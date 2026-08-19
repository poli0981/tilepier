import { formatLog, readLog } from '$lib/core/log-buffer';
import { LOCAL_KEYS } from '$lib/shared-constants';

/**
 * The bug-report payload (doc 18 §2–§4).
 *
 * TilePier never phones home (doc 18 §6), so this assembles a block the user
 * reads and sends themselves. Everything here is either environment or already
 * scrubbed log; nothing reaches in for note bodies, track titles or place
 * names.
 */

const ISSUE_URL = 'https://github.com/poli0981/tilepier/issues/new';

export interface TpEnvBlock {
	version: string;
	sha: string;
	locale: string;
	theme: string;
	ua: string;
	viewport: string;
	widgets: string;
	/** Correlates "same layout" across reports without carrying its contents. */
	layoutHash: string;
	storage: string;
	online: string;
	swState: string;
}

/**
 * FNV-1a, 32-bit, six hex characters. Not a security primitive — it exists so
 * two reports from the same arrangement can be recognised as such.
 */
export function shortHash(input: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

/** `clock×2, weather` — counts, never per-instance settings. */
function widgetSummary(widgetIds: readonly string[]): string {
	if (widgetIds.length === 0) return 'none';
	const counts = new Map<string, number>();
	for (const id of widgetIds) counts.set(id, (counts.get(id) ?? 0) + 1);
	return [...counts]
		.map(([id, n]) => (n > 1 ? `${id}×${n}` : id))
		.sort()
		.join(', ');
}

export function collectEnv(input: {
	version: string;
	sha: string;
	locale: string;
	theme: string;
	widgetIds: readonly string[];
	online: boolean;
}): TpEnvBlock {
	const layout = localStorage.getItem(LOCAL_KEYS.layout) ?? '';
	const swState =
		navigator.serviceWorker?.controller === null || navigator.serviceWorker === undefined
			? 'none'
			: (navigator.serviceWorker.controller?.state ?? 'unknown');

	return {
		version: input.version,
		sha: input.sha,
		locale: input.locale,
		theme: input.theme,
		ua: navigator.userAgent,
		viewport: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}`,
		widgets: widgetSummary(input.widgetIds),
		layoutHash: layout === '' ? 'none' : shortHash(layout),
		storage: typeof indexedDB === 'undefined' ? 'idb missing' : 'idb ok',
		online: input.online ? 'yes' : 'no',
		swState
	};
}

/** The block the dialog shows and the clipboard carries (doc 18 §4). */
export function formatReport(env: TpEnvBlock, errorId?: string): string {
	const lines = [
		errorId === undefined ? null : `error id: ${errorId}`,
		`version: ${env.version} (${env.sha})`,
		`locale: ${env.locale} · theme: ${env.theme}`,
		`ua: ${env.ua}`,
		`viewport: ${env.viewport}`,
		`widgets: ${env.widgets}`,
		`layoutHash: ${env.layoutHash} · storage: ${env.storage}`,
		`online: ${env.online} · swState: ${env.swState}`,
		'',
		'--- log ---',
		formatLog(readLog())
	].filter((line): line is string => line !== null);

	return lines.join('\n');
}

/**
 * doc 18 §4: the big block travels by clipboard, not in the URL. Issue forms
 * prefill from query params, but ~8 KB is the practical URL ceiling and a log
 * tail blows through it — so only the short fields go here.
 */
export function issueUrl(version: string): string {
	const params = new URLSearchParams({
		template: 'bug_report.yml',
		title: '[bug] ',
		labels: 'bug',
		version
	});
	return `${ISSUE_URL}?${params.toString()}`;
}
