/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// Compose-document side of /modules/composeToolbar.mjs. Injected via
// tabs.executeScript, possibly several times, hence the guard.
//
// Layout "sticky": the host is placed in front of <body> and sticks to the top
// of the editor while scrolling. It takes up its own space, so it never covers
// any content.

(() => {
  if (globalThis.QuicktextComposeToolbar) {
    return;
  }

  const HOST_ID = "quicktext-compose-toolbar";
  const actions = new WeakMap();
  const menus = new WeakMap();

  let host = null;
  let bar = null;
  let menu = null;
  let menuButton = null;

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function svg(markup) {
    const t = document.createElement("template");
    t.innerHTML = markup;
    return t.content.firstElementChild;
  }

  const ICONS = {
    chevron: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    settings: `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 5.5A2.5 2.5 0 1 0 8 10.5 2.5 2.5 0 0 0 8 5.5zm0 3.75A1.25 1.25 0 1 1 8 6.75a1.25 1.25 0 0 1 0 2.5zM14 8.6V7.4l-1.6-.4a4.6 4.6 0 0 0-.5-1.2l.9-1.4-.85-.85-1.4.9a4.6 4.6 0 0 0-1.2-.5L9 2.2H7.8l-.4 1.6a4.6 4.6 0 0 0-1.2.5l-1.4-.9-.85.85.9 1.4a4.6 4.6 0 0 0-.5 1.2L2 7.4v1.2l1.6.4c.1.43.28.83.5 1.2l-.9 1.4.85.85 1.4-.9c.37.22.77.4 1.2.5l.4 1.6H9l.4-1.6c.43-.1.83-.28 1.2-.5l1.4.9.85-.85-.9-1.4c.22-.37.4-.77.5-1.2z"/></svg>`,
  };

  function build() {
    // A draft saved while the toolbar was showing contains an empty host.
    document.getElementById(HOST_ID)?.remove();
    host = el("div");
    host.id = HOST_ID;
    host.contentEditable = "false";
    const root = host.attachShadow({ mode: "open" });

    const style = el("link");
    style.rel = "stylesheet";
    style.href = browser.runtime.getURL("/scripts/composeToolbar.css");
    root.append(style);

    bar = el("div", "bar");
    bar.setAttribute("role", "toolbar");
    root.append(bar);

    // Clicking the toolbar must not take the caret out of the message.
    root.addEventListener("mousedown", e => e.preventDefault());
    root.addEventListener("click", onClick);
  }

  function attach() {
    // In front of <body>, so it takes up its own space at the top.
    if (host.parentNode !== document.documentElement || host.nextSibling !== document.body) {
      document.documentElement.insertBefore(host, document.body);
    }
  }

  function renderEntry(entry) {
    if (entry.disabled) {
      return el("span", "entry disabled", entry.label);
    }
    const button = el("button", "entry");
    button.type = "button";
    button.append(el("span", "label", entry.label));
    if (entry.children) {
      button.classList.add("has-menu");
      button.setAttribute("aria-haspopup", "menu");
      button.append(svg(ICONS.chevron));
      menus.set(button, entry.children);
    } else {
      if (entry.hint) button.title = entry.hint;
      actions.set(button, entry.action);
    }
    return button;
  }

  function render(model) {
    closeMenu();
    bar.replaceChildren();
    const main = el("div", "entries");
    for (const section of model.sections ?? []) {
      let target = main;
      if (section.label) {
        target = el("div", section.disabled ? "section disabled" : "section");
        target.append(el("span", "section-label", section.label));
        main.append(target);
      }
      for (const entry of section.entries ?? []) {
        target.append(renderEntry(entry));
      }
    }
    bar.append(main);

    const tools = el("div", "tools");
    for (const tool of model.tools ?? []) {
      const button = el("button", "tool");
      button.type = "button";
      button.title = tool.label;
      button.setAttribute("aria-label", tool.label);
      button.append(svg(ICONS[tool.icon] ?? ICONS.settings));
      actions.set(button, tool.action);
      tools.append(button);
    }
    bar.append(tools);
  }

  function openMenu(button) {
    closeMenu();
    menu = el("div", "menu");
    menu.setAttribute("role", "menu");
    for (const child of menus.get(button)) {
      const item = el("button", "item");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.append(el("span", "label", child.label));
      if (child.hint) item.append(el("span", "hint", child.hint));
      actions.set(item, child.action);
      menu.append(item);
    }
    bar.getRootNode().append(menu);

    // Below the button, kept inside the editor viewport.
    const r = button.getBoundingClientRect();
    const left = Math.max(4, Math.min(r.left, window.innerWidth - menu.offsetWidth - 4));
    menu.style.left = `${left}px`;
    menu.style.top = `${r.bottom + 2}px`;
    menu.style.maxHeight = `${Math.max(120, window.innerHeight - r.bottom - 12)}px`;

    menuButton = button;
    button.classList.add("open");
  }

  function closeMenu() {
    menu?.remove();
    menu = null;
    menuButton?.classList.remove("open");
    menuButton = null;
  }

  function onClick(e) {
    const target = e.target.closest?.("button");
    if (!target) return;
    if (menus.has(target)) {
      if (menuButton === target) {
        closeMenu();
      } else {
        openMenu(target);
      }
      return;
    }
    if (actions.has(target)) {
      const action = actions.get(target);
      closeMenu();
      browser.runtime.sendMessage({ composeToolbar: "action", action });
    }
  }

  // Close an open menu on any click outside of it, on Escape, and when the
  // editor scrolls or resizes (the menu is positioned relative to the viewport).
  document.addEventListener("mousedown", e => {
    if (menu && !e.composedPath().includes(host)) closeMenu();
  }, true);
  document.addEventListener("keydown", e => {
    if (menu && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    }
  }, true);
  window.addEventListener("resize", closeMenu);

  function show(model) {
    if (!host) build();
    render(model);
    attach();
  }

  function hide() {
    closeMenu();
    host?.remove();
  }

  globalThis.QuicktextComposeToolbar = { show, hide };

  browser.runtime.onMessage.addListener(message => {
    switch (message?.composeToolbar) {
      case "show":
        show(message.model);
        return Promise.resolve();
      case "hide":
        hide();
        return Promise.resolve();
    }
    return false;
  });
})();
