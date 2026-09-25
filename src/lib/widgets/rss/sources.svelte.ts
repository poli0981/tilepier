import { untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { logEntry } from '$lib/core/log-buffer';
import type { TpSwrHandle } from '$lib/core/swr.svelte';
import { feedUrlHash } from '$lib/shared-constants';
import { feedView, type TpFeedReading, type TpFeedView } from './service';

/**
 * The bookkeeping between a list of feed URLs and the `TpRssFeedSource`
 * components that read them — shared by the tile and the detail, which both
 * need every feed of the instance and must not each grow their own copy of it.
 *
 * It owns two maps. **Hashes**: a source cannot exist without its key, and the
 * key is `feedUrlHash(url)`, which `crypto.subtle` only answers asynchronously —
 * so the component mounts a feed's source once its hash is here. **Handles**:
 * each source reports its `swr` handle up as it subscribes and again as it goes,
 * and every view is derived from them.
 *
 * Construct it during a component's initialisation: the hashing is an
 * `$effect`, owned by whichever component made this.
 */
export class TpFeedSources {
	readonly hashes = new SvelteMap<string, string>();
	readonly #handles = new SvelteMap<string, TpSwrHandle<TpFeedReading>>();

	/**
	 * `crypto.subtle` exists only in a secure context. Served over plain http —
	 * a LAN address in development — no feed can be keyed, and the owner says
	 * so rather than holding a skeleton forever.
	 */
	hashFailed = $state(false);

	constructor(feeds: () => readonly string[]) {
		$effect(() => {
			const wanted = feeds();
			let live = true;

			untrack(() => {
				for (const url of [...this.hashes.keys()]) {
					if (!wanted.includes(url)) this.hashes.delete(url);
				}
				for (const url of wanted) {
					if (this.hashes.has(url)) continue;
					feedUrlHash(url)
						.then((hash) => {
							if (live) this.hashes.set(url, hash);
						})
						.catch((error: unknown) => {
							this.hashFailed = true;
							// The error, never the URL: a private feed carries its token in it.
							logEntry('error', 'rss: a feed URL could not be hashed', { src: 'widget', error });
						});
				}
			});

			return () => {
				live = false;
			};
		});
	}

	/** Arrow properties, so a template can pass them straight to a source. */
	readonly onHandle = (url: string, handle: TpSwrHandle<TpFeedReading>): void => {
		this.#handles.set(url, handle);
	};

	/** Drops only the handle that is going — never a successor that a quick
	 *  remove-and-add has already put in its place. */
	readonly onGone = (url: string, handle: TpSwrHandle<TpFeedReading>): void => {
		if (this.#handles.get(url) === handle) this.#handles.delete(url);
	};

	/** In the order given, and only the feeds that have a source yet. */
	views(feeds: readonly string[]): TpFeedView[] {
		return feeds.flatMap((url): TpFeedView[] => {
			const handle = this.#handles.get(url);
			return handle === undefined ? [] : [feedView(url, handle)];
		});
	}

	/** One feed again, because the reader asked. Its refusal lands in its own
	 *  status, which is what everything renders from. */
	retryOne(url: string): void {
		void this.#handles
			.get(url)
			?.revalidate('retry')
			.catch(() => undefined);
	}

	/**
	 * Every feed again. An arrow property so it is one function for the life of
	 * the owner: the host badge's `retry` is compared by identity
	 * (`core/tile-status`), and a fresh closure per render would rewrite it.
	 */
	readonly retry = (): void => {
		for (const handle of this.#handles.values()) {
			void handle.revalidate('retry').catch(() => undefined);
		}
	};
}
