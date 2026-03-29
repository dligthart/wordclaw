const API_URL = process.env.GRAPHQL_URL || 'http://localhost:4000/graphql';

const REQUIRED_QUERIES = [
    'contentTypes',
    'contentType',
    'contentItems',
    'contentItem',
    'contentItemVersions',
    'auditLogs'
];

const REQUIRED_MUTATIONS = [
    'createContentType',
    'updateContentType',
    'deleteContentType',
    'createContentItem',
    'createContentItemsBatch',
    'updateContentItem',
    'updateContentItemsBatch',
    'deleteContentItem',
    'deleteContentItemsBatch',
    'rollbackContentItem'
];

const REQUIRED_DRY_RUN_MUTATIONS = new Set([
    'createContentType',
    'updateContentType',
    'deleteContentType',
    'createContentItem',
    'createContentItemsBatch',
    'updateContentItem',
    'updateContentItemsBatch',
    'deleteContentItem',
    'deleteContentItemsBatch',
    'rollbackContentItem'
]);

type IntrospectionField = {
    name: string;
    args: Array<{ name: string }>;
};

type IntrospectionResult = {
    data?: {
        __schema?: {
            queryType?: { fields?: IntrospectionField[] };
            mutationType?: { fields?: IntrospectionField[] };
        };
    };
    errors?: unknown[];
};

async function graphqlRequest<T>(query: string): Promise<T> {
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
    });

    return response.json() as Promise<T>;
}

async function verifyGraphQL() {
    console.log('Starting GraphQL verification...');

    try {
        const introspectionQuery = `
            query {
                __schema {
                    queryType {
                        fields {
                            name
                            args { name }
                        }
                    }
                    mutationType {
                        fields {
                            name
                            args { name }
                        }
                    }
                }
            }
        `;

        const schemaResult = await graphqlRequest<IntrospectionResult>(introspectionQuery);
        if (schemaResult.errors || !schemaResult.data?.__schema) {
            console.error('GraphQL introspection failed:', schemaResult.errors || 'missing schema');
            process.exit(1);
        }

        const queryFields = schemaResult.data.__schema.queryType?.fields || [];
        const mutationFields = schemaResult.data.__schema.mutationType?.fields || [];
        const queryNames = new Set(queryFields.map((field) => field.name));
        const mutationMap = new Map(mutationFields.map((field) => [field.name, field]));

        for (const requiredQuery of REQUIRED_QUERIES) {
            if (!queryNames.has(requiredQuery)) {
                throw new Error(`Missing GraphQL query: ${requiredQuery}`);
            }
        }

        for (const requiredMutation of REQUIRED_MUTATIONS) {
            const mutation = mutationMap.get(requiredMutation);
            if (!mutation) {
                throw new Error(`Missing GraphQL mutation: ${requiredMutation}`);
            }

            if (REQUIRED_DRY_RUN_MUTATIONS.has(requiredMutation)) {
                const argNames = new Set(mutation.args.map((argument) => argument.name));
                if (!argNames.has('dryRun')) {
                    throw new Error(`Mutation missing dryRun argument: ${requiredMutation}`);
                }
            }
        }

        const query = `
            query {
                contentTypes {
                    id
                    name
                    slug
                }
            }
        `;

        const dataResult = await graphqlRequest<{
            data?: { contentTypes?: unknown[] };
            errors?: unknown[];
        }>(query);

        if (dataResult.errors) {
            throw new Error(`contentTypes query failed: ${JSON.stringify(dataResult.errors)}`);
        }

        if (!Array.isArray(dataResult.data?.contentTypes)) {
            throw new Error('contentTypes query returned an invalid payload');
        }

        console.log(`contentTypes query succeeded (${dataResult.data.contentTypes.length} rows).`);
        console.log('GraphQL verification passed.');
    } catch (error) {
        console.error('GraphQL verification failed:', error);
        process.exit(1);
    }
}

verifyGraphQL();
