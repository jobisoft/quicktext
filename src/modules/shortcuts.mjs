// Helpers for the modifier+digit shortcuts, shared by the compose script, the
// manager and the toolbar. No imports, so the compose script can load it.

const ua = () => navigator.userAgent.toLowerCase();

export const isMac = () => ua().includes("mac");
const isWin = () => ua().includes("win");

// The digit of a physical digit key (number row or numpad) as "0".."9", or
// null. Uses e.code instead of e.key, because e.key holds the typed character,
// which depends on the keyboard layout (AZERTY) and the modifier (Option on
// macOS turns 1 into ¡).
export function getShortcutDigit(e) {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  return m ? m[1] : null;
}

// Advanced mode eats every modifier+digit press. On macOS that only works with
// Control: Option+digit types characters like [ ] { } | on many layouts, and
// Thunderbird takes ⌘1 for Window > Mail. On Windows it does not work with Alt,
// because releasing Alt activates the menu bar.
export function isShortcutAdvForced(modifier) {
  if (isMac()) {
    return modifier !== "control";
  }
  return isWin() && modifier === "alt";
}

export function isShortcutAdvActive(shortcutTypeAdv, modifier) {
  return !!shortcutTypeAdv && !isShortcutAdvForced(modifier);
}

// macOS shows modifiers as symbols (menus, tooltips): ⌥1 instead of Alt+1.
const MAC_SYMBOLS = { alt: "\u2325", control: "\u2303", meta: "\u2318" };

// The i18n key of the full display name of the modifier, using the Mac key
// names on macOS ("⌥ Option"). Only used where the full name is wanted, which
// is the modifier dropdown in the settings.
export function getModifierNameKey(modifier) {
  return `quicktext.${modifier}Key${isMac() ? "Mac" : ""}.label`;
}

// The short label of the modifier: the symbol on macOS, the name elsewhere.
export function getModifierLabel(modifier) {
  if (isMac()) {
    return MAC_SYMBOLS[modifier] ?? modifier;
  }
  return browser.i18n.getMessage(`quicktext.${modifier}Key.label`) || modifier;
}

// A shortcut as shown to the user: "⌥1" on macOS, "Alt+1" elsewhere. Without
// a key, only the prefix ("⌥" or "Alt+") is returned.
export function formatShortcut(modifier, key = "") {
  const label = getModifierLabel(modifier);
  return isMac() ? `${label}${key}` : `${label}+${key}`;
}
