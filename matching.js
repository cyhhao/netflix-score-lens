import {normalize,selectCandidate} from './core.js';
import {diagnostic,diagnosticsFor} from './providers.js';
export const MATCHING_VERSION = 1;
export function needsNetflixAlias(item, selection) {
  return Boolean(/^\d{4,12}$/.test(item.netflixId || '') && item.year && ['movie','series'].includes(item.type) && !['high','manual'].includes(selection?.confidence));
}
export function selectNetflixAlias(item, alias, candidates) {
  if (!item.year || !item.type || alias?.status !== 'ok' || alias.netflixId !== item.netflixId || alias.language !== 'en') return null;
  const title = normalize(alias.title);
  if (!title) return null;
  const exact = new Map(candidates.filter(c=>/^tt\d{7,10}$/.test(c.id) && c.type===item.type && c.year===item.year && normalize(c.title)===title).map(c=>[c.id,c]));
  // Provider order/rank cannot disambiguate same-name, same-year works.
  return exact.size === 1 ? [...exact.values()][0] : null;
}
function mergeCandidates(first, second) {
  const seen = new Set();
  return [...first,...second].filter(c=>{if(seen.has(c.id))return false;seen.add(c.id);return true;});
}
const confirmed = candidate => ({candidate,status:'ok',confidence:'high',reason:'Netflix ID 英文标题 + 年份/类型一致'});
const conflict = () => ({candidate:null,status:'ambiguous',reason:'原片名与 Netflix 英文标题证据不一致，请确认'});
const disabled = () => ({selection:{candidate:null,status:'disabled'},candidates:[],diagnostics:[]});
// Optional Netflix title client reasons → sanitized provenance (no URL/body).
function aliasDiagnostic(reason) {
  const http=/^http_(\d{3})$/.exec(reason||'');
  return diagnostic({provider:'Netflix',stage:'title',kind:http||reason==='cooldown'?'http':{timeout:'timeout',request_failed:'network'}[reason]||'internal',status:http?Number(http[1]):undefined});
}
export async function matchTitle(item, {search,getAlias,allowed=()=>true}) {
  if (!allowed()) return disabled();
  let candidates=[], selection, warning='', alias=null;
  const diagnostics=[];
  try { candidates=await search(item.title,{type:item.type,year:item.year}); selection=selectCandidate(item,candidates); }
  catch (error) { selection={candidate:null,status:'error',reason:'检索失败，请稍后重试'}; diagnostics.push(...diagnosticsFor(error,'search')); }
  if (!allowed()) return disabled();
  if (needsNetflixAlias(item,selection)) {
    try { alias=await getAlias(item.netflixId); }
    catch { alias={status:'error'}; }
    if (!allowed()) return disabled();
    if (alias?.status==='ok' && alias.netflixId===item.netflixId && alias.language==='en' && normalize(alias.title)) {
      // IMDb's original search may already have the English candidate. Verify
      // it against Netflix before spending another provider request.
      const existing=selectNetflixAlias(item,alias,candidates);
      if (existing) {
        selection=!selection.candidate || selection.candidate.id===existing.id ? confirmed(existing) : conflict();
      } else if (normalize(alias.title)!==normalize(item.title)) {
        let english=[], complete=true;
        try { english=await search(alias.title,{type:item.type,year:item.year}); }
        catch (error) { complete=false; diagnostics.push(...diagnosticsFor(error,'search')); }
        if (!allowed()) return disabled();
        const chosen=selectNetflixAlias(item,alias,[...english,...candidates]);
        candidates=mergeCandidates(english,candidates);
        if (chosen) selection=!selection.candidate || selection.candidate.id===chosen.id ? confirmed(chosen) : conflict();
        // A missing/non-exact English result is absence of corroboration, not
        // contradictory identity evidence. Preserve a valid localized match.
        else if (complete && !selection.candidate) selection={candidate:null,status:candidates.length?'ambiguous':'not_found',reason:candidates.length?'同名或跨语言结果需要确认':'未找到对应作品'};
        if (!complete) warning='英文片名检索暂不可用，已保留原片名检索结果';
      }
    } else {
      if (alias?.status==='error') { warning='Netflix 英文标题暂不可用，已回退原片名检索'; diagnostics.push(aliasDiagnostic(alias.reason)); }
      if (alias?.status==='ok') alias={status:'unavailable'};
    }
  }
  return {selection,candidates,warning,alias,diagnostics};
}
