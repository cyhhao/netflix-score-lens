// Deterministic fetch fixtures in a REAL MV3 worker, with real storage/UI.
// Synthetic title IDs; never an owner's profile or account/credential data.
import {chromium} from 'playwright';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import assert from 'node:assert/strict';
import {executablePath} from './browser.mjs';
const root=resolve(import.meta.dirname,'..'),profile=await mkdtemp(join(tmpdir(),'scorelens-matching-'));
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
const report=[],errors=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=async(name,fn)=>{try{await fn();report.push({name,passed:true});console.log('PASS',name);}catch(e){report.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message);}};
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2];
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`chrome-extension://${id}/library.html`);
  const send=m=>page.evaluate(m=>chrome.runtime.sendMessage(m),m);
  await send({type:'GET_UI'});
  await worker.evaluate(()=>{
    globalThis.__f={calls:[],original:[],english:[{id:'tt7000001',title:'Example Film',year:2024,type:'movie'}],status:200,hold:false,releases:[]};
    globalThis.fetch=async(input,options={})=>{
      const f=globalThis.__f,u=new URL(String(input));f.calls.push({url:u.href,credentials:options.credentials,referrerPolicy:options.referrerPolicy,language:options.headers?.['Accept-Language']});
      if(u.hostname==='www.netflix.com') {
        if(f.hold)await new Promise(resolve=>f.releases.push(resolve));
        const id=u.pathname.split('/').at(-1);
        const html=`<!doctype html><html lang="en"><meta property="al:ios:url" content="nflx://www.netflix.com/title/${id}"><h1>Example Film</h1><script>DO_NOT_STORE_HTML_OR_EXECUTE</script></html>`;
        const r=new Response(html,{status:f.status,headers:{'Content-Type':'text/html'}});Object.defineProperty(r,'url',{value:`https://www.netflix.com/hk-en/title/${id}`});return r;
      }
      let data={};
      if(u.hostname.includes('cinemeta')) {
        if(u.pathname.includes('/meta/'))data={meta:{id:u.pathname.split('/').at(-1).replace('.json',''),type:'movie',name:'Example Film',year:2024,imdbRating:6.1}};
        else data={metas:(decodeURIComponent(u.pathname).includes('search=Example Film')?f.english:[]).map(c=>({...c,name:c.title}))};
      } else if(u.hostname==='v3.sg.media-imdb.com') {
        const english=decodeURIComponent(u.pathname).includes('Example Film');
        data={d:(english?f.english:f.original).map(c=>({id:c.id,l:c.title,y:c.year,qid:c.type==='movie'?'movie':'tvSeries'}))};
      } else if(u.hostname==='www.omdbapi.com')data={Response:'True',imdbID:'tt7000001',Title:'Example Film',Year:'2024',Type:'movie',imdbRating:'6.1'};
      else throw Error('Unexpected fixture host');
      return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
    };
  });
  const item={title:'合成片名甲',netflixId:'70000001',year:2024,type:'movie'};
  const lookup=(changes={})=>send({type:'LOOKUP',item:{...item,...changes}});
  const aliases=()=>worker.evaluate(()=>__f.calls.filter(c=>c.url.startsWith('https://www.netflix.com/')).length);
  const snapshot=()=>worker.evaluate(()=>chrome.storage.local.get(['cacheV3','netflixTitlesV1']));
  const until=async(fn)=>{for(let i=0;i<500;i++){if(await worker.evaluate(fn))return;await sleep(20);}throw Error('fixture wait timed out');};
  const release=()=>worker.evaluate(()=>{__f.hold=false;__f.releases.splice(0).forEach(r=>r());});
  const reset=async()=>{
    await release();await send({type:'SAVE_SETTINGS',settings:{enabled:true,language:'en'}});await send({type:'CLEAR_CACHE'});
    await worker.evaluate(()=>{__f.calls=[];__f.original=[];__f.english=[{id:'tt7000001',title:'Example Film',year:2024,type:'movie'}];__f.status=200;});
  };
  await check('English alias rescues an empty localized search in the actual worker',async()=>{
    await reset();const r=(await lookup()).result;
    assert.equal(r.status,'ok');assert.equal(r.id,'tt7000001');assert.equal(r.confidence,'high');assert.equal(r.netflixTitle.title,'Example Film');assert.equal(r.ratings.imdb.value,6.1);
    const data=await snapshot();assert.equal(data.netflixTitlesV1[item.netflixId].ttl,604800000);assert.equal(Object.values(data.cacheV3)[0].matchingVersion,1);assert.ok(r.expiresAt>Date.now());assert.equal(JSON.stringify(data).includes('DO_NOT_STORE'),false);
  });
  await check('positive alias cache survives a different localized query signature; rating cache hits stay offline',async()=>{
    const before=await aliases();await lookup({title:'合成片名乙'});assert.equal(await aliases(),before);
    const count=await worker.evaluate(()=>__f.calls.length);await lookup({title:'合成片名乙'});assert.equal(await worker.evaluate(()=>__f.calls.length),count);
  });
  await check('legacy weak cache upgrades automatically, legacy high/manual caches are retained',async()=>{
    await reset();const key='nf:70000001|合成片名甲|2024|movie|auto|false';
    await worker.evaluate(async key=>chrome.storage.local.set({cacheV3:{[key]:{at:Date.now(),ttl:604800000,result:{status:'not_found',ratings:{}}}}}),key);
    assert.equal((await lookup()).result.confidence,'high');assert.equal(await aliases(),1);
    for(const confidence of ['high','manual']) {
      await worker.evaluate(async({key,confidence})=>chrome.storage.local.set({cacheV3:{[key]:{at:Date.now(),ttl:604800000,result:{status:'ok',confidence,ratings:{}}}}}),{key,confidence});
      const before=await worker.evaluate(()=>__f.calls.length);assert.equal((await lookup()).result.confidence,confidence);assert.equal(await worker.evaluate(()=>__f.calls.length),before);
    }
  });
  await check('concurrent query variants for one Netflix ID share one alias request',async()=>{
    await reset();await worker.evaluate(()=>__f.hold=true);
    const a=lookup(),b=lookup({title:'合成片名乙'});await until(()=>__f.releases.length===1&&__f.calls.filter(c=>c.url.includes('media-imdb')).length>=2);await sleep(300);
    assert.equal(await aliases(),1);await release();const results=await Promise.all([a,b]);assert.ok(results.every(r=>r.result.confidence==='high'));assert.equal(await aliases(),1);
  });
  await check('clear-cache deletes both caches and prevents old alias/score writes and replies',async()=>{
    await reset();await worker.evaluate(()=>__f.hold=true);const pending=lookup();await until(()=>__f.releases.length===1);
    await send({type:'CLEAR_CACHE'});await release();assert.equal((await pending).result.status,'disabled');const data=await snapshot();assert.equal(Object.keys(data.cacheV3||{}).length,0);assert.equal(Object.keys(data.netflixTitlesV1||{}).length,0);
  });
  await check('pause followed by resume does not revive an already canceled request generation',async()=>{
    await reset();await worker.evaluate(()=>__f.hold=true);const pending=lookup();await until(()=>__f.releases.length===1);
    await send({type:'SAVE_SETTINGS',settings:{enabled:false}});const before=await worker.evaluate(()=>__f.calls.length);assert.equal((await lookup({netflixId:'70000002'})).result.status,'disabled');assert.equal(await worker.evaluate(()=>__f.calls.length),before);
    await send({type:'SAVE_SETTINGS',settings:{enabled:true}});await release();assert.equal((await pending).result.status,'disabled');const data=await snapshot();assert.equal(Object.keys(data.netflixTitlesV1||{}).length,0);assert.equal(Object.keys(data.cacheV3||{}).length,0);
  });
  await check('manual binding wins over a late alias response; unbinding restores automatic matching',async()=>{
    await reset();await worker.evaluate(()=>__f.hold=true);const pending=lookup();await until(()=>__f.releases.length===1);
    const candidate={id:'tt7000002',title:'Manual Example',year:2024,type:'movie'};const bound=await send({type:'BIND',item,candidate});assert.equal(bound.result.confidence,'manual');assert.equal(bound.result.id,candidate.id);
    await release();assert.equal((await pending).result.status,'disabled');assert.equal((await lookup()).result.id,candidate.id);
    await send({type:'UNBIND',item});assert.equal((await lookup()).result.id,'tt7000001');
  });
  await check('negative title pages are briefly cached without replacing baseline results',async()=>{
    await reset();await worker.evaluate(()=>__f.status=404);
    assert.equal((await lookup()).result.status,'not_found');assert.equal((await lookup({title:'合成片名乙'})).result.status,'not_found');assert.equal(await aliases(),1);
    assert.equal((await snapshot()).netflixTitlesV1[item.netflixId].ttl,600000);
  });
  await check('transient title failure preserves localized scores and their normal reuse window',async()=>{
    await reset();await worker.evaluate(()=>{__f.status=500;__f.original=[{id:'tt7000001',title:'Example Film',year:2024,type:'movie'}];});
    const r=(await lookup()).result;assert.equal(r.status,'ok');assert.equal(r.confidence,'localized');assert.match(r.warning,/回退/);assert.ok(r.expiresAt-Date.now()>604000000);
    const data=await snapshot();assert.equal(data.netflixTitlesV1[item.netflixId].ttl,60000);assert.equal(Object.values(data.cacheV3)[0].ttl,604800000);
  });
  await check('alias failure does not consume repeated provider/OMDb quota as its short cache expires',async()=>{
    await reset();await send({type:'SAVE_SETTINGS',apiKey:'fixture-not-a-secret'});
    await worker.evaluate(()=>{__f.status=500;__f.original=[{id:'tt7000001',title:'Example Film',year:2024,type:'movie'}];});await lookup();
    const before=await worker.evaluate(()=>__f.calls.length),omdbBefore=await worker.evaluate(()=>__f.calls.filter(c=>c.url.includes('omdbapi')).length);assert.equal(omdbBefore,1);
    try {
      // Age both caches one hour: the alias is long expired, the rating is not.
      // Repeated encounters must reuse the good score without requesting either.
      await worker.evaluate(async()=>{const d=await chrome.storage.local.get(['cacheV3','netflixTitlesV1']);for(const map of Object.values(d))for(const e of Object.values(map)){e.at-=3600000;if(e.result.expiresAt)e.result.expiresAt-=3600000;}await chrome.storage.local.set(d);});
      for(let i=0;i<12;i++)assert.equal((await lookup()).result.status,'ok');
      assert.equal(await worker.evaluate(()=>__f.calls.length),before);
      assert.equal(await worker.evaluate(()=>__f.calls.filter(c=>c.url.includes('omdbapi')).length),omdbBefore);
    } finally {await send({type:'SAVE_SETTINGS',removeApiKey:true});}
  });
  await check('contradictory localized and English identities remain unscored for review',async()=>{
    await reset();await worker.evaluate(()=>__f.original=[{id:'tt7000002',title:'Other Film',year:2024,type:'movie'}]);const r=(await lookup()).result;
    assert.equal(r.status,'ambiguous');assert.deepEqual(r.ratings,{});assert.equal(r.id,undefined);assert.equal(r.candidates.length,2);assert.match(r.matchReason,/证据不一致/);
  });
  await check('600-entry alias cache evicts the oldest without retaining HTML',async()=>{
    await reset();await worker.evaluate(async()=>{const titles=Object.fromEntries(Array.from({length:600},(_,i)=>[String(71000000+i),{at:Date.now()-600000+i,ttl:600000,result:{status:'unavailable'}}]));await chrome.storage.local.set({netflixTitlesV1:titles});});
    await lookup();const data=await snapshot();assert.equal(Object.keys(data.netflixTitlesV1).length,600);assert.equal(data.netflixTitlesV1['71000000'],undefined);assert.ok(data.netflixTitlesV1['70000001']);
  });
  await check('English-title provenance is visible and searchable in the real library in both languages',async()=>{
    await reset();await worker.evaluate(()=>__f.original=[{id:'tt7000002',title:'Other Film',year:2024,type:'movie'}]);await lookup();
    await page.reload();await page.waitForFunction(()=>document.querySelector('#statTotal')?.textContent==='1');
    const calls=await worker.evaluate(()=>__f.calls.length);await page.locator('#query').fill('Example Film');assert.equal(await page.locator('.card').count(),1);await page.locator('.details').click();
    assert.match(await page.locator('.details-panel').textContent(),/Netflix English display title: Example Film/);assert.match(await page.locator('.reason').textContent(),/evidence disagree/);
    assert.equal(await page.getByRole('link',{name:'Netflix title source ↗',exact:true}).getAttribute('href'),'https://www.netflix.com/hk-en/title/70000001');
    await page.locator('#language').selectOption('zh-CN');await page.waitForFunction(()=>document.documentElement.lang==='zh-CN');assert.match(await page.locator('.details-panel').textContent(),/Netflix 英文展示名：Example Film/);assert.equal(await worker.evaluate(()=>__f.calls.length),calls);
  });
  await check('real content badges and popup expose provenance; conflicts never dim',async()=>{
    await send({type:'SAVE_SETTINGS',settings:{language:'en'}});
    const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><style>a{display:block;width:260px;height:150px}img{width:100%;height:100%}</style><script>window.netflix={reactContext:{models:{graphql:{data:{'Movie:{"videoId":70000001}':{releaseYear:2024}}}}}};</script><a data-uia="standard-card" aria-label="合成片名甲" href="/browse?jbv=70000001"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"></a></html>`;
    await context.route('https://www.netflix.com/browse',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html}));
    const netflix=await context.newPage();netflix.on('pageerror',e=>errors.push(e.message));await netflix.goto('https://www.netflix.com/browse');
    await netflix.waitForFunction(()=>document.querySelector('.nsl-chip')?.textContent==='Needs review');assert.equal(await netflix.locator('.nsl-low').count(),0);
    await netflix.locator('.nsl-badges').click();assert.match(await netflix.locator('#nsl-root #panel').textContent(),/Netflix English display title: Example Film/);
    const created=context.waitForEvent('page');await worker.evaluate(()=>chrome.tabs.create({url:chrome.runtime.getURL('popup.html'),active:false}));const popup=await created;popup.on('pageerror',e=>errors.push(e.message));
    await popup.waitForSelector('#tab-titles');await popup.locator('#tab-titles').click();await popup.locator('#titleFilter').fill('Example Film');await popup.waitForSelector('#titleList .title-row');
    assert.equal(await popup.locator('#titleList .title-row').count(),1);await popup.locator('.title-row').click();
    assert.match(await popup.locator('.detail-match').textContent(),/Netflix English display title: Example Film/);assert.match(await popup.locator('.detail-match').textContent(),/evidence disagree/);
    assert.equal(await popup.getByRole('link',{name:'Netflix title source ↗',exact:true}).getAttribute('href'),'https://www.netflix.com/hk-en/title/70000001');
    await worker.evaluate(()=>__f.original=[]);await send({type:'CLEAR_CACHE'});await netflix.waitForSelector('.nsl-imdb');assert.equal(await netflix.locator('.nsl-low').count(),1);
    await send({type:'SAVE_SETTINGS',settings:{language:'zh-CN'}});await popup.waitForFunction(()=>document.documentElement.lang==='zh-CN');assert.match(await popup.locator('.detail-match').textContent(),/Netflix 英文展示名：Example Film/);
    await popup.close();await netflix.close();
  });
  await check('all automatic requests omit credentials, and Netflix requests ask for English without a referrer',async()=>{
    const calls=await worker.evaluate(()=>__f.calls);assert.ok(calls.length);assert.ok(calls.every(c=>c.credentials==='omit'));const nf=calls.find(c=>c.url.includes('www.netflix.com'));assert.equal(nf.referrerPolicy,'no-referrer');assert.match(nf.language,/en-US/);assert.deepEqual(errors,[]);
  });
  await mkdir(join(root,'artifacts'),{recursive:true});await writeFile(join(root,'artifacts/matching-integration-report.json'),JSON.stringify(report,null,2));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
console.log(`RESULT ${report.filter(x=>x.passed).length}/${report.length}`);if(report.some(x=>!x.passed))process.exitCode=1;
