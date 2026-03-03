/**
 * Golden corpus regression tests.
 *
 * For every case directory under vault/shared/golden_corpus/:
 *   1. Validates expected_quote.json against QuoteSchema
 *   2. Runs computePricing(quote, config) with the case's config.json
 *   3. Deep-equals the PricingResult against expected_proposal.json
 */
import { readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { describe, expect, it } from "vitest";

import { QuoteSchema } from "../../lib/schemas";
import { computePricing, type PricingConfig } from "../../orchestrator/pricing";

const CORPUS_DIR = resolve(__dirname, "../../vault/shared/golden_corpus");

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

const cases = readdirSync(CORPUS_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name);

describe("golden corpus regression", () => {
  it("has at least one test case", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const caseName of cases) {
    const caseDir = join(CORPUS_DIR, caseName);

    describe(caseName, () => {
      const rawQuote = readJson<unknown>(join(caseDir, "expected_quote.json"));
      const config   = readJson<PricingConfig>(join(caseDir, "config.json"));
      const expected = readJson<unknown>(join(caseDir, "expected_proposal.json"));

      it("expected_quote.json validates against QuoteSchema", () => {
        const result = QuoteSchema.safeParse(rawQuote);
        expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true);
      });

      it("computePricing output matches expected_proposal.json", () => {
        const quote = QuoteSchema.parse(rawQuote);
        const actual = computePricing(quote, config);
        expect(actual).toEqual(expected);
      });
    });
  }
});
