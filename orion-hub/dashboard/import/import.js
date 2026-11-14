const fileInput = document.querySelector("#file");
const preview = document.querySelector("#preview");
const result = document.querySelector("#result");
const importButton = document.querySelector("#import");
let snapshot = null;

function showResult(text, ok) {
  result.hidden = false;
  result.className = ok ? "ok" : "error";
  result.textContent = text;
}

fileInput.addEventListener("change", async () => {
  snapshot = null;
  importButton.disabled = true;
  result.hidden = true;

  const file = fileInput.files?.[0];
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
    importButton.disabled = false;
  } catch (error) {
    preview.textContent = `Rejected locally: ${error instanceof Error ? error.message : String(error)}`;
  }
});

importButton.addEventListener("click", async () => {
  if (!snapshot) return;
  importButton.disabled = true;
  showResult("Importing…", true);

  try {
    const response = await fetch("/orion-hub/api/dashboard/snapshot", {
      method: "POST",
      credentials: "same-origin",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(snapshot),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);

    showResult(`Imported. Current snapshot: ${body.pointer?.snapshotId ?? snapshot.snapshotId}`, true);
  } catch (error) {
    showResult(`Import failed: ${error instanceof Error ? error.message : String(error)}`, false);
    importButton.disabled = false;
  }
});
