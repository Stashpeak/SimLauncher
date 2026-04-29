import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

const rendererTests = ['tests/settingsSaveRace.test.ts', 'tests/renderer/**/*.test.ts']
const mainProcessTests = ['tests/electronApiSurface.test.ts', 'tests/main/**/*.test.ts']

function nodeTestCompat(): Plugin {
  return {
    name: 'node-test-compat',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.test.ts') || !code.includes('node:test')) {
        return null
      }

      return code.replace(
        /import\s+test\s+from\s+['"]node:test['"]/g,
        "import { test } from 'vitest'"
      )
    }
  }
}

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [nodeTestCompat()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: rendererTests
        }
      },
      {
        plugins: [nodeTestCompat()],
        test: {
          name: 'main',
          environment: 'node',
          include: mainProcessTests
        }
      }
    ]
  }
})
