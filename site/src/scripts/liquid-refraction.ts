// Liquid glass refraction for pages without the WebGL sim.
//
// Mark an element with data-glass="clear" or data-glass="frosted" and call
// initLiquidRefraction(). Where the browser can run SVG filters inside
// backdrop-filter (Chromium), each element gets a displacement map built for
// its size and corner radius, so light bends at its rim the way the sim's
// compositor (gravity_simulation/src/glass.rs) bends it. Everywhere else the
// element keeps the frosted blur from liquid-refraction.css.
//
// API and the parameter mapping to glass.rs: src/styles/LIQUID_GLASS.md.

export type GlassKind = "clear" | "frosted";

export interface GlassMaterial {
	/** Share of the blurred backdrop mixed into the sharp one (0..1). */
	frost: number;
	/** How much the backdrop is dimmed (0..1). */
	darken: number;
	/** Brightness added after dimming (0..1). */
	lift: number;
	/** Displacement at the silhouette, CSS px. */
	refraction: number;
}

/** Mirrors GlassStyle::params in gravity_simulation/src/glass.rs. Keep in sync. */
export const GLASS_MATERIALS: Record<GlassKind, GlassMaterial> = {
	clear: { frost: 0.32, darken: 0.05, lift: 0.04, refraction: 16 },
	frosted: { frost: 1, darken: 0.55, lift: 0.04, refraction: 22 },
};

/** The compositor's blur (half-res, two separable passes), as a Gaussian sigma in CSS px. */
export const BLUR_SIGMA = 7.5;
/** Per-channel displacement scale (R, G, B): glass.rs's dispersion fringe. */
const DISPERSION = [1.08, 1, 0.92];
/** Light axis for the rim highlight, as in glass.rs. */
const LIGHT = [-0.6, -0.8];

/**
 * True when backdrop-filter can apply an SVG filter.
 *
 * CSS.supports() only checks parsing, and WebKit and Gecko both parse
 * url() inside backdrop-filter without painting it (WebKit drops the whole
 * filter). Backdrop pixels can't be read back from script, so the parse
 * check is combined with two engine features: WebKit still accepts the
 * -webkit- prefixed property, and only Gecko knows -moz-orient. Neither
 * reads the user agent string.
 */
export function supportsSvgBackdropFilter(): boolean {
	if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
	return (
		CSS.supports("backdrop-filter", "url(#a)") &&
		!CSS.supports("-webkit-backdrop-filter", "blur(1px)") &&
		!CSS.supports("-moz-orient", "inline")
	);
}

const SVG_NS = "http://www.w3.org/2000/svg";

const smoothstep = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

interface Maps {
	displacement: string;
	specular: string;
	/** Extra backdrop sampled around the shape, CSS px. */
	margin: number;
}

/** Backdrop sampled around a shape: the rim's reach plus the blur's. */
const marginFor = (m: GlassMaterial) => Math.ceil(m.refraction * DISPERSION[0] + 3 * BLUR_SIGMA) + 2;

interface Pixels {
	width: number;
	height: number;
	displacement: ImageData;
	specular: ImageData;
	margin: number;
}

/**
 * Computes the displacement and highlight maps for a w x h shape with corner
 * radius r, using glass.rs's lens profile: a circular bevel as wide as the
 * corner radius, refracting outward by up to `refraction` px at the rim.
 * The maps cover the shape plus `margin` on every side, since the rim
 * samples light from just outside the shape.
 *
 * The rounded box's distance and normal are evaluated analytically (one
 * pass per pixel, no Math.hypot): this runs for every glass control on the
 * page, at device resolution.
 */
export function computeMaps(w: number, h: number, r: number, material: GlassMaterial, scale = 1): Pixels {
	const margin = marginFor(material);
	const pw = Math.max(1, Math.round((w + 2 * margin) * scale));
	const ph = Math.max(1, Math.round((h + 2 * margin) * scale));
	const displacement = new ImageData(pw, ph);
	const specular = new ImageData(pw, ph);
	const disp = displacement.data;
	const spec = specular.data;
	const hx = w / 2;
	const hy = h / 2;
	const radius = Math.min(r, hx, hy);
	const bevel = Math.max(radius, 1);
	const ex = hx - radius; // half extents of the box the corners round off
	const ey = hy - radius;
	const ll = Math.sqrt(LIGHT[0] * LIGHT[0] + LIGHT[1] * LIGHT[1]);
	const lx = LIGHT[0] / ll;
	const ly = LIGHT[1] / ll;
	const px1 = 1 / scale; // one device pixel, CSS px

	for (let j = 0; j < ph; j++) {
		const py = (j + 0.5) / scale - margin - hy;
		const sy = py < 0 ? -1 : 1;
		const qy = sy * py - ey;
		for (let i = 0; i < pw; i++) {
			const px = (i + 0.5) / scale - margin - hx;
			const sx = px < 0 ? -1 : 1;
			const qx = sx * px - ex;
			const o = (j * pw + i) * 4;
			disp[o + 3] = 255;
			// Signed distance to the rounded box, and its outward normal.
			let d: number;
			let nx: number;
			let ny: number;
			if (qx > 0 && qy > 0) {
				const l = Math.sqrt(qx * qx + qy * qy);
				d = l - radius;
				nx = (sx * qx) / l;
				ny = (sy * qy) / l;
			} else if (qx > qy) {
				d = qx - radius;
				nx = sx;
				ny = 0;
			} else {
				d = qy - radius;
				nx = 0;
				ny = sy;
			}
			if (d > px1) {
				disp[o] = disp[o + 1] = 128;
				continue;
			}

			const t = Math.min(1, Math.max(0, -d / bevel));
			const bend = 1 - Math.sqrt(1 - (1 - t) * (1 - t));
			// Offset / (2 * refraction) maps +-refraction onto 0..255.
			disp[o] = Math.round(127.5 + 127.5 * nx * bend);
			disp[o + 1] = Math.round(127.5 + 127.5 * ny * bend);
			disp[o + 2] = 128;

			const facing = Math.abs(nx * lx + ny * ly);
			const s2 = facing * facing;
			const s = s2 * s2;
			const edge = 1 - smoothstep(0, 1, -d);
			const light = edge * (0.07 + 0.5 * s) + bend * bend * bend * s * 0.18;
			spec[o] = spec[o + 1] = spec[o + 2] = 255;
			spec[o + 3] = Math.round(Math.min(1, light) * 255);
		}
	}
	return { width: pw, height: ph, displacement, specular, margin };
}

/**
 * The maps as image URLs for feImage. PNG encoding runs off the main thread
 * (canvas.toBlob); the blob URLs live as long as the page.
 */
export async function buildMaps(w: number, h: number, r: number, material: GlassMaterial, scale = 1): Promise<Maps> {
	const px = computeMaps(w, h, r, material, scale);
	const canvas = document.createElement("canvas");
	canvas.width = px.width;
	canvas.height = px.height;
	const ctx = canvas.getContext("2d")!;
	const encode = (img: ImageData) => {
		ctx.putImageData(img, 0, 0);
		return new Promise<string>((resolve) =>
			canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png")), "image/png"),
		);
	};
	const displacement = await encode(px.displacement);
	const specular = await encode(px.specular);
	return { displacement, specular, margin: px.margin };
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
	const node = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
	parent?.append(node);
	return node;
}

/** The SVG filter for one shape: frost, refract (per channel), tone, highlight. */
function buildFilter(id: string, w: number, h: number, maps: Maps, m: GlassMaterial): SVGFilterElement {
	const W = w + 2 * maps.margin;
	const H = h + 2 * maps.margin;
	const region = { x: 0, y: 0, width: W, height: H };
	const f = el("filter", {
		id,
		...region,
		filterUnits: "userSpaceOnUse",
		primitiveUnits: "userSpaceOnUse",
		"color-interpolation-filters": "sRGB",
	});
	let src = "SourceGraphic";
	if (m.frost > 0) {
		el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: BLUR_SIGMA, result: "blur" }, f);
		src = "blur";
		if (m.frost < 1) {
			el("feComposite", { in: "SourceGraphic", in2: "blur", operator: "arithmetic", k1: 0, k2: 1 - m.frost, k3: m.frost, k4: 0, result: "frost" }, f);
			src = "frost";
		}
	}
	el("feImage", { href: maps.displacement, ...region, preserveAspectRatio: "none", result: "map" }, f);
	const keep = ["1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0", "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"];
	DISPERSION.forEach((k, c) => {
		el("feDisplacementMap", { in: src, in2: "map", scale: 2 * m.refraction * k, xChannelSelector: "R", yChannelSelector: "G", result: `d${c}` }, f);
		el("feColorMatrix", { in: `d${c}`, type: "matrix", values: keep[c], result: `c${c}` }, f);
	});
	el("feComposite", { in: "c0", in2: "c1", operator: "arithmetic", k2: 1, k3: 1, result: "rg" }, f);
	el("feComposite", { in: "rg", in2: "c2", operator: "arithmetic", k2: 1, k3: 1, result: "rgb" }, f);
	const tone = el("feComponentTransfer", { in: "rgb", result: "tone" }, f);
	for (const fn of ["feFuncR", "feFuncG", "feFuncB"] as const) el(fn, { type: "linear", slope: 1 - m.darken, intercept: m.lift }, tone);
	el("feFuncA", { type: "linear", slope: 0, intercept: 1 }, tone);
	el("feImage", { href: maps.specular, ...region, preserveAspectRatio: "none", result: "spec" }, f);
	el("feComposite", { in: "tone", in2: "spec", operator: "arithmetic", k2: 1, k3: 1 }, f);
	return f;
}

export interface LiquidRefraction {
	/** Whether SVG refraction is running (false: CSS frosted fallback). */
	readonly active: boolean;
	/** Re-measure every element (e.g. after a layout change ResizeObserver can't see). */
	refresh(): void;
	/** Stop refracting and fall back to the CSS frosted glass. */
	disconnect(): void;
}

/** Runs `fn` when the main thread is idle (soon after load), else after a timeout. */
function whenIdle(fn: () => void, timeout = 1000) {
	if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout });
	else setTimeout(fn, 50);
}

/**
 * Turns on refraction for every [data-glass] element under `root`. Safe to
 * call where it's unsupported: it returns an inactive controller and the CSS
 * fallback stays in place.
 *
 * Nothing runs on the critical path: the maps are built in idle time once
 * the page has loaded, one element per idle slice, and each element keeps
 * the CSS frosted glass until its filter is ready.
 */
export function initLiquidRefraction(root: ParentNode = document): LiquidRefraction {
	const elements = [...root.querySelectorAll<HTMLElement>("[data-glass]")];
	if (!elements.length || !supportsSvgBackdropFilter() || typeof ResizeObserver === "undefined") {
		return { active: false, refresh() {}, disconnect() {} };
	}

	const defs = el("svg", { "aria-hidden": "true", width: 0, height: 0, focusable: "false" });
	defs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
	document.body.append(defs);

	// One filter per distinct (material, size, radius, resolution), built once.
	const filters = new Map<string, { id: string; ready: Promise<Maps> }>();
	const scale = Math.min(window.devicePixelRatio || 1, 2);
	let n = 0;
	let connected = true;

	function update(node: HTMLElement) {
		if (!connected) return;
		const kind: GlassKind = node.dataset.glass === "clear" ? "clear" : "frosted";
		const material = GLASS_MATERIALS[kind];
		// Layout size, untransformed (hover scales mustn't rebuild the map).
		const w = node.offsetWidth;
		const h = node.offsetHeight;
		if (!w || !h) return;
		const radius = Math.min(parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0, w / 2, h / 2);
		const key = `${kind}:${w}x${h}:${radius}:${scale}`;
		if (node.dataset.glassKey === key) return;
		node.dataset.glassKey = key;
		let filter = filters.get(key);
		if (!filter) {
			const id = `lg-refract-${n++}`;
			const ready = buildMaps(w, h, radius, material, scale).then((maps) => {
				defs.append(buildFilter(id, w, h, maps, material));
				return maps;
			});
			filters.set(key, (filter = { id, ready }));
		}
		const { id, ready } = filter;
		ready.then((maps) => {
			// Superseded by a resize, or switched off, while the maps encoded.
			if (!connected || node.dataset.glassKey !== key) return;
			node.style.setProperty("--lg-refract-filter", `url(#${id})`);
			node.style.setProperty("--lg-refract-margin", `${maps.margin}px`);
			node.style.setProperty("--lg-refract-radius", `${radius}px`);
			node.setAttribute("data-glass-active", "");
		});
	}

	let queued = new Set<HTMLElement>();
	const ro = new ResizeObserver((entries) => {
		const first = queued.size === 0;
		for (const entry of entries) queued.add(entry.target as HTMLElement);
		if (first) {
			requestAnimationFrame(() => {
				const batch = queued;
				queued = new Set();
				batch.forEach(update);
			});
		}
	});

	// After load, one element per idle slice; then watch for size changes.
	const queue = [...elements];
	const next = () => {
		const node = queue.shift();
		if (!node || !connected) return;
		update(node);
		ro.observe(node);
		if (queue.length) whenIdle(next);
	};
	const begin = () => whenIdle(next);
	if (document.readyState === "complete") begin();
	else window.addEventListener("load", begin, { once: true });

	return {
		active: true,
		refresh() {
			elements.forEach((node) => {
				delete node.dataset.glassKey;
				update(node);
			});
		},
		disconnect() {
			connected = false;
			ro.disconnect();
			for (const node of elements) {
				node.removeAttribute("data-glass-active");
				delete node.dataset.glassKey;
				for (const p of ["--lg-refract-filter", "--lg-refract-margin", "--lg-refract-radius"]) node.style.removeProperty(p);
			}
			for (const { ready } of filters.values()) {
				ready.then((maps) => {
					for (const url of [maps.displacement, maps.specular]) if (url.startsWith("blob:")) URL.revokeObjectURL(url);
				});
			}
			defs.remove();
		},
	};
}
