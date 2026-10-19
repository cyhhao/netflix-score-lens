// Pure, shared matching and filtering rules. No browser/credential dependency.
export const DEFAULTS = Object.freeze({enabled:true,dimLowScores:true,scoreSource:'auto',minScore:7,dimOpacity:0.62,revealOnHover:true,providerMode:'auto'});
export const LABELS = {imdb:'IMDb',tvmaze:'TVmaze',rt:'烂番茄',metacritic:'Metacritic'};
export const normalize = (v='') => String(v).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]/gu,'');
export const scaleFor = source => ['rt','metacritic'].includes(source) ? 100 : 10;
export function cleanSettings(input={}) {
  const s = {...DEFAULTS};
  for (const k of ['enabled','dimLowScores','revealOnHover']) if (typeof input[k]==='boolean') s[k]=input[k];
  if (['auto','imdb','tvmaze','rt','metacritic'].includes(input.scoreSource)) s.scoreSource=input.scoreSource;
  if (input.providerMode==='free') s.providerMode='free';
  const n=Number(input.minScore);
  s.minScore=Number.isFinite(n) ? Math.max(0,Math.min(scaleFor(s.scoreSource),n)) : scaleFor(s.scoreSource)*0.7;
  const o=Number(input.dimOpacity);
  if(Number.isFinite(o)) s.dimOpacity=Math.max(.2,Math.min(.85,o));
  return s;
}
export function validItem(raw) {
  if (!raw || typeof raw.title!=='string' || !raw.title.trim()) throw Error('作品标题为空');
  const title=raw.title.trim().slice(0,200);
  const netflixId=/^\d{4,12}$/.test(String(raw.netflixId||'')) ? String(raw.netflixId) : '';
  const year=Number(raw.year);
  const item={title,netflixId,year:Number.isInteger(year)&&year>=1880&&year<=2100?year:null,type:['movie','series'].includes(raw.type)?raw.type:undefined};
  item.key=netflixId ? `nf:${netflixId}` : `title:${normalize(title)}:${item.year||''}:${item.type||''}`;
  return item;
}
export function ratingChoice(result, settings) {
  if (!result || result.status!=='ok') return null;
  const order=settings.scoreSource==='auto'?['imdb','tvmaze','rt','metacritic']:[settings.scoreSource];
  for(const source of order){
    const r=result.ratings?.[source];
    if(r && Number.isFinite(r.value) && r.value>=0 && r.value<=r.scale && [10,100].includes(r.scale)) return {source,...r};
  }
  return null;
}
export function isLow(result,settings) {
  const r=ratingChoice(result,settings);
  if(!settings.enabled||!settings.dimLowScores||!r) return false;
  return (settings.scoreSource==='auto'?r.value*10/r.scale:r.value)<settings.minScore;
}
export function formatRating(r) {return r.scale===100 ? `${Math.round(r.value)}${r.source==='rt'?'%':'/100'}` : r.value.toFixed(1);}
export function selectCandidate(item, candidates) {
  const title=normalize(item.title);
  const ranked=candidates.filter(c=>/^tt\d{7,10}$/.test(c.id)&&(!item.type||c.type===item.type)).map(c=>{
    const exact=normalize(c.title)===title;
    const yearDiff=item.year&&c.year?Math.abs(item.year-c.year):null;
    // Reject episode/miniseries/remake near misses before considering provider rank.
    const score=(exact?100:0)+(yearDiff===0?30:yearDiff===1?12:yearDiff!==null?-100:0)-Math.min(50,(c.rank||0)*2);
    return {c,exact,yearDiff,score};
  }).sort((a,b)=>b.score-a.score);
  if(!ranked.length) return {candidate:null,status:'not_found',reason:'未找到对应作品'};
  const first=ranked[0],second=ranked[1];
  const chinese=/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(item.title);
  if(first.exact && (!item.year||(first.yearDiff!==null&&first.yearDiff<=1)) && (!second || !second.exact || first.score-second.score>=10))
    return {candidate:first.c,status:'ok',confidence:'high',reason:'标题一致'+(item.year?'，年份已核对':'')};
  // A localized AKA can be inferred only from IMDb's title suggestions WITH
  // Netflix year/type. Never accept arbitrary Cinemeta rank 0 for CJK.
  const localized=ranked.filter(x=>x.c.provider==='IMDb' && x.yearDiff===0);
  if(chinese && item.type && localized.length===1 && (localized[0].c.rank??99)===0)
    return {candidate:localized[0].c,status:'ok',confidence:'localized',reason:'IMDb 别名检索 + Netflix 年份/类型；可点击纠错'};
  return {candidate:null,status:'ambiguous',reason:'同名或跨语言结果需要确认'};
}
export function candidateInput(c){
  if(!c||!/^tt\d{7,10}$/.test(c.id)||!['movie','series'].includes(c.type)) throw Error('无效的 IMDb 作品');
  return {id:c.id,type:c.type,title:String(c.title||c.id).slice(0,200),year:Number.isInteger(c.year)?c.year:null,provider:String(c.provider||'manual'),url:`https://www.imdb.com/title/${c.id}/`};
}
