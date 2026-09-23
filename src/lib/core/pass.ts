import type { TpApiResponse, TpVerifyConfig, TpVerifyPass } from '$lib/api-types';
import { PASS_HEADER } from '$lib/shared-constants';

/**
 * The client half of the bot check (doc 15 §3): turns a Turnstile token into a
 * pass, keeps the pass in memory, and gives `fetchEnvelope` a header.
 *
 * **Idle until something primes it.** Before `TpBotCheck` mounts — which it
 * does only after the legal gate is passed — every request goes without a pass
 * and nothing is fetched on its behalf. That keeps the gate out of every
 * component test that stubs `fetch` and counts the calls, and it is also the
 * honest order of events: nobody is challenged before agreeing to anything.
 *
 * **Single-flight.** A deck opening at once is a dozen tiles revalidating in the
 * same tick. They all wait on one promise: one config read, one challenge, one
 * exchange.
 *
 * **The Worker decides.** `GET /api/verify` says whether there is a gate at all;
 * a 401 later says the belief was stale, and `invalidate` re-asks. A failure to
 * reach any of it sends the request without a pass and lets the server rule.
 *
 * Rune-free, like `api.ts`, so it is tested in the node project; the component
 * reads `status` through `subscribe`.
 */

/** Runs the Turnstile challenge for a sitekey and resolves with its token. */
export type TpChallenger = (sitekey: string) => Promise<string>;

export type TpPassStatus =
	/** Nothing has primed the gate; requests go without a pass. */
	| 'idle'
	/** Config, challenge or exchange in flight. */
	| 'checking'
	/** A pass is held, or this deploy has no gate. */
	| 'ready'
	/** The last attempt failed. `retry()`, or the next request, tries again. */
	| 'failed';

/** Replace a pass this close to its expiry rather than send it. */
const RENEW_BEFORE_MS = 60_000;

/** How long a request waits for a pass before going without one. */
const WAIT_MS = 15_000;

const VERIFY_URL = '/api/verify';

interface HeldPass {
	value: string;
	expiresAt: number;
}

export class PassGate {
	readonly #fetch: typeof fetch;
	#status: TpPassStatus = 'idle';
	#challenger: TpChallenger | null = null;
	#pass: HeldPass | null = null;
	#gateOff = false;
	#inflight: Promise<string | null> | null = null;
	readonly #listeners = new Set<(status: TpPassStatus) => void>();

	constructor(options: { fetcher?: typeof fetch } = {}) {
		// Resolved per call rather than captured, so a test's stubbed global is
		// the one used.
		this.#fetch = options.fetcher ?? ((input, init) => fetch(input, init));
	}

	get status(): TpPassStatus {
		return this.#status;
	}

	subscribe(listener: (status: TpPassStatus) => void): () => void {
		this.#listeners.add(listener);
		listener(this.#status);
		return () => this.#listeners.delete(listener);
	}

	/** Called by `TpBotCheck` once the legal gate is passed. Starts at once. */
	prime(challenger: TpChallenger): void {
		this.#challenger = challenger;
		void this.ensure().catch(() => undefined);
	}

	/** After a failure: try again now, rather than on the next tile refresh. */
	retry(): void {
		void this.ensure().catch(() => undefined);
	}

	/**
	 * The pass header for one request — or `{}` while idle, with no gate, or
	 * when a pass could not be had in time. Never throws: without a pass the
	 * request still goes, and a 401 is the server's to send.
	 */
	async header(): Promise<Record<string, string>> {
		if (this.#challenger === null) return {};
		let timer: ReturnType<typeof setTimeout> | undefined;
		const giveUp = new Promise<null>((resolve) => {
			timer = setTimeout(() => resolve(null), WAIT_MS);
		});
		try {
			const pass = await Promise.race([this.ensure(), giveUp]);
			return pass === null ? {} : { [PASS_HEADER]: pass };
		} catch {
			return {};
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * A request carrying `sent` came back `VERIFY_REQUIRED`. Drop that pass —
	 * and only that one: a tile answering late must not throw away the pass a
	 * faster tile has just fetched. With no pass sent, the "no gate" belief was
	 * the stale thing, so the next `ensure` asks the Worker again.
	 */
	invalidate(sent: string | undefined): void {
		if (sent === undefined) this.#gateOff = false;
		else if (this.#pass?.value === sent) this.#pass = null;
	}

	/** A pass good for at least another minute, or `null` when there is no gate. */
	ensure(): Promise<string | null> {
		if (this.#gateOff) return Promise.resolve(null);
		const held = this.#pass;
		if (held !== null && held.expiresAt - Date.now() > RENEW_BEFORE_MS) {
			return Promise.resolve(held.value);
		}
		this.#inflight ??= this.#obtain().finally(() => {
			this.#inflight = null;
		});
		return this.#inflight;
	}

	/** Test seam. */
	reset(): void {
		this.#challenger = null;
		this.#pass = null;
		this.#gateOff = false;
		this.#inflight = null;
		this.#setStatus('idle');
	}

	async #obtain(): Promise<string | null> {
		const challenger = this.#challenger;
		if (challenger === null) return null;

		this.#setStatus('checking');
		try {
			const sitekey = await this.#sitekey();
			if (sitekey === null) {
				this.#gateOff = true;
				this.#setStatus('ready');
				return null;
			}
			const pass = await this.#exchange(await challenger(sitekey));
			this.#pass = pass;
			this.#setStatus('ready');
			return pass.value;
		} catch (error) {
			this.#setStatus('failed');
			throw error;
		}
	}

	async #sitekey(): Promise<string | null> {
		const response = await this.#fetch(VERIFY_URL, { headers: { accept: 'application/json' } });
		const body = (await response.json()) as TpApiResponse<TpVerifyConfig>;
		if (!body.ok) throw new Error(`verify config ${String(response.status)}`);
		return body.data.sitekey;
	}

	async #exchange(token: string): Promise<HeldPass> {
		const response = await this.#fetch(VERIFY_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ token })
		});
		const body = (await response.json()) as TpApiResponse<TpVerifyPass>;
		if (!body.ok) throw new Error(`verify refused (${body.error.code})`);
		return { value: body.data.pass, expiresAt: body.data.expiresAt };
	}

	#setStatus(status: TpPassStatus): void {
		if (status === this.#status) return;
		this.#status = status;
		for (const listener of this.#listeners) listener(status);
	}
}

/** The app's one gate. */
export const passGate = new PassGate();
