import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        exclude: ['dist/**', 'node_modules/**'],
        reporters: ['verbose'],
        setupFiles: ['tests/vitest.setup.ts'],
        globalSetup: ['tests/vitest.global-setup.ts'],
        coverage: {
            provider: 'v8',
            thresholds: {
                statements: 55,
                branches: 50,
                functions: 60,
                lines: 55
            }
        }
    },
});
