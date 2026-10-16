// Scroll performance check for the homepage on touch devices. Run it on a
// branch and on main before merging anything that touches scrolling, the
// shelf, the scroll pill, the headline, or the sim canvas's input.
//
//   node scripts/scroll-check.mjs <branch-url> [main-url]
// Setup (Playwright, serving both builds): CLAUDE.md, "Scroll performance rules".
//
// iPhone 15 emulation, sim running, 4x CPU throttle in Chromium. Fails when:
// - a swipe over empty space lands on the sim canvas (its non-passive touch
//   listeners make the browser wait on the main thread before scrolling);
// - anything that moves with the page is position: fixed, or has its
//   transform / translate / top / left written by script during the swipe
//   (iOS runs script at 60fps at most while it scrolls at 120Hz);
// - with a baseline URL: p95 frame time during the swipe is over 25% (+2ms)
//   worse than the baseline's.
// Emulation can't show 120Hz judder itself; the checks above catch its causes.
import { chromium, webkit, devices } from "playwright";

const [url, baseline] = process.argv.slice(2);
if (!url) {
	console.error("usage: node scripts/scroll-check.mjs <url> [baseline-url]");
	process.exit(2);
}

const MOVING = ".shelf, .shelf *, main, main *, .scroll-hint";
const POSITION_PROPS = ["transform", "translate", "top", "left", "position"];

async function run(browserType, target) {
	const browser = await browserType.launch();
	const context = await browser.newContext({ ...devices["iPhone 15"] });
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(String(e)));
	await page.goto(target);
	await page.waitForFunction(() => document.documentElement.classList.contains("sim-glass"), null, { timeout: 40000 });
	await page.waitForTimeout(500);
	const cdp = browserType === chromium ? await context.newCDPSession(page) : null;
	if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

	// Swipe from empty space at the left edge, below the headline.
	const start = await page.evaluate(() => ({ x: 8, y: Math.round(innerHeight * 0.8) }));
	await page.evaluate(
		({ moving, props }) => {
			const probe = document.createElement("div");
			const pick = (css) => {
				probe.style.cssText = css || "";
				return props.map((p) => probe.style.getPropertyValue(p)).join("|");
			};
			window.__check = { writes: [], frames: [], fixed: new Set(), armed: false, lastScroll: -Infinity };
			const c = window.__check;
			// Count from the first touch or scroll (at rest the pill's bob may
			// animate), and writes only while the page is moving (once it
			// settles, the shelf may hand back to the renderer).
			for (const type of ["touchstart", "scroll"]) window.addEventListener(type, () => (c.armed = true), { capture: true, passive: true, once: true });
			window.addEventListener("scroll", () => (c.lastScroll = performance.now()), { capture: true, passive: true });
			c.mo = new MutationObserver((list) => {
				for (const m of list) {
					if (!c.armed || performance.now() - c.lastScroll > 100 || !m.target.matches?.(moving)) continue;
					// Setting a position counts; clearing one (handing back to the page's flow) doesn't.
					const now = pick(m.target.getAttribute("style"));
					if (now !== pick(m.oldValue) && now.replaceAll("|", "")) c.writes.push(m.target.className || m.target.tagName);
				}
			});
			c.mo.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["style"], attributeOldValue: true });
			let last = performance.now();
			const tick = (t) => {
				if (c.armed) c.frames.push(t - last);
				last = t;
				for (const s of [".shelf-content", ".scroll-hint", "main h1"]) {
					const el = document.querySelector(s);
					if (c.armed && el && getComputedStyle(el).position === "fixed") c.fixed.add(s);
				}
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

	if (cdp) {
		const at = (y) => [{ x: start.x, y: Math.round(y), id: 1 }];
		await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(start.y) });
		for (let i = 1; i <= 40; i++) {
			await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(start.y - i * 15) });
			await page.waitForTimeout(8);
		}
		await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	} else {
		// No touch synthesis in WebKit: scroll by script, which still fires scroll events.
		await page.evaluate(
			() =>
				new Promise((done) => {
					let i = 0;
					const step = () => (window.scrollBy(0, 15), ++i < 40 ? requestAnimationFrame(step) : done());
					requestAnimationFrame(step);
				}),
		);
	}
	await page.waitForTimeout(150);
	const result = await page.evaluate(() => {
		const c = window.__check;
		c.mo.disconnect();
		cancelAnimationFrame(c.raf);
		const f = c.frames.slice(1).sort((a, b) => a - b);
		const q = (p) => (f.length ? +f[Math.min(f.length - 1, Math.floor(p * f.length))].toFixed(1) : NaN);
		return { scrolled: Math.round(scrollY), writes: c.writes.length, writers: [...new Set(c.writes)].slice(0, 5), fixed: [...c.fixed], p50: q(0.5), p95: q(0.95) };
	});
	await browser.close();
	return { hit, ...result, errors };
}

let failed = false;
for (const [name, type] of [["chromium", chromium], ["webkit", webkit]]) {
	const r = await run(type, url);
	const problems = [];
	if (r.hit === "glcanvas") problems.push("swipe over empty space hits the sim canvas");
	if (r.fixed.length) problems.push(`fixed while scrolling: ${r.fixed.join(", ")}`);
	if (r.writes) problems.push(`${r.writes} script position writes on page content (${r.writers.join(", ")})`);
	if (r.scrolled < 300) problems.push(`the swipe only scrolled ${r.scrolled}px`);
	if (r.errors.length) problems.push(`page errors: ${r.errors.join("; ")}`);
	let line = `${name}: hit=${r.hit} scrolled=${r.scrolled}px writes=${r.writes} fixed=[${r.fixed}] frame p50=${r.p50}ms p95=${r.p95}ms`;
	if (baseline && name === "chromium") {
		const b = await run(type, baseline);
		line += ` | baseline p95=${b.p95}ms`;
		if (r.p95 > b.p95 * 1.25 + 2) problems.push(`p95 frame time ${r.p95}ms vs baseline ${b.p95}ms`);
	}
	console.log(`${problems.length ? "FAIL" : "PASS"} ${line}`);
	for (const p of problems) console.log(`  - ${p}`);
	failed ||= problems.length > 0;
}
process.exit(failed ? 1 : 0);
