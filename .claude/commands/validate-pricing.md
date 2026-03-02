Run the pricing engine test suite and the determinism check.
Report any failures with the exact numeric values that diverged.

!`npx vitest run tests/pricing/ --reporter=verbose 2>&1 | tail -40`
