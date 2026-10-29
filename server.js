const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8790);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PARTS_DIR = path.join(__dirname, 'parts');
const BUILD = 'public-binary-backend-20261029-v9';
const MAX_PDF_BYTES = 40 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 24;
const pdfCache = new Map();
const rate = new Map();

function json(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket.remoteAddress || 'unknown';
}
function allowRate(req) {
  const now = Date.now();
  const key = clientIp(req);
  let x = rate.get(key);
  if (!x || now - x.start > 60000) x = {start: now, count: 0};
  x.count++;
  rate.set(key, x);
  return x.count <= 90;
}
function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '0.0.0.0' || ip === '::') return true;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      p[0] >= 224;
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    return s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') ||
      s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb');
  }
  return true;
}
async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('URLが不正です'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('http/https URLのみ対応です');
  if (!u.hostname || /^(localhost|localhost\.|.*\.localhost)$/i.test(u.hostname)) throw new Error('ローカル宛URLは利用できません');
  const addrs = await dns.lookup(u.hostname, {all: true, verbatim: true});
  if (!addrs.length || addrs.some(x => isPrivateIp(x.address))) throw new Error('プライベートIP宛URLは利用できません');
  return u;
}
async function fetchPdf(rawUrl) {
  const cached = pdfCache.get(rawUrl);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublicUrl(current);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 60000);
    let r;
    try {
      r = await fetch(u, {
        redirect: 'manual',
        signal: ctl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TDnetEarningsCompanion/1.0)',
          'Accept': 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.5',
          'Accept-Language': 'ja,en;q=0.8',
        },
      });
    } finally { clearTimeout(timer); }
    if ([301,302,303,307,308].includes(r.status)) {
      const loc = r.headers.get('location');
      if (!loc) throw new Error(`リダイレクト先がありません (HTTP ${r.status})`);
      current = new URL(loc, u).href;
      continue;
    }
    if (!r.ok) throw new Error(`取得先がHTTP ${r.status}を返しました`);
    const len = Number(r.headers.get('content-length') || 0);
    if (len && len > MAX_PDF_BYTES) throw new Error('PDFが40MBを超えています');
    const ab = await r.arrayBuffer();
    if (ab.byteLength > MAX_PDF_BYTES) throw new Error('PDFが40MBを超えています');
    const buf = Buffer.from(ab);
    if (buf.subarray(0,5).toString('ascii') !== '%PDF-') throw new Error('取得結果がPDFではありません');
    const item = {at: Date.now(), buf, finalUrl: current};
    pdfCache.set(rawUrl, item);
    if (pdfCache.size > CACHE_MAX) {
      const oldest = [...pdfCache.entries()].sort((a,b)=>a[1].at-b[1].at)[0]?.[0];
      if (oldest) pdfCache.delete(oldest);
    }
    return item;
  }
  throw new Error('リダイレクト回数が多すぎます');
}
function readIndex() {
  const files = fs.readdirSync(PARTS_DIR).filter(x => /^part\d+\.txt$/.test(x)).sort();
  return Buffer.from(files.map(f => fs.readFileSync(path.join(PARTS_DIR, f), 'utf8')).join(''), 'utf8');
}
function serveStatic(req, res, pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    try {
      const data = readIndex();
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': data.length,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      return res.end(data);
    } catch (e) {
      return json(res, 500, {error:'index build failed: ' + e.message});
    }
  }
  const rel = pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) return json(res, 403, {error:'forbidden'});
  fs.readFile(file, (e, data) => {
    if (e) return json(res, 404, {error:'not found'});
    const ext = path.extname(file).toLowerCase();
    const type = ext === '.js' ? 'text/javascript; charset=utf-8' :
      ext === '.css' ? 'text/css; charset=utf-8' :
      'application/octet-stream';
    res.writeHead(200, {'Content-Type':type,'Content-Length':data.length,'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'});
    res.end(data);
  });
}
const server = http.createServer(async (req, res) => {
  try {
    const base = `http://${req.headers.host || 'localhost'}`;
    const u = new URL(req.url, base);
    if (u.pathname === '/api/health') return json(res, 200, {ok:true, build:BUILD, pdf_proxy:true});
    if (u.pathname === '/api/pdf') {
      if (!allowRate(req)) return json(res, 429, {error:'リクエストが多すぎます'});
      const target = u.searchParams.get('url');
      if (!target) return json(res, 400, {error:'urlが必要です'});
      const item = await fetchPdf(target);
      res.writeHead(200, {
        'Content-Type':'application/pdf',
        'Content-Length':item.buf.length,
        'Cache-Control':'private, max-age=300',
        'X-Content-Type-Options':'nosniff',
        'X-PDF-Source':'server-side-fetch',
        'Access-Control-Expose-Headers':'X-PDF-Source',
      });
      return res.end(item.buf);
    }
    return serveStatic(req, res, u.pathname);
  } catch (e) {
    return json(res, 502, {error: e && e.message ? e.message : String(e)});
  }
});
server.listen(PORT, HOST, () => console.log(`TDnet earnings companion listening on http://${HOST}:${PORT} build=${BUILD}`));
