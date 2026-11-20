// Static server for src/ (from the Baiboly app). Run a build:* script first so that
// src/config.js exists.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 3000;
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const filePath = path.join(SRC, pathname === '/' ? '/index.html' : pathname);
  if (!filePath.startsWith(SRC + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'text/plain',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

// Local network IP for phone testing
function getLocalIP() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const info of iface) {
      if (info.family === 'IPv4' && !info.internal) return info.address;
    }
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  iPass Badge Check dev server:\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Phone:   http://${getLocalIP()}:${PORT}\n`);
});
