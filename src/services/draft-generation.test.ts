import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const responsesCreateMock = vi.fn();
    const openAIMock = vi.fn(function OpenAIMock() {
        return {
            responses: {
                create: responsesCreateMock,
            },
        };
    });

    return {
        responsesCreateMock,
        openAIMock,
    };
});

vi.mock('openai', () => ({
    default: mocks.openAIMock,
}));

import type { DraftGenerationInput, DraftGenerationTargetContentType } from './draft-generation.js';
import { DraftGenerationError, generateDraftData } from './draft-generation.js';

function buildTargetContentType(): DraftGenerationTargetContentType {
    return {
        id: 13,
        name: 'Proposal Draft',
        slug: 'proposal-draft',
        schema: JSON.stringify({
            type: 'object',
            properties: {
                title: { type: 'string' },
                brief: { type: 'string' },
                summary: { type: 'string' },
            },
            required: ['title', 'brief', 'summary'],
            'x-wordclaw-preview': {
                titleField: 'title',
            },
        }),
    };
}

function buildInput(overrides: Partial<DraftGenerationInput> = {}): DraftGenerationInput {
    return {
        domainId: 1,
        formId: 5,
        formSlug: 'proposal-request',
        intakeContentItemId: 88,
        intakeData: {
            requirements: 'Need a proposal',
        },
        targetContentType: buildTargetContentType(),
        agentSoul: 'software-proposal-writer',
        fieldMap: {
            requirements: 'brief',
        },
        defaultData: {
            title: 'Draft proposal',
        },
        provider: {
            type: 'openai',
            model: 'gpt-4o',
            instructions: 'Write a concise proposal draft.',
        },
        providerProvisioning: {
            type: 'openai',
            apiKey: 'tenant-openai-key',
            defaultModel: 'gpt-4.1',
        },
        ...overrides,
    };
}

describe('draft generation service', () => {
    beforeEach(() => {
        mocks.responsesCreateMock.mockReset();
        mocks.openAIMock.mockClear();
        vi.restoreAllMocks();
        process.env.OPENAI_DRAFT_GENERATION_MODEL = 'gpt-4o';
    });

    it('uses OpenAI structured outputs when the provider is configured', async () => {
        mocks.responsesCreateMock.mockResolvedValue({
            id: 'resp_123',
            output_text: JSON.stringify({
                title: 'Model generated title',
                summary: 'Generated summary',
            }),
        });

        const result = await generateDraftData(buildInput());

        expect(mocks.responsesCreateMock).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gpt-4o',
            store: false,
            text: expect.objectContaining({
                format: expect.objectContaining({
                    type: 'json_schema',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            brief: { type: 'string' },
                            summary: { type: 'string' },
                        },
                        required: ['title', 'brief', 'summary'],
                    },
                }),
            }),
        }));
        expect(mocks.openAIMock).toHaveBeenCalledWith({
            apiKey: 'tenant-openai-key',
        });
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.instructions).toContain('software-proposal-writer');
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.instructions).toContain('Write a concise proposal draft.');
        expect(result).toEqual({
            data: {
                title: 'Draft proposal',
                brief: 'Need a proposal',
                summary: 'Generated summary',
            },
            strategy: 'openai_structured_outputs_v1',
            provider: {
                type: 'openai',
                model: 'gpt-4o',
                responseId: 'resp_123',
            },
        });
    });

    it('uses Anthropic tool-schema output when the provider is configured', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
            JSON.stringify({
                id: 'msg_123',
                content: [
                    {
                        type: 'tool_use',
                        name: 'submit_draft',
                        input: {
                            summary: 'Anthropic generated summary',
                        },
                    },
                ],
            }),
            {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                },
            },
        ));

        const result = await generateDraftData(buildInput({
            provider: {
                type: 'anthropic',
                instructions: 'Keep it concise.',
            },
            providerProvisioning: {
                type: 'anthropic',
                apiKey: 'anthropic-secret',
                defaultModel: 'claude-sonnet-4-20250514',
            },
        }));

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.anthropic.com/v1/messages',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'x-api-key': 'anthropic-secret',
                    'anthropic-version': '2023-06-01',
                }),
            }),
        );
        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(requestBody.model).toBe('claude-sonnet-4-20250514');
        expect(requestBody.tool_choice).toEqual({
            type: 'tool',
            name: 'submit_draft',
        });
        expect(requestBody.tools[0]).toEqual(expect.objectContaining({
            name: 'submit_draft',
            input_schema: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    brief: { type: 'string' },
                    summary: { type: 'string' },
                },
                required: ['title', 'brief', 'summary'],
            },
        }));
        expect(result).toEqual({
            data: {
                title: 'Draft proposal',
                brief: 'Need a proposal',
                summary: 'Anthropic generated summary',
            },
            strategy: 'anthropic_tool_schema_v1',
            provider: {
                type: 'anthropic',
                model: 'claude-sonnet-4-20250514',
                responseId: 'msg_123',
            },
        });
    });

    it('uses Gemini structured JSON output when the provider is configured', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
            JSON.stringify({
                responseId: 'gemini_123',
                candidates: [
                    {
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify({
                                        summary: 'Gemini generated summary',
                                    }),
                                },
                            ],
                        },
                    },
                ],
            }),
            {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                },
            },
        ));

        const result = await generateDraftData(buildInput({
            provider: {
                type: 'gemini',
                model: 'gemini-2.5-flash',
                instructions: 'Keep it concise.',
            },
            providerProvisioning: {
                type: 'gemini',
                apiKey: 'gemini-secret',
                defaultModel: null,
            },
        }));

        expect(fetchMock).toHaveBeenCalledWith(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'x-goog-api-key': 'gemini-secret',
                }),
            }),
        );
        const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
        expect(requestBody.generationConfig).toEqual(expect.objectContaining({
            responseMimeType: 'application/json',
            responseJsonSchema: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    brief: { type: 'string' },
                    summary: { type: 'string' },
                },
                required: ['title', 'brief', 'summary'],
            },
        }));
        expect(result).toEqual({
            data: {
                title: 'Draft proposal',
                brief: 'Need a proposal',
                summary: 'Gemini generated summary',
            },
            strategy: 'gemini_structured_outputs_v1',
            provider: {
                type: 'gemini',
                model: 'gemini-2.5-flash',
                responseId: 'gemini_123',
            },
        });
    });

    it('fails clearly when the tenant has not provisioned the requested provider', async () => {
        await expect(generateDraftData(buildInput({
            provider: {
                type: 'openai',
            },
            providerProvisioning: null,
        }))).rejects.toMatchObject({
            code: 'DRAFT_GENERATION_PROVIDER_NOT_PROVISIONED',
        } satisfies Partial<DraftGenerationError>);
    });

    it('requires an explicit Anthropic or Gemini model before making a request', async () => {
        await expect(generateDraftData(buildInput({
            provider: {
                type: 'anthropic',
            },
            providerProvisioning: {
                type: 'anthropic',
                apiKey: 'anthropic-secret',
                defaultModel: null,
            },
        }))).rejects.toMatchObject({
            code: 'DRAFT_GENERATION_PROVIDER_MODEL_REQUIRED',
        } satisfies Partial<DraftGenerationError>);

        await expect(generateDraftData(buildInput({
            provider: {
                type: 'gemini',
            },
            providerProvisioning: {
                type: 'gemini',
                apiKey: 'gemini-secret',
                defaultModel: null,
            },
        }))).rejects.toMatchObject({
            code: 'DRAFT_GENERATION_PROVIDER_MODEL_REQUIRED',
        } satisfies Partial<DraftGenerationError>);
    });
});
