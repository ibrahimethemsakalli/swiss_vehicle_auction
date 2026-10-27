import next from 'next';
import { createServer } from 'node:http';
const app = next({ dev: true, conf: { distDir: '.local/next-legal-test' } });
await app.prepare();
createServer(app.getRequestHandler()).listen(3103, '127.0.0.1', () => process.send?.('ready'));
