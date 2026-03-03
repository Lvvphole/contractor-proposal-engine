import crypto from "crypto";
import type { Proposal } from "../../lib/schemas";
import type { MCPTools } from "../../lib/mcp-tools";

export type QuickBooksExportResult = {
  invoice_id: string;
  status: string;
};

export async function exportToQuickBooks(
  proposal: Proposal,
  tools: MCPTools
): Promise<QuickBooksExportResult> {
  const result = await tools.quickbooks.export_invoice(proposal.id);

  await tools.vault.append_event({
    id: crypto.randomUUID(),
    tenant_id: proposal.tenant_id,
    type: "quickbooks_export",
    aggregate_id: proposal.id,
    aggregate_type: "proposal",
    payload: {
      invoice_id: result.invoice_id,
      quickbooks_status: result.status,
    },
    created_at: new Date().toISOString(),
  });
  await tools.cache.rebuild(proposal.tenant_id);

  return result;
}
