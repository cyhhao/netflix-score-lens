// Network outcome classification, retry windows, OMDb parallelism and
// sanitized diagnostics in the REAL MV3 worker. Deterministic fetch fixtures,
// disposable profile, synthetic IDs and an obviously fake Key only.
import {chromium} from 'playwright';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import assert from 'node:assert/strict';
import {executablePath} from './browser.mjs';
const root=resolve(import.meta.dirname,'..'),profile=await mkdtemp(join(tmpdir(),'scorelens-network-'));
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
const report=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));let failures=0;
const check=async(name,fn)=>{try{await fn();report.push({name,passed:true});console.log('PASS',name);}catch(e){failures++;report.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message);}};
const KEY='fixture-key-NOT-A-SECRET-7f3a',MARKER='RAW-EXCEPTION-MARKER';
const GOOD=604800000,QUOTA=86400000,HOUR=3600000,SETTLED=600000,DEGRADED=300000,TRANSIENT=30000,PERMANENT=600000;
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2];
  const page=await context.newPage();await page.goto(`chrome-extension://${id}/popup.html`);
  const send=m=>page.evaluate(m=>chrome.runtime.sendMessage(m),m);
  await send({type:'GET_UI'});
  await worker.evaluate(({MARKER})=>{
    globalThis.__n={calls:[],events:[],mode:{},barrier:[],barrierTimedOut:false,hold:[],releases:[]};
    const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
    const routes={
      search:m=>m==='ok'?json({metas:[{id:'tt7000001',type:'movie',name:'Example Film',year:2024}]}):json({},Number(m)),
      imdb:m=>m==='network'?Promise.reject(new TypeError(`${MARKER} https://v3.sg.media-imdb.com/`)):m==='localized'?json({d:[{id:'tt7000001',qid:'movie',l:'Some AKA Title',y:2024}]}):m==='empty'?json({d:[]}):json({},Number(m)),
      meta:m=>m==='rated'?json({meta:{id:'tt7000001',type:'movie',name:'Example Film',year:2024,imdbRating:'6.1'}}):m==='unrated'?json({meta:{id:'tt7000001',type:'movie',name:'Example Film',year:2024}}):json({},Number(m)),
      omdb:m=>({
        valid:()=>json({Response:'True',imdbID:'tt7000001',Title:'Example Film',Year:'2024',Type:'movie',imdbRating:'6.5',Ratings:[{Source:'Rotten Tomatoes',Value:'80%'}]}),
        notfound:()=>json({Response:'False',Error:'Movie not found!'}),
        nodata:()=>json({Response:'False',Error:'Error getting data.'}),
        incorrect:()=>json({Response:'False',Error:'Incorrect IMDb ID.'}),
        seriesnf:()=>json({Response:'False',Error:'Series not found!'}),
        unknown:()=>json({Response:'False',Error:`Unexpected upstream state ${MARKER}`}),
        mismatch:()=>json({Response:'True',imdbID:'tt7000002',Title:'Other Film',Year:'2024',Type:'movie',imdbRating:'9.9',Ratings:[{Source:'Rotten Tomatoes',Value:'99%'}]}),
        invalid:()=>json({Response:'False',Error:'Invalid API key!'},401),
        quota:()=>json({Response:'False',Error:'Request limit reached!'},401),
        503:()=>new Response('<html>Service Unavailable</html>',{status:503,headers:{'Content-Type':'text/html'}}),
        403:()=>new Response('<html>Forbidden</html>',{status:403,headers:{'Content-Type':'text/html'}}),
        network:()=>Promise.reject(new TypeError(`${MARKER} https://www.omdbapi.com/`))
      })[m](),
      netflix:m=>new Response('',{status:Number(m)})
    };
    globalThis.fetch=async(input,options={})=>{
      const f=globalThis.__n,u=new URL(String(input));
      const name=u.hostname.includes('cinemeta')?(u.pathname.includes('/meta/')?'meta':'search'):({'v3.sg.media-imdb.com':'imdb','www.omdbapi.com':'omdb','www.netflix.com':'netflix','api.tvmaze.com':'tvmaze'})[u.hostname];
      f.calls.push({name,url:u.href,credentials:options.credentials});f.events.push(`start:${name}`);
      // Deferred barrier: each listed request waits until all listed requests
      // have started. Serial execution cannot satisfy it and times out.
      if(f.barrier.includes(name)){const deadline=Date.now()+3000;while(!f.barrier.every(n=>f.events.includes(`start:${n}`))){if(Date.now()>deadline){f.barrierTimedOut=true;break;}await new Promise(r=>setTimeout(r,10));}}
      if(f.hold.includes(name))await new Promise(r=>f.releases.push(r));
      try{return await routes[name](f.mode[name]);}finally{f.events.push(`end:${name}`);}
    };
  },{MARKER});
  const item={title:'Example Film',year:2024,type:'movie',netflixId:'70000001'};
  const lookup=(value=item)=>send({type:'LOOKUP',item:value}).then(r=>{assert.equal(r.ok,true,r.error);return r.result;});
  const fixture=(fn,arg)=>worker.evaluate(fn,arg);
  const until=async fn=>{for(let i=0;i<300;i++){if(await worker.evaluate(fn))return;await sleep(20);}throw Error('fixture wait timed out');};
  const cache=()=>worker.evaluate(async()=>(await chrome.storage.local.get('cacheV3')).cacheV3||{});
  const onlyTtl=async()=>{const entries=Object.values(await cache());assert.equal(entries.length,1);return entries[0].ttl;};
  const omdbCalls=()=>worker.evaluate(()=>__n.calls.filter(c=>c.name==='omdb').length);
  const setup=async(mode,{key=true,providerMode='auto'}={})=>{
    await worker.evaluate(()=>{__n.hold=[];__n.releases.splice(0).forEach(r=>r());});
    await send({type:'SAVE_SETTINGS',settings:{enabled:true,providerMode},...(key?{apiKey:KEY}:{removeApiKey:true})});
    await send({type:'CLEAR_CACHE'});
    await worker.evaluate(mode=>Object.assign(__n,{calls:[],events:[],barrier:[],barrierTimedOut:false,hold:[],mode:{search:'ok',imdb:'empty',meta:'rated',omdb:'valid',netflix:'500',...mode}}),mode);
  };
  const ALLOWED=new Set(['provider','stage','kind','status']);
  const assertSanitized=value=>{
    const text=JSON.stringify(value);
    for(const forbidden of [KEY,MARKER,'apikey','omdbapi.com'])assert.equal(text.includes(forbidden),false,`leaked ${forbidden}`);
    for(const d of value.diagnostics||[]){for(const k of Object.keys(d))assert.ok(ALLOWED.has(k),`unexpected diagnostic field ${k}`);if('status' in d)assert.ok(Number.isInteger(d.status));}
  };

  await check('OMDb not found with no free rating is no_rating, not a short error retry loop',async()=>{
    await setup({meta:'unrated',omdb:'notfound'});const r=await lookup();
    assert.equal(r.status,'no_rating');assert.equal(r.warning,'');assert.equal(r.retryAfterMs,undefined);
    assert.deepEqual(r.diagnostics,[{provider:'OMDb',stage:'rating',kind:'not_found'}]);assert.equal(await onlyTtl(),SETTLED);
    assert.equal((await send({type:'GET_UI'})).providerHealth.OMDb.status,'ok');assertSanitized(r);
  });
  await check('known OMDb absence messages never shorten a good free rating',async()=>{
    for(const omdb of ['notfound','nodata','incorrect','seriesnf']) {
      await setup({omdb});const r=await lookup();
      assert.equal(r.status,'ok',omdb);assert.equal(r.ratings.imdb.provider,'Cinemeta');assert.equal(r.warning,'');assert.equal(await onlyTtl(),GOOD);
      assert.deepEqual(r.diagnostics,[{provider:'OMDb',stage:'rating',kind:'not_found'}]);
    }
  });
  await check('mismatched OMDb identity is a protocol fault: no foreign ratings, visible, short retry',async()=>{
    await setup({omdb:'mismatch'});const r=await lookup();
    assert.equal(r.status,'ok');assert.equal(r.ratings.imdb.provider,'Cinemeta');assert.equal(r.ratings.imdb.value,6.1);assert.equal(r.ratings.rt,undefined);
    assert.match(r.warning,/无法解析/);assert.deepEqual(r.diagnostics,[{provider:'OMDb',stage:'rating',kind:'parse'}]);assert.equal(await onlyTtl(),DEGRADED);
    assert.equal((await send({type:'GET_UI'})).providerHealth.OMDb.status,'error');assertSanitized(r);
  });
  await check('unrecognized OMDb Response:False is not silent absence',async()=>{
    await setup({omdb:'unknown'});let r=await lookup();
    assert.equal(r.status,'ok');assert.match(r.warning,/无法解析/);assert.deepEqual(r.diagnostics,[{provider:'OMDb',stage:'rating',kind:'parse'}]);assert.equal(await onlyTtl(),DEGRADED);assertSanitized(r);
    await setup({meta:'unrated',omdb:'unknown'});r=await lookup();
    assert.equal(r.status,'error');assert.equal(r.retryAfterMs,TRANSIENT);assert.equal(await onlyTtl(),TRANSIENT);assertSanitized(r);
  });
  await check('non-transient OMDb states bound a good free rating: Key/403 one hour, quota one day',async()=>{
    for(const [mode,kind,status,warning,ttl] of [['invalid','auth',401,/Key 无效/,HOUR],['403','http',403,/HTTP 403/,HOUR],['quota','quota',401,/额度/,QUOTA]]) {
      await setup({omdb:mode});const r=await lookup();
      assert.equal(r.status,'ok',mode);assert.equal(r.ratings.imdb.provider,'Cinemeta');assert.match(r.warning,warning);assert.equal(r.retryAfterMs,undefined);
      assert.deepEqual(r.diagnostics,[{provider:'OMDb',stage:'rating',kind,status}]);assert.equal(await onlyTtl(),ttl);assertSanitized(r);
    }
    await setup({meta:'unrated',omdb:'quota'});const unrated=await lookup();
    assert.equal(unrated.status,'no_rating');assert.match(unrated.warning,/额度/);assert.equal(await onlyTtl(),SETTLED);
  });
  await check('same unactivated Key recovers RT within about an hour with no setting change or cache clear',async()=>{
    await setup({omdb:'invalid'});assert.match((await lookup()).warning,/Key 无效/);assert.equal(await omdbCalls(),1);
    // The same Key becomes valid at OMDb; nothing local changes.
    await fixture(()=>{__n.mode.omdb='valid';});
    const age=ms=>worker.evaluate(async ms=>{const d=await chrome.storage.local.get('cacheV3');for(const e of Object.values(d.cacheV3)){e.at-=ms;e.result.expiresAt-=ms;}await chrome.storage.local.set(d);},ms);
    await age(59*60000);const early=await lookup();assert.match(early.warning,/Key 无效/);assert.equal(await omdbCalls(),1,'no retry loop inside the hour');
    await age(60000+1000);const r=await lookup();
    assert.equal(await omdbCalls(),2);assert.equal(r.ratings.rt.value,80);assert.equal(r.ratings.imdb.provider,'OMDb');assert.equal(r.warning,'');assert.deepEqual(r.diagnostics,[]);assert.equal(await onlyTtl(),GOOD);
  });
  await check('saving a different Key clears an invalid-Key result and queries OMDb again',async()=>{
    await setup({omdb:'invalid'});assert.match((await lookup()).warning,/Key 无效/);assert.equal(await onlyTtl(),HOUR);
    await send({type:'SAVE_SETTINGS',apiKey:`${KEY}-replacement`});assert.equal(Object.keys(await cache()).length,0);
    await fixture(()=>{__n.mode.omdb='valid';});const r=await lookup();
    assert.equal(r.ratings.rt.value,80);assert.equal(r.warning,'');assert.equal(await omdbCalls(),2);
  });
  await check('transient OMDb or free-source failures keep short retry windows',async()=>{
    await setup({omdb:'503'});let r=await lookup();
    assert.equal(r.status,'ok');assert.deepEqual(r.diagnostics,[{provider:'OMDb',stage:'rating',kind:'http',status:503}]);assert.equal(await onlyTtl(),DEGRADED);
    await setup({meta:'unrated',omdb:'network'});r=await lookup();
    assert.equal(r.status,'error');assert.equal(r.retryAfterMs,TRANSIENT);assert.equal(await onlyTtl(),TRANSIENT);
    assert.deepEqual(r.diagnostics,[{provider:'OMDb',stage:'rating',kind:'network'}]);assertSanitized(r);
    await setup({meta:'503',omdb:'notfound'});r=await lookup();
    assert.equal(r.status,'error');assert.equal(r.retryAfterMs,TRANSIENT);assert.match(r.warning,/部分免费/);
    assert.deepEqual(r.diagnostics,[{provider:'Cinemeta',stage:'rating',kind:'http',status:503},{provider:'OMDb',stage:'rating',kind:'not_found'}]);
  });
  await check('free and OMDb rating requests are in flight together; OMDb keeps precedence',async()=>{
    await setup({});await fixture(()=>{__n.barrier=['meta','omdb'];});const r=await lookup();
    const {events,barrierTimedOut}=await fixture(()=>({events:__n.events,barrierTimedOut:__n.barrierTimedOut}));
    assert.equal(barrierTimedOut,false,`serial rating requests: ${events.join(',')}`);
    const firstEnd=Math.min(events.indexOf('end:meta'),events.indexOf('end:omdb'));
    assert.ok(events.indexOf('start:meta')<firstEnd&&events.indexOf('start:omdb')<firstEnd,events.join(','));
    assert.equal(r.ratings.imdb.provider,'OMDb');assert.equal(r.ratings.imdb.value,6.5);assert.equal(r.ratings.rt.value,80);assert.equal(r.status,'ok');
  });
  await check('no OMDb request without a Key or in free mode; no extra free requests',async()=>{
    await setup({},{key:false});assert.equal((await lookup()).status,'ok');
    assert.deepEqual(await fixture(()=>__n.calls.map(c=>c.name)),['search','meta']);
    await setup({},{providerMode:'free'});assert.equal((await lookup()).status,'ok');
    assert.equal(await omdbCalls(),0);assert.deepEqual(await fixture(()=>__n.calls.map(c=>c.name)),['search','meta']);
    await setup({});await lookup();assert.equal(await omdbCalls(),1);
  });
  await check('search failure provenance is sanitized; permanent failures back off',async()=>{
    // A failed search still tries the optional Netflix title rescue (500 here).
    const title={provider:'Netflix',stage:'title',kind:'http',status:500};
    await setup({search:'503',imdb:'network'});let r=await lookup();
    assert.equal(r.status,'error');assert.equal(r.retryAfterMs,TRANSIENT);
    assert.deepEqual(r.diagnostics,[{provider:'Cinemeta',stage:'search',kind:'http',status:503},{provider:'IMDb',stage:'search',kind:'network'},title]);assertSanitized(r);
    // Optional title failures never decide the retry window, even when transient.
    await setup({search:'400',imdb:'403'});r=await lookup();
    assert.equal(r.status,'error');assert.equal(r.retryAfterMs,PERMANENT);assert.equal(await onlyTtl(),PERMANENT);
    assert.deepEqual(r.diagnostics,[{provider:'Cinemeta',stage:'search',kind:'http',status:400},{provider:'IMDb',stage:'search',kind:'http',status:403},title]);
  });
  await check('optional Netflix title failure is a title diagnostic, never an error',async()=>{
    await setup({imdb:'localized',netflix:'500'});const r=await lookup({...item,title:'合成片名甲'});
    assert.equal(r.status,'ok');assert.equal(r.confidence,'localized');assert.equal(r.retryAfterMs,undefined);
    assert.deepEqual(r.diagnostics,[{provider:'Netflix',stage:'title',kind:'http',status:500}]);assert.equal(await onlyTtl(),GOOD);assertSanitized(r);
  });
  await check('unexpected extension failure is sanitized in result and log, and backs off',async()=>{
    await setup({});
    await fixture(({MARKER,KEY})=>{
      globalThis.__warnings=[];globalThis.__warn=console.warn;console.warn=(...args)=>__warnings.push(JSON.stringify(args));
      const get=chrome.storage.local.get.bind(chrome.storage.local);globalThis.__get=chrome.storage.local.get;
      chrome.storage.local.get=keys=>keys==='overrides'?Promise.reject(Error(`${MARKER} https://www.omdbapi.com/?apikey=${KEY}`)):get(keys);
    },{MARKER,KEY});
    try {
      const r=await lookup();const warnings=await fixture(()=>__warnings);
      assert.equal(r.status,'error');assert.equal(r.retryAfterMs,PERMANENT);assert.ok(r.expiresAt-r.fetchedAt===PERMANENT);assert.equal(r.warning,'评分查询暂未完成，将自动重试');
      assert.deepEqual(r.diagnostics,[{provider:'Extension',stage:'extension',kind:'internal'}]);assertSanitized(r);
      assert.equal(warnings.length,1);assert.match(warnings[0],/internal/);assertSanitized({log:warnings});
      assert.equal((await send({type:'GET_UI'})).providerHealth.Search?.status==='error',false,'internal failures are not blamed on search');
    } finally {await fixture(()=>{chrome.storage.local.get=__get;console.warn=__warn;});}
  });
  await check('cache clear during parallel OMDb rejects late reply and write',async()=>{
    await setup({});await fixture(()=>{__n.hold=['omdb'];});const pending=lookup();
    await until(()=>__n.events.includes('start:omdb')&&__n.events.includes('end:meta'));
    await send({type:'CLEAR_CACHE'});await fixture(()=>__n.releases.splice(0).forEach(r=>r()));
    assert.equal((await pending).status,'disabled');assert.equal(Object.keys(await cache()).length,0);
  });
  await check('pause and quick resume during parallel OMDb cannot revive the old generation',async()=>{
    await setup({});await fixture(()=>{__n.hold=['omdb'];});const pending=lookup();
    await until(()=>__n.events.includes('start:omdb'));
    await send({type:'SAVE_SETTINGS',settings:{enabled:false}});await send({type:'SAVE_SETTINGS',settings:{enabled:true}});
    await fixture(()=>__n.releases.splice(0).forEach(r=>r()));
    assert.equal((await pending).status,'disabled');assert.equal(Object.keys(await cache()).length,0);
  });
  await check('identical concurrent lookups share one OMDb request and one cache entry',async()=>{
    await setup({});await fixture(()=>{__n.hold=['omdb'];});const a=lookup(),b=lookup();
    await until(()=>__n.events.includes('start:omdb'));await sleep(100);await fixture(()=>__n.releases.splice(0).forEach(r=>r()));
    const results=await Promise.all([a,b]);assert.ok(results.every(r=>r.status==='ok'&&r.ratings.rt.value===80));
    assert.equal(await omdbCalls(),1);assert.equal(Object.keys(await cache()).length,1);
  });
  await check('stored results never contain the Key, OMDb URL or raw exceptions',async()=>{
    for(const mode of [{omdb:'invalid'},{omdb:'network',meta:'unrated'},{search:'503',imdb:'network'}]){await setup(mode);await lookup();}
    const stored=await cache();for(const entry of Object.values(stored))assertSanitized(entry.result);
    assert.ok(await fixture(()=>__n.calls.every(c=>c.credentials==='omit')));
  });
  await send({type:'SAVE_SETTINGS',removeApiKey:true});
  await mkdir(join(root,'artifacts'),{recursive:true});await writeFile(join(root,'artifacts/network-reliability-report.json'),JSON.stringify(report,null,2));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
console.log(`RESULT ${report.length-failures}/${report.length}`);if(failures)process.exitCode=1;
