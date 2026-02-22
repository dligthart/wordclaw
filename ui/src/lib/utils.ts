export function formatJson(obj: any, indent: number = 2): string {
    if (obj === null || obj === undefined) return String(obj);

    function deepParse(val: any): any {
        if (typeof val === 'string') {
            try {
                const parsed = JSON.parse(val);
                // Only return parsed if it's an object or array (ignore primitives that accidentally parse)
                if (typeof parsed === 'object' && parsed !== null) {
                    return deepParse(parsed);
                }
            } catch {
                // Not valid JSON, return as-is
            }
            return val;
        }

        if (Array.isArray(val)) {
            return val.map(v => deepParse(v));
        }

        if (typeof val === 'object' && val !== null) {
            const result: Record<string, any> = {};
            for (const [k, v] of Object.entries(val)) {
                result[k] = deepParse(v);
            }
            return result;
        }

        return val;
    }

    try {
        const parsed = deepParse(obj);
        if (typeof parsed === 'string') {
            return parsed;
        }
        return JSON.stringify(parsed, null, indent);
    } catch {
        return String(obj);
    }
}
