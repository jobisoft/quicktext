#!/usr/bin/env bash
# Remove the quicktext_bridge_host native messaging host registered by install.sh.

set -euo pipefail

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
MANIFEST_DEST="$HOSTS_DIR/quicktext_bridge_host.json"

rm -f "$MANIFEST_DEST"
rm -rf "$INSTALL_DIR"

# Also remove a copy installed at the wrong (Firefox) location by older versions.
if [[ -n "${LEGACY_HOSTS_DIR:-}" ]]; then
  rm -f "$LEGACY_HOSTS_DIR/quicktext_bridge_host.json"
  rm -rf "$LEGACY_HOSTS_DIR/quicktext_bridge_host_helper"
fi

echo "Removed:"
echo "  $MANIFEST_DEST"
echo "  $INSTALL_DIR"
echo
echo "The bridge is now unregistered. Disable it in Quicktext's options too, if"
echo "you had it on."
