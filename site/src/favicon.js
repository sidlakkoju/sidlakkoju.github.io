// Pixel-art bichon frise favicon (16x16), modeled on the GitHub avatar: white
// cotton-ball face, cream ears, lavender sequin sweater. The static
// /favicon.svg is frame 0; animateFavicon() swaps frames in the tab.

const PALETTE = {
	W: "#ffffff", // fluff
	C: "#e3ddd2", // cream ears / shading
	K: "#17171c", // eyes, nose
	P: "#ff8fa3", // tongue
	V: "#b8a3e3", // sweater
	D: "#8f7cc2", // sweater shade
	s: "#f6f2ff", // sequin glint
};

const BASE = [
	"................",
	"....WWWWWWWW....",
	"..WWWWWCWWWWWW..",
	".WWWWWWWWWWCWWW.",
	".CWWWWWWWWWWWWC.",
	"CCWWWWWWWWWWWWCC",
	"CCWWWWWWWWWWWWCC",
	"CCWWKKWWWWKKWWCC",
	"CCWWKKWWWWKKWWCC",
	"CCCWWWWWWWWWWCCC",
	".CCWWWWKKWWWWCC.",
	".CCWWWWWWWWWWCC.",
	"..CCWWWWWWWWCC..",
	"..VVVVVVVVVVVV..",
	".VDVVVVVVVVVVDV.",
	"..VVVVVVVVVVVV..",
];

// Sequin positions [x, y]; alternating sets make the sweater twinkle.
const SEQUINS = [
	[[5, 14], [10, 14], [7, 13]],
	[[4, 15], [8, 14], [11, 15]],
];

function set(rows, x, y, c) {
	rows[y] = rows[y].slice(0, x) + c + rows[y].slice(x + 1);
}

function grid({ blink = false, tongue = false, sparkle = 0 } = {}) {
	const rows = [...BASE];
	if (blink) {
		for (const x of [4, 5, 10, 11]) {
			set(rows, x, 7, "W");
			set(rows, x, 8, "K");
		}
	}
	if (tongue) {
		for (const [x, y] of [[7, 11], [8, 11], [7, 12], [8, 12]]) set(rows, x, y, "P");
	}
	for (const [x, y] of SEQUINS[sparkle]) set(rows, x, y, "s");
	return rows;
}

function svg(rows) {
	// One rect per horizontal run of a color keeps the markup tiny.
	let rects = "";
	rows.forEach((row, y) => {
		for (let x = 0; x < row.length; ) {
			const c = row[x];
			let end = x + 1;
			while (end < row.length && row[end] === c) end++;
			if (c !== ".") rects += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${PALETTE[c]}"/>`;
			x = end;
		}
	});
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">` +
		`<rect width="16" height="16" rx="3" fill="#0d0f16" shape-rendering="geometricPrecision"/>${rects}</svg>`
	);
}

export const faviconSvg = svg(grid());

// [frame, duration ms]: idle, a blink, a little pant, a double blink.
const SEQUENCE = [
	[{}, 1400],
	[{ blink: true }, 140],
	[{ sparkle: 1 }, 900],
	[{ tongue: true }, 260],
	[{ sparkle: 1 }, 260],
	[{ tongue: true }, 260],
	[{ sparkle: 1 }, 260],
	[{ tongue: true }, 260],
	[{}, 1300],
	[{ blink: true }, 130],
	[{}, 140],
	[{ blink: true }, 130],
];

export function animateFavicon() {
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const frames = SEQUENCE.map(([opts, ms]) => [`data:image/svg+xml,${encodeURIComponent(svg(grid(opts)))}`, ms]);

	// Browsers pick one icon from several candidates, so own a single link.
	for (const link of document.querySelectorAll('link[rel="icon"]')) link.remove();
	const link = document.createElement("link");
	link.rel = "icon";
	link.type = "image/svg+xml";
	document.head.append(link);

	let i = 0;
	const tick = () => {
		const [href, ms] = frames[i];
		link.href = href;
		i = (i + 1) % frames.length;
		setTimeout(tick, ms);
	};
	tick();
}
