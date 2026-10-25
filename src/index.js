import { config } from './config.js';
import { createApp } from './server.js';
import { db } from './db.js';
import { startSync } from './sync.js';

const app = createApp();

app.listen(config.port, '0.0.0.0', () => {
  console.log(`AniCore API listening on http://localhost:${config.port} (LAN: 0.0.0.0)`);
  console.log(`Docs: http://localhost:${config.port}/docs`);

  // auto-resume interrupted mirror builds (stale running flag from a restart)
  const stale = db.prepare("SELECT kind FROM sync_state WHERE running = 1").all();
  for (const { kind } of stale) {
    db.prepare("UPDATE sync_state SET running = 0 WHERE kind = ?").run(kind);
    console.log(`[boot] resuming ${kind} mirror sync...`);
    startSync(kind);
  }
});
