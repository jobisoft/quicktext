#!/usr/bin/env bash
# Install the quicktext_bridge_host native messaging host for Thunderbird on
# Linux/macOS. Copies the helper into the user-level Mozilla native-messaging
# dir and registers its manifest, so this source folder can be moved or deleted
# afterwards. Re-run it whenever quicktext_bridge_host.py changes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_SRC="$SCRIPT_DIR/quicktext_bridge_host.py"
MANIFEST_SRC="$SCRIPT_DIR/quicktext_bridge_host.json"

if [[ "$OSTYPE" == darwin* ]]; then
  # Thunderbird on macOS reads ~/Library/Mozilla/..., not Firefox's
  # ~/Library/Application Support/Mozilla/... (earlier versions of this script
  # used the Firefox location by mistake).
  HOSTS_DIR="$HOME/Library/Mozilla/NativeMessagingHosts"
  LEGACY_HOSTS_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
else
  HOSTS_DIR="$HOME/.mozilla/native-messaging-hosts"
fi

INSTALL_DIR="$HOSTS_DIR/quicktext_bridge_host_helper"
PY_DEST="$INSTALL_DIR/quicktext_bridge_host.py"
MANIFEST_DEST="$HOSTS_DIR/quicktext_bridge_host.json"

if ! command -v python3 >/dev/null 2>&1; then
  echo "WARNING: python3 not detected — install it via your package manager,"
  echo "otherwise the bridge helper will not run."
  echo
fi

echo "Installing the Quicktext bridge helper (beta/dev only):"
echo "  helper   -> $PY_DEST"
echo "  manifest -> $MANIFEST_DEST"
echo

# Remove a copy installed at the wrong (Firefox) location by older versions.
if [[ -n "${LEGACY_HOSTS_DIR:-}" ]]; then
  rm -f "$LEGACY_HOSTS_DIR/quicktext_bridge_host.json"
  rm -rf "$LEGACY_HOSTS_DIR/quicktext_bridge_host_helper"
fi

mkdir -p "$INSTALL_DIR"
cp "$PY_SRC" "$PY_DEST"
chmod +x "$PY_DEST"

# Bake the absolute helper path into the registered manifest.
sed "s|/path/to/quicktext_bridge_host.py|$PY_DEST|" "$MANIFEST_SRC" > "$MANIFEST_DEST"

echo "Done. Now:"
echo "  1. Enable the bridge in Quicktext's options page (Developer Bridge)."
echo "  2. Restart Thunderbird (or reload the dev add-on) so it re-reads the host."
echo
