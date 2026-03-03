import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { createMockTools } from "../../lib/mcp-tools";
import type { MCPTools } from "../../lib/mcp-tools";
import { exportToQuickBooks } from "../../orchestrator/stages/export";
import type { Proposal } from "../../lib/schemas";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

const PAID_PROPOSAL: Proposal = {
  id: "00000000-0000-0000-0000-000000000002",
  tenant_id: TENANT_ID,
  quote_id: "00000000-0000-0000-0000-000000000003",
  created_at: "2024-01-01T00:00:00.000Z",
  status: "paid",
  client: { name: "Jane Smith", email: "jane@example.com" },
  line_items: [
    { description: "2x4 Lumber 8ft", category: "lumber", cost: 50.00, margin_pct: 0.2, price: 62.50 },
  ],
  subtotal: 62.50,
  margin_total: 12.50,
  total: 62.50,
};

describe("exportToQuickBooks", () => {
  let tools: MCPTools;

  beforeEach(() => {
    tools = createMockTools();
    vi.mocked(tools.quickbooks.export_invoice).mockResolvedValue({
      invoice_id: "inv_qb_001",
      status: "pending",
    });
  });

  it("returns the QuickBooks invoice_id and status", async () => {
    const result = await exportToQuickBooks(PAID_PROPOSAL, tools);

    expect(result.invoice_id).toBe("inv_qb_001");
    expect(result.status).toBe("pending");
  });

  it("calls export_invoice with proposal.id", async () => {
    await exportToQuickBooks(PAID_PROPOSAL, tools);

    expect(tools.quickbooks.export_invoice).toHaveBeenCalledWith(PAID_PROPOSAL.id);
  });

  it("appends quickbooks_export event with correct fields", async () => {
    await exportToQuickBooks(PAID_PROPOSAL, tools);

    expect(tools.vault.append_event).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "quickbooks_export",
        aggregate_id: PAID_PROPOSAL.id,
        aggregate_type: "proposal",
        tenant_id: TENANT_ID,
        payload: { invoice_id: "inv_qb_001", quickbooks_status: "pending" },
      })
    );
  });

  it("calls cache.rebuild with tenant_id", async () => {
    await exportToQuickBooks(PAID_PROPOSAL, tools);

    expect(tools.cache.rebuild).toHaveBeenCalledWith(TENANT_ID);
  });

  it("does not write any vault documents", async () => {
    await exportToQuickBooks(PAID_PROPOSAL, tools);

    expect(tools.vault.write).not.toHaveBeenCalled();
  });

  it("propagates QuickBooks error without appending event or rebuilding cache", async () => {
    vi.mocked(tools.quickbooks.export_invoice).mockRejectedValue(new Error("QB unavailable"));

    await expect(exportToQuickBooks(PAID_PROPOSAL, tools)).rejects.toThrow("QB unavailable");

    expect(tools.vault.append_event).not.toHaveBeenCalled();
    expect(tools.cache.rebuild).not.toHaveBeenCalled();
  });
});
