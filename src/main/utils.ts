import path from 'path'

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isValidExePath(p: unknown): p is string {
  return typeof p === 'string' && p.trim().length > 0 && /\.exe$/i.test(p.trim())
}

export function getExeName(filePath: string) {
  return path.basename(filePath).toLowerCase()
}

export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

export function getErrorCode(err: unknown) {
  return err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : undefined
}
