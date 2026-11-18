#!/usr/bin/env python3
"""Loopback HTTP client for the Quicktext Bridge.

Quick start (from a shell):

    python3 bridge.py help                    # every verb, its args
    python3 bridge.py status                  # link state + compose tabs
    python3 bridge.py parseTemplate Grp Name  # trace a stored template, pretty-printed
    python3 bridge.py rpc getBrowserInfo      # any verb, raw JSON reply

As a module:

    from bridge import rpc
    rpc("parseTemplate", group="Grp", name="Name")   # -> {"ok": True, "result": {...}}

The bridge is a beta/dev-only automation surface: Quicktext spawns a native
helper that listens on this loopback port and forwards `cmd`/`args` to the live
parser. Every call answers `{ok, result}` — the payload is under `result`.

Each Thunderbird listens on 47000 + its major version (ESR 140 -> 47140,
release 159 -> 47159), so several can run their bridges at once. Pick one with
`--tb 140` / `--port 47140` (or QUICKTEXT_BRIDGE_TB=140); with none given the
client probes for running bridges and uses the only one it finds, or lists them
and asks you to choose. `python3 bridge.py instances` shows what is running.

PORT_BASE and TOKEN are fixed by the helper (bridge/quicktext_bridge_host.py);
they are duplicated here rather than discovered because the helper is installed
outside the repo (Thunderbird launches it by path). Stdlib only.
"""

import json
import os
import re
import socket
import sys
import urllib.error
import urllib.request

PORT_BASE = 47000  # keep in sync with quicktext_bridge_host.py
TOKEN = "quicktext"

# Majors probed when no instance is named. Wide enough for every Thunderbird
# release for years; a connection to a closed loopback port is refused at once,
# so the sweep is cheap.
PROBE_MAJORS = range(100, 300)
PROBE_TIMEOUT = 0.3

_target = {"tb": None, "port": None}  # set by use(); resolved lazily
_resolved_port = None


class BridgeDown(Exception):
    """The port is not answering — the bridge is off in Quicktext's options,
    Thunderbird is not running, or the helper is not installed. Also raised when
    several bridges answer and none was chosen. Distinct from an RPC that
    answered with an error, which comes back in the reply."""


def port_for(major):
    """The port the helper uses for a Thunderbird version: 140, "140.5" and
    "140.5.0esr" all give 47140 (same rule as the helper)."""
    match = re.match(r"(\d+)", str(major))
    if not match:
        raise BridgeDown(f"cannot derive a port from Thunderbird version {major!r}")
    return PORT_BASE + int(match.group(1))


def use(tb=None, port=None):
    """Choose which Thunderbird to talk to: a major version (`tb=140`) or an
    explicit `port`. Without either, rpc() auto-detects."""
    global _resolved_port
    _target["tb"] = tb
    _target["port"] = port
    _resolved_port = None


def _probe(port):
    """The /health reply of a bridge on `port`, or None if nothing answers."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=PROBE_TIMEOUT):
            pass
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/health",
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
        with urllib.request.urlopen(req, timeout=2) as f:
            reply = json.loads(f.read())
        return reply if reply.get("ok") else None
    except (OSError, ValueError):
        return None


def instances():
    """Every running bridge: a list of {port, appVersion, pid}."""
    found = []
    for major in PROBE_MAJORS:
        reply = _probe(port_for(major))
        if reply:
            found.append({
                "port": reply.get("port", port_for(major)),
                "appVersion": reply.get("appVersion", ""),
                "pid": reply.get("pid"),
            })
    return found


def _resolve_port():
    global _resolved_port
    if _resolved_port is not None:
        return _resolved_port
    tb = _target["tb"] or os.environ.get("QUICKTEXT_BRIDGE_TB")
    if _target["port"]:
        _resolved_port = int(_target["port"])
    elif tb:
        _resolved_port = port_for(tb)
    else:
        found = instances()
        if len(found) == 1:
            _resolved_port = found[0]["port"]
        elif not found:
            raise BridgeDown(
                f"no bridge answers on 127.0.0.1:{port_for(PROBE_MAJORS[0])}-"
                f"{port_for(PROBE_MAJORS[-1])}. Is Thunderbird running, and is "
                f"the bridge switched on in Quicktext's options?"
            )
        else:
            listing = ", ".join(f"{i['appVersion'] or '?'} (:{i['port']})" for i in found)
            raise BridgeDown(
                f"several bridges are running: {listing}. "
                f"Choose one with --tb <major> or --port <port>."
            )
    return _resolved_port


def rpc(cmd, timeout=180, **args):
    """Call one bridge verb. Returns the decoded reply dict
    (`{"ok": True, "result": ...}` or `{"ok": False, "error": ...}`).
    Only an unreachable port raises (BridgeDown)."""
    port = _resolve_port()
    body = json.dumps({"cmd": cmd, "args": args, "timeoutMs": timeout * 1000}).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/rpc",
        data=body,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout + 15) as f:
            return json.loads(f.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())
    except urllib.error.URLError as e:
        raise BridgeDown(
            f"no answer on 127.0.0.1:{port} ({e.reason}). Is Thunderbird "
            f"running, and is the bridge switched on in Quicktext's options?"
        ) from e


def _print_parse(result):
    """Pretty-print a `parse` result: the resolved output and a per-pass trace
    so it is obvious which pass (if any) drops a tag."""
    if result.get("source") is not None:
        print(f"source     : {result.get('source')!r}")
    print(f"boundTabId : {result.get('boundTabId')}   isPlainText: {result.get('isPlainText')}")
    if result.get("error"):
        print(f"ERROR      : {json.dumps(result['error'], indent=2)}")
    print(f"result     : {result.get('result')!r}")
    print(f"passes     : {result.get('passCount')}")
    for p in result.get("passes", []):
        tags = ", ".join(
            f"{t['tagName']}({'|'.join(t['variables'])})" if t["variables"] else t["tagName"]
            for t in p["tagsSeen"]
        ) or "—"
        print(f"  ── pass {p['pass']}  changed={p['changed']}  getTags: {tags}")
        print(f"       before: {p['before']!r}")
        print(f"       after : {p['after']!r}")


def _take_option(argv, name):
    """Remove `name <value>` from argv wherever it sits; return its value or None."""
    if name not in argv:
        return None
    i = argv.index(name)
    if i + 1 >= len(argv):
        raise SystemExit(f"{name} needs a value")
    value = argv[i + 1]
    del argv[i:i + 2]
    return value


def _main(argv):
    argv = list(argv)
    use(tb=_take_option(argv, "--tb"), port=_take_option(argv, "--port"))
    if not argv or argv[0] in ("-h", "--help", "help") and len(argv) == 1 and argv[0] == "--help":
        print(__doc__)
        return 0
    cmd = argv[0]
    try:
        if cmd == "instances":
            # instances   (every running bridge; needs no choice of target)
            found = instances()
            if not found:
                print("no bridge is running")
                return 2
            for i in found:
                print(f"{i['appVersion'] or '?':<14} :{i['port']}   pid {i['pid']}")
            return 0
        if cmd == "parseTemplate":
            # parseTemplate <group> <name>   (real [[TEXT=group|name]] path)
            if len(argv) < 3:
                print("usage: parseTemplate <group> <name>")
                return 1
            reply = rpc("parseTemplate", group=argv[1], name=argv[2])
            if not reply.get("ok"):
                print(f"refused: {reply.get('error')}")
                return 1
            _print_parse(reply["result"])
            return 0
        if cmd == "rpc":
            # bridge.py rpc <verb> [k=v ...]   (values parsed as JSON, else string)
            verb = argv[1]
            args = {}
            for pair in argv[2:]:
                k, _, v = pair.partition("=")
                try:
                    args[k] = json.loads(v)
                except ValueError:
                    args[k] = v
            print(json.dumps(rpc(verb, **args), indent=2))
            return 0
        # Bare verb with no args, e.g. `bridge.py status` / `bridge.py help`.
        print(json.dumps(rpc(cmd), indent=2))
        return 0
    except BridgeDown as e:
        print(f"BridgeDown: {e}")
        return 2


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
