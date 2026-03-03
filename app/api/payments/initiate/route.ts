import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase';
import { createTools } from '@/lib/tools';

const BodySchema = z.object({
  proposal_id: z.string().uuid(),
  mode: z.enum(['deposit', 'full']),
});

export async function POST(req: Request) {
  const { userId, sessionClaims } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenantId = (sessionClaims as Record<string, unknown> | null)?.tenant_id as string | undefined;
  if (!tenantId) return NextResponse.json({ error: 'No tenant_id in JWT' }, { status: 403 });

  const parsed = BodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 422 });
  }

  const { proposal_id, mode } = parsed.data;
  const supabase = createServerClient();

  // Verify proposal belongs to this tenant
  const { data: proposal } = await supabase
    .from('proposals_cache')
    .select('proposal_id')
    .eq('proposal_id', proposal_id)
    .eq('tenant_id', tenantId)
    .single();
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const { url } = await createTools(supabase).stripe.create_checkout(proposal_id, mode);
    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
