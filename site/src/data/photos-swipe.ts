// Copy for the Photos Swipe project page (/photos-swipe/), including every
// claim the "How it works" diagram makes. Keep claims here so they can be
// checked against the app's code and corrected in one place.

export const links = {
	install: "https://photoswiper-sync.sidlakkoju.workers.dev/photoswiper.user.js",
	github: "https://github.com/sidlakkoju/GooglePhotosSwiper",
	// The live demo. The coordinator copies the real build into
	// site/public/photos-swipe/demo/; see LiveDemo.astro for the contract.
	demo: "/photos-swipe/demo/",
};

export const intro = {
	title: "Photos Swipe",
	tagline: "Swipe to clean up Google Photos",
	lede: "Swipe through your Google Photos and free up storage. Left to trash, right to keep.",
	caption: "Free userscript · desktop browsers and iPhone Safari",
};

export const features = [
	{ icon: "swipe", title: "Swipe, don't select", text: "One photo at a time. Undo anytime." },
	{ icon: "hard-drive", title: "See storage freed", text: "A live counter that matches Google's quota." },
	{ icon: "shield", title: "Review before Trash", text: "Nothing moves until you confirm. 60-day restore." },
] as const;

export const installSteps = [
	{ title: "Get a userscript manager", text: "Tampermonkey on desktop, Userscripts on iPhone." },
	{ title: "Install Photos Swipe", text: "One click. It keeps itself updated." },
	{ title: "Open Google Photos", text: "Tap Photos Swipe at the bottom right." },
];

// ---------------------------------------------------------------------------
// How it works diagram
// ---------------------------------------------------------------------------
// Desktop geometry is a 1200x600 stage (Figma component 15:996). On narrow
// screens the same nodes stack vertically.

export type NodeId = "userscript" | "storage" | "api" | "media" | "trash" | "worker";
export type RouteId = "toApi" | "toMedia" | "toTrash" | "toWorker" | "toStorage";
export type LabelId = "libraryPage" | "upcomingPreviews" | "keepTrash" | "idsDecisions" | "moveBatch" | "verify" | "appCode";

export const diagram = {
	heading: "How it works",
	subheading: "It runs entirely inside your signed-in Google Photos tab.",
	tabLabel: "photos.google.com · your signed-in tab",
	tabLabelShort: "photos.google.com · your tab",
	groupLabel: "Google",
	optionalLabel: "Optional",
	footnote:
		"The script checks the Worker for updates on each Google Photos page load; no account data is sent. Optional sync uses Sign in with Google for identity only. No analytics.",

	nodes: {
		userscript: { title: "Photos Swipe userscript", sub: "UI in a shadow DOM over the page", glyph: "app" },
		storage: { title: "Decisions & progress", sub: "IndexedDB · on this device", glyph: "hard-drive" },
		api: { title: "Google Photos web API", sub: "batchexecute · the calls photos.google.com makes", glyph: "braces" },
		media: { title: "Google media servers", sub: "googleusercontent.com · previews & video", glyph: "download" },
		trash: { title: "Google Photos Trash", sub: "Restorable for 60 days", glyph: "trash" },
		worker: { title: "Photos Swipe Worker", sub: "Cloudflare · app updates + optional sync", glyph: "sync" },
	} satisfies Record<NodeId, { title: string; sub: string; glyph: string }>,

	labels: {
		libraryPage: "library page",
		upcomingPreviews: "upcoming previews",
		keepTrash: "keep / trash",
		idsDecisions: "IDs, decisions, progress",
		moveBatch: "move batch",
		verify: "verify",
		appCode: "app code",
	} satisfies Record<LabelId, string>,

	// Each step lights up `active` nodes, sends packets along `routes`
	// ("out" = from the tab toward Google/the Worker, "in" = back into the tab),
	// and shows `labels` on the wires.
	steps: [
		{
			id: "overview",
			chip: "Overview",
			title: "How it works",
			caption:
				"Photos Swipe runs inside your signed-in Google Photos tab. Your photos and videos only travel between Google and your browser.",
			active: [],
			routes: [],
			labels: ["appCode"],
		},
		{
			id: "read",
			chip: "1 · Read",
			title: "1 · Read your library",
			caption:
				"The userscript calls the same web API photos.google.com uses, with the session you're already signed in with. No password, and no Google API permissions to grant.",
			active: ["userscript", "api"],
			routes: [{ id: "toApi", dir: "out" }],
			labels: ["libraryPage"],
		},
		{
			id: "preview",
			chip: "2 · Preview",
			title: "2 · Preload previews",
			caption:
				"Previews for the next few photos load straight from Google's media servers into the tab, so swipes feel instant.",
			active: ["userscript", "media"],
			routes: [{ id: "toMedia", dir: "in" }],
			labels: ["upcomingPreviews"],
		},
		{
			id: "swipe",
			chip: "3 · Swipe",
			title: "3 · Swipe = a local decision",
			caption:
				"Each swipe is saved to IndexedDB on your device. Nothing is deleted. Optional sync shares item IDs, decisions and progress, never photos, names, locations or preview links.",
			active: ["userscript", "storage", "worker"],
			routes: [
				{ id: "toStorage", dir: "out" },
				{ id: "toWorker", dir: "out" },
			],
			labels: ["keepTrash", "idsDecisions", "appCode"],
		},
		{
			id: "trash",
			chip: "4 · Trash",
			title: "4 · Review, then move to Trash",
			caption:
				"After you review, marked items move to Google Photos Trash in batches of 25 through the web API, and each batch is confirmed in Trash. Restorable for 60 days.",
			active: ["userscript", "api", "trash"],
			routes: [
				{ id: "toApi", dir: "out" },
				{ id: "toTrash", dir: "out" },
			],
			labels: ["moveBatch", "verify"],
		},
	] as Array<{
		id: string;
		chip: string;
		title: string;
		caption: string;
		active: NodeId[];
		routes: Array<{ id: RouteId; dir: "out" | "in" }>;
		labels: LabelId[];
	}>,
};
