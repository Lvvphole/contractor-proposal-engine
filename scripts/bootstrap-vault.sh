#!/usr/bin/env bash
set -euo pipefail

chmod +x "$0"

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <tenant_id>" >&2
  exit 1
fi

TENANT_ID="$1"
UUID_REGEX='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

if [[ ! "$TENANT_ID" =~ $UUID_REGEX ]]; then
  echo "Error: tenant_id must be a valid UUID (e.g. 550e8400-e29b-41d4-a716-446655440000)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# vault/shared/schemas/
# ---------------------------------------------------------------------------
mkdir -p "$REPO_ROOT/vault/shared/schemas"

cat > "$REPO_ROOT/vault/shared/schemas/quote.json" << 'SCHEMA'
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "vault/shared/schemas/quote.json",
  "title": "Quote",
  "description": "Structured data extracted from a materials receipt or supplier invoice",
  "type": "object",
  "required": ["id", "tenant_id", "created_at", "status", "source_file", "line_items", "subtotal", "tax", "total"],
  "additionalProperties": false,
  "properties": {
    "id":          { "type": "string", "format": "uuid" },
    "tenant_id":   { "type": "string", "format": "uuid" },
    "created_at":  { "type": "string", "format": "date-time" },
    "status": {
      "type": "string",
      "enum": ["draft", "priced", "sent", "accepted", "rejected", "expired"]
    },
    "source_file": { "type": "string", "description": "Vault-relative path to the source PDF" },
    "supplier":    { "type": "string" },
    "line_items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["description", "quantity", "unit", "unit_cost", "total_cost", "category"],
        "additionalProperties": false,
        "properties": {
          "description": { "type": "string" },
          "quantity":    { "type": "number", "minimum": 0 },
          "unit":        { "type": "string" },
          "unit_cost":   { "type": "number", "minimum": 0 },
          "total_cost":  { "type": "number", "minimum": 0 },
          "category": {
            "type": "string",
            "enum": ["lumber", "roofing", "electrical", "plumbing", "concrete", "paint", "hardware", "flooring", "other"]
          },
          "sku": { "type": "string" }
        }
      }
    },
    "subtotal": { "type": "number", "minimum": 0 },
    "tax":      { "type": "number", "minimum": 0 },
    "total":    { "type": "number", "minimum": 0 }
  }
}
SCHEMA

cat > "$REPO_ROOT/vault/shared/schemas/proposal.json" << 'SCHEMA'
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "vault/shared/schemas/proposal.json",
  "title": "Proposal",
  "description": "Formal contractor proposal document delivered to a client",
  "type": "object",
  "required": ["id", "tenant_id", "quote_id", "created_at", "status", "client", "line_items", "subtotal", "margin_total", "total"],
  "additionalProperties": false,
  "properties": {
    "id":          { "type": "string", "format": "uuid" },
    "tenant_id":   { "type": "string", "format": "uuid" },
    "quote_id":    { "type": "string", "format": "uuid" },
    "created_at":  { "type": "string", "format": "date-time" },
    "expires_at":  { "type": "string", "format": "date-time" },
    "status": {
      "type": "string",
      "enum": ["draft", "sent", "viewed", "accepted", "rejected", "expired", "paid"]
    },
    "client": {
      "type": "object",
      "required": ["name", "email"],
      "additionalProperties": false,
      "properties": {
        "name":    { "type": "string" },
        "email":   { "type": "string", "format": "email" },
        "phone":   { "type": "string" },
        "address": { "type": "string" }
      }
    },
    "project_description": { "type": "string" },
    "line_items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["description", "cost", "margin_pct", "price"],
        "additionalProperties": false,
        "properties": {
          "description": { "type": "string" },
          "category":    { "type": "string" },
          "cost":        { "type": "number", "minimum": 0 },
          "margin_pct":  { "type": "number", "minimum": 0, "maximum": 1 },
          "price":       { "type": "number", "minimum": 0 }
        }
      }
    },
    "subtotal":           { "type": "number", "minimum": 0 },
    "margin_total":       { "type": "number", "minimum": 0 },
    "total":              { "type": "number", "minimum": 0 },
    "deposit_pct":        { "type": "number", "minimum": 0, "maximum": 1 },
    "deposit_amount":     { "type": "number", "minimum": 0 },
    "stripe_payment_link":{ "type": "string", "format": "uri" },
    "public_token":       { "type": "string" }
  }
}
SCHEMA

cat > "$REPO_ROOT/vault/shared/schemas/event.json" << 'SCHEMA'
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "vault/shared/schemas/event.json",
  "title": "Event",
  "description": "Immutable event appended to the event log on every state mutation",
  "type": "object",
  "required": ["id", "tenant_id", "type", "aggregate_id", "aggregate_type", "payload", "created_at"],
  "additionalProperties": false,
  "properties": {
    "id":             { "type": "string", "format": "uuid" },
    "tenant_id":      { "type": "string", "format": "uuid" },
    "type":           { "type": "string", "description": "SCREAMING_SNAKE_CASE, e.g. QUOTE_CREATED" },
    "aggregate_id":   { "type": "string", "format": "uuid" },
    "aggregate_type": { "type": "string", "enum": ["quote", "proposal", "payment"] },
    "payload":        { "type": "object", "description": "Event-specific data; shape is determined by type" },
    "created_at":     { "type": "string", "format": "date-time" },
    "actor":          { "type": "string", "description": "Clerk user_id or 'system'" }
  }
}
SCHEMA

cat > "$REPO_ROOT/vault/shared/schemas/payment.json" << 'SCHEMA'
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "vault/shared/schemas/payment.json",
  "title": "Payment",
  "description": "Payment record created from a Stripe Checkout webhook event",
  "type": "object",
  "required": ["id", "tenant_id", "proposal_id", "mode", "amount", "currency", "status", "stripe_session_id", "created_at"],
  "additionalProperties": false,
  "properties": {
    "id":                       { "type": "string", "format": "uuid" },
    "tenant_id":                { "type": "string", "format": "uuid" },
    "proposal_id":              { "type": "string", "format": "uuid" },
    "mode":                     { "type": "string", "enum": ["deposit", "full"] },
    "amount":                   { "type": "number", "minimum": 0, "description": "Dollars with 2 decimal places" },
    "currency":                 { "type": "string", "default": "usd" },
    "status":                   { "type": "string", "enum": ["pending", "succeeded", "failed", "refunded"] },
    "stripe_session_id":        { "type": "string" },
    "stripe_payment_intent_id": { "type": "string" },
    "created_at":               { "type": "string", "format": "date-time" },
    "completed_at":             { "type": "string", "format": "date-time" }
  }
}
SCHEMA

# ---------------------------------------------------------------------------
# vault/shared/skills/
# ---------------------------------------------------------------------------
mkdir -p "$REPO_ROOT/vault/shared/skills"

cat > "$REPO_ROOT/vault/shared/skills/home-depot-extraction.md" << 'SKILL'
# Home Depot Receipt Extraction Skill

Extract structured line-item data from a Home Depot receipt or invoice PDF.

## Output Format

Return a single JSON object that conforms to `vault/shared/schemas/quote.json`.
All monetary values must use exactly 2 decimal places.

## Extraction Rules

- Extract every line item present on the receipt. Do not omit items.
- Map each item to exactly one category: lumber, roofing, electrical, plumbing, concrete, paint, hardware, flooring, other.
- `unit_cost` is the per-unit shelf price. `total_cost` = `unit_cost × quantity`, rounded to 2 decimal places.
- `subtotal` is the sum of all `total_cost` values before tax.
- `tax` is the tax amount as printed on the receipt.
- `total` = `subtotal + tax`, rounded to 2 decimal places.
- `sku` is the 12-digit item number printed on the receipt; omit the field entirely if absent.
- `supplier` is always `"Home Depot"` for this skill.
- Do not invent fields not defined in the schema. Do not include fields whose value would be null.

## Category Mapping

| Category    | Examples                                                       |
|-------------|----------------------------------------------------------------|
| lumber      | 2x4, plywood, OSB, dimensional lumber, trim boards, MDF       |
| roofing     | shingles, felt paper, drip edge, flashing, roofing nails      |
| electrical  | wire, conduit, outlets, breakers, junction boxes, cable       |
| plumbing    | pipe, fittings, valves, connectors, plumber's tape, sealant   |
| concrete    | bags, premix, rebar, wire mesh, concrete forms                |
| paint       | paint, primer, caulk, brushes, rollers, painter's tape        |
| hardware    | screws, bolts, anchors, brackets, hinges, door hardware       |
| flooring    | tile, grout, underlayment, adhesive, transition strips        |
| other       | anything that does not fit the above categories               |

## Error Condition

If the document is not a Home Depot receipt or cannot be read, return:

```json
{ "error": "not_a_home_depot_receipt", "reason": "<brief explanation>" }
```
SKILL

# ---------------------------------------------------------------------------
# vault/shared/golden_corpus/
# ---------------------------------------------------------------------------
mkdir -p "$REPO_ROOT/vault/shared/golden_corpus"

cat > "$REPO_ROOT/vault/shared/golden_corpus/README.md" << 'DOC'
# Golden Corpus

Reference PDFs and their expected extraction outputs used for regression testing.

## Structure

Each test case is a subdirectory named after the bug or feature it covers:

```
golden_corpus/
  {case-slug}/
    input.pdf        # Source document
    expected.json    # Expected extraction output (must pass quote.json schema)
    notes.md         # Optional: description of the edge case
```

## Rules

- Every extraction bug fix must add a new case before the fix is merged.
- `expected.json` must validate against `vault/shared/schemas/quote.json`.
- Do not modify an existing case without updating both `input.pdf` and `expected.json` together.
- Cases run automatically in CI via `tests/golden-corpus/`.
DOC

# ---------------------------------------------------------------------------
# vault/tenants/{tenant_id}/
# ---------------------------------------------------------------------------
mkdir -p \
  "$REPO_ROOT/vault/tenants/$TENANT_ID/inbox/pdf" \
  "$REPO_ROOT/vault/tenants/$TENANT_ID/docs" \
  "$REPO_ROOT/vault/tenants/$TENANT_ID/events" \
  "$REPO_ROOT/vault/tenants/$TENANT_ID/exports" \
  "$REPO_ROOT/vault/tenants/$TENANT_ID/config"

cat > "$REPO_ROOT/vault/tenants/$TENANT_ID/config/pricing.json" << 'CONFIG'
{
  "default_margin": 0.25,
  "category_overrides": {
    "lumber":     0.20,
    "roofing":    0.30,
    "electrical": 0.35,
    "plumbing":   0.35,
    "concrete":   0.20,
    "paint":      0.25,
    "hardware":   0.20,
    "flooring":   0.25
  }
}
CONFIG

echo "Vault bootstrapped for tenant $TENANT_ID"
