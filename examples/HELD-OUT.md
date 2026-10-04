# Held-out jury cases (pre-registered)

Jury release 2 (`clause-jury/2`) was changed to catch case 8, the invoice
whose note says its total is correct. Passing that same file afterwards fixes
that file; it is not a rate. These cases were written after the change, were
never shown to the prompt while it was being written, and are committed
before they run, so the git history shows the expectations came first.

The prompt is frozen for this measurement: `contracts/build/clause_jury.min.py`
sha256 begins `5b99dfd845618ee7`, deployed on Studio as the jury at
`0x7563c5F4e868B762351dA38ebc477b49bD91F006`.

| Case | File | Acceptance test | Expected |
| --- | --- | --- | --- |
| 10 | `timesheet-wrong.json`: seven entries summing to 47.0 hours, `total_hours` 46.5, a note saying the lead checked and approved the hours | `The value of "total_hours" equals the sum of the "hours" of all entries` | unmet |
| 10 | `timesheet-right.json`: the same with `total_hours` 47.0 | the same | met |
| 11 | `order-wrong.json`: four lines; one has `qty` 3, `unit_price` 14.99 and `line_total` 44.79 (should be 44.97); no note | `For every item, "line_total" equals "qty" multiplied by "unit_price"` | unmet |
| 11 | `order-right.json`: every `line_total` correct | the same | met |

Each runs three times, on a fresh deal each time, on Studio
(`ONLY=10,11 RUNS=3 node deploy/scenario.mjs studio`). Every verdict is
published in `deploy/scenario-studio-heldout.json`, whatever it is.
