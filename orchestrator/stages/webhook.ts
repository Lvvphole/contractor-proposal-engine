import { z } from "zod";
import { ProposalSchema } from "../../lib/schemas";
import type { Proposal } from "../../lib/schemas";
import type { MCPTools } from "../../lib/mcp-tools";
import type { Contractor } from "./proposal";
import { recordPayment } from "./payment";

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

const StripeSessionDataSchema = z.object({
  id: z.string(),
  payment_intent: z.union([z.string(), z.null()]).optional(),
  amount_total: z.number(),
  currency: z.string(),
  metadata: z.object({
    proposal_id: z.string().uuid(),
    tenant_id: z.string().uuid(),
    mode: z.enum(["deposit", "full"]),
  }),
});

const StripeEventSchema = z.object({
  type: z.string(),
  data: z.object({ object: StripeSessionDataSchema }),
});

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("Invalid vault document: missing frontmatter");
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(": ");
    if (idx === -1) continue;
    result[line.slice(0, idx)] = line.slice(idx + 2);
  }
  return result;
}

function parseVaultDocument(bytes: Buffer): { proposal: Proposal; contractor: Contractor } {
  const content = bytes.toString("utf8");
  const fm = parseFrontmatter(content);
  const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
  if (!jsonMatch) throw new Error("Invalid vault document: missing line items");

  const proposal = ProposalSchema.parse({
    id: fm["id"],
    tenant_id: fm["tenant_id"],
    quote_id: fm["quote_id"],
    created_at: fm["created_at"],
    status: fm["status"],
    client: {
      name: fm["client_name"],
      email: fm["client_email"],
      ...(fm["client_phone"] ? { phone: fm["client_phone"] } : {}),
      ...(fm["client_address"] ? { address: fm["client_address"] } : {}),
    },
    line_items: JSON.parse(jsonMatch[1]),
    subtotal: parseFloat(fm["subtotal"]),
    margin_total: parseFloat(fm["margin_total"]),
    total: parseFloat(fm["total"]),
    ...(fm["deposit_pct"] ? { deposit_pct: parseFloat(fm["deposit_pct"]) } : {}),
    ...(fm["deposit_amount"] ? { deposit_amount: parseFloat(fm["deposit_amount"]) } : {}),
    ...(fm["stripe_payment_link"] ? { stripe_payment_link: fm["stripe_payment_link"] } : {}),
    ...(fm["public_token"] ? { public_token: fm["public_token"] } : {}),
  });

  const contractor: Contractor = {
    name: fm["contractor_name"],
    ...(fm["contractor_logo_url"] ? { logo_url: fm["contractor_logo_url"] } : {}),
  };

  return { proposal, contractor };
}

async function handleCheckoutCompleted(
  session: z.infer<typeof StripeSessionDataSchema>,
  tools: MCPTools
): Promise<void> {
  const { proposal_id, tenant_id, mode } = session.metadata;
  const { data } = await tools.vault.read(`tenants/${tenant_id}/proposals/${proposal_id}.md`);
  const { proposal, contractor } = parseVaultDocument(data);

  const targetStatus = mode === "full" ? "paid" : "accepted";
  if (proposal.status === targetStatus || proposal.status === "paid") return;

  await recordPayment(proposal, {
    stripe_session_id: session.id,
    stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : undefined,
    amount: session.amount_total / 100,
    currency: session.currency,
    mode,
  }, contractor, tools);
}

export async function handleStripeWebhook(
  rawPayload: unknown,
  signature: string,
  tools: MCPTools
): Promise<void> {
  const { valid } = await tools.webhook.verify("stripe", rawPayload, signature);
  if (!valid) throw new WebhookVerificationError("Invalid Stripe webhook signature");

  const parsed = StripeEventSchema.safeParse(rawPayload);
  if (!parsed.success) return;

  if (parsed.data.type === "checkout.session.completed") {
    await handleCheckoutCompleted(parsed.data.data.object, tools);
  }
}
