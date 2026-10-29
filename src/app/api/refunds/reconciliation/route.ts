import { requireUser } from '../../../../lib/http';
import { refundPool } from '../../../../lib/refund-service';
import { refundReconciliation } from '../../../../lib/refund-reconciliation';
import { reconciliationHandlers } from '../../../../lib/refund-reconciliation-http';
export const dynamic = 'force-dynamic';
export const { GET, POST } = reconciliationHandlers(
  (id, page) => refundReconciliation(refundPool(), id, page),
  requireUser,
);
