import type { Dispatch, SetStateAction } from 'react'
import { normalizeConfiguredExePath } from '../../../../shared/path'
import { getFileIcon } from '../../lib/electron'

/**
 * Asks the main process for the shell icon of every configured app path, in
 * parallel. An empty path is the "not configured" sentinel, not a file to ask
 * about, so it is left out of the answer.
 *
 * `null` is an answer rather than an absence: the executable has no usable
 * icon, or `get-file-icon` refused a path that is neither in the store nor
 * freshly picked through Browse. What a missing icon means for the slot is the
 * caller's call: the initial load simply shows nothing, a save after a path
 * change drops the previous executable's icon (#428, #898).
 */
export async function fetchAppIcons(
  appPaths: Record<string, string>
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    Object.entries(appPaths)
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(async ([key, path]) => [key, await getFileIcon(path)] as const)
  )
  return Object.fromEntries(entries)
}

/**
 * Refetches the icons of the app paths a save just wrote (#898).
 *
 * A path pasted or typed into a slot cannot have its icon fetched while it is
 * being entered: `get-file-icon` only answers for paths already in the store or
 * just picked through Browse, which is how Browse shows an icon immediately and
 * typing never did. The save is the moment the path becomes fetchable, and
 * nothing else asks afterwards, because the store-changed reload skips the
 * settings provider's own save on purpose (#480). So the icon corrected itself
 * only once some other write reloaded Settings, typically enabling the slot in
 * a profile.
 *
 * Same rule as the Browse branch: an icon replaces the previous one, no icon
 * drops it rather than leaving the old executable's picture on a new path
 * (#428). Functional updates, because a Browse that lands while the fetch is in
 * flight puts an icon in state this call never saw, and a value write would
 * discard it. Cosmetic, so a failure here logs and must not turn a saved
 * settings into a failed one.
 *
 * A result belongs to the path it was fetched for. A slot the user retyped or
 * Browsed while the fetch was in flight has moved on: the save-race guard keeps
 * that draft, Browse has already set that slot's icon, and an answer for the
 * path just written would overwrite it whenever the fetch settles second. So
 * each result is applied only while the slot still shows the path it was
 * fetched for, read from the synchronous mirror of the latest edits rather than
 * from the state this call closed over (Codex on #936).
 *
 * "Still shows" is judged in the sanitizer's own form of the input, trimmed
 * and with a matched pair of quotes removed (#859): the store keeps that form
 * and returns it as the persisted path, while the slot on screen holds the raw
 * input. Compared raw, a pasted "Copy as path" value is exactly the path that
 * never gets its icon, which is most of what this issue is about (Codex on
 * #936).
 */
export async function refreshAppIcons(
  persistedAppPaths: Record<string, string>,
  latestAppPaths: () => Record<string, string>,
  previousIcons: Record<string, string>,
  setAppIcons: Dispatch<SetStateAction<Record<string, string>>>,
  setIconLoadErrors: Dispatch<SetStateAction<Set<string>>>
): Promise<void> {
  let fetched: Record<string, string | null>
  try {
    fetched = await fetchAppIcons(persistedAppPaths)
  } catch (err) {
    console.error('Failed to refresh app icons after save:', err)
    return
  }
  const current = latestAppPaths()
  const keys = Object.keys(fetched).filter(
    (key) => normalizeConfiguredExePath(current[key] ?? '') === persistedAppPaths[key]
  )
  if (keys.length === 0) return

  setAppIcons((current) => {
    const next = { ...current }
    for (const key of keys) {
      const icon = fetched[key]
      if (icon) {
        next[key] = icon
      } else {
        delete next[key]
      }
    }
    return next
  })

  // A decode failure belongs to the image that failed: stale once the image
  // changes, still true while it does not, and never this save's business for
  // a bundled icon it did not fetch.
  const changed = keys.filter((key) => (fetched[key] ?? undefined) !== previousIcons[key])
  if (changed.length === 0) return
  setIconLoadErrors((current) => {
    if (!changed.some((key) => current.has(key))) return current
    const next = new Set(current)
    changed.forEach((key) => next.delete(key))
    return next
  })
}
