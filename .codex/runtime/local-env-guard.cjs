// Used only by the owned local launcher. Never loaded by a production build.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { syncBuiltinESMExports } = require('node:module');

function envFile(file) {
  if (typeof file !== 'string' && !(file instanceof URL)) return false;
  const name = path.basename(file instanceof URL ? file.pathname : file);
  return name === '.env' || name.startsWith('.env.');
}
function absent() { return Object.assign(new Error('Local workflow does not load project env files'), { code: 'ENOENT' }); }
for (const name of ['readFileSync', 'statSync', 'accessSync']) {
  const original = fs[name];
  fs[name] = function(file, ...args) { if (envFile(file)) throw absent(); return original.call(this, file, ...args); };
}
const exists = fs.existsSync;
fs.existsSync = function(file) { return envFile(file) ? false : exists.call(this, file); };
const read = fs.readFile;
fs.readFile = function(file, ...args) {
  if (!envFile(file)) return read.call(this, file, ...args);
  queueMicrotask(() => args.at(-1)(absent()));
};
for (const name of ['readFile', 'stat', 'access']) {
  const original = fs.promises[name];
  fs.promises[name] = async function(file, ...args) { if (envFile(file)) throw absent(); return original.call(this, file, ...args); };
}
syncBuiltinESMExports();

if (process.env.CODEX_LOCAL_DATA_MODE === 'mocks') {
  const loopback = host => ['localhost', '127.0.0.1', '::1'].includes(String(host).replace(/^\[|\]$/g, ''));
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function(...args) {
    let value = args[0];
    if (Array.isArray(value)) value = value[0];
    if (typeof value === 'object' && !value.path && !loopback(value.host || 'localhost')) throw new Error('Mock runtime blocks external network connections');
    if (typeof value === 'number' && typeof args[1] === 'string' && !loopback(args[1])) throw new Error('Mock runtime blocks external network connections');
    return connect.apply(this, args);
  };
  const fetch = globalThis.fetch;
  globalThis.fetch = async function(input, options) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (loopback(url.hostname)) return fetch(input, options);
    // No real credentials or message bodies enter the local outbox.
    if (process.env.CODEX_LOCAL_OUTBOX) fs.appendFileSync(process.env.CODEX_LOCAL_OUTBOX, JSON.stringify({ host: url.hostname, method: options?.method || 'GET', simulated: true }) + '\n', { mode: 0o600 });
    if (url.hostname === 'api.resend.com') return Response.json({ id: 'mock-email' });
    if (url.hostname === 'api.telegram.org') return Response.json({ ok: true, result: { message_id: 1 } });
    if (url.hostname === 'api.openai.com' && url.pathname.endsWith('/audio/transcriptions')) return Response.json({ text: 'Тестовая расшифровка' });
    throw new Error('No mock adapter for external provider: ' + url.hostname);
  };
}

module.exports = { envFile };
