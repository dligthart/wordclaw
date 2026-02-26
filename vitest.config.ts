import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        exclude: ['dist/**', 'node_modules/**'],
        reporters: ['verbose'],
    },
});
