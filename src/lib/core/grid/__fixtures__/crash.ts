/** Whether `TpThrowingWidget` throws on its next render; the test flips it.
 *  Here rather than in the component's module script, whose named exports
 *  plain `tsc` cannot see. */
export const crash = { on: true };
