const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const source = html.slice(html.indexOf('  let importRunning = false;'),html.indexOf('  /* ─────────── timers'));
function importer(failAt=0) {
  const stored = new Map(), messages=[], deleted=[];
  const state={recipes:[],plan:{}};
  const context={state,console:{error(){}},setTimeout:fn=>{fn();},carryOver(){},makeThumb:async()=>'',renderSidebar(){},renderList(){},toast:text=>messages.push(text),Store:{ready:async()=>{},isMemoryOnly:false,pref:async()=>{},deleteRecipe:async id=>deleted.push(id),putRecipes:async rows=>{
    assert.equal(rows.length,1);
    assert.equal(state.recipes.some(r=>r.id===rows[0].id),false,'not displayed before saving');
    if(rows[0].id===failAt)throw new Error('Upload failed');
    stored.set(rows[0].id,rows[0]);
  }}};
  vm.runInNewContext(source+'\n globalThis.runImport=applyImport;',context);
  return {context,stored,state,messages,deleted};
}
const library=()=>Array.from({length:151},(_,i)=>({id:i+1,images:['photo']}));
test('151 recipes save individually, including the final 11',async()=>{
  const h=importer();await h.context.runImport(library(),'merge');
  assert.equal(h.stored.size,151);assert.equal(h.state.recipes.length,151);
  assert.match(h.messages.at(-1),/151 of 151/);
});
test('interrupted import retains confirmed saves and does not delete old entries',async()=>{
  const h=importer(141);await h.context.runImport(library(),'replace',[],[{id:'old'}]);
  assert.equal(h.stored.size,140);assert.equal(h.state.recipes.length,140);
  assert.equal(h.deleted.length,0);assert.match(h.messages.at(-1),/140 of 151 recipes saved/);
});
test('thumbnail timeout resolves and releases the image',async()=>{
  const a=html.indexOf('  function makeThumb(dataUrl) {'),b=html.indexOf('  async function buildThumbs',a);
  let timeout, released=false;
  const ctx={THUMB:200,Image:class {removeAttribute(){released=true;}},setTimeout:fn=>{timeout=fn;return 1;},clearTimeout(){}};
  vm.runInNewContext(html.slice(a,b)+'\n globalThis.thumb=makeThumb;',ctx);
  const pending=ctx.thumb('stalled-image');timeout();
  assert.equal(await pending,'');assert.equal(released,true);
});
