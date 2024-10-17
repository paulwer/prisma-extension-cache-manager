import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { createHash } from "crypto";
import stringify from "safe-stable-stringify";
import { PrismaExtensionCacheConfig } from "./types";

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

export function serializeData(data: any, prefixes: PrismaExtensionCacheConfig['prefixes']) {
    function serializeCustomClasses(data: any) {
        if (Decimal.isDecimal(data)) return `${prefixes?.Decimal || '___decimal_'}${data.toString()}`;
        if (typeof data === "bigint") return `${prefixes?.BigInt || '___bigint_'}${data.toString()}`;
        if (Buffer.isBuffer(data)) return `${prefixes?.Buffer || '___buffer_'}${data.toString()}`;
        if (data instanceof Date) return `${prefixes?.Date || '___date_'}${data.toISOString()}`;
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

export function deserializeData(serializedData: any, prefixes: PrismaExtensionCacheConfig['prefixes']) {
    return JSON.parse(serializedData, (_key, value) => {
        // Check if the value contains the custom marker and convert back to original class/type
        if (typeof value === "string" && value.startsWith(prefixes?.Decimal || '___decimal_'))
            return new Decimal(value.replace(prefixes?.Decimal || '___decimal_', ""));
        if (typeof value === "string" && value.startsWith(prefixes?.Buffer || "___buffer_"))
            return Buffer.from(value.replace(prefixes?.Buffer || "___buffer_", ""));
        if (typeof value === "string" && value.startsWith(prefixes?.BigInt || "___bigint_"))
            return BigInt(value.replace(prefixes?.BigInt || "___bigint_", ""));
        if (typeof value === "string" && value.startsWith(prefixes?.Date || "___date_"))
            return new Date(value.replace(prefixes?.Date || "___date_", ""));
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