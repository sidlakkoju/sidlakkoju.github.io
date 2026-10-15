//! Offscreen scene rendering plus a refractive "liquid glass" pass.
//!
//! The simulation (planets, hero text, arrows) is drawn into a multisampled
//! render target. That texture is then drawn to the screen and every glass
//! shape samples it through a curved-edge lens model, so light bends around
//! the rim the way it does through real rounded glass. The browser can't do
//! this with CSS (backdrop-filter only blurs, and Safari ignores SVG
//! displacement filters there), which is why the glass lives in the renderer
//! and the HTML on top only carries text and icons.

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

struct Targets {
    size: (u32, u32),
    scene: RenderTarget,
    blur_a: RenderTarget,
    blur_b: RenderTarget,
}

pub struct Compositor {
    targets: Option<Targets>,
    glass: Material,
    blur: Material,
    downsample: Material,
    difference: Material,
}

impl Compositor {
    pub fn new() -> Self {
        Self {
            targets: None,
            glass: material(
                GLASS_FRAGMENT,
                vec![UniformDesc::new("Screen", UniformType::Float4)],
                vec!["SceneTex".to_owned(), "BlurTex".to_owned()],
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
        }
    }

    fn ensure_targets(&mut self) -> &Targets {
        let dpr = screen_dpi_scale();
        let w = ((screen_width() * dpr).round() as u32).max(1);
        let h = ((screen_height() * dpr).round() as u32).max(1);
        if self.targets.as_ref().map_or(true, |t| t.size != (w, h)) {
            let scene = render_target_ex(w, h, RenderTargetParams { sample_count: 4, depth: false });
            let (bw, bh) = ((w / 4).max(1), (h / 4).max(1));
            let blur_a = render_target(bw, bh);
            let blur_b = render_target(bw, bh);
            for t in [&scene, &blur_a, &blur_b] {
                t.texture.set_filter(FilterMode::Linear);
            }
            self.targets = Some(Targets { size: (w, h), scene, blur_a, blur_b });
        }
        self.targets.as_ref().unwrap()
    }

    /// Start drawing the scene. Everything until `finish` lands in the
    /// offscreen target, in CSS-pixel coordinates.
    pub fn begin_scene(&mut self) {
        let rect = Rect::new(0.0, 0.0, screen_width(), screen_height());
        let targets = self.ensure_targets();
        set_camera(&target_camera(&targets.scene, rect));
        clear_background(BLACK);
    }

    /// Draw a texture into the scene with difference blending.
    pub fn draw_difference(&self, texture: &Texture2D, dest: Rect) {
        gl_use_material(&self.difference);
        draw_texture_ex(texture, dest.x, dest.y, WHITE, DrawTextureParams {
            dest_size: Some(dest.size()),
            ..Default::default()
        });
        gl_use_default_material();
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

    /// Present the scene to the screen and draw the glass on top. Leaves the
    /// default (screen) camera active for any further drawing.
    pub fn finish(&mut self, shapes: &[GlassShape]) {
        let targets = self.targets.as_ref().expect("begin_scene first");
        let (sw, sh) = (screen_width(), screen_height());

        // Quarter-res blurred copy of the scene for the frosted component.
        // Two H+V iterations with growing spread give a smooth, wide falloff.
        if shapes.iter().any(|s| s.alpha > 0.001) {
            let (w, h) = targets.size;
            let small = targets.blur_a.texture.size();
            self.downsample.set_uniform("Texel", vec2(1.0 / w as f32, 1.0 / h as f32));
            Self::pass(&self.downsample, &targets.scene, &targets.blur_a);
            for spread in [1.0, 2.0] {
                self.blur.set_uniform("Step", vec2(spread / small.x, 0.0));
                Self::pass(&self.blur, &targets.blur_a, &targets.blur_b);
                self.blur.set_uniform("Step", vec2(0.0, spread / small.y));
                Self::pass(&self.blur, &targets.blur_b, &targets.blur_a);
            }
        }

        set_default_camera();
        draw_texture_ex(&targets.scene.texture, 0.0, 0.0, WHITE, DrawTextureParams {
            dest_size: Some(vec2(sw, sh)),
            // Render targets are stored bottom-up.
            flip_y: true,
            ..Default::default()
        });

        let visible: Vec<&GlassShape> = shapes.iter().filter(|s| s.alpha > 0.001).collect();
        if visible.is_empty() {
            return;
        }

        let mut vertices = Vec::with_capacity(visible.len() * 4);
        let mut indices = Vec::with_capacity(visible.len() * 6);
        for s in visible {
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
            let (x0, y0) = (s.center.x - s.half.x - 1.0, s.center.y - s.half.y - 1.0);
            let (x1, y1) = (s.center.x + s.half.x + 1.0, s.center.y + s.half.y + 1.0);
            let base = vertices.len() as u16;
            for (x, y) in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)] {
                vertices.push(Vertex { position: vec3(x, y, 0.0), uv, color, normal });
            }
            indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
        }

        self.glass.set_texture("SceneTex", targets.scene.texture.clone());
        self.glass.set_texture("BlurTex", targets.blur_a.texture.clone());
        self.glass.set_uniform("Screen", vec4(sw, sh, screen_dpi_scale(), 0.0));
        gl_use_material(&self.glass);
        draw_mesh(&Mesh { vertices, indices, texture: None });
        gl_use_default_material();
    }
}
