/**
 * Schema sync tests — verifies that each Zod schema in lib/schemas.ts
 * accepts and rejects exactly the same inputs as its canonical JSON Schema
 * counterpart in vault/shared/schemas/.
 */
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";

import {
  EventSchema,
  PaymentSchema,
  ProposalLineItemSchema,
  ProposalSchema,
  QuoteLineItemSchema,
  QuoteSchema,
} from "../lib/schemas";
import eventJson from "../vault/shared/schemas/event.json";
import paymentJson from "../vault/shared/schemas/payment.json";
import proposalJson from "../vault/shared/schemas/proposal.json";
import quoteJson from "../vault/shared/schemas/quote.json";

// ---------------------------------------------------------------------------
// AJV setup
// ---------------------------------------------------------------------------
const ajv = new Ajv({ strict: false });
addFormats(ajv);

const validateQuote         = ajv.compile(quoteJson);
const validateQuoteLineItem = ajv.compile(quoteJson.properties.line_items.items);
const validateProposal      = ajv.compile(proposalJson);
const validateProposalLineItem = ajv.compile(proposalJson.properties.line_items.items);
const validateEvent         = ajv.compile(eventJson);
const validatePayment       = ajv.compile(paymentJson);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function expectBothAccept(validate: ValidateFunction, schema: ZodTypeAny, data: unknown): void {
  const ajvOk = validate(data);
  const zodResult = schema.safeParse(data);
  expect(ajvOk,          `AJV rejected: ${ajv.errorsText(validate.errors)}`).toBe(true);
  expect(zodResult.success, `Zod rejected: ${!zodResult.success ? JSON.stringify(zodResult.error.issues) : ""}`).toBe(true);
}

function expectBothReject(validate: ValidateFunction, schema: ZodTypeAny, data: unknown): void {
  const ajvOk = validate(data);
  const zodResult = schema.safeParse(data);
  expect(ajvOk,             "AJV accepted but should have rejected").toBe(false);
  expect(zodResult.success, "Zod accepted but should have rejected").toBe(false);
}

function without<T extends object>(obj: T, key: keyof T): Record<string, unknown> {
  const copy = { ...obj } as Record<string, unknown>;
  delete copy[key as string];
  return copy;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const QUOTE_LINE_ITEM = {
  description: "2x4x8 Stud",
  quantity:    10,
  unit:        "each",
  unit_cost:   4.50,
  total_cost:  45.00,
  category:    "lumber",
} as const;

const QUOTE_MIN = {
  id:          "550e8400-e29b-41d4-a716-446655440000",
  tenant_id:   "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  created_at:  "2024-01-15T10:00:00.000Z",
  status:      "draft",
  source_file: "vault/tenants/abc/inbox/pdf/receipt.pdf",
  line_items:  [],
  subtotal:    0,
  tax:         0,
  total:       0,
} as const;

const PROPOSAL_MIN = {
  id:           "550e8400-e29b-41d4-a716-446655440000",
  tenant_id:    "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  quote_id:     "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  created_at:   "2024-01-15T10:00:00.000Z",
  status:       "draft",
  client:       { name: "Jane Smith", email: "jane@example.com" },
  line_items:   [],
  subtotal:     0,
  margin_total: 0,
  total:        0,
} as const;

const EVENT_MIN = {
  id:             "550e8400-e29b-41d4-a716-446655440000",
  tenant_id:      "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  type:           "QUOTE_CREATED",
  aggregate_id:   "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  aggregate_type: "quote",
  payload:        { quoteId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
  created_at:     "2024-01-15T10:00:00.000Z",
} as const;

const PAYMENT_MIN = {
  id:                "550e8400-e29b-41d4-a716-446655440000",
  tenant_id:         "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  proposal_id:       "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  mode:              "deposit",
  amount:            500.00,
  currency:          "usd",
  status:            "pending",
  stripe_session_id: "cs_test_abc123",
  created_at:        "2024-01-15T10:00:00.000Z",
} as const;

// ---------------------------------------------------------------------------
// quote.json / QuoteSchema
// ---------------------------------------------------------------------------
describe("schema sync: quote", () => {
  describe("valid inputs", () => {
    it("accepts a minimal valid quote", () => {
      expectBothAccept(validateQuote, QuoteSchema, QUOTE_MIN);
    });

    it("accepts a quote with all optional fields", () => {
      expectBothAccept(validateQuote, QuoteSchema, {
        ...QUOTE_MIN,
        supplier:   "Home Depot",
        line_items: [{ ...QUOTE_LINE_ITEM, sku: "123456789012" }],
        subtotal:   45.00,
        tax:        3.60,
        total:      48.60,
      });
    });

    it("accepts a line item without optional sku", () => {
      expectBothAccept(validateQuoteLineItem, QuoteLineItemSchema, QUOTE_LINE_ITEM);
    });

    it("accepts every valid status value", () => {
      for (const status of ["draft", "priced", "sent", "accepted", "rejected", "expired"] as const) {
        expectBothAccept(validateQuote, QuoteSchema, { ...QUOTE_MIN, status });
      }
    });

    it("accepts every valid category value", () => {
      const categories = ["lumber", "roofing", "electrical", "plumbing", "concrete", "paint", "hardware", "flooring", "other"] as const;
      for (const category of categories) {
        expectBothAccept(validateQuoteLineItem, QuoteLineItemSchema, { ...QUOTE_LINE_ITEM, category });
      }
    });
  });

  describe("invalid inputs", () => {
    it("rejects a quote missing a required field (status)", () => {
      expectBothReject(validateQuote, QuoteSchema, without(QUOTE_MIN, "status"));
    });

    it("rejects an invalid status enum value", () => {
      expectBothReject(validateQuote, QuoteSchema, { ...QUOTE_MIN, status: "pending" });
    });

    it("rejects an extra unknown top-level property", () => {
      expectBothReject(validateQuote, QuoteSchema, { ...QUOTE_MIN, foo: "bar" });
    });

    it("rejects a malformed uuid for id", () => {
      expectBothReject(validateQuote, QuoteSchema, { ...QUOTE_MIN, id: "not-a-uuid" });
    });

    it("rejects a malformed date-time for created_at", () => {
      expectBothReject(validateQuote, QuoteSchema, { ...QUOTE_MIN, created_at: "not-a-date" });
    });

    it("rejects a negative quantity in a line item", () => {
      expectBothReject(validateQuote, QuoteSchema, {
        ...QUOTE_MIN,
        line_items: [{ ...QUOTE_LINE_ITEM, quantity: -1 }],
      });
    });

    it("rejects an invalid category in a line item", () => {
      expectBothReject(validateQuote, QuoteSchema, {
        ...QUOTE_MIN,
        line_items: [{ ...QUOTE_LINE_ITEM, category: "tools" }],
      });
    });

    it("rejects an extra field in a line item", () => {
      expectBothReject(validateQuote, QuoteLineItemSchema, { ...QUOTE_LINE_ITEM, extra: true });
    });
  });
});

// ---------------------------------------------------------------------------
// proposal.json / ProposalSchema
// ---------------------------------------------------------------------------
describe("schema sync: proposal", () => {
  describe("valid inputs", () => {
    it("accepts a minimal valid proposal", () => {
      expectBothAccept(validateProposal, ProposalSchema, PROPOSAL_MIN);
    });

    it("accepts a proposal with all optional fields", () => {
      expectBothAccept(validateProposal, ProposalSchema, {
        ...PROPOSAL_MIN,
        expires_at:          "2024-02-15T10:00:00.000Z",
        project_description: "Deck rebuild",
        client:              { name: "Jane Smith", email: "jane@example.com", phone: "555-1234", address: "123 Main St" },
        line_items:          [{ description: "Lumber", cost: 100, margin_pct: 0.25, price: 125, category: "lumber" }],
        subtotal:            100,
        margin_total:        25,
        total:               125,
        deposit_pct:         0.5,
        deposit_amount:      62.50,
        stripe_payment_link: "https://buy.stripe.com/test_abc",
        public_token:        "tok_abc123",
      });
    });

    it("accepts a proposal line item without optional category", () => {
      expectBothAccept(validateProposalLineItem, ProposalLineItemSchema, {
        description: "Labor",
        cost:        200,
        margin_pct:  0.25,
        price:       250,
      });
    });
  });

  describe("invalid inputs", () => {
    it("rejects a proposal missing a required field (quote_id)", () => {
      expectBothReject(validateProposal, ProposalSchema, without(PROPOSAL_MIN, "quote_id"));
    });

    it("rejects an invalid status enum value", () => {
      expectBothReject(validateProposal, ProposalSchema, { ...PROPOSAL_MIN, status: "cancelled" });
    });

    it("rejects a client missing required email", () => {
      expectBothReject(validateProposal, ProposalSchema, {
        ...PROPOSAL_MIN,
        client: { name: "Jane Smith" },
      });
    });

    it("rejects an invalid email format in client", () => {
      expectBothReject(validateProposal, ProposalSchema, {
        ...PROPOSAL_MIN,
        client: { name: "Jane Smith", email: "not-an-email" },
      });
    });

    it("rejects an extra unknown top-level property", () => {
      expectBothReject(validateProposal, ProposalSchema, { ...PROPOSAL_MIN, extra: true });
    });

    it("rejects an extra field in client", () => {
      expectBothReject(validateProposal, ProposalSchema, {
        ...PROPOSAL_MIN,
        client: { name: "Jane Smith", email: "jane@example.com", extra: true },
      });
    });

    it("rejects a margin_pct greater than 1", () => {
      expectBothReject(validateProposal, ProposalLineItemSchema, {
        description: "Lumber",
        cost:        100,
        margin_pct:  1.5,
        price:       250,
      });
    });

    it("rejects an invalid stripe_payment_link URI", () => {
      expectBothReject(validateProposal, ProposalSchema, {
        ...PROPOSAL_MIN,
        stripe_payment_link: "not-a-url",
      });
    });
  });
});

// ---------------------------------------------------------------------------
// event.json / EventSchema
// ---------------------------------------------------------------------------
describe("schema sync: event", () => {
  describe("valid inputs", () => {
    it("accepts a minimal valid event", () => {
      expectBothAccept(validateEvent, EventSchema, EVENT_MIN);
    });

    it("accepts an event with optional actor field", () => {
      expectBothAccept(validateEvent, EventSchema, { ...EVENT_MIN, actor: "user_clerk_123" });
    });

    it("accepts every valid aggregate_type value", () => {
      for (const aggregate_type of ["quote", "proposal", "payment"] as const) {
        expectBothAccept(validateEvent, EventSchema, { ...EVENT_MIN, aggregate_type });
      }
    });

    it("accepts an open-ended payload object", () => {
      expectBothAccept(validateEvent, EventSchema, {
        ...EVENT_MIN,
        payload: { foo: "bar", nested: { a: 1 }, arr: [1, 2] },
      });
    });
  });

  describe("invalid inputs", () => {
    it("rejects an event missing a required field (type)", () => {
      expectBothReject(validateEvent, EventSchema, without(EVENT_MIN, "type"));
    });

    it("rejects an invalid aggregate_type enum value", () => {
      expectBothReject(validateEvent, EventSchema, { ...EVENT_MIN, aggregate_type: "invoice" });
    });

    it("rejects a non-object payload", () => {
      expectBothReject(validateEvent, EventSchema, { ...EVENT_MIN, payload: "string-payload" });
    });

    it("rejects an extra unknown top-level property", () => {
      expectBothReject(validateEvent, EventSchema, { ...EVENT_MIN, extra: true });
    });

    it("rejects a malformed uuid for aggregate_id", () => {
      expectBothReject(validateEvent, EventSchema, { ...EVENT_MIN, aggregate_id: "not-a-uuid" });
    });
  });
});

// ---------------------------------------------------------------------------
// payment.json / PaymentSchema
// ---------------------------------------------------------------------------
describe("schema sync: payment", () => {
  describe("valid inputs", () => {
    it("accepts a minimal valid payment", () => {
      expectBothAccept(validatePayment, PaymentSchema, PAYMENT_MIN);
    });

    it("accepts a payment with all optional fields", () => {
      expectBothAccept(validatePayment, PaymentSchema, {
        ...PAYMENT_MIN,
        stripe_payment_intent_id: "pi_test_abc123",
        completed_at:             "2024-01-15T10:05:00.000Z",
      });
    });

    it("accepts both mode values", () => {
      expectBothAccept(validatePayment, PaymentSchema, { ...PAYMENT_MIN, mode: "deposit" });
      expectBothAccept(validatePayment, PaymentSchema, { ...PAYMENT_MIN, mode: "full" });
    });

    it("accepts every valid status value", () => {
      for (const status of ["pending", "succeeded", "failed", "refunded"] as const) {
        expectBothAccept(validatePayment, PaymentSchema, { ...PAYMENT_MIN, status });
      }
    });
  });

  describe("invalid inputs", () => {
    it("rejects a payment missing a required field (stripe_session_id)", () => {
      expectBothReject(validatePayment, PaymentSchema, without(PAYMENT_MIN, "stripe_session_id"));
    });

    it("rejects an invalid mode enum value", () => {
      expectBothReject(validatePayment, PaymentSchema, { ...PAYMENT_MIN, mode: "partial" });
    });

    it("rejects a negative amount", () => {
      expectBothReject(validatePayment, PaymentSchema, { ...PAYMENT_MIN, amount: -1 });
    });

    it("rejects an invalid status enum value", () => {
      expectBothReject(validatePayment, PaymentSchema, { ...PAYMENT_MIN, status: "cancelled" });
    });

    it("rejects an extra unknown top-level property", () => {
      expectBothReject(validatePayment, PaymentSchema, { ...PAYMENT_MIN, extra: true });
    });

    it("rejects a malformed date-time for completed_at", () => {
      expectBothReject(validatePayment, PaymentSchema, { ...PAYMENT_MIN, completed_at: "2024-01-15" });
    });
  });
});
