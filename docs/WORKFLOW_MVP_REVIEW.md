# Jackson Telcom ERP Workflow and MVP Boundary Review

This document keeps the build anchored to real Jackson Telcom operations. New slices should support one of the workflows below. If a proposed feature does not improve one of these paths, it should be deferred.

## Operating Principle

The ERP is not a generic feature collection. It is the system of record for:

- what Map is being worked,
- who is allowed to work it,
- what happened in the field,
- what evidence proves the work,
- what can be billed,
- what cash is still exposed,
- what safety/compliance risk remains,
- what Admin approved.

## Guiding Decision

For the near term, Jackson ERP should use SQUAN exports and Jackson-entered production as the operating source. Do not make live ArcGIS integration part of the Phase 1 MVP.

This keeps the system useful while Jackson is still early in the SQUAN operating rhythm. SQUAN already provides daily/pay exports and map evidence, while live ArcGIS adds service access, authentication, permissions, and cost questions. The data model should remain ready for ArcGIS later by storing Map/NTP references, source IDs, layer/category labels, quantity fields, evidence links, and reconciliation rows.

## Core User Workflows

### 1. Admin / Owner Workflow

Primary question: "What needs Ronald's decision today?"

Admin should see:

- Map profitability and cash exposure.
- Release-to-field blockers.
- Billing and collections exceptions.
- Safety/compliance exceptions.
- Evidence that needs acceptance or rejection.
- Final approval gates and frozen audit packets.

Admin should not be forced into raw tables unless investigating details.

MVP boundary:

- Keep Admin focused on decision queues, readiness gates, audit snapshots, and exception review.
- Defer advanced analytics until the core approval workflows are stable.

### 2. Operations Workflow

Primary question: "Can this Map be released to the field, and what is blocking production?"

Operations should see:

- Beginning-phase intake.
- Map/site survey readiness.
- 811 and permit readiness.
- Obstacles and obstructions.
- Crew assignment.
- Equipment assignment.
- Release-to-field gate.
- Active/completed Map status.

MVP boundary:

- Prioritize Map setup, readiness, release, and blocker resolution.
- Defer advanced dispatch optimization and route planning.

### 3. Foreman Workflow

Primary question: "Can my crew start today, and can I close out the daily once?"

Foreman should see:

- Today's assigned Map.
- JSA/PPE/equipment/811 start gate.
- Crew and equipment readiness.
- Map documents, survey, obstacles, and photos.
- Daily production, labor, equipment, material, SOT, and photo closeout.
- Blockers that stop start or submission.

MVP boundary:

- Prioritize guided daily start, field evidence, and one-submit closeout.
- Defer offline sync, advanced GPS capture, and native mobile features until the workflow is stable.

### 4. Crew Member Workflow

Primary question: "What am I assigned to, what do I need to sign, and is my time right?"

Crew members should see:

- Today's assignment.
- Safety plan/JSA/PPE signoff.
- Role-specific tasks for aerial, underground, ground hand, traffic control, and operator work.
- Obstacles or hazards they need to know about.
- Time confirmation.

MVP boundary:

- Keep the crew view narrow and mobile-first.
- Do not expose financial, Admin, or unrelated Map data.

### 4A. Contractor Workflow

Primary question: "What did my crew complete, and what proof supports payment?"

Contractors should see:

- Assigned Map/NTP reference.
- Production daily form.
- Work code, quantity, notes, and proof upload/notes.
- Review status, correction requests, payable status, and paid/held status.

MVP boundary:

- Keep the contractor flow mobile-friendly and limited to submitted work, proof, corrections, and payment status.
- Do not expose Jackson internal job cost, billing strategy, Admin decisions, or unrelated Maps.

### 4B. In-House Technician Workflow

Primary question: "What did I do today, what time/equipment was used, and what proof is attached?"

Technicians should see:

- Assigned Map/NTP reference.
- Tech daily form.
- Hours, production quantity, vehicle/equipment usage, notes, photos, and proof status.
- Review status and any correction request.

MVP boundary:

- Treat tech entries as in-house job cost and SQUAN billable support after Jackson review.
- Keep payroll processing out of Phase 1 beyond export-ready time/job-cost records.

### 5. Billing Workflow

Primary question: "What can be billed, what is missing, and what cash is at risk?"

Billing should see:

- Billing readiness by Map.
- Daily/SOT/photo/as-built/QC support package status.
- SQUAN submission log and receipt tracking.
- 90 percent AR, retainage, pay-when-paid, disputes, chargebacks, and collections.
- Evidence corrections that block Admin approval.
- Cash forecast and follow-through tasks.

MVP boundary:

- Prioritize billing readiness, SQUAN submission, AR/retainage tracking, collections response, and evidence correction.
- Defer full accounting ledger replacement, tax filing, and payroll processing.

### 6. Safety / Compliance Workflow

Primary question: "What risk could stop work, hurt the company, or fail an audit?"

Safety/Compliance should see:

- Certification expirations.
- Background/drug/MVR/HSE records.
- Equipment inspection/calibration issues.
- Incidents, near misses, hazards, Form 12, 5 Whys, corrective actions.
- SQUAN score impact.

MVP boundary:

- Prioritize blocking controls, corrective action closure, safety evidence, and audit exports.
- Defer advanced safety analytics until core risk records are complete.

## End-to-End MVP Workflow

The end-to-end MVP should prove this path:

1. SQUAN daily/pay export and Jackson/SQUAN price sheet are imported.
2. Map/NTP reference is available for production entry.
3. Contractor or in-house technician submits a Jackson production daily.
4. Jackson reviews quantity and proof.
5. Approved line becomes contractor payable, in-house job cost, and SQUAN billable support as applicable.
6. Billing package groups approved lines by Map/NTP, date, and code.
7. Billing tracks submitted amounts, unpaid work, retainage, disputes, and proof.
8. Admin reviews exceptions with accepted evidence and ledger impact.
9. System freezes approval packets for audit.

## Current Build Focus

The current build had moved deeply into the Billing/Admin collections decision path:

- decision evidence attachment,
- Admin evidence acceptance/rejection,
- evidence replacement/version history,
- Billing correction workbench,
- evidence SLA alerts and tasks,
- decision readiness gate,
- finalized decision packet snapshots.

That work is useful because it protects high-risk cash decisions, but the immediate build priority is now Phase 1 Operational Pay/Billing MVP:

- import price sheet,
- import SQUAN daily CSV,
- contractor daily submission,
- tech daily submission,
- Jackson review queue,
- production ledger,
- billing package/pay ledger.

Phase 2 has now started inside the Production workflow:

- proof checklist grouped by missing, needs review, and accepted,
- correction tasks for missing or rejected proof,
- proof acceptance history,
- approval blocked until proof is accepted,
- accepted-line billing package view.

Phase 3 has now started as an internal SQUAN Map Workbench:

- map cards by Map/NTP,
- layer and feature browser,
- selected feature detail,
- code and quantity rollups,
- manual feature creation/editing,
- feature-level proof before or after daily creation,
- layer/status filtering,
- feature status updates,
- bulk feature status updates,
- batch feature selection,
- map-to-daily creation from one or more selected feature placeholders,
- feature-level reconciliation against submitted, approved, and billing quantities.

Phase 4 readiness has started, but live ArcGIS is still not an operating dependency. The current non-secret portal metadata is:

- Portal URL: `https://jactelops.maps.arcgis.com`
- Portal display name: `jactelops`

Do not store passwords, security answers, API keys, client secrets, access tokens, or refresh tokens in the repo or JSON database. Live ArcGIS stays Phase 4. Until then, model SQUAN map behavior with Map cards, Map/NTP references, layer/category labels, feature code and quantity placeholders, evidence viewer, and quantity reconciliation.

## What Is MVP Required

These items are MVP required because they support real daily operations:

- Role-based login and role-scoped workspaces.
- Map source of truth.
- Beginning-phase release gate.
- Foreman daily start and closeout workflow.
- Documents/evidence linked to Map, daily, obstacle, billing, safety, and collections records.
- Time tracking tied to field daily and job cost.
- SQUAN export and price sheet import.
- Contractor and in-house tech production dailies.
- Jackson production review queue.
- Production ledger that shows SQUAN billable, contractor payable, in-house cost, proof status, and payment status.
- Billing readiness and SQUAN submission tracking.
- AR, retainage, collections, and cash exposure tracking.
- Safety/compliance blocking records.
- Admin decision gates and audit snapshots.

## What Should Be Deferred

These are useful later but should not drive near-term slices:

- Full accounting replacement.
- Payroll tax filing.
- Native mobile app.
- Real file storage infrastructure beyond prototype placeholders.
- Advanced route optimization.
- Customer portal.
- Vendor portal.
- Full BI analytics.
- AI document extraction.
- Complex inventory purchasing.

## Slice Acceptance Checklist

Before starting a new slice, confirm:

- Which user owns the workflow?
- Which real operating question does it answer?
- Which record becomes more accurate?
- Which downstream workflow benefits?
- Does it reduce double entry or prevent missed billing/safety/compliance risk?
- Is it MVP required, or should it be deferred?

If the answer is unclear, the slice should be refined before implementation.
