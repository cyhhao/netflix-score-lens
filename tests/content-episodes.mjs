// Disposable MV3 browser; all titles, IDs, page state and provider data are synthetic.
// Reproduces episode cards whose aria-label/h3 name an episode, not its show.
import {chromium} from 'playwright';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import assert from 'node:assert/strict';
import {executablePath} from './browser.mjs';
const root=resolve(import.meta.dirname,'..'),profile=await mkdtemp(join(tmpdir(),'scorelens-episodes-'));
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath,locale:'en-US',args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
const report=[],check=async(name,fn)=>{try{await fn();report.push({name,passed:true});console.log('PASS',name);}catch(e){report.push({name,passed:false,error:e.message});console.error('FAIL',name,e.message);}};
const svg="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";
const card=(id,video,label,episodic=true)=>`<a id="${id}" data-uia="${episodic?'episodic':'standard'}-card" href="/browse?jbv=${video}" aria-label="${label}"><img alt="" src="${svg}"><h3>${label}</h3></a>`;
const data={
  'Show:{"videoId":99030001}':{videoId:99030001,title:'Example Alpha',releaseYear:2018,secret:'PRIVATE'},
  'Show:{"videoId":99030002}':{videoId:99030002,title:'Example Beta',releaseYear:2020},
  'Episode:{"videoId":99031001}':{title:'試播集',releaseYear:2025,parentShow:{__ref:'Show:{"videoId":99030001}'}},
  'Episode:{"videoId":99031002}':{title:'第 1 章',parentShow:{__ref:'Show:{"videoId":99030001}'}},
  'Episode:{"videoId":99031003}':{title:'試播集',parentShow:{__ref:'Show:{"videoId":99030002}'}},
  'Episode:{"videoId":99031004}':{title:'試播集',releaseYear:2025},
  'Episode:{"videoId":99031005}':{title:'第 2 章',parentShow:{__ref:'Show:{"videoId":99030001}'}}
};
const html=`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><style>body{margin:20px;background:#141414;color:white}#cards{display:flex;flex-wrap:wrap;gap:8px}a{display:block;width:220px;height:155px;position:relative;background:#345}a>img{width:220px;height:110px}h3{font-size:13px;margin:2px}#below{margin-top:1800px}</style><script>window.netflix={reactContext:{models:{graphql:{data:${JSON.stringify(data)}}},userInfo:{secret:'PRIVATE'}}};window.requested=[];window.addEventListener('nsl:metadata-request',e=>requested.push(...JSON.parse(e.detail)));</script><section id="cards"><h2>First episodes — synthetic fixture</h2>${card('alpha','99031001','試播集')}${card('alpha2','99031002','第 1 章')}${card('beta','99031003','試播集')}${card('unknown','99031004','試播集')}${card('ordinary','99030001','Example Alpha',false)}</section><div id="below">${card('offscreen','99031005','第 2 章')}</div></html>`;
try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2];
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
  const send=m=>popup.evaluate(m=>chrome.runtime.sendMessage(m),m);
  await send({type:'GET_UI'});await send({type:'SAVE_SETTINGS',settings:{language:'en',providerMode:'free',minScore:7}});
  await worker.evaluate(async()=>{
    const now=Date.now();await chrome.storage.local.set({
      // A still-fresh poisoned legacy episode query must not be reused as the show result.
      cacheV3:{'nf:99031001|試播集|||free|false':{at:now,ttl:604800000,matchingVersion:1,result:{status:'ok',title:'Wrong Movie',queryTitle:'試播集',ratings:{imdb:{value:1,scale:10}},fetchedAt:now,expiresAt:now+604800000}}},
      overrides:{'nf:99030002':{id:'tt99030002',title:'Example Beta',year:2020,type:'series'}}
    });
    globalThis.calls=[];globalThis.fetch=async input=>{
      const url=String(input);calls.push(url);const beta=/Beta|tt99030002/.test(decodeURIComponent(url)),pilot=/Pilot|tt99030003/.test(decodeURIComponent(url)),imdb=pilot?'tt99030003':beta?'tt99030002':'tt99030001',name=pilot?'Pilot':beta?'Example Beta':'Example Alpha',year=beta?2020:2018,type=pilot?'movie':'series';
      const body=url.includes('/catalog/')?{metas:[{id:imdb,name,year,type}]}:url.includes('tvmaze')?{id:beta?2:1,name,externals:{imdb},rating:{average:beta?6.2:8.2}}:{meta:{id:imdb,name,year,type,imdbRating:pilot?'3.1':beta?'6.5':'8.7'}};
      return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
    };
  });
  await context.route('https://www.netflix.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:html}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://www.netflix.com/browse');
  const summary=()=>worker.evaluate(async()=>chrome.tabs.sendMessage((await chrome.tabs.query({url:'https://www.netflix.com/*'}))[0].id,{type:'GET_PAGE'}));
  const calls=()=>worker.evaluate(()=>calls.map(u=>decodeURIComponent(u)));
  const mountPreview=(video,label)=>page.evaluate(({video,label,svg})=>{
    document.querySelector('#episode-preview')?.remove();
    const root=document.createElement('div');root.id='episode-preview';root.dataset.uia='modal-motion-container-MINI_MODAL';root.style.cssText='position:fixed;top:180px;left:20px;width:320px;z-index:50';
    const media=document.createElement('div');media.dataset.uia='previewModal--player_container';media.style.cssText='height:180px;position:relative';
    const img=document.createElement('img');img.className='previewModal--boxart';img.alt=label;img.src=svg;media.append(img);
    const a=document.createElement('a');a.href=`/browse?jbv=${video}`;a.textContent='Details';root.append(media,a);document.body.append(root);
  },{video,label,svg});
  await check('different Pilot cards resolve to their own parent series, never episode-title provider queries',async()=>{
    await page.waitForFunction(()=>document.querySelector('#alpha .nsl-imdb')?.textContent==='IMDb 8.7'&&document.querySelector('#beta .nsl-imdb')?.textContent==='IMDb 6.5');
    const s=await summary();const a=s.items.find(x=>x.item.netflixId==='99030001'),b=s.items.find(x=>x.item.netflixId==='99030002');
    assert.equal(a.item.title,'Example Alpha');assert.equal(a.item.year,2018);assert.equal(a.item.type,'series');assert.equal(b.result.confidence,'manual');
    assert.equal((await calls()).some(u=>/試播集|第 1 章|Pilot/.test(u)),false);
    assert.equal(await page.locator('#alpha').getAttribute('aria-label'),'試播集');assert.equal(await page.locator('#alpha h3').textContent(),'試播集');
  });
  await check('two episodes and the ordinary show card share one lookup and bypass the old episode cache',async()=>{
    assert.equal(await page.locator('#alpha2 .nsl-imdb').textContent(),'IMDb 8.7');assert.equal(await page.locator('#ordinary .nsl-imdb').textContent(),'IMDb 8.7');
    assert.equal((await calls()).filter(u=>u.includes('/catalog/')&&u.includes('Example Alpha')).length,1);
    assert.equal((await calls()).filter(u=>u.includes('/meta/series/tt99030001')).length,1);
    assert.equal(await page.locator('#alpha.nsl-low').count(),0);assert.equal((await summary()).items.filter(x=>x.item.netflixId==='99030001').length,1);
    assert.equal((await worker.evaluate(()=>chrome.storage.local.get('overrides'))).overrides['nf:99030002'].id,'tt99030002');
  });
  await check('missing parent stays explicitly unresolved, undimmed and does not search the episode title',async()=>{
    assert.equal(await page.locator('#unknown .nsl-chip').textContent(),'Identifying TV show');assert.equal(await page.locator('#unknown.nsl-low').count(),0);
    await page.locator('#unknown .nsl-badges').click();assert.match(await page.locator('#nsl-root #panel').innerText(),/episode names are never used/);await page.getByRole('button',{name:'Close details',exact:true}).click();
    assert.equal((await calls()).some(u=>u.includes('99031004')),false);
  });
  await check('unresolved cards are excluded from popup corrections and progress, but explained on the card',async()=>{
    const s=await summary();assert.equal(s.items.some(x=>x.item.awaitingSeries),false);assert.equal(s.items.some(x=>x.item.netflixId==='99031004'),false);
    assert.equal(s.summary.discovered,s.items.length);assert.equal(s.summary.unresolved,2); // includes the offscreen episode not yet hydrated
    assert.doesNotMatch(await page.locator('#unknown .nsl-badges').getAttribute('title'),/popup|correct/);
    assert.doesNotMatch(await page.locator('#unknown .nsl-badges').getAttribute('aria-label'),/correction/);
  });
  await check('hover previews cannot search an unresolved episode name even when it matches a movie',async()=>{
    const before=(await calls()).length;await page.locator('#unknown').evaluate(e=>e.setAttribute('aria-label','Pilot'));await mountPreview('99031004','Pilot');await page.waitForTimeout(600);
    assert.equal(await page.locator('#episode-preview .nsl-layer').count(),0);assert.equal(await page.locator('#episode-preview .nsl-low').count(),0);assert.equal((await calls()).length,before);
    await page.locator('#episode-preview').evaluate(e=>e.remove());
  });
  await check('late parent metadata hydrates an unresolved episode without rescan/cache clear',async()=>{
    const before=(await calls()).length;
    await page.evaluate(()=>{
      const data={'Episode:{"videoId":99031004}':{parentShow:{__ref:'Show:{"videoId":99030002}'}}};
      window.netflix.appContext={state:{graphqlClient:{cache:{data:{data}}}}};
      document.querySelector('#unknown').title='metadata arrived';
    });
    await page.waitForFunction(()=>document.querySelector('#unknown .nsl-imdb')?.textContent==='IMDb 6.5');assert.equal((await calls()).length,before);
  });
  await check('recycling an episodic DOM slot with the same Pilot label switches identity without stale ratings',async()=>{
    const before=(await calls()).length;await page.locator('#alpha').evaluate(a=>a.href='/browse?jbv=99031003');
    await page.waitForFunction(()=>document.querySelector('#alpha .nsl-imdb')?.textContent==='IMDb 6.5');assert.equal((await calls()).length,before);
    await page.locator('#alpha .nsl-badges').click();assert.match(await page.locator('#nsl-root #panel').innerText(),/Example Beta/);assert.doesNotMatch(await page.locator('#nsl-root #panel').innerText(),/Example Alpha/);await page.getByRole('button',{name:'Close details',exact:true}).click();
  });
  await check('offscreen episode waits for the viewport and then shares the canonical cached score',async()=>{
    assert.equal((await page.evaluate(()=>requested)).includes('99031005'),false);assert.equal(await page.locator('#offscreen .nsl-layer').count(),0);
    const before=(await calls()).length;await page.locator('#offscreen').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('#offscreen .nsl-imdb')?.textContent==='IMDb 8.7');assert.equal((await calls()).length,before);
    assert.equal((await page.evaluate(()=>requested)).includes('99031005'),true);
  });
  await check('new virtualized episode slots are discovered and unknown identities never query arbitrary names',async()=>{
    await page.evaluate(svg=>{scrollTo(0,0);const a=document.createElement('a');a.id='new-slot';a.dataset.uia='episodic-card';a.href='/browse?jbv=99031999';a.setAttribute('aria-label','試播集');const img=document.createElement('img');img.src=svg;a.append(img);document.querySelector('#cards').append(a);},svg);
    await page.locator('#new-slot .nsl-chip').waitFor();assert.equal(await page.locator('#new-slot .nsl-chip').textContent(),'Identifying TV show');
    assert.equal((await calls()).some(u=>u.includes('99031999')||u.includes('試播集')),false);
    await send({type:'SAVE_SETTINGS',settings:{language:'zh-CN'}});await page.waitForFunction(()=>document.querySelector('#new-slot .nsl-chip')?.textContent==='待识别剧集');
  });
  await check('an unresolved replacement cannot expose an earlier normal-card result through GET_PAGE',async()=>{
    await page.evaluate(svg=>{
      const a=document.createElement('a');a.id='replaced';a.dataset.uia='standard-card';a.href='/browse?jbv=99034001';a.setAttribute('aria-label','Example Alpha');
      const img=document.createElement('img');img.src=svg;a.append(img);document.querySelector('#cards').append(a);
    },svg);
    await page.locator('#replaced .nsl-imdb').waitFor();
    await page.locator('#replaced').evaluate(a=>a.remove());
    await page.waitForTimeout(300);
    await page.evaluate(svg=>{
      const a=document.createElement('a');a.id='replaced';a.dataset.uia='episodic-card';a.href='/browse?jbv=99034001';a.setAttribute('aria-label','Pilot');
      const img=document.createElement('img');img.src=svg;a.append(img);document.querySelector('#cards').append(a);
    },svg);
    await page.waitForFunction(()=>document.querySelector('#replaced .nsl-chip')?.textContent==='待识别剧集');
    const entry=(await summary()).items.find(x=>x.item.netflixId==='99034001');assert.equal(entry,undefined);
    assert.equal((await calls()).some(u=>u.includes('Pilot')),false);
    const before=(await calls()).length;
    await mountPreview('99034001','Pilot');await page.waitForTimeout(600);assert.equal(await page.locator('#episode-preview .nsl-layer').count(),0);
    await page.locator('#replaced').evaluate(e=>e.remove());
    // Even a stale poster matching an older normal-card result must not revive this ID.
    await mountPreview('99034001','Example Alpha');await page.waitForTimeout(600);
    assert.equal(await page.locator('#episode-preview .nsl-layer').count(),0);assert.equal((await calls()).length,before);
    await page.locator('#episode-preview').evaluate(e=>e.remove());
  });
  await check('ordinary watch links known to be episodes resolve parents or fail closed, including Falcor',async()=>{
    const before=(await calls()).length;
    await page.evaluate(svg=>{
      window.netflix.falcorCache={videos:{'99035001':{summary:{value:{type:'episode'}},title:{value:'Legacy Show'},releaseYear:{value:2024}}}};
      for(const [id,video,label]of [['legacy-resolved','99031002','Legacy Show'],['legacy-unknown','99035001','Legacy Show']]){
        const root=document.createElement('div');root.className='title-card';const a=document.createElement('a');a.id=id;a.href=`/watch/${video}`;a.setAttribute('aria-label',label);
        const img=document.createElement('img');img.src=svg;a.append(img);root.append(a);document.querySelector('#cards').append(root);
      }
    },svg);
    await page.locator('#legacy-unknown').scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>document.querySelector('#legacy-resolved .nsl-imdb')?.textContent==='IMDb 8.7'&&document.querySelector('#legacy-unknown .nsl-chip')?.textContent==='待识别剧集');
    assert.equal(await page.locator('#legacy-unknown.nsl-low').count(),0);assert.equal((await calls()).length,before);
    assert.equal((await summary()).items.some(x=>x.item.netflixId==='99035001'),false);
  });
  await check('real popup explains mixed and all-unresolved episode pages in both languages without correction rows',async()=>{
    await send({type:'SAVE_SETTINGS',settings:{language:'en'}});await page.bringToFront();
    const created=context.waitForEvent('page');await worker.evaluate(()=>chrome.tabs.create({url:chrome.runtime.getURL('popup.html'),active:false}));const view=await created;
    let only;
    try{
      await view.waitForFunction(()=>document.querySelector('#pageHint')?.textContent.includes('excluded from title lookups'));
      assert.match(await view.locator('#stats').textContent(),/Identifying TV show/);
      await context.route('https://www.netflix.com/browse?episodes-only',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><style>a{display:block;width:220px;height:155px}</style>${card('only-a','99039001','Pilot')}${card('only-b','99039002','Pilot')}`}));
      const before=(await calls()).length;only=await context.newPage();only.on('pageerror',e=>errors.push(e.message));await only.goto('https://www.netflix.com/browse?episodes-only');
      await only.waitForFunction(()=>document.querySelectorAll('.nsl-chip').length===2);
      await view.waitForFunction(()=>document.querySelector('#pageTitle')?.textContent==='Identifying parent shows');
      assert.match(await view.locator('#pageHint').textContent(),/2 cards/);
      await view.locator('#tab-titles').click();assert.equal(await view.locator('#titleList .title-row').count(),0);
      await send({type:'SAVE_SETTINGS',settings:{language:'zh-CN'}});
      await view.waitForFunction(()=>document.querySelector('#pageTitle')?.textContent==='正在识别所属剧集');
      assert.match(await view.locator('#pageHint').textContent(),/2 张卡片/);assert.equal((await calls()).length,before);
    }finally{await view.close();if(only)await only.close();await page.bringToFront();}
  });
  await check('pause and playback clear episode overlays; no page errors or private-field leakage',async()=>{
    assert.equal(JSON.stringify(await summary()).includes('PRIVATE'),false);
    await send({type:'SAVE_SETTINGS',settings:{enabled:false}});await page.waitForFunction(()=>!document.querySelector('.nsl-layer'));
    await send({type:'SAVE_SETTINGS',settings:{enabled:true}});await page.locator('#alpha .nsl-imdb').waitFor();
    await page.evaluate(()=>{history.pushState({},'', '/watch/99031003');document.querySelector('#alpha').title='playback';});await page.waitForFunction(()=>!document.querySelector('.nsl-layer')&&document.querySelector('#nsl-root')?.hidden);assert.deepEqual(errors,[]);
  });
  await writeFile(join(root,'artifacts/content-episodes-report.json'),JSON.stringify(report,null,2));
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
console.log(`RESULT ${report.filter(x=>x.passed).length}/${report.length}`);if(report.some(x=>!x.passed))process.exitCode=1;
