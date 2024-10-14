# @paulwer/prisma-extension-cache-manager

A caching extension for [Prisma](https://www.prisma.io/), fully compatible with [cache-manager](https://www.npmjs.com/package/cache-manager), predefined uncaching strategies and custom handlers for key generation and uncaching.

## Features

- full [cache-manager](https://www.npmjs.com/package/cache-manager) compatibility => also supports external storages like redis (see cache-manager)
- Automatic uncaching strategy
- Namespaces for separate caching ttl
- Custom keys for custom caching strategies
- Keys and Uncache-Strategy can be handled with a custom functions
- Only model queries can be cacheable (no $query or $queryRaw)

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
  const prisma = new PrismaClient().$extends(cacheExtension({ cache }));
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
      key: (result) => `user-${user.id}`, // custom cache key by result (There will be no reading from the cache, only a write down)
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
      key: (result) => `user-${user.id}`, // custom cache key by result (There will be no reading from the cache, only a write down)
    },
    uncache: [`user_count`, `users`], // delete keys from cache
  });
}

main().catch(console.error);
```

## Credit

Original Implementation by [@knaus94](https://github.com/knaus94)

## Learn more

- [Docs — Client extensions](https://www.prisma.io/docs/concepts/components/prisma-client/client-extensions)
- [Docs — Shared extensions](https://www.prisma.io/docs/concepts/components/prisma-client/client-extensions/shared-extensions)
- [Credit: Original Repository](https://github.com/@knaus94/prisma-extension-cache-manager)
