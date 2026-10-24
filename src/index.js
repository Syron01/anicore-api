import { config } from './config.js';
import { createApp } from './server.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`AniCore API listening on http://localhost:${config.port}`);
  console.log(`Docs: http://localhost:${config.port}/docs`);
});
