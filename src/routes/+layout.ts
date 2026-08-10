/**
 * The shell is prerendered so the legal gate exists in the HTML before any
 * JavaScript runs (doc 16 §2) and first paint is instant (doc 03 §Rendering).
 * The dashboard itself opts out of SSR in `+page.ts` — it depends entirely on
 * client storage, so rendering it on the server would only produce a flash.
 */
export const prerender = true;
