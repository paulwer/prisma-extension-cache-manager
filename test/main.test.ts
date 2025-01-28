import { Prisma, PrismaClient } from "@prisma/client";
import { Metrics } from "@prisma/client/runtime/library";
import { createCache } from 'cache-manager';
import { Keyv } from 'keyv';
import assert from "node:assert";
import test from "node:test";
import cacheExtension from "../src";
import { deserializeData, generateComposedKey } from "../src/methods";
import { OPTIONAL_ARGS_OPERATIONS, READ_OPERATIONS } from "../src/types";
import KeyvSqlite from "@keyv/sqlite";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

test("cacheExtension", { only: true }, async (t) => {
  const defaultTtl = 1000;

  const store = new KeyvSqlite();
  const keyv = new Keyv<KeyvSqlite>({ store });
  const cache = createCache({
    ttl: defaultTtl,
    stores: [keyv],
  });
  async function getCacheSize(): Promise<number> {
    return store.query(`SELECT COUNT(*) as count FROM ${store.opts.table};`).then(([res]: { count: number }[]) => res.count);
  }
  async function getCacheData() {
    return store.query(`SELECT * FROM ${store.opts.table};`);
  }

  // regenerate client to reset metrics
  let useClientWithAutomaticUncache = false;
  const getClient = () =>
    new PrismaClient().$extends(
      cacheExtension({ cache, useAutoUncache: useClientWithAutomaticUncache }),
    );

  let prisma = getClient();
  assert(prisma.$cache === cache);
  // db queries count
  const queries = async (): Promise<number | undefined> =>
    ((await (prisma as any).$metrics.json()) as Metrics).counters.find(
      (x: any) => x.key === "prisma_client_queries_total",
    )?.value;
  // expected db query count
  let q = 0;
  // expected cache size
  let c = 0;

  // reset client and cache before each test
  t.beforeEach(async () => {
    prisma = getClient();
    await cache.clear();
    q = 0;
    c = 0;
  });

  const testCache = async () => {
    const [qq, cc, data] = await Promise.all([queries(), getCacheSize(), getCacheData()]);
    if (qq !== q || cc !== c)
      console.log(data);
    assert.equal(qq, q, `invalid count of queries performed - expected: ${q} performed: ${qq}`);
    assert.equal(cc, c, `invalid cache entries - expected: ${c} existing: ${cc}`);
  };

  // clear table
  const reset = async () => {
    await prisma.user.deleteMany();
    await prisma.post.deleteMany();
    return await prisma.user.create({
      data: {
        id: 1,
        string: "string",
        decimal: new Prisma.Decimal("10.44"),
        bigint: BigInt("1283231897"),
        float: 321.84784,
        timestamp: new Date(),
        bytes: Buffer.from("o21ijferve9ir3"),
        posts: {
          create: {
            id: 1,
          },
        },
      },
    });
  };

  const user = await reset();

  const args = {
    where: {
      OR: [
        {
          id: {
            gte: 1,
          },
          bytes: user.bytes,
        },
        {
          string: {
            not: null,
          },
          decimal: {
            not: new Prisma.Decimal("10.99"),
          },
        },
      ],
    },
    orderBy: {
      timestamp: "desc",
    },
  } satisfies Prisma.UserFindManyArgs;

  // t.runOnly(true);

  await t.test("basic caching i/o", async () => {
    await cache.set("test", 'test');
    const data = await cache.get('test')
    assert(data === 'test', `Cache returned invalid Data: ${data}`);
  })

  await t.test("every read model operation", async () => {
    const useCache = { cache: true } as const;
    await prisma.user.findMany(useCache);
    await prisma.user.findFirst(useCache);
    await prisma.user.findFirstOrThrow(useCache);
    const findUniqueArgs = {
      where: {
        id: user.id,
      },
      ...useCache,
    } satisfies Prisma.UserFindUniqueArgs;
    await prisma.user.findUnique(findUniqueArgs);
    await prisma.user.findUniqueOrThrow(findUniqueArgs);
    await prisma.user.count(useCache);
    await prisma.user.aggregate({
      _sum: {
        float: true,
      },
      ...useCache,
    });
    await prisma.user.groupBy({
      by: "id",
      _sum: {
        float: true,
      },
      ...useCache,
    });
    const expectedOperations = READ_OPERATIONS.length;
    q += expectedOperations;
    c += expectedOperations;
    await testCache();
  });

  await t.test(
    "every optional args model operation without args & cache",
    async () => {
      await prisma.user.findMany();
      await prisma.user.findFirst();
      await prisma.user.findFirstOrThrow();
      await prisma.user.count();
      await prisma.user.deleteMany();

      const expectedOperations = OPTIONAL_ARGS_OPERATIONS.length;
      q += expectedOperations;
      await testCache();
    },
  );
  await reset(); // recreate the data because we have done write operations

  await t.test("inside a prisma transaction", async () => {
    await prisma.$transaction([prisma.user.findMany()]);
  });

  await t.test("value matching", async () => {
    const key = "key";
    const arg = {
      ...args,
      cache: {
        key,
      },
    } satisfies Prisma.UserFindManyArgs & { cache: any };
    const d1 = await prisma.user.findMany(arg);
    q++;
    c++;
    await testCache();
    const d2 = await prisma.user.findMany(arg);
    const d3: typeof d2 = deserializeData((await cache.get(key))!);
    await testCache();
    assert(d3);
    assert.deepEqual(d1, d2); // check that the output is the same, as in direct
    assert.deepEqual(d2, d3); // check if the output of the 2nd method is the same as manualy parsing it
    assert.deepEqual(d1, d3); // check if the output of the 1st method is the same as manualy parsing it
  });

  await t.test("key generation", async () => {
    const hashingData = {
      model: "User",
      operation: "findMany",
      queryArgs: args,
    };
    await prisma.user.findMany({ ...args, cache: true });
    const key = generateComposedKey(hashingData);
    assert(await cache.get(key));
    q++;
    c++;
    await testCache();
    // same arguments but different instantiation
    const now = Date.now();
    await prisma.user.count({
      where: {
        decimal: new Prisma.Decimal("1.1213"),
        bytes: Buffer.from("123"),
        timestamp: new Date(now),
      },
      cache: true,
    });
    await prisma.user.count({
      where: {
        decimal: new Prisma.Decimal("1.1213"),
        bytes: Buffer.from("123"),
        timestamp: new Date(now),
      },
      cache: true,
    });
    c++;
    q++;
    await testCache();
  });

  await t.test("no cache", async () => {
    await prisma.user.findMany({ cache: false });
    q++;
    await testCache();
  });

  await t.test(
    "same args different operation should use different key",
    async () => {
      await prisma.user.findMany({ ...args, cache: true });
      await prisma.user.count({ ...args, cache: true });
      q += 2;
      c += 2;
      await testCache();
    },
  );

  await t.test("same args different cache options", async () => {
    await prisma.user.count({ ...args, cache: true });
    // cache hit
    await prisma.user.count({
      ...args,
      cache: {
        ttl: 200,
      },
    });
    // cache miss
    await prisma.user.count({
      ...args,
      cache: {
        ttl: 100,
        key: "different-key",
      },
    });
    // cache miss
    await prisma.user.count({
      ...args,
      cache: {
        ttl: 100,
        namespace: "different-key",
      },
    });
    q += 3;
    c += 3;
    await testCache();
  });

  await t.test("default ttl", async () => {
    await prisma.user.findFirst({
      cache: true,
    });
    q++;
    c++;
    await sleep(defaultTtl + 10);
    // cache miss
    await prisma.user.findFirst({
      cache: true,
    });
    q++;
    await testCache();
  });

  await t.test("custom ttl", async () => {
    const ttl = 200;
    await prisma.user.count({
      cache: ttl,
    });
    q++;
    c++;
    await sleep(ttl + 10);
    await prisma.user.count({
      cache: ttl,
    });
    q++;
    await testCache();
  });

  await t.test("shortened ttl should still use cache", async () => {
    const ttl = 400;
    await prisma.user.count({
      cache: ttl,
    });
    q++;
    c++;
    await prisma.user.count({
      cache: ttl / 4,
    });
    await testCache();
  });

  await t.test("expired ttl should should not have cache", async () => {
    const ttl = 400;
    await prisma.user.count({
      cache: {
        key: 'test',
        ttl,
      },
    });
    q++;
    c++;
    await testCache();
    await sleep(ttl);
    c--;
    await cache.get('test'); // keyv only refreshs cache, when its accessed => in prod this would happen with the prisma request
    await testCache();
  });

  await t.test("custom cache keys for provided namespace", async () => {
    const hashingDataWithout = {
      model: "User",
      operation: "findMany",
      queryArgs: args,
    };
    await prisma.user.findMany({
      ...args,
      cache: true,
    });
    const keyWithout = generateComposedKey(hashingDataWithout);
    assert(!keyWithout.startsWith("test:"), `invalid key: ${keyWithout}`);
    assert(await cache.get(keyWithout));
    q++;
    c++;
    await testCache();
    // Now with namespace
    const hashingData = {
      model: "User",
      operation: "findMany",
      namespace: "test",
      queryArgs: args,
    };
    await prisma.user.findMany({
      ...args,
      cache: {
        namespace: "test",
      },
    });
    const key = generateComposedKey(hashingData);
    assert(key.startsWith("test:"), `invalid key: ${key}`);
    assert(await cache.get(key));
    q++;
    c++;
    await testCache();
  });

  // TEST FOR AUTOMATIC UNCACHE
  await t.test(
    "write operation should not uncache when automatic uncache is disabled",
    async () => {
      await prisma.user.findMany({
        cache: true,
      });
      q++;
      c++;
      await testCache();
      await prisma.user.update({
        data: {
          string: "updated-string",
        },
        where: {
          id: 1,
        },
      });
      q++;
      await testCache();
      await prisma.user.findMany({
        cache: true,
      });
      await testCache();
    },
  );
  await reset(); // recreate the data because we have done write operations

  await t.test(
    "nested write operation should not uncache when automatic uncache is disabled",
    async () => {
      await prisma.post.findMany({
        cache: true,
      });
      q++;
      c++;
      await testCache();
      await prisma.user.update({
        data: {
          posts: {
            create: {
              id: 2,
            },
          },
        },
        where: {
          id: 1,
        },
      });
      q++;
      await testCache();
      await prisma.post.findMany({
        cache: true,
      });
      await testCache();
    },
  );
  await reset(); // recreate the data because we have done write operations

  await t.test(
    "upsert write operation should not uncache when automatic uncache is disabled",
    async () => {
      await prisma.user.findMany({
        cache: true,
      });
      q++;
      c++;
      await testCache();
      await prisma.user.upsert({
        create: {
          id: 2,
          string: "updated-string",
        },
        update: {},
        where: {
          id: 2,
        },
      });
      q++;
      await testCache();
      await prisma.user.findMany({
        cache: true,
      });
      await testCache();
    },
  );
  await reset(); // recreate the data because we have done write operations

  useClientWithAutomaticUncache = true;
  await t.test(
    "write operation should uncache when automatic uncache is enabled",
    async () => {
      await prisma.user.findMany({
        cache: true,
      });
      q++;
      c++;
      await testCache();
      await prisma.user.update({
        data: {
          string: "updated-string",
        },
        where: {
          id: 1,
        },
      });
      q++;
      c--;
      await testCache();
      await prisma.user.findMany({
        cache: true,
      });
      q++;
      c++;
      await testCache();
    },
  );
  await reset(); // recreate the data because we have done write operations

  await t.test(
    "nested write operation should uncache when automatic uncache is enabled",
    async () => {
      await prisma.post.findMany({
        cache: true,
      });
      q++;
      c++;
      await testCache();
      await prisma.user.update({
        data: {
          posts: {
            create: {
              id: 2,
            },
          },
        },
        where: {
          id: 1,
        },
      });
      q++;
      c--;
      await testCache();
      await prisma.post.findMany({
        cache: true,
      });
      q++;
      c++;
      await testCache();
    },
  );
  await reset(); // recreate the data because we have done write operations

  await t.test(
    "upsert write operation should uncache when automatic uncache is enabled",
    async () => {
      await prisma.user.findMany({
        cache: true,
      });
      q++;
      c++;
      await testCache();
      await prisma.user.upsert({
        create: {
          id: 2,
          string: "updated-string",
        },
        update: {},
        where: {
          id: 2,
        },
      });
      q++;
      c--;
      await testCache();
      await prisma.user.findMany({
        cache: true,
      });
      q++;
      c++;
      await testCache();
    },
  );
  await reset(); // recreate the data because we have done write operations

  await t.test(
    "write operation should not uncache other model when automatic uncache is enabled",
    async () => {
      await prisma.post.findMany({
        cache: true,
      });
      q++;
      c++;
      await testCache();
      await prisma.user.update({
        data: {
          string: "updated-string",
        },
        where: {
          id: 1,
        },
      });
      q++;
      await testCache();
      await prisma.post.findMany({
        cache: true,
      });
      await testCache();
    },
  );
  await reset(); // recreate the data because we have done write operations

  t.todo(
    "custom cache typePrefixes should be used and value should be parseable",
  );
  t.todo("key generation should work with a function provided");

  // RAW QUERIES
  await t.test("queryRawCached should use cache when reused", async () => {
    await prisma.$queryRawCached(
      Prisma.sql`SELECT * FROM "User" WHERE id = ${1}`,
    );
    q++;
    c++;
    await testCache();
    await prisma.$queryRawCached(
      Prisma.sql`SELECT * FROM "User" WHERE id = ${1}`,
    );
    await testCache();
  });
  await t.test(
    "queryRawUnsafeCached should use cache when reused",
    async () => {
      await prisma.$queryRawUnsafeCached(
        `SELECT * FROM "User" WHERE id = ${1}`,
      );
      q++;
      c++;
      await testCache();
      await prisma.$queryRawUnsafeCached(
        `SELECT * FROM "User" WHERE id = ${1}`,
      );
      await testCache();
    },
  );
  t.todo("additional tests for queryRawCached should be implemented");
  t.todo("additional tests for deduplication");
});
