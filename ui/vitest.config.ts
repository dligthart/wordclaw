import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
    plugins: [sveltekit()],
    test: {
        include: ['src/**/*.{test,spec}.{js,ts}'],
        environment: 'jsdom',
        setupFiles: ['./vitest-setup.ts'],
        globals: true,
        coverage: {
            provider: 'v8',
            thresholds: {
                statements: 65,
                branches: 45,
                functions: 65,
                lines: 70
            }
        }
    },
    resolve: {
        conditions: ['mode=test', 'browser']
    }
});
