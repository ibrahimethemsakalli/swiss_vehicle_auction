import next from 'next';
import { createServer } from 'node:http';
// Dedicated HTTP test host: no auction/payment workers or external providers.
const app = next({ dev: true, conf: { distDir: '.local/next-media-test' } });
await app.prepare();
createServer(app.getRequestHandler()).listen(3102, '127.0.0.1', () => process.send?.('ready'));
