import { afterEach, describe, expect, it } from 'vitest';

import {
    issueExternalFeedbackToken,
    verifyExternalFeedbackToken,
} from './external-feedback-token.js';

const originalExternalFeedbackSecret = process.env.EXTERNAL_FEEDBACK_TOKEN_SECRET;
const originalExternalFeedbackTtl = process.env.EXTERNAL_FEEDBACK_TOKEN_TTL_SECONDS;

function restoreEnv() {
    if (originalExternalFeedbackSecret === undefined) {
        delete process.env.EXTERNAL_FEEDBACK_TOKEN_SECRET;
    } else {
        process.env.EXTERNAL_FEEDBACK_TOKEN_SECRET = originalExternalFeedbackSecret;
    }

    if (originalExternalFeedbackTtl === undefined) {
        delete process.env.EXTERNAL_FEEDBACK_TOKEN_TTL_SECONDS;
    } else {
        process.env.EXTERNAL_FEEDBACK_TOKEN_TTL_SECONDS = originalExternalFeedbackTtl;
    }
}

describe('external feedback tokens', () => {
    afterEach(() => {
        restoreEnv();
    });

    it('issues and verifies a scoped external feedback token', () => {
        process.env.EXTERNAL_FEEDBACK_TOKEN_SECRET = 'external-feedback-secret';
        process.env.EXTERNAL_FEEDBACK_TOKEN_TTL_SECONDS = '120';

        const issued = issueExternalFeedbackToken({
            domainId: 7,
            contentItemId: 42,
            actorId: 'proposal-contact:123',
            actorSource: 'proposal_portal',
            actorDisplayName: 'Jane Smith',
            actorEmail: 'jane@client.com',
            allowAgentDirect: true,
            workflowTransitionId: 90,
        });

        expect(verifyExternalFeedbackToken(issued.token)).toEqual(
            expect.objectContaining({
                ok: true,
                domainId: 7,
                contentItemId: 42,
                actorId: 'proposal-contact:123',
                actorType: 'external_requester',
                actorSource: 'proposal_portal',
                actorDisplayName: 'Jane Smith',
                actorEmail: 'jane@client.com',
                allowAgentDirect: true,
                workflowTransitionId: 90,
            }),
        );
    });

    it('rejects malformed external feedback tokens', () => {
        process.env.EXTERNAL_FEEDBACK_TOKEN_SECRET = 'external-feedback-secret';

        expect(verifyExternalFeedbackToken('not-a-token')).toEqual({
            ok: false,
            code: 'INVALID_EXTERNAL_FEEDBACK_TOKEN',
            remediation: 'Provide a valid external feedback token issued by POST /api/content-items/:id/external-feedback-token.'
        });
    });
});
