import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { createHash } from "crypto";
import stringify from "safe-stable-stringify";

export function generateComposedKey(options: {
    model: string;
    operation: string;
    namespace?: string;
    queryArgs: any;
}): string {
    const hash = createHash("md5")
        .update(
            JSON.stringify(options?.queryArgs, (_, v) =>
                typeof v === "bigint" ? v.toString() : v,
            ),
        )
        .digest("hex");
    return `${options.namespace ? options.namespace : ''}:${[options.model, options.operation].join(":")}@${hash}`;
}

export function createKey(key?: string, namespace?: string): string {
    return [namespace, key].filter((e) => !!e).join(":");
}

export function serializeData(data) {
    function serializeCustomClasses(data) {
        if (Decimal.isDecimal(data)) return `___decimal_${data.toString()}`;
        if (typeof data === "bigint") return `___bigint_${data.toString()}`;
        if (Buffer.isBuffer(data)) return `___buffer_${data.toString()}`;
        if (data instanceof Date) return `___date_${data.toISOString()}`;
        else if (Array.isArray(data))
            return data.map(serializeCustomClasses); // Handle arrays
        else if (data && typeof data === "object") {
            const out: Record<string, any> = {};
            for (const key in data) out[key] = serializeCustomClasses(data[key]); // Recursively serialize
            return out;
        } else return data;
    }
    return stringify({ data: serializeCustomClasses(data) });
}

export function deserializeData(serializedData) {
    return JSON.parse(serializedData, (_key, value) => {
        // Check if the value contains the custom marker and convert back to original class/type
        if (typeof value === "string" && value.startsWith("___decimal_"))
            return new Decimal(value.replace("___decimal_", ""));
        if (typeof value === "string" && value.startsWith("___buffer_"))
            return Buffer.from(value.replace("___buffer_", ""));
        if (typeof value === "string" && value.startsWith("___bigint_"))
            return BigInt(value.replace("___bigint_", ""));
        if (typeof value === "string" && value.startsWith("___date_"))
            return new Date(value.replace("___date_", ""));
        return value;
    }).data;
}

// Utility to detect related models from query arguments
export function getInvolvedModels(prisma: typeof Prisma, modelName: string, args: any): string[] {
    const model = prisma.dmmf.datamodel.models.find(m => m.name === modelName)!;
    const involvedModels: string[] = [modelName];

    for (const field in args.data) {
        if (model.fields.some(f => f.name === field && f.kind === 'object')) {
            // If the field represents a relation, add it to involvedModels
            const relatedField = model.fields.find(f => f.name === field);

            if (relatedField) {
                const relatedModelName = relatedField.type;
                involvedModels.push(relatedModelName);

                // Recursively check if there are further nested models
                if (typeof args[field] === 'object') {
                    for (const relatedMethodName in args[field]) {
                        const nestedModels = getInvolvedModels(prisma, relatedModelName, args[field][relatedMethodName]);
                        involvedModels.push(...nestedModels);
                    }
                }
            }
        }
    }

    return [...new Set(involvedModels)];
}