/**
 * No hydration here: the page is prerendered HTML and stays that way, so the
 * licence appendix — about 150 KB of text — never becomes JavaScript (doc 16
 * §5). Nothing on the page needs a script; the locale toggle is boot.js and
 * CSS, as on every prose page.
 */
export const csr = false;
