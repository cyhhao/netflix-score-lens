(() => {
  if(window.__scoreLensInstance){window.__scoreLensInstance.scan();return;}
  const SELECTOR='a[data-uia="standard-card"],a[href*="?jbv="],a[href*="&jbv="],a[href*="/title/"],.title-card a[href*="/watch/"]';
  const state={settings:null,records:new Map(),results:new Map(),pending:new Set(),failAt:new Map(),metadata:{},revisions:new Map(),epoch:0,url:location.href,ready:false};
  let core,scanTimer,activeLookups=0,host,panel,stats,btn,observer,intersection,heartbeat;
  const send=m=>chrome.runtime.sendMessage(m);
  const near=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>-100&&r.top<innerHeight+220;};
  const nfId=a=>{try{const u=new URL(a.href);return u.searchParams.get('jbv')||u.pathname.match(/\/(?:title|watch)\/(\d+)/)?.[1]||'';}catch{return '';}};
  const statusLabels={pending:'查询中',ambiguous:'待确认',not_found:'未找到',error:'重试',no_rating:'暂无评分'};
  function itemFor(a){
    const title=(a.getAttribute('aria-label')||a.getAttribute('title')||a.querySelector('img')?.alt||a.querySelector('.fallback-text')?.textContent||'').trim();
    if(!title)return null;
    const id=nfId(a),m=state.metadata[id]||{};
    try{return core.validItem({title,netflixId:id,...m});}catch{return null;}
  }
  function removeDecoration(a){
    a.classList.remove('nsl-card','nsl-low','nsl-hover-reveal');
    a.querySelector(':scope > .nsl-layer')?.remove();
    if(a.dataset.nslPosition){a.style.position=a.dataset.nslOriginalPosition||'';delete a.dataset.nslPosition;delete a.dataset.nslOriginalPosition;}
    a.style.removeProperty('--nsl-dim');delete a.dataset.nslRender;
  }
  function createLayer(a){
    let layer=a.querySelector(':scope > .nsl-layer');if(layer)return layer;
    if(getComputedStyle(a).position==='static'){a.dataset.nslPosition='1';a.dataset.nslOriginalPosition=a.style.position;a.style.position='relative';}
    a.classList.add('nsl-card');
    layer=document.createElement('span');layer.className='nsl-layer';
    const dim=document.createElement('span');dim.className='nsl-shade';dim.setAttribute('aria-hidden','true');
    const badge=document.createElement('span');badge.className='nsl-badges';badge.setAttribute('role','button');badge.tabIndex=0;
    const open=e=>{e.preventDefault();e.stopPropagation();const record=state.records.get(a);if(record)showDetail(record.item);};
    badge.addEventListener('click',open);badge.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key))open(e);});
    badge.addEventListener('mouseenter',e=>e.stopPropagation());
    layer.append(dim,badge);a.append(layer);return layer;
  }
  function render(a,record){
    if(!a.isConnected)return;
    if(!state.settings?.enabled){removeDecoration(a);return;}
    const r=state.results.get(record.item.key),pending=state.pending.has(record.item.key);
    const signature=JSON.stringify([record.item.key,r,state.settings,pending]);
    if(a.dataset.nslRender===signature)return;
    a.dataset.nslRender=signature;
    const layer=createLayer(a),badge=layer.querySelector('.nsl-badges');badge.replaceChildren();
    const ratings=r?.status==='ok'?Object.entries(r.ratings||{}).filter(([,x])=>Number.isFinite(x.value)):[];
    if(ratings.length){
      for(const [source,rating] of ratings){
        const chip=document.createElement('span');chip.className=`nsl-chip nsl-${source}`;
        chip.textContent=`${source==='metacritic'?'MC':source==='rt'?'RT':core.LABELS[source]} ${core.formatRating({source,...rating})}`;
        badge.append(chip);
      }
    }else{
      const chip=document.createElement('span');chip.className='nsl-chip nsl-muted';chip.textContent=statusLabels[pending?'pending':r?.status]||'等候查询';badge.append(chip);
    }
    const score=core.ratingChoice(r,state.settings),low=core.isLow(r,state.settings);
    a.classList.toggle('nsl-low',low);a.classList.toggle('nsl-hover-reveal',state.settings.revealOnHover);
    a.style.setProperty('--nsl-dim',String(state.settings.dimOpacity));
    badge.setAttribute('aria-label',`${record.item.title}：${badge.textContent}。点击查看匹配、来源及纠错方式`);
    badge.title=[record.item.title,r?.title&&`${r.title} (${r.year||'年份未知'})`,r?.matchReason,low?`低于 ${state.settings.minScore}${state.settings.revealOnHover?'，悬停可恢复亮度':''}`:!score&&r?.status==='ok'?'所选评分源暂无数据，不会变暗':'','点击评分查看来源；插件弹窗可纠错'].filter(Boolean).join('\n');
  }
  function summary(){
    const items=new Map();let visible=0;
    for(const [a,r] of state.records){if(!a.isConnected)continue;items.set(r.item.key,r.item);if(near(a))visible++;}
    const s={discovered:items.size,visible,matched:0,pending:0,ambiguous:0,unmatched:0,errors:0};
    for(const [key]of items){const r=state.results.get(key);if(state.pending.has(key))s.pending++;else if(r?.status==='ok')s.matched++;else if(r?.status==='ambiguous')s.ambiguous++;else if(r?.status==='error')s.errors++;else if(r)s.unmatched++;}
    return {summary:s,items:[...items.values()].map(item=>({item,result:state.results.get(item.key)||{status:state.pending.has(item.key)?'pending':'waiting',ratings:{}}})),url:location.href,version:chrome.runtime.getManifest().version};
  }
  function updateStats(){if(!stats)return;const s=summary().summary;stats.textContent=!state.settings?.enabled?'已暂停':s.pending?`${s.matched} 已匹配 · ${s.pending} 查询中`:`${s.matched} 已匹配${s.ambiguous?' · '+s.ambiguous+' 待确认':''}${s.errors?' · 请求失败':''}`;}
  function createHud(){
    host=document.createElement('div');host.id='nsl-root';const shadow=host.attachShadow({mode:'open'});
    const style=document.createElement('style');style.textContent=`:host{all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483000;font-family:system-ui;color:#eee}button{cursor:pointer;font:inherit}#toggle{border:1px solid #49525d;border-radius:20px;background:#161b23ed;color:#dfe7ef;padding:9px 13px;font-size:12px;box-shadow:0 3px 16px #0006}b{color:#f4ce79}#panel{width:320px;max-height:65vh;overflow:auto;background:#151a22;color:#eee;border:1px solid #48505e;border-radius:14px;padding:16px;box-shadow:0 10px 40px #0009;margin-bottom:8px;font-size:13px;line-height:1.6}#panel[hidden]{display:none}h3{margin:0 0 8px;font-size:16px}p{margin:6px 0;color:#b7c2d1}a{color:#f4ce79}#close{float:right;border:0;background:none;color:#aaa;font-size:18px}li{margin:6px 0}small{color:#9eabba}.muted{color:#91a1b4}`;
    panel=document.createElement('section');panel.id='panel';panel.hidden=true;panel.setAttribute('aria-label','评分详情');
    btn=document.createElement('button');btn.id='toggle';btn.type='button';btn.setAttribute('aria-label','打开评分镜片状态');
    const brand=document.createElement('b');brand.textContent='◈ 评分镜片 ';stats=document.createElement('span');btn.append(brand,stats);
    btn.onclick=()=>{if(!panel.hidden){panel.hidden=true;return;}showStatus();};
    shadow.append(style,panel,btn);document.documentElement.append(host);
    shadow.addEventListener('keydown',e=>{if(e.key==='Escape'){panel.hidden=true;btn.focus();}});
  }
  function basePanel(title){panel.replaceChildren();panel.hidden=false;const close=document.createElement('button');close.id='close';close.textContent='×';close.setAttribute('aria-label','关闭详情');close.onclick=()=>{panel.hidden=true;btn.focus();};const h=document.createElement('h3');h.textContent=title;panel.append(close,h);}
  function p(text){const e=document.createElement('p');e.textContent=text;panel.append(e);}
  function showStatus(){const s=summary().summary;basePanel('评分镜片');p(`识别 ${s.discovered} 部 · 匹配 ${s.matched} 部 · 待确认 ${s.ambiguous} 部`);p('仅查询视口附近作品，滚动页面自动继续。点击卡片评分可看来源。');p('打开工具栏「Netflix Score Lens」可调阈值、检查评分源、手动修正匹配。');if(!s.discovered)p('未识别到卡片：请进入已登录的 Netflix 首页、电影、节目或搜索页。');}
  function showDetail(item){const r=state.results.get(item.key);basePanel(item.title);p(r?.title?`${r.title} · ${r.year||'未知年份'} · ${r.type==='series'?'剧集':'电影'}`:statusLabels[r?.status]||'等待查询');if(r?.matchReason)p(r.matchReason);if(r?.warning)p(r.warning);if(r?.status==='error'){const retry=document.createElement('button');retry.textContent='重新查询';retry.onclick=()=>{state.failAt.delete(item.key);panel.hidden=true;schedule();};panel.append(retry);}for(const [source,rating]of Object.entries(r?.ratings||{})){
    let url;try{url=new URL(rating.url);}catch{continue;}if(!['www.imdb.com','www.tvmaze.com','www.rottentomatoes.com','www.metacritic.com'].includes(url.hostname)||url.protocol!=='https:')continue;
    const row=document.createElement('p'),a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=`${core.LABELS[source]} ${core.formatRating({source,...rating})}`;row.append(a,document.createTextNode(` · 来源 ${rating.provider}`));panel.append(row);
  }if(r?.fetchedAt)p(`查询时间：${new Date(r.fetchedAt).toLocaleString()}`);p('IMDb 为 Cinemeta 镜像或 OMDb 汇总；TVmaze 是独立评分，不是 IMDb。');p('匹配不对？打开插件弹窗 → 作品 → 点击该作品修正匹配。未确认和无评分作品不会变暗。');}
  function scan(){
    if(!state.ready)return;
    state.url=location.href;
    for(const [a]of state.records)if(!a.isConnected||!a.matches(SELECTOR)||!itemFor(a)){removeDecoration(a);state.records.delete(a);intersection.unobserve(a);}
    if(location.pathname.startsWith('/watch/')){for(const [a]of state.records)removeDecoration(a);host.hidden=true;return;}host.hidden=false;
    const links=[...document.querySelectorAll(SELECTOR)].filter(a=>a.querySelector('img')||a.matches('[data-uia=standard-card]'));
    const metadataIds=[...new Set(links.filter(near).map(nfId).filter(id=>id&&!state.metadata[id]?.year))];
    for(let i=0;i<metadataIds.length;i+=200)window.dispatchEvent(new CustomEvent('nsl:metadata-request',{detail:JSON.stringify(metadataIds.slice(i,i+200))}));
    for(const a of links){
      const item=itemFor(a);if(!item)continue;
      let record=state.records.get(a);
      if(!record||JSON.stringify(record.item)!==JSON.stringify(item)){
      if(record){
        const previousKey=record.item.key;
        removeDecoration(a);
        if(previousKey===item.key){
          state.revisions.set(item.key,(state.revisions.get(item.key)||0)+1);
          state.pending.delete(item.key);
          state.results.delete(item.key);
          state.failAt.delete(item.key);
        }
      }
        record={item};state.records.set(a,record);intersection.observe(a);
      }
      if(near(a)||a.querySelector(':scope > .nsl-layer'))render(a,record);
    }
    updateStats();drain();
  }
  function schedule(){if(!scanTimer)scanTimer=setTimeout(()=>{scanTimer=null;scan();},180);}
  function missingResult(key){
    const r=state.results.get(key);
    const stale=r?.fetchedAt&&Date.now()-r.fetchedAt>(r.warning?300000:r.status==='ok'?7*86400000:600000);
    return (!r||stale||r.status==='error'||r.status==='disabled')&&!state.pending.has(key)&&Date.now()-(state.failAt.get(key)||0)>30000;
  }
  function drain(){
    if(!state.settings?.enabled||location.pathname.startsWith('/watch/'))return;
    const wanted=new Map();for(const[a,r]of state.records)if(missingResult(r.item.key)&&near(a))wanted.set(r.item.key,r.item);
    for(const item of [...wanted.values()].slice(0,Math.max(0,6-activeLookups))){
      activeLookups++;
      const epoch=state.epoch,revision=state.revisions.get(item.key)||0;
      state.pending.add(item.key);for(const[a,r]of state.records)if(r.item.key===item.key)render(a,r);updateStats();
      (async()=>{
        let result;
        try{const response=await send({type:'LOOKUP',item,force:state.results.get(item.key)?.status==='error'});if(!response.ok)throw Error(response.error);result=response.result;}
        catch{result={status:'error',ratings:{},warning:'扩展连接已断开，请刷新 Netflix 标签页'};}
        if(epoch!==state.epoch||revision!==(state.revisions.get(item.key)||0))return;
        state.pending.delete(item.key);
        const stillCurrent=[...state.records].some(([a,r])=>a.isConnected&&JSON.stringify(r.item)===JSON.stringify(item));
        if(!stillCurrent||result.status==='disabled')return;
        if(result.status==='error')state.failAt.set(item.key,Date.now());
        state.results.set(item.key,result);
        for(const[a,r]of state.records)if(r.item.key===item.key)render(a,r);
        updateStats();
      })().finally(()=>{activeLookups--;schedule();});
    }
  }
  function reset(key){
    if(key){state.revisions.set(key,(state.revisions.get(key)||0)+1);state.pending.delete(key);state.results.delete(key);state.failAt.delete(key);}
    else{state.epoch++;state.revisions.clear();state.pending.clear();state.results.clear();state.failAt.clear();}
    for(const[a,r]of state.records)if(!key||r.item.key===key)delete a.dataset.nslRender;schedule();
  }
  chrome.runtime.onMessage.addListener((m,_s,reply)=>{
    if(m.type==='GET_PAGE'){reply({ok:true,...summary()});return false;}
    if(m.type==='CONFIG'){const wasEnabled=state.settings?.enabled;state.settings=core.cleanSettings({...state.settings,...m.settings});if(wasEnabled&&!state.settings.enabled){state.epoch++;state.pending.clear();}for(const[a,r]of state.records)render(a,r);updateStats();schedule();reply({ok:true});return false;}
    if(['RESCAN','RESET'].includes(m.type)){reset(m.type==='RESET'?m.key:undefined);reply({ok:true});return false;}
    return false;
  });
  window.addEventListener('nsl:metadata-response',e=>{try{const data=JSON.parse(e.detail);let changed=false;for(const[id,v]of Object.entries(data))if(/^\d{4,12}$/.test(id)&&v&&['movie','series'].includes(v.type)){const next={year:Number.isInteger(v.year)&&v.year>=1880&&v.year<=2100?v.year:null,type:v.type};if(JSON.stringify(state.metadata[id])!==JSON.stringify(next)){state.metadata[id]=next;changed=true;}}if(changed)schedule();}catch{}});
  (async()=>{
    core=await import(chrome.runtime.getURL('core.js'));
    const r=await send({type:'GET_CONFIG'});if(!r.ok)throw Error('配置读取失败');state.settings=r.settings;
    createHud();intersection=new IntersectionObserver(schedule,{rootMargin:'220px 0px'});
    observer=new MutationObserver(records=>{if(records.some(r=>{const e=r.target.nodeType===1?r.target:r.target.parentElement;return !e?.closest('.nsl-layer,#nsl-root') && !(r.type==='childList'&&[...r.addedNodes,...r.removedNodes].every(n=>n.nodeType===1&&n.matches?.('.nsl-layer,#nsl-root')));} ))schedule();});
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href','aria-label','title','alt','src']});
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});window.addEventListener('online',()=>{for(const[key,r]of state.results)if(r.status==='error')state.failAt.delete(key);schedule();});heartbeat=setInterval(schedule,3000);
    state.ready=true;scan();window.__scoreLensInstance={scan};
  })().catch(()=>{console.warn('Score Lens: 请在扩展管理页重新加载插件，再刷新 Netflix。');});
})();
