const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness({owner='A', remembered='A', libraries=new Map(), failure=false, total=1}={}) {
  const elements=new Map(), calls=[];
  const element=id=>{ if(!elements.has(id)) elements.set(id,{style:{},append(){},setAttribute(){}}); return elements.get(id); };
  let handler;
  const stateFor=id=>{
    if(!libraries.has(id)) libraries.set(id,{recipes:new Map(),prefs:new Map(),pending:[],version:0,initialized:false});
    return libraries.get(id);
  };
  const open=async id=>{
    const s=stateFor(id);
    const queue=op=>{s.pending.push({id:++s.version,...op});};
    return {close(){},seed(){},initialized:async()=>s.initialized,version:async()=>s.version,
      allRecipes:async()=>Array.from(s.recipes.values()),
      pending:async()=>s.pending.slice(),acknowledge:async id=>{s.pending=s.pending.filter(x=>x.id!==id);},
      replaceSnapshot:async (entries,settings,v)=>{
        if(v!==s.version||s.pending.length) return false;
        s.recipes=new Map(entries.map(x=>[x.id,x.data]));s.prefs=new Map(settings.map(x=>[x.id,x.data]));s.initialized=true;return true;
      },
      putRecipes:async list=>list.forEach(x=>{s.recipes.set(x.id,x);queue({type:'recipe',key:x.id,data:x});}),
      pref:async (key,data)=>{if(data===undefined)return s.prefs.get(key);s.prefs.set(key,data);queue({type:'pref',key,data});}};
  };
  const timers=[];
  const ctx={AbortController,setTimeout:(fn,ms)=>{if(ms<1000)timers.push(fn);return 0;},clearTimeout(){},setInterval(){},
    navigator:{},localStorage:{getItem:()=>remembered,setItem(){}},sessionStorage:{getItem:()=>null,removeItem(){}},
    document:{createElement:()=>element('panel'),head:{append(){}},getElementById:element},
    location:{reload(){ctx.reloaded=true;}},addEventListener(){},console,
    Store:{ready:async()=>{},allRecipes:async()=>[],allPrefs:async()=>({})},openRecipeDeviceLibrary:open,
    RECIPE_SUPABASE:{url:'https://example.test',publishableKey:'sb_publishable_test'},
    supabase:{createClient:(url,key,options)=>({
      auth:{getSession:async()=>({data:{session:owner?{user:{id:owner},access_token:'token-'+owner}:null}}),
        getUser:async token=>({data:{user:{id:token.slice(6)}}}),onAuthStateChange(fn){handler=fn;}},
      from(table){
        let start=0,row;
        const q={select(){return q;},eq(){return q;},order(){return q;},range(a){start=a;return q;},upsert(x){row=x;return q;},
          async then(resolve){
            if(failure)return resolve({error:Error('offline')});
            assert.equal(await options.accessToken(),'token-'+owner);
            if(row)calls.push({table,row});
            resolve({data:row?null:table==='recipe_entries'&&start<total?[{id:'cloud'+start,data:{id:'cloud'+start}}]:[]});
          }};return q;
      }
    })}};
  ctx.window=ctx;
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../cloud-store.js'),'utf8'),ctx);
  return {store:ctx.Store,libraries,calls,ctx,auth:(...args)=>handler(...args),elements};
}
test('signed-out library keeps downloaded recipes and queues local recipe and Kitchen edits for next sign-in',async()=>{
  const first=harness({total:3});await first.store.ready();assert.equal((await first.store.allRecipes()).length,3);
  const offline=harness({owner:null,libraries:first.libraries});await offline.store.ready();
  assert.equal((await offline.store.allRecipes()).length,3);
  await offline.store.putRecipes([{id:'offline'}]);await offline.store.pref('fridge',['Milk']);
  assert.equal(offline.calls.length,0);
  const back=harness({libraries:first.libraries});await back.store.ready();
  assert.ok((await back.store.allRecipes()).some(x=>x.id==='offline'));
  await back.elements.get('cloud-reload').onclick();
  assert.deepEqual(back.calls.map(x=>[x.table,x.row.id,x.row.user_id]),[['recipe_entries','offline','A'],['recipe_preferences','fridge','A']]);
});
test('cloud failure keeps the downloaded account copy; another account does not get its data or uploads',async()=>{
  const first=harness();await first.store.ready();
  const bad=harness({failure:true,libraries:first.libraries});await bad.store.ready();
  await bad.store.putRecipes([{id:'queued'}]);await bad.elements.get('cloud-reload').onclick();
  assert.equal((await bad.store.allRecipes()).length,2);
  assert.match(bad.elements.get('cloud-status').textContent,/waiting to sync/);
  const other=harness({owner:'B',total:0,libraries:first.libraries});await other.store.ready();
  assert.equal((await other.store.allRecipes()).length,0);assert.equal(other.calls.length,0);
  assert.equal(first.libraries.get('A').pending.length,1);
});
test('all inline scripts parse and service worker excludes external APIs',()=>{
  const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  const worker=fs.readFileSync(require('node:path').join(__dirname,'../sw.js'),'utf8');
  let handler,intercepted=0;
  vm.runInNewContext(worker,{URL,self:{location:{origin:'https://app.test'},registration:{scope:'https://app.test/recipe/'},addEventListener:(event,fn)=>{if(event==='fetch') handler=fn;}}});
  handler({request:{method:'GET',url:'https://example.supabase.co/rest/v1/recipe_entries'},respondWith:()=>intercepted++});
  handler({request:{method:'GET',url:'https://app.test/private-api'},respondWith:()=>intercepted++});
  assert.equal(intercepted,0);
});
