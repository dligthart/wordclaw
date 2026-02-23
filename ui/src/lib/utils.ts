export function deepParseJson(val: any): any {
    if (typeof val === "string") {
        try {
            const parsed = JSON.parse(val);
            if (typeof parsed === "object" && parsed !== null) {
                return deepParseJson(parsed);
            }
        } catch {
            // Not valid JSON, return as-is
        }
        return val;
    }

    if (Array.isArray(val)) {
        return val.map((item) => deepParseJson(item));
    }

    if (typeof val === "object" && val !== null) {
        const result: Record<string, any> = {};
        for (const [k, v] of Object.entries(val)) {
            result[k] = deepParseJson(v);
        }
        return result;
    }

    return val;
}

export function formatJson(obj: any, indent: number = 2): string {
    if (obj === null || obj === undefined) return String(obj);

    try {
        const parsed = deepParseJson(obj);
        if (typeof parsed === 'string') {
            return parsed;
        }
        return JSON.stringify(parsed, null, indent);
    } catch {
        return String(obj);
    }
}
