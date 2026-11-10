import { getStore } from "@netlify/blobs";

const STORE_NAME = "orion-dashboard-snapshots";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const PROJECT_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export const RECONCILIATION_DISPOSITIONS = [
  "COMPLETED",
  "CARRIED FORWARD / ACTIVE",
  "DEFERRED",
  "BLOCKED",
  "SUPERSEDED",
  "REMOVED / CANCELED",
  "UNRESOLVED",
] as const;

type Disposition = typeof RECONCILIATION_DISPOSITIONS[number];

interface TrackedItem {
  id: string;
  name: string;
  state?: string;
}

interface ReconciliationTarget {
  targetId: string;
  name: string;
  disposition: Disposition;
  note: string;
  replacementId?: string | null;
  ownerDecisionReference?: string | null;
}

interface SnapshotLike {
  schemaVersion: number;
  snapshotId: string;
  capturedAt: string;
  project: { id: string; name: string };
  currentWorkUnit: TrackedItem;
  remainingWorkUnits: TrackedItem[];
  deferred: Array<{ id: string; name: string }>;
  hours: {
    forecastHistory: Array<{
      capturedAt: string;
      projectedTotalBest: number;
      remainingBest: number;
    }>;
  };
  evidenceBaseline: unknown[];
  reconciliation: {
    priorSnapshotId: string | null;
    targets: ReconciliationTarget[];
    newScope: Array<{ id: string; name: string; reason: string }>;
  };
}

interface Heartbeat {
  schemaVersion: 1;
  heartbeatId: string;
  projectId: string;
  checkedAt: string;
  message: "No material project change this week";
  evidenceBaseline: unknown[];
  currentSnapshotId: string;
}

function store() {
  return getStore(STORE_NAME);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertId(value: string, label: string) {
  assert(ID_PATTERN.test(value), `${label} has an invalid id.`);
}

function assertProjectId(value: string) {
  assert(PROJECT_PATTERN.test(value), "Project id must be lowercase letters, numbers, and hyphens.");
}

function snapshotKey(projectId: string, snapshotId: string) {
  return `projects/${projectId}/snapshots/${snapshotId}.json`;
}

function currentKey(projectId: string) {
  return `projects/${projectId}/current.json`;
}

function heartbeatKey(projectId: string, heartbeatId: string) {
  return `projects/${projectId}/heartbeats/${heartbeatId}.json`;
}

function trackedItems(snapshot: SnapshotLike) {
  const items: TrackedItem[] = [
    snapshot.currentWorkUnit,
    ...snapshot.remainingWorkUnits,
    ...snapshot.deferred,
  ];

  const ids = new Set<string>();
  for (const item of items) {
    assertId(item.id, "Tracked work");
    assert(!ids.has(item.id), `Tracked work id ${item.id} appears more than once.`);
    ids.add(item.id);
  }

  return items;
}

function jsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateForecastHistory(previous: SnapshotLike, next: SnapshotLike) {
  const oldHistory = previous.hours.forecastHistory;
  const newHistory = next.hours.forecastHistory;

  assert(
    newHistory.length >= oldHistory.length,
    "Forecast history cannot shrink between canonical snapshots.",
  );

  for (let index = 0; index < oldHistory.length; index += 1) {
    assert(
      jsonEqual(oldHistory[index], newHistory[index]),
      `Forecast history entry ${index} was rewritten. Historical estimates are immutable.`,
    );
  }
}

export function validateReconciliation(previous: SnapshotLike, next: SnapshotLike) {
  assert(next.schemaVersion === 1, "Unsupported snapshot schema version.");
  assert(next.reconciliation.priorSnapshotId === previous.snapshotId, "priorSnapshotId does not match the current canonical snapshot.");

  const previousItems = trackedItems(previous);
  const nextItems = trackedItems(next);
  const previousIds = new Set(previousItems.map((item) => item.id));
  const nextIds = new Set(nextItems.map((item) => item.id));

  const records = new Map<string, ReconciliationTarget>();
  for (const record of next.reconciliation.targets) {
    assertId(record.targetId, "Reconciliation target");
    assert(previousIds.has(record.targetId), `Reconciliation target ${record.targetId} did not exist in the prior canonical snapshot.`);
    assert(!records.has(record.targetId), `Reconciliation target ${record.targetId} appears more than once.`);
    assert(RECONCILIATION_DISPOSITIONS.includes(record.disposition), `Invalid disposition for ${record.targetId}.`);

    if (record.disposition === "SUPERSEDED") {
      assert(record.replacementId, `SUPERSEDED target ${record.targetId} requires replacementId.`);
      assert(nextIds.has(record.replacementId), `Replacement ${record.replacementId} is not tracked in the new snapshot.`);
    }

    if (record.disposition === "REMOVED / CANCELED") {
      assert(
        typeof record.ownerDecisionReference === "string" && record.ownerDecisionReference.trim().length > 0,
        `REMOVED / CANCELED target ${record.targetId} requires an explicit project-owner decision reference.`,
      );
    }

    records.set(record.targetId, record);
  }

  for (const prior of previousItems) {
    assert(records.has(prior.id), `Prior target ${prior.id} disappeared without reconciliation.`);
  }

  assert(
    records.size === previousIds.size,
    "Reconciliation must account for every prior tracked target exactly once.",
  );

  for (const record of records.values()) {
    const remainsTracked = nextIds.has(record.targetId);

    if (record.disposition === "CARRIED FORWARD / ACTIVE" || record.disposition === "BLOCKED") {
      assert(remainsTracked, `${record.disposition} target ${record.targetId} must remain tracked.`);
    }

    if (record.disposition === "DEFERRED") {
      assert(next.deferred.some((item) => item.id === record.targetId), `DEFERRED target ${record.targetId} must remain in deferred work.`);
    }

    if (["COMPLETED", "SUPERSEDED", "REMOVED / CANCELED"].includes(record.disposition)) {
      assert(!remainsTracked, `${record.disposition} target ${record.targetId} must not remain active/deferred under the same id.`);
    }
  }

  const expectedNewIds = new Set([...nextIds].filter((id) => !previousIds.has(id)));
  const declaredNewIds = new Set<string>();

  for (const item of next.reconciliation.newScope) {
    assertId(item.id, "New scope");
    assert(expectedNewIds.has(item.id), `New-scope item ${item.id} is not actually new tracked work.`);
    assert(!declaredNewIds.has(item.id), `New-scope item ${item.id} appears more than once.`);
    declaredNewIds.add(item.id);
  }

  for (const id of expectedNewIds) {
    assert(declaredNewIds.has(id), `New tracked target ${id} was added without being declared as new scope.`);
  }

  validateForecastHistory(previous, next);
}

export async function readCanonicalSnapshot(projectId: string): Promise<SnapshotLike | null> {
  assertProjectId(projectId);
  const blobs = store();
  const pointer = await blobs.get(currentKey(projectId), {
    type: "json",
    consistency: "strong",
  }) as { snapshotId?: unknown } | null;

  if (!pointer || typeof pointer.snapshotId !== "string" || !ID_PATTERN.test(pointer.snapshotId)) {
    return null;
  }

  return await blobs.get(snapshotKey(projectId, pointer.snapshotId), {
    type: "json",
    consistency: "strong",
  }) as SnapshotLike | null;
}

export async function saveCanonicalSnapshot(next: SnapshotLike) {
  assert(next.schemaVersion === 1, "Unsupported snapshot schema version.");
  assertProjectId(next.project.id);
  assertId(next.snapshotId, "Snapshot");
  trackedItems(next);

  const blobs = store();
  const current = await blobs.getWithMetadata(currentKey(next.project.id), {
    type: "json",
    consistency: "strong",
  });

  let previous: SnapshotLike | null = null;
  if (current?.data && typeof (current.data as { snapshotId?: unknown }).snapshotId === "string") {
    const currentSnapshotId = (current.data as { snapshotId: string }).snapshotId;
    assertId(currentSnapshotId, "Current snapshot");
    previous = await blobs.get(snapshotKey(next.project.id, currentSnapshotId), {
      type: "json",
      consistency: "strong",
    }) as SnapshotLike | null;
    assert(previous, "Current snapshot pointer references a missing snapshot.");
  }

  if (previous) {
    validateReconciliation(previous, next);
  } else {
    assert(next.reconciliation.priorSnapshotId === null, "The first canonical snapshot must use priorSnapshotId = null.");
  }

  const snapshotWrite = await blobs.setJSON(snapshotKey(next.project.id, next.snapshotId), next, {
    onlyIfNew: true,
  });
  assert(snapshotWrite.modified, `Snapshot ${next.snapshotId} already exists. Canonical snapshots are immutable.`);

  const pointer = {
    schemaVersion: 1,
    snapshotId: next.snapshotId,
    updatedAt: next.capturedAt,
  };

  const pointerWrite = current?.etag
    ? await blobs.setJSON(currentKey(next.project.id), pointer, { onlyIfMatch: current.etag })
    : await blobs.setJSON(currentKey(next.project.id), pointer, { onlyIfNew: true });

  assert(
    pointerWrite.modified,
    "The canonical pointer changed concurrently. The immutable snapshot was preserved but was not made current.",
  );

  return pointer;
}

export async function saveHeartbeat(heartbeat: Heartbeat) {
  assertProjectId(heartbeat.projectId);
  assertId(heartbeat.heartbeatId, "Heartbeat");
  assertId(heartbeat.currentSnapshotId, "Heartbeat snapshot reference");
  assert(heartbeat.message === "No material project change this week", "Heartbeat message must use the canonical no-change wording.");

  const canonical = await readCanonicalSnapshot(heartbeat.projectId);
  assert(canonical, "Cannot record a heartbeat before the first canonical snapshot.");
  assert(canonical.snapshotId === heartbeat.currentSnapshotId, "Heartbeat must reference the current canonical snapshot.");
  assert(Array.isArray(heartbeat.evidenceBaseline), "Heartbeat must include the verified evidence baseline.");

  const result = await store().setJSON(
    heartbeatKey(heartbeat.projectId, heartbeat.heartbeatId),
    heartbeat,
    { onlyIfNew: true },
  );

  assert(result.modified, `Heartbeat ${heartbeat.heartbeatId} already exists.`);
  return heartbeat;
}
