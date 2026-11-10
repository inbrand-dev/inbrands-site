# Orion Hub universal dashboard architecture

## Purpose

The dashboard is a read-only summary layer. It does not replace the authoritative records for any project.

The framework uses project-neutral concepts internally:

- Project
- Milestone
- Work Unit
- Snapshot
- Evidence Baseline
- Decision
- Blocker
- Forecast
- Disposition

A project may override the display labels for Milestone and Work Unit without changing the data model.

## Privacy boundary

`inbrand-dev/inbrands-site` is public. Real project snapshots must therefore **never** be committed to this repository.

Public repository content may include:

- renderer code
- CSS
- schemas
- synthetic fixtures
- documentation

Private project state is stored at runtime in the Netlify Blob store named:

`orion-dashboard-snapshots`

The Orion Hub password edge function protects both the dashboard page and the private snapshot read endpoint.

## Canonical storage layout

Canonical snapshots are immutable objects:

`projects/<project-id>/snapshots/<snapshot-id>.json`

The live dashboard follows a small mutable pointer:

`projects/<project-id>/current.json`

The pointer contains only the current snapshot ID and update timestamp.

Weekly no-change heartbeats are separate immutable records:

`projects/<project-id>/heartbeats/<heartbeat-id>.json`

A heartbeat never rewrites the canonical snapshot.

## Canonical snapshot contract

Schema:

`/orion-hub/dashboard/project-snapshot.schema.json`

The contract preserves:

- current milestone and definition of done
- current work unit, goal, state, gate, next action, dependencies and blockers
- remaining work until the milestone
- recently completed work
- deferred work and reason
- open owner decisions
- genuine blockers
- changes since the prior snapshot
- evidence baseline
- cumulative project-hour estimate and range
- milestone spent/remaining/projected estimates
- original forecast and forecast drift classification
- append-only forecast history
- approximate recent work mix
- complete reconciliation against the previous canonical snapshot
- separately declared new scope

## Reconciliation invariant

Before a new canonical snapshot may become current, the updater must load the current canonical snapshot.

Every tracked target from the prior snapshot is the union of:

1. the prior current work unit
2. prior remaining work units
3. prior deferred work

Every one of those IDs must appear exactly once in `reconciliation.targets`.

Allowed dispositions are:

- `COMPLETED`
- `CARRIED FORWARD / ACTIVE`
- `DEFERRED`
- `BLOCKED`
- `SUPERSEDED`
- `REMOVED / CANCELED`
- `UNRESOLVED`

Additional enforcement:

- `SUPERSEDED` requires a replacement ID that exists in the new tracked work.
- `REMOVED / CANCELED` requires an explicit project-owner decision reference.
- carried-forward or blocked work must remain tracked.
- deferred work must remain in the deferred collection.
- completed, superseded, or removed work cannot remain tracked under the same ID.
- every newly tracked ID must appear in `reconciliation.newScope`.
- old forecast-history entries must remain field-for-field equivalent in later snapshots.

The runtime enforcement implementation is:

`netlify/lib/dashboardSnapshotStore.ts`

This is the protection against silent disappearance. The rule is enforced before the current pointer can advance.

## Immutable write order

A canonical update uses this order:

1. Read the current pointer with strong consistency.
2. Read the prior canonical snapshot.
3. Validate reconciliation and historical forecast preservation.
4. Write the new snapshot with `onlyIfNew`.
5. Advance the current pointer conditionally using its prior ETag.

If the pointer changes concurrently, the new immutable snapshot may remain as an orphaned non-current record, but the previous canonical pointer is not silently overwritten. This is preferable to a pointer that references a missing snapshot.

## Weekly and manual checks

Weekly checks and manual "run snapshot now" requests must use the same reconciliation and save path.

The only difference is the trigger.

If there is meaningful project movement:

- build a new canonical snapshot
- reconcile against current
- save immutable history
- advance current

If there is no meaningful movement:

- keep the canonical snapshot unchanged
- write an immutable heartbeat with the exact message:
  `No material project change this week`
- include the newly verified Evidence Baseline

Do not create a second snapshot format for weekly checks.

## Main-page hierarchy

The renderer intentionally prioritizes:

1. Current milestone
2. Current work unit
3. Remaining until milestone
4. Hours and forecast movement
5. Open decisions and blockers
6. Recently completed work
7. Recent work mix
8. Deferred work
9. Changes, evidence and reconciliation detail

Lower-priority material uses progressive disclosure.

Repository diffs, audit transcripts, and dense technical evidence do not belong on the landing view.

## Forecasting rules

Hour estimates are ranges, not timesheets.

A canonical snapshot preserves:

- cumulative project best estimate and range
- milestone hours already spent
- remaining milestone estimate and range
- projected milestone total
- drift against the original forecast

Forecast drift may be classified with:

- Scope Change
- Execution Variance
- Required Discovery
- Estimate Refinement

Forecast history is append-only. Previous entries may not be rewritten.

## Work-mix rules

The snapshot may approximately classify recent effort as:

- Planned Milestone Work
- Required Discovery
- Added Scope
- Unplanned Work

This is deliberately approximate. It must not become minute-level time tracking.

## Current implementation boundary

Implemented:

- universal browser renderer
- versioned snapshot schema
- heartbeat schema
- synthetic fixture
- private authenticated read path
- Netlify Blob storage contract
- canonical reconciliation/write library

Not yet implemented:

- a public or website-based snapshot editor
- an externally callable snapshot-write endpoint
- project-specific canonical snapshots
- IRL Tower Defense project mapping
- automated weekly triggers
- historical snapshot browsing UI

The write endpoint is intentionally deferred until the control path is defined. The website remains read-only.
