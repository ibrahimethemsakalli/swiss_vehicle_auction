import type { PrismaClient } from '../generated/prisma/client';
import { createDatabaseClient } from './database-client';

const globalDb = globalThis as unknown as { prisma7Db?: PrismaClient };
let client = globalDb.prisma7Db;
// DB-free builds/demo imports must not open a pool. The first actual DB operation
// requires an explicit URL and fails closed if it is absent.
export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    if (property === '$disconnect' && !client) return async () => {};
    if (!client) {
      client = createDatabaseClient();
      if (process.env.NODE_ENV !== 'production') globalDb.prisma7Db = client;
    }
    const value = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
