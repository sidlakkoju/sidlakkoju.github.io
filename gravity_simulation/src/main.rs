mod glass;

use glass::{view_size, Compositor, GlassShape, GlassStyle, Planet, Scene};
use macroquad::prelude::*;
use std::cell::RefCell;
use std::sync::atomic::{AtomicI32, Ordering};

// Gravitational constant — not the real one (6.674e-11).
// Tuned to make pixel-scale bodies behave visibly.
const G: f32 = 1000.0;

// Pause state shared between Rust (canvas button) and JS (DOM overlay button).
// JS reads this via window.wasm_exports.set_paused after wasm instantiates.
static PAUSED: AtomicI32 = AtomicI32::new(0);

/// Exported to JS so the DOM-level pause button can toggle physics.
#[no_mangle]
pub extern "C" fn set_paused(p: i32) {
    PAUSED.store(p, Ordering::Relaxed);
}

#[no_mangle]
pub extern "C" fn is_paused() -> i32 {
    PAUSED.load(Ordering::Relaxed)
}

// On the web the pause / add / remove / mass controls are HTML elements
// layered over the canvas (so they can use real backdrop blur). The canvas
// versions are only drawn and hit-tested in native builds.
const CANVAS_UI: bool = cfg!(not(target_arch = "wasm32"));

// Simulation state lives in a thread-local so the exported functions below can
// read and edit it between frames. wasm is single-threaded and the main loop
// never holds the borrow across `next_frame().await`, so this can't conflict.
thread_local! {
    static WORLD: RefCell<World> = RefCell::new(World {
        bodies: Vec::new(),
        cx: 0.0,
        cy: 0.0,
        drag: Drag::None,
    });
}

// Body getters used by JS to position the per-body HTML controls each frame.
// Out-of-range indices return 0 rather than trapping.
fn with_body(i: i32, f: impl FnOnce(&Body) -> f32) -> f32 {
    WORLD.with_borrow(|w| w.bodies.get(i as usize).map(f).unwrap_or(0.0))
}

#[no_mangle]
pub extern "C" fn body_count() -> i32 {
    WORLD.with_borrow(|w| w.bodies.len() as i32)
}

#[no_mangle]
pub extern "C" fn body_x(i: i32) -> f32 {
    with_body(i, |b| b.pos.x)
}

#[no_mangle]
pub extern "C" fn body_y(i: i32) -> f32 {
    with_body(i, |b| b.pos.y)
}

#[no_mangle]
pub extern "C" fn body_radius(i: i32) -> f32 {
    with_body(i, |b| b.radius)
}

#[no_mangle]
pub extern "C" fn body_mass(i: i32) -> f32 {
    with_body(i, |b| b.mass)
}

#[no_mangle]
pub extern "C" fn add_body() {
    WORLD.with_borrow_mut(|w| w.add_body());
}

#[no_mangle]
pub extern "C" fn remove_body(i: i32) {
    WORLD.with_borrow_mut(|w| w.remove_body(i as usize));
}

/// 1 if a press at (x, y) (CSS px) would start dragging a body or a velocity
/// handle. The page uses it to decide whether a touch belongs to the sim or
/// should scroll the page.
#[no_mangle]
pub extern "C" fn grab_at(x: f32, y: f32) -> i32 {
    if PAUSED.load(Ordering::Relaxed) == 0 {
        return 0;
    }
    let p = vec2(x, y);
    WORLD.with_borrow(|w| {
        w.bodies
            .iter()
            .any(|b| hit_circle(velocity_tip(b), TIP_HIT_RADIUS, p) || hit_circle(b.pos, b.radius, p)) as i32
    })
}

/// `dir` is +1 or -1: one MASS_STEP up or down.
#[no_mangle]
pub extern "C" fn step_mass(i: i32, dir: i32) {
    WORLD.with_borrow_mut(|w| w.step_mass(i as usize, dir.signum() as f32 * MASS_STEP));
}

// ---------------------------------------------------------------------------
// PAGE OVERLAY (web)
// ---------------------------------------------------------------------------
//
// The page hands the renderer everything that has to sit *under* the glass:
// the headline and social icons (rasterized by the browser so they use the
// real system font), plus the rects of its glass panels and buttons. That way
// the glass refracts the name and icons too, not just the planets.

/// Per-body control geometry. Must match the JS in site/src/pages/index.astro.
const CTL_REMOVE_RADIUS: f32 = 14.0;
const CTL_STEPPER_HALF: Vec2 = vec2(58.0, 16.0);
const CTL_GAP: f32 = 14.0;

fn remove_center(b: &Body) -> Vec2 {
    let o = b.radius * 0.72 + CTL_GAP;
    b.pos + vec2(o, -o)
}

fn stepper_center(b: &Body) -> Vec2 {
    b.pos + vec2(0.0, b.radius + CTL_GAP + CTL_STEPPER_HALF.y)
}

struct Sprite {
    texture: Option<Texture2D>,
    // Raw RGBA waiting to become a texture on the next frame.
    pending: Option<(u16, u16, Vec<u8>)>,
    dest: Rect,
    offset: Vec2,
    alpha: f32,
}

impl Default for Sprite {
    fn default() -> Self {
        Sprite { texture: None, pending: None, dest: Rect::default(), offset: Vec2::ZERO, alpha: 1.0 }
    }
}

impl Sprite {
    fn realize(&mut self) {
        if let Some((w, h, bytes)) = self.pending.take() {
            let texture = Texture2D::from_rgba8(w, h, &bytes);
            texture.set_filter(FilterMode::Linear);
            self.texture = Some(texture);
        }
    }
}

#[derive(Default)]
struct Overlay {
    upload: Vec<u8>,
    hero: Sprite,
    icons: Sprite,
    // Where each icon cell of the atlas is drawn, and its opacity.
    icon_slots: Vec<(Rect, f32)>,
    glass: Vec<GlassShape>,
    body_ui_alpha: f32,
}

thread_local! {
    static OVERLAY: RefCell<Overlay> = RefCell::new(Overlay::default());
}

/// Returns a buffer of `len` bytes for JS to write RGBA pixels into, ahead
/// of `ui_upload`. JS must re-read wasm memory after calling (it may grow).
#[no_mangle]
pub extern "C" fn ui_alloc(len: i32) -> *mut u8 {
    OVERLAY.with_borrow_mut(|o| {
        o.upload.clear();
        o.upload.resize(len.max(0) as usize, 0);
        o.upload.as_mut_ptr()
    })
}

/// Turns the uploaded pixels into slot 0 (headline, drawn with difference
/// blending at x/y/w/h) or slot 1 (icon atlas of square cells).
#[no_mangle]
pub extern "C" fn ui_upload(slot: i32, pw: i32, ph: i32, x: f32, y: f32, w: f32, h: f32) {
    OVERLAY.with_borrow_mut(|o| {
        let bytes = std::mem::take(&mut o.upload);
        let sprite = if slot == 0 { &mut o.hero } else { &mut o.icons };
        sprite.pending = Some((pw as u16, ph as u16, bytes));
        sprite.dest = Rect::new(x, y, w, h);
        sprite.offset = Vec2::ZERO;
    });
}

/// Moves the uploaded headline without re-rasterizing it (it glides up to
/// make room for the info card).
#[no_mangle]
pub extern "C" fn ui_offset(slot: i32, dx: f32, dy: f32) {
    OVERLAY.with_borrow_mut(|o| {
        let sprite = if slot == 0 { &mut o.hero } else { &mut o.icons };
        sprite.offset = vec2(dx, dy);
    });
}

/// Opacity of the uploaded headline (it fades as the page scrolls).
#[no_mangle]
pub extern "C" fn ui_alpha(slot: i32, alpha: f32) {
    OVERLAY.with_borrow_mut(|o| {
        let sprite = if slot == 0 { &mut o.hero } else { &mut o.icons };
        sprite.alpha = alpha.clamp(0.0, 1.0);
    });
}

#[no_mangle]
pub extern "C" fn icon_set(i: i32, x: f32, y: f32, w: f32, h: f32, alpha: f32) {
    OVERLAY.with_borrow_mut(|o| {
        let i = i as usize;
        if o.icon_slots.len() <= i {
            o.icon_slots.resize(i + 1, (Rect::default(), 0.0));
        }
        o.icon_slots[i] = (Rect::new(x, y, w, h), alpha);
    });
}

#[no_mangle]
pub extern "C" fn glass_clear() {
    OVERLAY.with_borrow_mut(|o| o.glass.clear());
}

/// Adds a page glass shape (CSS px). `style` 0 = clear control, 1 = frosted panel.
#[no_mangle]
pub extern "C" fn glass_push(x: f32, y: f32, w: f32, h: f32, radius: f32, alpha: f32, style: i32) {
    OVERLAY.with_borrow_mut(|o| {
        o.glass.push(GlassShape {
            center: vec2(x + w / 2.0, y + h / 2.0),
            half: vec2(w / 2.0, h / 2.0),
            radius,
            alpha,
            style: if style == 1 { GlassStyle::Frosted } else { GlassStyle::Clear },
        });
    });
}

/// Device px per CSS px for the screen pass. The page caps it below the
/// display's pixel ratio and lowers it further when frames run long; it
/// resizes the canvas backing store to match right after.
#[no_mangle]
pub extern "C" fn set_render_scale(scale: f32) {
    glass::set_render_scale(scale);
}

/// Opacity of the per-body controls (they fade with pause).
#[no_mangle]
pub extern "C" fn set_body_ui_alpha(alpha: f32) {
    OVERLAY.with_borrow_mut(|o| o.body_ui_alpha = alpha);
}

// ---------------------------------------------------------------------------
// UI CONSTANTS
// ---------------------------------------------------------------------------

// Pixels drawn per velocity unit when rendering the velocity arrow. Also used
// inversely to convert a dragged tip position back into a velocity value.
const VEL_SCALE: f32 = 0.25;

// Radius (in pixels) of the grab handle at the velocity arrow tip.
const TIP_HIT_RADIUS: f32 = 14.0;

// Pause / plus button geometry.
const BTN_SIZE: f32 = 48.0;
const BTN_MARGIN: f32 = 16.0;
const BTN_GAP: f32 = 12.0;

// Per-body minus button geometry.
const MINUS_BTN_RADIUS: f32 = 12.0;
const MINUS_BTN_OFFSET: f32 = 18.0;

// Mass stepper ([-] 10000 [+]) drawn below each body when paused.
const BASE_MASS: f32 = 10000.0;
const BASE_RADIUS: f32 = 30.0;
const MASS_STEP: f32 = 1000.0;
const MASS_MIN: f32 = 100.0;
const MASS_BTN_SIZE: f32 = 22.0;
const MASS_BTN_GAP: f32 = 6.0;
const MASS_LABEL_MIN_W: f32 = 58.0;
const MASS_ROW_OFFSET: f32 = 16.0;
const MASS_FONT_SIZE: u16 = 18;

// Cycled through when the user adds bodies via the + button.
// const PALETTE: &[Color] = &[YELLOW, BLUE, RED, GREEN, PURPLE, ORANGE, PINK, SKYBLUE, LIME, GOLD];
const PALETTE: &[Color] = &[
    Color::from_hex(0x00F0FF),
    Color::from_hex(0x2E5BFF),
    Color::from_hex(0xC0C8D8),
    Color::from_hex(0x0B0F1A),
    Color::from_hex(0x008B8B),
    Color::from_hex(0xB22222),
    Color::from_hex(0xFF4500),
    Color::from_hex(0xB57EDC),
    Color::from_hex(0x0A1A40),
    Color::from_hex(0xFF2D95),
];

// A single gravitating body with position, velocity, mass, radius, and color.
#[derive(Clone, Copy, Debug)]
struct Body {
    pos: Vec2,
    vel: Vec2,
    mass: f32,
    radius: f32,
    color: Color,
}

impl Body {
    fn new(pos: Vec2, vel: Vec2, mass: f32, radius: f32, color: Color) -> Self {
        Self { pos, vel, mass, radius, color }
    }
}

// What (if anything) the user is currently dragging with the mouse.
// Both variants carry an index into the `bodies` vec; callers must guard
// against the index becoming stale after a remove.
#[derive(Clone, Copy, PartialEq)]
enum Drag {
    None,
    Body { idx: usize, offset: Vec2 },
    VelTip { idx: usize },
}

struct World {
    bodies: Vec<Body>,
    // Canvas center; tracked so bodies can be re-centered on resize.
    cx: f32,
    cy: f32,
    drag: Drag,
}

impl World {
    fn add_body(&mut self) {
        let jitter = vec2(
            rand::gen_range(-100.0, 100.0),
            rand::gen_range(-100.0, 100.0),
        );
        let color = PALETTE[self.bodies.len() % PALETTE.len()];
        self.bodies.push(Body::new(
            vec2(self.cx, self.cy) + jitter,
            Vec2::ZERO,
            BASE_MASS,
            BASE_RADIUS,
            color,
        ));
    }

    fn remove_body(&mut self, i: usize) {
        if i < self.bodies.len() {
            self.bodies.remove(i);
            self.drag = Drag::None;
        }
    }

    fn step_mass(&mut self, i: usize, delta: f32) {
        if let Some(b) = self.bodies.get_mut(i) {
            b.mass = (b.mass + delta).max(MASS_MIN);
            b.radius = radius_for_mass(b.mass);
        }
    }
}

// ---------------------------------------------------------------------------
// PHYSICS
// ---------------------------------------------------------------------------

/// Computes the gravitational acceleration on each body due to all others.
/// Uses Newton's law: F = G * m1 * m2 / d². A softening factor (+1.0) prevents
/// the force from blowing up when two bodies get very close.
/// Each pair is processed once and Newton's third law gives the opposite force for free.
fn compute_accelerations(bodies: &[Body]) -> Vec<Vec2> {
    let mut accels = vec![Vec2::ZERO; bodies.len()];

    for i in 0..bodies.len() {
        for j in (i + 1)..bodies.len() {
            let r = bodies[j].pos - bodies[i].pos;
            let dist_sq = r.length_squared();
            let dist = dist_sq.sqrt();

            let softened_dist_sq = dist_sq + 1.0;

            let force_mag = G * bodies[i].mass * bodies[j].mass / softened_dist_sq;
            let dir = r / dist;

            accels[i] += dir * force_mag / bodies[i].mass;
            accels[j] -= dir * force_mag / bodies[j].mass;
        }
    }

    accels
}

/// Advances each body's velocity then position by `dt` seconds (semi-implicit Euler).
/// Updating velocity before position conserves energy better than plain Euler,
/// keeping orbits stable over time.
fn integrate(bodies: &mut [Body], accels: &[Vec2], dt: f32) {
    for (body, &accel) in bodies.iter_mut().zip(accels.iter()) {
        body.vel += accel * dt;
        body.pos += body.vel * dt;
    }
}

/// Detects overlapping body pairs and resolves them as elastic collisions.
/// Phase 1 pushes the bodies apart (weighted by mass) to eliminate overlap.
/// Phase 2 applies an impulse along the collision normal to reverse their
/// relative approach velocity, conserving both momentum and kinetic energy.
fn resolve_collisions(bodies: &mut [Body]) {
    for i in 0..bodies.len() {
        for j in (i + 1)..bodies.len() {
            let (left, right) = bodies.split_at_mut(j);
            let a = &mut left[i];
            let b = &mut right[0];

            let delta = b.pos - a.pos;
            let dist = delta.length();

            let overlap = (a.radius + b.radius) - dist;
            if overlap <= 0.0 {
                continue;
            }

            let n = delta / dist;

            // Phase 1: positional correction.
            let total_mass = a.mass + b.mass;
            a.pos -= n * (overlap * b.mass / total_mass);
            b.pos += n * (overlap * a.mass / total_mass);

            // Phase 2: velocity impulse.
            let vel_along = (b.vel - a.vel).dot(n);
            if vel_along >= 0.0 {
                continue;
            }

            let j = -(2.0 * vel_along) / (1.0 / a.mass + 1.0 / b.mass);
            let impulse = n * j;
            a.vel -= impulse / a.mass;
            b.vel += impulse / b.mass;
        }
    }
}

// ---------------------------------------------------------------------------
// UI HELPERS
// ---------------------------------------------------------------------------

fn hit_rect(r: Rect, p: Vec2) -> bool {
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

fn hit_circle(center: Vec2, radius: f32, p: Vec2) -> bool {
    (p - center).length_squared() <= radius * radius
}

/// Where the velocity-arrow tip is drawn (and the grab handle for velocity dragging).
fn velocity_tip(b: &Body) -> Vec2 {
    b.pos + b.vel * VEL_SCALE
}

/// Position of the body's minus button, offset from the body's upper-right edge.
fn minus_button_center(b: &Body) -> Vec2 {
    let offset = b.radius + MINUS_BTN_OFFSET;
    b.pos + vec2(offset, -offset)
}

fn pause_button_rect() -> Rect {
    Rect::new(
        view_size().x - BTN_MARGIN - BTN_SIZE,
        BTN_MARGIN,
        BTN_SIZE,
        BTN_SIZE,
    )
}

fn plus_button_rect() -> Rect {
    Rect::new(
        view_size().x - BTN_MARGIN - BTN_SIZE * 2.0 - BTN_GAP,
        BTN_MARGIN,
        BTN_SIZE,
        BTN_SIZE,
    )
}

/// Area-proportional size: r ∝ √mass, anchored so (BASE_MASS → BASE_RADIUS).
fn radius_for_mass(mass: f32) -> f32 {
    BASE_RADIUS * (mass / BASE_MASS).sqrt()
}

/// Layout for a body's mass stepper row: `[ − ] 10000 [ + ]`, centered
/// horizontally below the body. Returns (minus_rect, label_rect, plus_rect).
fn mass_row_rects(b: &Body) -> (Rect, Rect, Rect) {
    let text = format!("{}", b.mass as i32);
    let dim = measure_text(&text, None, MASS_FONT_SIZE, 1.0);
    let label_w = dim.width.max(MASS_LABEL_MIN_W);
    let row_w = MASS_BTN_SIZE * 2.0 + MASS_BTN_GAP * 2.0 + label_w;
    let row_x = b.pos.x - row_w / 2.0;
    let row_y = b.pos.y + b.radius + MASS_ROW_OFFSET;

    let minus = Rect::new(row_x, row_y, MASS_BTN_SIZE, MASS_BTN_SIZE);
    let label = Rect::new(
        row_x + MASS_BTN_SIZE + MASS_BTN_GAP,
        row_y,
        label_w,
        MASS_BTN_SIZE,
    );
    let plus = Rect::new(
        row_x + row_w - MASS_BTN_SIZE,
        row_y,
        MASS_BTN_SIZE,
        MASS_BTN_SIZE,
    );
    (minus, label, plus)
}

fn draw_button_rect(rect: Rect, hot: bool) {
    let fill = if hot {
        Color::new(1.0, 1.0, 1.0, 0.18)
    } else {
        Color::new(0.0, 0.0, 0.0, 0.45)
    };
    draw_rectangle(rect.x, rect.y, rect.w, rect.h, fill);
    draw_rectangle_lines(rect.x, rect.y, rect.w, rect.h, 2.0, WHITE);
}

fn draw_pause_glyph(rect: Rect) {
    let bar_w = rect.w * 0.14;
    let bar_h = rect.h * 0.46;
    let cx = rect.x + rect.w / 2.0;
    let cy = rect.y + rect.h / 2.0;
    let gap = rect.w * 0.09;
    draw_rectangle(cx - gap - bar_w, cy - bar_h / 2.0, bar_w, bar_h, WHITE);
    draw_rectangle(cx + gap, cy - bar_h / 2.0, bar_w, bar_h, WHITE);
}

fn draw_play_glyph(rect: Rect) {
    let cx = rect.x + rect.w / 2.0;
    let cy = rect.y + rect.h / 2.0;
    let s = rect.w * 0.22;
    let p1 = vec2(cx - s * 0.55, cy - s);
    let p2 = vec2(cx - s * 0.55, cy + s);
    let p3 = vec2(cx + s * 0.9, cy);
    draw_triangle(p1, p2, p3, WHITE);
}

fn draw_plus_glyph(rect: Rect) {
    let cx = rect.x + rect.w / 2.0;
    let cy = rect.y + rect.h / 2.0;
    let bar_len = rect.w * 0.48;
    let bar_thick = rect.w * 0.12;
    draw_rectangle(cx - bar_len / 2.0, cy - bar_thick / 2.0, bar_len, bar_thick, WHITE);
    draw_rectangle(cx - bar_thick / 2.0, cy - bar_len / 2.0, bar_thick, bar_len, WHITE);
}

fn draw_minus_glyph(rect: Rect) {
    let cx = rect.x + rect.w / 2.0;
    let cy = rect.y + rect.h / 2.0;
    let bar_len = rect.w * 0.48;
    let bar_thick = rect.w * 0.12;
    draw_rectangle(cx - bar_len / 2.0, cy - bar_thick / 2.0, bar_len, bar_thick, WHITE);
}

fn draw_mass_stepper(body: &Body, mouse: Vec2) {
    let (minus, label, plus) = mass_row_rects(body);

    draw_button_rect(minus, hit_rect(minus, mouse));
    draw_minus_glyph(minus);

    draw_rectangle(label.x, label.y, label.w, label.h, Color::new(0.0, 0.0, 0.0, 0.55));
    draw_rectangle_lines(label.x, label.y, label.w, label.h, 2.0, WHITE);

    let text = format!("{}", body.mass as i32);
    let dim = measure_text(&text, None, MASS_FONT_SIZE, 1.0);
    let tx = label.x + (label.w - dim.width) / 2.0;
    let ty = label.y + (label.h + dim.offset_y) / 2.0;
    draw_text(&text, tx, ty, MASS_FONT_SIZE as f32, WHITE);

    draw_button_rect(plus, hit_rect(plus, mouse));
    draw_plus_glyph(plus);
}

fn draw_minus_button(center: Vec2, hot: bool) {
    let fill = if hot {
        Color::new(1.0, 0.3, 0.3, 0.9)
    } else {
        Color::new(0.0, 0.0, 0.0, 0.75)
    };
    draw_circle(center.x, center.y, MINUS_BTN_RADIUS, fill);
    draw_circle_lines(center.x, center.y, MINUS_BTN_RADIUS, 2.0, WHITE);
    let bar = MINUS_BTN_RADIUS * 0.55;
    draw_line(
        center.x - bar,
        center.y,
        center.x + bar,
        center.y,
        2.5,
        WHITE,
    );
}

fn draw_velocity_arrow(body: &Body) {
    let tip = velocity_tip(body);
    let delta = tip - body.pos;
    let line = Color::new(1.0, 1.0, 1.0, 0.85);
    let handle_fill = Color::new(1.0, 1.0, 1.0, 0.14);
    let handle_ring = Color::new(1.0, 1.0, 1.0, 0.9);

    // If velocity is effectively zero, just draw the grab handle on top of
    // the body so the user can still pick it up to start dragging velocity.
    if delta.length_squared() < 4.0 {
        draw_poly(body.pos.x, body.pos.y, 48, TIP_HIT_RADIUS, 0.0, handle_fill);
        draw_poly_lines(body.pos.x, body.pos.y, 48, TIP_HIT_RADIUS, 0.0, 1.5, handle_ring);
        return;
    }

    let dir = delta.normalize();
    let perp = vec2(-dir.y, dir.x);
    let head_len = 11.0;
    let head_w = 6.0;
    // Stop the shaft at the arrowhead base so the translucent line and head
    // don't overlap into a brighter seam.
    let base = tip - dir * head_len;
    draw_line(body.pos.x, body.pos.y, base.x, base.y, 2.0, line);
    draw_triangle(tip, base + perp * head_w, base - perp * head_w, line);

    draw_poly(tip.x, tip.y, 48, TIP_HIT_RADIUS, 0.0, handle_fill);
    draw_poly_lines(tip.x, tip.y, 48, TIP_HIT_RADIUS, 0.0, 1.5, handle_ring);
}

// ---------------------------------------------------------------------------
// MAIN LOOP
// ---------------------------------------------------------------------------

// Builds the initial 3-body configuration: an equilateral triangle inscribed
// in a circle of radius `spread` around (cx, cy), each body given a tangential
// velocity for counter-clockwise orbit.
fn initial_bodies(cx: f32, cy: f32) -> Vec<Body> {
    let spread = 100.0;
    let angle_step = 2.0 * std::f32::consts::PI / 3.0;
    let start_angle = std::f32::consts::PI / 2.0;
    let speed = 300.0;

    (0..3).map(|i| {
        let angle = start_angle + i as f32 * angle_step;
        let pos = vec2(cx + spread * angle.cos(), cy - spread * angle.sin());
        let vel = vec2(-angle.sin(), -angle.cos()) * speed;
        Body::new(pos, vel, BASE_MASS, BASE_RADIUS, PALETTE[i % PALETTE.len()])
    }).collect()
}

fn window_conf() -> Conf {
    Conf {
        window_title: "Gravity Simulation".to_owned(),
        window_width: 1280,
        window_height: 800,
        high_dpi: true,
        // WebGL2: the glass passes rely on non-power-of-two render targets
        // and textures, which WebGL1 restricts.
        platform: miniquad::conf::Platform {
            webgl_version: miniquad::conf::WebGLVersion::WebGL2,
            ..Default::default()
        },
        ..Default::default()
    }
}

// Run multiple physics steps per frame to reduce energy drift during
// close encounters and collisions.
const SUBSTEPS: u32 = 8;

/// One frame of input, physics, and rendering.
/// Per-frame lists, kept between frames so the steady state allocates nothing.
#[derive(Default)]
struct Scratch {
    planets: Vec<Planet>,
    shapes: Vec<GlassShape>,
}

fn frame(w: &mut World, overlay: &mut Overlay, compositor: &mut Compositor, scratch: &mut Scratch) {
    // If the canvas resized, translate every body by the delta between
    // the old and new center so the system stays visually centered.
    let view = view_size();
    let new_cx = view.x / 2.0;
    let new_cy = view.y / 2.0;
    if (new_cx - w.cx).abs() > 0.5 || (new_cy - w.cy).abs() > 0.5 {
        let shift = vec2(new_cx - w.cx, new_cy - w.cy);
        for body in &mut w.bodies {
            body.pos += shift;
        }
        w.cx = new_cx;
        w.cy = new_cy;
    }

    // Space toggles pause. JS reads the shared atomic each frame, so the
    // HTML controls follow along.
    if is_key_pressed(KeyCode::Space) {
        PAUSED.fetch_xor(1, Ordering::Relaxed);
        w.drag = Drag::None;
    }

    let paused = PAUSED.load(Ordering::Relaxed) != 0;

    // ----- Input -----
    let (mx, my) = mouse_position();
    let mouse = vec2(mx, my);
    let pressed = is_mouse_button_pressed(MouseButton::Left);
    let down = is_mouse_button_down(MouseButton::Left);
    let released = is_mouse_button_released(MouseButton::Left);

    let pause_rect = pause_button_rect();
    let plus_rect = plus_button_rect();

    if pressed {
        if CANVAS_UI && hit_rect(pause_rect, mouse) {
            PAUSED.fetch_xor(1, Ordering::Relaxed);
            w.drag = Drag::None;
        } else if paused {
            // Click-dispatch order: UI buttons > minus buttons > velocity
            // tips > bodies. Minus before vel-tip so removal beats
            // accidental drag start when they visually overlap.
            let mass_hit = || {
                w.bodies.iter().enumerate().find_map(|(i, b)| {
                    let (m, _, p) = mass_row_rects(b);
                    if hit_rect(m, mouse) {
                        Some((i, -MASS_STEP))
                    } else if hit_rect(p, mouse) {
                        Some((i, MASS_STEP))
                    } else {
                        None
                    }
                })
            };

            if CANVAS_UI && hit_rect(plus_rect, mouse) {
                w.add_body();
            } else if let Some(i) = w.bodies.iter().position(|b| {
                CANVAS_UI && hit_circle(minus_button_center(b), MINUS_BTN_RADIUS, mouse)
            }) {
                w.remove_body(i);
            } else if let Some((i, delta)) = mass_hit().filter(|_| CANVAS_UI) {
                w.step_mass(i, delta);
            } else if let Some(i) = w
                .bodies
                .iter()
                .position(|b| hit_circle(velocity_tip(b), TIP_HIT_RADIUS, mouse))
            {
                w.drag = Drag::VelTip { idx: i };
            } else if let Some(i) = w
                .bodies
                .iter()
                .position(|b| hit_circle(b.pos, b.radius, mouse))
            {
                w.drag = Drag::Body {
                    idx: i,
                    offset: mouse - w.bodies[i].pos,
                };
            }
        }
    }

    if down {
        match w.drag {
            Drag::Body { idx, offset } if idx < w.bodies.len() => {
                w.bodies[idx].pos = mouse - offset;
            }
            Drag::VelTip { idx } if idx < w.bodies.len() => {
                w.bodies[idx].vel = (mouse - w.bodies[idx].pos) / VEL_SCALE;
            }
            _ => {}
        }
    }

    if released {
        w.drag = Drag::None;
    }

    // ----- Physics (skipped while paused) -----
    if !paused {
        // Clamp dt so a long pause (e.g. tab backgrounded) can't produce
        // one huge step that tunnels bodies through each other on resume.
        let frame_time = get_frame_time().min(1.0 / 30.0);
        let dt = frame_time / SUBSTEPS as f32;

        for _ in 0..SUBSTEPS {
            let accels = compute_accelerations(&w.bodies);
            integrate(&mut w.bodies, &accels, dt);
            resolve_collisions(&mut w.bodies);
        }
    }

    // ----- Render -----
    overlay.hero.realize();
    overlay.icons.realize();
    let Scratch { planets, shapes } = scratch;
    planets.clear();
    planets.extend(w.bodies.iter().map(|b| Planet { center: b.pos, radius: b.radius, color: b.color }));
    let scene = Scene {
        planets: &planets[..],
        hero: overlay
            .hero
            .texture
            .as_ref()
            .map(|t| (t, overlay.hero.dest.offset(overlay.hero.offset), overlay.hero.alpha)),
        icons: overlay.icons.texture.as_ref().map(|t| (t, &overlay.icon_slots[..])),
    };
    let arrows = || {
        if paused {
            for body in &w.bodies {
                draw_velocity_arrow(body);
            }
        }
    };

    // Glass, back to front: panels, then per-body controls, then the small
    // page controls, matching the HTML stacking order.
    shapes.clear();
    shapes.extend(overlay.glass.iter().filter(|s| matches!(s.style, GlassStyle::Frosted)).copied());
    if overlay.body_ui_alpha > 0.001 {
        for b in &w.bodies {
            shapes.push(GlassShape {
                center: remove_center(b),
                half: Vec2::splat(CTL_REMOVE_RADIUS),
                radius: CTL_REMOVE_RADIUS,
                alpha: overlay.body_ui_alpha,
                style: GlassStyle::Clear,
            });
            shapes.push(GlassShape {
                center: stepper_center(b),
                half: CTL_STEPPER_HALF,
                radius: CTL_STEPPER_HALF.y,
                alpha: overlay.body_ui_alpha,
                style: GlassStyle::Clear,
            });
        }
    }
    shapes.extend(overlay.glass.iter().filter(|s| matches!(s.style, GlassStyle::Clear)).copied());
    compositor.render(&scene, &arrows, &shapes[..]);

    if CANVAS_UI {
        if paused {
            for body in &w.bodies {
                draw_mass_stepper(body, mouse);
            }
            for body in &w.bodies {
                let center = minus_button_center(body);
                draw_minus_button(center, hit_circle(center, MINUS_BTN_RADIUS, mouse));
            }
            draw_button_rect(plus_rect, hit_rect(plus_rect, mouse));
            draw_plus_glyph(plus_rect);
        }

        draw_button_rect(pause_rect, hit_rect(pause_rect, mouse));
        if paused {
            draw_play_glyph(pause_rect);
        } else {
            draw_pause_glyph(pause_rect);
        }
    }
}

#[macroquad::main(window_conf)]
async fn main() {
    // Defer initialization until macroquad reports a real viewport size.
    // On web the canvas can report 0×0 for a frame or two after launch.
    loop {
        let Vec2 { x: w, y: h } = view_size();
        if w > 1.0 && h > 1.0 {
            WORLD.with_borrow_mut(|world| {
                world.cx = w / 2.0;
                world.cy = h / 2.0;
                world.bodies = initial_bodies(world.cx, world.cy);
            });
            break;
        }
        next_frame().await;
    }

    let mut compositor = Compositor::new();
    let mut scratch = Scratch::default();
    loop {
        WORLD.with_borrow_mut(|world| {
            OVERLAY.with_borrow_mut(|overlay| frame(world, overlay, &mut compositor, &mut scratch))
        });
        next_frame().await;
    }
}
