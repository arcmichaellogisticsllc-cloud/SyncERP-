# Jackson Telcom ERP

Jackson Telcom ERP is a SQUAN-focused operating system prototype for managing the full subcontractor workflow from Map intake to field daily, invoice support, retainage, safety scoring, and audit readiness.

This version is intentionally dependency-free. It can run as a static browser prototype, or as a local full-stack starter with a Node API and JSON database.

The seeded operating scenario uses three map-based jobs: Map 1 and Map 2 are completed, billed, and sitting in retainage tracking; Map 3 is in the beginning phase with map review, 811, permits, survey, crew/equipment readiness, obstacles, and pre-job evidence still open.

## Run Locally

Recommended full-stack mode:

```bash
npm start
```

Then visit `http://127.0.0.1:8080`.

## Demo Login Workspaces

Sign in with one of these seeded emails and password `demo`:

- `ronald@jacksontelcom.example` - Admin
- `marcus@jacksontelcom.example` - Foreman
- `ops@jacksontelcom.example` - Operations
- `billing@jacksontelcom.example` - Billing
- `safety@jacksontelcom.example` - Safety/Compliance
- `groundhand@jacksontelcom.example` - Crew Member / Aerial Ground Hand
- `traffic@jacksontelcom.example` - Crew Member / Traffic Control
- `underground@jacksontelcom.example` - Crew Member / Underground Crew
- `operator@jacksontelcom.example` - Crew Member / Underground Operator

Static fallback:

```bash
python3 -m http.server 8080
```

Then visit `http://127.0.0.1:8080`. In static mode, records are stored in browser `localStorage`.

## Included Modules

- Role-based dashboard views for Admin, Foreman, Operations, Billing, Safety/Compliance, and Crew Member users
- Role-scoped navigation for Admin, Foreman, Operations, Billing, Safety/Compliance, and Crew Member
- Demo login screen with individual workspaces for each role
- Role workspaces refined around primary queues: Admin Exceptions, Foreman Today's Work, Operations Map Dispatch Board, Billing Cash Queue, and Safety Compliance Risk Queue
- Limited Crew Member workspace for ground hand, traffic control, aerial, and underground users to see assigned work, JSA/PPE signoff, safety documents, obstacles, equipment, time confirmation, and hazard reporting
- Time Tracking module for employee time, clock in/out, breaks, regular/OT/travel/standby hours, foreman approval, payroll export status, Map cost posting, and safety-hour metrics
- Responsive desktop and mobile layouts with table-to-card behavior on phones
- Executive dashboard with Map profitability, retainage, SQUAN score estimate, and risk exposure
- Map Hub for SQUAN maps, scope, budget, required certs, document control, and margin
- Source-credited sample photo evidence placeholders for aerial obstructions, underground utility conflicts, bucket truck inspection, and traffic-control setup
- Desktop Map drill-down with linked dailies, invoices, and risk events
- Field Operations daily workflow for JSA, inspections, 811, production, SOT, payroll, and inventory outputs
- Mobile-first Field Daily workflow with pre-job, work log, and closeout steps
- Dependency-free Node API with JSON persistence
- REST endpoints for maps/projects, Map units, dailies, time entries, daily line items, people, equipment, invoices, billing readiness, safety, documents, photo evidence, crews, cost codes, and unit prices
- End-to-end daily submit workflow that updates production units, Map cost, material usage, and billing readiness
- Executive, audit package, and CSV export endpoints
- People & Compliance ledger for certifications, background checks, drug tests, and workers' comp class
- Equipment & Materials controls for inspections, availability, SQUAN-supplied materials, and cost allocation
- Money module for invoice completeness, 30-day billing window, 90/10 retainage, AR, and pay-when-paid notes
- Safety, Quality, and Risk log for near misses, 5 Whys, Form 12 corrective actions, and audit metrics

## Data

Full-stack records are stored in `data/db.json`. Static fallback records are stored in browser `localStorage`.

## Workflow Guardrail

The build is now governed by the MVP workflow boundary in [docs/WORKFLOW_MVP_REVIEW.md](docs/WORKFLOW_MVP_REVIEW.md). New slices should support one of the core Jackson Telcom workflows: Map setup, release-to-field, field daily, documents/evidence, billing/collections, safety/compliance, or Admin approval/audit.

## First End-to-End Slice

The first implemented operating loop was:

`Map -> Field Daily -> Cost Update -> Billing Readiness`

Use the Field Operations screen to submit a daily with production quantity, labor hours, equipment hours, and SQUAN material usage. The server updates Map unit progress, actual cost, and the Money module billing readiness queue. Later slices extended the Admin/Billing collections workflow with decision evidence review, SLA tasks, readiness gates, and approval packet snapshots.

See [docs/BUILD_OUTLINE.md](docs/BUILD_OUTLINE.md) for the 1-10 ERP build path.
