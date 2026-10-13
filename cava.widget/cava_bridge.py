#!/usr/bin/env python3
import sys
import os
import time
import subprocess
import shutil

BARS_FILE = "/tmp/cava_bars.txt"
HEARTBEAT_FILE = "/tmp/cava_heartbeat.txt"
PID_FILE = "/tmp/cava_bridge.pid"
CONF_FILE = "/tmp/cava_uebersicht.conf"
NUM_BARS = 28

def find_cava():
    for p in ["/opt/homebrew/bin/cava", "/usr/local/bin/cava"]:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return shutil.which("cava") or "cava"

def write_config():
    config = f"""
[general]
bars = {NUM_BARS}
framerate = 35
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
noise_reduction = 60
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

def run_worker():
    # Ensure only one worker runs
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, "r") as f:
                old_pid = int(f.read().strip())
            if is_pid_running(old_pid):
                return
        except Exception:
            pass

    my_pid = os.getpid()
    with open(PID_FILE, "w") as f:
        f.write(str(my_pid))

    write_config()
    cava_bin = find_cava()

    touch_heartbeat()

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
        while True:
            line = proc.stdout.readline()
            if not line:
                break
            line = line.strip()
            if line and not line.startswith("\x1b"):
                tmp_target = BARS_FILE + ".tmp"
                try:
                    with open(tmp_target, "w") as f:
                        f.write(line)
                    os.replace(tmp_target, BARS_FILE)
                except Exception:
                    pass

            now = time.time()
            if now - last_heartbeat_check >= 1.5:
                last_heartbeat_check = now
                hb_mtime = 0
                try:
                    hb_mtime = os.path.getmtime(HEARTBEAT_FILE)
                except Exception:
                    pass
                # If no poll for 6 seconds, exit cleanly
                if now - hb_mtime > 6.0:
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

    # Check if worker is running, if not start it
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
            stdin=subprocess.DEVNULL
        )

    # Read current bars
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
