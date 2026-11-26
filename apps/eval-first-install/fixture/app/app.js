// A small list app with no ayme in it. Its DOM matches the Page Objects in
// ../project/ayme/pom/, which were written for apps/example-vue's list demo.
// Every change is sent to the server, which keeps the list so the harness can
// check the outcome and a reload shows the same list.

const state = { items: [], nextId: 1, rev: 0 };
let editingId;
let archiveTargetId;

const $ = (id) => document.getElementById(id);

async function load() {
  const response = await fetch("/api/state");
  Object.assign(state, await response.json());
  render();
}

// Each save carries a higher revision, so the server keeps the latest even
// when two requests arrive out of order.
function save() {
  state.rev += 1;
  void fetch("/api/state", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
  });
}

function button(text, attributes, onClick) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  element.addEventListener("click", onClick);
  return element;
}

// Rows are kept by item id and updated in place, as a keyed framework list
// does, so a row's element stays the same while its item is on the list.
// A Page Object rooted at a row keeps its id across changes, as it does on
// apps/example-vue.
const rows = { active: new Map(), archived: new Map() };

function activeRow(item) {
  const row = document.createElement("li");
  const name = document.createElement("div");
  row.append(
    name,
    button(
      "Archive",
      { "data-action": "archive", "aria-label": `Archive ${item.id}` },
      () => openArchive(item)
    )
  );
  fillName(row, item);
  return row;
}

// Rebuilds the name part of an active row only when what it shows changed.
function fillName(row, item) {
  const shown =
    editingId === item.id ? `edit:${item.text}` : `view:${item.text}`;
  if (row.dataset.shown === shown) return;
  row.dataset.shown = shown;
  const name = row.firstElementChild;
  name.replaceChildren();
  if (editingId === item.id) {
    const input = document.createElement("input");
    input.value = item.text;
    input.setAttribute("aria-label", "Item name");
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      if (text) item.text = text;
      editingId = undefined;
      save();
      render();
    };
    input.addEventListener("keyup", (event) => {
      if (event.key === "Enter") commit();
    });
    input.addEventListener("blur", commit);
    name.append(input);
    queueMicrotask(() => input.focus());
  } else {
    name.append(
      button(item.text, { "data-action": "rename" }, () => {
        editingId = item.id;
        render();
      })
    );
  }
  const id = document.createElement("code");
  id.textContent = item.id;
  name.append(" ", id);
}

function archivedRow(item) {
  const row = document.createElement("li");
  const name = document.createElement("span");
  name.textContent = item.text;
  const id = document.createElement("code");
  id.textContent = item.id;
  const label = document.createElement("span");
  label.textContent = "Archived";
  label.setAttribute("data-archived-label", "");
  row.append(name, " ", id, label);
  return row;
}

// Removes the rows of items that left the list, updates the others in place
// and appends rows for new items. Items never change order, so appending
// keeps the list in item order.
function sync(list, kept, items, create, update) {
  const ids = new Set(items.map((item) => item.id));
  for (const [id, row] of kept) {
    if (!ids.has(id)) {
      row.remove();
      kept.delete(id);
    }
  }
  for (const item of items) {
    const row = kept.get(item.id);
    if (row) {
      update?.(row, item);
    } else {
      const created = create(item);
      kept.set(item.id, created);
      list.append(created);
    }
  }
}

function render() {
  const active = state.items.filter((item) => !item.archived);
  const archived = state.items.filter((item) => item.archived);
  sync($("active-items"), rows.active, active, activeRow, fillName);
  $("active-items").hidden = active.length === 0;
  $("no-active-items").hidden = active.length > 0;
  sync($("archived-items"), rows.archived, archived, archivedRow);
  $("archived-items").hidden = archived.length === 0;
  $("no-archived-items").hidden = archived.length > 0;
}

function openArchive(item) {
  archiveTargetId = item.id;
  $("archive-dialog-target").textContent = item.text;
  $("archive-dialog").hidden = false;
}

function closeArchive() {
  archiveTargetId = undefined;
  $("archive-dialog").hidden = true;
}

$("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("new-item");
  const text = input.value.trim();
  const error = $("new-item-error");
  if (!text) {
    error.textContent = "Enter an item name first.";
    error.hidden = false;
    return;
  }
  state.items.push({ id: `item-${state.nextId}`, text, archived: false });
  state.nextId += 1;
  input.value = "";
  error.hidden = true;
  save();
  render();
});

$("cancel-archive").addEventListener("click", closeArchive);
$("confirm-archive").addEventListener("click", () => {
  const item = state.items.find(
    (candidate) => candidate.id === archiveTargetId
  );
  if (item) item.archived = true;
  closeArchive();
  save();
  render();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("archive-dialog").hidden) closeArchive();
});

void load();
