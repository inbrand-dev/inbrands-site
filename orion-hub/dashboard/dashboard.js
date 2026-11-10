const root = document.querySelector("#dashboard-root");
const meta = document.querySelector("#snapshot-meta");

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function normalizeState(value = "") {
  return String(value).trim().toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
}

function badge(text, state = "") {
  const element = node("span", `small-badge state-${normalizeState(state || text)}`, text);
  return element;
}

function required(condition, message) {
  if (!condition) throw new Error(message);
}

function validateSnapshot(snapshot) {
  required(snapshot && typeof snapshot === "object", "Snapshot must be an object.");
  required(snapshot.schemaVersion === 1, "Unsupported snapshot schema version.");
  required(typeof snapshot.snapshotId === "string" && snapshot.snapshotId, "Snapshot ID is required.");
  required(typeof snapshot.capturedAt === "string" && snapshot.capturedAt, "Snapshot capturedAt is required.");
  required(snapshot.project && typeof snapshot.project.name === "string", "Project identity is required.");
  required(snapshot.milestone && typeof snapshot.milestone.name === "string", "Milestone is required.");
  required(snapshot.currentWorkUnit && typeof snapshot.currentWorkUnit.name === "string", "Current work unit is required.");

  for (const field of [
    "remainingWorkUnits",
    "recentlyCompleted",
    "deferred",
    "openDecisions",
    "blockers",
    "changesSincePrior",
    "evidenceBaseline",
  ]) {
    required(Array.isArray(snapshot[field]), `${field} must be an array.`);
  }

  required(snapshot.hours && typeof snapshot.hours === "object", "Hours/forecast block is required.");
  required(snapshot.tempo && typeof snapshot.tempo === "object", "Tempo block is required.");
  required(snapshot.reconciliation && typeof snapshot.reconciliation === "object", "Reconciliation block is required.");
  required(Array.isArray(snapshot.reconciliation.targets), "Reconciliation targets must be an array.");
  required(Array.isArray(snapshot.reconciliation.newScope), "Reconciliation newScope must be an array.");

  return snapshot;
}

function terminology(snapshot) {
  return {
    milestone: snapshot.project.terminology?.milestone || "Milestone",
    workUnit: snapshot.project.terminology?.workUnit || "Work Unit",
  };
}

function appendFact(parent, label, value) {
  if (!value) return;
  const box = node("div", "fact");
  box.append(node("span", "fact-label", label));
  box.append(node("div", "fact-value", value));
  parent.append(box);
}

function appendList(panel, items, emptyText, options = {}) {
  if (!items.length) {
    panel.append(node("p", "empty", emptyText));
    return;
  }

  const list = node("ul", options.className || "simple-list");
  for (const item of items) {
    const li = node("li", options.itemClassName || "simple-item");
    const row = node("div", "item-row");
    row.append(node("div", "item-title", item.name || item.title || item.summary || item.question || "Untitled"));

    const state = item.state || item.disposition;
    if (state) row.append(badge(state, state));
    li.append(row);

    const note =
      item.goal ||
      item.note ||
      item.reason ||
      item.impact ||
      item.nextAction ||
      item.movedTo ||
      item.answerNeeded ||
      "";
    if (note) li.append(node("p", "item-note", note));

    if (item.replacementId) {
      li.append(node("p", "item-note", `Replacement: ${item.replacementId}`));
    }

    list.append(li);
  }
  panel.append(list);
}

function panel(title, kicker = "") {
  const section = node("section", "panel");
  if (kicker) section.append(node("p", "panel-kicker", kicker));
  section.append(node("h2", "", title));
  return section;
}

function hoursText(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(Number(value) % 1 === 0 ? 0 : 1)} h`;
}

function rangeText(metric) {
  if (!metric || metric.low === undefined || metric.high === undefined) return "";
  return `${hoursText(metric.low)}–${hoursText(metric.high)} likely range`;
}

function metricCard(label, metric, extraClass = "") {
  const card = node("div", "metric");
  card.append(node("div", "metric-label", label));

  if (typeof metric === "number") {
    card.append(node("div", `metric-value ${extraClass}`.trim(), hoursText(metric)));
    return card;
  }

  const value = metric?.best;
  card.append(node("div", `metric-value ${extraClass}`.trim(), hoursText(value)));
  const range = rangeText(metric);
  if (range) card.append(node("div", "metric-range", range));
  return card;
}

function renderForecast(snapshot) {
  const p = panel("Hours & Forecast", "Trajectory");
  const grid = node("div", "forecast-grid");

  grid.append(metricCard("Project total", snapshot.hours.cumulativeProject));
  grid.append(metricCard("Remaining", snapshot.hours.remainingToMilestone));
  grid.append(metricCard("Projected milestone", snapshot.hours.projectedMilestoneTotal));

  const drift = snapshot.hours.forecastDrift || {};
  const driftMetric = node("div", "metric");
  driftMetric.append(node("div", "metric-label", "Forecast drift"));

  const driftHours = Number(drift.hours || 0);
  const driftPercent = Number(drift.percent || 0);
  const driftClass = driftHours > 0 ? "drift-positive" : driftHours < 0 ? "drift-negative" : "";
  const prefix = driftHours > 0 ? "+" : "";
  driftMetric.append(node("div", `metric-value ${driftClass}`.trim(), `${prefix}${hoursText(driftHours)}`));
  driftMetric.append(node("div", "metric-range", `${driftPercent > 0 ? "+" : ""}${driftPercent}% vs original`));
  grid.append(driftMetric);

  p.append(grid);

  if (Array.isArray(drift.classification) && drift.classification.length) {
    const line = node("p", "item-note", `Why it moved: ${drift.classification.join(", ")}`);
    p.append(line);
  }

  return p;
}

function renderTempo(snapshot) {
  const p = panel("Recent Work Mix", snapshot.tempo.windowLabel || "Tempo");
  const bar = node("div", "tempo-bar");

  const rows = [
    ["Planned milestone work", snapshot.tempo.plannedHours],
    ["Required discovery", snapshot.tempo.discoveryHours],
    ["Added scope", snapshot.tempo.addedScopeHours],
    ["Unplanned work", snapshot.tempo.unplannedHours],
  ];

  for (const [label, value] of rows) {
    const row = node("div", "tempo-row");
    row.append(node("span", "tempo-label", label));
    row.append(node("span", "tempo-value", hoursText(value)));
    bar.append(row);
  }

  p.append(bar);
  p.append(node("p", "item-note", `~${hoursText(snapshot.tempo.totalHoursApprox)} represented in this snapshot window.`));
  return p;
}

function detailsPanel(title, items, emptyText, itemOptions = {}) {
  const details = node("details", "details-panel");
  const summary = node("summary", "", title);
  summary.append(node("span", "", "›"));
  details.append(summary);
  const content = node("div", "details-content");
  appendList(content, items, emptyText, itemOptions);
  details.append(content);
  return details;
}

function render(snapshot) {
  const terms = terminology(snapshot);
  document.title = `${snapshot.project.name} · Orion Hub`;
  meta.textContent = `Snapshot ${snapshot.snapshotId} · ${new Date(snapshot.capturedAt).toLocaleString()}`;

  const fragment = document.createDocumentFragment();

  const hero = node("section", "hero-card");
  const heroRow = node("div", "hero-row");
  const heroText = node("div");
  heroText.append(node("p", "eyebrow", `Current ${terms.milestone}`));
  heroText.append(node("h1", "", snapshot.milestone.name));
  heroText.append(node("p", "hero-subtitle", snapshot.project.name));
  heroRow.append(heroText);
  heroRow.append(node("span", `state-badge state-${normalizeState(snapshot.milestone.state)}`, snapshot.milestone.state));
  hero.append(heroRow);

  const definition = node("div", "definition");
  definition.append(node("strong", "", "Definition of done"));
  definition.append(node("p", "", snapshot.milestone.definitionOfDone));
  hero.append(definition);
  fragment.append(hero);

  const primary = node("div", "primary-grid");

  const current = node("section", "current-work");
  current.append(node("p", "panel-kicker", `Current ${terms.workUnit}`));
  const currentHeader = node("div", "hero-row");
  currentHeader.append(node("h2", "", snapshot.currentWorkUnit.name));
  currentHeader.append(badge(snapshot.currentWorkUnit.state, snapshot.currentWorkUnit.state));
  current.append(currentHeader);
  current.append(node("p", "current-goal", snapshot.currentWorkUnit.plainEnglishGoal));

  const facts = node("div", "key-facts");
  appendFact(facts, "Current gate", snapshot.currentWorkUnit.currentGate);
  appendFact(facts, "Next action", snapshot.currentWorkUnit.nextAction);
  appendFact(
    facts,
    "Dependencies",
    snapshot.currentWorkUnit.dependencies?.length ? snapshot.currentWorkUnit.dependencies.join(" · ") : "None",
  );
  appendFact(
    facts,
    "Blockers",
    snapshot.currentWorkUnit.blockers?.length ? snapshot.currentWorkUnit.blockers.join(" · ") : "None",
  );
  current.append(facts);
  primary.append(current);

  const remaining = panel(`Remaining Until ${terms.milestone}`, "Known work");
  appendList(remaining, snapshot.remainingWorkUnits, `No remaining ${terms.workUnit.toLowerCase()}s are currently known.`, {
    className: "remaining-list",
    itemClassName: "remaining-item",
  });
  primary.append(remaining);

  fragment.append(primary);
  fragment.append(renderForecast(snapshot));

  const secondary = node("div", "secondary-grid");
  const decisions = panel("Open Decisions", "Owner input");
  appendList(decisions, snapshot.openDecisions, "No owner decisions are currently open.");
  secondary.append(decisions);

  const blockers = panel("Blockers", "Only genuine blockers");
  appendList(blockers, snapshot.blockers, "No genuine blockers.");
  secondary.append(blockers);

  const completed = panel("Recently Completed", "Latest movement");
  appendList(completed, snapshot.recentlyCompleted, "Nothing recently completed.");
  secondary.append(completed);

  secondary.append(renderTempo(snapshot));
  fragment.append(secondary);

  fragment.append(detailsPanel("Deferred", snapshot.deferred, "Nothing is currently deferred."));
  fragment.append(detailsPanel("Changes Since Prior Snapshot", snapshot.changesSincePrior, "No material changes recorded."));
  fragment.append(detailsPanel("Evidence Baseline", snapshot.evidenceBaseline, "No evidence baseline recorded."));
  fragment.append(detailsPanel("Snapshot Reconciliation", snapshot.reconciliation.targets, "No prior targets required reconciliation."));

  if (snapshot.reconciliation.newScope.length) {
    fragment.append(detailsPanel("New Scope Since Prior Snapshot", snapshot.reconciliation.newScope, "No new scope."));
  }

  root.replaceChildren(fragment);
}

function renderError(error) {
  const card = node("section", "error-card");
  card.append(node("p", "eyebrow", "Dashboard unavailable"));
  card.append(node("h1", "", "Snapshot could not be loaded"));
  card.append(node("p", "", error instanceof Error ? error.message : String(error)));
  root.replaceChildren(card);
  meta.textContent = "";
}

async function loadSnapshot() {
  const params = new URLSearchParams(location.search);
  const demo = params.get("demo") === "1";
  const project = params.get("project");

  let response;
  if (demo) {
    response = await fetch("./demo-snapshot.json", { cache: "no-store" });
  } else {
    if (!project || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(project)) {
      throw new Error("No valid project was selected. Use ?project=<project-id> or ?demo=1.");
    }
    response = await fetch(`/orion-hub/api/dashboard/current?project=${encodeURIComponent(project)}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
  }

  if (!response.ok) {
    if (response.status === 404) throw new Error("No canonical snapshot exists for this project yet.");
    throw new Error(`Snapshot request failed with HTTP ${response.status}.`);
  }

  return validateSnapshot(await response.json());
}

loadSnapshot().then(render).catch(renderError);
