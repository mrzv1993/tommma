import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { PrismaClient } from '@prisma/client'
import { backupSchema } from './shared/backup.js'
import { migrateCapital, payloadDigest } from './migration.js'

const { values } = parseArgs({ options: { input: { type: 'string' }, owner: { type: 'string' }, apply: { type: 'boolean' }, 'expected-digest': { type: 'string' } } })
if (!values.input || !values.owner || !/^\d+$/.test(values.owner) || !process.env.DATABASE_URL) throw new Error('Нужны DATABASE_URL, --input <backup.json>, --owner <Tommma user ID>. По умолчанию dry-run с откатом.')
const payload = backupSchema.parse(JSON.parse(readFileSync(values.input, 'utf8')))
if (values.apply && values['expected-digest'] !== payloadDigest(payload)) throw new Error('Для --apply нужен --expected-digest из успешного dry-run этого файла')
const prisma = new PrismaClient()
try { console.log(JSON.stringify(await migrateCapital(prisma, BigInt(values.owner), payload, values.apply), null, 2)) }
catch (error) { console.error(error instanceof Error ? error.message : 'Перенос отменён'); process.exitCode = 1 }
finally { await prisma.$disconnect() }
