import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticLines} from '../i18n-content.js';
import {setLanguage} from '../i18n.js';

test('diagnostics localize source/stage/cause without changing provider identities',()=>{
  const result={diagnostics:[{provider:'IMDb',stage:'search',kind:'http',status:429},{provider:'OMDb',stage:'rating',kind:'quota'},{provider:'Netflix',stage:'title',kind:'timeout'}]};
  setLanguage('en');assert.deepEqual(diagnosticLines(result),['IMDb · Title search: Service returned HTTP 429','OMDb · Rating lookup: Quota exhausted','Netflix · English title lookup: Request timed out']);
  setLanguage('zh-CN');assert.deepEqual(diagnosticLines(result),['IMDb · 标题检索：服务返回 HTTP 429','OMDb · 评分获取：额度已用完','Netflix · 英文标题补充：请求超时']);
});
test('diagnostics allowlist fields and never render URLs, raw exceptions or unknown identities',()=>{
  setLanguage('en');const secret='SECRET_KEY_MUST_NOT_RENDER';
  const lines=diagnosticLines({diagnostics:[{provider:'OMDb',stage:'rating',kind:'auth',url:`https://www.omdbapi.com/?apikey=${secret}`,error:secret},{provider:secret,stage:'rating',kind:secret,status:secret},{provider:'IMDb',stage:secret,kind:'timeout'},{provider:'IMDb',stage:'search',kind:'http',status:secret},null]});
  assert.equal(lines.length,3);assert.equal(lines.join('\n').includes(secret),false);assert.equal(lines.join('\n').includes('https:'),false);assert.match(lines[0],/Key invalid/);
});
test('diagnostics are bounded, deduplicated and tolerate old caches',()=>{
  assert.deepEqual(diagnosticLines({}),[]);assert.deepEqual(diagnosticLines(null),[]);assert.deepEqual(diagnosticLines({diagnostics:'bad'}),[]);
  const d={provider:'Cinemeta',stage:'rating',kind:'network'};assert.equal(diagnosticLines({diagnostics:Array(30).fill(d)}).length,1);
});
