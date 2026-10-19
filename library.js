export const SOURCE_ORDER = {auto:['imdb','tvmaze','rt','metacritic'],imdb:['imdb'],tvmaze:['tvmaze'],rt:['rt'],metacritic:['metacritic']};
export const SOURCE_LABELS = {imdb:'IMDb',tvmaze:'TVmaze',rt:'烂番茄',metacritic:'Metacritic'};
export const TYPE_LABELS = {movie:'电影',series:'剧集'};
export const STATUS_LABELS = {ok:'有评分',ambiguous:'待确认',not_found:'未找到',error:'请求失败',no_rating:'暂无评分',waiting:'待查询',disabled:'已暂停'};
const ratingValue = r => {
  if(r?.value == null || String(r.value).trim() === '' || ![10,100].includes(r.scale)) return null;
  const n = Number(r.value);
  return Number.isFinite(n) && n >= 0 && n <= r.scale ? n : null;
};
export function pickRating(result,source='auto') {
  if(result?.status && result.status !== 'ok') return null;
  for(const key of SOURCE_ORDER[source] || SOURCE_ORDER.auto) {
    const r=result?.ratings?.[key], n=ratingValue(r);
    if(n !== null) return {key,rating:r,value:n,comparable:r.scale===100?n/10:n};
  }
  return null;
}
export function formatRating(r,key) {
  const n=ratingValue(r);
  return n===null ? '' : r.scale===100 ? `${Math.round(n)}${key==='rt'?'%':'/100'}` : n.toFixed(1);
}
export function statusOf(item) { return item?.result?.status || 'waiting'; }
export function normalizeLibraryItems(items=[]) {
  const best=new Map();
  for(const raw of items) {
    if(!raw?.itemKey) continue;
    const old=best.get(raw.itemKey);
    if(!old || Number(raw.current)>Number(old.current) || (raw.current===old.current && Number(raw.at)>Number(old.at))) best.set(raw.itemKey,raw);
  }
  return [...best.values()];
}
export function filterLibraryItems(items,{query='',type='all',status='all',source='auto'}={}) {
  const needle=String(query).trim().toLowerCase();
  return items.filter(item=>{
    const result=item.result||{}, statusValue=statusOf(item), picked=pickRating(result,source);
    if(type!=='all' && result.type!==type) return false;
    if(status==='rated' && !picked) return false;
    if(status==='attention' && !['ambiguous','not_found','error'].includes(statusValue)) return false;
    if(status==='no_rating' && (picked || ['ambiguous','not_found','error'].includes(statusValue))) return false;
    return !needle || `${item.title||''} ${result.title||''} ${result.id||''}`.toLowerCase().includes(needle);
  });
}
export function sortLibraryItems(items,sort='score-desc',source='auto') {
  return [...items].sort((a,b)=>{
    if(sort.startsWith('score')) {
      const ar=pickRating(a.result,source), br=pickRating(b.result,source);
      if(!ar || !br) return Number(!ar)-Number(!br);
      return sort==='score-asc' ? ar.comparable-br.comparable : br.comparable-ar.comparable;
    }
    if(sort==='updated-desc') return (b.at||0)-(a.at||0);
    if(sort==='year-desc') return (Number(b.result?.year)||0)-(Number(a.result?.year)||0);
    return String(a.title||'').localeCompare(String(b.title||''),'zh-Hans-CN');
  });
}
export function groupLibraryItems(items,group='none',source='auto') {
  if(group==='none') return [['全部',items]];
  const groups=new Map(), hundred=source==='rt'||source==='metacritic';
  for(const item of items) {
    const result=item.result||{}, picked=pickRating(result,source);
    const label=group==='type' ? TYPE_LABELS[result.type]||'未分类' : group==='status' ? STATUS_LABELS[statusOf(item)]||'其他' :
      !picked ? '暂无评分' : picked.comparable>=8 ? (hundred?'高分 · 80+':'高分 · 8.0+') :
      picked.comparable>=7 ? (hundred?'合格 · 70–79':'合格 · 7.0–7.9') : (hundred?'低分 · 低于 70':'低分 · 低于 7.0');
    if(!groups.has(label)) groups.set(label,[]);
    groups.get(label).push(item);
  }
  return [...groups.entries()];
}
export function isLow(item,settings,source=settings?.scoreSource||'auto') {
  const picked=pickRating(item.result,source), threshold=Number(settings?.minScore)/(['rt','metacritic'].includes(settings?.scoreSource)?10:1);
  return Boolean(picked && settings?.dimLowScores && picked.comparable<threshold);
}

const $=(s,r=document)=>r.querySelector(s);
const state={items:[],settings:null,hasApiKey:false,source:'auto',query:'',type:'all',status:'all',sort:'score-desc',group:'none'};
const fields=['query','type','status','source','sort','group'];
const expanded=new Set(), allowedHosts=new Set(['www.imdb.com','www.tvmaze.com','www.rottentomatoes.com','www.metacritic.com']);
let refreshRevision=0, statusTimer, changeTimer;
function safeUrl(value) {
  try { const u=new URL(value); return u.protocol==='https:'&&allowedHosts.has(u.hostname)?u.href:null; } catch { return null; }
}
async function getLibrary() {
  const response=await chrome.runtime.sendMessage({type:'GET_LIBRARY'});
  if(!response?.ok) throw Error(response?.error||'评分库读取失败');
  return response;
}
function setStatus(text,error=false) {
  clearTimeout(statusTimer);
  const node=$('#statusMessage'); node.textContent=text||''; node.className=`status${error?' is-error':''}`;
}
function updateStats(items) {
  $('#statTotal').textContent=items.length;
  $('#statRated').textContent=items.filter(i=>pickRating(i.result,state.source)).length;
  $('#statAttention').textContent=items.filter(i=>['ambiguous','not_found','error'].includes(statusOf(i))).length;
  $('#statLow').textContent=items.filter(i=>isLow(i,state.settings,state.source)).length;
}
function card(item) {
  const root=$('#cardTemplate').content.firstElementChild.cloneNode(true);
  const result=item.result||{}, picked=pickRating(result,state.source), canonical=result.title&&result.title!==item.title?result.title:'';
  root.dataset.status=statusOf(item); root.dataset.itemKey=item.itemKey;
  $('.local-title',root).textContent=item.title||'未命名作品';
  $('.local-title',root).title=item.title||'';
  $('.canonical',root).textContent=canonical || `${result.year||'年份未知'} · ${TYPE_LABELS[result.type]||'类型未知'}`;
  $('.canonical',root).title=canonical;
  const score=$('.score',root);
  score.textContent=picked ? formatRating(picked.rating,picked.key) : statusOf(item)==='ok' ? '暂无该源评分' : STATUS_LABELS[statusOf(item)]||'待查询';
  if(!picked) score.classList.add('is-none');
  $('.score-source',root).textContent=picked ? SOURCE_LABELS[picked.key] : state.source==='auto'?'评分状态':SOURCE_LABELS[state.source];
  const chips=$('.chips',root);
  if(statusOf(item)==='ok') for(const [key,r] of Object.entries(result.ratings||{})) {
    if(ratingValue(r)===null) continue;
    const chip=document.createElement('span'); chip.className=`score-chip ${key}`;
    chip.textContent=`${SOURCE_LABELS[key]||key} ${formatRating(r,key)}`;
    chip.title=`提供方：${r.provider||'未标注'}`; chips.append(chip);
  }
  $('.meta',root).textContent=[TYPE_LABELS[result.type],result.year?`${result.year}年`:'年份未知',result.confidence==='manual'?'手动绑定':result.confidence==='localized'?'别名匹配':result.confidence==='high'?'高置信度':''].filter(Boolean).join(' · ');
  $('.reason',root).textContent=result.warning||result.matchReason||STATUS_LABELS[statusOf(item)]||'';
  const detail=$('.details-panel',root), button=$('.details',root);
  detail.id=`detail-${encodeURIComponent(item.itemKey)}`;
  button.setAttribute('aria-controls',detail.id);
  const showDetails=open=>{
    detail.hidden=!open; button.textContent=open?'收起资料':'查看资料'; button.setAttribute('aria-expanded',String(open));
    if(!open) return;
    detail.replaceChildren();
    const line=text=>{ const p=document.createElement('p'); p.textContent=text; detail.append(p); };
    line(`Netflix 标题：${item.title}`);
    if(canonical) line(`匹配标题：${canonical}`);
    if(result.id) line(`IMDb ID：${result.id}`);
    if(result.matchReason) line(`匹配依据：${result.matchReason}`);
    if(result.fetchedAt||item.at) line(`查询时间：${new Date(result.fetchedAt||item.at).toLocaleString()}`);
    if(item.current===false) line('历史配置下的结果：评分源设置现已改变。');
    if(item.stale) line('缓存已过期；返回 Netflix 并再次遇到此作品时重新查询，本页仅浏览本机数据。');
    for(const [key,r] of Object.entries(result.ratings||{})) {
      if(ratingValue(r)===null) continue;
      line(`${SOURCE_LABELS[key]||key} ${formatRating(r,key)} · 提供方：${r.provider||'未标注'}`);
      const url=safeUrl(r.url); if(!url) continue;
      const a=document.createElement('a'); a.href=url; a.target='_blank'; a.rel='noopener noreferrer';
      a.textContent=`打开 ${SOURCE_LABELS[key]||key} 来源 ↗`; detail.append(a);
    }
    if(result.ratings?.tvmaze) line('TVmaze 数据按 CC BY-SA 使用；来源链接见上。');
    if(Array.isArray(result.candidates)&&result.candidates.length) line(`候选：${result.candidates.slice(0,5).map(c=>`${c.title||c.id}${c.year?`（${c.year}）`:''}`).join('、')}`);
    if(statusOf(item)==='ambiguous') line('尚未确认匹配，请在 Netflix 页的插件弹窗「作品」中核对并绑定。');
  };
  showDetails(expanded.has(item.itemKey));
  button.addEventListener('click',()=>{
    const open=detail.hidden;
    if(open) expanded.add(item.itemKey); else expanded.delete(item.itemKey);
    showDetails(open);
  });
  const netflix=$('.netflix',root); netflix.disabled=!item.netflixId;
  netflix.addEventListener('click',()=>chrome.tabs.create({url:`https://www.netflix.com/browse?jbv=${encodeURIComponent(item.netflixId)}`}));
  return root;
}
function render() {
  const focused=document.activeElement, focusedCard=focused?.closest?.('.card');
  const focus=focusedCard?{key:focusedCard.dataset.itemKey,kind:focused.classList.contains('details')?'details':focused.classList.contains('netflix')?'netflix':null}:null;
  const filtered=filterLibraryItems(state.items,state), sorted=sortLibraryItems(filtered,state.sort,state.source);
  const groups=groupLibraryItems(sorted,state.group,state.source), library=$('#library'); library.replaceChildren();
  $('#resultMeta').textContent=`显示 ${sorted.length} / ${state.items.length} 部作品 · 评分依据：${state.source==='auto'?'自动（IMDb 优先）':SOURCE_LABELS[state.source]}`;
  $('#empty').hidden=sorted.length!==0; library.hidden=sorted.length===0;
  $('#empty h2').textContent=state.items.length?'没有符合条件的作品':'还没有可展示的作品';
  $('#empty p').textContent=state.items.length?'试试其他关键词，或清除筛选条件。':'先在 Netflix 浏览一些作品，已有匹配结果会出现在这里。';
  $('#clearFilters').hidden=!state.items.length; $('#emptyOpenNetflix').hidden=Boolean(state.items.length);
  for(const [name,items] of groups) {
    const section=document.createElement('section'), h=document.createElement('h2'), count=document.createElement('span'), grid=document.createElement('div');
    h.className='group-title'; h.textContent=name; count.textContent=`${items.length} 部`; h.append(count);
    grid.className='card-grid'; for(const item of items) grid.append(card(item));
    section.append(h,grid); library.append(section);
  }
  updateStats(state.items);
  if(focus?.kind) [...library.querySelectorAll('.card')].find(c=>c.dataset.itemKey===focus.key)?.querySelector(`.${focus.kind}`)?.focus({preventScroll:true});
}
async function refresh({silent=false}={}) {
  const revision=++refreshRevision;
  if(!silent) setStatus('正在读取本机缓存…');
  $('#refresh').disabled=true;
  try {
    const response=await getLibrary(); if(revision!==refreshRevision) return;
    state.items=normalizeLibraryItems(response.items); state.settings=response.settings; state.hasApiKey=Boolean(response.hasApiKey);
    $('#headline').textContent=`${state.items.length} 部作品`;
    const omdb=state.hasApiKey&&state.settings.providerMode!=='free';
    $('#subline').textContent=omdb?'取分模式：免费源 + OMDb 补充。当前展示本机缓存。':state.hasApiKey?'取分模式：仅免费源；已保存的 OMDb Key 不用于自动取分。':'取分模式：免费免 Key 源。无需先填写 API Key。';
    const notice=$('#keyNotice'); notice.hidden=omdb;
    notice.textContent=state.hasApiKey?'OMDb 补充已关闭：自动取分仅使用 IMDb 镜像 / TVmaze。':'未配置 OMDb Key：可获取 IMDb 镜像 / TVmaze；RT 和 Metacritic 需要可选 OMDb。';
    render();
    if(!silent) { setStatus('已读取本机缓存'); statusTimer=setTimeout(()=>setStatus(''),2200); }
  } catch(error) {
    if(revision!==refreshRevision) return;
    if(!state.settings) $('#headline').textContent='暂时无法读取评分库';
    setStatus(`${error.message||'读取失败'}；请重试，更新扩展后需刷新此页。`,true);
  } finally { if(revision===refreshRevision) $('#refresh').disabled=false; }
}
function saveView() { try { localStorage.setItem('scoreLensLibraryView',JSON.stringify(Object.fromEntries(fields.map(k=>[k,state[k]])))); } catch {} }
function boot() {
  let saved={}; try { saved=JSON.parse(localStorage.getItem('scoreLensLibraryView')||'{}'); } catch {}
  for(const id of fields) {
    const input=$('#'+id), value=saved?.[id];
    if(typeof value==='string'&&(id==='query'||[...input.options].some(o=>o.value===value))) { state[id]=value.slice(0,200); input.value=state[id]; }
    input.addEventListener(id==='query'?'input':'change',()=>{ state[id]=input.value; saveView(); render(); });
  }
  $('#version').textContent=`v${chrome.runtime.getManifest().version}`;
  $('#refresh').addEventListener('click',()=>refresh());
  const openNetflix=()=>chrome.tabs.create({url:'https://www.netflix.com/browse'});
  $('#openNetflix').addEventListener('click',openNetflix); $('#emptyOpenNetflix').addEventListener('click',openNetflix);
  $('#clearFilters').addEventListener('click',()=>{ for(const [key,value] of Object.entries({query:'',type:'all',status:'all'})) { state[key]=value; $('#'+key).value=value; } saveView(); render(); $('#query').focus(); });
  chrome.storage?.onChanged?.addListener((changes,area)=>{
    if(area!=='local'||!(changes.cacheV3||changes.settings||changes.credentials)) return;
    clearTimeout(changeTimer); changeTimer=setTimeout(()=>refresh({silent:true}),200);
  });
  refresh();
}
if(typeof document!=='undefined'&&globalThis.chrome?.runtime?.id) boot();
