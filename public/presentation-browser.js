(function(){
 let ocrPromise=null,ocrFailure='';
 function progress(el,text){if(el)el(text);}
 async function timeout(p,ms){let timer;try{return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('図表の読取がタイムアウトしました')),ms))]);}finally{clearTimeout(timer);}}
 async function ocrWorker(status){
  if(ocrFailure)throw Error(ocrFailure);
  if(!ocrPromise){ocrPromise=(async()=>{
    if(!window.Tesseract)await timeout(new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/vendor/tesseract.min.js';s.onload=resolve;s.onerror=()=>reject(Error('図表読取エンジンを取得できません'));document.head.appendChild(s);}),45000);
    return timeout(Tesseract.createWorker(['eng','jpn'],1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr/core',langPath:'/ocr/lang',gzip:false,workerBlobURL:false,cacheMethod:'write',logger:m=>{if(m.status&&m.status!=='recognizing text')progress(status,'画像内文字の読取準備：'+m.status);}}),90000);
   })().catch(e=>{ocrPromise=null;throw e;});}
  return ocrPromise;
 }
 function tsvWords(tsv){return String(tsv||'').trim().split('\n').slice(1).map(l=>l.split('\t')).filter(x=>x[0]==='5'&&x[11]?.trim()).map(x=>({text:x[11],confidence:Number(x[10]),line:x.slice(1,5).join('-'),bbox:{x0:Number(x[6]),x1:Number(x[6])+Number(x[8]),y0:Number(x[7]),y1:Number(x[7])+Number(x[9])}}));}
 function asRows(words,height,scale,offset=0,alignLines=false){const baselines={};if(alignLines)for(const w of words)baselines[w.line]=Math.max(baselines[w.line]||0,w.bbox.y1);return StatementParser.rows(words.map(w=>({s:w.text,x:w.bbox.x0/scale,y:height-((alignLines?baselines[w.line]:w.bbox.y1)+offset)/scale,w:(w.bbox.x1-w.bbox.x0)/scale,h:(w.bbox.y1-w.bbox.y0)/scale,confidence:w.confidence})));}
 async function recognize(worker,canvas,lang,psm){await worker.reinitialize(lang);await worker.setParameters({tessedit_pageseg_mode:String(psm),preserve_interword_spaces:'1'});return tsvWords((await timeout(worker.recognize(canvas,{}, {text:true,blocks:true,tsv:true}),60000)).data.tsv);}
 async function read(doc,expected,deps){
  progress(deps.onStatus,`${doc.title||'説明会資料'}：PDF本文を確認中…`);
  let data;if(doc.file)data=await doc.file.arrayBuffer();else {const r=await fetch('/api/pdf?url='+encodeURIComponent(doc.url),{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error((await r.json()).error||'PDF取得失敗');data=await r.arrayBuffer();}
  if(new TextDecoder().decode(data.slice(0,5))!=='%PDF-')throw Error('説明会資料が生PDFではありません');
  const pdfjs=await deps.loadPdfJs(),pdf=await pdfjs.getDocument({data,useSystemFonts:true,cMapUrl:'/vendor/cmaps/',cMapPacked:true}).promise;
  try{
   if(pdf.numPages>120)throw Error('120ページを超える説明会資料は自動解析できません');
   const pages=[];for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),v=page.getViewport({scale:1});pages.push({page:n,width:v.width,height:v.height,rows:StatementParser.rows((await page.getTextContent()).items)});}
   let parsed=PresentationParser.parse(pages,expected);
   const warnings=[],jobs=parsed.ocrPages.filter(n=>{const t=pages[n-1].rows.slice(0,6).map(r=>r.text).join('');return deps.role==='presentation_current'||deps.role==='presentation_previous'&&!/巻末|参考/.test(t)&&!/通期|予想/.test(t);}).slice(0,8);
   for(const n of jobs){
    progress(deps.onStatus,`${expected.company} 説明会資料p.${n}：画像内の増減図を読取り、合計を照合中…`);
    let canvas;
    try{
     const worker=await ocrWorker(deps.onStatus),page=await pdf.getPage(n),scale=2.5,v=page.getViewport({scale});canvas=document.createElement('canvas');canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);
     const context=canvas.getContext('2d',{willReadFrequently:true});await page.render({canvasContext:context,viewport:v}).promise;
     const japanese=await recognize(worker,canvas,'jpn',11),initial=asRows(japanese,pages[n-1].height,scale,0,true),labels=[];
     for(const y of PresentationParser.labelBands(initial).slice(0,2)){
      const top=Math.max(0,Math.round((pages[n-1].height-y-22)*scale)),crop=document.createElement('canvas');crop.width=canvas.width;crop.height=Math.min(canvas.height-top,Math.round(48*scale));
      crop.getContext('2d').drawImage(canvas,0,top,crop.width,crop.height,0,0,crop.width,crop.height);
      labels.push(...asRows(await recognize(worker,crop,'jpn',6),pages[n-1].height,scale,top,true));crop.width=1;crop.height=1;
     }
     pages[n-1].ocrRows=labels.length?labels:initial;
     const english=await recognize(worker,canvas,'eng',11),signed=OcrNumbers.normalize(english,context.getImageData(0,0,canvas.width,canvas.height));
     pages[n-1].numberRows=asRows(signed,pages[n-1].height,scale);
    }catch(e){ocrFailure=e.message;warnings.push(`p.${n}の図表読取を完了できません：${e.message}`);progress(deps.onStatus,`p.${n}の画像内数値を確実に取得できず。該当項目を非表示にします。`);const broken=ocrPromise;ocrPromise=null;try{await(await broken)?.terminate();}catch{}break;}
    finally{if(canvas){canvas.width=1;canvas.height=1;}}
   }
   parsed=PresentationParser.parse(pages,expected);parsed.warnings=warnings;parsed.source={title:doc.title||parsed.title,url:doc.url||'',fileName:doc.file?.name||'',role:deps.role};return parsed;
  }finally{await pdf.destroy();}
 }
 async function analyze(args){
  ocrFailure='';
  const {src,parsed,manual,ticker,company,fiscalYear,quarter,onStatus,loadPdfJs}=args,priorFY=String(Number(fiscalYear.split('/')[0])-1)+'/'+fiscalYear.split('/')[1],prevQ={Q2:'Q1',Q3:'Q2',Q4:'Q3'}[quarter],docs={...(src.materials||{})};
  for(const k of ['presentation_current','presentation_previous','presentation_prior_full'])if(manual[k])docs[k]=manual[k];
  const output={},errors=[];
  for(const key of ['presentation_current','presentation_previous','presentation_prior_full']){
   const doc=docs[key];if(!doc)continue;const fy=key==='presentation_prior_full'||key==='presentation_previous'&&quarter==='Q1'?priorFY:fiscalYear,q=key==='presentation_current'?quarter:key==='presentation_previous'&&quarter!=='Q1'?prevQ:'Q4';
   try{output[key]=await read(doc,{ticker,company,fy,q,reference:key==='presentation_current'?parsed.current:key==='presentation_previous'?parsed.previous_quarter:null,segmentNames:(parsed.current?.segments||[]).map(s=>s.name)},{role:key,onStatus,loadPdfJs});}catch(e){errors.push(`${key==='presentation_current'?'今回':key==='presentation_previous'?'前Q':'前年本決算'}の説明会資料：${e.message}`);}
  }
  const result=PresentationParser.compare(output.presentation_current,output.presentation_previous,output.presentation_prior_full,{q:quarter});result.missing.push(...errors,...Object.values(output).flatMap(doc=>doc.warnings||[]));
  if(!docs.presentation_current)result.missing.unshift('今回の説明会資料を取得できません。URL又はPDFを指定してください。');
  return result;
 }
 window.PresentationBrowser={analyze};
})();
