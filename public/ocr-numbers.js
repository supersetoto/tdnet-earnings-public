(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OcrNumbers=api;})(typeof window==='object'?window:this,function(){
 'use strict';
 // Recognize the printed ▲ sign by its filled, widening silhouette. Never infer a
 // sign from a bar colour or from the amount needed to balance a bridge.
 function triangle(image,box){
  const {width,height,data}=image,h=box.y1-box.y0;
  if(h<7||h>150)return null;
  const x0=Math.max(0,Math.floor(box.x0-h*1.5)),y0=Math.max(0,Math.floor(box.y0-4)),x1=Math.min(width,Math.ceil(box.x1+3)),y1=Math.min(height,Math.ceil(box.y1+4)),w=x1-x0,hh=y1-y0;
  if(w*hh>100000)return null;
  const mask=new Uint8Array(w*hh),components=[];
  for(let y=0;y<hh;y++)for(let x=0;x<w;x++){const at=((y+y0)*width+x+x0)*4;mask[y*w+x]=Math.max(data[at],data[at+1],data[at+2])<180?1:0;}
  for(let start=0;start<mask.length;start++)if(mask[start]){
   const todo=[start],pts=[];mask[start]=0;let l=w,r=0,t=hh,b=0;
   while(todo.length){const at=todo.pop(),x=at%w,y=Math.floor(at/w);pts.push([x,y]);l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);for(const next of [x?at-1:-1,x<w-1?at+1:-1,y?at-w:-1,y<hh-1?at+w:-1])if(next>=0&&mask[next]){mask[next]=0;todo.push(next);}}
   if(pts.length<8)continue;const cw=r-l+1,ch=b-t+1,rows=Array.from({length:ch},()=>({lo:w,hi:0,n:0}));
   for(const [x,y]of pts){const row=rows[y-t];row.lo=Math.min(row.lo,x);row.hi=Math.max(row.hi,x);row.n++;}
   const fill=pts.length/(cw*ch),widths=rows.map(row=>row.hi-row.lo+1),top=widths.slice(0,Math.max(1,Math.floor(ch*.2))),bottom=widths.slice(Math.floor(ch*.8));
   const isTriangle=ch>=h*.55&&ch<=h*1.15&&cw/ch>.75&&cw/ch<1.5&&fill>.42&&fill<.68&&Math.max(...top)<cw*.42&&Math.min(...bottom)>cw*.65&&rows.every(row=>row.n>=.85*(row.hi-row.lo+1))&&widths.every((v,i)=>!i||v>=widths[i-1]-2);
   components.push({x0:l+x0,x1:r+x0,y0:t+y0,y1:b+y0,w:cw,h:ch,isTriangle});
  }
  const sign=components.find(c=>c.isTriangle&&c.x0<=box.x0+h*.35&&c.x1<box.x1-h*.2);if(!sign)return null;
  const digits=components.filter(c=>!c.isTriangle&&c.x0>sign.x1&&c.h>h*.55&&c.w>1);
  return digits.length?{sign,digits:digits.length}:null;
 }
 function normalize(words,image){return words.map(word=>{
  const raw=String(word.text||'').normalize('NFKC').replace(/[,\s]/g,'');if(!/^[Aムへ4]?\d+$/.test(raw))return word;
  const match=triangle(image,word.bbox);if(!match)return word;
  let digits=raw;if(/^[Aムへ]/.test(digits))digits=digits.slice(1);else if(digits.startsWith('4')&&digits.length===match.digits+1)digits=digits.slice(1);
  if(digits.length!==match.digits)return word;
  return {...word,text:'-'+digits,signVerified:true};
 });}
 return {normalize,triangle};
});
