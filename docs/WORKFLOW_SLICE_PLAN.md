# Workflow Slice Plan

This plan keeps the build from bouncing across unrelated areas. Only one slice is active at a time. Each slice must include UI, Admin visibility, data/status flow, wired actions, QA/tests, and deferred notes before moving forward.

## Build Rule

- Do not change unrelated screens unless they directly support the active slice.
- Daily Capture is the production source of truth and is frozen except for blockers.
- Billing Package is the active lane until package prep and SQUAN handoff are clean.
- Reports and broad UI cleanup come after the money workflow is stable.

## Operational Completion Gate

Status: Closing pass.

Done means:

- Foreman Daily Capture is fast enough for real daily production input.
- Admin/Ops can review proof, blockers, corrections, and billing readiness.
- Billing can see what is ready to submit, record manual SQUAN Tracker submission, track response/payment/holdback, and export support records.
- Contractor settlements keep agreement versions, deductions, expenses, net due, payments, and disputes separate from SQUAN payment.
- Permissions hide or block restricted screens/actions by role.
- Real, imported, manual, generated, and demo data are labeled.
- Operational blockers create an owner-based cleanup queue with source, route, and task action.
- Reports/exports support daily production, approved production, ready-to-submit, package lifecycle, exceptions, payments, settlement, rates, readiness, and cleanup.
- QA passes through `npm run check`.
- Deployment, persistence, backup, restore, and admin recovery have a final go-live decision.

## MAMP / Persistence Decision

Status: Local tool confirmed.

Decision:

- Keep the application running as a Node app.
- Do not move the app into MAMP `htdocs`; Apache/PHP is not the current runtime.
- Use MAMP as the local MySQL bridge when persistence moves beyond `data/db.json`.
- Short term: Node server + JSON database + full Admin backup/restore controls.
- Next persistence slice: define MySQL schema for users, roles, maps, production dailies, production lines, price sheet, billing ledger, package snapshots, SQUAN submissions, cash receipts, contractor agreements, contractor settlements, and audit log.

## Real Submission Preservation + Demo Archive

Status: Complete.

Goal: Keep imported SQUAN/Brightspeed submissions as original source records while Jackson validates and resubmits them through its own Daily Capture workflow.

Done means:

- Imported SQUAN/Brightspeed rows are classified as real imported source data and treated as read-only.
- Corrections, proof, Admin review, and billing readiness happen on linked Jackson resubmission records with sourceSubmissionId/resubmissionOf/version metadata.
- Duplicate Jackson dailies are blocked unless the user intentionally creates a revision.
- Admin can compare original source versus Jackson daily for Map/NTP, worked date, code, quantity, proof, and billing readiness.
- Demo/training records can be archived separately and do not block live operational readiness by themselves.
- CSV exports exist for imported originals, Jackson resubmission comparison, and demo archive.

## Operational Closeout

Status: Active.

Goal: Close the remaining confidence gap before go-live.

Done means:

- Real workflow validation, persistence prep, role permission QA, UX polish, backup/restore, real users/roles, locking rules, correction SOP, required fields, SQUAN Tracker format confirmation, exception paths, audit trail review, role dashboards, archive rules, deployment runbook, acceptance test, and import SOP are tracked in one closeout plan.
- Admin can see the closeout plan in the app and export it as `/api/reports/operational-closeout.csv`.
- The runbook lives in `docs/OPERATIONAL_CLOSEOUT_RUNBOOK.md`.

## Slice 1: Daily Capture Freeze / QA

Status: Freeze except blockers.

Goal: Protect production input.

Done means:

- Foreman can submit Daily Capture lines quickly.
- Admin can see owner, proof, codes, quantities, blockers, and billing readiness.
- Approved lines feed the Billing Package workflow.
- Only bug fixes or blocker fixes are allowed.

## Slice 2: Billing Package Completion

Status: Active.

Goal: Define exactly what Jackson is billing to SQUAN.

Done means:

- Billing sees package groups by Map/NTP, work date, and billing code.
- Billing can open package detail and see source dailies, owner, proof, quantity, billable amount, payable/cost, and blockers.
- Package prep is clearly separate from SQUAN submission.
- Admin sees package owner, status, blockers, value, and SQUAN response.

## Slice 3: SQUAN Submission

Status: Next.

Goal: Track what was sent to SQUAN and whether SQUAN accepted it.

Done means:

- Prepared package can be submitted to SQUAN.
- Receipt/reference, contact, method, and follow-up date are recorded.
- Accepted/rejected/needs-support responses update the package and Admin visibility.
- Rejection or missing support creates clear follow-up work.

## Slice 4: Payment / Retainage

Status: After SQUAN Submission.

Goal: Track money until collected.

Done means:

- SQUAN submitted value, actual paid amount, holdback/variance, and follow-up are tracked from real payment data.
- Retainage or holdback is optional and recorded from SQUAN/customer terms or actual payment behavior, not assumed automatically.
- Contractor payable is snapshotted from the rate sheet/rules used at package preparation, because contractor terms can change later.
- Short-pay, dispute, chargeback, pay-when-paid, and follow-up actions are visible and actionable.
- Admin can see collection risk and owner.

## Slice 5: Reports / Audit Trail

Status: After workflow stability.

Goal: Produce clean review/export views from completed workflow data.

Done means:

- Daily Capture report matches submitted production.
- Billing Package report shows what is being billed.
- SQUAN Submission report shows receipt/response/follow-up.
- Payment/Audit report shows 90%, retainage, disputes, and exceptions.

## Slice 6: UI / Navigation Cleanup

Status: Final cleanup pass.

Goal: Make the app feel intentional instead of like an information dump.

Done means:

- Duplicate panels are removed or moved into drawers.
- Labels are consistent across Daily Capture, Billing, Reports, and Admin.
- Navigation follows the active workflow lane.
- Dense tables remain available, but command views lead the user.
