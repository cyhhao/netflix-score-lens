import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const json=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
test('native store metadata resolves in English and Simplified Chinese within limits',async()=>{
  const manifest=await json('manifest.json');
  assert.equal(manifest.default_locale,'en');
  assert.equal(manifest.name,'__MSG_extensionName__');
  assert.equal(manifest.action.default_title,manifest.name);
  assert.equal(manifest.description,'__MSG_extensionDescription__');
  for(const locale of ['en','zh_CN']){
    const messages=await json(`_locales/${locale}/messages.json`);
    assert.equal(messages.extensionName.message,'Netflix Score Lens');
    assert.ok([...messages.extensionName.message].length<=45);
    assert.ok([...messages.extensionDescription.message].length<=132);
    assert.ok(messages.extensionDescription.message.length>20);
  }
  assert.match((await json('_locales/en/messages.json')).extensionDescription.message,/Optional OMDb/);
  assert.match((await json('_locales/zh_CN/messages.json')).extensionDescription.message,/可选 OMDb/);
});
test('store metadata does not change permissions or install automatic update endpoints',async()=>{
  const m=await json('manifest.json');
  assert.deepEqual(m.permissions,['storage','activeTab']);
  assert.deepEqual(m.host_permissions,['https://www.netflix.com/*','https://www.omdbapi.com/*','https://v3-cinemeta.strem.io/*','https://cinemeta-live.strem.io/*','https://v3.sg.media-imdb.com/*','https://api.tvmaze.com/*']);
  assert.equal(m.update_url,undefined);
  assert.equal(m.key,undefined);
});
