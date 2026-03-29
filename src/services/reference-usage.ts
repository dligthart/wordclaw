import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { contentItems, contentItemVersions, contentTypes } from '../db/schema.js';
import { extractAssetReferencesFromContent, extractContentReferencesFromContent } from './content-schema.js';

export type ReferenceUsage = {
    contentItemId: number;
    contentTypeId: number;
    contentTypeName: string;
    contentTypeSlug: string;
    path: string;
    version: number;
    status?: string;
    contentItemVersionId?: number;
};

export type ReferenceUsageSummary = {
    activeReferences: ReferenceUsage[];
    historicalReferences: ReferenceUsage[];
};

type ReferenceCarrier = {
    path: string;
};

type CandidateContentType = {
    id: number;
    name: string;
    slug: string;
    schema: string;
};

async function loadReferenceCandidateTypes(domainId: number): Promise<CandidateContentType[]> {
    return db.select({
        id: contentTypes.id,
        name: contentTypes.name,
        slug: contentTypes.slug,
        schema: contentTypes.schema
    })
        .from(contentTypes)
        .where(and(
            eq(contentTypes.domainId, domainId),
            sql<boolean>`${contentTypes.schema} like '%x-wordclaw-field-kind%'`
        ));
}

async function collectReferenceUsage(
    domainId: number,
    extractMatches: (schemaText: string, dataText: string) => ReferenceCarrier[]
): Promise<ReferenceUsageSummary> {
    const candidateTypes = await loadReferenceCandidateTypes(domainId);
    if (candidateTypes.length === 0) {
        return {
            activeReferences: [],
            historicalReferences: []
        };
    }

    const schemaByTypeId = new Map(candidateTypes.map((contentType) => [contentType.id, contentType]));
    const contentTypeIds = candidateTypes.map((contentType) => contentType.id);

    const currentRows = await db.select({
        contentItemId: contentItems.id,
        contentTypeId: contentItems.contentTypeId,
        status: contentItems.status,
        version: contentItems.version,
        data: contentItems.data
    })
        .from(contentItems)
        .where(and(
            eq(contentItems.domainId, domainId),
            inArray(contentItems.contentTypeId, contentTypeIds)
        ));

    const historicalRows = await db.select({
        contentItemVersionId: contentItemVersions.id,
        contentItemId: contentItemVersions.contentItemId,
        version: contentItemVersions.version,
        data: contentItemVersions.data,
        contentTypeId: contentItems.contentTypeId
    })
        .from(contentItemVersions)
        .innerJoin(contentItems, eq(contentItemVersions.contentItemId, contentItems.id))
        .where(and(
            eq(contentItems.domainId, domainId),
            inArray(contentItems.contentTypeId, contentTypeIds)
        ));

    const activeReferences = currentRows.flatMap((row) => {
        const contentType = schemaByTypeId.get(row.contentTypeId);
        if (!contentType) {
            return [];
        }

        return extractMatches(contentType.schema, row.data).map((reference) => ({
            contentItemId: row.contentItemId,
            contentTypeId: row.contentTypeId,
            contentTypeName: contentType.name,
            contentTypeSlug: contentType.slug,
            path: reference.path,
            version: row.version,
            status: row.status
        }));
    });

    const historicalReferences = historicalRows.flatMap((row) => {
        const contentType = schemaByTypeId.get(row.contentTypeId);
        if (!contentType) {
            return [];
        }

        return extractMatches(contentType.schema, row.data).map((reference) => ({
            contentItemId: row.contentItemId,
            contentItemVersionId: row.contentItemVersionId,
            contentTypeId: row.contentTypeId,
            contentTypeName: contentType.name,
            contentTypeSlug: contentType.slug,
            path: reference.path,
            version: row.version
        }));
    });

    return {
        activeReferences,
        historicalReferences
    };
}

export async function findAssetUsage(domainId: number, assetId: number): Promise<ReferenceUsageSummary> {
    return collectReferenceUsage(
        domainId,
        (schemaText, dataText) => extractAssetReferencesFromContent(schemaText, dataText)
            .filter((reference) => reference.assetId === assetId)
    );
}

export async function findContentItemUsage(domainId: number, contentItemId: number): Promise<ReferenceUsageSummary> {
    return collectReferenceUsage(
        domainId,
        (schemaText, dataText) => extractContentReferencesFromContent(schemaText, dataText)
            .filter((reference) => reference.contentItemId === contentItemId)
    );
}
