(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PresentationParser=api;})(typeof window==='object'?window:this,function(){
 'use strict';
 const norm=s=>String(s??'').normalize('NFKC').replace(/[△▲−]/g,'-').replace(/\s+/g,' ').trim(),c=s=>norm(s).replace(/\s/g,''),finite=Number.isFinite;
 const known=['増減販','販売数量','数量構成','売上構成','数量・構成','販売ミックス','価格改訂','価格改定','売価改善','材料市況','原材料','原価改善','合理化','昇給影響','人件費','固定費','為替','その他'];
 const canonical=s=>c(s).replace(/価格改定/g,'価格改訂').replace(/為暁/g,'為替');
 const amount=t=>{const raw=c(t).replace(/,/g,'').replace(/^[Aムへ](?=\d)/,'-');return /^[+-]?\d+(?:\.\d+)?$/.test(raw)?{value:Number(raw),signed:/^[+-]/.test(raw),raw}:null;};
 function rowAnchors(row){const anchors=[];let txt='',map=[];for(const i of row.items){const t=canonical(i.s);for(let k=0;k<t.length;k++){txt+=t[k];map.push(i.x+i.w*(k+.5)/t.length);}}
  for(const label of known){let at=txt.indexOf(label);if(at>=0)anchors.push({name:label,x:(map[at]+map[at+label.length-1])/2});}
  return anchors.sort((a,b)=>a.x-b.x).filter((a,i,x)=>!i||Math.abs(a.x-x[i-1].x)>3);
 }
 function statementTitle(pages,expected){const first=(pages[0]?.rows||[]).slice(0,35).map(r=>c(r.text)).join(' '),all=pages.slice(0,2).flatMap(p=>p.rows).map(r=>c(r.text)).join(' ');
  const fy=expected.fy.match(/(\d+)\/(\d+)/),year=2000+Number(fy?.[1])%100,month=Number(fy?.[2]);
  const period=new RegExp(`${year}年${month}月期`).test(first)||new RegExp(`${month===12?year:year-1}年度`).test(first);
  const q=expected.q==='Q1'?/第1四半期|1Q/i:expected.q==='Q2'?/第2四半期|2Q|中間/i:expected.q==='Q3'?/第3四半期|3Q/i:/通期|期末|決算説明/;
  const company=c(expected.company).replace(/株式会社/g,''),companyOk=!!company&&all.replace(/株式会社/g,'').includes(company)||new RegExp(`(?:コード|証券).*${expected.ticker}`).test(all);
  if(!period||!q.test(first)||!/決算|Financial/i.test(first)||!companyOk)throw Error('説明会資料の会社名・対象期・Qを本文で確認できません');
  return {title:pages[0].rows.slice(0,12).map(r=>r.text).join(' '),verified:true};
 }
 function bridges(page,expected){
  const header=page.rows.slice(0,6).map(r=>c(r.text)).join(' ');if(!/営業利益.*(?:増減|変動)|営業増益.*要因/.test(header)||!/億円|百万円/.test(page.rows.slice(0,12).map(r=>r.text).join(' ')))return [];
  const divisor=/百万円/.test(page.rows.slice(0,12).map(r=>r.text).join(' '))?100:1;
  const region=(expected.segmentNames||[]).find(name=>header.includes('['+c(name)+']')||header.includes('【'+c(name)+'】'))||((header.match(/\[([^\]]+)\]/)?.[1]||'').replace(/単位.*/,''))||'連結';
  if(region!=='連結'&&!(expected.segmentNames||[]).some(name=>c(name)===c(region)))return [];
  const rs=page.ocrRows?.length?page.ocrRows:page.rows;
  const labelRows=rs.map(r=>({row:r,anchors:rowAnchors(r)})).filter(x=>x.anchors.length>=3).sort((a,b)=>b.row.y-a.row.y);
  const result=[];
  for(let n=0;n<labelRows.length;n++){
    const {row,anchors}=labelRows[n],xs=anchors.map(a=>a.x),steps=xs.slice(1).map((x,i)=>x-xs[i]).sort((a,b)=>a-b),step=steps[Math.floor(steps.length/2)];
    if(!step||step<10||steps.some(v=>v>step*2.2))continue;
    const high=n===0?page.height*.8:labelRows[n-1].row.y-12,low=row.y+8;
    const area=(page.numberRows||rs).filter(r=>r.y>low&&r.y<high),items=area.flatMap(r=>r.items.map(i=>({...i,y:r.y}))),candidates=[];
    for(const i of items){let a=amount(i.s);if(!a)continue;
      const sign=items.find(j=>j!==i&&/^[Aムへ-]$/.test(c(j.s))&&Math.abs(j.y-i.y)<4&&i.x-(j.x+j.w)>=-1&&i.x-(j.x+j.w)<9);
      if(sign&&!a.signed)a={...a,value:-a.value,signed:true};
      candidates.push({...a,x:i.x+i.w/2,y:i.y,h:i.h||0,confidence:i.confidence??100});
    }
    const pick=(x,isFactor)=>{const ranked=candidates.filter(v=>Math.abs(v.x-x)<step*.35&&(!isFactor||v.signed||v.value===0)).sort((a,b)=>b.h-a.h||Math.abs(a.x-x)-Math.abs(b.x-x)||b.confidence-a.confidence);return ranked[0];};
    const values=anchors.map(a=>({...a,...pick(a.x,true)}));if(values.some(v=>!finite(v.value)))continue;
    const start=pick(xs[0]-step,false),end=pick(xs.at(-1)+step,false);if(!start||!end)continue;
    const sum=values.reduce((s,v)=>s+v.value,0),gap=end.value-start.value-sum;
    if(Math.abs(gap)>Math.max(2,values.length*.51))continue;
    const labelText=rs.filter(r=>Math.abs(r.y-row.y)<22).map(r=>c(r.text)).join(' '),years=[...new Set([...labelText.matchAll(/((?:20)?\d{2})年度/g)].map(m=>Number(m[1])%100))];
    const basis=/(前回|従来|年初)予想/.test(labelText)&&/(今回予想|修正後)/.test(labelText)?'revision':/前年|前期/.test(labelText)||years.length===2&&Math.abs(years[0]-years[1])===1&&/実績/.test(labelText)?'yoy':null;
    if(!basis)continue;
    const annual=/通期|予想/.test(header)||basis==='revision';
    const ref=expected.reference;
    if(!annual&&ref){const now=region==='連結'?ref.actual:ref.segments?.find(s=>c(s.name)===c(region)),prior=region==='連結'?ref.priorActual:ref.priorSegments?.find(s=>c(s.name)===c(region));if(!now||Math.abs(end.value/divisor-now.op)>1.2||prior&&Math.abs(start.value/divisor-prior.op)>1.2)continue;}
    result.push({scope:annual?'annual':'actual',basis,region,start:start.value/divisor,end:end.value/divisor,factors:values.map(v=>({name:v.name,value:v.value/divisor})),page:page.page,method:page.ocrRows?'図表読取・合計照合済み':'PDF表抽出',roundingGap:gap/divisor});
  }return result;
 }
 function narratives(pages,expected){const names=expected.segmentNames||[];const out=[];
  for(const p of pages){const title=p.rows.slice(0,5).map(r=>c(r.text)).join('');if(!/セグメント|地域別|事業別/.test(title))continue;
    const rows=p.rows.filter(r=>r.y<p.height*.86);for(const name of names){const heading=rows.flatMap(r=>r.items.map(i=>({...i,y:r.y}))).find(i=>c(i.s)===c(name));if(!heading)continue;const line=rows.filter(r=>r.y<heading.y&&r.y>heading.y-35).flatMap(r=>r.items.filter(i=>Math.abs(i.x+i.w/2-(heading.x+heading.w/2))<p.width/6).map(i=>i.s)).join(' ');if(/増益|減益|増販|減販|改善|影響/.test(line))out.push({name,comment:line,page:p.page,kind:'会社コメントの原文抜粋'});}
  }return out;
 }
 function segmentTables(pages,expected){const out=[];
  for(const p of pages){const title=p.rows.slice(0,6).map(r=>c(r.text)).join('');if(!/(セグメント|地域別|事業別).*(予想|計画|見通し)/.test(title))continue;
    const text=p.rows.map(r=>c(r.text)).join('');if(!/前回|従来|年初/.test(text)||!/今回|修正後/.test(text))continue;
    // Only explicit labelled rows with old/new monetary columns are accepted.
    const unitText=p.rows.slice(0,12).map(r=>c(r.text)).join(''),divisor=/百万円/.test(unitText)?100:/億円/.test(unitText)?1:null;if(!divisor)continue;
    for(const r of p.rows){const m=norm(r.text).match(/^([^\d]{1,30}?)\s+(-?[\d,]+(?:\.\d+)?)\s+(-?[\d,]+(?:\.\d+)?)(?:\s|$)/);if(m&&(expected.segmentNames||[]).some(name=>c(name)===c(m[1])))out.push({name:m[1].trim(),previous:Number(m[2].replace(/,/g,''))/divisor,current:Number(m[3].replace(/,/g,''))/divisor,page:p.page,metric:/営業利益/.test(title)?'営業利益':null});}
  }return out.filter(x=>x.metric);
 }
 function parse(pages,expected){const id=statementTitle(pages,expected);const bs=pages.flatMap(p=>bridges(p,expected));return {...id,fy:expected.fy,q:expected.q,bridges:bs,narratives:narratives(pages,expected),segmentPlans:segmentTables(pages,expected),ocrPages:pages.filter(p=>/営業利益.*(?:増減|変動)/.test(p.rows.slice(0,6).map(r=>c(r.text)).join(''))&&!bridges(p,expected).length).map(p=>p.page)};}
 function compare(current,previous,priorFull,expected){
  const missing=[],quarter=[],annual=[],plans=[];const now=current?.bridges||[],prev=previous?.bridges||[];
  const actual=now.filter(b=>b.scope==='actual'&&b.basis==='yoy');
  for(const b of actual){if(expected.q==='Q1'){quarter.push({...b,kind:'会社開示',sources:[{role:'current',page:b.page}]});continue;}
    const old=prev.find(x=>x.scope==='actual'&&x.region===b.region&&x.basis===b.basis);if(!old){missing.push(`${b.region}のQ単体増減要因：前Qの同じ基準の内訳がありません`);continue;}
    if(b.factors.map(f=>f.name).join('|')!==old.factors.map(f=>f.name).join('|')){missing.push(`${b.region}のQ単体増減要因：今回と前Qで要因の分類が異なります`);continue;}
    quarter.push({...b,start:b.start-old.start,end:b.end-old.end,factors:b.factors.map((f,i)=>({name:f.name,value:f.value-old.factors[i].value})),kind:'差分計算（累計−前Q累計）',sources:[{role:'current',page:b.page},{role:'previous',page:old.page}]});
  }
  for(const b of now.filter(b=>b.scope==='annual'&&b.basis==='yoy'))annual.push({...b,kind:'会社開示',sources:[{role:'current',page:b.page}]});
  for(const b of now.filter(b=>b.scope==='annual'&&b.basis==='revision'&&b.region!=='連結'))plans.push({name:b.region,metric:'営業利益',previous:b.start,current:b.end,delta:b.end-b.start,rate:b.start>0?(b.end/b.start-1)*100:null,page:b.page,kind:'会社開示の修正図から抽出'});
  for(const b of current?.segmentPlans||[])plans.push({...b,delta:b.current-b.previous,rate:b.previous>0?(b.current/b.previous-1)*100:null,kind:'会社開示表から抽出'});
  if(!quarter.length)missing.push('Q単体の増減要因を算出できません。今回・前Qの同じ分類のYoY増減図が必要です。画像の数字を確実に読めない場合も非表示にします。');
  if(!annual.length)missing.push(priorFull?'通期YoYの要因別内訳は算出不可：今回は従来予想比の図のみです。過去の年初YoY図だけでは、中間時点の内訳変更を確認できません。最新のYoY内訳又は各修正時点の比較可能な内訳が必要です。':'通期YoYの要因別内訳は算出不可：今回のYoY増減図を特定できません。前年本決算の説明会資料、又は今回の前期実績比較の内訳が必要です。');
  if(!plans.length)missing.push('セグメント別計画変更は取得できず：前回・今回の計画値が明記された表又は修正図が必要です。');
  return {quarter,annual,segmentPlans:plans,comments:current?.narratives||[],missing:[...new Set(missing)],sources:{current:current?.source,previous:previous?.source,priorFull:priorFull?.source}};
 }
 function text(result,q){if(!result)return '';
  const v=n=>Math.round(n).toLocaleString('ja-JP'),signed=n=>(n>=0?'+':'▲')+v(Math.abs(n));
  const lines=[];lines.push(`【説明会資料：${q}単体の営業利益増減要因】`);
  for(const b of result.quarter)lines.push(`${b.region}：${b.factors.map(f=>f.name+signed(f.value)+'億円').join('、')}。［${b.kind}／今回p.${b.sources[0].page}${b.sources[1]?'・前Q p.'+b.sources[1].page:''}］`);
  if(!result.quarter.length)lines.push('算出不可（理由は下記）。');
  lines.push('','【説明会資料：通期YoYの営業利益増減要因】');for(const b of result.annual)lines.push(`${b.region}：${b.factors.map(f=>f.name+signed(f.value)+'億円').join('、')}。［${b.kind}／p.${b.page}］`);if(!result.annual.length)lines.push('算出不可（従来予想比をYoYとして扱いません）。');
  lines.push('','【説明会資料：セグメント別計画変更】');for(const s of result.segmentPlans)lines.push(`${s.name}：${s.metric} ${v(s.previous)}→${v(s.current)}億円（${signed(s.delta)}億円${finite(s.rate)?'、従来比'+signed(s.rate)+'%':''}）。［${s.kind}／p.${s.page}］`);if(!result.segmentPlans.length)lines.push('取得できず。');
  if(result.comments.length){lines.push('','【セグメント別：会社コメント（資料記載期間・原文抜粋）】');for(const s of result.comments)lines.push(`${s.name}：${s.comment}［p.${s.page}］`);}
  if(result.missing.length)lines.push('','【算出できない項目・理由・必要資料】',...result.missing);
  return '\n\n'+lines.join('\n');
 }
 const labelBands=rows=>rows.filter(r=>rowAnchors(r).length>=3).map(r=>r.y);
 return {parse,bridges,compare,text,statementTitle,labelBands};
});
