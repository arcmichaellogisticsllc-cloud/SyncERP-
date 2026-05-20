# Source-Backed ERP Requirements

This note captures the requirements pulled from the signed MSA and Jackson Telcom workflow transcripts. The source PDFs stay outside the repository; this file records the product implications we should build into the ERP.

## Source Documents Reviewed

- `MSA - Signed - Executed.pdf`
- `Meeting Jackson Telcom - 2026_04_21 13_05 EDT - Transcript.pdf`
- `Jackson Telcom - 2026_04_19 11_53 EDT - Notes by Gemini.pdf`

## Contract Controls From The MSA

These should become system-enforced gates, alerts, dashboards, or audit evidence.

| Area | ERP Requirement |
| --- | --- |
| SQUAN score | Track the Evaluation Rating and Acceptance score. Anything below 90 should create a payment-delay risk alert and mitigation requirement. |
| Dailies | Require daily production reports within 24 hours of the work day. Repeated late dailies should raise a payment-term risk. |
| SOT | Require SQUAN Safety Observation Tour / crew rollup submission for each work day. |
| Invoice window | Track a 30-day invoice deadline from service/work date. Anything not properly invoiced within the window is at forfeiture risk. |
| Invoice support | Block invoice readiness until required dailies and as-builts are attached. Add photos/SOT as Jackson Telcom internal controls. |
| Retainage | Default invoices to 10% retainage, with release tracked 12 months from impacted invoice receipt unless overridden by PO terms. |
| Pay-when-paid | Track whether SQUAN has been paid by its customer and use that status in AR forecasting. |
| Holdbacks | Track holdback reasons: behind schedule, dispute, unpaid subs/material suppliers, financial condition risk, unresolved obligations. |
| COI | Treat expired insurance certificates as a payment-hold risk and assignment/compliance exception. |
| Background checks | Require government ID retention and background checks covering the prior 7 years before assignment. Refresh checks every 3 years. |
| Subcontractors | Require prior SQUAN consent, safety review, orientation, insurance, HSE program, and drug/alcohol policy compliance before use. |
| Safety metrics | Track TRIR, EMR, DART, fatality rate, training documents, and safety program documentation for prequalification. |
| Incident reporting | Require reporting for injuries, spills, property damage, hazards, and near misses. |
| Equipment inspections | Require pre-job equipment inspection evidence and operating equipment inspection/maintenance records. |
| Acceptance/warranty | Track acceptance status and 12-month correction/warranty exposure after acceptance. |
| Chargebacks | Log rework and chargeback exposure with reason, responsible project, corrective action, and financial impact. |

## Operational Workflow From The Transcripts

These should shape the UX so it matches how Jackson Telcom actually works.

| Stage | Workflow Details To Support |
| --- | --- |
| PO intake | Capture map, contract/PO, site surveys, permits, utility conflict notes, natural gas/water line notes, aerial-to-underground transitions, and special conditions. |
| Documents and maps | Maps, permits, site surveys, locate tickets, as-builts, photos, and customer documents must be viewable from the PO, not only listed as file names. |
| Obstacles and obstructions | Field obstacles should be documented against a project/location with photos, owner, status, operational impact, and billing/claim relevance. |
| Photo evidence | Seeded web photos are only placeholders to show where field evidence belongs. Production records should use actual field uploads with timestamp, GPS, uploader, linked PO/daily/obstacle/QC record, and source-of-truth storage path. |
| Site survey | Record PM/foreman/lead walkout notes before crew assignment. |
| Design and engineering review | Store permit review, specialty conditions, build assumptions, and exceptions before release to field. |
| Crew assignment | Assign crew only after certs, background checks, equipment status, and required documents clear. |
| Loadout/preflight | Confirm truck, equipment, PPE, tools, materials, and inspection status before the crew starts. |
| Field production | Track footage, spans/segments, splices, underground/aerial work type, labor, equipment time, fuel impact, and production blockers. |
| Time tracking | Time should be its own record tied to employee, crew, PO/map, daily, work type, cost code, payroll status, job cost status, and safety-hour metrics. |
| Internal QC | Foreman owns QC until a dedicated QC role exists. Require photos of completed work, GPS/timestamp metadata, and span/segment closeout. |
| Billing | Jackson Telcom expects daily billing once work starts, so billing readiness should be daily, not only milestone-based. |
| Bottlenecks | Track weather, permits, equipment downtime, manpower, fuel, workmanship issues, late billing, and chargebacks as structured blockers. |
| Safety culture | Make safety checks hard to skip: JSA, PPE, traffic control, bucket/truck inspection, near-miss capture, and corrective actions. |

## Product Changes To Build Next

1. Add import-first production controls: SQUAN Daily Export CSV import, Jackson/SQUAN Price Sheet CSV import, contractor daily, tech daily, Jackson review queue, production ledger, contractor payable, in-house job cost, SQUAN billable support, and quantity reconciliation.
2. Add a `contractRules` or `customerContractRules` record for SQUAN defaults: invoice window, retainage percent, retainage release period, daily SLA, SOT requirement, as-built requirement, score thresholds, and pay-when-paid status.
3. Add PO intake checklists for maps, permits, site surveys, utility conflicts, aerial/underground transitions, and special conditions.
4. Add assignment blockers for expired/missing background checks, certs, COI, required SQUAN consent, equipment inspection, and open safety restrictions.
5. Add a daily SLA monitor that flags missing or late dailies/SOT within 24 hours.
6. Add a billing forfeiture clock that starts from each work date and escalates at 7 days, 3 days, and overdue.
7. Expand billing readiness to verify accepted production lines, dailies, as-builts, SOT, photos, acceptance/QC status, and document completeness.
8. Expand retainage into its own ledger with original invoice, held amount, release date, release status, disputes, and payment notes.
9. Add pay-when-paid AR states: submitted, approved by SQUAN, SQUAN customer paid, payable to Jackson, paid, disputed, held.
10. Add COI and insurance compliance records with expiration dates and payment-hold warnings.
11. Add subcontractor onboarding records with SQUAN consent, safety review, HSE program, insurance, background checks, and orientation.
12. Add SQUAN safety score inputs and mitigation plan workflow for B/C/D scores or any score below 90.
13. Add QC closeout records for spans/segments with workmanship status, required photos, rework, and chargeback exposure.
14. Add equipment downtime and fuel tracking to job cost because the transcripts identify them as major margin drivers.
15. Add audit package exports grouped by PO, person, equipment, invoice, safety event, and SQUAN score period.
16. Add a viewable project document and site intelligence layer for maps, surveys, permits, locate tickets, obstacles, obstruction photos, and QC evidence.
17. Add time tracking from employee to crew, daily, PO/map, payroll, job cost, and safety-hour reporting.

## Practical Build Priority

The immediate end-to-end slice should be:

`Price sheet import -> SQUAN daily CSV import -> Contractor/Tech production daily -> Jackson review -> Production ledger -> Billing package/pay ledger`

That slice gives Jackson Telcom an operating pay/billing workflow now. The contract-control slice should follow immediately after proof controls are stable:

`PO intake checklist -> cleared crew/equipment assignment -> daily SLA/SOT -> QC closeout/photos -> invoice readiness -> retainage/pay-when-paid AR`

## Current Seed Scenario

The prototype data is organized around three map jobs so every role is looking at the same operating picture:

- Map 1: completed and billed underground work, with dailies, SOT, photos, as-builts, QC, invoice support, and retainage ledger.
- Map 2: completed and billed aerial work, with traffic control, equipment inspection evidence, photos, as-builts, QC, invoice support, and retainage ledger.
- Map 3: beginning phase, with map received but site survey, 811, permits, crew/equipment release, obstacle photos, JSA, production, QC, and billing still pending.
