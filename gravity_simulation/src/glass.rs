//! Scene rendering, glass-bead planets, and the refractive "liquid glass" UI.
//!
//! Each frame the scene (planets, headline, icons, arrows) is drawn twice:
//! once into a small 1x (CSS-pixel) render target, and once straight to the
//! screen at full device resolution. The glass UI on top samples the small
//! copy (and a blurred version of it) through a curved-edge lens model, so
//! light bends around its rim the way it does through real rounded glass.
//! Drawing straight to the screen avoids a full-resolution offscreen pass and
//! copy, which is what dominates on 3x phone displays.
//!
//! The browser can't do this with CSS (backdrop-filter only blurs, and Safari
//! ignores SVG displacement filters there), which is why the glass lives in
//! the renderer and the HTML on top only carries text and icons.

use macroquad::miniquad::{BlendFactor, BlendState, BlendValue, Equation};
use macroquad::models::{Mesh, Vertex};
use macroquad::prelude::*;

/// How a glass shape treats what's behind it.
#[derive(Clone, Copy)]
pub enum GlassStyle {
    /// Small controls: mostly clear, strong edge refraction.
    Clear,
    /// Text panels: frosted and dimmed so copy stays legible, softer edge.
    Frosted,
}

#[derive(Clone, Copy)]
pub struct GlassShape {
    pub center: Vec2,
    pub half: Vec2,
    pub radius: f32,
    pub alpha: f32,
    pub style: GlassStyle,
}

impl GlassStyle {
    /// (frost, darken, lift, refraction px). Packed into the vertex color.
    fn params(self) -> [f32; 4] {
        match self {
            GlassStyle::Clear => [0.32, 0.05, 0.04, 16.0],
            GlassStyle::Frosted => [1.0, 0.55, 0.04, 22.0],
        }
    }
}

const MAX_REFRACTION: f32 = 32.0;
const MAX_LIFT: f32 = 0.25;

/// A planet, drawn as a glass bead.
#[derive(Clone, Copy)]
pub struct Planet {
    pub center: Vec2,
    pub radius: f32,
    pub color: Color,
}

/// What the scene pass draws.
pub struct Scene<'a> {
    pub planets: &'a [Planet],
    /// Headline texture and where it goes (CSS px); drawn with difference blending.
    pub hero: Option<(&'a Texture2D, Rect)>,
    /// Icon atlas (square cells, left to right) and each icon's rect + opacity.
    pub icons: Option<(&'a Texture2D, &'a [(Rect, f32)])>,
}

const VERTEX: &str = r#"#version 100
attribute vec3 position;
attribute vec2 texcoord;
attribute vec4 color0;
attribute vec4 normal;

varying vec2 v_pos;
varying vec2 v_uv;
varying vec4 v_color;
varying vec4 v_shape;

uniform mat4 Model;
uniform mat4 Projection;

void main() {
    gl_Position = Projection * Model * vec4(position, 1.0);
    v_pos = position.xy;
    v_uv = texcoord;
    v_color = color0 / 255.0;
    v_shape = normal;
}
"#;

const GLASS_FRAGMENT: &str = r#"#version 100
precision highp float;

varying vec2 v_pos;    // fragment position, CSS px
varying vec2 v_uv;     // (corner radius, alpha)
varying vec4 v_color;  // (frost, darken, lift, refraction), normalized
varying vec4 v_shape;  // (center.xy, half-size.xy)

uniform sampler2D SceneTex;
uniform sampler2D BlurTex;
uniform vec4 Screen;   // (css width, css height, device pixel ratio, unused)

float sd_round_box(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec2 to_uv(vec2 pos) {
    // Render targets are stored bottom-up.
    vec2 uv = clamp(pos / Screen.xy, 0.0, 1.0);
    uv.y = 1.0 - uv.y;
    return uv;
}

vec3 backdrop(vec2 pos, float frost) {
    vec2 uv = to_uv(pos);
    return mix(texture2D(SceneTex, uv).rgb, texture2D(BlurTex, uv).rgb, frost);
}

void main() {
    vec2 half_size = v_shape.zw;
    float radius = min(v_uv.x, min(half_size.x, half_size.y));
    float alpha = v_uv.y;
    float frost = v_color.x;
    float darken = v_color.y;
    float lift = v_color.z * 0.25;
    float refraction = v_color.w * 32.0;

    vec2 p = v_pos - v_shape.xy;
    float d = sd_round_box(p, half_size, radius);

    // Analytic-width antialiasing at the silhouette: one device pixel.
    float px = 1.0 / Screen.z;
    float coverage = clamp(0.5 - d / px, 0.0, 1.0);
    if (coverage <= 0.0) discard;

    // Outward surface direction from the distance field gradient.
    const float e = 0.35;
    vec2 n = vec2(
        sd_round_box(p + vec2(e, 0.0), half_size, radius) - sd_round_box(p - vec2(e, 0.0), half_size, radius),
        sd_round_box(p + vec2(0.0, e), half_size, radius) - sd_round_box(p - vec2(0.0, e), half_size, radius)
    );
    n = normalize(n + 1e-6);

    // Lens profile: a circular bevel whose width is the corner radius. For
    // circles and pills that makes the whole shape a dome; for panels it's a
    // rounded rim around a flat plate. `bend` is 1 at the silhouette and
    // falls to 0 where the surface flattens out.
    float bevel = max(radius, 1.0);
    float t = clamp(-d / bevel, 0.0, 1.0);
    float height = sqrt(1.0 - (1.0 - t) * (1.0 - t));
    float bend = 1.0 - height;

    // Steep rim surfaces tilt rays outward, so the rim shows (compressed)
    // light from just beyond the edge. A small per-channel spread gives the
    // faint dispersion fringe real glass has.
    vec2 offset = n * refraction * bend;
    vec3 color;
    color.r = backdrop(v_pos + offset * 1.08, frost).r;
    color.g = backdrop(v_pos + offset, frost).g;
    color.b = backdrop(v_pos + offset * 0.92, frost).b;

    // Adaptive dimming: over bright content the glass darkens so the white
    // labels on top stay legible, the way system glass adapts.
    float lum = dot(texture2D(BlurTex, to_uv(v_pos)).rgb, vec3(0.2126, 0.7152, 0.0722));
    float dim = mix(darken, max(darken, 0.6), smoothstep(0.06, 0.5, lum));
    color = color * (1.0 - dim) + lift;

    // Light catching the bevel. Highlights sit on the two arcs that face the
    // light axis (both ends, so it reads as a lit edge rather than top-down
    // lighting with a shadow underneath).
    float facing = abs(dot(n, normalize(vec2(-0.6, -0.8))));
    float spec = pow(facing, 4.0);
    float edge = 1.0 - smoothstep(0.0, 1.0, -d);
    color += edge * (0.07 + 0.5 * spec);
    color += pow(bend, 3.0) * spec * 0.18;

    // Nearby light (a planet next to the glass) reflects in the bevel.
    vec3 env = texture2D(BlurTex, to_uv(v_pos + n * (bevel + 18.0))).rgb;
    color += env * pow(bend, 1.5) * 0.4;

    gl_FragColor = vec4(color, coverage * alpha);
}
"#;

// Planets are simple glass beads: their own color with soft shading, a thin
// lit edge, and a faint inverted view of the headline/icons behind them
// (sampled straight from those textures, so the planets don't depend on a
// render of the scene they're part of).
const PLANET_FRAGMENT: &str = r#"#version 100
precision highp float;

varying vec2 v_pos;    // CSS px
varying vec4 v_color;  // tint
varying vec4 v_shape;  // (center.xy, radius, unused)

uniform sampler2D HeroTex;
uniform sampler2D IconTex;
uniform vec4 HeroRect;   // x, y, w, h (CSS px); w = 0 when absent
uniform vec4 Icon0;
uniform vec4 Icon1;
uniform vec4 Icon2;
uniform vec4 IconAlpha;  // per-icon opacity, w = atlas cell count
uniform vec4 Params;     // x = device px per CSS px for this pass

vec3 icon(vec4 rect, float index, float alpha, vec2 q) {
    vec2 uv = (q - rect.xy) / rect.zw;
    if (alpha <= 0.0 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec3(0.0);
    vec4 t = texture2D(IconTex, vec2((index + uv.x) / IconAlpha.w, uv.y));
    return t.rgb * t.a * alpha;
}

// What lies behind a point: the headline and the icons, on black.
vec3 backdrop(vec2 q) {
    vec3 c = vec3(0.0);
    vec2 uv = (q - HeroRect.xy) / HeroRect.zw;
    if (HeroRect.z > 0.0 && uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) {
        vec4 t = texture2D(HeroTex, uv);
        c += t.rgb * t.a;
    }
    if (IconAlpha.w > 0.0) {
        c += icon(Icon0, 0.0, IconAlpha.x, q);
        c += icon(Icon1, 1.0, IconAlpha.y, q);
        c += icon(Icon2, 2.0, IconAlpha.z, q);
    }
    return c;
}

void main() {
    vec2 center = v_shape.xy;
    float r = v_shape.z;
    vec2 d = v_pos - center;
    float dist = length(d);
    float coverage = clamp((r - dist) * Params.x + 0.5, 0.0, 1.0);
    if (coverage <= 0.0) discard;

    vec2 p = d / r;
    float rho2 = min(dot(p, p), 1.0);
    float rho = sqrt(rho2);
    vec3 n = vec3(p, sqrt(1.0 - rho2));
    vec3 tint = v_color.rgb;
    vec3 L = normalize(vec3(-0.45, -0.62, 0.64));

    // Mostly the planet's own color, with gentle shading for volume.
    vec3 color = tint * mix(0.8, 1.04, dot(n, L) * 0.5 + 0.5);

    // A faint, inverted view of what's behind, like looking through a bead.
    color += backdrop(center - d * mix(0.5, 1.4, rho2 * rho)) * 0.2;

    // Thin lit edge on the upper left and one soft highlight.
    float toward = max(dot(p / max(rho, 1e-4), normalize(vec2(-0.6, -0.8))), 0.0);
    float band = smoothstep(0.84, 0.92, rho) * (1.0 - smoothstep(0.95, 0.99, rho));
    color = mix(color, vec3(1.0), band * pow(toward, 3.0) * 0.35 + pow(1.0 - n.z, 3.0) * 0.08);
    color += pow(max(reflect(-L, n).z, 0.0), 50.0) * 0.35;

    gl_FragColor = vec4(color, coverage);
}
"#;

// Separable Gaussian, 9 taps folded into 5 using bilinear filtering.
const BLUR_FRAGMENT: &str = r#"#version 100
precision mediump float;
varying vec2 v_uv;
uniform sampler2D Texture;
uniform vec2 Step;

void main() {
    vec3 c = texture2D(Texture, v_uv).rgb * 0.2270270270;
    c += texture2D(Texture, v_uv + Step * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(Texture, v_uv - Step * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(Texture, v_uv + Step * 3.2307692308).rgb * 0.0702702703;
    c += texture2D(Texture, v_uv - Step * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(c, 1.0);
}
"#;

// 4 bilinear taps = a 4x4 box, so the quarter-res copy doesn't shimmer.
const DOWNSAMPLE_FRAGMENT: &str = r#"#version 100
precision mediump float;
varying vec2 v_uv;
uniform sampler2D Texture;
uniform vec2 Texel;

void main() {
    vec3 c = texture2D(Texture, v_uv + Texel * vec2(-1.0, -1.0)).rgb;
    c += texture2D(Texture, v_uv + Texel * vec2(1.0, -1.0)).rgb;
    c += texture2D(Texture, v_uv + Texel * vec2(-1.0, 1.0)).rgb;
    c += texture2D(Texture, v_uv + Texel * vec2(1.0, 1.0)).rgb;
    gl_FragColor = vec4(c * 0.25, 1.0);
}
"#;

// White text drawn with this blends as `difference`, matching the
// `mix-blend-mode: difference` the HTML headline used to have.
const DIFFERENCE_FRAGMENT: &str = r#"#version 100
precision mediump float;
varying vec2 v_uv;
varying vec4 v_color;
uniform sampler2D Texture;

void main() {
    vec4 t = texture2D(Texture, v_uv);
    float a = t.a * v_color.a;
    gl_FragColor = vec4(t.rgb * a, a);
}
"#;

fn material(fragment: &str, uniforms: Vec<UniformDesc>, textures: Vec<String>, blend: Option<BlendState>) -> Material {
    load_material(
        ShaderSource::Glsl { vertex: VERTEX, fragment },
        MaterialParams {
            uniforms,
            textures,
            pipeline_params: PipelineParams {
                color_blend: blend,
                // Without a separate alpha state the color factors apply to
                // alpha too, which would punch holes in the opaque scene.
                alpha_blend: blend.map(|_| BlendState::new(Equation::Add, BlendFactor::Zero, BlendFactor::One)),
                ..Default::default()
            },
        },
    )
    .unwrap()
}

fn alpha_blend() -> Option<BlendState> {
    Some(BlendState::new(
        Equation::Add,
        BlendFactor::Value(BlendValue::SourceAlpha),
        BlendFactor::OneMinusValue(BlendValue::SourceAlpha),
    ))
}

/// Camera that maps `rect` onto the whole of `target`.
fn target_camera(target: &RenderTarget, rect: Rect) -> Camera2D {
    Camera2D {
        render_target: Some(target.clone()),
        ..Camera2D::from_display_rect(rect)
    }
}

/// Appends an axis-aligned quad carrying per-shape data in its vertices.
fn push_quad(vertices: &mut Vec<Vertex>, indices: &mut Vec<u16>, rect: Rect, uv: Vec2, color: [u8; 4], normal: Vec4) {
    let base = vertices.len() as u16;
    for (x, y) in [(rect.x, rect.y), (rect.right(), rect.y), (rect.right(), rect.bottom()), (rect.x, rect.bottom())] {
        vertices.push(Vertex { position: vec3(x, y, 0.0), uv, color, normal });
    }
    indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
}

/// macroquad batches at most 5000 indices per draw call; stay under it.
const MAX_QUADS_PER_MESH: usize = 800;

fn draw_quads(vertices: &[Vertex], indices: &[u16]) {
    for (v, i) in vertices.chunks(MAX_QUADS_PER_MESH * 4).zip(indices.chunks(MAX_QUADS_PER_MESH * 6)) {
        let base = i[0];
        let indices = i.iter().map(|x| x - base).collect();
        draw_mesh(&Mesh { vertices: v.to_vec(), indices, texture: None });
    }
}

struct Targets {
    size: (u32, u32),
    scene: RenderTarget,
    blur_a: RenderTarget,
    blur_b: RenderTarget,
}

pub struct Compositor {
    targets: Option<Targets>,
    glass: Material,
    planet: Material,
    blur: Material,
    downsample: Material,
    difference: Material,
    empty: Texture2D,
    // Per-frame geometry, rebuilt in place to avoid reallocating.
    planet_vertices: Vec<Vertex>,
    planet_indices: Vec<u16>,
}

impl Compositor {
    pub fn new() -> Self {
        let planet_uniforms = ["HeroRect", "Icon0", "Icon1", "Icon2", "IconAlpha", "Params"]
            .iter()
            .map(|n| UniformDesc::new(n, UniformType::Float4))
            .collect();
        Self {
            targets: None,
            glass: material(
                GLASS_FRAGMENT,
                vec![UniformDesc::new("Screen", UniformType::Float4)],
                vec!["SceneTex".to_owned(), "BlurTex".to_owned()],
                alpha_blend(),
            ),
            planet: material(
                PLANET_FRAGMENT,
                planet_uniforms,
                vec!["HeroTex".to_owned(), "IconTex".to_owned()],
                alpha_blend(),
            ),
            blur: material(BLUR_FRAGMENT, vec![UniformDesc::new("Step", UniformType::Float2)], vec![], None),
            downsample: material(
                DOWNSAMPLE_FRAGMENT,
                vec![UniformDesc::new("Texel", UniformType::Float2)],
                vec![],
                None,
            ),
            difference: material(
                DIFFERENCE_FRAGMENT,
                vec![],
                vec![],
                Some(BlendState::new(
                    Equation::Add,
                    BlendFactor::OneMinusValue(BlendValue::DestinationColor),
                    BlendFactor::OneMinusValue(BlendValue::SourceColor),
                )),
            ),
            empty: Texture2D::from_rgba8(1, 1, &[0, 0, 0, 0]),
            planet_vertices: Vec::new(),
            planet_indices: Vec::new(),
        }
    }

    /// The glass source is rendered at 1 texel per CSS px: refraction
    /// compresses what it shows and the frosted part is blurred anyway, so
    /// full device resolution would only cost fill rate.
    fn ensure_targets(&mut self) {
        let w = (screen_width().round() as u32).max(1);
        let h = (screen_height().round() as u32).max(1);
        if self.targets.as_ref().map_or(true, |t| t.size != (w, h)) {
            let scene = render_target(w, h);
            let (bw, bh) = ((w / 2).max(1), (h / 2).max(1));
            let blur_a = render_target(bw, bh);
            let blur_b = render_target(bw, bh);
            for t in [&scene, &blur_a, &blur_b] {
                t.texture.set_filter(FilterMode::Linear);
            }
            self.targets = Some(Targets { size: (w, h), scene, blur_a, blur_b });
        }
    }

    fn build_planet_geometry(&mut self, planets: &[Planet]) {
        self.planet_vertices.clear();
        self.planet_indices.clear();
        for pl in planets {
            let color: [u8; 4] = pl.color.into();
            let normal = vec4(pl.center.x, pl.center.y, pl.radius, 0.0);
            // One extra px so the antialiased edge isn't clipped.
            let r = pl.radius + 1.0;
            push_quad(
                &mut self.planet_vertices,
                &mut self.planet_indices,
                Rect::new(pl.center.x - r, pl.center.y - r, r * 2.0, r * 2.0),
                Vec2::ZERO,
                color,
                normal,
            );
        }
    }

    /// Draws the scene with the current camera. `scale` is device px per
    /// CSS px for the target (used for analytic antialiasing).
    fn draw_scene(&self, scene: &Scene, scale: f32, overlays: &dyn Fn()) {
        let (hero_tex, hero_rect) = match scene.hero {
            Some((t, r)) => (t.clone(), vec4(r.x, r.y, r.w, r.h)),
            None => (self.empty.clone(), Vec4::ZERO),
        };
        let mut icon_rects = [Vec4::ZERO; 3];
        let mut icon_alpha = Vec4::ZERO;
        let icon_tex = match scene.icons {
            Some((t, slots)) => {
                for (i, (r, a)) in slots.iter().take(3).enumerate() {
                    icon_rects[i] = vec4(r.x, r.y, r.w, r.h);
                    icon_alpha[i] = *a;
                }
                icon_alpha.w = (t.width() / t.height()).round();
                t.clone()
            }
            None => self.empty.clone(),
        };
        self.planet.set_texture("HeroTex", hero_tex);
        self.planet.set_texture("IconTex", icon_tex);
        self.planet.set_uniform("HeroRect", hero_rect);
        self.planet.set_uniform("Icon0", icon_rects[0]);
        self.planet.set_uniform("Icon1", icon_rects[1]);
        self.planet.set_uniform("Icon2", icon_rects[2]);
        self.planet.set_uniform("IconAlpha", icon_alpha);
        self.planet.set_uniform("Params", vec4(scale, 0.0, 0.0, 0.0));
        gl_use_material(&self.planet);
        draw_quads(&self.planet_vertices, &self.planet_indices);
        gl_use_default_material();

        if let Some((tex, dest)) = scene.hero {
            gl_use_material(&self.difference);
            draw_texture_ex(tex, dest.x, dest.y, WHITE, DrawTextureParams {
                dest_size: Some(dest.size()),
                ..Default::default()
            });
            gl_use_default_material();
        }
        if let Some((tex, slots)) = scene.icons {
            let cell = tex.height();
            for (i, &(dest, alpha)) in slots.iter().enumerate() {
                if alpha <= 0.0 {
                    continue;
                }
                draw_texture_ex(tex, dest.x, dest.y, Color::new(1.0, 1.0, 1.0, alpha), DrawTextureParams {
                    dest_size: Some(dest.size()),
                    source: Some(Rect::new(i as f32 * cell, 0.0, cell, cell)),
                    ..Default::default()
                });
            }
        }
        overlays();
    }

    /// Draw `src` into `dst` through `mat` (a full-target pass).
    fn pass(mat: &Material, src: &RenderTarget, dst: &RenderTarget) {
        set_camera(&target_camera(dst, Rect::new(0.0, 0.0, 1.0, 1.0)));
        gl_use_material(mat);
        draw_texture_ex(&src.texture, 0.0, 0.0, WHITE, DrawTextureParams {
            dest_size: Some(vec2(1.0, 1.0)),
            flip_y: true,
            ..Default::default()
        });
        gl_use_default_material();
    }

    /// Renders a frame: the scene to the screen, plus the glass on top.
    /// `overlays` draws anything else that belongs in the scene (arrows).
    /// Leaves the default (screen) camera active.
    pub fn render(&mut self, scene: &Scene, overlays: &dyn Fn(), shapes: &[GlassShape]) {
        self.ensure_targets();
        self.build_planet_geometry(scene.planets);
        let (sw, sh) = (screen_width(), screen_height());
        let any_glass = shapes.iter().any(|s| s.alpha > 0.001);

        if any_glass {
            let targets = self.targets.as_ref().unwrap();
            set_camera(&target_camera(&targets.scene, Rect::new(0.0, 0.0, sw, sh)));
            clear_background(BLACK);
            self.draw_scene(scene, targets.size.0 as f32 / sw, overlays);

            // Half-res blurred copy for the frosted component. Two H+V
            // iterations with growing spread give a smooth, wide falloff.
            let (w, h) = targets.size;
            let small = targets.blur_a.texture.size();
            self.downsample.set_uniform("Texel", vec2(0.5 / w as f32, 0.5 / h as f32));
            Self::pass(&self.downsample, &targets.scene, &targets.blur_a);
            for spread in [1.0, 2.0] {
                self.blur.set_uniform("Step", vec2(spread / small.x, 0.0));
                Self::pass(&self.blur, &targets.blur_a, &targets.blur_b);
                self.blur.set_uniform("Step", vec2(0.0, spread / small.y));
                Self::pass(&self.blur, &targets.blur_b, &targets.blur_a);
            }
        }

        set_default_camera();
        clear_background(BLACK);
        self.draw_scene(scene, screen_dpi_scale(), overlays);

        if !any_glass {
            return;
        }
        let targets = self.targets.as_ref().unwrap();
        let mut vertices = Vec::with_capacity(shapes.len() * 4);
        let mut indices = Vec::with_capacity(shapes.len() * 6);
        for s in shapes.iter().filter(|s| s.alpha > 0.001) {
            let [frost, darken, lift, refraction] = s.style.params();
            let color = [
                (frost * 255.0) as u8,
                (darken * 255.0) as u8,
                (lift / MAX_LIFT * 255.0).min(255.0) as u8,
                (refraction / MAX_REFRACTION * 255.0).min(255.0) as u8,
            ];
            let normal = vec4(s.center.x, s.center.y, s.half.x, s.half.y);
            let uv = vec2(s.radius, s.alpha.clamp(0.0, 1.0));
            // Pad by a pixel so the antialiased silhouette isn't clipped.
            let rect = Rect::new(s.center.x - s.half.x - 1.0, s.center.y - s.half.y - 1.0, s.half.x * 2.0 + 2.0, s.half.y * 2.0 + 2.0);
            push_quad(&mut vertices, &mut indices, rect, uv, color, normal);
        }

        self.glass.set_texture("SceneTex", targets.scene.texture.clone());
        self.glass.set_texture("BlurTex", targets.blur_a.texture.clone());
        self.glass.set_uniform("Screen", vec4(sw, sh, screen_dpi_scale(), 0.0));
        gl_use_material(&self.glass);
        draw_quads(&vertices, &indices);
        gl_use_default_material();
    }
}
