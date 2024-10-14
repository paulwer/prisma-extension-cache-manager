import {
  CACHE_OPERATIONS,
  ModelExtension,
  PrismaRedisCacheConfig,
  WRITE_OPERATIONS,
} from "./types";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client/extension";

export function generateComposedKey(options: {
  model: string;
  operation: string;
  namespace?: string;
  queryArgs: any;
}): string {
  const hash = createHash("md5")
    .update(JSON.stringify(options?.queryArgs, (_, v) => typeof v === 'bigint' ? v.toString() : v))
    .digest("hex");
  return `${options.namespace ? `${options.namespace}:` : ''}${options.model}:${options.operation}@${hash}`;
}

function createKey(key?: string, namespace?: string): string {
  return [namespace, key].filter(e => !!e).join(":");
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

          const isWriteOperation = (WRITE_OPERATIONS as readonly string[]).includes(operation);

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

          const useCache = cacheOption !== undefined && ["boolean", "object", "number", "string"].includes(typeof cacheOption) && !(typeof cacheOption === 'boolean' && cacheOption === false);
          const useUncache = uncacheOption !== undefined && (typeof uncacheOption === "function" || typeof uncacheOption === "string" || Array.isArray(uncacheOption));

          if (!useCache) {
            const result = await query(queryArgs);
            if (useUncache) processUncache(result);

            return result;
          }

          if (["boolean", "number", "string"].includes(typeof cacheOption)) {
            const cacheKey = typeof cacheOption === "string"
              ? cacheOption
              : generateComposedKey({
                model,
                operation,
                queryArgs,
              });

            if (!isWriteOperation) return cache.wrap(cacheKey, () => query(queryArgs), cacheOption.ttl ?? defaultTTL);

            const result = await query(queryArgs);
            if (useUncache) processUncache(result);
            return cache.wrap(cacheKey, async () => result, typeof cacheOption === "number" ? cacheOption : defaultTTL ?? undefined);
          }

          if (typeof cacheOption.key === "function") {
            const result = await query(queryArgs);
            if (useUncache) processUncache(result);

            const customCacheKey = cacheOption.key(result);
            return cache.wrap(customCacheKey, async () => result, cacheOption.ttl ?? defaultTTL);
          }

          const customCacheKey = cacheOption.key ?
            createKey(cacheOption.key, cacheOption.namespace) :
            generateComposedKey({
              model,
              operation,
              namespace: cacheOption.namespace,
              queryArgs,
            });

          if (!isWriteOperation) return cache.wrap(customCacheKey, () => query(queryArgs), cacheOption.ttl ?? defaultTTL);

          const result = await query(queryArgs);
          if (useUncache) processUncache(result);
          return cache.wrap(customCacheKey, async () => result, cacheOption.ttl ?? defaultTTL);
        },
      },
    },
  });
};
