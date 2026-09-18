// Administrative, read-only snapshot of the legacy DeFi schema. No credentials exported.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { output: { type: 'string' } } })
if (!values.output || !process.env.DEFI_DATABASE_URL) throw new Error('Нужны DEFI_DATABASE_URL и --output <private-backup.json>')
const sql = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object(
 'operations', COALESCE((SELECT jsonb_agg(to_jsonb(o) || jsonb_build_object('legs',
   COALESCE((SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object('amount', l.amount::text, 'fiat_value', l.fiat_value::text, 'unit_price', l.unit_price::text) ORDER BY l.position) FROM operation_legs l WHERE l.operation_id = o.id), '[]'::jsonb)) ORDER BY o.occurred_at, o.created_at, o.id) FROM operations o), '[]'::jsonb),
 'assets', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM assets a), '[]'::jsonb),
 'locations', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM locations l), '[]'::jsonb),
 'networks', COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM networks n), '[]'::jsonb),
 'auditEvents', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM audit_events a), '[]'::jsonb),
 'syncSources', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM sync_sources s), '[]'::jsonb),
 'syncRuns', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM sync_runs s), '[]'::jsonb),
 'externalRecords', COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM external_records e), '[]'::jsonb),
 'settings', COALESCE((SELECT jsonb_object_agg(key,value) FROM app_settings WHERE key IN ('base_currency','timezone','number_format')), '{}'::jsonb)
);
COMMIT;`
const connection = new URL(process.env.DEFI_DATABASE_URL)
if (!['postgres:', 'postgresql:'].includes(connection.protocol)) throw new Error('Нужен PostgreSQL URL')
const optionEnv = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', connect_timeout: 'PGCONNECT_TIMEOUT' }
const env = { ...process.env, PGDATABASE: decodeURIComponent(connection.pathname.slice(1)), PGHOST: connection.hostname, PGPORT: connection.port || '5432', PGUSER: decodeURIComponent(connection.username), PGPASSWORD: decodeURIComponent(connection.password) }
for (const [key,value] of connection.searchParams) {
  if (!optionEnv[key]) throw new Error(`Неподдерживаемый параметр PostgreSQL URL: ${key}`)
  env[optionEnv[key]] = value
}
const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env })
if (result.status !== 0) throw new Error('Не удалось получить read-only снимок defi; проверьте доступ и версию схемы')
const raw = JSON.parse(result.stdout)
const row = value => Object.fromEntries(Object.entries(value).map(([key,v]) => {
  const camel = key.replace(/_([a-z])/g, (_,c) => c.toUpperCase())
  return [camel, camel.endsWith('At') && v ? new Date(v).toISOString() : v]
}))
const operations = raw.operations.map(operation => {
  const value = row(operation)
  const legs = operation.legs.map(leg => Object.fromEntries(Object.entries(row(leg)).filter(([k,v]) => k !== 'operationId' && v !== null)))
  return { ...Object.fromEntries(Object.entries(value).filter(([k,v]) => k !== 'legs' && (v !== null || k === 'archivedAt'))), legs }
})
const backup = {
  schemaVersion: 2, exportedAt: new Date().toISOString(), operations,
  references: { assets: raw.assets, locations: raw.locations, networks: raw.networks },
  settings: { baseCurrency: raw.settings.base_currency ?? 'RUB', timezone: raw.settings.timezone ?? 'Asia/Bangkok', ...(raw.settings.number_format ? { numberFormat: raw.settings.number_format } : {}) },
  ...Object.fromEntries(['auditEvents','syncSources','syncRuns','externalRecords'].map(key => [key, raw[key].map(row)])),
}
writeFileSync(values.output, JSON.stringify(backup, null, 2), { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ exported: true, operations: operations.length, auditEvents: backup.auditEvents.length, externalRecords: backup.externalRecords.length }))
