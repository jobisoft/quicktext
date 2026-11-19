/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// Lets the user choose which groups, templates and scripts of an export or
// import file to use. Shared by export and import (#668).

import { showDialog } from "./popover.js";

const i18n = (key, subs) => browser.i18n.getMessage(key, subs) || key;

// showSelectionDialog({ title, okLabel, payload, existing? })
//
//   payload  - { templates: { groups, texts }, scripts } (the export file format)
//   existing - optional bundle ({ groups, texts, scripts }) the payload would be
//              imported into: entries with a name that already exists there are
//              marked as replacing the existing one.
//
// Nothing is selected initially. Resolves with the payload reduced to the
// checked entries, or null on cancel.
export async function showSelectionDialog({ title, okLabel, payload, existing }) {
  const groups = payload.templates?.groups ?? [];
  const texts = payload.templates?.texts ?? [];
  const scripts = payload.scripts ?? [];

  const tree = el("div", "sel-tree");
  let api = null;
  const leaves = [];

  // A parent checkbox controls its children and shows their combined state.
  function makeParent(checkbox, children) {
    checkbox.addEventListener("change", () => {
      for (const child of children) child.setChecked(checkbox.checked);
      update();
    });
    return {
      setChecked(checked) {
        for (const child of children) child.setChecked(checked);
      },
      refresh() {
        for (const child of children) child.refresh?.();
        const checked = children.filter(c => c.isChecked()).length;
        const partial = children.some(c => c.isPartial?.());
        checkbox.checked = checked === children.length;
        checkbox.indeterminate = partial || (checked > 0 && checked < children.length);
      },
      isChecked: () => checkbox.checked,
      isPartial: () => checkbox.indeterminate,
    };
  }

  // `ref` is what the leaf stands for: { gi, text? } or { script }.
  function makeLeaf(checkbox, ref) {
    checkbox.addEventListener("change", update);
    const leaf = {
      ref,
      setChecked(checked) { checkbox.checked = checked; },
      isChecked: () => checkbox.checked,
    };
    leaves.push(leaf);
    return leaf;
  }

  function row(className, label, note) {
    const labelEl = el("label", className);
    const checkbox = el("input");
    checkbox.type = "checkbox";
    labelEl.append(checkbox, el("span", "sel-name", label));
    if (note) labelEl.append(el("span", "sel-note", note));
    return { labelEl, checkbox };
  }

  const replaces = i18n("quicktext.importexport.replaces");
  const sections = [];

  if (groups.length) {
    const section = row("sel-section", i18n("quicktext.templates.label"));
    tree.append(section.labelEl);
    const groupNodes = groups.map((group, gi) => {
      const existingPos = existing?.groups.findIndex(g => g.name === group.name) ?? -1;
      const groupRow = row("sel-group", group.name);
      tree.append(groupRow.labelEl);
      if (!texts[gi]?.length) {
        // An empty group is an entry of its own.
        return makeLeaf(groupRow.checkbox, { gi });
      }
      const textNodes = texts[gi].map(text => {
        const clash = existingPos !== -1 &&
          (existing.texts[existingPos] ?? []).some(t => t.name === text.name);
        const textRow = row("sel-item", text.name, clash ? replaces : null);
        tree.append(textRow.labelEl);
        return makeLeaf(textRow.checkbox, { gi, text });
      });
      return makeParent(groupRow.checkbox, textNodes);
    });
    sections.push(makeParent(section.checkbox, groupNodes));
  }

  if (scripts.length) {
    const section = row("sel-section", i18n("quicktext.scripts.label"));
    tree.append(section.labelEl);
    const scriptNodes = scripts.map(script => {
      const clash = existing?.scripts.some(s => s.name === script.name);
      const scriptRow = row("sel-item sel-script", script.name, clash ? replaces : null);
      tree.append(scriptRow.labelEl);
      return makeLeaf(scriptRow.checkbox, { script });
    });
    sections.push(makeParent(section.checkbox, scriptNodes));
  }

  function update() {
    for (const section of sections) section.refresh();
    api?.setButtonEnabled("ok", leaves.some(l => l.isChecked()));
  }

  const result = await showDialog({
    title,
    content: tree,
    wide: true,
    buttons: [
      { id: "cancel", label: i18n("quicktext.cancel.label") },
      { id: "ok", label: okLabel, primary: true },
    ],
    // Not the primary button: it starts disabled (nothing is selected), and
    // focus must not stay on the button behind the overlay.
    focus: "cancel",
    // Enter must not run or cancel the export/import by accident while
    // moving through the list with the keyboard.
    noEnter: true,
    onOpen(dialogApi) {
      api = dialogApi;
      update();
    },
  });
  if (result?.button !== "ok") return null;

  // Keep a group if it (when empty) or at least one of its templates is
  // checked; groups and texts stay index-aligned.
  const filtered = { templates: { groups: [], texts: [] }, scripts: [] };
  groups.forEach((group, gi) => {
    const checked = leaves.filter(l => l.ref.gi === gi && l.isChecked());
    if (checked.length) {
      filtered.templates.groups.push(group);
      filtered.templates.texts.push(checked.filter(l => l.ref.text).map(l => l.ref.text));
    }
  });
  filtered.scripts = leaves.filter(l => l.ref.script && l.isChecked()).map(l => l.ref.script);
  return filtered;
}

// Tells the user what an import added: a small table of counts, and that the
// entries are only kept after saving.
export async function showImportSummary({ groups, templates, scripts }) {
  const content = el("div", "import-summary");
  const table = el("div", "import-summary-counts");
  for (const [label, count] of [
    [i18n("quicktext.importexport.groups"), groups],
    [i18n("quicktext.templates.label"), templates],
    [i18n("quicktext.scripts.label"), scripts],
  ]) {
    table.append(el("span", "import-summary-label", label), el("span", "import-summary-count", String(count)));
  }
  content.append(table, el("p", "import-summary-hint", i18n("quicktext.importexport.saveHint")));
  await showDialog({
    title: i18n("quicktext.importexport.importSummary"),
    content,
    buttons: [{ id: "ok", label: "OK", primary: true }],
  });
}

// The groups, templates and scripts that can be read from parsed import data,
// in the export format. Entries that are not objects with a name are left out,
// and so are duplicates (the first group, template in a group, or script with
// a name wins). Returns null if nothing usable was found.
export function extractPayload(data) {
  const isEntry = e => e && typeof e === "object" && typeof e.name === "string";
  const list = v => (Array.isArray(v) ? v : []);
  const unique = entries => {
    const seen = new Set();
    return entries.filter(e => isEntry(e) && !seen.has(e.name) && seen.add(e.name));
  };
  const payload = { templates: { groups: [], texts: [] }, scripts: [] };
  const groupNames = new Set();
  list(data?.templates?.groups).forEach((group, gi) => {
    if (!isEntry(group) || groupNames.has(group.name)) return;
    groupNames.add(group.name);
    payload.templates.groups.push(group);
    payload.templates.texts.push(unique(list(data.templates.texts?.[gi])));
  });
  payload.scripts = unique(list(data?.scripts));
  return payload.templates.groups.length || payload.scripts.length ? payload : null;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}
