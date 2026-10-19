import {chromium} from 'playwright';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {executablePath} from './browser.mjs';
const root=resolve(import.meta.dirname,'..');
const {version}=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
const base=await mkdtemp(join(tmpdir(),'scorelens-package-'));
let context;
try {
  const zip=join(root,'dist',`netflix-score-lens-${version}-chrome-web-store.zip`);
  execFileSync('python3',['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert "manifest.json" in z.namelist(); assert not any(n.startswith(("tests/","artifacts/","node_modules/","docs/")) for n in z.namelist()); z.extractall(sys.argv[2])',zip,join(base,'extension')]);
  const ext=join(base,'extension');
  context=await chromium.launchPersistentContext(join(base,'profile'),{headless:true,executablePath,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2];
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`chrome-extension://${id}/library.html`);
  await page.waitForFunction(()=>document.querySelector('#statTotal')?.textContent==='0');
  assert.equal(await page.locator('#version').textContent(),`v${version}`);
  assert.equal(await page.locator('#empty').isVisible(),true);
  await page.goto(`chrome-extension://${id}/popup.html`);
  assert.equal(await page.getByRole('button',{name:'评分库',exact:true}).count(),1);
  assert.deepEqual(errors,[]);
  console.log('PASS store ZIP root, runtime-only contents, actual extension boot, empty library and popup entry');
} finally { if(context)await context.close();await rm(base,{recursive:true,force:true}); }
