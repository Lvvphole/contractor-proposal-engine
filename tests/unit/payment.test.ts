import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { createMockTools } from "../../lib/mcp-tools";
import type { MCPTools } from "../../lib/mcp-tools";
import { recordPayment } from "../../orchestrator/stages/payment";
import type { StripePaymentEvent } from "../../orchestrator/stages/payment";
import type { Proposal } from "../../lib/schemas";
import type { Contractor } from "../../orchestrator/stages/proposal";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const SENT_PROPOSAL: Proposal = {
  id: "00000000-0000-0000-0000-000000000002",
  tenant_id: TENANT_ID,
  quote_id: "00000000-0000-0000-0000-000000000003",
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

const CONTRACTOR: Contractor = { name: "Best Build Co." };

const FULL_EVENT: StripePaymentEvent = {
  stripe_session_id: "cs_test_full_001",
  stripe_payment_intent_id: "pi_test_001",
  amount: 62.50,
  currency: "usd",
  mode: "full",
};

const DEPOSIT_EVENT: StripePaymentEvent = {
  stripe_session_id: "cs_test_dep_001",
  amount: 15.63,
  currency: "usd",
  mode: "deposit",
};

describe("recordPayment", () => {
  let tools: MCPTools;

  beforeEach(() => {
    tools = createMockTools();
  });

  it("returns Payment with correct fields for full payment", async () => {
    const { payment } = await recordPayment(SENT_PROPOSAL, FULL_EVENT, CONTRACTOR, tools);

    expect(payment.tenant_id).toBe(TENANT_ID);
    expect(payment.proposal_id).toBe(SENT_PROPOSAL.id);
    expect(payment.mode).toBe("full");
    expect(payment.amount).toBe(62.50);
    expect(payment.currency).toBe("usd");
    expect(payment.status).toBe("succeeded");
    expect(payment.stripe_session_id).toBe("cs_test_full_001");
    expect(payment.stripe_payment_intent_id).toBe("pi_test_001");
    expect(payment.completed_at).toBeDefined();
  });

  it("returns updated Proposal with status paid for full payment", async () => {
    const { proposal } = await recordPayment(SENT_PROPOSAL, FULL_EVENT, CONTRACTOR, tools);
    expect(proposal.status).toBe("paid");
  });

  it("returns updated Proposal with status accepted for deposit payment", async () => {
    const { proposal } = await recordPayment(SENT_PROPOSAL, DEPOSIT_EVENT, CONTRACTOR, tools);
    expect(proposal.status).toBe("accepted");
  });

  it("writes payment document to correct vault path", async () => {
    const { payment } = await recordPayment(SENT_PROPOSAL, FULL_EVENT, CONTRACTOR, tools);
    const calls = vi.mocked(tools.vault.write).mock.calls;
    const paymentCall = calls.find(([path]) =>
      path === `tenants/${TENANT_ID}/payments/${payment.id}.md`
    );
    expect(paymentCall).toBeDefined();
  });

  it("writes updated proposal document to correct vault path", async () => {
    await recordPayment(SENT_PROPOSAL, FULL_EVENT, CONTRACTOR, tools);
    const calls = vi.mocked(tools.vault.write).mock.calls;
    const proposalCall = calls.find(([path]) =>
      path === `tenants/${TENANT_ID}/proposals/${SENT_PROPOSAL.id}.md`
    );
    expect(proposalCall).toBeDefined();
  });

  it("payment markdown contains key frontmatter fields", async () => {
    const { payment } = await recordPayment(SENT_PROPOSAL, FULL_EVENT, CONTRACTOR, tools);
    const calls = vi.mocked(tools.vault.write).mock.calls;
    const [, bytes] = calls.find(([path]) => path.includes(`/payments/${payment.id}.md`))!;
    const markdown = (bytes as Buffer).toString("utf8");

    expect(markdown).toContain(`stripe_session_id: cs_test_full_001`);
    expect(markdown).toContain(`stripe_payment_intent_id: pi_test_001`);
    expect(markdown).toContain("status: succeeded");
    expect(markdown).toContain("mode: full");
    expect(markdown).toContain("content_hash:");
  });

  it("proposal markdown has updated status", async () => {
    await recordPayment(SENT_PROPOSAL, FULL_EVENT, CONTRACTOR, tools);
    const calls = vi.mocked(tools.vault.write).mock.calls;
    const [, bytes] = calls.find(([path]) => path.includes(`/proposals/${SENT_PROPOSAL.id}.md`))!;
    const markdown = (bytes as Buffer).toString("utf8");

    expect(markdown).toContain("status: paid");
    expect(markdown).toContain(`stripe_payment_link: ${SENT_PROPOSAL.stripe_payment_link}`);
  });

  it("appends payment_received event with payment aggregate", async () => {
    const { payment } = await recordPayment(SENT_PROPOSAL, FULL_EVENT, CONTRACTOR, tools);

    expect(tools.vault.append_event).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "payment_received",
        aggregate_id: payment.id,
        aggregate_type: "payment",
        tenant_id: TENANT_ID,
        payload: expect.objectContaining({
          proposal_id: SENT_PROPOSAL.id,
          mode: "full",
          stripe_session_id: "cs_test_full_001",
        }),
      })
    );
  });

  it("appends proposal_paid event for full payment", async () => {
    const { payment } = await recordPayment(SENT_PROPOSAL, FULL_EVENT, CONTRACTOR, tools);

    expect(tools.vault.append_event).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "proposal_paid",
        aggregate_id: SENT_PROPOSAL.id,
        aggregate_type: "proposal",
        payload: expect.objectContaining({ payment_id: payment.id }),
      })
    );
  });

  it("appends proposal_deposit_received event for deposit payment", async () => {
    const { payment } = await recordPayment(SENT_PROPOSAL, DEPOSIT_EVENT, CONTRACTOR, tools);

    expect(tools.vault.append_event).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "proposal_deposit_received",
        aggregate_id: SENT_PROPOSAL.id,
        aggregate_type: "proposal",
        payload: expect.objectContaining({ payment_id: payment.id }),
      })
    );
  });

  it("calls cache.rebuild with tenant_id", async () => {
    await recordPayment(SENT_PROPOSAL, FULL_EVENT, CONTRACTOR, tools);
    expect(tools.cache.rebuild).toHaveBeenCalledWith(TENANT_ID);
  });

  it("payment content_hash is deterministic for identical events", async () => {
    await recordPayment(SENT_PROPOSAL, FULL_EVENT, CONTRACTOR, tools);
    const [, , hash1] = vi.mocked(tools.vault.write).mock.calls[0];

    vi.mocked(tools.vault.write).mockClear();
    await recordPayment(SENT_PROPOSAL, FULL_EVENT, CONTRACTOR, tools);
    const [, , hash2] = vi.mocked(tools.vault.write).mock.calls[0];

    expect(hash1).toBe(hash2);
  });

  it("vault.write called exactly twice (payment + proposal)", async () => {
    await recordPayment(SENT_PROPOSAL, FULL_EVENT, CONTRACTOR, tools);
    expect(tools.vault.write).toHaveBeenCalledTimes(2);
  });

  it("error from first vault.write propagates without second write", async () => {
    vi.mocked(tools.vault.write).mockRejectedValueOnce(new Error("vault unavailable"));

    await expect(
      recordPayment(SENT_PROPOSAL, FULL_EVENT, CONTRACTOR, tools)
    ).rejects.toThrow("vault unavailable");

    expect(tools.vault.write).toHaveBeenCalledTimes(1);
    expect(tools.cache.rebuild).not.toHaveBeenCalled();
  });
});
