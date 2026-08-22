const tabs = document.querySelectorAll(".tab");
const toastEl = document.getElementById("toast");
const healthEl = document.getElementById("health");
const skillList = document.getElementById("skill-list");
const mcpList = document.getElementById("mcp-list");
const skillDetail = document.getElementById("skill-detail");
const mcpForm = document.getElementById("form-mcp");

let state = null;
let selectedSkill = null;
let selectedMcp = null;

function toast(message, ms = 2800) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.add("hidden"), ms);
}

async function api(pathname, options = {}) {
  const res = await fetch(pathname, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function project() {
  return document.getElementById("sync-project").checked;
}

function syncAllHarnesses() {
  return document.getElementById("sync-all").checked;
}

function overwriteImport() {
  return document.getElementById("import-overwrite").checked;
}

function showActivity(title, lines) {
  const el = document.getElementById("activity");
  el.classList.remove("hidden");
  el.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  el.append(heading, list);
}

function mcpSummary(server) {
  if (!server) return "";
  if (server.command) return [server.command, ...(server.args || [])].join(" ");
  return server.url || server.type || "";
}

function pairsFromText(text) {
  const out = {};
  for (const line of (text || "").split("\n")) {
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    if (key) out[key] = line.slice(index + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function pairsToText(map) {
  if (!map) return "";
  return Object.entries(map)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function setState(next) {
  state = next;
  render();
}

async function refresh() {
  setState(await api("/api/state"));
}

function render() {
  if (!state) return;
  document.getElementById("library-path").textContent = state.library;
  document.getElementById("stats").innerHTML =
    `<span><strong>${state.skills.length}</strong> skills</span>` +
    `<span><strong>${Object.keys(state.mcp).length}</strong> MCP</span>` +
    `<span><strong>${state.status.harnesses.filter((h) => h.detected).length}</strong> detected</span>`;

  renderHealth();
  renderSkills();
  renderMcps();
  renderHarnesses();
}

function compactNames(names, max = 6) {
  if (!names?.length) return "";
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max} more`;
}

function renderHealth() {
  const findings = state.health || [];
  const lead = document.getElementById("health-lead");
  const list = document.getElementById("health-list");
  healthEl.classList.toggle("hidden", findings.length === 0);
  if (!findings.length) return;

  const unmanaged = findings.find((item) => item.kind === "unmanaged-skills");
  lead.textContent = unmanaged
    ? unmanaged.detail || "Import left the original folders in place. Sync replaces them with Skillcp links."
    : "Drift between the library and detected harnesses.";
  lead.classList.remove("hidden");

  list.replaceChildren();
  for (const item of findings) {
    const li = document.createElement("li");
    li.className = item.level === "warn" ? "warn" : "info";
    const title = document.createElement("p");
    title.className = "health-item-title";
    title.textContent = item.title;
    li.append(title);
    if (item.names?.length) {
      const names = document.createElement("p");
      names.className = "health-names";
      names.textContent = compactNames(item.names);
      li.append(names);
    }
    list.append(li);
  }
}

function renderSkills() {
  skillList.replaceChildren();
  if (!state.skills.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No skills yet. Create one or import from a harness.";
    skillList.append(empty);
  }
  for (const skill of state.skills) {
    const li = document.createElement("li");
    if (selectedSkill === skill.name) li.classList.add("active");
    li.dataset.name = skill.name;
    const main = document.createElement("div");
    main.className = "item-main";
    const name = document.createElement("p");
    name.className = "name";
    name.textContent = skill.name;
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = skill.description || "No description";
    main.append(name, meta);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost danger";
    del.dataset.removeSkill = skill.name;
    del.textContent = "Remove";
    li.append(main, del);
    skillList.append(li);
  }
}

function renderMcps() {
  mcpList.replaceChildren();
  const names = Object.keys(state.mcp);
  if (!names.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No MCP servers yet. Save one on the right, or import.";
    mcpList.append(empty);
  }
  for (const name of names) {
    const server = state.mcp[name];
    const li = document.createElement("li");
    if (selectedMcp === name) li.classList.add("active");
    li.dataset.mcp = name;
    const main = document.createElement("div");
    main.className = "item-main";
    const title = document.createElement("p");
    title.className = "name";
    title.textContent = name;
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = mcpSummary(server);
    main.append(title, meta);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost danger";
    del.dataset.removeMcp = name;
    del.textContent = "Remove";
    li.append(main, del);
    mcpList.append(li);
  }
}

function renderHarnesses() {
  const body = document.getElementById("harness-rows");
  body.replaceChildren();
  for (const row of state.status.harnesses) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = row.name;
    const status = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `pill ${row.detected ? "ok" : "off"}`;
    pill.textContent = row.detected ? "detected" : "absent";
    status.append(pill);
    const skills = document.createElement("td");
    skills.textContent = row.skills ? `${row.skillMatches ?? 0}/${row.skillTotal ?? 0}` : "—";
    const mcp = document.createElement("td");
    mcp.textContent = row.mcp ? `${row.mcpMatches ?? 0}/${row.mcpTotal ?? 0}` : "—";
    const actions = document.createElement("td");
    const sync = document.createElement("button");
    sync.type = "button";
    sync.dataset.syncTo = row.id;
    sync.textContent = "Sync";
    const imp = document.createElement("button");
    imp.type = "button";
    imp.className = "ghost";
    imp.dataset.importTo = row.id;
    imp.textContent = "Import";
    actions.append(sync, imp);
    tr.append(name, status, skills, mcp, actions);
    body.append(tr);
  }
}

async function showSkill(name) {
  selectedSkill = name;
  renderSkills();
  const skill = await api(`/api/skills/${encodeURIComponent(name)}`);
  skillDetail.replaceChildren();
  const form = document.createElement("form");
  form.className = "form-stack";
  form.innerHTML = `
    <h2></h2>
    <label>Name<input name="name" readonly /></label>
    <label>Description<textarea name="description" rows="3" required></textarea></label>
    <label>Instructions<textarea name="body" rows="14"></textarea></label>
    <div class="row-actions"><button class="primary" type="submit">Save skill</button></div>
  `;
  form.querySelector("h2").textContent = skill.name;
  form.elements.namedItem("name").value = skill.name;
  form.elements.namedItem("description").value = skill.description;
  form.elements.namedItem("body").value = skill.body;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await api(`/api/skills/${encodeURIComponent(skill.name)}`, {
        method: "PUT",
        body: {
          description: form.elements.namedItem("description").value,
          body: form.elements.namedItem("body").value,
        },
      });
      setState(data.state);
      toast(`Saved ${skill.name}`);
    } catch (error) {
      toast(error.message);
    }
  });
  skillDetail.append(form);
}

function field(form, name) {
  return form.elements.namedItem(name);
}

function fillMcpForm(name) {
  selectedMcp = name;
  const server = name ? state.mcp[name] : null;
  document.getElementById("mcp-form-title").textContent = name ? `Edit ${name}` : "Add server";
  field(mcpForm, "name").value = name || "";
  field(mcpForm, "type").value = server?.type || (server?.url ? "http" : "stdio");
  field(mcpForm, "command").value = server?.command || "";
  field(mcpForm, "args").value = (server?.args || []).join(", ");
  field(mcpForm, "url").value = server?.url || "";
  field(mcpForm, "cwd").value = server?.cwd || "";
  field(mcpForm, "env").value = pairsToText(server?.env);
  field(mcpForm, "headers").value = pairsToText(server?.headers);
  renderMcps();
}

function showNewSkill() {
  selectedSkill = null;
  renderSkills();
  skillDetail.innerHTML = `
    <form class="form-stack" id="form-new-skill">
      <h2>New skill</h2>
      <label>Name<input name="name" required placeholder="code-review" /></label>
      <label>Description<textarea name="description" rows="3" required placeholder="When to use this skill"></textarea></label>
      <label>Instructions<textarea name="body" rows="12" placeholder="Markdown instructions"></textarea></label>
      <div class="row-actions"><button class="primary" type="submit">Create skill</button></div>
    </form>
  `;
  document.getElementById("form-new-skill").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = await api("/api/skills", {
        method: "POST",
        body: {
          name: form.elements.namedItem("name").value.trim(),
          description: form.elements.namedItem("description").value,
          body: form.elements.namedItem("body").value,
        },
      });
      setState(data.state);
      toast(`Created ${form.elements.namedItem("name").value.trim()}`);
      showSkill(form.elements.namedItem("name").value.trim());
    } catch (error) {
      toast(error.message);
    }
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.add("hidden"));
    document.getElementById(`panel-${tab.dataset.tab}`).classList.remove("hidden");
  });
});

document.getElementById("btn-new-skill").addEventListener("click", showNewSkill);

document.getElementById("form-add-skill").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await api("/api/skills", {
      method: "POST",
      body: {
        source: form.elements.namedItem("source").value.trim(),
        path: form.elements.namedItem("path").value.trim() || undefined,
      },
    });
    setState(data.state);
    const names = (data.added || []).map((item) => item.name).join(", ");
    toast(names ? `Added ${names}` : "No skills added");
    form.reset();
  } catch (error) {
    toast(error.message);
  }
});

skillList.addEventListener("click", async (event) => {
  const remove = event.target.closest("[data-remove-skill]");
  if (remove) {
    event.stopPropagation();
    const name = remove.dataset.removeSkill;
    if (!confirm(`Remove skill ${name} from the library?`)) return;
    try {
      const data = await api(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (selectedSkill === name) {
        selectedSkill = null;
        skillDetail.innerHTML = `<p class="empty">Select a skill to view or edit it.</p>`;
      }
      setState(data.state);
      toast(`Removed ${name}`);
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const row = event.target.closest("li[data-name]");
  if (row) showSkill(row.dataset.name);
});

mcpList.addEventListener("click", async (event) => {
  const remove = event.target.closest("[data-remove-mcp]");
  if (remove) {
    event.stopPropagation();
    const name = remove.dataset.removeMcp;
    if (!confirm(`Remove MCP server ${name}?`)) return;
    try {
      const data = await api(`/api/mcp/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (selectedMcp === name) fillMcpForm(null);
      setState(data.state);
      toast(`Removed ${name}`);
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const row = event.target.closest("li[data-mcp]");
  if (row) fillMcpForm(row.dataset.mcp);
});

mcpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const args = field(mcpForm, "args")
      .value.split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const name = field(mcpForm, "name").value.trim();
    const data = await api("/api/mcp", {
      method: "POST",
      body: {
        name,
        type: field(mcpForm, "type").value,
        command: field(mcpForm, "command").value.trim() || undefined,
        args: args.length ? args : undefined,
        url: field(mcpForm, "url").value.trim() || undefined,
        cwd: field(mcpForm, "cwd").value.trim() || undefined,
        env: pairsFromText(field(mcpForm, "env").value),
        headers: pairsFromText(field(mcpForm, "headers").value),
      },
    });
    setState(data.state);
    toast(`Saved ${name}`);
    fillMcpForm(name);
  } catch (error) {
    toast(error.message);
  }
});

document.getElementById("btn-mcp-reset").addEventListener("click", () => fillMcpForm(null));

async function runImport(harnesses) {
  try {
    const data = await api("/api/import", {
      method: "POST",
      body: { project: project(), overwrite: overwriteImport(), all: syncAllHarnesses(), harnesses },
    });
    setState(data.state);
    const skills = (data.result?.skills || []).filter((row) => row.action !== "skipped");
    const mcp = (data.result?.mcp || []).filter((row) => row.action !== "skipped");
    const summarize = (label, rows) => {
      if (!rows.length) return [];
      const names = rows.map((row) => row.name);
      if (names.length <= 8) return names.map((name, i) => `${label} ${rows[i].action}: ${name}`);
      return [`${names.length} ${label}s imported (${compactNames(names, 8)})`];
    };
    const lines = [...summarize("skill", skills), ...summarize("mcp", mcp)];
    if (skills.length || mcp.length) {
      lines.push("Original harness folders were left in place. Sync to replace them with Skillcp links.");
    }
    showActivity("Import", lines.length ? lines : ["Nothing new imported (existing entries were skipped)."]);
    toast("Import finished");
  } catch (error) {
    toast(error.message);
  }
}

async function runSync(harnesses) {
  try {
    const data = await api("/api/sync", {
      method: "POST",
      body: { project: project(), force: true, all: syncAllHarnesses(), harnesses },
    });
    setState(data.state);
    const counts = {};
    for (const target of data.targets || []) {
      counts[target.action] = (counts[target.action] || 0) + 1;
    }
    const lines = Object.entries(counts).map(([action, count]) => `${count} ${action}`);
    showActivity("Sync", lines.length ? lines : ["Nothing to sync."]);
    toast("Sync finished");
  } catch (error) {
    toast(error.message);
  }
}

document.getElementById("btn-import").addEventListener("click", () => runImport());
document.getElementById("btn-sync").addEventListener("click", () => runSync());
document.getElementById("btn-sync-all").addEventListener("click", () => runSync());
document.getElementById("harness-rows").addEventListener("click", (event) => {
  const syncTo = event.target.closest("[data-sync-to]");
  if (syncTo) runSync([syncTo.dataset.syncTo]);
  const importTo = event.target.closest("[data-import-to]");
  if (importTo) runImport([importTo.dataset.importTo]);
});
document.getElementById("btn-install").addEventListener("click", async () => {
  try {
    const data = await api("/api/install", { method: "POST", body: { project: project() } });
    setState(data.state);
    toast("Skillcp installed as a skill and MCP server");
  } catch (error) {
    toast(error.message);
  }
});

refresh().catch((error) => toast(error.message));
