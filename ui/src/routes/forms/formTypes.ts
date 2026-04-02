export type ContentType = {
    id: number;
    name: string;
    slug: string;
    kind: "collection" | "singleton";
    basePrice?: number | null;
};

export type FormFieldOption = {
    label?: string | null;
    value: string;
};

export type FormField = {
    name: string;
    label?: string | null;
    description?: string | null;
    type:
        | "text"
        | "textarea"
        | "number"
        | "checkbox"
        | "select"
        | "asset"
        | "asset-list";
    required: boolean;
    placeholder?: string | null;
    options?: FormFieldOption[];
};

export type DraftGenerationProvider =
    | {
          type: "deterministic";
      }
    | {
          type: "openai" | "anthropic" | "gemini";
          model?: string;
          instructions?: string;
      };

export type WorkforceAgent = {
    id: number;
    domainId: number;
    name: string;
    slug: string;
    purpose: string;
    soul: string;
    provider: DraftGenerationProvider;
    active: boolean;
    createdAt: string;
    updatedAt: string;
};

export type FormDraftGenerationConfig = {
    targetContentTypeId: number;
    targetContentTypeName: string;
    targetContentTypeSlug: string;
    workforceAgentId: number | null;
    workforceAgentSlug: string | null;
    workforceAgentName: string | null;
    workforceAgentPurpose: string | null;
    agentSoul: string;
    fieldMap: Record<string, string>;
    defaultData: Record<string, unknown>;
    postGenerationWorkflowTransitionId: number | null;
    provider: DraftGenerationProvider;
};

export type FormDefinition = {
    id: number;
    domainId: number;
    name: string;
    slug: string;
    description: string | null;
    contentTypeId: number;
    contentTypeName: string;
    contentTypeSlug: string;
    active: boolean;
    publicRead: boolean;
    submissionStatus: string;
    workflowTransitionId: number | null;
    requirePayment: boolean;
    successMessage: string | null;
    fields: FormField[];
    defaultData: Record<string, unknown>;
    draftGeneration: FormDraftGenerationConfig | null;
    createdAt: string;
    updatedAt: string;
};

export type PublicFormDefinition = {
    id: number;
    domainId: number;
    name: string;
    slug: string;
    description: string | null;
    contentTypeId: number;
    contentTypeName: string;
    contentTypeSlug: string;
    requirePayment: boolean;
    successMessage: string | null;
    fields: FormField[];
    createdAt: string;
    updatedAt: string;
};

export type FormEditorState = {
    id: number | null;
    name: string;
    slug: string;
    description: string;
    contentTypeId: string;
    active: boolean;
    publicRead: boolean;
    submissionStatus: string;
    workflowTransitionId: string;
    requirePayment: boolean;
    webhookUrl: string;
    webhookSecret: string;
    successMessage: string;
};
