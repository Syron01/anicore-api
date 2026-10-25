#!/usr/bin/env node
/**
 * Overnight sync watcher: waits for the ANIME mirror build to finish, then
 * starts the MANGA build; keeps an eye on both and restarts either if it
 * stops before the cursor reaches the final year. Logs to watcher.log.
 */
import { db } from './db.js';
import { startSync } from './sync.js';

const FINAL_YEAR = new Date().getFullYear() + 1;
const doneCursor = (kind) => kind === 'ANIME' ? 20150000 : 20200000; // resume points
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stateOf = (kind) => db.prepare('SELECT * FROM sync_state WHERE kind = ?').get(kind);
const setCursor = (kind, id) =>
  db.prepare('UPDATE sync_state SET running = 0, last_id = ? WHERE kind = ?').run(id, kind);

console.log('[watcher] started', new Date().toISOString());
let phase = 'anime';

for (;;) {
  const a = stateOf('ANIME');
  const m = stateOf('MANGA');

  if (phase === 'anime' && a?.running === 0) {
    const year = Math.floor(a.last_id / 10000);
    if (year >= FINAL_YEAR) {
      console.log(`[watcher] anime mirror complete (${a.total} processed)`);
      phase = 'manga';
    } else {
      console.log(`[watcher] anime stopped at year ${year}, resuming...`);
      startSync('ANIME');
    }
  }

  if (phase === 'manga') {
    if (m?.running === 0) {
      const year = Math.floor(m.last_id / 10000);
      if (year >= FINAL_YEAR) {
        console.log(`[watcher] manga mirror complete (${m.total} processed) — ALL DONE`);
        break;
      }
      console.log(`[watcher] manga stopped at year ${year}, resuming...`);
      startSync('MANGA');
    }
  }

  await sleep(60_000);
}
console.log('[watcher] exiting', new Date().toISOString());
process.exit(0);
