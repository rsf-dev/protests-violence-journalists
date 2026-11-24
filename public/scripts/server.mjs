import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const root = projectRoot;
const port = Number(process.env.PORT || 4177);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.md': 'text/plain; charset=utf-8',
};
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  const sendHTML = (status, body) => {
    const csp = body
      .toString('utf8')
      .match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
    res.writeHead(status, {
      'Content-Type': mime['.html'],
      'Cache-Control': 'no-cache',
      ...(csp ? { 'Content-Security-Policy': csp } : {}),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let target = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, target);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      relative.split(path.sep).some((part) => part.startsWith('.'))
    ) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    const body = await readFile(target);
    if (path.extname(target) === '.html') {
      sendHTML(200, body);
      return;
    }
    const version = new URL(req.url, 'http://localhost').searchParams.get('v');
    res.writeHead(200, {
      'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': /^[a-f0-9]{16}$/.test(version || '')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    if (req.headers.accept?.includes('text/html')) {
      sendHTML(
        404,
        Buffer.from(
          '<!doctype html><html lang="fr"><meta charset="utf-8"><title>Page introuvable</title><p>Page introuvable.</p></html>',
        ),
      );
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});
server.listen(port, '127.0.0.1', () => console.log(`News City POC · http://127.0.0.1:${port}/`));
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
