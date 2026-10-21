// Synthetic public-metadata shapes only; never captures a personal Netflix cache.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../bridge.js',import.meta.url),'utf8');
const key=(kind,id)=>`${kind}:{"videoId":${id}}`;
const SHOW='99030001',EPISODE='99031001';
function run({data={},live={},videos={}}={},ids=[EPISODE]){
  let listener,result;
  const window={netflix:{reactContext:{models:{graphql:{data}},userInfo:{secret:'PRIVATE'}},appContext:{state:{graphqlClient:{cache:{data:{data:live}}}}},falcorCache:{videos}},
    addEventListener:(_name,fn)=>{listener=fn;},dispatchEvent:event=>{result=JSON.parse(event.detail);}};
  vm.runInNewContext(source,{window,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}}});
  listener({detail:JSON.stringify(ids)});return result;
}
const show={title:'Example Series',releaseYear:2018,videoId:Number(SHOW)};
const episode={title:'Pilot',releaseYear:2025,parentShow:{__ref:key('Show',SHOW)}};
test('episode resolves to the referenced show title, premiere year and stable identity',()=>{
  assert.deepEqual(run({data:{[key('Episode',EPISODE)]:episode,[key('Show',SHOW)]:show}}),{[EPISODE]:{netflixId:SHOW,title:'Example Series',year:2018,type:'series'}});
});
test('SPA live fields can complete an SSR show without discarding its missing fields',()=>{
  assert.deepEqual(run({data:{[key('Show',SHOW)]:show},live:{[key('Episode',EPISODE)]:episode,[key('Show',SHOW)]:{title:'Localized Series'}}}),{[EPISODE]:{netflixId:SHOW,title:'Localized Series',year:2018,type:'series'}});
});
test('one explicit season reference may link an episode to its show',()=>{
  const season='99032001';
  assert.equal(run({data:{[key('Episode',EPISODE)]:{parentSeason:{__ref:key('Season',season)}},[key('Season',season)]:{parentShow:{__ref:key('Show',SHOW)}},[key('Show',SHOW)]:show}})[EPISODE].netflixId,SHOW);
});
test('unresolved episodes never use their own title/year or an arbitrary ID as a series',()=>{
  for(const e of [{title:'Pilot',releaseYear:2025},{...episode,parentShow:{__ref:key('Movie',SHOW)}},{...episode,parentShow:{__ref:'userInfo'}},{title:'Pilot',showId:SHOW,seriesId:SHOW,show:{__ref:key('Show',SHOW)}}]){
    assert.deepEqual(run({data:{[key('Episode',EPISODE)]:e}}),{[EPISODE]:{type:'episode'}});
  }
  assert.deepEqual(run({data:{[key('Episode',EPISODE)]:episode,[key('Show',SHOW)]:{releaseYear:2018}}}),{[EPISODE]:{type:'episode'}});
});
test('contradictory show relationships stay unresolved',()=>{
  const other='99030002',season='99032001';
  assert.deepEqual(run({data:{[key('Episode',EPISODE)]:{...episode,parentSeason:{__ref:key('Season',season)}},[key('Season',season)]:{parentShow:{__ref:key('Show',other)}},[key('Show',SHOW)]:show,[key('Show',other)]:{title:'Other Series',releaseYear:2019}}}),{[EPISODE]:{type:'episode'}});
});
test('legacy Falcor episodes fail closed without an evidence-backed parent edge',()=>{
  const videos={[EPISODE]:{summary:{$type:'atom',value:{type:'episode',showId:Number(SHOW)}},title:{value:'Pilot'},releaseYear:{value:2025}},[SHOW]:{summary:{value:{type:'show'}},title:{value:'Example Series'},releaseYear:{value:2018}}};
  assert.deepEqual(run({videos}),{[EPISODE]:{type:'episode'}});
  assert.deepEqual(run({videos},[SHOW]),{[SHOW]:{title:'Example Series',year:2018,type:'series'}});
});
test('explicit live null parent does not resurrect the initial relationship',()=>{
  assert.deepEqual(run({data:{[key('Episode',EPISODE)]:episode,[key('Show',SHOW)]:show},live:{[key('Episode',EPISODE)]:{parentShow:null}}}),{[EPISODE]:{type:'episode'}});
});
test('ordinary metadata stays compatible and only explicitly requested safe fields leave the bridge',()=>{
  const data={[key('Show',SHOW)]:{releaseYear:2018,userInfo:'PRIVATE'},[key('Movie','99030002')]:{releaseYear:2020,title:'Other Title',secret:'PRIVATE'}};
  assert.deepEqual(run({data},[SHOW]),{[SHOW]:{year:2018,type:'series'}});
  assert.deepEqual(run({data},['__proto__','bad',SHOW]),{[SHOW]:{year:2018,type:'series'}});
  assert.deepEqual(run({data},Array(200).fill('bad').concat(SHOW)),{});
  assert.equal(JSON.stringify(run({data},[SHOW,'99030002'])).includes('PRIVATE'),false);
});
test('invalid parent title/year and mismatched entity identity cannot manufacture metadata',()=>{
  for(const title of ['',{},'x'.repeat(201),'bad\u0000title'])assert.deepEqual(run({data:{[key('Episode',EPISODE)]:episode,[key('Show',SHOW)]:{...show,title}}}),{[EPISODE]:{type:'episode'}});
  assert.equal(run({data:{[key('Episode',EPISODE)]:episode,[key('Show',SHOW)]:{...show,releaseYear:2026.5}}})[EPISODE].year,null);
  assert.deepEqual(run({data:{[key('Episode',EPISODE)]:episode,[key('Show',SHOW)]:{...show,videoId:99030002}}}),{[EPISODE]:{type:'episode'}});
});
