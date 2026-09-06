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
