import { LEGAL_VERSION, LOCAL_KEYS } from '$lib/shared-constants';

/**
 * Legal gate state (doc 16 §2).
 *
 * The gate is a real gate, not an overlay: `data-legal="ok"` on <html> is set
 * by static/boot.js before first paint, and CSS keys off it. Deleting the gate
 * node from the DOM does not grant access, because the app store only
 * hydrates once the flag exists.
 */

/** Shape of `tp.legal.v1` (doc 05 §2). Not exported until something outside
 *  this module needs it — the settings backup exporter will, in Week 1. */
interface TpLegalAcceptance {
	acceptedVersion: number;
	acceptedAt: string;
}

/** True when the stored acceptance covers the current LEGAL_VERSION. */
export function hasAcceptedLegal(): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		const raw = localStorage.getItem(LOCAL_KEYS.legal);
		if (!raw) return false;
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return false;
		const version = (parsed as { acceptedVersion?: unknown }).acceptedVersion;
		return typeof version === 'number' && version >= LEGAL_VERSION;
	} catch {
		// Corrupt JSON must never crash the shell (doc 05 §5); fail closed.
		return false;
	}
}

/** Records acceptance and lifts the gate for this document. */
export function acceptLegal(): void {
	const value: TpLegalAcceptance = {
		acceptedVersion: LEGAL_VERSION,
		acceptedAt: new Date().toISOString()
	};
	try {
		localStorage.setItem(LOCAL_KEYS.legal, JSON.stringify(value));
	} catch {
		// Private mode or a full quota: the session still proceeds, the gate
		// simply returns next visit. Better than trapping the user.
	}
	document.documentElement.setAttribute('data-legal', 'ok');
}
