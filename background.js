import {searchCandidates,resolveCandidate} from './providers.js';
import {DEFAULTS,cleanSettings,validItem,selectCandidate,candidateInput} from './core.js';
const VERSION=4, MAX_CACHE=600;
let health={}, inflight=new Map(), writeQueue=Promise.resolve(), generation=0, active=0, queue=[], cacheMemo=null;
const itemGenerations=new Map();
const epochFor=key=>`${generation}:${itemGenerations.get(key)||0}`;
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.cacheV3)cacheMemo=changes.cacheV3.newValue||{};});
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
const ready=(async()=>{await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});return stored();})();
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
async function json(url){
  try{
    const r=await fetch(url,{signal:AbortSignal.timeout(10000),credentials:'omit'});
    // OMDb describes invalid keys / quota exhaustion in JSON even on HTTP 401.
    const data=await r.json();
    if(data?.Response==='False')throw Error(omdbError(data));
    if(!r.ok)throw Error(r.status===429?'请求过快，请稍后重试':`服务返回 HTTP ${r.status}`);
    return data;
  }catch(e){if(e.name==='TimeoutError'||e.name==='AbortError')throw Error('请求超时');if(e instanceof TypeError)throw Error('评分服务暂时不可达');if(e instanceof SyntaxError)throw Error('评分服务返回了无法解析的数据');throw e;}
}
function omdbError(d){const e=String(d?.Error||''); if(/invalid|no api|not activated/i.test(e)) return 'OMDb Key 无效或尚未通过邮件激活';if(/limit|quota/i.test(e))return 'OMDb 今日额度已用完';return e.includes('not found')?'未找到作品':'OMDb 暂无此作品数据';}
async function omdb(id,key){
  const url=new URL('https://www.omdbapi.com/');url.search=new URLSearchParams({apikey:key,i:id,r:'json'});
  const d=await json(url);
  if(d.Response!=='True')throw Error(omdbError(d));
  if(d.imdbID!==id)throw Error('OMDb 返回作品不一致');
  const ratings={};
  const add=(source,value,scale)=>{const n=Number(value);if(value!==null&&value!==''&&Number.isFinite(n)&&n>=0&&n<=scale)ratings[source]={value:n,scale,provider:'OMDb',url:source==='imdb'?`https://www.imdb.com/title/${id}/`:source==='rt'?`https://www.rottentomatoes.com/search?search=${encodeURIComponent(d.Title)}`:`https://www.metacritic.com/search/${encodeURIComponent(d.Title)}/`};};
  add('imdb',d.imdbRating,10);add('metacritic',d.Metascore,100);
  for(const r of d.Ratings||[]) if(r.Source==='Rotten Tomatoes')add('rt',r.Value.replace('%',''),100);
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
async function resetCache(){generation++;itemGenerations.clear();inflight.clear();await serializeWrite(async()=>{await chrome.storage.local.remove('cacheV3');cacheMemo={};});await broadcast({type:'RESET'});}
async function resetItem(key){
  itemGenerations.set(key,(itemGenerations.get(key)||0)+1);
  for(const k of inflight.keys())if(k.startsWith(`${key}|`))inflight.delete(k);
  await serializeWrite(async()=>{const cache=Object.fromEntries(Object.entries(await cacheRead()).filter(([k])=>!k.startsWith(`${key}|`)));await chrome.storage.local.set({cacheV3:cache});cacheMemo=cache;});
  await broadcast({type:'RESET',key});
}
function requestCacheKey(item,config){return `${item.key}|${item.title}|${item.year||''}|${item.type||''}|${config.settings.providerMode}|${Boolean(config.apiKey)}`;}
async function resolve(item,candidate,config,selection){
  const data=await resolveCandidate(candidate);
  for(const s of data.sources)record(s.provider,s.status,s.error|| (s.status==='ok'?'请求成功':'此作品暂无评分'));
  let ratings={...data.ratings}, warning='';
  if(config.apiKey&&config.settings.providerMode!=='free'){
    try{const d=await omdb(candidate.id,config.apiKey);ratings={...ratings,...d.ratings};record('OMDb','ok','Key 已验证，连接正常');}
    catch(e){warning=e.message;record('OMDb','error',warning);}
  }
  const partialFailure=data.sources.some(s=>s.status==='error');
  if(partialFailure)warning=[warning,'部分免费评分源暂不可用，将稍后重试'].filter(Boolean).join('；');
  const status=Object.keys(ratings).length?'ok':partialFailure||warning?'error':'no_rating';
  return {...data,ratings,status,confidence:selection.confidence,matchReason:selection.reason,warning,fetchedAt:Date.now(),queryTitle:item.title};
}
async function performLookup(item,config,epoch){
  const {overrides={}}=await chrome.storage.local.get('overrides');
  let selection,candidates=[];
  if(overrides[item.key])selection={candidate:candidateInput(overrides[item.key]),confidence:'manual',reason:'你已确认此匹配'};
  else{
    candidates=await searchCandidates(item.title,{type:item.type,year:item.year});
    record('Search','ok','标题检索成功');
    selection=selectCandidate(item,candidates);
  }
  let result;
  if(!selection.candidate)result={status:selection.status,type:item.type,year:item.year,ratings:{},candidates:candidates.slice(0,12),matchReason:selection.reason,queryTitle:item.title,fetchedAt:Date.now()};
  else result={...await resolve(item,selection.candidate,config,selection),candidates:candidates.slice(0,12)};
  const ttl=result.status==='ok'?(result.warning?5*60e3:7*86400e3):result.status==='error'?30e3:10*60e3;
  await cachePut(requestCacheKey(item,config),{at:Date.now(),ttl,result},epoch);
  return result;
}
async function lookup(raw,force=false){
  const item=validItem(raw),config=await stored(),key=requestCacheKey(item,config);
  if(!config.settings.enabled)return {status:'disabled',ratings:{}};
  const cacheV3=await cacheRead(),entry=cacheV3[key];
  if(entry&&Date.now()-entry.at<entry.ttl&&!(force&&entry.result.status==='error'))return entry.result;
  if(inflight.has(key))return inflight.get(key);
  const epoch=epochFor(item.key);
  const p=gate(async()=>{
    // Work waiting in the queue must not start requests after pause/reset.
    if(epoch!==epochFor(item.key) || !(await stored()).settings.enabled)return {status:'disabled',ratings:{}};
    return performLookup(item,config,epoch);
  }).catch(e=>{
    record('Search','error','检索失败，请稍后重试');
    return {status:'error',ratings:{},warning:'评分请求失败，请检查网络后重试',fetchedAt:Date.now()};
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
