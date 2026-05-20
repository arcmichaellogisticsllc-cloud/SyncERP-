# Jackson Telcom ERP Data Model

The prototype uses `data/db.json` as the source of truth. The browser keeps a versioned local copy in `localStorage`; if the seed version changes, the app reloads the latest seed.

## Standard Fields

Workflow records should use these fields when applicable:

- `id`: stable record identifier
- `project`: related PO/map id
- `status`: current workflow state
- `owner`: accountable user, foreman, office role, or crew
- `notes`: current note summary
- `activityLog`: timestamped notes and actions
- `createdAt`: record creation timestamp
- `modifiedAt`: last update timestamp

## Core Collections

- `projects`: PO/map parent records. Owns scope, crew, required certs, budget, schedule, billing deadline, and document control summary.
- `tasks`: action queue across PO intake, documents, field blockers, time approval, safety, billing, retainage, and compliance.
- `documents`: evidence records for maps, 811, permits, surveys, photos, as-builts, generated forms, SOT, and invoice support.
- `fieldEvidence`: proof records linked to Map/NTP, production line, daily, note, photo/as-built placeholder, source, submitter, and review status.
- `dailies`: foreman field daily records. Submitting a daily creates production, labor, equipment, material, forms, documents, photo evidence, and billing readiness updates.
- `squanImports`: imported SQUAN CSV files with source type, file name, import date, status, warning notes, and parsed line count.
- `squanProductionLines`: parsed SQUAN daily/pay export rows by Map/NTP, date, code, quantity, UOM, amount, source file, and import ID.
- `squanMapFeatures`: Phase 3 SQUAN map feature placeholders. Stores Map/NTP, layer name, feature code, quantity, status, objectId/globalId placeholders, geometry status, and source line link. Live ArcGIS can populate the same concept later.
- `priceSheetItems`: Jackson/SQUAN price sheet rows for unit code, description, UOM, subcontractor rate, and work aspect/category.
- `productionDailies`: Jackson-created contractor and tech daily headers.
- `productionLines`: submitted work lines by code, quantity, submitter, proof status, review status, payable amount, and billable amount.
- `contractorPayables`: approved contractor production lines ready for payment.
- `techWorkEntries`: in-house technician labor/time/production tied to Map/NTP, employee, vehicle/equipment usage, and job cost.
- `billingLedger`: approved source lines showing SQUAN billable, contractor payable, in-house cost, proof status, billing status, and payment status.
- `quantityReconciliation`: compares SQUAN export quantity, Jackson submitted quantity, approved quantity, billing quantity, and variance.
- `formSubmissions`: structured fillable form submissions such as JSA, Daily Report, and SOT.
- `timeEntries`: employee time records for payroll, job costing, and safety-hour metrics.
- `people`: employee and compliance ledger with certs, background refresh, drug test, crew, and assignment readiness.
- `equipment`: truck, tool, material, inspection, calibration, location, and availability records.
- `safety`: incidents, near misses, hazards, Form 12 corrective actions, owners, due dates, and closure status.
- `invoices`: invoice, AR, 90% paid, retainage, release, and support package records.
- `retainageLedger`: retainage release tracking and pay-when-paid notes.
- `billingReadiness`: computed package readiness by PO/map.

## Setup Collections

- `contractRules`: SQUAN/customer rules driving invoice windows, retainage, safety thresholds, required docs, background checks, and payment holds.
- `roles`: module visibility and create permissions by role.
- `users`: login/workspace users and crew/person links.
- `crews`: crew roster status.
- `costCodes`: labor, material, equipment, and cost category setup.
- `unitPrices`: contract price book for billable units.
- `squanScores`: safety score period snapshot.
- `auditLog`: login, record, workflow, note, and status-change events.
- `company.arcgis`: non-secret Phase 4 readiness metadata: portal URL, portal display name, future auth mode label, web map ID, feature service URL, layer ID/name, field mapping names, and geometry import status. Never store passwords, API keys, client secrets, tokens, or recovery answers here.

## Relationship Rules

- `project` fields should reference `projects.id` when the work is tied to an internal Map. SQUAN NTP-only rows may use the SQUAN NTP until a Map record is created.
- `tasks.project`, `documents.project`, `fieldEvidence.project`, `dailies.project`, `productionDailies.project`, `productionLines.project`, `timeEntries.project`, `safety.project`, `invoices.project`, and `billingReadiness.project` should all point to a valid PO/map or a tracked SQUAN NTP placeholder.
- `users.role` should exist in `roles.id`.
- `project.crew` should exist in `crews.id`.
- `timeEntries.employeeId` should exist in `people.id` when populated.

## Workflow Ownership

- PO Hub owns project source-of-truth context.
- Production owns SQUAN imports, price sheet import, contractor/tech production dailies, review queue, payables, job cost, billable support, and quantity reconciliation.
- SQUAN Map Workbench owns map cards, layer/feature browser, feature detail, code/quantity rollups, and map-to-daily creation from selected feature placeholders.
- ArcGIS Phase 4 readiness owns non-secret portal/service/layer metadata and readiness checks. Live service calls should be added only after auth and access are approved.
- Field Operations creates dailies, forms, production, time/cost inputs, and evidence.
- Documents owns evidence control and required package completeness.
- Billing owns billing readiness, invoice package, AR, and retainage.
- Safety owns incidents, Form 12, audit readiness, and SQUAN score protection.
- People and Equipment own assignment gates.
- Admin Settings owns rules, users, roles, cost codes, unit prices, and audit visibility.
