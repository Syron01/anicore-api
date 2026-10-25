/**
 * Interactive-request priority gate.
 * Bulk sync checks `waiters` between pages and yields while a user-facing
 * request needs the provider, so clicks never queue behind the mirror build.
 */
export const priority = { waiters: 0 };
