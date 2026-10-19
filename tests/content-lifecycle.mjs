// Real extension reloads in a disposable browser. Sources and titles are synthetic.
import {chromium} from 'playwright';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {executablePath} from './browser.mjs';
const root=resolve(import.meta.dirname,'..'),profile=await mkdtemp(join(tmpdir(),'scorelens-lifecycle-'));
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath,locale:'en-US',args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
const report=[];let failures=0;
const check=async(name,fn)=>{try{await fn();report.push({name,passed:true});console.log('PASS',name);}catch(e){failures++;report.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message);}};
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><style>body{background:#141414}a{display:block;width:260px;height:150px;background:#345;margin:30px}img{width:100%;height:100%}</style><script>window.netflix={reactContext:{models:{graphql:{data:{'Movie:{"videoId":99000001}':{releaseYear:2024}}}}}};</script><a data-uia="standard-card" aria-label="Lifecycle Demo" href="/browse?jbv=99000001"><img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"></a></html>`;
try{
 let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=worker.url().split('/')[2];
 // Enable developer mode through the disposable browser's UI: Chrome otherwise
 // disables command-line-loaded unpacked extensions on their first reload.
 const manager=await context.newPage();await manager.goto('chrome://extensions');
 const devMode=manager.locator('extensions-toolbar #devMode');
 if(await devMode.getAttribute('aria-checked')!=='true')await devMode.click();
 assert.equal(await devMode.getAttribute('aria-checked'),'true');await manager.close();
 let ui=await context.newPage();await ui.goto(`chrome-extension://${id}/library.html`);
 const send=m=>ui.evaluate(m=>chrome.runtime.sendMessage(m),m);
 await send({type:'GET_UI'});await send({type:'SAVE_SETTINGS',settings:{language:'en',providerMode:'free',minScore:7}});
 await worker.evaluate(async()=>{globalThis.fetch=()=>{throw Error('Unexpected provider call in lifecycle test');};await chrome.storage.local.set({cacheV3:{'nf:99000001|Lifecycle Demo|2024|movie|free|false':{at:Date.now(),ttl:604800000,result:{status:'ok',confidence:'high',title:'Lifecycle Demo',id:'tt99000001',year:2024,type:'movie',ratings:{imdb:{value:5.8,scale:10,provider:'Fixture',url:'https://www.imdb.com/'}},fetchedAt:Date.now()}}}});});
 await context.route('https://www.netflix.com/**',r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));
 const pages=[];
 async function openPage(){
   const page=await context.newPage(),cdp=await context.newCDPSession(page),worlds=[],errors=[];
   cdp.on('Runtime.executionContextCreated',({context:c})=>worlds.push(c));
   cdp.on('Runtime.exceptionThrown',({exceptionDetails:d})=>errors.push({text:d.exception?.description||d.text,stack:d.stackTrace}));
   await cdp.send('Runtime.enable');await page.goto('https://www.netflix.com/browse',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('.nsl-imdb');let world;
   for(const c of worlds){try{const r=await cdp.send('Runtime.evaluate',{contextId:c.id,expression:'typeof chrome!=="undefined" && chrome.runtime?.id',returnByValue:true});if(r.result.value===id){world=c;break;}}catch{}}
   assert.ok(world,'real extension isolated world found');
   const isolated=async expression=>{const r=await cdp.send('Runtime.evaluate',{contextId:world.id,expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
   // Count actual old-world API calls and scanning; instrumentation does not suppress errors.
   await isolated(`(()=>{window.probe={manifest:0,messages:0,queries:0};const manifest=chrome.runtime.getManifest.bind(chrome.runtime),send=chrome.runtime.sendMessage.bind(chrome.runtime),query=document.querySelectorAll.bind(document);chrome.runtime.getManifest=(...args)=>{probe.manifest++;return manifest(...args)};chrome.runtime.sendMessage=(...args)=>{probe.messages++;const r=send(...args);if(window.holdLookup&&args[0]?.type==='LOOKUP'){window.lookupHeld=true;return Promise.resolve(r).then(value=>new Promise(resolve=>{window.releaseLookup=()=>resolve(value)}))}return r};document.querySelectorAll=(...args)=>{probe.queries++;return query(...args)};return true})()`);
   const value={page,cdp,isolated,errors};pages.push(value);return value;
 }
 const idle=await openPage(),pending=await openPage();
 await check('initial low score renders in both tabs',async()=>{for(const {page} of pages)assert.equal(await page.locator('.nsl-low').count(),1);});
 await check('content localization leaves Netflix document language untouched',async()=>{assert.equal(await idle.page.locator('html').getAttribute('lang'),'ja');assert.equal(await idle.page.locator('.nsl-layer').getAttribute('lang'),'en');});
 await check('language sync updates HUD brand, aria labels and open panel',async()=>{
   await idle.page.locator('#nsl-root').getByRole('button',{name:'Open Score Lens status'}).click();
   await send({type:'SAVE_SETTINGS',settings:{language:'zh-CN'}});
   await idle.page.waitForFunction(()=>document.querySelector('#nsl-root')?.shadowRoot.querySelector('#toggle b')?.textContent.includes('评分镜片'),null,{timeout:2000});
   assert.equal(await idle.page.locator('#nsl-root').getByRole('button',{name:'打开评分镜片状态'}).count(),1);
   assert.equal(await idle.page.locator('#nsl-root').getByRole('heading',{name:'评分镜片',exact:true}).count(),1);
   assert.equal(await idle.page.locator('html').getAttribute('lang'),'ja');
   assert.equal(await idle.page.locator('.nsl-layer').getAttribute('lang'),'zh-CN');
 });
 await send({type:'SAVE_SETTINGS',settings:{language:'en'}});
 const playback=await openPage();
 await playback.page.evaluate(()=>{history.pushState({},'', '/watch/99000001');document.querySelector('a').title='playback';});
 await playback.page.waitForFunction(()=>document.querySelector('#nsl-root')?.hidden&&!document.querySelector('.nsl-layer'));
 await pending.isolated('window.holdLookup=true');
 // Request a content reset to hold a cached reply in flight.
 await worker.evaluate(async()=>{for(const t of await chrome.tabs.query({url:'https://www.netflix.com/*'}))await chrome.tabs.sendMessage(t.id,{type:'RESET'});});
 await pending.page.waitForFunction(()=>document.querySelector('.nsl-chip')?.textContent==='Loading ratings');
 await check('in-flight lookup is held before the real reload',async()=>{
   // The pending badge precedes the async cached reply. Wait for the actual
   // release hook, not merely the loading UI, before invalidating the runtime.
   await pending.isolated('new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const poll=()=>{if(window.lookupHeld&&typeof window.releaseLookup==="function")return resolve(true);if(Date.now()>=deadline)return reject(Error("Cached lookup reply was not held before reload"));setTimeout(poll,20)};poll()})');
   assert.equal(await pending.isolated('!!window.lookupHeld'),true);assert.equal(await pending.isolated('typeof window.releaseLookup'),'function');
 });
 const beforeStorage=await worker.evaluate(()=>chrome.storage.local.get(['settings','credentials','cacheV3','overrides']));
 const closed=worker.waitForEvent('close');
 await worker.evaluate(()=>{setTimeout(()=>chrome.runtime.reload(),0);});await closed;
 // Timer-based lifecycle detection must work even with no DOM/user activity.
 await new Promise(resolve=>setTimeout(resolve,3800));
 await check('real extension reload produces no uncaught exceptions in old tabs',async()=>{assert.deepEqual(pages.flatMap(p=>p.errors),[]);});
 await check('invalidated tabs remove stale badges, dimming and HUD',async()=>{for(const {page} of pages)assert.equal(await page.locator('.nsl-layer,.nsl-low,#nsl-root').count(),0);});
 await check('reload gives a localized refresh notice with a working dismiss control',async()=>{
   assert.equal(await idle.page.locator('#nsl-reload-notice').count(),1);
   assert.match(await idle.page.locator('#nsl-reload-notice').innerText(),/refresh/i);
   await idle.page.locator('#nsl-reload-notice').getByRole('button',{name:'Dismiss'}).click();
   assert.equal(await idle.page.locator('#nsl-reload-notice').count(),0);
 });
 await check('reload during playback stays quiet and never refreshes the player',async()=>{assert.equal(await playback.page.locator('#nsl-reload-notice').count(),0);assert.equal(playback.page.url(),'https://www.netflix.com/watch/99000001');});
 const counters=await Promise.all(pages.map(p=>p.isolated('({...probe})')));
 await pending.isolated('window.releaseLookup();true');
 for(const {page}of pages)await page.evaluate(()=>{window.dispatchEvent(new Event('scroll'));window.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('online'));window.dispatchEvent(new CustomEvent('nsl:metadata-response',{detail:'{"99000001":{"year":2025,"type":"movie"}}'}));document.querySelector('a').title='changed after reload';});
 await new Promise(resolve=>setTimeout(resolve,3600));
 await check('old timers, DOM events and late replies do not restart work',async()=>{assert.deepEqual(await Promise.all(pages.map(p=>p.isolated('({...probe})'))),counters);for(const {page}of pages)assert.equal(await page.locator('.nsl-layer,.nsl-low,#nsl-root').count(),0);assert.deepEqual(pages.flatMap(p=>p.errors),[]);});
 // Reopen the extension UI after its old context was invalidated.
 if(ui.isClosed())ui=await context.newPage();
 await ui.goto(`chrome-extension://${id}/library.html`);
 worker=context.serviceWorkers().find(w=>w.url().includes(id))||await context.waitForEvent('serviceworker');
 await check('settings and cached records survive extension reload',async()=>{assert.deepEqual(await worker.evaluate(()=>chrome.storage.local.get(['settings','credentials','cacheV3','overrides'])),beforeStorage);});
 await worker.evaluate(()=>{globalThis.fetch=()=>{throw Error('Unexpected provider call after reload');};});
 await idle.page.reload({waitUntil:'domcontentloaded'});
 await check('page refresh restores one new HUD and rating overlay',async()=>{await idle.page.waitForSelector('.nsl-imdb');assert.equal(await idle.page.locator('#nsl-root').count(),1);assert.equal(await idle.page.locator('.nsl-imdb').count(),1);assert.equal(await idle.page.locator('.nsl-low').count(),1);assert.equal(await idle.page.locator('#nsl-reload-notice').count(),0);});
 await check('refreshed content still responds to settings changes',async()=>{await ui.goto(`chrome-extension://${id}/library.html`);await send({type:'SAVE_SETTINGS',settings:{enabled:false}});await idle.page.waitForFunction(()=>!document.querySelector('.nsl-layer'));assert.deepEqual(idle.errors,[]);});
 await writeFile(join(root,'artifacts/content-lifecycle-report.json'),JSON.stringify(report,null,2));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
console.log(`RESULT ${report.length-failures}/${report.length}`);if(failures)process.exitCode=1;
