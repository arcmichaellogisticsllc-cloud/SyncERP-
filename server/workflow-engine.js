function slug(value = "") {
  return String(value || "record").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toUpperCase() || "RECORD";
}

function nextId(rows = [], prefix) {
  return `${prefix}-${String(rows.length + 1).padStart(5, "0")}`;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function workflowInstanceId(input = {}) {
  return `WFI-${slug(input.workflowType || "workflow")}-${slug(input.aggregateType || "record")}-${slug(input.aggregateId || input.packageKey || input.project || "unknown")}`;
}

function ensureWorkflowCollections(db) {
  db.workflowEvents = db.workflowEvents || [];
  db.workflowInstances = db.workflowInstances || [];
  db.workflowTransitions = db.workflowTransitions || [];
}

function emitWorkflowEvent(db, input = {}, deps = {}) {
  ensureWorkflowCollections(db);
  if (!input.eventName) throw new Error("workflow eventName is required");
  if (!input.workflowType) throw new Error("workflow workflowType is required");
  if (!input.aggregateType) throw new Error("workflow aggregateType is required");
  if (!input.aggregateId) throw new Error("workflow aggregateId is required");

  const now = input.at || new Date().toISOString();
  const instanceId = input.workflowInstanceId || workflowInstanceId(input);
  const existingInstance = db.workflowInstances.find(item => item.id === instanceId);
  const previousStatus = input.fromStatus ?? existingInstance?.status ?? "";
  const nextStatus = input.toStatus ?? input.status ?? existingInstance?.status ?? "";
  const relatedRecords = unique([
    ...(existingInstance?.relatedRecords || []),
    ...(input.relatedRecords || [])
  ]);
  const event = {
    id: nextId(db.workflowEvents, "WFE"),
    eventName: input.eventName,
    workflowType: input.workflowType,
    workflowInstanceId: instanceId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    project: input.project || input.projectId || "",
    packageKey: input.packageKey || "",
    owner: input.owner || "",
    role: input.role || "",
    actor: input.actor || input.owner || "System",
    fromStatus: previousStatus,
    toStatus: nextStatus,
    blockers: input.blockers || input.blockedReasons || [],
    relatedRecords: input.relatedRecords || [],
    correlationId: input.correlationId || instanceId,
    causationId: input.causationId || "",
    payload: input.payload || {},
    auditAction: input.auditAction || input.eventName,
    notes: input.notes || "",
    createdAt: now,
    modifiedAt: now
  };
  db.workflowEvents.push(event);

  const instance = {
    ...(existingInstance || {}),
    id: instanceId,
    workflowType: input.workflowType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    project: event.project,
    packageKey: event.packageKey,
    status: nextStatus || previousStatus || "Open",
    previousStatus,
    owner: input.owner || existingInstance?.owner || "",
    role: input.role || existingInstance?.role || "",
    openBlockers: event.blockers,
    relatedRecords,
    lastEventId: event.id,
    lastEventName: event.eventName,
    lastEventAt: now,
    transitionCount: Number(existingInstance?.transitionCount || 0) + 1,
    createdAt: existingInstance?.createdAt || now,
    modifiedAt: now
  };
  if (existingInstance) Object.assign(existingInstance, instance);
  else db.workflowInstances.push(instance);

  if (input.transitionName || previousStatus || nextStatus) {
    db.workflowTransitions.push({
      id: nextId(db.workflowTransitions, "WF"),
      transition: input.transitionName || input.eventName,
      workflowEventId: event.id,
      workflowInstanceId: instance.id,
      packageKey: event.packageKey,
      project: event.project,
      fromStatus: previousStatus,
      toStatus: nextStatus,
      owner: input.owner || event.actor,
      blockedReasons: event.blockers,
      relatedRecords: event.relatedRecords,
      auditAction: event.auditAction,
      notes: event.notes,
      createdAt: now,
      modifiedAt: now
    });
  }

  if (typeof deps.appendAudit === "function") {
    deps.appendAudit(db, event.auditAction, {
      eventId: event.id,
      workflowInstanceId: instance.id,
      workflowType: event.workflowType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      project: event.project,
      packageKey: event.packageKey,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      by: event.actor,
      ...(input.auditDetail || {})
    });
  }

  return { event, instance };
}

module.exports = {
  emitWorkflowEvent,
  ensureWorkflowCollections,
  workflowInstanceId
};
