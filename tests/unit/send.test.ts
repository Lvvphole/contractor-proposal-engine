import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { createMockTools } from "../../lib/mcp-tools";
import type { MCPTools } from "../../lib/mcp-tools";
import { sendProposal } from "../../orchestrator/stages/send";
import type { Proposal } from "../../lib/schemas";
import type { Contractor } from "../../orchestrator/stages/proposal";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const DRAFT_PROPOSAL: Proposal = {
  id: "00000000-0000-0000-0000-000000000002",
  tenant_id: TENANT_ID,
  quote_id: "00000000-0000-0000-0000-000000000003",
  created_at: "2024-01-01T00:00:00.000Z",
  status: "draft",
  client: {
    name: "Jane Smith",
    email: "jane@example.com",
    phone: "555-1234",
  },
  line_items: [
    {
      description: "2x4 Lumber 8ft",
      category: "lumber",
      cost: 50.00,
      margin_pct: 0.2,
      price: 62.50,
    },
  ],
  subtotal: 62.50,
  margin_total: 12.50,
  total: 62.50,
  deposit_pct: 0.25,
  deposit_amount: 15.63,
};

const CONTRACTOR: Contractor = {
  name: "Best Build Co.",
  logo_url: "https://bestbuild.example.com/logo.png",
};

const STRIPE_URL = "https://checkout.stripe.com/pay/cs_test_abc123";

describe("sendProposal", () => {
  let tools: MCPTools;

  beforeEach(() => {
    tools = createMockTools();
    vi.mocked(tools.stripe.create_checkout).mockResolvedValue({
      session_id: "cs_test_abc123",
      url: STRIPE_URL,
    });
  });

  it("returns Proposal with status sent, stripe_payment_link, and public_token", async () => {
    const sent = await sendProposal(DRAFT_PROPOSAL, CONTRACTOR, tools);

    expect(sent.status).toBe("sent");
    expect(sent.stripe_payment_link).toBe(STRIPE_URL);
    expect(sent.public_token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves all original proposal fields", async () => {
    const sent = await sendProposal(DRAFT_PROPOSAL, CONTRACTOR, tools);

    expect(sent.id).toBe(DRAFT_PROPOSAL.id);
    expect(sent.tenant_id).toBe(TENANT_ID);
    expect(sent.quote_id).toBe(DRAFT_PROPOSAL.quote_id);
    expect(sent.client).toEqual(DRAFT_PROPOSAL.client);
    expect(sent.total).toBe(DRAFT_PROPOSAL.total);
  });

  it("uses deposit mode when deposit_amount is defined", async () => {
    await sendProposal(DRAFT_PROPOSAL, CONTRACTOR, tools);

    expect(tools.stripe.create_checkout).toHaveBeenCalledWith(
      DRAFT_PROPOSAL.id,
      "deposit"
    );
  });

  it("uses full mode when deposit_amount is not defined", async () => {
    const noDeposit: Proposal = {
      ...DRAFT_PROPOSAL,
      deposit_pct: undefined,
      deposit_amount: undefined,
    };
    await sendProposal(noDeposit, CONTRACTOR, tools);

    expect(tools.stripe.create_checkout).toHaveBeenCalledWith(
      DRAFT_PROPOSAL.id,
      "full"
    );
  });

  it("writes updated proposal to correct vault path", async () => {
    const sent = await sendProposal(DRAFT_PROPOSAL, CONTRACTOR, tools);
    const expectedPath = `tenants/${TENANT_ID}/proposals/${sent.id}.md`;

    expect(tools.vault.write).toHaveBeenCalledWith(
      expectedPath,
      expect.any(Buffer),
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
  });

  it("written markdown contains stripe_payment_link and public_token", async () => {
    const sent = await sendProposal(DRAFT_PROPOSAL, CONTRACTOR, tools);
    const [, bytes] = vi.mocked(tools.vault.write).mock.calls[0];
    const markdown = (bytes as Buffer).toString("utf8");

    expect(markdown).toContain(`stripe_payment_link: ${STRIPE_URL}`);
    expect(markdown).toContain(`public_token: ${sent.public_token}`);
    expect(markdown).toContain("status: sent");
  });

  it("appends proposal_sent event with correct fields", async () => {
    const sent = await sendProposal(DRAFT_PROPOSAL, CONTRACTOR, tools);

    expect(tools.vault.append_event).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "proposal_sent",
        aggregate_id: sent.id,
        aggregate_type: "proposal",
        tenant_id: TENANT_ID,
        payload: expect.objectContaining({
          stripe_payment_link: STRIPE_URL,
          checkout_mode: "deposit",
        }),
      })
    );
  });

  it("sends email with client and contractor details", async () => {
    const sent = await sendProposal(DRAFT_PROPOSAL, CONTRACTOR, tools);

    expect(tools.email.send).toHaveBeenCalledWith(
      "proposal_sent",
      expect.objectContaining({
        client_email: "jane@example.com",
        client_name: "Jane Smith",
        contractor_name: "Best Build Co.",
        stripe_payment_link: STRIPE_URL,
        public_token: sent.public_token,
      })
    );
  });

  it("calls cache.rebuild with tenant_id", async () => {
    await sendProposal(DRAFT_PROPOSAL, CONTRACTOR, tools);
    expect(tools.cache.rebuild).toHaveBeenCalledWith(TENANT_ID);
  });

  it("propagates Stripe error without vault write or email", async () => {
    vi.mocked(tools.stripe.create_checkout).mockRejectedValue(new Error("stripe timeout"));

    await expect(sendProposal(DRAFT_PROPOSAL, CONTRACTOR, tools)).rejects.toThrow("stripe timeout");

    expect(tools.vault.write).not.toHaveBeenCalled();
    expect(tools.email.send).not.toHaveBeenCalled();
    expect(tools.vault.append_event).not.toHaveBeenCalled();
  });

  it("generates a unique public_token per call", async () => {
    const s1 = await sendProposal(DRAFT_PROPOSAL, CONTRACTOR, tools);
    const s2 = await sendProposal(DRAFT_PROPOSAL, CONTRACTOR, tools);
    expect(s1.public_token).not.toBe(s2.public_token);
  });
});
