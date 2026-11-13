"""Prints, as JSON, how much context the Claude Code session whose process id is argv[1] uses,
and the model and effort of its last reply.

The context is what the last reply was sent: its input tokens, new and cached.
The transcript does not say the window's size: 1M when the reply's model is a Fable or Opus 5.5,
the configured model ends in [1m] or the context is already past 200k, else 200k.
"""
import glob
import json
import os
import sys

SMALL, LARGE = 200_000, 1_000_000
LARGE_BY_DEFAULT = ("claude-fable-", "claude-opus-5-5")


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


def model_name(model_id):
    """claude-opus-5-5 -> Opus 5.5, claude-haiku-4-5-20251001 -> Haiku 4.5."""
    parts = [p for p in (model_id or "").removeprefix("claude-").split("-") if not (p.isdigit() and len(p) == 8)]
    words = [p for p in parts if not p.isdigit()]
    version = ".".join(p for p in parts if p.isdigit())
    return " ".join([w.capitalize() for w in words] + ([version] if version else []))


def last_reply(path, size=2_000_000):
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        f.seek(max(0, f.tell() - size))
        lines = f.read().decode("utf-8", "replace").splitlines()
    for line in reversed(lines):
        if '"usage"' not in line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        message = entry.get("message") or {}
        usage = message.get("usage")
        if entry.get("type") != "assistant" or entry.get("isSidechain") or message.get("model") == "<synthetic>" or not usage:
            continue
        return {
            "tokens": sum(usage.get(k) or 0 for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")),
            "model": model_name(message.get("model")),
            "effort": entry.get("effort"),
            "large": (message.get("model") or "").startswith(LARGE_BY_DEFAULT),
        }
    return None


def configured_model(d):
    try:
        with open(os.path.join(d, "settings.json")) as f:
            return json.load(f).get("model") or ""
    except (OSError, ValueError):
        return ""


def main():
    pid = sys.argv[1]
    for d in config_dirs():
        try:
            with open(os.path.join(d, "sessions", f"{pid}.json")) as f:
                session = json.load(f)["sessionId"]
        except (OSError, ValueError, KeyError):
            continue
        found = glob.glob(os.path.join(d, "projects", "*", f"{session}.jsonl"))
        reply = last_reply(found[0]) if found else None
        if reply is None:
            break
        large = reply.pop("large") or "[1m]" in configured_model(d).lower() or reply["tokens"] > SMALL
        reply["window"] = LARGE if large else SMALL
        print(json.dumps(reply))
        return
    print("null")


main()
