import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
    plugins: [sveltekit()],
    test: {
        include: ['src/**/*.{test,spec}.{js,ts}'],
        environment: 'jsdom',
        setupFiles: ['./vitest-setup.ts'],
        globals: true
    },
    resolve: {
        conditions: ['mode=test', 'browser']
    }
});
