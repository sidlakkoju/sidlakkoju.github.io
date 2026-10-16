// Performance check for the homepage: the same 600px scroll on your branch
// and on main, in touch emulation (iPhone 15) and on desktop (1280x800), in
// Chromium and WebKit. Required before merging anything that touches
// scrolling, animation, glass, or the sim (CLAUDE.md, "Verify before merging").
//
//   node scripts/scroll-check.mjs <branch-url> <main-url>
//
// Reports per run: the element under the swipe (or wheel) start, style
// writes on page content during the scroll (total and per frame), script
// position writes (transform / translate / top / left), elements that are
// position: fixed while scrolling, and frame times (Chromium: 4x CPU throttle).
//
// Fails when:
// - the swipe or wheel over empty space hits the sim canvas (its
//   non-passive touch and wheel listeners make scrolling wait on the main thread);
// - touch: page content is fixed or gets script position writes while scrolling
//   (iOS runs script at 60fps at most while it scrolls at 120Hz);
// - style writes per frame, or p95 frame time, are over 25% worse than main.
// Emulation can't show 120Hz judder itself; these catch its causes. A swipe
// on a real iPhone is the final check.
import { chromium, webkit, devices } from "playwright";

const [url, mainUrl] = process.argv.slice(2);
if (!url || !mainUrl) {
	console.error("usage: node scripts/scroll-check.mjs <branch-url> <main-url>");
	process.exit(2);
}

const MOVING = ".shelf, .shelf *, main, main *, .scroll-hint";
const POSITION_PROPS = ["transform", "translate", "top", "left", "position"];
const SWIPE = 600;
const STEP = 15;

const RUNS = [
	{ name: "touch chromium", type: chromium, touch: true, context: { ...devices["iPhone 15"] } },
	{ name: "touch webkit", type: webkit, touch: true, context: { ...devices["iPhone 15"] } },
	{ name: "desktop chromium", type: chromium, touch: false, context: { viewport: { width: 1280, height: 800 } } },
	{ name: "desktop webkit", type: webkit, touch: false, context: { viewport: { width: 1280, height: 800 } } },
];

async function measure(run, target) {
	const browser = await run.type.launch();
	const context = await browser.newContext(run.context);
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(String(e)));
	await page.goto(target);
	await page.waitForFunction(() => document.documentElement.classList.contains("sim-glass"), null, { timeout: 40000 });
	await page.waitForTimeout(500);
	const cdp = run.type === chromium ? await context.newCDPSession(page) : null;
	if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

	// Start over empty space at the left edge, below the headline.
	const start = await page.evaluate(() => ({ x: 8, y: Math.round(innerHeight * 0.8) }));
	await page.evaluate(
		({ moving, props }) => {
			const probe = document.createElement("div");
			const pick = (css) => {
				probe.style.cssText = css || "";
				return props.map((p) => probe.style.getPropertyValue(p)).join("|");
			};
			const c = (window.__check = { styleWrites: 0, positionWrites: [], frames: [], fixed: new Set(), armed: false, lastScroll: -Infinity });
			// Count from the first touch or scroll (at rest the pill's bob may
			// animate), and only while the page is moving (once it settles,
			// the shelf may hand back to the renderer).
			for (const type of ["touchstart", "wheel", "scroll"]) window.addEventListener(type, () => (c.armed = true), { capture: true, passive: true, once: true });
			window.addEventListener("scroll", () => (c.lastScroll = performance.now()), { capture: true, passive: true });
			c.mo = new MutationObserver((list) => {
				for (const m of list) {
					if (!c.armed || performance.now() - c.lastScroll > 100 || !m.target.matches?.(moving)) continue;
					c.styleWrites++;
					// Setting a position counts; clearing one (back to the page's flow) doesn't.
					const now = pick(m.target.getAttribute("style"));
					if (now !== pick(m.oldValue) && now.replaceAll("|", "")) c.positionWrites.push(m.target.className || m.target.tagName);
				}
			});
			c.mo.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["style"], attributeOldValue: true });
			let last = performance.now();
			const tick = (t) => {
				if (c.armed && performance.now() - c.lastScroll <= 100) {
					c.frames.push(t - last);
					for (const s of [".shelf-content", ".scroll-hint", "main h1"]) {
						const el = document.querySelector(s);
						if (el && getComputedStyle(el).position === "fixed") c.fixed.add(s);
					}
				}
				last = t;
				c.raf = requestAnimationFrame(tick);
			};
			c.raf = requestAnimationFrame(tick);
		},
		{ moving: MOVING, props: POSITION_PROPS },
	);
	const hit = await page.evaluate(({ x, y }) => {
		const el = document.elementFromPoint(x, y);
		return el ? el.id || el.tagName : "none";
	}, start);

	const steps = SWIPE / STEP;
	if (run.touch && cdp) {
		const at = (y) => [{ x: start.x, y: Math.round(y), id: 1 }];
		await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(start.y) });
		for (let i = 1; i <= steps; i++) {
			await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(start.y - i * STEP) });
			await page.waitForTimeout(8);
		}
		await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	} else if (run.touch) {
		// No touch synthesis in WebKit: scroll by script, which still fires scroll events.
		await page.evaluate(
			({ steps, step }) =>
				new Promise((done) => {
					let i = 0;
					const next = () => (window.scrollBy(0, step), ++i < steps ? requestAnimationFrame(next) : done());
					requestAnimationFrame(next);
				}),
			{ steps, step: STEP },
		);
	} else {
		await page.mouse.move(start.x, start.y);
		for (let i = 0; i < steps; i++) {
			await page.mouse.wheel(0, STEP);
			await page.waitForTimeout(8);
		}
	}
	await page.waitForTimeout(150);
	const result = await page.evaluate(() => {
		const c = window.__check;
		c.mo.disconnect();
		cancelAnimationFrame(c.raf);
		const f = c.frames.slice(1).sort((a, b) => a - b);
		const q = (p) => (f.length ? +f[Math.min(f.length - 1, Math.floor(p * f.length))].toFixed(1) : NaN);
		return {
			scrolled: Math.round(scrollY),
			frames: f.length,
			styleWrites: c.styleWrites,
			perFrame: f.length ? +(c.styleWrites / f.length).toFixed(2) : 0,
			positionWrites: c.positionWrites.length,
			positioned: [...new Set(c.positionWrites)].slice(0, 5),
			fixed: [...c.fixed],
			p95: q(0.95),
		};
	});
	await browser.close();
	return { hit, ...result, errors };
}

const fmt = (r) =>
	`target=${r.hit} scrolled=${r.scrolled}px style writes=${r.styleWrites} (${r.perFrame}/frame) position writes=${r.positionWrites}${r.positioned.length ? ` (${r.positioned.join(", ")})` : ""} fixed=[${r.fixed}] p95=${r.p95}ms`;

let failed = false;
for (const run of RUNS) {
	const b = await measure(run, url);
	const m = await measure(run, mainUrl);
	const problems = [];
	if (b.hit === "glcanvas") problems.push("the scroll starts on the sim canvas");
	if (run.touch && b.fixed.length) problems.push(`fixed while scrolling: ${b.fixed.join(", ")}`);
	if (run.touch && b.positionWrites) problems.push(`${b.positionWrites} script position writes while scrolling`);
	if (b.scrolled < 300) problems.push(`the scroll only moved ${b.scrolled}px`);
	if (b.perFrame > m.perFrame * 1.25 + 0.5) problems.push(`style writes per frame ${b.perFrame} vs main ${m.perFrame}`);
	// Throttled frame times come in whole frames, so measure again before failing on them.
	const slower = (x, y) => x.p95 > y.p95 * 1.25 + 2;
	if (slower(b, m)) {
		const [b2, m2] = [await measure(run, url), await measure(run, mainUrl)];
		if (slower(b2, m2)) problems.push(`p95 frame time ${b.p95}/${b2.p95}ms vs main ${m.p95}/${m2.p95}ms (two runs)`);
	}
	if (b.errors.length) problems.push(`page errors: ${b.errors.join("; ")}`);
	console.log(`${problems.length ? "FAIL" : "PASS"} ${run.name}`);
	console.log(`  branch: ${fmt(b)}`);
	console.log(`  main:   ${fmt(m)}`);
	for (const p of problems) console.log(`  - ${p}`);
	failed ||= problems.length > 0;
}
process.exit(failed ? 1 : 0);
