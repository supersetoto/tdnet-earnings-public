import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),source=path.join(root,'node_modules/pdfjs-dist'),dest=path.join(root,'public/vendor');fs.mkdirSync(dest,{recursive:true});
for(const file of ['pdf.min.mjs','pdf.worker.min.mjs'])fs.copyFileSync(path.join(source,'build',file),path.join(dest,file));
fs.copyFileSync(path.join(source,'LICENSE'),path.join(dest,'PDFJS-LICENSE'));
const maps={};for(const file of fs.readdirSync(path.join(source,'cmaps')))if(file.endsWith('.bcmap'))maps[file]=fs.readFileSync(path.join(source,'cmaps',file)).toString('base64');
fs.writeFileSync(path.join(dest,'cmaps.json'),JSON.stringify(maps));console.log('PDF.js 4.10.38 browser assets and CMaps prepared');
