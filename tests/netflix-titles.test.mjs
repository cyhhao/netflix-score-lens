import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {createNetflixTitleClient,parseNetflixTitle} from '../netflix-titles.js';
import {netflixTitleUrl} from '../core.js';
const ID='70000001', url=`https://www.netflix.com/hk-en/title/${ID}`;
const page=(id=ID,title='Example &amp; Story',lang='en')=>`<!doctype html><html lang="${lang}"><head><meta property="al:ios:url" content="nflx://www.netflix.com/title/${id}?locale=en-US"></head><body><h1>${title}</h1></body></html>`;
const parse=(html=page(),overrides={})=>parseNetflixTitle(html,{netflixId:ID,url,...overrides});
function response(body=page(),options={}) {
  const r=new Response(body,{status:options.status||200,headers:{'Content-Type':'text/html',...options.headers}});
  Object.defineProperty(r,'url',{value:options.url||url});return r;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

describe('parseNetflixTitle',()=>{
  it('accepts same-ID English title, entities and a regional redirect',()=>{
    assert.deepEqual(parse(),{status:'ok',netflixId:ID,title:'Example & Story',language:'en',url});
    assert.equal(parse(page(ID,'Caf&eacute; &#x1f3ac; &#38; &#39;Story&#39;','en-US')).title,"Café 🎬 & 'Story'");
  });
  it('rejects invalid IDs and wrong final URL identity, origin or transport',()=>{
    for(const netflixId of ['1','bad','70000002','1234567890123'])assert.equal(parse(page(),{netflixId}),null);
    for(const bad of ['https://www.netflix.com/NotFound','https://www.netflix.com/title/70000002','https://evil.test/title/70000001','http://www.netflix.com/title/70000001','https://www.netflix.com:444/title/70000001','https://user@www.netflix.com/title/70000001'])assert.equal(parse(page(),{url:bad}),null);
  });
  it('rejects non-English, generic 200 errors, duplicate h1 and missing identity proof',()=>{
    for(const title of ['Netflix','Lost your way?','Sign in','Access denied','', 'x'.repeat(201),'&unknown;'])assert.equal(parse(page(ID,title)),null);
    assert.equal(parse(page(ID,'Example','zh-Hant')),null);
    assert.equal(parse(page().replace('</body>','<h1>Other</h1></body>')),null);
    assert.equal(parse(page().replace(/<meta[^>]+>/,'')),null);
    assert.equal(parse(page().replace('nflx://www.netflix.com/title/70000001','nflx://www.netflix.com/title/70000002')),null);
  });
  it('ignores executable/inert markup and never executes embedded script',()=>{
    const html=page().replace('<body>','<body><!-- <h1>Fake</h1> --><script>globalThis.__nslExecuted=true;<h1>Fake</h1></script><template><h1>Fake</h1></template><style><h1>Fake</h1></style>');
    assert.equal(parse(html).title,'Example & Story');assert.equal(globalThis.__nslExecuted,undefined);
    assert.equal(parse(html.replace('<h1>Example &amp; Story</h1>','')),null);
  });
  it('accepts canonical and Android public deep links, rejects arbitrary embedded URLs',()=>{
    for(const link of [`<link rel="canonical" href="${url}">`,`<link rel="alternate" href="android-app://com.netflix.mediaclient/http/www.netflix.com/title/${ID}">`])assert.ok(parse(page().replace(/<meta[^>]+>/,link)));
    assert.equal(parse(page().replace('nflx://','https://evil.test/?url=nflx://')),null);
  });
  it('safe UI provenance URLs reject cached cross-ID or unsafe links',()=>{
    assert.equal(netflixTitleUrl(parse(),ID),url);
    for(const bad of ['https://evil.test/','javascript:alert(1)','https://www.netflix.com/title/70000002','https://user@www.netflix.com/title/70000001'])assert.equal(netflixTitleUrl({...parse(),url:bad},ID),'');
  });
});

describe('createNetflixTitleClient',()=>{
  it('omits credentials, referrer and browser cache; requests English without a fixed region',async()=>{
    const calls=[];const client=createNetflixTitleClient({spacingMs:0,fetchImpl:async(...args)=>{calls.push(args);return response();}});
    assert.equal((await client.get(ID)).title,'Example & Story');
    const [request,init]=calls[0];assert.equal(request,`https://www.netflix.com/title/${ID}`);
    assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.cache,'no-store');assert.match(init.headers['Accept-Language'],/^en-US/);
  });
  it('rejects invalid IDs before network, 404, non-HTML and HTTP-200 error routes',async()=>{
    let calls=0;const client=createNetflixTitleClient({spacingMs:0,fetchImpl:async()=>{calls++;return response('',{status:404});}});
    assert.equal((await client.get('bad')).reason,'invalid_id');assert.equal(calls,0);
    assert.equal((await client.get(ID)).status,'unavailable');
    for(const options of [{headers:{'Content-Type':'application/json'}},{url:'https://www.netflix.com/NotFound'}])assert.equal((await createNetflixTitleClient({fetchImpl:async()=>response(page(),options)}).get(ID)).reason,'not_title_page');
  });
  it('bounds body size both with and without Content-Length',async()=>{
    const huge='x'.repeat(2*1024*1024+1);
    for(const r of [()=>response('',{headers:{'Content-Length':String(huge.length)}}),()=>response(huge)])assert.equal((await createNetflixTitleClient({fetchImpl:async()=>r()}).get(ID)).status,'error');
  });
  it('times out before headers and during response streaming',async()=>{
    const hang=(_,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));
    assert.equal((await createNetflixTitleClient({timeoutMs:15,fetchImpl:hang}).get(ID)).reason,'timeout');
    const bodyHang=async(_,{signal})=>response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(Error('aborted')));}}));
    assert.equal((await createNetflixTitleClient({timeoutMs:15,fetchImpl:bodyHang}).get(ID)).reason,'timeout');
  });
  it('backs off on 403/429 with bounded Retry-After seconds and dates, then recovers',async()=>{
    for(const [status,header,wait] of [[403,null,60000],[429,'120',120000],[429,'99999',3600000],[429,'garbage',60000],[429,new Date(180000).toUTCString(),180000]]) {
      let now=0,calls=0;const client=createNetflixTitleClient({spacingMs:0,now:()=>now,fetchImpl:async()=>{calls++;return calls===1?response('',{status,headers:header?{'Retry-After':header}:{}}):response();}});
      assert.equal((await client.get(ID)).reason,`http_${status}`);
      now=wait-1;assert.equal((await client.get(ID)).reason,'cooldown');assert.equal(calls,1);
      now=wait;assert.equal((await client.get(ID)).status,'ok');assert.equal(calls,2);
    }
  });
  it('limits concurrent requests to two, spaces starts and skips canceled queued work',async()=>{
    let active=0,peak=0,allowed=true;const starts=[];
    const client=createNetflixTitleClient({spacingMs:20,fetchImpl:async()=>{starts.push(Date.now());peak=Math.max(peak,++active);await sleep(50);active--;return response();}});
    const a=client.get(ID),b=client.get(ID),c=client.get(ID,{allowed:()=>allowed});
    await sleep(30);allowed=false;
    const results=await Promise.all([a,b,c]);assert.equal(results[2].reason,'canceled');assert.equal(peak,2);assert.equal(starts.length,2);assert.ok(starts[1]-starts[0]>=18);
  });
});
