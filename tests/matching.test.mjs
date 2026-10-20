import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {matchTitle,needsNetflixAlias,selectNetflixAlias} from '../matching.js';
import {ProviderError,SearchIncompleteError} from '../providers.js';

const item=(overrides={})=>({title:'绝命毒师',netflixId:'70143836',year:2008,type:'series',...overrides});
const candidate=(overrides={})=>({id:'tt0903747',title:'Breaking Bad',year:2008,type:'series',provider:'IMDb',rank:0,...overrides});
const alias={status:'ok',netflixId:'70143836',title:'Breaking Bad',language:'en',url:'https://www.netflix.com/hk-en/title/70143836'};

async function run(itemValue, routes, aliasValue=alias) {
  const calls=[];
  const result=await matchTitle(itemValue, {
    search:async(title,options)=>{calls.push({title,options});return routes[title]||[];},
    getAlias:async()=>aliasValue
  });
  return {result,calls};
}

describe('Netflix English-title enrichment',()=>{
  it('only needs an alias for a Netflix item with verified year/type and a weak result',()=>{
    assert.equal(needsNetflixAlias(item(),{confidence:'localized'}),true);
    assert.equal(needsNetflixAlias(item({year:null}),{confidence:'localized'}),false);
    assert.equal(needsNetflixAlias(item(),{confidence:'high'}),false);
    assert.equal(needsNetflixAlias(item(),{confidence:'manual'}),false);
  });

  it('confirms an existing candidate without issuing a second provider search',async()=>{
    const {result,calls}=await run(item(),{'绝命毒师':[candidate({title:'Breaking Bad'})]});
    assert.equal(calls.length,1);
    assert.equal(result.selection.candidate.id,'tt0903747');
    assert.equal(result.selection.confidence,'high');
    assert.equal(result.alias.title,'Breaking Bad');
  });

  it('rescues a localized not-found result with a unique English title/year/type candidate',async()=>{
    const {result,calls}=await run(item(),{'绝命毒师':[],'Breaking Bad':[candidate()]});
    assert.deepEqual(calls.map(x=>x.title),['绝命毒师','Breaking Bad']);
    assert.equal(result.selection.candidate.id,'tt0903747');
    assert.equal(result.selection.confidence,'high');
  });

  it('keeps a conflict ambiguous instead of replacing a different localized match',async()=>{
    const old=candidate({id:'tt1234567',title:'Breaking Bad (localized)',provider:'IMDb',rank:0});
    const {result}=await run(item(),{'绝命毒师':[old],'Breaking Bad':[candidate()]});
    assert.equal(result.selection.candidate,null);
    assert.equal(result.selection.status,'ambiguous');
    assert.match(result.selection.reason,/证据不一致/);
    assert.deepEqual(result.candidates.map(c=>c.id),['tt0903747','tt1234567']);
  });

  it('rejects same-name candidates with wrong year/type or duplicate IMDb ids',async()=>{
    const wrong=[candidate({year:2020}),candidate({type:'movie'}),candidate({id:'tt0903747',title:'Breaking Bad',year:2008})];
    const picked=selectNetflixAlias(item(),alias,wrong);
    assert.equal(picked?.id,'tt0903747');
    assert.equal(selectNetflixAlias(item(),alias,[candidate({year:2009})]),null);
    assert.equal(selectNetflixAlias(item(),alias,[candidate(),candidate({id:'tt1234567'})]),null);
  });

  it('does not turn an alias lookup failure into a false match and preserves the original localized result',async()=>{
    const original=candidate({title:'The Healer',provider:'IMDb'});
    const {result,calls}=await run(item(),{'绝命毒师':[original]}, {status:'error',reason:'timeout'});
    assert.equal(result.selection.candidate.id,'tt0903747');
    assert.equal(result.selection.confidence,'localized');
    assert.match(result.warning,/回退/);
    assert.deepEqual(calls.map(x=>x.title),['绝命毒师']);
  });

  it('does not query an alias after an already high-confidence exact match',async()=>{
    let aliases=0;
    const result=await matchTitle(item({title:'Breaking Bad'}),{search:async()=>[candidate()],getAlias:async()=>{aliases++;return alias;}});
    assert.equal(result.selection.confidence,'high');assert.equal(aliases,0);
  });
  it('does not enrich missing metadata, missing IDs or invalid alias identities',async()=>{
    for(const fields of [{year:null},{type:undefined},{netflixId:''}]) {
      let calls=0;await matchTitle(item(fields),{search:async()=>[],getAlias:async()=>{calls++;return alias;}});assert.equal(calls,0);
    }
    for(const fields of [{netflixId:'70000002'},{language:'zh-CN'},{title:''}]) {
      const {result,calls}=await run(item(),{'绝命毒师':[],'Breaking Bad':[candidate()]},{...alias,...fields});
      assert.equal(result.selection.status,'not_found');assert.equal(calls.length,1);
    }
  });
  it('rescues an original search error but does not claim not-found if both searches fail',async()=>{
    const result=await matchTitle(item(),{search:async title=>{if(title===item().title)throw Error('offline');return [candidate()];},getAlias:async()=>alias});
    assert.equal(result.selection.confidence,'high');
    const failed=await matchTitle(item(),{search:async()=>{throw Error('offline');},getAlias:async()=>alias});
    assert.equal(failed.selection.status,'error');assert.match(failed.warning,/暂不可用/);
  });
  it('shows ambiguous English near-misses rather than retaining an empty not-found state',async()=>{
    const {result}=await run(item(),{'Breaking Bad':[candidate({year:2009})]});
    assert.equal(result.selection.status,'ambiguous');assert.equal(result.selection.candidate,null);
  });
  it('rejects same-name same-year different IDs regardless of rank, deduplicates the same ID',async()=>{
    const {result}=await run(item(),{'Breaking Bad':[candidate(),candidate({id:'tt1234567',rank:99})]});
    assert.equal(result.selection.status,'ambiguous');
    assert.ok(selectNetflixAlias(item(),alias,[candidate(),candidate()]));
  });
  it('non-exact or empty English search is not conflicting evidence against the original ID',async()=>{
    const display={...alias,title:"Breaking Bad: Director's Cut"};
    for(const english of [[],[candidate()]]) {
      const {result}=await run(item(),{'绝命毒师':[candidate()],[display.title]:english},display);
      assert.equal(result.selection.status,'ok');assert.equal(result.selection.confidence,'localized');assert.equal(result.selection.candidate.id,'tt0903747');assert.doesNotMatch(result.selection.reason,/证据不一致/);
    }
  });
  it('English search failure preserves the original localized result with a warning',async()=>{
    const original=candidate({title:'Other'});
    const result=await matchTitle(item(),{search:async title=>{if(title==='Breaking Bad')throw Error();return [original];},getAlias:async()=>alias});
    assert.equal(result.selection.confidence,'localized');assert.equal(result.selection.candidate.title,'Other');assert.match(result.warning,/已保留/);
  });
  it('preserves sanitized search failure provenance through matching',async()=>{
    const failures=[new ProviderError('Cinemeta HTTP 504',{provider:'Cinemeta',url:'https://v3-cinemeta.strem.io/catalog/x',status:504,kind:'http',transient:true}),new ProviderError('IMDb timed out after 8000 ms',{provider:'IMDb',url:'https://v3.sg.media-imdb.com/x',kind:'timeout',transient:true})];
    const result=await matchTitle(item({netflixId:''}),{search:async()=>{throw new SearchIncompleteError(failures,[]);},getAlias:async()=>alias});
    assert.equal(result.selection.status,'error');
    assert.deepEqual(result.diagnostics,[{provider:'Cinemeta',stage:'search',kind:'http',status:504},{provider:'IMDb',stage:'search',kind:'timeout'}]);
    assert.doesNotMatch(JSON.stringify(result.diagnostics),/https?:|timed out|绝命毒师/);
    const internal=await matchTitle(item({netflixId:''}),{search:async()=>{throw new TypeError('raw https://secret');},getAlias:async()=>alias});
    assert.deepEqual(internal.diagnostics,[{provider:'Extension',stage:'search',kind:'internal'}]);
  });
  it('records optional alias and English-search failures without changing a good selection',async()=>{
    for(const [reason,expected] of [['timeout',{kind:'timeout'}],['request_failed',{kind:'network'}],['http_503',{kind:'http',status:503}],['cooldown',{kind:'http'}],[undefined,{kind:'internal'}]]) {
      const {result}=await run(item(),{'绝命毒师':[candidate({title:'The Healer'})]},{status:'error',reason});
      assert.equal(result.selection.confidence,'localized');
      assert.deepEqual(result.diagnostics,[{provider:'Netflix',stage:'title',...expected}]);
    }
    const unavailable=await run(item(),{'绝命毒师':[candidate({title:'The Healer'})]},{status:'unavailable',reason:'http_404'});
    assert.deepEqual(unavailable.result.diagnostics,[]);
    const failed=await matchTitle(item(),{search:async title=>{if(title==='Breaking Bad')throw new SearchIncompleteError([new ProviderError('x',{provider:'Cinemeta',kind:'network'})],[]);return [candidate({title:'Other'})];},getAlias:async()=>alias});
    assert.equal(failed.selection.confidence,'localized');
    assert.deepEqual(failed.diagnostics,[{provider:'Cinemeta',stage:'search',kind:'network'}]);
  });
  it('stops between stages after pause/reset and never starts when disallowed',async()=>{
    let allowed=false,calls=0;
    const options={search:async()=>{calls++;allowed=false;return [];},getAlias:async()=>{throw Error('unexpected');},allowed:()=>allowed};
    assert.equal((await matchTitle(item(),options)).selection.status,'disabled');assert.equal(calls,0);
    allowed=true;assert.equal((await matchTitle(item(),options)).selection.status,'disabled');assert.equal(calls,1);
  });
});
