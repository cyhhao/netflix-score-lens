import {searchCandidates,resolveCandidate,diagnostic,isTransientDiagnostic} from './providers.js';
import {DEFAULTS,cleanSettings,validItem,candidateInput} from './core.js';
import {MATCHING_VERSION,needsNetflixAlias,matchTitle} from './matching.js';
import {createNetflixTitleClient} from './netflix-titles.js';
const VERSION=4, MAX_CACHE=600, GOOD_TTL=7*86400e3, QUOTA_TTL=86400e3, CONFIG_TTL=3600e3, DEGRADED_TTL=5*60e3, SETTLED_TTL=10*60e3, TRANSIENT_RETRY=30e3, PERMANENT_RETRY=10*60e3;
let health={}, inflight=new Map(), writeQueue=Promise.resolve(), generation=0, active=0, queue=[], cacheMemo=null;
const itemGenerations=new Map(), titleInflight=new Map(), titleClient=createNetflixTitleClient();
let titleMemo=null, lookupEnabled=true;
const epochFor=key=>`${generation}:${itemGenerations.get(key)||0}`;
function setLookupEnabled(enabled){
  if(lookupEnabled&&!enabled){generation++;itemGenerations.clear();inflight.clear();titleInflight.clear();}
  lookupEnabled=enabled;
}
chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.cacheV3)cacheMemo=changes.cacheV3.newValue||{};if(changes.netflixTitlesV1)titleMemo=changes.netflixTitlesV1.newValue||{};if(changes.settings)setLookupEnabled(cleanSettings(changes.settings.newValue||{}).enabled);});
async function cacheRead(){if(cacheMemo===null)cacheMemo=(await chrome.storage.local.get('cacheV3')).cacheV3||{};return cacheMemo;}
const gate=fn=>new Promise((resolve,reject)=>{queue.push({fn,resolve,reject});pump();});
function pump(){while(active<4&&queue.length){const q=queue.shift();active++;Promise.resolve().then(q.fn).then(q.resolve,q.reject).finally(()=>{active--;pump();});}}
async function stored(){
  const d=await chrome.storage.local.get(['settings','credentials','configVersion']);
  if(d.configVersion!==VERSION){
    const legacy=d.settings||{};
    const settings=cleanSettings({...legacy,scoreSource:legacy.scoreSource==='best'?'auto':legacy.scoreSource});
    const apiKey=d.credentials?.omdb||legacy.apiKey||'';
    await chrome.storage.local.set({settings,credentials:{omdb:apiKey},configVersion:VERSION});
    await chrome.storage.local.remove('titleCache');
    return {settings,apiKey};
  }
  return {settings:cleanSettings(d.settings),apiKey:d.credentials?.omdb||''};
}
// Secrets never leave the trusted extension context. Content scripts receive
// public settings only; Chrome's storage API is restricted to trusted contexts.
const ready=(async()=>{await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});const config=await stored();setLookupEnabled(config.settings.enabled);return config;})();
function publicConfig(c){return {settings:c.settings,hasApiKey:Boolean(c.apiKey)};}
function libraryEntries(cacheV3,settings,hasApiKey){
  const best=new Map();
  for(const [cacheKey,entry] of Object.entries(cacheV3||{})){
    const raw=entry?.result;if(!raw||typeof raw!=='object')continue;
    const parts=cacheKey.split('|'),itemKey=parts[0];if(!itemKey)continue;
    const providerMode=parts.at(-2),keyFlag=parts.at(-1);
    const result={...raw,type:raw.type||(['movie','series'].includes(parts.at(-3))?parts.at(-3):undefined),year:raw.year||Number(parts.at(-4))||undefined};
    const current=providerMode===settings.providerMode&&keyFlag===String(Boolean(hasApiKey));
    const candidate={itemKey,netflixId:itemKey.startsWith('nf:')?itemKey.slice(3):'',title:String(result.queryTitle||result.title||itemKey),result,at:Number(entry.at)||0,ttl:Number(entry.ttl)||0,current};
    const previous=best.get(itemKey);
    if(!previous||Number(candidate.current)-Number(previous.current)>0||((candidate.current===previous.current)&&candidate.at>previous.at))best.set(itemKey,candidate);
  }
  return [...best.values()].sort((a,b)=>b.at-a.at).map(({itemKey,netflixId,title,result,at,ttl,current})=>({itemKey,netflixId,title,result,at,ttl,current,stale:ttl>0&&Date.now()-at>=ttl}));
}
function record(name,status,message){health[name]={status,message,at:Date.now()};}
// OMDb outcomes: only known absence messages are not_found; auth/quota are
// configuration states; unrecognized or unreadable responses (including another
// title's data) are parse failures and, like service errors, retried soon.
// Errors carry a kind and an HTTP status only; never the URL or Key.
const OMDB_ABSENT=/^(?:(?:movie|series|episode|series or season|series or episode) not found!?|incorrect imdb id\.?|error getting data\.?)$/i;
const OMDB_MESSAGES={auth:'OMDb Key 无效或尚未通过邮件激活',quota:'OMDb 今日额度已用完',not_found:'未找到作品',timeout:'请求超时',network:'评分服务暂时不可达',parse:'评分服务返回了无法解析的数据'};
function omdbFailure(kind,status){const e=Error(OMDB_MESSAGES[kind]||(status===429?'请求过快，请稍后重试':`服务返回 HTTP ${status}`));e.kind=kind;e.status=status;return e;}
async function omdb(id,key){
  const url=new URL('https://www.omdbapi.com/');url.search=new URLSearchParams({apikey:key,i:id,r:'json'});
  const aborted=e=>['TimeoutError','AbortError'].includes(e?.name);
  let r,d;
  try{r=await fetch(url,{signal:AbortSignal.timeout(10000),credentials:'omit'});}catch(e){throw omdbFailure(aborted(e)?'timeout':'network');}
  const status=r.ok?undefined:r.status;
  try{d=await r.json();}catch(e){throw omdbFailure(aborted(e)?'timeout':r.ok?'parse':'http',status);}
  // OMDb describes invalid keys / quota exhaustion in JSON even on HTTP 401.
  if(d?.Response==='False'){const e=String(d.Error||'').trim();throw omdbFailure(/invalid api key|no api key|not activated/i.test(e)?'auth':/limit|quota/i.test(e)?'quota':!r.ok?(r.status===401?'auth':'http'):OMDB_ABSENT.test(e)?'not_found':'parse',status);}
  if(!r.ok)throw omdbFailure(r.status===401?'auth':'http',status);
  // Identity check: another title's data is a protocol fault, never absence.
  if(d?.Response!=='True'||d.imdbID!==id)throw omdbFailure('parse');
  const ratings={};
  const add=(source,value,scale)=>{const n=Number(value);if(value!==null&&value!==''&&Number.isFinite(n)&&n>=0&&n<=scale)ratings[source]={value:n,scale,provider:'OMDb',url:source==='imdb'?`https://www.imdb.com/title/${id}/`:source==='rt'?`https://www.rottentomatoes.com/search?search=${encodeURIComponent(d.Title)}`:`https://www.metacritic.com/search/${encodeURIComponent(d.Title)}/`};};
  add('imdb',d.imdbRating,10);add('metacritic',d.Metascore,100);
  for(const r of Array.isArray(d.Ratings)?d.Ratings:[]) if(r?.Source==='Rotten Tomatoes')add('rt',String(r.Value).replace('%',''),100);
  return {ratings,title:d.Title,year:Number(String(d.Year).slice(0,4)),type:d.Type==='series'?'series':'movie'};
}
const serializeWrite=fn=>{const p=writeQueue.then(fn,fn);writeQueue=p.catch(()=>{});return p;};
async function cachePut(key,entry,epoch){
  return serializeWrite(async()=>{
    if(epoch!==epochFor(key.split('|')[0]))return;
    const cacheV3=await cacheRead();
    cacheV3[key]=entry;
    const cache=Object.fromEntries(Object.entries(cacheV3).sort((a,b)=>b[1].at-a[1].at).slice(0,MAX_CACHE));
    await chrome.storage.local.set({cacheV3:cache});cacheMemo=cache;
  });
}
async function broadcast(message){
  const tabs=await chrome.tabs.query({url:['https://www.netflix.com/*']});
  await Promise.all(tabs.map(t=>chrome.tabs.sendMessage(t.id,message).catch(()=>{})));
}
async function resetCache(){generation++;itemGenerations.clear();inflight.clear();titleInflight.clear();await serializeWrite(async()=>{await chrome.storage.local.remove(['cacheV3','netflixTitlesV1']);cacheMemo={};titleMemo={};});await broadcast({type:'RESET'});}
async function netflixTitle(item,epoch){
  const allowed=()=>epoch===epochFor(item.key)&&lookupEnabled;
  if(titleMemo===null)titleMemo=(await chrome.storage.local.get('netflixTitlesV1')).netflixTitlesV1||{};
  const saved=titleMemo[item.netflixId];
  if(saved&&Date.now()-saved.at<saved.ttl)return saved.result;
  const key=`${item.netflixId}|${epoch}`;
  if(titleInflight.has(key))return titleInflight.get(key);
  const p=titleClient.get(item.netflixId,{allowed}).then(async result=>{
    if(allowed())await serializeWrite(async()=>{
      if(!allowed())return;
      const ttl=result.status==='ok'?7*86400e3:result.status==='error'?60e3:600e3;
      const titles={...titleMemo,[item.netflixId]:{at:Date.now(),ttl,result}};
      const next=Object.fromEntries(Object.entries(titles).sort((a,b)=>b[1].at-a[1].at).slice(0,MAX_CACHE));
      await chrome.storage.local.set({netflixTitlesV1:next});titleMemo=next;
    });
    return result;
  }).finally(()=>{if(titleInflight.get(key)===p)titleInflight.delete(key);});
  titleInflight.set(key,p);return p;
}
async function resetItem(key){
  itemGenerations.set(key,(itemGenerations.get(key)||0)+1);
  for(const k of inflight.keys())if(k.startsWith(`${key}|`))inflight.delete(k);
  await serializeWrite(async()=>{const cache=Object.fromEntries(Object.entries(await cacheRead()).filter(([k])=>!k.startsWith(`${key}|`)));await chrome.storage.local.set({cacheV3:cache});cacheMemo=cache;});
  await broadcast({type:'RESET',key});
}
function requestCacheKey(item,config){return `${item.key}|${item.title}|${item.year||''}|${item.type||''}|${config.settings.providerMode}|${Boolean(config.apiKey)}`;}
async function resolve(item,candidate,config,selection){
  // OMDb needs only the IMDb ID, so it runs alongside the free sources.
  const paid=config.apiKey&&config.settings.providerMode!=='free'?omdb(candidate.id,config.apiKey).then(value=>({value}),error=>({error})):null;
  const [data,omdbOutcome]=await Promise.all([resolveCandidate(candidate),paid]);
  for(const s of data.sources)record(s.provider,s.status,s.error|| (s.status==='ok'?'请求成功':'此作品暂无评分'));
  const freeFailure=data.sources.some(s=>s.status==='error'),warnings=[],diagnostics=[...data.diagnostics];
  let ratings={...data.ratings}, degraded=freeFailure;
  if(omdbOutcome?.value){ratings={...ratings,...omdbOutcome.value.ratings};record('OMDb','ok','Key 已验证，连接正常');}
  else if(omdbOutcome){
    const e=omdbOutcome.error,d=diagnostic({provider:'OMDb',stage:'rating',kind:e.kind,status:e.status});diagnostics.push(d);
    // "Not found" proves the Key works; it is absent data, not a failure.
    if(d.kind==='not_found')record('OMDb','ok','Key 已验证，连接正常');
    else{const message=e.kind?e.message:OMDB_MESSAGES.parse;warnings.push(message);record('OMDb','error',message);degraded||=isTransientDiagnostic(d);}
  }
  if(freeFailure)warnings.push('部分免费评分源暂不可用，将稍后重试');
  const status=Object.keys(ratings).length?'ok':degraded?'error':'no_rating';
  return {result:{...data,ratings,status,diagnostics,confidence:selection.confidence,matchReason:selection.reason,warning:warnings.join('；'),fetchedAt:Date.now(),queryTitle:item.title},degraded};
}
// Reuse/retry boundaries come from structured outcomes, never warning text.
// Optional title enrichment never shortens a good rating. Non-transient OMDb
// states never cause a short retry loop, but must recover without user action:
// an exhausted daily quota after one day; an invalid/unactivated Key or other
// permanent refusal after one hour (activating the same Key changes no setting).
// Known absence keeps the full window. Explicit cache clear recovers at once.
function lifetime(result,degraded){
  const rating=result.diagnostics.filter(d=>d.stage==='rating');
  if(result.status==='ok')return degraded?DEGRADED_TTL:rating.some(d=>d.kind==='quota')?QUOTA_TTL:rating.some(d=>d.kind!=='not_found')?CONFIG_TTL:GOOD_TTL;
  if(result.status!=='error')return SETTLED_TTL;
  const failures=result.diagnostics.filter(d=>d.stage!=='title');
  return !failures.length||failures.some(isTransientDiagnostic)?TRANSIENT_RETRY:PERMANENT_RETRY;
}
async function performLookup(item,config,epoch){
  const {overrides={}}=await chrome.storage.local.get('overrides');
  let selection,candidates=[],alias=null,matchingWarning='',diagnostics=[];
  const allowed=()=>epoch===epochFor(item.key)&&lookupEnabled;
  if(overrides[item.key])selection={candidate:candidateInput(overrides[item.key]),confidence:'manual',reason:'你已确认此匹配'};
  else{
    const match=await matchTitle(item,{search:searchCandidates,getAlias:()=>netflixTitle(item,epoch),allowed});
    ({selection,candidates,alias,diagnostics}=match);matchingWarning=match.warning||'';
    record('Search',selection.status==='error'?'error':'ok',selection.status==='error'?'检索失败，请稍后重试':'标题检索成功');
  }
  if(!allowed()||selection.status==='disabled')return {status:'disabled',ratings:{}};
  let result,degraded=false;
  if(!selection.candidate)result={status:selection.status,type:item.type,year:item.year,ratings:{},candidates:candidates.slice(0,12),matchReason:selection.reason,queryTitle:item.title,fetchedAt:Date.now(),diagnostics:[]};
  else{({result,degraded}=await resolve(item,selection.candidate,config,selection));result.candidates=candidates.slice(0,12);}
  if(!allowed())return {status:'disabled',ratings:{}};
  result.diagnostics=[...diagnostics,...result.diagnostics];
  const ttl=lifetime(result,degraded);
  if(alias?.status==='ok')result.netflixTitle={title:alias.title,url:alias.url,language:'en'};
  if(matchingWarning)result.warning=[result.warning,matchingWarning].filter(Boolean).join('；');
  if(result.status==='error')result.retryAfterMs=ttl;
  result.expiresAt=Date.now()+ttl;
  await cachePut(requestCacheKey(item,config),{at:Date.now(),ttl,result,matchingVersion:MATCHING_VERSION},epoch);
  return allowed()?result:{status:'disabled',ratings:{}};
}
async function lookup(raw,force=false){
  const item=validItem(raw),config=await stored(),key=requestCacheKey(item,config);
  if(!config.settings.enabled||!lookupEnabled)return {status:'disabled',ratings:{}};
  const cacheV3=await cacheRead(),entry=cacheV3[key];
  const upgraded=entry?.matchingVersion===MATCHING_VERSION||!needsNetflixAlias(item,entry?.result);
  if(entry&&upgraded&&Date.now()-entry.at<entry.ttl&&!(force&&entry.result.status==='error'))return entry.result;
  if(inflight.has(key))return inflight.get(key);
  const epoch=epochFor(item.key);
  const p=gate(async()=>{
    // Work waiting in the queue must not start requests after pause/reset.
    if(epoch!==epochFor(item.key) || !(await stored()).settings.enabled)return {status:'disabled',ratings:{}};
    return performLookup(item,config,epoch);
  }).catch(e=>{
    // Unexpected extension failure: log a sanitized class, never the raw
    // exception (it may echo URLs or provider data), and back off.
    const d=diagnostic({provider:'Extension',stage:'extension',kind:'internal'}),now=Date.now();
    console.warn('Score Lens: lookup failed',{...d,error:/^[A-Za-z]{1,40}$/.test(e?.name||'')?e.name:'Error'});
    return {status:'error',ratings:{},warning:'评分查询暂未完成，将自动重试',diagnostics:[d],retryAfterMs:PERMANENT_RETRY,fetchedAt:now,expiresAt:now+PERMANENT_RETRY};
  }).finally(()=>{if(inflight.get(key)===p)inflight.delete(key);});
  inflight.set(key,p);return p;
}
async function tests(){
  const c=await stored();
  const r=await resolveCandidate({id:'tt0903747',title:'Breaking Bad',type:'series',year:2008});
  const checks=r.sources.map(s=>({name:s.provider,status:s.status==='ok'?'ok':'error',message:s.status==='ok'?'真实请求成功':s.error||'服务未返回评分'}));
  try{const candidates=await searchCandidates('絕命毒師',{type:'series',year:2008});const ok=candidates.some(x=>x.id==='tt0903747');checks.push({name:'Search',status:ok?'ok':'error',message:ok?'中文标题检索成功':'中文检索暂不可用，可尝试英文名或 IMDb 编号'});}catch{checks.push({name:'Search',status:'error',message:'标题检索请求失败，请稍后重试'});}
  if(!c.apiKey)checks.push({name:'OMDb',status:'not_configured',message:'可选：未配置 Key，IMDb/TVmaze 仍可用'});
  else {try{await omdb('tt0903747',c.apiKey);checks.push({name:'OMDb',status:'ok',message:'Key 有效，真实请求成功'});}catch(e){checks.push({name:'OMDb',status:'error',message:e.message});}}
  for(const s of checks)record(s.name,s.status,s.message);
  return {checks};
}
async function handle(m,sender){
  await ready;
  const extensionPage=sender.id===chrome.runtime.id&&!sender.tab?.url?.startsWith('https://www.netflix.com/')&&String(sender.url||'').startsWith(chrome.runtime.getURL(''));
  if(m.type==='GET_CONFIG')return publicConfig(await stored());
  if(m.type==='LOOKUP')return {result:await lookup(m.item,m.force===true)};
  if(!extensionPage)throw Error('该操作仅能在扩展设置页执行');
  if(m.type==='GET_LIBRARY'){const config=await stored(),cacheV3=await cacheRead();return {...publicConfig(config),items:libraryEntries(cacheV3,config.settings,Boolean(config.apiKey))};}
  if(m.type==='GET_UI'){const cacheV3=await cacheRead();return {...publicConfig(await stored()),cacheEntries:Object.keys(cacheV3).length,providerHealth:health};}
  if(m.type==='SAVE_SETTINGS'){
    const old=await stored(),settings=cleanSettings({...old.settings,...m.settings});
    const apiKey=m.removeApiKey?'':typeof m.apiKey==='string'&&m.apiKey.trim()?m.apiKey.trim().slice(0,100):old.apiKey;
    setLookupEnabled(settings.enabled);
    await serializeWrite(async()=>{await chrome.storage.local.set({settings,credentials:{omdb:apiKey}});});
    if(apiKey!==old.apiKey||settings.providerMode!==old.settings.providerMode)await resetCache();
    await broadcast({type:'CONFIG',settings});return {settings,hasApiKey:Boolean(apiKey)};
  }
  if(m.type==='CLEAR_CACHE'){const cacheV3=await cacheRead();await resetCache();return {cleared:Object.keys(cacheV3).length};}
  if(m.type==='TEST_PROVIDERS')return tests();
  if(m.type==='SEARCH'){
    const q=String(m.query||'').trim().slice(0,200);
    if(/^tt\d{7,10}$/.test(q)){
      const candidates=[];
      for(const type of m.titleType?[m.titleType]:['movie','series']){
        const r=await resolveCandidate({id:q,type});
        if(r.title)candidates.push({id:q,type,title:r.title,year:r.year,provider:'IMDb ID',url:`https://www.imdb.com/title/${q}/`});
      }
      return {candidates};
    }
    return {candidates:await searchCandidates(q,{type:m.titleType||undefined,year:m.year||undefined})};
  }
  if(m.type==='BIND'||m.type==='UNBIND'){
    const item=validItem(m.item);
    await serializeWrite(async()=>{const {overrides={}}=await chrome.storage.local.get('overrides');if(m.type==='UNBIND')delete overrides[item.key];else overrides[item.key]=candidateInput(m.candidate);await chrome.storage.local.set({overrides});});
    await resetItem(item.key);return m.type==='BIND'?{result:await lookup(item)}:{};
  }
  throw Error('不支持的操作');
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  handle(m||{},sender).then(r=>reply({ok:true,...r}),e=>reply({ok:false,error:String(e.message||'操作失败').slice(0,300)}));return true;
});
