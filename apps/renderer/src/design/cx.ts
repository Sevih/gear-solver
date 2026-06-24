/** Lightweight classnames concat — same shape as the design bundle's `cx`. */
export const cx = (...xs: Array<string | false | null | undefined>): string =>
  xs.filter(Boolean).join(" ");
