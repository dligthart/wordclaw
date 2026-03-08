export function resolveAlias(
    value: string | undefined,
    aliases: Record<string, string>,
): string | undefined {
    if (!value) {
        return value;
    }

    return aliases[value] ?? value;
}

function levenshteinDistance(left: string, right: string): number {
    const a = left.toLowerCase();
    const b = right.toLowerCase();
    const matrix = Array.from({ length: a.length + 1 }, () =>
        new Array<number>(b.length + 1).fill(0),
    );

    for (let index = 0; index <= a.length; index += 1) {
        matrix[index][0] = index;
    }
    for (let index = 0; index <= b.length; index += 1) {
        matrix[0][index] = index;
    }

    for (let row = 1; row <= a.length; row += 1) {
        for (let column = 1; column <= b.length; column += 1) {
            const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
            matrix[row][column] = Math.min(
                matrix[row - 1][column] + 1,
                matrix[row][column - 1] + 1,
                matrix[row - 1][column - 1] + substitutionCost,
            );
        }
    }

    return matrix[a.length][b.length];
}

export function suggestClosest(
    value: string,
    candidates: readonly string[],
): string | undefined {
    let bestCandidate: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        const distance = levenshteinDistance(value, candidate);
        if (distance < bestDistance) {
            bestCandidate = candidate;
            bestDistance = distance;
        }
    }

    const maxDistance = Math.max(2, Math.floor((bestCandidate?.length ?? 0) / 3));
    return bestDistance <= maxDistance ? bestCandidate : undefined;
}

export function buildUnknownCommandError(
    kind: string,
    value: string,
    candidates: readonly string[],
): Error {
    const suggestion = suggestClosest(value, candidates);

    if (!suggestion) {
        return new Error(`Unknown ${kind}: ${value}`);
    }

    return new Error(
        `Unknown ${kind}: ${value}. Did you mean \`${suggestion}\`?`,
    );
}
