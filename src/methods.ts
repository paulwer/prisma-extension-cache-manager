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
  return `${options.namespace ? options.namespace : ""}:${[options.model, options.operation].join(":")}@${hash}`;
}

export function createKey(key?: string, namespace?: string): string {
  return [namespace, key].filter((e) => !!e).join(":");
}

export function serializeData(
  data: any,
  prefixes?: PrismaExtensionCacheConfig["typePrefixes"],
) {
  function serializeCustomClasses(data: any) {
    if (Decimal.isDecimal(data))
      return `${prefixes?.Decimal || "___de_"}${data.toString()}`;
    if (typeof data === "bigint")
      return `${prefixes?.BigInt || "___bi_"}${data.toString()}`;
    if (Buffer.isBuffer(data))
      return `${prefixes?.Buffer || "___bu_"}${data.toString()}`;
    if (data instanceof Uint8Array)
      return `${prefixes?.Uint8Array || "___u8_"}${data.toString()}`;
    if (data instanceof Uint16Array)
      return `${prefixes?.Uint16Array || "___u16_"}${data.toString()}`;
    if (data instanceof Uint32Array)
      return `${prefixes?.Uint32Array || "___u32_"}${data.toString()}`;
    if (data instanceof Date)
      return `${prefixes?.Date || "___da_"}${data.toISOString()}`;
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

export function deserializeData(
  serializedData: any,
  prefixes?: PrismaExtensionCacheConfig["typePrefixes"],
) {
  return JSON.parse(serializedData, (_key, value) => {
    // Check if the value contains the custom marker and convert back to original class/type
    if (
      typeof value === "string" &&
      value.startsWith(prefixes?.Decimal || "___de_")
    )
      return new Decimal(value.replace(prefixes?.Decimal || "___de_", ""));
    if (
      typeof value === "string" &&
      value.startsWith(prefixes?.Buffer || "___bu_")
    )
      return Buffer.from(value.replace(prefixes?.Buffer || "___bu_", ""));
    if (
      typeof value === "string" &&
      value.startsWith(prefixes?.Uint8Array || "___u8_")
    )
      return new Uint8Array(
        value
          .replace(prefixes?.Uint8Array || "___u8_", "")
          .split(",")
          .map(Number),
      );
    if (
      typeof value === "string" &&
      value.startsWith(prefixes?.Uint16Array || "___u16_")
    )
      return new Uint8Array(
        value
          .replace(prefixes?.Uint16Array || "___u16_", "")
          .split(",")
          .map(Number),
      );
    if (
      typeof value === "string" &&
      value.startsWith(prefixes?.Uint32Array || "___u32_")
    )
      return new Uint8Array(
        value
          .replace(prefixes?.Uint32Array || "___u32_", "")
          .split(",")
          .map(Number),
      );
    if (
      typeof value === "string" &&
      value.startsWith(prefixes?.BigInt || "___bi_")
    )
      return BigInt(value.replace(prefixes?.BigInt || "___bi_", ""));
    if (
      typeof value === "string" &&
      value.startsWith(prefixes?.Date || "___da_")
    )
      return new Date(value.replace(prefixes?.Date || "___da_", ""));
    return value;
  }).data;
}

// Utility to detect related models from query arguments
export function getInvolvedModels(
  prisma: typeof Prisma,
  modelName: string,
  operation: string,
  args: any,
): string[] {
  const model = prisma.dmmf.datamodel.models.find((m) => m.name === modelName)!;
  const involvedModels: string[] = [];

  const checkInvolvedModels = (modelName: string, args: any) => {
    involvedModels.push(modelName);
    for (const field in args) {
      if (model.fields.some((f) => f.name === field && f.kind === "object")) {
        // If the field represents a relation, add it to involvedModels
        const relatedField = model.fields.find((f) => f.name === field);

        if (relatedField) {
          const relatedModelName = relatedField.type;
          involvedModels.push(relatedModelName);

          // Recursively check if there are further nested models
          if (typeof args[field] === "object") {
            for (const relatedMethodName in args[field]) {
              checkInvolvedModels(
                relatedModelName,
                args[field][relatedMethodName],
              );
            }
          }
        }
      }
    }
  };

  if (
    operation == "create" ||
    operation == "update" ||
    operation == "updateMany"
  )
    checkInvolvedModels(modelName, args.data);
  else if (operation == "createMany" || operation == "createManyAndReturn")
    [args.data].flat().map((row: any) => checkInvolvedModels(modelName, row));
  else if (operation == "upsert" && args.create)
    checkInvolvedModels(modelName, args.create);
  else if (operation == "upsert" && args.update)
    checkInvolvedModels(modelName, args.update);
  else involvedModels.push(modelName);

  return [...new Set(involvedModels)];
}
