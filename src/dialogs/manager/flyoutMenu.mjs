/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// A nested drop-down menu for extension pages. Each level is its own popover
// in the top layer, so no parent can clip it, and it is positioned with the
// vendored Floating UI (global FloatingUIDOM) after it is shown, when its real
// size is known.
//
// Nodes: { label, title?, children?: [...] } or { separator: true }. Any
// other properties are kept and handed back to onSelect.
//
//   const menu = openFlyoutMenu(button, nodes, { onSelect, onClose });
//   menu.close();

const { computePosition, flip, shift, size, offset } = FloatingUIDOM;

const OPEN_DELAY = 150;
const CLOSE_DELAY = 300;

export function openFlyoutMenu(anchor, nodes, { onSelect, onClose } = {}) {
  // Open levels, root first. Each: { list, group (the item that opened it) }.
  const levels = [];
  let openTimer = null;
  let closeTimer = null;
  let closed = false;

  const nodeOf = new WeakMap();

  function makeList(items) {
    const list = document.createElement("div");
    list.className = "flyout";
    list.setAttribute("role", "menu");
    list.popover = "manual";
    for (const node of items) {
      if (node.separator) {
        const sep = document.createElement("div");
        sep.className = "flyout-separator";
        sep.setAttribute("role", "separator");
        list.append(sep);
        continue;
      }
      const item = document.createElement("button");
      item.type = "button";
      item.className = "flyout-item";
      item.setAttribute("role", "menuitem");
      item.tabIndex = -1;
      item.textContent = node.label;
      item.title = node.title ?? node.label;
      if (node.children) {
        item.classList.add("flyout-group");
        item.setAttribute("aria-haspopup", "menu");
        item.setAttribute("aria-expanded", "false");
      }
      nodeOf.set(item, node);
      list.append(item);
    }
    list.addEventListener("click", onClick);
    list.addEventListener("pointerover", onPointerOver);
    list.addEventListener("pointerleave", onPointerLeave);
    list.addEventListener("keydown", onKeyDown);
    return list;
  }

  async function place(list, reference, isRoot) {
    const { x, y } = await computePosition(reference, list, {
      strategy: "fixed",
      placement: isRoot ? "bottom-end" : "left-start",
      middleware: [
        offset(isRoot ? 2 : { mainAxis: 0, crossAxis: -3 }),
        flip(isRoot ? {} : { fallbackPlacements: ["right-start"] }),
        shift({ padding: 4 }),
        size({
          padding: 4,
          apply({ availableHeight, elements }) {
            // shift() may move a long list up, so also cap it to the window.
            const max = Math.min(availableHeight, window.innerHeight - 8);
            elements.floating.style.maxHeight = `${Math.max(80, max)}px`;
          },
        }),
      ],
    });
    list.style.left = `${x}px`;
    list.style.top = `${y}px`;
  }

  function items(list) {
    return [...list.querySelectorAll(":scope > .flyout-item")];
  }

  function levelIndexOf(list) {
    return levels.findIndex(l => l.list === list);
  }

  // Close all levels deeper than `index`.
  function closeBelow(index) {
    while (levels.length > index + 1) {
      const { list, group } = levels.pop();
      group?.setAttribute("aria-expanded", "false");
      list.hidePopover();
      list.remove();
    }
  }

  async function openGroup(item, focusFirst) {
    const list = item.parentElement;
    const index = levelIndexOf(list);
    if (levels[index + 1]?.group === item) {
      if (focusFirst) items(levels[index + 1].list)[0]?.focus();
      return;
    }
    closeBelow(index);
    const sub = makeList(nodeOf.get(item).children);
    document.body.append(sub);
    sub.showPopover();
    levels.push({ list: sub, group: item });
    item.setAttribute("aria-expanded", "true");
    await place(sub, item, false);
    if (focusFirst) items(sub)[0]?.focus();
  }

  function clearTimers() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    openTimer = closeTimer = null;
  }

  function onPointerOver(e) {
    const list = e.currentTarget;
    const index = levelIndexOf(list);
    clearTimeout(closeTimer);
    closeTimer = null;
    const item = e.target.closest(".flyout-item");
    if (!item) return;
    // Pointer reached a submenu: keep its whole chain open.
    if (levels[index + 1]?.group === item) {
      clearTimeout(openTimer);
      return;
    }
    clearTimeout(openTimer);
    openTimer = setTimeout(() => {
      if (closed) return;
      if (item.classList.contains("flyout-group")) {
        openGroup(item, false);
      } else {
        closeBelow(index);
      }
    }, OPEN_DELAY);
  }

  function onPointerLeave(e) {
    clearTimeout(openTimer);
    const index = levelIndexOf(e.currentTarget);
    // Give the pointer time to travel into an open submenu.
    if (levels.length > index + 1) {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        if (!closed) closeBelow(index);
      }, CLOSE_DELAY);
    }
  }

  function onClick(e) {
    const item = e.target.closest(".flyout-item");
    if (!item) return;
    e.stopPropagation();
    clearTimers();
    if (item.classList.contains("flyout-group")) {
      openGroup(item, e.detail === 0);
      return;
    }
    const node = nodeOf.get(item);
    close();
    onSelect?.(node);
  }

  function onKeyDown(e) {
    const list = e.currentTarget;
    const index = levelIndexOf(list);
    const all = items(list);
    const pos = all.indexOf(document.activeElement);
    const item = all[pos];
    const move = to => {
      all[(to + all.length) % all.length]?.focus();
    };
    switch (e.key) {
      case "ArrowDown": move(pos + 1); break;
      case "ArrowUp": move(pos < 0 ? -1 : pos - 1); break;
      case "Home": move(0); break;
      case "End": move(-1); break;
      case "ArrowRight":
        if (item?.classList.contains("flyout-group")) openGroup(item, true);
        break;
      case "ArrowLeft":
      case "Escape":
        if (index > 0) {
          const { group } = levels[index];
          closeBelow(index - 1);
          group.focus();
        } else if (e.key === "Escape") {
          close();
        }
        break;
      case "Tab":
        close();
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function onOutsidePointerDown(e) {
    if (e.composedPath().some(el => el === anchor || el.classList?.contains("flyout"))) return;
    close({ focusAnchor: false });
  }

  function onWindowChange() {
    close({ focusAnchor: false });
  }

  function close({ focusAnchor = true } = {}) {
    if (closed) return;
    closed = true;
    clearTimers();
    closeBelow(-1);
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    window.removeEventListener("blur", onWindowChange);
    window.removeEventListener("resize", onWindowChange);
    anchor.setAttribute("aria-expanded", "false");
    if (focusAnchor) anchor.focus();
    onClose?.();
  }

  const root = makeList(nodes);
  document.body.append(root);
  root.showPopover();
  levels.push({ list: root, group: null });
  anchor.setAttribute("aria-expanded", "true");
  place(root, anchor, true).then(() => {
    if (!closed) items(root)[0]?.focus();
  });
  document.addEventListener("pointerdown", onOutsidePointerDown, true);
  window.addEventListener("blur", onWindowChange);
  window.addEventListener("resize", onWindowChange);

  return { close, get isOpen() { return !closed; } };
}
