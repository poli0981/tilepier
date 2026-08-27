import { MANIFESTS } from '$lib/core/registry';

/**
 * The detail deep link (doc 06 §6, doc 13 §5.4).
 *
 * **Inside the `(app)` group**, so the legal gate wraps it. Doc 03's tree drew
 * this route as a sibling of the group; that would have served notes and todo
 * content full-screen to a visitor who had not accepted the terms. Route groups
 * do not appear in the URL, so the path is still `/w/[id]` — the fix costs
 * nothing, and doc 03 has been corrected.
 *
 * Prerendered like the rest of the shell rather than rendered per request. The
 * widget ids are a closed set the registry already knows, so `entries()` can
 * enumerate them and every detail route becomes static HTML with the gate in
 * it — no Worker invocation for a page whose content is client-side anyway.
 * That is the same shape `/` has, and "client-rendered" in doc 03 means the
 * *content*, not the shell.
 *
 * A consequence worth knowing: the `?i=<instanceId>` query cannot be read
 * during prerender, and SvelteKit will throw if anything tries. The page reads
 * it from `location` behind a `browser` guard, exactly as `TpSettingsPanel`
 * does for `?debug=1`.
 */
export const prerender = true;

/** Only widgets that actually have a detail view get a route. A deep link to a
 *  widget without one — or to one this build has not gained yet — is a genuine
 *  404 rather than a page that renders an apology. */
export function entries(): { id: string }[] {
	return MANIFESTS.filter((manifest) => manifest.loadDetail !== undefined).map((manifest) => ({
		id: manifest.id
	}));
}
