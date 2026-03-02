import crypto from "crypto";
import { ProposalSchema } from "../../lib/schemas";
import type { Proposal } from "../../lib/schemas";
import type { MCPTools } from "../../lib/mcp-tools";
import type { Contractor } from "./proposal";

function computeContentHash(lineItems: Proposal["line_items"]): string {
  return crypto.createHash("sha256").update(JSON.stringify(lineItems)).digest("hex");
}

function optLine(key: string, val?: string): string[] {
  return val !== undefined ? [`${key}: ${val}`] : [];
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
    ...optLine("stripe_payment_link", proposal.stripe_payment_link),
    ...optLine("public_token", proposal.public_token),
    `content_hash: ${contentHash}`,
    "---",
  ].join("\n");
  return `${fm}\n\n\`\`\`json\n${JSON.stringify(proposal.line_items, null, 2)}\n\`\`\`\n`;
}

function applyUpdates(proposal: Proposal, stripeUrl: string, publicToken: string): Proposal {
  return ProposalSchema.parse({
    ...proposal,
    status: "sent",
    stripe_payment_link: stripeUrl,
    public_token: publicToken,
  });
}

export async function sendProposal(
  proposal: Proposal,
  contractor: Contractor,
  tools: MCPTools
): Promise<Proposal> {
  const checkoutMode = proposal.deposit_amount !== undefined ? "deposit" : "full";
  const { url: stripeUrl } = await tools.stripe.create_checkout(proposal.id, checkoutMode);

  const publicToken = crypto.randomBytes(32).toString("hex");
  const sent = applyUpdates(proposal, stripeUrl, publicToken);

  const contentHash = computeContentHash(sent.line_items);
  const bytes = Buffer.from(serializeProposal(sent, contractor, contentHash), "utf8");

  await tools.vault.write(
    `tenants/${sent.tenant_id}/proposals/${sent.id}.md`,
    bytes,
    contentHash
  );
  await tools.vault.append_event({
    id: crypto.randomUUID(),
    tenant_id: sent.tenant_id,
    type: "proposal_sent",
    aggregate_id: sent.id,
    aggregate_type: "proposal",
    payload: {
      stripe_payment_link: stripeUrl,
      public_token: publicToken,
      checkout_mode: checkoutMode,
    },
    created_at: new Date().toISOString(),
  });
  await tools.email.send("proposal_sent", {
    proposal_id: sent.id,
    client_name: sent.client.name,
    client_email: sent.client.email,
    contractor_name: contractor.name,
    total: sent.total,
    stripe_payment_link: stripeUrl,
    public_token: publicToken,
  });
  await tools.cache.rebuild(sent.tenant_id);

  return sent;
}
