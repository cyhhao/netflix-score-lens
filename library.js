import {t,setLanguage,getLanguage,localizeDOM,localizeMessage,formatDate} from './i18n.js';
import './i18n-content.js'; // shared backend/cache message dictionary (matchReason, warnings, errors)
import './i18n-library.js';
import {netflixTitleUrl} from './core.js';

// Label maps hold canonical Chinese catalog keys; display them through t().
export const SOURCE_ORDER = {auto:['imdb','tvmaze','rt','metacritic'],imdb:['imdb'],tvmaze:['tvmaze'],rt:['rt'],metacritic:['metacritic']};
export const SOURCE_LABELS = {imdb:'IMDb',tvmaze:'TVmaze',rt:'烂番茄',metacritic:'Metacritic'};
export const TYPE_LABELS = {movie:'电影',series:'剧集'};
export const STATUS_LABELS = {ok:'有评分',ambiguous:'待确认',not_found:'未找到',error:'请求失败',no_rating:'暂无评分',waiting:'待查询',disabled:'已暂停'};
export const sourceLabel = key => SOURCE_LABELS[key] ? t(SOURCE_LABELS[key]) : key;
const typeLabel = type => TYPE_LABELS[type] && t(TYPE_LABELS[type]);
const statusLabel = status => STATUS_LABELS[status] && t(STATUS_LABELS[status]);
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
    return !needle || `${item.title||''} ${result.title||''} ${result.netflixTitle?.title||''} ${result.id||''}`.toLowerCase().includes(needle);
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
  if(group==='none') return [[t('全部'),items]];
  const groups=new Map(), hundred=source==='rt'||source==='metacritic';
  for(const item of items) {
    const result=item.result||{}, picked=pickRating(result,source);
    const label=t(group==='type' ? TYPE_LABELS[result.type]||'未分类' : group==='status' ? STATUS_LABELS[statusOf(item)]||'其他' :
      !picked ? '暂无评分' : picked.comparable>=8 ? (hundred?'高分 · 80+':'高分 · 8.0+') :
      picked.comparable>=7 ? (hundred?'合格 · 70–79':'合格 · 7.0–7.9') : (hundred?'低分 · 低于 70':'低分 · 低于 7.0'));
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
const state={items:[],settings:null,hasApiKey:false,loadFailed:false,source:'auto',query:'',type:'all',status:'all',sort:'score-desc',group:'none'};
const fields=['query','type','status','source','sort','group'];
const expanded=new Set(), allowedHosts=new Set(['www.imdb.com','www.tvmaze.com','www.rottentomatoes.com','www.metacritic.com']);
// Status text is a thunk so a language switch re-renders it from canonical messages.
let refreshRevision=0, languageEpoch=0, statusTimer, changeTimer, languageSaveError, statusView={text:()=>'',error:false};
const countText=(n,one,many)=>n===1?t(one):t(many,{count:n});
const errorText=(error,fallback)=>error?.message?localizeMessage(error.message):t(fallback);
function safeUrl(value) {
  try { const u=new URL(value); return u.protocol==='https:'&&allowedHosts.has(u.hostname)?u.href:null; } catch { return null; }
}
async function getLibrary() {
  const response=await chrome.runtime.sendMessage({type:'GET_LIBRARY'});
  if(!response?.ok) throw Error(response?.error||'');
  return response;
}
function setStatus(text=()=>'',error=false) {
  clearTimeout(statusTimer); statusView={text,error}; paintStatus();
}
function paintStatus() {
  const node=$('#statusMessage'); node.textContent=statusView.text(); node.className=`status${statusView.error?' is-error':''}`;
}
function paintSummary() {
  if(!state.settings) { $('#headline').textContent=t(state.loadFailed?'暂时无法读取评分库':'正在读取评分库…'); return; }
  $('#headline').textContent=countText(state.items.length,'1 部作品','{count} 部作品');
  const omdb=state.hasApiKey&&state.settings.providerMode!=='free', notice=$('#keyNotice');
  $('#subline').textContent=t(omdb?'取分模式：免费源 + OMDb 补充。当前展示本机缓存。':state.hasApiKey?'取分模式：仅免费源；已保存的 OMDb Key 不用于自动取分。':'取分模式：免费免 Key 源。无需先填写 API Key。');
  notice.hidden=omdb;
  notice.textContent=t(state.hasApiKey?'OMDb 补充已关闭：自动取分仅使用 IMDb 镜像 / TVmaze。':'未配置 OMDb Key：可获取 IMDb 镜像 / TVmaze；RT 和 Metacritic 需要可选 OMDb。');
}
function updateStats(items) {
  $('#statTotal').textContent=items.length;
  $('#statRated').textContent=items.filter(i=>pickRating(i.result,state.source)).length;
  $('#statAttention').textContent=items.filter(i=>['ambiguous','not_found','error'].includes(statusOf(i))).length;
  $('#statLow').textContent=items.filter(i=>isLow(i,state.settings,state.source)).length;
}
function card(item) {
  const root=$('#cardTemplate').content.firstElementChild.cloneNode(true);
  const result=item.result||{}, status=statusOf(item), picked=pickRating(result,state.source), canonical=result.title&&result.title!==item.title?result.title:'';
  const provider=r=>t('提供方：{provider}',{provider:r.provider||t('未标注')});
  root.dataset.status=status; root.dataset.itemKey=item.itemKey;
  $('.local-title',root).textContent=item.title||t('未命名作品');
  $('.local-title',root).title=item.title||'';
  $('.canonical',root).textContent=canonical || `${result.year||t('年份未知')} · ${typeLabel(result.type)||t('类型未知')}`;
  $('.canonical',root).title=canonical;
  const score=$('.score',root);
  score.textContent=picked ? formatRating(picked.rating,picked.key) : status==='ok' ? t('暂无该源评分') : statusLabel(status)||t('待查询');
  if(!picked) score.classList.add('is-none');
  $('.score-source',root).textContent=picked ? sourceLabel(picked.key) : state.source==='auto'?t('评分状态'):sourceLabel(state.source);
  const chips=$('.chips',root);
  if(status==='ok') for(const [key,r] of Object.entries(result.ratings||{})) {
    if(ratingValue(r)===null) continue;
    const chip=document.createElement('span'); chip.className=`score-chip ${key}`;
    chip.textContent=`${sourceLabel(key)} ${formatRating(r,key)}`;
    chip.title=provider(r); chips.append(chip);
  }
  $('.meta',root).textContent=[typeLabel(result.type),result.year?t('{year}年',{year:result.year}):t('年份未知'),result.confidence==='manual'?t('手动绑定'):result.confidence==='localized'?t('别名匹配'):result.confidence==='high'?t('高置信度'):''].filter(Boolean).join(' · ');
  $('.reason',root).textContent=result.warning?localizeMessage(result.warning):result.matchReason?localizeMessage(result.matchReason):statusLabel(status)||'';
  const detail=$('.details-panel',root), button=$('.details',root);
  detail.id=`detail-${encodeURIComponent(item.itemKey)}`;
  button.setAttribute('aria-controls',detail.id);
  const showDetails=open=>{
    detail.hidden=!open; button.textContent=t(open?'收起资料':'查看资料'); button.setAttribute('aria-expanded',String(open));
    if(!open) return;
    detail.replaceChildren();
    const line=text=>{ const p=document.createElement('p'); p.textContent=text; detail.append(p); };
    line(t('Netflix 标题：{title}',{title:item.title}));
    if(canonical) line(t('匹配标题：{title}',{title:canonical}));
    if(result.netflixTitle?.title) {
      line(t('Netflix 英文展示名：{title}',{title:result.netflixTitle.title}));
      const url=netflixTitleUrl(result.netflixTitle,item.netflixId);
      if(url){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=t('Netflix 标题来源 ↗');detail.append(a);}
    }
    if(result.id) line(t('IMDb ID：{id}',{id:result.id}));
    if(result.matchReason) line(t('匹配依据：{reason}',{reason:localizeMessage(result.matchReason)}));
    if(result.fetchedAt||item.at) line(t('查询时间：{date}',{date:formatDate(result.fetchedAt||item.at)}));
    if(item.current===false) line(t('历史配置下的结果：评分源设置现已改变。'));
    if(item.stale) line(t('缓存已过期；返回 Netflix 并再次遇到此作品时重新查询，本页仅浏览本机数据。'));
    for(const [key,r] of Object.entries(result.ratings||{})) {
      if(ratingValue(r)===null) continue;
      line(`${sourceLabel(key)} ${formatRating(r,key)} · ${provider(r)}`);
      const url=safeUrl(r.url); if(!url) continue;
      const a=document.createElement('a'); a.href=url; a.target='_blank'; a.rel='noopener noreferrer';
      a.textContent=t('打开 {source} 来源 ↗',{source:sourceLabel(key)}); detail.append(a);
    }
    if(result.ratings?.tvmaze) line(t('TVmaze 数据按 CC BY-SA 使用；来源链接见上。'));
    if(Array.isArray(result.candidates)&&result.candidates.length) line(t('候选：{candidates}',{candidates:result.candidates.slice(0,5).map(c=>c.year?t('{title}（{year}）',{title:c.title||c.id,year:c.year}):c.title||c.id).join(t('、'))}));
    if(status==='ambiguous') line(t('尚未确认匹配，请在 Netflix 页的插件弹窗「作品」中核对并绑定。'));
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
  const focus=focusedCard?{key:focusedCard.dataset.itemKey,kind:focused.classList.contains('details')?'details':focused.classList.contains('netflix')?'netflix':null,link:[...focusedCard.querySelectorAll('.details-panel a')].indexOf(focused)}:null;
  const filtered=filterLibraryItems(state.items,state), sorted=sortLibraryItems(filtered,state.sort,state.source);
  const groups=groupLibraryItems(sorted,state.group,state.source), library=$('#library'); library.replaceChildren();
  $('#resultMeta').textContent=t('显示 {shown} / {total} 部作品 · 评分依据：{source}',{shown:sorted.length,total:state.items.length,source:state.source==='auto'?t('自动（IMDb 优先）'):sourceLabel(state.source)});
  $('#empty').hidden=sorted.length!==0; library.hidden=sorted.length===0;
  $('#empty h2').textContent=t(state.items.length?'没有符合条件的作品':'还没有可展示的作品');
  $('#empty p').textContent=t(state.items.length?'试试其他关键词，或清除筛选条件。':'先在 Netflix 浏览一些作品，已有匹配结果会出现在这里。');
  $('#clearFilters').hidden=!state.items.length; $('#emptyOpenNetflix').hidden=Boolean(state.items.length);
  for(const [name,items] of groups) {
    const section=document.createElement('section'), h=document.createElement('h2'), count=document.createElement('span'), grid=document.createElement('div');
    h.className='group-title'; h.textContent=name; count.textContent=countText(items.length,'1 部','{count} 部'); h.append(count);
    grid.className='card-grid'; for(const item of items) grid.append(card(item));
    section.append(h,grid); library.append(section);
  }
  updateStats(state.items);
  if(!focus) return;
  const target=[...library.querySelectorAll('.card')].find(c=>c.dataset.itemKey===focus.key);
  (focus.kind?target?.querySelector(`.${focus.kind}`):target?.querySelectorAll('.details-panel a')[focus.link])?.focus({preventScroll:true});
}
// Re-renders every app-owned string from state; filters, search text, expanded details and focus survive.
function localize() {
  localizeDOM(document);
  $('#language').value=getLanguage();
  paintSummary(); paintStatus();
  if(state.settings) render();
}
async function refresh({silent=false}={}) {
  const revision=++refreshRevision, epoch=languageEpoch;
  if(!silent) setStatus(()=>t('正在读取本机缓存…'));
  $('#refresh').disabled=true;
  try {
    const response=await getLibrary(); if(revision!==refreshRevision) return;
    state.items=normalizeLibraryItems(response.items); state.settings=response.settings; state.hasApiKey=Boolean(response.hasApiKey); state.loadFailed=false;
    // A read that raced a language save must not revert the choice just made.
    if(epoch===languageEpoch) setLanguage(state.settings.language);
    localize();
    if(!silent) { setStatus(()=>t('已读取本机缓存')); statusTimer=setTimeout(()=>setStatus(),2200); }
  } catch(error) {
    if(revision!==refreshRevision) return;
    state.loadFailed=true; paintSummary();
    setStatus(()=>t('{error}；请重试，更新扩展后需刷新此页。',{error:errorText(error,'评分库读取失败')}),true);
  } finally { if(revision===refreshRevision) $('#refresh').disabled=false; }
}
async function changeLanguage() {
  const previous=getLanguage();
  languageEpoch++; setLanguage($('#language').value); localize();
  try {
    const response=await chrome.runtime.sendMessage({type:'SAVE_SETTINGS',settings:{language:getLanguage()}});
    if(!response?.ok) throw Error(response?.error||'');
    state.settings=response.settings; state.hasApiKey=Boolean(response.hasApiKey);
    if(statusView.text===languageSaveError) setStatus();
  } catch(error) {
    setLanguage(previous); localize();
    setStatus(languageSaveError=()=>t('语言设置保存失败：{error}',{error:errorText(error,'请求失败')}),true);
  } finally { languageEpoch++; }
}
function saveView() { try { localStorage.setItem('scoreLensLibraryView',JSON.stringify(Object.fromEntries(fields.map(k=>[k,state[k]])))); } catch {} }
function boot() {
  setLanguage('auto'); localize();
  let saved={}; try { saved=JSON.parse(localStorage.getItem('scoreLensLibraryView')||'{}'); } catch {}
  for(const id of fields) {
    const input=$('#'+id), value=saved?.[id];
    if(typeof value==='string'&&(id==='query'||[...input.options].some(o=>o.value===value))) { state[id]=value.slice(0,200); input.value=state[id]; }
    input.addEventListener(id==='query'?'input':'change',()=>{ state[id]=input.value; saveView(); render(); });
  }
  $('#version').textContent=`v${chrome.runtime.getManifest().version}`;
  $('#language').addEventListener('change',changeLanguage);
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
