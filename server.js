const http=require('http');
const dns=require('dns').promises;
const net=require('net');

const HOST=process.env.HOST||'0.0.0.0';
const PORT=Number(process.env.PORT||8790);
const BUILD='public-binary-backend-20261029-v9';
const MAX_PDF_BYTES=40*1024*1024;
const MAX_REDIRECTS=5;
const CACHE_TTL_MS=10*60*1000;
const CACHE_MAX=24;
const pdfCache=new Map();
const rate=new Map();

function json(res,status,obj){
  const body=Buffer.from(JSON.stringify(obj));
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'});
  res.end(body);
}
function clientIp(req){
  const xf=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
  return xf||req.socket.remoteAddress||'unknown';
}
function allowRate(req){
  const now=Date.now(),key=clientIp(req);
  let x=rate.get(key);
  if(!x||now-x.start>60000)x={start:now,count:0};
  x.count++;rate.set(key,x);
  return x.count<=90;
}
function isPrivateIp(ip){
  if(!ip)return true;
  if(ip==='::1'||ip==='0.0.0.0'||ip==='::')return true;
  if(ip.startsWith('::ffff:'))ip=ip.slice(7);
  if(net.isIPv4(ip)){
    const p=ip.split('.').map(Number);
    return p[0]===10||p[0]===127||p[0]===0||
      (p[0]===169&&p[1]===254)||
      (p[0]===172&&p[1]>=16&&p[1]<=31)||
      (p[0]===192&&p[1]===168)||
      (p[0]===100&&p[1]>=64&&p[1]<=127)||p[0]>=224;
  }
  if(net.isIPv6(ip)){
    const s=ip.toLowerCase();
    return s.startsWith('fc')||s.startsWith('fd')||s.startsWith('fe8')||s.startsWith('fe9')||s.startsWith('fea')||s.startsWith('feb');
  }
  return true;
}
async function assertPublicUrl(raw){
  let u;
  try{u=new URL(raw);}catch{throw new Error('URLが不正です');}
  if(!['http:','https:'].includes(u.protocol))throw new Error('http/https URLのみ対応です');
  if(!u.hostname||/^(localhost|localhost\.|.*\.localhost)$/i.test(u.hostname))throw new Error('ローカル宛URLは利用できません');
  const addrs=await dns.lookup(u.hostname,{all:true,verbatim:true});
  if(!addrs.length||addrs.some(x=>isPrivateIp(x.address)))throw new Error('プライベートIP宛URLは利用できません');
  return u;
}
async function fetchPdf(rawUrl){
  const cached=pdfCache.get(rawUrl);
  if(cached&&Date.now()-cached.at<CACHE_TTL_MS)return cached;
  let current=rawUrl;
  for(let hop=0;hop<=MAX_REDIRECTS;hop++){
    const u=await assertPublicUrl(current);
    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),60000);
    let r;
    try{
      r=await fetch(u,{redirect:'manual',signal:ctl.signal,headers:{
        'User-Agent':'Mozilla/5.0 (compatible; TDnetEarningsCompanion/1.0)',
        'Accept':'application/pdf,application/octet-stream;q=0.9,*/*;q=0.5',
        'Accept-Language':'ja,en;q=0.8'
      }});
    }finally{clearTimeout(timer);}
    if([301,302,303,307,308].includes(r.status)){
      const loc=r.headers.get('location');
      if(!loc)throw new Error(`リダイレクト先がありません (HTTP ${r.status})`);
      current=new URL(loc,u).href;continue;
    }
    if(!r.ok)throw new Error(`取得先がHTTP ${r.status}を返しました`);
    const len=Number(r.headers.get('content-length')||0);
    if(len&&len>MAX_PDF_BYTES)throw new Error('PDFが40MBを超えています');
    const ab=await r.arrayBuffer();
    if(ab.byteLength>MAX_PDF_BYTES)throw new Error('PDFが40MBを超えています');
    const buf=Buffer.from(ab);
    if(buf.subarray(0,5).toString('ascii')!=='%PDF-')throw new Error('取得結果がPDFではありません');
    const item={at:Date.now(),buf,finalUrl:current};
    pdfCache.set(rawUrl,item);
    if(pdfCache.size>CACHE_MAX){
      const oldest=[...pdfCache.entries()].sort((a,b)=>a[1].at-b[1].at)[0]?.[0];
      if(oldest)pdfCache.delete(oldest);
    }
    return item;
  }
  throw new Error('リダイレクト回数が多すぎます');
}
const HOME=`<!doctype html><meta charset="utf-8"><title>TDnet Earnings PDF Backend</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:60px auto;padding:0 20px;line-height:1.7}code{background:#f2f4f7;padding:2px 5px;border-radius:4px}input{width:100%;padding:10px}button{margin-top:10px;padding:10px 16px}</style>
<h1>TDnet 決算PDFバックエンド</h1>
<p>稼働中です。PDF URLをサーバー側で取得し、生PDFを返します。</p>
<p><code>/api/health</code> / <code>/api/pdf?url=&lt;PDF_URL&gt;</code></p>
<input id="u" value="https://www.release.tdnet.info/inbs/140120261027556975.pdf">
<button onclick="location.href='/api/pdf?url='+encodeURIComponent(u.value)">デンソーPDF取得テスト</button>`;
const server=http.createServer(async(req,res)=>{
  try{
    const base=`http://${req.headers.host||'localhost'}`;
    const u=new URL(req.url,base);
    if(u.pathname==='/api/health')return json(res,200,{ok:true,build:BUILD,pdf_proxy:true});
    if(u.pathname==='/api/pdf'){
      if(!allowRate(req))return json(res,429,{error:'リクエストが多すぎます'});
      const target=u.searchParams.get('url');
      if(!target)return json(res,400,{error:'urlが必要です'});
      const item=await fetchPdf(target);
      res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':item.buf.length,'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff','X-PDF-Source':'server-side-fetch','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'X-PDF-Source'});
      return res.end(item.buf);
    }
    if(u.pathname==='/'){
      const body=Buffer.from(HOME);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-cache'});
      return res.end(body);
    }
    return json(res,404,{error:'not found'});
  }catch(e){return json(res,502,{error:e&&e.message?e.message:String(e)});}
});
server.listen(PORT,HOST,()=>console.log(`TDnet earnings PDF backend listening on ${HOST}:${PORT} build=${BUILD}`));
