import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';

const settings = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const localOrigin = new URL(settings.url);
const web = new URL(settings.web);
const api = settings.api ? new URL(settings.api) : web;
const apiPrefixes = settings.apiPrefixes || ['/api'];
export function allowedRequest(headers, origin) {
  if (headers.host !== new URL(origin).host) return false;
  if (headers.origin && headers.origin !== origin) return false;
  if (headers['sec-fetch-site'] && !['same-origin', 'none'].includes(headers['sec-fetch-site'])) return false;
  return true;
}
function destination(url) { return apiPrefixes.some(prefix => url === prefix || url.startsWith(prefix + '/') || url.startsWith(prefix + '?')) ? api : web; }
function upstreamHeaders(req, target) {
  const headers = { ...req.headers, 'accept-encoding': 'identity' };
  if (target === api && settings.mode === 'prod' && api !== web) {
    headers.host = target.host;
    if (headers.origin) headers.origin = target.origin;
    if (headers.referer) headers.referer = target.origin + '/';
  }
  delete headers['x-forwarded-host']; delete headers['x-forwarded-for'];
  headers['x-forwarded-proto'] = target.protocol === 'https:' ? 'https' : 'http';
  return headers;
}
function request(req, target, callback) {
  let pathname = req.url;
  if (target === api && settings.apiStripPrefix) pathname = pathname.replace(/^\/api(?=\/|\?|$)/, '') || '/';
  // Keep the configured upstream even for a path beginning with two slashes.
  const destination = new URL(target); const path = new URL('http://local.invalid' + pathname);
  destination.pathname = path.pathname; destination.search = path.search;
  return (target.protocol === 'https:' ? https : http).request(destination, { method: req.method, headers: upstreamHeaders(req, target), rejectUnauthorized: true }, callback);
}
const label = settings.label || (settings.mode === 'mocks' ? 'Моки' : 'Прод: реальные данные');
const badge = `<div id="codex-local-mode" role="status" style="position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:${settings.mode === 'mocks' ? '#e4f1e7' : '#fff0d5'};color:#212121;border:1px solid #aaa;border-radius:8px;padding:6px 12px;font:13px system-ui;pointer-events:none">${label.replace(/[<>&]/g, '')}</div>`;
const server = http.createServer((req, res) => {
  if (!allowedRequest(req.headers, localOrigin.origin)) { res.writeHead(403); res.end('Local preview accepts only same-origin requests'); return; }
  if (req.url === '/__codex/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ mode: settings.mode, root: settings.root })); return; }
  const target = destination(req.url);
  const upstream = request(req, target, response => {
    const headers = { ...response.headers };
    delete headers['content-length'];
    if (headers['set-cookie']) headers['set-cookie'] = headers['set-cookie'].map(cookie => cookie.replace(/;\s*Domain=[^;]+/ig, ''));
    if (headers.location?.startsWith(target.origin)) headers.location = headers.location.replace(target.origin, localOrigin.origin);
    if (String(headers['content-type']).includes('text/html') && target === web) {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => { const html = Buffer.concat(chunks).toString(); res.writeHead(response.statusCode || 502, headers); res.end(html.includes('</body>') ? html.replace('</body>', badge + '</body>') : html + badge); });
    } else { res.writeHead(response.statusCode || 502, headers); response.pipe(res); }
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Configured local upstream is unavailable'); });
  req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
});
server.on('upgrade', (req, socket, head) => {
  if (!allowedRequest(req.headers, localOrigin.origin)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
  const upstream = request(req, destination(req.url));
  upstream.on('upgrade', (response, remote, remoteHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` + Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n') + '\r\n\r\n');
    if (remoteHead.length) socket.write(remoteHead); if (head.length) remote.write(head);
    socket.pipe(remote); remote.pipe(socket); socket.on('error', () => remote.destroy()); remote.on('error', () => socket.destroy());
  });
  upstream.on('response', response => { socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`); });
  upstream.on('error', () => socket.destroy()); upstream.end();
});
server.listen(localOrigin.port, '127.0.0.1', () => console.log('Local preview: ' + localOrigin.origin));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
