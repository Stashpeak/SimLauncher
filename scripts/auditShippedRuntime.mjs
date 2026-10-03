#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Release gate for the Electron runtime the installer ships. See #998.
//
// Why it exists: electron is a devDependency (electron-builder refuses it
// anywhere else), so the `npm audit --omit=dev` steps never see it, the blind
// spot #126 named. Yet electron-builder.yml pins no electronVersion, so the
// lockfile's electron IS the runtime inside the installer. v1.2.3 shipped
// 42.4.0 with five high advisories open and every audit step green.
//
// What it judges, and nothing else:
//
// - FAIL (exit 1) on an advisory filed against the `electron` package itself
//   that is not recorded in runtime-audit-accepted.json. Nothing else in the
//   tree is judged: electron-builder's own @electron/get pulls in
//   http-cache-semantics, whose GHSA-ch52-4w7c-c8xp has no patched release, so
//   a tree-wide gate would block every release with nothing to do. That
//   includes what npm lists against electron only because of a dependency
//   (the string entries in its `via`): electron's dependencies fetch and
//   unpack the binary at install time and do not ship.
// - WARN when the locked electron is behind the newest patch of its major, or
//   its major is past end of life. Chromium and V8 fixes ship in those patch
//   releases and never reach npm audit, so this is the only signal for them.
// - COULD NOT CHECK (exit 2) when npm gives no usable answer. Never a pass,
//   and deliberately not exit 1 either: the defect in #920 was an audit step
//   that reported a registry outage and a real finding with the same exit
//   code, so the reader had to open the log to learn which happened. Two kinds
//   are told apart, on #920's own discriminator: no `auditReportVersion` at
//   all is an outage (retried, and a re-run may help), while a report this
//   script cannot read is an answer that a re-run only repeats, so it is not
//   retried and says to update this script instead.
//
// Two npm settings fake a clean answer, and a machine can carry either one
// without anyone noticing. `offline` (any npmrc, or npm_config_offline) makes
// `npm audit` skip the registry and still print a well-formed version 2 report
// with nothing in it. `omit=dev`, or NODE_ENV=production, leaves electron, a
// devDependency, out of the report. Both read as a pass, so every query forces
// --offline=false and the audit adds --include=dev (see AUDIT_QUERY): a
// command-line flag outranks every npmrc and npm_config_* variable.
//
// Not wired into ci.yml on purpose: with strict required checks on main, an
// upstream advisory would turn every open PR red at once (#993). The release
// workflow runs it before anything is built or signed; run it at the start of
// a smoke run as well, so a new advisory surfaces before the smoke, not at the
// tag.
//
// Accepting an advisory. An advisory published mid-smoke must not blindly
// derail a milestone, and it must never pass silently either, so the failure
// forces a decision: bump electron, or record why the advisory stays. To
// record it, add an entry to the `accepted` list in runtime-audit-accepted.json:
//
//   { "id": "GHSA-xxxx-xxxx-xxxx", "reason": "why it cannot reach SimLauncher", "issue": 123 }
//
// The reason should name which of the advisory's "affected only if" conditions
// SimLauncher does not meet, and the issue is where the decision and the bump
// that ends it are tracked. An entry missing either fails the gate. An entry
// that no longer matches any reported advisory is a warning to delete it, so
// the file cannot rot into a blanket waiver.
//
// Usage: npm run audit:runtime. It judges the project in the current directory
// (package-lock.json there, and `npm audit` run there), which is what `npm run`
// sets, so it works on a bare lockfile without node_modules too.

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

/** Committed accepted-risk list, next to this script. */
export const ACCEPTED_FILE = 'scripts/runtime-audit-accepted.json'

// #920: npm never retries the audit request (it is a POST), and the default
// fetch-timeout of 300000 ms turned one failed attempt into five minutes of a
// runner. Healthy answers measured a 3.31 s median there, so short attempts
// with a retry outside npm beat one long wait. npm's own GET retries are
// switched off too, so this loop is the only retry policy to reason about.
const ATTEMPTS = 3
const FETCH_TIMEOUT_MS = 30000
const BACKOFF_MS = 5000

// --offline=false: offline mode answers the audit with a well-formed, empty
// report instead of an error (measured on the 1.2.3 lockfile: six FAIL lines
// become a PASS). On `npm view` it would serve cached, possibly stale tags.
const FETCH_FLAGS = [`--fetch-timeout=${FETCH_TIMEOUT_MS}`, '--fetch-retries=0', '--offline=false']

/**
 * The two questions main() puts to npm, and what counts as an answer to each
 * (anything else is retried). Exported so the tests pin the flags: losing one
 * of them does not break anything visibly, it makes the gate pass on a report
 * that silently left electron out.
 */
export const AUDIT_QUERY = {
  // --include=dev: electron is a devDependency, and NODE_ENV=production or an
  // omit=dev in any npmrc silently drops it from the report (measured: 11
  // findings become 0 on the 1.2.3 lockfile), which would read as a pass.
  args: ['audit', '--json', '--include=dev', ...FETCH_FLAGS],
  isAnswer: isAuditAnswer
}

/** See AUDIT_QUERY. */
export const DIST_TAGS_QUERY = {
  args: ['view', 'electron', 'dist-tags', '--json', ...FETCH_FLAGS],
  isAnswer: isDistTags
}

const GHSA_ID = /^GHSA(?:-[0-9a-z]{4}){3}$/i
const GHSA_IN_URL = /GHSA(?:-[0-9a-z]{4}){3}/i

/**
 * `JSON.parse` that returns undefined instead of throwing. npm prints plain
 * text, not JSON, for some failures, and those are an outage like any other.
 */
export function readNpmJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Whether npm answered the audit at all, which is the only thing a retry can
 * change. Decided on the presence of `auditReportVersion`, never on an error
 * string: #920 saw a 503, a network timeout and a hang for the same outage,
 * and npm's failure payload (`{ message, error }`) carries no report version
 * at all. A report of a version this script cannot read is still an answer,
 * and asking again returns the same one.
 */
export function isAuditAnswer(value) {
  return isObject(value) && value.auditReportVersion !== undefined
}

/** Whether `npm audit --json` produced a report this script can read. */
export function isAuditReport(value) {
  return isAuditAnswer(value) && value.auditReportVersion === 2 && isObject(value.vulnerabilities)
}

/** Whether `npm view electron dist-tags --json` produced the tags. */
export function isDistTags(value) {
  return isObject(value) && parseVersion(value.latest) !== undefined
}

/**
 * `major.minor.patch[-prerelease]`, or undefined. Hand-rolled because this
 * script must run on a bare lockfile, before any dependency is installed.
 */
export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(
    typeof version === 'string' ? version : ''
  )
  if (!match) return undefined
  return { major: +match[1], minor: +match[2], patch: +match[3], prerelease: match[4] ?? '' }
}

function isOlder(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key]
  }
  // A prerelease sorts before the release of the same number.
  if (a.prerelease === b.prerelease) return false
  if (!a.prerelease) return false
  if (!b.prerelease) return true
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true }) < 0
}

/**
 * Splits npm's entry for `electron` into the advisories filed against the
 * package itself, deduplicated by GHSA id (npm lists one advisory several
 * times when it covers several ranges), and the names of dependencies it is
 * flagged through. Returns undefined when npm flags electron in a shape this
 * script does not understand, so the caller fails closed instead of passing.
 *
 * @param {{ vulnerabilities: Record<string, unknown> }} audit a report accepted by isAuditReport
 * @returns {{ advisories: { id: string, severity: string, title: string, range: string }[], viaDependencies: string[] } | undefined}
 */
export function electronAdvisories(audit) {
  const entry = audit.vulnerabilities.electron
  if (entry === undefined) return { advisories: [], viaDependencies: [] }
  if (!isObject(entry) || !Array.isArray(entry.via)) return undefined

  const advisories = new Map()
  const viaDependencies = []
  for (const via of entry.via) {
    // A string names a vulnerable dependency, which has its own entry in the
    // report. Only an object is an advisory against electron itself.
    if (typeof via === 'string') {
      viaDependencies.push(via)
      continue
    }
    if (!isObject(via)) return undefined
    const url = typeof via.url === 'string' ? via.url : ''
    const id = GHSA_IN_URL.exec(url)?.[0] ?? `npm advisory ${via.source}`
    advisories.set(id.toLowerCase(), {
      id,
      severity: via.severity ?? 'unknown',
      title: via.title ?? '',
      range: via.range ?? ''
    })
  }
  return { advisories: [...advisories.values()], viaDependencies }
}

function validateAccepted(accepted) {
  const valid = new Map()
  const invalid = new Set()
  const problems = []

  if (!Array.isArray(accepted)) {
    problems.push(`${ACCEPTED_FILE} must hold an "accepted" list (an empty one is fine)`)
    return { valid, invalid, problems }
  }

  accepted.forEach((entry, index) => {
    const id = isObject(entry) && typeof entry.id === 'string' ? entry.id : ''
    const faults = []
    if (!GHSA_ID.test(id)) faults.push('an "id" that is a GHSA identifier')
    // Whitespace is not a reason. Checking only for the key would let `""`
    // buy an exemption without anything looking different in review.
    if (!isObject(entry) || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      faults.push('a non-empty "reason"')
    }
    if (!isObject(entry) || !Number.isInteger(entry.issue) || entry.issue <= 0) {
      faults.push('an "issue" number')
    }

    if (faults.length > 0) {
      problems.push(
        `${ACCEPTED_FILE}: entry ${index + 1}${id ? ` (${id})` : ''} needs ${faults.join(', ')}\n` +
          `  an accepted risk without its reason and issue is a silent pass, which this gate exists to prevent`
      )
      if (id) invalid.add(id.toLowerCase())
      return
    }
    valid.set(id.toLowerCase(), entry)
  })

  return { valid, invalid, problems }
}

function describeAuditFailure(audit) {
  if (audit === undefined) return 'npm audit printed no JSON'
  const message = isObject(audit) ? (audit.message ?? audit.error?.summary) : undefined
  return `npm audit returned no report${message ? `: ${message}` : ''}`
}

// The remedy is part of the message because in Actions the annotation is all
// most readers see, and "re-run" is the instinct this one has to stop.
const UPDATE_THE_SCRIPT =
  'npm answered, so re-running will not help: update scripts/auditShippedRuntime.mjs to read it'

function describeUnreadableReport(audit) {
  const shape =
    audit.auditReportVersion === 2
      ? 'a version 2 report without a vulnerabilities map'
      : `report version ${JSON.stringify(audit.auditReportVersion)}`
  return `npm audit returned ${shape}, which this script does not understand\n  ${UPDATE_THE_SCRIPT}`
}

function describeDistTagsFailure(distTags) {
  if (distTags === undefined) return 'npm view electron dist-tags printed no JSON'
  const message = isObject(distTags) ? distTags.error?.summary : undefined
  return `npm view electron dist-tags returned no usable "latest" tag${message ? `: ${message}` : ''}`
}

/**
 * The whole decision, pure: every input is already fetched and parsed, so the
 * rules can be tested without npm, a registry or a lockfile.
 *
 * @param {object} input
 * @param {unknown} input.audit parsed `npm audit --json`, or undefined if unparseable
 * @param {unknown} input.electronVersion `packages["node_modules/electron"].version` from package-lock.json
 * @param {unknown} input.distTags parsed `npm view electron dist-tags --json`, or undefined
 * @param {unknown} input.accepted the `accepted` list from runtime-audit-accepted.json
 * @returns {{ exitCode: 0 | 1 | 2, errors: string[], unchecked: string[], unreadable: string[], warnings: string[], report: string[] }}
 *   `unchecked` is npm giving no answer (an outage, which a re-run may clear),
 *   `unreadable` is an answer this script cannot read (which a re-run only
 *   repeats). exitCode 1 when anything in `errors`, else 2 when anything in
 *   `unchecked` or `unreadable`, else 0.
 */
export function evaluateRuntimeAudit({ audit, electronVersion, distTags, accepted }) {
  const errors = []
  const unchecked = []
  const unreadable = []
  const warnings = []
  const report = []

  const { valid, invalid, problems } = validateAccepted(accepted)
  errors.push(...problems)

  const installed = parseVersion(electronVersion)
  if (installed) {
    report.push(`electron ${electronVersion}, as locked in package-lock.json`)
  } else {
    errors.push(
      `package-lock.json has no usable node_modules/electron version (${JSON.stringify(electronVersion)})\n` +
        `  this gate judges the lockfile that gets packaged, so it cannot pass without one`
    )
  }

  const found = isAuditReport(audit) ? electronAdvisories(audit) : undefined
  if (!isAuditAnswer(audit)) {
    unchecked.push(describeAuditFailure(audit))
  } else if (!isAuditReport(audit)) {
    unreadable.push(describeUnreadableReport(audit))
  } else if (found === undefined) {
    unreadable.push(
      `npm audit flags electron in a shape this script does not understand\n  ${UPDATE_THE_SCRIPT}`
    )
  } else {
    if (found.advisories.length === 0) report.push('no advisories filed against electron itself')
    for (const advisory of found.advisories) {
      const line = `[${advisory.severity}] ${advisory.id} ${advisory.title} (affected ${advisory.range})`
      const acceptance = valid.get(advisory.id.toLowerCase())
      if (acceptance) {
        report.push(`accepted: ${line}\n  #${acceptance.issue}: ${acceptance.reason.trim()}`)
        continue
      }
      errors.push(
        `electron ${electronVersion ?? ''} has an advisory that is not accepted: ${line}\n` +
          (invalid.has(advisory.id.toLowerCase())
            ? `  ${ACCEPTED_FILE} lists it, but that entry is invalid (see above)\n`
            : '') +
          `  fix: bump electron out of that range, or accept it in ${ACCEPTED_FILE} with a reason and an issue`
      )
    }
    if (found.viaDependencies.length > 0) {
      report.push(
        `npm also flags electron through its dependencies (${found.viaDependencies.join(', ')}): ` +
          'install-time tooling, not the shipped runtime, so out of scope here'
      )
    }

    // Only judged against a real report: with no report, every entry would
    // look stale.
    const reported = new Set(found.advisories.map((advisory) => advisory.id.toLowerCase()))
    for (const [key, entry] of valid) {
      if (reported.has(key)) continue
      warnings.push(
        `${ACCEPTED_FILE} accepts ${entry.id} (#${entry.issue}), but npm no longer reports it against electron\n` +
          `  delete the entry, so the file cannot turn into a blanket waiver`
      )
    }
  }

  if (!isDistTags(distTags)) {
    unchecked.push(describeDistTagsFailure(distTags))
  } else if (installed) {
    const lineTag = `${installed.major}-x-y`
    const newestPatch = parseVersion(distTags[lineTag])
    if (!newestPatch) {
      warnings.push(
        `npm has no ${lineTag} dist-tag for electron, so whether ${electronVersion} is the newest patch of its line was not checked`
      )
    } else if (isOlder(installed, newestPatch)) {
      warnings.push(
        `electron ${electronVersion} is behind ${distTags[lineTag]}, the newest ${installed.major}.x\n` +
          `  Chromium and V8 fixes ship in patch releases and never appear in npm audit\n` +
          `  fix: bump electron to ^${distTags[lineTag]}`
      )
    } else {
      report.push(`newest ${installed.major}.x is ${distTags[lineTag]}: up to date`)
    }

    // Electron's support policy: "The latest three stable major versions are
    // supported by the Electron team."
    // https://www.electronjs.org/docs/latest/tutorial/electron-timelines#version-support-policy
    // Derived from the `latest` tag rather than a table of dates, because the
    // dates follow Chromium's schedule and move.
    const newestStable = parseVersion(distTags.latest).major
    const supported = [newestStable, newestStable - 1, newestStable - 2]
    if (installed.major < newestStable - 2) {
      warnings.push(
        `Electron ${installed.major} is past end of life: only the newest three stable majors (${supported.join(', ')}) get fixes\n` +
          `  nothing, not even a Chromium security fix, ships for ${installed.major} any more`
      )
    } else if (installed.major <= newestStable) {
      report.push(
        `Electron ${installed.major} is supported (newest stable majors: ${supported.join(', ')})`
      )
    }
  }

  const exitCode = errors.length > 0 ? 1 : unchecked.length > 0 || unreadable.length > 0 ? 2 : 0
  return { exitCode, errors, unchecked, unreadable, warnings, report }
}

/**
 * Runs `run` until `isUsable` accepts its result, at most `attempts` times,
 * and returns the last result either way so the caller can say what failed.
 *
 * @param {() => unknown} run one attempt, returning the parsed npm output
 * @param {(result: unknown) => boolean} isUsable whether that output is an answer rather than an outage
 * @param {{ attempts?: number, sleep?: (ms: number) => Promise<void>, onRetry?: (attempt: number) => void }} [options]
 *   `sleep` is injectable so tests do not wait out the backoff
 */
export async function retryUntilUsable(run, isUsable, options = {}) {
  const { attempts = ATTEMPTS, sleep = defaultSleep, onRetry = () => {} } = options
  let result
  for (let attempt = 1; attempt <= attempts; attempt++) {
    result = run()
    if (isUsable(result) || attempt === attempts) break
    onRetry(attempt)
    await sleep(BACKOFF_MS * attempt)
  }
  return result
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function runNpmJson(args) {
  // One command string with a shell: npm is a .cmd shim on Windows, which Node
  // only starts through a shell, and passing an args array alongside
  // `shell: true` is deprecated (DEP0190) because nothing is escaped. Every
  // argument here is a constant.
  const result = spawnSync(`npm ${args.join(' ')}`, {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  // The exit code is ignored: npm audit exits 1 whenever anything in the tree
  // is flagged, which is always true here. The JSON decides.
  return readNpmJson(result.stdout ?? '')
}

const LABELS = { 0: 'PASS', 1: 'FAIL', 2: 'COULD NOT CHECK' }

// GitHub annotation syntax: %, CR and LF must be escaped or the message ends
// at the first newline.
const annotate = (level, message) =>
  `::${level}::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`

function print(result) {
  const inActions = Boolean(process.env.GITHUB_ACTIONS)
  const log = (level, prefix, message) =>
    console.log(inActions ? annotate(level, message) : `${prefix}: ${message}`)

  console.log('Electron runtime audit (#998)')
  for (const line of result.report) console.log(`  ${line}`)
  for (const message of result.warnings) log('warning', 'WARNING', message)
  for (const message of result.errors) log('error', 'FAIL', message)
  for (const message of result.unchecked) log('error', 'COULD NOT CHECK', message)
  for (const message of result.unreadable) log('error', 'COULD NOT READ', message)

  console.log(`\nResult: ${LABELS[result.exitCode]}`)
  if (result.exitCode === 1) {
    console.log(
      'Bump electron to a release without the advisory, or record why it stays in\n' +
        `${ACCEPTED_FILE}.\n` +
        'In the release workflow, a re-run checks the same tagged commit again: merge\n' +
        'the fix, then move the tag onto it. See "Release runtime audit" in AGENTS.md.'
    )
  } else if (result.exitCode === 2) {
    // Neutral on purpose: a missing lockfile or ERESOLVE also arrives with no
    // report, and #920 rules out telling those apart by their error text.
    if (result.unchecked.length > 0) {
      console.log(
        `npm gave no usable answer after ${ATTEMPTS} attempts (its error is above). This says\n` +
          'nothing about the runtime. A registry or network error clears once the registry\n' +
          'recovers, so re-run then (#920). A local error, such as a missing lockfile,\n' +
          'needs fixing first.'
      )
    }
    if (result.unreadable.length > 0) {
      console.log(
        'npm answered in a form this script cannot read (see above), so a re-run returns\n' +
          'the same answer: update scripts/auditShippedRuntime.mjs.'
      )
    }
  }

  // #920: which outcome happened belongs in the job summary, so a red release
  // run is diagnosable without opening the log.
  if (process.env.GITHUB_STEP_SUMMARY) {
    // Advisory titles carry tags such as `<webview>`, which the summary's
    // Markdown would swallow as HTML.
    const item = (text) => `- ${text.replace(/</g, '&lt;')}`
    const bullets = (title, items) =>
      items.length ? `\n**${title}**\n\n${items.map(item).join('\n')}\n` : ''
    const summary =
      `### Electron runtime audit: ${LABELS[result.exitCode]}\n\n` +
      result.report.map(item).join('\n') +
      '\n' +
      bullets('Failures', result.errors) +
      bullets('Could not check (npm gave no answer)', result.unchecked) +
      bullets('Could not read (npm answered in an unknown form)', result.unreadable) +
      bullets('Warnings', result.warnings)
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
    } catch {
      // The summary is a convenience; the annotations and exit code carry the result.
    }
  }
}

function readLocalJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    return { unreadable: err.message }
  }
}

async function main() {
  const lockfile = readLocalJson(path.join(process.cwd(), 'package-lock.json'))
  const acceptedFile = readLocalJson(path.join(scriptDir, path.basename(ACCEPTED_FILE)))
  // Both still flow into the evaluation, which fails on a missing version or
  // list; this only keeps the underlying read error from being lost.
  if (lockfile.unreadable) console.log(`package-lock.json: ${lockfile.unreadable}`)
  if (acceptedFile.unreadable) console.log(`${ACCEPTED_FILE}: ${acceptedFile.unreadable}`)

  const ask = (what, { args, isAnswer }) =>
    retryUntilUsable(() => runNpmJson(args), isAnswer, {
      onRetry: (attempt) =>
        console.log(`${what}: no usable answer on attempt ${attempt} of ${ATTEMPTS}, retrying`)
    })
  const audit = await ask('npm audit', AUDIT_QUERY)
  const distTags = await ask('npm view', DIST_TAGS_QUERY)

  const result = evaluateRuntimeAudit({
    audit,
    electronVersion: lockfile.packages?.['node_modules/electron']?.version,
    distTags,
    accepted: acceptedFile.accepted
  })
  print(result)
  process.exitCode = result.exitCode
}

// Importing this module for its rules must not run the check. Both sides go
// through realpath because Node resolves junctions and symlinks before it sets
// import.meta.url but leaves process.argv[1] as typed: compared raw, a start
// through a junction skipped main() and exited 0, a silent pass. Not
// `import.meta.main`: it arrived in Node 24.2, engines allows any 24, and
// where it is undefined the check would skip just as silently.
const realPath = (file) => {
  try {
    return fs.realpathSync(file)
  } catch {
    return path.resolve(file)
  }
}
if (process.argv[1] && realPath(process.argv[1]) === realPath(fileURLToPath(import.meta.url))) {
  await main()
}
