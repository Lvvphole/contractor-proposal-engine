import { describe, expect, it } from "vitest";
import { computePricing, PricingError, type PricingConfig } from "../../orchestrator/pricing";
import type { Quote } from "../../lib/schemas";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const BASE_CONFIG: PricingConfig = {
  default_margin_percent: 25,
  category_overrides: {},
  deposit_percent: 30,
};

const BASE_QUOTE: Quote = {
  id:          "550e8400-e29b-41d4-a716-446655440000",
  tenant_id:   "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  created_at:  "2024-01-15T10:00:00.000Z",
  status:      "draft",
  source_file: "vault/tenants/abc/inbox/pdf/receipt.pdf",
  line_items: [
    {
      description: "2x4x8 Stud",
      quantity:    10,
      unit:        "each",
      unit_cost:   4.50,
      total_cost:  45.00,
      category:    "lumber",
    },
  ],
  subtotal: 45.00,
  tax:      3.60,
  total:    48.60,
};

// ---------------------------------------------------------------------------
// Line item pricing
// ---------------------------------------------------------------------------
describe("computePricing — line items", () => {
  it("applies default margin to compute sell price", () => {
    // sell_price = 45 / (1 - 0.25) = 60.00
    const result = computePricing(BASE_QUOTE, BASE_CONFIG);
    expect(result.line_items).toHaveLength(1);
    expect(result.line_items[0].cost).toBe(45.00);
    expect(result.line_items[0].margin_pct).toBe(0.25);
    expect(result.line_items[0].price).toBe(60.00);
  });

  it("applies category override when present", () => {
    const config: PricingConfig = { ...BASE_CONFIG, category_overrides: { lumber: 20 } };
    // sell_price = 45 / (1 - 0.20) = 56.25
    const result = computePricing(BASE_QUOTE, config);
    expect(result.line_items[0].margin_pct).toBe(0.20);
    expect(result.line_items[0].price).toBe(56.25);
  });

  it("falls back to default margin when category has no override", () => {
    const config: PricingConfig = { ...BASE_CONFIG, category_overrides: { electrical: 35 } };
    const result = computePricing(BASE_QUOTE, config);
    expect(result.line_items[0].margin_pct).toBe(0.25);
    expect(result.line_items[0].price).toBe(60.00);
  });

  it("preserves description and category on output line items", () => {
    const result = computePricing(BASE_QUOTE, BASE_CONFIG);
    expect(result.line_items[0].description).toBe("2x4x8 Stud");
    expect(result.line_items[0].category).toBe("lumber");
  });

  it("prices multiple line items independently with per-category overrides", () => {
    const quote: Quote = {
      ...BASE_QUOTE,
      line_items: [
        { description: "Lumber", quantity: 10, unit: "each", unit_cost: 4.50, total_cost: 45.00, category: "lumber" },
        { description: "Wire",   quantity: 1,  unit: "roll", unit_cost: 100.00, total_cost: 100.00, category: "electrical" },
      ],
      subtotal: 145.00,
      tax:      0,
      total:    145.00,
    };
    const config: PricingConfig = {
      default_margin_percent: 25,
      category_overrides: { electrical: 35 },
      deposit_percent: 30,
    };
    // lumber:      45 / 0.75 = 60.00
    // electrical: 100 / 0.65 = 153.85 (rounded)
    const result = computePricing(quote, config);
    expect(result.line_items[0].price).toBe(60.00);
    expect(result.line_items[1].price).toBe(parseFloat((100 / 0.65).toFixed(2)));
  });

  it("rounds individual prices to 2 decimal places", () => {
    const quote: Quote = {
      ...BASE_QUOTE,
      line_items: [
        { description: "Wire", quantity: 1, unit: "roll", unit_cost: 10.00, total_cost: 10.00, category: "electrical" },
      ],
      subtotal: 10.00,
      tax:      0,
      total:    10.00,
    };
    const config: PricingConfig = { ...BASE_CONFIG, category_overrides: { electrical: 35 } };
    // 10 / 0.65 = 15.384615... → 15.38
    const result = computePricing(quote, config);
    expect(result.line_items[0].price).toBe(15.38);
  });
});

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------
describe("computePricing — totals", () => {
  it("sets materials_total to the rounded sum of extended sell prices", () => {
    const result = computePricing(BASE_QUOTE, BASE_CONFIG);
    expect(result.materials_total).toBe(60.00);
  });

  it("applies tax_rate_override to materials_total", () => {
    const config: PricingConfig = { ...BASE_CONFIG, tax_rate_override: 8 };
    // tax = 60.00 * 0.08 = 4.80
    const result = computePricing(BASE_QUOTE, config);
    expect(result.tax).toBe(4.80);
  });

  it("defaults tax to 0 when tax_rate_override is absent", () => {
    const result = computePricing(BASE_QUOTE, BASE_CONFIG);
    expect(result.tax).toBe(0);
  });

  it("computes proposal_total as materials_total + tax", () => {
    const config: PricingConfig = { ...BASE_CONFIG, tax_rate_override: 8 };
    const result = computePricing(BASE_QUOTE, config);
    expect(result.proposal_total).toBe(64.80);
  });

  it("computes deposit_amount from proposal_total and deposit_percent", () => {
    // proposal_total = 60.00, deposit_percent = 30 → 18.00
    const result = computePricing(BASE_QUOTE, BASE_CONFIG);
    expect(result.deposit_amount).toBe(18.00);
  });

  it("rounds deposit_amount to 2 decimal places", () => {
    const quote: Quote = {
      ...BASE_QUOTE,
      line_items: [
        { description: "Wire", quantity: 1, unit: "roll", unit_cost: 10.00, total_cost: 10.00, category: "electrical" },
      ],
      subtotal: 10.00,
      tax:      0,
      total:    10.00,
    };
    const config: PricingConfig = {
      default_margin_percent: 25,
      category_overrides: { electrical: 35 },
      deposit_percent: 33,
    };
    const result = computePricing(quote, config);
    const decimals = result.deposit_amount.toString().split(".")[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Empty quote
// ---------------------------------------------------------------------------
describe("computePricing — empty quote", () => {
  it("returns zero totals for a quote with no line items", () => {
    const quote: Quote = { ...BASE_QUOTE, line_items: [], subtotal: 0, tax: 0, total: 0 };
    const result = computePricing(quote, BASE_CONFIG);
    expect(result.line_items).toEqual([]);
    expect(result.materials_total).toBe(0);
    expect(result.tax).toBe(0);
    expect(result.proposal_total).toBe(0);
    expect(result.deposit_amount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
describe("computePricing — PricingError", () => {
  it("throws PricingError when default_margin_percent < 0", () => {
    const config: PricingConfig = { ...BASE_CONFIG, default_margin_percent: -1 };
    expect(() => computePricing(BASE_QUOTE, config)).toThrow(PricingError);
  });

  it("throws PricingError when default_margin_percent > 100", () => {
    const config: PricingConfig = { ...BASE_CONFIG, default_margin_percent: 101 };
    expect(() => computePricing(BASE_QUOTE, config)).toThrow(PricingError);
  });

  it("throws PricingError when a category override is < 0", () => {
    const config: PricingConfig = { ...BASE_CONFIG, category_overrides: { lumber: -5 } };
    expect(() => computePricing(BASE_QUOTE, config)).toThrow(PricingError);
  });

  it("throws PricingError when a category override is > 100", () => {
    const config: PricingConfig = { ...BASE_CONFIG, category_overrides: { lumber: 150 } };
    expect(() => computePricing(BASE_QUOTE, config)).toThrow(PricingError);
  });

  it("error carries correct name and message", () => {
    const config: PricingConfig = { ...BASE_CONFIG, default_margin_percent: -1 };
    let caught: unknown;
    try { computePricing(BASE_QUOTE, config); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PricingError);
    expect((caught as PricingError).name).toBe("PricingError");
    expect((caught as PricingError).message).toMatch(/margin_percent/);
  });
});

// ---------------------------------------------------------------------------
// Determinism — 100 identical iterations
// ---------------------------------------------------------------------------
describe("computePricing — determinism", () => {
  it("produces identical output across 100 iterations", () => {
    const first = computePricing(BASE_QUOTE, BASE_CONFIG);
    for (let i = 0; i < 99; i++) {
      expect(computePricing(BASE_QUOTE, BASE_CONFIG)).toEqual(first);
    }
  });
});
