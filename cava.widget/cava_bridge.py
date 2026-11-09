#!/usr/bin/env python3
import sys
import os
import time
import socket
import select
import threading
import subprocess
import shutil

BARS_FILE = "/tmp/cava_bars.txt"
HEARTBEAT_FILE = "/tmp/cava_heartbeat.txt"
PID_FILE = "/tmp/cava_bridge.pid"
CONF_FILE = "/tmp/cava_uebersicht.conf"
NUM_BARS = 28
STREAM_HOST = "127.0.0.1"
STREAM_PORT = 41418

_clients_lock = threading.Lock()
_sse_clients = []
_latest_bars = ";".join(["0"] * NUM_BARS) + ";"
_last_client_activity = time.time()


def find_cava():
    for p in ("/opt/homebrew/bin/cava", "/usr/local/bin/cava"):
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return shutil.which("cava") or "cava"


def write_config():
    config = f"""
[general]
bars = {NUM_BARS}
framerate = 60
autosens = 1
overshoot = 20

[input]
method = coreaudio
source = tap

[output]
method = raw
raw_target = /dev/stdout
data_format = ascii
ascii_max_range = 100
bar_delimiter = 59
frame_delimiter = 10

[smoothing]
monstercat = 1
waves = 0
noise_reduction = 55
"""
    with open(CONF_FILE, "w") as f:
        f.write(config)


def is_pid_running(pid):
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def touch_heartbeat():
    try:
        with open(HEARTBEAT_FILE, "w") as f:
            f.write(str(time.time()))
    except Exception:
        pass


def _handle_http_client(conn):
    global _last_client_activity
    try:
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        conn.settimeout(2.0)
        req = conn.recv(1024).decode("utf-8", errors="ignore")
        first_line = req.splitlines()[0] if req else ""
        if "OPTIONS " in first_line:
            resp = (
                "HTTP/1.1 204 No Content\r\n"
                "Access-Control-Allow-Origin: *\r\n"
                "Access-Control-Allow-Methods: GET, OPTIONS\r\n"
                "Access-Control-Allow-Headers: *\r\n"
                "Connection: close\r\n\r\n"
            )
            conn.sendall(resp.encode("ascii"))
            conn.close()
            return

        if "GET /bars" in first_line:
            _last_client_activity = time.time()
            body = _latest_bars.encode("ascii")
            resp = (
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: text/plain; charset=utf-8\r\n"
                f"Content-Length: {len(body)}\r\n"
                "Access-Control-Allow-Origin: *\r\n"
                "Cache-Control: no-cache\r\n"
                "Connection: close\r\n\r\n"
            ).encode("ascii") + body
            conn.sendall(resp)
            conn.close()
            return

        # Default: Server-Sent Events stream (/stream)
        _last_client_activity = time.time()
        headers = (
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: text/event-stream; charset=utf-8\r\n"
            "Cache-Control: no-cache, no-transform\r\n"
            "Connection: keep-alive\r\n"
            "Access-Control-Allow-Origin: *\r\n\r\n"
            f"data: {_latest_bars}\n\n"
        )
        conn.settimeout(0.05)
        conn.sendall(headers.encode("ascii"))
        with _clients_lock:
            _sse_clients.append(conn)
    except Exception:
        try:
            conn.close()
        except Exception:
            pass


def _sse_server_loop():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind((STREAM_HOST, STREAM_PORT))
        srv.listen(8)
        while True:
            try:
                conn, _ = srv.accept()
                t = threading.Thread(target=_handle_http_client, args=(conn,), daemon=True)
                t.start()
            except Exception:
                time.sleep(0.1)
    except Exception:
        pass
    finally:
        try:
            srv.close()
        except Exception:
            pass


def _broadcast_bars(line):
    global _latest_bars, _last_client_activity
    _latest_bars = line
    with _clients_lock:
        if not _sse_clients:
            return
        payload = f"data: {line}\n\n".encode("ascii", errors="ignore")
        alive = []
        for c in _sse_clients:
            try:
                # Check if peer sent FIN/RST
                r, _, _ = select.select([c], [], [], 0)
                if r:
                    data = c.recv(64)
                    if not data:
                        c.close()
                        continue
                c.sendall(payload)
                alive.append(c)
            except Exception:
                try:
                    c.close()
                except Exception:
                    pass
        _sse_clients[:] = alive
        if alive:
            _last_client_activity = time.time()


def run_worker():
    global _last_client_activity
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, "r") as f:
                old_pid = int(f.read().strip())
            if old_pid != os.getpid() and is_pid_running(old_pid):
                return
        except Exception:
            pass

    my_pid = os.getpid()
    with open(PID_FILE, "w") as f:
        f.write(str(my_pid))

    write_config()
    cava_bin = find_cava()
    touch_heartbeat()
    _last_client_activity = time.time()

    server_thread = threading.Thread(target=_sse_server_loop, daemon=True)
    server_thread.start()

    proc = None
    try:
        proc = subprocess.Popen(
            [cava_bin, "-p", CONF_FILE],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1
        )

        last_heartbeat_check = time.time()
        last_file_write = 0.0
        last_line = ""

        while True:
            line = proc.stdout.readline()
            if not line:
                break
            line = line.strip()
            if line and not line.startswith("\x1b"):
                if line != last_line:
                    last_line = line
                    _broadcast_bars(line)

                now = time.time()
                if now - last_file_write >= 0.05:
                    last_file_write = now
                    tmp_target = BARS_FILE + ".tmp"
                    try:
                        with open(tmp_target, "w") as f:
                            f.write(line)
                        os.replace(tmp_target, BARS_FILE)
                    except Exception:
                        pass

            now = time.time()
            if now - last_heartbeat_check >= 2.0:
                last_heartbeat_check = now
                hb_mtime = 0.0
                try:
                    hb_mtime = os.path.getmtime(HEARTBEAT_FILE)
                except Exception:
                    pass
                with _clients_lock:
                    has_clients = len(_sse_clients) > 0
                if has_clients:
                    _last_client_activity = now
                last_active = max(hb_mtime, _last_client_activity)
                if now - last_active > 35.0:
                    break

    except Exception:
        pass
    finally:
        if proc:
            try:
                proc.terminate()
                proc.wait(timeout=0.5)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        try:
            if os.path.exists(PID_FILE):
                os.remove(PID_FILE)
        except Exception:
            pass


def poll():
    touch_heartbeat()

    worker_running = False
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, "r") as f:
                pid = int(f.read().strip())
            worker_running = is_pid_running(pid)
        except Exception:
            pass

    if not worker_running:
        script_path = os.path.abspath(__file__)
        subprocess.Popen(
            [sys.executable, script_path, "--run"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True
        )

    bars = ""
    try:
        if os.path.exists(BARS_FILE):
            with open(BARS_FILE, "r") as f:
                bars = f.read().strip()
    except Exception:
        pass

    if not bars:
        bars = ";".join(["0"] * NUM_BARS) + ";"

    print(bars)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--run":
        run_worker()
    else:
        poll()
