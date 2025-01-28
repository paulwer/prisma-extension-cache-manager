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
import { Prisma as InternalPrisma } from "@prisma/client";
import { createHash } from "crypto";

const promiseCache: { [key: string]: Promise<any> } = {};

export default ({
  cache,
  defaultTTL,
  useAutoUncache,
  useDeduplication,
  prisma,
  typePrefixes,
}: PrismaExtensionCacheConfig) => {
  if (prisma && !prisma.defineExtension)
    throw new Error(
      'Prisma object is invalid. Please provide a valid Prisma object by using the following: import { Prisma } from "@prisma/client"',
    );

  async function safeDelete(keys: string[]) {
    for (const store of cache.stores) for (const key of keys)
      await store.delete(key); // Delete the key from each store
  }

  const Prisma: typeof InternalPrisma =
    (prisma as unknown as typeof InternalPrisma) || InternalPrisma;
  return Prisma.defineExtension({
    name: "prisma-extension-cache-manager",
    model: {
      $allModels: {} as ModelExtension,
    },
    client: {
      $cache: cache,
      async $queryRawCached(
        sql: ReturnType<typeof Prisma.sql>,
        cacheOption?: PrismaQueryCacheArgs,
      ) {
        const context = Prisma.getExtensionContext(this);

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

          if (keysToDelete.length) await safeDelete(keysToDelete);
        };

        const useUncache =
          cacheOption?.uncache !== undefined &&
          (typeof cacheOption?.uncache === "function" ||
            typeof cacheOption?.uncache === "string" ||
            Array.isArray(cacheOption?.uncache));
        const cacheTTL =
          typeof cacheOption?.cache === "number"
            ? cacheOption?.cache
            : typeof cacheOption?.cache === "object"
              ? cacheOption?.cache?.ttl ?? defaultTTL
              : defaultTTL;

        const cacheKey = generateComposedKey({
          model: "$queryRaw",
          operation: createHash("md5")
            .update(JSON.stringify(sql.strings))
            .digest("hex"),
          queryArgs: sql.values,
        });

        const cached = await cache.get(cacheKey);
        if (cached) return deserializeData(cached, typePrefixes);

        let queryPromise: Promise<any> | undefined;
        if (useDeduplication) {
          if (!promiseCache[cacheKey])
            promiseCache[cacheKey] = context.$queryRaw(sql);
          queryPromise = promiseCache[cacheKey];
        } else queryPromise = context.$queryRaw(sql);
        const result = await queryPromise.finally(
          () => delete promiseCache[cacheKey],
        );
        if (useUncache) await processUncache(result);

        await cache.set(
          cacheKey,
          serializeData(result, typePrefixes),
          cacheTTL,
        );
        if (useUncache) await processUncache(result);

        return result;
      },
      async $queryRawUnsafeCached(
        sql: string,
        cacheOption?: PrismaQueryCacheArgs,
      ) {
        const context = Prisma.getExtensionContext(this);

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

          if (keysToDelete.length) await safeDelete(keysToDelete);
        };

        const useUncache =
          cacheOption?.uncache !== undefined &&
          (typeof cacheOption?.uncache === "function" ||
            typeof cacheOption?.uncache === "string" ||
            Array.isArray(cacheOption?.uncache));
        const cacheTTL =
          typeof cacheOption?.cache === "number"
            ? cacheOption?.cache
            : typeof cacheOption?.cache === "object"
              ? cacheOption?.cache?.ttl ?? defaultTTL
              : defaultTTL;

        const cacheKey = generateComposedKey({
          model: "$queryRawUnsafe",
          operation: createHash("md5").update(sql).digest("hex"),
          queryArgs: {},
        });

        const cached = await cache.get(cacheKey);
        if (cached) return deserializeData(cached, typePrefixes);

        let queryPromise: Promise<any> | undefined;
        if (useDeduplication) {
          if (!promiseCache[cacheKey])
            promiseCache[cacheKey] = context.$queryRawUnsafe(sql);
          queryPromise = promiseCache[cacheKey];
        } else queryPromise = context.$queryRawUnsafe(sql);
        const result = await queryPromise.finally(
          () => delete promiseCache[cacheKey],
        );
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

            if (keysToDelete.length) await safeDelete(keysToDelete);
          };

          const processAutoUncache = async () => {
            const keysToDelete: string[] = [];
            const models = getInvolvedModels(Prisma, model, operation, args);

            await Promise.all(
              models.map((model) =>
                (async () => {
                  for (const store of cache.stores) if (store?.iterator) {
                    for await (const [key] of store.iterator({})) {
                      if (key.includes(`:${model}:`)) keysToDelete.push(key)
                    }
                  }
                })(),
              ),
            );

            await safeDelete(keysToDelete);
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
          const cacheTTL =
            typeof cacheOption === "number"
              ? cacheOption
              : typeof cacheOption === "object"
                ? cacheOption.ttl ?? defaultTTL
                : defaultTTL;

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

          let queryPromise: Promise<any> | undefined;
          if (useDeduplication) {
            if (!promiseCache[cacheKey])
              promiseCache[cacheKey] = query(queryArgs);
            queryPromise = promiseCache[cacheKey];
          } else queryPromise = query(queryArgs);
          const result = await queryPromise.finally(
            () => delete promiseCache[cacheKey],
          );
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
