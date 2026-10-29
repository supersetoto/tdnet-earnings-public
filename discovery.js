'use strict';
// Candidate discovery never supplies financial amounts to the parser.
const HINTS={
  '6902':{company:'デンソー',ir:'https://www.denso.com/jp/ja/investors/settlement/',xj:'AS04353'},
  '7282':{company:'豊田合成',ir:'https://www.toyoda-gosei.co.jp/ir/document/accounts_data/'},
  '6471':{company:'日本精工',ir:'https://www.nsk.com/jp-ja/company/investors/financial-announcements/',html:true},
  '7269':{company:'スズキ',ir:'https://www.suzuki.co.jp/ir/library/financialaffairs/',html:true},
};
const CONFIRMED={
  '6902|27/3|Q2':'https://www.release.tdnet.info/inbs/140120261027556975.pdf',
  '7282|27/3|Q2':'https://ssl4.eir-parts.net/doc/7282/tdnet/2900070/00.pdf',
  '7282|27/3|Q1':'https://ssl4.eir-parts.net/doc/7282/tdnet/2859001/00.pdf',
};
const n=s=>String(s||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const strip=s=>n(s.replace(/<[^>]*>/g,' ').replace(/&#x([a-f0-9]+);/gi,(_,s)=>String.fromCodePoint(parseInt(s,16))).replace(/&#(\d+);/g,(_,s)=>String.fromCodePoint(Number(s))).replace(/&amp;/g,'&').replace(/&nbsp;/g,' '));
const date=s=>String(s||'').slice(0,10).replace(/\//g,'-');
const samePeriod=(title,fy,q)=>{const [y,m]=fy.split('/').map(Number),t=n(title).replace(/\s/g,'');return t.includes(`${y<100?y+2000:y}年${m}月期`)&&/決算短信/.test(t)&&!/(一部訂正|訂正に関する|英文|English)/i.test(t)&&(q==='Q1'?/第1四半期/.test(t):q==='Q2'?/第2四半期|中間期/.test(t):q==='Q3'?/第3四半期/.test(t):!/第[123]四半期|中間期/.test(t));};
function createDiscovery(readText){
  const cache=new Map();
  async function cached(key,fn){const c=cache.get(key);if(c&&Date.now()-c.at<300000)return c.value;const value=await fn();cache.set(key,{value,at:Date.now()});if(cache.size>80)cache.delete(cache.keys().next().value);return value;}
  async function official(ticker){return cached('official:'+ticker,async()=>{
    const hint=HINTS[ticker]||{},sources=[],docs=[],errors=[];
    if(hint.html){
      try{const html=await readText(hint.ir);let period='',quarter='';
        for(const token of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)){
          if(token[1]){const heading=strip(token[2]),match=heading.match(/(20\d{2})年\s*(\d+)月期/);if(match){period=`${match[1]}年${Number(match[2])}月期`;quarter='';}const qq=heading.match(/第[123]四半期|中間期/);if(qq)quarter=qq[0];continue;}
          const title=strip(token[4]);if(!/\.pdf(?:$|\?)/i.test(token[3])||!/決算短信/.test(title)||/一部訂正|訂正に関する/.test(title)||!period)continue;
          const full=`${period} ${/第[123]四半期|中間期/.test(title)?'':quarter} ${title}`;
          docs.push({ticker,company:hint.company,title:full,url:new URL(token[3].replace(/&amp;/g,'&'),hint.ir).href,date:'',source:'会社公式IR',source_page:hint.ir});
        }sources.push(hint.ir);
      }catch(e){errors.push(e.message);}
    }else if(hint.xj){
      const url=`https://www.xj-storage.jp/public-list/GetList2.aspx?company=${hint.xj}&len=1000&output=json`;
      try{const j=JSON.parse(await readText(url));for(const i of j.items||[])for(const f of i.files||[])if(/pdf/i.test(f.type||f.url))docs.push({title:n(i.title),url:f.url,date:date(i.publishDate),source:'会社公式IR（XJ Storage）',source_page:hint.ir,ticker,company:hint.company});sources.push(url);}catch(e){errors.push(e.message);}
    }else{
      const url=`https://ssl4.eir-parts.net/V4Public/EIR/${ticker}/ja/announcement/announcement_1.js`;
      try{const raw=await readText(url),j=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));if(j.header?.[0]?.customer_code!==ticker)throw Error('IR配信銘柄の不一致');for(const i of j.item||[])if(i.link&&/\.pdf(?:$|\?)/i.test(i.link))docs.push({title:n(i.title),url:i.link,date:date(i.date),source:'会社公式IR（EIR）',source_page:hint.ir||url,ticker,company:hint.company||''});sources.push(url);}catch(e){errors.push(e.message);}
    }
    return {docs,sources,errors};
  });}
  async function tdnet(day){return cached('tdnet:'+day,async()=>{
    const ymd=day.replace(/-/g,''),root='https://www.release.tdnet.info/inbs/',first=`${root}I_list_001_${ymd}.html`,html=await readText(first);
    if(!/kjCode/.test(html))throw Error('TDnet日次一覧を確認できません');
    const links=[...new Set([...html.matchAll(new RegExp(`I_list_\\d{3}_${ymd}\\.html`,'g'))].map(m=>m[0]))];
    if(links.length>30)throw Error('TDnetのページ数が上限を超えました');
    const pages=[{url:first,html}];
    // Every page must be read before a negative result can be trusted.
    for(let at=0;at<links.length;at+=4){const batch=links.slice(at,at+4).filter(x=>root+x!==first);const more=await Promise.all(batch.map(async p=>({url:root+p,html:await readText(root+p)})));pages.push(...more);}
    const docs=[];
    for(const p of pages){if(!/kjCode/.test(p.html))throw Error('TDnetの一部ページを確認できません');}
    for(const p of pages)for(const m of p.html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const row=m[1],ticker=strip(row.match(/<td[^>]*class="[^"]*kjCode[^"]*"[^>]*>([\s\S]*?)<\/td>/i)?.[1]||'').replace(/0$/,'');
      const titleCell=row.match(/<td[^>]*class="[^"]*kjTitle[^"]*"[^>]*>([\s\S]*?)<\/td>/i)?.[1]||'',link=titleCell.match(/href="([^"]+\.pdf)"/i)?.[1];
      if(!link||!ticker)continue;docs.push({ticker,title:strip(titleCell),company:strip(row.match(/<td[^>]*class="[^"]*kjName[^"]*"[^>]*>([\s\S]*?)<\/td>/i)?.[1]||''),url:new URL(link,root).href,date:day,source:'TDnet',source_page:p.url});
    }
    return {docs,sources:pages.map(p=>p.url),complete:true};
  });}
  async function sources(input){
    const ticker=String(input.ticker||'').toUpperCase(),fy=input.fiscal_year,q=input.quarter;
    if(!/^(?:\d{4}|\d{3}[A-Z])$/.test(ticker)||!/^\d{2,4}\/\d{1,2}$/.test(fy)||!/^Q[1-4]$/.test(q))throw Error('銘柄コード・決算期・Qを確認してください');
    const o=await official(ticker),hint=HINTS[ticker]||{},docs=[...o.docs],selected={},candidates={},targets=[['current',fy,q]];
    if(q!=='Q1')targets.push(['previous_quarter',fy,{Q2:'Q1',Q3:'Q2',Q4:'Q3'}[q]]);
    const skip=new Set(input.manual_keys||[]);
    for(const [key,period,quarter] of targets){
      if(skip.has(key))continue;
      const known=CONFIRMED[`${ticker}|${period}|${quarter}`];
      const found=docs.filter(d=>samePeriod(d.title,period,quarter)).sort((a,b)=>b.date.localeCompare(a.date));
      if(known&&!found.some(d=>d.url===known))found.unshift({ticker,company:hint.company||'',title:`${period} ${quarter} 決算短信（本文確認前）`,url:known,source:'指定資料候補'});
      candidates[key]=found;if(found[0])selected[key]=found[0];
    }
    if(!selected.current&&!skip.has('current')){
      const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
      try{const t=await tdnet(today);const found=t.docs.filter(d=>d.ticker===ticker&&samePeriod(d.title,fy,q));if(found.length){candidates.current=found;selected.current=found[0];docs.push(...found);}}catch{}
    }
    return {ticker,company:hint.company||selected.current?.company||'',fiscal_year:fy,quarter:q,selected,candidates,ir_documents:docs,ir_root:hint.ir||'',related_disclosures:[],discovery_sources:o.sources,discovery_errors:o.errors};
  }
  async function disclosures(ticker,day){
    if(!/^(?:\d{4}|\d{3}[A-Z])$/.test(ticker)||!/^20\d{2}-\d{2}-\d{2}$/.test(day))throw Error('同日開示の検索条件が不正です');
    const o=await official(ticker);let result,errors=[...o.errors];
    try{result=await tdnet(day);}catch(e){errors.push(e.message);}
    const docs=[...o.docs.filter(d=>d.date===day),...(result?.docs||[]).filter(d=>d.ticker===ticker)];
    const unique=[...new Map(docs.map(d=>[d.title,d])).values()];
    return {docs:unique,complete:!!result?.complete,sources:[...o.sources,...(result?.sources||[])],errors};
  }
  return {sources,disclosures};
}
module.exports={createDiscovery,HINTS,samePeriod};
