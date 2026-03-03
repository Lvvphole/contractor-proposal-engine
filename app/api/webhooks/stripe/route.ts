import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { handleStripeWebhook, WebhookVerificationError } from '@/orchestrator/stages/webhook';
import { createServerClient } from '@/lib/supabase';
import { createTools } from '@/lib/tools';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const sig = req.headers.get('stripe-signature') ?? '';

  const supabase = createServerClient();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  // Override webhook.verify to use the raw body bytes for signature verification
  const tools = {
    ...createTools(supabase),
    webhook: {
      async verify(_provider: string, _payload: unknown, signature: string) {
        const event = await stripe.webhooks.constructEventAsync(
          rawBody,
          signature,
          process.env.STRIPE_WEBHOOK_SECRET!
        );
        return { valid: true, event_type: event.type };
      },
    },
  };

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    await handleStripeWebhook(parsedBody, sig, tools);
    return NextResponse.json({ received: true });
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }
    console.error('[webhook/stripe] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
