// README screenshots: real packaged UI/runtime with explicitly synthetic data.
// No normal browser, account, credentials, remote assets or provider calls.
import {chromium} from 'playwright';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const locale=process.argv[2]||'en';
if(!['en','zh-CN'].includes(locale)) throw new Error(`Unsupported screenshot locale: ${locale}`);
const suffix=locale==='en'?'.en':'.zh-CN';
const root=resolve(import.meta.dirname,'..'),out=join(root,'docs/screenshots');
await mkdir(out,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'scorelens-readme-'));
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_PATH||process.env.CFT_PATH||chromium.executablePath(),viewport:{width:1280,height:720},deviceScaleFactor:1,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
const works=[
  {id:'9900001',title:'Northbound · Demo',type:'series',score:9.1,tvmaze:8.7,color:'#527d80',label:'NORTHBOUND'},
  {id:'9900002',title:'Night Signal · Demo',type:'movie',score:5.8,color:'#9b5769',label:'NIGHT SIGNAL'},
  {id:'9900003',title:'Beyond Blue · Demo',type:'movie',score:8.2,color:'#5368a0',label:'BEYOND BLUE'},
  {id:'9900004',title:'Open Ending · Demo',type:'series',score:null,color:'#967d4d',label:'OPEN ENDING'}
];
// Page copy follows the README locale; titles and ratings stay fixed, fictional and English.
const copy={
  en:{doc:'Score Lens — illustrative card demonstration',note:'DEMO PAGE · SYNTHETIC TITLES & RATINGS',poster:'ILLUSTRATIVE TITLE · DEMO DATA',heading:'Keep the ratings in view.',intro:'The actual extension adds badges and dims low-rated cards. This controlled page demonstrates the overlay; it is not a screenshot of a Netflix account.',type:{series:'Series',movie:'Movie'},demo:'Demo',legend:[['Separate sources','no averaged scores'],['Below 7.0','dimmed, not removed'],['No rating','left untouched']],footer:'Original placeholder artwork. All data in this demonstration is synthetic; no personal browsing information is shown.',ratingTitle:'DEMO · synthetic rating',reason:'Demo data; UI showcase only',provider:'Demo data'},
  'zh-CN':{doc:'Score Lens — 示意卡片演示页',note:'演示页面 · 虚构片名与评分',poster:'示意片名 · 演示数据',heading:'评分，一眼可见。',intro:'评分角标与低分遮罩由真实插件渲染。这是受控的演示页面，用于展示叠加效果，不是 Netflix 账户截图。',type:{series:'剧集',movie:'电影'},demo:'演示',legend:[['来源分别标注','不取平均分'],['低于 7.0','变暗而非移除'],['暂无评分','保持原样']],footer:'占位海报为原创图形。演示中的所有数据均为虚构，不含任何个人浏览信息。',ratingTitle:'DEMO · 非实时评分',reason:'演示数据，仅展示界面功能',provider:'演示数据'}
}[locale];
const poster=w=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="520" height="294"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${w.color}"/><stop offset="1" stop-color="#17242f"/></linearGradient></defs><rect width="520" height="294" fill="url(#g)"/><circle cx="410" cy="46" r="145" fill="#fff" opacity=".08"/><path d="M0 234L165 94L337 294H0Z" fill="#fff" opacity=".13"/><path d="M140 294L340 152L520 294Z" fill="#08131e" opacity=".24"/><text x="30" y="234" fill="#fff" font-size="28" font-family="sans-serif" font-weight="700">${w.label}</text><text x="32" y="264" fill="#fff" opacity=".7" font-size="13" font-family="sans-serif">${copy.poster}</text></svg>`);
const metadata=Object.fromEntries(works.map(w=>[`${w.type==='series'?'Show':'Movie'}:{"videoId":${w.id}}`,{releaseYear:2024}]));
const fixture=`<!doctype html><html lang="${locale}"><meta charset="utf-8"><title>${copy.doc}</title><style>*{box-sizing:border-box}body{margin:0;background:#11151a;color:#ece7dc;font-family:system-ui}header{padding:26px 54px;border-bottom:1px solid #ffffff14;display:flex;align-items:center;justify-content:space-between}.brand{font-weight:750;letter-spacing:2px;color:#efbd62}.note{font-size:12px;color:#a1aab3}main{padding:48px 54px}h1{font-size:34px;letter-spacing:-1px;margin:0 0 12px}p{font-size:15px;color:#a1aab3;max-width:820px;line-height:1.7;margin:0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:34px}.card a{position:relative;display:block;aspect-ratio:520/294;border-radius:10px;overflow:hidden}.card img{display:block;width:100%;height:100%}.card h2{font-size:14px;margin:16px 0 4px}.card span{color:#909aa4;font-size:12px}.legend{margin-top:36px;padding:18px 22px;background:#ffffff05;border:1px solid #ffffff0d;border-radius:10px;display:flex;gap:32px;font-size:13px;color:#adb7c0}.legend b{color:#e6d5b3}footer{margin-top:36px;font-size:12px;color:#74808b}</style><script>window.netflix={reactContext:{models:{graphql:{data:${JSON.stringify(metadata)}}}}};</script><header><div class="brand">SCORE LENS</div><div class="note">${copy.note}</div></header><main><h1>${copy.heading}</h1><p>${copy.intro}</p><div class="grid">${works.map(w=>`<article class="card"><a data-uia="standard-card" aria-label="${w.title}" href="/browse?jbv=${w.id}"><img alt="" src="${poster(w)}"></a><h2>${w.title}</h2><span>${copy.type[w.type]} · 2024 · ${copy.demo}</span></article>`).join('')}</div><div class="legend">${copy.legend.map(([b,t])=>`<div><b>${b}</b> · ${t}</div>`).join('')}</div><footer>${copy.footer}</footer></main></html>`;
// Only the Netflix document is served (from the fixture); any other web request fails the run.
const external=[];
try {
  await context.route(/^https?:\/\//,route=>{const url=route.request().url();if(new URL(url).hostname==='www.netflix.com')return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture});external.push(url);return route.abort();});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2];
  const probe=await context.newPage();await probe.goto(`chrome-extension://${id}/popup.html`);await probe.evaluate(()=>chrome.runtime.sendMessage({type:'GET_UI'}));await probe.close();
  await worker.evaluate(async ({works,copy,locale})=>{
    globalThis.screenshotNetworkCalls=0;
    globalThis.fetch=async()=>{screenshotNetworkCalls++;throw Error('Screenshots must not request providers');};
    const cacheV3={},now=Date.now();
    for(const w of works){
      const ratings={};
      if(w.score!==null)ratings.imdb={value:w.score,scale:10,provider:copy.provider,url:'https://www.imdb.com/'};
      if(w.tvmaze)ratings.tvmaze={value:w.tvmaze,scale:10,provider:copy.provider,url:'https://www.tvmaze.com/'};
      cacheV3[`nf:${w.id}|${w.title}|2024|${w.type}|free|false`]={at:now,ttl:604800000,result:{status:w.score===null?'no_rating':'ok',queryTitle:w.title,title:copy.ratingTitle,id:`tt${w.id}`,year:2024,type:w.type,ratings,confidence:'manual',matchReason:copy.reason,fetchedAt:now}};
    }
    await chrome.storage.local.set({configVersion:4,credentials:{omdb:''},settings:{enabled:true,dimLowScores:true,scoreSource:'auto',minScore:7,dimOpacity:.62,revealOnHover:true,providerMode:'free',language:locale},cacheV3});
  },{works,copy,locale});
  const netflix=context.pages()[0]||await context.newPage();
  await netflix.goto('https://www.netflix.com/browse',{waitUntil:'domcontentloaded'});
  await netflix.waitForFunction(()=>document.querySelectorAll('.nsl-imdb').length===3);
  assert.equal(await netflix.locator('.nsl-low').count(),1);
  assert.equal(await worker.evaluate(()=>screenshotNetworkCalls),0);
  await netflix.screenshot({path:join(out,`ratings-overlay${suffix}.png`),scale:'css',animations:'disabled'});
  const popup=await context.newPage();await popup.setViewportSize({width:400,height:600});
  // Only this disposable headless browser is affected; no desktop focus changes.
  await worker.evaluate(async()=>{const [t]=await chrome.tabs.query({url:'https://www.netflix.com/*'});await chrome.tabs.update(t.id,{active:true});});
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForFunction(()=>!document.querySelector('#enabled').disabled&&document.querySelector('#page').dataset.kind==='done');
  for(const name of ['enabled','dimLowScores','revealOnHover']) assert.equal(await popup.locator('#'+name).isChecked(),true);
  await popup.screenshot({path:join(out,`settings${suffix}.png`),scale:'css',animations:'disabled'});
  const library=await context.newPage();await library.setViewportSize({width:1280,height:900});
  await library.goto(`chrome-extension://${id}/library.html`);
  await library.waitForFunction(()=>document.querySelector('#statTotal')?.textContent==='4');
  assert.equal(await library.locator('.card').count(),4);
  await library.screenshot({path:join(out,`library${suffix}.png`),scale:'css',animations:'disabled'});
  assert.equal(await worker.evaluate(()=>screenshotNetworkCalls),0);
  assert.deepEqual(external,[]);
  console.log(`PASS README screenshots (${locale}): real extension UI, 1 actually dimmed card, 4 local entries, no provider requests or credentials.`);
}finally{await context.close();await rm(profile,{recursive:true,force:true});}
