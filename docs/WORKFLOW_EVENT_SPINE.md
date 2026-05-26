# Workflow Event Spine

SyncERP workflow mutations should move toward server-side events first, UI routing second.

## Canonical Records

- `workflowEvents`: immutable operational events such as `daily.submitted`, `billing.package.prepare`, `billing.package.submit`, `billing.package.response`, and `billing.package.squan-payment`.
- `workflowInstances`: current state for a business workflow instance, keyed by workflow type and aggregate record.
- `workflowTransitions`: compatibility transition rows for reports and existing UI surfaces. New code should treat these as derived from `workflowEvents`.
- `auditLog`: security and compliance audit records linked back to workflow events where possible.
- `notifications`: event-created operational prompts for work that needs a person or role to act.

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

## Event Bus

`server/event-bus.js` validates operational event shape and routes consequences after a workflow event is recorded. Consequences include notifications, future task open/close behavior, readiness recomputation, and KPI updates.

Minimum event fields:

- `eventName`
- `workflowType`
- `aggregateType`
- `aggregateId`

The workflow engine then assigns event IDs, workflow instance IDs, transition rows, and audit links.

## Current Event Coverage

- Field Daily Submit creates a `daily.submitted` event, a `field-daily` workflow instance, a transition, an audit link, and a Review notification for QC.
- Billing package prepare, submit, response/reject, payment, holdback, and contractor payment create `billing-package` workflow events and update the package workflow instance.

## Next Refactor Targets

1. Move Production Approval into the event spine.
2. Move Crew/Equipment release gates into the event spine.
3. Move QC Review outcomes into the event spine.
4. Move AR/retainage adjustments into the event spine.
5. Replace client-side workflow mutation fallbacks with server APIs.
