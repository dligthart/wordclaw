import { describe, expect, it } from 'vitest';

import {
    AgentRunServiceError,
    isAgentRunControlAction,
    isAgentRunStatus,
    resolveAgentRunTransition
} from './agent-runs.js';

describe('AgentRun transition resolver', () => {
    it('approves waiting_approval into running', () => {
        expect(resolveAgentRunTransition('waiting_approval', 'approve', false)).toBe('running');
    });

    it('pauses running into waiting_approval', () => {
        expect(resolveAgentRunTransition('running', 'pause', true)).toBe('waiting_approval');
    });

    it('resumes paused run to queued when not started yet', () => {
        expect(resolveAgentRunTransition('waiting_approval', 'resume', false)).toBe('queued');
    });

    it('resumes paused run back to running when already started', () => {
        expect(resolveAgentRunTransition('waiting_approval', 'resume', true)).toBe('running');
    });

    it('cancels non-terminal states', () => {
        expect(resolveAgentRunTransition('queued', 'cancel', false)).toBe('cancelled');
    });

    it('rejects invalid transitions with deterministic codes', () => {
        expect(() => resolveAgentRunTransition('queued', 'approve', false)).toThrowError(AgentRunServiceError);

        try {
            resolveAgentRunTransition('queued', 'approve', false);
        } catch (error) {
            expect(error).toBeInstanceOf(AgentRunServiceError);
            expect((error as AgentRunServiceError).code).toBe('AGENT_RUN_INVALID_TRANSITION');
        }
    });

    it('rejects cancelling already terminal succeeded runs', () => {
        try {
            resolveAgentRunTransition('succeeded', 'cancel', true);
            throw new Error('Expected transition to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(AgentRunServiceError);
            expect((error as AgentRunServiceError).code).toBe('AGENT_RUN_INVALID_TRANSITION');
        }
    });
});

describe('AgentRun guards', () => {
    it('validates known statuses and actions', () => {
        expect(isAgentRunStatus('running')).toBe(true);
        expect(isAgentRunStatus('unknown')).toBe(false);
        expect(isAgentRunControlAction('pause')).toBe(true);
        expect(isAgentRunControlAction('launch')).toBe(false);
    });
});
