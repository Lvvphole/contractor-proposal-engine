import crypto from "crypto";
import { z } from "zod";
import { QuoteSchema } from "../../lib/schemas";
import type { Quote } from "../../lib/schemas";
import type { MCPTools } from "../../lib/mcp-tools";

export class SchemaValidationError extends Error {
  readonly issues: z.ZodIssue[];
  constructor(issues: z.ZodIssue[]) {
    super(`Quote schema validation failed: ${issues.map(i => i.message).join("; ")}`);
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

function computeContentHash(lineItems: Quote["line_items"]): string {
  return crypto.createHash("sha256").update(JSON.stringify(lineItems)).digest("hex");
}

function verifyLineConsistency(lineItems: Quote["line_items"]): void {
  for (const item of lineItems) {
    const expected = round2(item.quantity * item.unit_cost);
    if (Math.abs(item.total_cost - expected) > 0.01) {
      throw new SchemaValidationError([{
        code: z.ZodIssueCode.custom,
        path: ["line_items"],
        message: `"${item.description}": total_cost ${item.total_cost} ≠ qty×unit_cost ${expected}`,
      }]);
    }
  }
}

function serializeQuote(quote: Quote, contentHash: string): string {
  const frontmatter = [
    "---",
    `id: ${quote.id}`,
    `tenant_id: ${quote.tenant_id}`,
    `created_at: ${quote.created_at}`,
    `status: ${quote.status}`,
    `source_file: ${quote.source_file}`,
    ...(quote.supplier ? [`supplier: ${quote.supplier}`] : []),
    `subtotal: ${quote.subtotal}`,
    `tax: ${quote.tax}`,
    `total: ${quote.total}`,
    `content_hash: ${contentHash}`,
    "---",
  ].join("\n");
  return `${frontmatter}\n\n\`\`\`json\n${JSON.stringify(quote.line_items, null, 2)}\n\`\`\`\n`;
}

function makeEvent(
  tenantId: string,
  type: string,
  aggregateId: string,
  payload: Record<string, unknown>
) {
  return {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    type,
    aggregate_id: aggregateId,
    aggregate_type: "quote" as const,
    payload,
    created_at: new Date().toISOString(),
  };
}

export async function ingestQuote(
  tenantId: string,
  pdfVaultPath: string,
  tools: MCPTools
): Promise<Quote> {
  const { text } = await tools.pdf.extract_text(pdfVaultPath);
  const { json } = await tools.claude.structured_extract(text, "quote");

  const parsed = QuoteSchema.safeParse(json);
  if (!parsed.success) {
    await tools.vault.append_event(
      makeEvent(tenantId, "quote_validation_failed", crypto.randomUUID(), {
        pdf_vault_path: pdfVaultPath,
        issues: parsed.error.issues,
      })
    );
    throw new SchemaValidationError(parsed.error.issues);
  }

  const quote = parsed.data;

  try {
    verifyLineConsistency(quote.line_items);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      await tools.vault.append_event(
        makeEvent(tenantId, "quote_validation_failed", quote.id, {
          pdf_vault_path: pdfVaultPath,
          issues: err.issues,
        })
      );
    }
    throw err;
  }

  const contentHash = computeContentHash(quote.line_items);
  const bytes = Buffer.from(serializeQuote(quote, contentHash), "utf8");

  await tools.vault.write(`tenants/${tenantId}/quotes/${quote.id}.md`, bytes, contentHash);
  await tools.vault.append_event(
    makeEvent(tenantId, "quote_ingested", quote.id, {
      pdf_vault_path: pdfVaultPath,
      content_hash: contentHash,
      line_item_count: quote.line_items.length,
    })
  );
  await tools.cache.rebuild(tenantId);

  return quote;
}
