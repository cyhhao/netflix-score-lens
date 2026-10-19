// Real extension, deterministic HTML/providers: hidden popovers must not query.
import {chromium} from 'playwright';import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import assert from 'node:assert/strict';
import {executablePath} from './browser.mjs';
const root=resolve(import.meta.dirname,'..'),profile=await mkdtemp(join(tmpdir(),'scorelens-visibility-'));
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
const report=[],check=async(name,fn)=>{try{await fn();report.push({name,passed:true});console.log('PASS',name);}catch(e){report.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message);}};
const card=(id,name,attrs='')=>`<a ${attrs} aria-label="${name}" href="/browse?jbv=${id}"><img alt="${name}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"></a>`;
const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0}a{display:block;width:240px;height:130px}img{width:100%;height:100%}.panel{position:absolute;top:0;left:0}</style>
<script>window.netflix={reactContext:{models:{graphql:{data:Object.fromEntries(Array.from({length:7},(_,i)=>['Movie:{"videoId":'+(99010000+i)+'}',{releaseYear:2024}]))}}}};window.requestedIds=[];window.addEventListener('nsl:metadata-request',e=>requestedIds.push(...JSON.parse(e.detail)));</script>
<div id="notification" class="panel" data-uia="navigation+notifications" aria-hidden="true" style="visibility:hidden;opacity:0">${card('99010000','Notification Example','data-uia="navigation+notifications+item"')}</div>
<div id="cssHidden" class="panel" style="visibility:hidden">${card('99010001','CSS Hidden Example','data-uia="standard-card"')}</div>
<div id="toggleHidden" class="panel" hidden>${card('99010002','Toggle Hidden Example','data-uia="standard-card"')}</div>
<div id="hidden" class="panel" hidden>${card('99010003','Hidden Attribute Example','data-uia="standard-card"')}</div>
<div id="visible">${card('99010004','Visible Example','data-uia="standard-card"')}</div>
<div id="ariaOnly" aria-hidden="true">${card('99010006','ARIA Only Example','data-uia="standard-card"')}</div>
<div id="below" style="margin-top:2500px">${card('99010005','Below Example','data-uia="standard-card"')}</div>`;
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2];
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.evaluate(()=>chrome.runtime.sendMessage({type:'GET_UI'}));
  await worker.evaluate(()=>{globalThis.visibilityCalls=[];globalThis.fetch=async input=>{const url=String(input);visibilityCalls.push(url);let data;if(url.includes('/catalog/')){const name=decodeURIComponent(url.match(/search=(.*)\.json/)[1]);data={metas:[{id:'tt9901000',name,type:'movie',year:2024}]};}else if(url.includes('/meta/'))data={meta:{id:'tt9901000',name:'Visible Example',type:'movie',year:2024,imdbRating:6.1}};else throw Error('unexpected fixture request');return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});};});
  await context.route('https://www.netflix.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('https://www.netflix.com/browse');await page.locator('#visible .nsl-imdb').waitFor();await page.locator('#ariaOnly .nsl-imdb').waitFor();
  const summary=()=>worker.evaluate(async()=>chrome.tabs.sendMessage((await chrome.tabs.query({url:'https://www.netflix.com/*'}))[0].id,{type:'GET_PAGE'}));
  const requests=()=>worker.evaluate(()=>visibilityCalls);
  await check('hidden notifications and cards with positive rectangles make no metadata/provider requests',async()=>{
    const rect=await page.locator('#notification a').evaluate(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height};});assert.ok(rect.width>0&&rect.height>0);
    assert.equal(await page.locator('#notification .nsl-layer,#cssHidden .nsl-layer,#toggleHidden .nsl-layer,#hidden .nsl-layer,#below .nsl-layer').count(),0);
    const calls=await requests();assert.ok(calls.some(x=>x.includes('Visible%20Example')));assert.equal(calls.filter(x=>/Notification|Hidden|Below/.test(x)).length,0);
    const ids=await page.evaluate(()=>requestedIds);assert.ok(ids.includes('99010004'));assert.equal(ids.some(id=>['99010000','99010001','99010002','99010003','99010005'].includes(id)),false);
    assert.deepEqual((await summary()).items.map(x=>x.item.netflixId).sort(),['99010004','99010005','99010006']);
  });
  await check('ARIA-only hidden but visually rendered cards are still discovered and scored',async()=>{
    assert.equal(await page.locator('#ariaOnly').getAttribute('aria-hidden'),'true');assert.equal(await page.locator('#ariaOnly .nsl-imdb').count(),1);
    assert.ok((await summary()).items.some(x=>x.item.netflixId==='99010006'));assert.ok((await requests()).some(x=>x.includes('ARIA%20Only%20Example')));
    assert.ok((await page.evaluate(()=>requestedIds)).includes('99010006'));
  });
  await check('notification thumbnails never enter discovery or matching counts even when opened',async()=>{
    assert.equal((await summary()).items.some(x=>x.item.netflixId==='99010000'),false);
    await page.evaluate(()=>{const n=document.querySelector('#notification');n.style.visibility='visible';n.style.opacity='1';n.setAttribute('aria-hidden','false');});
    await page.waitForTimeout(500);assert.equal((await summary()).items.some(x=>x.item.netflixId==='99010000'),false);assert.equal(await page.locator('#notification .nsl-layer').count(),0);
  });
  await check('revealing a real card queries it; hiding removes decoration; showing reuses cached score',async()=>{
    await page.locator('#toggleHidden').evaluate(e=>e.hidden=false);await page.locator('#toggleHidden .nsl-imdb').waitFor();
    const count=(await requests()).length;await page.locator('#toggleHidden').evaluate(e=>e.hidden=true);await page.waitForFunction(()=>!document.querySelector('#toggleHidden .nsl-layer'));
    await page.locator('#toggleHidden').evaluate(e=>e.hidden=false);await page.locator('#toggleHidden .nsl-imdb').waitFor();assert.equal((await requests()).length,count);
  });
  await check('CSS visibility changes recover through the heartbeat without a reload',async()=>{
    await page.locator('#cssHidden').evaluate(e=>e.style.visibility='visible');await page.locator('#cssHidden .nsl-imdb').waitFor({timeout:6000});
    await page.locator('#cssHidden').evaluate(e=>e.style.visibility='hidden');await page.waitForFunction(()=>!document.querySelector('#cssHidden .nsl-layer'),null,{timeout:6000});
  });
  await check('offscreen genuine cards remain discoverable and are queried after scrolling',async()=>{
    assert.ok((await summary()).items.some(x=>x.item.netflixId==='99010005'));assert.equal((await requests()).some(x=>x.includes('Below%20Example')),false);
    await page.locator('#below').scrollIntoViewIfNeeded();await page.locator('#below .nsl-imdb').waitFor();assert.ok((await requests()).some(x=>x.includes('Below%20Example')));
  });
  await check('moving an existing card into notification UI removes it from discovery and decoration',async()=>{
    await page.evaluate(()=>document.querySelector('#notification').append(document.querySelector('#below a')));
    await page.waitForFunction(()=>!document.querySelector('#notification .nsl-layer'));assert.equal((await summary()).items.some(x=>x.item.netflixId==='99010005'),false);assert.deepEqual(errors,[]);
  });
  await mkdir(join(root,'artifacts'),{recursive:true});await writeFile(join(root,'artifacts/content-visibility-report.json'),JSON.stringify(report,null,2));
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
console.log(`RESULT ${report.filter(x=>x.passed).length}/${report.length}`);if(report.some(x=>!x.passed))process.exitCode=1;
