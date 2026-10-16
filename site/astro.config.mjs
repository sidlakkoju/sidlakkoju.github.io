// @ts-check
import { defineConfig } from 'astro/config';

// Deployed as a GitHub user site at sidlakkoju.github.io (repo must be
// named exactly `sidlakkoju.github.io`). That means no base path.
export default defineConfig({
	site: 'https://sidlakkoju.github.io',
	build: {
		// Each page's CSS goes in its <style>, not a render-blocking <link>:
		// one round trip less before first paint. (GitHub Pages caches files
		// for only 10 minutes, so separate stylesheets buy little on repeat
		// visits.)
		inlineStylesheets: 'always',
	},
});
