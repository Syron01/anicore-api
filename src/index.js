import { config } from './config.js';
import { createApp } from './server.js';
import { db } from './db.js';
import { startSync } from './sync.js';

const app = createApp();

const start = (port) =>
  app.listen(port, '0.0.0.0', () => {
    console.log(`AniCore API listening on http://localhost:${port} (LAN: 0.0.0.0)`);
  }).on('error', (e) => console.log(`[boot] port ${port} busy: ${e.code}`));

start(config.port);
// convenience mirror so :3000 always works too
if (config.port !== 3000) start(3000);

// auto-resume interrupted mirror builds (stale running flag from a restart)
const stale = db.prepare('SELECT kind FROM sync_state WHERE running = 1').all();
for (const { kind } of stale) {
  db.prepare('UPDATE sync_state SET running = 0 WHERE kind = ?').run(kind);
  console.log(`[boot] resuming ${kind} mirror sync...`);
  startSync(kind);
}
