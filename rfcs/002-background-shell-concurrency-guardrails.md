# RFC-002: Guardrails and Visibility for Concurrent Background Shells

**Status**: Draft
**Author**: Community
**Created**: 2026-09-22
**Related Issue**: #916

## Summary

This RFC proposes a small, opt-in concurrency guard for background shell launches, plus the load visibility the reporter of issue #916 could not get. The guard warns as launches approach a configurable limit and refuses new background launches once the limit is reached, so the feature stays available and the blast radius stays bounded. This is the smallest change that closes the reported gap.

## Motivation

Issue #916 reports that the in-app agent spawned more than 20 concurrent test runs as direct children of the app, that load average climbed past 220, and that the machine became unusable with no cap, warning, or visibility from the app side. The runs were legitimate work and eventually completed. The session ended only with a manual reboot. The gap is plain: nothing bounds how many heavy shells run at once, and nothing tells the agent or the user that the system is saturated.

## Evidence

The live documentation gives us four facts that shape this proposal. First (F1), every background shell launch already returns a structured receipt with a task id, status, PID, working directory, and the path of an on-disk output log, so each launch is observable after the fact. Second (F2), the permissions layer already documents a parameter rule, Shell(run_in_background:true), that gates on exactly this flag, which proves run_in_background is a real top-level input parameter of the shell tool. Third (F3), the hooks page table for shell tool input lists command, args, directory, and timeout but never mentions run_in_background, so a hook cannot count on the flag being present in its payload and must read it defensively. Fourth (F4), hooks are scriptable and testable without running the product by piping a fake payload in, which is how the reference implementation carried by this RFC is verified. Where the flag is absent, the guard falls back to a configurable list of long-running command patterns, and that fallback is a stated limitation of the approach rather than a claim about what hooks receive.

## Why a threshold, not a blanket deny

Three options are available today, honestly ranked. Option (a) is the zero-code deny rule on Shell(run_in_background:true), which anyone can write now and which stops every background shell from launching. Option (b) is the guard proposed here, which keeps background shells working up to a limit and refuses only past it. Option (c) is admission control inside the harness itself, which only the maintainers can build. Option (a) is binary: it removes the capability the product documents as a feature, namely that any shell command can start as a tracked background task, while the reported failure was 20 or more simultaneous shells saturating a machine, not background shells as such. A threshold keeps the feature and bounds the failure. Option (c) is the maintainers call to make. Until it exists or this guard lands, option (a) remains the right answer for anyone who wants protection now.

## Design

### Admission model

The guard counts the live background shell launches it has registered in a session, and
applies a warn-then-deny ladder to launches it can identify as background or heavy:

- count below `cap - 1`: admit, no opinion. The hook prints nothing and exits 0.
- count at `cap - 1`: admit, and inject a warning through `additionalContext`.
- count at or above `cap`: deny through `permissionDecision: "deny"`, with a reason the model
  can read and act on.

A launch the guard cannot identify as background or heavy is never denied. It proceeds. If
the ledger is at or above the cap the guard may attach the soft warning, but it must not
block the call. That is the property that keeps the guard from regressing unrelated
foreground work: a quick `ls` is not the shape of the failure this RFC is about.

Why a denial rather than a queue, and why a denial rather than silence:

- A queue needs ordering and starvation rules, and it hides the decision from the model. A
  denial teaches the model the shape of the limit in one step.
- A denial with no warning arrives as a surprise in the middle of a fan-out. The warn
  threshold gives the model a turn in which it can serialise its own work before the wall.
- A silent drop is the worst of the three: the model retries the same pattern and the user
  sees nothing.

The two message strings are fixed:

> Background shell concurrency limit reached (N/M active). Complete or stop an existing
> background task before launching another. Use shell_tasks to list active tasks,
> kill_shell or task_stop to free capacity.

> WARNING: Background shell concurrency is at N/M. One more launch will hit the cap.
> Consider completing existing tasks before starting new ones.

### Identifying a gateable launch

The `PreToolUse` payload documents `tool_input` for `shell_command` as `command`, `args`,
`directory`, and `timeout`. The permissions layer separately documents
`Shell(run_in_background:true)` as a matchable parameter, so the flag is a real top-level
input of the shell tool even though the hooks `tool_input` table does not enumerate it. The
guard therefore reads the flag when it is there and never depends on it:

(a) `run_in_background` is present and truthy in the raw payload; or
(b) the command string contains one of a configurable list of long-running patterns:
`pytest`, `npm test`, `npm run`, `yarn`, `pnpm`, `cargo`, `go test`, `make`, `bundle exec`,
`docker build`, `tsc`, `vite build`, `webpack`, `gradle`, `mvn`.

**Stated limitation.** Condition (b) is a heuristic. A heavy command that does not match the
list and does not carry the flag is admitted. The list is configurable, which closes the
common cases, and the guard never denies a launch it cannot identify. The durable fix is
maintainer-side: surface the parameter the permissions layer already matches on in the
`PreToolUse` `tool_input` payload, or expose a documented count of live background shells.
Both are requested below.

### The ledger

Each hook invocation is a separate short-lived process, so the count has to live outside any
one of them. The state medium is a JSON file on disk, with `fcntl.flock` serialising the
read-modify-write.

- Path: `$TMPDIR/cc-shell-concurrency-guard.json`, falling back to
  `/tmp/cc-shell-concurrency-guard.json`, overridable through `CC_CONCURRENCY_STATE_FILE`.
- Schema: `{"entries": [{"pid": <int>, "task_id": <string>, "started_at": <epoch_ms>, "session_id": <string>}]}`
- Writer: the only path that adds an entry is `PostToolUse`. It parses the launch receipt
  from `tool_response` for a task id and a PID. A receipt that does not yield both — format
  drift, a foreground command, an error — registers nothing, and the hook exits 0 with no
  output. It does not guess.
- Reconciliation: every `PreToolUse` fire reads the ledger and drops the entries whose PID is
  no longer alive (`os.kill(pid, 0)` raises for a dead PID). The surviving count is the
  current concurrency. Dead entries are pruned from the file during that pass. That path
  never adds an entry.
- Fail-open: if the ledger cannot be opened or read, the guard cannot count, so it has no
  opinion and the call proceeds. It does not deny on a number it could not read.
- The file is held under an exclusive lock for the whole read-decide-write section, so
  concurrent hook processes cannot interleave a partial write.

The ledger counts what the guard registered, not everything the machine is running. A shell
the guard never observed is not in it, and a background task started by another session is
not in it either. The count is a floor.

### Visibility surfaces

| Audience | Channel | When |
|---|---|---|
| Model | `hookSpecificOutput.additionalContext` | warning, at `cap - 1` and above |
| Model | `hookSpecificOutput.permissionDecisionReason` | denial, at or above the cap |
| User | `systemMessage` (TUI feed) | denial |

All three are documented hook output fields. Nothing here needs a new UI surface: the
user-facing side is one line of text in the feed the user already reads.

**Harness-side readout (a suggestion, not part of the proposal).** The Background panel
already shows a running count in the status bar. A concurrency indicator there, reading the
same number the hook reads, would give the user visibility with nothing installed. That is a
maintainer decision and the RFC does not depend on it.

### What the guard cannot enforce

1. It cannot reliably detect `run_in_background` in `tool_input`, because the field is not in
   the documented schema for `shell_command`. It reads it defensively when present.
2. It cannot stop CPU-heavy work that runs in the foreground and does not match the pattern
   list.
3. It cannot enforce anything if hooks are skipped, or are not configured at all.
4. It counts tasks, not resource usage. It does not read CPU load or memory pressure.
5. It cannot stop a user from bypassing it by editing settings or removing the hook.
6. It cannot cap background sub-agents. The `agent` tool with `run_in_background: true` is a
   different tool, not `shell_command`.
7. Cross-process state depends on the file lock, which is best-effort on some filesystems.
8. The receipt parse is regex-based and breaks if the receipt format changes. A structured
   hook payload for background task receipts would close that gap, and is requested below.

## Configuration

### Environment variables

| Key | Default | Precedence | Source |
|-----|---------|------------|--------|
| `CC_SHELL_CONCURRENCY_CAP` | `max(min(cpu_count // 2, 8), 2)` | env var overrides built-in default | Environment variable |
| `CC_SHELL_HEAVY_PATTERNS` | `pytest,npm test,npm run,yarn,pnpm,cargo,go test,make,bundle exec,docker build,tsc,vite build,webpack,gradle,mvn` | env var overrides built-in default | Environment variable |
| `CC_CONCURRENCY_STATE_FILE` | `$TMPDIR/cc-shell-concurrency-guard.json` | env var overrides | Environment variable |

The default cap takes half the core count, capped at 8 and floored at 2, so a large machine
does not admit a wide fan-out and a small one is not strangled. `CC_SHELL_CONCURRENCY_CAP`
must parse as an integer of 1 or more; anything else falls back to the computed default
rather than failing the hook. `CC_SHELL_HEAVY_PATTERNS` replaces the built-in list, and an
empty string disables pattern matching so only the `run_in_background` signal is used.

No `settings.json` keys are introduced. The guard is configured entirely through environment
variables, which keeps it independent of the product's settings schema.

### Wiring

Add the two entries to the project's `.commandcode/settings.json`. The same script serves
both events; `--post` selects the `PostToolUse` path.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "shell",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .commandcode/hooks/shell_concurrency_guard.py",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "shell",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .commandcode/hooks/shell_concurrency_guard.py --post",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Both entries carry a 10 second timeout. The `PreToolUse` hook runs before the call and must
not be slow: it opens one small file, counts, and exits. The `PostToolUse` hook only appends
on a launch that returned a parseable receipt, and runs after the tool has already returned.

The two files the entries point at are the two files carried by this document. Their
installation paths are the paths in the block sentinels below:

- `.commandcode/hooks/shell_concurrency_guard.py`
- `tests/test_shell_concurrency_guard.py`

## Reference implementation

Both files below are Python 3 standard library, Python 3.9 or newer, with no third-party
dependency and no install step. The code in these blocks is the code the test suite was run
against: the blocks are delimiter-exact, and a byte-wise extraction of them diffs clean
against the tested copies.

Python rather than the bash plus `jq` shape the documentation examples use, because `jq` is
an external dependency the documentation itself lists as a common failure, and because
`json` gives the hook safe parsing of untrusted `tool_input` without `eval`.

The policy core, `decide_concurrency(current_count, cap, is_gateable)`, is a pure function
with no I/O, which is what makes the ladder testable without spawning anything.

### `.commandcode/hooks/shell_concurrency_guard.py`

<!-- BEGIN file: .commandcode/hooks/shell_concurrency_guard.py -->
```python
#!/usr/bin/env python3
"""Bound the number of concurrent background shell tasks in one session.

One script, two entry points:

  PreToolUse  (default)  reads the hook payload on stdin, reconciles the ledger,
                         and decides admit / warn / deny for shell launches.
  PostToolUse (--post)   parses the launch receipt and registers the entry.

Everything is Python 3 stdlib. Nothing here needs an install step.

Design notes that matter when reading the code:

* The guard only ever denies a launch it can identify as a background or heavy
  launch. A launch it cannot identify is never blocked.
* The only writer of ledger entries is the ``--post`` path. The PreToolUse path
  reads the ledger and drops entries whose PID is no longer alive; it never adds
  one.
* Fail-open: an unreadable ledger means the guard cannot count, so it has no
  opinion and the call proceeds.

Environment variables (all optional):

  CC_SHELL_CONCURRENCY_CAP   integer >= 1, overrides the computed default cap.
  CC_SHELL_HEAVY_PATTERNS    comma-separated substring patterns; an empty string
                             disables pattern matching.
  CC_CONCURRENCY_STATE_FILE  path of the ledger JSON file.
"""

import errno
import fcntl
import json
import os
import re
import sys
import time
from contextlib import contextmanager
from typing import Any, Dict, List, Optional, Tuple

STATE_FILE_NAME = "cc-shell-concurrency-guard.json"

ENV_CAP = "CC_SHELL_CONCURRENCY_CAP"
ENV_PATTERNS = "CC_SHELL_HEAVY_PATTERNS"
ENV_STATE_FILE = "CC_CONCURRENCY_STATE_FILE"

SHELL_TOOL_NAME = "shell_command"
SHELL_DISPLAY_NAME = "SHELL"

DEFAULT_HEAVY_PATTERNS = [
    "pytest",
    "npm test",
    "npm run",
    "yarn",
    "pnpm",
    "cargo",
    "go test",
    "make",
    "bundle exec",
    "docker build",
    "tsc",
    "vite build",
    "webpack",
    "gradle",
    "mvn",
]

DENY_REASON_TEMPLATE = (
    "Background shell concurrency limit reached ({count}/{cap} active). "
    "Complete or stop an existing background task before launching another. "
    "Use shell_tasks to list active tasks, kill_shell or task_stop to free capacity."
)

WARN_CONTEXT_TEMPLATE = (
    "WARNING: Background shell concurrency is at {count}/{cap}. "
    "One more launch will hit the cap. "
    "Consider completing existing tasks before starting new ones."
)

SOFT_WARN_CONTEXT_TEMPLATE = (
    "NOTE: Background shell concurrency is at {count}/{cap} on the background "
    "ledger, but this command was not identified as a background or heavy "
    "launch, so it was not blocked."
)

SYSTEM_MESSAGE_TEMPLATE = (
    "Background shell concurrency limit reached ({count}/{cap} active): "
    "a background shell launch was denied. Use shell_tasks to list active "
    "tasks, kill_shell or task_stop to free capacity."
)


# --------------------------------------------------------------------------- #
# Policy core
# --------------------------------------------------------------------------- #

def decide_concurrency(
    current_count: int,
    cap: int,
    is_gateable: bool,
) -> Optional[Dict[str, Any]]:
    """Return the hook output dict, or ``None`` for "no opinion, allow".

    Pure function, no I/O.

    ``current_count`` is the reconciled count of live background launches
    *before* the call being decided is admitted.

    Gateable launches:
      * ``current_count >= cap``      -> deny
      * ``current_count >= cap - 1``  -> admit with a warning
      * otherwise                     -> no opinion

    Non-gateable launches are never denied. At or above the cap they get a soft
    warning and still proceed.
    """
    count = int(current_count)
    limit = int(cap)

    if is_gateable:
        if count >= limit:
            reason = DENY_REASON_TEMPLATE.format(count=count, cap=limit)
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                },
                "systemMessage": SYSTEM_MESSAGE_TEMPLATE.format(
                    count=count, cap=limit
                ),
            }
        if count >= limit - 1:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "additionalContext": WARN_CONTEXT_TEMPLATE.format(
                        count=count, cap=limit
                    ),
                }
            }
        return None

    if count >= limit:
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": SOFT_WARN_CONTEXT_TEMPLATE.format(
                    count=count, cap=limit
                ),
            }
        }
    return None


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

def compute_default_cap(cpu_count: Optional[int] = None) -> int:
    """Default cap: ``max(min(cores // 2, 8), 2)``."""
    cores = os.cpu_count() if cpu_count is None else cpu_count
    if not cores or cores < 1:
        cores = 2
    return max(min(cores // 2, 8), 2)


def resolve_cap() -> int:
    """Effective cap: the validated env override, else the computed default."""
    raw = os.environ.get(ENV_CAP)
    if raw is not None:
        try:
            value = int(str(raw).strip())
        except (TypeError, ValueError):
            value = -1
        if value >= 1:
            return value
    return compute_default_cap()


def heavy_patterns() -> List[str]:
    """Effective long-running command patterns.

    The env var replaces the built-in list. An empty string disables pattern
    matching entirely.
    """
    raw = os.environ.get(ENV_PATTERNS)
    if raw is None:
        return list(DEFAULT_HEAVY_PATTERNS)
    return [part.strip() for part in raw.split(",") if part.strip()]


def state_file_path() -> str:
    """Ledger path: env override, else ``$TMPDIR`` with a ``/tmp`` fallback."""
    override = os.environ.get(ENV_STATE_FILE)
    if override:
        return override
    base = os.environ.get("TMPDIR") or "/tmp"
    return os.path.join(base, STATE_FILE_NAME)


# --------------------------------------------------------------------------- #
# Payload inspection
# --------------------------------------------------------------------------- #

def is_shell_payload(payload: Dict[str, Any]) -> bool:
    """True when the payload describes a shell tool call.

    Absent identifying fields are not treated as evidence of a non-shell tool:
    the hook is wired to a shell matcher, so an envelope without the tool fields
    is still handled.
    """
    tool_name = payload.get("tool_name")
    if isinstance(tool_name, str) and tool_name:
        return tool_name == SHELL_TOOL_NAME
    display = payload.get("tool_display_name")
    if isinstance(display, str) and display:
        return display.upper() == SHELL_DISPLAY_NAME
    return True


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("true", "1", "yes", "on")
    if isinstance(value, (int, float)):
        return value != 0
    return False


def is_gateable(
    payload: Dict[str, Any],
    tool_input: Dict[str, Any],
    patterns: List[str],
) -> bool:
    """Decide whether this launch is one the guard may gate.

    (a) ``run_in_background`` present and truthy in the raw payload. The field
        is not part of the documented ``shell_command`` ``tool_input`` table, so
        it is read defensively and its absence is not an error.
    (b) the command string matches one of the configured long-running patterns.
    """
    container = tool_input if isinstance(tool_input, dict) else {}
    for source in (payload, container):
        if isinstance(source, dict) and _truthy(source.get("run_in_background")):
            return True

    command = container.get("command")
    if not isinstance(command, str) or not command:
        return False
    for pattern in patterns or []:
        if pattern and pattern in command:
            return True
    return False


# --------------------------------------------------------------------------- #
# Ledger
# --------------------------------------------------------------------------- #

@contextmanager
def ledger_lock(path: str):
    """Hold an exclusive ``flock`` on the ledger file while it is open."""
    directory = os.path.dirname(os.path.abspath(path))
    if directory and not os.path.isdir(directory):
        try:
            os.makedirs(directory)
        except OSError:
            pass
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield fd
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        except OSError:
            pass
        try:
            os.close(fd)
        except OSError:
            pass


def _read_ledger_fd(fd: int) -> Tuple[List[Dict[str, Any]], bool]:
    """Return ``(entries, valid)``.

    ``valid`` is False when the file is empty or does not hold a parseable
    ledger, so the caller can normalise it instead of leaving a zero-byte file
    that fails to parse.
    """
    try:
        os.lseek(fd, 0, os.SEEK_SET)
    except OSError:
        return [], False
    chunks = []
    while True:
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            return [], False
        if not chunk:
            break
        chunks.append(chunk)
    raw = b"".join(chunks)
    if not raw.strip():
        return [], False
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return [], False
    if not isinstance(data, dict):
        return [], False
    entries = data.get("entries")
    if not isinstance(entries, list):
        return [], False
    return [entry for entry in entries if isinstance(entry, dict)], True


def _write_entries_fd(fd: int, entries: List[Dict[str, Any]]) -> None:
    blob = json.dumps({"entries": entries}, separators=(",", ":")).encode("utf-8")
    os.lseek(fd, 0, os.SEEK_SET)
    os.ftruncate(fd, 0)
    written = 0
    while written < len(blob):
        written += os.write(fd, blob[written:])
    try:
        os.fsync(fd)
    except OSError:
        pass


def _pid_alive(pid: int) -> bool:
    """``kill -0`` check. A dead PID raises, a live one does not."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError as exc:
        if getattr(exc, "errno", None) == errno.ESRCH:
            return False
        return True
    return True


def reconcile_entries(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep only entries whose PID is still alive."""
    live = []
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        try:
            pid = int(entry.get("pid"))
        except (TypeError, ValueError):
            continue
        if _pid_alive(pid):
            live.append(entry)
    return live


def count_live_entries(path: str, prune: bool = True) -> Optional[int]:
    """Reconciled count of live background launches.

    Returns ``None`` when the ledger cannot be opened or read at all, which the
    caller treats as "cannot count, no opinion".
    """
    try:
        with ledger_lock(path) as fd:
            entries, valid = _read_ledger_fd(fd)
            live = reconcile_entries(entries)
            if prune and (not valid or len(live) != len(entries)):
                _write_entries_fd(fd, live)
            return len(live)
    except (OSError, IOError):
        return None


# --------------------------------------------------------------------------- #
# Launch receipts
# --------------------------------------------------------------------------- #

_TASK_ID_PATTERNS = (
    re.compile(r"\btask[\s_-]*id[\"']?\s*[:=]\s*[\"']?([A-Za-z0-9_.:-]+)", re.IGNORECASE),
    re.compile(r"\b(task_[A-Za-z0-9]+)\b"),
)

_PID_PATTERNS = (
    re.compile(r"\bpid[\"']?\s*[:=]\s*[\"']?(\d+)", re.IGNORECASE),
    re.compile(r"\bPID\s+(\d+)\b"),
)


def _first_match(text: str, patterns) -> Optional[str]:
    for pattern in patterns:
        match = pattern.search(text)
        if match:
            return match.group(1)
    return None


def _response_text(response: Any) -> str:
    if isinstance(response, str):
        return response
    if isinstance(response, (dict, list)):
        try:
            return json.dumps(response)
        except (TypeError, ValueError):
            return ""
    if response is None:
        return ""
    try:
        return str(response)
    except Exception:
        return ""


def parse_launch_receipt(text: str) -> Optional[Dict[str, Any]]:
    """Extract ``{"task_id", "pid"}`` from a background launch receipt.

    Tolerant on purpose: the receipt format is documented in prose, not as a
    schema. A receipt that does not yield both a task id and a PID returns
    ``None`` and nothing is registered.
    """
    if not text:
        return None
    task_id = _first_match(text, _TASK_ID_PATTERNS)
    pid_text = _first_match(text, _PID_PATTERNS)
    if not task_id or not pid_text:
        return None
    try:
        pid = int(pid_text)
    except (TypeError, ValueError):
        return None
    if pid <= 0:
        return None
    return {"task_id": task_id, "pid": pid}


# --------------------------------------------------------------------------- #
# Entry points
# --------------------------------------------------------------------------- #

def run_pre(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        tool_input = {}

    gateable = is_gateable(payload, tool_input, heavy_patterns())
    count = count_live_entries(state_file_path())
    if count is None:
        return None
    return decide_concurrency(count, resolve_cap(), gateable)


def run_post(payload: Dict[str, Any]) -> None:
    text = _response_text(payload.get("tool_response"))
    parsed = parse_launch_receipt(text)
    if not parsed:
        return

    session_id = payload.get("session_id")
    if not isinstance(session_id, str) or not session_id:
        session_id = os.environ.get("COMMANDCODE_SESSION_ID") or ""

    entry = {
        "pid": parsed["pid"],
        "task_id": parsed["task_id"],
        "started_at": int(time.time() * 1000),
        "session_id": session_id,
    }

    try:
        with ledger_lock(state_file_path()) as fd:
            entries, _valid = _read_ledger_fd(fd)
            entries = reconcile_entries(entries)
            for existing in entries:
                if (
                    existing.get("pid") == entry["pid"]
                    and existing.get("task_id") == entry["task_id"]
                ):
                    return
            entries.append(entry)
            _write_entries_fd(fd, entries)
    except (OSError, IOError, ValueError):
        return


def main(argv: Optional[List[str]] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    post = "--post" in args

    try:
        raw = sys.stdin.read()
    except Exception:
        return 0
    if not raw or not raw.strip():
        return 0

    try:
        payload = json.loads(raw)
    except Exception:
        return 0
    if not isinstance(payload, dict):
        return 0
    if not is_shell_payload(payload):
        return 0

    if post:
        run_post(payload)
        return 0

    output = run_pre(payload)
    if output:
        sys.stdout.write(json.dumps(output) + "\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException:
        sys.exit(0)
```
<!-- END file: .commandcode/hooks/shell_concurrency_guard.py -->

### `tests/test_shell_concurrency_guard.py`

<!-- BEGIN file: tests/test_shell_concurrency_guard.py -->
```python
#!/usr/bin/env python3
"""Tests for the background shell concurrency guard.

Stdlib only, Python 3.9+. No install step, no third-party runner.

Run either way:

    python3 tests/test_shell_concurrency_guard.py
    python3 -m unittest discover -s tests -p 'test_*.py'

These tests exercise the reference implementation carried by the RFC. They feed
documented payload shapes through the hook and assert the documented decision
shapes. They do not, and cannot, exercise the product that would run the hook.
"""

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from typing import Any, Dict, Optional
from unittest import mock

_HERE = os.path.dirname(os.path.abspath(__file__))
for _candidate in (
    os.path.join(_HERE, "..", "hooks"),
    os.path.join(_HERE, "..", ".commandcode", "hooks"),
):
    if os.path.isfile(
        os.path.join(_candidate, "shell_concurrency_guard.py")
    ) and _candidate not in sys.path:
        sys.path.insert(0, _candidate)

import shell_concurrency_guard as guard


def _find_key(obj: Any, key: str) -> Optional[str]:
    """First value for ``key`` at the top level or under ``hookSpecificOutput``."""
    if not isinstance(obj, dict):
        return None
    if key in obj and isinstance(obj[key], str):
        return obj[key]
    nested = obj.get("hookSpecificOutput")
    if isinstance(nested, dict) and isinstance(nested.get(key), str):
        return nested[key]
    return None


def _entry(pid: int, task_id: str) -> Dict[str, Any]:
    return {
        "pid": pid,
        "task_id": task_id,
        "started_at": 1758000000000,
        "session_id": "session-under-test",
    }


def _write_state(path: str, entries) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"entries": entries}, handle)


def _read_state(path: str):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


class ShellConcurrencyGuardTests(unittest.TestCase):
    """The eight locked behavioural tests."""

    def test_admit_below_cap(self):
        self.assertIsNone(guard.decide_concurrency(0, 4, True))
        self.assertIsNone(guard.decide_concurrency(1, 4, True))

    def test_warn_at_threshold(self):
        output = guard.decide_concurrency(3, 4, True)
        self.assertIsInstance(output, dict)
        context = _find_key(output, "additionalContext")
        self.assertIsNotNone(context)
        self.assertIn("WARNING", context)
        self.assertIn("concurrency", context)

    def test_deny_at_cap(self):
        count, cap = 4, 4
        output = guard.decide_concurrency(count, cap, True)
        self.assertIsInstance(output, dict)
        specific = output["hookSpecificOutput"]
        self.assertEqual(specific["permissionDecision"], "deny")
        reason = specific["permissionDecisionReason"]
        self.assertIn(str(count), reason)
        self.assertIn("shell_tasks", reason)
        self.assertIn("kill_shell", reason)

    def test_default_cap_formula(self):
        cores = os.cpu_count() or 2
        self.assertEqual(guard.compute_default_cap(), max(min(cores // 2, 8), 2))
        self.assertEqual(guard.compute_default_cap(1), 2)
        self.assertEqual(guard.compute_default_cap(8), 4)
        self.assertEqual(guard.compute_default_cap(64), 8)
        self.assertEqual(guard.compute_default_cap(None), guard.compute_default_cap())

    def test_stale_entry_cleanup(self):
        dead_pid, live_pid = 4242, 5353
        with tempfile.TemporaryDirectory() as tmp:
            state = os.path.join(tmp, "guard-state.json")
            _write_state(state, [_entry(dead_pid, "task_dead"), _entry(live_pid, "task_live")])

            def fake_kill(pid, sig):
                if pid == dead_pid:
                    raise ProcessLookupError(3, "No such process")
                return None

            with mock.patch("os.kill", side_effect=fake_kill):
                count = guard.count_live_entries(state)

            self.assertEqual(count, 1)
            remaining = _read_state(state)["entries"]
            self.assertEqual(len(remaining), 1)
            self.assertEqual(remaining[0]["task_id"], "task_live")

    def test_refusal_message_content(self):
        count, cap = 4, 3
        output = guard.decide_concurrency(count, cap, True)
        reason = output["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertIn(str(count), reason)
        self.assertIn(str(cap), reason)
        self.assertIn("shell_tasks", reason)
        self.assertIn("kill_shell", reason)

    def test_env_override_cap(self):
        with mock.patch.dict(os.environ, {"CC_SHELL_CONCURRENCY_CAP": "3"}):
            self.assertEqual(guard.resolve_cap(), 3)
        with mock.patch.dict(os.environ, {"CC_SHELL_CONCURRENCY_CAP": " 12 "}):
            self.assertEqual(guard.resolve_cap(), 12)

    def test_nongateable_never_denied(self):
        for count in (2, 9, 100):
            output = guard.decide_concurrency(count, 2, False)
            if output is not None:
                self.assertNotIn("deny", json.dumps(output))
            self.assertNotIn("deny", json.dumps(output or {}))


class ShellConcurrencyGuardConfigurationTests(unittest.TestCase):
    """Configuration parsing and the identification signal."""

    def test_invalid_cap_falls_back_and_does_not_crash(self):
        for value in ("", "zero", "0", "-4", "2.5", "3x"):
            with mock.patch.dict(os.environ, {"CC_SHELL_CONCURRENCY_CAP": value}):
                self.assertEqual(guard.resolve_cap(), guard.compute_default_cap())

    def test_heavy_pattern_override(self):
        with mock.patch.dict(os.environ, {"CC_SHELL_HEAVY_PATTERNS": "ninja,meson"}):
            self.assertEqual(guard.heavy_patterns(), ["ninja", "meson"])
        with mock.patch.dict(os.environ, {"CC_SHELL_HEAVY_PATTERNS": ""}):
            self.assertEqual(guard.heavy_patterns(), [])
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("CC_SHELL_HEAVY_PATTERNS", None)
            self.assertIn("pytest", guard.heavy_patterns())

    def test_run_in_background_signal_is_defensive(self):
        patterns = guard.heavy_patterns()
        self.assertTrue(guard.is_gateable({"run_in_background": True}, {}, patterns))
        self.assertTrue(
            guard.is_gateable({"tool_input": {"run_in_background": "true"}}, {"run_in_background": "true"}, patterns)
        )
        self.assertTrue(guard.is_gateable({}, {"command": "npm run build"}, patterns))
        self.assertFalse(guard.is_gateable({}, {"command": "ls -la"}, patterns))
        self.assertFalse(guard.is_gateable({}, {"command": "npm run build"}, []))
        self.assertFalse(guard.is_gateable({"run_in_background": False}, {"command": "ls"}, patterns))

    def test_state_path_default_and_override(self):
        with mock.patch.dict(os.environ, {"TMPDIR": "/tmp/probe-tmp"}, clear=False):
            os.environ.pop("CC_CONCURRENCY_STATE_FILE", None)
            self.assertEqual(
                guard.state_file_path(),
                os.path.join("/tmp/probe-tmp", "cc-shell-concurrency-guard.json"),
            )
        with mock.patch.dict(os.environ, {"CC_CONCURRENCY_STATE_FILE": "/tmp/probe-state.json"}):
            self.assertEqual(guard.state_file_path(), "/tmp/probe-state.json")


class ShellConcurrencyGuardCliTests(unittest.TestCase):
    """Payload robustness and the PostToolUse registration path."""

    def _fire(self, text, argv=()):
        buffer = io.StringIO()
        with mock.patch("sys.stdin", io.StringIO(text)):
            with redirect_stdout(buffer):
                code = guard.main(list(argv))
        return code, buffer.getvalue()

    def test_empty_stdin_is_silent(self):
        for text in ("", "   ", "\n"):
            self.assertEqual(self._fire(text), (0, ""))

    def test_malformed_payload_is_silent(self):
        for text in ("not json", "{", '{"tool_name": ', "[1, 2, 3]", '"a string"'):
            self.assertEqual(self._fire(text), (0, ""))

    def test_non_shell_tool_is_silent(self):
        payload = json.dumps(
            {
                "hook_event_name": "PreToolUse",
                "tool_name": "read_file",
                "tool_display_name": "READ",
                "tool_input": {"absolute_path": "/etc/hosts"},
                "session_id": "s",
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            state = os.path.join(tmp, "guard-state.json")
            _write_state(state, [_entry(4, "task_live")])
            with mock.patch.dict(os.environ, {"CC_CONCURRENCY_STATE_FILE": state}):
                self.assertEqual(self._fire(payload), (0, ""))

    def test_unreadable_ledger_is_silent(self):
        payload = json.dumps(
            {
                "hook_event_name": "PreToolUse",
                "tool_name": "shell_command",
                "tool_display_name": "SHELL",
                "tool_input": {"command": "pytest -q"},
                "session_id": "s",
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            # A directory where the ledger file should be: opening it raises.
            state = os.path.join(tmp, "guard-state.json")
            os.mkdir(state)
            with mock.patch.dict(os.environ, {"CC_CONCURRENCY_STATE_FILE": state}):
                self.assertEqual(self._fire(payload), (0, ""))

    def test_deny_and_warn_through_the_entry_point(self):
        payload = json.dumps(
            {
                "hook_event_name": "PreToolUse",
                "tool_name": "shell_command",
                "tool_display_name": "SHELL",
                "tool_input": {"command": "pytest -q"},
                "session_id": "s",
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            state = os.path.join(tmp, "guard-state.json")
            env = {"CC_CONCURRENCY_STATE_FILE": state, "CC_SHELL_CONCURRENCY_CAP": "2"}

            _write_state(state, [_entry(11, "task_a")])
            with mock.patch.dict(os.environ, env):
                with mock.patch("os.kill", return_value=None):
                    code, out = self._fire(payload)
            self.assertEqual(code, 0)
            self.assertIsNone(_find_key(json.loads(out), "permissionDecision"))

            _write_state(state, [_entry(11, "task_a"), _entry(12, "task_b")])
            with mock.patch.dict(os.environ, env):
                with mock.patch("os.kill", return_value=None):
                    code, out = self._fire(payload)
            body = json.loads(out)
            self.assertEqual(code, 0)
            self.assertEqual(body["hookSpecificOutput"]["permissionDecision"], "deny")
            self.assertIn("systemMessage", body)

    def test_post_registers_receipt_and_is_silent(self):
        receipt = (
            "Background task started.\n"
            "task_id: task_01HZX9\n"
            "status: running\n"
            "pid: 90210\n"
            "cwd: /tmp\n"
            "log: /tmp/task_01HZX9.log\n"
        )
        payload = json.dumps(
            {
                "hook_event_name": "PostToolUse",
                "tool_name": "shell_command",
                "tool_display_name": "SHELL",
                "tool_input": {"command": "npm test"},
                "tool_response": receipt,
                "session_id": "session-abc",
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            state = os.path.join(tmp, "guard-state.json")
            with mock.patch.dict(os.environ, {"CC_CONCURRENCY_STATE_FILE": state}):
                self.assertEqual(self._fire(payload, argv=["--post"]), (0, ""))
                entries = _read_state(state)["entries"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["task_id"], "task_01HZX9")
        self.assertEqual(entries[0]["pid"], 90210)
        self.assertEqual(entries[0]["session_id"], "session-abc")
        self.assertIsInstance(entries[0]["started_at"], int)

    def test_post_ignores_unparsable_receipt(self):
        for response in ("done, no tasks here", "", "task_id: only_an_id", "pid: 5"):
            payload = json.dumps(
                {
                    "hook_event_name": "PostToolUse",
                    "tool_name": "shell_command",
                    "tool_display_name": "SHELL",
                    "tool_input": {"command": "ls"},
                    "tool_response": response,
                    "session_id": "session-abc",
                }
            )
            with tempfile.TemporaryDirectory() as tmp:
                state = os.path.join(tmp, "guard-state.json")
                with mock.patch.dict(os.environ, {"CC_CONCURRENCY_STATE_FILE": state}):
                    self.assertEqual(self._fire(payload, argv=["--post"]), (0, ""))
                if os.path.exists(state):
                    self.assertEqual(_read_state(state)["entries"], [])

    def test_post_accepts_structured_receipt(self):
        payload = json.dumps(
            {
                "hook_event_name": "PostToolUse",
                "tool_name": "shell_command",
                "tool_display_name": "SHELL",
                "tool_input": {"command": "pytest"},
                "tool_response": {"task_id": "task_ZZ9", "pid": 777, "status": "running"},
                "session_id": "session-abc",
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            state = os.path.join(tmp, "guard-state.json")
            with mock.patch.dict(os.environ, {"CC_CONCURRENCY_STATE_FILE": state}):
                self.assertEqual(self._fire(payload, argv=["--post"]), (0, ""))
                entries = _read_state(state)["entries"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["pid"], 777)
        self.assertEqual(entries[0]["task_id"], "task_ZZ9")

    def test_pre_never_writes_entries(self):
        payload = json.dumps(
            {
                "hook_event_name": "PreToolUse",
                "tool_name": "shell_command",
                "tool_display_name": "SHELL",
                "tool_input": {"command": "npm run dev", "run_in_background": True},
                "session_id": "s",
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            state = os.path.join(tmp, "guard-state.json")
            with mock.patch.dict(os.environ, {"CC_CONCURRENCY_STATE_FILE": state}):
                self.assertEqual(self._fire(payload), (0, ""))
                if os.path.exists(state):
                    self.assertEqual(_read_state(state)["entries"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
```
<!-- END file: tests/test_shell_concurrency_guard.py -->

### Running the tests

From the project root, with the two files installed at the paths above:

```
python3 tests/test_shell_concurrency_guard.py
python3 -m unittest discover -s tests -p 'test_*.py'
```

Both forms use the standard library `unittest` runner, which is what the suite is written
for. There is no `pytest`, no package to install, and no build step.

What the tests cover: the eight decisions of the ladder and its configuration, plus the
payload handling the hook has to survive — empty stdin, malformed JSON, a payload for a
non-shell tool, an unreadable ledger, a `PostToolUse` receipt that registers an entry, a
receipt that does not parse, and the rule that the `PreToolUse` path never adds an entry.

**What these tests do and do not prove.** They exercise the reference implementation carried
by this document, by feeding documented payload shapes through the script and asserting the
documented decision shapes. They were run without the product installed, off-product. They
say nothing about the product's own behaviour, and they are not a claim that the product has
been changed.

### Exercising the decision path by hand

The ladder is visible in one command, with no state file involved, because the policy core is
a pure function:

```
python3 -c 'import sys; sys.path.insert(0, ".commandcode/hooks"); import shell_concurrency_guard as g; print(g.decide_concurrency(1, 3, True)); print(g.decide_concurrency(2, 3, True)); print(g.decide_concurrency(3, 3, True))'
```

At a cap of 3 that prints `None` (admit, no opinion), then the warning object, then the
denial object.

To drive the hook itself, save this as `pre-tool-use-payload.json`:

```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "example-session",
  "transcript_path": "/tmp/example-session.jsonl",
  "cwd": "/tmp/example-project",
  "tool_name": "shell_command",
  "tool_display_name": "SHELL",
  "tool_input": {
    "command": "pytest -q",
    "run_in_background": true
  }
}
```

then run the hook the way the harness runs it:

```
python3 .commandcode/hooks/shell_concurrency_guard.py < pre-tool-use-payload.json
```

With an empty ledger this prints nothing and exits 0: that is "no opinion, allow".

The registration side takes a receipt. Save this as `post-tool-use-payload.json`:

```json
{
  "hook_event_name": "PostToolUse",
  "session_id": "example-session",
  "cwd": "/tmp/example-project",
  "tool_name": "shell_command",
  "tool_display_name": "SHELL",
  "tool_input": {
    "command": "npm test",
    "run_in_background": true
  },
  "tool_response": "Background task started. task_id: task_example123, status: running, pid: 4242, cwd: /tmp/example-project, log: /tmp/task_example123.log"
}
```

```
python3 .commandcode/hooks/shell_concurrency_guard.py --post < post-tool-use-payload.json
```

That registers one entry, silently, and exits 0. The receipt in this example carries pid
4242, which is almost certainly not a live process on your machine, so the next `PreToolUse`
fire would drop the entry during reconciliation. Point the payload's `pid` at a process that
is alive to watch a registered launch hold its slot.

## Compatibility and rollback

Nothing changes for anyone who does not opt in. The guard ships as a hook the user installs deliberately, so existing sessions, settings, and workflows behave exactly as before. If the guard misbehaves or is no longer wanted, reverting is deleting the file this RFC adds. No product behavior changes and no migration is needed.

The detail behind that statement:

- **No hooks configured.** The guard does nothing. The session behaves exactly as it does
  without it, and no new failure mode is introduced.
- **Hooks configured but the script missing or failing.** The documented behaviour for a hook
  command that cannot be run applies: the failure is logged and the tool proceeds. The guard
  never converts its own breakage into a blocked shell call.
- **What this document promises.** The reference implementation carried above, once
  installed, bounds the background shell launches it has registered at the computed or
  configured limit, warns as the count approaches that limit, and denies a gateable launch at
  the limit with an actionable message. Those statements are about the code in this document.
  They are not statements about the product.
- **What this document suggests, and does not promise.** That the maintainers expose the
  background flag, or a live count of background shells, in the `PreToolUse` payload;
  that they show a concurrency indicator where running counts are already shown; that they
  consider a built-in limit with a sensible default and a supported opt-out; and that they
  provide a structured hook payload for background task receipts, so registering a launch
  stops being regex work.
- **Removal.** Delete `.commandcode/hooks/shell_concurrency_guard.py`, delete
  `tests/test_shell_concurrency_guard.py`, and remove the two `hooks` entries from
  `settings.json`. Nothing else refers to them. The ledger lives under `$TMPDIR`: delete it,
  or let the temporary directory reclaim it.
- **Rollback.** Revert the commit that adds this document, or delete the file it adds.
- **Repository change.** This document adds one file,
  `rfcs/002-background-shell-concurrency-guardrails.md`. No other file is added, changed or
  deleted. There is no product code in this change, no build change, and no CI in this
  repository to run.

## Improvements requested from the maintainers

1. Please expose a live count of running background shells to hooks, or include the run_in_background flag itself in the PreToolUse tool_input payload for shell commands.
2. Please surface a concurrency indicator where the product already shows running counts, so the user can see saturation building.
3. Please consider a built-in cap on concurrent background shells with a sensible default and a supported opt-out.

## Open questions for the maintainers

1. What should the default limit be on a shared or CI machine, where one agent task fanning out can starve other users work?
2. When the limit is reached, does refusal fit the product philosophy better than queueing the extra launch until capacity frees up?
3. Does this guard belong in the harness at all, or should the product instead teach the agent to bound its own parallelism through load feedback?
4. Which surface should own the count of running background shells, so hooks, the panel, and the agent all read the same number?
