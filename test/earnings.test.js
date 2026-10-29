const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parse}=require('acorn'),parser=require('../public/statement-parser'),{createDiscovery,samePeriod}=require('../discovery');
const ROOT=path.resolve(__dirname,'..'),CACHE=process.env.EARNINGS_PDF_CACHE||path.join(ROOT,'.test-cache');
const URLS={
 '7282-q2':'https://ssl4.eir-parts.net/doc/7282/tdnet/2900070/00.pdf',
 '7282-q1':'https://ssl4.eir-parts.net/doc/7282/tdnet/2859001/00.pdf',
 '7282-buyback':'https://ssl4.eir-parts.net/doc/7282/tdnet/2900073/00.pdf',
 '6902-q2':'https://www.release.tdnet.info/inbs/140120261027556975.pdf',
 '6902-q1':'https://contents.xj-storage.jp/xcontents/AS04353/7a100ade/bef9/4c3d/8386/f840b750c755/140120260729501784.pdf',
 '6471-q1':'https://www.nsk.com/content/dam/nsk/jp/ja/company/investors/library/pdf/financial_announcement/2027/con2703q1v2.pdf',
 '7269-q1':'https://www.suzuki.co.jp/ir/library/financialaffairs/pdf/2027_1q/financialaffairs.pdf',
};
// Unit-level execution of the actual UI calculation/text functions, not a second implementation.
function appFunctions(){
 const code=fs.readFileSync(path.join(ROOT,'public/index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1],ast=parse(code,{ecmaVersion:'latest'}),body=ast.body.find(x=>x.type==='ExpressionStatement').expression.callee.body.body;
 const functions=new Set(['defaultTemplates','renderTemplate','buildFetchedFromParsed','mergeAutoSegments','buildEarningsText','segmentDerived','segmentProfitPhrase','segmentOutputText','opComparison','buybackLineFor']);
 const constants=new Set(['n','roundInt','round1','pctChange','fmtNum','fmtPct','fmtOpm','signedYen','compactDecimal','revenueWord','profitWord','amountWord']);
 const chunks=body.filter(n=>n.type==='FunctionDeclaration'&&functions.has(n.id.name)||n.type==='VariableDeclaration'&&n.declarations.every(d=>constants.has(d.id.name))).map(n=>code.slice(n.start,n.end));
 const context=vm.createContext({StatementParser:parser,uid:()=>String(Math.random()),state:{templates:{}}});vm.runInContext(chunks.join('\n')+'\nthis.api={buildFetchedFromParsed,buildEarningsText,n,opComparison};',context);return context.api;
}
const app=appFunctions(),loaded=new Map();let pdfjs;
async function pages(name){
 if(loaded.has(name))return loaded.get(name);
 fs.mkdirSync(CACHE,{recursive:true});const file=path.join(CACHE,name+'.pdf');
 if(!fs.existsSync(file)){const r=await fetch(URLS[name],{signal:AbortSignal.timeout(45000)});assert.equal(r.status,200,`${name}: source HTTP`);fs.writeFileSync(file,Buffer.from(await r.arrayBuffer()));}
 const bytes=fs.readFileSync(file);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs');
 const pdf=await pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true,cMapUrl:path.join(ROOT,'node_modules/pdfjs-dist/cmaps/')+path.sep,cMapPacked:true}).promise,ps=[];
 for(let p=1;p<=pdf.numPages;p++)ps.push({page:p,rows:parser.rows((await(await pdf.getPage(p)).getTextContent()).items)});
 await pdf.destroy();loaded.set(name,ps);return ps;
}
async function statement(name){return parser.parseStatement(await pages(name),{ticker:name.slice(0,4),fy:'27/3',q:name.endsWith('q1')?'Q1':'Q2'});}
async function result(ticker,q='Q2'){
 const current=await statement(ticker+'-'+q.toLowerCase()),previous_quarter=q==='Q2'?await statement(ticker+'-q1'):undefined;
 const src={ticker,company:current.company,fiscal_year:'27/3',quarter:q,selected:{current:{url:URLS[ticker+'-'+q.toLowerCase()]},...(previous_quarter?{previous_quarter:{url:URLS[ticker+'-q1']}}:{})},disclosuresComplete:false};
 if(ticker==='7282')src.buybackParsed=parser.parseBuyback(await pages('7282-buyback'),{ticker,date:'2026-10-29'});
 const r=app.buildFetchedFromParsed(src,{current,previous_quarter});r.dividendYoy=r.dividend!==null&&r.dividendPrior!==null?r.dividend-r.dividendPrior:null;r.dividendVsPrev=r.dividend!==null&&r.dividendPrev!==null?r.dividend-r.dividendPrev:null;return r;
}
test('blank and missing values remain missing',()=>{assert.equal(app.n(''),null);assert.equal(app.n(null),null);assert.equal(app.n('0'),0);assert.equal(app.n(undefined),null);});
test('7282 Q2: exact cumulative/comparative subtraction, six segments, split-adjusted dividend and buyback',async()=>{
 const r=await result('7282');assert.equal(r.qRevenue,3042);assert.equal(r.qOp,150);assert.equal(r.qRevenueYoy,11);assert.equal(r.qOpYoy,3);assert.equal(r.qOpm,4.9);
 assert.deepEqual(Array.from(r.segments,s=>s.name),['日本','米州','欧州・アフリカ','中国','アジア','インド']);assert.equal(r.dividend,175);assert.equal(r.dividendPrior,138);assert.equal(r.buybackAmount,300);assert.equal(r.buybackShares,3600);assert.equal(r.buybackRatio,6.1);
 assert.equal(parser.anomalies(r).length,0);const text=app.buildEarningsText(r);assert.match(text,/YoY11%増収の3,042億円/);assert.match(text,/同3%増益の150億円/);assert.match(text,/OPM4\.9%/);assert.match(text,/分割前換算/);assert.match(text,/前年差\+37円/);assert.match(text,/300億円\/3,600万株/);assert.doesNotMatch(text,/通期1円|公表はなかった|YoY0%/);
});
test('6902 Q2: individually positioned PDF glyphs retain correct amounts',async()=>{
 const r=await result('6902');assert.equal(r.evidence.current.actual.sourceRevenue,3843550);assert.equal(r.evidence.current.actual.sourceOp,170147);assert.equal(r.qRevenue,19297);assert.equal(r.qOp,860);assert.equal(r.qRevenueYoy,5);assert.equal(r.qOpYoy,-18);assert.equal(r.qOpm,4.5);assert.equal(r.dividend,74);assert.equal(r.dividendPrior,67);assert.equal(r.buybackType,'unknown');
 assert.equal(parser.anomalies(r).length,0);assert.match(app.buildEarningsText(r),/同18%減益の860億円/);assert.match(app.buildEarningsText(r),/同日開示を取得できず/);
});
test('additional issuer 6471 Q1',async()=>{const r=await result('6471','Q1');assert.equal(r.qRevenue,2556);assert.equal(r.qOp,150);assert.equal(r.qRevenueYoy,31);assert.equal(r.qOpYoy,212);assert.equal(r.dividend,34);assert.equal(parser.anomalies(r).length,0);});
test('additional issuer 7269 Q1: exact previous forecast from the revision table',async()=>{const r=await result('7269','Q1');assert.equal(r.qRevenue,17058);assert.equal(r.qOp,1580);assert.equal(r.qRevenueYoy,22);assert.equal(r.qOpYoy,11);assert.equal(r.fyOpPrev,5700);assert.equal(r.fyOp,5400);assert.equal(r.guidanceStatus,'下方修正');assert.equal(r.segments.length,4);assert.equal(r.dividend,51);assert.equal(parser.anomalies(r).length,0);});
test('wrong issuer, fiscal year and quarter are rejected before analysis',async()=>{const ps=await pages('7282-q2');for(const e of [{ticker:'6902',fy:'27/3',q:'Q2'},{ticker:'7282',fy:'26/3',q:'Q2'},{ticker:'7282',fy:'27/3',q:'Q1'}])assert.throws(()=>parser.parseStatement(ps,e),/資料確認失敗/);});
test('no formal segment or dividend table produces missing values',async()=>{const ps=await pages('7282-q2');assert.deepEqual(parser.segments([ps[0]],{fy:'27/3'},{current:{op:382.04}}).current,[]);assert.equal(parser.dividend([{page:1,rows:ps[0].rows.filter(r=>!/^2\./.test(r.text))}],{fy:'27/3',q:'Q2'}).forecast,null);});
test('anomalies stop text generation; unknown fields never become zero or buyback absence',async()=>{const r=await result('7282');for(const change of [{qRevenue:17932525},{qOpm:9928},{qOp:r.qRevenue},{qOp:r.qRevenue*3},{segments:[{name:'現金及び現金同等物',cumRevenueNow:5,cumRevenuePrevQ:0,cumOpNow:1,cumOpPrevQ:0}]}]){assert.ok(parser.anomalies({...r,...change}).length);assert.equal(app.buildEarningsText({...r,...change}),'解析結果に異常値があるため停止');}const text=app.buildEarningsText({...r,buybackType:'unknown',dividend:null,qRevenueYoy:null});assert.match(text,/配当は自動判定できませんでした/);assert.match(text,/YoY取得できず/);assert.doesNotMatch(text,/公表なし|YoY0%|年間0円/);});
test('loss-language transitions',()=>{assert.equal(app.opComparison(10,-5,null),'黒字転換');assert.equal(app.opComparison(-5,10,null),'赤字転落');assert.equal(app.opComparison(-5,-10,null),'赤字縮小');assert.equal(app.opComparison(-10,-5,null),'赤字拡大');});
test('metadata rejects the wrong period and a correction notice',()=>{assert.equal(samePeriod('2026年3月期 第2四半期 決算短信','27/3','Q2'),false);assert.equal(samePeriod('2027年3月期 第1四半期 決算短信(訂正版)','27/3','Q1'),true);assert.equal(samePeriod('2027年3月期 第1四半期 決算短信の一部訂正について','27/3','Q1'),false);});
