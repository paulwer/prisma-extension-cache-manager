import { Operation } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client/extension";
import { Cache } from "cache-manager";

export const CACHE_OPERATIONS = [
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "create",
  "createMany",
  "updateMany",
  "update",
  "upsert",
  "delete",
  "deleteMany",
] as const satisfies ReadonlyArray<Operation>;

export const READ_OPERATIONS = [
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
] as const satisfies ReadonlyArray<Operation>;

export const WRITE_OPERATIONS = [
  "create",
  "createMany",
  "updateMany",
  "upsert",
  "update",
  "delete",
  "deleteMany",
] as const satisfies ReadonlyArray<Operation>;

type ArgsOperation = (typeof CACHE_OPERATIONS)[number];

type ArgsFunction<O extends ArgsOperation> = <T, A>(
  this: T,
  args: Prisma.Exact<A, Prisma.Args<T, O> & PrismaCacheArgs<T, A, O>>,
) => Prisma.PrismaPromise<Prisma.Result<T, A, O>>;

export type ModelExtension = {
  [O in ArgsOperation]: ArgsFunction<O>;
};

export interface CacheOptions<
  T,
  A,
  O extends ArgsOperation,
> {
  /**
   * Cache key
   */
  key?: ((result: Prisma.Result<T, A, O>) => string) | string;

  /**
   * Cache namespace
   */
  namespace?: string;
  /**
   * Time to live
   */
  ttl?: number;
}

export interface PrismaCacheArgs<
  T,
  A,
  O extends ArgsOperation,
> {
  cache?: boolean | number | string | CacheOptions<T, A, O>;
  uncache?:
  | ((result: Prisma.Result<T, A, O>) => string[] | string)
  | string
  | string[]
  | {
    key: string;
    namespace?: string;
  }[];
}

export interface PrismaRedisCacheConfig {
  cache: Cache;
  defaultTTL?: number;
}
