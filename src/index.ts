import { Prisma } from "@prisma/client/extension";
import {
  CACHE_OPERATIONS,
  ModelExtension,
  PrismaRedisCacheConfig,
} from "./types";
import { createHash } from "crypto";
import { Operation } from "@prisma/client/runtime/library";
import { BSON } from 'bson';

function generateComposedKey(options: {
  model: string;
  queryArgs: any;
}): string {
  const hash = createHash("md5")
    .update(JSON.stringify(options?.queryArgs))
    .digest("hex");
  return `Prisma@${options.model}@${hash}`;
}

function serializeData(data: any) {
  const serializedResult = BSON.serialize({ data });
  return Buffer.from(serializedResult).toString("base64");
}

function deserializeData(data: any) {
  const binaryData = Buffer.from(data, "base64");
  return BSON.deserialize(binaryData).data;
}

export default ({ cache, serialize }: PrismaRedisCacheConfig) => {
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
              "upsert",
              "update",
            ] as ReadonlyArray<Operation> as string[]
          ).includes(operation);

          const isBinarySerialize = serialize === "binary";

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
            ["boolean", "object", "number"].includes(typeof cacheOption);

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

          if (["boolean", "number"].includes(typeof cacheOption)) {
            const cacheKey = generateComposedKey({
              model,
              queryArgs,
            });

            if (!isWriteOperation) {
              const cached = await cache.get(cacheKey);
              if (cached) {
                if (isBinarySerialize) {
                  return deserializeData(cached);
                }

                return typeof cached === "string" ? JSON.parse(cached) : cached;
              }
            }

            const result = await query(queryArgs);
            if (useUncache) processUncache(result);
            const ttl =
              typeof cacheOption === "number" ? cacheOption : undefined;
            await cache.set(
              cacheKey,
              isBinarySerialize
                ? serializeData(result)
                : JSON.stringify(result),
              ttl
            );

            return result;
          }

          const { key, ttl } = cacheOption as any;

          if (typeof key === "function") {
            const result = await query(queryArgs);
            if (useUncache) processUncache(result);

            const customCacheKey = key(result);
            await cache.set(
              customCacheKey,
              isBinarySerialize
                ? serializeData(result)
                : JSON.stringify(result),
              ttl
            );

            return result;
          }

          const customCacheKey =
            key ||
            generateComposedKey({
              model,
              queryArgs,
            });

          if (!isWriteOperation) {
            const cached = await cache.get(customCacheKey);
            if (cached) {
              if (isBinarySerialize) {
                return deserializeData(cached);
              }

              return typeof cached === "string" ? JSON.parse(cached) : cached;
            }
          }

          const result = await query(queryArgs);
          if (useUncache) processUncache(result);
          await cache.set(
            customCacheKey,
            isBinarySerialize ? serializeData(result) : JSON.stringify(result),
            ttl
          );

          return result;
        },
      },
    },
  });
};
