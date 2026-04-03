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

function buildTargetContentTypeWithOptionalField(): DraftGenerationTargetContentType {
    return {
        id: 14,
        name: 'Proposal Draft (optional field)',
        slug: 'proposal-draft-optional',
        schema: JSON.stringify({
            type: 'object',
            properties: {
                title: { type: 'string' },
                brief: { type: 'string' },
                summary: { type: 'string' },
                company: { type: 'string' },
            },
            required: ['title', 'brief', 'summary'],
            'x-wordclaw-preview': {
                titleField: 'title',
            },
        }),
    };
}

function buildProposalTargetContentType(): DraftGenerationTargetContentType {
    return {
        id: 15,
        name: 'Generated Proposal',
        slug: 'generated-proposal',
        schema: JSON.stringify({
            type: 'object',
            properties: {
                title: { type: 'string' },
                recommendedApproach: { type: 'string' },
                deliveryPlan: { type: 'string' },
                assumptions: { type: 'string' },
                nextSteps: { type: 'string' },
            },
            required: ['title', 'recommendedApproach', 'deliveryPlan', 'assumptions', 'nextSteps'],
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

function buildInlineAttachments() {
    return [
        {
            assetId: 7,
            path: '/attachment',
            filename: 'asset-7.png',
            originalFilename: 'brief.png',
            mimeType: 'image/png',
            sizeBytes: 2048,
            accessMode: 'signed' as const,
            inlineImageDataUrl: 'data:image/png;base64,AAA=',
            inlineImageBase64: 'AAA=',
        },
        {
            assetId: 8,
            path: '/supportingDoc',
            filename: 'asset-8.pdf',
            originalFilename: 'spec.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 4096,
            accessMode: 'entitled' as const,
            inlineImageDataUrl: null,
            inlineImageBase64: null,
        },
    ];
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
                        additionalProperties: false,
                    },
                }),
            }),
        }));
        expect(mocks.openAIMock).toHaveBeenCalledWith({
            apiKey: 'tenant-openai-key',
        });
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.instructions).toContain('software-proposal-writer');
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.instructions).toContain('Write a concise proposal draft.');
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.instructions).toContain(
            'Treat deterministic baseline fields as fallback scaffolding, not the final answer.',
        );
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.instructions).toContain(
            'replace generic baseline wording instead of copying it verbatim.',
        );
        expect(result).toEqual({
            data: {
                title: 'Model generated title',
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

    it('includes supervisor revision context when regenerating an existing draft', async () => {
        mocks.responsesCreateMock.mockResolvedValue({
            id: 'resp_revision',
            output_text: JSON.stringify({
                title: 'Updated proposal title',
                brief: 'Reframed brief with explicit delivery risks.',
                summary: 'Updated summary',
            }),
        });

        const result = await generateDraftData(buildInput({
            currentDraftData: {
                title: 'Current proposal title',
                brief: 'Need a proposal',
                summary: 'Current summary',
            },
            revisionPrompt: 'Make the summary more specific about delivery risks.',
        }));

        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.instructions).toContain(
            'Supervisor revision request: Make the summary more specific about delivery risks.',
        );
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.instructions).toContain(
            'Treat the supervisor revision request as a required change request, not a hint.',
        );
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.instructions).toContain(
            'You may revise baseline-derived fields when needed to satisfy the supervisor request.',
        );
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.input?.[0]?.content?.[0]?.text).toContain(
            'Current draft to revise:',
        );
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.input?.[0]?.content?.[0]?.text).toContain(
            '"Current proposal title"',
        );
        expect(result).toEqual({
            data: {
                title: 'Updated proposal title',
                brief: 'Reframed brief with explicit delivery risks.',
                summary: 'Updated summary',
            },
            strategy: 'openai_structured_outputs_v1',
            provider: {
                type: 'openai',
                model: 'gpt-4o',
                responseId: 'resp_revision',
            },
        });
    });

    it('translates optional fields into OpenAI-compatible strict schema and prunes null placeholders', async () => {
        mocks.responsesCreateMock.mockResolvedValue({
            id: 'resp_optional',
            output_text: JSON.stringify({
                title: 'Model generated title',
                summary: 'Generated summary',
                company: null,
            }),
        });

        const result = await generateDraftData(buildInput({
            targetContentType: buildTargetContentTypeWithOptionalField(),
        }));

        expect(mocks.responsesCreateMock).toHaveBeenCalledWith(expect.objectContaining({
            text: expect.objectContaining({
                format: expect.objectContaining({
                    schema: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            brief: { type: 'string' },
                            summary: { type: 'string' },
                            company: { type: ['string', 'null'] },
                        },
                        required: ['title', 'brief', 'summary', 'company'],
                        additionalProperties: false,
                    },
                }),
            }),
        }));
        expect(result).toEqual({
            data: {
                title: 'Model generated title',
                brief: 'Need a proposal',
                summary: 'Generated summary',
            },
            strategy: 'openai_structured_outputs_v1',
            provider: {
                type: 'openai',
                model: 'gpt-4o',
                responseId: 'resp_optional',
            },
        });
    });

    it('passes inline image attachments to OpenAI when available', async () => {
        mocks.responsesCreateMock.mockResolvedValue({
            id: 'resp_attachments',
            output_text: JSON.stringify({
                summary: 'Generated from image attachment',
            }),
        });

        await generateDraftData(buildInput({
            attachments: buildInlineAttachments(),
        }));

        expect(mocks.responsesCreateMock).toHaveBeenCalledWith(expect.objectContaining({
            input: [{
                role: 'user',
                content: [
                    expect.objectContaining({
                        type: 'input_text',
                        text: expect.stringContaining('Referenced image attachments:'),
                    }),
                    expect.objectContaining({
                        type: 'input_image',
                        image_url: 'data:image/png;base64,AAA=',
                        detail: 'auto',
                    }),
                ],
            }],
        }));
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.input?.[0]?.content?.[0]?.text).toContain('brief.png');
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.input?.[0]?.content?.[0]?.text).not.toContain('spec.pdf');
    });

    it('adds richer proposal drafting guidance for proposal-style target schemas', async () => {
        mocks.responsesCreateMock.mockResolvedValue({
            id: 'resp_proposal',
            output_text: JSON.stringify({
                title: 'Tailored proposal title',
                recommendedApproach: 'Detailed solution approach.',
                deliveryPlan: 'Detailed phased plan.',
                assumptions: 'Detailed assumptions.',
                nextSteps: 'Detailed next steps.',
            }),
        });

        await generateDraftData(buildInput({
            targetContentType: buildProposalTargetContentType(),
            fieldMap: {},
            defaultData: {},
        }));

        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.instructions).toContain(
            'This target schema represents a proposal-style document.',
        );
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.instructions).toContain(
            'Do not keep the proposal high level when the intake contains concrete scope, constraints, integrations, rollout needs, governance, or delivery sequencing.',
        );
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.instructions).toContain(
            'In deliveryPlan, break the work into concrete phases or work packages',
        );
        expect(mocks.responsesCreateMock.mock.calls[0]?.[0]?.instructions).toContain(
            'Prefer multi-sentence or enumerated detail in long-form fields when the intake supports it.',
        );
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
            attachments: buildInlineAttachments(),
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
        expect(requestBody.messages[0].content).toEqual([
            {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'AAA=',
                },
            },
            expect.objectContaining({
                type: 'text',
                text: expect.stringContaining('Referenced image attachments:'),
            }),
        ]);
        expect(requestBody.messages[0].content[1].text).not.toContain('spec.pdf');
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
            attachments: buildInlineAttachments(),
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
        expect(requestBody.contents[0].parts).toEqual([
            {
                inlineData: {
                    mimeType: 'image/png',
                    data: 'AAA=',
                },
            },
            expect.objectContaining({
                text: expect.stringContaining('Referenced image attachments:'),
            }),
        ]);
        expect(requestBody.contents[0].parts[1].text).not.toContain('spec.pdf');
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
