import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),target=path.resolve(process.argv[2]||path.join(root,'hosting-worker.js'));
const assets={};for(const file of ['index.html','statement-parser.js','presentation-parser.js','presentation-browser.js','ocr-numbers.js','vendor/tesseract.min.js','vendor/pdf.min.mjs','vendor/pdf.worker.min.mjs'])assets['/'+(file==='index.html'?'':file)]=fs.readFileSync(path.join(root,'public',file),'utf8');
const maps=JSON.parse(fs.readFileSync(path.join(root,'public/vendor/cmaps.json'),'utf8'));const binaryAssets=Object.fromEntries(Object.entries(maps).map(([k,v])=>['/vendor/cmaps/'+k,v]));
const discovery=fs.readFileSync(path.join(root,'discovery.js'),'utf8').replace(/^'use strict';\s*/,'').replace(/module\.exports=\{createDiscovery,HINTS,samePeriod\};\s*$/,'');
const ocrAssets=fs.readFileSync(path.join(root,'ocr-assets.js'),'utf8').replace('module.exports={OCR_ASSETS};','');
const runtime=fs.readFileSync(path.join(root,'scripts','worker-runtime.txt'),'utf8');
fs.writeFileSync(target,'// Generated from the same source as the Node companion.\nconst ASSETS='+JSON.stringify(assets)+';\nconst BINARY_ASSETS='+JSON.stringify(binaryAssets)+';\n'+discovery+'\n'+ocrAssets+'\n'+runtime);
console.log('Worker built:',target);
