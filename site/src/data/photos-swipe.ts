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

// ---------------------------------------------------------------------------
// Install modal
// ---------------------------------------------------------------------------
// Opened by every Install button (the buttons still link to links.install
// without JS). Store links and setup toggles follow docs/userscript.md in the
// GooglePhotosSwiper repo; the illustrations follow how each manager's install
// prompt actually behaves (Tampermonkey's install page, the Userscripts popup).

export type PlatformId = "chrome" | "edge" | "firefox" | "safari" | "ios";

export interface ManagerLink {
	name: string;
	store: string;
	href: string;
}

export const installGuide = {
	title: "Install Photos Swipe",
	subtitle: "Three steps, about a minute.",
	pickerLabel: "Your browser",
	allLabel: "Pick your browser",
	safety: { text: "Runs only on photos.google.com", link: "open source", href: links.github },
	platforms: [
		{
			id: "chrome",
			chip: "Chrome",
			blurb: "Chrome, Brave, Arc and other Chromium browsers",
			managers: [
				{
					name: "Tampermonkey",
					store: "Chrome Web Store",
					href: "https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo",
				},
			],
			note: "Then open chrome://extensions, choose Tampermonkey › Details and turn on Allow User Scripts. Don't see it? Turn on Developer mode first.",
		},
		{
			id: "edge",
			chip: "Edge",
			blurb: "Microsoft Edge",
			managers: [
				{
					name: "Tampermonkey",
					store: "Edge Add-ons",
					href: "https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd",
				},
			],
			note: "If Tampermonkey says scripts can't run, open edge://extensions, turn on Developer mode, and check Tampermonkey › Details for Allow User Scripts.",
		},
		{
			id: "firefox",
			chip: "Firefox",
			blurb: "Firefox",
			managers: [
				{ name: "Tampermonkey", store: "Firefox Add-ons", href: "https://addons.mozilla.org/firefox/addon/tampermonkey/" },
				{ name: "Violentmonkey", store: "Firefox Add-ons", href: "https://addons.mozilla.org/firefox/addon/violentmonkey/" },
			],
			note: "",
		},
		{
			id: "safari",
			chip: "Safari on Mac",
			blurb: "Safari on Mac",
			managers: [
				{ name: "Userscripts", store: "Mac App Store · free", href: "https://apps.apple.com/app/userscripts/id1463298887" },
				{ name: "Tampermonkey", store: "Mac App Store · paid", href: "https://apps.apple.com/app/tampermonkey/id6738342400" },
			],
			note: "Then turn it on in Safari › Settings › Extensions and allow it on photos.google.com.",
		},
		{
			id: "ios",
			chip: "iPhone & iPad",
			blurb: "Safari on iPhone and iPad",
			managers: [
				{ name: "Userscripts", store: "App Store · free", href: "https://apps.apple.com/app/userscripts/id1463298887" },
			],
			note: "Open the app once. Then go to Settings › Apps › Safari › Extensions (Settings › Safari › Extensions on older iOS), turn on Userscripts and allow it on photos.google.com.",
		},
	] satisfies Array<{ id: PlatformId; chip: string; blurb: string; managers: ManagerLink[]; note: string }>,
	// Shown on iPhone when the page is open in another browser.
	iosNotSafari: "Safari extensions only run in Safari. Open this page in Safari to install.",
	steps: {
		manager: "Install a userscript manager",
		script: {
			title: "Install Photos Swipe",
			button: "Install Photos Swipe",
			// What the manager shows next, per platform.
			hint: {
				all: "Your userscript manager opens an install prompt. Review it, then choose Install.",
				tampermonkey: "Tampermonkey opens an install page. Review it, then choose Install.",
				firefox: "Your manager opens an install page. Choose Install (Violentmonkey: Confirm installation).",
				safari:
					"Safari shows the script. Click the Userscripts button in the toolbar, then choose Install in its popup.",
				ios: "Safari shows the script. Tap the extensions button in the address bar, choose Userscripts, then tap Install.",
			},
		},
		open: {
			title: "Open Google Photos and tap the Photos Swipe button at the bottom right.",
			iosExtra: "Use Safari, not the Google Photos app.",
			button: "Open",
			href: "https://photos.google.com",
		},
	},
};

// ---------------------------------------------------------------------------
// How it works diagram
// ---------------------------------------------------------------------------
// Desktop geometry is a 1200x600 stage (Figma component 15:996). On narrow
// screens the same nodes stack vertically as one-line rows: `subShort`,
// `chipShort` and `captionShort` are the phone versions of `sub`, `chip` and
// `caption`, and must make the same claims.

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
		userscript: {
			title: "Photos Swipe userscript",
			sub: "UI in a shadow DOM over the page",
			subShort: "UI in a shadow DOM over the page",
			glyph: "app",
		},
		storage: {
			title: "Decisions & progress",
			sub: "IndexedDB · on this device",
			subShort: "IndexedDB · on this device",
			glyph: "hard-drive",
		},
		api: {
			title: "Google Photos web API",
			sub: "batchexecute · the calls photos.google.com makes",
			subShort: "Same API as photos.google.com",
			glyph: "braces",
		},
		media: {
			title: "Google media servers",
			sub: "googleusercontent.com · previews & video",
			subShort: "Previews & video",
			glyph: "download",
		},
		trash: { title: "Google Photos Trash", sub: "Restorable for 60 days", subShort: "Restorable for 60 days", glyph: "trash" },
		worker: {
			title: "Photos Swipe Worker",
			sub: "Cloudflare · app updates + optional sync",
			subShort: "Cloudflare · updates + optional sync",
			glyph: "sync",
		},
	} satisfies Record<NodeId, { title: string; sub: string; subShort: string; glyph: string }>,

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
			chipShort: "",
			title: "How it works",
			caption:
				"Photos Swipe runs inside your signed-in Google Photos tab. Your photos and videos only travel between Google and your browser.",
			captionShort: "It runs inside your signed-in Google Photos tab. Photos only travel between Google and your browser.",
			active: [],
			routes: [],
			labels: ["appCode"],
		},
		{
			id: "read",
			chip: "1 · Read",
			chipShort: "Read",
			title: "1 · Read your library",
			caption:
				"The userscript calls the same web API photos.google.com uses, with the session you're already signed in with. No password, and no Google API permissions to grant.",
			captionShort: "It calls the same web API as photos.google.com, with your session. No password, no permissions to grant.",
			active: ["userscript", "api"],
			routes: [{ id: "toApi", dir: "out" }],
			labels: ["libraryPage"],
		},
		{
			id: "preview",
			chip: "2 · Preview",
			chipShort: "Preview",
			title: "2 · Preload previews",
			caption:
				"Previews for the next few photos load straight from Google's media servers into the tab, so swipes feel instant.",
			captionShort: "The next few previews load straight from Google's media servers, so swipes feel instant.",
			active: ["userscript", "media"],
			routes: [{ id: "toMedia", dir: "in" }],
			labels: ["upcomingPreviews"],
		},
		{
			id: "swipe",
			chip: "3 · Swipe",
			chipShort: "Swipe",
			title: "3 · Swipe = a local decision",
			caption:
				"Each swipe is saved to IndexedDB on your device. Nothing is deleted. Optional sync shares item IDs, decisions and progress, never photos, names, locations or preview links.",
			captionShort: "Each swipe is saved on your device. Nothing is deleted. Optional sync shares only IDs, decisions and progress.",
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
			chipShort: "Trash",
			title: "4 · Review, then move to Trash",
			caption:
				"After you review, marked items move to Google Photos Trash in batches of 25 through the web API, and each batch is confirmed in Trash. Restorable for 60 days.",
			captionShort: "After review, marked items move to Trash in batches of 25, and each batch is verified. Restorable for 60 days.",
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
		/** Phone segmented-control label; empty shows the overview icon. */
		chipShort: string;
		title: string;
		caption: string;
		captionShort: string;
		active: NodeId[];
		routes: Array<{ id: RouteId; dir: "out" | "in" }>;
		labels: LabelId[];
	}>,
};
