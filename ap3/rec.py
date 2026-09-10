#!/usr/bin/env python3
"""Tiny JSON get/set for run records, trust.json and routines.json (no jq dependency).

  rec.py get     <file> <dotted.key> [default]   print the value ('' + exit 1 if absent & no default)
  rec.py set     <file> <dotted.key> <string>     set a string value (creates the file/parents)
  rec.py setjson <file> <dotted.key> <json>        set a raw JSON value (numbers/bools/null/objects)
  rec.py init    <file> <json-object>              write a whole JSON object (create the file)

Dotted keys index nested objects, e.g. classes.code-quality-p2.budget_usd_max. A key
containing a literal dot is not supported (the ap3 schemas don't use one).
"""
import json
import os
import sys


def _load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _dump(path, obj):
    # atomic: write a sibling temp then rename, so a reader (or a crash mid-write) never sees a
    # partially-written file — a corrupt trust.json could otherwise read as "nothing paused".
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def _get(obj, keys):
    for k in keys:
        if not isinstance(obj, dict) or k not in obj:
            return None
        obj = obj[k]
    return obj


def _set(obj, keys, value):
    for k in keys[:-1]:
        if not isinstance(obj.get(k), dict):
            obj[k] = {}
        obj = obj[k]
    obj[keys[-1]] = value


def main(argv):
    if len(argv) < 4:
        sys.stderr.write("usage: rec.py {get|set|setjson} <file> <dotted.key> [value]\n")
        return 2
    cmd, path = argv[1], argv[2]
    if cmd == "init":
        _dump(path, json.loads(argv[3]))
        return 0
    dotted = argv[3]
    keys = dotted.split(".")
    if cmd == "get":
        val = _get(_load(path), keys)
        if val is None:
            if len(argv) > 4:
                print(argv[4]); return 0
            return 1
        print(val if isinstance(val, str) else json.dumps(val))
        return 0
    if cmd in ("set", "setjson"):
        if len(argv) < 5:
            sys.stderr.write("value required\n"); return 2
        value = argv[4] if cmd == "set" else json.loads(argv[4])
        obj = _load(path)
        _set(obj, keys, value)
        _dump(path, obj)
        return 0
    sys.stderr.write("unknown subcommand %r\n" % cmd)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
