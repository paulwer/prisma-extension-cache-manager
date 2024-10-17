import { Operation } from "@prisma/client/runtime/library";
import { Cache } from "cache-manager";
import { Prisma, PrismaPromise } from "@prisma/client";

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

export type PrismaExtensionCacheConfig = {
  cache: Cache;
  defaultTTL?: number;
  /**
   * when active the cache extension will automaticly uncache cache values from storage when a write operation has happend.
   *
   * **ImportantNote:** If you are using a custom client please provide the prisma typings with property *prisma*.
   */
  useAutoUncache?: boolean;
  /**
   * prisma typings from a custom client other than *@prisma/client*.
   *
   * You may have to use ```{ prisma: Prisma as typeof Prisma }```
   */
  prisma?: typeof Prisma;
  /**
   * prefixes for custom cache rewrites. you can customize those prefixes for cases where you experience overlaps
   */
  typePrefixes?: {
    Decimal?: string;
    BigInt?: string;
    Date?: string;
    Buffer?: string;
  }
};
