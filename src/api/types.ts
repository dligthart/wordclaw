import { Type, Static, TSchema } from '@sinclair/typebox';

export const ActionPriority = Type.Union([
    Type.Literal('low'),
    Type.Literal('medium'),
    Type.Literal('high'),
    Type.Literal('critical')
]);

export const AIResponseMeta = Type.Object({
    recommendedNextAction: Type.Optional(Type.String({ description: 'The most logical next step for the agent' })),
    availableActions: Type.Array(Type.String(), { description: 'List of all possible actions from this state' }),
    actionPriority: ActionPriority,
    cost: Type.Optional(Type.Number({ description: 'Estimated complexity/cost of the operation' })),
    documentationUrl: Type.Optional(Type.String({ format: 'uri' })),
    dryRun: Type.Optional(Type.Boolean({ description: 'Indicates if the operation was simulated' }))
});

export const DryRunQuery = Type.Object({
    mode: Type.Optional(Type.Literal('dry_run'))
});

export const AIErrorResponse = Type.Object({
    error: Type.String(),
    code: Type.String(),
    remediation: Type.String({ description: 'Specific instructions for the AI agent to fix this error' }),
    context: Type.Optional(Type.Any())
});

export type AIResponseMetaType = Static<typeof AIResponseMeta>;
export type AIErrorResponseType = Static<typeof AIErrorResponse>;

export function createAIResponse<T extends TSchema>(schema: T) {
    return Type.Object({
        data: schema,
        meta: AIResponseMeta
    });
}
