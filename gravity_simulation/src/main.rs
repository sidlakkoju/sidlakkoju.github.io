use macroquad::prelude::*;

// Gravitational constant — not the real one (6.674e-11).
// Tuned to make pixel-scale bodies behave visibly.
const G: f32 = 1000.0;

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

// Cycled through when the user adds bodies via the + button.
const PALETTE: &[Color] = &[YELLOW, BLUE, RED, GREEN, PURPLE, ORANGE, PINK, SKYBLUE, LIME, GOLD];

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

    fn draw(&self) {
        draw_circle(self.pos.x, self.pos.y, self.radius, self.color);
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

struct Ui {
    paused: bool,
    drag: Drag,
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
        screen_width() - BTN_MARGIN - BTN_SIZE,
        BTN_MARGIN,
        BTN_SIZE,
        BTN_SIZE,
    )
}

fn plus_button_rect() -> Rect {
    Rect::new(
        screen_width() - BTN_MARGIN - BTN_SIZE * 2.0 - BTN_GAP,
        BTN_MARGIN,
        BTN_SIZE,
        BTN_SIZE,
    )
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

    // If velocity is effectively zero, just draw the grab handle on top of
    // the body so the user can still pick it up to start dragging velocity.
    if delta.length_squared() < 4.0 {
        draw_circle_lines(body.pos.x, body.pos.y, TIP_HIT_RADIUS, 2.0, WHITE);
        return;
    }

    draw_line(body.pos.x, body.pos.y, tip.x, tip.y, 2.5, WHITE);

    let dir = delta.normalize();
    let perp = vec2(-dir.y, dir.x);
    let head_len = 12.0;
    let head_w = 7.0;
    let base = tip - dir * head_len;
    draw_triangle(tip, base + perp * head_w, base - perp * head_w, WHITE);

    draw_circle_lines(tip.x, tip.y, TIP_HIT_RADIUS, 2.0, WHITE);
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
        Body::new(pos, vel, 10000.0, 30.0, [YELLOW, BLUE, RED][i])
    }).collect()
}

fn window_conf() -> Conf {
    Conf {
        window_title: "Gravity Simulation".to_owned(),
        window_width: 1280,
        window_height: 800,
        high_dpi: true,
        ..Default::default()
    }
}

#[macroquad::main(window_conf)]
async fn main() {
    // Defer initialization until macroquad reports a real viewport size.
    // On web the canvas can report 0×0 for a frame or two after launch.
    let mut cx;
    let mut cy;
    loop {
        let w = screen_width();
        let h = screen_height();
        if w > 1.0 && h > 1.0 {
            cx = w / 2.0;
            cy = h / 2.0;
            break;
        }
        next_frame().await;
    }
    let mut bodies = initial_bodies(cx, cy);
    let mut ui = Ui { paused: false, drag: Drag::None };

    // Run multiple physics steps per frame to reduce energy drift during
    // close encounters and collisions.
    const SUBSTEPS: u32 = 8;

    loop {
        // If the canvas resized, translate every body by the delta between
        // the old and new center so the system stays visually centered.
        let new_cx = screen_width() / 2.0;
        let new_cy = screen_height() / 2.0;
        if (new_cx - cx).abs() > 0.5 || (new_cy - cy).abs() > 0.5 {
            let shift = vec2(new_cx - cx, new_cy - cy);
            for body in &mut bodies {
                body.pos += shift;
            }
            cx = new_cx;
            cy = new_cy;
        }

        // ----- Input -----
        let (mx, my) = mouse_position();
        let mouse = vec2(mx, my);
        let pressed = is_mouse_button_pressed(MouseButton::Left);
        let down = is_mouse_button_down(MouseButton::Left);
        let released = is_mouse_button_released(MouseButton::Left);

        let pause_rect = pause_button_rect();
        let plus_rect = plus_button_rect();

        if pressed {
            if hit_rect(pause_rect, mouse) {
                ui.paused = !ui.paused;
                ui.drag = Drag::None;
            } else if ui.paused {
                // Click-dispatch order: UI buttons > minus buttons > velocity
                // tips > bodies. Minus before vel-tip so removal beats
                // accidental drag start when they visually overlap.
                if hit_rect(plus_rect, mouse) {
                    let jitter = vec2(
                        rand::gen_range(-100.0, 100.0),
                        rand::gen_range(-100.0, 100.0),
                    );
                    let color = PALETTE[bodies.len() % PALETTE.len()];
                    bodies.push(Body::new(
                        vec2(cx, cy) + jitter,
                        Vec2::ZERO,
                        10000.0,
                        30.0,
                        color,
                    ));
                } else if let Some(i) = bodies
                    .iter()
                    .position(|b| hit_circle(minus_button_center(b), MINUS_BTN_RADIUS, mouse))
                {
                    bodies.remove(i);
                } else if let Some(i) = bodies
                    .iter()
                    .position(|b| hit_circle(velocity_tip(b), TIP_HIT_RADIUS, mouse))
                {
                    ui.drag = Drag::VelTip { idx: i };
                } else if let Some(i) = bodies
                    .iter()
                    .position(|b| hit_circle(b.pos, b.radius, mouse))
                {
                    ui.drag = Drag::Body {
                        idx: i,
                        offset: mouse - bodies[i].pos,
                    };
                }
            }
        }

        if down {
            match ui.drag {
                Drag::Body { idx, offset } if idx < bodies.len() => {
                    bodies[idx].pos = mouse - offset;
                }
                Drag::VelTip { idx } if idx < bodies.len() => {
                    bodies[idx].vel = (mouse - bodies[idx].pos) / VEL_SCALE;
                }
                _ => {}
            }
        }

        if released {
            ui.drag = Drag::None;
        }

        // ----- Physics (skipped while paused) -----
        if !ui.paused {
            // Clamp dt so a long pause (e.g. tab backgrounded) can't produce
            // one huge step that tunnels bodies through each other on resume.
            let frame_time = get_frame_time().min(1.0 / 30.0);
            let dt = frame_time / SUBSTEPS as f32;

            for _ in 0..SUBSTEPS {
                let accels = compute_accelerations(&bodies);
                integrate(&mut bodies, &accels, dt);
                resolve_collisions(&mut bodies);
            }
        }

        // ----- Render -----
        clear_background(BLACK);
        for body in &bodies {
            body.draw();
        }

        if ui.paused {
            for body in &bodies {
                draw_velocity_arrow(body);
            }
            for body in &bodies {
                let center = minus_button_center(body);
                draw_minus_button(center, hit_circle(center, MINUS_BTN_RADIUS, mouse));
            }
            draw_button_rect(plus_rect, hit_rect(plus_rect, mouse));
            draw_plus_glyph(plus_rect);
        }

        draw_button_rect(pause_rect, hit_rect(pause_rect, mouse));
        if ui.paused {
            draw_play_glyph(pause_rect);
        } else {
            draw_pause_glyph(pause_rect);
        }

        next_frame().await;
    }
}
