import { Prisma } from "@prisma/client/extension";
import {
  CACHE_OPERATIONS,
  CacheOptions,
  ModelExtension,
  PrismaRedisCacheConfig,
} from "./types";

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
          let result: any;
          const useCache =
            ["boolean", "object"].includes(typeof args["cache"]) &&
            args["cache"] !== null &&
            (CACHE_OPERATIONS as ReadonlyArray<string>).includes(operation);

          if (!useCache) return query(args);

          const queryArgs = {
            ...args,
          };
          delete queryArgs["cache"];

          if (typeof args["cache"] === "boolean") {
            const cacheKey = `prisma-${model}-${JSON.stringify(queryArgs)}`;
            const cached = await cache.get(cacheKey);

            if (cached) {
              return typeof cached === "string" ? JSON.parse(cached) : cached;
            }

            result = await query(queryArgs);
            await cache.set(cacheKey, JSON.stringify(result));
            return result;
          }

          const { key, ttl } = args["cache"] as unknown as CacheOptions;
          const customCacheKey =
            key || `prisma-custom-${model}-${JSON.stringify(queryArgs)}`;
          const cached = await cache.get(customCacheKey);

          if (cached) {
            return typeof cached === "string" ? JSON.parse(cached) : cached;
          }

          result = await query(queryArgs);
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
