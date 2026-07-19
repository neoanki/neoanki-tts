import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/{config,generation,media,providers,text,worker}.ts'],
      // The worker and provider boundary are deliberately included even though
      // they lower aggregate percentages; this gate must track the risky code.
      thresholds: { lines: 85, functions: 82, statements: 73, branches: 57 },
    },
  },
})
