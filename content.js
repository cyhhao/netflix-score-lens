(() => {
  if(window.__scoreLensInstance){window.__scoreLensInstance.scan();return;}
  const SELECTOR='a[data-uia="standard-card"],a[href*="?jbv="],a[href*="&jbv="],a[href*="/title/"],.title-card a[href*="/watch/"]';
  const state={settings:null,records:new Map(),results:new Map(),pending:new Set(),failAt:new Map(),metadata:{},revisions:new Map(),epoch:0,url:location.href,ready:false};
  let core,i18n,scanTimer,activeLookups=0,host,panel,stats,btn,observer,intersection,heartbeat,version='',stopped=false;
  const instance={scan};
  const invalidated=error=>/Extension context invalidated/i.test(error?.message||'');
  function live(){
    if(stopped)return false;
    try{if(chrome.runtime?.id)return true;}catch(error){if(!invalidated(error))throw error;}
    stop(true);return false;
  }
  async function send(message){
    if(!live())throw Error('Extension context invalidated.');
    try{return await chrome.runtime.sendMessage(message);}
    catch(error){if(invalidated(error))stop(true);else live();throw error;}
  }
  function stop(notify=false){
    if(stopped)return;
    stopped=true;state.ready=false;state.epoch++;
    clearTimeout(scanTimer);clearInterval(heartbeat);scanTimer=null;
    observer?.disconnect();intersection?.disconnect();
    window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);
    window.removeEventListener('online',online);window.removeEventListener('nsl:metadata-response',metadataResponse);
    try{chrome.runtime.onMessage.removeListener(onMessage);}catch(error){if(!invalidated(error))console.warn('Score Lens:',error);}
    for(const [a]of state.records)removeDecoration(a);
    state.records.clear();state.pending.clear();state.results.clear();state.failAt.clear();state.revisions.clear();state.metadata={};
    host?.remove();
    if(window.__scoreLensInstance===instance)delete window.__scoreLensInstance;
    if(notify)showReloadNotice();
  }
  function showReloadNotice(){
    if(location.pathname.startsWith('/watch/')||document.getElementById('nsl-reload-notice'))return;
    const notice=document.createElement('div');notice.id='nsl-reload-notice';notice.setAttribute('role','status');
    notice.lang=i18n?.getLocale()||'en';
    notice.style.cssText='position:fixed;bottom:20px;right:20px;z-index:2147483000;max-width:380px;padding:14px;border:1px solid #49525d;border-radius:12px;background:#161b23;color:#eee;font:13px/1.6 system-ui;box-shadow:0 3px 16px #0006';
    const text=document.createElement('div');text.textContent=t('评分镜片连接已断开。若已重新加载扩展，请刷新页面。');notice.append(text);
    for(const [key,action]of [['刷新页面',()=>location.reload()],['忽略提示',()=>notice.remove()]]){
      const button=document.createElement('button');button.type='button';button.textContent=t(key);button.style.cssText='margin:8px 8px 0 0;padding:5px 10px;border:1px solid #69717c;border-radius:6px;background:#252d38;color:#fff;cursor:pointer;font:inherit';button.onclick=action;notice.append(button);
    }
    document.documentElement.append(notice);
  }
  function unexpected(error){
    if(invalidated(error)||!live()){stop(true);return;}
    stop();console.warn('Score Lens:',error);
  }
  const t=(key,params)=>i18n?.t(key,params)||String(key);
  const localizeMessage=value=>i18n?.localizeMessage(value)||value;
  const label=source=>t(core.LABELS[source]||source);
  const typeLabel=type=>t(type==='series'?'剧集':'电影');
  // Notification thumbnails are navigation, not browse cards. Their hidden
  // popover retains positive rectangles within the viewport; geometry is not visibility.
  const nonCard=el=>Boolean(el.closest('[data-uia^="navigation+notifications"]'));
  const hidden=el=>Boolean(el.closest('[hidden]'))||!el.getClientRects().length||getComputedStyle(el).visibility!=='visible';
  const near=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>-100&&r.top<innerHeight+220&&!hidden(el);};
  const nfId=a=>{try{const u=new URL(a.href);return u.searchParams.get('jbv')||u.pathname.match(/\/(?:title|watch)\/(\d+)/)?.[1]||'';}catch{return '';}};
  const statusLabels={pending:'查询中',ambiguous:'待确认',not_found:'未找到',error:'重试',no_rating:'暂无评分'};
  function itemFor(a){
    if(nonCard(a)||hidden(a))return null;
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
    if(stopped||!a.isConnected)return;
    if(!state.settings?.enabled||hidden(a)){removeDecoration(a);return;}
    const r=state.results.get(record.item.key),pending=state.pending.has(record.item.key);
    const signature=JSON.stringify([record.item.key,r,state.settings,pending]);
    if(a.dataset.nslRender===signature)return;
    a.dataset.nslRender=signature;
    const layer=createLayer(a),badge=layer.querySelector('.nsl-badges');layer.lang=i18n.getLocale();badge.replaceChildren();
    const ratings=r?.status==='ok'?Object.entries(r.ratings||{}).filter(([,x])=>Number.isFinite(x.value)):[];
    if(ratings.length){
      for(const [source,rating] of ratings){
        const chip=document.createElement('span');chip.className=`nsl-chip nsl-${source}`;
        chip.textContent=`${source==='metacritic'?'MC':source==='rt'?'RT':label(source)} ${core.formatRating({source,...rating})}`;
        badge.append(chip);
      }
    }else{
      const chip=document.createElement('span');chip.className='nsl-chip nsl-muted';chip.textContent=t(statusLabels[pending?'pending':r?.status]||'等候查询');badge.append(chip);
    }
    const score=core.ratingChoice(r,state.settings),low=core.isLow(r,state.settings);
    a.classList.toggle('nsl-low',low);a.classList.toggle('nsl-hover-reveal',state.settings.revealOnHover);
    a.style.setProperty('--nsl-dim',String(state.settings.dimOpacity));
    badge.setAttribute('aria-label',t('{title}：{badge}。点击查看匹配、来源及纠错方式',{title:record.item.title,badge:badge.textContent}));
    badge.title=[record.item.title,r?.netflixTitle?.title&&t('Netflix 英文展示名：{title}',{title:r.netflixTitle.title}),r?.title&&`${r.title} (${r.year||t('未知年份')})`,r?.matchReason&&localizeMessage(r.matchReason),low?t('低于 {score}{reveal}',{score:state.settings.minScore,reveal:state.settings.revealOnHover?t('，悬停可恢复亮度'):''}):!score&&r?.status==='ok'?t('所选评分源暂无数据，不会变暗'):t('点击评分查看来源；插件弹窗可纠错')].filter(Boolean).join('\n');
  }
  function summary(){
    const items=new Map();let visible=0;
    for(const [a,r] of state.records){if(!a.isConnected)continue;items.set(r.item.key,r.item);if(near(a))visible++;}
    const s={discovered:items.size,visible,matched:0,pending:0,ambiguous:0,unmatched:0,errors:0};
    for(const [key]of items){const r=state.results.get(key);if(state.pending.has(key))s.pending++;else if(r?.status==='ok')s.matched++;else if(r?.status==='ambiguous')s.ambiguous++;else if(r?.status==='error')s.errors++;else if(r)s.unmatched++;}
    return {summary:s,items:[...items.values()].map(item=>({item,result:state.results.get(item.key)||{status:state.pending.has(item.key)?'pending':'waiting',ratings:{}}})),url:location.href,version};
  }
  function updateStats(){if(stopped||!stats)return;const s=summary().summary;stats.textContent=!state.settings?.enabled?t('已暂停'):s.pending?t('{matched} 已匹配 · {pending} 查询中',{matched:s.matched,pending:s.pending}):`${t('{matched} 已匹配',{matched:s.matched})}${s.ambiguous?t(' · {ambiguous} 待确认',{ambiguous:s.ambiguous}):''}${s.errors?t(' · 请求失败'):''}`;}
  function localizeHud(){
    if(!host)return;
    host.lang=i18n.getLocale();panel.setAttribute('aria-label',t('评分详情'));
    btn.setAttribute('aria-label',t('打开评分镜片状态'));btn.querySelector('b').textContent=t('◈ 评分镜片 ');
  }
  function createHud(){
    document.getElementById('nsl-reload-notice')?.remove();
    host=document.createElement('div');host.id='nsl-root';const shadow=host.attachShadow({mode:'open'});
    const style=document.createElement('style');style.textContent=`:host{all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483000;font-family:system-ui;color:#eee}button{cursor:pointer;font:inherit}#toggle{border:1px solid #49525d;border-radius:20px;background:#161b23ed;color:#dfe7ef;padding:9px 13px;font-size:12px;box-shadow:0 3px 16px #0006}b{color:#f4ce79}#panel{width:320px;max-height:65vh;overflow:auto;background:#151a22;color:#eee;border:1px solid #48505e;border-radius:14px;padding:16px;box-shadow:0 10px 40px #0009;margin-bottom:8px;font-size:13px;line-height:1.6}#panel[hidden]{display:none}h3{margin:0 0 8px;font-size:16px}p{margin:6px 0;color:#b7c2d1}a{color:#f4ce79}#close{float:right;border:0;background:none;color:#aaa;font-size:18px}li{margin:6px 0}small{color:#9eabba}.muted{color:#91a1b4}`;
    panel=document.createElement('section');panel.id='panel';panel.hidden=true;panel.setAttribute('aria-label',t('评分详情'));
    btn=document.createElement('button');btn.id='toggle';btn.type='button';btn.setAttribute('aria-label',t('打开评分镜片状态'));
    const brand=document.createElement('b');brand.textContent=t('◈ 评分镜片 ');stats=document.createElement('span');btn.append(brand,stats);
    btn.onclick=()=>{if(!panel.hidden){panel.hidden=true;return;}showStatus();};
    shadow.append(style,panel,btn);document.documentElement.append(host);localizeHud();
    shadow.addEventListener('keydown',e=>{if(e.key==='Escape'){panel.hidden=true;btn.focus();}});
  }
  function basePanel(title){panel.replaceChildren();panel.hidden=false;const close=document.createElement('button');close.id='close';close.textContent='×';close.setAttribute('aria-label',t('关闭详情'));close.onclick=()=>{panel.hidden=true;btn.focus();};const h=document.createElement('h3');h.textContent=title;panel.append(close,h);}
  function p(text){const e=document.createElement('p');e.textContent=text;panel.append(e);}
  function showStatus(){if(!live())return;panel.dataset.view='status';delete panel.dataset.itemKey;const s=summary().summary;basePanel(t('评分镜片'));p(t('识别 {discovered} 部 · 匹配 {matched} 部 · 待确认 {ambiguous} 部',{discovered:s.discovered,matched:s.matched,ambiguous:s.ambiguous}));p(t('仅查询视口附近作品，滚动页面自动继续。点击卡片评分可看来源。'));p(t('打开工具栏「Netflix Score Lens」可调阈值、检查评分源、手动修正匹配。'));if(!s.discovered)p(t('未识别到卡片：请进入已登录的 Netflix 首页、电影、节目或搜索页。'));}
  function showDetail(item){
    if(!live())return;
    panel.dataset.view='detail';panel.dataset.itemKey=item.key;
    const r=state.results.get(item.key);basePanel(item.title);
    if(r?.netflixTitle?.title) {
      p(t('Netflix 英文展示名：{title}',{title:r.netflixTitle.title}));
      const url=core.netflixTitleUrl(r.netflixTitle,item.netflixId);
      if(url){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=t('Netflix 标题来源 ↗');panel.append(a);}
    }
    p(r?.title?`${r.title} · ${r.year||t('未知年份')} · ${typeLabel(r.type)}`:t(statusLabels[r?.status]||'等待查询'));
    if(r?.matchReason)p(localizeMessage(r.matchReason));if(r?.warning)p(localizeMessage(r.warning));
    if(r?.status==='error'){const retry=document.createElement('button');retry.textContent=t('重新查询');retry.onclick=()=>{state.failAt.delete(item.key);panel.hidden=true;schedule();};panel.append(retry);}
    for(const [source,rating]of Object.entries(r?.ratings||{})){
      let url;try{url=new URL(rating.url);}catch{continue;}if(!['www.imdb.com','www.tvmaze.com','www.rottentomatoes.com','www.metacritic.com'].includes(url.hostname)||url.protocol!=='https:')continue;
      const row=document.createElement('p'),a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=`${source==='metacritic'?'MC':source==='rt'?'RT':label(source)} ${core.formatRating({source,...rating})}`;row.append(a,document.createTextNode(` · ${t('来源')} ${rating.provider}`));panel.append(row);
    }
    if(r?.fetchedAt)p(t('查询时间：{date}',{date:i18n.formatDate(r.fetchedAt)}));
    p(t('IMDb 为 Cinemeta 镜像或 OMDb 汇总；TVmaze 是独立评分，不是 IMDb。'));
    p(t('匹配不对？打开插件弹窗 → 作品 → 点击该作品修正匹配。未确认和无评分作品不会变暗。'));
  }
  function scan(){
    if(!live()||!state.ready)return;
    state.url=location.href;
    for(const [a]of state.records)if(!a.isConnected||!a.matches(SELECTOR)||!itemFor(a)){removeDecoration(a);state.records.delete(a);intersection.unobserve(a);}
    if(location.pathname.startsWith('/watch/')){for(const [a]of state.records)removeDecoration(a);host.hidden=true;return;}host.hidden=false;
    const links=[...document.querySelectorAll(SELECTOR)].filter(a=>!nonCard(a)&&(a.querySelector('img')||a.matches('[data-uia=standard-card]')));
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
  function schedule(){if(!live())return;if(!scanTimer)scanTimer=setTimeout(()=>{scanTimer=null;scan();},180);}
  function missingResult(key){
    const r=state.results.get(key);
    const stale=r?.expiresAt?Date.now()>=r.expiresAt:r?.fetchedAt&&Date.now()-r.fetchedAt>(r.warning?300000:r.status==='ok'?7*86400000:600000);
    return (!r||stale||r.status==='error'||r.status==='disabled')&&!state.pending.has(key)&&Date.now()-(state.failAt.get(key)||0)>30000;
  }
  function drain(){
    if(!live()||!state.settings?.enabled||location.pathname.startsWith('/watch/'))return;
    const wanted=new Map();for(const[a,r]of state.records)if(missingResult(r.item.key)&&near(a))wanted.set(r.item.key,r.item);
    for(const item of [...wanted.values()].slice(0,Math.max(0,6-activeLookups))){
      activeLookups++;
      const epoch=state.epoch,revision=state.revisions.get(item.key)||0;
      state.pending.add(item.key);for(const[a,r]of state.records)if(r.item.key===item.key)render(a,r);updateStats();
      (async()=>{
        let result;
        try{const response=await send({type:'LOOKUP',item,force:state.results.get(item.key)?.status==='error'});if(!response.ok)throw Error(response.error);result=response.result;}
        catch(error){if(invalidated(error)||!live()){stop(true);return;}result={status:'error',ratings:{},warning:'扩展连接已断开，请刷新 Netflix 标签页'};}
        if(!live()||epoch!==state.epoch||revision!==(state.revisions.get(item.key)||0))return;
        state.pending.delete(item.key);
        const stillCurrent=[...state.records].some(([a,r])=>a.isConnected&&JSON.stringify(r.item)===JSON.stringify(item));
        if(!stillCurrent||result.status==='disabled')return;
        if(result.status==='error')state.failAt.set(item.key,Date.now());
        state.results.set(item.key,result);
        for(const[a,r]of state.records)if(r.item.key===item.key)render(a,r);
        updateStats();
      })().finally(()=>{activeLookups--;schedule();}).catch(unexpected);
    }
  }
  function reset(key){
    if(key){state.revisions.set(key,(state.revisions.get(key)||0)+1);state.pending.delete(key);state.results.delete(key);state.failAt.delete(key);}
    else{state.epoch++;state.revisions.clear();state.pending.clear();state.results.clear();state.failAt.clear();}
    for(const[a,r]of state.records)if(!key||r.item.key===key)delete a.dataset.nslRender;schedule();
  }
  function onMessage(m,_s,reply){
    if(!live()||!state.ready)return false;
    if(m.type==='GET_PAGE'){reply({ok:true,...summary()});return false;}
    if(m.type==='CONFIG'){
      const wasEnabled=state.settings?.enabled;
      state.settings=core.cleanSettings({...state.settings,...m.settings});
      i18n.setLanguage(state.settings.language);localizeHud();
      if(wasEnabled&&!state.settings.enabled){state.epoch++;state.pending.clear();}
      for(const[a,r]of state.records)render(a,r);updateStats();
      if(!panel.hidden){const key=panel.dataset.itemKey,item=key&&[...state.records.values()].map(r=>r.item).find(x=>x.key===key);if(item)showDetail(item);else showStatus();}
      schedule();reply({ok:true});return false;
    }
    if(['RESCAN','RESET'].includes(m.type)){reset(m.type==='RESET'?m.key:undefined);reply({ok:true});return false;}
    return false;
  }
  function online(){if(!live())return;for(const[key,r]of state.results)if(r.status==='error')state.failAt.delete(key);schedule();}
  function metadataResponse(e){if(!live())return;try{const data=JSON.parse(e.detail);let changed=false;for(const[id,v]of Object.entries(data))if(/^\d{4,12}$/.test(id)&&v&&['movie','series'].includes(v.type)){const next={year:Number.isInteger(v.year)&&v.year>=1880&&v.year<=2100?v.year:null,type:v.type};if(JSON.stringify(state.metadata[id])!==JSON.stringify(next)){state.metadata[id]=next;changed=true;}}if(changed)schedule();}catch{}}
  (async()=>{
    if(!live())return;
    const base=chrome.runtime.getURL('');version=chrome.runtime.getManifest().version;
    i18n=await import(`${base}i18n.js`);
    await import(`${base}i18n-content.js`);
    core=await import(`${base}core.js`);
    if(!live())return;
    const r=await send({type:'GET_CONFIG'});if(!live())return;if(!r?.ok)throw Error(t('配置读取失败'));state.settings=core.cleanSettings(r.settings);i18n.setLanguage(state.settings.language);
    chrome.runtime.onMessage.addListener(onMessage);window.addEventListener('nsl:metadata-response',metadataResponse);
    createHud();intersection=new IntersectionObserver(schedule,{rootMargin:'220px 0px'});
    observer=new MutationObserver(records=>{if(records.some(r=>{const e=r.target.nodeType===1?r.target:r.target.parentElement;return !e?.closest('.nsl-layer,#nsl-root') && !(r.type==='childList'&&[...r.addedNodes,...r.removedNodes].every(n=>n.nodeType===1&&n.matches?.('.nsl-layer,#nsl-root')));} ))schedule();});
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href','aria-label','title','alt','src','hidden']});
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});window.addEventListener('online',online);heartbeat=setInterval(schedule,3000);
    state.ready=true;window.__scoreLensInstance=instance;scan();
  })().catch(unexpected);
})();
