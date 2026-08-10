/**
 * Prerendered so the legal gate exists in the HTML before any JavaScript runs
 * (doc 16 §2).
 *
 * Note this route group does **not** set `ssr = false`, which doc 03
 * §Rendering strategy originally specified for the dashboard. Those two
 * requirements are incompatible: `ssr = false` disables server rendering for
 * the layouts above the page too, so the gate would vanish from the HTML —
 * verified on a real build, where `/` came back with no gate markup at all
 * while `/legal/*` (which does SSR) carried it, exactly backwards.
 *
 * The rationale doc 03 gave for `ssr = false` was that server-rendering the
 * deck "would render an empty shell then flash". That is addressed where it
 * actually belongs: the deck renders nothing until it has mounted and read
 * client storage, so the server emits an empty deck area and there is nothing
 * to flash. The shell — header, theme class, gate — still prerenders.
 */
export const prerender = true;
