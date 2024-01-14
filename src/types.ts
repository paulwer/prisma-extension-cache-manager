import { Operation } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client/extension";
import { Cache } from "cache-manager";

export const REQUIRED_ARGS_OPERATIONS = [
  "findUnique",
  "findUniqueOrThrow",
  "groupBy",
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
  args: Prisma.Exact<A, Prisma.Args<T, O> & PrismaCacheArgs>
) => Promise<Prisma.Result<T, A, O>>;

type OptionalArgsFunction<O extends OptionalArgsOperation> = <T, A>(
  this: T,
  args?: Prisma.Exact<A, Prisma.Args<T, O> & PrismaCacheArgs>
) => Promise<Prisma.Result<T, A, O>>;

export type ModelExtension = {
  [O1 in RequiredArgsOperation]: RequiredArgsFunction<O1>;
} & {
  [O2 in OptionalArgsOperation]: OptionalArgsFunction<O2>;
};

export interface CacheOptions {
  /**
   * Cache key
   */
  key: string;
  /**
   * Time to live
   */
  ttl?: number;
}

export interface PrismaCacheArgs {
  cache?: boolean | CacheOptions;
}

export interface PrismaRedisCacheConfig {
  cache: Cache;
}
