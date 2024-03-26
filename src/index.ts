import { Prisma } from "@prisma/client/extension";
import {
  CACHE_OPERATIONS,
  ModelExtension,
  PrismaRedisCacheConfig,
} from "./types";
import { createHash } from "crypto";
import { Operation } from "@prisma/client/runtime/library";

function generateComposedKey(options: {
  model: string;
  queryArgs: any;
}): string {
  const hash = createHash("md5")
    .update(JSON.stringify(options?.queryArgs))
    .digest("hex");
  return `${options.model}@${hash}`;
}

function createKey(key: string, namespace?: string): string {
  return namespace ? `${namespace}:${key}` : key;
}

function serializeData(data) {
  return JSON.stringify({ data });
}

function deserializeData(serializedData) {
  return JSON.parse(serializedData).data;
}

export default ({ cache }: PrismaRedisCacheConfig) => {
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
            [
              "create",
              "createMany",
              "updateMany",
              "upsert",
              "update",
            ] as ReadonlyArray<Operation> as string[]
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
                  obj.namespace ? `${obj.namespace}:${obj.key}` : obj.key
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
              typeof cacheOption
            );

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

          if (["boolean", "number", "string"].includes(typeof cacheOption)) {
            const cacheKey =
              typeof cacheOption === "string"
                ? cacheOption
                : generateComposedKey({
                    model,
                    queryArgs,
                  });

            if (!isWriteOperation) {
              const cached = await cache.get(cacheKey);
              if (cached) {
                return deserializeData(cached);
              }
            }

            const result = await query(queryArgs);
            if (useUncache) processUncache(result);
            const ttl =
              typeof cacheOption === "number" ? cacheOption : undefined;
            await cache.set(cacheKey, serializeData(result), ttl);

            return result;
          }

          if (typeof cacheOption.key === "function") {
            const result = await query(queryArgs);
            if (useUncache) processUncache(result);

            const customCacheKey = cacheOption.key(result);
            await cache.set(
              customCacheKey,
              serializeData(result),
              cacheOption.ttl
            );

            return result;
          }

          const customCacheKey =
            createKey(cacheOption.key, cacheOption.namespace) ||
            generateComposedKey({
              model,
              queryArgs,
            });

          if (!isWriteOperation) {
            const cached = await cache.get(customCacheKey);
            if (cached) {
              return deserializeData(cached);
            }
          }

          const result = await query(queryArgs);
          if (useUncache) processUncache(result);
          await cache.set(
            customCacheKey,
            serializeData(result),
            cacheOption.ttl
          );

          return result;
        },
      },
    },
  });
};
