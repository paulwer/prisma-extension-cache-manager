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
  return `Prisma@${options.model}@${hash}`;
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

          const isCreateOperation = (
            [
              "create",
              "upsert",
              "update",
            ] as ReadonlyArray<Operation> as string[]
          ).includes(operation);

          const {
            cache: cacheOption,
            uncache: uncacheOption,
            ...queryArgs
          } = args;

          function processUncache(result: unknown) {
            const option = uncacheOption as any;
            let keysToDelete: string[] = [];

            if (typeof option === "function") {
              const keys = option(result);
              keysToDelete = Array.isArray(keys) ? keys : [keys];
            } else if (typeof option === "string") {
              keysToDelete = [option];
            } else if (Array.isArray(option)) {
              keysToDelete = option;
            }

            if (!keysToDelete.length) return true;

            return cache.store
              .mdel(...keysToDelete)
              .then(() => true)
              .catch(() => false);
          }

          const useCache =
            cacheOption !== undefined &&
            ["boolean", "object"].includes(typeof cacheOption);

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

          if (typeof cacheOption === "boolean") {
            const cacheKey = generateComposedKey({
              model,
              queryArgs,
            });

            if (!isCreateOperation) {
              const cached = await cache.get(cacheKey);

              if (cached) {
                return typeof cached === "string" ? JSON.parse(cached) : cached;
              }
            }

            const result = await query(queryArgs);
            if (useUncache) processUncache(result);

            await cache.set(cacheKey, JSON.stringify(result));
            return result;
          }

          const { key, ttl } = cacheOption as any;

          if (typeof key === "function") {
            const result = await query(queryArgs);
            if (useUncache) processUncache(result);
            const customCacheKey = key(result);
            const value = JSON.stringify(result);

            if (ttl) {
              await cache.set(customCacheKey, value, ttl);
            } else {
              await cache.set(customCacheKey, value);
            }

            return result;
          }

          const customCacheKey =
            key ||
            generateComposedKey({
              model,
              queryArgs,
            });

          if (!isCreateOperation) {
            const cached = await cache.get(customCacheKey);
            if (cached) {
              return typeof cached === "string" ? JSON.parse(cached) : cached;
            }
          }

          const result = await query(queryArgs);
          if (useUncache) processUncache(result);

          const value = JSON.stringify(result);

          if (ttl) {
            await cache.set(customCacheKey, value, ttl);
          } else {
            await cache.set(customCacheKey, value);
          }

          return result;
        },
      },
    },
  });
};
