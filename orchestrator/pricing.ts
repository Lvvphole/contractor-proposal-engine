import type { Quote, QuoteLineItem, ProposalLineItem } from "../lib/schemas";

export type PricingConfig = {
  default_margin_percent: number;
  category_overrides: Record<string, number>;
  deposit_percent: number;
  tax_rate_override?: number;
};

export type PricingResult = {
  line_items: ProposalLineItem[];
  materials_total: number;
  tax: number;
  proposal_total: number;
  deposit_amount: number;
};

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

function round2(n: number): number {
  return parseFloat(n.toFixed(2));
}

function assertValidMargin(margin: number, label: string): void {
  if (margin < 0 || margin > 100) {
    throw new PricingError(`${label}: margin_percent ${margin} must be in [0, 100]`);
  }
}

function resolveMargin(category: string, config: PricingConfig): number {
  return config.category_overrides[category] ?? config.default_margin_percent;
}

function buildLineItem(line: QuoteLineItem, config: PricingConfig): ProposalLineItem {
  const margin = resolveMargin(line.category, config);
  assertValidMargin(margin, line.category);
  return {
    description: line.description,
    category:    line.category,
    cost:        round2(line.total_cost),
    margin_pct:  margin / 100,
    price:       round2(line.total_cost / (1 - margin / 100)),
  };
}

export function computePricing(quote: Quote, config: PricingConfig): PricingResult {
  assertValidMargin(config.default_margin_percent, "default_margin_percent");
  for (const [cat, pct] of Object.entries(config.category_overrides)) {
    assertValidMargin(pct, `category_overrides.${cat}`);
  }

  const line_items = quote.line_items.map(line => buildLineItem(line, config));

  const sumExtendedSell = line_items.reduce((acc, li) => acc + li.price, 0);
  const materials_total = round2(sumExtendedSell);

  if (Math.abs(sumExtendedSell - materials_total) > 0.01) {
    throw new PricingError(
      `Consistency check failed: sum of extended_sell (${sumExtendedSell}) differs from materials_total (${materials_total}) by more than $0.01`
    );
  }

  const tax = config.tax_rate_override !== undefined
    ? round2(materials_total * config.tax_rate_override / 100)
    : round2(quote.tax);

  const proposal_total = round2(materials_total + tax);
  const deposit_amount = round2(proposal_total * config.deposit_percent / 100);

  return { line_items, materials_total, tax, proposal_total, deposit_amount };
}
