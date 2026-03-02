import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { createMockTools } from "../../lib/mcp-tools";
import type { MCPTools } from "../../lib/mcp-tools";
import { ingestQuote, SchemaValidationError } from "../../orchestrator/stages/ingest";
import type { Quote } from "../../lib/schemas";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const PDF_PATH = "tenants/t1/uploads/quote.pdf";

const VALID_QUOTE: Quote = {
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

describe("ingestQuote", () => {
  let tools: MCPTools;

  beforeEach(() => {
    tools = createMockTools();
  });

  function mockExtract(quote: unknown, confidence = 0.95) {
    vi.mocked(tools.pdf.extract_text).mockResolvedValue({ text: "pdf text", page_count: 1 });
    vi.mocked(tools.claude.structured_extract).mockResolvedValue({ json: quote, confidence });
  }

  it("returns validated Quote on success", async () => {
    mockExtract(VALID_QUOTE);
    const result = await ingestQuote(TENANT_ID, PDF_PATH, tools);
    expect(result).toEqual(VALID_QUOTE);
  });

  it("writes markdown to correct vault path with content_hash", async () => {
    mockExtract(VALID_QUOTE);
    await ingestQuote(TENANT_ID, PDF_PATH, tools);

    const expectedPath = `tenants/${TENANT_ID}/quotes/${VALID_QUOTE.id}.md`;
    expect(tools.vault.write).toHaveBeenCalledWith(
      expectedPath,
      expect.any(Buffer),
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
  });

  it("written markdown includes YAML frontmatter with quote fields", async () => {
    mockExtract(VALID_QUOTE);
    await ingestQuote(TENANT_ID, PDF_PATH, tools);

    const [, bytes] = vi.mocked(tools.vault.write).mock.calls[0];
    const markdown = (bytes as Buffer).toString("utf8");
    expect(markdown).toContain(`id: ${VALID_QUOTE.id}`);
    expect(markdown).toContain(`tenant_id: ${TENANT_ID}`);
    expect(markdown).toContain("content_hash:");
    expect(markdown).toContain("```json");
  });

  it("appends quote_ingested event with correct fields", async () => {
    mockExtract(VALID_QUOTE);
    await ingestQuote(TENANT_ID, PDF_PATH, tools);

    expect(tools.vault.append_event).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "quote_ingested",
        aggregate_id: VALID_QUOTE.id,
        aggregate_type: "quote",
        tenant_id: TENANT_ID,
      })
    );
  });

  it("calls cache.rebuild with tenant_id", async () => {
    mockExtract(VALID_QUOTE);
    await ingestQuote(TENANT_ID, PDF_PATH, tools);
    expect(tools.cache.rebuild).toHaveBeenCalledWith(TENANT_ID);
  });

  it("throws SchemaValidationError and appends failure event on invalid schema", async () => {
    mockExtract({ invalid: true }, 0.1);

    await expect(ingestQuote(TENANT_ID, PDF_PATH, tools)).rejects.toBeInstanceOf(SchemaValidationError);

    expect(tools.vault.write).not.toHaveBeenCalled();
    expect(tools.vault.append_event).toHaveBeenCalledWith(
      expect.objectContaining({ type: "quote_validation_failed" })
    );
    expect(tools.cache.rebuild).not.toHaveBeenCalled();
  });

  it("SchemaValidationError carries Zod issues", async () => {
    mockExtract({ invalid: true }, 0.1);

    const err = await ingestQuote(TENANT_ID, PDF_PATH, tools).catch(e => e);
    expect(err).toBeInstanceOf(SchemaValidationError);
    expect((err as SchemaValidationError).issues.length).toBeGreaterThan(0);
  });

  it("throws SchemaValidationError on line item consistency mismatch", async () => {
    const badQuote: Quote = {
      ...VALID_QUOTE,
      line_items: [{ ...VALID_QUOTE.line_items[0], total_cost: 999.00 }],
    };
    mockExtract(badQuote, 0.9);

    await expect(ingestQuote(TENANT_ID, PDF_PATH, tools)).rejects.toBeInstanceOf(SchemaValidationError);

    expect(tools.vault.write).not.toHaveBeenCalled();
    expect(tools.vault.append_event).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "quote_validation_failed",
        aggregate_id: VALID_QUOTE.id,
      })
    );
  });

  it("content_hash is deterministic for identical line items", async () => {
    mockExtract(VALID_QUOTE);
    await ingestQuote(TENANT_ID, PDF_PATH, tools);
    const [, , hash1] = vi.mocked(tools.vault.write).mock.calls[0];

    vi.mocked(tools.vault.write).mockClear();
    mockExtract(VALID_QUOTE);
    await ingestQuote(TENANT_ID, PDF_PATH, tools);
    const [, , hash2] = vi.mocked(tools.vault.write).mock.calls[0];

    expect(hash1).toBe(hash2);
  });
});
