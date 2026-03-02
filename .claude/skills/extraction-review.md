---
name: extraction-review
description: Review and validate Claude extraction output against quote schema. Use when debugging extraction failures or adding golden corpus cases.
allowed-tools: [Read, Grep, Glob, Bash]
---

# Extraction Review

Compare the extraction output against vault/shared/schemas/quote.schema.json.

Check for:
1. Missing required fields
2. Numeric consistency (extended_cost = qty × unit_cost)
3. Category classification accuracy
4. SKU format validity

If the extraction has issues, suggest corrections and whether the golden corpus needs a new test case.
