import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Guards the parsing and scoping logic inside `.github/workflows/pr-smoke-note.yml`.
 *
 * The script is extracted from the YAML at test time rather than copied here, so
 * these cases cannot drift from what CI actually runs: editing the workflow and
 * forgetting the test is the failure mode this is built to prevent, and a copied
 * script would silently pass while the real one broke.
 */

const repoFile = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8')

const WORKFLOW = repoFile('.github/workflows/pr-smoke-note.yml')
const TEMPLATE = repoFile('.github/pull_request_template.md')

const SCRIPT = (() => {
  const marker = '          script: |\n'
  const start = WORKFLOW.indexOf(marker)
  if (start === -1) {
    throw new Error(
      'Could not find the `script: |` block in pr-smoke-note.yml. If the workflow was ' +
        'restructured, update this extractor rather than deleting the test.'
    )
  }
  return WORKFLOW.slice(start + marker.length)
    .split(/\r?\n/)
    .map((line) => (line.startsWith('            ') ? line.slice(12) : line))
    .join('\n')
})()

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<void>

interface RunInput {
  body: string
  files?: string[]
  title?: string
}

/** Runs the real workflow script and returns the failure message, or null on pass. */
async function run({
  body,
  files = ['src/main/index.ts'],
  title = 'fix: something (#1)'
}: RunInput): Promise<string | null> {
  let failure: string | null = null
  const core = {
    setFailed: (message: string) => {
      failure = message
    },
    info: () => {}
  }
  const github = {
    paginate: async () => files.map((filename) => ({ filename })),
    rest: { pulls: { listFiles: 'listFiles' } }
  }
  const context = {
    repo: { owner: 'Stashpeak', repo: 'SimLauncher' },
    payload: { pull_request: { body, number: 1, title } }
  }
  await new AsyncFunction('core', 'context', 'github', SCRIPT)(core, context, github)
  return failure
}

const tick = (body: string, marker: string): string =>
  body
    .split(/\r?\n/)
    .map((line) => (line.includes(marker) ? line.replace(/\[ \]/, '[x]') : line))
    .join('\n')

const answer = (body: string, marker: string, text: string): string =>
  body
    .split(/\r?\n/)
    .map((line) => (line.includes(marker) ? `${line.replace(/\s*$/, '')} ${text}` : line))
    .join('\n')

const filled = (marker: string, text: string): string =>
  answer(tick(TEMPLATE, marker), marker, text)

const dropOption = (body: string, marker: string): string =>
  body
    .split(/\r?\n/)
    .filter((line) => !line.includes(marker))
    .join('\n')

const AUTO_CLOSES = '\n\n<!-- auto-closes -->\nCloses #123\n<!-- auto-closes -->'
const SRC = ['src/renderer/src/components/GameList.tsx', 'tests/renderer/GameList.test.tsx']

describe('pr-smoke-note gate', () => {
  describe('in scope, a declaration is required', () => {
    it.each([
      ['the template is untouched', { body: TEMPLATE, files: SRC }],
      ['the section was deleted', { body: '## Summary\n\nrenamed a var\n', files: SRC }],
      ['the body is empty', { body: '', files: SRC }],
      [
        'both boxes are ticked',
        {
          body: answer(tick(tick(TEMPLATE, 'smoke:none'), 'smoke:check'), 'smoke:none', 'x'),
          files: SRC
        }
      ],
      ['"needs none" is ticked with no reason', { body: tick(TEMPLATE, 'smoke:none'), files: SRC }],
      [
        '"needs a check" is ticked with no text',
        { body: tick(TEMPLATE, 'smoke:check'), files: SRC }
      ]
    ])('fails when %s', async (_name, input) => {
      expect(await run(input)).not.toBeNull()
    })

    it.each([
      ['packaging', ['electron-builder.yml']],
      ['a dependency bump', ['package.json']],
      ['build scripts', ['scripts/generate.mjs']],
      ['one src file among exempt ones', ['tests/a.test.ts', 'README.md', 'src/main/kill.ts']]
    ])('treats %s as in scope', async (_name, files) => {
      expect(await run({ body: TEMPLATE, files })).not.toBeNull()
    })
  })

  describe('in scope, a filled declaration passes', () => {
    it.each([
      [
        '"needs none" with a reason',
        filled('smoke:none', 'internal refactor, nothing reaches the UI')
      ],
      [
        '"needs a check" with instructions',
        filled('smoke:check', 'Launch a profile; the strip shows companions only.')
      ],
      [
        'the answer written on the following line',
        tick(TEMPLATE, 'smoke:check').replace(
          /(<!-- smoke:check -->.*)$/m,
          '$1\n      Change the accent, restart, it must persist.'
        )
      ],
      ['a CRLF body', filled('smoke:none', 'refactor').replace(/\n/g, '\r\n')],
      ['asterisk bullets', filled('smoke:none', 'refactor').replace(/^- \[/gm, '* [')],
      ['an uppercase [X]', filled('smoke:none', 'refactor').replace('[x]', '[X]')]
    ])('passes with %s', async (_name, body) => {
      expect(await run({ body, files: SRC })).toBeNull()
    })

    it('survives the auto-closes block that sync-pr-closes.yml appends', async () => {
      expect(
        await run({ body: filled('smoke:none', 'CI only') + AUTO_CLOSES, files: SRC })
      ).toBeNull()
    })

    it('accepts a body where the unchosen option was deleted', async () => {
      const body = dropOption(filled('smoke:check', 'Launch a profile and close it.'), 'smoke:none')
      expect(body).not.toContain('smoke:none')
      expect(await run({ body, files: SRC })).toBeNull()
    })

    it('still fails when the only remaining option is unticked', async () => {
      const body = dropOption(TEMPLATE, 'smoke:none')
      expect(await run({ body, files: SRC })).not.toBeNull()
    })
  })

  describe('out of scope, nothing is asked', () => {
    it.each([
      ['tests only', ['tests/main/kill.test.ts']],
      ['docs only', ['README.md', 'CHANGELOG.md']],
      ['CI only', ['.github/workflows/ci.yml']],
      ['tsconfig only', ['tsconfig.json']],
      ['editor and tooling dotfiles', ['.gitignore', '.prettierrc.json', '.vscode/settings.json']],
      ['a mix of exempt paths', ['tests/main/a.test.ts', 'docs/x.md', '.github/dependabot.yml']]
    ])('passes an untouched template for %s', async (_name, files) => {
      expect(await run({ body: TEMPLATE, files })).toBeNull()
    })
  })

  describe('release PRs', () => {
    it('are exempt, because their check is the smoke run that precedes the tag', async () => {
      const result = await run({
        body: TEMPLATE,
        files: ['package.json', 'package-lock.json'],
        title: 'chore(release): v1.2.1'
      })
      expect(result).toBeNull()
    })
  })

  describe('the template itself', () => {
    it('carries both markers as unticked checkboxes', () => {
      for (const marker of ['smoke:none', 'smoke:check']) {
        const line = TEMPLATE.split(/\r?\n/).find((l) => l.includes(marker))
        expect(line, `template is missing ${marker}`).toBeDefined()
        expect(line).toMatch(/^\s*[-*]\s*\[ \]/)
      }
    })

    it('keeps the sections the template had before the smoke block was added', () => {
      for (const heading of ['## What does this PR do?', '## Checklist', '## Screenshots']) {
        expect(TEMPLATE).toContain(heading)
      }
      expect(TEMPLATE.startsWith('Closes #')).toBe(true)
    })
  })
})
