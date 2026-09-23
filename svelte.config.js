import adapter from '@sveltejs/adapter-cloudflare';

/**
 * SvelteKit config (doc 03 §Repo structure).
 *
 * The CSP block is the important part. Doc 15 §2 specifies `script-src 'self'`
 * with no `'unsafe-inline'`, and claimed "Rolldown output complies". It does —
 * but SvelteKit itself emits a small inline <script> to hand hydration data to
 * the client, and a bare `script-src 'self'` blocks it. The failure mode is
 * nasty: the page renders fine, so everything looks healthy, and only the parts
 * that need JavaScript quietly stop working. Found 2026-08-10 by an e2e test
 * where clicking "Tôi đồng ý" did nothing.
 *
 * `mode: 'hash'` makes SvelteKit hash its own inline scripts and emit the CSP
 * with those hashes included. Hash mode rather than nonce because nonces need a
 * fresh value per response, which prerendered pages cannot have.
 */
const config = {
	kit: {
		adapter: adapter(),
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				// Cloudflare Turnstile's api.js, which refuses to run from a proxied
				// or bundled copy (doc 15 §3). The only third-party script source.
				'script-src': ['self', 'https://challenges.cloudflare.com'],
				// Turnstile draws its challenge in an iframe from the same host.
				// Without this, default-src 'self' would refuse the frame.
				'frame-src': ['https://challenges.cloudflare.com'],
				// Svelte writes inline styles for transitions — the pragmatic cost
				// doc 15 §2 already accepts.
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:', 'https://tiles.openfreemap.org'],
				'media-src': ['self', 'blob:'],
				// The single third party the browser may talk to directly (doc 10 §6).
				'connect-src': ['self', 'https://tiles.openfreemap.org'],
				'font-src': ['self'],
				'worker-src': ['self'],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'object-src': ['none'],
				'upgrade-insecure-requests': true
			}
		}
	},
	compilerOptions: {
		// Force runes mode project-wide except for libraries (CLAUDE.md rule 6).
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	}
};

export default config;
