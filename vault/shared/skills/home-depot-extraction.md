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
