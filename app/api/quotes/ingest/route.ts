import crypto from 'crypto';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { createTools } from '@/lib/tools';
import { runPipeline } from '@/orchestrator/pipeline';
import type { PricingConfig } from '@/orchestrator/pricing';

export async function POST(req: Request) {
  const { userId, sessionClaims } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenantId = (sessionClaims as Record<string, unknown> | null)?.tenant_id as string | undefined;
  if (!tenantId) return NextResponse.json({ error: 'No tenant_id in JWT' }, { status: 403 });

  const form = await req.formData();
  const file = form.get('file');
  const recipientEmail = form.get('recipient_email');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 });
  }
  if (typeof recipientEmail !== 'string') {
    return NextResponse.json({ error: 'recipient_email required' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('name, logo_url, default_margin, deposit_percent')
    .eq('tenant_id', tenantId)
    .single();
  if (tenantErr || !tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const tools = createTools(supabase);

  // Write PDF to vault inbox
  const inboxPath = `tenants/${tenantId}/inbox/${crypto.randomUUID()}.pdf`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  await tools.vault.write(inboxPath, bytes, sha256);

  const pricingConfig: PricingConfig = {
    default_margin_percent: tenant.default_margin,
    category_overrides: {},
    deposit_percent: tenant.deposit_percent,
  };

  try {
    const result = await runPipeline(tools, {
      tenant_id: tenantId,
      pdf_vault_path: inboxPath,
      pricing_config: pricingConfig,
      contractor: { name: tenant.name, logo_url: tenant.logo_url ?? undefined },
      recipient_email: recipientEmail,
      proposal_base_url: `${process.env.NEXT_PUBLIC_APP_URL}/p`,
    });
    return NextResponse.json({
      quote_id: result.quote.id,
      proposal_id: result.proposal.id,
      proposal_url: result.proposal_url,
    });
  } catch (err) {
    console.error('[ingest] pipeline error:', err);
    const message = err instanceof Error ? err.message : 'Pipeline failed';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
