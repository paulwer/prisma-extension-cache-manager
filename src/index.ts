import {
  CACHE_OPERATIONS,
  ModelExtension,
  PrismaRedisCacheConfig,
  WRITE_OPERATIONS,
} from "./types";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client/extension";
import { Decimal } from "@prisma/client/runtime/library";

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
  return `${options.namespace ? `${options.namespace}:` : ""}${options.model}:${options.operation}@${hash}`;
}

function createKey(key?: string, namespace?: string): string {
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
  return JSON.stringify({ data: serializeCustomClasses(data) });
}

export function deserializeData(serializedData) {
  return JSON.parse(serializedData, (_key, value) => {
    // Check if the value contains the decimal marker and convert back to Prisma.Decimal
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

export default ({ cache, defaultTTL }: PrismaRedisCacheConfig) => {
  return Prisma.defineExtension({
    name: "prisma-extension-cache-manager",
    client: {
      $cache: cache,
    },
    model: {
      $allModels: {} as ModelExtension,
    },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!(CACHE_OPERATIONS as ReadonlyArray<string>).includes(operation))
            return query(args);

          const isWriteOperation = (
            WRITE_OPERATIONS as readonly string[]
          ).includes(operation);

          const {
            cache: cacheOption,
            uncache: uncacheOption,
            ...queryArgs
          } = args as any;

          function processUncache(result: any) {
            const option = uncacheOption as any;
            let keysToDelete: string[] = [];

            if (typeof option === "function") {
              const keys = option(result);
              keysToDelete = Array.isArray(keys) ? keys : [keys];
            } else if (typeof option === "string") {
              keysToDelete = [option];
            } else if (Array.isArray(option)) {
              if (typeof option[0] === "string") {
                keysToDelete = option;
              } else if (typeof option[0] === "object") {
                keysToDelete = option.map((obj) =>
                  obj.namespace ? `${obj.namespace}:${obj.key}` : obj.key,
                );
              }
            }

            if (!keysToDelete.length) return true;

            return cache.store
              .mdel(...keysToDelete)
              .then(() => true)
              .catch(() => false);
          }

          const useCache =
            cacheOption !== undefined &&
            ["boolean", "object", "number", "string"].includes(
              typeof cacheOption,
            ) &&
            !(typeof cacheOption === "boolean" && cacheOption === false);
          const useUncache =
            uncacheOption !== undefined &&
            (typeof uncacheOption === "function" ||
              typeof uncacheOption === "string" ||
              Array.isArray(uncacheOption));

          if (!useCache) {
            const result = await query(queryArgs);
            if (useUncache) processUncache(result);

            return result;
          }

          if (typeof cacheOption.key === "function") {
            const result = await query(queryArgs);
            if (useUncache) processUncache(result);

            const customCacheKey = cacheOption.key(result);

            cache.set(
              customCacheKey,
              serializeData(result),
              cacheOption.ttl ?? defaultTTL,
            );
            return result;
          }

          const cacheKey =
            typeof cacheOption === "string"
              ? cacheOption
              : cacheOption.key
                ? createKey(cacheOption.key, cacheOption.namespace)
                : generateComposedKey({
                    model,
                    operation,
                    namespace: cacheOption.namespace,
                    queryArgs,
                  });

          if (!isWriteOperation) {
            const cached = await cache.get(cacheKey);
            if (cached) return deserializeData(cached);
          }

          const result = await query(queryArgs);
          if (useUncache) processUncache(result);

          await cache.set(
            cacheKey,
            serializeData(result),
            cacheOption.ttl ?? defaultTTL,
          );
          return result;
        },
      },
    },
  });
};
