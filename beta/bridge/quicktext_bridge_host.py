#!/usr/bin/env python3
"""
Native messaging host for the Quicktext bridge (beta/dev builds only).

Thunderbird spawns this process when the Quicktext background page connects to
it, and it dies when that port closes - there is no daemon to start, stop or
forget about. It does one thing: expose Quicktext's internal RPC table on a
loopback HTTP socket, so a script (or an agent) can drive the live parser from
the shell without a rebuild-reload cycle per probe.

    shell --HTTP--> this host --native messaging--> Quicktext --> RPC handler

Message framing (Mozilla native messaging protocol):
  - Each message is preceded by a 4-byte unsigned int (native byte order)
    giving the byte length of the following UTF-8 JSON payload.

  Incoming, first (add-on -> host): { "type": "init", "appVersion": str }
                    The port is derived from it, so the host binds nothing
                    until it arrives.

  Outgoing (host -> add-on):  { "requestId": str, "cmd": str, "args": {} }
                           |  { "type": "hello", "port": int, "token": str,
                                 "version": int, "appVersion": str }
                              (or { "type": "hello", "error": str })
  Incoming (add-on -> host):  { "requestId": str, "ok": true,  "result": any }
                            | { "requestId": str, "ok": false, "error": str }

NOTHING may be written to stdout except framed messages: a stray print()
corrupts the stream and silently kills the port. Diagnostics go to stderr,
which Thunderbird surfaces in its console.
"""

import sys
import json
import struct
import os
import re
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ── Configuration ──────────────────────────────────────────────────────────────

# The port is 47000 + the Thunderbird major version (ESR 140 -> 47140, release
# 159 -> 47159), so ESR and release can run their bridges side by side and a
# caller needs nothing but the major version to know where to knock. An
# ephemeral port would have to be published somewhere, which is more machinery
# than a debug tool is worth.
#
# Keep PORT_BASE in sync with bridge.py. Two Thunderbirds with the same major
# (two profiles, or an ESR cut at the release's own major) still collide.
PORT_BASE = 47000
MAX_MAJOR = 999

# Set once the add-on has told us which Thunderbird it runs in (see main()).
PORT = None
APP_VERSION = ''

# Not a secret, and not meant to be one. Its job is to make every request a
# *non-simple* CORS request, so a web page you visit cannot silently POST at
# this port and trigger commands. It does not keep out other processes running
# as you - those can read the Thunderbird profile anyway.
TOKEN = 'quicktext'

# Bumped whenever this file changes in a way that needs reinstalling. The
# add-on carries the version it expects and logs a mismatch, which is the only
# way to tell a stale helper from a broken one.
VERSION = 2

# How long an HTTP request waits for the add-on to answer, in seconds. Finite,
# so a wedged call releases its socket instead of holding it forever.
MAX_TIMEOUT_S = 600

MAX_BODY_BYTES = 1024 * 1024

# ── Native messaging framing ───────────────────────────────────────────────────

_stdout_lock = threading.Lock()


def get_message():
    """Read one framed message from stdin. Returns None at EOF."""
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) < 4:
        return None
    message_length = struct.unpack('@I', raw_length)[0]
    payload = sys.stdin.buffer.read(message_length)
    if len(payload) < message_length:
        return None
    return json.loads(payload.decode('utf-8'))


def send_message(content):
    """Write one framed message to stdout. Serialized: interleaved writes
    would corrupt the framing, and every HTTP thread calls this."""
    encoded = json.dumps(content, separators=(',', ':')).encode('utf-8')
    with _stdout_lock:
        sys.stdout.buffer.write(struct.pack('@I', len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()


def log(*parts):
    print('[quicktext-bridge]', *parts, file=sys.stderr, flush=True)


# ── Pending requests ───────────────────────────────────────────────────────────

# requestId -> {"event": Event, "response": dict|None}
_pending = {}
_pending_lock = threading.Lock()


def dispatch(cmd, args, timeout_s):
    """Send one command to the add-on and wait for its reply.

    Returns the reply dict, or None if the add-on did not answer in time."""
    request_id = uuid.uuid4().hex
    event = threading.Event()
    with _pending_lock:
        _pending[request_id] = {'event': event, 'response': None}
    try:
        send_message({'requestId': request_id, 'cmd': cmd, 'args': args})
        if not event.wait(timeout_s):
            return None
        with _pending_lock:
            return _pending[request_id]['response']
    finally:
        with _pending_lock:
            _pending.pop(request_id, None)


def resolve(message):
    """Hand an incoming reply to whichever HTTP thread is waiting for it."""
    request_id = message.get('requestId')
    if not request_id:
        return
    with _pending_lock:
        entry = _pending.get(request_id)
        if not entry:
            # Timed out and already gone, or never ours.
            return
        entry['response'] = message
    entry['event'].set()


# ── HTTP server ────────────────────────────────────────────────────────────────

def make_handler():
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        # Thunderbird's console is not the place for an access log.
        def log_message(self, fmt, *args):
            pass

        def _reply(self, status, payload, cors=False):
            body = json.dumps(payload).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            if cors:
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Headers', 'Authorization')
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            if self.path != '/health':
                self._reply(404, {'ok': False, 'error': 'not found'})
                return
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Headers', 'Authorization')
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Content-Length', '0')
            self.end_headers()

        def _authorized(self):
            header = self.headers.get('Authorization', '')
            return header == f'Bearer {TOKEN}'

        def do_GET(self):
            if self.path != '/health':
                self._reply(404, {'ok': False, 'error': 'not found'})
                return
            if not self._authorized():
                self._reply(401, {'ok': False, 'error': 'unauthorized'}, cors=True)
                return
            self._reply(200, {
                'ok': True,
                'pid': os.getpid(),
                'port': PORT,
                'appVersion': APP_VERSION,
            }, cors=True)

        def do_POST(self):
            if self.path != '/rpc':
                self._reply(404, {'ok': False, 'error': 'not found'})
                return
            if not self._authorized():
                self._reply(401, {'ok': False, 'error': 'unauthorized'})
                return

            length = int(self.headers.get('Content-Length') or 0)
            if length > MAX_BODY_BYTES:
                self._reply(413, {'ok': False, 'error': 'body too large'})
                return
            try:
                body = json.loads(self.rfile.read(length).decode('utf-8'))
            except (ValueError, UnicodeDecodeError) as err:
                self._reply(400, {'ok': False, 'error': f'bad JSON: {err}'})
                return

            cmd = body.get('cmd')
            if not isinstance(cmd, str) or not cmd:
                self._reply(400, {'ok': False, 'error': 'missing cmd'})
                return
            args = body.get('args') or {}
            if not isinstance(args, dict):
                self._reply(400, {'ok': False, 'error': 'args must be an object'})
                return

            # Clamped rather than rejected: an out-of-range value is the caller
            # being optimistic, not the caller being wrong.
            timeout_s = body.get('timeoutMs')
            timeout_s = (
                min(max(timeout_s / 1000, 1), MAX_TIMEOUT_S)
                if isinstance(timeout_s, (int, float))
                else MAX_TIMEOUT_S
            )

            response = dispatch(cmd, args, timeout_s)
            if response is None:
                self._reply(504, {
                    'ok': False,
                    'error': f'no reply from Quicktext within {timeout_s:g}s',
                })
                return
            if response.get('ok'):
                self._reply(200, {'ok': True, 'result': response.get('result')})
            else:
                self._reply(200, {
                    'ok': False,
                    'error': response.get('error') or 'unknown error',
                    'errorCode': response.get('errorCode'),
                })

    return Handler


# ── Entry point ────────────────────────────────────────────────────────────────

def wait_for_init():
    """Read stdin until the add-on's {"type": "init", "appVersion": str}
    arrives; anything else before it is ignored. Returns the appVersion string,
    or None if stdin closes first. The port depends on it, so nothing can be
    bound before this."""
    while True:
        message = get_message()
        if message is None:
            return None
        if isinstance(message, dict) and message.get('type') == 'init':
            version = message.get('appVersion')
            return version if isinstance(version, str) else ''


def port_for_version(app_version):
    """47000 + the major version of a Thunderbird version string such as
    "140.5.0esr" or "159.0". None when there is no usable major."""
    match = re.match(r'(\d+)', app_version)
    if not match:
        return None
    major = int(match.group(1))
    if not 1 <= major <= MAX_MAJOR:
        return None
    return PORT_BASE + major


def main():
    global PORT, APP_VERSION

    app_version = wait_for_init()
    if app_version is None:
        return 0  # the add-on went away before it said anything
    PORT = port_for_version(app_version)
    if PORT is None:
        # No guessing: a wrong port would silently collide with someone else's.
        log(f'cannot derive a port from Thunderbird version {app_version!r}')
        send_message({
            'type': 'hello',
            'error': f'cannot derive a port from Thunderbird version {app_version!r}',
        })
        return 1
    APP_VERSION = app_version

    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), make_handler())
    except OSError as err:
        # Almost always "address already in use": another Thunderbird with the
        # same major version has the bridge on, or a stale helper. Say so and
        # stop.
        log(f'could not listen on 127.0.0.1:{PORT}:', err)
        send_message({
            'type': 'hello',
            'error': f'port {PORT} (Thunderbird {app_version}): {err}',
        })
        return 1
    server.daemon_threads = True

    log(f'listening on 127.0.0.1:{PORT} (Thunderbird {app_version})')
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()

    # Tell the add-on we are up, so it can log the address rather than guess.
    # Carries no requestId, which is how the add-on tells it apart from a reply.
    send_message({
        'type': 'hello',
        'port': PORT,
        'token': TOKEN,
        'version': VERSION,
        'appVersion': APP_VERSION,
    })

    try:
        # Thunderbird closes the port on shutdown or reload; stdin hits EOF.
        while True:
            message = get_message()
            if message is None:
                break
            if isinstance(message, dict) and message.get('type') == 'ping':
                send_message({
                    'type': 'pong',
                    'id': message.get('id'),
                    'listening': server_thread.is_alive(),
                })
                continue
            resolve(message)
    except (OSError, ValueError) as err:
        log('stdin pump stopped:', err)
    finally:
        server.shutdown()
    return 0


if __name__ == '__main__':
    sys.exit(main())
