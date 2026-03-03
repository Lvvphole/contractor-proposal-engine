import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase';
import { createTools } from '@/lib/tools';
import { updateMargins } from '@/orchestrator/stages/update-margins';

type Params = { params: { id: string } };

export async function GET(_req: Request, { params }: Params) {
  const { userId, sessionClaims } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenantId = (sessionClaims as Record<string, unknown> | null)?.tenant_id as string | undefined;
  if (!tenantId) return NextResponse.json({ error: 'No tenant_id in JWT' }, { status: 403 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('proposals_cache')
    .select(`
      proposal_id, quote_id, status,
      contractor_name, project_name,
      materials_total, tax, proposal_total,
      deposit_percent, deposit_amount,
      proposal_items_cache (
        line_number, description, category,
        cost, margin_percent, sell_price
      )
    `)
    .eq('proposal_id', params.id)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(data);
}

const PatchBodySchema = z.object({
  default_margin_percent: z.number().min(0).max(100),
  category_overrides: z.record(z.number().min(0).max(100)).default({}),
  deposit_percent: z.number().min(0).max(100),
  tax_rate_override: z.number().min(0).optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  const { userId, sessionClaims } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenantId = (sessionClaims as Record<string, unknown> | null)?.tenant_id as string | undefined;
  if (!tenantId) return NextResponse.json({ error: 'No tenant_id in JWT' }, { status: 403 });

  const parsed = PatchBodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 422 });
  }

  const supabase = createServerClient();

  // Verify ownership before touching vault
  const { data: existing } = await supabase
    .from('proposals_cache')
    .select('proposal_id')
    .eq('proposal_id', params.id)
    .eq('tenant_id', tenantId)
    .single();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const updated = await updateMargins(params.id, tenantId, parsed.data, createTools(supabase));
    return NextResponse.json({ proposal_id: updated.id, total: updated.total, status: updated.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
