/**
 * Service-worker registration and update state (doc 17 §2).
 *
 * Hand-rolled registration against `src/service-worker.ts`, which SvelteKit
 * compiles and serves at `/service-worker.js`. See that file for why the
 * vite-plugin-pwa route was abandoned (spike S5).
 *
 * The rule from doc 17 §2 is explicit: a waiting worker shows a quiet toast,
 * and `skipWaiting` fires **only** on user action. Never reload under the user.
 */

class PwaState {
	/** A new version is installed and waiting to take over. */
	updateReady = $state(false);
	/** The shell is precached and the app will work offline. */
	offlineReady = $state(false);

	#waiting: ServiceWorker | null = null;
	#started = false;

	async init() {
		if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
		if (this.#started) return;
		this.#started = true;

		let registration: ServiceWorkerRegistration;
		try {
			registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
		} catch {
			// A blocked or unsupported worker must never break the app — offline
			// support is an enhancement, and the deck is local-first regardless.
			return;
		}

		// Already waiting when the page loaded (a previous visit installed it).
		if (registration.waiting && navigator.serviceWorker.controller) {
			this.#waiting = registration.waiting;
			this.updateReady = true;
		}

		registration.addEventListener('updatefound', () => {
			const installing = registration.installing;
			if (!installing) return;

			installing.addEventListener('statechange', () => {
				if (installing.state !== 'installed') return;

				if (navigator.serviceWorker.controller) {
					// An older worker is in charge: this is an update, so ask first.
					this.#waiting = installing;
					this.updateReady = true;
				} else {
					// First install — the shell is now available offline.
					this.offlineReady = true;
				}
			});
		});
	}

	/** User accepted the update: let the new worker take over, then reload. */
	async applyUpdate() {
		this.updateReady = false;
		const waiting = this.#waiting;
		if (!waiting) {
			location.reload();
			return;
		}

		// Reload once the new worker is actually in control, not before.
		navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
			once: true
		});
		waiting.postMessage({ type: 'SKIP_WAITING' });
	}

	dismiss() {
		this.updateReady = false;
		this.offlineReady = false;
	}
}

export const pwa = new PwaState();
