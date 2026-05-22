# Workflow Confidence QA

Last updated: 2026-05-21

## Goal

Prove the money workflow is clickable and understandable from Foreman daily entry through Admin review, Billing package, SQUAN submission, payment tracking, and reports.

## Button Inventory Summary

The application has a broad clickable surface. The high-volume action attributes are:

- `data-workflow-action`: general workflow navigation across Home, Maps, Daily Capture, Billing, Reports, Tasks, and drawers.
- `data-billing-action`: Billing package, payment, closeout, and package blocker actions.
- `data-production-*`: Daily Capture mode switching, daily open, code picking, draft line, proof, and review actions.
- `data-report-*`: report mode, filters, report project selection, packet actions, and print/export controls.
- `data-open-record` / `data-task-open`: drill-ins into records and task workflows.
- `data-view` / `data-view-shortcut`: sidebar and shortcut navigation between role-safe screens.
- `data-workflow-id` / `data-workflow-focus` / `data-workflow-target`: passive route metadata used to land users on the right Map, mode, or report context.

## Critical Button Groups

| Group | Status | Notes |
| --- | --- | --- |
| Daily Capture mode tabs | Working action | Switches Command, Submit Daily, Review, Billing Handoff, Reports & Tools. |
| Foreman production form | Working action | Supports draft line add/remove, draft save, and submit. |
| Admin Daily Capture filters | Working action | Filters by responsible user, map, code, proof, review, and billing state. |
| Open daily drill-ins | Working navigation | Selects a production daily and scrolls to detail. |
| Production proof/review actions | Working action | Routes through proof and review handlers with permission guard. |
| Billing package selection | Working navigation | Selects package, opens Billing view, and scrolls package detail. |
| Billing package lifecycle actions | Working action | Prepare, submit, response, rejection, SQUAN payment, holdback, contractor payment. Submission, response, and payment now use focused drawers instead of browser prompts. |
| Outcome exports | Export/download | Approved production, ready to submit, lifecycle, exceptions, payment ledger. Billing, Daily Capture Billing Handoff, and Reports Audit / Exports all expose the critical CSVs. |
| Report mode tabs | Working navigation | Switches Daily Production, Packet Readiness, Audit / Exports. |
| Generic workflow buttons | Working navigation | Now route Daily Capture and Reports to the appropriate mode based on focus/scope. |
| Role home and sidebar navigation | Working navigation | Admin, Operations, Foreman, Crew Member, Billing, and Safety/Compliance sidebars are checked against expected role paths. |
| Workflow rail / stepper navigation | Working navigation | Shared workflow steps route through `configureWorkflowRoute` and preserve focus, selected Map, production mode, and report scope. |
| Project selector controls | Working navigation | `data-project-id` now acts only on pure project-selection controls, so action buttons that carry project metadata do not get a second generic render. |
| Next best action strips | UX guidance | Daily Capture, Billing package detail, and Safety/Compliance now surface the next action before dense tables or detail panels. |
| Grouped export hub | UX guidance | Reports Audit / Exports groups links by SQUAN submit, audit/blockers, closeout/cash, and field proof instead of one long export list. |

## Critical Path Confidence Checklist

1. Foreman opens Daily Capture and lands on `Submit Daily` when the workflow intent is new daily, submit, foreman, entry, or capture.
2. Foreman adds Map, code, quantity, proof note, and submits or saves the daily.
3. Admin opens Daily Capture command/review and sees responsible user, blockers, proof, review, and billing readiness.
4. Admin proof/review buttons update the production line status through existing handlers.
5. Billing Handoff shows approved production, SQUAN billable value, contractor/cost value, package groups, and blocked dailies.
6. Billing package detail supports prepare, export, submit to SQUAN, response, rejection, SQUAN payment, holdback, and contractor payment.
7. Reports / Audit exports expose lifecycle, exceptions, payment ledger, approved production, and ready-to-submit data.
8. SQUAN payment and contractor payout remain separate records and are not forced into an automatic split.
9. Critical package buttons show readiness context so Billing can see why prepare, submit, response/payment, or contractor payment is blocked.
10. Core workflow screens keep the next action visible before lower-priority detail, tables, or export lists.

## Automated Checks

Run `npm run check` before closing a workflow slice. It now includes `scripts/workflow-confidence-test.js` and `scripts/browser-workflow-qa.js`, which start the app on temporary local ports and check:

- The live app shell, JavaScript, and CSS load through the server.
- Daily Capture modes, route mapping, Foreman submit/draft, Admin review, proof, Billing Handoff, and Reports controls are still wired.
- Billing package submission, response, payment, holdback, contractor payment, and readiness drawer controls are present.
- Billing package preview, package-specific export naming, submitted date/value, partial SQUAN approval variance, lifecycle lanes, and payment/holdback controls are present.
- Role home, role sidebar, `renderView`, `navigateToView`, workflow rail, and workflow route configuration tokens are present.
- Admin, Operations, Foreman, Crew Member, Billing, and Safety/Compliance sidebar paths stay aligned with the intended workflow for that role.
- Shared route attributes such as `data-workflow-action`, `data-view`, `data-view-shortcut`, `data-open-record`, and `data-task-open` are inventoried so new route buttons need a handler or explicit passive metadata classification.
- Project metadata routing is guarded so Billing/Admin/package buttons with `data-project-id` are not also treated as generic project selectors.
- Daily Capture and Billing action attributes are inventoried so newly added action buttons must have a bound handler or be explicitly passive metadata.
- Approved production, ready-to-submit, package-specific billing package, billing package lifecycle, exceptions, and payment ledger CSV exports respond with the expected headers.
- Chrome headless clicks the Foreman Daily Capture, Admin Daily Capture review, Billing package, Daily Capture Billing Handoff, Reports tabs, SQUAN export links, and Safety/Compliance risk/report paths and fails on blank renders or browser errors.
- Responsive visual QA runs the same core workflow at phone `390x844`, tablet `820x1180`, and desktop `1440x900`, checking for page-level horizontal overflow, Foreman form order, and touch-sized Foreman inputs/buttons.

Run `npm run test:workflow` when you only need the live workflow/export confidence pass.
Run `npm run test:browser` when you only need the Chrome click-through confidence pass.

## Known Boundaries

- `data/db.json` is runtime/demo state and is intentionally not committed during QA slices.
- Browser automation covers the main money workflow path non-destructively and now includes viewport-level visual checks; mutating submit/payment actions still need targeted manual review before each large UI slice is considered complete.
- Low-value generic buttons outside the money path should be reviewed in later screen-specific QA passes.
