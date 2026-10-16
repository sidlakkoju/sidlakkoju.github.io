// Regenerates the responsive images the pages serve from public/.
//
//   node scripts/images.mjs icons     app icon variants from public/photos-swipe/icon.png
//   node scripts/images.mjs preview   the phone frame's static preview: a screenshot of
//                                     the live demo in public/photos-swipe/demo/
//
// Run `preview` whenever the demo is refreshed, so phones see the current app.
// sharp ships with Astro. `preview` also needs Playwright's WebKit:
//   npm i --no-save playwright && npx playwright install webkit
//
// Sizes follow what the pages display (CSS px x 1-3 device px):
//   icon:    96/80px (project page), 56px (homepage card), 52/32px (diagram)
//   preview: 200px wide in the phone frame on phones, 330px on larger screens
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(site, "public/photos-swipe");

export const ICON_WIDTHS = [64, 128, 192, 288];
export const PREVIEW_WIDTHS = [400, 660];

async function icons() {
	const src = sharp(path.join(dir, "icon.png"));
	for (const w of ICON_WIDTHS) {
		const img = src.clone().resize(w, w, { kernel: "lanczos3" });
		await img.clone().avif({ quality: 60, effort: 9 }).toFile(path.join(dir, `icon-${w}.avif`));
		await img.clone().webp({ quality: 85, effort: 6 }).toFile(path.join(dir, `icon-${w}.webp`));
		await img.clone().png({ compressionLevel: 9, palette: true, quality: 90, effort: 10 }).toFile(path.join(dir, `icon-${w}.png`));
	}
}

// Serves public/ so the demo loads exactly as it does on the site.
function serve(root) {
	const types = { ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".css": "text/css" };
	return new Promise((resolve) => {
		const server = http.createServer((req, res) => {
			let p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
			if (p.endsWith("/")) p += "index.html";
			if (!p.startsWith(root) || !fs.existsSync(p)) return res.writeHead(404).end();
			res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
			fs.createReadStream(p).pipe(res);
		});
		server.listen(0, () => resolve(server));
	});
}

async function preview() {
	const { webkit } = await import("playwright");
	const server = await serve(path.join(site, "public"));
	const browser = await webkit.launch();
	const page = await browser.newPage({
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
		colorScheme: "dark",
		userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
	});
	// The demo shuffles its sample photos. A seeded Math.random makes the
	// shot reproducible; seed 4 opens on the Big Sur sunset (the app icon's photo).
	await page.addInitScript(() => {
		let a = 4;
		Math.random = () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	});
	// Same URL as the inline demo (LiveDemo.astro): the page draws the status bar.
	await page.goto(`http://localhost:${server.address().port}/photos-swipe/demo/?embed=1&top=50&scheme=dark`);
	// The demo renders into a shadow root: wait for the deck's card images,
	// then for the entrance animations to finish.
	await page.waitForFunction(() => {
		const host = document.getElementById("photos-swipe-userscript-host");
		const imgs = host?.shadowRoot ? [...host.shadowRoot.querySelectorAll(".card img")] : [];
		return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
	});
	await page.evaluate(() => Promise.all(document.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))));
	await page.waitForTimeout(1500);
	const shot = await page.screenshot();
	await browser.close();
	server.close();

	for (const w of PREVIEW_WIDTHS) {
		const img = sharp(shot).resize(w, null, { kernel: "lanczos3" });
		await img.clone().avif({ quality: 55, effort: 9 }).toFile(path.join(dir, `preview-${w}.avif`));
		await img.clone().webp({ quality: 80, effort: 6 }).toFile(path.join(dir, `preview-${w}.webp`));
		await img.clone().jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(dir, `preview-${w}.jpg`));
	}
}

const task = process.argv[2];
if (task === "icons") await icons();
else if (task === "preview") await preview();
else {
	console.error("usage: node scripts/images.mjs icons|preview");
	process.exit(1);
}
