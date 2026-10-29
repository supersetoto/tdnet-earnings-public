// Fixed public OCR assets; document contents are never sent to these hosts.
const OCR_ASSETS={
 '/ocr/worker.min.js':{url:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',type:'text/javascript'},
 '/ocr/lang/jpn.traineddata':{url:'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/jpn.traineddata',type:'application/octet-stream'},
 '/ocr/lang/eng.traineddata':{url:'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/eng.traineddata',type:'application/octet-stream'},
};
for(const mode of ['','-simd','-lstm','-simd-lstm'])for(const ext of ['wasm.js','wasm']){const file=`tesseract-core${mode}.${ext}`;OCR_ASSETS['/ocr/core/'+file]={url:'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/'+file,type:ext==='wasm'?'application/wasm':'text/javascript'};}
module.exports={OCR_ASSETS};
