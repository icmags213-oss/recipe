const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness({configured = true, failure = false, signedIn = true, total = 0} = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, style: {}, append() {}, setAttribute() {}, elements: {password: {}}, reportValidity: () => true });
    return elements.get(id);
  };
  const calls = [];
  let authHandler;
  const client = {
    auth: {
      getSession: async () => ({data: {session: signedIn ? {user: {id: 'A', email: 'a@example.test'}} : null}}),
      getUser: async () => ({data: {user: {id: 'A'}}}),
      onAuthStateChange: fn => { authHandler = fn; }
    },
    from: table => {
      const query = {table};
      for (const method of ['select','eq','order','range','upsert','delete']) query[method] = (...args) => { (query[method+'Args'] ||= []).push(args); return query; };
      query.then = (resolve, reject) => {
        calls.push(query);
        if (failure) return Promise.resolve({error: new Error('offline')}).then(resolve,reject);
        const start = query.rangeArgs?.[0][0] || 0;
        const data = table === 'recipe_entries' && query.selectArgs ? Array.from({length: Math.min((query.rangeArgs?.[0][1] ?? (start + 499)) - start + 1, Math.max(0,total-start))}, (_, i) => ({id: String(i+start), data: {id: String(i+start)}})) : [];
        return Promise.resolve({data}).then(resolve,reject);
      };
      return query;
    }
  };
  const localCalls = [];
  const context = {AbortController, setTimeout, clearTimeout, document: {createElement: () => element('panel'), body: {prepend() {}}, head: {append() {}}, getElementById: element}, sessionStorage: {getItem:()=>null}, location: {reload(){context.reloaded = true;}}, console, Store: {ready: async()=>{}, allRecipes:async()=>[{id:'local'}],putRecipes:async rows=>localCalls.push(rows)}, RECIPE_SUPABASE:configured?{url:'https://example.supabase.co',publishableKey:'sb_publishable_test'}:{}, supabase: {createClient:()=>client}, addEventListener() {}};
  context.window=context;
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../cloud-store.js'),'utf8'),context);
  return {context,calls,localCalls,elements,authChange:(...args)=>authHandler(...args)};
}
test('unconfigured or signed-out app preserves local storage',async()=>{
  for(const options of [{configured:false},{signedIn:false}]) {
    const h=harness(options);await h.context.Store.ready();
    assert.equal((await h.context.Store.allRecipes())[0].id,'local');
    await h.context.Store.putRecipes([{id:'new'}]);assert.equal(h.localCalls.length,1);
  }
});
test('cloud reads paginate beyond the API limit and writes are scoped to the owner',async()=>{
  const h=harness({total:1100});await h.context.Store.ready();
  assert.equal((await h.context.Store.allRecipes()).length,1100);
  await h.context.Store.putRecipes([{id:'new',title:'Pasta'}]);
  const write=h.calls.find(x=>x.upsertArgs);
  assert.equal(write.upsertArgs[0][0].user_id,'A');
  await h.context.Store.pref('plan',{today:['new']});
  assert.equal((await h.context.Store.pref('plan')).today[0],'new');
  await h.context.Store.deleteRecipe('new');
  assert.ok(h.calls.at(-1).eqArgs.some(([key,value])=>key==='user_id'&&value==='A'));
});
test('failed cloud load rejects without returning device data',async()=>{
  const h=harness({failure:true});
  await assert.rejects(h.context.Store.ready(),/offline/);
  await assert.rejects(h.context.Store.putRecipes([{id:'x'}]),/offline/);
  assert.equal(h.localCalls.length,0);
  assert.match(h.elements.get('cloud-message').textContent,/not confirmed saved/);
});
test('changing accounts clears cloud state and reloads',async()=>{
  const h=harness({total:1});await h.context.Store.ready();
  h.authChange('SIGNED_IN',{user:{id:'B'}});
  assert.equal(h.context.reloaded,true);
  await assert.rejects(h.context.Store.putRecipes([{id:'x'}]),/sign in again/);
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
