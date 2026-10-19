// MAIN world adapter: return ONLY public movie metadata for supplied visible IDs.
// Never expose reactContext userInfo, cookies, auth URLs or full graphql state.
(() => {
  if(window.__scoreLensMetadataBridge)return;
  window.__scoreLensMetadataBridge=true;
  window.addEventListener('nsl:metadata-request',event=>{
    let ids;
    try{ids=JSON.parse(event.detail);}catch{return;}
    if(!Array.isArray(ids))return;
    const data=window.netflix?.reactContext?.models?.graphql?.data||{};
    // SPA navigation/scroll writes new titles to Apollo, not initial SSR state.
    // Read only the requested public entity; never extract/export the cache.
    const live=window.netflix?.appContext?.state?.graphqlClient?.cache?.data?.data||{};
    const videos=window.netflix?.falcorCache?.videos||{};
    const out={};
    for(const raw of ids.slice(0,200)){
      const id=String(raw);if(!/^\d{4,12}$/.test(id))continue;
      for(const [kind,type] of [['Show','series'],['Movie','movie']]){
        const key=`${kind}:{"videoId":${id}}`,entity=live[key]||data[key];
        if(entity){out[id]={year:Number(live[key]?.releaseYear??data[key]?.releaseYear)||null,type};break;}
      }
      if(!out[id]&&videos[id]){
        const v=videos[id],s=v.summary?.value||v.summary||{};
        out[id]={year:Number(v.releaseYear?.value||v.releaseYear)||null,type:s.type==='show'?'series':s.type==='movie'?'movie':undefined};
      }
    }
    window.dispatchEvent(new CustomEvent('nsl:metadata-response',{detail:JSON.stringify(out)}));
  });
})();
