# Liquid glass

The site's glass comes in two implementations of one material.

1. **WebGL compositor** (`gravity_simulation/src/glass.rs`). On the homepage, the
   sim's renderer draws every glass surface: the info card, the add and pause
   buttons, the per-planet controls, and the Projects shelf (project cards and
   the scroll pill). It refracts the scene behind it, including planets and the
   headline. HTML on top supplies text, icons, and hit areas only.
2. **CSS/SVG refraction** (`liquid-refraction.css` + `src/scripts/liquid-refraction.ts`).
   For pages without the sim, and for the homepage when the sim isn't running.

## Homepage: feeding shapes to the compositor

The page script in `src/pages/index.astro` sends shapes every frame that
something changes:

```js
ex.glass_clear();
ex.glass_push(x, y, w, h, radius, alpha, style); // CSS px, viewport space
```

- `style`: `0` = Clear (small controls), `1` = Frosted (text panels).
- Frosted shapes draw first, then the per-planet controls, then Clear shapes.
- Rects are measured once (and on resize) in document coordinates. Each frame
  they're offset by `scrollY` and by the animations the page drives itself
  (reveal, hover, press, bob), so no layout is read per frame.
- `html.sim-glass` is set once the renderer is drawing. Under it, the shelf's
  HTML drops its own blur, fill, and shadow.
- Canvas content trails native scrolling, so while the page scrolls the HTML
  headline stands in for the renderer's copy until scrolling settles. The
  shelf and the scroll pill don't scroll natively under `html.sim-glass`: they
  are fixed and the page script moves them from `scrollY` in the same frame as
  their glass, so the glass stays liquid while scrolling and their content
  stays on it (including iOS rubber-banding).

## Elsewhere: `data-glass`

```html
<a class="card" data-glass="frosted">…</a>
<button data-glass="clear">…</button>
```

```ts
import "../styles/liquid-refraction.css";
import { initLiquidRefraction } from "../scripts/liquid-refraction";

const glass = initLiquidRefraction(); // or initLiquidRefraction(someContainer)
glass.active;       // true if SVG refraction is running
glass.refresh();    // re-measure after a layout change ResizeObserver can't see
glass.disconnect(); // back to the CSS frosted fallback
```

- `data-glass="clear"`: controls. `data-glass="frosted"`: cards and panels.
- Nothing runs on the critical path. The maps are built after `load`, one
  element per idle callback, and PNG-encoded off the main thread
  (`canvas.toBlob`, blob URLs); each element keeps the CSS frosted glass until
  its filter is ready. The distance field and normals are evaluated
  analytically, so a map costs a few ms.
- A refracting element that moves (a CSS animation, a transition) re-runs its
  filter every frame on Chromium's main thread. Keep such motion short or
  finite (the demo's coach mark nudges five times).
- The element's own `border-radius` sets the shape.
- Each element gets a displacement map built for its size and radius, rebuilt
  when its size changes (ResizeObserver). Same-size elements share a filter.
- Refraction draws in the element's `::before`, so don't use `::before` on
  `[data-glass]` elements. Give the element a non-static `position` if you need
  one other than `relative`.
- Without the script, or where it's unsupported, `[data-glass]` is the frosted
  blur from `.lg-glass-clear` / `.lg-glass-regular`.
- The refracting layer reaches past the element (see below), which counts as
  scrollable overflow. Glass near the viewport edge needs a full-width
  ancestor with `overflow-x: clip` (`.ps-page` and the homepage's `.shelf`
  have one), or the page scrolls sideways.
- Hover on a refracting `a`/`button` tints the layer (the element's own
  background paints under it). Touch hit areas (`.lg-hit` and the `lg-*`
  button classes) use `::after`, so both pseudo-elements are taken.

### Where it's used

- Homepage: the project cards and the scroll pill, as the fallback when the
  sim isn't drawing them.
- Project page: the back chip, the GitHub button, the live demo badge and
  coach mark (clear), and the demo sheet's close button. Large surfaces
  (the install sheet, the phone demo panel, the diagram) stay CSS: they sit
  over smooth washes where refraction is invisible, and a filtered layer
  that size costs real time while scrolling. On phones the fallback drops
  its backdrop blur too (one live blur layer per control in iOS Safari).

### Browser support

| Engine | Result |
| --- | --- |
| Chromium (Chrome, Edge, Arc, Opera) | SVG refraction via `backdrop-filter: url(#…)` |
| WebKit (Safari, all iOS browsers) | Frosted blur fallback |
| Gecko (Firefox) | Frosted blur fallback |

`CSS.supports()` only checks parsing, and WebKit and Gecko both parse `url()` in
`backdrop-filter` without painting it (WebKit drops the whole filter). Backdrop
pixels can't be read back from script, so the check combines the parse test
with two engine features rather than the user agent string: WebKit still
accepts the `-webkit-backdrop-filter` prefix, and only Gecko knows `-moz-orient`.

## Parameter mapping to glass.rs

| glass.rs (`GlassStyle::params`) | Clear | Frosted | SVG filter |
| --- | --- | --- | --- |
| `frost` (blurred share) | 0.32 | 1.0 | `feGaussianBlur` mixed with the sharp backdrop by `feComposite arithmetic` |
| `darken` | 0.05 | 0.55 | `feComponentTransfer` slope `1 - darken` (no adaptive dimming) |
| `lift` | 0.04 | 0.04 | `feComponentTransfer` intercept |
| refraction px | 16 | 22 | `feDisplacementMap scale = 2 * refraction` |
| blur (half-res, two separable passes) | σ ≈ 7.5 CSS px | | `stdDeviation = 7.5` |
| dispersion (R, G, B offsets) | 1.08, 1, 0.92 | | one displacement per channel, recombined |
| lens profile | circular bevel as wide as the corner radius: `bend = 1 - sqrt(1 - (1 - t)^2)`, `t = clamp(-d / radius)` | | same formula, baked into the displacement map |
| rim highlight | `edge * (0.07 + 0.5 * spec) + bend^3 * spec * 0.18`, light axis (-0.6, -0.8) | | same formula, baked into a highlight image added at the end |

The rim samples light from just outside the shape, so the filtered layer extends
`refraction * 1.08 + 3σ` px past the element and is clipped back with
`clip-path: inset(… round radius)`. `GLASS_MATERIALS` in the script mirrors
`GlassStyle::params`; change both together.

## Render resolution (homepage)

`mq_js_bundle.js` carries a few small hooks (see its header). The page caps the
canvas at 2 device px per CSS px and steps down to 1.75, 1.5, 1.25 (times the
cap) when a quarter of frames run late in two consecutive 30-frame windows. It
steps back up after a run of clean windows, never within 20 s of that step
failing. miniquad keeps its startup dpi, so the renderer works in CSS px and
gets the backing scale from `set_render_scale`.

The sim also skips frames when nothing would change (paused with no input),
draws at half rate once the headline has scrolled away, and stops with the tab
hidden (requestAnimationFrame does).
