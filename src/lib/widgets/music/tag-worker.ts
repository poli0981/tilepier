/// <reference lib="webworker" />
import { parseTags, type TpTagReply, type TpTagRequest } from './tags';

/**
 * The tag worker (doc 09 §2, doc 20 §7): the Web Worker is mandatory, not an
 * optimisation. Parsing on the main thread froze the deck for seconds in
 * spike S2, and the music widget has to stay usable while a library scans.
 *
 * Deliberately nothing but the message loop, and excluded from coverage for it
 * — v8's browser coverage cannot see inside a worker, so everything worth
 * testing lives in `tags.ts`, which the tests run directly. One request, one
 * reply: `library.ts` sends a file at a time, so a file that hangs the parser
 * costs a timeout and a fresh worker instead of the rest of the scan.
 */

/** music-metadata's names for "this is not something I can read as audio at
 *  all", set as strings in its source, so a minifier cannot rename them. */
const NOT_AUDIO = new Set(['CouldNotDetermineFileTypeError', 'UnsupportedFileTypeError']);

self.addEventListener('message', (event: MessageEvent<TpTagRequest>) => {
	const { id, file } = event.data;
	parseTags(file).then(
		(tags) => reply({ id, tags }),
		(error: unknown) =>
			reply({
				id,
				failed: error instanceof Error && NOT_AUDIO.has(error.name) ? 'not-audio' : 'unreadable'
			})
	);
});

function reply(message: TpTagReply): void {
	self.postMessage(message);
}

export {};
