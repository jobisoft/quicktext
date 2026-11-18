/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/**
 * Quicktext Bridge — beta/dev builds only.
 *
 * Exposes Quicktext's live template parser on a loopback HTTP socket, so a
 * script can drive it from the shell instead of a human driving it through a
 * compose window. The point is parser debugging and regression tests without a
 * rebuild-reload cycle per probe.
 *
 *     shell --HTTP--> native helper --native messaging--> this --> parser
 *
 * ## Presence and gating
 *
 * The build excludes this file from the ATN xpi, so on that channel the dynamic
 * import in background.js throws harmlessly and the feature is simply absent. In
 * beta/dev it is present but dark until the user switches it on in the options
 * page (`ENABLED_KEY`, default false) AND the native helper is installed. Two
 * deliberate acts, so neither installing an update nor flipping one switch is
 * enough on its own to open the port.
 *
 * ## Command table
 *
 * `COMMANDS` is the whole surface: an allow-list keyed by verb. The options
 * page never calls these — it talks to the two `bridge*` runtime messages
 * below. Only the native helper (loopback, token-guarded) reaches `COMMANDS`.
 */

import { QuicktextParser, getTags, STORAGE_STATE } from "/modules/quicktextParser.mjs";
import * as storage from "/modules/storage.mjs";
import * as quicktext from "/modules/quicktext.mjs";

const NATIVE_APP = "quicktext_bridge_host";

/** The helper version this build expects, matching `VERSION` in
 *  quicktext_bridge_host.py. The helper is installed outside the xpi, so the
 *  two can silently disagree; a mismatch is logged rather than guessed at. */
const EXPECTED_HELPER_VERSION = 2;

const ENABLED_KEY = "quicktext-bridge-enabled";

// Delay between answering the `reload` verb and calling runtime.reload(), so the
// reply reaches the caller before the native port is torn down.
const RELOAD_DELAY_MS = 100;

// The parser neutralises stray "[[" / "]]" in resolved values with these
// private-use sentinels between the resolve and the final unmask. Mirrored here
// so a trace can render them legibly and so `parse` can strip/restore exactly
// as parse() does.
const MASK_OPEN = "\uE000";
const MASK_CLOSE = "\uE001";
const viz = s =>
  typeof s === "string"
    ? s.replaceAll(MASK_OPEN, "«[[»").replaceAll(MASK_CLOSE, "«]]»")
    : s;
const unmask = s =>
  typeof s === "string"
    ? s.replaceAll(MASK_OPEN, "[[").replaceAll(MASK_CLOSE, "]]")
    : s;

// ── Command table ────────────────────────────────────────────────────────────

const COMMANDS = {
  help: {
    summary: "List every verb, or describe one with { verb }.",
    args: "{ verb? }",
    run: ({ verb }) => {
      if (verb) {
        const c = COMMANDS[verb];
        if (!c) throw new Error(`no such verb: ${verb}`);
        return { verb, summary: c.summary, args: c.args };
      }
      return Object.fromEntries(
        Object.entries(COMMANDS).map(([k, v]) => [
          k,
          { summary: v.summary, args: v.args },
        ]),
      );
    },
  },

  getBrowserInfo: {
    summary: "Which Thunderbird this is: name, version, buildID.",
    args: "{}",
    run: () => browser.runtime.getBrowserInfo(),
  },

  status: {
    summary: "Bridge link state, endpoint, activity, and the open compose tabs.",
    args: "{}",
    run: () => getStatus(),
  },

  listTemplates: {
    summary:
      "List the stored template groups and texts across the active bundles " +
      "(storageUuid, group/text names, content type, body preview) - the " +
      "coordinates parseTemplate takes.",
    args: "{}",
    run: async () => {
      const bundles = await storage.getActiveStorageEntries();
      return bundles.map(b => ({
        storageUuid: b.storageUuid,
        type: b.type,
        groups: (b.templates?.groups ?? []).map((g, gi) => ({
          name: g.name,
          texts: (b.templates?.texts?.[gi] ?? []).map(t => ({
            name: t.name,
            contentType: t.type,
            bodyPreview: (t.text ?? "").slice(0, 400),
          })),
        })),
      }));
    },
  },

  parseTemplate: {
    summary:
      "Parse a STORED template through the real [[TEXT=group|name]] path: the " +
      "body is resolved by get_text and spliced through maskStrayBrackets, " +
      "exactly as the compose menu inserts it. Returns the per-pass trace.",
    args: "{ group, name, storageUuid?, tabId?, maxPasses? }",
    run: async ({ group, name, storageUuid, tabId, maxPasses }) => {
      if (!group || !name) throw new Error("group and name are required");
      const bundles = await storage.getActiveStorageEntries();
      const has = (b) =>
        (b.templates?.groups ?? []).some(
          (g, gi) =>
            g.name === group &&
            (b.templates?.texts?.[gi] ?? []).some(t => t.name === name),
        );
      const bundle = storageUuid
        ? bundles.find(b => b.storageUuid === storageUuid)
        : bundles.find(has);
      if (!bundle) {
        throw new Error(`no active bundle has group "${group}" / text "${name}"`);
      }
      const boundTabId = await resolveComposeTab(tabId);
      const parser = new QuicktextParser(boundTabId, bundles);
      // The same storage binding the compose menu sets, so get_text finds the
      // body in this bundle.
      const stateByType = {
        vfs: STORAGE_STATE.VFS_TEMPLATE,
        import: STORAGE_STATE.IMPORT_TEMPLATE,
        managed: STORAGE_STATE.MANAGED_TEMPLATE,
      };
      parser.setActiveStorage({
        state: stateByType[bundle.type] ?? STORAGE_STATE.IMPORT_TEMPLATE,
        ref: bundle.type === "vfs" ? (bundle.storageRef ?? null) : null,
        uuid: bundle.storageUuid,
      });
      try {
        await parser.clearNonPersistentData();
      } catch {
        /* no tab-scoped state to clear */
      }
      const source = `[[TEXT=${group}|${name}]]`;
      const trace = await traceParse(parser, source, capOf(maxPasses));
      return {
        source,
        storageUuid: bundle.storageUuid,
        boundTabId,
        isPlainText: await plainTextOf(parser, boundTabId),
        ...trace,
      };
    },
  },

  // ── Compose windows ────────────────────────────────────────────────────────

  openComposeWindow: {
    summary: "Open a new compose window (browser.compose.beginNew). Returns tabId/windowId.",
    args: "{ details? }",
    run: async ({ details }) => {
      const tab = await browser.compose.beginNew(details ?? undefined);
      return { tabId: tab.id, windowId: tab.windowId };
    },
  },

  closeComposeWindow: {
    summary: "Close a compose tab by id (browser.tabs.remove).",
    args: "{ tabId }",
    run: async ({ tabId }) => {
      if (!Number.isInteger(tabId)) throw new Error("tabId (integer) is required");
      await browser.tabs.remove(tabId);
      return { closed: tabId };
    },
  },

  listComposeWindows: {
    summary: "List the open compose tabs (tabId, windowId, subject).",
    args: "{}",
    run: async () => {
      const tabs = await messenger.tabs.query({ type: "messageCompose" });
      const out = [];
      for (const t of tabs) {
        let subject = "";
        try {
          subject = (await browser.compose.getComposeDetails(t.id)).subject ?? "";
        } catch {
          /* tab going away */
        }
        out.push({ tabId: t.id, windowId: t.windowId, subject });
      }
      return out;
    },
  },

  getComposeDetails: {
    summary:
      "browser.compose.getComposeDetails(tabId) — body, plainTextBody, subject, " +
      "isPlainText, … Use after insertTemplate to see exactly what landed.",
    args: "{ tabId }",
    run: async ({ tabId }) => {
      if (!Number.isInteger(tabId)) throw new Error("tabId (integer) is required");
      return browser.compose.getComposeDetails(tabId);
    },
  },

  insertTemplate: {
    summary:
      "Insert a stored template into a compose window via the REAL production " +
      "path (quicktext.insertTemplate → parseAndInsert → insertBody). The reply " +
      "includes the resulting compose body, so a nested-tag bug shows as a " +
      "literal [[URL=…]] in `details.body`.",
    args: "{ tabId, group, name, storageUuid? }",
    run: async ({ tabId, group, name, storageUuid }) => {
      if (!Number.isInteger(tabId)) throw new Error("tabId (integer) is required");
      if (!group || !name) throw new Error("group and name are required");
      const bundle = await findBundle(group, name, storageUuid);
      const gi = bundle.templates.groups.findIndex(g => g.name === group);
      const ti = bundle.templates.texts[gi].findIndex(t => t.name === name);
      await quicktext.insertTemplate(tabId, bundle.storageUuid, gi, ti);
      let details = null;
      try {
        const d = await browser.compose.getComposeDetails(tabId);
        details = {
          isPlainText: d.isPlainText,
          body: d.body,
          plainTextBody: d.plainTextBody,
          subject: d.subject,
        };
      } catch {
        /* tab closed */
      }
      return {
        inserted: { group, name, storageUuid: bundle.storageUuid, groupIdx: gi, textIdx: ti },
        details,
      };
    },
  },

  insertVariable: {
    summary:
      "Insert a single variable/tag into a compose window via the REAL path " +
      "(quicktext.insertVariable → [[<variable>]]). `variable` omits the " +
      "brackets, e.g. \"VERSION\" or \"URL=http://…|get\". Returns the body.",
    args: "{ tabId, variable, storageRef? }",
    run: async ({ tabId, variable, storageRef }) => {
      if (!Number.isInteger(tabId)) throw new Error("tabId (integer) is required");
      if (typeof variable !== "string" || !variable) {
        throw new Error("variable (string, without [[ ]]) is required");
      }
      await quicktext.insertVariable({ tabId, variable, storageRef });
      let details = null;
      try {
        const d = await browser.compose.getComposeDetails(tabId);
        details = { isPlainText: d.isPlainText, body: d.body, plainTextBody: d.plainTextBody };
      } catch {
        /* tab closed */
      }
      return { inserted: variable, details };
    },
  },

  setComposeDetails: {
    summary:
      "browser.compose.setComposeDetails(tabId, details) — seed a compose " +
      "window's body/subject/to before inserting, to test insertion into " +
      "existing content.",
    args: "{ tabId, details }",
    run: async ({ tabId, details }) => {
      if (!Number.isInteger(tabId)) throw new Error("tabId (integer) is required");
      if (!details || typeof details !== "object") {
        throw new Error("details (object) is required");
      }
      await browser.compose.setComposeDetails(tabId, details);
      return { ok: true };
    },
  },

  listAttachments: {
    summary: "List a compose window's attachments (id, name, size) — verify ATTACHMENT/ATT tags.",
    args: "{ tabId }",
    run: async ({ tabId }) => {
      if (!Number.isInteger(tabId)) throw new Error("tabId (integer) is required");
      const atts = await browser.compose.listAttachments(tabId);
      return atts.map(a => ({ id: a.id, name: a.name, size: a.size }));
    },
  },

  // ── Template / group CRUD (writable bundles only) ────────────────────────────

  addGroup: {
    summary: "Add a template group to a writable (vfs) bundle.",
    args: "{ name, storageUuid? }",
    run: async ({ name, storageUuid }) => {
      if (!name) throw new Error("name is required");
      const b = await writableBundle(storageUuid);
      ensureTemplates(b);
      if (b.templates.groups.some(g => g.name === name)) {
        throw new Error(`group "${name}" already exists`);
      }
      b.templates.groups.push({ name });
      b.templates.texts.push([]);
      await saveBundle(b);
      return { added: name, storageUuid: b.storageUuid };
    },
  },

  setGroup: {
    summary: "Rename a template group.",
    args: "{ group, newName, storageUuid? }",
    run: async ({ group, newName, storageUuid }) => {
      if (!group || !newName) throw new Error("group and newName are required");
      const b = await writableBundle(storageUuid);
      b.templates.groups[groupIndex(b, group)].name = newName;
      await saveBundle(b);
      return { renamed: { from: group, to: newName }, storageUuid: b.storageUuid };
    },
  },

  deleteGroup: {
    summary: "Delete a template group and all its texts.",
    args: "{ group, storageUuid? }",
    run: async ({ group, storageUuid }) => {
      const b = await writableBundle(storageUuid);
      const gi = groupIndex(b, group);
      b.templates.groups.splice(gi, 1);
      b.templates.texts.splice(gi, 1);
      await saveBundle(b);
      return { deleted: group, storageUuid: b.storageUuid };
    },
  },

  addTemplate: {
    summary: "Add a template (text) to a group. type defaults to text/plain.",
    args: "{ group, name, text?, subject?, type?, storageUuid? }",
    run: async ({ group, name, text, subject, type, storageUuid }) => {
      if (!group || !name) throw new Error("group and name are required");
      const b = await writableBundle(storageUuid);
      const gi = groupIndex(b, group);
      if ((b.templates.texts[gi] ?? []).some(t => t.name === name)) {
        throw new Error(`text "${name}" already exists in group "${group}"`);
      }
      b.templates.texts[gi].push({
        name,
        text: text ?? "",
        shortcut: "",
        type: type ?? "text/plain",
        keyword: "",
        subject: subject ?? "",
      });
      await saveBundle(b);
      return { added: { group, name }, storageUuid: b.storageUuid };
    },
  },

  setTemplate: {
    summary: "Modify a template's body (text), subject, type, or name.",
    args: "{ group, name, text?, subject?, type?, newName?, storageUuid? }",
    run: async ({ group, name, text, subject, type, newName, storageUuid }) => {
      if (!group || !name) throw new Error("group and name are required");
      const b = await writableBundle(storageUuid);
      const gi = groupIndex(b, group);
      const t = b.templates.texts[gi][textIndex(b, gi, name)];
      if (text !== undefined) t.text = text;
      if (subject !== undefined) t.subject = subject;
      if (type !== undefined) t.type = type;
      if (newName !== undefined) t.name = newName;
      await saveBundle(b);
      return { updated: { group, name: newName ?? name }, storageUuid: b.storageUuid };
    },
  },

  deleteTemplate: {
    summary: "Delete a template (text) from a group.",
    args: "{ group, name, storageUuid? }",
    run: async ({ group, name, storageUuid }) => {
      const b = await writableBundle(storageUuid);
      const gi = groupIndex(b, group);
      b.templates.texts[gi].splice(textIndex(b, gi, name), 1);
      await saveBundle(b);
      return { deleted: { group, name }, storageUuid: b.storageUuid };
    },
  },

  // ── Scripts (writable bundles only) ──────────────────────────────────────────

  listScripts: {
    summary: "List the scripts in the active bundles (uuid, script names, body preview).",
    args: "{}",
    run: async () => {
      const bundles = await storage.getActiveStorageEntries();
      return bundles.map(b => ({
        storageUuid: b.storageUuid,
        type: b.type,
        scripts: (b.scripts ?? []).map(s => ({
          name: s.name,
          bodyPreview: (s.script ?? "").slice(0, 400),
        })),
      }));
    },
  },

  addScript: {
    summary: "Add a script to a writable (vfs) bundle.",
    args: "{ name, script?, storageUuid? }",
    run: async ({ name, script, storageUuid }) => {
      if (!name) throw new Error("name is required");
      const b = await writableBundle(storageUuid);
      b.scripts ??= [];
      if (b.scripts.some(s => s.name === name)) {
        throw new Error(`script "${name}" already exists`);
      }
      b.scripts.push({ name, script: script ?? "" });
      await saveBundle(b);
      return { added: name, storageUuid: b.storageUuid };
    },
  },

  setScript: {
    summary: "Modify a script's body or name. (edit)",
    args: "{ name, script?, newName?, storageUuid? }",
    run: async ({ name, script, newName, storageUuid }) => {
      if (!name) throw new Error("name is required");
      const b = await writableBundle(storageUuid);
      const s = (b.scripts ?? []).find(x => x.name === name);
      if (!s) throw new Error(`script "${name}" not found`);
      if (script !== undefined) s.script = script;
      if (newName !== undefined) s.name = newName;
      await saveBundle(b);
      return { updated: newName ?? name, storageUuid: b.storageUuid };
    },
  },

  deleteScript: {
    summary: "Delete a script from a bundle.",
    args: "{ name, storageUuid? }",
    run: async ({ name, storageUuid }) => {
      const b = await writableBundle(storageUuid);
      const i = (b.scripts ?? []).findIndex(x => x.name === name);
      if (i === -1) throw new Error(`script "${name}" not found`);
      b.scripts.splice(i, 1);
      await saveBundle(b);
      return { deleted: name, storageUuid: b.storageUuid };
    },
  },

  // ── Prefs ────────────────────────────────────────────────────────────────────

  getPref: {
    summary: "Read a Quicktext pref. Returns { value, isManaged }.",
    args: "{ name }",
    run: async ({ name }) => {
      if (!name) throw new Error("name is required");
      return storage.getPrefWithManagedInfo(name);
    },
  },

  setPref: {
    summary:
      "Set a Quicktext pref (e.g. allowRemoteRequests). Ignored for " +
      "policy-managed prefs. Returns the resulting { value, isManaged }.",
    args: "{ name, value }",
    run: async ({ name, value }) => {
      if (!name) throw new Error("name is required");
      await storage.setPref(name, value);
      return storage.getPrefWithManagedInfo(name);
    },
  },

  // ── Storage introspection ────────────────────────────────────────────────────

  listStorages: {
    summary:
      "List every storage location (uuid, name, type, isReadOnly, enabled, …); " +
      "config only, bulky `data` omitted. Maps storageUuid ↔ name.",
    args: "{}",
    run: async () => {
      const locs = (await storage.getAllStorageEntries()) ?? [];
      return locs.map(({ data, ...rest }) => rest);
    },
  },

  // ── Per-tab parser state (COUNTER, INPUT answers, …) ─────────────────────────

  getStateData: {
    summary: "Read the parser's per-tab state (session QuicktextStateData_<tabId>).",
    args: "{ tabId }",
    run: async ({ tabId }) => {
      if (!Number.isInteger(tabId)) throw new Error("tabId (integer) is required");
      const key = `QuicktextStateData_${tabId}`;
      return (await browser.storage.session.get({ [key]: {} }))[key];
    },
  },

  clearStateData: {
    summary: "Clear the parser's per-tab state (resets COUNTER, INPUT answers, …).",
    args: "{ tabId }",
    run: async ({ tabId }) => {
      if (!Number.isInteger(tabId)) throw new Error("tabId (integer) is required");
      await browser.storage.session.remove(`QuicktextStateData_${tabId}`);
      return { cleared: tabId };
    },
  },

  reload: {
    summary:
      "Reload the add-on (browser.runtime.reload()) to pick up a rebuilt dev " +
      "xpi. Needs a temporarily installed add-on. The reply is sent first; the " +
      "port then drops and the bridge reconnects on its own. Allow a few seconds.",
    args: "{}",
    run: async () => {
      // A reload only re-reads the xpi for a temporarily installed add-on; on a
      // permanent install it would restart the same code and just look broken.
      const { installType } = await browser.management.getSelf();
      if (installType !== "development") {
        throw new Error(
          `reload needs a temporarily installed add-on (this is "${installType}") ` +
            `- a reload would restart the same code`,
        );
      }
      // Answer before reloading: the reload tears down this very port, so a
      // reply sent afterwards would never leave. Close the native link cleanly
      // first - a spawn issued into a conduit the reload has torn can stall the
      // fresh instance; an orderly disconnect is the best shot at a clean start.
      setTimeout(() => {
        teardownLink();
        browser.runtime.reload();
      }, RELOAD_DELAY_MS);
      return { reloading: true, installType };
    },
  },
};

// ── Shared helpers ───────────────────────────────────────────────────────────

async function resolveComposeTab(tabId) {
  if (Number.isInteger(tabId)) return tabId;
  const tabs = await messenger.tabs.query({ type: "messageCompose" });
  return tabs[0]?.id ?? null;
}

function capOf(maxPasses) {
  return Number.isInteger(maxPasses) ? Math.min(Math.max(maxPasses, 1), 50) : 20;
}

async function plainTextOf(parser, boundTabId) {
  if (boundTabId == null) return null;
  try {
    return (await parser.getStaticDetails()).isPlainText;
  } catch {
    return null;
  }
}

// Drive the same fixpoint loop parse() runs — strip stray sentinels, then
// getTags + parseText until stable or capped — recording each pass. Returns the
// per-pass trace plus the final unmasked result (or the error and where it threw).
async function traceParse(parser, source, cap) {
  let cur = source.replaceAll(MASK_OPEN, "").replaceAll(MASK_CLOSE, "");
  const passes = [];
  let error = null;
  for (let n = 0; n < cap; n++) {
    const before = cur;
    let tagsSeen;
    try {
      tagsSeen = getTags(before).map(t => ({
        tag: t.tag,
        tagName: t.tagName,
        variables: t.variables,
      }));
    } catch (e) {
      error = { phase: "getTags", pass: n, message: e?.message ?? String(e), stack: e?.stack };
      break;
    }
    let after;
    try {
      after = await parser.parseText(before);
    } catch (e) {
      error = { phase: "parseText", pass: n, message: e?.message ?? String(e), stack: e?.stack };
      break;
    }
    const changed = after !== before;
    passes.push({ pass: n, tagsSeen, changed, before: viz(before), after: viz(after) });
    cur = after;
    if (!changed) break;
  }
  return { passCount: passes.length, result: error ? null : unmask(cur), error, passes };
}

// Find the active bundle holding group/name (by uuid if given). Read-only ok:
// insertTemplate and parseTemplate only read.
async function findBundle(group, name, storageUuid) {
  const bundles = await storage.getActiveStorageEntries();
  const has = (b) =>
    (b.templates?.groups ?? []).some(
      (g, gi) =>
        g.name === group &&
        (b.templates?.texts?.[gi] ?? []).some(t => t.name === name),
    );
  const bundle = storageUuid
    ? bundles.find(b => b.storageUuid === storageUuid)
    : bundles.find(has);
  if (!bundle) throw new Error(`no active bundle has group "${group}" / text "${name}"`);
  return bundle;
}

// A writable (non read-only) bundle for CRUD. Defaults to the first internal
// "vfs" bundle when no uuid is named.
async function writableBundle(storageUuid) {
  const bundles = await storage.getActiveStorageEntries();
  const b = storageUuid
    ? bundles.find(x => x.storageUuid === storageUuid)
    : bundles.find(x => x.type === "vfs");
  if (!b) {
    throw new Error(storageUuid ? `no bundle ${storageUuid}` : "no writable (vfs) bundle found");
  }
  return b;
}

function ensureTemplates(bundle) {
  bundle.templates ??= { groups: [], texts: [] };
  bundle.templates.groups ??= [];
  bundle.templates.texts ??= [];
}

function groupIndex(bundle, group) {
  const gi = (bundle.templates?.groups ?? []).findIndex(g => g.name === group);
  if (gi === -1) throw new Error(`group "${group}" not found`);
  return gi;
}

function textIndex(bundle, gi, name) {
  const ti = (bundle.templates?.texts?.[gi] ?? []).findIndex(t => t.name === name);
  if (ti === -1) throw new Error(`text "${name}" not found in group`);
  return ti;
}

async function saveBundle(bundle) {
  await storage.setBundleForStorage(bundle.storageUuid, {
    templates: bundle.templates,
    scripts: bundle.scripts,
  });
}

// ── Native link ──────────────────────────────────────────────────────────────

let port = null;
/** Where the running helper is listening, as it reported at startup:
 *  { url, token, version, stale }, or null whenever the port is down. */
let endpoint = null;
const activity = [];

/** The link's honest state. `port` alone cannot tell the truth: connectNative
 *  returns a Port object synchronously whether or not a helper ever spawns, and
 *  a spawn issued into a conduit torn by a reload neither completes nor fails -
 *  the page would then read "running" off a zombie Port. "up" therefore means
 *  the helper said hello and answers pings; everything else says what is known. */
let linkState = "off"; // "off" | "starting" | "up" | "failed"
let lastPong = 0; // ms epoch of the last pong (0 = none yet)
let helperListening = null; // the pong's report about the HTTP socket
let restartAttempts = 0; // failed starts since the last successful hello
let helloTimer = null; // spawn watchdog
let heartbeatTimer = null;
let restartTimer = null;
let pingSeq = 0;
let lastPingAnswered = true;

const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 15_000;
const RESTART_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 30_000];
const MAX_RESTART_ATTEMPTS = 5;
const ACTIVITY_LIMIT = 50;

function note(level, text) {
  activity.push({ at: Date.now(), level, text });
  if (activity.length > ACTIVITY_LIMIT * 2) {
    activity.splice(0, activity.length - ACTIVITY_LIMIT);
  }
}

async function isEnabled() {
  const rv = await browser.storage.local.get({ [ENABLED_KEY]: false });
  return !!rv[ENABLED_KEY];
}

function clearTimers() {
  if (helloTimer) clearTimeout(helloTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (restartTimer) clearTimeout(restartTimer);
  helloTimer = heartbeatTimer = restartTimer = null;
}

/** Drop the port and every timer, without touching the enabled flag. */
function teardownLink() {
  clearTimers();
  if (port) {
    try {
      port.disconnect();
    } catch {
      /* already gone */
    }
  }
  port = null;
  endpoint = null;
  lastPong = 0;
  helperListening = null;
  lastPingAnswered = true;
}

/** Tear the link down and, while the bridge is still enabled, try again on a
 *  backoff. Capped: a helper that keeps failing to start is retried five times
 *  and then declared "failed", so the page says so instead of flickering. Any
 *  successful hello resets the count. */
async function failAndMaybeRestart(why) {
  note("error", why);
  teardownLink();
  if (!(await isEnabled())) {
    linkState = "off";
    return;
  }
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    linkState = "failed";
    note(
      "error",
      `giving up after ${restartAttempts} failed starts - use Disable/Enable to try again, or reinstall the helper`,
    );
    return;
  }
  const delay =
    RESTART_BACKOFF_MS[Math.min(restartAttempts, RESTART_BACKOFF_MS.length - 1)];
  restartAttempts++;
  linkState = "starting";
  note("info", `restarting the helper in ${delay / 1000}s (attempt ${restartAttempts})`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    connect();
  }, delay);
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  lastPingAnswered = true;
  heartbeatTimer = setInterval(() => {
    if (!port) return;
    if (!lastPingAnswered) {
      // Two intervals without an answer: the pipe is dead or the helper is
      // wedged - either way, what a real request would hit.
      failAndMaybeRestart("helper stopped answering pings");
      return;
    }
    lastPingAnswered = false;
    try {
      port.postMessage({ type: "ping", id: ++pingSeq });
    } catch (err) {
      failAndMaybeRestart(`ping failed: ${err?.message ?? err}`);
    }
  }, HEARTBEAT_MS);
}

function reply(msg) {
  try {
    port?.postMessage(msg);
  } catch {
    /* the HTTP caller will time out; nothing to do */
  }
}

async function onNativeMessage(msg) {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "pong") {
    lastPong = Date.now();
    lastPingAnswered = true;
    helperListening = msg.listening !== false;
    return;
  }

  // The helper's opening message, carrying the address it settled on. No
  // requestId, which is what tells it apart from a command.
  if (msg.type === "hello") {
    if (helloTimer) {
      clearTimeout(helloTimer);
      helloTimer = null;
    }
    if (msg.error) {
      // The helper started but could not listen - almost always the port
      // already being in use. The backoff heals the in-use race a reload leaves.
      failAndMaybeRestart(`helper could not listen: ${msg.error}`);
      return;
    }
    linkState = "up";
    restartAttempts = 0;
    lastPong = Date.now();
    startHeartbeat();
    const version = msg.version ?? 0;
    endpoint = {
      url: `http://127.0.0.1:${msg.port}`,
      token: msg.token ?? "",
      version,
      appVersion: msg.appVersion ?? "",
      stale: version !== EXPECTED_HELPER_VERSION,
    };
    note(
      endpoint.stale ? "error" : "info",
      endpoint.stale
        ? `helper is version ${version}, this build expects ${EXPECTED_HELPER_VERSION} - re-download the installer`
        : `listening on ${endpoint.url}`,
    );
    return;
  }

  if (!msg.requestId) return;
  const { requestId, cmd, args } = msg;
  const command = COMMANDS[cmd];
  if (!command) {
    note("error", `${cmd} (refused: not in the command table)`);
    reply({
      requestId,
      ok: false,
      error: `command not allowed: ${cmd}`,
      errorCode: "E:NOT_ALLOWED",
    });
    return;
  }
  try {
    const result = await command.run(args ?? {});
    note("info", cmd);
    reply({ requestId, ok: true, result: result ?? null });
  } catch (err) {
    note("error", `${cmd}: ${err?.message ?? err}`);
    reply({
      requestId,
      ok: false,
      error: err?.message ?? String(err),
      errorCode: err?.code ?? null,
    });
  }
}

function connect() {
  if (port) return;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  linkState = "starting";
  try {
    port = browser.runtime.connectNative(NATIVE_APP);
  } catch (err) {
    port = null;
    failAndMaybeRestart(`could not start the helper app: ${err?.message ?? err}`);
    return;
  }
  const thisPort = port;
  port.onMessage.addListener(onNativeMessage);
  port.onDisconnect.addListener((p) => {
    if (port !== thisPort) return;
    // An unexpected death while enabled goes through the restart path: a link
    // that dies once (a reload race, a killed process) only needs reconnecting,
    // and the user should not have to be the retry loop.
    failAndMaybeRestart(`helper app disconnected: ${p.error?.message ?? "closed"}`);
  });
  // The helper derives its port from the Thunderbird major version (47000 +
  // major), so it binds nothing until we tell it which Thunderbird this is.
  // That is what lets an ESR and a release bridge run side by side.
  browser.runtime
    .getBrowserInfo()
    .then((info) => info.version)
    .catch(() => "") // the helper answers an empty version with a clear error
    .then((appVersion) => {
      if (port !== thisPort) return; // torn down while we were asking
      try {
        thisPort.postMessage({ type: "init", appVersion });
      } catch (err) {
        failAndMaybeRestart(`could not send init: ${err?.message ?? err}`);
      }
    });
  // The spawn watchdog. connectNative handing back a Port proves nothing; only
  // the helper's hello does. A spawn into a torn conduit hangs forever with no
  // error and no disconnect - that is the zombie this catches.
  helloTimer = setTimeout(() => {
    helloTimer = null;
    failAndMaybeRestart("helper did not say hello - spawn presumed stuck");
  }, HELLO_TIMEOUT_MS);
  note("info", "helper app starting");
}

function disconnect() {
  teardownLink();
  linkState = "off";
  restartAttempts = 0;
  note("info", "helper app stopped");
}

async function getStatus() {
  let composeTabs = [];
  try {
    composeTabs = (await messenger.tabs.query({ type: "messageCompose" }))
      .map(t => t.id);
  } catch {
    /* leave empty */
  }
  return {
    connected: linkState === "up",
    linkState,
    lastPongAgeMs: lastPong ? Date.now() - lastPong : null,
    helperListening,
    restartAttempts,
    enabled: await isEnabled(),
    endpoint,
    activity: activity.slice(-ACTIVITY_LIMIT),
    allowed: Object.keys(COMMANDS),
    helperVersionExpected: EXPECTED_HELPER_VERSION,
    composeTabs,
  };
}

// ── Options-page control surface ─────────────────────────────────────────────
// The options page (beta/dev only, gated on the nativeMessaging permission)
// drives the bridge through these two runtime messages. Kept separate from the
// native COMMANDS table: the page toggles the feature; the helper uses it.
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;
  if (message.bridgeGetStatus) {
    getStatus().then(sendResponse);
    return true; // async sendResponse
  }
  if ("bridgeSetEnabled" in message) {
    (async () => {
      await browser.storage.local.set({ [ENABLED_KEY]: !!message.bridgeSetEnabled });
      if (message.bridgeSetEnabled) {
        restartAttempts = 0;
        connect();
      } else {
        disconnect();
      }
      sendResponse(await getStatus());
    })();
    return true;
  }
  // Not ours: let other listeners handle it.
});

export async function initBackground() {
  if (await isEnabled()) connect();
}
