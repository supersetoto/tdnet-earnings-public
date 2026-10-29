const test=require('node:test'),assert=require('node:assert/strict');
const p=require('../public/presentation-parser'),{createDiscovery}=require('../discovery');
const page=n=>structuredClone(require('./fixtures/presentation-'+n+'.json'));
const expected={segmentNames:['日本','米州','欧州・アフリカ','中国','アジア','インド']};
test('real PDF chart extracts: Q-only factor subtraction reconciles and keeps source pages',()=>{
 const current={bridges:p.bridges(page('q2'),{reference:{actual:{op:382.04},priorActual:{op:329.2}}})},previous={bridges:p.bridges(page('q1'),{reference:{actual:{op:232.24},priorActual:{op:183.73}}})};
 assert.equal(current.bridges.length,1);assert.equal(previous.bridges.length,1);
 const r=p.compare(current,previous,null,{q:'Q2'});assert.deepEqual(r.quarter[0].factors.map(f=>f.value),[8,-32,-30,58,-24,-16,4,36]);assert.equal(r.quarter[0].start,146);assert.equal(r.quarter[0].end,150);assert.equal(r.quarter[0].sources.length,2);assert.match(p.text(r,'Q2'),/差分計算/);
});
test('OCR failure, unbalanced sum and statement discrepancy do not yield factors',()=>{
 const x=page('q2');x.numberRows=x.numberRows.filter(r=>!r.items.some(i=>i.s==='-48'));assert.equal(p.bridges(x,{}).length,0);
 assert.equal(p.bridges(page('q2'),{reference:{actual:{op:40},priorActual:{op:329.2}}}).length,0);
});
test('changing factor classifications cannot be subtracted',()=>{
 const a={bridges:p.bridges(page('q2'),{})},b={bridges:p.bridges(page('q1'),{})};b.bridges[0].factors[0].name='数量構成';const r=p.compare(a,b,null,{q:'Q2'});assert.equal(r.quarter.length,0);assert.match(r.missing.join(''),/分類が異なります/);
});
test('regional plans are tied to formal reporting segments; revision is never called YoY',()=>{
 const chart=require('./fixtures/presentation-regional-vector.json'),bridges=p.bridges(chart,expected);assert.equal(bridges.length,2);
 const r=p.compare({bridges},null,{bridges:[]},{q:'Q2'});assert.equal(r.annual.length,0);assert.equal(r.segmentPlans[0].name,'中国');assert.equal(r.segmentPlans[0].previous,-5);assert.equal(r.segmentPlans[0].current,-25);assert.equal(r.segmentPlans[0].rate,null);assert.match(r.missing.join(''),/従来予想比/);
 assert.equal(p.bridges(chart,{segmentNames:[]}).length,0);
});
test('direct full-year YoY bridge is supported independently of revision charts',()=>{
 const bridge=p.bridges(page('q2'),{})[0];bridge.scope='annual';const r=p.compare({bridges:[bridge]},null,null,{q:'Q2'});assert.equal(r.annual.length,1);assert.equal(r.annual[0].basis,'yoy');
});
test('a registered IR page finds latest period, two statements and supplemental presentation',async()=>{
 const root='https://example.co.jp/ir/',html='<h2>2027年3月期</h2><h3>第2四半期</h3><a href="q2.pdf">決算短信</a><a href="slides2.pdf">決算説明会資料</a><h3>第1四半期</h3><a href="q1.pdf">決算短信</a><a href="slides1.pdf">決算説明会資料</a><h2>2026年3月期</h2><a href="fy.pdf">決算短信</a><a href="slidesfy.pdf">決算説明会資料</a>';
 const d=createDiscovery(async u=>{assert.equal(u,root);return html;});const r=await d.sources({ticker:'1234',latest:true,official_url_hint:root,company_hint:'確認用会社'});
 assert.equal(r.fiscal_year,'27/3');assert.equal(r.quarter,'Q2');assert.equal(r.selected.current.url,root+'q2.pdf');assert.equal(r.selected.previous_quarter.url,root+'q1.pdf');assert.equal(r.materials.presentation_current.url,root+'slides2.pdf');assert.equal(r.materials.presentation_prior_full.url,root+'slidesfy.pdf');assert.equal(Object.keys(r.selected).length,2);
});
