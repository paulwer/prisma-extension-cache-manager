# @knaus94/prisma-extension-cache-manager

A caching extension for [Prisma](https://www.prisma.io/), compatible with [cache-manager](https://www.npmjs.com/package/cache-manager).

## Features

- [cache-manager](https://www.npmjs.com/package/cache-manager) compatibility
- Only model queries can be cacheable (no $query or $queryRaw)

## Installation

Install:

```
npm i @knaus94/prisma-extension-cache-manager
```

## Usage

```typescript
import { PrismaClient } from "@prisma/client";
import * as cm from "cache-manager";
import cacheExtension from "@knaus94/prisma-extension-cache-manager";

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

## Learn more

- [Docs — Client extensions](https://www.prisma.io/docs/concepts/components/prisma-client/client-extensions)
- [Docs — Shared extensions](https://www.prisma.io/docs/concepts/components/prisma-client/client-extensions/shared-extensions)
- [Preview announcement blog post](https://www.prisma.io/blog/client-extensions-preview-8t3w27xkrxxn#introduction)
