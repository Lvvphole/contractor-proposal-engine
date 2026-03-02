/**
 * Pricing engine unit tests.
 * All numeric assertions use exact values — no fuzzy matching.
 */
import { describe, expect, it } from "vitest";
import { computePricing, PricingError, type PricingConfig } from "../../orchestrator/pricing";
import type { Quote } from "../../lib/schemas";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id:          "550e8400-e29b-41d4-a716-446655440000",
    tenant_id:   "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    created_at:  "2024-01-15T10:00:00.000Z",
    status:      "draft",
    source_file: "vault/tenants/abc/inbox/pdf/receipt.pdf",
    line_items:  [],
    subtotal:    0,
    tax:         0,
    total:       0,
    ...overrides,
  };
}

type Category = "lumber" | "roofing" | "electrical" | "plumbing" | "concrete" | "paint" | "hardware" | "flooring" | "other";

function item(description: string, total_cost: number, category: Category) {
  return { description, quantity: 1, unit: "each", unit_cost: total_cost, total_cost, category };
}

// ---------------------------------------------------------------------------
// 1. Basic 25% margin applied uniformly
// ---------------------------------------------------------------------------
it("1. applies 25% default margin uniformly across all line items", () => {
  // sell_price = 45 / (1 − 0.25) = 45 / 0.75 = 60.00
  const quote = makeQuote({ line_items: [item("Stud", 45.00, "lumber")], subtotal: 45.00, total: 45.00 });
  const config: PricingConfig = { default_margin_percent: 25, category_overrides: {}, deposit_percent: 30 };

  const result = computePricing(quote, config);

  expect(result.line_items[0].cost).toBe(45.00);
  expect(result.line_items[0].margin_pct).toBe(0.25);
  expect(result.line_items[0].price).toBe(60.00);
  expect(result.materials_total).toBe(60.00);
  expect(result.tax).toBe(0);
  expect(result.proposal_total).toBe(60.00);
  expect(result.deposit_amount).toBe(18.00);
});

// ---------------------------------------------------------------------------
// 2. Category overrides: lumber=20%, paint=35%
// ---------------------------------------------------------------------------
it("2. applies per-category margin overrides independently of the default", () => {
  // lumber: 45 / 0.80 = 56.25  (exact: 225/4)
  // paint:  30 / 0.65 = 46.153... → 46.15
  // materials_total = round2(56.25 + 46.15) = 102.40
  // deposit = round2(102.40 × 0.30) = 30.72
  const quote = makeQuote({
    line_items: [item("Lumber", 45.00, "lumber"), item("Paint", 30.00, "paint")],
    subtotal: 75.00,
    total: 75.00,
  });
  const config: PricingConfig = {
    default_margin_percent: 25,
    category_overrides: { lumber: 20, paint: 35 },
    deposit_percent: 30,
  };

  const result = computePricing(quote, config);

  expect(result.line_items[0].margin_pct).toBe(0.20);
  expect(result.line_items[0].price).toBe(56.25);
  expect(result.line_items[1].margin_pct).toBe(0.35);
  expect(result.line_items[1].price).toBe(46.15);
  expect(result.materials_total).toBe(102.40);
  expect(result.tax).toBe(0);
  expect(result.proposal_total).toBe(102.40);
  expect(result.deposit_amount).toBe(30.72);
});

// ---------------------------------------------------------------------------
// 3. Zero margin: sell_price equals cost exactly
// ---------------------------------------------------------------------------
it("3. at zero margin the sell price equals the cost exactly", () => {
  // sell_price = 100 / (1 − 0) = 100.00
  const quote = makeQuote({ line_items: [item("Concrete", 100.00, "concrete")], subtotal: 100.00, total: 100.00 });
  const config: PricingConfig = { default_margin_percent: 0, category_overrides: {}, deposit_percent: 50 };

  const result = computePricing(quote, config);

  expect(result.line_items[0].cost).toBe(100.00);
  expect(result.line_items[0].margin_pct).toBe(0);
  expect(result.line_items[0].price).toBe(100.00);
  expect(result.materials_total).toBe(100.00);
  expect(result.proposal_total).toBe(100.00);
  expect(result.deposit_amount).toBe(50.00);
});

// ---------------------------------------------------------------------------
// 4. Rounding precision on fractional cents
// ---------------------------------------------------------------------------
it("4. rounds prices to exactly 2 decimal places (rounds down and rounds up)", () => {
  // lumber:     2.00 / 0.75 = 2.666... → 2.67  (rounds UP)
  // electrical: 10.00 / 0.65 = 15.384... → 15.38 (rounds DOWN)
  // materials_total = round2(2.67 + 15.38) = 18.05
  const quote = makeQuote({
    line_items: [item("Stud", 2.00, "lumber"), item("Wire", 10.00, "electrical")],
    subtotal: 12.00,
    total: 12.00,
  });
  const config: PricingConfig = {
    default_margin_percent: 25,
    category_overrides: { electrical: 35 },
    deposit_percent: 30,
  };

  const result = computePricing(quote, config);

  expect(result.line_items[0].price).toBe(2.67);
  expect(result.line_items[1].price).toBe(15.38);
  expect(result.materials_total).toBe(18.05);
});

// ---------------------------------------------------------------------------
// 5. Numeric consistency: materials_total == sum of extended_sell
// ---------------------------------------------------------------------------
it("5. materials_total equals the exact sum of all line item prices", () => {
  // 4 × $30.00 @ 25%: price = 30 / 0.75 = 40.00 (exact, no rounding needed)
  // sum = 4 × 40.00 = 160.00; materials_total = round2(160.00) = 160.00
  const quote = makeQuote({
    line_items: [
      item("Board", 30.00, "lumber"),
      item("Board", 30.00, "lumber"),
      item("Board", 30.00, "lumber"),
      item("Board", 30.00, "lumber"),
    ],
    subtotal: 120.00,
    total: 120.00,
  });
  const config: PricingConfig = { default_margin_percent: 25, category_overrides: {}, deposit_percent: 30 };

  const result = computePricing(quote, config);
  const priceSum = result.line_items.reduce((acc, li) => acc + li.price, 0);

  expect(result.line_items[0].price).toBe(40.00);
  expect(priceSum).toBe(160.00);
  expect(result.materials_total).toBe(160.00);
  expect(result.materials_total).toBe(priceSum);
});

// ---------------------------------------------------------------------------
// 6. Invalid margin (negative) throws PricingError
// ---------------------------------------------------------------------------
it("6. throws PricingError when default_margin_percent is negative", () => {
  const quote = makeQuote({ line_items: [item("Stud", 45.00, "lumber")], subtotal: 45.00, total: 45.00 });
  const config: PricingConfig = { default_margin_percent: -1, category_overrides: {}, deposit_percent: 30 };

  expect(() => computePricing(quote, config)).toThrow(PricingError);
  expect(() => computePricing(quote, config)).toThrow(/margin_percent/);
});

// ---------------------------------------------------------------------------
// 7. Invalid margin (>100%) throws PricingError
// ---------------------------------------------------------------------------
it("7. throws PricingError when default_margin_percent exceeds 100", () => {
  const quote = makeQuote({ line_items: [item("Stud", 45.00, "lumber")], subtotal: 45.00, total: 45.00 });
  const config: PricingConfig = { default_margin_percent: 101, category_overrides: {}, deposit_percent: 30 };

  expect(() => computePricing(quote, config)).toThrow(PricingError);
  expect(() => computePricing(quote, config)).toThrow(/margin_percent/);
});

// ---------------------------------------------------------------------------
// 8. Single line item — all five outputs verified precisely
// ---------------------------------------------------------------------------
it("8. single line item produces correct line_items, totals, and deposit", () => {
  // sell_price = 80 / 0.80 = 100.00
  const quote = makeQuote({ line_items: [item("Lumber", 80.00, "lumber")], subtotal: 80.00, total: 80.00 });
  const config: PricingConfig = { default_margin_percent: 20, category_overrides: {}, deposit_percent: 50 };

  const result = computePricing(quote, config);

  expect(result.line_items).toHaveLength(1);
  expect(result.line_items[0].description).toBe("Lumber");
  expect(result.line_items[0].category).toBe("lumber");
  expect(result.line_items[0].cost).toBe(80.00);
  expect(result.line_items[0].margin_pct).toBe(0.20);
  expect(result.line_items[0].price).toBe(100.00);
  expect(result.materials_total).toBe(100.00);
  expect(result.tax).toBe(0);
  expect(result.proposal_total).toBe(100.00);
  expect(result.deposit_amount).toBe(50.00);
});

// ---------------------------------------------------------------------------
// 9. 50 line items — verify totals accumulate correctly
// ---------------------------------------------------------------------------
it("9. correctly accumulates totals across 50 line items", () => {
  // 50 × $12.00 @ 20%: price = 12 / 0.80 = 15.00 (exact)
  // materials_total = 750.00; tax = 750.00 × 0.08 = 60.00
  // proposal_total = 810.00; deposit = 810.00 × 0.30 = 243.00
  const quote = makeQuote({
    line_items: Array.from({ length: 50 }, () => item("Board", 12.00, "lumber")),
    subtotal: 600.00,
    tax: 0,
    total: 600.00,
  });
  const config: PricingConfig = {
    default_margin_percent: 20,
    category_overrides: {},
    deposit_percent: 30,
    tax_rate_override: 8,
  };

  const result = computePricing(quote, config);

  expect(result.line_items).toHaveLength(50);
  expect(result.line_items[0].price).toBe(15.00);
  expect(result.materials_total).toBe(750.00);
  expect(result.tax).toBe(60.00);
  expect(result.proposal_total).toBe(810.00);
  expect(result.deposit_amount).toBe(243.00);
});

// ---------------------------------------------------------------------------
// 10. Tax rate override vs. pass-through supplier tax
// ---------------------------------------------------------------------------
describe("10. tax: rate override vs. supplier pass-through", () => {
  // sell_price = 45 / 0.75 = 60.00; materials_total = 60.00
  const lineItems = [item("Stud", 45.00, "lumber")];
  const baseConfig: PricingConfig = {
    default_margin_percent: 25,
    category_overrides: {},
    deposit_percent: 30,
  };

  it("applies tax_rate_override to materials_total, ignoring quote.tax", () => {
    // override=10%: tax = 60.00 × 0.10 = 6.00 (quote.tax of 5.00 is ignored)
    const quote = makeQuote({ line_items: lineItems, subtotal: 45.00, tax: 5.00, total: 50.00 });
    const result = computePricing(quote, { ...baseConfig, tax_rate_override: 10 });

    expect(result.materials_total).toBe(60.00);
    expect(result.tax).toBe(6.00);
    expect(result.proposal_total).toBe(66.00);
    expect(result.deposit_amount).toBe(19.80);
  });

  it("passes through supplier tax from quote.tax when no override is given", () => {
    // no override: tax = quote.tax = 5.00
    const quote = makeQuote({ line_items: lineItems, subtotal: 45.00, tax: 5.00, total: 50.00 });
    const result = computePricing(quote, baseConfig);

    expect(result.materials_total).toBe(60.00);
    expect(result.tax).toBe(5.00);
    expect(result.proposal_total).toBe(65.00);
    expect(result.deposit_amount).toBe(19.50);
  });
});
