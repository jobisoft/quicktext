/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// Compose-document side of /modules/composeToolbar.mjs. Injected via
// tabs.executeScript, possibly several times, hence the guard.
//
// Layout "fixed": the host is an empty inline element in <body>; the bar
// inside it is fixed at the top of the editor. The body gets a top margin of
// the bar's height, so the toolbar never covers any content.

(() => {
  if (globalThis.QuicktextComposeToolbar) {
    return;
  }

  // Keep in sync with HOST_CLASS in /modules/composeToolbar.mjs.
  const HOST_CLASS = "quicktext-compose-toolbar";
  const actions = new WeakMap();
  const menus = new WeakMap();

  let host = null;
  let style = null;
  let bar = null;
  let menu = null;
  let menuButton = null;

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  // A button that is not a Tab stop: Tab from the subject must go straight
  // into the message, not through the toolbar.
  function makeButton(className) {
    const b = el("button", className);
    b.type = "button";
    b.tabIndex = -1;
    return b;
  }

  function svg(markup) {
    const t = document.createElement("template");
    t.innerHTML = markup;
    return t.content.firstElementChild;
  }

  const ICONS = {
    chevron: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };

  function build() {
    // A draft saved while the toolbar was showing contains an empty host.
    removeCopies();
    host = el("div", HOST_CLASS);
    host.contentEditable = "false";
    const root = host.attachShadow({ mode: "open" });

    // Filled from the show message, before the host is attached.
    style = el("style");
    root.append(style);

    bar = el("div", "bar");
    bar.setAttribute("role", "toolbar");
    root.append(bar);

    // Clicking the toolbar must not take the caret out of the message.
    root.addEventListener("mousedown", e => e.preventDefault());
    root.addEventListener("click", onClick);
  }

  function attach() {
    // The host has no size, so where in the body it sits does not matter.
    if (!host.isConnected) {
      document.body.prepend(host);
    }
    // The body's children, and <html>'s: setting the body of an HTML message
    // (setComposeDetails) replaces the whole <body> element.
    removalObserver.observe(document.body, { childList: true });
    removalObserver.observe(document.documentElement, { childList: true });
    reserveSpace();
  }

  // The bar is fixed at the top of the editor (the host is an empty inline
  // element). The body gets a top margin of the bar's height, so the message
  // never goes behind it.
  // The margin comes from a constructed style sheet: it is not part of the
  // HTML, so it is neither sent nor saved in drafts.
  // The rule uses a selector of its own, so the sheet can be recognised: after
  // the add-on was reloaded or updated, the sheet of the previous copy of this
  // script is still adopted by an open composer. It must be removed before the
  // body's own margin is read, otherwise every reload adds the bar's height.
  const SPACE_SELECTOR = "body:not(.quicktext-compose-toolbar-space)";
  let spaceSheet = null;
  let bodyMarginTop = 0;
  const resizeObserver = new ResizeObserver(() => reserveSpace());

  function isSpaceSheet(sheet) {
    return sheet.cssRules[0]?.selectorText === SPACE_SELECTOR;
  }

  function reserveSpace() {
    if (!host?.isConnected) return;
    if (!spaceSheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => !isSpaceSheet(s));
      bodyMarginTop = parseFloat(getComputedStyle(document.body).marginTop) || 0;
      spaceSheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, spaceSheet];
      resizeObserver.observe(bar);
    }
    const height = bar.getBoundingClientRect().height;
    spaceSheet.replaceSync(`${SPACE_SELECTOR} { margin-top:${bodyMarginTop + height}px !important; }`);
  }

  function releaseSpace() {
    resizeObserver.disconnect();
    if (spaceSheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== spaceSheet);
      spaceSheet = null;
    }
  }

  // Editing can remove the toolbar like any other node: Backspace at the start
  // of a plain text message, select all + Delete, Cut. Put it straight back.
  // Re-parsing the message (e.g. a getComposeDetails/setComposeDetails round
  // trip) also leaves an empty copy of it behind, remove those (#667).
  const removalObserver = new MutationObserver(() => {
    removeCopies();
    if (!host.isConnected) attach();
  });

  // Every toolbar element in the document except our own. A copy has no
  // shadow root, so it is just an empty element.
  function removeCopies() {
    for (const e of document.querySelectorAll(`.${HOST_CLASS}`)) {
      if (e !== host) e.remove();
    }
  }

  function renderEntry(entry) {
    if (entry.disabled) {
      return el("span", "entry disabled", entry.label);
    }
    const entryButton = makeButton("entry");
    entryButton.append(el("span", "label", entry.label));
    if (entry.children) {
      entryButton.classList.add("has-menu");
      entryButton.setAttribute("aria-haspopup", "menu");
      entryButton.append(svg(ICONS.chevron));
      menus.set(entryButton, entry.children);
    } else {
      if (entry.hint) entryButton.title = entry.hint;
      actions.set(entryButton, entry.action);
    }
    return entryButton;
  }

  function render(model) {
    closeMenu();
    bar.replaceChildren();
    const main = el("div", "entries");
    for (const section of model.sections ?? []) {
      let target = main;
      if (section.label) {
        // Storage name above its buttons.
        const box = el("div", section.disabled ? "section disabled" : "section");
        box.append(el("div", "section-label", section.label));
        target = el("div", "section-entries");
        box.append(target);
        main.append(box);
      }
      for (const entry of section.entries ?? []) {
        target.append(renderEntry(entry));
      }
    }
    bar.append(main);
  }

  function openMenu(button) {
    closeMenu();
    menu = el("div", "menu");
    menu.setAttribute("role", "menu");
    for (const child of menus.get(button)) {
      const item = makeButton("item");
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

  function show(model, css) {
    if (!host) build();
    if (css && style.textContent !== css) {
      style.textContent = css;
    }
    render(model);
    attach();
  }

  function hide() {
    closeMenu();
    removalObserver.disconnect();
    host?.remove();
    removeCopies();
    releaseSpace();
  }

  globalThis.QuicktextComposeToolbar = { show, hide };

  browser.runtime.onMessage.addListener(message => {
    switch (message?.composeToolbar) {
      case "show":
        show(message.model, message.css);
        return Promise.resolve();
      case "hide":
        hide();
        return Promise.resolve();
    }
    return false;
  });
})();
