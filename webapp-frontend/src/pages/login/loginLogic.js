// Sign-in page helpers: where to return after signing in, and why the person was sent here.

/** The page to return to: only same-site paths, so a crafted link cannot redirect elsewhere. */
export const safeReturnTo = (from) =>
  (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/');

/** A short explanation when the person arrived by scanning a desk's QR code (/checkin/<seat id>). */
export const loginReason = (returnTo) =>
  (/^\/checkin\/[^/]+/.test(returnTo) ? 'Sign in to check in at this desk. You will go straight back to it.' : null);
