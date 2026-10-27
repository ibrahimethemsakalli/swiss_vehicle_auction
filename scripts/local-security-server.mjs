import 'dotenv/config';
if (process.env.NODE_ENV === 'production')
  throw new Error('Local security tests cannot run in production');
process.env.NODE_ENV = 'development';
process.env.LOCAL_TEST_MESSAGES = 'true';
process.env.HOST = '127.0.0.1';
const { localMessagesEnabled } = await import('../src/lib/account-challenges.ts');
if (!localMessagesEnabled()) throw new Error('Loopback origin and local database required');
console.log('LOCAL SECURITY TEST MODE: no email/SMS delivery. Inbox: .local/messages');
await import('../server.ts');
