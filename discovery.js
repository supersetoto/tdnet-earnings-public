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
function inferPeriod(title){const t=n(title),m=t.match(/(20\d{2})年\s*(\d+)月期/);return m?{fy:`${m[1].slice(-2)}/${Number(m[2])}`,q:/第1四半期/.test(t)?'Q1':/第2四半期|中間期/.test(t)?'Q2':/第3四半期/.test(t)?'Q3':'Q4'}:null;}
function presentationFor(d,fy,q){return d.fiscal_year===fy&&d.quarter===q&&/説明.*資料|説明.*決算|決算説明|決算.*参考|決算.*補足/.test(d.title)&&!/短信|動画|質疑|English|英文/i.test(d.title);}
function htmlDocuments(html,root,ticker,company){let period='',quarter='';const docs=[];
  for(const token of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    if(token[1]){const h=strip(token[2]),m=h.match(/(20\d{2})年\s*(\d+)月期/);if(m){period=`${m[1]}年${Number(m[2])}月期`;quarter='';}const q=h.match(/第[123]四半期|中間期/);if(q)quarter=q[0];continue;}
    const label=strip(token[4]),href=token[3];if(!/\.pdf(?:$|\?)/i.test(href)||!/決算|説明資料/.test(label)||/一部訂正|訂正に関する|動画/.test(label))continue;
    const url=new URL(href.replace(/&amp;/g,'&'),root).href;
    const full=/20\d{2}年\s*\d+月期/.test(label)?label:`${period} ${/第[123]四半期|中間期/.test(label)?'':quarter} ${label}`;
    const per=inferPeriod(full);docs.push({ticker,company,title:full,url,date:'',fiscal_year:per?.fy,quarter:per?.q,source:'登録した会社IR',source_page:root,officialLinked:true});
  }return docs;
}
function createDiscovery(readText){
  const cache=new Map();
  async function cached(key,fn){const c=cache.get(key);if(c&&Date.now()-c.at<300000)return c.value;const value=await fn();cache.set(key,{value,at:Date.now()});if(cache.size>80)cache.delete(cache.keys().next().value);return value;}
  async function official(ticker,registeredRoot='',companyHint=''){return cached('official:'+ticker+':'+registeredRoot,async()=>{
    const hint={...(HINTS[ticker]||{})},sources=[],docs=[],errors=[];
    if(companyHint)hint.company=companyHint;
    if(registeredRoot){const u=new URL(registeredRoot);if(!/^https?:$/.test(u.protocol)||u.username||u.password)throw Error('IRサイトのURLを確認してください');hint.ir=u.href;
      try{const html=await readText(hint.ir);sources.push(hint.ir);docs.push(...htmlDocuments(html,hint.ir,ticker,hint.company||''));
        const xj=html.match(/xj-storage\.jp\/resources\/([A-Z]{2}\d+)/i)||html.match(/company[=:]['"]?([A-Z]{2}\d+)/i);if(xj)hint.xj=xj[1];
        if(!xj&&docs.some(d=>/決算短信/.test(d.title)))return {docs,sources,errors};
      }catch(e){errors.push(e.message);}
    }
    if(hint.html){
      try{const html=await readText(hint.ir);docs.push(...htmlDocuments(html,hint.ir,ticker,hint.company||''));sources.push(hint.ir);}catch(e){errors.push(e.message);}
    }else if(hint.xj){
      const url=`https://www.xj-storage.jp/public-list/GetList2.aspx?company=${hint.xj}&len=1000&output=json`;
      try{const j=JSON.parse(await readText(url));for(const i of j.items||[])for(const f of i.files||[])if(/pdf/i.test(f.type||f.url)){const per=inferPeriod(i.title);docs.push({title:n(i.title),url:f.url,date:date(i.publishDate),fiscal_year:per?.fy,quarter:per?.q,source:'会社公式IR（XJ Storage）',source_page:hint.ir,ticker,company:hint.company,officialLinked:true});}sources.push(url);}catch(e){errors.push(e.message);}
    }else{
      const url=`https://ssl4.eir-parts.net/V4Public/EIR/${ticker}/ja/announcement/announcement_1.js`;
      try{const raw=await readText(url),j=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));if(j.header?.[0]?.customer_code!==ticker)throw Error('IR配信銘柄の不一致');for(const i of j.item||[])if(i.link&&/\.pdf(?:$|\?)/i.test(i.link)){const meta=/^20\d{4}$/.test(i.fiscal_ym)?{fy:`${i.fiscal_ym.slice(2,4)}/${Number(i.fiscal_ym.slice(4))}`,q:Number(i.quarter)===0?'Q4':`Q${i.quarter}`}:inferPeriod(i.title);docs.push({title:n(i.title),url:i.link,date:date(i.date),fiscal_year:meta?.fy,quarter:meta?.q,source:'会社公式IR（EIR）',source_page:hint.ir||url,ticker,company:hint.company||'',officialLinked:true});}sources.push(url);}catch(e){errors.push(e.message);}
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
    const ticker=String(input.ticker||'').toUpperCase();let fy=input.fiscal_year,q=input.quarter;
    if(!/^(?:\d{4}|\d{3}[A-Z])$/.test(ticker))throw Error('銘柄コードを確認してください');
    const o=await official(ticker,input.official_url_hint||'',input.company_hint||''),hint=HINTS[ticker]||{},docs=[...o.docs],selected={},candidates={},materials={};
    if(input.latest){const latest=docs.filter(d=>/決算短信/.test(d.title)&&!/(一部訂正|訂正に関する|英文|English)/i.test(d.title)).map(d=>({d,p:inferPeriod(d.title)})).filter(x=>x.p).sort((a,b)=>{const k=p=>{const [y,m]=p.fy.split('/').map(Number);return y*1000+m*10+Number(p.q.slice(1));};return k(b.p)-k(a.p)||b.d.date.localeCompare(a.d.date);})[0];if(!latest)throw Error('登録IRから最新短信の対象期を特定できません。決算期・Q又はPDFを指定してください');fy=latest.p.fy;q=latest.p.q;}
    if(!/^(?:\d{4}|\d{3}[A-Z])$/.test(ticker)||!/^\d{2,4}\/\d{1,2}$/.test(fy)||!/^Q[1-4]$/.test(q))throw Error('銘柄コード・決算期・Qを確認してください');
    const targets=[['current',fy,q]];
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
    const [year,month]=fy.split('/').map(Number),priorFY=`${String(year-1).padStart(2,'0')}/${month}`;
    for(const [key,period,quarter] of [['presentation_current',fy,q],['presentation_previous',q==='Q1'?priorFY:fy,q==='Q1'?'Q4':{Q2:'Q1',Q3:'Q2',Q4:'Q3'}[q]],['presentation_prior_full',priorFY,'Q4']]){
      const found=docs.filter(d=>presentationFor(d,period,quarter)||samePeriod(d.title.replace(/決算説明会資料|決算説明資料|決算説明会|決算参考資料|決算補足資料/,'決算短信'),period,quarter)&&!/短信|動画|質疑/.test(d.title)).sort((a,b)=>Number(/スクリプト|参考|補足/.test(a.title))-Number(/スクリプト|参考|補足/.test(b.title))||b.date.localeCompare(a.date));if(found[0])materials[key]=found[0];
    }
    return {ticker,company:input.company_hint||hint.company||selected.current?.company||'',fiscal_year:fy,quarter:q,selected,candidates,materials,ir_documents:docs,ir_root:input.official_url_hint||hint.ir||'',related_disclosures:[],discovery_sources:o.sources,discovery_errors:o.errors};
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
