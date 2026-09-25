<script lang="ts">
	import { untrack } from 'svelte';
	import { useRefresh } from '$lib/core/refresh.svelte';
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpSwrHandle } from '$lib/core/swr.svelte';
	import { RSS_CADENCE, feedSource, type TpFeedReading } from './service';

	/**
	 * One feed's subscription and refresh — and no markup at all.
	 *
	 * **A component per feed** because a tile's feed count changes while it is
	 * mounted, and `useRefresh` registers once, at initialisation, under an id
	 * it captures (doc 04 §3). A component keyed by feed URL gives every feed a
	 * lifetime of its own: it subscribes when its feed is added, it registers
	 * its own cadence, and both go when it is removed — with no other feed's
	 * registration or subscription touched.
	 *
	 * Not a grid item: this renders nothing, inside a tile that gridstack
	 * already owns (CLAUDE.md rule 1 is about `.grid-stack-item` wrappers).
	 *
	 * **The refresh is registered under the instance** —
	 * `<instanceId>:rss:<hash>` — as markets registers `<instanceId>:stock`, so
	 * no tile's refresh depends on a closure belonging to another tile. Two tiles
	 * reading one feed may then both come due at once, and that costs one
	 * request: `swr` shares the one in flight, and the edge answers whatever is
	 * left. The label names the hash, never the URL, which may carry a private
	 * feed's token (service.ts).
	 */
	interface Props {
		instanceId: string;
		/** Canonical, and never changes for the life of this component: the
		 *  parent keys it by URL. */
		url: string;
		/** `feedUrlHash(url)`, worked out by the parent before mounting this. */
		hash: string;
		db?: TpDb | undefined;
		/** Receives this feed's handle once it exists… */
		onHandle: (url: string, handle: TpSwrHandle<TpFeedReading>) => void;
		/** …and again as it goes, so the parent drops only this one — never a
		 *  successor that a quick remove-and-add has already put in its place. */
		onGone: (url: string, handle: TpSwrHandle<TpFeedReading>) => void;
	}

	let { instanceId, url, hash, db = undefined, onHandle, onGone }: Props = $props();

	let handle: TpSwrHandle<TpFeedReading> | null = null;

	// Made and released in one effect, as markets does, so a component torn down
	// before its effects run cannot leave a subscription behind. Every read is
	// untracked: none of these props can change for this instance, and `swr()`
	// reads its dedupe map and then writes it — tracked, that self-invalidates.
	$effect(() => {
		const source = untrack(() => feedSource(url, hash, db));
		handle = source;
		untrack(() => onHandle(url, source));

		return () => {
			handle = null;
			untrack(() => onGone(url, source));
			source.release();
		};
	});

	const taskId = untrack(() => `${instanceId}:rss:${hash}`);
	const label = untrack(() => `rss:${hash.slice(0, 8)}`);

	useRefresh(
		taskId,
		RSS_CADENCE,
		async () => {
			await handle?.revalidate('scheduler');
		},
		// The first read is `swr`'s own: it asks when Dexie's copy is past the
		// window, and not when it is not.
		{ label, runOnRegister: false }
	);
</script>
