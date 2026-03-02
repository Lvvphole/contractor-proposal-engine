import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { createMockTools } from "../../lib/mcp-tools";
import type { MCPTools } from "../../lib/mcp-tools";
import { createProposal } from "../../orchestrator/stages/proposal";
import type { Contractor } from "../../orchestrator/stages/proposal";
import type { Quote, Proposal } from "../../lib/schemas";
import type { PricingConfig } from "../../orchestrator/pricing";
import { PricingError } from "../../orchestrator/pricing";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const QUOTE: Quote = {
  id: "00000000-0000-0000-0000-000000000002",
  tenant_id: TENANT_ID,
  created_at: "2024-01-01T00:00:00.000Z",
  status: "draft",
  source_file: "quote.pdf",
  supplier: "Acme Supply Co.",
  line_items: [
    {
      description: "2x4 Lumber 8ft",
      quantity: 10,
      unit: "each",
      unit_cost: 5.00,
      total_cost: 50.00,
      category: "lumber",
    },
  ],
  subtotal: 50.00,
  tax: 0,
  total: 50.00,
};

const CONFIG: PricingConfig = {
  default_margin_percent: 20,
  category_overrides: {},
  deposit_percent: 25,
};

const CLIENT: Proposal["client"] = {
  name: "Jane Smith",
  email: "jane@example.com",
  phone: "555-1234",
};

const CONTRACTOR: Contractor = {
  name: "Best Build Co.",
  logo_url: "https://bestbuild.example.com/logo.png",
};

describe("createProposal", () => {
  let tools: MCPTools;

  beforeEach(() => {
    tools = createMockTools();
  });

  it("returns a validated Proposal with correct fields", async () => {
    const proposal = await createProposal(QUOTE, CONFIG, CLIENT, CONTRACTOR, tools);

    expect(proposal.tenant_id).toBe(TENANT_ID);
    expect(proposal.quote_id).toBe(QUOTE.id);
    expect(proposal.status).toBe("draft");
    expect(proposal.client).toEqual(CLIENT);
    expect(proposal.line_items).toHaveLength(1);
  });

  it("computes subtotal, margin_total, total, deposit_pct, deposit_amount", async () => {
    const proposal = await createProposal(QUOTE, CONFIG, CLIENT, CONTRACTOR, tools);

    // 50.00 cost / (1 - 0.20) = 62.50 sell price
    expect(proposal.subtotal).toBe(62.50);
    expect(proposal.margin_total).toBeCloseTo(12.50, 2);
    expect(proposal.total).toBe(62.50);
    expect(proposal.deposit_pct).toBe(0.25);
    expect(proposal.deposit_amount).toBeCloseTo(15.63, 2);
  });

  it("writes markdown to correct vault path", async () => {
    const proposal = await createProposal(QUOTE, CONFIG, CLIENT, CONTRACTOR, tools);
    const expectedPath = `tenants/${TENANT_ID}/proposals/${proposal.id}.md`;

    expect(tools.vault.write).toHaveBeenCalledWith(
      expectedPath,
      expect.any(Buffer),
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
  });

  it("written markdown contains YAML frontmatter with contractor and client fields", async () => {
    const proposal = await createProposal(QUOTE, CONFIG, CLIENT, CONTRACTOR, tools);
    const [, bytes] = vi.mocked(tools.vault.write).mock.calls[0];
    const markdown = (bytes as Buffer).toString("utf8");

    expect(markdown).toContain(`id: ${proposal.id}`);
    expect(markdown).toContain(`contractor_name: Best Build Co.`);
    expect(markdown).toContain(`contractor_logo_url: https://bestbuild.example.com/logo.png`);
    expect(markdown).toContain(`client_name: Jane Smith`);
    expect(markdown).toContain(`client_email: jane@example.com`);
    expect(markdown).toContain("content_hash:");
    expect(markdown).toContain("```json");
  });

  it("omits optional contractor and client fields when absent", async () => {
    const minimalClient: Proposal["client"] = { name: "Jane Smith", email: "jane@example.com" };
    const proposal = await createProposal(
      QUOTE, CONFIG, minimalClient, { name: "Solo Build" }, tools
    );
    const [, bytes] = vi.mocked(tools.vault.write).mock.calls[0];
    const markdown = (bytes as Buffer).toString("utf8");

    expect(markdown).not.toContain("contractor_logo_url:");
    expect(markdown).not.toContain("client_phone:");
    expect(proposal.id).toBeTruthy();
  });

  it("appends proposal_created event with correct fields", async () => {
    const proposal = await createProposal(QUOTE, CONFIG, CLIENT, CONTRACTOR, tools);

    expect(tools.vault.append_event).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "proposal_created",
        aggregate_id: proposal.id,
        aggregate_type: "proposal",
        tenant_id: TENANT_ID,
      })
    );
  });

  it("calls cache.rebuild with tenant_id", async () => {
    await createProposal(QUOTE, CONFIG, CLIENT, CONTRACTOR, tools);
    expect(tools.cache.rebuild).toHaveBeenCalledWith(TENANT_ID);
  });

  it("propagates PricingError without writing to vault", async () => {
    const badConfig: PricingConfig = {
      ...CONFIG,
      default_margin_percent: 150,
    };

    await expect(
      createProposal(QUOTE, badConfig, CLIENT, CONTRACTOR, tools)
    ).rejects.toBeInstanceOf(PricingError);

    expect(tools.vault.write).not.toHaveBeenCalled();
    expect(tools.vault.append_event).not.toHaveBeenCalled();
  });

  it("content_hash is deterministic for identical line items", async () => {
    await createProposal(QUOTE, CONFIG, CLIENT, CONTRACTOR, tools);
    const [, , hash1] = vi.mocked(tools.vault.write).mock.calls[0];

    vi.mocked(tools.vault.write).mockClear();
    await createProposal(QUOTE, CONFIG, CLIENT, CONTRACTOR, tools);
    const [, , hash2] = vi.mocked(tools.vault.write).mock.calls[0];

    expect(hash1).toBe(hash2);
  });

  it("each call generates a unique proposal id", async () => {
    const p1 = await createProposal(QUOTE, CONFIG, CLIENT, CONTRACTOR, tools);
    const p2 = await createProposal(QUOTE, CONFIG, CLIENT, CONTRACTOR, tools);
    expect(p1.id).not.toBe(p2.id);
  });
});
