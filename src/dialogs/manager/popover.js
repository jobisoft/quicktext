/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

const overlay = document.getElementById("dialog-overlay");
const box = document.getElementById("dialog-box");
const titleEl = document.getElementById("dialog-title");
const messageEl = document.getElementById("dialog-message");
const contentEl = document.getElementById("dialog-content");
const fieldsEl = document.getElementById("dialog-fields");
const errorEl = document.getElementById("dialog-error");
const buttonsEl = document.getElementById("dialog-buttons");

// showDialog({ title?, message?, content?, wide?, fields?, buttons, focus?, noEnter?, onOpen?, onButton? })
//
//   title    - optional heading string
//   message  - optional body text
//   content  - optional DOM node shown below the message
//   wide     - optional, a wider dialog (e.g. for a list in `content`)
//   fields   - optional array of { id, label?, type?, value?, placeholder?, required? }
//   buttons  - array of { id, label, primary? }
//   focus    - optional id of the button to focus initially (default: the
//              first field, else the primary button)
//   noEnter  - optional, Enter does nothing (not even on a focused button);
//              for dialogs where an accidental Enter would be costly
//   onOpen   - optional (api) => void, called once the dialog is shown
//   onButton - optional async (buttonId, values, api) => bool
//              return false to keep the dialog open
//
// Resolves with { button, values } or null on dismiss.
export function showDialog({ title, message, content, wide, fields, buttons, focus, noEnter, onOpen, onButton }) {
  return new Promise(resolve => {
    titleEl.textContent = title || "";
    titleEl.hidden = !title;
    messageEl.textContent = message || "";
    messageEl.hidden = !message;
    contentEl.replaceChildren(...(content ? [content] : []));
    box.classList.toggle("wide", !!wide);
    fieldsEl.innerHTML = "";
    errorEl.textContent = "";
    buttonsEl.innerHTML = "";

    if (fields?.length) {
      for (const field of fields) {
        const label = document.createElement("label");
        if (field.label) {
          const span = document.createElement("span");
          span.textContent = field.label;
          label.appendChild(span);
        }
        const input = document.createElement("input");
        input.type = field.type || "text";
        input.id = `dialog-field-${field.id}`;
        if (field.value != null) input.value = field.value;
        if (field.placeholder) input.placeholder = field.placeholder;
        if (field.required) input.required = true;
        label.appendChild(input);
        fieldsEl.appendChild(label);
      }
    }

    for (const btn of buttons) {
      const el = document.createElement("button");
      el.textContent = btn.label;
      el.dataset.id = btn.id;
      if (btn.primary) el.classList.add("primary");
      buttonsEl.appendChild(el);
    }

    function getValues() {
      const values = {};
      if (fields?.length) {
        for (const field of fields) {
          const input = document.getElementById(`dialog-field-${field.id}`);
          values[field.id] = input?.value ?? "";
        }
      }
      return values;
    }

    const api = {
      setError(text) {
        errorEl.textContent = text || "";
      },
      setButtonEnabled(id, enabled) {
        const btn = buttonsEl.querySelector(`[data-id="${id}"]`);
        if (btn) btn.disabled = !enabled;
      },
    };

    function close(result) {
      overlay.hidden = true;
      overlay.removeEventListener("click", onOverlayClick);
      buttonsEl.removeEventListener("click", onButtonClick);
      document.removeEventListener("keydown", onKeyDown, true);
      resolve(result);
    }

    async function handleButton(buttonId) {
      const values = getValues();
      if (onButton) {
        const shouldClose = await onButton(buttonId, values, api);
        if (shouldClose === false) return;
      }
      close({ button: buttonId, values });
    }

    function onOverlayClick(e) {
      if (e.target === overlay) close(null);
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        close(null);
      }
      if (e.key === "Enter" && noEnter) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (e.key === "Enter" && e.target.tagName !== "BUTTON") {
        e.stopPropagation();
        e.preventDefault();
        const primary = buttonsEl.querySelector(".primary");
        if (primary && !primary.disabled) handleButton(primary.dataset.id);
      }
    }

    function onButtonClick(e) {
      const btn = e.target.closest("[data-id]");
      if (btn) handleButton(btn.dataset.id);
    }
    buttonsEl.addEventListener("click", onButtonClick);

    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeyDown, true);
    overlay.hidden = false;
    onOpen?.(api);

    const firstInput = fieldsEl.querySelector("input");
    if (focus) {
      buttonsEl.querySelector(`[data-id="${focus}"]`)?.focus();
    } else if (firstInput) {
      firstInput.focus();
      firstInput.select();
    } else {
      const primary = buttonsEl.querySelector(".primary");
      if (primary) primary.focus();
    }
  });
}

export async function showAlert(message) {
  await showDialog({
    message,
    buttons: [{ id: "ok", label: "OK", primary: true }],
  });
}

export async function showConfirm(message) {
  const result = await showDialog({
    message,
    buttons: [
      { id: "cancel", label: browser.i18n.getMessage("quicktext.close.label") },
      { id: "ok", label: "OK", primary: true },
    ],
  });
  return result?.button === "ok";
}

export async function showPrompt(message, defaultValue = "") {
  const result = await showDialog({
    message,
    fields: [{ id: "value", type: "text", value: defaultValue }],
    buttons: [
      { id: "cancel", label: browser.i18n.getMessage("quicktext.close.label") },
      { id: "ok", label: "OK", primary: true },
    ],
  });
  return result?.button === "ok" ? result.values.value : null;
}
