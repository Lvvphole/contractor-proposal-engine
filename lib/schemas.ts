import { z } from "zod";

// vault/shared/schemas/quote.json
export const QuoteLineItemSchema = z
  .object({
    description: z.string(),
    quantity:    z.number().min(0),
    unit:        z.string(),
    unit_cost:   z.number().min(0),
    total_cost:  z.number().min(0),
    category:    z.enum(["lumber", "roofing", "electrical", "plumbing", "concrete", "paint", "hardware", "flooring", "other"]),
    sku:         z.string().optional(),
  })
  .strict();

export type QuoteLineItem = z.infer<typeof QuoteLineItemSchema>;

// vault/shared/schemas/quote.json
export const QuoteSchema = z
  .object({
    id:          z.string().uuid(),
    tenant_id:   z.string().uuid(),
    created_at:  z.string().datetime(),
    status:      z.enum(["draft", "priced", "sent", "accepted", "rejected", "expired"]),
    source_file: z.string(),
    supplier:    z.string().optional(),
    line_items:  z.array(QuoteLineItemSchema),
    subtotal:    z.number().min(0),
    tax:         z.number().min(0),
    total:       z.number().min(0),
  })
  .strict();

export type Quote = z.infer<typeof QuoteSchema>;

// vault/shared/schemas/proposal.json
const ProposalClientSchema = z
  .object({
    name:    z.string(),
    email:   z.string().email(),
    phone:   z.string().optional(),
    address: z.string().optional(),
  })
  .strict();

// vault/shared/schemas/proposal.json
export const ProposalLineItemSchema = z
  .object({
    description: z.string(),
    category:    z.string().optional(),
    cost:        z.number().min(0),
    margin_pct:  z.number().min(0).max(1),
    price:       z.number().min(0),
  })
  .strict();

export type ProposalLineItem = z.infer<typeof ProposalLineItemSchema>;

// vault/shared/schemas/proposal.json
export const ProposalSchema = z
  .object({
    id:                   z.string().uuid(),
    tenant_id:            z.string().uuid(),
    quote_id:             z.string().uuid(),
    created_at:           z.string().datetime(),
    expires_at:           z.string().datetime().optional(),
    status:               z.enum(["draft", "sent", "viewed", "accepted", "rejected", "expired", "paid"]),
    client:               ProposalClientSchema,
    project_description:  z.string().optional(),
    line_items:           z.array(ProposalLineItemSchema),
    subtotal:             z.number().min(0),
    margin_total:         z.number().min(0),
    total:                z.number().min(0),
    deposit_pct:          z.number().min(0).max(1).optional(),
    deposit_amount:       z.number().min(0).optional(),
    stripe_payment_link:  z.string().url().optional(),
    public_token:         z.string().optional(),
  })
  .strict();

export type Proposal = z.infer<typeof ProposalSchema>;

// vault/shared/schemas/event.json
export const EventSchema = z
  .object({
    id:             z.string().uuid(),
    tenant_id:      z.string().uuid(),
    type:           z.string(),
    aggregate_id:   z.string().uuid(),
    aggregate_type: z.enum(["quote", "proposal", "payment"]),
    payload:        z.record(z.unknown()),
    created_at:     z.string().datetime(),
    actor:          z.string().optional(),
  })
  .strict();

export type Event = z.infer<typeof EventSchema>;

// vault/shared/schemas/payment.json
export const PaymentSchema = z
  .object({
    id:                       z.string().uuid(),
    tenant_id:                z.string().uuid(),
    proposal_id:              z.string().uuid(),
    mode:                     z.enum(["deposit", "full"]),
    amount:                   z.number().min(0),
    currency:                 z.string(),
    status:                   z.enum(["pending", "succeeded", "failed", "refunded"]),
    stripe_session_id:        z.string(),
    stripe_payment_intent_id: z.string().optional(),
    created_at:               z.string().datetime(),
    completed_at:             z.string().datetime().optional(),
  })
  .strict();

export type Payment = z.infer<typeof PaymentSchema>;
