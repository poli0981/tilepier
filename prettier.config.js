/** @type {import("prettier").Config} */
const config = {
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	printWidth: 100,
	plugins: ['prettier-plugin-svelte', 'prettier-plugin-tailwindcss'],
	overrides: [{ files: '*.svelte', options: { parser: 'svelte' } }],
	// Where the Tailwind 4 `@theme` block lives (doc 12 §2). The plugin reads it
	// to sort utility classes against the real token set.
	tailwindStylesheet: './src/app.css'
};

export default config;
