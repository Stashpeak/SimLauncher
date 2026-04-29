import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const outdir = path.join(root, '.test-out')
const files = [
  'src/renderer/src/components/settings/saveRace.ts',
  'tests/settingsSaveRace.test.ts',
  'tests/electronApiSurface.test.ts'
]
const testFiles = ['tests/settingsSaveRace.test.ts', 'tests/electronApiSurface.test.ts']

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

for (const file of files) {
  const sourcePath = path.join(root, file)
  const outputPath = path.join(outdir, file).replace(/\.ts$/, '.js')
  const source = await readFile(sourcePath, 'utf8')
  const result = ts.transpileModule(source, {
    fileName: sourcePath,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      sourceMap: false,
      inlineSourceMap: true
    }
  })

  const diagnostics = result.diagnostics?.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  )

  if (diagnostics?.length) {
    const host = {
      getCanonicalFileName: (diagnosticFile) => diagnosticFile,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n'
    }
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host))
    process.exit(1)
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, result.outputText, 'utf8')
}

const compiledTests = testFiles.map((file) => path.join(outdir, file).replace(/\.ts$/, '.js'))

for (const testFile of compiledTests) {
  require(testFile)
}
