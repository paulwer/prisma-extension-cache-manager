import {
  CACHE_OPERATIONS,
  ModelExtension,
  PrismaExtensionCacheConfig,
  PrismaQueryCacheArgs,
  WRITE_OPERATIONS,
} from "./types";
import {
  generateComposedKey,
  serializeData,
  deserializeData,
  createKey,
  getInvolvedModels,
} from "./methods";
import { Prisma } from "@prisma/client";
import { createHash } from "crypto";

export default ({
  cache,
  defaultTTL,
  useAutoUncache,
  prisma,
  typePrefixes,
}: PrismaExtensionCacheConfig) => {
  return Prisma.defineExtension({
    name: "prisma-extension-cache-manager",
    client: {
      $cache: cache,
      async $queryRawCached(sql: ReturnType<typeof Prisma.sql>, cacheOption?: PrismaQueryCacheArgs) {
        const context = (prisma || Prisma).getExtensionContext(this);

        const processUncache = async (result: any) => {
          const option = cacheOption?.uncache as any;
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

          if (keysToDelete.length) await cache.store.mdel(...keysToDelete);
        };

        const useUncache =
          cacheOption?.uncache !== undefined &&
          (typeof cacheOption?.uncache === "function" ||
            typeof cacheOption?.uncache === "string" ||
            Array.isArray(cacheOption?.uncache));
        const cacheTTL = typeof cacheOption?.cache === "number" ? cacheOption?.cache : typeof cacheOption?.cache === "object" ? (cacheOption?.cache?.ttl ?? defaultTTL) : defaultTTL;

        const cacheKey = generateComposedKey({
          model: '$queryRaw',
          operation: createHash("md5").update(JSON.stringify(sql.strings)).digest("hex"),
          queryArgs: sql.values,
        });

        const cached = await cache.get(cacheKey);
        if (cached) return deserializeData(cached, typePrefixes);

        const result = await context.$queryRaw(sql);
        if (useUncache) await processUncache(result);

        await cache.set(
          cacheKey,
          serializeData(result, typePrefixes),
          cacheTTL,
        );
        if (useUncache) await processUncache(result);

        return result;
      },
      async $queryRawUnsafeCached(sql: string, cacheOption?: PrismaQueryCacheArgs) {
        const context = (prisma || Prisma).getExtensionContext(this);

        const processUncache = async (result: any) => {
          const option = cacheOption?.uncache as any;
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

          if (keysToDelete.length) await cache.store.mdel(...keysToDelete);
        };

        const useUncache =
          cacheOption?.uncache !== undefined &&
          (typeof cacheOption?.uncache === "function" ||
            typeof cacheOption?.uncache === "string" ||
            Array.isArray(cacheOption?.uncache));
        const cacheTTL = typeof cacheOption?.cache === "number" ? cacheOption?.cache : typeof cacheOption?.cache === "object" ? (cacheOption?.cache?.ttl ?? defaultTTL) : defaultTTL;

        const cacheKey = generateComposedKey({
          model: '$queryRawUnsafe',
          operation: createHash("md5").update(sql).digest("hex"),
          queryArgs: {},
        });

        const cached = await cache.get(cacheKey);
        if (cached) return deserializeData(cached, typePrefixes);

        const result = await context.$queryRawUnsafe(sql);
        if (useUncache) await processUncache(result);

        await cache.set(
          cacheKey,
          serializeData(result, typePrefixes),
          cacheTTL,
        );
        if (useUncache) await processUncache(result);

        return result;
      },
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

          const processUncache = async (result: any) => {
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

            if (keysToDelete.length) await cache.store.mdel(...keysToDelete);
          };

          const processAutoUncache = async () => {
            const keysToDelete: string[] = [];
            const models = getInvolvedModels(
              prisma ?? Prisma,
              model,
              operation,
              args,
            );

            await Promise.all(
              models.map((model) =>
                (async () => {
                  const keys = await cache.store.keys(`*:${model}:*`);
                  keysToDelete.push(
                    ...keys.filter((key) => key.includes(`:${model}:`)),
                  ); // some backends may not support patter matching
                })(),
              ),
            );

            await cache.store.mdel(...keysToDelete);
          };

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
          const cacheTTL = typeof cacheOption === "number" ? cacheOption : typeof cacheOption === "object" ? (cacheOption.ttl ?? defaultTTL) : defaultTTL;

          if (!useCache) {
            const result = await query(queryArgs);
            if (useUncache) await processUncache(result);
            if (useAutoUncache && isWriteOperation) await processAutoUncache();

            return result;
          }

          if (typeof cacheOption.key === "function") {
            const result = await query(queryArgs);
            if (useUncache) await processUncache(result);
            if (useAutoUncache && isWriteOperation) await processAutoUncache();

            const customCacheKey = cacheOption.key(result);

            cache.set(
              customCacheKey,
              serializeData(result, typePrefixes),
              cacheTTL,
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
            if (cached) return deserializeData(cached, typePrefixes);
          }

          const result = await query(queryArgs);
          if (useUncache) await processUncache(result);
          if (useAutoUncache && isWriteOperation) await processAutoUncache();

          await cache.set(
            cacheKey,
            serializeData(result, typePrefixes),
            cacheTTL,
          );
          return result;
        },
      },
    },
  });
};
