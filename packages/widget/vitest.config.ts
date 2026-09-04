import { defineConfig } from 'vitest/config'

export default defineConfig({
  // What `build.mjs` sets per bundle. The tests exercise the build that is
  // allowed to fetch a runtime; without this the identifier is undefined at
  // runtime and every call test fails on a reference error rather than on
  // anything it meant to check.
  define: { __RECOURSE_FETCH_RUNTIME__: 'true' },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
  },
})
