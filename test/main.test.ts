import { Prisma, PrismaClient } from '@prisma/client';
import { Metrics } from '@prisma/client/runtime/library';
import * as cm from 'cache-manager';
import assert from 'node:assert';
import test from 'node:test';
import cacheExtension, { generateComposedKey } from '../src';
import { READ_OPERATIONS } from '../src/types';

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

test('cacheExtension', { only: true }, async (t) => {
  const defaultTtl = 100;
  const cache = await cm.caching('memory', {
    ttl: defaultTtl,
  });

  // regenerate client to reset metrics
  const getClient = () => new PrismaClient().$extends(cacheExtension({ cache }));

  let prisma = getClient();
  assert(prisma.$cache === cache);
  // db queries count
  const queries = async (): Promise<number | undefined> =>
    ((await (prisma as any).$metrics.json()) as Metrics).counters.find(
      (x: any) => x.key === 'prisma_client_queries_total'
    )?.value;
  // expected db query count
  let q = 0;
  // expected cache size
  let c = 0;

  // reset client and cache before each test
  t.beforeEach(async () => {
    prisma = getClient();
    await cache.reset();
    q = 0;
    c = 0;
  });

  const testCache = async () => {
    const qq = await queries();
    const cc = cache.store.size;
    assert.equal(qq, q, `queries mismatch: ${(qq || 0) - q}`);
    assert.equal(cc, c, `cache mismatch: ${cc - c}`);
  };
  const insert = {
    string: 'string',
    decimal: new Prisma.Decimal('10.44'),
    bigint: BigInt('1283231897'),
    float: 321.84784,
    timestamp: new Date(),
    bytes: Buffer.from('o21ijferve9ir3'),
  };
  // clear table
  await prisma.$executeRaw`delete from "User"`;
  const user = await prisma.user.create({
    data: insert,
  });

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
            not: new Prisma.Decimal('10.99'),
          },
        },
      ],
    },
    orderBy: {
      timestamp: 'desc',
    },
  } satisfies Prisma.UserFindManyArgs;

  // t.runOnly(true);

  await t.test('every read model operation', async () => {
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
      by: 'id',
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

  await t.test('value matching', async () => {
    const key = 'key';
    const arg = {
      ...args,
      cache: {
        key,
      },
    };
    const d1 = await prisma.user.findMany(arg);
    q++;
    c++;
    await testCache();
    const d2 = await prisma.user.findMany(arg);
    const d3: typeof d2 = (await cache.get(key))!;
    await testCache();
    assert(d3);
    assert.deepEqual(d1, d2);
    assert.deepEqual(d1, d3);
  });

  await t.test('key generation', async () => {
    const hashingData = { model: 'User', operation: 'findMany', queryArgs: args };
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
        decimal: new Prisma.Decimal('1.1213'),
        bytes: Buffer.from('123'),
        timestamp: new Date(now),
      },
      cache: true,
    });
    await prisma.user.count({
      where: {
        decimal: new Prisma.Decimal('1.1213'),
        bytes: Buffer.from('123'),
        timestamp: new Date(now),
      },
      cache: true,
    });
    c++;
    q++;
    await testCache();
  });

  await t.test('no cache', async () => {
    await prisma.user.findMany({ cache: false });
    q++;
    await testCache();
  });

  await t.test(
    'same args different operation should use different key',
    async () => {
      await prisma.user.findMany({ ...args, cache: true });
      await prisma.user.count({ ...args, cache: true });
      q += 2;
      c += 2;
      await testCache();
    }
  );

  await t.test('same args different cache options', async () => {
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
        key: 'different-key',
      },
    });
    // cache miss
    await prisma.user.count({
      ...args,
      cache: {
        ttl: 100,
        namespace: 'different-key',
      },
    });
    q += 3;
    c += 3;
    await testCache();
  });

  await t.test('default ttl', async () => {
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

  await t.test('custom ttl', async () => {
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

  await t.test('shortened ttl should still use cache', async () => {
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

  await t.test('expired ttl should should not have cache', async () => {
    const ttl = 400;
    await prisma.user.count({
      cache: ttl,
    });
    q++;
    c++;
    await testCache();
    await sleep(ttl);
    c--;
    await testCache();
  });

  await t.test('custom cache keys for provided namespace', async () => {
    const hashingDataWithout = { model: 'User', operation: 'findMany', queryArgs: args };
    await prisma.user.findMany({
      ...args, cache: true
    });
    const keyWithout = generateComposedKey(hashingDataWithout);
    assert(!keyWithout.startsWith('test:'), `invalid key: ${keyWithout}`);
    assert(await cache.get(keyWithout));
    q++;
    c++;
    await testCache();
    // Now with namespace
    const hashingData = { model: 'User', operation: 'findMany', namespace: 'test', queryArgs: args };
    await prisma.user.findMany({
      ...args, cache: {
        namespace: 'test',
      }
    });
    const key = generateComposedKey(hashingData);
    assert(key.startsWith('test:'), `invalid key: ${key}`);
    assert(await cache.get(key));
    q++;
    c++;
    await testCache();
  });

  t.todo('write operation should uncache');
  t.todo('key generation should work as a function');
});