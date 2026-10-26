/**
 * Code-unit order, spelled out: exactly what `Array.prototype.sort()` does with
 * no comparator, for lists whose order belongs to the data rather than to a
 * reader — ISO codes, market symbols, IANA zone names, widget ids, tags. The
 * same input sorts the same on every engine and in every locale, which
 * `localeCompare` does not promise. Names a reader scans sort with
 * `localeCompare` and their locale instead (the calendar, the quote authors).
 *
 * Named rather than left implicit because an argument-less `sort()` reads as an
 * oversight (SonarQube S2871): this says the order was chosen.
 */
export function byCodeUnit(a: string, b: string): number {
	return Number(a > b) - Number(a < b);
}
