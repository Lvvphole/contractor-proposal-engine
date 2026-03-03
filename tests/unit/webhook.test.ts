import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { createMockTools } from "../../lib/mcp-tools";
import type { MCPTools } from "../../lib/mcp-tools";
import { handleStripeWebhook, WebhookVerificationError } from "../../orchestrator/stages/webhook";
import type { Proposal } from "../../lib/schemas";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const PROPOSAL_ID = "00000000-0000-0000-0000-000000000002";
const QUOTE_ID = "00000000-0000-0000-0000-000000000003";

const SENT_PROPOSAL: Proposal = {
  id: PROPOSAL_ID,
  tenant_id: TENANT_ID,
  quote_id: QUOTE_ID,
  created_at: "2024-01-01T00:00:00.000Z",
  status: "sent",
  client: { name: "Jane Smith", email: "jane@example.com" },
  line_items: [
    { description: "2x4 Lumber 8ft", category: "lumber", cost: 50.00, margin_pct: 0.2, price: 62.50 },
  ],
  subtotal: 62.50,
  margin_total: 12.50,
  total: 62.50,
  deposit_pct: 0.25,
  deposit_amount: 15.63,
  stripe_payment_link: "https://checkout.stripe.com/pay/cs_test_abc",
  public_token: "abc123token",
};

function makeVaultBytes(proposal: Proposal, contractorName = "Best Build Co."): Buffer {
  const lines = [
    "---",
    `id: ${proposal.id}`,
    `tenant_id: ${proposal.tenant_id}`,
    `quote_id: ${proposal.quote_id}`,
    `created_at: ${proposal.created_at}`,
    `status: ${proposal.status}`,
    `contractor_name: ${contractorName}`,
    `client_name: ${proposal.client.name}`,
    `client_email: ${proposal.client.email}`,
    `subtotal: ${proposal.subtotal}`,
    `margin_total: ${proposal.margin_total}`,
    `total: ${proposal.total}`,
    ...(proposal.deposit_pct !== undefined ? [`deposit_pct: ${proposal.deposit_pct}`] : []),
    ...(proposal.deposit_amount !== undefined ? [`deposit_amount: ${proposal.deposit_amount}`] : []),
    ...(proposal.stripe_payment_link ? [`stripe_payment_link: ${proposal.stripe_payment_link}`] : []),
    ...(proposal.public_token ? [`public_token: ${proposal.public_token}`] : []),
    "content_hash: deadbeef",
    "---",
    "",
    "```json",
    JSON.stringify(proposal.line_items, null, 2),
    "```",
    "",
  ].join("\n");
  return Buffer.from(lines, "utf8");
}

function makeStripeEvent(overrides: {
  type?: string;
  session_id?: string;
  amount_total?: number;
  currency?: string;
  payment_intent?: string | null;
  mode?: "deposit" | "full";
  proposal_id?: string;
  tenant_id?: string;
} = {}) {
  return {
    type: overrides.type ?? "checkout.session.completed",
    data: {
      object: {
        id: overrides.session_id ?? "cs_test_full_001",
        payment_intent: overrides.payment_intent !== undefined ? overrides.payment_intent : "pi_test_001",
        amount_total: overrides.amount_total ?? 6250,
        currency: overrides.currency ?? "usd",
        metadata: {
          proposal_id: overrides.proposal_id ?? PROPOSAL_ID,
          tenant_id: overrides.tenant_id ?? TENANT_ID,
          mode: overrides.mode ?? "full",
        },
      },
    },
  };
}

describe("handleStripeWebhook", () => {
  let tools: MCPTools;

  beforeEach(() => {
    tools = createMockTools();
    vi.mocked(tools.vault.read).mockResolvedValue({
      data: makeVaultBytes(SENT_PROPOSAL),
      sha256: "deadbeef",
    });
  });

  describe("verification", () => {
    it("throws WebhookVerificationError when signature is invalid", async () => {
      vi.mocked(tools.webhook.verify).mockResolvedValue({ valid: false, event_type: "" });

      await expect(
        handleStripeWebhook(makeStripeEvent(), "bad_sig", tools)
      ).rejects.toBeInstanceOf(WebhookVerificationError);

      expect(tools.vault.read).not.toHaveBeenCalled();
    });

    it("calls webhook.verify with provider stripe", async () => {
      const payload = makeStripeEvent();
      await handleStripeWebhook(payload, "sig_abc", tools);

      expect(tools.webhook.verify).toHaveBeenCalledWith("stripe", payload, "sig_abc");
    });
  });

  describe("routing", () => {
    it("silently ignores unknown event types", async () => {
      await handleStripeWebhook(makeStripeEvent({ type: "customer.created" }), "sig", tools);

      expect(tools.vault.read).not.toHaveBeenCalled();
      expect(tools.vault.write).not.toHaveBeenCalled();
    });

    it("silently ignores payloads that do not match Stripe schema", async () => {
      await handleStripeWebhook({ type: "checkout.session.completed", data: {} }, "sig", tools);

      expect(tools.vault.read).not.toHaveBeenCalled();
      expect(tools.vault.write).not.toHaveBeenCalled();
    });

    it("silently ignores payloads missing metadata fields", async () => {
      const bad = { type: "checkout.session.completed", data: { object: { id: "cs_1", amount_total: 100, currency: "usd", metadata: {} } } };
      await handleStripeWebhook(bad, "sig", tools);

      expect(tools.vault.write).not.toHaveBeenCalled();
    });
  });

  describe("checkout.session.completed", () => {
    it("reads proposal from correct vault path", async () => {
      await handleStripeWebhook(makeStripeEvent(), "sig", tools);

      expect(tools.vault.read).toHaveBeenCalledWith(
        `tenants/${TENANT_ID}/proposals/${PROPOSAL_ID}.md`
      );
    });

    it("writes payment and proposal docs to vault (two writes)", async () => {
      await handleStripeWebhook(makeStripeEvent(), "sig", tools);
      expect(tools.vault.write).toHaveBeenCalledTimes(2);
    });

    it("converts amount_total from cents to dollars", async () => {
      await handleStripeWebhook(makeStripeEvent({ amount_total: 6250 }), "sig", tools);

      expect(tools.vault.append_event).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "payment_received",
          payload: expect.objectContaining({ amount: 62.50 }),
        })
      );
    });

    it("extracts stripe_payment_intent_id when present", async () => {
      await handleStripeWebhook(makeStripeEvent({ payment_intent: "pi_abc" }), "sig", tools);

      const [paymentBytes] = vi.mocked(tools.vault.write).mock.calls
        .filter(([p]) => p.includes("/payments/"))
        .map(([, b]) => (b as Buffer).toString("utf8"));

      expect(paymentBytes).toContain("stripe_payment_intent_id: pi_abc");
    });

    it("omits stripe_payment_intent_id when null", async () => {
      await handleStripeWebhook(makeStripeEvent({ payment_intent: null }), "sig", tools);

      const [paymentBytes] = vi.mocked(tools.vault.write).mock.calls
        .filter(([p]) => p.includes("/payments/"))
        .map(([, b]) => (b as Buffer).toString("utf8"));

      expect(paymentBytes).not.toContain("stripe_payment_intent_id:");
    });

    it("appends proposal_paid event for full mode", async () => {
      await handleStripeWebhook(makeStripeEvent({ mode: "full" }), "sig", tools);

      expect(tools.vault.append_event).toHaveBeenCalledWith(
        expect.objectContaining({ type: "proposal_paid", aggregate_id: PROPOSAL_ID })
      );
    });

    it("appends proposal_deposit_received event for deposit mode", async () => {
      vi.mocked(tools.vault.read).mockResolvedValue({
        data: makeVaultBytes({ ...SENT_PROPOSAL, status: "sent" }),
        sha256: "deadbeef",
      });

      await handleStripeWebhook(makeStripeEvent({ mode: "deposit", amount_total: 1563 }), "sig", tools);

      expect(tools.vault.append_event).toHaveBeenCalledWith(
        expect.objectContaining({ type: "proposal_deposit_received", aggregate_id: PROPOSAL_ID })
      );
    });

    it("rebuilds cache after recording payment", async () => {
      await handleStripeWebhook(makeStripeEvent(), "sig", tools);
      expect(tools.cache.rebuild).toHaveBeenCalledWith(TENANT_ID);
    });
  });

  describe("idempotency", () => {
    it("skips recordPayment when proposal is already paid (full mode)", async () => {
      vi.mocked(tools.vault.read).mockResolvedValue({
        data: makeVaultBytes({ ...SENT_PROPOSAL, status: "paid" }),
        sha256: "deadbeef",
      });

      await handleStripeWebhook(makeStripeEvent({ mode: "full" }), "sig", tools);

      expect(tools.vault.write).not.toHaveBeenCalled();
      expect(tools.cache.rebuild).not.toHaveBeenCalled();
    });

    it("skips recordPayment when proposal is already accepted (deposit mode)", async () => {
      vi.mocked(tools.vault.read).mockResolvedValue({
        data: makeVaultBytes({ ...SENT_PROPOSAL, status: "accepted" }),
        sha256: "deadbeef",
      });

      await handleStripeWebhook(makeStripeEvent({ mode: "deposit", amount_total: 1563 }), "sig", tools);

      expect(tools.vault.write).not.toHaveBeenCalled();
      expect(tools.cache.rebuild).not.toHaveBeenCalled();
    });

    it("skips deposit event when proposal is already fully paid", async () => {
      vi.mocked(tools.vault.read).mockResolvedValue({
        data: makeVaultBytes({ ...SENT_PROPOSAL, status: "paid" }),
        sha256: "deadbeef",
      });

      await handleStripeWebhook(makeStripeEvent({ mode: "deposit", amount_total: 1563 }), "sig", tools);

      expect(tools.vault.write).not.toHaveBeenCalled();
    });
  });
});
