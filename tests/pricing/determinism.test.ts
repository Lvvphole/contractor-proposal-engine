import { describe, expect, it } from "vitest";
import { computePricing, type PricingConfig } from "../../orchestrator/pricing";
import { QuoteSchema } from "../../lib/schemas";
import fixtureJson from "../fixtures/sample-quote.json";

const quote = QuoteSchema.parse(fixtureJson);

const config: PricingConfig = {
  default_margin_percent: 25,
  category_overrides: {
    lumber:     20,
    roofing:    30,
    electrical: 35,
    plumbing:   35,
    paint:      25,
    hardware:   20,
    flooring:   25,
  },
  deposit_percent:  30,
  tax_rate_override: 8,
};

describe("computePricing determinism", () => {
  it("produces JSON-identical output across 100 runs", () => {
    const first = JSON.stringify(computePricing(quote, config));
    for (let i = 1; i < 100; i++) {
      expect(JSON.stringify(computePricing(quote, config))).toBe(first);
    }
  });
});
