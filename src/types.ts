import { Operation } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client/extension";
import { Cache } from "cache-manager";

export const REQUIRED_ARGS_OPERATIONS = [
  "delete",
  "findUnique",
  "findUniqueOrThrow",
  "aggregate",
  "groupBy",
  "update",
  "upsert",
  "create",
  "createMany",
  "updateMany",
] as const satisfies ReadonlyArray<Operation>;
export const OPTIONAL_ARGS_OPERATIONS = [
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
] as const satisfies ReadonlyArray<Operation>;

export const CACHE_OPERATIONS = [
  ...REQUIRED_ARGS_OPERATIONS,
  ...OPTIONAL_ARGS_OPERATIONS,
] as const;

type RequiredArgsOperation = (typeof REQUIRED_ARGS_OPERATIONS)[number];
type OptionalArgsOperation = (typeof OPTIONAL_ARGS_OPERATIONS)[number];

type RequiredArgsFunction<O extends RequiredArgsOperation> = <T, A>(
  this: T,
  args: Prisma.Exact<A, Prisma.Args<T, O> & PrismaCacheArgs<T, A, O>>
) => Prisma.PrismaPromise<Prisma.Result<T, A, O>>;

type OptionalArgsFunction<O extends OptionalArgsOperation> = <T, A>(
  this: T,
  args?: Prisma.Exact<A, Prisma.Args<T, O> & PrismaCacheArgs<T, A, O>>
) => Prisma.PrismaPromise<Prisma.Result<T, A, O>>;

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
  key: ((result: Prisma.Result<T, A, O>) => string) | string;

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
