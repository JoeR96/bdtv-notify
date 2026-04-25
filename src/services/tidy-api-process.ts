import { readConfig } from './config';
import { TidyApiServer } from './tidy-api';

const config = readConfig();
const server = new TidyApiServer(config);

server.start().then(() => {
  console.log(`[tidy-api] Listening on http://127.0.0.1:${config.api.port}`);
}).catch((err: unknown) => {
  console.error('[tidy-api] Failed to start:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  server.stop().then(() => process.exit(0)).catch(() => process.exit(1));
});
