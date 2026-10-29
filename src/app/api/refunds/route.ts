import { requireUser } from '../../../lib/http';
import { rateLimit } from '../../../lib/rate-limit';
import { refundService } from '../../../lib/refund-service';
import { refundHandlers } from '../../../lib/refund-http';
export const dynamic = 'force-dynamic';
export const { GET, POST } = refundHandlers(
  {
    list: (...a) => refundService().list(...a),
    read: (...a) => refundService().read(...a),
    request: (...a) => refundService().request(...a),
    decide: (...a) => refundService().decide(...a),
    workflow: (...a) => refundService().workflow(...a),
  },
  requireUser,
  (id) => rateLimit(`refund-write:${id}`, 20, 60),
);
