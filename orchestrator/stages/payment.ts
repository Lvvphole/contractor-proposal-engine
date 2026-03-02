import crypto from "crypto";
import { PaymentSchema, ProposalSchema } from "../../lib/schemas";
import type { Payment, Proposal } from "../../lib/schemas";
import type { MCPTools } from "../../lib/mcp-tools";
import type { Contractor } from "./proposal";

export type StripePaymentEvent = {
  stripe_session_id: string;
  stripe_payment_intent_id?: string;
  amount: number;
  currency: string;
  mode: "deposit" | "full";
};

function sha256(data: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function optLine(key: string, val?: string): string[] {
  return val !== undefined ? [`${key}: ${val}`] : [];
}

function buildPayment(proposal: Proposal, event: StripePaymentEvent): Payment {
  const now = new Date().toISOString();
  return PaymentSchema.parse({
    id: crypto.randomUUID(),
    tenant_id: proposal.tenant_id,
    proposal_id: proposal.id,
    mode: event.mode,
    amount: event.amount,
    currency: event.currency,
    status: "succeeded",
    stripe_session_id: event.stripe_session_id,
    stripe_payment_intent_id: event.stripe_payment_intent_id,
    created_at: now,
    completed_at: now,
  });
}

function serializePayment(payment: Payment, contentHash: string): string {
  return [
    "---",
    `id: ${payment.id}`,
    `tenant_id: ${payment.tenant_id}`,
    `proposal_id: ${payment.proposal_id}`,
    `mode: ${payment.mode}`,
    `amount: ${payment.amount}`,
    `currency: ${payment.currency}`,
    `status: ${payment.status}`,
    `stripe_session_id: ${payment.stripe_session_id}`,
    ...optLine("stripe_payment_intent_id", payment.stripe_payment_intent_id),
    `created_at: ${payment.created_at}`,
    ...optLine("completed_at", payment.completed_at),
    `content_hash: ${contentHash}`,
    "---",
  ].join("\n") + "\n";
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

async function persistPayment(
  payment: Payment,
  proposalId: string,
  event: StripePaymentEvent,
  tools: MCPTools
): Promise<void> {
  const contentHash = sha256({ stripe_session_id: event.stripe_session_id, amount: event.amount, currency: event.currency, mode: event.mode });
  const bytes = Buffer.from(serializePayment(payment, contentHash), "utf8");
  await tools.vault.write(`tenants/${payment.tenant_id}/payments/${payment.id}.md`, bytes, contentHash);
  await tools.vault.append_event({
    id: crypto.randomUUID(),
    tenant_id: payment.tenant_id,
    type: "payment_received",
    aggregate_id: payment.id,
    aggregate_type: "payment",
    payload: { proposal_id: proposalId, mode: event.mode, amount: event.amount, currency: event.currency, stripe_session_id: event.stripe_session_id },
    created_at: new Date().toISOString(),
  });
}

async function persistProposal(
  proposal: Proposal,
  paymentId: string,
  event: StripePaymentEvent,
  contractor: Contractor,
  tools: MCPTools
): Promise<void> {
  const contentHash = sha256(proposal.line_items);
  const bytes = Buffer.from(serializeProposal(proposal, contractor, contentHash), "utf8");
  await tools.vault.write(`tenants/${proposal.tenant_id}/proposals/${proposal.id}.md`, bytes, contentHash);
  await tools.vault.append_event({
    id: crypto.randomUUID(),
    tenant_id: proposal.tenant_id,
    type: event.mode === "full" ? "proposal_paid" : "proposal_deposit_received",
    aggregate_id: proposal.id,
    aggregate_type: "proposal",
    payload: { payment_id: paymentId, amount: event.amount, currency: event.currency },
    created_at: new Date().toISOString(),
  });
}

export async function recordPayment(
  proposal: Proposal,
  event: StripePaymentEvent,
  contractor: Contractor,
  tools: MCPTools
): Promise<{ payment: Payment; proposal: Proposal }> {
  const payment = buildPayment(proposal, event);
  const updated = ProposalSchema.parse({
    ...proposal,
    status: event.mode === "full" ? "paid" : "accepted",
  });

  await persistPayment(payment, proposal.id, event, tools);
  await persistProposal(updated, payment.id, event, contractor, tools);
  await tools.cache.rebuild(payment.tenant_id);

  return { payment, proposal: updated };
}
