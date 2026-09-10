#!/usr/bin/env python3
"""Merge the ap3 writer settings INTO an existing .claude/settings.json (post-fact #2).

  python3 ap3/merge-settings.py <existing.json|-> <source.json>   -> merged JSON on stdout

Rules:
- Keep every existing top-level key (e.g. a project's `fallbackModel`). A key the source adds
  and the existing file lacks (`sandbox`, `permissions`) is added; a key both define is kept from
  the EXISTING file — the merge never clobbers project settings.
- `hooks` is merged per event: the source's entries are APPENDED to the existing event array
  (so a project's `review:check:changed` PostToolUse/Stop hooks survive and ap3 adds its own
  PreToolUse/Stop hooks beside them). Idempotent: an entry whose command set already appears is
  not appended again, so re-running install does not duplicate hooks.
If <existing> is `-` or an empty/absent file, the source is emitted unchanged (fresh install).
"""
import json
import os
import sys


def _load(path, label):
    # absent existing file is fine (fresh install -> {}); a PRESENT but unparseable file is a hard
    # error — never silently turn a corrupt settings file into {} and overwrite it.
    if path == "-" or not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError) as e:
        sys.stderr.write("merge-settings: %s (%s) is not readable JSON: %s\n" % (label, path, e))
        sys.exit(3)


def _commands(entry):
    return tuple(h.get("command") for h in (entry.get("hooks") or []))


def _union(a, b):
    out = list(a or [])
    for x in (b or []):
        if x not in out:
            out.append(x)
    return out


def _merge_sandbox(existing, source):
    # A target's own sandbox must not weaken AP3's: force it ON, union the credential denies, and
    # bring the writer domains only if the target set none (never shrink the target's own allow-list).
    r = json.loads(json.dumps(existing))
    r["enabled"] = True
    r["autoAllowBashIfSandboxed"] = True   # the unattended dontAsk writer needs this — force it
    fs = dict(r.get("filesystem") or {})
    fs["denyRead"] = _union(fs.get("denyRead"), (source.get("filesystem") or {}).get("denyRead"))
    r["filesystem"] = fs
    net = dict(r.get("network") or {})
    if not net.get("allowedDomains"):
        net["allowedDomains"] = (source.get("network") or {}).get("allowedDomains", [])
    r["network"] = net
    if "excludedCommands" not in r and "excludedCommands" in source:
        r["excludedCommands"] = source["excludedCommands"]
    return r


def _merge_permissions(existing, source):
    # Union both lists: AP3's deny rules (push, rm -rf, .env reads, WebFetch) are always present.
    # A broad existing allow (e.g. Bash(*)) stays contained because sandbox.enabled is forced true.
    r = json.loads(json.dumps(existing))
    r["allow"] = _union(r.get("allow"), source.get("allow"))
    r["deny"] = _union(r.get("deny"), source.get("deny"))
    return r


def merge(existing, source):
    result = json.loads(json.dumps(existing))  # deep copy
    for key, val in source.items():
        if key == "hooks":
            hooks = result.setdefault("hooks", {})
            for event, entries in val.items():
                arr = hooks.setdefault(event, [])
                have = {_commands(e) for e in arr}
                for e in entries:
                    if _commands(e) not in have:
                        arr.append(e)
                        have.add(_commands(e))
        elif key == "sandbox":
            result[key] = _merge_sandbox(result[key], val) if key in result else val
        elif key == "permissions":
            result[key] = _merge_permissions(result[key], val) if key in result else val
        elif key not in result:
            result[key] = val
        # else: a plain scalar/object present in both -> keep the existing (project) value
    return result


def main(argv):
    if len(argv) != 3:
        sys.stderr.write("usage: merge-settings.py <existing|-> <source>\n")
        return 2
    print(json.dumps(merge(_load(argv[1], "existing"), _load(argv[2], "source")), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
