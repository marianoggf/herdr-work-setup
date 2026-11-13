"""Prints, as JSON, the sub-agents still running in the Claude Code session whose process id is argv[1].

Claude Code writes sessions/<pid>.json under its config folder, and each sub-agent's
transcript and meta file under projects/*/<session>/subagents/.
"""
import glob
import json
import os
import sys
import time

QUIET = 1800  # seconds without a word after which a sub-agent counts as gone (killed, crashed)


def config_dirs():
    home = os.path.expanduser("~")
    dirs = [os.path.join(home, ".claude")]
    try:
        with open(os.path.join(home, ".config/herdr-app/state/claude-account")) as f:
            dirs.append(f.read().strip())
    except OSError:
        pass
    dirs += glob.glob(os.path.join(home, "Library/Application Support/orca/claude-profiles/*/home"))
    return [d for d in dirs if d]


def tail(path, size=262144):
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        f.seek(max(0, f.tell() - size))
        return f.read().decode("utf-8", "replace").splitlines()


# Done: its last word is a reply that ends its turn. Doing: the last word is a tool call or a tool's result.
# Also the most recent tool call's description, which says what it is doing now.
def read_transcript(path):
    done, activity = None, None
    for line in reversed(tail(path)):
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        message = entry.get("message") or {}
        content = message.get("content")
        blocks = content if isinstance(content, list) else []
        if done is None and entry.get("type") in ("user", "assistant"):
            calls = any(b.get("type") == "tool_use" for b in blocks)
            done = entry["type"] == "assistant" and message.get("stop_reason") == "end_turn" and not calls
        if activity is None:
            for b in reversed(blocks):
                if b.get("type") == "tool_use" and isinstance(b.get("input"), dict) and b["input"].get("description"):
                    activity = b["input"]["description"]
                    break
        if done is not None and activity is not None:
            break
    return bool(done), activity


def subagents(folder):
    now = time.time()
    found = []
    for meta_path in glob.glob(os.path.join(folder, "subagents", "agent-*.meta.json")):
        agent_id = os.path.basename(meta_path)[len("agent-"):-len(".meta.json")]
        transcript = os.path.join(folder, "subagents", f"agent-{agent_id}.jsonl")
        try:
            with open(meta_path) as f:
                meta = json.load(f)
            updated = os.path.getmtime(transcript)
            started = os.path.getmtime(meta_path)
        except (OSError, ValueError):
            continue
        if meta.get("finished"):
            continue
        done, activity = read_transcript(transcript)
        found.append({
            "id": agent_id,
            "parent": meta.get("parentAgentId"),
            "label": meta.get("description") or activity or meta.get("name") or meta.get("agentType") or "Sub-agent",
            "activity": activity,
            "started": int(started * 1000),
            "running": not done and now - updated < QUIET,
        })
    # A parent waiting on its own sub-agent says nothing meanwhile: it runs while one of them does.
    running = {a["id"] for a in found if a["running"]}
    grew = True
    while grew:
        grew = False
        for a in found:
            if a["id"] in running and a["parent"] and a["parent"] not in running and any(p["id"] == a["parent"] for p in found):
                running.add(a["parent"])
                grew = True
    return [{k: v for k, v in a.items() if k != "running"} for a in found if a["id"] in running]


def main():
    pid = sys.argv[1]
    for d in config_dirs():
        try:
            with open(os.path.join(d, "sessions", f"{pid}.json")) as f:
                session = json.load(f)["sessionId"]
        except (OSError, ValueError, KeyError):
            continue
        folders = glob.glob(os.path.join(d, "projects", "*", session))
        print(json.dumps(subagents(folders[0]) if folders else []))
        return
    print("[]")


main()
