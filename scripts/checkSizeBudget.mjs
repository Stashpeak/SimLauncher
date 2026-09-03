#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { countCodeLines } from './countCodeLines.mjs'

// Fails the build when a file that is already large gets larger. See #918.
//
// This is NOT a size limit and the current ceilings are NOT an endorsement:
// 569 code lines in GameRow.tsx is not fine, the ceiling only stops 570.
// Lowering the numbers is the job of the refactor issues (#530, #775, #776,
// #396), and a refactor PR is expected to drop its file's number by hand.
//
// Why it exists: consolidation has been done here before and did not hold.
// GameRow.tsx was cut to 403 lines by #340 in the 0.9.8 "Refactor & Testing"
// milestone and is back over 800; spawn.ts went 509 -> 728 -> 1317 while two
// issues sat open about that exact growth. Nothing noticed for months. Every
// one of those cases is caught by a plain upper bound on the first added line.
//
// Raising a ceiling is allowed and deliberately easy: edit the one number. The
// point is not to forbid growth, it is to make growth appear in a diff where a
// reviewer sees it, instead of surfacing four months later.
//
// A downward ratchet was designed and rejected as unproven need; the reasoning
// and the trigger to revisit it are recorded on #918.

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const budgetPath = path.join(scriptDir, 'size-budget.json')

/** Repo-relative, forward-slashed, so Windows and Linux produce the same keys. */
export function toPosix(relativePath) {
  return relativePath.split(/[\\/]/).join('/')
}

/**
 * Every violation in one pass, as readable strings.
 *
 * Pure on purpose: `files`, the config and `codeLinesFor` are all injected, so
 * the rules can be tested without a repo, a git checkout or the filesystem.
 */
export function evaluateBudget({ files, config, codeLinesFor }) {
  const threshold = config.thresholdCodeLines
  const budgets = config.budgets ?? {}
  const exclusions = config.exclusions ?? {}

  if (!Number.isInteger(threshold) || threshold <= 0) {
    return ['size-budget.json: thresholdCodeLines must be a positive integer']
  }

  const present = new Set(files.map(toPosix))
  const violations = []

  // Config rot first: a stale entry means the gate is measuring something that
  // no longer exists, and silently dropping it is how a budget stops covering
  // the file it was written for.
  for (const file of Object.keys(budgets)) {
    if (!present.has(file)) {
      violations.push(
        `stale budget entry: ${file}\n` +
          `  no such tracked file under src/\n` +
          `  fix: remove the entry, or correct the path if the file moved`
      )
    }
    if (Object.hasOwn(exclusions, file)) {
      violations.push(
        `${file} is both budgeted and excluded\n` +
          `  fix: keep one. An excluded file is not measured, so a budget on it is dead config`
      )
    }
  }

  for (const file of Object.keys(exclusions)) {
    if (!present.has(file)) {
      violations.push(
        `stale exclusion: ${file}\n` +
          `  no such tracked file under src/\n` +
          `  fix: remove the entry, or correct the path if the file moved`
      )
    }
  }

  for (const file of [...present].sort()) {
    if (Object.hasOwn(exclusions, file)) continue

    const budget = budgets[file]

    if (budget !== undefined && (!Number.isInteger(budget) || budget < 0)) {
      violations.push(
        `${file} has a non-integer budget (${JSON.stringify(budget)})\n` +
          `  fix: set it to a whole number of code lines`
      )
      continue
    }

    const code = codeLinesFor(file)

    if (budget === undefined) {
      // A file only needs an entry once it crosses the threshold. Below it,
      // files are unlisted and unconstrained.
      if (code >= threshold) {
        violations.push(
          `${file} is new above the threshold: ${code} code lines (threshold ${threshold})\n` +
            `  fix: add "${file}": ${code} to budgets in scripts/size-budget.json,\n` +
            `       or add it to exclusions with a reason if it is generated or data`
        )
      }
      continue
    }

    // Deliberately no lower bound. A tracked file that shrinks is fine and
    // stays tracked, so it cannot quietly climb back toward the threshold.
    if (code > budget) {
      violations.push(
        `${file} grew past its budget: ${code} code lines, budget ${budget} (+${code - budget})\n` +
          `  fix: reduce the file, or raise the number in scripts/size-budget.json\n` +
          `       in this PR so the growth is visible in review`
      )
    }
  }

  return violations
}

function listSourceFiles() {
  const output = execFileSync('git', ['ls-files', '-z', 'src'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })

  return output
    .split('\0')
    .filter(Boolean)
    .map(toPosix)
    .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
    .sort()
}

function main() {
  const config = JSON.parse(fs.readFileSync(budgetPath, 'utf8'))
  const files = listSourceFiles()

  const violations = evaluateBudget({
    files,
    config,
    codeLinesFor: (file) => countCodeLines(path.join(repoRoot, file)).code
  })

  if (violations.length > 0) {
    console.error(`\nCode-line budget: ${violations.length} problem(s).\n`)
    for (const violation of violations) console.error(`  ${violation}\n`)
    console.error(
      `These budgets are a stop against growth, not a verdict on the current sizes.\n` +
        `Raising one is a normal thing to do; doing it in the diff is the point. See #918.\n`
    )
    process.exit(1)
  }

  console.log(
    `Code-line budget: ${Object.keys(config.budgets ?? {}).length} tracked file(s) within budget.`
  )
}

// Importing this module for its rules must not run the check.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
