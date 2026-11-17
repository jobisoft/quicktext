/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// Compose-document side of /modules/composeToast.mjs. Injected on demand,
// possibly several times into the same document, so everything is guarded.
//
// The light DOM is a single empty host element outside of the body; all text
// and styles live in its shadow root. The host is not editable and is removed
// by the background before the message is sent.
(() => {
  if (globalThis.QuicktextComposeToast) {
    return;
  }

  // Keep in sync with HOST_ID in /modules/composeToast.mjs.
  const HOST_ID = "quicktext-compose-toast";

  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (text) {
      element.textContent = text;
    }
    return element;
  };

  const drawIcon = (path, strokeWidth) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", path);
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", strokeWidth);
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    svg.append(line);
    return svg;
  };

  // A host found here was not created by this instance: a draft saved while
  // a toast was showing, or a leftover of an earlier add-on instance.
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.contentEditable = "false";
  const root = host.attachShadow({ mode: "open" });

  // Filled from the show message, before the host is attached.
  const style = document.createElement("style");
  root.append(style);

  const bubble = make("details", "bubble");
  // No Tab stops: Tab in the compose window must not land in the toast.
  const summary = make("summary");
  summary.tabIndex = -1;
  const icon = make("img", "brand");
  icon.src = browser.runtime.getURL("/assets/icon.png");
  icon.alt = "";
  const heading = make("span", "heading");
  const title = make("strong", "title");
  const summaryText = make("span", "summary-text");
  heading.append(title, summaryText);

  const chevron = make("span", "chevron header-control");
  chevron.setAttribute("aria-hidden", "true");
  chevron.append(drawIcon("m7.5 5 5 5-5 5", "1.8"));

  const close = make("button", "close header-control");
  close.type = "button";
  close.tabIndex = -1;
  close.append(drawIcon("m5 5 10 10M15 5 5 15", "2.4"));
  close.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    hide();
  });

  summary.append(icon, heading, chevron, close);

  const panel = make("section", "panel");
  const details = make("ul", "details");
  const link = make("button", "link");
  link.type = "button";
  link.tabIndex = -1;
  link.addEventListener("click", () => {
    browser.runtime
      .sendMessage({ composeToast: "openLink" })
      .catch(error => console.error("[Quicktext] Could not open link", error));
  });
  panel.append(details, link);
  bubble.append(summary, panel);
  root.append(bubble);

  let labels = {};
  function updateToggleLabel() {
    const label = bubble.open ? labels.collapse : labels.expand;
    summary.title = label ?? "";
  }
  bubble.addEventListener("toggle", () => {
    // :has() cannot look into the shadow tree from the host.
    host.toggleAttribute("data-expanded", bubble.open);
    updateToggleLabel();
  });

  function show(model, css) {
    if (css && style.textContent !== css) {
      style.textContent = css;
    }
    if (model.tone) {
      host.dataset.tone = model.tone;
    } else {
      delete host.dataset.tone;
    }
    labels = model.labels ?? {};
    title.textContent = model.title ?? "";
    summaryText.textContent = model.summary ?? "";
    close.title = labels.close ?? "";
    close.setAttribute("aria-label", labels.close ?? "");

    details.replaceChildren();
    for (const line of model.details ?? []) {
      details.append(make("li", "", line));
    }
    details.hidden = !model.details?.length;

    link.textContent = model.link?.label ?? "";
    link.hidden = !model.link?.label;

    bubble.open = false;
    host.removeAttribute("data-expanded");
    updateToggleLabel();

    // Outside of the body, so it is not part of the editable content.
    if (!host.isConnected) {
      document.documentElement.append(host);
    }
  }

  function hide() {
    host.remove();
  }

  browser.runtime.onMessage.addListener(message => {
    switch (message?.composeToast) {
      case "show":
        show(message.model, message.css);
        return Promise.resolve(true);
      case "hide":
        hide();
        return Promise.resolve(true);
      default:
        return false;
    }
  });

  globalThis.QuicktextComposeToast = { show, hide };
})();
