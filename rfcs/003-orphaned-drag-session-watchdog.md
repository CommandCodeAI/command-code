# RFC-003: Orphaned Drag Session Watchdog for the Drop-to-Attach Overlay

**Status:** draft proposal for maintainer review. **Addresses:** issue #915.
**Scope:** one markdown file. No product code, no build change, no CI.

## Summary

A drag that ends without a terminal drag event leaves the drop-to-attach overlay on screen and
the renderer busy until the window is reloaded. This proposal replaces the "overlay visible
until the next event" rule with an explicit active drag session: one shared teardown, six
terminal paths, and a watchdog that clears a session whose events have stopped.

## The proposed fix

Failure class: any drag session that ends without a terminal drag event leaves the app stuck
in the receiving state. The orphaned source process is one trigger. The class covers every
path where drop, dragleave, or dragend never arrives (source crash, source kill, OS-level
orphan at the WindowServer, focus change mid-drag). Fix the class, not one handler: the
overlay must be driven by an explicit active-drag-session state, never by the last enter
event alone.

Hypothesis (labelled as such: the renderer source is not public, so this is inferred from
the report, not from code): a dragenter handler sets the "drop to attach" state and shows
the overlay, but only drop and dragleave clear it. When the source dies first, neither
fires, the state stays true forever, and whatever repaint or animation work the overlay
performs keeps running against a drag that no longer exists, which matches the steady
30-66% renderer CPU with an unchanged renderer PID.

Minimal fix: (1) hold drag-receiving UI behind a session object with a watchdog: entering
the state starts a timer (a few seconds, refreshed on dragover). Expiry with no terminal
event resets the state and hides the overlay. (2) Clear the state on every terminal path:
drop, dragleave, dragend, window blur, and Escape. Escape and blur must work even when no
drag payload is present, since the orphaned case has no payload to deliver. (3) When the
session is inactive, stop all overlay-driven work: pause its animations and repaint loop,
remove its listeners, and confirm via sampling that the renderer returns to idle.

Diagnostic ask: log every drag-state transition (enter with source id where available,
over-throttled, leave, drop, dragend, blur-clear, escape-clear, watchdog-clear) at a level
shipped in release builds, so the next stuck-overlay report arrives with a timeline instead
of a CPU sample.

Verification: (1) reproduce per the report: drag over the window, kill the source mid-hover,
confirm the overlay clears on its own within the watchdog interval and renderer CPU returns
to idle with no reload. (2) Regression cover each terminal path: normal drop, dragleave,
dragend, blur mid-drag, Escape mid-drag. (3) Confirm no behavior change for intact drags:
overlay still appears on enter and attach still works on drop.

> Prepared from the public report text with human oversight. No renderer source was
available, so the cause above is a hypothesis for the maintainers to confirm.

## Reference implementation (evidence, not a patch)

The state machine, the watchdog and the idle-gating rule above were implemented and exercised in
isolation while preparing this proposal: eleven acceptance tests, one per behaviour described
above, 33 assertions, all passing on Node 22, with each test shown to fail when its behaviour is
deliberately removed. That work is evidence that the mechanism is implementable and testable. It
is deliberately not part of this pull request: the change belongs in the renderer that owns the
overlay, which is not this repository.

## Compatibility and rollback

This pull request adds one markdown file and changes nothing else, so it carries no runtime
compatibility surface. There is nothing to roll back if the proposal is not adopted: the file is
simply not merged, and no user-visible behaviour depends on it.

> Automated posting by agentic team with human oversight.
