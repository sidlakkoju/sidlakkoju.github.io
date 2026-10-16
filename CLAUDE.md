# Notes for Claude

## Copy
- Avoid using the "—" (em dash) character in any UI copy (page text, meta tags, alt text, labels). Use a period, comma, colon, or hyphen instead.

## Architecture
- The glass UI and the glass-bead planets are drawn by the Rust renderer (`gravity_simulation/src/glass.rs`), not CSS. HTML elements marked `.glass` only supply content, layout, and hit areas.
- Performance: the page script never reads layout or computed styles per frame. Layout is measured once (and on resize), UI animations are JS springs, and the renderer/DOM are written only when values change. Keep it that way.
- The headline and social icons are rasterized by the page and drawn inside the scene so the glass can refract them. Per-body control sizes are duplicated in `main.rs` (`CTL_*`) and `index.astro`; keep them in sync.
- After changing Rust, rebuild the wasm (`cargo build --release --target wasm32-unknown-unknown`), then optimize it into `site/public/sim/` the same way CI does: `npx --yes -p binaryen@132.0.0 wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals gravity_simulation/target/wasm32-unknown-unknown/release/gravity_simulation.wasm -o site/public/sim/gravity_simulation.wasm`.

## Pages and shared styles
- `site/src/layouts/BaseLayout.astro` owns the `<head>` (SEO, OG, icons, JSON-LD); pages add extras through its `head` slot. Liquid Glass tokens (`--lg-*`) and glass/button classes live in `site/src/styles/liquid-glass.css`. Don't name new classes `.glass`: on the homepage that class marks shapes the renderer draws.
- The homepage scrolls over the fixed sim canvas. macroquad's canvas listeners `preventDefault` wheel, touch, and some keys, so the page script stops those in the capture phase unless the sim needs them (touches that `grab_at` a body while paused). The headline the renderer draws follows the scroll through `ui_offset` / `ui_alpha`. On fine-pointer devices the projects shelf and the scroll pill are `position: fixed` once the renderer draws their glass (`html.sim-glass`); the page script moves them from `scrollY` in the same frame as their glass, so the glass never hands off to CSS while scrolling. Touch devices (`html.touch-scroll`, `(pointer: coarse)`) must scroll natively instead: iOS Safari runs rAF at 60fps at most while it scrolls at 120Hz, so anything positioned from script there judders and trails the finger. From the first touch or scroll until the page settles (`html.scroll-native`), the shelf, pill and HTML headline scroll natively with CSS glass, and the renderer's glass fades back in under them once still. Never put per-frame script positioning, parallax, or JS-driven reveals on content that moves with the page on touch devices.
- The sim canvas takes pointer input only while the sim is paused (`.paused #glcanvas`). macroquad registers non-passive touch and wheel listeners on it; if touches can reach the canvas, every swipe waits on the main thread before the page scrolls.
- Photos Swipe page copy, including every "How it works" diagram claim, lives in `site/src/data/photos-swipe.ts`. The live demo is a static build in `site/public/photos-swipe/demo/`; its postMessage contract is documented in `site/src/components/LiveDemo.astro`.

## Scroll performance rules
PR #15 made iPhone scrolling lag and PR #16 fixed it. Never reintroduce either cause:
- **Touch devices: nothing that moves with the page is positioned by script.** No `position: fixed` content moved from `scrollY`, no per-frame `transform` / `translate` / `top` writes, no parallax, no JS-driven reveals while the page scrolls. iOS Safari runs rAF at 60fps at most while it scrolls natively at 120Hz, so script-positioned content judders and trails the finger (#15 did exactly this to the shelf and pill). Use normal flow and CSS (scroll-driven animations, CSS glass while moving). Script positioning is only allowed for fine pointers (`html:not(.touch-scroll)`).
- **Touches over empty space never reach `#glcanvas` unless the sim is paused.** macroquad's touch and wheel listeners are non-passive, so a touch that hits the canvas makes every swipe wait on the busy main thread. Keep `pointer-events: none` on the canvas outside `.paused`, and make every page-level touch, wheel, and scroll listener `passive: true`.
- **Fix scroll-time visuals with CSS, not by moving content.** Hand off to the renderer only once the page is still (`html.scroll-native` ends). Known trade-off since #16: on touch, the cards wear CSS glass while the page moves, and the renderer's liquid glass fades back in at rest.

## Verify before merging
Any change that touches scrolling, animation, glass, or the sim needs a performance check against main before merge, in touch emulation and on desktop. A visual pass alone (screenshots, "looks smooth") does not count: #15 passed every visual check and still made iPhone scrolling lag.
- **The check to run is `site/scripts/perf-check.mjs`** (built by Research; it fails on #15's code and passes on #16). It runs a 600px swipe in iPhone 13 touch emulation (WebKit, and Chromium with real CDP touches) and a 600px wheel scroll at 1280x800 desktop (WebKit and Chromium), 2 reps each. Run it on your branch and on main, only while the box is quiet (`cat /proc/loadavg` under 3), then compare:
  ```sh
  cd site && npm i --no-save playwright@1.64.0
  npm run build && npx astro preview --port 4321 &          # your branch
  git worktree add /tmp/main-check origin/main && ln -s "$PWD/node_modules" /tmp/main-check/site/node_modules
  (cd /tmp/main-check/site && npm run build && npx astro preview --port 4322 &)   # main
  node scripts/perf-check.mjs http://localhost:4321/ branch 2
  node scripts/perf-check.mjs http://localhost:4322/ main 2
  node scripts/perf-compare.mjs perf-main.json perf-branch.json
  ```
- **Put both tables in the PR, branch next to main (as #16 did).** Show:
  - `target`, the touch target under the swipe start, which must not be `#glcanvas`;
  - `blocking`, the non-passive touch or wheel listeners on its path, which must be 0;
  - `posW/allW`, the positioning and total style writes on the shelf and pill during the swipe;
  - `posFrames`, the frames where script moved the shelf or pill.
- **Every row must say PASS.** On touch rows, PASS means:
  - the target isn't the canvas;
  - nothing on the path blocks;
  - `posW` and `posFrames` are at most max(3, 10% of moving frames);
  - there are no page errors.
- **Desktop rows are script-positioned by design** (the fixed shelf), so they only fail on blocking listeners or errors. Compare their writes with main.
- **Main's touch Chromium row runs close to the limit** (6 position writes against an allowance of 6). A FAIL there needs a rerun and a look at `shelfProps` in `perf-branch.json`, not a shrug.
- **Timing is only a warning:** headless boxes have no 120Hz compositor or GPU. The target, blocking, and positioning numbers are the real gate. A swipe on a real iPhone is the final check, and the PR should say whether it was done.
- `site/scripts/scroll-check.mjs <branch-url> <main-url>` is an optional second opinion. It also fails on style writes per frame over 25% worse than main.

## Photos Swipe demo and project page
- `site/public/photos-swipe/demo/` is generated by the GooglePhotosSwiper repo (`npm run build:demo` → `demo-dist/`). Never hand-edit it; replace it wholesale with a fresh build.
- Whenever Photos Swipe changes in a way users can see (UI, copy, behavior, architecture), refresh that demo and update the project page copy and the "How it works" diagram data (`site/src/data/photos-swipe.ts`) in the same release, so sidlakkoju.github.io never shows a stale version of the app.
