import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuration } from '../dist/config.js';
import { initialize } from '../dist/mcp/runtime.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');
const uiDir = join(root, 'ui');

const config = configuration({
  RP_DATA_DIR: join(root, 'data'),
  RP_TIMEOUT_MS: '2000'
});

const r = initialize(config);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(payload, null, 2));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Handle API routes
  if (pathname.startsWith('/api/')) {
    try {
      if (req.method === 'POST' && pathname === '/api/fault') {
        const body = await readBody(req);
        if (body.fault) {
          await r.issue.call('lab_set_fault', { fault: body.fault });
        }
        return sendJson(res, 200, { ok: true, fault: body.fault });
      }

      if (req.method === 'POST' && pathname === '/api/start') {
        const body = await readBody(req);
        const result = await r.engine.start(body.request_id, body.title, body.body || '');
        return sendJson(res, 200, result);
      }

      if (req.method === 'POST' && pathname === '/api/resume') {
        const body = await readBody(req);
        const result = await r.engine.resume(body.request_id);
        return sendJson(res, 200, result);
      }

      if (req.method === 'GET' && pathname === '/api/receipt') {
        const requestId = url.searchParams.get('request_id');
        if (!requestId) return sendJson(res, 400, { error: 'Missing request_id parameter' });
        const result = await r.engine.status(requestId);
        return sendJson(res, 200, result);
      }

      if (req.method === 'GET' && pathname === '/api/records') {
        const issueRes = await r.issue.call('lab_list_records', {}).catch(() => ({ records: [] }));
        const trackRes = await r.tracking.call('lab_list_records', {}).catch(() => ({ records: [] }));
        return sendJson(res, 200, {
          issues: issueRes.records || [],
          tracking: trackRes.records || []
        });
      }

      return sendJson(res, 404, { error: 'Endpoint not found' });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  }

  // Serve static UI assets
  let filePath = pathname === '/' ? join(uiDir, 'index.html') : join(uiDir, pathname);
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('404 Not Found');
  }

  const ext = extname(filePath);
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mimeType });
  res.end(readFileSync(filePath));
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`RetryProof UI Server running at: http://127.0.0.1:${PORT}`);
});

process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await r.close();
  server.close(() => process.exit(0));
});
