import { faviconSvg } from "../favicon.js";

// Static first frame for crawlers and browsers that don't run the page script.
export function GET() {
	return new Response(faviconSvg, { headers: { "Content-Type": "image/svg+xml" } });
}
