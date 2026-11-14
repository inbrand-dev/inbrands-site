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
  if (!metric || typeof metric.low !== "number" || typeof metric.high !== "number") return "";
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
  grid.append(metricCard("Original forecast", snapshot.milestone.originalForecast));
  grid.append(metricCard("Spent this milestone", snapshot.hours.spentDuringMilestone));
  grid.append(metricCard("Remaining", snapshot.hours.remainingToMilestone));
  grid.append(metricCard("Projected milestone", snapshot.hours.projectedMilestoneTotal));

  const drift = snapshot.hours.forecastDrift || {};
  const driftMetric = node("div", "metric");
  driftMetric.append(node("div", "metric-label", "Forecast drift"));

  const driftHours = typeof drift.hours === "number" ? drift.hours : null;
  const driftPercent = typeof drift.percent === "number" ? drift.percent : null;
  const driftClass = driftHours === null ? "" : driftHours > 0 ? "drift-positive" : driftHours < 0 ? "drift-negative" : "";
  const prefix = driftHours !== null && driftHours > 0 ? "+" : "";
  driftMetric.append(node("div", `metric-value ${driftClass}`.trim(), driftHours === null ? "—" : `${prefix}${hoursText(driftHours)}`));
  driftMetric.append(node("div", "metric-range", driftPercent === null ? "Not established" : `${driftPercent > 0 ? "+" : ""}${driftPercent}% vs original`));
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
  p.append(node(
    "p",
    "item-note",
    typeof snapshot.tempo.totalHoursApprox === "number"
      ? `~${hoursText(snapshot.tempo.totalHoursApprox)} represented in this snapshot window.`
      : "Work-mix hours have not been estimated for this snapshot.",
  ));
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

  const forecastHistory = [...snapshot.hours.forecastHistory]
    .reverse()
    .map((entry, index) => ({
      id: `forecast-${index}`,
      name: new Date(entry.capturedAt).toLocaleString(),
      note: `Projected ${hoursText(entry.projectedTotalBest)} · Remaining ${hoursText(entry.remainingBest)}`,
    }));
  fragment.append(detailsPanel("Forecast History", forecastHistory, "No forecast history recorded."));

  root.replaceChildren(fragment);
}

function renderImporter() {
  document.title = "Snapshot Loader · Orion Hub";
  meta.textContent = "Authenticated utility";

  const card = node("section", "panel");
  card.append(node("p", "eyebrow", "Authenticated utility"));
  card.append(node("h1", "", "Snapshot Loader"));
  card.append(node("p", "hero-subtitle", "Loads a prepared canonical snapshot into Orion Hub. This page does not edit project data."));

  const label = node("label", "fact-label", "Snapshot JSON");
  label.htmlFor = "snapshot-file";
  label.style.marginTop = "18px";
  label.style.display = "block";

  const input = document.createElement("input");
  input.id = "snapshot-file";
  input.type = "file";
  input.accept = ".json,application/json";
  input.style.width = "100%";
  input.style.marginTop = "8px";

  const preview = node("pre", "fact", "Choose a snapshot file.");
  preview.style.whiteSpace = "pre-wrap";
  preview.style.marginTop = "14px";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Import canonical snapshot";
  button.disabled = true;
  button.style.width = "100%";
  button.style.minHeight = "48px";
  button.style.marginTop = "14px";
  button.style.borderRadius = "13px";
  button.style.fontWeight = "850";

  const result = node("pre", "fact", "");
  result.hidden = true;
  result.style.whiteSpace = "pre-wrap";
  result.style.marginTop = "14px";

  let snapshot = null;

  input.addEventListener("change", async () => {
    snapshot = null;
    button.disabled = true;
    result.hidden = true;
    const file = input.files?.[0];
    if (!file) {
      preview.textContent = "Choose a snapshot file.";
      return;
    }

    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.schemaVersion !== 1) throw new Error("Unsupported or missing schemaVersion.");
      if (!parsed?.project?.id || !parsed?.project?.name) throw new Error("Project identity is missing.");
      if (!parsed?.snapshotId) throw new Error("snapshotId is missing.");
      if (!parsed?.milestone?.name) throw new Error("Milestone is missing.");
      if (!parsed?.currentWorkUnit?.name) throw new Error("Current work unit is missing.");

      snapshot = parsed;
      preview.textContent = [
        `Project: ${parsed.project.name} (${parsed.project.id})`,
        `Snapshot: ${parsed.snapshotId}`,
        `Milestone: ${parsed.milestone.name}`,
        `Current work: ${parsed.currentWorkUnit.name}`,
        `Prior snapshot: ${parsed.reconciliation?.priorSnapshotId ?? "none — initial snapshot"}`,
      ].join("\n");
      button.disabled = false;
    } catch (error) {
      preview.textContent = `Rejected locally: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  button.addEventListener("click", async () => {
    if (!snapshot) return;
    button.disabled = true;
    result.hidden = false;
    result.textContent = "Importing…";

    try {
      const response = await fetch("/orion-hub/api/dashboard/snapshot", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      result.textContent = `Imported. Current snapshot: ${body.pointer?.snapshotId ?? snapshot.snapshotId}`;
    } catch (error) {
      result.textContent = `Import failed: ${error instanceof Error ? error.message : String(error)}`;
      button.disabled = false;
    }
  });

  card.append(label, input, preview, button, result);
  root.replaceChildren(card);
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
    if (response.status === 401) throw new Error("Your Orion Hub session expired. Reload this page to unlock the hub again.");
    if (response.status === 404) throw new Error("No canonical snapshot exists for this project yet.");
    throw new Error(`Snapshot request failed with HTTP ${response.status}.`);
  }

  return validateSnapshot(await response.json());
}

if (new URLSearchParams(location.search).get("import") === "1") {
  renderImporter();
} else {
  loadSnapshot().then(render).catch(renderError);
}
