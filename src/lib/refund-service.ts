import { Pool } from 'pg';
import { databaseOptions } from './database-client';
import { RefundDecisions } from './refund-decisions';
const shared = globalThis as unknown as { refundDecisionPool?: Pool };
export function refundPool() {
  if (!shared.refundDecisionPool) {
    const { pool, schema } = databaseOptions(process.env.DATABASE_URL);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw Error('INVALID_SCHEMA');
    shared.refundDecisionPool = new Pool({ ...pool, options: `-c search_path=${schema}` });
  }
  return shared.refundDecisionPool;
}

export function refundService() {
  return new RefundDecisions(refundPool());
}
