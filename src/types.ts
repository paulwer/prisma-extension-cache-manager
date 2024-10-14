import { Operation } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client/extension";
import { Cache } from "cache-manager";
import { PrismaPromise } from "@prisma/client";

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

export const REQUIRED_ARGS_OPERATIONS = [
  "findUnique",
  "findUniqueOrThrow",
  "aggregate",
  "groupBy",
  "create",
  "createMany",
  "updateMany",
  "update",
  "upsert",
  "delete",
] as const satisfies ReadonlyArray<Operation>;

export const OPTIONAL_ARGS_OPERATIONS = [
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "deleteMany",
] as const satisfies ReadonlyArray<Operation>;

type RequiredArgsOperation = (typeof REQUIRED_ARGS_OPERATIONS)[number];
type OptionalArgsOperation = (typeof OPTIONAL_ARGS_OPERATIONS)[number];

type RequiredArgsFunction<O extends RequiredArgsOperation> = <T, A>(
  this: T,
  args: Prisma.Exact<A, Prisma.Args<T, O> & PrismaCacheArgs<T, A, O>>,
) => PrismaPromise<Prisma.Result<T, A, O>>;

type OptionalArgsFunction<O extends OptionalArgsOperation> = <T, A>(
  this: T,
  args?: Prisma.Exact<A, Prisma.Args<T, O> & PrismaCacheArgs<T, A, O>>,
) => PrismaPromise<Prisma.Result<T, A, O>>;

export type ModelExtension = {
  [O1 in RequiredArgsOperation]: RequiredArgsFunction<O1>;
} & {
  [O2 in OptionalArgsOperation]: OptionalArgsFunction<O2>;
};

export interface CacheOptions<
  T,
  A,
  O extends RequiredArgsOperation | OptionalArgsOperation,
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
  O extends RequiredArgsOperation | OptionalArgsOperation,
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
