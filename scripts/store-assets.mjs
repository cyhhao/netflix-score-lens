// Generate draft store images from the real extension UI + labelled demo data.
// No personal profiles, third-party artwork or real credentials are used.
import {chromium} from 'playwright';
import {mkdtemp,mkdir,rm,readFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const root=resolve(import.meta.dirname,'..'),out=join(root,'store/assets');
await mkdir(out,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'scorelens-store-assets-'));
const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_PATH||chromium.executablePath(),viewport:{width:1280,height:800},args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2],page=await context.newPage();
  await page.goto(`chrome-extension://${id}/library.html`);
  await page.waitForFunction(()=>document.querySelector('#statTotal')?.textContent==='0');
  await worker.evaluate(async()=>{
    globalThis.fetch=async()=>{throw Error('No provider requests for store drafts');};
    const cacheV3={},now=Date.now();
    for(const [index,title,type,score] of [[0,'演示剧集 A','series',9.1],[1,'演示电影 B','movie',8.3],[2,'演示剧集 C','series',7.4],[3,'演示电影 D','movie',6.2]]) {
      cacheV3[`nf:${9000000+index}|${title}|2024|${type}|free|false`]={at:now,ttl:604800000,result:{status:'ok',queryTitle:title,title:'DEMO · 非实时评分',id:`tt${9000000+index}`,year:2024,type,ratings:{imdb:{value:score,scale:10,provider:'演示数据',url:'https://www.imdb.com/'}},confidence:'manual',matchReason:'演示数据，仅展示界面功能',fetchedAt:now}};
    }
    await chrome.storage.local.set({configVersion:3,credentials:{omdb:''},settings:{enabled:true,dimLowScores:true,scoreSource:'auto',minScore:7,dimOpacity:.62,revealOnHover:true,providerMode:'free'},cacheV3});
  });
  await page.waitForFunction(()=>document.querySelector('#statTotal')?.textContent==='4');
  await page.locator('#group').selectOption('type');
  await page.screenshot({path:join(out,'library-demo-1280x800.png')});
  await page.locator('#group').selectOption('none');
  await page.locator('.details').first().click();
  await page.locator('.toolbar').scrollIntoViewIfNeeded();
  await page.screenshot({path:join(out,'library-details-demo-1280x800.png')});
  const icon=(await readFile(join(root,'icons/icon128.png'))).toString('base64');
  const promo=await context.newPage();await promo.setViewportSize({width:440,height:280});
  await promo.setContent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:440px;height:280px;background:radial-gradient(circle at 50% 30%,#26333e,#0d0f12 75%);color:#eee9e0;font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center}img{width:96px;height:96px;filter:drop-shadow(0 6px 18px #e9b65c30)}h1{font-size:29px;letter-spacing:1px;margin:8px 0}p{font-size:15px;color:#62c7bc;margin:0}.dots{display:flex;gap:9px;margin-top:20px}.dots i{width:36px;height:6px;border-radius:5px;background:#efbd62}.dots i:last-child{opacity:.3}</style><img src="data:image/png;base64,${icon}" alt=""><h1>SCORE LENS</h1><p>Ratings. Your choice.</p><div class="dots"><i></i><i></i><i></i><i></i></div>`);
  await promo.screenshot({path:join(out,'promo-440x280.png')});
  await copyFile(join(root,'icons/icon128.png'),join(out,'icon-128.png'));
  console.log('Draft assets generated in store/assets. Library screenshots contain explicitly labelled synthetic data; not production or approval evidence.');
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
