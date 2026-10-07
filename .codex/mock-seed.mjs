import { createRequire } from 'node:module';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcrypt');
const url = new URL(process.env.DATABASE_URL);
if (process.env.CODEX_LOCAL_DATA_MODE !== 'mocks' || url.hostname !== '127.0.0.1' || !url.pathname.endsWith('_dev')) throw new Error('Synthetic user seed requires the owned mock database');
const db = new PrismaClient();
try {
  await db.user.upsert({ where: { email: 'mock@example.test' }, update: {}, create: { email: 'mock@example.test', nickname: 'Моки', passwordHash: await hash('mock-password', 12), emailVerifiedAt: new Date() } });
} finally { await db.$disconnect(); }
