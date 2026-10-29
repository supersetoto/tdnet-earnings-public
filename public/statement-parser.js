/* TDnet statements: amounts come exclusively from PDF.js text items. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StatementParser=api;})(typeof window==='object'?window:this,function(){
  'use strict';
  const finite=Number.isFinite;
  const norm=s=>String(s??'').normalize('NFKC').replace(/[△▲−]/g,'-').replace(/\s+/g,' ').trim();
  const compact=s=>norm(s).replace(/\s/g,'');
  const number=s=>{const t=norm(s).replace(/,/g,'');return /^-?\d+(?:\.\d+)?$/.test(t)?Number(t):null;};
  const nums=s=>(norm(s).match(/-?\s*\d[\d,]*(?:\.\d+)?/g)||[]).map(x=>number(x.replace(/\s/g,''))).filter(finite);
  const fy=s=>{const m=/^(\d{2,4})\/(\d{1,2})$/.exec(s);if(!m)throw Error('決算期は27/3の形式で指定してください');return {y:Number(m[1])+(m[1].length===2?2000:0),m:Number(m[2])};};
  const canonical=s=>compact(s).replace(/株式会社|有限会社|\(株\)|㈱/g,'');
  const unit=s=>/百万円/.test(s)?100:/千円/.test(s)?100000:/億円/.test(s)?1:null;
  function rows(items){
    const lines=[];
    for(const item of items.filter(i=>norm(i.str??i.s)).map(i=>({s:norm(i.str??i.s),x:i.transform?.[4]??i.x,y:i.transform?.[5]??i.y,w:i.width??i.w??0,h:i.height??i.h??0,confidence:i.confidence??100})).sort((a,b)=>b.y-a.y||a.x-b.x)){
      let row=lines.find(r=>Math.abs(r.y-item.y)<2.4);
      if(!row){row={y:item.y,items:[]};lines.push(row);}row.items.push(item);
    }
    return lines.sort((a,b)=>b.y-a.y).map(r=>{
      r.items.sort((a,b)=>a.x-b.x);const merged=[];
      for(const item of r.items){const last=merged.at(-1),gap=last?item.x-(last.x+last.w):Infinity;
        if(last&&gap>=-0.5&&gap<1.1){last.s+=item.s;last.w=item.x+item.w-last.x;}else merged.push({...item});}
      return {...r,items:merged,text:merged.map(i=>i.s).join(' ')};
    });
  }
  function identity(pages,expected){
    const rs=pages[0]?.rows||[];const head=rs.slice(0,18).map(r=>compact(r.text));
    const title=head.find(t=>/20\d{2}年\d+月期.*決算短信/.test(t));
    if(!title)throw Error('資料確認失敗：先頭ページの決算短信タイトルを確認できません');
    const {y,m}=fy(expected.fy);const label=title.match(/(20\d{2})年(\d+)月期/);
    const q=/第1四半期/.test(title)?'Q1':/第2四半期|中間期/.test(title)?'Q2':/第3四半期/.test(title)?'Q3':'Q4';
    const codeLine=head.find(t=>/コード番号|証券コード/.test(t))||'';const code=codeLine.match(/(?:コード番号|証券コード)[:：]?([0-9A-Z]{4})/i)?.[1];
    const companyLine=head.find(t=>/上場会社名/.test(t))||'';const company=companyLine.replace(/^.*上場会社名[:：]?/,'').split(/上場取引所/)[0];
    const companyOk=!!company&&(!expected.company||canonical(company).includes(canonical(expected.company)));
    if(code!==expected.ticker||Number(label?.[1])!==y||Number(label?.[2])!==m||q!==expected.q||!companyOk){
      throw Error(`資料確認失敗：${code||'コード不明'} ${company||'社名不明'} ${label?.[1]||'?'}年${label?.[2]||'?'}月期 ${q}。指定は${expected.ticker} ${expected.fy} ${expected.q}`);
    }
    const dt=head.slice(0,6).join(' ').match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
    const date=dt?`${dt[1]}-${dt[2].padStart(2,'0')}-${dt[3].padStart(2,'0')}`:null;
    return {code,company,q,fy:expected.fy,date,title,verified:true};
  }
  function periodMatch(text,y,m,q){const t=compact(text);if(!t.startsWith(`${y}年${m}月期`))return false;return q==='Q1'?/第1四半期/.test(t):q==='Q2'?/中間期|第2四半期/.test(t):q==='Q3'?/第3四半期/.test(t):!/第[123]四半期|中間期/.test(t);}
  function performance(pages,expected){
    const rs=pages[0]?.rows||[],start=rs.findIndex(r=>/連結経営成績/.test(compact(r.text)));
    const end=rs.findIndex((r,i)=>i>start&&/連結財政状態/.test(compact(r.text)));
    if(start<0||end<0)throw Error('連結経営成績表の範囲を確認できません');
    const section=rs.slice(start,end),text=section.map(r=>r.text).join(' '),divisor=unit(text)||unit(rs.slice(0,start).map(r=>r.text).join(' '));
    if(!/売上(?:高|収益)|営業収益/.test(compact(text))||!/営業利益/.test(compact(text))||!divisor)throw Error('売上高・営業利益の見出し又は単位を確認できません');
    const {y,m}=fy(expected.fy);
    function extract(year){
      const row=section.find(r=>periodMatch(r.text,year,m,expected.q));if(!row)return null;
      const stripped=norm(row.text).replace(new RegExp(`${year}年\\s*${m}月期`),'').replace(/第\s*[123]\s*四半期|中間期|\(中間期\)/g,'').trim();
      // Alternating amount/% cells. Missing percentage must retain its slot.
      const cells=(stripped.match(/-?\s*\d[\d,]*(?:\.\d+)?|[ー―—－-]/g)||[]).map(x=>number(x.replace(/\s/g,'')));
      if(cells.length<4||!finite(cells[0])||!finite(cells[2]))return null;
      if(finite(cells[1])&&Math.abs(cells[1])>10000)return null;
      return {revenue:cells[0]/divisor,op:cells[2]/divisor,sourceRevenue:cells[0],sourceOp:cells[2],unitDivisor:divisor,evidence:row.text,page:1,method:'verified-summary-row'};
    }
    const current=extract(y),prior=extract(y-1);if(!current)throw Error('対象期の売上高・営業利益の実績行を確認できません');
    return {current,prior};
  }
  function firstRows(pages){return pages.slice(0,3).flatMap(p=>p.rows.map(r=>({...r,page:p.page})));}
  function forecast(pages,expected){
    const rs=firstRows(pages),start=rs.findIndex(r=>/^3[.、]?20\d{2}年.*(?:連結)?業績予想/.test(compact(r.text)));
    if(start<0)return null;
    let end=rs.findIndex((r,i)=>i>start&&/注記事項|発行済株式数/.test(compact(r.text)));if(end<0)end=Math.min(rs.length,start+35);
    const section=rs.slice(start,end),text=section.map(r=>compact(r.text)).join(''),divisor=unit(text);
    if(!divisor||!/売上(?:高|収益)|営業収益/.test(text)||!/営業利益/.test(text))return null;
    const row=section.find(r=>/^通期\s/.test(norm(r.text)));if(!row)return null;
    const cells=(norm(row.text).replace(/^通期/,'').match(/-?\s*\d[\d,]*(?:\.\d+)?|[ー―—－-]/g)||[]).map(x=>number(x.replace(/\s/g,'')));
    if(cells.length<4||!finite(cells[0])||!finite(cells[2]))return null;
    const flag=text.match(/業績予想からの修正の有無[:：]?([有無])/);
    const value={revenue:cells[0]/divisor,op:cells[2]/divisor,revenueYoy:cells[1],opYoy:cells[3],revisionFlag:flag?.[1]||'',evidence:row.text,page:row.page};
    // A revision table can supply the exact previous forecast without another PDF.
    for(const page of pages){
      const rs=page.rows,at=rs.findIndex(r=>/^前回(?:発表)?予想(?:\(A\))?\s/.test(norm(r.text))&&nums(r.text).length>=2);
      if(at<0)continue;const prev=rs[at],cur=rs.slice(at+1,at+5).find(r=>/今回(?:発表)?予想/.test(compact(r.text)));
      const context=rs.slice(Math.max(0,at-6),at+4).map(r=>r.text).join(' ');
      if(!cur||!/売上(?:高|収益)/.test(compact(context))||!/営業利益/.test(compact(context)))continue;
      const a=nums(prev.text),b=nums(cur.text),ud=unit(context);
      if(ud&&a.length>=2&&b.length>=2&&Math.abs(b[0]/ud-value.revenue)<0.02&&Math.abs(b[1]/ud-value.op)<0.02)value.previous={revenue:a[0]/ud,op:a[1]/ud,evidence:prev.text,page:page.page};
    }
    const target=rs[start].text.match(/(20\d{2})年\s*(\d+)月期/);value.fiscal_year=target?`${target[1].slice(-2)}/${Number(target[2])}`:expected.fy;
    return value;
  }
  function dividend(pages,expected){
    const rs=firstRows(pages),start=rs.findIndex(r=>/^2[.、]?配当の状況/.test(compact(r.text)));
    const empty={forecast:null,actual:null,priorActual:null,revisionFlag:'',basis:'',yearEnd:null,interim:null};
    if(start<0)return empty;
    let end=rs.findIndex((r,i)=>i>start&&/^3[.、]?20\d{2}年/.test(compact(r.text)));if(end<0)return empty;
    const section=rs.slice(start,end),text=section.map(r=>compact(r.text)).join('');
    if(!/年間配当金/.test(text)||!/第2四半期末/.test(text)||!/期末/.test(text)||!/合計/.test(text))return empty;
    const {y,m}=fy(expected.fy),flag=text.match(/配当予想からの修正の有無[:：]?([有無])/);
    const result={...empty,revisionFlag:flag?.[1]||'',method:'dividend-table',evidence:text,page:section[0].page};
    function tableRow(year,prediction){
      const row=section.find(r=>compact(r.text).startsWith(`${year}年${m}月期`)&&/予想/.test(r.text)===prediction);if(!row)return null;
      const raw=norm(row.text).replace(new RegExp(`${year}年\\s*${m}月期`),'').replace(/\(予想\)|\(注\s*\d+\)/g,'');
      const cells=(raw.match(/\d[\d,]*\.\d+|\b\d[\d,]*\b|[ー―—－-]/g)||[]).map(x=>number(x));
      return {row,cells};
    }
    const prior=tableRow(y-1,false),current=tableRow(y,false),pred=tableRow(y,true);
    if(prior?.cells.length===5)result.priorActual=prior.cells[4];
    if(current?.cells.length===5)result.actual=current.cells[4];
    if(pred&&pred.cells.length>=2){result.yearEnd=pred.cells.at(-2);if(pred.cells.length>=3)result.forecast=pred.cells.at(-1);}
    if(current&&current.cells.length>=2)result.interim=current.cells[1];else if(pred?.cells.length===4)result.interim=pred.cells[0];
    if(/株式分割/.test(text)){
      result.split=true;result.basis='株式分割のため自動判定不可';
      // Only the explicitly stated annual amount on a consistent pre-split basis is accepted.
      const pre=text.match(/(?:株式分割を考慮しない場合|株式分割前)[\s\S]*?年間配当金(?:合計)?は([\d,]+(?:\.\d+)?)円(?:\d+銭)?/);
      const priorPre=/前.*実績.*分割前|分割前.*実績|株式分割前の実績|当該株式分割前の実績/.test(text);
      const splitDate=text.match(/(20\d{2})年(\d+)月(\d+)日付で[^。]{0,80}株式分割/);
      const afterPriorYear=splitDate&&Number(splitDate[1])*100+Number(splitDate[2])>(y-1)*100+m;
      const currentOnlySplit=afterPriorYear&&new RegExp(`${y}年${m}月期\\(予想\\)の1株当たり期末配当金については、当該株式分割の影響を考慮`).test(text);
      if(pre){result.forecast=Number(pre[1].replace(/,/g,''));result.basis='分割前換算';result.splitEquivalent=true;}
      else {result.forecast=null;result.priorActual=null;}
      // Unadjusted prior rows are on the same pre-split basis. Require that the annual total exists.
      if(pre&&(priorPre||currentOnlySplit)&&prior?.cells.length===5){result.priorActual=prior.cells[4];result.priorBasis=priorPre?'分割前実績':'分割日以前の実績（当期予想のみ分割後との注記）';}else result.priorActual=null;
      result.splitNote=priorPre;
    }
    if(expected.q==='Q4'&&result.forecast==null&&!result.split)result.forecast=result.actual;
    if(result.forecast!==null&&(!finite(result.forecast)||result.forecast<0||result.forecast>100000))result.forecast=null;
    return result;
  }
  function numericItems(row){return row.items.filter(i=>/^(?:-?\s*\d[\d,]*(?:\.\d+)?|[ー―—－-])$/.test(i.s)).map(i=>({...i,v:number(i.s.replace(/\s/g,'')),cx:i.x+i.w/2}));}
  const forbidden=/現金|棚卸|固定資産|無形資産|繰延税金|借入金|社債|法人所得税|資本金|資本剰余|自己株式|非支配|決算短信|20\d{2}年|財政状態|キャッシュ/;
  const aggregate=/^(?:計|合計|調整額|連結|消去.*|全社.*|報告セグメント|その他の項目|\(注.*)$/;
  function segments(pages,expected,actuals){
    const packs={current:[],prior:[],method:'formal-reporting-segment-table'};const {y,m}=fy(expected.fy),startYear=m===12?y:y-1;
    for(const page of pages){const rs=page.rows;
      for(let a=0;a<rs.length;a++){
        if(!/^報告セグメント(?:\s|$)/.test(norm(rs[a].text)))continue;
        let opIndex=rs.findIndex((r,i)=>i>a&&i<a+24&&/^(?:セグメント利益|セグメント損失|セグメント損益|営業利益)/.test(compact(r.text))&&numericItems(r).length>=3);
        if(opIndex<0)continue;
        const headerEnd=rs.findIndex((r,i)=>i>a&&i<opIndex&&/^売上(?:高|収益)/.test(compact(r.text)));if(headerEnd<0)continue;
        const totals=rs.slice(headerEnd,opIndex).filter(r=>/^(?:合計|計)\s/.test(norm(r.text))&&numericItems(r).length>=3);
        const revRow=totals.at(-1);if(!revRow)continue;const rv=numericItems(revRow),ov=numericItems(rs[opIndex]);if(rv.length!==ov.length)continue;
        const period=rs.slice(Math.max(0,a-7),a).map(r=>compact(r.text)).join('');
        const periodYear=period.match(/自(20\d{2})年/)?.[1];
        const role=Number(periodYear)===startYear?'current':Number(periodYear)===startYear-1?'prior':null;if(!role)continue;
        const divisor=unit(rs.slice(Math.max(0,a-3),opIndex+1).map(r=>r.text).join(' '));if(!divisor)continue;
        const expectedOp=actuals[role]?.op;if(!finite(expectedOp)||Math.abs((ov.at(-1).v??NaN)/divisor-expectedOp)>0.03)continue;
        const headerItems=rs.slice(a+1,headerEnd).flatMap(r=>r.items).filter(i=>!/^\(注\d*\)$|^\d+$/.test(i.s));
        const all=[];
        for(let k=0;k<rv.length;k++){
          const left=k===0?rv[k].cx-(rv[k+1].cx-rv[k].cx)/2:(rv[k-1].cx+rv[k].cx)/2;
          const right=k===rv.length-1?Infinity:(rv[k].cx+rv[k+1].cx)/2;
          const name=headerItems.filter(i=>i.x+i.w/2>=left&&i.x+i.w/2<right).map(i=>compact(i.s)).join('').replace(/\(注\d*\)/g,'');
          if(!name||aggregate.test(name))continue;
          if(forbidden.test(name)||!finite(rv[k].v)||!finite(ov[k].v)||rv[k].v<=0){all.length=0;break;}
          const revenue=rv[k].v/divisor,op=ov[k].v/divisor;
          if(Math.abs(op)>revenue){all.length=0;break;}
          all.push({name,revenue,op,page:page.page,revenueBasis:'内部取引を含むセグメント売上',evidence:`${revRow.text}\n${rs[opIndex].text}`});
        }
        if(all.length>=2&&new Set(all.map(s=>s.name)).size===all.length)packs[role]=all;
      }
    }
    return packs;
  }
  function parseStatement(pages,expected){
    const id=identity(pages,expected),a=performance(pages,expected),g=forecast(pages,expected),d=dividend(pages,expected),s=segments(pages,expected,a);
    const nextFY=`${String((fy(expected.fy).y+1)%100).padStart(2,'0')}/${fy(expected.fy).m}`;
    const nextDividend=expected.q==='Q4'?dividend(pages,{...expected,fy:nextFY,q:'Q1'}):null;
    return {...id,actual:a.current,priorActual:a.prior,forecast:g,dividend:d,nextDividend,segments:s.current,priorSegments:s.prior,segmentMethod:s.method,linesCount:pages.reduce((n,p)=>n+p.rows.length,0)};
  }
  function parseBuyback(pages,expected){
    const text=pages.map(p=>p.rows.map(r=>compact(r.text)).join('')).join('');
    const date=text.match(/(20\d{2})年(\d+)月(\d+)日/);const dateText=date?`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`:null;
    const code=text.match(/コード(?:番号)?[:：]?([0-9A-Z]{4})/i)?.[1];
    if(code!==expected.ticker||dateText!==expected.date||!/自己株式.*取得/.test(text)||/取得状況に関するお知らせ/.test(text.slice(0,400)))throw Error('同日・同一銘柄の自己株式取得の決議資料と確認できません');
    const sm=text.match(/(?:取得し得る株式の総数|取得する株式の総数|取得株式数)[^\d]{0,40}([\d,]+)株/);
    const am=text.match(/(?:株式の取得価額の総額|取得価額の総額|取得総額)[^\d]{0,40}([\d,.]+)(億円|百万円|円)/);
    const ratio=text.match(/発行済株式[^%]{0,85}?(\d+(?:\.\d+)?)%/);
    const pm=text.match(/取得期間[^\d]{0,20}((?:20\d{2})年\d+月\d+日)(?:\([^)]*\))?(?:から|~|〜|～|－|-)((?:20\d{2})年\d+月\d+日)/);
    const amount=am?Number(am[1].replace(/,/g,''))/(am[2]==='円'?1e8:am[2]==='百万円'?100:1):null;
    const shares_10k=sm?Number(sm[1].replace(/,/g,''))/1e4:null;
    return {type:finite(amount)&&finite(shares_10k)?'both':finite(amount)?'amount':finite(shares_10k)?'shares':'detected',amount,shares_10k,ratio:ratio?Number(ratio[1]):null,period:pm?`${pm[1]}～${pm[2]}`:'',evidence:text,date:dateText,verified:true};
  }
  function anomalies(r){
    const problems=[];
    if(!finite(r.qRevenue)||r.qRevenue<=0||r.qRevenue>2e6)problems.push('売上高が範囲外');
    if(!finite(r.qOp)||Math.abs(r.qOp)>r.qRevenue||r.qRevenue===r.qOp)problems.push('売上高と営業利益の整合性');
    if(!finite(r.qOpm)||Math.abs(r.qOpm)>100)problems.push('OPMが範囲外');
    if((r.segments||[]).length>=3&&r.qRevenueYoy===0&&r.qOpYoy===0&&r.segments.every(s=>s.cumRevenueNow-s.cumRevenuePrevQ===s.cumRevenuePriorNow-s.cumRevenuePriorPrevQ&&s.cumOpNow-s.cumOpPrevQ===s.cumOpPriorNow-s.cumOpPriorPrevQ))problems.push('全セグメントの前年比が一律0%');
    for(const s of r.segments||[]){
      const revenue=s.cumRevenueNow-s.cumRevenuePrevQ,op=s.cumOpNow-s.cumOpPrevQ;
      const complete=['cumRevenueNow','cumRevenuePrevQ','cumRevenuePriorNow','cumRevenuePriorPrevQ','cumOpNow','cumOpPrevQ','cumOpPriorNow','cumOpPriorPrevQ'].every(k=>finite(s[k]));
      if(!complete||forbidden.test(s.name)||!finite(revenue)||revenue<=0||!finite(op)||Math.abs(op)>revenue)problems.push(`セグメント異常：${s.name}`);
    }
    if(r.dividend!=null&&(r.dividend<0||r.dividend===1&&r.dividendPrior>10))problems.push('配当が不自然');
    return problems;
  }
  return {norm,compact,rows,identity,performance,forecast,dividend,segments,parseStatement,parseBuyback,anomalies};
});
