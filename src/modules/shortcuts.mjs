// Helpers for the modifier+digit shortcuts. No imports, so the compose script
// can load it.

// The digit of a physical digit key (number row or numpad) as "0".."9", or
// null. Uses e.code instead of e.key, because e.key holds the typed character,
// which depends on the keyboard layout (AZERTY) and the modifier (Option on
// macOS turns 1 into ¡).
export function getShortcutDigit(e) {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  return m ? m[1] : null;
}
