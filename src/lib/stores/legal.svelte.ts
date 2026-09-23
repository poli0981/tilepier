import { acceptLegal, hasAcceptedLegal } from '$lib/core/legal';

/**
 * Whether the legal gate has been passed, as state the app can wait on
 * (doc 16 §2).
 *
 * `core/legal.ts` reads and writes `tp.legal.v1`; this is the reactive view of
 * it. **The gate was CSS alone until Week 5b.** `.tp-app` stayed hidden until
 * `data-legal="ok"`, while underneath it the deck mounted and its widgets were
 * free to fetch — `e2e/legal-gate` found a currency tile calling `/api/fx`
 * before anyone had agreed to anything. The deck page and the detail route now
 * wait on `accepted`, which makes "a real gate in code, not an overlay" true of
 * the code and not only of the stylesheet.
 *
 * Read from storage once, when the module is first imported on the client —
 * before the first component renders — so a returning visitor never sees the
 * deck wait a frame for it. The prerender has no storage and gets `false`,
 * which is the gate it has always shipped.
 */
class LegalGate {
	#accepted = $state(typeof localStorage !== 'undefined' && hasAcceptedLegal());

	get accepted(): boolean {
		return this.#accepted;
	}

	/**
	 * Re-reads storage — the layout's defence against a dropped boot.js.
	 * Returns the fresh value rather than reading the state back, so an effect
	 * that calls this does not come to depend on what it just wrote.
	 */
	sync(): boolean {
		const accepted = hasAcceptedLegal();
		this.#accepted = accepted;
		return accepted;
	}

	accept(): void {
		acceptLegal();
		this.#accepted = true;
	}
}

export const legalGate = new LegalGate();
