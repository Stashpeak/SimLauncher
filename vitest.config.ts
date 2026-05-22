import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const rendererTests = [
  'tests/settingsSaveRace.test.ts',
  'tests/renderer/**/*.test.ts',
  'tests/renderer/**/*.test.tsx'
]
const mainProcessTests = ['tests/electronApiSurface.test.ts', 'tests/main/**/*.test.ts']

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: { name: 'renderer', environment: 'jsdom', include: rendererTests, pool: 'vmThreads' }
      },
      {
        test: {
          name: 'main',
          environment: 'node',
          include: mainProcessTests,
          alias: {
            electron: fileURLToPath(new URL('./tests/main/electronMock.ts', import.meta.url))
          },
          pool: 'vmThreads'
        }
      }
    ]
  }
})
