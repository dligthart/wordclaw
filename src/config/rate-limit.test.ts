import { describe, expect, it } from 'vitest';

import {
    getRateLimitMax,
    getRateLimitTimeWindow,
    getSupervisorRateLimitMax,
    resolveRateLimitKey,
    resolveRateLimitMax,
} from './rate-limit.js';

describe('rate-limit config', () => {
    it('derives supervisor buckets from the supervisor session cookie', () => {
        const key = resolveRateLimitKey({
            headers: {
                cookie: 'theme=dark; supervisor_session=supervisor-token; mode=full',
                'x-api-key': 'writer-key',
            },
            ip: '127.0.0.1',
        });

        expect(key).toMatch(/^supervisor:[0-9a-f]{24}$/);
    });

    it('derives credential buckets from x-api-key headers', () => {
        const key = resolveRateLimitKey({
            headers: {
                'x-api-key': 'writer-key',
            },
            ip: '127.0.0.1',
        });

        expect(key).toMatch(/^credential:[0-9a-f]{24}$/);
    });

    it('derives credential buckets from bearer tokens when no explicit api key is present', () => {
        const key = resolveRateLimitKey({
            headers: {
                authorization: 'Bearer supervisor-api-token',
            },
            ip: '127.0.0.1',
        });

        expect(key).toMatch(/^credential:[0-9a-f]{24}$/);
    });

    it('falls back to ip buckets when no actor credential is present', () => {
        expect(resolveRateLimitKey({
            headers: {},
            ip: '10.0.0.4',
        })).toBe('ip:10.0.0.4');
    });

    it('uses secure defaults and allows environment overrides', () => {
        expect(getRateLimitMax({} as NodeJS.ProcessEnv)).toBe(100);
        expect(getSupervisorRateLimitMax({} as NodeJS.ProcessEnv)).toBe(500);
        expect(getRateLimitTimeWindow({} as NodeJS.ProcessEnv)).toBe('1 minute');
        expect(getRateLimitMax({ RATE_LIMIT_MAX: '240' } as NodeJS.ProcessEnv)).toBe(240);
        expect(getSupervisorRateLimitMax({
            RATE_LIMIT_MAX: '240',
            SUPERVISOR_RATE_LIMIT_MAX: '800',
        } as NodeJS.ProcessEnv)).toBe(800);
        expect(getRateLimitTimeWindow({ RATE_LIMIT_TIME_WINDOW: '2 minutes' } as NodeJS.ProcessEnv)).toBe('2 minutes');
    });

    it('assigns a higher limit to supervisor buckets', () => {
        const env = {
            RATE_LIMIT_MAX: '120',
            SUPERVISOR_RATE_LIMIT_MAX: '420',
        } as NodeJS.ProcessEnv;

        expect(resolveRateLimitMax('credential:abc', env)).toBe(120);
        expect(resolveRateLimitMax('supervisor:def', env)).toBe(420);
    });
});
