import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type DrizzleJournalEntry = {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
};

export type DrizzleMigrationRecord = DrizzleJournalEntry & {
    hash: string;
    sql: string;
};

type DrizzleJournalFile = {
    version: string;
    dialect: string;
    entries: DrizzleJournalEntry[];
};

export const getDefaultMigrationsFolder = () => path.join(process.cwd(), 'drizzle');

export const readDrizzleJournal = (
    migrationsFolder: string = getDefaultMigrationsFolder()
): DrizzleJournalEntry[] => {
    const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');

    if (!fs.existsSync(journalPath)) {
        throw new Error(`Can't find Drizzle journal at ${journalPath}`);
    }

    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as DrizzleJournalFile;

    if (!Array.isArray(journal.entries)) {
        throw new Error(`Invalid Drizzle journal at ${journalPath}`);
    }

    return journal.entries;
};

export const readDrizzleMigrations = (
    migrationsFolder: string = getDefaultMigrationsFolder()
): DrizzleMigrationRecord[] => {
    return readDrizzleJournal(migrationsFolder).map((entry) => {
        const migrationPath = path.join(migrationsFolder, `${entry.tag}.sql`);

        if (!fs.existsSync(migrationPath)) {
            throw new Error(`Missing migration file ${migrationPath}`);
        }

        const sql = fs.readFileSync(migrationPath, 'utf8');

        return {
            ...entry,
            sql,
            hash: crypto.createHash('sha256').update(sql).digest('hex')
        };
    });
};

export const resolveDrizzleMigrationTarget = (
    migrations: DrizzleMigrationRecord[],
    throughTag?: string
): DrizzleMigrationRecord[] => {
    if (migrations.length === 0) {
        throw new Error('No Drizzle migrations found');
    }

    if (!throughTag) {
        return migrations;
    }

    const throughIdx = migrations.findIndex((migration) => migration.tag === throughTag);

    if (throughIdx === -1) {
        throw new Error(
            `Unknown migration tag "${throughTag}". Expected one of: ${migrations.map((migration) => migration.tag).join(', ')}`
        );
    }

    return migrations.slice(0, throughIdx + 1);
};

export const formatBaselineGuidance = (
    migrations: DrizzleMigrationRecord[],
    throughTag?: string
) => {
    const defaultTag = throughTag ?? migrations[migrations.length - 1]?.tag ?? 'latest-migration';

    return [
        'Existing database schema detected with an empty Drizzle migration journal.',
        `Baseline the journal first: npx tsx src/db/stamp-migrations.ts --through ${defaultTag}`,
        'Then rerun: npx tsx src/db/migrate.ts'
    ].join('\n');
};
