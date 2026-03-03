import crypto from 'crypto';
import { ProposalSchema } from '../../lib/schemas';
import type { Proposal } from '../../lib/schemas';
import type { MCPTools } from '../../lib/mcp-tools';
import { parseProposalDocument, parseQuoteDocument } from '../../lib/vault-parser';
import type { Contractor } from '../../lib/vault-parser';
import { computePricing } from '../pricing';
import type { PricingConfig, PricingResult } from '../pricing';

function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

function buildUpdated(existing: Proposal, pricing: PricingResult, config: PricingConfig): Proposal {
  const margin_total = round2(pricing.line_items.reduce((a, li) => a + (li.price - li.cost), 0));
  return ProposalSchema.parse({
    ...existing,
    line_items: pricing.line_items,
    subtotal: pricing.materials_total,
    margin_total,
    total: pricing.proposal_total,
    deposit_pct: config.deposit_percent / 100,
    deposit_amount: pricing.deposit_amount,
  });
}

function optLine(key: string, val?: string): string[] {
  return val !== undefined ? [`${key}: ${val}`] : [];
}

function serialize(proposal: Proposal, contractor: Contractor, contentHash: string): string {
  const fm = [
    '---',
    `id: ${proposal.id}`,
    `tenant_id: ${proposal.tenant_id}`,
    `quote_id: ${proposal.quote_id}`,
    `created_at: ${proposal.created_at}`,
    `status: ${proposal.status}`,
    `contractor_name: ${contractor.name}`,
    ...optLine('contractor_logo_url', contractor.logo_url),
    `client_name: ${proposal.client.name}`,
    `client_email: ${proposal.client.email}`,
    ...optLine('client_phone', proposal.client.phone),
    ...optLine('client_address', proposal.client.address),
    `subtotal: ${proposal.subtotal}`,
    `margin_total: ${proposal.margin_total}`,
    `total: ${proposal.total}`,
    ...optLine('deposit_pct', proposal.deposit_pct?.toString()),
    ...optLine('deposit_amount', proposal.deposit_amount?.toString()),
    ...optLine('stripe_payment_link', proposal.stripe_payment_link),
    ...optLine('public_token', proposal.public_token),
    `content_hash: ${contentHash}`,
    '---',
  ].join('\n');
  return `${fm}\n\n\`\`\`json\n${JSON.stringify(proposal.line_items, null, 2)}\n\`\`\`\n`;
}

export async function updateMargins(
  proposalId: string,
  tenantId: string,
  config: PricingConfig,
  tools: MCPTools
): Promise<Proposal> {
  const { data: propBytes } = await tools.vault.read(`tenants/${tenantId}/proposals/${proposalId}.md`);
  const { proposal, contractor } = parseProposalDocument(propBytes);

  const { data: quoteBytes } = await tools.vault.read(`tenants/${tenantId}/quotes/${proposal.quote_id}.md`);
  const quote = parseQuoteDocument(quoteBytes);

  const pricing = computePricing(quote, config);
  const updated = buildUpdated(proposal, pricing, config);

  const contentHash = crypto.createHash('sha256').update(JSON.stringify(updated.line_items)).digest('hex');
  const bytes = Buffer.from(serialize(updated, contractor, contentHash), 'utf8');

  await tools.vault.write(`tenants/${tenantId}/proposals/${proposalId}.md`, bytes, contentHash);
  await tools.vault.append_event({
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    type: 'proposal_margins_updated',
    aggregate_id: proposalId,
    aggregate_type: 'proposal',
    payload: { default_margin_percent: config.default_margin_percent, new_total: updated.total },
    created_at: new Date().toISOString(),
  });
  await tools.cache.rebuild(tenantId);

  return updated;
}
