/**
 * Spike S1 harness (doc 22). gridstack needs a real DOM, so no SSR — and this
 * page is a throwaway diagnostic, deliberately outside the (app) group so the
 * legal gate does not stand between the harness and the measurement.
 */
export const ssr = false;
export const prerender = false;
