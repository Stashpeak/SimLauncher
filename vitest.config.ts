import { defineConfig } from 'vitest/config'

const rendererTests = ['tests/settingsSaveRace.test.ts', 'tests/renderer/**/*.test.ts']
const mainProcessTests = ['tests/electronApiSurface.test.ts', 'tests/main/**/*.test.ts']

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: rendererTests
        }
      },
      {
        test: {
          name: 'main',
          environment: 'node',
          include: mainProcessTests
        }
      }
    ]
  }
})
