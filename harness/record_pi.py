#!/usr/bin/env python3
"""Records the first N seconds of Pi's interactive TUI working on a task into an asciicast v2 file, using a
pseudo-terminal (works without a real terminal), then renders a GIF with agg.
Usage: python3 harness/record_pi.py --model-id ID --out DIR [--seconds 40] [--url URL --key KEY] [--task dashboard]"""
import argparse, fcntl, json, os, pty, re, select, shutil, signal, struct, subprocess, termios, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument("--model-id", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--seconds", type=float, default=40); ap.add_argument("--task", default="dashboard")
ap.add_argument("--url", default="http://127.0.0.1:8080"); ap.add_argument("--key", default="eval-key")
ap.add_argument("--cols", type=int, default=110); ap.add_argument("--rows", type=int, default=32)
a = ap.parse_args()

out = os.path.abspath(a.out); shutil.rmtree(out, ignore_errors=True)
work, agent = os.path.join(out, "work"), os.path.join(out, "agent")
shutil.copytree(os.path.join(ROOT, "data/agent_tasks", a.task), work); os.makedirs(agent)
json.dump({"providers": {"local": {"baseUrl": a.url + "/v1", "api": "openai-completions", "apiKey": a.key,
           "compat": {"supportsDeveloperRole": False, "supportsReasoningEffort": False},
           "models": [{"id": a.model_id, "reasoning": True, "contextWindow": 65536, "maxTokens": 16000}]}}},
          open(os.path.join(agent, "models.json"), "w"))
json.dump({"enableInstallTelemetry": False}, open(os.path.join(agent, "settings.json"), "w"))

env = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor", PI_OFFLINE="1", PI_TELEMETRY="0", PI_CODING_AGENT_DIR=agent)
cmd = [os.path.join(ROOT, "tools/pi/node_modules/.bin/pi"), "--no-session", "--no-context-files", "--provider", "local", "--model", a.model_id,
       "Read TASK.md in the current directory and complete the task it describes."]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(work); os.execvpe(cmd[0], cmd, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", a.rows, a.cols, 0, 0))

cast = open(os.path.join(out, "pi.cast"), "w")
cast.write(json.dumps({"version": 2, "width": a.cols, "height": a.rows, "timestamp": int(time.time()),
                       "env": {"TERM": "xterm-256color"}, "title": f"Pi + {a.model_id} on an RTX 5070 Ti"}) + "\n")
t0 = time.time()
while time.time() - t0 < a.seconds:
    r, _, _ = select.select([fd], [], [], 0.1)
    if not r: continue
    try: data = os.read(fd, 65536)
    except OSError: break
    if not data: break
    if b"\x1b[6n" in data:                       # answer cursor-position queries like a real terminal would
        os.write(fd, b"\x1b[1;1R")
    cast.write(json.dumps([round(time.time() - t0, 4), "o", data.decode("utf-8", "replace")]) + "\n")
cast.close()
os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0)
subprocess.run([os.path.join(ROOT, "tools/bin/agg"), "--font-size", "16", "--theme", "monokai", "--idle-time-limit", "2",
                os.path.join(out, "pi.cast"), os.path.join(out, "pi.gif")], check=True)
print("wrote", os.path.join(out, "pi.cast"), os.path.join(out, "pi.gif"), "files in work:", sorted(os.listdir(work)))
