import { describe, expect, it, vi } from 'vitest';

import {
    cleanupSmokeArtifacts,
    type SmokeState,
} from './mcp-client.js';

describe('cleanupSmokeArtifacts', () => {
    it('deletes workflow content types even when workflow artifacts were created', async () => {
        const callTool = vi.fn().mockResolvedValue({
            content: [{ text: '{"ok":true}' }],
            isError: false,
        });
        const state: SmokeState = {
            batchItemIds: [],
            workflowDraftItemId: 11,
            workflowTypeId: 22,
            workflowId: 33,
            workflowTransitionId: 44,
            reviewTaskId: 55,
        };

        await cleanupSmokeArtifacts({ callTool }, state);

        expect(callTool).toHaveBeenCalledWith('delete_content_item', { id: 11 });
        expect(callTool).toHaveBeenCalledWith('delete_content_type', { id: 22 });

        const deleteItemCallIndex = callTool.mock.calls.findIndex(
            ([tool]) => tool === 'delete_content_item',
        );
        const deleteTypeCallIndex = callTool.mock.calls.findIndex(
            ([tool]) => tool === 'delete_content_type',
        );

        expect(deleteItemCallIndex).toBeGreaterThanOrEqual(0);
        expect(deleteTypeCallIndex).toBeGreaterThan(deleteItemCallIndex);
    });
});
