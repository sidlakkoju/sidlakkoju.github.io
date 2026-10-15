# Notes for Claude

## Copy
- Avoid using the "—" (em dash) character in any UI copy (page text, meta tags, alt text, labels). Use a period, comma, colon, or hyphen instead.

## Architecture
- The glass UI is drawn by the Rust renderer (`gravity_simulation/src/glass.rs`), not CSS. HTML elements marked `.glass` only supply content, layout, and hit areas; their rects are sent to the renderer each frame.
- The headline and social icons are rasterized by the page and drawn inside the scene so the glass can refract them. Per-body control sizes are duplicated in `main.rs` (`CTL_*`) and `index.astro`; keep them in sync.
- After changing Rust, rebuild the wasm (`cargo build --release --target wasm32-unknown-unknown`) and copy it to `site/public/sim/`.
