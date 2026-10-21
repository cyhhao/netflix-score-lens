// MAIN world adapter: only requested public title/identity/year/type metadata.
// Never expose userInfo, cookies, auth URLs, or enumerate/export application caches.
(() => {
  if(window.__scoreLensMetadataBridge)return;
  window.__scoreLensMetadataBridge=true;
  const validId=value=>typeof value==='string'||typeof value==='number'?(/^\d{4,12}$/.test(String(value))?String(value):''):'';
  const scalar=value=>value&&typeof value==='object'&&Object.hasOwn(value,'value')?value.value:value;
  const title=value=>typeof value==='string'&&value.trim()&&value.trim().length<=200&&!/[\x00-\x1f]/.test(value)?value.trim():'';
  const year=value=>Number.isInteger(Number(value))&&Number(value)>=1880&&Number(value)<=2100?Number(value):null;
  const refId=(value,kind)=>typeof value?.__ref==='string'?value.__ref.match(new RegExp(`^${kind}:\\{"videoId":(\\d{4,12})\\}$`))?.[1]||'':'';
  window.addEventListener('nsl:metadata-request',event=>{
    let ids;
    try{ids=JSON.parse(event.detail);}catch{return;}
    if(!Array.isArray(ids))return;
    const data=window.netflix?.reactContext?.models?.graphql?.data||{};
    const live=window.netflix?.appContext?.state?.graphqlClient?.cache?.data?.data||{};
    const videos=window.netflix?.falcorCache?.videos||{};
    function entity(kind,id){
      const key=`${kind}:{"videoId":${id}}`,current=live[key],initial=data[key];
      if(!current&&!initial)return null;
      // Field-level fallback handles partial Apollo hydration without copying a cache entity.
      const get=name=>current&&Object.hasOwn(current,name)?current[name]:initial?.[name];
      if(get('videoId')!=null&&validId(get('videoId'))!==id)return null;
      return get;
    }
    function showMetadata(id){
      const get=entity('Show',id);
      if(get){const name=title(get('title'));return name?{netflixId:id,title:name,year:year(get('releaseYear')),type:'series'}:null;}
      const v=videos[id],summary=scalar(v?.summary)||{};
      const name=title(scalar(v?.title));
      return summary.type==='show'&&name?{netflixId:id,title:name,year:year(scalar(v.releaseYear)),type:'series'}:null;
    }
    // Netflix's public GraphQL fragments use parentShow / parentSeason.
    // Follow only these typed edges (at most one season), never scan the cache
    // or infer a parent from an episode's title, year, rank or numeric proximity.
    function episodeMetadata(id,get){
      const direct=refId(get('parentShow'),'Show'),seasonId=refId(get('parentSeason'),'Season');
      const season=seasonId&&entity('Season',seasonId);
      const throughSeason=season?refId(season('parentShow'),'Show'):'';
      const parents=[...new Set([direct,throughSeason].filter(Boolean))];
      return parents.length===1&&parents[0]!==id?showMetadata(parents[0]):null;
    }
    const out={};
    for(const raw of ids.slice(0,200)){
      const id=validId(raw);if(!id)continue;
      const episode=entity('Episode',id);
      if(episode){out[id]=episodeMetadata(id,episode)||{type:'episode'};continue;}
      for(const [kind,type] of [['Show','series'],['Movie','movie']]){
        const get=entity(kind,id);if(!get)continue;
        out[id]={year:year(get('releaseYear')),type};
        const name=title(get('title'));if(name)out[id].title=name;
        break;
      }
      if(!out[id]&&videos[id]){
        const v=videos[id],s=scalar(v.summary)||{};
        // No verified legacy episode -> show edge: fail closed, not a guessed ID.
        if(s.type==='episode'){out[id]={type:'episode'};continue;}
        const type=s.type==='show'?'series':s.type==='movie'?'movie':null;
        if(type){out[id]={year:year(scalar(v.releaseYear)),type};const name=title(scalar(v.title));if(name)out[id].title=name;}
      }
    }
    window.dispatchEvent(new CustomEvent('nsl:metadata-response',{detail:JSON.stringify(out)}));
  });
})();
