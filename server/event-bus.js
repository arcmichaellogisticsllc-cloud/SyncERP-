const { emitWorkflowEvent } = require("./workflow-engine");

function ensureEventBusCollections(db) {
  db.notifications = db.notifications || [];
}

function nextNotificationId(db) {
  return `NTF-${String((db.notifications || []).length + 1).padStart(5, "0")}`;
}

function validateEvent(input = {}) {
  const required = ["eventName", "workflowType", "aggregateType", "aggregateId"];
  const missing = required.filter(key => !input[key]);
  if (missing.length) throw new Error(`operational event missing required field(s): ${missing.join(", ")}`);
}

function createNotification(db, input = {}) {
  ensureEventBusCollections(db);
  const now = input.createdAt || new Date().toISOString();
  const record = {
    id: input.id || nextNotificationId(db),
    eventId: input.eventId || "",
    workflowInstanceId: input.workflowInstanceId || "",
    project: input.project || "",
    packageKey: input.packageKey || "",
    title: input.title || "Workflow notification",
    detail: input.detail || "",
    severity: input.severity || "Info",
    status: input.status || "Open",
    owner: input.owner || "",
    role: input.role || "",
    workflowArea: input.workflowArea || "",
    relatedType: input.relatedType || "",
    relatedId: input.relatedId || "",
    createdAt: now,
    modifiedAt: now
  };
  db.notifications.push(record);
  return record;
}

function routeEventConsequences(db, result, input = {}) {
  if (input.eventName === "daily.submitted") {
    const payload = input.payload || {};
    createNotification(db, {
      eventId: result.event.id,
      workflowInstanceId: result.instance.id,
      project: input.project || "",
      title: "QC review triggered",
      detail: `${input.aggregateId} was submitted and needs QC review before production approval.`,
      severity: "Action",
      owner: payload.qcOwner || "Operations",
      role: "Operations",
      workflowArea: "Review",
      relatedType: "Daily",
      relatedId: input.aggregateId
    });
  }
}

function dispatchOperationalEvent(db, input = {}, deps = {}) {
  validateEvent(input);
  ensureEventBusCollections(db);
  const result = emitWorkflowEvent(db, input, deps);
  routeEventConsequences(db, result, input);
  return result;
}

module.exports = {
  createNotification,
  dispatchOperationalEvent,
  ensureEventBusCollections,
  validateEvent
};
