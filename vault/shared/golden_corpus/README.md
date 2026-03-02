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
