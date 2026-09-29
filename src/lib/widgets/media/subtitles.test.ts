import { describe, expect, it } from 'vitest';
import { decodeSubtitles, srtToVtt, SUBTITLES_MAX_BYTES, toVtt, trackLanguage } from './subtitles';

/** Subtitle files as bytes, the way readers' disks hold them (doc 09 §3, doc 14 §6). */

const utf8 = (text: string) => new TextEncoder().encode(text);

function utf16(text: string, littleEndian: boolean): Uint8Array {
	const bytes = new Uint8Array(text.length * 2);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < text.length; index += 1) {
		view.setUint16(index * 2, text.charCodeAt(index), littleEndian);
	}
	return bytes;
}

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('decodeSubtitles', () => {
	it('reads UTF-8, with or without its mark', () => {
		expect(decodeSubtitles(utf8('Xin chào'))).toBe('Xin chào');
		expect(decodeSubtitles(bytes(0xef, 0xbb, 0xbf, ...utf8('Xin chào')))).toBe('Xin chào');
	});

	it('reads UTF-16 either way round by its mark', () => {
		expect(decodeSubtitles(bytes(0xff, 0xfe, ...utf16('Tiếng Việt', true)))).toBe('Tiếng Việt');
		expect(decodeSubtitles(bytes(0xfe, 0xff, ...utf16('Tiếng Việt', false)))).toBe('Tiếng Việt');
	});

	it('reads what is not UTF-8 as windows-1258, composed to NFC', () => {
		// "Việt Nam đẹp" as 1258 writes it: ê (EA) + combining dot below (F2);
		// đ (F0); e + combining dot below.
		const cp1258 = bytes(
			0x56,
			0x69,
			0xea,
			0xf2,
			0x74,
			0x20,
			0x4e,
			0x61,
			0x6d,
			0x20,
			0xf0,
			0x65,
			0xf2,
			0x70
		);
		const text = decodeSubtitles(cp1258);

		expect(text).toBe('Việt Nam đẹp');
		expect(text).toBe(text.normalize('NFC'));
		expect(text).toHaveLength(12);
	});

	it('keeps a UTF-8 file UTF-8 over a stray byte, rather than garble every accent', () => {
		const mostly = bytes(
			...utf8('Chào buổi sáng, thế giới — những dòng phụ đề '),
			0x92,
			...utf8('ổn')
		);

		const text = decodeSubtitles(mostly);

		expect(text.startsWith('Chào buổi sáng, thế giới')).toBe(true);
		expect(text.endsWith('�ổn')).toBe(true);
	});

	it('composes decomposed UTF-8, and ends every line with \\n alone', () => {
		expect(decodeSubtitles(utf8('Việt\r\nNam\rĐẹp\n'))).toBe('Việt\nNam\nĐẹp\n');
	});
});

describe('srtToVtt', () => {
	it('turns cues into WebVTT, numbers and blank lines gone', () => {
		const srt =
			'1\n00:00:01,000 --> 00:00:02,500\nMột\n\n2\n00:00:03,000 --> 00:00:04,000\nHai\nBa\n';

		expect(srtToVtt(srt)).toBe(
			'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nMột\n\n00:00:03.000 --> 00:00:04.000\nHai\nBa\n'
		);
	});

	it('keeps b, i and u, and escapes everything else that could read as markup', () => {
		const srt =
			'1\n00:00:01,000 --> 00:00:02,000\n<I>nghiêng</I> & <b>đậm</b> <script>x</script> a --> b\n';

		expect(srtToVtt(srt)).toContain(
			'<i>nghiêng</i> &amp; <b>đậm</b> &lt;script&gt;x&lt;/script&gt; a --&gt; b'
		);
	});

	it('drops font tags but keeps their words, and drops override blocks', () => {
		const srt =
			'1\n00:00:01,000 --> 00:00:02,000\n{\\an8}<font color="yellow">Vàng</font> {\\i1}thôi\n';

		expect(srtToVtt(srt)).toContain('\nVàng thôi\n');
	});

	it('reads one-digit hours, short milliseconds, positions, and seconds past 59', () => {
		const srt = '1\n0:00:04,5 --> 00:00:75,25 X1:100 X2:500 Y1:10 Y2:50\nMột\n';

		expect(srtToVtt(srt)).toContain('00:00:04.500 --> 00:01:15.250\nMột');
	});

	it('keeps a cue together across a blank line inside it', () => {
		const srt =
			'7\n00:00:08,500 --> 00:00:13,000\nDòng một\n\nsau một dòng trống\n\n8\n00:00:14,000 --> 00:00:15,000\nTiếp\n';

		expect(srtToVtt(srt)).toContain(
			'00:00:08.500 --> 00:00:13.000\nDòng một\nsau một dòng trống\n\n'
		);
	});

	it('keeps a line that is only a number when no timing follows it', () => {
		const srt = '1\n00:00:01,000 --> 00:00:02,000\nCâu trả lời là\n42\n';

		expect(srtToVtt(srt)).toContain('Câu trả lời là\n42');
	});

	it('is nothing for a file with no cue to show', () => {
		expect(srtToVtt('không phải phụ đề\n')).toBeNull();
		expect(srtToVtt('1\n00:00:02,000 --> 00:00:01,000\nNgược\n')).toBeNull();
		expect(srtToVtt('1\n00:00:01,000 --> 00:00:02,000\n\n')).toBeNull();
	});
});

describe('toVtt', () => {
	it('takes WebVTT as it is, and converts SubRip', () => {
		const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<b>Đậm</b>\n';

		expect(toVtt(vtt)).toBe(vtt);
		expect(toVtt('1\n00:00:01,000 --> 00:00:02,000\nMột\n')).toMatch(/^WEBVTT\n/);
		expect(toVtt('WEBVTT\n\nNOTE nothing to show\n')).toBeNull();
		expect(toVtt('WEBVTTX\n')).toBeNull();
	});
});

describe('trackLanguage', () => {
	it('reads the language before the extension, or says it is unknown', () => {
		expect(trackLanguage('Phim.vi.srt')).toBe('vi');
		expect(trackLanguage('Film.en-US.vtt')).toBe('en-US');
		expect(trackLanguage('film.pt_br.srt')).toBe('pt-BR');
		expect(trackLanguage('Phim.srt')).toBe('und');
		expect(trackLanguage('Phim.Part.2.srt')).toBe('und');
	});
});

describe('SUBTITLES_MAX_BYTES', () => {
	it('is far above any subtitle file and far below any film', () => {
		expect(SUBTITLES_MAX_BYTES).toBe(2 * 1024 * 1024);
	});
});
