import { Prisma } from "@prisma/client/extension";
import {
  CACHE_OPERATIONS,
  CacheOptions,
  ModelExtension,
  PrismaRedisCacheConfig,
  UncacheOptions,
} from "./types";
import { createHash } from "crypto";

function generateComposedKey(options: {
  model: string;
  queryArgs: any;
}): string {
  const hash = createHash("md5")
    .update(JSON.stringify(options?.queryArgs))
    .digest("hex");
  return `prisma-${options.model}@${hash}`;
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
          const isOperationSupported = (
            CACHE_OPERATIONS as ReadonlyArray<string>
          ).includes(operation);

          const queryArgs = {
            ...args,
          };

          const useUncache =
            typeof args["uncache"] === "object" &&
            args["uncache"] !== null &&
            isOperationSupported;

          if (useUncache) {
            delete queryArgs["uncache"];
            const { uncacheKeys } = args[
              "uncache"
            ] as unknown as UncacheOptions;

            if (uncacheKeys?.length > 0) {
              await Promise.all(
                uncacheKeys.map((key) =>
                  cache.del(key).catch(() => Promise.resolve(true))
                )
              );
            }
          }

          const useCache =
            ["boolean", "object"].includes(typeof args["cache"]) &&
            args["cache"] !== null &&
            isOperationSupported;

          if (!useCache) return query(args);

          delete queryArgs["cache"];

          if (typeof args["cache"] === "boolean") {
            const cacheKey = generateComposedKey({
              model,
              queryArgs,
            });
            const cached = await cache.get(cacheKey);

            if (cached) {
              return typeof cached === "string" ? JSON.parse(cached) : cached;
            }

            const result = await query(queryArgs);
            await cache.set(cacheKey, JSON.stringify(result));
            return result;
          }

          const { key, ttl } = args["cache"] as unknown as CacheOptions;
          const customCacheKey =
            key ||
            generateComposedKey({
              model,
              queryArgs,
            });
          const cached = await cache.get(customCacheKey);

          if (cached) {
            return typeof cached === "string" ? JSON.parse(cached) : cached;
          }

          const result = await query(queryArgs);
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
