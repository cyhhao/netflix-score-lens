// Regenerate store drafts: actual extension renderer + clearly labelled synthetic data.
// Disposable profiles only; no owner account, remote artwork, credentials or live requests.
import {chromium} from 'playwright';
import {mkdtemp,mkdir,rm,readFile,copyFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {executablePath} from '../tests/browser.mjs';
const root=resolve(import.meta.dirname,'..'),out=join(root,'store/assets');
const version=JSON.parse(await readFile(join(root,'manifest.json'),'utf8')).version;
const works=[
  {id:'9900001',title:'Northbound · Demo',type:'series',score:9.1,tvmaze:8.7,color:'#527d80',label:'NORTHBOUND'},
  {id:'9900002',title:'Night Signal · Demo',type:'movie',score:5.8,color:'#9b5769',label:'NIGHT SIGNAL'},
  {id:'9900003',title:'Beyond Blue · Demo',type:'movie',score:8.2,color:'#5368a0',label:'BEYOND BLUE'},
  {id:'9900004',title:'Open Ending · Demo',type:'series',score:null,color:'#967d4d',label:'OPEN ENDING'}
];
const languages={
  en:{browser:'en-US',note:'DEMO PAGE · SYNTHETIC TITLES & RATINGS',heading:'Keep the ratings in view.',intro:'Real extension badges and dimming on an illustrative page. This is not a Netflix account screenshot.',poster:'ILLUSTRATIVE TITLE · DEMO DATA',types:{series:'Series',movie:'Movie'},demo:'Demo',legend:'Separate sources · Below 7.0 is dimmed, not removed · Unrated titles stay unchanged',footer:'Original placeholder artwork. All titles and ratings shown here are synthetic.',preview:'Expanded preview',previewNote:'The actual badge renderer reuses the same title’s score.',play:'Play (demo)',canonical:'DEMO · synthetic rating',reason:'Demo data; UI showcase only',provider:'Demo data',promo:'Ratings. Your choice.',badge:'DEMO DATA · NOT LIVE RATINGS'},
  'zh-CN':{browser:'zh-CN',note:'演示页面 · 虚构片名与评分',heading:'评分，一眼可见。',intro:'评分角标与低分遮罩由真实插件渲染。这是示意页面，不是 Netflix 账户截图。',poster:'示意片名 · 演示数据',types:{series:'剧集',movie:'电影'},demo:'演示',legend:'来源分别标注 · 低于 7.0 变暗而非移除 · 暂无评分保持原样',footer:'占位海报为原创图形。此处片名与评分均为虚构，不含个人浏览信息。',preview:'放大预览也有评分',previewNote:'真实角标复用同一作品的评分，不重复取分。',play:'播放（演示）',canonical:'演示数据 · 非实时评分',reason:'演示数据，仅展示界面功能',provider:'演示数据',promo:'评分在眼前，选择在自己。',badge:'演示数据 · 非实时评分'}
};
const report={version,synthetic:true,ownerProfileUsed:false,locales:[]};
await mkdir(out,{recursive:true});
await copyFile(join(root,'icons/icon128.png'),join(out,'icon-128.png'));
for(const [locale,c] of Object.entries(languages)){
  const dir=join(out,locale);await mkdir(dir,{recursive:true});
  const profile=await mkdtemp(join(tmpdir(),'scorelens-store-'));
  const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath,locale:c.browser,viewport:{width:1280,height:800},deviceScaleFactor:1,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
  const unexpected=[],errors=[];
  const poster=w=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="520" height="294"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${w.color}"/><stop offset="1" stop-color="#17242f"/></linearGradient></defs><rect width="520" height="294" fill="url(#g)"/><circle cx="410" cy="46" r="145" fill="#fff" opacity=".08"/><path d="M0 234L165 94L337 294H0Z" fill="#fff" opacity=".13"/><text x="30" y="234" fill="#fff" font-size="28" font-family="sans-serif" font-weight="700">${w.label}</text><text x="32" y="264" fill="#fff" opacity=".7" font-size="13" font-family="sans-serif">${c.poster}</text></svg>`);
  const metadata=Object.fromEntries(works.map(w=>[`${w.type==='series'?'Show':'Movie'}:{"videoId":${w.id}}`,{releaseYear:2024}]));
  const w=works[1];
  const fixture=`<!doctype html><html lang="${locale}"><meta charset="utf-8"><title>Score Lens — ${c.demo}</title><style>*{box-sizing:border-box}body{margin:0;background:#11151a;color:#ece7dc;font-family:system-ui}header{padding:26px 54px;border-bottom:1px solid #ffffff14;display:flex;justify-content:space-between}.brand{font-weight:750;letter-spacing:2px;color:#efbd62}.note{font-size:12px;color:#a1aab3}main{padding:42px 54px}h1{font-size:34px;margin:0 0 12px}p{font-size:15px;color:#a1aab3;line-height:1.7;margin:0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:30px}.card a{position:relative;display:block;aspect-ratio:520/294;border-radius:10px;overflow:hidden}.card img{display:block;width:100%;height:100%}.card h2{font-size:14px;margin:14px 0 4px}.card span{color:#909aa4;font-size:12px}.legend{margin-top:30px;padding:18px 22px;background:#ffffff05;border:1px solid #ffffff0d;border-radius:10px;font-size:13px;color:#c4c4b5}footer{margin-top:26px;font-size:12px;color:#94a0ab}#preview{position:absolute;left:430px;top:350px;width:390px;z-index:100;background:#20262e;border-radius:12px;overflow:hidden;box-shadow:0 16px 45px #0009}#preview[hidden]{display:none}#preview [data-uia="previewModal--player_container"]{position:relative;height:220px}#preview img{position:absolute;inset:0;width:100%;height:100%}.previewModal--info{position:relative;padding:15px 20px}.previewModal--info a{color:#dfe8e5;text-decoration:none}.previewModal--info button{padding:8px 18px;border:0;border-radius:6px;font-weight:700;cursor:pointer}#preview-caption{display:none;position:absolute;top:580px;left:54px;width:320px}body.expanded #preview-caption{display:block}#preview-caption h2{font-size:23px;color:#efbd62}</style><script>window.netflix={reactContext:{models:{graphql:{data:${JSON.stringify(metadata)}}}}};window.demoPlayClicks=0;</script><header><div class="brand">SCORE LENS</div><div class="note">${c.note}</div></header><main><h1>${c.heading}</h1><p>${c.intro}</p><div class="grid">${works.map(x=>`<article class="card"><a data-uia="standard-card" aria-label="${x.title}" href="/browse?jbv=${x.id}"><img alt="" src="${poster(x)}"></a><h2>${x.title}</h2><span>${c.types[x.type]} · 2024 · ${c.demo}</span></article>`).join('')}</div><div class="legend">${c.legend}</div><footer>${c.footer}</footer><section id="preview-caption"><h2>${c.preview}</h2><p>${c.previewNote}</p></section></main><div id="preview" role="dialog" data-uia="modal-motion-container-MINI_MODAL" class="previewModal--container mini-modal" hidden><div data-uia="previewModal--player_container" class="previewModal--player_container"><img class="previewModal--boxart" alt="${w.title}" src="${poster(w)}"></div><div class="previewModal--info"><a href="/title/${w.id}"><button data-uia="play-button" onclick="event.preventDefault();window.demoPlayClicks++">▶ ${c.play}</button></a></div></div></html>`;
  try{
    context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
    await context.route(/^https?:\/\//,route=>{if(route.request().url()==='https://www.netflix.com/browse')return route.fulfill({contentType:'text/html; charset=utf-8',body:fixture});unexpected.push(route.request().url());return route.abort();});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2];
    const probe=await context.newPage();await probe.goto(`chrome-extension://${id}/popup.html`);await probe.evaluate(()=>chrome.runtime.sendMessage({type:'GET_UI'}));await probe.close();
    await worker.evaluate(async({works,c,locale})=>{
      globalThis.storeNetworkCalls=0;globalThis.fetch=async()=>{storeNetworkCalls++;throw Error('Store drafts must never request providers');};
      const cacheV3={},now=Date.now();
      for(const w of works){
        const ratings={};if(w.score!==null)ratings.imdb={value:w.score,scale:10,provider:c.provider,url:'https://www.imdb.com/'};
        if(w.tvmaze)ratings.tvmaze={value:w.tvmaze,scale:10,provider:c.provider,url:'https://www.tvmaze.com/'};
        cacheV3[`nf:${w.id}|${w.title}|2024|${w.type}|free|false`]={at:now,ttl:604800000,result:{status:w.score===null?'no_rating':'ok',queryTitle:w.title,title:c.canonical,id:`tt${w.id}`,year:2024,type:w.type,ratings,confidence:'manual',matchReason:c.reason,fetchedAt:now,expiresAt:now+604800000}};
      }
      await chrome.storage.local.set({configVersion:4,credentials:{omdb:''},settings:{enabled:true,dimLowScores:true,scoreSource:'auto',minScore:7,dimOpacity:.62,revealOnHover:true,providerMode:'free',language:locale},cacheV3});
    },{works,c,locale});
    const page=await context.newPage();await page.goto('https://www.netflix.com/browse');
    await page.waitForFunction(()=>document.querySelectorAll('.nsl-imdb').length===3);
    assert.equal(await page.locator('.nsl-low').count(),1);
    await page.mouse.move(1250,760);
    await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.nsl-low .nsl-shade')).opacity)>.6);
    await page.screenshot({path:join(dir,'01-ratings-1280x800.png'),animations:'disabled'});
    await page.evaluate(()=>{document.querySelector('#preview').hidden=false;document.body.classList.add('expanded');});
    await page.locator('#preview .nsl-imdb').waitFor();
    assert.equal(await page.locator('#preview .nsl-imdb').textContent(),'IMDb 5.8');
    await page.locator('#preview [data-uia="play-button"]').hover();
    await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#preview .nsl-shade')).opacity)<.01);
    await page.screenshot({path:join(dir,'02-preview-1280x800.png'),animations:'disabled'});
    const library=await context.newPage();await library.goto(`chrome-extension://${id}/library.html`);
    await library.waitForFunction(()=>document.querySelector('#statTotal')?.textContent==='4');
    assert.equal(await library.locator('.card').count(),4);
    assert.equal(await library.evaluate(()=>document.documentElement.lang),locale);
    // Disclosure is an editorial annotation, not a claimed production feature.
    await library.evaluate(label=>{const n=document.createElement('aside');n.textContent=label;n.style.cssText='position:fixed;left:360px;top:22px;z-index:9999;padding:8px 13px;background:#24333e;color:#efbd62;border:1px solid #efbd6270;border-radius:7px;font:600 12px system-ui';document.body.append(n);},c.badge);
    await library.evaluate(()=>window.scrollTo(0,0));
    await library.screenshot({path:join(dir,'03-library-1280x800.png'),animations:'disabled'});
    await library.locator('.details').first().click();
    await library.locator('.details-panel').first().waitFor();
    await library.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
    assert.ok(await library.locator('.details-panel').first().evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=76&&r.bottom<=innerHeight-40;}));
    await library.screenshot({path:join(dir,'04-details-1280x800.png'),animations:'disabled'});
    if(locale==='en'){
    const icon=(await readFile(join(root,'icons/icon128.png'))).toString('base64');
    const promo=await context.newPage();await promo.setViewportSize({width:440,height:280});
    await promo.setContent(`<!doctype html><html lang="${locale}"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:440px;height:280px;background:radial-gradient(circle at 50% 30%,#26333e,#0d0f12 75%);color:#eee9e0;font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center}img{width:96px;height:96px}h1{font-size:29px;letter-spacing:1px;margin:8px 0}p{font-size:15px;color:#62c7bc;margin:0}.dots{display:flex;gap:9px;margin-top:20px}.dots i{width:36px;height:6px;border-radius:5px;background:#efbd62}.dots i:last-child{opacity:.3}</style><img src="data:image/png;base64,${icon}" alt=""><h1>SCORE LENS</h1><div class="dots"><i></i><i></i><i></i><i></i></div></html>`);
    await promo.screenshot({path:join(out,'promo-440x280.png')});
    }
    assert.equal(await worker.evaluate(()=>storeNetworkCalls),0);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
    report.locales.push({locale,screenshots:4,previewBadge:'IMDb 5.8',dimmedCards:1,libraryEntries:4,providerRequests:0,unexpectedRequests:0,pageErrors:0});
    console.log(`PASS store assets ${locale}: four 1280x800 actual-renderer drafts, shared 440x280 promo, no live requests`);
  }finally{await context.close();await rm(profile,{recursive:true,force:true});}
}
await mkdir(join(root,'artifacts'),{recursive:true});
await writeFile(join(root,'artifacts/store-assets-report.json'),JSON.stringify(report,null,2)+'\n');
// Commit reviewed images + their provenance together. store:kit validates and
// packages them verbatim; it must not silently replace artwork during CI/build.
const inputs=['manifest.json','background.js','core.js','providers.js','matching.js','netflix-titles.js','bridge.js','content.js','content.css','i18n.js','i18n-content.js','i18n-library.js','i18n-popup.js','popup.html','popup.css','popup.js','library.html','library.css','library.js','_locales/en/messages.json','_locales/zh_CN/messages.json',...['16','32','48','128'].map(s=>`icons/icon${s}.png`),'scripts/store-assets.mjs'];
const pictures=['icon-128.png','promo-440x280.png',...Object.keys(languages).flatMap(l=>['01-ratings','02-preview','03-library','04-details'].map(s=>`${l}/${s}-1280x800.png`))];
const sha=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
report.inputsSha256=Object.fromEntries(await Promise.all(inputs.map(async p=>[p,await sha(join(root,p))])));
report.imagesSha256=Object.fromEntries(await Promise.all(pictures.map(async p=>[p,await sha(join(out,p))])));
await writeFile(join(out,'provenance.json'),JSON.stringify(report,null,2)+'\n');
