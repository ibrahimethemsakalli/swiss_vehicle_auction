import { stripeClient, handlePaymentEvent } from '../../../../lib/payments';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) return new Response('Unavailable', { status: 503 });
  let event;
  try {
    event = stripeClient().webhooks.constructEvent(
      await request.text(),
      request.headers.get('stripe-signature') ?? '',
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }
  try {
    await handlePaymentEvent(event);
    return Response.json({ received: true });
  } catch {
    return new Response('Retry delivery', { status: 500 });
  }
}
