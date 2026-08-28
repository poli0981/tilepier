/**
 * QR encoding for doc 07 §7's first tab.
 *
 * `qrcode-generator` does the matrix; this module owns the two things around it
 * that are ours to get right.
 *
 * **The text is encoded as UTF-8, which is not the library's default.** Its
 * `stringToBytes` is `charCodeAt(i) & 0xff` — Latin-1 truncation. `à` survives
 * that by luck and `ộ` does not: U+1ED9 truncates to 0xD9, and the scanned
 * result is a different character. For an app whose first locale is Vietnamese
 * that is not an edge case, it is most inputs. The override goes through
 * `TextEncoder`, which is the platform's own UTF-8 and is exact, rather than
 * the library's optional hand-rolled `qrcode_UTF8` module.
 *
 * That split is also what `qr.test.ts` can honestly assert: the byte encoding
 * is ours and is checked against `TextEncoder`; the matrix is the library's, is
 * fifteen years old and widely used, and cannot be verified here without a
 * decoder — so what is checked of it is shape and determinism, not pixels.
 *
 * The library is loaded through `await import()` so a user who never opens the
 * QR tab never pays for it (doc 20 §7).
 */

export type TpQrEcc = 'L' | 'M' | 'Q' | 'H';

/** doc 07 §7's error-correction options, weakest first. */
export const QR_ECC_LEVELS: readonly TpQrEcc[] = ['L', 'M', 'Q', 'H'];

export function isQrEcc(value: unknown): value is TpQrEcc {
	return typeof value === 'string' && (QR_ECC_LEVELS as readonly string[]).includes(value);
}

/**
 * A cap before the encoder is asked, so a paste of a whole document produces a
 * sentence rather than an exception. Version 40 at level L holds 2953 bytes;
 * this is well inside that, and a QR that dense is unscannable from a screen
 * anyway.
 */
export const QR_MAX_CHARS = 1000;

export interface TpQrMatrix {
	/** Modules per side, 21 for version 1 and 177 for version 40. */
	size: number;
	/** `modules[row][col]`, true where the module is dark. */
	modules: readonly (readonly boolean[])[];
}

type QrFactory = typeof import('qrcode-generator');

let factory: QrFactory | null = null;

async function loadFactory(): Promise<QrFactory> {
	if (factory !== null) return factory;

	const module = await import('qrcode-generator');
	const qrcode = module.default;
	// Applied once, to the module singleton, before anything encodes. See the
	// header: the default is Latin-1 truncation.
	qrcode.stringToBytes = (value: string): number[] => [...new TextEncoder().encode(value)];
	factory = qrcode;
	return qrcode;
}

/**
 * `null` for input the encoder cannot represent — empty, over the cap, or
 * beyond version 40 even at level L. The caller renders doc 06 §3's `empty` or
 * `error` from that rather than catching an exception.
 */
export async function qrMatrix(text: string, ecc: TpQrEcc): Promise<TpQrMatrix | null> {
	if (text === '' || text.length > QR_MAX_CHARS) return null;

	const qrcode = await loadFactory();
	try {
		// Type number 0 asks the library to pick the smallest version that fits.
		const code = qrcode(0, ecc);
		code.addData(text);
		code.make();

		const size = code.getModuleCount();
		const modules = Array.from({ length: size }, (_row, y) =>
			Array.from({ length: size }, (_col, x) => code.isDark(y, x))
		);
		return { size, modules };
	} catch {
		// The library throws for data that does not fit any version. That is a
		// legitimate answer to a legitimate question, not a fault.
		return null;
	}
}

export interface TpQrDrawOptions {
	/** Device pixels per module. */
	scale: number;
	/** Quiet zone in modules. The spec asks for four; less is not scannable. */
	margin: number;
	dark: string;
	light: string;
}

export const QR_QUIET_ZONE = 4;

/**
 * Paints a matrix onto a canvas, sizing the canvas to fit.
 *
 * Here rather than in the component because it is arithmetic with a canvas
 * attached, and because the download path and the on-screen preview must not
 * be allowed to drift into drawing two different images.
 */
export function drawQr(
	canvas: HTMLCanvasElement,
	matrix: TpQrMatrix,
	options: TpQrDrawOptions
): void {
	const { scale, margin, dark, light } = options;
	const side = (matrix.size + margin * 2) * scale;

	canvas.width = side;
	canvas.height = side;

	const ctx = canvas.getContext('2d');
	if (ctx === null) return;

	// The quiet zone is part of the symbol, not padding around it: a QR drawn
	// edge to edge on a dark page does not scan.
	ctx.fillStyle = light;
	ctx.fillRect(0, 0, side, side);

	ctx.fillStyle = dark;
	for (let y = 0; y < matrix.size; y++) {
		const row = matrix.modules[y];
		if (row === undefined) continue;
		for (let x = 0; x < matrix.size; x++) {
			if (row[x] !== true) continue;
			ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
		}
	}
}
