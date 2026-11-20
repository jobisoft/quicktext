// Helpers for the modifier+digit shortcuts, shared by the compose script and
// the manager. No imports, so the compose script can load it.

const ua = () => navigator.userAgent.toLowerCase();

const isMac = () => ua().includes("mac");
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
