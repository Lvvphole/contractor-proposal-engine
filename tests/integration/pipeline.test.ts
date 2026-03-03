import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { createMockTools } from "../../lib/mcp-tools";
import type { MCPTools } from "../../lib/mcp-tools";
import { runPipeline } from "../../orchestrator/pipeline";
import type { PipelineInput } from "../../orchestrator/pipeline";
import type { Quote } from "../../lib/schemas";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const QUOTE_ID = "00000000-0000-0000-0000-000000000002";

const VALID_QUOTE: Quote = {
  id: QUOTE_ID,
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

const INPUT: PipelineInput = {
  tenant_id: TENANT_ID,
  pdf_vault_path: "tenants/t1/uploads/quote.pdf",
  pricing_config: {
    default_margin_percent: 20,
    category_overrides: {},
    deposit_percent: 25,
  },
  contractor: { name: "Best Build Co.", logo_url: "https://bestbuild.example.com/logo.png" },
  recipient_email: "jane@example.com",
  proposal_base_url: "https://proposals.example.com",
};

describe("runPipeline", () => {
  let tools: MCPTools;

  beforeEach(() => {
    tools = createMockTools();
    vi.mocked(tools.claude.structured_extract).mockResolvedValue({ json: VALID_QUOTE, confidence: 1 });
    vi.mocked(tools.stripe.create_checkout).mockResolvedValue({
      session_id: "cs_test_abc123",
      url: "https://checkout.stripe.com/pay/cs_test_abc123",
    });
  });

  it("returns quote, proposal, and proposal_url", async () => {
    const output = await runPipeline(tools, INPUT);

    expect(output.quote.id).toBe(QUOTE_ID);
    expect(output.proposal.status).toBe("sent");
    expect(output.proposal.client.email).toBe("jane@example.com");
    expect(output.proposal_url).toMatch(/^https:\/\/proposals\.example\.com\//);
  });

  it("proposal_url contains proposal id and public_token", async () => {
    const { proposal, proposal_url } = await runPipeline(tools, INPUT);

    expect(proposal_url).toContain(proposal.id);
    expect(proposal_url).toContain(proposal.public_token);
  });

  it("derives client name from recipient_email local-part", async () => {
    const { proposal } = await runPipeline(tools, INPUT);
    expect(proposal.client.name).toBe("jane");
  });

  it("calls all three stages in order", async () => {
    const callOrder: string[] = [];
    vi.mocked(tools.pdf.extract_text).mockImplementation(async () => { callOrder.push("ingest"); return { text: "", page_count: 1 }; });
    vi.mocked(tools.claude.structured_extract).mockImplementation(async () => { return { json: VALID_QUOTE, confidence: 1 }; });
    vi.mocked(tools.stripe.create_checkout).mockImplementation(async () => { callOrder.push("send"); return { session_id: "cs_x", url: "https://checkout.stripe.com/x" }; });

    await runPipeline(tools, INPUT);

    expect(callOrder[0]).toBe("ingest");
    expect(callOrder[1]).toBe("send");
  });

  it("propagates ingest error without creating a proposal", async () => {
    vi.mocked(tools.pdf.extract_text).mockRejectedValue(new Error("pdf read failed"));

    await expect(runPipeline(tools, INPUT)).rejects.toThrow("pdf read failed");
    expect(tools.stripe.create_checkout).not.toHaveBeenCalled();
    expect(tools.email.send).not.toHaveBeenCalled();
  });
});
