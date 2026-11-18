# The Quicktext Bridge

Drive Quicktext's **live** template engine — and its storage and compose
surface — from a shell script instead of clicking through the manager and a
compose window: reproduce a real template insertion, read back exactly what
landed, trace it pass by pass, edit templates/scripts/prefs — without a
rebuild-reload cycle per probe.

```
your script --HTTP--> native helper --native messaging--> Quicktext --> parser
```

## Beta/dev only, and off by default

The bridge lives only in the **beta** and **dev** builds (it is stripped from
the ATN release), and even there it stays dark until **both**:

1. the native helper is installed (`bridge/install.sh`), and
2. the bridge is switched **on** in Quicktext's **options page** → *Developer
   Bridge*.

With the helper absent or the toggle off, nothing listens. Installing the
helper is a deliberate act, and the toggle is a second deliberate act — so
neither installing an update nor flipping one switch opens the port on its own.

## Setup

The easiest path is from **Quicktext options → Developer Bridge**: click
*Download install.sh* (it is self-contained — the helper is embedded), run it,
enable the toggle, and restart Thunderbird. To do it from the repo instead:

```sh
# 1. Register the native helper (one time; re-run if the .py changes)
beta/bridge/install.sh

# 2. In Thunderbird: Quicktext options → Developer Bridge → enable
# 3. Restart Thunderbird / reload the dev add-on so it re-reads the helper
```

Then drive it with the client:

```sh
python3 beta/bridge/bridge.py status
python3 beta/bridge/bridge.py help
python3 beta/bridge/bridge.py listTemplates
```

## Verbs

**There is no list of verbs in this file, on purpose.** `help` is generated from
the same command table the dispatcher reads, so it cannot fall out of date, and a
copy here would:

```sh
python3 bridge.py help               # every verb, its one-line summary and args
python3 bridge.py rpc help verb=parse
```

## The reply envelope

Every call answers `{ok: true, result}` or `{ok: false, error, errorCode}`. The
payload is under `result`. `bridge.py`'s `rpc()` raises `BridgeDown` only when
the port is not answering at all — a refused command is data, not an exception.

## Running several Thunderbirds at once (ESR and release)

Each Thunderbird gets its own port: **47000 + its major version**. ESR 140
listens on 47140, release 159 on 47159, so both bridges can be up together and
the port is predictable. Install the helper once; every Thunderbird uses it.

```sh
python3 bridge.py instances          # what is running: version, port, pid
python3 bridge.py --tb 140 status    # the ESR  (also QUICKTEXT_BRIDGE_TB=140)
python3 bridge.py --port 47159 status
```

With neither option the client uses the only running bridge, and refuses to
guess when there are several. From Python: `bridge.use(tb=140)` before `rpc()`.

Two Thunderbirds with the *same* major version (two profiles, or an ESR cut at
the release's own major) would still collide; the second reports that the port
is in use.

After updating the add-on, re-run `install.sh` once: the helper must know the
Thunderbird version to pick its port, so an old installed helper is reported as
stale in the options page.

## A habit worth having

Don't assume the next call lands right after `reload`. The reload takes the
native port with it, the helper dies with the port, and the bridge reconnects
and respawns a fresh helper on its own — so poll `status` until it answers again
rather than firing the next request blind.

## Where the pieces live

Everything beta-only sits under the repo's `beta/` overlay, which the build
applies to the beta and dev XPIs and never to the ATN release (see `build.js`,
`collectOverlay`). Inside a built xpi the `beta/bridge/*` files land at
`bridge/*` and `beta/modules/bridge.mjs` at `modules/bridge.mjs`.

- `beta/bridge/quicktext_bridge_host.py` — the native helper (loopback HTTP ⇄
  native messaging). Port **47000 + the Thunderbird major version**, token
  `quicktext`.
- `beta/bridge/quicktext_bridge_host.json` — its native-messaging manifest
  template (install.sh bakes in the absolute path).
- `beta/bridge/bridge.py` — the client, usable as a CLI or a module.
- `beta/bridge/install.sh` / `beta/bridge/uninstall.sh` — register / unregister
  the helper. The options page serves a self-contained install.sh generated from
  the packaged helper.
- `beta/modules/bridge.mjs` — the add-on half: the command table and the native
  port dispatcher.
