// Optional, anonymous Netflix display-title enrichment. No account state,
// script evaluation, HTML persistence, cookies, or additional host permission.
const ID = /^\d{4,12}$/;
const MAX_BYTES = 2 * 1024 * 1024;
const ENTITIES = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ndash:'–',mdash:'—',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',hellip:'…',eacute:'é'};
function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, key) => {
    if (!key.startsWith('#')) return ENTITIES[key] ?? all;
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}
function attributes(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4]);
  return out;
}
function titlePage(url, id) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'www.netflix.com' && !u.port && !u.username && !u.password &&
      new RegExp(`^/(?:[a-z]{2,3}(?:-[a-z]{2,3})?/)?title/${id}/?$`, 'i').test(u.pathname);
  } catch { return false; }
}
export function parseNetflixTitle(html, {netflixId, url} = {}) {
  const id = String(netflixId || '');
  if (!ID.test(id) || !titlePage(url, id) || typeof html !== 'string' || html.length > MAX_BYTES) return null;
  // Never inspect/evaluate embedded application state. Strip executable and
  // inert template content before looking for visible markup and public links.
  const markup = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const lang = attributes(markup.match(/<html\b[^>]*>/i)?.[0] || '').lang || '';
  if (!/^en(?:-[a-z]{2})?$/i.test(lang)) return null;
  const titles = [...markup.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)];
  if (titles.length !== 1) return null;
  const title = decode(titles[0][1].replace(/<[^>]*>/g, '')).replace(/\s+/g,' ').trim();
  if (!title || title.length > 200 || /[\x00-\x1f]|&(?:#\w+|[a-z]+);/i.test(title) || /^(?:Netflix|Lost your way\?|Page not found|Access denied|Sign in|Something went wrong)$/i.test(title)) return null;
  // A 200 login/error/generic landing page is not proof of an ID→title mapping.
  const identified = [...markup.matchAll(/<(?:meta|link)\b[^>]*>/gi)].some(([tag]) => {
    const a = attributes(tag);
    if (a.rel === 'canonical' && titlePage(a.href, id)) return true;
    const value = ['al:ios:url','al:android:url'].includes(a.property) ? a.content : a.rel === 'alternate' ? a.href : '';
    return typeof value === 'string' && new RegExp(`^(?:(?:https?|nflx)://www\\.netflix\\.com|android-app://com\\.netflix\\.mediaclient/https?/www\\.netflix\\.com)/title/${id}(?:[?#]|$)`).test(value);
  });
  return identified ? {status:'ok',netflixId:id,title,language:'en',url:new URL(url).origin + new URL(url).pathname} : null;
}
async function boundedText(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw Error('oversized'); }
  const reader = response.body?.getReader();
  if (!reader) throw Error('missing_body');
  const decoder = new TextDecoder(); let size = 0, text = '';
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw Error('oversized'); }
      text += decoder.decode(value,{stream:true});
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
export function createNetflixTitleClient({fetchImpl=(...args)=>fetch(...args),timeoutMs=6000,spacingMs=500,now=Date.now} = {}) {
  let active = 0, nextStart = 0, cooldown = 0, timer = null;
  const queue = [];
  function pump() {
    while (active < 2 && queue.length) {
      const wait = nextStart - now();
      if (wait > 0) { if (!timer) timer=setTimeout(()=>{timer=null;pump();},wait); return; }
      const {id,allowed,resolve} = queue.shift();
      if (!allowed()) { resolve({status:'unavailable',reason:'canceled'}); continue; }
      if (cooldown > now()) { resolve({status:'error',reason:'cooldown'}); continue; }
      nextStart = now() + spacingMs; active++;
      request(id).then(resolve).finally(()=>{active--;pump();});
    }
  }
  async function request(id) {
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response = await fetchImpl(`https://www.netflix.com/title/${id}`, {
        credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:controller.signal,
        headers:{Accept:'text/html','Accept-Language':'en-US,en;q=0.9'}
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([403,429].includes(response.status)) {
          const raw = response.headers.get('retry-after');
          let wait = Number.NaN;
          if (raw && /^\d+(?:\.\d+)?$/.test(raw.trim())) wait = Number(raw) * 1000;
          else if (raw) { const retryAt = Date.parse(raw); if (Number.isFinite(retryAt)) wait = retryAt - now(); }
          cooldown = now() + Math.min(3600000, Math.max(60000, Number.isFinite(wait) ? wait : 0));
        }
        return {status:response.status===404?'unavailable':'error',reason:`http_${response.status}`};
      }
      if (!titlePage(response.url,id) || !/\btext\/html\b/i.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel(); return {status:'unavailable',reason:'not_title_page'};
      }
      return parseNetflixTitle(await boundedText(response),{netflixId:id,url:response.url}) || {status:'unavailable',reason:'unverified_page'};
    } catch { return {status:'error',reason:controller.signal.aborted?'timeout':'request_failed'}; }
    finally { clearTimeout(timer); }
  }
  return {get(netflixId,{allowed=()=>true}={}) {
    const id=String(netflixId||'');
    if (!ID.test(id)) return Promise.resolve({status:'unavailable',reason:'invalid_id'});
    return new Promise(resolve=>{queue.push({id,allowed,resolve});pump();});
  }};
}
