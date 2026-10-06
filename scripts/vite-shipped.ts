import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Records which installed packages a build actually puts in the bundles, for
 * `pnpm licenses:gen` (doc 16 §5).
 *
 * `pnpm licenses list --prod` cannot answer that here: svelte and SvelteKit,
 * and devalue, cookie and set-cookie-parser under them, are devDependencies
 * whose code ships in the Worker and the page. A hand-kept list of them would
 * drift the first time an import moved, so the module graph is read instead:
 * every chunk of every environment — the page, the server, the music tag
 * worker — names the modules it holds, and each one under `node_modules/`
 * belongs to a package. One file per environment, and per worker (Vite builds
 * each worker on its own); `pnpm clean` empties the folder, so every build
 * starts from nothing.
 */

export const SHIPPED_DIR = '.svelte-kit/tp-shipped';

/** The package directory a module id lives in, or null for project source. */
export function packageRoot(id: string): string | null {
	const path = id.replace(/\\/g, '/').replace(/^\0/, '').split('?')[0] ?? '';
	const marker = '/node_modules/';
	const at = path.lastIndexOf(marker);
	if (at === -1) return null;
	const rest = path.slice(at + marker.length).split('/');
	const name = rest[0]?.startsWith('@') ? rest.slice(0, 2).join('/') : rest[0];
	return name === undefined || name === '' ? null : path.slice(0, at + marker.length) + name;
}

export function shippedPackages(label: string): Plugin {
	return {
		name: `tp-shipped-packages:${label}`,
		apply: 'build',
		generateBundle(_options, bundle) {
			const roots = new Set<string>();
			let entry = '';
			for (const item of Object.values(bundle)) {
				if (item.type !== 'chunk') continue;
				if (item.isEntry && entry === '') entry = item.name;
				for (const id of item.moduleIds) {
					const root = packageRoot(id);
					if (root !== null) roots.add(relative(process.cwd(), root).replace(/\\/g, '/'));
				}
			}
			const environment = (this as { environment?: { name: string } }).environment?.name;
			const file = [label, environment ?? 'default', ...(label === 'worker' ? [entry] : [])];
			mkdirSync(SHIPPED_DIR, { recursive: true });
			writeFileSync(
				join(SHIPPED_DIR, `${file.join('-')}.json`),
				`${JSON.stringify([...roots].sort(), null, '\t')}\n`
			);
		}
	};
}
