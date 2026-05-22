# Workflow Click QA Notes

Last updated: 2026-05-21

## Scope

This pass focuses on the highest-value money path:

1. Foreman Daily Capture.
2. Admin Daily Capture review and visibility.
3. Billing package readiness and package actions.
4. SQUAN submission, response, payment, holdback, and contractor payout.
5. Reports and CSV exports.

## Findings From This Slice

| Area | Finding | Resolution |
| --- | --- | --- |
| Shared project metadata | Many action buttons carry `data-project-id` as context. The generic project selector listener also attached to those buttons, creating a risk that a valid action click could immediately trigger a second project-selection render. | Added `isProjectNavigationOnly` so `data-project-id` only drives navigation on pure project-selector controls. |
| Role workflow routes | Role home, sidebar, workflow rail, Daily Capture route mode, and Reports route mode were source-audited. | Added automated coverage in `scripts/workflow-confidence-test.js`. |
| Export endpoints | Approved production, ready-to-submit, billing package, lifecycle, exceptions, and payment ledger exports respond with expected headers. | Covered by `npm run check`. |
| Real browser click path | Foreman Daily Capture, Admin review visibility, Billing package detail, SQUAN action presence, Reports tabs, and CSV endpoints need browser-level coverage. | Added dependency-free Chrome DevTools runner in `scripts/browser-workflow-qa.js` and wired it into `npm run check`. |
| Real RDB daily sample | `BSP-MIC-0197` / RDB daily `226231` was not present in the app data, so adding it directly would have risked duplicate future imports. | Added an idempotent normalizer that seeds one canonical sample only when missing, including HRS quantity 6.00, prior-approval billing state, four proof-photo references, and RDB field-change history. |

## Automated Browser QA

Run:

```bash
npm run test:browser
```

The runner launches local Chrome headless through the Chrome DevTools Protocol and validates:

- Foreman can open Daily Capture, enter Submit Daily mode, fill quantity/proof, and see enabled submit controls without a blank render.
- Admin can route into Daily Capture visibility, open Review mode, and drill into a daily detail without a blank render.
- Admin Review can select the real `BSP-MIC-0197` / `226231` sample and see the RDB saved history plus prior-approval billing state.
- Billing can open Billing, select a package, and see prepare/submit/response/payment/contractor actions.
- Reports tabs for Daily Production, Packet Readiness, and Audit / Exports render after real clicks.
- CSV endpoints for approved production, ready-to-submit, lifecycle, exceptions, and payments return CSV content.

## Manual Browser QA Still Needed

The automated runner avoids destructive clicks. Use this checklist for final hands-on review of actions that create, submit, or pay records:

| Role | Start | Click Path | Expected Result |
| --- | --- | --- | --- |
| Foreman | Home or Daily Capture | Daily Capture -> Submit Daily -> add line/proof -> Save Draft / Submit | The form stays focused on Map, code, quantity, proof, and submit state. Admin visibility updates from the same daily. |
| Admin | Home or Daily Capture | Daily Capture -> Command/Review -> open daily -> proof/review actions | Admin sees owner, status, blockers, codes, quantities, proof, and billing readiness before drilling in. |
| Billing | Billing or Daily Capture Billing Handoff | Package row -> package detail -> Prepare -> Submit to SQUAN | Package readiness shows blockers when disabled and opens focused drawers when enabled. |
| Billing/Admin | Billing package detail | Log SQUAN response -> record payment/holdback -> contractor payment | SQUAN receipts and contractor payout remain separate records; contractor split is visible but not forced. |
| Reports | Reports / Audit Exports | Open Daily Production, Packet Readiness, Audit / Exports, then CSV links | Reports do not blank, selected Map/report context is preserved, and CSV links return files. |

## Next Hardening Option

Add a browser runner in a later slice so this checklist can become executable click tests with screenshots.
