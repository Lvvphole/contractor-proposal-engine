import crypto from "crypto";
import { ProposalSchema } from "../../lib/schemas";
import type { Quote, Proposal } from "../../lib/schemas";
import type { MCPTools } from "../../lib/mcp-tools";
import { computePricing } from "../pricing";
import type { PricingConfig, PricingResult } from "../pricing";

export type Contractor = {
  name: string;
  logo_url?: string;
};

function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

function computeContentHash(lineItems: Proposal["line_items"]): string {
  return crypto.createHash("sha256").update(JSON.stringify(lineItems)).digest("hex");
}

function optLine(key: string, val?: string): string[] {
  return val !== undefined ? [`${key}: ${val}`] : [];
}

function buildProposal(
  quote: Quote,
  pricing: PricingResult,
  config: PricingConfig,
  client: Proposal["client"]
): Proposal {
  const margin_total = round2(
    pricing.line_items.reduce((acc, li) => acc + (li.price - li.cost), 0)
  );
  return ProposalSchema.parse({
    id: crypto.randomUUID(),
    tenant_id: quote.tenant_id,
    quote_id: quote.id,
    created_at: new Date().toISOString(),
    status: "draft",
    client,
    line_items: pricing.line_items,
    subtotal: pricing.materials_total,
    margin_total,
    total: pricing.proposal_total,
    deposit_pct: config.deposit_percent / 100,
    deposit_amount: pricing.deposit_amount,
  });
}

function serializeProposal(proposal: Proposal, contractor: Contractor, contentHash: string): string {
  const fm = [
    "---",
    `id: ${proposal.id}`,
    `tenant_id: ${proposal.tenant_id}`,
    `quote_id: ${proposal.quote_id}`,
    `created_at: ${proposal.created_at}`,
    `status: ${proposal.status}`,
    `contractor_name: ${contractor.name}`,
    ...optLine("contractor_logo_url", contractor.logo_url),
    `client_name: ${proposal.client.name}`,
    `client_email: ${proposal.client.email}`,
    ...optLine("client_phone", proposal.client.phone),
    ...optLine("client_address", proposal.client.address),
    `subtotal: ${proposal.subtotal}`,
    `margin_total: ${proposal.margin_total}`,
    `total: ${proposal.total}`,
    ...optLine("deposit_pct", proposal.deposit_pct?.toString()),
    ...optLine("deposit_amount", proposal.deposit_amount?.toString()),
    `content_hash: ${contentHash}`,
    "---",
  ].join("\n");
  return `${fm}\n\n\`\`\`json\n${JSON.stringify(proposal.line_items, null, 2)}\n\`\`\`\n`;
}

export async function createProposal(
  quote: Quote,
  config: PricingConfig,
  client: Proposal["client"],
  contractor: Contractor,
  tools: MCPTools
): Promise<Proposal> {
  const pricing = computePricing(quote, config);
  const proposal = buildProposal(quote, pricing, config, client);

  const contentHash = computeContentHash(proposal.line_items);
  const bytes = Buffer.from(serializeProposal(proposal, contractor, contentHash), "utf8");

  await tools.vault.write(
    `tenants/${proposal.tenant_id}/proposals/${proposal.id}.md`,
    bytes,
    contentHash
  );
  await tools.vault.append_event({
    id: crypto.randomUUID(),
    tenant_id: proposal.tenant_id,
    type: "proposal_created",
    aggregate_id: proposal.id,
    aggregate_type: "proposal",
    payload: { quote_id: quote.id, content_hash: contentHash, total: proposal.total },
    created_at: new Date().toISOString(),
  });
  await tools.cache.rebuild(proposal.tenant_id);

  return proposal;
}
