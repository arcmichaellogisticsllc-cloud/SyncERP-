# Workflow Event Spine

SyncERP workflow mutations should move toward server-side events first, UI routing second.

## Canonical Records

- `workflowEvents`: immutable operational events such as `daily.submitted`, `billing.package.prepare`, `billing.package.submit`, `billing.package.response`, and `billing.package.squan-payment`.
- `workflowInstances`: current state for a business workflow instance, keyed by workflow type and aggregate record.
- `workflowTransitions`: compatibility transition rows for reports and existing UI surfaces. New code should treat these as derived from `workflowEvents`.
- `auditLog`: security and compliance audit records linked back to workflow events where possible.

## Rule

Pages must not be the source of downstream business effects. A page can request an action, but the server workflow layer owns:

- state changes
- blocker enforcement
- downstream record creation
- audit events
- workflow events
- transition history
- task creation or closure
- readiness recomputation

## Current Event Coverage

- Field Daily Submit creates a `daily.submitted` event and a `field-daily` workflow instance.
- Billing package prepare, submit, response/reject, payment, holdback, and contractor payment create `billing-package` workflow events and update the package workflow instance.

## Next Refactor Targets

1. Move Production Approval into the event spine.
2. Move Crew/Equipment release gates into the event spine.
3. Move QC Review outcomes into the event spine.
4. Move AR/retainage adjustments into the event spine.
5. Replace client-side workflow mutation fallbacks with server APIs.
