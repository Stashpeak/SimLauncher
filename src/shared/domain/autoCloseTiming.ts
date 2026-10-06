// Auto-close timing (#204). Shared so the profile editor states the real
// numbers (#945) rather than a paraphrase ("a few seconds") that read as a
// failure and could drift from the values main actually uses.

/**
 * How long to wait after the game's exe disappears before closing that
 * profile's companions (#204).
 *
 * NOT a debounce, and not protection against a bad tasklist read: reads report
 * `succeeded` explicitly and a failed one is never cached, so that risk is
 * handled deterministically in `observeProcessScan` (main's autoClose.ts).
 * This window exists because companion apps do their most important work AT
 * the end of a session. Garage61 uploads telemetry once the session ends;
 * killing it seconds later risks truncating exactly the data the user ran the
 * session for.
 *
 * Until now the only way these apps got closed was a human deciding to close
 * them, which happens tens of seconds to minutes after the flag drops, so the
 * absence of reported problems says nothing about closing them immediately.
 * 15s is deliberately on the safe side: a window that is too long is cosmetic,
 * a close that is too early destroys data, and it lands while the user still
 * has both hands on the wheel and cannot intervene.
 */
export const AUTO_CLOSE_GRACE_MS = 15000

/**
 * How long a game must have been seen running before its disappearance counts
 * as the end of a session (#204).
 *
 * Launcher stubs are the reason. Steam and EA App style entry points show up
 * under the configured game name, hand off to a differently-named child and
 * exit, all within seconds. Their disappearance is not an exit, it is the
 * session starting, and closing the user's overlays there lands mid-race.
 *
 * A duration rather than provenance: the alternative was to trust only games
 * SimLauncher launched itself, since only those produce a mismatch warning, and
 * that silently excluded everyone who starts their sim from Steam (Codex on
 * #826). This rule needs no evidence about who started the game.
 *
 * Two minutes costs nothing real. A session shorter than that had no telemetry
 * worth flushing and no overlays worth closing on a timer.
 */
export const MIN_SESSION_MS = 120000
