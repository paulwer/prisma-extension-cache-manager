# @paulwer/prisma-extension-cache-manager

A caching extension for [Prisma](https://www.prisma.io/), fully compatible with [cache-manager](https://www.npmjs.com/package/cache-manager), predefined uncaching strategies and custom handlers for key generation and uncaching.

## Features

- full [cache-manager](https://www.npmjs.com/package/cache-manager) compatibility => also supports external storages like redis (see cache-manager)
- Model queries and custom queries are cacheable (additional methods $queryRawCached or $queryRawUnsafeCached)
- Automatic uncaching strategy
- Namespaces for separate caching ttl
- Custom keys for custom caching strategies
- Cache-Keys and Uncache-Keys can be handled with a custom function after data fetching

## Installation

Install:

```cmd
npm i @paulwer/prisma-extension-cache-manager
```

## Usage

```typescript
import { PrismaClient } from "@prisma/client";
import * as cm from "cache-manager";
import cacheExtension from "@paulwer/prisma-extension-cache-manager";

async function main() {
  const cache = await cm.caching("memory", {
    ttl: 10000,
    max: 200,
  });
  const prisma = new PrismaClient().$extends(
    cacheExtension({ cache, useAutoUncaching: true }),
  );
  await prisma.user.findUniqueOrThrow({
    where: {
      email: user.email,
    },
    cache: true, // using cache default settings
  });
  await prisma.user.findMany({
    cache: 5000, // setting ttl in milliseconds
  });
  await prisma.user.count({
    cache: {
      ttl: 2000,
      key: "user_count", // custom cache key
    },
  });
  await prisma.user.count({
    cache: {
      ttl: 24 * 60 * 60 * 1000,
      namespace: "pricing_tier1", // custom namespace for custom ttls
    },
  });
  await prisma.user.update({
    data: {},
    cache: {
      ttl: 2000,
      key: (result) => `user-${result.id}`, // custom cache key by result (There will be no reading from the cache, only a write down)
    },
  });
  await prisma.user.create({
    data: {},
    uncache: `user_count`, // delete key from cache
  });
  await prisma.user.create({
    data: {},
    cache: {
      ttl: 2000,
      key: (result) => `user-${result.id}`, // custom cache key by result (There will be no reading from the cache, only a write down)
    },
    uncache: [`user_count`, `users`], // delete keys from cache
  });
  // Custom Queries
  await prisma.$queryRawCached(
    Prisma.sql`SELECT * FROM "User" WHERE id = ${1}`,
    {
      cache: {
        namespace: "test",
        ttl: 2000,
        key: (result) => `user-${result[0].id}`, // custom cache key by result (There will be no reading from the cache, only a write down)
      },
      uncache: [`user_count`, `users`], // delete keys from cache
    },
  );
  await prisma.$queryRawUnsafeCached(
    Prisma.sql`SELECT * FROM "User" WHERE id = 1`,
    {
      cache: "custom_query1",
      uncache: {
        namespace: "test", // delete keys from cache
      },
    },
  );
}

main().catch(console.error);
```

## Customize Caching

### Caching Key

By default this extension will create a cache-key in the format of `<namespace?>:<model>:<operation>@<args-hash>`.

You can customize this behavior by providing one or both of the following parameters. Both parameters can also be computed by a function which gets passed the result of the query for even more customization options.

**namespace** By providing a namespace you can prefix the key and handle seperate caching ttls.

**key** By providing a custom key you can define how the caching key is generated. When using a custom key, the cache key will be generated as following: `<key>` or `<namespace>:<key>`.

### Automatic Uncaching

When a write-operation was performed on a model, all cache-data for this model will be removed. We also support nested write operations.

**Important Notice:** This will only work for the default caching keys.

### TTL

You can customize the ttl of the cache key. The plugin will use the first ttl only when originaly creating the cache entry.

### (De-)Serialization

This plugin serialize/deserialize some classes used by prisma to string with a prefix to deserialize it back when using cache later. You can customize this behavior by passing the prefixes property to the plugin while initialization.

## Planned features

- more granular automatic uncaching
- performance improvements for uncaching

## Limitations & Important Considderations

1. Be carefull when using custom cache-keys and automatic-uncaching. If you produce an overlay it could happen, that more cache entries gets deleted than exspected.
2. Automatic Uncaching only works when using @prisma/client. Custom generated client which are loaded from another origin/package are not supported yet.

## Credit

Original Implementation by [@knaus94](https://github.com/knaus94)

## Learn more

- [Docs — Client extensions](https://www.prisma.io/docs/concepts/components/prisma-client/client-extensions)
- [Docs — Shared extensions](https://www.prisma.io/docs/concepts/components/prisma-client/client-extensions/shared-extensions)
- [Credit: Original Repository](https://github.com/@knaus94/prisma-extension-cache-manager)
