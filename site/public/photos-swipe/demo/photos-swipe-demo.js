(function () {
'use strict';
function stillClonedVideos(copy,source){
 const originals=[...(source.querySelectorAll?.('video')||[])];
 [...(copy.querySelectorAll?.('video')||[])].forEach((clone,index)=>{
  clone.removeAttribute?.('src');clone.preload='none';
  for(const child of [...(clone.querySelectorAll?.('source')||[])])child.remove?.();
  const original=originals[index];
  if(!original||original.hidden||original.style?.opacity==='0'){clone.remove?.();return;}
  const width=original.clientWidth,height=original.clientHeight,document=clone.ownerDocument;
  if(!original.videoWidth||original.readyState<2||!width||!height||!document?.createElement)return;
  try{
   const canvas=document.createElement('canvas'),ratio=globalThis.devicePixelRatio||1;
   canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
   const scale=Math.min(canvas.width/original.videoWidth,canvas.height/original.videoHeight),drawnWidth=original.videoWidth*scale,drawnHeight=original.videoHeight*scale;
   canvas.getContext('2d').drawImage(original,(canvas.width-drawnWidth)/2,(canvas.height-drawnHeight)/2,drawnWidth,drawnHeight);
   canvas.className=clone.className;canvas.style.cssText=clone.style.cssText;canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
   clone.replaceWith?.(canvas);
  }catch{}
 });
 return copy;
}

const emptyReview = () => ({revision:0,history:[],items:[],cursor:null,started:false,exhausted:false,albumKey:null,job:null});
const reviewDeck = state => state.items.filter(item=>!item.decision&&!item.needsPreview&&item.state!=='in_trash');
const reviewQueue = state => state.items.filter(item=>item.decision==='remove'&&!item.needsPreview&&!item.queueSent&&item.state!=='in_trash');
const reviewTrashCandidates = state => state.items.filter(item=>item.decision==='remove'&&!item.needsPreview&&item.state!=='in_trash');
const captureFormats=new Map();
function captureFormat(options){
 const key=JSON.stringify(options||null);let format=captureFormats.get(key);
 if(!format){format=new Intl.DateTimeFormat(undefined,Object.keys(options||{}).some(name=>['weekday','era','year','month','day'].includes(name))?options:{year:'numeric',month:'numeric',day:'numeric',...options});captureFormats.set(key,format);}
 return format;
}
function captureDate(item,options) {
 const time=Date.parse(item?.date);
 if(!Number.isFinite(time))return null;
 return Number.isFinite(item.timezoneOffset)?captureFormat({...options,timeZone:'UTC'}).format(time+item.timezoneOffset):captureFormat(options).format(time);
}
function reviewStorage(items) {
 return items.reduce((total,item)=>{
  const bytes=item.takesUpSpace===false?0:item.spaceTaken??item.size;
  if(Number.isFinite(bytes)&&bytes>=0)total.bytes+=bytes;else total.unknown++;
  return total;
 },{bytes:0,unknown:0});
}
function mergeReviewPage(state,page,requestCursor,refresh=false) {
 if(!refresh&&state.cursor!==requestCursor)throw Error('Library progress changed. Retry Load more.');
 if(page.nextPageId&&page.nextPageId===requestCursor)throw Error('Google repeated a page. Reload before retrying.');
 const items=new Map(state.items.map(item=>[item.mediaKey,item]));
 for(const item of page.items){const old=items.get(item.mediaKey);items.set(item.mediaKey,{...old,...item,urlFetchedAt:Date.now(),decision:old?.decision??null,queueSent:old?.queueSent??false,albumKey:old?.albumKey??null,state:'active',needsPreview:false,revision:(old?.revision||0)+(old&&old.state!=='active'?1:0)});}
 const progress=!refresh||!state.started?{cursor:page.nextPageId,exhausted:!page.nextPageId,started:true}:{};
 return {...state,...progress,items:[...items.values()]};
}
function canUndoReview(state,entry) {
 const item=state.items.find(item=>item.mediaKey===entry.key);
 return !!item&&item.state!=='in_trash'&&item.decision===entry.decision&&(item.revision||0)===entry.revision&&!state.job?.mediaKeys.includes(entry.key);
}
function decideReview(state,key,decision,expected,expectedRevision) {
 if(![null,'keep','remove'].includes(decision))throw Error('Invalid decision.');
 if(state.job?.mediaKeys.includes(key))throw Error('Finish the saved album operation before changing this item.');
 const item=state.items.find(item=>item.mediaKey===key);
 if(!item||item.state==='in_trash'||item.decision!==expected||(expectedRevision!==undefined&&(item.revision||0)!==expectedRevision))throw Error('This item changed. Refresh and try again.');
 return {...state,items:state.items.map(item=>item.mediaKey===key?{...item,decision,queueSent:false,revision:(item.revision||0)+1}:item)};
}
const albumMatches = (members,item) => members.keys.includes(item.mediaKey)||!!item.dedupKey&&members.dedupKeys.includes(item.dedupKey);
function finishReviewAlbum(state,members) {
 if(!state.job||!state.job.albumKey)throw Error('No saved album operation.');
 const keys=new Set(state.job.mediaKeys);
 const items=state.items.filter(item=>keys.has(item.mediaKey));
 if(items.length!==keys.size||items.some(item=>!albumMatches(members,item)))throw Error('Not every candidate was verified. Retry the saved album operation.');
 return {...state,albumKey:state.job.albumKey,albumTitle:state.job.albumTitle===undefined?state.job.title:state.job.albumTitle,job:null,items:state.items.map(item=>keys.has(item.mediaKey)?{...item,queueSent:true,albumKey:state.job.albumKey,revision:(item.revision||0)+1}:item)};
}
async function sendReviewAlbum({read,save,call,title}) {
 let state=await read();
 if(!state.job){const mediaKeys=reviewQueue(state).map(item=>item.mediaKey);if(!mediaKeys.length)throw Error('Nothing is marked for Trash.');state=await save({...state,job:{title,mediaKeys,albumKey:state.albumKey,albumTitle:state.albumKey?state.albumTitle||null:title}});}
 let members;
 if(state.job.albumKey){
  try{members=await call('albumMembers',{albumKey:state.job.albumKey});}catch(error){
   const found=await call('findAlbum',{title:state.job.title});
   const albumTitle=state.job.albumTitle===undefined?state.job.title:state.job.albumTitle;
   if(found.albumKey||albumTitle!==state.job.title)throw error;
   const albumKey=(await call('createAlbum',{title:state.job.title})).albumKey;
   state=await save({...state,job:{...state.job,albumKey,albumTitle:state.job.title}});
  }
 }
 if(!state.job.albumKey){const found=await call('findAlbum',{title:state.job.title});const albumKey=found.albumKey||(await call('createAlbum',{title:state.job.title})).albumKey;state=await save({...state,job:{...state.job,albumKey,albumTitle:state.job.title}});}
 const albumKey=state.job.albumKey;
 members ||= await call('albumMembers',{albumKey});
 const candidates=state.items.filter(item=>state.job.mediaKeys.includes(item.mediaKey));
 const missing=candidates.filter(item=>!albumMatches(members,item));
 for(let index=0;index<missing.length;index+=25){
  const batch=missing.slice(index,index+25);let writeError;
  try{await call('addToAlbum',{albumKey,mediaKeys:batch.map(item=>item.mediaKey)});}catch(error){writeError=error;}
  members=await call('albumMembers',{albumKey});
  if(batch.some(item=>!albumMatches(members,item)))throw writeError||Error('Some additions were not confirmed. Retry the saved album operation.');
 }
 return save(finishReviewAlbum(state,members));
}
async function readReviewTrash(call) {
 const keys=new Set(),dedupKeys=new Set(),seen=new Set();let cursor=null;
 do {
  const page=await call('trashPage',{cursor});
  for(const item of page.items){keys.add(item.mediaKey);if(item.dedupKey)dedupKeys.add(item.dedupKey);}
  cursor=page.nextPageId;
  if(cursor&&seen.has(cursor))throw Error('Google repeated a Trash page. Nothing was updated.');
  seen.add(cursor);if(seen.size>1000)throw Error('Trash scan exceeded its safety limit.');
 }while(cursor);
 return {keys,dedupKeys};
}
function markReviewTrash(state,mediaKeys,now=Date.now()) {
 const keys=new Set(mediaKeys),newlyTrashed=state.items.filter(item=>keys.has(item.mediaKey)&&item.state!=='in_trash');
 if(!newlyTrashed.length)return state;
 return {...state,items:state.items.map(item=>keys.has(item.mediaKey)&&item.state!=='in_trash'?{...item,state:'in_trash',trashedAt:now,revision:(item.revision||0)+1}:item),lifetimeFreed:(state.lifetimeFreed||reviewStorage(state.items.filter(item=>item.state==='in_trash')).bytes)+reviewStorage(newlyTrashed).bytes};
}
async function confirmReviewTrash(mediaKeys,call,{concurrency=8,retryDelay=1500,sleep=delay=>new Promise(resolve=>setTimeout(resolve,delay))}={}) {
 const confirmed=new Set(),pending=()=>mediaKeys.filter(key=>!confirmed.has(key));
 try{const page=await call('trashPage',{cursor:null});const keys=new Set(page.items.map(item=>item.mediaKey));for(const key of mediaKeys)if(keys.has(key))confirmed.add(key);}catch{}
 const check=async keys=>{const queue=[...keys];await Promise.all(Array.from({length:Math.min(concurrency,queue.length)},async()=>{while(queue.length){const key=queue.shift();try{if((await call('itemState',{mediaKey:key})).state==='in_trash')confirmed.add(key);}catch{}}}));};
 if(pending().length)await check(pending());
 if(pending().length){await sleep(retryDelay);await check(pending());}
 if(pending().length){const trash=await readReviewTrash(call);for(const key of pending())if(trash.keys.has(key))confirmed.add(key);}
 return confirmed;
}
async function reconcileReviewTrash(state,call,now=Date.now()) {
 if(state.job)throw Error('Finish the saved album operation before checking Trash.');
 const trash=await readReviewTrash(call),items=[];
 for(const item of state.items){
  let next=item.state;
  if(trash.keys.has(item.mediaKey))next='in_trash';
  else if(item.state==='in_trash'||item.dedupKey&&trash.dedupKeys.has(item.dedupKey)){const result=await call('itemState',{mediaKey:item.mediaKey});if(['active','in_trash'].includes(result.state))next=result.state;}
  items.push({...item,state:next,revision:(item.revision||0)+(next!==item.state?1:0),...(next==='in_trash'&&item.state!=='in_trash'?{trashedAt:now}:{})});
 }
 const newlyTrashed=items.filter(item=>item.state==='in_trash'&&state.items.find(previous=>previous.mediaKey===item.mediaKey)?.state!=='in_trash');
 return {...state,items,lifetimeFreed:(state.lifetimeFreed||reviewStorage(state.items.filter(item=>item.state==='in_trash')).bytes)+reviewStorage(newlyTrashed).bytes};
}
async function loadReviewPages({read,save,call,refresh=false,progress=()=>{},target=50,maxPages=Infinity}) {
 let state=await read();
 const before=new Set(reviewDeck(state).map(item=>item.mediaKey)),seen=new Set(state.cursor?[state.cursor]:[]);
 let scanned=0,added=0,warning='',limited=false;
 if(!refresh&&state.exhausted)return {scanned,added,warning,limited,exhausted:true};
 for(let count=0;count<maxPages;count++){
  progress(scanned);
  const cursor=refresh?null:state.cursor,page=await call('library',{cursor});
  if(!refresh&&page.nextPageId&&seen.has(page.nextPageId))throw Error('Google repeated a library page. Reload before retrying.');
  state=await save(mergeReviewPage(await read(),page,cursor,refresh),page,cursor,refresh);scanned+=page.items.length;warning=page.metadataWarning||warning;added=reviewDeck(state).filter(item=>!before.has(item.mediaKey)).length;
  if(refresh||state.exhausted||added>=target)break;
  seen.add(state.cursor);limited=count===maxPages-1;
 }
 return {scanned,added,warning,limited,exhausted:state.exhausted};
}

const REVIEW_HISTORY_LIMIT=2000;
const itemSwipeCounts=new WeakMap();
function reviewSwipeCount(state) {
 let latest=itemSwipeCounts.get(state.items);
 if(latest===undefined){latest=0;for(const item of state.items)if(item.lastDecisionSwipe>latest)latest=item.lastDecisionSwipe;itemSwipeCounts.set(state.items,latest);}
 return Math.max(latest,state.swipeCount||0,state.history?.length||0);
}
function recordReviewDecision(state,item,decision,now=Date.now()) {
 if(![null,'keep','remove'].includes(decision))throw Error('Invalid decision.');
 if(state.job?.mediaKeys.includes(item.mediaKey))throw Error('Finish the saved album operation before changing this item.');
 const index=state.items.findIndex(candidate=>candidate.mediaKey===item.mediaKey),saved=state.items[index];
 if(!saved||saved.state==='in_trash'||saved.decision!==item.decision||(saved.revision||0)!==(item.revision||0))throw Error('This item changed. Refresh and try again.');
 const swipeCount=reviewSwipeCount(state)+1,items=state.items.slice();
 const cooldown=Object.fromEntries(['lastDecisionAt','lastDecisionSwipe','keepCount'].map(field=>[field,item[field]??null]));
 items[index]={...saved,decision,queueSent:false,revision:(saved.revision||0)+1,lastDecisionAt:now,lastDecisionSwipe:swipeCount,keepCount:(item.keepCount||0)+(decision==='keep'?1:0)};
 itemSwipeCounts.set(items,swipeCount);
 return {...state,swipeCount,items,history:[...(state.history||[]).slice(1-REVIEW_HISTORY_LIMIT),{key:item.mediaKey,previous:item.decision,decision,revision:(item.revision||0)+1,cooldown}]};
}

const reviewOrders=[['flashbacks','Flashbacks','\u2928'],['original','Timeline','\u25f7'],['oldest','Oldest first','\u2191'],['largest','Largest first','\u25a3']];
function reviewMemories(items){
 const dated=items.map(item=>({item,time:Date.parse(item.date)})).sort((a,b)=>(a.time||0)-(b.time||0)),memories=[];
 let previous=null;
 for(const entry of dated){if(!previous||!!entry.time!==!!previous.time||entry.time-previous.time>6*3600000)memories.push([]);memories[memories.length-1].push(entry.item);previous=entry;}
 return memories;
}
function keptEligible(item,swipes,now=Date.now()){
 const multiplier=2**Math.max(0,(item.keepCount||1)-1);
 return item.decision==='keep'&&Number.isFinite(item.lastDecisionAt)&&now-item.lastDecisionAt>=30*86400000*multiplier&&swipes-(item.lastDecisionSwipe||0)>=500*multiplier;
}
function flashbackDeck(state,saved={},random=Math.random,now=Date.now(),focused=null,allowPartial=false){
 const previousOrder=saved.keys||[],previousKeys=new Set(previousOrder),initialSeen=new Set(saved.seen||[]),initialStarts=new Set(saved.starts||[]);
 const memories=reviewMemories(state.items.filter(item=>!item.needsPreview&&item.state!=='in_trash')),boundary=state.started&&!state.exhausted&&!allowPartial?memories[0]:null;
 const memoryOf=new Map();for(const group of memories)for(const item of group)memoryOf.set(item.mediaKey,group);
 const boundaryStarted=boundary?.some(item=>item.mediaKey===focused||initialSeen.has(item.mediaKey)||item.decision&&initialStarts.has(item.mediaKey));
 const held=new Set(boundary&&!boundaryStarted?boundary.map(item=>item.mediaKey):[]);
 const swipes=reviewSwipeCount(state),eligible=state.items.filter(item=>!held.has(item.mediaKey)&&!item.needsPreview&&item.state!=='in_trash'&&(!item.decision||(!saved.keptOff&&keptEligible(item,swipes,now)))),byKey=new Map(eligible.map(item=>[item.mediaKey,item]));
 const seen=(saved.seen||[]).filter(key=>byKey.get(key)?.decision!=='keep');
 let keys=(saved.keys||[]).filter(key=>byKey.has(key)&&!initialSeen.has(key)),known=new Set([...keys,...seen]);
 const unreviewed=eligible.filter(item=>!item.decision&&!known.has(item.mediaKey)),kept=eligible.filter(item=>item.decision==='keep'&&!known.has(item.mediaKey)).sort((a,b)=>a.lastDecisionAt-b.lastDecisionAt),remainingUnswiped=eligible.filter(item=>!item.decision).length;
 const allowance=remainingUnswiped?Math.max(0,Math.floor(remainingUnswiped/19)-keys.filter(key=>byKey.get(key)?.decision==='keep').length):kept.length;
 const selected=new Set([...unreviewed,...kept.slice(0,allowance)].map(item=>item.mediaKey));
 saved.seen=(saved.seen||[]).filter(key=>!selected.has(key)||byKey.get(key)?.decision!=='keep');
 const headMemory=keys.length?memoryOf.get(keys[0]):undefined;
 const activeMemory=memoryOf.get(focused)||(headMemory?.some(item=>item.decision&&initialStarts.has(item.mediaKey))?headMemory:null);
 const reshuffle=keys.length>0&&unreviewed.length>0;
 const fresh=memories.map(memory=>memory.filter(item=>selected.has(item.mediaKey))).filter(memory=>memory.length);
 for(let i=reshuffle?0:fresh.length-1;i>0;i--){if(!fresh[i][0].date)continue;const j=Math.floor(random()*(i+1));[fresh[i],fresh[j]]=[fresh[j],fresh[i]];}
 if(!remainingUnswiped&&!keys.length)fresh.sort((a,b)=>Math.min(...a.map(item=>item.lastDecisionAt))-Math.min(...b.map(item=>item.lastDecisionAt)));
 let keySet=new Set(keys);
 const present=new Set();for(const key of keys){const group=memoryOf.get(key);if(group)present.add(group);}
 for(const memory of fresh){
  const fullMemory=memoryOf.get(memory[0].mediaKey);
  if(present.has(fullMemory)){const existing=keys.findIndex(key=>memoryOf.get(key)===fullMemory),merged=fullMemory.filter(item=>keySet.has(item.mediaKey)||selected.has(item.mediaKey)).map(item=>item.mediaKey);const members=new Set(merged);keys.splice(existing,0,...merged);for(let index=keys.length-1;index>=existing+merged.length;index--)if(members.has(keys[index]))keys.splice(index,1);keySet=new Set(keys);}
  else {for(const item of memory){keys.push(item.mediaKey);keySet.add(item.mediaKey);}present.add(fullMemory);}
 }
 if(reshuffle){
  const groups=memories.map(group=>group.filter(item=>keySet.has(item.mediaKey))).filter(group=>group.length);
  for(let i=groups.length-1;i>0;i--){if(!groups[i][0].date)continue;const j=Math.floor(random()*(i+1));[groups[i],groups[j]]=[groups[j],groups[i]];}
  if(activeMemory){const index=groups.findIndex(group=>activeMemory.includes(group[0]));if(index>0)groups.unshift(...groups.splice(index,1));}
  keys=groups.flatMap(group=>group.map(item=>item.mediaKey));keySet=new Set(keys);
 }
 let startSet=new Set(saved.starts||[]);
 for(const group of memories){
  let playedStart=null;for(const item of group)if(item.decision&&startSet.has(item.mediaKey)){playedStart=item;break;}
  if(!playedStart)continue;
  const startIndex=group.indexOf(playedStart);let continuation=false;
  for(let index=0;index<startIndex;index++){const item=group[index];if(!item.decision&&keySet.has(item.mediaKey)){continuation=true;break;}}
  if(!continuation)continue;
  const members=new Set(group.map(item=>item.mediaKey));
  const ordered=group.some(item=>keySet.has(item.mediaKey)&&!previousKeys.has(item.mediaKey))?group.filter(item=>keySet.has(item.mediaKey)).map(item=>item.mediaKey):keys.filter(key=>members.has(key));
  saved.starts=saved.starts.filter(key=>key===playedStart.mediaKey||!members.has(key));startSet=new Set(saved.starts);
  const remainder=keys.filter(key=>!members.has(key));
  const insertion=activeMemory&&activeMemory!==group?remainder.findIndex(key=>!activeMemory.some(item=>item.mediaKey===key)):0;
  remainder.splice(insertion<0?remainder.length:insertion,0,...ordered);keys=remainder;keySet=new Set(keys);
 }
 const memory=focused&&memoryOf.get(focused);
 if(memory&&keySet.has(focused)){
  const members=new Set(memory.map(item=>item.mediaKey)),ordered=memory.filter(item=>keySet.has(item.mediaKey)).map(item=>item.mediaKey),index=ordered.indexOf(focused);
  const earlier=ordered.slice(0,index),remaining=keys.filter(key=>!members.has(key)),previousRemaining=previousOrder.find(key=>!members.has(key));
  keys=earlier.some(key=>!previousKeys.has(key))||earlier.length&&earlier.every(key=>previousOrder.indexOf(key)>previousOrder.indexOf(focused)&&(!previousRemaining||previousOrder.indexOf(key)<previousOrder.indexOf(previousRemaining)))?[...ordered.slice(index),...earlier,...remaining]:[...ordered.slice(index),...remaining,...earlier];
 }
 const loadedKeys=new Set(state.items.map(item=>item.mediaKey));
 saved.keys=keys;saved.seen=(saved.seen||[]).filter(key=>loadedKeys.has(key));
 const firstKey=new Map();for(const key of keys){const group=memoryOf.get(key);if(group&&!firstKey.has(group))firstKey.set(group,key);}
 const currentStarts=saved.starts||[],startsBefore=new Set(currentStarts),removed=new Set(),added=[];
 for(const group of memories){
  let start=false;for(const item of group)if(item.decision&&startsBefore.has(item.mediaKey)){start=true;break;}
  if(start)continue;
  for(const item of group)removed.add(item.mediaKey);
  const first=byKey.get(firstKey.get(group));
  if(first)added.push(first.mediaKey);
 }
 saved.starts=[...new Set([...currentStarts.filter(key=>!removed.has(key)),...added])];
 return keys.map(key=>byKey.get(key));
}
function keptReady(state,now=Date.now()){
 const swipes=reviewSwipeCount(state);
 return state.items.filter(item=>!item.needsPreview&&item.state!=='in_trash'&&keptEligible(item,swipes,now)).sort((a,b)=>(a.lastDecisionAt||0)-(b.lastDecisionAt||0));
}
function resurfaceKept(unreviewed,kept,every=20,start=every-1){
 if(!kept.length)return unreviewed;
 if(!unreviewed.length)return kept;
 const result=[];let next=0,index=0;
 while(index<unreviewed.length){
  if(next<kept.length&&result.length===start+next*every){result.push(kept[next++]);continue;}
  result.push(unreviewed[index++]);
 }
 return result;
}
function nextKeptReturn(state,now=Date.now()){
 const swipes=reviewSwipeCount(state);let next=Infinity;
 for(const item of state.items){
  if(item.decision!=='keep'||item.state==='in_trash'||item.needsPreview||!Number.isFinite(item.lastDecisionAt))continue;
  const multiplier=2**Math.max(0,(item.keepCount||1)-1);
  if(swipes-(item.lastDecisionSwipe||0)<500*multiplier)continue;
  next=Math.min(next,item.lastDecisionAt+30*86400000*multiplier);
 }
 return Number.isFinite(next)?Math.max(next,now):null;
}

const LEASE_HEARTBEAT_MS=4000;
const CHUNK_SIZE=500;
const LEASE_EXPIRY_MS=12000;
async function createLeaseOwner(window,crypto) {
 const key='photos-swipe-lease-owner';
 let owner=crypto.randomUUID(),saved;
 try{saved=window.sessionStorage.getItem(key);window.sessionStorage.removeItem(key);}catch{}
 let handoff=saved||owner;
 window.addEventListener?.('pagehide',()=>{try{window.sessionStorage.setItem(key,handoff);}catch{}});
 window.addEventListener?.('pageshow',()=>{try{window.sessionStorage.removeItem(key);}catch{}});
 const locks=window.navigator?.locks;
 if(locks){
  const claim=candidate=>new Promise((resolve,reject)=>{
   locks.request(`photos-swipe-owner:${candidate}`,{ifAvailable:true},lock=>{
    resolve(!!lock);
    if(lock)return new Promise(()=>{});
   }).catch(reject);
  });
  try{if(saved&&await claim(saved))owner=saved;else await claim(owner);}catch{owner=crypto.randomUUID();}
 }
 handoff=owner;
 return owner;
}
const storageError=error=>error?.name==='QuotaExceededError'?Error('Couldn\u2019t save: storage full. Free up space.'):error||Error('Local storage transaction failed.');
async function openReviewDatabase(indexedDB) {
 const unavailable=()=>Error('Photos Swipe can\u2019t use storage in this browser. Use a normal window or allow site data for photos.google.com, then reload.');
 const db=await new Promise((resolve,reject)=>{
  let request;
  try{request=indexedDB.open('photos-swipe-userscript',2);}catch{reject(unavailable());return;}
  request.onupgradeneeded=()=>{for(const name of ['accounts','leases','settings'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error?.name==='VersionError'?request.error:unavailable());
  request.onblocked=()=>reject(Error('Close other Photos Swipe tabs to open local storage.'));
 });
 db.onversionchange=()=>db.close();
 const loaded=new Map(),legacyAccounts=new Set(),resumeLists=new Map(),metaKey=account=>`v2:${account}`,chunkKey=(account,index)=>`v2:${account}:${String(index).padStart(5,'0')}`;
 function transaction(store,key,change) {
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(store,change?'readwrite':'readonly'),table=tx.objectStore(store),request=table.get(key);let result,failure;
   request.onsuccess=()=>{
    try {result=change?change(request.result):request.result;if(change){if(result===undefined)table.delete(key);else table.put(result,key)};}catch(error){failure=error;tx.abort();}
   };
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(storageError(failure||tx.error));
   tx.onerror=()=>{};
  });
 }
 return {
  resume:account=>new Promise((resolve,reject)=>{
   const tx=db.transaction('settings','readonly'),table=tx.objectStore('settings'),request=table.get(`resume:${account}`);let result={};
   request.onsuccess=()=>{result=request.result||{};if(!result.flashbacks?.split)return;const lists=table.get(`resume-lists:${account}`);lists.onsuccess=()=>{const {split:_split,...flashbacks}=result.flashbacks;result={...result,flashbacks:{...flashbacks,...(lists.result||{})}};resumeLists.set(account,lists.result||null);};};
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(storageError(tx.error));
   tx.onerror=()=>{};
  }),
  saveResume:(account,value)=>new Promise((resolve,reject)=>{
   const tx=db.transaction('settings','readwrite'),table=tx.objectStore('settings'),{flashbacks}=value;
   const lists=flashbacks?{keys:flashbacks.keys,starts:flashbacks.starts}:null,last=resumeLists.get(account),changed=lists&&(!last||last.keys!==lists.keys||last.starts!==lists.starts);
   const request=table.get(`resume:${account}`);
   request.onsuccess=()=>{table.put(flashbacks?{...value,flashbacks:{...flashbacks,keys:undefined,starts:undefined,split:true}}:value,`resume:${account}`);if(changed)table.put(lists,`resume-lists:${account}`);};
   tx.oncomplete=()=>{if(changed)resumeLists.set(account,lists);resolve(value);};
   tx.onabort=()=>reject(storageError(tx.error));
   tx.onerror=()=>{};
  }),
  settings:async()=>await transaction('settings','sync')||{},
  deleteSettings:()=>transaction('settings','sync',()=>undefined),
  saveSettings:value=>transaction('settings','sync',()=>value),
  read:account=>new Promise((resolve,reject)=>{
   const tx=db.transaction('accounts','readonly'),table=tx.objectStore('accounts'),meta=table.get(metaKey(account));let result;
   meta.onsuccess=()=>{
    const value=meta.result;
    if(value&&Number.isSafeInteger(value.chunks)){
     const chunks=Array(value.chunks);let pending=value.chunks;
     const finish=()=>{const {chunks:_count,format:_format,...rest}=value;result={...rest,items:chunks.flat()};loaded.set(account,chunks);};
     if(!pending)finish();
     for(let index=0;index<value.chunks;index++){const request=table.get(chunkKey(account,index));request.onsuccess=()=>{chunks[index]=request.result||[];if(!--pending)finish();};}
     return;
    }
    const legacy=table.get(account);legacy.onsuccess=()=>{result=legacy.result||emptyReview();loaded.delete(account);if(legacy.result)legacyAccounts.add(account);};
   };
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(storageError(tx.error));
   tx.onerror=()=>{};
  }),
  save:(account,state)=>new Promise((resolve,reject)=>{
   const tx=db.transaction('accounts','readwrite'),table=tx.objectStore('accounts'),revisionKey=`revision:${account}`,request=table.get(revisionKey);let result,failure,written;
   const commit=current=>{try{
    if((current||0)!==state.revision)throw Error('Progress changed in another tab. Reopen Photos Swipe and retry.');
    result={...state,revision:state.revision+1};
    const {items=[],...rest}=result,previous=loaded.get(account)||[];written=[];
    for(let index=0;index*CHUNK_SIZE<items.length;index++){
     const chunk=items.slice(index*CHUNK_SIZE,(index+1)*CHUNK_SIZE),old=previous[index];
     if(!old||old.length!==chunk.length||chunk.some((item,position)=>item!==old[position]))table.put(chunk,chunkKey(account,index));
     written.push(chunk);
    }
    for(let index=written.length;index<previous.length;index++)table.delete(chunkKey(account,index));
    table.put({...rest,chunks:written.length,format:2},metaKey(account));table.put(result.revision,revisionKey);
    if(legacyAccounts.has(account))table.delete(account);
   }catch(error){failure=error;tx.abort();}};
   request.onsuccess=()=>{if(Number.isSafeInteger(request.result)){commit(request.result);return;}const meta=table.get(metaKey(account));meta.onsuccess=()=>{if(meta.result){commit(meta.result.revision);return;}const full=table.get(account);full.onsuccess=()=>commit(full.result?.revision);};};
   tx.oncomplete=()=>{loaded.set(account,written);legacyAccounts.delete(account);resolve(result);};
   tx.onabort=()=>reject(storageError(failure||tx.error));
   tx.onerror=()=>{};
  }),
  readLease:account=>transaction('leases',account),
  lease:(account,owner,release=false,takeover=true,claim=false)=>transaction('leases',account,current=>{
   if(release&&current?.owner!==owner)return current;
   if(!release&&!claim&&current?.owner!==owner&&current?.expires>Date.now()){
    if(!takeover)return current;
    throw Error('Photos Swipe is busy in another tab. Try again when it finishes.');
   }
   return {owner,expires:release?0:Date.now()+LEASE_EXPIRY_MS};
  })
 };
}

const fields=['mediaKey','type','size','spaceTaken','takesUpSpace','state','revision','queueSent','lastDecisionAt','lastDecisionSwipe','keepCount'];
function syncedItemWorthKeeping(item){return !!item&&((item.revision||0)>0||(item.state!==undefined&&item.state!=='active')||!!item.queueSent||!!item.lastDecisionAt||!!item.keepCount);}
function changedProgressItems(items,previous=[]){
 const before=new Map(previous.map(item=>[item.mediaKey,item]));
 return items.filter(item=>{const old=before.get(item.mediaKey);return (syncedItemWorthKeeping(item)||syncedItemWorthKeeping(old))&&JSON.stringify(item)!==JSON.stringify(old);});
}
function serverKeeps(item,stored){return !!stored&&(stored.state==='in_trash'||item.state!=='in_trash'&&(item.revision||0)<=(stored.revision||0));}
function sameMetadata(local,remote){return Object.entries(local).every(([key,value])=>JSON.stringify(value)===JSON.stringify(remote?.[key]));}
function cursorKey(token){let hash=0x811c9dc5;for(let index=0;index<token.length;index++){hash^=token.charCodeAt(index);hash=Math.imul(hash,0x01000193)>>>0;}return hash.toString(36);}
function syncedPreviewItem(item){const local={...item};delete local.urlFetchedAt;return local;}
function mergeProgressItem(item,checkpoint) {
 return {...Object.fromEntries(Object.entries(item).filter(([field])=>!fields.includes(field))),...Object.fromEntries(fields.filter(field=>checkpoint[field]!==undefined).map(field=>[field,checkpoint[field]]))};
}
function createSyncClient({fetch,status=()=>{},unpaired=()=>{}}) {
 let settings={},blocked=false,firstSync=true,failures=0,retryAt=0;
 const failed=()=>{failures++;retryAt=Date.now()+Math.min(SYNC_BACKOFF_MS*2**(failures-1),SYNC_BACKOFF_MAX_MS);};
 const configure=value=>{settings=value||{};blocked=false;firstSync=true;status(settings.url&&settings.token?'Sync ready':'Sync off \u00b7 saved locally');};
 async function request(scope,path,method='GET',value,query={}) {
  if(blocked)throw Error('This device was unpaired.');
  if(!settings.url||!settings.token)throw Error('Configure sync to manage paired devices.');
  const url=new URL(path,settings.url.replace(/\/$/,'')+'/');url.searchParams.set('scope',scope);for(const [key,entry] of Object.entries(query))url.searchParams.set(key,String(entry));
  const signal=AbortSignal.timeout(10000);
  try {
   const response=await fetch(url.href,{method,headers:{Authorization:`Bearer ${settings.token}`,...(value?{'Content-Type':'application/json'}:{})},...(value?{body:JSON.stringify(value)}:{}),credentials:'omit',referrerPolicy:'no-referrer',signal});
   if(response.status===401){blocked=true;status('This device was unpaired.');await unpaired();throw Error('This device was unpaired.');}
   if(!response.ok)throw Object.assign(Error(`Sync HTTP ${response.status}`),{status:response.status});
   return await response.json();
  }catch(error){
   if(signal.aborted||error.name==='TimeoutError')throw Object.assign(Error('Sync timed out'),{name:'TimeoutError'});
   if(error.name==='AbortError')throw Error('Sync cancelled');
   throw error;
  }
 }
 async function sync(scope,state,save,options={}) {
  const {pull=true,rebuild=async value=>value}=typeof options==='function'?{rebuild:options}:options;
  if(blocked||!settings.url||!settings.token)return state;
  let retryAvailable=firstSync;firstSync=false;
  const syncRequest=async(...args)=>{
   try{return await request(...args);}catch(error){
    if(error.name!=='TimeoutError'||!retryAvailable)throw error;
    retryAvailable=false;return request(...args);
   }
  };
  status('Syncing\u2026');
  let checkpoint=state;
  const itemsKey=cursorKey(settings.token),cursor=state.syncCursor?.key===itemsKey&&typeof state.syncCursor.at==='string'&&state.syncDecisions&&(state.started||state.items.length||state.history.length)?state.syncCursor.at:'';
  try {
   const remote=pull?await syncRequest(scope,'api/state','GET',undefined,{cursor}):{delta:true,decisions:[],progress:state.syncProgress||{}};
   const decisions=remote.delta?{...state.syncDecisions}:{},owners={...remote.decisionOwners};
   const applyDecisions=rows=>{for(const {id,decision} of rows)if(decision==null)delete decisions[id];else decisions[id]=decision;};
   applyDecisions(remote.decisions);
   const pending={...state.syncPending},pendingTimes={...state.syncPendingTimes};
   if(state.syncDecisions==null)for(const item of state.items)if(item.decision&&!Object.hasOwn(pending,item.mediaKey)){pending[item.mediaKey]=item.decision;pendingTimes[item.mediaKey]=item.lastDecisionAt??0;}
   const dirty=state.syncDirty||!state.syncDecisions&&state.history.length>0;
   const historyKeys=new Set([...(state.syncHistoryKeys||[]),...Object.keys(pending),...(dirty?state.history.map(entry=>entry.key):[])]);
   const remaining={...pending};
   for(const batch of decisionBatches(pending,pendingTimes,state.syncPendingUndo)){
    const accepted=await syncRequest(scope,'api/decisions','PUT',{decisions:batch},{delta:1});
    for(const {id} of batch)delete remaining[id];
    applyDecisions(batch);
    if(accepted.delta&&Array.isArray(accepted.decisions)){applyDecisions(accepted.decisions);Object.assign(owners,accepted.decisionOwners);}
    else if(accepted.merged&&accepted.decisions){for(const id of Object.keys(decisions))delete decisions[id];applyDecisions(accepted.decisions);Object.assign(owners,accepted.decisionOwners);}
    checkpoint={...state,syncDecisions:{...decisions},syncPending:{...remaining},syncPendingTimes:pendingTimes,syncDirty:dirty,syncHistoryKeys:[...historyKeys]};
   }
   const remoteHistory=remote.delta?null:remote.history,historyBase=remoteHistory||state.syncHistory;
   const history=(remoteHistory?dirty?mergeHistory(remoteHistory,state.history,historyKeys):remoteHistory:state.history).filter(entry=>owners[entry.key]!==false).slice(-2000);
   const checkpointItems=new Map((remote.progress.items||[]).map(item=>[item.mediaKey,item])),serverItems=new Map(checkpointItems);
   const checkpointRevisions=new Map([...checkpointItems].map(([key,item])=>[key,item.revision||0]));
   const mergedItems=state.items.map(item=>{
    const checkpoint=checkpointItems.get(item.mediaKey);checkpointItems.delete(item.mediaKey);
    return checkpoint&&(checkpoint.revision||0)>=(item.revision||0)?mergeProgressItem(item,checkpoint):item;
   });
   for(const item of checkpointItems.values())mergedItems.push({...syncedPreviewItem(item),name:item.mediaKey,type:item.type||'photo',needsPreview:true});
   const items=mergedItems.map(item=>{
    const value=decisions[item.mediaKey]??(Object.hasOwn(pending,item.mediaKey)||Object.hasOwn(state.syncDecisions||{},item.mediaKey)?null:item.decision);
    const entry=history.findLast(entry=>entry.key===item.mediaKey&&entry.decision===value);
    return {...item,decision:value,revision:!dirty&&entry&&(value!==item.decision||!item.revision)?Math.max(entry.revision,checkpointRevisions.get(item.mediaKey)||0):item.revision};
   });
   let next={...state,swipeCount:Math.max(reviewSwipeCount(state),remote.progress.swipeCount||0),history,items,syncDecisions:decisions,lifetimeFreed:Math.max(state.lifetimeFreed||0,remote.progress.lifetimeFreed||0,reviewStorage(items.filter(item=>item.state==='in_trash')).bytes)};
   if(!state.started&&!state.items.length&&!state.history.length&&!dirty&&Object.keys(pending).length===0&&(remote.progress.started||Object.keys(decisions).length)){
    const restored=remote.progress.items?.map(item=>({...item}))||Object.keys(decisions).map(mediaKey=>({mediaKey,revision:history.findLast(entry=>entry.key===mediaKey)?.revision||0,state:'active'}));
    for(const mediaKey of Object.keys(decisions))if(!restored.some(item=>item.mediaKey===mediaKey))restored.push({mediaKey,revision:history.findLast(entry=>entry.key===mediaKey)?.revision||0,state:'active'});
    next={...next,started:!!remote.progress.started,items:restored.map(item=>({...syncedPreviewItem(item),name:item.mediaKey,type:item.type||'photo',decision:decisions[item.mediaKey]??null,needsPreview:true})),lifetimeFreed:remote.progress.lifetimeFreed||0};
    try{next=await rebuild(next);}catch(error){status(`${error.message} \u00b7 checkpoint recovered; retry loading the library`);}
   }
   let progress=reviewSyncProgress(next,decisions);
   const {items:checkpointList,...checkpointMetadata}=state.syncCheckpoint||{},{items:progressList,...progressMetadata}=progress;
   const accepted=new Map(),skipped=new Map(),changedItems=changedProgressItems(progressList,Array.isArray(checkpointList)?checkpointList:[]).filter(item=>{const stored=serverItems.get(item.mediaKey);if(!serverKeeps(item,stored))return true;skipped.set(item.mediaKey,stored);return false;});
   const progressDirty=dirty||(changedItems.length>0||JSON.stringify(progressMetadata)!==JSON.stringify(checkpointMetadata)&&!(pull&&sameMetadata(progressMetadata,remote.progress)))&&state.items.length>0;
   if(progressDirty)for(const [key,stored] of skipped)accepted.set(key,stored);
   let writeError=null,historySynced=false;
   try{
    if(dirty){
     const patch=historyBase&&historyPatch(historyBase,history),body=patch&&{action:'patch',base:cursorKey(JSON.stringify(historyBase)),...patch};
     let patched=false;
     if(body&&new TextEncoder().encode(JSON.stringify(body)).length<=262144){
      try{patched=(await syncRequest(scope,'api/undo','POST',body)).length===history.length;}catch(error){if(error.status!==409&&error.status!==400)throw error;}
     }
     if(!patched)await syncRequest(scope,'api/undo','PUT',{history});
     historySynced=true;
    }
    if(progressDirty){
     for(const batch of progressBatches({...progress,items:changedItems})){
      const result=await syncRequest(scope,'api/progress','PUT',batch);
      const items=result.items||(await syncRequest(scope,'api/state')).progress.items;
      if(!Array.isArray(items)||batch.items.some(item=>!items.some(row=>row.mediaKey===item.mediaKey)))throw Error('Unconfirmed sync');
      for(const item of items)accepted.set(item.mediaKey,item);
     }
    }
   }catch(error){writeError=error;}
   if(accepted.size){
    next={...next,items:next.items.map(item=>accepted.has(item.mediaKey)?mergeProgressItem(item,accepted.get(item.mediaKey)):item)};
    progress.items=reviewSyncProgress(next,decisions).items;
   }
   const confirmed=new Map(progress.items.filter(item=>accepted.has(item.mediaKey)).map(item=>[item.mediaKey,item]));
   const syncCheckpoint=!writeError?{...progress,items:progress.items.filter(syncedItemWorthKeeping)}:confirmed.size?{...checkpointMetadata,items:[...(Array.isArray(checkpointList)?checkpointList:[]).filter(item=>!confirmed.has(item.mediaKey)),...[...confirmed.values()].filter(syncedItemWorthKeeping)]}:state.syncCheckpoint;
   const unsynced=!!writeError&&!historySynced;
   const {syncItemsCursor,...saved}=next;
   next=await save({...saved,syncPending:{},syncPendingTimes:{},syncPendingUndo:{},syncDirty:unsynced&&!!dirty,syncHistoryKeys:unsynced?[...historyKeys]:[],syncHistory:historySynced?history:historyBase,syncProgress:Object.fromEntries(Object.entries(remote.progress||{}).filter(([key])=>key!=='items')),syncCheckpoint,...(pull&&typeof remote.cursor==='string'?{syncCursor:{key:itemsKey,at:remote.cursor}}:{})});
   if(writeError){failed();if(!blocked)status(`${writeError.message} \u00b7 pull saved locally; retry on next action`);return next;}
   failures=0;retryAt=0;
   status(`Synced \u00b7 ${Object.keys(decisions).length} reviewed IDs`);return next;
  }catch(error){failed();if(!blocked)status(`${error.message} \u00b7 saved locally; retry on next action`);return checkpoint===state?state:await save(checkpoint);}
 }
 return {configure,sync,ready:(now=Date.now())=>now>=retryAt,trashCheck:(scope,ids)=>request(scope,'api/trash-check','POST',{ids}),devices:()=>request('default','api/devices'),rename:(id,name)=>request('default',`api/devices/${encodeURIComponent(id)}`,'PATCH',{name}),revoke:id=>request('default',`api/devices/${encodeURIComponent(id)}`,'DELETE'),revokeOthers:()=>request('default','api/devices/revoke-others','POST')};
}
const SYNC_POLL_MS=60000,SYNC_IDLE_POLL_MS=300000,SYNC_IDLE_AFTER_MS=120000,SYNC_PUSH_DELAY_MS=5000,SYNC_BACKOFF_MS=5000,SYNC_BACKOFF_MAX_MS=300000;
function heartbeatSync(state,lastPullAt,now,activeAt=now){
 if(now-lastPullAt>=(now-activeAt<SYNC_IDLE_AFTER_MS?SYNC_POLL_MS:SYNC_IDLE_POLL_MS))return 'pull';
 return now-activeAt>=SYNC_PUSH_DELAY_MS&&(state.syncDirty||Object.keys(state.syncPending||{}).length)?'push':null;
}
function markSyncChanges(previous,next) {
 const pending={...previous.syncPending},times={...previous.syncPendingTimes},undos={...previous.syncPendingUndo};
 const undo=next.history.length<previous.history.length;
 const aligned=previous.items.length===next.items.length;let decisions=null;
 const old={has:key=>(decisions||=new Map(previous.items.map(item=>[item.mediaKey,item.decision]))).has(key),get:key=>(decisions||=new Map(previous.items.map(item=>[item.mediaKey,item.decision]))).get(key)};
 let dirty=!!previous.syncDirty||JSON.stringify(previous.history)!==JSON.stringify(next.history);
 const items=next.items.map((item,index)=>{
  const before=aligned?previous.items[index]:null;
  if(before===item)return item;
  if(before?.mediaKey===item.mediaKey){if((before.decision??null)!==(item.decision??null)){pending[item.mediaKey]=item.decision??null;times[item.mediaKey]=Date.now();undos[item.mediaKey]=undo||item.decision==='keep'&&(!!undos[item.mediaKey]||before.decision==='remove');dirty=true;}return item;}
  if(!old.has(item.mediaKey)&&previous.syncDecisions?.[item.mediaKey])return {...item,decision:previous.syncDecisions[item.mediaKey],revision:previous.history.findLast(entry=>entry.key===item.mediaKey)?.revision||item.revision||0};
  if((old.get(item.mediaKey)??null)!==(item.decision??null)){pending[item.mediaKey]=item.decision??null;times[item.mediaKey]=Date.now();undos[item.mediaKey]=undo||item.decision==='keep'&&(!!undos[item.mediaKey]||old.get(item.mediaKey)==='remove');dirty=true;}
  return item;
 });
 return {...next,items,syncPending:pending,syncPendingTimes:times,syncPendingUndo:undos,syncDirty:dirty};
}

function progressBatches(progress) {
 const {items,...metadata}=progress,encoder=new TextEncoder(),batches=[];
 let batch=[],bytes=encoder.encode(JSON.stringify({...metadata,items:[]})).length;
 const baseBytes=bytes;
 for(const item of items){
  const itemBytes=encoder.encode(JSON.stringify(item)).length;
  if(batch.length&&(batch.length===2000||bytes+itemBytes+1>262144)){
   batches.push({...metadata,items:batch});batch=[];bytes=baseBytes;
  }
  bytes+=itemBytes+(batch.length?1:0);batch.push(item);
 }
 if(batch.length||!batches.length)batches.push({...metadata,items:batch});
 return batches;
}
function reviewSyncProgress(state,decisions=state.syncDecisions||{}) {
 return {swipeCount:reviewSwipeCount(state),started:!!state.started,reviewed:Object.keys(decisions).length,items:state.items.map(item=>Object.fromEntries(fields.filter(field=>item[field]!==undefined).map(field=>[field,item[field]]))),lifetimeFreed:state.lifetimeFreed||reviewStorage(state.items.filter(item=>item.state==='in_trash')).bytes};
}
async function rebuildSyncedReview(state,call) {
 const items=new Map(state.items.map(item=>[item.mediaKey,item])),seen=new Set();let cursor=null,exhausted=false;
 for(let count=0;count<12;count++){
  const page=await call('library',{cursor});
  for(const item of page.items){const old=items.get(item.mediaKey),storage=Object.fromEntries(['size','spaceTaken','takesUpSpace'].map(field=>[field,item[field]??old?.[field]]));items.set(item.mediaKey,{...old,...item,...storage,decision:state.syncDecisions[item.mediaKey]??null,state:old?.state||'active',revision:old?.revision||0,urlFetchedAt:Date.now(),needsPreview:false});}
  if(page.nextPageId&&(page.nextPageId===cursor||seen.has(page.nextPageId)))throw Error('Google repeated a library page during sync recovery.');
  cursor=page.nextPageId;exhausted=!cursor;seen.add(cursor);
  if(exhausted||[...items.values()].filter(item=>!item.decision&&!item.needsPreview&&item.state!=='in_trash').length>=50)break;
 }
 return {...state,items:[...items.values()],started:true,cursor,exhausted};
}

function historyPatch(base,next) {
 const before=base.map(entry=>JSON.stringify(entry)),after=next.map(entry=>JSON.stringify(entry));
 let start=0,end=0;
 for(let index=0;index<before.length;index++){
  if(before[index]!==after[0])continue;
  let run=1;while(index+run<before.length&&run<after.length&&before[index+run]===after[run])run++;
  if(run>end-start){start=index;end=index+run;}
  if(index+run===before.length)break;
 }
 return end>start?{start,end,append:next.slice(end-start)}:null;
}
function mergeHistory(remote,local,keys) {
 return [...remote.filter(entry=>!keys.has(entry.key)),...local.filter(entry=>keys.has(entry.key))];
}
function mergeSyncResult(current,snapshot,synced) {
 const before=new Map(snapshot.items.map(item=>[item.mediaKey,item]));
 const incoming=new Map(synced.items.map(item=>[item.mediaKey,item]));
 const changed=new Set(current.items.filter(item=>{const old=before.get(item.mediaKey);return !old||item.revision!==old.revision||item.decision!==old.decision;}).map(item=>item.mediaKey));
 for(const key of new Set([...snapshot.history,...current.history].map(entry=>entry.key)))if(JSON.stringify(snapshot.history.filter(entry=>entry.key===key))!==JSON.stringify(current.history.filter(entry=>entry.key===key)))changed.add(key);
 const pending={...synced.syncPending};
 for(const key of changed)if(Object.hasOwn(current.syncPending||{},key))pending[key]=current.syncPending[key];
 const history=mergeHistory(synced.history,current.history,changed).slice(-2000);
 const items=current.items.map(item=>changed.has(item.mediaKey)?item:incoming.get(item.mediaKey)||item);
 const existing=new Set(items.map(item=>item.mediaKey));
 for(const item of synced.items)if(!existing.has(item.mediaKey))items.push(item);
 const recovered=!snapshot.started&&!snapshot.items.length&&synced.started;
 return {...current,swipeCount:Math.max(reviewSwipeCount(current),reviewSwipeCount(synced)),...(recovered?{started:synced.started,cursor:synced.cursor,exhausted:synced.exhausted}:{}),lifetimeFreed:Math.max(current.lifetimeFreed||0,synced.lifetimeFreed||0),syncProgress:synced.syncProgress,syncCheckpoint:synced.syncCheckpoint,syncCursor:synced.syncCursor,syncHistory:synced.syncHistory,items,history,syncDecisions:synced.syncDecisions,syncPending:pending,syncPendingTimes:{...synced.syncPendingTimes,...Object.fromEntries([...changed].filter(key=>Object.hasOwn(current.syncPendingTimes||{},key)).map(key=>[key,current.syncPendingTimes[key]]))},syncPendingUndo:{...synced.syncPendingUndo,...Object.fromEntries([...changed].filter(key=>Object.hasOwn(current.syncPendingUndo||{},key)).map(key=>[key,current.syncPendingUndo[key]]))},syncHistoryKeys:[...new Set([...(synced.syncHistoryKeys||[]),...changed])],syncDirty:!!synced.syncDirty||JSON.stringify(history)!==JSON.stringify(synced.history)};
}
function decisionBatches(pending,times={},undos={}) {
 const batches=[];let batch=[],bytes=16;
 for(const [id,decision] of Object.entries(pending)){
  const entry={id,decision,...(times?.[id]!==undefined?{updatedAt:times[id]}:{}),...(undos?.[id]?{undo:true}:{})},size=new TextEncoder().encode(JSON.stringify(entry)).length;
  if(batch.length&&(batch.length===2000||bytes+size+1>262144)){batches.push(batch);batch=[];bytes=16;}
  if(bytes+size>262144)throw Error('Decision exceeds sync input limit');
  bytes+=size+(batch.length?1:0);batch.push(entry);
 }
 if(batch.length)batches.push(batch);
 return batches;
}

function privateSyncFetch(GM){
 return (url,options={})=>new Promise((resolve,reject)=>{
  const abort=()=>{handle?.abort?.();reject(new DOMException('Sync cancelled','AbortError'));};
  let handle;
  if(options.signal?.aborted){abort();return;}
  options.signal?.addEventListener('abort',abort,{once:true});
  const finish=callback=>value=>{options.signal?.removeEventListener('abort',abort);callback(value);};
  handle=GM.xmlHttpRequest({url,method:options.method||'GET',headers:options.headers,data:options.body,timeout:10000,onload:finish(response=>resolve({ok:response.status>=200&&response.status<300,status:response.status,json:async()=>JSON.parse(response.responseText)})),onerror:finish(()=>reject(Error('Sync request failed'))),ontimeout:finish(()=>reject(new DOMException('Sync timed out','TimeoutError')))});
 });
}

async function createPairingStore({GM,database,crypto}) {
 const durable=!!GM&&['getValue','setValue','deleteValue'].every(name=>typeof GM[name]==='function');
 const key='photos-swipe-pairing';
 const dismissalKey='photos-swipe-onboarding-dismissed';
 const complete=value=>typeof value?.url==='string'&&!!value.url&&typeof value?.token==='string'&&!!value.token;
 const select=value=>Object.fromEntries(['url','token','deviceId','deviceName','email','photosAccount'].filter(name=>typeof value?.[name]==='string').map(name=>[name,value[name]]));
 async function settings() {
  const db=await database();
  if(!durable)return db.settings();
  let value=await GM.getValue(key);
  const legacy=await db.settings();
  if(!complete(value)&&complete(legacy)){
   value={...select(legacy),deviceId:legacy.deviceId||crypto.randomUUID()};
   await GM.setValue(key,value);
  }
  if(complete(value)&&(legacy.token||legacy.url||legacy.deviceId||legacy.deviceName)){await db.deleteSettings();if(legacy.onboardingDismissed)await db.saveSettings({onboardingDismissed:true});}
  return {...(!complete(value)?select({...legacy,token:undefined}):{}),...select(value),onboardingDismissed:await GM.getValue(dismissalKey),unpaired:legacy.unpaired};
 }
 async function saveSettings(value) {
  const db=await database();
  if(!durable)return db.saveSettings(value);
  if(value.url&&value.token)await GM.setValue(key,{...select(value),deviceId:value.deviceId||crypto.randomUUID()});
  else await GM.deleteValue(key);
  if(value.onboardingDismissed)await GM.setValue(dismissalKey,true);
  else await GM.deleteValue(dismissalKey);
  await db.saveSettings({...(!(value.url&&value.token)?select({...value,token:undefined}):{}),...(value.onboardingDismissed?{onboardingDismissed:true}:{}),...(value.unpaired?{unpaired:true}:{})});
 }
 return {durable,settings,saveSettings};
}

function createSwipeFeedback({window,targets,card,under,keep,remove,canSwipe,onDecide,playbackOnClick=false,stage=null}) {
 let gesture=null,frame=null,animation=null,incoming=null,dismissing=false,finished=Promise.resolve(),cardWidth=300;
 const FLIGHT_MS=340,FLIGHT_EASING='cubic-bezier(.3,.2,.3,1)',FLING_MS=280,FLING_EASING='cubic-bezier(.2,.7,.3,1)';
 const motionPreference=window.matchMedia?.('(prefers-reduced-motion: reduce)');
 const reduced=()=>motionPreference?.matches===true;
 const lifted=on=>{card.classList?.toggle?.('lifted',on);stage?.classList?.toggle?.('lifting',on);};
 const eligible=({dx,dy})=>Math.abs(dx)>Math.abs(dy)*1.5;
 const commits=value=>value.locked&&eligible(value)&&(Math.abs(value.dx)>=value.width*.33||Math.abs(value.velocity)>.5&&Math.sign(value.velocity)===Math.sign(value.dx))&&canSwipe();
 const paint=()=>{
  frame=null;
  if(!gesture)return;
  if(gesture.cancelled){reset();return;}
  if(!gesture.locked)return;
  const lift=reduced()?'':'transform';
  if(card.style.willChange!==lift){card.style.willChange=lift;under.classList?.toggle?.('peek',!!lift);lifted(!!lift);}
  const {dx,dy,width}=gesture,progress=eligible(gesture)?Math.min(1,Math.abs(dx)/(width*.33)):0;
  card.style.transform=reduced()?'':`translate3d(${dx}px,${dy*.2}px,0) rotate(${Math.max(-15,Math.min(15,dx/width*15))}deg) scale(1.02)`;
  keep.style.opacity=String(dx>0?progress:0);
  remove.style.opacity=String(dx<0?progress:0);
  under.style.transform=reduced()?'':`scale(${.94+.06*progress})`;
 };
 const release=()=>{
  const previous=gesture;
  gesture=null;
  if(frame!==null)window.cancelAnimationFrame?.(frame);
  frame=null;
  card.style.willChange='';under.classList?.remove?.('peek');
  if(previous?.target.hasPointerCapture?.(previous.id))previous.target.releasePointerCapture(previous.id);
 };
 const reset=()=>{
  release();animation?.cancel();animation=null;dismissing=false;finished=Promise.resolve();
  card.style.transform='';card.style.willChange='';card.style.visibility='';lifted(false);
  keep.style.opacity='0';remove.style.opacity='0';under.style.transform=reduced()?'':'scale(.94)';
 };
 const animate=(transform,{duration=180,easing='ease-out'}={})=>{
  const start=card.style.transform||'none';
  animation?.cancel();animation=null;
  card.style.transform=transform;
  if(!reduced()&&card.animate){animation=card.animate([{transform:start},{transform:transform||'none'}],{duration,easing});finished=animation.finished.catch(()=>{});}
  else finished=Promise.resolve();
  return finished;
 };
 const dismiss=decision=>{
  if(dismissing)return finished;
  dismissing=true;const width=gesture?.width||cardWidth,flung=!!card.style.transform,duration=flung?FLING_MS:FLIGHT_MS,easing=flung?FLING_EASING:FLIGHT_EASING;release();
  const direction=decision==='keep'?1:-1;
  keep.style.opacity=decision==='keep'?'1':'0';remove.style.opacity=decision==='remove'?'1':'0';under.style.transform=reduced()?'':'scale(1)';
  const destination=reduced()?'':`translate3d(${Math.round(direction*width*1.3)}px,${Math.round((gesture?.dy||0)*.2)}px,0) rotate(${direction*16}deg)`;
  if(card.cloneNode&&card.parentNode){
   const outgoing=stillClonedVideos(card.cloneNode(true),card);
   outgoing.setAttribute('aria-hidden','true');outgoing.inert=true;
   for(const control of outgoing.querySelectorAll?.('button:not(.card-tool):not(#enlarge),a:not(.card-tool),input')||[])control.remove();
   for(const element of outgoing.querySelectorAll?.('[id]')||[])element.removeAttribute('id');
   outgoing.removeAttribute?.('id');outgoing.style.willChange='';outgoing.style.transform=reduced()?'':card.style.transform;
   outgoing.style.position='absolute';outgoing.style.inset='0';outgoing.style.pointerEvents='none';outgoing.style.zIndex='7';outgoing.classList?.add?.('lifted');
   card.parentNode.append(outgoing);
   card.style.visibility='hidden';lifted(false);
   const flight=outgoing.animate?.(reduced()?[{opacity:1},{opacity:0}]:[{transform:card.style.transform||'none',opacity:1,offset:0},{opacity:1,offset:.7},{transform:destination,opacity:0,offset:1}],{duration:reduced()?150:duration,easing:reduced()?'ease-out':easing});
   outgoing.style.transform=destination;outgoing.style.opacity='0';
   incoming?.cancel();incoming=null;
   if(!reduced()&&card.animate)incoming=card.animate([{transform:'scale(.95)'},{transform:'none'}],{duration,easing:'cubic-bezier(.2,.8,.2,1)'});
   finished=flight?flight.finished.catch(()=>{}).then(()=>outgoing.remove()):Promise.resolve(outgoing.remove());
   return finished;
  }
  return animate(destination,{duration,easing});
 };
 const springBack=(transform,always=false)=>{
  reset();
  if(!transform&&!always)return;
  card.style.transform=transform;if(transform)lifted(true);
  animate('').then(()=>{if(!gesture)lifted(false);});
 };
 const cancelGesture=()=>{
  if(!gesture)return;
  gesture.suppressClick();
  springBack(gesture.locked?card.style.transform:null);
 };
 const update=event=>{
  if(!gesture||event.pointerId!==gesture.id)return;
  const dx=event.clientX-gesture.x,time=event.timeStamp;
  if(Number.isFinite(time)){
   gesture.samples.push({dx,time});
   while(gesture.samples.length>1&&gesture.samples[0].time<time-80)gesture.samples.shift();
   const first=gesture.samples[0],elapsed=time-first.time;
   gesture.velocity=elapsed>=16?(dx-first.dx)/elapsed:0;
  }
  gesture.dx=dx;gesture.dy=event.clientY-gesture.y;
  if(!gesture.locked){
   if(Math.hypot(gesture.dx,gesture.dy)<10)return;
   if(Math.abs(gesture.dy)>=Math.abs(gesture.dx))gesture.cancelled=true;
   else {gesture.locked=true;gesture.target.setPointerCapture(gesture.id);}
  }
  gesture.suppressClick();
  if(!gesture.cancelled)event.preventDefault?.();
  if(frame===null){if(window.requestAnimationFrame)frame=window.requestAnimationFrame(paint);else paint();}
 };
 const finishGesture=event=>{
   if(!gesture||event.pointerId!==gesture.id)return;
   update(event);
   if(!gesture)return;
   const value=gesture,commit=!value.cancelled&&commits(value);
   if(commit){if(frame!==null)window.cancelAnimationFrame?.(frame);frame=null;paint();release();dismiss(value.dx>0?'keep':'remove');onDecide(value.dx>0?'keep':'remove');}
   else {
    springBack(card.style.transform,true);
    if(!playbackOnClick&&!value.locked&&Math.hypot(value.dx,value.dy)<10&&value.video){if(value.video.paused)value.video.play().catch(()=>{});else value.video.pause();}
   }
 };
 window.addEventListener?.('pointermove',update,true);
 window.addEventListener?.('pointerup',finishGesture,true);
 window.addEventListener?.('pointercancel',event=>{if(gesture&&event.pointerId===gesture.id)cancelGesture();},true);
 for(const target of targets){
  let suppressClick=false;
  target.addEventListener('pointerdown',event=>{
   if(event.target.closest?.('[data-video-control]')||gesture||dismissing||!canSwipe()||event.isPrimary===false||event.button!==0)return;
   suppressClick=false;animation?.cancel();animation=null;incoming?.finish?.();incoming=null;
   cardWidth=card.getBoundingClientRect?.().width||card.offsetWidth||300;
   gesture={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,samples:Number.isFinite(event.timeStamp)?[{dx:0,time:event.timeStamp}]:[],velocity:0,width:cardWidth,target,suppressClick:()=>{suppressClick=true;},video:event.target.tagName==='VIDEO'?event.target:null,locked:false};
   if(event.pointerType==='mouse')target.setPointerCapture(event.pointerId);
  });
  target.addEventListener('pointermove',update);
  target.addEventListener('pointerup',finishGesture);
  for(const type of ['pointercancel'])target.addEventListener(type,event=>{if(gesture&&event.pointerId===gesture.id){suppressClick=true;cancelGesture();}});
  target.addEventListener('touchmove',event=>{if(gesture?.locked&&event.cancelable)event.preventDefault();},{passive:false});
  target.addEventListener('lostpointercapture',event=>{if(event.target===target&&gesture?.id===event.pointerId){suppressClick=true;reset();}});
  target.addEventListener('click',event=>{
   if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;return;}
   if(event.target.closest?.('button, [data-video-control]'))return;
   const video=playbackOnClick&&target.querySelector?.('video');
   if(video&&!video.controls){if(video.paused)video.play().catch(()=>{});else video.pause();}
  });
 }
 reset();
 return {reset,dismiss,get finished(){return finished;},get dragging(){return !!gesture;}};
}

function reviewPreviewWindow(items,current,compact=false) {
 const index=items.findIndex(item=>item.mediaKey===current?.mediaKey),photos=[],videos=[],limit=compact?2:3;
 if(index>=0)for(let position=index+1;position<items.length&&(photos.length<limit||videos.length<2);position++){const item=items[position];if(item.type==='video'){if(videos.length<2)videos.push(item);}else if(photos.length<limit)photos.push(item);}
 return [...(current?[current]:[]),...photos,...videos];
}
const reviewURLStale = (item,now=Date.now()) => !item.urlFetchedAt||now-item.urlFetchedAt>=40*60*1000;
function createReviewPreloader({createImage,createVideo,videoURL,previewURL,playbackURL}) {
 const entries=new Map(),links=new Map(),warmed=new Map();
 let warmKey=null,videosHeld=false;
 const active=entry=>entries.get(entry.key)===entry;
 const activeLink=entry=>links.get(entry.key)===entry;
 function disposeVideo(entry){
  const video=warmed.get(entry.source);
  if(!video)return;
  warmed.delete(entry.source);video.pause();video.removeAttribute('src');video.removeAttribute('poster');video.load();
 }
 function dispose(entry){if(entry.image){entry.image.onload=entry.image.onerror=null;entry.image.src='';}}
 function removeLink(entry){links.delete(entry.key);disposeVideo(entry);}
 function warm(entry){
  if(videosHeld||!activeLink(entry)||entry.key!==warmKey||!entry.source)return;
  const preview=entries.get(entry.key)?.preview,existing=warmed.get(entry.source);
  if(existing){if(preview)existing.poster=preview;return;}
  const video=createVideo();warmed.set(entry.source,video);
  video.preload='auto';video.muted=true;video.playsInline=true;if(preview)video.poster=preview;video.src=entry.source;
  video.onerror=()=>{if(activeLink(entry)&&warmed.get(entry.source)===video)removeLink(entry);};
  video.load();
 }
 function update(items,current,{width,height,compact=false}={}) {
  const windowItems=reviewPreviewWindow(items,current,compact),ahead=windowItems.filter(item=>item.mediaKey!==current?.mediaKey);
  const photos=ahead.filter(item=>item.type!=='video'),videos=ahead.filter(item=>item.type==='video');
  warmKey=videos[0]?.mediaKey||null;
  for(const entry of links.values())if(entry.key!==warmKey&&entry.key!==current?.mediaKey)disposeVideo(entry);
  const wanted=new Map();
  for(const item of [...(current?[current]:[]),...photos,...videos]){
   try{const url=previewURL(item.thumbUrl,{width,height});wanted.set(item.mediaKey,{item,url});}catch{}
  }
  for(const [key,entry] of entries)if(wanted.get(key)?.url!==entry.preview){entries.delete(key);dispose(entry);}
  for(const [key,entry] of links)if(!wanted.has(key))removeLink(entry);
  for(const {item,url} of [...photos,...videos].map(item=>wanted.get(item.mediaKey)).filter(Boolean)){
   if(entries.has(item.mediaKey)&&(item.type!=='video'||links.has(item.mediaKey))){warm(links.get(item.mediaKey)||{});continue;}
   const previous=entries.get(item.mediaKey);if(previous)dispose(previous);
   const entry={key:item.mediaKey,preview:url};entries.set(entry.key,entry);
   Promise.resolve().then(async()=>{
    if(!active(entry))return;
    const image=createImage();entry.image=image;image.src=url;
    const decoded=image.decode();
    let link=links.get(item.mediaKey);
    if(item.type==='video'&&!link){
     link={key:item.mediaKey};links.set(link.key,link);
     link.request=(async()=>{
      const result=await videoURL(item.mediaKey);
      if(!activeLink(link))return;
      const source=playbackURL(result.url);link.source=source;warm(link);
      return source;
     })().catch(()=>{if(activeLink(link)){removeLink(link);const preview=entries.get(link.key);if(preview){entries.delete(link.key);dispose(preview);}}});
    }
    if(link)warm(link);
    await Promise.all([decoded,link?.request]);
    if(active(entry))entry.ready=true;
   }).catch(()=>{if(active(entry)){entries.delete(entry.key);dispose(entry);}});
  }
 }
 function holdVideos(held){videosHeld=held;const link=links.get(warmKey);if(!held&&link)warm(link);}
 return {update,holdVideos,take(key,url){const entry=entries.get(key);if(!entry?.ready||entry.preview!==url)return null;entries.delete(key);return entry.image;},cancelVideos(){warmKey=null;for(const entry of links.values())disposeVideo(entry);},takeVideo(key){const source=links.get(key)?.source,video=warmed.get(source);if(!video)return null;warmed.delete(source);return video;},videoSource:key=>links.get(key)?.source||links.get(key)?.request,clear(items=[],size){const wanted=new Map();for(const item of items){try{wanted.set(item.mediaKey,previewURL(item.thumbUrl,size));}catch{}}for(const [key,entry] of entries){if(wanted.get(key)===entry.preview)continue;entries.delete(key);dispose(entry);}for(const [key,entry] of links)if(!wanted.has(key))removeLink(entry);}};
}

function smallerVideoURL(value,compact=false){
 const url=new URL(value);
 url.pathname=url.pathname.replace(/=.+$/,'')+(compact?'=m18':'=m22');
 return url.href;
}
function playVideo(video){return video.play().catch(error=>{if(video.muted||error?.name!=='NotAllowedError')throw error;video.muted=true;return video.play();});}
function setVideoMuted(video,muted){const playing=!video.paused;video.muted=muted;if(playing&&video.paused){video.muted=true;video.play().catch(()=>{});}}
function startProgressiveVideo({video,url,compact,createVideo,onSwap,onError,onFallback=()=>{},isActive,held=()=>false,runOutAfter=2000,runOuts=0}){
 let original=null,finished=false,seeking=false,wantsPlayback=true,seekIssued=0,retries=0,retryAt=0,unstick=()=>{},chaseUntil=0,giveUp=()=>{};
 const release=element=>{element.pause();element.removeAttribute('src');element.load();if(element!==video)element.remove();};
 const cancel=()=>{finished=true;if(original){release(original);original=null;}};
 video.cancelUpgrade=cancel;video.upgradeActive=()=>!finished;
 video.addEventListener('play',()=>{wantsPlayback=true;});
 video.addEventListener('pause',()=>{if(!video.error)wantsPlayback=false;});
 const fallback=()=>{
  if(finished||!isActive())return;
  const time=video.currentTime,paused=!wantsPlayback,restoreTime=video.dataset.resumeReady!=='pending';
  cancel();video.onerror=onError;onFallback();
  video.addEventListener('loadedmetadata',()=>{if(isActive()&&restoreTime&&Number.isFinite(time))video.currentTime=time;},{once:true});
  video.src=url;video.load();if(!paused)playVideo(video).catch(()=>{});
 };
 const watchRunOut=(element,lower)=>{
  let timer=0,done=false,last=element.currentTime,armedAt=0,pending=null;
  const abort=()=>{if(!pending)return;release(pending);pending=null;done=false;};
  const cancelPrevious=element.cancelUpgrade;
  element.cancelUpgrade=()=>{done=true;clearTimeout(timer);if(pending){release(pending);pending=null;}cancelPrevious?.();};
  const downgrade=time=>{
   const next=createVideo();pending=next;
   next.hidden=false;Object.assign(next.style,{position:'absolute',inset:'0',opacity:'0',pointerEvents:'none'});element.parentNode.append(next);
   next.preload='auto';next.muted=true;next.playsInline=true;next.loop=element.loop;
   let starting=false;
   const show=()=>{
    if(pending!==next||!isActive())return;
    pending=null;const muted=element.muted;element.pause();setVideoMuted(next,muted);next.volume=element.volume;next.playbackRate=element.playbackRate;
    next.style.position='';next.style.inset='';next.style.opacity='';next.style.pointerEvents='';next.onerror=onError;next.dataset.resumeReady='ready';
    onSwap(next);release(element);onFallback();
    if(runOuts<2)startProgressiveVideo({video:next,url,compact,createVideo,onSwap,onError,onFallback,isActive,held,runOutAfter,runOuts:runOuts+1});
   };
   const ready=()=>{
    if(pending!==next||!isActive()||starting||next.seeking||next.readyState<2||Math.abs(next.currentTime-time)>.25)return;
    starting=true;next.play().then(()=>{if(next.requestVideoFrameCallback)next.requestVideoFrameCallback(show);else show();}).catch(show);
   };
   next.addEventListener('loadedmetadata',()=>{if(pending===next)next.currentTime=time;},{once:true});
   for(const event of ['seeked','canplay'])next.addEventListener(event,ready);
   next.onerror=()=>{if(pending===next){release(next);pending=null;}};
   next.src=lower;next.load();
  };
  const check=()=>{
   timer=0;
   if(done||!isActive()||!element.src||element.paused||element.ownerDocument?.hidden||element.upgradeActive?.())return;
   if(Date.now()-armedAt>runOutAfter*2){arm();return;}
   done=true;downgrade(element.currentTime);
  };
  const arm=()=>{if(done||!isActive())return;clearTimeout(timer);armedAt=Date.now();timer=setTimeout(check,runOutAfter);};
  element.addEventListener('timeupdate',()=>{if(element.currentTime!==last){last=element.currentTime;abort();arm();}});
  for(const event of ['play','playing'])element.addEventListener(event,arm);
  element.addEventListener('pause',()=>{clearTimeout(timer);timer=0;abort();});
  if(!element.paused)arm();
 };
 const prepare=()=>{
  if(finished||original||!isActive())return;
  if(held()){retryAt=retryAt||Date.now();return;}
  original=createVideo();const full=original;
  full.hidden=false;Object.assign(full.style,{position:'absolute',inset:'0',opacity:'0',pointerEvents:'none'});video.parentNode.append(full);full.preload='auto';full.muted=true;full.loop=video.loop;full.playsInline=true;full.poster=video.poster;
  let seekStart=0,seekAttempts=0,frameQueued=false,chasing=false,reissued=false,behind=0,seekTook=0;
  const abandon=()=>{if(finished||original!==full)return;release(full);original=null;seeking=false;chasing=false;chaseUntil=0;if(retries<3)retryAt=Date.now()+5000*2**retries++;};
  const bufferedTo=time=>{const ranges=full.buffered;for(let index=0;index<(ranges?.length||0);index++)if(ranges.start(index)<=time&&time<=ranges.end(index))return ranges.end(index);return time;};
  const caughtUp=()=>{frameQueued=false;align();};
  const onFrame=callback=>{if(full.requestVideoFrameCallback)full.requestVideoFrameCallback((now,frame)=>callback(frame?.mediaTime));else full.addEventListener('timeupdate',()=>callback(),{once:true});};
  const position=frameTime=>Number.isFinite(frameTime)?frameTime:full.currentTime;
  const swap=frameTime=>{
   if(finished||original!==full||!isActive())return;
   const ahead=position(frameTime)-video.currentTime;
   if(Math.abs(ahead)>.08){if(!video.paused&&video.playbackRate>0&&Math.abs(ahead)<=1.6){chase(frameTime);return;}chasing=false;chaseUntil=0;full.pause();align();return;}
   const muted=video.muted;if(video.paused)full.pause();video.pause();setVideoMuted(full,muted);full.playbackRate=video.playbackRate;full.hidden=false;full.style.position='';full.style.inset='';full.style.opacity='';full.style.pointerEvents='';
   finished=true;original=null;chasing=false;chaseUntil=0;full.onerror=onError;full.dataset.resumeReady='ready';
   const lower=video.src;onSwap(full);release(video);if(lower)watchRunOut(full,lower);
  };
  const chase=frameTime=>{
   if(finished||original!==full||!isActive())return;
   const ahead=position(frameTime)-video.currentTime;
   if(!chasing){chasing=true;chaseUntil=Date.now()+8000;}
   if(video.paused||video.playbackRate<=0||Math.abs(ahead)>1.6){chasing=false;chaseUntil=0;full.pause();full.playbackRate=video.playbackRate;align();return;}
   if(Math.abs(ahead)<=.04){swap(frameTime);return;}
   const rate=video.playbackRate*(ahead<0?1.5:.75);
   if(full.playbackRate!==rate)full.playbackRate=rate;
   if(full.paused)full.play().catch(abandon);
   onFrame(chase);
  };
  giveUp=abandon;
  const align=()=>{
   if(finished||original!==full||!isActive()||full.readyState<2||seeking||chasing)return;
   const ahead=full.currentTime-video.currentTime,playing=!video.paused&&video.playbackRate>0;
   if(playing&&seekAttempts>=1&&ahead<-.04&&ahead>=-1.5&&bufferedTo(full.currentTime)-full.currentTime>=.5){chase();return;}
   if(playing&&ahead>.04&&ahead<=1.6){
    if(!frameQueued){frameQueued=true;if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(caughtUp);else video.addEventListener('timeupdate',caughtUp,{once:true});}
    return;
   }
   if(Math.abs(ahead)>.04){
    if(seekAttempts>=8){abandon();return;}
    behind=playing&&ahead<-.04?behind+1:0;const lead=behind>=4?Math.min(1,seekTook*video.playbackRate+.1):0;
    seekAttempts++;seekStart=full.currentTime;seeking=true;seekIssued=Date.now();full.currentTime=video.currentTime+lead;return;
   }
   const paused=video.paused;
   full.playbackRate=video.playbackRate;full.volume=video.volume;
   if(paused){swap();return;}
   const started=full.play();if(full.requestVideoFrameCallback){started.catch(abandon);onFrame(swap);}else started.then(()=>swap(),abandon);
  };
  full.addEventListener('seeked',()=>{if(!seeking)return;seeking=false;seekTook=(Date.now()-seekIssued)/1000;if(reissued){reissued=false;seekAttempts=1;}if(Math.abs(full.currentTime-seekStart)<.001&&Math.abs(full.currentTime-video.currentTime)>.04){abandon();return;}align();});
  unstick=()=>{if(seekAttempts>=8){abandon();return;}seekAttempts++;reissued=true;seekStart=full.currentTime;seekIssued=Date.now();full.currentTime=video.currentTime;};
  full.addEventListener('canplay',align);
  full.onerror=()=>{release(full);original=null;};
  full.src=compact?smallerVideoURL(url):url;full.load();
 };
 video.onerror=fallback;
 let smallRetried=false,stallPending=false,lastTime=video.currentTime,movedAt=0;
 video.addEventListener('timeupdate',()=>{if(video.currentTime!==lastTime){lastTime=video.currentTime;movedAt=Date.now();}});
 const stall=()=>{
  if(finished||!isActive())return;
  if(!smallRetried&&video.readyState<2){
   smallRetried=true;const time=video.currentTime,restoreTime=video.dataset.resumeReady!=='pending';
   video.addEventListener('loadedmetadata',()=>{if(isActive()&&restoreTime&&time>0)video.currentTime=time;},{once:true});
   video.load();if(wantsPlayback)playVideo(video).catch(()=>{});return;
  }
  fallback();
 };
 video.addEventListener('stalled',()=>{
  if(finished||!isActive())return;
  if(!video.paused&&Date.now()-movedAt<1000){stallPending=true;return;}
  stall();
 });
 video.addEventListener('waiting',()=>{if(stallPending){stallPending=false;stall();}});
 video.addEventListener('progress',()=>{stallPending=false;});
 for(const event of ['loadeddata','playing','timeupdate'])video.addEventListener(event,prepare,{once:true});
 video.addEventListener('timeupdate',()=>{
  if(finished||!isActive())return;
  const now=Date.now();
  if(original&&seeking&&now-seekIssued>4000){unstick();return;}
  if(original&&chaseUntil&&now>chaseUntil){chaseUntil=0;giveUp();return;}
  if(!original&&retryAt&&now>=retryAt&&!video.paused&&!held()){retryAt=0;prepare();}
 });
 const small=smallerVideoURL(url,compact);
 if(video.src!==small){video.src=small;playVideo(video).catch(()=>{});}
 else if(video.paused)playVideo(video).catch(()=>{});
 if(video.readyState>=2)prepare();
 return cancel;
}

function loopOnEnd(video,isActive){
 video.loop=false;
 video.addEventListener('ended',()=>{if(!isActive())return;video.currentTime=0;playVideo(video).catch(()=>{});});
}

function watchVideoLoading({video,isActive,onReady}){
 let time=video.currentTime;
 const ready=()=>{if(isActive())onReady();};
 for(const event of ['loadeddata','canplay','playing'])video.addEventListener(event,ready);
 video.addEventListener('timeupdate',()=>{const next=video.currentTime;if(next>time)ready();time=next;});
 if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(ready);
 if(video.readyState>=2)ready();
}

function previewURL(value,{width=512,height=512,dpr=1,mobile=false,expanded=false,authuser='0',video=false}={}) {
 const url=new URL(value);
 if(url.protocol!=='https:'||!(url.hostname==='photos.fife.usercontent.google.com'||url.hostname.endsWith('.googleusercontent.com'))||url.username||url.password||url.port)throw Error('Unexpected preview host.');
 if(!video){
  const ratio=Math.min(dpr||1,2),pixels=Math.ceil(Math.max(width,height)*ratio);
  const bucket=[512,768,1024,1600].find(size=>size>=pixels)||1600;
  const size=mobile?Math.min(bucket,1024):bucket;
  url.pathname=url.pathname.replace(/=.+$/,'')+(expanded?`=w${Math.min(Math.ceil(width*ratio),mobile?1024:Infinity)}-h${Math.min(Math.ceil(height*ratio),mobile?1024:Infinity)}-k-no`:`=w${size}-h${size}-k-no`);
  url.searchParams.set('authuser',authuser);
 }
 return url.href;
}
function cardPreviewURL(value,{width,height,authuser='0'}={}) {
 const url=new URL(previewURL(value,{authuser}));
 url.pathname=url.pathname.replace(/=.+$/,'')+`=w${Math.max(1,Math.ceil(width))}-h${Math.max(1,Math.ceil(height))}-k-no`;
 return url.href;
}
function reusablePreview(element,source) {
 return element?.src===source&&element.complete&&element.naturalWidth>0?element:null;
}
function pendingPreview(element,source) {
 return element?.src===source&&!element.complete?element:null;
}
function createPreloadBuffer({load,source=item=>item.thumbUrl,concurrency=2,size=3}) {
 const entries=new Map();let active=0;
 function pump(){
  for(const entry of entries.values()){
   if(active>=concurrency)break;
   if(entry.state!=='queued')continue;
   entry.state='loading';active++;
   Promise.resolve().then(()=>load(entry.item,entry.controller.signal,entry.source)).then(el=>{
    if(entries.get(entry.key)===entry&&!entry.controller.signal.aborted){entry.el=el;entry.state='ready';}
   },()=>{entry.state='failed';}).finally(()=>{active--;pump();});
  }
 }
 const drop=(key,entry)=>{entry.controller.abort();if(entry.el)entry.el.src='';entries.delete(key);};
 const current=(entry,item)=>entry.item.thumbUrl===item.thumbUrl&&entry.source===source(item);
 function update(items,previous,keep){
  const wanted=items.slice(0,size),keys=new Set(wanted.map(item=>item.mediaKey));
  if(previous)keys.add(previous);
  if(keep)keys.add(keep);
  for(const [key,entry] of entries)if(!keys.has(key))drop(key,entry);
  for(const item of wanted){
   const entry=entries.get(item.mediaKey);
   if(entry&&entry.state!=='failed'&&current(entry,item))continue;
   if(entry)drop(item.mediaKey,entry);
   entries.set(item.mediaKey,{key:item.mediaKey,item,source:source(item),state:'queued',controller:new AbortController()});
  }
  pump();
 }
 function clear(items=[]){const wanted=new Map(items.map(item=>[item.mediaKey,item]));for(const [key,entry] of entries){if(wanted.has(key)&&current(entry,wanted.get(key)))continue;drop(key,entry);}}
 return {update,clear,retain(item,el){const existing=entries.get(item.mediaKey);if(existing?.el!==el)existing?.controller.abort();entries.set(item.mediaKey,{key:item.mediaKey,item,source:el.src,el,state:'ready',controller:new AbortController()});},get:key=>entries.get(key)?.state==='ready'?entries.get(key).el:null,take(key,wanted){const entry=entries.get(key);if(entry?.state!=='ready'||(wanted!==undefined&&entry.source!==wanted))return null;entries.delete(key);return entry.el;},entries};
}
function createWriteQueue({write,snapshot,committed,error=()=>{}}) {
 let pending=false,running=null;
 function flush(){
  if(running)return running;
  if(!pending)return Promise.resolve();
  running=Promise.resolve().then(async()=>{
   while(pending){
    pending=false;
    try{const value=snapshot();const started=Date.now();const saved=await write(value);committed(saved,value,Date.now()-started);}
    catch(failure){pending=true;error(failure);break;}
   }
  }).finally(()=>{running=null;});
  return running;
 }
 return {enqueue(){pending=true;return flush();},flush,get flushing(){return !!running;},get pending(){return pending;}};
}

function createLocalThumbnails({refresh,stale,scope=()=>'',placeholder}) {
 const cache=new Map(),pending=new Map(),retriedKeys=new Set(),failedKeys=new Map();
 async function resolve(item,force=false) {
  const key=`${scope()}:${item.mediaKey}`;
  const failure=failedKeys.get(key);
  if(failure&&item.thumbUrl&&item.thumbUrl!==failure.thumbUrl&&item.thumbUrl!==failure.originalUrl&&!stale(item)){failedKeys.delete(key);retriedKeys.delete(key);cache.delete(key);}
  else if(failure)throw Error('Thumbnail unavailable');
  const local=cache.get(key);
  if(pending.has(key)){const active=pending.get(key);if(!force&&item.thumbUrl&&item.thumbUrl!==active.item.thumbUrl&&!stale(item)){retriedKeys.delete(key);cache.set(key,item);return item;}return active.request;}
  if(!force&&local&&!stale(local))return local;
  if(!force&&!stale(item)&&item.thumbUrl){cache.set(key,item);if(cache.size>512)cache.delete(cache.keys().next().value);return item;}
  if(force)retriedKeys.add(key);
  const request=Promise.resolve().then(()=>refresh(item)).then(fresh=>{if(cache.has(key)&&cache.get(key)!==local)return cache.get(key);cache.delete(key);cache.set(key,fresh);if(cache.size>512)cache.delete(cache.keys().next().value);return fresh;},error=>{if(!cache.has(key)||cache.get(key)===local)retriedKeys.delete(key);throw error;});
  pending.set(key,{request,item});
  try{return await request;}finally{pending.delete(key);}
 }
 function bind(image,item,source,{retryLookup=false}={}) {
  const key=`${scope()}:${item.mediaKey}`;
  let refreshing=false,failed=false,currentSource,currentItem;
  const fail=(remember=true)=>{if(failed)return;failed=true;if(remember&&currentItem&&cache.get(key)?.thumbUrl===currentItem.thumbUrl)failedKeys.set(key,{thumbUrl:currentItem.thumbUrl,originalUrl:item.thumbUrl});image.onerror=null;placeholder(image,item);};
  image.onload=()=>{retriedKeys.delete(key);};
  image.onerror=async()=>{
   if(failed||refreshing)return;
   if(retriedKeys.has(key)&&!pending.has(key)){
    const fresh=cache.get(key),nextSource=fresh&&source(fresh);
    if(failedKeys.has(key)||!nextSource||nextSource===currentSource)fail();
    else{currentItem=fresh;currentSource=nextSource;image.src=nextSource;}
    return;
   }
   refreshing=true;
   try{const fresh=await resolve(item,true);if(!failed&&image.isConnected!==false){const nextSource=source(fresh);if(nextSource===currentSource)fail();else{currentItem=fresh;currentSource=nextSource;image.src=nextSource;}}}catch{fail(false);}finally{refreshing=false;}
  };
  const ready=resolve(item).then(fresh=>{if(failedKeys.has(key)){fail();return;}if(!failed){currentItem=fresh;currentSource=source(fresh);image.src=currentSource;}},async()=>{if(retryLookup){try{const fresh=await resolve(item,true);currentItem=fresh;currentSource=source(fresh);image.src=currentSource;return;}catch{}}fail(false);});
  return ready;
 }
 return {resolve,bind};
}

function createSessionStorageCounter() {
 const excluded=new Set(),seen=new Set();
 function total(items){
  let bytes=0;
  for(const item of items){
   const key=item.mediaKey,trashed=item.state==='in_trash';
   if(seen.size!==seen.add(key).size&&trashed)excluded.add(key);
   if(item.decision!=='remove'){if(!trashed&&excluded.size)excluded.delete(key);continue;}
   if(item.needsPreview||excluded.size&&excluded.has(key))continue;
   const size=item.takesUpSpace===false?0:item.spaceTaken??item.size;
   if(Number.isFinite(size)&&size>=0)bytes+=size;
  }
  return bytes;
 }
 return {total,reset(submittedItems){for(const item of submittedItems)if(item.decision==='remove'||item.state==='in_trash')excluded.add(item.mediaKey);}};
}
function formatStorageBytes(bytes){const fit=value=>[2,1,0].map(digits=>value.toFixed(digits)).find((text,index)=>Math.abs(text)<10**(index+1))??value.toFixed(0),megabytes=fit(bytes/1e6),kilobytes=Math.round(bytes/1e3);if(Math.abs(kilobytes)<1000)return kilobytes+' KB';return bytes<1e9&&Math.abs(megabytes)<1000?megabytes+' MB':fit(bytes/1e9)+' GB';}
function createStorageCapsule({document,window,root,element,isVisible}) {
 const renderingWindow=document.defaultView||window;
 const style=document.createElement('style');style.textContent='.content .storage-counter{position:absolute;left:50%;top:50%;width:auto;height:auto;min-width:0;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:2px;padding:0;background:none;border-radius:0;overflow:visible;line-height:1;z-index:3;font-variant-numeric:tabular-nums;cursor:default}.sv-label{font:600 10px/12px var(--ps-font);letter-spacing:.09em;text-transform:uppercase;color:var(--ps-label2)}.sv-value{display:flex;align-items:baseline;color:var(--ps-label);font:700 21px/24px var(--ps-font);letter-spacing:-.01em;transition:color .9s ease}.sv-value.sv-bump{color:var(--sv-flash);transition:none}.sv-digits{display:flex}.sv-col{display:inline-block;height:24px;overflow:hidden;position:relative}.sv-strip{display:flex;flex-direction:column;transform:translateY(calc(var(--n,0) * -24px));transition:transform .7s cubic-bezier(.2,.9,.25,1);transition-delay:calc(var(--i,0) * 35ms)}.sv-strip span,.sv-sep{display:block;height:24px}.sv-unit{font:600 12px/24px var(--ps-font);color:var(--ps-label2);margin-left:3px;letter-spacing:.02em}.sv-delta{position:absolute;left:50%;top:0;white-space:nowrap;font:700 10px/12px var(--ps-font);letter-spacing:.06em;text-transform:uppercase;color:var(--sv-flash);opacity:0;pointer-events:none;transform:translateX(-50%)}.sv-delta.sv-free{color:var(--ps-label2)}.sv-delta.sv-go{animation:sv-note 1.7s cubic-bezier(.2,.8,.2,1) forwards}.storage-counter.sv-noting .sv-label{animation:sv-hide 1.7s ease forwards}@keyframes sv-note{0%{opacity:0;transform:translate(-50%,5px)}12%{opacity:1;transform:translate(-50%,0)}80%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-4px)}}@keyframes sv-hide{0%{opacity:1}8%{opacity:0;transform:translateY(-4px)}84%{opacity:0;transform:translateY(5px)}100%{opacity:1;transform:none}}.storage-counter{--sv-flash:var(--ps-accent)}@media(prefers-reduced-motion:reduce){.sv-strip,.sv-value{transition:none}}.content>header:first-child{position:relative;height:56px}.content header #settings{margin-right:auto}.queue-size{color:var(--ps-label2);font-variant-numeric:tabular-nums}.trash-badge{background:var(--ps-destructive)}';root.append(style);
 const label=document.createElement('span'),value=document.createElement('span'),digits=document.createElement('span'),unit=document.createElement('span'),delta=document.createElement('span');
 label.className='sv-label';label.textContent='Freed';value.className='sv-value';digits.className='sv-digits';unit.className='sv-unit';delta.className='sv-delta';
 for(const part of [label,value,delta])part.setAttribute('aria-hidden','true');value.append(digits,unit);element.append(label,value,delta);
 element.setAttribute('role','img');element.title='Storage your deletions free in Google Photos this session. Items Google stores free, like most photos backed up before June 2021, add nothing.';
 const motion=renderingWindow.matchMedia?.('(prefers-reduced-motion: reduce)');
 let shape='',target=0,initialized=false,bumpTimer=null;
 const parts=bytes=>{const text=formatStorageBytes(bytes),space=text.lastIndexOf(' ');return [text.slice(0,space),text.slice(space+1)];};
 function build(number){
  digits.replaceChildren();
  [...number].forEach((character,index)=>{
   if(!/\d/.test(character)){const separator=document.createElement('span');separator.className='sv-sep';separator.textContent=character;digits.append(separator);return;}
   const column=document.createElement('span'),strip=document.createElement('span');column.className='sv-col';strip.className='sv-strip';
   for(let digit=0;digit<10;digit++){const cell=document.createElement('span');cell.textContent=String(digit);strip.append(cell);}
   strip.style.setProperty('--i',String(number.length-1-index));column.append(strip);digits.append(column);
  });
 }
 function show(bytes,animate){
  const [number,suffix]=parts(bytes),pattern=number.replace(/\d/g,'0');
  unit.textContent=suffix;value.dataset.text=number+' '+suffix;
  if(pattern!==shape){shape=pattern;build(number);if(animate){void digits.offsetWidth;}}
  const strips=digits.querySelectorAll?.('.sv-strip')||[];let position=0;
  for(const character of number){if(!/\d/.test(character))continue;const strip=strips[position++];if(!strip)continue;if(!animate){strip.style.transition='none';strip.style.setProperty('--n',character);void strip.offsetWidth;strip.style.transition='';}else strip.style.setProperty('--n',character);}
 }
 function float(text,free){
  delta.textContent=text;delta.classList.toggle('sv-free',free);delta.classList.remove('sv-go');element.classList.remove('sv-noting');
  if(motion?.matches)return;void delta.offsetWidth;delta.classList.add('sv-go');element.classList.add('sv-noting');
 }
 return {update(bytes,{animate=initialized,delta:added=0,free=false}={}){
  const changed=bytes!==target,moving=animate&&!motion?.matches;
  if(changed||!initialized){target=bytes;show(bytes,moving&&initialized);}
  initialized=true;
  element.setAttribute('aria-label',`${formatStorageBytes(bytes)} approximate storage freed this session`);
  if(moving&&changed&&added>0){float('+'+formatStorageBytes(added),false);value.classList.add('sv-bump');renderingWindow.clearTimeout?.(bumpTimer);bumpTimer=renderingWindow.setTimeout?.(()=>value.classList.remove('sv-bump'),60);}
  else if(moving&&free)float('Stored free',true);
 },reset(){target=-1;delta.classList.remove('sv-go');element.classList.remove('sv-noting');this.update(0,{animate:false});}};
}

const statsFormatters=new Map();
function statsDayKey(time,timeZone) {
 const id=timeZone||'';
 if(!statsFormatters.has(id))statsFormatters.set(id,new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}));
 const parts=Object.fromEntries(statsFormatters.get(id).formatToParts(new Date(time)).map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
function statsDayRange(now,count=30,timeZone) {
 const [year,month,day]=statsDayKey(now,timeZone).split('-').map(Number);
 return Array.from({length:count},(_,index)=>new Date(Date.UTC(year,month-1,day-(count-1-index))).toISOString().slice(0,10));
}
const statsBytes=item=>{const bytes=item.takesUpSpace===false?0:item.spaceTaken??item.size;return Number.isFinite(bytes)&&bytes>=0?bytes:0;};
function reviewStatistics(state,{now=Date.now(),timeZone,extra=[],days=30}={}) {
 const keys=statsDayRange(now,days,timeZone),index=new Map(keys.map((key,position)=>[key,position]));
 const rows=keys.map(key=>({key,keep:0,remove:0,freed:0,marked:0}));
 const dayKeys=new Map(),dayKey=time=>{const bucket=Math.floor(time/900000);let key=dayKeys.get(bucket);if(key===undefined){key=statsDayKey(time,timeZone);dayKeys.set(bucket,key);}return key;};
 const slot=time=>{if(!Number.isFinite(time))return -1;const key=dayKey(time);if(key<keys[0])return -1;return key>keys.at(-1)?keys.length-1:index.get(key);};
 let kept=0,trashed=0,markedInWindow=0,freedInWindow=0;
 const realTrashed=[],extraTrashed=[],marked=[],waiting=[];
 const visit=(item,synthetic)=>{
  if(item.decision!=='keep'&&item.decision!=='remove')return;
  const day=slot(item.lastDecisionAt);
  if(item.decision==='keep'){kept++;if(day>=0)rows[day].keep++;return;}
  trashed++;marked.push(item);if(day>=0)rows[day].remove++;
  const bytes=statsBytes(item);if(day>=0){rows[day].marked+=bytes;markedInWindow+=bytes;}
  if(item.state==='in_trash'){(synthetic?extraTrashed:realTrashed).push(item);const freedDay=slot(item.trashedAt??item.lastDecisionAt);if(freedDay>=0){rows[freedDay].freed+=bytes;freedInWindow+=bytes;}}
  else if(!item.needsPreview)waiting.push(item);
 };
 for(const item of state.items||[])visit(item,false);
 for(const item of extra)visit(item,true);
 const realStorage=reviewStorage(realTrashed),surplus=Math.max(0,(state.lifetimeFreed||0)-realStorage.bytes);
 const freed={bytes:realStorage.bytes+surplus+reviewStorage(extraTrashed).bytes,unknown:surplus?0:realStorage.unknown+reviewStorage(extraTrashed).unknown};
 const markedTotal=reviewStorage(marked).bytes+surplus,waitingStorage=reviewStorage(waiting);
 let freedRunning=freed.bytes-freedInWindow,markedRunning=markedTotal-markedInWindow;
 for(const row of rows){freedRunning+=row.freed;markedRunning+=row.marked;row.freed=freedRunning;row.marked=Math.max(markedRunning,freedRunning);}
 return {reviewed:kept+trashed,kept,trashed,freed,marked:{bytes:markedTotal},waiting:{count:waiting.length,bytes:waitingStorage.bytes,unknown:waitingStorage.unknown},days:rows};
}
function statsDayLabel(key) {
 return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
}
function statsCount(value) {
 return value>=10000?new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(value):value.toLocaleString();
}
function statsNiceStep(value) {
 const power=10**Math.floor(Math.log10(value)),fraction=value/power;
 return (fraction<=1?1:fraction<=2?2:fraction<=2.5?2.5:fraction<=5?5:10)*power;
}
function statsTicks(max,{bytes=false}={}) {
 if(!(max>0))return [0];
 let step=statsNiceStep(max/2);
 if(!bytes)step=Math.max(1,Math.ceil(step));
 return [0,step,step*2];
}
function reviewStatsSummary(stats) {
 const window=stats.days.reduce((total,day)=>({keep:total.keep+day.keep,remove:total.remove+day.remove}),{keep:0,remove:0});
 const busiest=stats.days.reduce((best,day)=>day.keep+day.remove>best.keep+best.remove?day:best,stats.days[0]);
 const reviews=window.keep+window.remove;
 const first=stats.days[0],last=stats.days.at(-1);
 return {
  reviews:reviews?`Reviews per day over the last ${stats.days.length} days: ${reviews.toLocaleString()} reviewed, ${window.keep.toLocaleString()} kept and ${window.remove.toLocaleString()} marked for Trash. Busiest day ${statsDayLabel(busiest.key)} with ${(busiest.keep+busiest.remove).toLocaleString()}.`:`No reviews in the last ${stats.days.length} days.`,
  storage:`Storage over the last ${stats.days.length} days: freed grew from ${formatStorageBytes(first.freed)} to ${formatStorageBytes(last.freed)}, and marked for Trash grew from ${formatStorageBytes(first.marked)} to ${formatStorageBytes(last.marked)}.`
 };
}
const statsPanelCSS=`.settings-sheet .stats-group{container-type:inline-size}
.stats-body{display:flex;flex-direction:column;gap:8px}
.stats-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@container (min-width:520px){.stats-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}
.stats-tile,.stats-chart{box-sizing:border-box;min-width:0;border-radius:22px;background:var(--ps-glass-fill-strong);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}
.stats-tile{display:flex;flex-direction:column;gap:2px;padding:12px 14px}
.stats-label{font:600 12px/16px var(--ps-font);color:var(--ps-label2)}
.stats-value{display:flex;align-items:center;gap:6px;min-width:0;font:600 22px/28px var(--ps-font);color:var(--ps-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stats-pair{display:inline-flex;align-items:center;gap:4px}
.stats-note{font:400 12px/16px var(--ps-font);color:var(--ps-label2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stats-chart{display:flex;flex-direction:column;gap:8px;padding:14px}
.stats-chart h3{margin:0;font:600 15px/20px var(--ps-font);color:var(--ps-label)}
.stats-legend{display:flex;flex-wrap:wrap;gap:4px 16px;margin:0;font:400 12px/16px var(--ps-font);color:var(--ps-label2)}
.stats-legend span{display:inline-flex;align-items:center;gap:6px}
.settings-sheet .stats-group svg.stats-swatch{flex:none;width:12px;height:12px}
.settings-sheet .stats-group svg.stats-plot{display:block;width:100%;height:auto;overflow:visible}
.stats-plot text{fill:var(--ps-label2);font:400 11px var(--ps-font);font-variant-numeric:tabular-nums}
.stats-grid{stroke:var(--ps-sep);stroke-width:1;shape-rendering:crispEdges}
.stats-keep{fill:var(--ps-accent)}
.stats-trash{fill:var(--ps-destructive)}
.stats-wash{fill:var(--ps-destructive);opacity:.16}
.stats-line{fill:none;stroke:var(--ps-destructive);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.stats-dashed{stroke-dasharray:4 4;opacity:.75}
.stats-ring{stroke:var(--ps-glass-solid);stroke-width:2}
.stats-hit{fill:transparent}
.stats-hit:hover{fill:var(--ps-fill)}
.stats-empty{display:flex;flex-direction:column;justify-content:center;gap:4px;min-height:96px;margin:0;text-align:center;font:400 13px/18px var(--ps-font);color:var(--ps-label2)}
.stats-empty strong{font:600 15px/20px var(--ps-font);color:var(--ps-label)}
.stats-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}`;
function renderReviewStats({document,container,stats,width=320}) {
 const svgNS='http://www.w3.org/2000/svg';
 const node=(tag,attributes={},...children)=>{const element=document.createElementNS(svgNS,tag);for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));element.append(...children);return element;};
 const html=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.setAttribute('class',className);if(text!==undefined)element.textContent=text;return element;};
 const swatch=(kind)=>{const svg=node('svg',{class:'stats-swatch',viewBox:'0 0 12 12','aria-hidden':'true'});if(kind==='line'||kind==='dashed')svg.append(node('path',{class:`stats-line${kind==='dashed'?' stats-dashed':''}`,d:'M1 6H11'}));else svg.append(node('rect',{class:kind==='keep'?'stats-keep':'stats-trash',x:1,y:1,width:10,height:10,rx:3}));return svg;};
 const legend=entries=>{const row=html('p','stats-legend');for(const [kind,text] of entries){const item=html('span');item.append(swatch(kind),document.createTextNode(text));row.append(item);}return row;};
 const table=(caption,headings,rows)=>{const element=html('table','stats-sr'),head=html('tr');element.append(html('caption','',caption));for(const heading of headings)head.append(html('th','',heading));element.append(head);for(const cells of rows){const row=html('tr');for(const cell of cells)row.append(html('td','',cell));element.append(row);}return element;};
 const tile=(label,value,note)=>{const element=html('div','stats-tile');const valueElement=html('span','stats-value');if(typeof value==='string')valueElement.textContent=value;else valueElement.append(...value);element.append(html('span','stats-label',label),valueElement,html('span','stats-note',note));return element;};
 const pair=(kind,count,label)=>{const element=html('span','stats-pair');element.append(swatch(kind),document.createTextNode(statsCount(count)),html('span','stats-sr',` ${label}`));return element;};
 const tiles=html('div','stats-tiles');tiles.setAttribute('id','stats-tiles');
 const freedText=`${formatStorageBytes(stats.freed.bytes)}${stats.freed.unknown?` + ${stats.freed.unknown} unknown`:''}`;
 tiles.append(
  tile('Reviewed',statsCount(stats.reviewed),stats.reviewed===1?'photo or video':'photos & videos'),
  tile('Kept vs Trash',[pair('keep',stats.kept,'kept'),pair('trash',stats.trashed,'marked for Trash')],stats.reviewed?`${Math.round(stats.kept/stats.reviewed*100)}% kept`:'nothing yet'),
  tile('Storage freed',freedText,'confirmed in Trash'),
  tile('Going to Trash',statsCount(stats.waiting.count),stats.waiting.count?`${formatStorageBytes(stats.waiting.bytes)}${stats.waiting.unknown?` + ${stats.waiting.unknown} unknown`:''} waiting`:'nothing waiting')
 );
 const children=[tiles];
 const card=(id,title)=>{const element=html('section','stats-chart');element.setAttribute('id',id);const heading=html('h3','',title);heading.setAttribute('id',`${id}-title`);element.setAttribute('aria-labelledby',`${id}-title`);element.append(heading);return element;};
 const summary=reviewStatsSummary(stats),count=stats.days.length;
 const reviewsCard=card('stats-reviews',`Reviews per day \u00b7 last ${count} days`);children.push(reviewsCard);
 if(!stats.reviewed){const empty=html('p','stats-empty');empty.append(html('strong','','No reviews yet'),document.createTextNode('Swipe a few photos and your daily activity shows up here.'));reviewsCard.append(empty);container.replaceChildren(...children);return;}
 const W=Math.max(240,Math.round(width)),H=140,top=10,bottom=H-24,plotH=bottom-top;
 const active=stats.days.filter(day=>day.keep||day.remove);
 if(!active.length){const empty=html('p','stats-empty');empty.append(html('strong','',`No reviews in the last ${count} days`),document.createTextNode('Older decisions still count toward the totals above.'));reviewsCard.append(empty);}
 else{
  const max=Math.max(...stats.days.map(day=>day.keep+day.remove)),ticks=statsTicks(max),labelWidth=Math.max(...ticks.map(tick=>String(tick).length))*7+8,plotW=W-labelWidth,yMax=ticks.at(-1),slotW=plotW/count,barW=Math.min(24,Math.max(2,slotW*.62));
  const y=value=>bottom-value/yMax*plotH;
  const svg=node('svg',{class:'stats-plot',viewBox:`0 0 ${W} ${H}`,width:W,height:H,role:'img','aria-label':summary.reviews});
  for(const tick of ticks)svg.append(node('line',{class:'stats-grid',x1:0,x2:plotW,y1:Math.round(y(tick))+.5,y2:Math.round(y(tick))+.5}),node('text',{x:W,y:y(tick)+4,'text-anchor':'end'},document.createTextNode(tick.toLocaleString())));
  const segment=(x,low,high,rounded)=>{const r=rounded?Math.min(4,barW/2,low-high):0;return `M${x.toFixed(1)} ${low.toFixed(1)}V${(high+r).toFixed(1)}${r?`A${r} ${r} 0 0 1 ${(x+r).toFixed(1)} ${high.toFixed(1)}`:''}H${(x+barW-r).toFixed(1)}${r?`A${r} ${r} 0 0 1 ${(x+barW).toFixed(1)} ${(high+r).toFixed(1)}`:''}V${low.toFixed(1)}Z`;};
  stats.days.forEach((day,position)=>{
   const x=position*slotW+(slotW-barW)/2;
   const keepH=day.keep?Math.max(2,day.keep/yMax*plotH):0,removeH=day.remove?Math.max(2,day.remove/yMax*plotH):0,gap=keepH&&removeH?2:0;
   if(keepH)svg.append(node('path',{class:'stats-keep',d:segment(x,bottom,bottom-keepH,!removeH)}));
   if(removeH)svg.append(node('path',{class:'stats-trash',d:segment(x,bottom-keepH-gap,bottom-keepH-gap-removeH,true)}));
   const hit=node('rect',{class:'stats-hit',x:position*slotW,y:top,width:slotW,height:plotH,rx:2});hit.append(node('title',{},document.createTextNode(`${statsDayLabel(day.key)}: ${day.keep.toLocaleString()} kept, ${day.remove.toLocaleString()} marked for Trash`)));svg.append(hit);
  });
  for(const [position,anchor] of [[0,'start'],[Math.floor((count-1)/2),'middle'],[count-1,'end']])svg.append(node('text',{x:anchor==='start'?0:anchor==='end'?plotW:position*slotW+slotW/2,y:H-6,'text-anchor':anchor},document.createTextNode(position===count-1?'Today':statsDayLabel(stats.days[position].key))));
  reviewsCard.append(legend([['keep','Kept'],['trash','Marked for Trash']]),svg,table('Reviews per day',['Day','Kept','Marked for Trash'],active.map(day=>[statsDayLabel(day.key),day.keep.toLocaleString(),day.remove.toLocaleString()])));
 }
 const storageCard=card('stats-storage',`Storage \u00b7 last ${count} days`);children.push(storageCard);
 const last=stats.days.at(-1);
 if(!last.marked){const empty=html('p','stats-empty');empty.append(html('strong','','Nothing marked for Trash yet'),document.createTextNode('Swipe left on photos you don\u2019t need to see storage add up here.'));storageCard.append(empty);}
 else{
  const ticks=statsTicks(last.marked,{bytes:true}),labels=ticks.map(tick=>tick?formatStorageBytes(tick).replace(/\.0+ /,' '):'0'),labelWidth=Math.max(...labels.map(label=>label.length))*6.6+8,plotW=W-labelWidth,yMax=ticks.at(-1);
  const y=value=>bottom-value/yMax*plotH,x=position=>count>1?position/(count-1)*plotW:plotW/2;
  const svg=node('svg',{class:'stats-plot',viewBox:`0 0 ${W} ${H}`,width:W,height:H,role:'img','aria-label':summary.storage});
  ticks.forEach((tick,position)=>svg.append(node('line',{class:'stats-grid',x1:0,x2:plotW,y1:Math.round(y(tick))+.5,y2:Math.round(y(tick))+.5}),node('text',{x:W,y:y(tick)+4,'text-anchor':'end'},document.createTextNode(labels[position]))));
  const line=key=>stats.days.map((day,position)=>`${position?'L':'M'}${x(position).toFixed(1)} ${y(day[key]).toFixed(1)}`).join('');
  svg.append(node('path',{class:'stats-wash',d:`${line('freed')}L${x(count-1).toFixed(1)} ${bottom}L${x(0).toFixed(1)} ${bottom}Z`}),node('path',{class:'stats-line stats-dashed',d:line('marked')}),node('path',{class:'stats-line',d:line('freed')}),node('circle',{class:'stats-trash stats-ring',cx:x(count-1),cy:y(last.freed),r:4}));
  stats.days.forEach((day,position)=>{const hit=node('rect',{class:'stats-hit',x:Math.max(0,x(position)-plotW/(count-1||1)/2),y:top,width:plotW/(count-1||1),height:plotH,rx:2});hit.append(node('title',{},document.createTextNode(`${statsDayLabel(day.key)}: ${formatStorageBytes(day.freed)} freed, ${formatStorageBytes(day.marked)} marked for Trash`)));svg.append(hit);});
  for(const [position,anchor] of [[0,'start'],[Math.floor((count-1)/2),'middle'],[count-1,'end']])svg.append(node('text',{x:x(position),y:H-6,'text-anchor':anchor},document.createTextNode(position===count-1?'Today':statsDayLabel(stats.days[position].key))));
  const changes=stats.days.filter((day,position)=>!position||day.freed!==stats.days[position-1].freed||day.marked!==stats.days[position-1].marked);
  storageCard.append(legend([['line',`Freed ${formatStorageBytes(last.freed)}`],['dashed',`Marked ${formatStorageBytes(last.marked)}`]]),svg,table('Storage freed and marked for Trash, running total',['Day','Freed','Marked for Trash'],changes.map(day=>[statsDayLabel(day.key),formatStorageBytes(day.freed),formatStorageBytes(day.marked)])));
 }
 container.replaceChildren(...children);
}

const updateOrigin='https://photoswiper-sync.sidlakkoju.workers.dev';
const updateTargetKey='photoswiper-update-target';
const openAfterUpdateKey='photoswiper-open-after-update';
function releaseNewer(candidate,current){
 const parse=value=>/^(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
 const a=parse(candidate),b=parse(current);
 if(!a||!b)return false;
 for(let index=0;index<3;index++)if(a[index]!==b[index])return a[index]>b[index];
 return false;
}
async function availableUpdate({fetch,version,setTimeout,clearTimeout,timeout=3000}){
 if(typeof fetch!=='function')return null;
 let timer;
 try{
  const response=await Promise.race([fetch(updateOrigin+'/version?t='+Date.now(),{method:'GET'}),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Update check timed out')),timeout);})]);
  if(!response?.ok)return null;
  const latest=(await response.json())?.version;
  return releaseNewer(latest,version)?latest:null;
 }catch{return null;}finally{clearTimeout(timer);}
}
function downloadRelease({GM,version,setTimeout,clearTimeout,timeout=30000}){
 const request=GM?.xmlHttpRequest?.bind(GM),store=GM?.setValue?.bind(GM);
 if(typeof request!=='function'||typeof store!=='function')return Promise.resolve(false);
 return new Promise(resolve=>{
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>finish(false),timeout);
  const loaded=async response=>{
   try{
    const headers=response?.responseHeaders||'';
    const served=/^x-photoswiper-version:\s*(\S+)/im.exec(headers)?.[1],required=/^x-photoswiper-required-loader-version:\s*(\S+)/im.exec(headers)?.[1];
    if(response.status!==200||served!==version||!response.responseText?.trim()){finish(false);return;}
    await store('photoswiper-app',{code:response.responseText,version,...(required?{requiredLoaderVersion:required}:{})});
    finish(true);
   }catch{finish(false);}
  };
  try{const result=request({method:'GET',url:updateOrigin+'/app.js?t='+Date.now(),timeout,onload:loaded,onerror:()=>finish(false),ontimeout:()=>finish(false),onabort:()=>finish(false)});result?.then?.(loaded,()=>finish(false));}catch{finish(false);}
 });
}
function claimUpdateReload(storage,latest){
 try{
  if(storage.getItem(updateTargetKey)===latest)return false;
  storage.setItem(updateTargetKey,latest);
  storage.setItem(openAfterUpdateKey,'1');
  return true;
 }catch{return false;}
}
function consumeOpenAfterUpdate(storage){
 try{
  const pending=storage.getItem(openAfterUpdateKey)==='1';
  storage.removeItem(openAfterUpdateKey);
  return pending;
 }catch{return false;}
}

const demoPalettes={
 sunset:{sky:['#FF8E5E','#FFB487'],sun:'#FFF1C7',far:'#C0707F',near:'#5C3758',water:['#E7A38C','#7E5574']},
 golden:{sky:['#FFC46B','#FF9A57'],sun:'#FFF6DA',far:'#C76A4E',near:'#6B3A3A',water:['#F0A070','#9A5550']},
 dusk:{sky:['#3B2E6E','#E3778A'],sun:'#FFD1A8',far:'#7A4F86',near:'#3A2A52',water:['#C76D86','#46325E']},
 lake:{sky:['#5E9FE6','#A9D2F2'],sun:'#F7F5DE',far:'#9DB6C9',near:'#2F5D45',water:['#4F8DB5','#2B648A']},
 alpine:{sky:['#9ED6F3','#FDF0D3'],sun:'#FFFBE8',far:'#7EA7C4',near:'#3F6F5A',water:['#6AA6C9','#3A759B'],snow:true},
 night:{sky:['#0F1534','#2A356B'],sun:'#E8E2C0',far:'#2B3566',near:'#121733',water:['#1E2A5C','#0E1638'],stars:true},
 dawn:{sky:['#F2C3BE','#C9D6EA'],sun:'#FFFFFF',far:'#A9B4C9',near:'#6C7A92',water:['#B8C6DC','#7F8FAD']},
 desert:{sky:['#F6D29C','#F3C38E'],sun:'#FFF8EC',far:'#D9A066',near:'#A8683E',water:['#D9A46C','#B4774A'],sand:true},
 desertDusk:{sky:['#F2A57C','#7A5FA0'],sun:'#FFE6C4',far:'#B56A6A',near:'#5A3A4F',water:['#C98A6A','#6E4558'],sand:true},
 teal:{sky:['#94DCCB','#C9F0E4'],sun:'#FBF8DC',far:'#5FB59A',near:'#2E7D6A',water:['#2FB3C4','#1B8399']},
 tropical:{sky:['#FF8F6B','#6B4A9E'],sun:'#FFE0A3',far:'#4A3F7A',near:'#1F2A4A',water:['#6B5AA8','#28285A']},
 lavender:{sky:['#D2AEEE','#E6CDF6'],sun:'#FDF2FB',far:'#A07AC8',near:'#6A4A8F',water:['#B58AD8','#83599F']},
 glacier:{sky:['#BCE1F4','#E8F5FB'],sun:'#FFFFFF',far:'#8FB3C9',near:'#3D6B7D',water:['#4CC3D0','#25879C'],snow:true}
};
const demoLibrary=[
 {key:'bigsur-1',file:'IMG_4820.HEIC',palette:'sunset',place:'Big Sur, CA',date:'2025-06-14T19:42:00-07:00',size:2.1e6,seed:11},
 {key:'bigsur-2',file:'IMG_4821.HEIC',palette:'golden',place:'Big Sur, CA',date:'2025-06-14T19:58:00-07:00',size:2.4e6,seed:12},
 {key:'bigsur-3',file:'IMG_4824.HEIC',palette:'dusk',place:'Big Sur, CA',date:'2025-06-14T20:31:00-07:00',size:3.2e6,seed:13,landscape:true},
 {key:'tahoe-1',file:'IMG_2317.HEIC',palette:'lake',place:'Lake Tahoe, CA',date:'2024-08-02T10:14:00-07:00',size:4.6e6,seed:21},
 {key:'tahoe-video',file:'IMG_2318.MOV',palette:'lake',place:'Lake Tahoe, CA',date:'2024-08-02T10:16:00-07:00',size:7.9e6,seed:22,video:'lake-loop.mp4',duration:4000},
 {key:'tahoe-2',file:'IMG_2325.HEIC',palette:'alpine',place:'Lake Tahoe, CA',date:'2024-08-02T11:03:00-07:00',size:3.8e6,seed:23,free:true},
 {key:'joshua-1',file:'IMG_3391.JPG',palette:'desert',place:'Joshua Tree, CA',date:'2025-03-09T13:20:00-07:00',size:5.3e6,seed:31},
 {key:'joshua-2',file:'IMG_3402.JPG',palette:'desertDusk',place:'Joshua Tree, CA',date:'2025-03-09T18:47:00-07:00',size:2.9e6,seed:32,landscape:true},
 {key:'yosemite-1',file:'IMG_0917.HEIC',palette:'night',place:'Yosemite Valley, CA',date:'2024-10-19T22:05:00-07:00',size:6.4e6,seed:41},
 {key:'yosemite-2',file:'IMG_0931.HEIC',palette:'dawn',place:'Yosemite Valley, CA',date:'2024-10-20T06:52:00-07:00',size:1.7e6,seed:42},
 {key:'maui-1',file:'IMG_5512.HEIC',palette:'teal',place:'Kapalua, Maui',date:'2025-01-24T15:10:00-10:00',size:3.5e6,seed:51},
 {key:'maui-2',file:'IMG_5530.HEIC',palette:'tropical',place:'Kapalua, Maui',date:'2025-01-24T18:36:00-10:00',size:4.1e6,seed:52,free:true},
 {key:'valensole-1',file:'IMG_6203.HEIC',palette:'lavender',place:'Valensole, France',date:'2025-07-06T09:28:00+02:00',size:2.6e6,seed:61},
 {key:'banff-1',file:'IMG_1148.HEIC',palette:'glacier',place:'Banff, Alberta',date:'2024-09-12T08:15:00-06:00',size:5.8e6,seed:71}
];
function seeded(seed){let value=seed>>>0||1;return ()=>{value=Math.imul(value^value>>>15,0x2c1b3c6d)+0x9e3779b9>>>0;value^=value>>>13;return (value>>>0)/4294967296;};}
function ridge(random,width,base,height,peaks){const points=[[0,base-height*(.3+random()*.4)]];const step=width/peaks;for(let index=1;index<=peaks;index++){const x=index*step-step*random()*.5;points.push([x-step*.5,base-height*(.85+random()*.25)]);points.push([x,base-height*(.25+random()*.45)]);}points.push([width,base-height*(.35+random()*.45)]);return points.map(([x,y])=>[Math.round(Math.max(0,Math.min(width,x))),Math.round(y)]);}
const path=points=>points.map(([x,y],index)=>`${index?'L':'M'}${x} ${y}`).join('');
function demoLandscapeSVG(name,{seed=1,width=900,height=1200}={}) {
 const palette=demoPalettes[name],random=seeded(seed),horizon=Math.round(height*.58),sunX=Math.round(width*(.3+random()*.4)),sunY=Math.round(height*(.2+random()*.08)),sunR=Math.round(Math.min(width,height)*.11);
 const far=ridge(random,width,horizon,height*.24,3+Math.floor(random()*2)),near=ridge(random,width,horizon,height*.12,2+Math.floor(random()*3));
 const id=`${name}${seed}`,parts=[];
 parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
 parts.push(`<defs><linearGradient id="s${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.sky[0]}"/><stop offset="1" stop-color="${palette.sky[1]}"/></linearGradient><linearGradient id="w${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.water[0]}"/><stop offset="1" stop-color="${palette.water[1]}"/></linearGradient><radialGradient id="g${id}"><stop offset="0" stop-color="${palette.sun}" stop-opacity=".55"/><stop offset="1" stop-color="${palette.sun}" stop-opacity="0"/></radialGradient></defs>`);
 parts.push(`<rect width="${width}" height="${horizon}" fill="url(#s${id})"/>`);
 if(palette.stars)for(let index=0;index<70;index++)parts.push(`<circle cx="${Math.round(random()*width)}" cy="${Math.round(random()*horizon*.8)}" r="${(random()*1.8+.6).toFixed(1)}" fill="#FFFFFF" opacity="${(random()*.6+.3).toFixed(2)}"/>`);
 parts.push(`<circle cx="${sunX}" cy="${sunY}" r="${sunR*2.6}" fill="url(#g${id})"/><circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="${palette.sun}"/>`);
 if(!palette.stars)for(let index=0;index<2;index++){const y=Math.round(height*(.12+random()*.2)),x=Math.round(random()*width);parts.push(`<ellipse cx="${x}" cy="${y}" rx="${Math.round(width*(.14+random()*.1))}" ry="${Math.round(height*.012+random()*8)}" fill="#FFFFFF" opacity=".22"/>`);}
 parts.push(`<path d="${path(far)}L${width} ${horizon}L0 ${horizon}Z" fill="${palette.far}"/>`);
 if(palette.snow)for(let index=1;index<far.length-1;index++){const [x,y]=far[index];if(y<horizon-height*.17)parts.push(`<path d="M${x-26} ${y+30}L${x} ${y}L${x+24} ${y+28}L${x+8} ${y+22}L${x-6} ${y+34}Z" fill="#FFFFFF" opacity=".85"/>`);}
 parts.push(`<path d="${path(near)}L${width} ${horizon}L0 ${horizon}Z" fill="${palette.near}"/>`);
 parts.push(`<rect y="${horizon}" width="${width}" height="${height-horizon}" fill="url(#w${id})"/>`);
 parts.push(`<path d="${path(near.map(([x,y])=>[x,2*horizon-y]))}L${width} ${horizon}L0 ${horizon}Z" fill="${palette.near}" opacity=".28"/>`);
 if(!palette.sand){parts.push(`<ellipse cx="${sunX}" cy="${Math.round(horizon+(height-horizon)*.42)}" rx="${Math.round(sunR*.32)}" ry="${Math.round((height-horizon)*.34)}" fill="${palette.sun}" opacity=".32"/>`);for(let index=0;index<5;index++){const y=Math.round(horizon+(height-horizon)*(.12+index*.17));parts.push(`<rect x="${Math.round(sunX-sunR*(.9-index*.1))}" y="${y}" width="${Math.round(sunR*(1.8-index*.2))}" height="3" rx="1.5" fill="${palette.sun}" opacity=".35"/>`);}}
 else for(let index=0;index<4;index++){const y=Math.round(horizon+(height-horizon)*(.2+index*.2));parts.push(`<path d="M0 ${y}Q${width*.3} ${y-18} ${width*.55} ${y}T${width} ${y-6}" stroke="${palette.near}" stroke-width="3" fill="none" opacity=".25"/>`);}
 parts.push('</svg>');
 return parts.join('');
}
const demoMediaFile=entry=>`${entry.key}.svg`;
function demoItems(base,library=demoLibrary) {
 return library.map(entry=>{
  const date=new Date(entry.date),zone=/([+-])(\d\d):(\d\d)$/.exec(entry.date),offset=zone?(zone[1]==='-'?-1:1)*(Number(zone[2])*60+Number(zone[3]))*60000:null;
  const [width,height]=entry.landscape?[1200,900]:[900,1200];
  return {mediaKey:`AF1QipDemo${entry.key.replace(/[^A-Za-z0-9]/g,'')}`,dedupKey:`demo-${entry.key}`,name:entry.file,type:entry.video?'video':'photo',date:date.toISOString(),timezoneOffset:offset,thumbUrl:new URL(demoMediaFile(entry),base).href,videoUrl:entry.video?new URL(entry.video,base).href:null,width,height,...(entry.video?{duration:entry.duration}:{}),locationName:entry.place,location:null,size:Math.round(entry.size),spaceTaken:entry.free?0:Math.round(entry.size),takesUpSpace:!entry.free};
 });
}
function demoPastDecisions(now=Date.now(),{days=21,seed=2024}={}) {
 const random=seeded(seed),today=new Date(now);today.setHours(0,0,0,0);
 const evening=(ago,hour)=>{const date=new Date(today);date.setDate(date.getDate()-ago);return date.getTime()+hour*3600000;};
 const sweeps=[days-3,days-7,days-12,days-16,1].filter(ago=>ago>=1).sort((a,b)=>b-a);
 const items=[];
 for(let ago=days;ago>=1;ago--){
  if(random()<.3)continue;
  const count=4+Math.floor(random()*(ago%6===0?40:22)),start=18+random()*2.5;
  for(let index=0;index<count;index++){
   const at=Math.round(evening(ago,start+index*.012+random()*.01)),video=random()<.08,free=!video&&random()<.15,size=Math.round((video?18e6+random()*60e6:1.2e6+random()*6e6));
   const remove=random()<(video?.55:.3),sweep=sweeps.find(day=>day<=ago&&evening(day,21.5)>at),trashedAt=remove&&sweep!==undefined?evening(sweep,21.5):null;
   items.push({mediaKey:`demo-past-${items.length}`,type:video?'video':'photo',decision:remove?'remove':'keep',lastDecisionAt:at,size,spaceTaken:free?0:size,takesUpSpace:!free,state:remove?'in_trash':'active',...(trashedAt?{trashedAt}:{})});
  }
 }
 return items;
}
function createDemoPhotos({items}) {
 const trashed=new Set(),find=mediaKey=>{const item=items.find(row=>row.mediaKey===mediaKey);if(!item)throw Error('Unknown demo item.');return item;};
 const listed=item=>{const {videoUrl:_unused,...row}=item;return {...row};};
 const handlers={
  identity:()=>({account:'photos-swipe-demo',label:'Demo library'}),
  library:()=>({items:items.filter(item=>!trashed.has(item.mediaKey)).map(listed),nextPageId:null}),
  mediaURL:({mediaKey})=>({url:find(mediaKey).thumbUrl}),
  video:({mediaKey})=>{const item=find(mediaKey);if(!item.videoUrl)throw Error('Not a video.');return {url:item.videoUrl};},
  moveToTrash:({dedupKeys=[]})=>{const keys=new Set(dedupKeys);for(const item of items)if(keys.has(item.dedupKey))trashed.add(item.mediaKey);return {requested:keys.size};},
  trashPage:()=>({items:items.filter(item=>trashed.has(item.mediaKey)).map(item=>({mediaKey:item.mediaKey,dedupKey:item.dedupKey})),nextPageId:null}),
  itemState:({mediaKey})=>({state:trashed.has(mediaKey)?'in_trash':'active'})
 };
 const call=async(operation,args={})=>{
  const handler=Object.hasOwn(handlers,operation)?handlers[operation]:null;
  if(!handler)return {ok:false,error:'That isn\u2019t available in the demo.'};
  try{return {ok:true,data:structuredClone(handler(args))};}catch(error){return {ok:false,error:error.message};}
 };
 return {call,trashed,calls:handlers};
}
function createMemoryIndexedDB() {
 const databases=new Map();
 const later=task=>Promise.resolve().then(task);
 function database(stores){
  return {
   objectStoreNames:{contains:name=>stores.has(name)},
   createObjectStore:name=>{stores.set(name,new Map());},
   close(){},
   transaction(names,mode='readonly'){
    const scope=[].concat(names),staged=new Map(scope.map(name=>[name,new Map(stores.get(name))]));let pending=0,finished=false,aborted=false,wrote=false;
    const tx={error:null,oncomplete:null,onabort:null,onerror:null};
    const settle=()=>later(()=>{if(finished||aborted||pending>0)return;finished=true;if(wrote&&mode==='readwrite')for(const [name,table] of staged)stores.set(name,table);tx.oncomplete?.();});
    tx.abort=()=>{if(finished||aborted)return;aborted=true;later(()=>tx.onabort?.());};
    tx.objectStore=name=>{
     const table=staged.get(name);if(!table)throw Error(`Unknown store ${name}`);
     return {
      get(key){const request={result:undefined,onsuccess:null,onerror:null};pending++;later(()=>{if(aborted)return;request.result=structuredClone(table.get(key));try{request.onsuccess?.();}finally{pending--;settle();}});return request;},
      put(value,key){if(mode!=='readwrite')throw Error('Read-only transaction.');wrote=true;table.set(key,structuredClone(value));},
      delete(key){if(mode!=='readwrite')throw Error('Read-only transaction.');wrote=true;table.delete(key);}
     };
    };
    settle();
    return tx;
   }
  };
 }
 return {
  open(name){
   const request={result:null,error:null,onsuccess:null,onerror:null,onupgradeneeded:null,onblocked:null};
   later(()=>{let stores=databases.get(name);const created=!stores;if(created){stores=new Map();databases.set(name,stores);}request.result=database(stores);if(created)request.onupgradeneeded?.();request.onsuccess?.();});
   return request;
  },
  databases:async()=>[...databases.keys()].map(name=>({name,version:2}))
 };
}
function demoSafeTop(value){const text=String(value??'').trim();if(!/^\d+(\.\d+)?$/.test(text))return null;const number=Number(text);return number<=100?number:null;}
function createDemoEnvironment({window,document,location,base,embed=false,top=null,scheme=null,version='demo'}) {
 const items=demoItems(base),photos=createDemoPhotos({items});
 let firstSwipe=false,announced=false;
 const parent=window.parent&&window.parent!==window?window.parent:null;
 const post=event=>{try{parent?.postMessage({type:'photos-swipe-demo',event},'*');}catch{}};
 const reset=()=>{try{window.location.reload();}catch{}};
 window.addEventListener('message',event=>{if(!parent||event.source!==parent)return;if(event.data?.type==='photos-swipe-demo'&&event.data.command==='reset')reset();});
 return {
  version,autoUpdating:false,window,document,location,crypto:window.crypto,
  indexedDB:createMemoryIndexedDB(),
  fetch:()=>Promise.reject(Error('The demo makes no network requests.')),
  AbortController:window.AbortController,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),
  photosCall:photos.call,
  demo:{embed,safeTop:embed?demoSafeTop(top):null,scheme:['dark','light'].includes(scheme)?scheme:null,reset,history:demoPastDecisions(),notify(event){if(event==='ready'&&!announced){announced=true;post('ready');}if(event==='decision'&&!firstSwipe){firstSwipe=true;post('first-swipe');}if(event==='escape')post('escape');}}
 };
}

function restoreVideoTime(video,savedTime){
 if(video.dataset.resumeReady!=='pending')return;
 if(Number.isFinite(savedTime))video.currentTime=Math.max(0,Math.min(savedTime,Number.isFinite(video.duration)?video.duration:savedTime));
 video.dataset.resumeReady='ready';
}
function createVideoTimeline({document,video,onSeek}){
 const timeline=document.createElement('input'),label=document.createElement('span');
 timeline.type='range';timeline.min='0';timeline.max='1';timeline.step='any';timeline.value='0';timeline.dataset.videoControl='seek';
 timeline.setAttribute('aria-label','Video timeline');
 timeline.style.cssText='position:absolute;bottom:46px;left:12px;width:calc(100% - 24px);height:44px;touch-action:none;z-index:2';
 label.dataset.videoControl='time';label.style.cssText='position:absolute;bottom:22px;left:50%;transform:translateX(-50%);pointer-events:none';
 const format=time=>{const seconds=Math.floor(Number.isFinite(time)?Math.max(0,time):0);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
 const update=()=>{timeline.value=String(Number.isFinite(video.duration)&&video.duration>0?video.currentTime/video.duration:0);label.textContent=`${format(video.currentTime)} / ${format(video.duration)}`;};
 const seek=fraction=>{if(!Number.isFinite(video.duration)||video.duration<=0)return;video.currentTime=Math.max(0,Math.min(1,fraction))*video.duration;video.dataset.resumeReady='ready';update();onSeek();};
 const seekAt=event=>{const rect=timeline.getBoundingClientRect();if(rect.width>0)seek((event.clientX-rect.left)/rect.width);};
 let pointer=null;
 timeline.addEventListener('pointerdown',event=>{event.stopPropagation();if(event.isPrimary===false||event.button!==0)return;event.preventDefault();pointer=event.pointerId;timeline.setPointerCapture?.(pointer);seekAt(event);});
 timeline.addEventListener('pointermove',event=>{event.stopPropagation();if(event.pointerId===pointer){event.preventDefault();seekAt(event);}});
 timeline.addEventListener('pointerup',event=>{event.stopPropagation();if(event.pointerId!==pointer)return;seekAt(event);pointer=null;if(timeline.hasPointerCapture?.(event.pointerId))timeline.releasePointerCapture(event.pointerId);});
 for(const type of ['pointercancel','lostpointercapture'])timeline.addEventListener(type,event=>{event.stopPropagation();pointer=null;});
 timeline.addEventListener('click',event=>{event.stopPropagation();seekAt(event);});
 for(const type of ['touchstart','touchmove','touchend'])timeline.addEventListener(type,event=>event.stopPropagation());
 timeline.addEventListener('input',()=>seek(Number(timeline.value)));
 for(const type of ['timeupdate','loadedmetadata','durationchange','seeked'])video.addEventListener(type,update);
 update();return [timeline,label];
}
function mountPhotosSwipe(environment) {
 if(typeof environment.GM?.xmlHttpRequest==='function')environment.syncFetch=privateSyncFetch(environment.GM);
 const {window,document,location}=environment;
 const demo=environment.demo||null;
 if((!demo&&(window.top!==window||location.origin!=='https://photos.google.com'))||document.getElementById('photos-swipe-userscript-host'))return;
 const rawCall=environment.photosCall||createPhotosAPI(environment);
 let owner;
 const ownerReady=createLeaseOwner(window,environment.crypto).then(value=>{owner=value;});
 let tabChannel;
 try{if(window.BroadcastChannel&&!demo)tabChannel=new window.BroadcastChannel('photos-swipe-tabs');}catch{}
 const notifyTabs=account=>{try{tabChannel?.postMessage({account,owner});}catch{}};
 const host=document.createElement('div');host.id='photos-swipe-userscript-host';
 host.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none';
 if(Number.isFinite(environment.demo?.safeTop))host.style.setProperty('--ps-safe-top',`${environment.demo.safeTop}px`);
 const root=host.attachShadow({mode:'open'});
 const styleElement1=document.createElement('style');
 root.append(styleElement1);
 styleElement1.append(document.createTextNode(":host{all:initial;--ps-bg:#F2F2F7;--ps-surface:rgba(255,255,255,.72);--ps-surface-solid:#FFF;--ps-fill:rgba(120,120,128,.12);--ps-label:#000;--ps-label2:rgba(60,60,67,.6);--ps-sep:rgba(60,60,67,.18);--ps-accent:#007AFF;--ps-destructive:#FF3B30;--ps-on-action:#FFF;--ps-shadow-color:rgba(0,0,0,.12);--ps-r-sm:10px;--ps-r-md:16px;--ps-r-lg:24px;--ps-r-pill:999px;--ps-s1:4px;--ps-s2:8px;--ps-s3:12px;--ps-s4:16px;--ps-s5:24px;--ps-s6:32px;--ps-font:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",system-ui,Inter,sans-serif;--ps-t-large:600 28px/34px var(--ps-font);--ps-t-title:600 20px/25px var(--ps-font);--ps-t-body:400 17px/22px var(--ps-font);--ps-t-callout:500 15px/20px var(--ps-font);--ps-t-caption:400 12px/16px var(--ps-font);--ps-glass-fill:rgba(255,255,255,.55);--ps-glass-fill-strong:rgba(255,255,255,.74);--ps-glass-stroke:rgba(255,255,255,.7);--ps-glass-edge:rgba(0,0,0,.08);--ps-glass-shadow:0 8px 24px rgba(0,0,0,.1);--ps-glass-shadow-lg:0 12px 40px rgba(0,0,0,.14);--ps-glass-tint-blue:rgba(0,122,255,.82);--ps-glass-tint-red:rgba(255,59,48,.8);--ps-glass-solid:rgba(250,250,252,.97);--ps-glass-scrim:rgba(242,242,247,.5);--ps-photo-chip:rgba(255,255,255,.62);--ps-photo-label:#000;--ps-photo-shadow:0 1px 1px rgba(255,255,255,.45);--ps-ambient-dim:rgba(242,242,247,.5);--ps-ambient-fade:rgba(242,242,247,.55);--ps-text-shadow:0 1px 2px rgba(255,255,255,.6);--ps-keycap:rgba(0,0,0,.06);--ps-blur-clear:blur(6px) saturate(180%);--ps-blur-regular:blur(20px) saturate(160%);--ps-blur-thick:blur(40px) saturate(140%);--ps-tint-regular:saturate(160%);--ps-r-card:28px;--ps-r-photo:32px;--ps-safe-top:env(safe-area-inset-top,0px);--ps-safe-right:env(safe-area-inset-right,0px);--ps-safe-bottom:env(safe-area-inset-bottom,0px);--ps-safe-left:env(safe-area-inset-left,0px);--ps-chrome:#DCDCE1;font:var(--ps-t-body);color:var(--ps-label);color-scheme:light}@media(prefers-color-scheme:dark){:host{--ps-bg:#000;--ps-surface:rgba(28,28,30,.72);--ps-surface-solid:#1C1C1E;--ps-fill:rgba(120,120,128,.24);--ps-label:#FFF;--ps-label2:rgba(235,235,245,.6);--ps-sep:rgba(84,84,88,.6);--ps-accent:#0A84FF;--ps-destructive:#FF453A;--ps-shadow-color:rgba(0,0,0,.5);--ps-glass-fill:rgba(255,255,255,.07);--ps-glass-fill-strong:rgba(255,255,255,.14);--ps-glass-stroke:rgba(255,255,255,.22);--ps-glass-edge:rgba(0,0,0,0);--ps-glass-shadow:0 8px 24px rgba(0,0,0,.25);--ps-glass-shadow-lg:0 12px 40px rgba(0,0,0,.35);--ps-glass-tint-blue:rgba(10,132,255,.62);--ps-glass-tint-red:rgba(255,69,58,.58);--ps-glass-solid:rgba(28,28,30,.97);--ps-glass-scrim:rgba(0,0,0,.5);--ps-photo-chip:rgba(18,18,22,.42);--ps-photo-label:#FFF;--ps-photo-shadow:0 1px 2px rgba(0,0,0,.5);--ps-ambient-dim:rgba(0,0,0,.42);--ps-ambient-fade:rgba(0,0,0,.5);--ps-text-shadow:0 1px 2px rgba(0,0,0,.55);--ps-keycap:rgba(255,255,255,.1);--ps-chrome:#1C1C1E;color-scheme:dark}}*{box-sizing:border-box}button,select,input{font:var(--ps-t-callout);appearance:none;-webkit-appearance:none;color:var(--ps-label);background:var(--ps-surface-solid);border:1px solid var(--ps-sep);border-radius:var(--ps-r-sm);padding:var(--ps-s2) var(--ps-s3);accent-color:var(--ps-accent)}button,a,select{touch-action:manipulation}button{min-height:44px;border:0;background:var(--ps-fill);padding:10px 16px;cursor:pointer}button:disabled{opacity:.5;cursor:wait}button:focus-visible,a:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid var(--ps-accent);outline-offset:2px}a{color:var(--ps-accent)}p{margin:8px 0;overflow-wrap:anywhere}[hidden]{display:none!important}.launcher{pointer-events:auto;position:absolute;right:16px;bottom:calc(16px + var(--ps-safe-bottom));background:var(--ps-accent);color:var(--ps-on-action);box-shadow:0 3px 20px var(--ps-shadow-color)}.overlay{pointer-events:auto;position:absolute;inset:0;background:var(--ps-bg);overflow:auto;overscroll-behavior:contain;padding:calc(12px + var(--ps-safe-top)) 12px calc(18px + var(--ps-safe-bottom))}.content{max-width:850px;margin:auto}header,.actions,.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}header{justify-content:space-between}h1{font:var(--ps-t-large);margin:0}.account{font:var(--ps-t-caption);color:var(--ps-label2)}.card{touch-action:none;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;-webkit-touch-callout:none;margin-top:12px;background:var(--ps-surface-solid);border-radius:var(--ps-r-lg);position:relative}.media{touch-action:none;height:48vh;height:48dvh;min-height:180px;display:flex;align-items:center;justify-content:center;overflow:auto}.media[aria-busy=true]{background:var(--ps-surface-solid)}.media[aria-busy=true]::after{content:'Loading\u2026';position:absolute;color:var(--ps-label);background:var(--ps-surface);padding:8px;border-radius:8px}.media img,.media video{display:block;max-width:100%;max-height:100%;object-fit:contain}.media img{pointer-events:none;-webkit-user-drag:none}.card.zoomed,.card.zoomed .media{touch-action:pan-x pan-y pinch-zoom}.card.zoomed .media img{pointer-events:auto}.card.expanded .media img{pointer-events:auto}.card.expanded .media{height:72vh;height:72dvh}.caption{padding:10px 14px}.swipe{color:var(--ps-label2);text-align:center;padding:12px;touch-action:none;background:var(--ps-fill)}.actions{justify-content:center;margin:12px 0}.stats{padding:12px;background:var(--ps-fill);border-radius:var(--ps-r-sm);margin:12px 0}.toolbar{margin:10px 0}select{max-width:100%;min-height:44px}details{margin:16px 0}#sync-local{display:block}#sync-settings>label{display:block;width:100%;margin:12px 0}#sync-settings>label>input{display:block;width:100%;min-width:0;margin-top:4px}.queue{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}.queue button{padding:6px;overflow:hidden}.queue img{width:100%;height:75px;object-fit:cover}.queue span{display:block;font:var(--ps-t-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{min-height:24px}.zoom-control,.trash-toggle{display:flex;align-items:center;gap:8px;white-space:nowrap}#zoom{width:120px;min-width:0;min-height:44px}#history-list li{overflow-wrap:anywhere}#undo-preview{font-size:13px;min-width:0;flex-basis:100%} @media(max-width:599px){.overlay{scrollbar-gutter:stable;padding-right:18px}.actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.actions button{padding:8px}#undo-preview{grid-column:1 / -1;grid-row:2;margin:0}.zoom-control{grid-column:span 2}.zoom-control input{flex:1}.library-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.library-controls>*{width:100%;min-width:0}.album-controls{position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:8px 0 calc(8px + var(--ps-safe-bottom));margin-bottom:0}.album-controls button{padding:8px;font-size:14px;min-width:0;white-space:normal;overflow-wrap:anywhere}.album-controls a,.album-explanation{grid-column:1 / -1;min-width:0}.album-explanation{margin:0;font-size:13px}.trash-toggle{min-height:44px;font-size:14px;white-space:normal;min-width:0}.trash-toggle input{flex-shrink:0}.media{height:32vh;height:32dvh}.stats{font-size:14px;padding:8px}} @media(min-width:800px){.media{height:55vh}.overlay{padding:24px}}h2{font:var(--ps-t-title)}.status,#sync-status,.album-explanation{color:var(--ps-label2)}select{padding-right:var(--ps-s6);background-image:linear-gradient(45deg,transparent 50%,var(--ps-label2) 50%),linear-gradient(135deg,var(--ps-label2) 50%,transparent 50%);background-position:calc(100% - 15px) 50%,calc(100% - 10px) 50%;background-size:5px 5px;background-repeat:no-repeat}input[type=checkbox]{width:22px;height:22px;min-width:22px;padding:0;display:grid;place-content:center}input[type=checkbox]:checked{background:var(--ps-accent);border-color:var(--ps-accent)}input[type=checkbox]:checked::before{content:'\u2713';color:var(--ps-on-action)}input[type=range]{padding:0;background:transparent;border:0}input[type=range]::-webkit-slider-runnable-track{height:4px;background:var(--ps-fill);border-radius:var(--ps-r-pill)}input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:22px;height:22px;margin-top:-9px;border:0;border-radius:var(--ps-r-pill);background:var(--ps-accent)}input[type=range]::-moz-range-track{height:4px;background:var(--ps-fill);border-radius:var(--ps-r-pill)}input[type=range]::-moz-range-thumb{width:22px;height:22px;border:0;border-radius:var(--ps-r-pill);background:var(--ps-accent)}.keep,.remove{background:var(--ps-surface-solid)}.keep{color:var(--ps-accent)}.remove{color:var(--ps-destructive)}#move-trash{background:var(--ps-destructive);color:var(--ps-on-action)}.empty-deck{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:24px;text-align:center;height:100%;box-sizing:border-box}.empty-deck .empty-title{margin:0;font-size:20px;font-weight:600;color:var(--ps-label)}.empty-deck .empty-detail{margin:0;font-size:14px;color:var(--ps-label2)}.empty-deck .empty-action{margin-top:8px;min-height:44px;padding:0 20px;border-radius:22px;border:0;background:var(--ps-accent);color:var(--ps-on-action);font-weight:600}.album-controls,#sync-settings{background:var(--ps-surface-solid);border-radius:var(--ps-r-md)}#sync-settings{padding:var(--ps-s3)}@supports ((backdrop-filter:blur(20px)) or (-webkit-backdrop-filter:blur(20px))){.album-controls,#sync-settings{background:var(--ps-surface);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}}"));
 const tokenBlock=pattern=>(String(styleElement1.textContent||"").match(pattern)?.[1]||'').split(';').filter(Boolean),darkTokens=tokenBlock(/@media\(prefers-color-scheme:dark\)\{:host\{([^}]*)\}\}/),darkNames=new Set(darkTokens.map(rule=>rule.split(':')[0])),lightTokens=tokenBlock(/^:host\{([^}]*)\}/).filter(rule=>darkNames.has(rule.split(':')[0]));
 const schemeStyle=document.createElement('style');schemeStyle.textContent=`:host([data-scheme=dark]){${darkTokens.join(';')}}:host([data-scheme=light]){${lightTokens.join(';')}}`;root.append(schemeStyle);
 if(['dark','light'].includes(environment.demo?.scheme))host.dataset.scheme=environment.demo.scheme;
 const launcherElement=document.createElement('button');
 launcherElement.setAttribute("class","launcher");
 launcherElement.setAttribute("id","launcher");
 root.append(launcherElement);
 launcherElement.append(document.createTextNode("Photos Swipe"));
 const overlayElement=document.createElement('section');
 overlayElement.setAttribute("class","overlay");
 overlayElement.setAttribute("id","overlay");
 overlayElement.hidden=true;
 overlayElement.setAttribute("role","dialog");
 overlayElement.setAttribute("aria-modal","true");
 overlayElement.setAttribute("aria-label","Photos Swipe");
 root.append(overlayElement);
 const divElement4=document.createElement('div');
 divElement4.setAttribute("class","content");
 overlayElement.append(divElement4);
 const headerElement5=document.createElement('header');
 divElement4.append(headerElement5);
 const h1Element6=document.createElement('h1');
 headerElement5.append(h1Element6);
 h1Element6.append(document.createTextNode("Photos Swipe"));
 const versionElement=document.createElement('span');
 versionElement.setAttribute('id','running-version');
 versionElement.setAttribute('class','version-label');
 versionElement.textContent=`v${environment.version}`;
 h1Element6.append(document.createTextNode(' '),versionElement);
 const closeElement=document.createElement('button');
 closeElement.setAttribute("id","close");
 headerElement5.append(closeElement);
 closeElement.append(document.createTextNode("Close"));
 const accountElement=document.createElement('p');
 accountElement.setAttribute("class","account");
 accountElement.setAttribute("id","account");
 divElement4.append(accountElement);
 const cardElement=document.createElement('div');
 cardElement.setAttribute("class","card");
 cardElement.setAttribute("id","card");
 divElement4.append(cardElement);
 const mediaElement=document.createElement('div');
 mediaElement.setAttribute("class","media");
 mediaElement.setAttribute("id","media");
 const topCard=document.createElement('div');topCard.setAttribute('class','top-card');cardElement.append(topCard);topCard.append(mediaElement);
 const underCard=document.createElement('div');underCard.setAttribute('id','next-card');underCard.setAttribute('class','media under-card');underCard.setAttribute('aria-hidden','true');underCard.hidden=true;
 cardElement.insertBefore(underCard,topCard);
 const stamps=[['KEEP','keep'],['TRASH','remove']].map(([label,kind])=>{const stamp=document.createElement('span');stamp.setAttribute('class',`swipe-stamp stamp-${kind}`);stamp.textContent=label;stamp.setAttribute('aria-hidden','true');topCard.append(stamp);return stamp;});
 const feedbackStyles=document.createElement('style');feedbackStyles.textContent='.card{overflow:hidden}.top-card{position:relative;z-index:1;background:var(--ps-surface-solid)}.media{position:relative;z-index:1;background:var(--ps-surface-solid);border-radius:var(--ps-r-lg);-webkit-user-select:none;-webkit-touch-callout:none}.media:has(>[data-video-control]:not([hidden])){padding-bottom:96px}.media .video-poster{width:100%;height:100%;min-width:0;min-height:0;object-fit:contain}.under-card{position:absolute;inset:0 0 auto;z-index:0;pointer-events:none;transform:scale(.94)}.swipe-stamp{position:absolute;top:24px;z-index:2;padding:8px 14px;border:4px solid currentColor;border-radius:8px;font-size:28px;font-weight:800;opacity:0;pointer-events:none}.stamp-keep{left:24px;color:var(--ps-accent);transform:rotate(-12deg)}.stamp-remove{right:24px;color:var(--ps-destructive);transform:rotate(12deg)}';root.append(feedbackStyles);
 const swipeElement=document.createElement('div');
 swipeElement.setAttribute("class","swipe");
 swipeElement.setAttribute("id","swipe");
 cardElement.append(swipeElement);
 swipeElement.append(document.createTextNode("Swipe left to trash \u00b7 right to keep \u00b7 Tap video to play/pause"));
 const captionElement=document.createElement('p');
 captionElement.setAttribute("class","caption");
 captionElement.setAttribute("id","caption");
 divElement4.append(captionElement);
 captionElement.append(document.createTextNode("Load a batch to start reviewing."));
 const divElement13=document.createElement('div');
 divElement13.setAttribute("class","actions");
 divElement4.append(divElement13);
 const removeElement=document.createElement('button');
 removeElement.setAttribute("class","remove");
 removeElement.setAttribute("id","remove");
 divElement13.append(removeElement);
 removeElement.append(document.createTextNode("\u00d7 Trash"));
 const undoElement=document.createElement('button');
 undoElement.setAttribute("id","undo");
 divElement13.append(undoElement);
 undoElement.append(document.createTextNode("Undo"));
 const keepElement=document.createElement('button');
 keepElement.setAttribute("class","keep");
 keepElement.setAttribute("id","keep");
 divElement13.append(keepElement);
 keepElement.append(document.createTextNode("\u2713 Keep"));
 const enlargeElement=document.createElement('button');
 enlargeElement.setAttribute("id","enlarge");
 divElement13.append(enlargeElement);
 enlargeElement.append(document.createTextNode("Enlarge"));
 const labelElement18=document.createElement('label');
 labelElement18.setAttribute('class','zoom-control');
 divElement13.append(labelElement18);
 labelElement18.append(document.createTextNode("Zoom "));
 const zoomElement=document.createElement('input');
 zoomElement.setAttribute("id","zoom");
 zoomElement.setAttribute("type","range");
 zoomElement.setAttribute("min","1");
 zoomElement.setAttribute("max","3");
 zoomElement.setAttribute("step","0.25");
 zoomElement.setAttribute("value","1");
 labelElement18.append(zoomElement);
 const statsElement=document.createElement('div');
 statsElement.setAttribute("class","stats");
 statsElement.setAttribute("id","stats");
 divElement4.append(statsElement);
 const divElement21=document.createElement('div');
 divElement21.setAttribute("class","toolbar library-controls");
 divElement4.append(divElement21);
 const loadElement=document.createElement('button');
 loadElement.setAttribute("id","load");
 divElement21.append(loadElement);
 loadElement.append(document.createTextNode("Load 50 more"));
 const refreshElement=document.createElement('button');
 refreshElement.setAttribute("id","refresh");
 divElement21.append(refreshElement);
 refreshElement.append(document.createTextNode("Check for new"));
 const filterElement=document.createElement('select');
 filterElement.setAttribute("id","filter");
 filterElement.setAttribute("aria-label","Media filter");
 divElement21.append(filterElement);
 const optionElement25=document.createElement('option');
 optionElement25.setAttribute("value","all");
 filterElement.append(optionElement25);
 optionElement25.append(document.createTextNode("All media"));
 const optionElement26=document.createElement('option');
 optionElement26.setAttribute("value","photo");
 filterElement.append(optionElement26);
 optionElement26.append(document.createTextNode("Photos"));
 const optionElement27=document.createElement('option');
 optionElement27.setAttribute("value","video");
 filterElement.append(optionElement27);
 optionElement27.append(document.createTextNode("Videos"));
 const sortElement=document.createElement('select');
 sortElement.setAttribute("id","sort");
 sortElement.setAttribute("aria-label","Review order");
 divElement21.append(sortElement);
 const flashbacksOption=document.createElement('option');flashbacksOption.value='flashbacks';flashbacksOption.textContent='Flashbacks';sortElement.append(flashbacksOption);sortElement.value='flashbacks';
 const optionElement29=document.createElement('option');
 optionElement29.setAttribute("value","original");
 sortElement.append(optionElement29);
 optionElement29.append(document.createTextNode("Timeline"));
 const optionElement30=document.createElement('option');
 optionElement30.setAttribute("value","oldest");
 sortElement.append(optionElement30);
 optionElement30.append(document.createTextNode("Oldest first"));
 const optionElement31=document.createElement('option');
 optionElement31.setAttribute("value","largest");
 sortElement.append(optionElement31);
 optionElement31.append(document.createTextNode("Largest first"));
 const statusElement=document.createElement('p');
 statusElement.setAttribute("role","status");
 statusElement.setAttribute("aria-live","polite");
 statusElement.setAttribute("class","status");
 statusElement.setAttribute("id","status");
 divElement4.append(statusElement);
 const queue_detailsElement=document.createElement('details');
 queue_detailsElement.setAttribute("id","queue-details");
 divElement4.append(queue_detailsElement);
 const queue_titleElement=document.createElement('summary');
 queue_titleElement.setAttribute("id","queue-title");
 queue_detailsElement.append(queue_titleElement);
 queue_titleElement.append(document.createTextNode("Going to Trash"));
 const queueElement=document.createElement('div');
 queueElement.setAttribute("class","queue");
 queueElement.setAttribute("id","queue");
 queue_detailsElement.append(queueElement);
 const divElement36=document.createElement('div');
 divElement36.setAttribute("class","toolbar album-controls");
 const sendElement=document.createElement('button');
 sendElement.setAttribute("id","send");
 divElement36.append(sendElement);
 sendElement.append(document.createTextNode("Send to review album"));
 const trashElement=document.createElement('button');
 trashElement.setAttribute("id","trash");
 divElement36.append(trashElement);
 trashElement.append(document.createTextNode("Check Trash"));
 const albumElement=document.createElement('a');
 albumElement.setAttribute("id","album");
 albumElement.setAttribute("target","_blank");
 albumElement.setAttribute("rel","noopener");
 albumElement.hidden=true;
 divElement36.append(albumElement);
 albumElement.append(document.createTextNode("Open review album \u2197"));
 const pElement40=document.createElement('p');
 pElement40.setAttribute('class','album-explanation');
 divElement36.append(pElement40);
 pElement40.append(document.createTextNode("Swipes never delete media. Send candidates to a review album, or explicitly enable Move to Trash."));
 const trashOptIn=document.createElement('input');trashOptIn.setAttribute('id','trash-opt-in');trashOptIn.type='checkbox';
 const trashLabel=document.createElement('label');trashLabel.setAttribute('class','trash-toggle');trashLabel.append(trashOptIn,document.createTextNode('Enable Move to Trash'));
 const moveTrash=document.createElement('button');moveTrash.setAttribute('id','move-trash');moveTrash.hidden=true;
 const trashCandidates=document.createElement('section');trashCandidates.setAttribute('id','trash-candidates');trashCandidates.hidden=true;
 const trashTitle=document.createElement('h2');trashTitle.setAttribute('id','trash-candidates-title');
 const trashExplanation=document.createElement('p');trashExplanation.textContent='These exact items will move to Trash, including candidates already sent to the review album. Select a thumbnail to inspect it or choose Keep instead.';
 const trashList=document.createElement('div');trashList.setAttribute('id','trash-candidates-list');trashList.setAttribute('class','queue');
 trashCandidates.append(trashTitle,trashExplanation,trashList);
 divElement4.append(trashCandidates);
 divElement4.append(divElement36);
 divElement36.append(trashLabel,moveTrash);
 const settingsPanel=document.createElement('details');settingsPanel.setAttribute('id','sync-settings');const settingsTitle=document.createElement('summary');settingsTitle.textContent='Sync settings';settingsPanel.append(settingsTitle);
 const syncExplanation=document.createElement('p');syncExplanation.textContent='Sign in with Google to sync your progress across devices.';settingsPanel.append(syncExplanation);
 const onboarding=document.createElement('section');onboarding.setAttribute('id','pair-onboarding');onboarding.hidden=true;
 const onboardingTitle=document.createElement('h2');onboardingTitle.textContent='Sync across devices';
 const onboardingText=document.createElement('p');onboardingText.textContent='Sign in once on each device to sync with your Google account.';
 onboarding.append(onboardingTitle,onboardingText);divElement4.insertBefore(onboarding,cardElement);
 const syncLocal=document.createElement('button');syncLocal.setAttribute('id','sync-local');syncLocal.textContent='Continue locally';settingsPanel.append(syncLocal);
 const onboardingLocal=document.createElement('button');onboardingLocal.textContent='Continue locally';onboarding.append(onboardingLocal);onboardingLocal.onclick=()=>syncLocal.onclick();
 let viewerShortcutsBlockedUntil=0;
 const suppressViewerShortcuts=()=>{viewerShortcutsBlockedUntil=Date.now()+500;};
 const syncStatus=document.createElement('p');syncStatus.setAttribute('id','sync-status');syncStatus.setAttribute('role','status');divElement4.insertBefore(settingsPanel,cardElement);divElement4.insertBefore(syncStatus,cardElement);
 const undoPreview=document.createElement('p');undoPreview.setAttribute('id','undo-preview');
 divElement13.insertBefore(undoPreview,enlargeElement);
 const shellStyle=document.createElement('style');shellStyle.textContent='.overlay{scrollbar-gutter:auto;display:flex;align-items:center;justify-content:center;background:var(--ps-bg);padding:24px}.content{display:flex;flex-direction:column;position:relative;width:540px;max-width:100%;max-height:calc(100dvh - 48px);overflow:auto;margin:0;background:var(--ps-bg);border-radius:28px;padding:20px}.content>*{flex-shrink:0}.content .card{display:flex;flex-direction:column;flex-shrink:1;min-height:0;overflow:hidden}.content .top-card{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}.content .media{flex:1 1 auto;min-height:0}.content .caption{flex-shrink:0;margin:0;border-radius:0 0 var(--ps-r-lg) var(--ps-r-lg)}.content .under-card{max-height:100%;overflow:hidden}.content header{flex-wrap:nowrap}.content header button{flex-shrink:0}.content h1{flex-basis:100%;font:var(--ps-t-title)}.content header{flex-wrap:wrap}.version-label{font:var(--ps-t-caption);color:var(--ps-label2)}.media{height:56dvh}.caption{position:relative;overflow-wrap:anywhere;background:var(--ps-surface-solid);pointer-events:none}.actions{display:flex}.actions #remove,.actions #keep{width:72px;height:72px;border-radius:50%;font-size:30px}.actions #undo,.actions #enlarge{border-radius:50%}.settings-sheet{position:absolute;inset:0;z-index:5;overflow:auto;padding:0 20px 20px;background:var(--ps-surface-solid);border-radius:inherit}.settings-sheet .settings-header{position:sticky;top:0;z-index:1;flex-wrap:nowrap;margin:0 -20px;padding:20px;background:var(--ps-surface-solid)}.settings-header h2{margin:0}.settings-sheet .group{padding:12px;background:var(--ps-fill);border-radius:16px;margin:12px 0}.settings-sheet label{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:8px 0}.settings-sheet input{max-width:100%;min-width:0}.settings-sheet #sync-settings{margin:0;padding:0;background:none;border-radius:0;backdrop-filter:none;-webkit-backdrop-filter:none}.settings-sheet #sync-settings>summary{display:none}.settings-sheet #sync-settings label{display:block}.settings-sheet #sync-settings input{width:100%}.settings-sheet #stats{margin:0}.gear-error::after{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ps-destructive)}#sync-status,#undo-preview,.swipe,.zoom-control{display:none}.counter{font:var(--ps-t-callout);border-radius:999px;background:var(--ps-fill);padding:8px;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}.status:empty{visibility:hidden}.status{position:relative;height:60px;min-height:60px;overflow:auto;margin:0;background:var(--ps-surface);border-radius:16px;padding:8px;text-align:center}.review-panel{padding:12px;background:var(--ps-surface-solid);border-radius:16px;margin-top:12px}@media(max-width:599px){.overlay{padding:0}.content{width:100%;max-height:100dvh;border-radius:0;padding:16px}.settings-sheet{border-radius:0}.content h1{position:absolute;width:1px;height:1px;overflow:hidden}.content header{flex-wrap:nowrap;gap:6px}.content header button{padding:10px 12px}.counter{font:var(--ps-t-caption)}.media{height:56dvh}.actions{display:flex}}';root.append(shellStyle);
 const gear=document.createElement('button');gear.setAttribute('id','settings');gear.textContent='\u2699';gear.setAttribute('aria-label','Settings');gear.setAttribute('aria-haspopup','dialog');headerElement5.insertBefore(gear,closeElement);
 const counter=document.createElement('span');counter.setAttribute('class','counter storage-counter');headerElement5.insertBefore(counter,closeElement);
 const storageSession=createSessionStorageCounter();const storageCapsule=createStorageCapsule({document,window,root,element:counter,isVisible:()=>!overlayElement.hidden});
 const reviewButton=document.createElement('button');reviewButton.setAttribute('id','review');reviewButton.setAttribute('aria-label','Review marked items');headerElement5.insertBefore(reviewButton,closeElement);
 closeElement.textContent='\u2715';closeElement.setAttribute('aria-label','Close Photos Swipe');
 const sheet=document.createElement('section');sheet.setAttribute('id','settings-sheet');sheet.setAttribute('class','settings-sheet');sheet.hidden=true;sheet.setAttribute('role','dialog');sheet.setAttribute('aria-label','Settings');
 const sheetHeader=document.createElement('header');sheetHeader.setAttribute('class','settings-header');sheet.append(sheetHeader);
 const sheetClose=document.createElement('button');sheetClose.textContent='Done';
 const sheetTitle=document.createElement('h2');sheetTitle.textContent='Settings';sheetHeader.append(sheetTitle,sheetClose);divElement4.append(sheet);
 const group=(title,...children)=>{const section=document.createElement('section');section.setAttribute('class','group');const heading=document.createElement('h2');heading.textContent=title;section.append(heading,...children);sheet.append(section);return section;};
 settingsTitle.textContent='Sync';settingsPanel.open=true;settingsPanel.insertBefore(accountElement,syncExplanation);group('Sync',settingsPanel).hidden=!!environment.demo;const bringBackLabel=document.createElement('label'),bringBackInput=document.createElement('input');bringBackInput.type='checkbox';bringBackInput.setAttribute('id','bring-back-kept');bringBackInput.checked=true;bringBackLabel.setAttribute('class','toggle-row');bringBackLabel.append(bringBackInput,document.createTextNode(' Bring back kept photos now and then'));bringBackInput.onchange=()=>{resume={...resume,bringBackKept:bringBackInput.checked};deckItems=null;persistResume();render();};group('Show',filterElement,bringBackLabel);sortElement.hidden=true;
 const reviewEvery=document.createElement('input');reviewEvery.setAttribute('id','review-every');reviewEvery.type='number';reviewEvery.min='1';reviewEvery.max='10000';reviewEvery.value='25';reviewEvery.setAttribute('aria-label','Review every N marked');reviewEvery.hidden=true;
 const statsBody=document.createElement('div');statsBody.setAttribute('class','stats-body');statsBody.setAttribute('id','stats-body');const statsGroup=group('Stats',statsBody);statsGroup.setAttribute('class','group stats-group');statsGroup.setAttribute('id','stats-group');
 const deleteMethod=document.createElement('select');deleteMethod.setAttribute('id','delete-method');deleteMethod.setAttribute('aria-label','Delete method');for(const [value,label] of [['trash','Trash']]){const option=document.createElement('option');option.value=value;option.textContent=label;deleteMethod.append(option);}deleteMethod.hidden=true;statsElement.hidden=true;sheet.append(statsElement);group('Library',refreshElement,loadElement,trashElement);group('Previous transfer',sendElement,albumElement).hidden=true;
 const settingsVersion=document.createElement('p');settingsVersion.setAttribute('id','settings-version');settingsVersion.setAttribute('class','version-label');settingsVersion.textContent=`Photos Swipe v${environment.version}`;sheet.append(settingsVersion);
 const reviewPanel=document.createElement('section');reviewPanel.setAttribute('class','review-panel');reviewPanel.setAttribute('id','review-panel');reviewPanel.hidden=true;reviewPanel.append(queue_detailsElement,trashCandidates,divElement36);const doneView=document.createElement('div');doneView.setAttribute('class','trash-done');doneView.setAttribute('id','trash-done');doneView.setAttribute('role','status');doneView.hidden=true;const doneRing=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({viewBox:'0 0 48 48',class:'trash-done-ring','aria-hidden':'true'}))doneRing.setAttribute(key,value);for(const [tag,attributes] of [['circle',{cx:'24',cy:'24',r:'21',fill:'none',stroke:'currentColor','stroke-width':'3'}],['path',{d:'M15 25l6 6 12-13',fill:'none',stroke:'currentColor','stroke-width':'3','stroke-linecap':'round','stroke-linejoin':'round'}]]){const shape=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attributes))shape.setAttribute(key,value);doneRing.append(shape);}const doneFreed=document.createElement('p'),doneCounts=document.createElement('p'),doneContinue=document.createElement('button'),doneTrash=document.createElement('a'),doneNext=document.createElement('p');doneFreed.setAttribute('class','trash-done-freed');doneFreed.setAttribute('id','trash-done-freed');doneCounts.setAttribute('class','trash-done-counts');doneCounts.setAttribute('id','trash-done-counts');doneContinue.setAttribute('class','trash-done-continue');doneContinue.setAttribute('id','keep-swiping');doneContinue.textContent='Keep swiping';doneTrash.setAttribute('class','trash-done-link');doneTrash.setAttribute('id','open-trash');doneTrash.target='_blank';doneTrash.rel='noopener noreferrer';doneTrash.textContent='Open Trash in Google Photos';doneNext.setAttribute('class','trash-done-next');doneNext.setAttribute('id','trash-done-next');const doneDemo=document.createElement('div'),doneDemoText=document.createElement('p'),doneDemoReset=document.createElement('button');doneDemo.setAttribute('class','trash-done-demo');doneDemo.hidden=true;doneDemoText.textContent='Demo: nothing was deleted.';doneDemoReset.textContent='Reset demo';doneDemoReset.onclick=()=>environment.demo?.reset?.();doneDemo.append(doneDemoText,doneDemoReset);doneView.append(doneRing,doneFreed,doneCounts,doneContinue,doneTrash,doneDemo,doneNext);reviewPanel.append(doneView);divElement4.append(reviewPanel);queue_detailsElement.open=true;trashLabel.hidden=true;trashOptIn.checked=true;pElement40.textContent='Review marked items before moving them to Google Photos Trash.';
 let cancelGoogleSignIn=null;
 const openSettings=()=>{sheet.hidden=false;renderSettingsStats();settingsPanel.open=true;gear.setAttribute('aria-expanded','true');sheetClose.focus();}
;const closeSettings=()=>{cancelGoogleSignIn?.();suppressViewerShortcuts();sheet.hidden=true;gear.setAttribute('aria-expanded','false');gear.focus();};gear.onclick=openSettings;sheetClose.onclick=closeSettings;
 const openReview=()=>{swipeFeedback.reset();doneSummary=null;const video=mediaElement.querySelector('video');if(video&&!video.paused){video.pause();resumeReviewPlayback=true;}reviewItems=reviewTrashCandidates(state).map(item=>({...item,legacy:!!item.queueSent}));previewKey=null;reviewPanel.hidden=false;reviewStatus.textContent='';reviewStatus.hidden=true;renderTrashReview();if(moveTrash.disabled||moveTrash.hidden)reviewBack.focus();else moveTrash.focus();};reviewButton.onclick=openReview;
 overlayElement.addEventListener('click',event=>{if(event.target===overlayElement){return close();}});
 document.documentElement.append(host);
 sheet.addEventListener('scroll',()=>sheetHeader.classList.toggle('scrolled',sheet.scrollTop>4),{passive:true});host.dataset.input='pointer';host.addEventListener('pointerdown',()=>{host.dataset.input='pointer';},true);window.addEventListener('keydown',event=>{if(!['Shift','Control','Alt','Meta','CapsLock'].includes(event.key))host.dataset.input='keyboard';},true);
 const icon=(button,label,paths)=>{button.replaceChildren();button.setAttribute('aria-label',label);const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);for(const path of paths){const element=document.createElementNS('http://www.w3.org/2000/svg','path');element.setAttribute('d',path);svg.append(element);}button.append(svg);};
 icon(removeElement,'Mark for Trash',['M6 6l12 12M18 6L6 18']);icon(keepElement,'Keep',['M12 21s-10-6-10-12a5 5 0 0 1 10-3 5 5 0 0 1 10 3c0 6-10 12-10 12Z']);icon(undoElement,'Undo',['M9 14L4 9l5-5','M4 9h10.5a5.5 5.5 0 0 1 0 11H11']);icon(enlargeElement,'Fullscreen photo',['M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7']);icon(closeElement,'Close Photos Swipe',['M6 6l12 12M18 6L6 18']);icon(gear,'Settings',['M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2','M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0']);icon(reviewButton,'Going to Trash',['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13']);
 const trashBadge=document.createElement('span');trashBadge.setAttribute('class','trash-badge');trashBadge.textContent='0';reviewButton.append(trashBadge);const shareElement=document.createElement('button'),openElement=document.createElement('a');shareElement.setAttribute('id','share');shareElement.setAttribute('class','card-tool');openElement.setAttribute('id','open-photos');openElement.setAttribute('class','card-tool');openElement.target='_blank';openElement.rel='noopener';icon(shareElement,'Share',['M12 3v12','M8 7l4-4 4 4','M6 11v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8']);icon(openElement,'Open in Google Photos',['M14 4h6v6','M20 4l-8 8','M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5']);openElement.title='Open in Google Photos to see what\u2019s around it';shareElement.title='Share';topCard.append(shareElement,openElement,enlargeElement);const coach=document.createElement('div');coach.setAttribute('class','coach');coach.setAttribute('aria-hidden','true');coach.hidden=true;const coachArrows=document.createElement('div'),coachDelete=document.createElement('span'),coachKeep=document.createElement('span'),coachHint=document.createElement('p');coachArrows.setAttribute('class','coach-arrows');coachDelete.setAttribute('class','coach-delete');coachDelete.textContent='\u2190 Trash';coachKeep.textContent='Keep \u2192';coachArrows.append(coachDelete,coachKeep);coachHint.textContent=window.matchMedia?.('(pointer: fine)')?.matches?'Swipe or use \u2190 \u2192 \u00b7 Z undo \u00b7 F enlarge':'Swipe left to trash \u00b7 right to keep';coach.append(coachArrows,coachHint);cardElement.append(coach);const videoSpinner=document.createElement('div');videoSpinner.setAttribute('class','video-spinner');videoSpinner.setAttribute('role','progressbar');videoSpinner.setAttribute('aria-label','Loading video');cardElement.append(videoSpinner);statusElement.onclick=()=>{if(statusElement.classList?.contains?.('toast-sticky')){statusElement.classList.remove('toast-sticky');statusElement.classList.add('toast-show');}};
 const queuePill=document.createElement('div');queuePill.setAttribute('class','queue-pill');queuePill.hidden=true;const queueThumbs=document.createElement('span');queueThumbs.setAttribute('class','queue-thumbs');const queueSize=document.createElement('span');queueSize.setAttribute('class','queue-size');const queuePillText=document.createElement('span'),queueGrowth=document.createElement('span'),queueReview=document.createElement('button');queueGrowth.setAttribute('class','queue-growth');queueReview.textContent='Review';queueReview.onclick=openReview;queuePill.setAttribute('role','button');queuePill.tabIndex=0;queuePill.setAttribute('aria-label','Review items going to Trash');queuePill.onclick=event=>{if(event.target!==queueReview)openReview();};queuePill.onkeydown=event=>{if(event.target===queuePill&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openReview();}};const queueGlyph=reviewButton.querySelector?.('svg')?.cloneNode?.(true);queuePill.append(...(queueGlyph?[queueGlyph]:[]),queueThumbs,queuePillText,queueGrowth,queueReview);divElement4.insertBefore(queuePill,divElement13);
 const redesignStyle=document.createElement('style');redesignStyle.textContent=`.overlay{padding:0}.content{width:440px;height:min(860px,90vh);max-height:90dvh;padding:8px 0 0;overflow:hidden;border-radius:24px}.content header{height:48px;flex:none;flex-wrap:nowrap;gap:8px;padding:0 12px}.content h1{position:absolute;width:1px;height:1px;overflow:hidden}.content > header button{position:relative;width:36px;height:36px;min-height:36px;padding:8px;border-radius:50%;flex:none}.content .settings-header button{position:relative;width:auto;min-width:44px;height:36px;min-height:36px;padding:0 14px;border-radius:18px}.content .settings-header button::before{content:"";position:absolute;inset:-4px;background:transparent}.content svg{width:100%;height:100%}.counter{flex:1;text-align:center;background:none;padding:0;font-size:12px}.trash-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:var(--ps-accent);color:#fff;font:600 11px/18px var(--ps-font)}.content .card{flex:1;min-height:0;margin:4px 8px 0;border-radius:20px;background:var(--ps-surface-solid);overflow:hidden}.content .top-card{height:100%}.content .media,.content .card.expanded .media{height:100%;min-height:0;overflow:hidden;border-radius:20px}.content .media img,.content .media video{width:100%;height:100%;object-fit:contain}.content .caption{position:relative;flex:none;order:1;margin:0;padding:8px 14px;background:var(--ps-surface-solid);color:var(--ps-label);font-size:12px;overflow-wrap:anywhere}.content .actions{flex:none;display:flex;align-items:center;gap:28px;margin:0;padding:14px 0 calc(var(--ps-safe-bottom) + 10px)}.actions #remove,.actions #keep{width:72px;height:72px;min-height:72px;padding:21px;box-shadow:0 10px 30px var(--ps-shadow-color)}.actions #remove{color:var(--ps-label);background:var(--ps-surface)}.actions #keep{background:var(--ps-accent);color:#fff}.actions #undo{width:48px;height:48px;min-height:48px;padding:13px;border-radius:50%;background:var(--ps-fill)}#undo:disabled{opacity:.3;cursor:default}.actions button,#enlarge{transition:transform .35s cubic-bezier(.34,1.56,.64,1)}.actions button:active:not(:disabled),#enlarge:active{transform:scale(.92)}#enlarge{position:absolute;top:12px;right:12px;z-index:3;width:36px;height:36px;min-height:36px;padding:9px;border-radius:50%;background:rgba(30,30,30,.35);color:#fff;border:.5px solid rgba(255,255,255,.25);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}.content .card.expanded{position:relative;inset:auto;z-index:4;margin:4px 0 0;border-radius:0}.content .card.expanded .caption{display:none}.content .status{position:relative;order:2;flex:none;height:24px;min-height:24px;margin:0 8px;padding:2px 6px;background:none;font-size:12px}.content .actions{order:4}.queue-pill{order:3}.trash-review-status{margin:0;padding:8px 16px;color:var(--ps-label2);font-size:13px}.content .status:empty{visibility:hidden}.queue-pill{flex:none;display:flex;gap:8px;align-items:center;align-self:center;max-width:calc(100% - 16px);margin-top:10px;padding:6px 10px;border-radius:999px;background:var(--ps-surface);backdrop-filter:blur(20px);font-size:12px}.queue-pill button{color:var(--ps-accent);background:none;padding:6px;min-height:32px}.queue-thumbs{display:flex;padding-left:8px}.queue-thumbs img{width:26px;height:30px;object-fit:cover;border:2px solid var(--ps-bg);border-radius:6px;margin-left:-8px;transform:rotate(-8deg)}.queue-growth{background:var(--ps-accent);color:#fff;border-radius:12px;padding:3px 5px}.video-spinner{position:absolute;left:50%;top:50%;z-index:4;width:44px;height:44px;margin:-22px 0 0 -22px;box-sizing:border-box;border-radius:50%;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;filter:drop-shadow(0 1px 4px rgba(0,0,0,.45));pointer-events:none;opacity:0;visibility:hidden;transition:opacity .15s,visibility 0s .15s;animation:ps-spin .8s linear infinite paused}#card.video-loading .media[aria-busy=true]::after{display:none}#card.video-loading .video-spinner{opacity:1;visibility:visible;transition:opacity .2s .15s,visibility 0s .15s;animation-play-state:running}#card.expanded.video-loading .video-spinner{width:56px;height:56px;margin:-28px 0 0 -28px}#card:has(#media>[data-video-control]:not([hidden])) .video-spinner{margin-top:-70px}#card.expanded:has(#media>[data-video-control]:not([hidden])) .video-spinner{margin-top:-76px}@keyframes ps-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.video-spinner{animation-duration:2.4s}}.content #card.zoomed #media{display:block;overflow:auto;cursor:grab}.content #card.zoomed #media img{display:block;margin:0 auto;max-width:none;max-height:none;height:auto;object-fit:initial}.content #card.zoomed #media:active{cursor:grabbing}.settings-sheet:not([hidden]){animation:ps-sheet-up .28s cubic-bezier(.2,.8,.2,1)}@keyframes ps-sheet-up{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}@media (prefers-reduced-motion:reduce){.settings-sheet:not([hidden]){animation:none}}.trash-done{position:absolute;inset:0;z-index:8;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;background:var(--ps-bg)}.trash-done svg.trash-done-ring{width:72px;height:72px;min-width:72px;flex:none;color:var(--ps-accent)}.trash-done-freed{margin:4px 0 0;font:600 28px/34px var(--ps-font);color:var(--ps-label)}.trash-done-counts,.trash-done-next{margin:0;font-size:15px;color:var(--ps-label2)}.trash-done-continue{margin-top:12px;min-height:50px;min-width:220px;border:0;border-radius:25px;background:var(--ps-accent);color:var(--ps-on-action);font:600 17px/22px var(--ps-font)}.trash-done-link{color:var(--ps-accent);font-size:15px;min-height:44px;display:inline-flex;align-items:center}.content #status.toast-show{animation:ps-status-fade 3.2s ease forwards}
.content #status.toast-show.toast-again{animation-name:ps-status-fade-again}.content #status.toast-sticky{cursor:pointer}.content .status{overflow-x:auto;overflow-y:hidden;white-space:nowrap;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent)}.content .status::-webkit-scrollbar{display:none}@keyframes ps-status-fade{0%,85%{opacity:1}100%{opacity:0}}
@keyframes ps-status-fade-again{0%,85%{opacity:1}100%{opacity:0}}.actions #remove{color:var(--ps-destructive)}.trash-badge{background:var(--ps-destructive)}.coach{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;padding:16px;pointer-events:none;background:linear-gradient(transparent 55%,rgba(0,0,0,.55));color:#fff;text-align:center;border-radius:inherit}.coach .coach-arrows{display:flex;justify-content:space-between;font:600 17px/22px var(--ps-font)}.coach .coach-arrows .coach-delete{color:#ff8a80}.coach p{margin:0;font-size:13px;opacity:.9}.card:has(#media>[data-video-control]:not([hidden])) .coach{padding-bottom:112px}.content:has(> #card.expanded) > :is(.order-row,#caption,.queue-pill,#sync-status){display:none}.content #card.expanded{margin:0;border-radius:0;background:var(--ps-surface-solid)}.content #card.expanded #media{border-radius:0}@media (min-width:601px){.content:has(> #card.expanded){width:min(1200px,calc(100vw - 48px));height:calc(100dvh - 48px);max-height:calc(100dvh - 48px)}}.content #caption{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;padding-bottom:0;border-bottom:8px solid var(--ps-surface-solid)}.queue-pill{cursor:pointer}.queue-pill > svg{width:16px;height:16px;flex:none;color:var(--ps-destructive)}.queue-pill button{min-height:44px;min-width:44px}.review-panel{position:absolute;inset:0;z-index:7;margin:0;padding:0;border-radius:24px;background:var(--ps-bg);display:flex;flex-direction:column;overflow:hidden}.trash-nav{height:48px;flex:none;display:flex;justify-content:space-between;align-items:center;padding:0 12px}.trash-nav button{background:none;color:var(--ps-accent);padding:8px}.trash-scroll{flex:1;min-height:0;overflow:auto}.content .trash-heading{position:static;width:auto;height:auto;overflow:visible;flex-basis:auto;order:0;font:700 30px/36px var(--ps-font);padding:4px 16px 0;margin:0}.trash-size{padding:8px 16px 0;color:var(--ps-accent);font:800 44px/46px var(--ps-font)}.trash-size small{display:block;color:var(--ps-label2);font:600 13px/18px var(--ps-font);text-transform:uppercase;letter-spacing:.6px}.trash-subtitle{padding:2px 16px 12px;color:var(--ps-label2);font-size:15px}.trash-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2px}.trash-tile{position:relative;aspect-ratio:1;min-width:0}.trash-photo{position:absolute;inset:0;width:100%;height:100%;padding:0;border-radius:0;background:var(--ps-fill)}.trash-photo img{width:100%;height:100%;object-fit:cover;display:block}.trash-tile.kept .trash-photo{opacity:.45}.trash-check{position:absolute;right:6px;bottom:6px;width:26px;height:26px;min-height:26px;padding:4px;border-radius:50%;border:2px solid #fff;background:var(--ps-accent);color:#fff}.trash-tile.kept .trash-check{background:rgba(0,0,0,.2)}.trash-tile.kept .trash-check svg{visibility:hidden}.trash-duration{position:absolute;left:6px;bottom:6px;color:#fff;font-size:12px;text-shadow:0 1px 2px #000;pointer-events:none}.trash-legacy{position:absolute;left:6px;top:6px;border-radius:6px;padding:2px 4px;background:rgba(0,0,0,.6);color:#fff;font-size:10px;pointer-events:none}.trash-help{padding:12px 16px;text-align:center;color:var(--ps-label2);font-size:13px}.trash-bar{flex:none;display:flex;gap:10px;padding:12px 16px calc(var(--ps-safe-bottom) + 12px);background:var(--ps-surface);border-top:1px solid var(--ps-sep)}.trash-bar button{flex:1;height:50px;border-radius:14px;font-weight:600}.trash-bar #move-trash,.trash-bar .preview-trash{background:var(--ps-destructive);color:#fff}.trash-preview{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--ps-bg);z-index:1}.trash-preview-media{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:var(--ps-surface-solid)}.trash-preview-media img,.trash-preview-media video{width:100%;height:100%;object-fit:contain}.trash-preview-caption{text-align:center;font-size:15px;padding:10px 12px 0}.trash-preview-caption small{display:block;color:var(--ps-label2);font-size:12px}.trash-strip{display:flex;gap:3px;overflow:auto;padding:8px;flex:none}.trash-strip button{width:34px;height:34px;min-height:34px;padding:0;flex:none;border-radius:4px;opacity:.6}.trash-strip button.active{opacity:1;outline:2px solid var(--ps-accent)}.trash-strip img{width:100%;height:100%;object-fit:cover}.settings-sheet{z-index:8}@media(max-width:600px){.overlay{position:fixed;inset:0;height:100vh;height:100dvh;background:var(--ps-bg);backdrop-filter:none;-webkit-backdrop-filter:none;overflow:hidden}.content{width:100%;height:100vh;height:100dvh;max-height:none;border-radius:0;padding:var(--ps-safe-top) var(--ps-safe-right) 0 var(--ps-safe-left)}.review-panel{position:fixed;border-radius:0;padding-top:var(--ps-safe-top)}.trash-preview{padding-top:var(--ps-safe-top)}.settings-sheet{position:fixed;padding-top:0}.settings-sheet .settings-header{height:auto;padding-top:calc(var(--ps-safe-top) + 20px)}}@media(prefers-reduced-motion:reduce){.actions button,#enlarge{transition:none}}.content > header button::before,#enlarge::before{content:"";position:absolute;inset:-4px;background:transparent}#enlarge::before{inset:-5px}.trash-check::before{content:"";position:absolute;inset:-14px -8px -8px -14px;background:transparent}@media(max-width:600px){.trash-strip button{width:44px;height:44px;min-height:44px}}@media(min-width:600px) and (max-height:699px){.media:has(>[data-video-control]:not([hidden])){padding-bottom:56px}.media>[data-video-control=play],.media>[data-video-control=mute]{bottom:6px!important}.media>[data-video-control=seek]{bottom:6px!important;height:44px!important;left:96px!important;width:calc(100% - 302px)!important}.media>[data-video-control=time]{bottom:17px!important;left:auto!important;right:112px!important;transform:none!important}#card:has(#media>[data-video-control]:not([hidden])) .video-spinner{margin-top:-50px}.card:has(#media>[data-video-control]:not([hidden])) .coach{padding-bottom:72px}}@media(max-height:500px) and (orientation:landscape){.content .trash-heading{font:700 20px/26px var(--ps-font);padding-top:0}.trash-size{display:flex;align-items:baseline;gap:8px;padding:2px 16px 0;font:800 24px/30px var(--ps-font)}.trash-size small{display:inline}.trash-subtitle{padding:0 16px 6px;font-size:13px}.trash-grid{grid-template-columns:repeat(auto-fill,minmax(112px,1fr))}.trash-bar{padding-top:8px;padding-bottom:calc(var(--ps-safe-bottom) + 8px)}.trash-bar button{height:44px}}#pair-onboarding{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:4px 8px 8px;padding:14px 16px;border-radius:16px;background:var(--ps-surface-solid);color:var(--ps-label)}#pair-onboarding[hidden]{display:none}#pair-onboarding h2{flex:1 0 100%;margin:0;font:600 17px/22px var(--ps-font)}#pair-onboarding p{flex:1 0 100%;margin:0 0 4px;font:400 15px/20px var(--ps-font);color:var(--ps-label2)}#pair-onboarding button{flex:1 1 auto;min-height:44px;margin:0;padding:10px 14px;border:0;border-radius:12px;background:var(--ps-fill);color:var(--ps-label);font:600 15px/20px var(--ps-font)}#pair-onboarding #google-sign-in{background:var(--ps-accent);color:var(--ps-on-action)}@media(max-height:700px){#pair-onboarding{padding:12px 16px}#pair-onboarding p{display:none}}@media(max-height:540px) and (orientation:portrait),(max-width:360px) and (max-height:700px) and (orientation:portrait){#pair-onboarding{padding:10px 12px;flex-wrap:nowrap;gap:6px}#pair-onboarding h2{display:none}#pair-onboarding button{padding:8px;font-size:13px;white-space:nowrap}}`;root.append(redesignStyle);
 reviewPanel.replaceChildren();reviewPanel.setAttribute('role','dialog');reviewPanel.setAttribute('aria-label','Going to Trash');
 const navBack=(button,label)=>{button.replaceChildren();const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2.4','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',class:'nav-chevron'}))svg.setAttribute(key,value);const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M15 5l-7 7 7 7');svg.append(path);button.append(svg,document.createTextNode(label));};
 const reviewNav=document.createElement('div');reviewNav.setAttribute('class','trash-nav');const reviewBack=document.createElement('button'),selectAll=document.createElement('button');navBack(reviewBack,'Back');selectAll.textContent='Select All';reviewBack.onclick=()=>{reviewPanel.hidden=true;previewKey=null;renderTrashReview();reviewButton.focus();};reviewNav.append(reviewBack,selectAll);
 const reviewScroll=document.createElement('div');reviewScroll.setAttribute('class','trash-scroll');const reviewHeading=document.createElement('h1');reviewHeading.setAttribute('class','trash-heading');reviewHeading.textContent='Going to Trash';const reviewSubtitle=document.createElement('p');reviewSubtitle.setAttribute('class','trash-subtitle');reviewSubtitle.setAttribute('id','trash-review-subtitle');const reviewGrid=document.createElement('div');reviewGrid.setAttribute('class','trash-grid');reviewGrid.setAttribute('id','trash-review-grid');const reviewHelp=document.createElement('p');reviewHelp.setAttribute('class','trash-help');reviewHelp.textContent='Tap a photo to preview. Untick to keep it. Items stay in Google Photos Trash for 60 days.';const reviewSize=document.createElement('div');reviewSize.setAttribute('class','trash-size');const sizeLabel=document.createElement('small'),sizeValue=document.createElement('span');sizeLabel.textContent='Free up';reviewSize.append(sizeLabel,sizeValue);reviewScroll.append(reviewHeading,reviewSize,reviewSubtitle,reviewGrid,reviewHelp);
 const reviewBar=document.createElement('div');reviewBar.setAttribute('class','trash-bar');const reviewCancel=document.createElement('button');reviewCancel.textContent='Cancel';reviewCancel.onclick=reviewBack.onclick;const reviewStatus=document.createElement('p');reviewStatus.setAttribute('role','status');reviewStatus.setAttribute('class','trash-review-status');reviewStatus.hidden=true;moveTrash.hidden=false;reviewBar.append(reviewCancel,moveTrash);reviewPanel.append(reviewNav,reviewScroll,reviewStatus,reviewBar,doneView);
 const settingsReview=document.createElement('button');settingsReview.textContent='Review';settingsReview.onclick=()=>{closeSettings();openReview();};group('Going to Trash',settingsReview);
 if(environment.demo){const demoNote=document.createElement('p'),demoReset=document.createElement('button');demoNote.textContent='This demo uses sample photos. Nothing here touches a Google Photos library, and nothing is ever deleted.';demoReset.setAttribute('id','demo-reset');demoReset.textContent='Reset demo';demoReset.onclick=()=>environment.demo.reset?.();group('Demo',demoNote,demoReset);}
 sheet.append(settingsVersion);
 const orderRow=document.createElement('div'),orderButton=document.createElement('button'),orderLabel=document.createElement('span'),orderMenu=document.createElement('div'),memoryLabel=document.createElement('div');
 orderRow.setAttribute('class','order-row');orderButton.setAttribute('id','order-switcher');orderButton.setAttribute('aria-label','Review order');orderButton.setAttribute('aria-haspopup','menu');orderMenu.setAttribute('id','order-menu');orderMenu.setAttribute('role','menu');orderMenu.hidden=true;const orderGlyph=(className,path)=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',class:className}))svg.setAttribute(key,value);const shape=document.createElementNS('http://www.w3.org/2000/svg','path');shape.setAttribute('d',path);svg.append(shape);return svg;};orderButton.append(orderLabel,orderGlyph('order-chevron','M8 10l4-4 4 4M8 14l4 4 4-4'));const hapticSwitch=document.createElement('input');if('switch' in hapticSwitch){hapticSwitch.type='checkbox';hapticSwitch.setAttribute('switch','');hapticSwitch.setAttribute('aria-hidden','true');hapticSwitch.tabIndex=-1;hapticSwitch.style.cssText='position:absolute;inset:0;width:100%;height:100%;opacity:0;margin:0;cursor:pointer';orderButton.append(hapticSwitch);}orderRow.append(orderButton,orderMenu);cardElement.parentNode.insertBefore(orderRow,cardElement);memoryLabel.setAttribute('class','memory-label');const memoryDate=document.createElement('span'),memoryPlace=document.createElement('span'),memoryPosition=document.createElement('span'),memoryPlaceSep=document.createElement('span'),memoryPositionSep=document.createElement('span');memoryPlace.setAttribute('class','memory-place');memoryPosition.setAttribute('class','memory-position');for(const separator of [memoryPlaceSep,memoryPositionSep]){separator.setAttribute('class','memory-sep');separator.setAttribute('aria-hidden','true');}memoryLabel.append(memoryDate,memoryPlaceSep,memoryPlace,memoryPositionSep,memoryPosition);topCard.append(memoryLabel);
 function updateOrder(){const order=reviewOrders.find(order=>order[0]===sortElement.value)||reviewOrders[0];orderLabel.textContent=order[1];orderButton.setAttribute('aria-label',`Review order: ${order[1]}`);orderButton.setAttribute('aria-expanded',String(!orderMenu.hidden));for(const button of orderMenu.childNodes)button.setAttribute('aria-checked',String(button.dataset.order===sortElement.value));}
 function chooseOrder(value){if(busy||otherTab||leaseError||inspected||!sheet.hidden||!reviewPanel.hidden)return;const key=current()?.mediaKey;sortElement.value=value;focused=key||null;inspected=null;deckItems=null;orderMenu.hidden=true;buffer.clear();updateOrder();if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)orderLabel.animate?.([{transform:'translateY(100%)',opacity:0},{transform:'translateY(0)',opacity:1}],{duration:200});window.navigator?.vibrate?.(10);render();}
 for(const [value,name] of reviewOrders){const button=document.createElement('button');button.dataset.order=value;button.setAttribute('role','menuitemradio');button.append(orderGlyph('order-check','M5 12l4 4L19 6'),document.createTextNode(name));button.onclick=()=>{chooseOrder(value);if(orderMenu.hidden)orderButton.focus();};orderMenu.append(button);}
 let orderTimer=null,longPressed=false;
 const cancelOrderPress=()=>{window.clearTimeout(orderTimer);orderTimer=null;};
 orderButton.addEventListener('pointerdown',event=>{if(event.button!==0)return;longPressed=false;orderTimer=window.setTimeout(()=>{longPressed=true;orderMenu.hidden=false;updateOrder();},500);});
 for(const type of ['pointerup','pointercancel','pointerleave'])orderButton.addEventListener(type,cancelOrderPress);
 orderButton.onclick=()=>{cancelOrderPress();if(longPressed){longPressed=false;return;}if(!orderMenu.hidden){orderMenu.hidden=true;updateOrder();return;}chooseOrder(reviewOrders[(reviewOrders.findIndex(order=>order[0]===sortElement.value)+1)%reviewOrders.length][0]);};
 orderButton.addEventListener('contextmenu',event=>{event.preventDefault();cancelOrderPress();longPressed=true;orderMenu.hidden=false;updateOrder();});
 overlayElement.addEventListener('pointerdown',event=>{if(!orderRow.contains(event.target)){orderMenu.hidden=true;updateOrder();}});
 orderRow.addEventListener('keydown',event=>{if(event.key==='Escape'){orderMenu.hidden=true;updateOrder();orderButton.focus();}if(event.key==='ArrowDown'){event.preventDefault();orderMenu.hidden=false;updateOrder();orderMenu.childNodes[0].focus();}});
 const orderStyle=document.createElement('style');orderStyle.textContent='.order-row{position:relative;flex:none;align-self:center;margin:10px 0 12px;z-index:3}.order-row>button{display:flex;align-items:center;border-radius:999px;min-height:44px;padding:8px 18px;background:var(--ps-surface);border:0;box-shadow:inset 0 0 0 1px var(--ps-sep);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);overflow:hidden;font-weight:600}.order-row span{display:block;white-space:nowrap}#order-menu{position:absolute;top:calc(100% + 8px);left:50%;transform:translateX(-50%);width:240px;border-radius:18px;background:var(--ps-surface-solid);border:1px solid var(--ps-sep);overflow:hidden;box-shadow:0 10px 30px var(--ps-shadow-color)}#order-menu button{display:block;width:100%;text-align:left;background:none;border-radius:0;border-bottom:1px solid var(--ps-sep)}#order-menu button{display:flex;align-items:center;gap:10px}#order-menu button[aria-checked=true]{color:var(--ps-accent)}.content #order-menu svg.order-check{width:18px;height:18px;flex:none;visibility:hidden}#order-menu button[aria-checked=true] svg.order-check{visibility:visible}.order-row>button{gap:6px}.content .order-row svg.order-chevron{width:14px;height:14px;flex:none;margin-right:-4px;color:var(--ps-label2)}.memory-label{display:flex;max-width:calc(100% - 72px);box-sizing:border-box;white-space:nowrap;position:absolute;top:16px;left:16px;z-index:2;pointer-events:none;border-radius:999px;background:rgba(30,30,30,.6);color:#fff;padding:8px 14px;font:600 15px/20px var(--ps-font);backdrop-filter:blur(20px)}.memory-label[hidden]{display:none}.memory-label>span{flex:none;white-space:pre}.memory-label>.memory-place{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}';root.append(orderStyle);
 const sideLayout=(query,frame,padding,extra='')=>`@media${query}{${frame}grid-template-rows:auto auto auto minmax(0,1fr) auto auto;column-gap:12px;${padding};overflow:hidden}.content>*{grid-column:2}.content:has(> #caption:not([hidden]))>#card:not(.expanded),.content:has(> #caption:not([hidden]))>#card:not(.expanded) #media{border-radius:20px}.content>.review-panel,.content>.settings-sheet{grid-column:1 / -1;grid-row:1 / -1}.content>#card{grid-column:1;grid-row:1 / -1;align-self:stretch;height:auto;min-height:0;margin:10px 0}.content:has(> #caption:not([hidden]))>#card:not(.expanded){margin:10px 0}.content>header:first-child{grid-row:1;height:56px}.content>.order-row{grid-row:2;justify-self:center;margin:2px 0 6px}.content>#caption{grid-row:4;align-self:start;margin:0;border-radius:14px;font-size:12px}.content>.queue-pill{grid-row:4;align-self:end;margin:0}.content .actions{grid-row:6;justify-content:center;gap:18px;padding:8px 0}.content .actions #remove,.content .actions #keep{width:60px;height:60px;min-height:60px;padding:17px}.content>.status{grid-row:5;margin:0}
.content>#pair-onboarding{grid-row:3;margin:0 0 8px}${extra}}`;
 const layoutStyle=document.createElement('style');layoutStyle.textContent='.content:has(> #caption:not([hidden]))>#card:not(.expanded),.content:has(> #caption:not([hidden]))>#card:not(.expanded) #media{border-bottom-left-radius:0;border-bottom-right-radius:0}.content:has(> #caption:not([hidden]))>#card:not(.expanded){margin-bottom:0}.content>#caption{margin:0 8px;border-radius:0 0 20px 20px}.content>.library-controls{margin:0}.content:has(> #caption:not([hidden])){row-gap:0}.card-tool{position:absolute;top:12px;z-index:3;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:36px;height:36px;min-height:36px;padding:9px;border-radius:50%;background:rgba(30,30,30,.35);color:#fff;border:.5px solid rgba(255,255,255,.25);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);transition:transform .35s cubic-bezier(.34,1.56,.64,1)}.card-tool svg{width:18px;height:18px;flex:none}.card-tool::before{content:"";position:absolute;inset:-5px}.card-tool:active{transform:scale(.92)}.card-tool[hidden]{display:none}.card-tool{right:12px}#open-photos{top:56px}#share{top:100px}#share[aria-busy=true]{opacity:.6}.content #card{container-type:size;container-name:ps-card}@container ps-card (max-height:149px){#open-photos,#share{display:none}}@container ps-card (max-height:229px){.coach .coach-arrows{padding:0 48px}}@container ps-card (max-height:339px){.card:has(#media>[data-video-control]:not([hidden])) .coach .coach-arrows{padding:0 48px}}#card:fullscreen,#card:-webkit-full-screen{width:100vw;height:100vh;max-width:none;max-height:none;margin:0;border-radius:0;background:#000}#card:fullscreen .top-card,#card:fullscreen #media,#card:-webkit-full-screen .top-card,#card:-webkit-full-screen #media{height:100%;border-radius:0;background:#000}#card:fullscreen #media img,#card:fullscreen #media video,#card:-webkit-full-screen #media img,#card:-webkit-full-screen #media video{width:100%;height:100%;object-fit:contain}#card:fullscreen .under-card,#card:-webkit-full-screen .under-card{height:100%;max-height:none;border-radius:0;background:#000}#card:fullscreen .under-card img,#card:-webkit-full-screen .under-card img{width:100%;height:100%;object-fit:contain}#card::backdrop{background:#000}@media(max-width:599px){.content:has(> #card.expanded)>header:first-child{display:none}.content #card.expanded{margin-top:0}}'+sideLayout('(orientation:landscape) and (max-height:520px)','.overlay{padding:0}.content,.content:has(> #card.expanded){width:100vw;height:100vh;height:100dvh;max-width:none;max-height:none;border-radius:0;display:grid;grid-template-columns:minmax(0,1fr) 256px;','padding:var(--ps-safe-top) max(12px,var(--ps-safe-right)) var(--ps-safe-bottom) max(12px,var(--ps-safe-left))','@media(pointer:coarse){.content:has(> #card.expanded){grid-template-columns:minmax(0,1fr)}.content:has(> #card.expanded)>:not(#card){display:none}.content:has(> #card.expanded)>#card{grid-column:1;margin:0}}.content>#pair-onboarding{grid-column:1;grid-row:1 / -1;align-self:start;z-index:5;margin:22px 60px 0 12px;padding:10px 12px;box-shadow:0 10px 30px var(--ps-shadow-color)}.content>#pair-onboarding p{display:none}')+sideLayout('(min-width:900px) and (min-height:700px)','.overlay{padding:24px}.content,.content:has(> #card.expanded){width:min(2560px,calc(100vw - 48px));height:calc(100vh - 48px);height:calc(100dvh - 48px);max-width:none;max-height:none;border-radius:24px;display:grid;grid-template-columns:minmax(0,1fr) 300px;','padding:0 16px','.trash-grid{grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}.settings-sheet>:not(.settings-header){max-width:680px;margin-left:auto;margin-right:auto}.content>#card,.content:has(> #caption:not([hidden]))>#card:not(.expanded){margin:16px 0}')+'';root.append(layoutStyle);
 let chromeTint='',reviewItems=[],previewKey=null,reviewSignature='',reviewStructure='',reviewTiles=new Map(),reviewLatest=new Map(),reviewOrder=[],reviewMore=null,reviewRowsMemo=null,previewVideo=null,previewGeneration=0,pageLock=null,resumeReviewPlayback=false;
 function lockPage(){
  if(pageLock)return;
  const viewport=document.querySelector('meta[name="viewport"]'),created=!viewport,meta=viewport||document.createElement('meta');
  pageLock={html:document.documentElement.style.cssText,body:document.body.style.cssText,x:window.scrollX,y:window.scrollY,meta,content:meta.getAttribute('content'),created};
  if(created){meta.setAttribute('name','viewport');document.head.append(meta);}
  pageLock.theme=document.createElement('meta');pageLock.theme.setAttribute('name','theme-color');pageLock.theme.setAttribute('content',chromeTint||window.getComputedStyle?.(overlayElement)?.backgroundColor||'');document.head?.prepend?.(pageLock.theme);
  meta.setAttribute('content',`${(pageLock.content||'width=device-width, initial-scale=1').replace(/,?\s*viewport-fit\s*=\s*[^,\s]+/gi,'')}, viewport-fit=cover`);
  document.documentElement.style.overflow='hidden';document.documentElement.style.overscrollBehavior='none';Object.assign(document.body.style,{overflow:'hidden',overscrollBehavior:'none',position:'fixed',top:`-${pageLock.y}px`,left:`-${pageLock.x}px`,width:'100%'});
 }
 function unlockPage(){if(!pageLock)return;const saved=pageLock;pageLock=null;document.documentElement.style.cssText=saved.html;document.body.style.cssText=saved.body;saved.theme.remove?.();if(saved.created)saved.meta.remove();else if(saved.content===null)saved.meta.removeAttribute('content');else saved.meta.setAttribute('content',saved.content);window.scrollTo(saved.x,saved.y);}
 const $=id=>root.getElementById(id);
 let resume={},resumeWrite=Promise.resolve(),videoSavedAt=0;
 let dbPromise,db,state=emptyReview(),identity,busy=false,refocus=false,inspected=null,focused=null,shown=null,generation=0,leaseError=null,leaseRecoveryPending=false,lockedAccount=null,syncEnabled=false,syncSummary='Sync off \u00b7 saved locally';
 const database=()=>dbPromise||(dbPromise=openReviewDatabase(environment.indexedDB).catch(error=>{dbPromise=null;throw error;}));
 const pairingNotice=document.createElement('p');settingsPanel.append(pairingNotice);
 const pairingPromise=createPairingStore({GM:environment.GM,database,crypto:environment.crypto}).then(async store=>{

  try{await store.settings();}catch(error){pairingNotice.textContent=`Sync storage unavailable: ${error.message}`;}
  return store;
 });
 const accountMismatch=document.createElement('p');accountMismatch.hidden=true;divElement4.insertBefore(accountMismatch,cardElement);
 const googleSignIn=document.createElement('button');googleSignIn.setAttribute('id','google-sign-in');googleSignIn.textContent='Sign in with Google';onboarding.append(googleSignIn);
 const googleSettings=document.createElement('button');googleSettings.setAttribute('id','google-settings');settingsPanel.append(googleSettings);
 const googleSignOut=document.createElement('button');googleSignOut.setAttribute('id','google-sign-out');googleSignOut.textContent='Sign out';settingsPanel.append(googleSignOut);
 const storageDetails=document.createElement('details');storageDetails.setAttribute('class','storage-details');const storageTitle=document.createElement('summary');storageTitle.textContent='What we store';storageDetails.append(storageTitle);
 for(const text of ["Your Google account email and Google account ID, to link your devices to one sync space.","Each Keep or Trash decision, keyed by Google Photos' internal item ID, with when and from which device it was made.","Your review progress and undo history: for each photo you\u2019ve reviewed, its item ID plus the details the app already shows (such as dates, type, and Google's own thumbnail link). The link only works for your signed-in Google account.","Each device's name (like \"Chrome on Mac\") and a hashed sign-in token. Pending sign-ins expire after 5 minutes.","No photos or videos, no image files, and no Google password or Google access token are ever stored."]){const paragraph=document.createElement('p');paragraph.textContent=text;storageDetails.append(paragraph);}settingsPanel.append(storageDetails);
 const showSyncAccount=settings=>{const signedIn=!!(settings.token&&settings.email);pairingNotice.textContent=signedIn?'Sync account: '+settings.email:settings.token?'Sign in with Google to link your existing sync progress.':'';googleSettings.textContent=signedIn?'Switch account':'Sign in with Google';googleSignOut.hidden=!signedIn;syncLocal.hidden=signedIn;accountMismatch.hidden=!signedIn||!identity?.label||identity.label===settings.email.toLowerCase();accountMismatch.textContent=accountMismatch.hidden?'':'This device syncs as '+settings.email+'; Photos is showing '+identity.label+'. Switch account in Settings.';};
 showSyncAccount({});
 googleSignOut.onclick=()=>run(async()=>{cancelGoogleSignIn?.();await syncRunning;const store=await pairingPromise,settings=await store.settings();await store.saveSettings({...settings,token:'',email:'',onboardingDismissed:true});syncEnabled=false;syncClient.configure({});showSyncAccount({});message('Signed out \u00b7 progress saved locally');});
 const signInGoogle=async(resumeState)=>{
  if(cancelGoogleSignIn||googleSignIn.disabled||googleSettings.disabled)return;
  openSettings();googleSignIn.disabled=true;googleSettings.disabled=true;
  const gm=environment.GM,origin='https://photoswiper-sync.sidlakkoju.workers.dev';
  let popup,timer,deadline,cancelled=false,rejectStop,navigating=false,claimCode=resumeState?.code;
  const receiveCode=event=>{if(!popup||event.origin!==origin||event.source!==popup||event.data?.type!=='photos-swipe-google-sign-in'||event.data.state!==activeState||!/^[A-Za-z0-9_-]{43}$/.test(event.data.code||''))return;claimCode=event.data.code;};
  let activeState;
  window.addEventListener?.('message',receiveCode);
  const stopped=new Promise((resolve,reject)=>{rejectStop=reject;});stopped.catch(()=>{});
  const stop=reason=>{cancelled=true;rejectStop(Error(reason));};
  cancelGoogleSignIn=()=>stop('Sign-in cancelled');
  const cancel=document.createElement('button');cancel.id='google-sign-in-cancel';cancel.textContent='Cancel';cancel.onclick=cancelGoogleSignIn;
  const privateRequest=(path,value,token)=>new Promise((resolve,reject)=>{gm.xmlHttpRequest({method:'POST',url:origin+path,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},data:JSON.stringify(value),timeout:10000,onload:response=>{try{resolve({status:response.status,value:JSON.parse(response.responseText)});}catch(error){reject(error);}},onerror:()=>reject(Error('Sign-in request failed')),ontimeout:()=>reject(Error('Sign-in request timed out'))});});
  const wait=promise=>Promise.race([promise,stopped]);
  try{
   if(typeof gm?.xmlHttpRequest!=='function')throw Error('Google sync requires private userscript storage and GM.xmlHttpRequest.');
   const ios=/iPhone|iPad|iPod/.test(window.navigator?.userAgent||'')||(window.navigator?.platform==='MacIntel'&&window.navigator?.maxTouchPoints>1);

   pairingNotice.textContent=resumeState?'Completing Google sign-in\u2026':'Opening Google sign-in\u2026';pairingNotice.append(cancel);
   deadline=environment.setTimeout(()=>stop('Google sign-in timed out. Please try again.'),300000);
   const store=await wait(pairingPromise);
   if(!store.durable)throw Error('Google sync requires private userscript storage and GM.xmlHttpRequest.');
   const state=resumeState?.state||btoa(String.fromCharCode(...environment.crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
   const claimSecret=resumeState?.claimSecret||btoa(String.fromCharCode(...environment.crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
   activeState=state;
   await wait(gm.setValue('photos-swipe-google-state',state));
   await wait(gm.setValue('photos-swipe-google-claim-secret',claimSecret));
   const previous=await wait(store.settings());
   if(!resumeState){
    const session=await wait(privateRequest('/auth/session',{state,automatic:true,claimSecret,name:ios?'iPhone (Safari)':'Browser',platform:window.navigator?.platform||'browser',loginHint:identity?.label||'',sourceScope:identity?.account||'default'},previous.token));
    if(session.status!==200)throw Error('Could not start Google sign-in');
    const target=new URL(session.value.url);
    target.searchParams.set('return',location.href);
    await wait(writes.flush());if(writes.pending)throw Error('Local changes could not be saved. Please retry sign-in after saving.');
    try{window.location.href=target.href;navigating=true;return;}catch{}
    target.searchParams.delete('return');
    popup=window.open?.(target.href,'_blank','popup,width=560,height=700')||gm.openInTab?.(target.href,{active:true});
    if(!popup)throw Error('Could not open Google sign-in. Please try again.');
    pairingNotice.textContent='Sign-in page opened. Waiting for Google sign-in\u2026';pairingNotice.append(cancel);
   }
   let claim;
   while(!cancelled){
    if(!resumeState)await wait(new Promise(resolve=>{timer=environment.setTimeout(resolve,2000);}));
    resumeState=null;
    if(sheet.hidden)throw Error('Sign-in cancelled');
    if(await wait(gm.getValue('photos-swipe-google-state'))!==state)throw Error('Sign-in cancelled');
    try{claim=await wait(privateRequest('/auth/poll',{state,claimSecret,...(claimCode?{code:claimCode}:{})},previous.token));}catch(error){if(cancelled)throw error;continue;}
    if(claim.status===400||claim.status===401)throw Error('Google sign-in failed. Please try again.');
    if(claim.status!==200)continue;
    if(claim.value.status==='done')break;
    if(claim.value.status!=='pending')throw Error(claim.value.error||(claim.value.status==='expired'?'Google sign-in timed out. Please try again.':'Google sign-in failed. Please try again.'));
   }
   const {status,...credentials}=claim.value;
   await wait(syncRunning);
   await wait(store.saveSettings({url:origin,...credentials,photosAccount:identity?.account,onboardingDismissed:true}));
   syncClient.configure({url:origin,...credentials});syncEnabled=true;onboarding.hidden=true;syncLocal.hidden=true;showSyncAccount(credentials);await synchronize();
  }catch(error){pairingNotice.textContent=error.message;}finally{
   window.removeEventListener?.('message',receiveCode);
   environment.clearTimeout(timer);environment.clearTimeout(deadline);cancel.hidden=true;
   try{popup?.close();}catch{}
   try{if(!navigating){await gm?.deleteValue('photos-swipe-google-state');await gm?.deleteValue('photos-swipe-google-claim-secret');}}catch{}finally{if(!navigating){cancelGoogleSignIn=null;googleSignIn.disabled=false;googleSettings.disabled=false;}}
  }
 };
 googleSignIn.onclick=()=>signInGoogle();googleSettings.onclick=()=>signInGoogle();
 const resumeGoogleSignIn=async()=>{try{
  const target=new URL(location.href),fragment=new URLSearchParams(target.hash.slice(1)),state=fragment.get('photos-swipe-state'),code=fragment.get('photos-swipe-code');
  if(fragment.has('photos-swipe-code')){target.hash=fragment.get('photos-swipe-return-hash')||'';window.history?.replaceState(null,'',target.href);}
  const stored=await environment.GM?.getValue('photos-swipe-google-state');
  if(/^[A-Za-z0-9_-]{43}$/.test(stored||''))await signInGoogle({state:stored,claimSecret:await environment.GM.getValue('photos-swipe-google-claim-secret'),...(state===stored&&/^[A-Za-z0-9_-]{43}$/.test(code||'')?{code}:{})});
  else if(stored){await environment.GM.deleteValue('photos-swipe-google-state');pairingNotice.textContent='Google sign-in failed. Please try again.';}
 }catch(error){pairingNotice.textContent=error.message;}};
 const clearCredentials=async()=>{const store=await pairingPromise,settings=await store.settings();await store.saveSettings({...settings,token:'',email:'',unpaired:true});syncEnabled=false;showSyncAccount({});};
 const syncClient=createSyncClient({fetch:environment.syncFetch||environment.fetch,unpaired:clearCredentials,status:value=>{syncSummary=value;syncStatus.textContent=value;const failed=/saved locally; retry|unpaired/i.test(value);gear.classList.toggle('gear-error',failed);gear.setAttribute('aria-label',failed?'Settings \u00b7 sync error':'Settings');if(failed)message(value);}});
 const googleSignInResumed=resumeGoogleSignIn();
 let pageActive=true,suspendingPromise=null,resumeOpening=false;
 let sessionClosing=false;
 let lastPullAt=0,activeAt=Date.now(),leaseTimer,syncTimer,openingPromise=null,closingPromise=null,activeOperation=null,syncRunning=null,decisionCount=0,writeRevision=0,leaseTicks=0,writeConflict=null,leaseGeneration=0,acquiringAccount=null,otherTab=false,takeoverPending=false;
 const useHere=document.createElement('button');useHere.setAttribute('id','use-here');useHere.textContent='Use here';useHere.hidden=true;useHere.onclick=()=>open(true);
 const createWrites=()=>createWriteQueue({snapshot:()=>({...state,revision:writeRevision}),write:async next=>{await assertSaveAccount();if(writeConflict)throw writeConflict;if(leaseError)throw leaseError;return db.save(identity.account,next);},committed:(saved,value,duration)=>{if(window.localStorage?.psDebug==='1')window.console?.table({persistenceMs:duration});writeRevision=saved.revision;state={...state,revision:writeRevision};persistedItems=value.items;while(refreshedItems.has(persistedItems))persistedItems=refreshedItems.get(persistedItems);if(state.items===persistedItems)persistResume();},error:error=>{if(error.message.includes('Progress changed in another tab'))writeConflict=error;message(leaseError?leaseError.message:writeConflict?'Local save conflict. Unsaved decisions remain visible. Reload the page to read the other tab\u2019s progress; unsaved decisions will be lost.':`Local save failed: ${error.message} \u00b7 pending changes will retry.`);}});
 const refreshedItems=new WeakMap();
 let writes=createWrites(),persistedItems=null;
 const synchronize=(pull=true)=>{
  if(!identity||!syncEnabled||otherTab||leaseError||writeConflict||leaseRecoveryPending||!lockedAccount)return Promise.resolve();
  if(syncRunning)return syncRunning.then(()=>synchronize(pull));
  if(pull)lastPullAt=Date.now();
  const account=identity.account,token=leaseGeneration;let version;
  syncRunning=(async()=>{
   await writes.flush();if(writes.pending)return;
   if(!await renewLease())return;
   if(token!==leaseGeneration||otherTab||leaseError||writeConflict||lockedAccount!==account||identity?.account!==account)return;
   version=state;
   const next=await syncClient.sync(account,version,async value=>value,{pull,rebuild:next=>rebuildSyncedReview(next,call)});
   if(token!==leaseGeneration||leaseRecoveryPending)return;
   await refreshLease();
   if(token===leaseGeneration&&!otherTab&&!leaseError&&identity?.account===account&&next!==version){
    state={...mergeSyncResult(state,version,next),revision:writeRevision};memoryVersion++;
    await writes.enqueue();render();
   }
  })().finally(()=>{syncRunning=null;});
  return syncRunning;
 };
 function scheduleSync(){
  if(!syncEnabled||sessionClosing||otherTab)return;
  window.clearTimeout(syncTimer);
  activeAt=Date.now();
  if(++decisionCount>=10&&!busy&&!activeOperation&&syncClient.ready()){decisionCount=0;synchronize(false);}
  else syncTimer=window.setTimeout(()=>{decisionCount=0;if(!busy&&!activeOperation&&syncClient.ready())synchronize(false);},SYNC_PUSH_DELAY_MS);
  syncTimer?.unref?.();
 }
 function apply(next,removedKey){state=markSyncChanges(state,next);if(removedKey&&deckCache){deckCache=deckCache.filter(item=>item.mediaKey!==removedKey);deckItems=state.items;}render();writes.enqueue();scheduleSync();}
 const readyMessage=()=>gear.classList.contains('gear-error')?syncSummary:'';
 const idleMessage=()=>state.job?'A saved album operation is ready to retry.':readyMessage();
 const message=value=>{const statusNode=$('status');statusNode.textContent=otherTab?'Open in another tab':value;statusNode.title=statusNode.textContent;const toast=statusNode.textContent?/fail|error|unavailable|couldn|could not|denied|conflict|another tab|not been saved|unsaved|retry/i.test(statusNode.textContent)?'toast-sticky':'toast-show':'';if(toast==='toast-show'&&statusNode.classList?.contains?.('toast-show'))statusNode.classList.toggle('toast-again');else{statusNode.classList?.remove?.('toast-show','toast-sticky','toast-again');if(toast){void statusNode.offsetWidth;statusNode.classList?.add?.(toast);}}reviewStatus.textContent=reviewPanel.hidden?'':value;reviewStatus.hidden=!reviewStatus.textContent;useHere.hidden=!(otherTab||leaseError?.message.includes('busy in another tab'));if(!useHere.hidden)showLockCard();};
 function persistResume(){if(otherTab||!identity||!db||state.items!==persistedItems)return;const account=identity.account,item=current();resume={...resume,currentId:item?.mediaKey||null,inspected:!!inspected,filter:$('filter').value,sort:$('sort').value,reviewEvery:Number(reviewEvery.value)||25,deleteMethod:deleteMethod.value};const value={...resume,flashbacks:resume.flashbacks&&{...resume.flashbacks},video:resume.video&&{...resume.video}};resumeWrite=resumeWrite.catch(()=>{}).then(()=>db.saveResume(account,value)).catch(error=>message(`Could not save resume: ${error.message}`));}
 function captureVideo(){const video=$('media').querySelector('video');if(video&&video.dataset.resumeReady!=='pending'&&shown&&Number.isFinite(video.currentTime)){resume={...resume,video:{key:shown,time:video.currentTime}};persistResume();}}
 async function call(operation,args={}) {
  if(!pageVisible())throw sessionChanged();
  if(leaseError)throw leaseError;
  const token=leaseGeneration;
  const result=await rawCall(operation,{...args,...(identity?{account:identity.account}:{})});
  if(!result.ok)throw Error(result.error);
  if(!pageVisible()||token!==leaseGeneration)throw sessionChanged();
  if(leaseError)throw leaseError;
  return result.data;
 }
 const pageVisible=()=>pageActive&&!document.hidden;
 const sessionChanged=()=>Error('Session changed. Close and reopen Photos Swipe.');
 function stopSync(){window.clearTimeout(syncTimer);syncTimer=null;}
 function stopRenewal(){clearInterval(leaseTimer);leaseTimer=null;}
 function releaseLease(){
  leaseGeneration++;
  stopRenewal();
  const account=lockedAccount||acquiringAccount;lockedAccount=null;acquiringAccount=null;
  return account?db.lease(account,owner,true).then(()=>notifyTabs(account)).catch(()=>{}):Promise.resolve();
 }
 async function assertAccount(){
  const token=leaseGeneration,account=identity?.account;
  if(!account)throw Error('Close and reopen Photos Swipe after signing into Google Photos.');
  const response=await rawCall('identity');
  if(token!==leaseGeneration||account!==identity?.account)throw sessionChanged();
  if(!response.ok)throw Error(response.error);
  if(response.data.account!==account){
   leaseError=Error('Google account changed. Close and reopen Photos Swipe.');
   releaseLease();message(leaseError.message);throw leaseError;
  }
 }
 function assertLockedAccount(){if(!lockedAccount||lockedAccount!==identity?.account)throw sessionChanged();}
 async function assertSaveAccount(){
  assertLockedAccount();
  await assertAccount();
  try{await db.lease(identity.account,owner);}catch(error){lockedAccount=null;leaseError=error;startRenewal();message(error.message);throw error;}
  assertLockedAccount();
 }
 async function save(next){await syncRunning;await assertSaveAccount();state=markSyncChanges(state,typeof next==='function'?next(state):next);memoryVersion++;await writes.enqueue();if(writes.pending)throw leaseError||Error('Local changes have not been saved.');return state;}
 function controls(){let hasCard;const cardPresent=()=>hasCard??=!!current();for(const button of root.querySelectorAll('button,select'))if(!['close','launcher','google-sign-in','google-settings','google-sign-in-cancel','retry'].includes(button.id))button.disabled=busy||!identity||(['keep','remove','enlarge'].includes(button.id)&&!cardPresent())||(otherTab&&button!==useHere)||(button.id==='undo'&&!historyView().nextUndo)||(button.id==='move-trash'&&!(reviewItems.length&&reviewRows().some(item=>item.decision==='remove')))||(!syncEnabled&&['refresh-devices','revoke-other-devices'].includes(button.id));$('overlay').setAttribute('aria-busy',String(busy));}
 function startRenewal(){
  if(leaseTimer||sessionClosing||!pageVisible()||$('overlay').hidden)return;
  leaseTimer=setInterval(()=>refreshLease(),LEASE_HEARTBEAT_MS);
  leaseTimer?.unref?.();
 }
 function pauseForOtherTab(){
  if(!sheet.hidden)closeSettings();reviewPanel.hidden=true;previewKey=null;resumeReviewPlayback=false;renderTrashReview();$('close').focus();
  leaseGeneration++;cancelLibraryFill();stopSync();libraryFailure=null;otherTab=true;acquiringAccount=null;swipeFeedback.reset();leaseError=Error('Open in another tab');lockedAccount=null;stopRenewal();startRenewal();message(leaseError.message);controls();
 }
 const hasLocalChanges=()=>activeOperation||writes.pending||state.items!==persistedItems;
 async function renewLease(takeover=false,claim=false){
  await ownerReady;
  const token=leaseGeneration,account=identity?.account;
  const sessionCurrent=()=>token===leaseGeneration&&!otherTab&&account===identity?.account;
  if(!account||otherTab||!pageVisible())return false;
  try{
   await assertAccount();
   if(!sessionCurrent())return false;
   acquiringAccount=account;
   let lease=await db.lease(account,owner,false,takeover||!!leaseError||hasLocalChanges(),claim);
   if(!sessionCurrent())return false;
   if(lease.owner!==owner&&hasLocalChanges())lease=await db.lease(account,owner,false,true);
   if(!sessionCurrent())return false;
   if(lease.owner!==owner){pauseForOtherTab();return false;}
   const acquired=lockedAccount!==account;lockedAccount=account;leaseError=null;startRenewal();if(acquired)notifyTabs(account);return true;
  }catch(error){
   if(token===leaseGeneration){lockedAccount=null;leaseError=error;message(error.message);startRenewal();}
   return false;
  }finally{if(token===leaseGeneration)acquiringAccount=null;}
 }
 async function refreshLease(){
  await suspendingPromise;
  if(sessionClosing||!pageVisible()||$('overlay').hidden)return;
  if(otherTab){const lease=await db.readLease(identity.account);if(!busy&&!openingPromise&&(!lease||lease.expires<=Date.now()))await open();return;}
  const token=leaseGeneration,recovering=leaseRecoveryPending||!!leaseError;
  const account=identity?.account;
  if(!account)return;
  if(recovering)leaseRecoveryPending=true;
  if(!await renewLease()||token!==leaseGeneration)return;
  if(recovering){if(busy||activeOperation||syncRunning||closingPromise||$('overlay').hidden)return;await open();return;}
  if(!busy&&!activeOperation&&!syncRunning){writes.flush();refill();}
  if(syncEnabled&&!busy&&!activeOperation&&!syncRunning&&!$('overlay').hidden&&syncClient.ready()){const mode=heartbeatSync(state,lastPullAt,Date.now(),activeAt);if(mode)synchronize(mode==='pull');}
 }
 async function withAccountLease(task) {
  if(!await renewLease(true))throw leaseError||sessionChanged();
  await writes.flush();if(writes.pending)throw Error('Save pending local changes before this operation.');
  await task();scheduleSync();
 }
 async function run(task) {
  if(busy||activeOperation)return;
  activeOperation=(async()=>{
   try {
    db=await database();
    await libraryLoading;await syncRunning;
    busy=true;controls();
    await assertAccount();
    await withAccountLease(task);
   }catch(error){message(error.message);}finally{
    busy=false;render();controls();
   }
  })();
  await activeOperation;activeOperation=null;
 }
 const bytes=formatStorageBytes;
 const itemSize=item=>Number.isFinite(item.size)&&item.size>=0?bytes(item.size):'Unknown size';
 const estimate=items=>{const total=reviewStorage(items);return `${bytes(total.bytes)}${total.unknown?` + ${total.unknown} unknown`:''}`;};
 let deckCache=null,deckItems=null,deckFilter=null,deckSort=null;
 function deck(){if(deckItems===state.items&&deckFilter===$('filter').value&&deckSort===$('sort').value)return deckCache;deckItems=state.items;deckFilter=$('filter').value;deckSort=$('sort').value;const bringBack=resume.bringBackKept!==false;if(deckSort==='flashbacks')(resume.flashbacks||={}).keptOff=!bringBack;let items=deckSort==='flashbacks'?flashbackDeck(state,resume.flashbacks,Math.random,Date.now(),focused,true):reviewDeck(state);items=items.filter(item=>deckFilter==='all'||item.type===deckFilter);if(deckSort==='oldest')items.sort((a,b)=>new Date(a.date||0)-new Date(b.date||0));if(deckSort==='largest')items.sort((a,b)=>(b.size||0)-(a.size||0));const pinned=state.items.find(item=>item.mediaKey===focused&&!item.needsPreview&&item.state!=='in_trash'&&(!item.decision||bringBack&&keptEligible(item,reviewSwipeCount(state))));if(pinned&&deckSort!=='flashbacks')items=[pinned,...items.filter(item=>item!==pinned)];if(deckSort!=='flashbacks'&&bringBack&&(state.exhausted||items.length)){const present=new Set(items.map(item=>item.mediaKey));items=resurfaceKept(items,keptReady(state).filter(item=>(deckFilter==='all'||item.type===deckFilter)&&!present.has(item.mediaKey)),20,19-reviewSwipeCount(state)%20);}deckCache=items;return items;}

 function current(){if(inspected)return state.items.find(item=>item.mediaKey===inspected);const items=deck();if(!focused||items[0]?.mediaKey===focused)return items[0];return items.find(item=>item.mediaKey===focused)||items[0];}
 let memoryCache=null,memoryVersion=0;
 function memoryFor(item){if(!memoryCache||memoryCache.version!==memoryVersion||memoryCache.length!==state.items.length||!memoryCache.groups.has(item.mediaKey)){const groups=new Map();for(const memory of reviewMemories(state.items.filter(row=>!row.needsPreview&&row.state!=='in_trash')))for(const row of memory)groups.set(row.mediaKey,memory);memoryCache={version:memoryVersion,length:state.items.length,groups};}return memoryCache.groups.get(item.mediaKey)||null;}
 function mediaURL(value,video=false,expanded=false) {
  if(demo)return new URL(value,location.href).href;
  if(typeof expanded==='object')return cardPreviewURL(value,{...expanded,authuser:location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'});
  const box=expanded?null:$('media').getBoundingClientRect?previewSize():null;
  return previewURL(value,{video,expanded,width:expanded?(window.innerWidth||512):(box?.width>1&&box.width||window.innerWidth||512),height:expanded?(window.innerHeight||800):(box?.height>1&&box.height||Math.round((window.innerHeight||800)*.48)),dpr:window.devicePixelRatio,mobile:/iPhone|iPad/.test(window.navigator?.userAgent||''),authuser:location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'});
 }
 const previewOwners=new Map(),loadedPreviews=new Map();
 function rememberPreview(map,key,value){map.delete(key);map.set(key,value);if(map.size>512)map.delete(map.keys().next().value);}
 function previewImage(image=document.createElement('img')){image.addEventListener('load',()=>{const source=image.currentSrc||image.src,owner=previewOwners.get(source);if(owner&&image.naturalWidth>0)rememberPreview(loadedPreviews,owner,source);});return image;}
 function queueThumbnailSource(item){const loaded=loadedPreviews.get(item.thumbUrl);if(loaded)return loaded;const ratio=Number(window.devicePixelRatio),size=Math.ceil(96*Math.min(3,Math.max(1,Number.isFinite(ratio)?ratio:1)));return mediaURL(item.thumbUrl,false,{width:size,height:size});}
 let soundOn=false;const videoPool=[],newVideo=()=>videoPool.pop()||document.createElement('video');
 for(const type of ['touchend','click','keydown'])window.addEventListener?.(type,event=>{if(!event.isTrusted)return;while(videoPool.length<4){const video=document.createElement('video');video.load();videoPool.push(video);}for(const video of [...videoPool,...mediaElement.querySelectorAll('video')]){video.muted=!video.muted;video.muted=!video.muted;}},true);
 const preloader=createReviewPreloader({createImage:()=>previewImage(),createVideo:newVideo,videoURL:async mediaKey=>({url:await videoURL(state.items.find(item=>item.mediaKey===mediaKey))}),previewURL:previewSource,playbackURL:url=>demo?mediaURL(url,true):smallerVideoURL(mediaURL(url,true),previewSize().compact)});
 const sharpImages=new Map(),releaseImage=image=>{image.onload=image.onerror=null;image.src='';};
 function sharpSize(){const {width,height}=previewSize(),ratio=Math.min(3,Math.max(1,Number(window.devicePixelRatio)||1)),scale=Math.min(1,2560/Math.max(width*ratio,height*ratio,1));return {width:Math.round(width*ratio*scale),height:Math.round(height*ratio*scale)};}
 function warmSharp(item,priority='low'){
  if(!item||item.type==='video'||!item.thumbUrl||reviewURLStale(item)||window.navigator?.connection?.saveData)return null;
  let url;try{url=mediaURL(item.thumbUrl,false,sharpSize());if(url===previewSource(item.thumbUrl))return null;}catch{return null;}
  const existing=sharpImages.get(item.mediaKey);
  if(existing?.url===url){sharpImages.delete(item.mediaKey);sharpImages.set(item.mediaKey,existing);return existing;}
  if(existing&&!existing.image.isConnected)releaseImage(existing.image);
  const image=window.Image?new window.Image():document.createElement('img'),entry={url,image};image.decoding='async';image.fetchPriority=priority;image.draggable=false;image.dataset.sharp='1';
  entry.ready=new Promise((resolve,reject)=>{image.onload=()=>Promise.resolve(image.decode?.()).catch(()=>{}).then(resolve);image.onerror=reject;}).then(()=>entry,()=>{if(sharpImages.get(item.mediaKey)===entry)sharpImages.delete(item.mediaKey);return null;});
  image.src=url;sharpImages.set(item.mediaKey,entry);
  while(sharpImages.size>2){const [key,old]=sharpImages.entries().next().value;sharpImages.delete(key);if(!old.image.isConnected)releaseImage(old.image);}
  return entry;
 }
 function sharpReady(item){const entry=sharpImages.get(item?.mediaKey);try{return entry&&entry.url===mediaURL(item.thumbUrl,false,sharpSize())&&entry.image.complete&&entry.image.naturalWidth>0?entry.image:null;}catch{return null;}}
 function upgradeSharp(item,token){
  const entry=warmSharp(item,'high'),following=()=>{const next=deck().find(candidate=>candidate.mediaKey!==item.mediaKey);if(next)warmSharp(next,'low');};
  if(!entry){following();return;}
  entry.ready.then(result=>{
   following();
   if(!result||token!==generation||shown!==item.mediaKey)return;
   const media=$('media').querySelector('img');
   if(!media||media===result.image||media.hidden)return;
   const image=result.image;image.alt=media.alt;image.className=media.className;image.style.cssText=media.style.cssText;image.dataset.sharp='1';image.onload=null;image.onerror=null;media.replaceWith(image);
  });
 }
 function previewSource(value,size=previewSize()){const source=mediaURL(value,false,size);rememberPreview(previewOwners,source,value);return source;}
 const mediaObserved=!!window.ResizeObserver;let mediaBox=null,compactSource=null,compactQuery=null;
 const compactViewport=()=>{if(compactSource!==window.matchMedia){compactSource=window.matchMedia;compactQuery=compactSource?.call(window,'(max-width:760px), (pointer:coarse)');}return !!compactQuery?.matches;};
 function measureMedia(){const media=$('media'),rect=media.offsetWidth?null:media.getBoundingClientRect(),width=media.offsetWidth||rect.width,height=media.offsetHeight||rect.height;return {width:width||1,height:height||1};}
 function previewSize(){const box=mediaBox||measureMedia();if(mediaObserved&&!mediaBox&&box.width>1&&box.height>1)mediaBox=box;return {width:box.width,height:box.height,compact:compactViewport()};}
 if(mediaObserved)new window.ResizeObserver(()=>{mediaBox=null;}).observe(mediaElement);
 function preloadReview(item){const size=previewSize(),items=reviewPreviewWindow(deck(),item,size.compact).filter(candidate=>candidate.mediaKey===item?.mediaKey||!reviewURLStale(candidate));preloader.update($('overlay').hidden||inspected?[]:items,$('overlay').hidden?null:item,size);}
 function clearPreviewWindow(){const size=previewSize(),items=reviewPreviewWindow(inspected?[]:deck(),current(),size.compact);preloader.clear(items,size);buffer.clear(items);}
 const thumbnails=createLocalThumbnails({refresh:refreshItemURL,stale:reviewURLStale,scope:()=>identity?.account,placeholder:(image,item)=>{const label=document.createElement('span');label.textContent=item.name||'Preview unavailable';label.setAttribute('class','thumbnail-placeholder');label.style.cssText='display:flex;align-items:center;justify-content:center;background:var(--ps-fill);color:var(--ps-label2);width:100%;height:100%;overflow:hidden;font-size:11px';if(image.parentElement===queueThumbs){label.style.width='26px';label.style.height='30px';}image.replaceWith(label);}});
 function queueImage(image,item){return thumbnails.bind(image,item,queueThumbnailSource);}
 const urlRefreshes=new Map();
 async function refreshItemURL(item) {
  const account=identity?.account,key=`${account}:${item.mediaKey}`;
  if(urlRefreshes.has(key))return urlRefreshes.get(key);
  const request=(async()=>{
   const response=await rawCall('mediaURL',{mediaKey:item.mediaKey,account});
   if(!response.ok)throw Error(response.error);
   const result=response.data;mediaURL(result.url);
   if(identity?.account!==account)return item;
   const fresh={...item,thumbUrl:result.url,urlFetchedAt:Date.now()};
   const previousItems=state.items;let updated=null;
   state={...state,items:state.items.map(saved=>saved.mediaKey===item.mediaKey?(updated={...saved,thumbUrl:fresh.thumbUrl,urlFetchedAt:fresh.urlFetchedAt}):saved)};
   refreshedItems.set(previousItems,state.items);
   if(persistedItems===previousItems)persistedItems=state.items;
   if(updated&&deckCache&&deckItems===previousItems){deckCache=deckCache.map(row=>row.mediaKey===updated.mediaKey?updated:row);deckItems=state.items;}
   return fresh;
  })();
  urlRefreshes.set(key,request);
  try{return await request;}finally{urlRefreshes.delete(key);}
 }
 function upcomingPreviews(){const item=current(),items=inspected?[]:deck(),index=items.findIndex(row=>row.mediaKey===item?.mediaKey),upcoming=index<0?[]:items.slice(index+1,index+8),seen=new Set();return [...reviewPreviewWindow(items,item,previewSize().compact),...upcoming].filter(row=>row&&!seen.has(row.mediaKey)&&seen.add(row.mediaKey));}
 async function refreshStalePreviews() {
  if($('overlay').hidden||!identity)return;
  const account=identity.account,soon=Date.now()+10*60*1000;
  const stale=upcomingPreviews().filter(row=>reviewURLStale(row,soon)&&!urlRefreshes.has(`${account}:${row.mediaKey}`));
  if(!stale.length)return;
  const results=await Promise.allSettled(stale.map(refreshItemURL));
  if($('overlay').hidden||identity?.account!==account)return;
  if(results.some(result=>result.status==='fulfilled'))refreshPreviews(true);
 }
  const mobile=/iPhone|iPad/.test(window.navigator?.userAgent||'');
 const smallBuffer=mobile||window.navigator?.deviceMemory<=4||window.navigator?.connection?.saveData;
 let dwellKey=null,shownAt=0,lastDwell=0,warmHoldTimer=null;
 let previousKey=null,swipeAt=null,idlePending=false,reopenAfterClose=null,doneSummary=null;
 const metrics={paint:[],hits:0,misses:0};
 const buffer=createPreloadBuffer({size:smallBuffer?2:3,source:item=>previewSource(item.thumbUrl),load:(item,signal,source)=>new Promise((resolve,reject)=>{
  const image=previewImage(window.Image?new window.Image():document.createElement('img'));
  const abort=()=>{image.src='';reject(Error('Aborted'));};
  signal.addEventListener('abort',abort,{once:true});
  image.onload=async()=>{try{if(image.decode)await image.decode();signal.removeEventListener('abort',abort);if(!signal.aborted)resolve(image);}catch(error){reject(error);}};
  image.onerror=()=>reject(Error('Preview unavailable'));
  image.src=source;
 })});
 const videoURLs=new Map(),videoRequests=new Map();
 function videoURL(item){
  const account=identity?.account;const cached=videoURLs.get(item.mediaKey);
  if(cached&&Date.now()-cached.fetchedAt<1800000)return Promise.resolve(cached.url);
  const requestKey=`${account}:${item.mediaKey}`;
  if(videoRequests.has(requestKey))return videoRequests.get(requestKey);
  const request=call('video',{mediaKey:item.mediaKey}).then(result=>{const url=mediaURL(result.url,true);if(identity?.account===account){videoURLs.set(item.mediaKey,{url,fetchedAt:Date.now()});if(videoURLs.size>32)videoURLs.delete(videoURLs.keys().next().value);}return url;}).finally(()=>{videoRequests.delete(requestKey);});
  videoRequests.set(requestKey,request);
  return request;
 }
 let libraryLoading=null,libraryFailure=null,cancelLibraryLoading=null;
 function cancelLibraryFill(reason){cancelLibraryLoading?.(reason);cancelLibraryLoading=null;libraryLoading=null;}
 function pauseLibraryFill(){if(libraryLoading)cancelLibraryFill(Object.assign(Error('Library loading paused.'),{paused:true}));}
 function canFillLibrary(){return !(libraryFailure||sessionClosing||closingPromise||busy||leaseError||leaseRecoveryPending||!pageVisible()||!lockedAccount||!identity||!state.started||state.exhausted||($('sort').value!=='flashbacks'&&reviewDeck(state).length>10)||$('overlay').hidden);}
 function emptyDeck(){
  const flashbacks=$('sort').value==='flashbacks';
  if(libraryFailure)return {kind:'failed',title:'Couldn\u2019t load your library',detail:libraryFailure.message,caption:'Library loading failed.',action:'Retry',run:()=>{refocus=true;return identity?run(()=>loadRequested()):open();}};
  if(reviewDeck(state).length&&(!state.started||state.exhausted||!flashbacks)){const filter=$('filter').value,noun=filter==='video'?'videos':filter==='photo'?'photos':'items';return {kind:'filtered',title:`No ${noun} to review`,detail:filter==='all'?'Try a different order.':'Show all media to keep going.',caption:`No ${noun} to review.`,...(filter==='all'?{}:{action:'Show all media',run:()=>{$('filter').value='all';$('filter').onchange();}})};}
  if(libraryLoading||canFillLibrary()||(flashbacks&&state.started&&!state.exhausted))return {kind:'loading',title:state.items.length?'Loading more\u2026':'Loading your library\u2026',caption:state.items.length?'Loading more\u2026':'Loading your library\u2026'};
  const returning=resume.bringBackKept!==false?nextKeptReturn(state):null;
  if(state.exhausted&&!state.items.length)return {kind:'done',title:'No photos found',detail:'Add photos to Google Photos, then refresh.',caption:'No photos found.',action:'Refresh',run:()=>run(()=>loadRequested(true))};
  if(state.exhausted)return {kind:'done',title:'All caught up',detail:returning?`Kept photos start coming back ${new Date(returning).toLocaleDateString(undefined,{month:'short',day:'numeric'})}.`:'You\u2019ve reviewed everything in your library.',caption:'You\u2019ve reviewed everything',action:'Refresh',run:()=>run(()=>loadRequested(true))};
  if(!state.started)return {kind:'start',title:'Ready when you are',detail:'Load your library to start swiping.',caption:'Load your library to start.',action:'Load library',run:()=>run(()=>loadRequested())};
  return {kind:'empty',title:'Nothing to review yet',detail:'Load more of your library to keep going.',caption:'Nothing to review yet.',action:'Load more',run:()=>run(()=>loadRequested())};
 }
 function renderEmpty(){
  const next=emptyDeck(),existing=$('media').querySelector?.('.empty-deck');if(next.kind==='failed')message('');
  if(existing&&existing.dataset.kind===next.kind&&existing.dataset.detail===(next.detail||''))return;
  const card=document.createElement('div'),title=document.createElement('p');
  card.setAttribute('class','empty-deck');card.dataset.kind=next.kind;card.dataset.detail=next.detail||'';title.setAttribute('class','empty-title');title.textContent=next.title;card.append(title);
  if(next.detail){const detail=document.createElement('p');detail.setAttribute('class','empty-detail');detail.textContent=next.detail;card.append(detail);}
  if(next.action){const action=document.createElement('button');action.setAttribute('class','empty-action');action.textContent=next.action;action.onclick=next.run;action.id=next.kind==='failed'?'retry':'';action.disabled=busy||!identity&&!action.id;card.append(action);}
  $('media').replaceChildren(card);if(next.kind==='failed'&&sheet.hidden&&reviewPanel.hidden)card.querySelector('#retry')?.focus();
 }
 function fillLibrary(){
  if(libraryLoading||!canFillLibrary())return;
  const token=leaseGeneration;
  let cancel;
  const cancelled=new Promise((resolve,reject)=>{cancel=(reason=Error('Library loading session changed.'))=>reject(reason);});
  cancelLibraryLoading=cancel;
  const loading=load(false,cancelled).catch(error=>{if(error?.paused||token!==leaseGeneration||sessionClosing||!pageVisible())return;libraryFailure=error;deckItems=null;message(`Library loading failed: ${error.message}. Retry Load more.`);}).finally(()=>{if(libraryLoading!==loading)return;libraryLoading=null;cancelLibraryLoading=null;render();});
  libraryLoading=loading;
 }
 function refill(){
  if(idlePending||!window.Image||$('overlay').hidden)return;
  idlePending=true;
  const idle=window.requestIdleCallback?.bind(window)||((task)=>window.setTimeout(task,0));
  idle(()=>{
   idlePending=false;if($('overlay').hidden)return;
   const upcoming=[],limit=smallBuffer?2:3;for(const item of deck()){if(upcoming.length>=limit)break;if(item.mediaKey!==shown&&!reviewURLStale(item))upcoming.push(item);}
   buffer.update(smallBuffer&&previousKey?upcoming.slice(0,1):upcoming,previousKey,shown);
  });
 }
 function painted(media,token){
  if(token!==generation||swipeAt===null)return;
  const finish=()=>{if(token!==generation||swipeAt===null)return;window.performance?.mark('painted');metrics.paint.push(window.performance.now()-swipeAt);if(metrics.paint.length>500)metrics.paint.shift();swipeAt=null;
   if(window.localStorage?.psDebug==='1'){const times=[...metrics.paint].sort((a,b)=>a-b);window.console?.table({p50:times[Math.floor(times.length*.5)],p95:times[Math.min(times.length-1,Math.floor(times.length*.95))],bufferHitRate:metrics.hits/(metrics.hits+metrics.misses)});}
  };
  (window.requestAnimationFrame?.bind(window)||((task)=>window.setTimeout(task,0)))(finish);
 }
 function dropWarmVideo(){preloader.cancelVideos();}
 function holdNextVideo(ms){window.clearTimeout(warmHoldTimer);preloader.holdVideos(ms>0);warmHoldTimer=ms>0?window.setTimeout(()=>preloader.holdVideos(false),ms):null;}
 function stopMedia(clearUnderCard=true){setVideoLoading(false);captureVideo();swipeFeedback.reset();if(clearUnderCard){underCard.replaceChildren();underCard.hidden=true;}generation++;const image=$('media').querySelector('img');const old=state.items.find(item=>item.mediaKey===shown);if(image&&old&&image.complete&&image.naturalWidth)buffer.retain(old,image);const video=$('media').querySelector('video');if(video){video.cancelUpgrade?.();video.pause();video.removeAttribute('src');video.load();}$('media').replaceChildren();shown=null;}
 function showLockCard(){
  stopMedia();
  const card=document.createElement('div'),title=document.createElement('p');
  card.setAttribute('class','tab-lock-card');card.style.padding='24px';title.textContent='Open in another tab';useHere.hidden=false;card.append(title,useHere);$('media').replaceChildren(card);
 }
 async function display(item,retried=false,forceRefresh=false) {
  const preview=underCard.querySelector('img'),preloaded=preview?.dataset?.key===item?.mediaKey?preview:null;
  stopMedia(shown!==(item?.mediaKey||null));if(item&&item.mediaKey!==dwellKey){lastDwell=dwellKey?Date.now()-shownAt:0;dwellKey=item.mediaKey;shownAt=Date.now();}holdNextVideo(item?.type==='video'&&lastDwell>=2000?4000:0);$('zoom').value='1';$('card').classList.remove('zoomed');mediaElement.style.touchAction='';shown=item?.mediaKey||null;const token=generation;
  $('media').style.color='var(--ps-label)';$('media').setAttribute('aria-busy','false');
  if(otherTab||leaseError?.message.includes('busy in another tab')){showLockCard();return;}
  if(!item){renderEmpty();return;}
  let handlingError=false;
  const failed=async()=>{
   if(token!==generation||handlingError)return;
   handlingError=true;setVideoLoading(false,token);
   const video=$('media').querySelector('video');if(video){video.cancelUpgrade?.();video.pause();video.removeAttribute('src');video.load();}
   $('media').setAttribute('aria-busy','false');$('media').replaceChildren();
   if(!retried){$('media').textContent='Refreshing preview\u2026';try{const fresh=await refreshItemURL(item);if(token===generation){clearPreviewWindow();videoURLs.delete(item.mediaKey);dropWarmVideo();display(fresh,true);preloadReview(fresh);}return;}catch{}}
   if(token!==generation)return;
   const card=document.createElement('div'),label=document.createElement('p'),detail=document.createElement('p'),retry=document.createElement('button');card.setAttribute('class','empty-deck');label.setAttribute('class','empty-title');detail.setAttribute('class','empty-detail');retry.setAttribute('class','empty-action');
   label.textContent=item.type==='video'?'Couldn\u2019t load this video':'Couldn\u2019t load this photo';detail.textContent='Check your connection, then try again.';retry.textContent='Retry';retry.onclick=()=>display(current(),false,true);card.append(label,detail,retry);
   $('media').replaceChildren(card);
  };
  try {
   if(forceRefresh){
    $('media').textContent='Refreshing preview\u2026';
    try{item=await refreshItemURL(item);if(forceRefresh)retried=true;}catch{if(forceRefresh){retried=true;await failed();return;}}
    if(token!==generation)return;
    $('media').replaceChildren();
   }
   const source=previewSource(item.thumbUrl);const buffered=!retried&&!forceRefresh?buffer.take(item.mediaKey,source):null;const cached=!retried&&!forceRefresh?(reusablePreview(buffered,source)||reusablePreview(preloaded,source)||preloader.take(item.mediaKey,source)||(item.type==='video'?null:pendingPreview(preloaded,source))):null;const warmed=item.type==='video'&&!retried&&!forceRefresh?preloader.takeVideo(item.mediaKey):null;const sharp=item.type==='video'||retried||forceRefresh?null:sharpReady(item),media=item.type==='video'?(warmed||newVideo()):(sharp||cached||previewImage());if(cached||warmed)metrics.hits++;else metrics.misses++;
   media.onerror=failed;
   if(item.type==='video'){setVideoLoading(true,token);trackVideoLoading(media,token);const savedTime=resume.video?.key===item.mediaKey?resume.video.time:0;media.dataset.resumeReady='pending';media.addEventListener('loadedmetadata',()=>{if(token!==generation)return;restoreVideoTime(media,savedTime);});media.addEventListener('timeupdate',()=>{if(Date.now()-videoSavedAt>=1000){videoSavedAt=Date.now();captureVideo();}});media.addEventListener('pause',captureVideo);if(media.readyState>=1)restoreVideoTime(media,savedTime);
    media.controls=false;media.muted=!soundOn;loopOnEnd(media,()=>token===generation&&!handlingError);media.playsInline=true;media.preload='metadata';media.poster=previewSource(item.thumbUrl);
    const poster=cached||previewImage();poster.alt=item.name;poster.setAttribute('class','video-poster');poster.style.width='';poster.style.maxWidth='100%';poster.style.maxHeight='100%';
    poster.onload=()=>painted(poster,token);if(!cached)poster.src=media.poster;
    media.hidden=true;$('media').replaceChildren(poster,media);addVideoControls(media);$('media').setAttribute('aria-busy','true');
    if(poster.complete&&poster.naturalWidth)painted(poster,token);
    const started=window.performance?.now();
    const clearLoading=()=>{if(token===generation&&!handlingError)$('media').setAttribute('aria-busy','false');};
    const initialTime=media.currentTime;
    const reveal=()=>{
     if(token!==generation||handlingError||!media.hidden)return;
     $('media').setAttribute('aria-busy','false');media.hidden=false;$('media').replaceChildren(media);addVideoControls(media);painted(media,token);
     if(window.localStorage?.psDebug==='1')window.console?.table({videoFirstFrameMs:window.performance.now()-started});
    };
    media.onloadeddata=media.oncanplay=media.onplaying=reveal;
    media.addEventListener('timeupdate',()=>{if(media.currentTime>initialTime)reveal();});
    if(media.readyState>=2)reveal();
    if(warmed)playVideo(media).catch(()=>{});
    if(retried||forceRefresh)videoURLs.delete(item.mediaKey);const url=await videoURL(item);if(token!==generation||handlingError)return;
    const sharpVideo=previewSize().compact&&Math.min(window.screen?.width||0,window.screen?.height||0)*(Number(window.devicePixelRatio)||1)>=1000&&!window.navigator?.connection?.saveData;const upgrade=(video,compact,next)=>startProgressiveVideo({video,url,compact,createVideo:newVideo,isActive:()=>token===generation&&!handlingError,held:()=>swipeFeedback.dragging,onError:failed,onFallback:()=>{clearLoading();holdNextVideo(0);},onSwap:full=>{if(token!==generation||handlingError)return;clearLoading();holdNextVideo(0);trackVideoLoading(full,token);setVideoLoading(full.paused&&full.readyState<3,token);full.addEventListener('timeupdate',()=>{if(Date.now()-videoSavedAt>=1000){videoSavedAt=Date.now();captureVideo();}});full.addEventListener('pause',captureVideo);const mediaNode=$('media');for(const child of Array.from(mediaNode.childNodes||[]))if(child!==full)child.remove();if(full.parentNode!==mediaNode)mediaNode.append?.(full);loopOnEnd(full,()=>token===generation&&!handlingError);addVideoControls(full);if(next)upgrade(full,false,false);}});if(demo){if(media.src!==url)media.src=url;playVideo(media).catch(()=>{});}else upgrade(media,previewSize().compact,sharpVideo);
    if(media.readyState>=2)reveal();
   }
   else {media.style.maxWidth='100%';media.style.maxHeight='100%';media.style.width='';media.style.touchAction='';media.alt=item.name;media.draggable=false;media.hidden=true;media.onload=()=>{if(token===generation){media.hidden=false;$('media').setAttribute('aria-busy','false');painted(media,token);upgradeSharp(item,token);}};$('media').append(media);const reused=!!(sharp||cached);$('media').setAttribute('aria-busy',String(!(reused&&media.complete)));if(!reused)media.src=source;if(reused&&media.complete){if(media.naturalWidth>0){media.hidden=false;$('media').setAttribute('aria-busy','false');painted(media,token);upgradeSharp(item,token);}else await failed();}}
  }catch{await failed();}
 }
 function setVideoLoading(value,token){if(token!==undefined&&token!==generation)return;if(value)$('card').classList?.add?.('video-loading');else $('card').classList?.remove?.('video-loading');}
 function trackVideoLoading(video,token){const done=()=>setVideoLoading(false,token);let last=video.currentTime||0;video.addEventListener('playing',done);video.addEventListener('pause',done);video.addEventListener('error',done);video.addEventListener('canplay',()=>{if(video.paused)done();});video.addEventListener('waiting',()=>{if(!video.paused)setVideoLoading(true,token);});video.addEventListener('timeupdate',()=>{if(video.currentTime>last)done();last=video.currentTime;});}
 function updateVideoControls(){
  const video=mediaElement.querySelector('video');
  if(video)video.controls=false;
  for(const button of mediaElement.childNodes)if(button.dataset?.videoControl)button.hidden=false;
 }
 function addVideoControls(video){
  for(const action of ['play','mute']){
   const button=document.createElement('button');button.dataset.videoControl=action;
   button.textContent=action==='play'?(video.paused?'Play':'Pause'):(video.muted?'Unmute':'Mute');
   button.style.cssText=`position:absolute;bottom:12px;${action==='play'?'left':'right'}:12px;z-index:2`;
   button.addEventListener('pointerdown',event=>event.stopPropagation());
   button.onclick=()=>{if(action==='play'){if(video.paused)video.play().catch(()=>{});else video.pause();button.textContent=video.paused?'Play':'Pause';}else{video.muted=!video.muted;soundOn=!video.muted;button.textContent=video.muted?'Unmute':'Mute';}};
   if(action==='play')for(const type of ['play','pause'])video.addEventListener(type,()=>{button.textContent=video.paused?'Play':'Pause';});
   if(action==='mute')video.addEventListener('volumechange',()=>{button.textContent=video.muted?'Unmute':'Mute';});
   mediaElement.append(button);
  }
  for(const control of createVideoTimeline({document,video,onSeek:captureVideo}))mediaElement.append(control);
  updateVideoControls();
 }
 queue_detailsElement.addEventListener('toggle',()=>render());
 let renderedStats='';
 function renderSettingsStats(){
  const stats=reviewStatistics(state,{extra:demo?.history||[]}),signature=JSON.stringify(stats);
  if(signature===renderedStats&&statsBody.childNodes.length)return;
  renderedStats=signature;renderReviewStats({document,container:statsBody,stats,width:(statsBody.getBoundingClientRect?.().width||300)-28});
 }
 let historyMemo=null;
 function historyView(){
  const decisionLabel=value=>value==='remove'?'Trash':value==='keep'?'Keep':'Unreviewed';
  const historyLabel=entry=>`${state.items.find(item=>item.mediaKey===entry.key)?.name||entry.key} \u00b7 ${decisionLabel(entry.previous)} \u2192 ${decisionLabel(entry.decision)}`;
  if(historyMemo?.history===state.history&&historyMemo.items===state.items&&historyMemo.job===state.job)return historyMemo.view;
  const history=state.history||[];let nextUndo;for(let index=history.length-1;index>=0;index--)if(canUndoReview(state,history[index])){nextUndo=history[index];break;}
  const view={get entries(){return [...history].reverse();},nextUndo,historyLabel,decisionLabel};historyMemo={history:state.history,items:state.items,job:state.job,view};return view;
 }
 function renderCard(){
  const item=current();
  $('caption').textContent=item?`${inspected?'Candidate inspection \u00b7 ':item.decision==='keep'?'Kept before \u00b7 ':''}${item.name} \u00b7 ${captureDate(item)||'Unknown date'} \u00b7 ${itemSize(item)}${item.takesUpSpace===false?' \u00b7 stored free':''}`:emptyDeck().caption;
  shareElement.hidden=openElement.hidden=!item;enlargeElement.hidden=!item&&!$('card').classList.contains('expanded');if(item&&demo)openElement.href='#';else if(item)openElement.href=`https://photos.google.com/u/${location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'}/photo/${encodeURIComponent(item.mediaKey)}`;
  $('caption').hidden=!item;coach.hidden=!item||!!demo?.embed||!!inspected||reviewSwipeCount(state)>0||$('card').classList.contains('expanded');$('caption').title=item?$('caption').textContent:'';
  if(!$('overlay').hidden&&(shown!==(item?.mediaKey||null)||!$('media').childNodes.length))display(item);
  else if(!item&&!$('overlay').hidden&&!otherTab&&!leaseError?.message.includes('busy in another tab'))renderEmpty();
 }
 let queueThumbKey='';
 function renderStats(){
  const queue=[],candidates=[],trashed=[];let decided=0;
  for(const item of state.items){if(item.decision)decided++;if(item.decision!=='remove')continue;if(item.state==='in_trash'){trashed.push(item);continue;}if(item.needsPreview)continue;candidates.push(item);if(!item.queueSent)queue.push(item);}if(!sheet.hidden)renderSettingsStats();
  storageCapsule.update(storageSession.total(state.items));queueSize.textContent='\u00b7 '+formatStorageBytes(reviewStorage(candidates).bytes);trashBadge.textContent=String(candidates.length);trashBadge.hidden=!candidates.length;reviewButton.setAttribute('aria-label',candidates.length?`Going to Trash, ${candidates.length} ${candidates.length===1?'item':'items'}`:'Going to Trash');queuePill.hidden=candidates.length<25;queuePillText.replaceChildren(document.createTextNode(`${candidates.length} going to Trash `),queueSize);queueGrowth.hidden=candidates.length<=25;queueGrowth.textContent=`+${candidates.length-25}`;const thumbKey=candidates.slice(-3).map(item=>`${item.mediaKey} ${item.thumbUrl}`).join('\n'),thumbsChanged=thumbKey!==queueThumbKey||queueThumbs.childNodes.length!==Math.min(3,candidates.length);if(thumbsChanged){queueThumbKey=thumbKey;queueThumbs.replaceChildren();}
  if(thumbsChanged)for(const item of candidates.slice(-3)){const image=document.createElement('img');image.alt='';queueImage(image,item);queueThumbs.append(image);}
  $('stats').textContent=`${deck().length} to review \u00b7 ${decided}/${state.items.length} reviewed \u00b7 Going to Trash: ${queue.length} (estimated savings: ${estimate(queue)}) \u00b7 In Trash: ${estimate(trashed)} (running total)`;
  const {nextUndo,historyLabel,decisionLabel}=historyView();
  undoPreview.textContent=nextUndo?`Next Undo: ${historyLabel(nextUndo)}; restores ${decisionLabel(nextUndo.previous)}.`:'No previous decisions can be undone.';
  $('undo').title=undoPreview.textContent;$('undo').setAttribute('aria-describedby','undo-preview');
$('remove').setAttribute('aria-label',inspected?'Back to review':'Mark for Trash');$('keep').setAttribute('aria-label',inspected?'Keep instead':'Keep');
  $('send').textContent='Finish previous transfer';$('send').parentElement.hidden=!state.job;
  $('album').hidden=!state.albumKey||!!state.job;if(state.albumKey)$('album').href=`https://photos.google.com/u/${location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'}/album/${encodeURIComponent(state.albumKey)}`;
 }
 function reviewRows(){if(reviewRowsMemo?.items===state.items&&reviewRowsMemo.saved===reviewItems)return reviewRowsMemo.rows.slice();const items=new Map(state.items.map(item=>[item.mediaKey,item])),rows=reviewItems.filter(saved=>items.has(saved.mediaKey)).map(saved=>({...saved,...items.get(saved.mediaKey)})).filter(item=>item.state!=='in_trash'&&!item.needsPreview);reviewRowsMemo={items:state.items,saved:reviewItems,rows};return rows.slice();}
 function decideWithHistory(current,item,decision){
  return recordReviewDecision(current,item,decision);
 }
 function selectTrashItem(key,selected){
  if(busy||!identity||leaseError)return;
  const item=state.items.find(item=>item.mediaKey===key);if(!item||item.state==='in_trash')return;
  const decision=selected?'remove':'keep';if(item.decision===decision)return;
  try{apply(decideWithHistory(state,item,decision));}catch(error){message(error.message);}
 }
 selectAll.onclick=()=>{if(busy||!identity||leaseError)return;try{let next=state;for(const item of reviewRows())if(item.decision!=='remove')next=decideWithHistory(next,item,'remove');apply(next);}catch(error){message(error.message);}};
 let trashProgress=null;
 function renderTrashReview(){
  doneView.hidden=!doneSummary||reviewPanel.hidden;
  if(doneSummary&&!reviewPanel.hidden){doneFreed.textContent=`${doneSummary.freed} freed`;doneCounts.textContent=`${doneSummary.deleted} moved to Trash${doneSummary.kept?` \u00b7 ${doneSummary.kept} kept`:''}`;const upcoming=reviewDeck(state).length;doneNext.textContent=upcoming?`Up next: ${upcoming} to review`:state.exhausted?'You\u2019ve reviewed everything in your library.':'Up next: more from your library';doneTrash.hidden=!!demo;doneDemo.hidden=!demo;doneTrash.href=`https://photos.google.com/u/${location.pathname.match(/^\/u\/(\d+)/)?.[1]||'0'}/trash`;}
  if(reviewPanel.hidden){doneSummary=null;doneView.hidden=true;if(resumeReviewPlayback&&!overlayElement.hidden){mediaElement.querySelector('video')?.play().catch(()=>{});resumeReviewPlayback=false;}previewGeneration++;if(previewVideo){previewVideo.pause();previewVideo.removeAttribute('src');previewVideo.load();previewVideo=null;}reviewSignature='';return;}
  const rows=reviewRows(),selected=rows.filter(item=>item.decision==='remove');
  sizeValue.textContent=estimate(selected);const storedFree=selected.filter(item=>item.takesUpSpace===false).length;reviewSubtitle.textContent=rows.length?`${selected.length} of ${rows.length} selected${storedFree?` \u00b7 ${storedFree} stored free, so ${storedFree===1?'it doesn\u2019t':'they don\u2019t'} use storage`:''}`:'Nothing marked for Trash';reviewHelp.textContent=rows.length?'Tap a photo to preview. Untick to keep it. Items stay in Google Photos Trash for 60 days.':'Swipe left or tap \u2715 to mark photos. They wait here until you move them to Trash.';selectAll.hidden=!rows.length;selectAll.disabled=busy||selected.length===rows.length;moveTrash.textContent=trashProgress||`Move ${selected.length} to Trash`;moveTrash.removeAttribute('aria-label');if(!trashProgress&&!reviewPanel.hidden&&moveTrash.scrollWidth>moveTrash.clientWidth+1){moveTrash.setAttribute('aria-label',moveTrash.textContent);moveTrash.textContent=`Trash ${selected.length}`;}moveTrash.disabled=busy||!identity||!selected.length;
  const signature=JSON.stringify([previewKey,rows.map(item=>[item.mediaKey,item.decision,item.thumbUrl,item.name,item.state])]);if(signature===reviewSignature)return;reviewSignature=signature;
  const structure=JSON.stringify(rows.map(item=>[item.mediaKey,item.thumbUrl,item.name,item.state,item.type,item.duration,!!item.legacy]));
  reviewLatest=new Map(rows.map(item=>[item.mediaKey,item]));
  if(structure===reviewStructure){for(const item of rows){const tile=reviewTiles.get(item.mediaKey);if(tile&&tile.decision!==item.decision)paintTrashTile(tile,item);}}
  else{reviewStructure=structure;reviewTiles.clear();reviewOrder=rows.map(item=>item.mediaKey);reviewGrid.replaceChildren();reviewMore?.disconnect();reviewMore=null;moreTrashTiles(96);}
  const closingPreview=reviewPanel.querySelector('.trash-preview')?.dataset.key;reviewPanel.querySelector('.trash-preview')?.remove();previewGeneration++;if(previewVideo){previewVideo.pause();previewVideo.removeAttribute('src');previewVideo.load();previewVideo=null;}
  const item=rows.find(item=>item.mediaKey===previewKey);if(!item){previewKey=null;if(closingPreview)(trashTileFor(closingPreview)?.tile.querySelector('.trash-photo')||(moveTrash.disabled?reviewBack:moveTrash)).focus();return;}
  const preview=document.createElement('section');preview.setAttribute('class','trash-preview');preview.setAttribute('id','trash-preview');preview.dataset.key=item.mediaKey;preview.setAttribute('role','dialog');preview.setAttribute('aria-label',`Preview ${item.name}`);const nav=document.createElement('div');nav.setAttribute('class','trash-nav');const back=document.createElement('button'),position=document.createElement('span');navBack(back,'Back');position.setAttribute('class','trash-position');position.textContent=`${rows.indexOf(item)+1} of ${rows.length}`;back.onclick=()=>{previewKey=null;renderTrashReview();};nav.append(back,position);
  const media=document.createElement('div');media.setAttribute('class','trash-preview-media');const image=document.createElement(item.type==='video'?'video':'img');if(item.type==='video'){image.controls=true;image.playsInline=true;previewVideo=image;const token=previewGeneration;const poster=document.createElement('img');poster.alt=item.name;media.append(poster);thumbnails.bind(poster,item,fresh=>previewSource(fresh.thumbUrl),{retryLookup:true});const loaded=poster.onload;poster.onload=()=>{loaded();if(token===previewGeneration){image.poster=poster.src;poster.hidden=true;}};videoURL(item).then(url=>{if(token===previewGeneration)image.src=url;}).catch(error=>message(error.message));}else{image.alt=item.name;thumbnails.bind(image,item,fresh=>previewSource(fresh.thumbUrl));}media.append(image);
  const caption=document.createElement('div'),details=document.createElement('small');caption.setAttribute('class','trash-preview-caption');caption.textContent=item.name;details.textContent=[captureDate(item)||'Unknown date',item.type==='video'?videoDuration(item):null,itemSize(item),item.legacy?'Previously marked':null].filter(Boolean).join(' \u00b7 ');caption.append(details);
  const strip=document.createElement('div');strip.setAttribute('class','trash-strip');const stripAt=Math.max(0,Math.min(rows.indexOf(item)-30,rows.length-61));for(const row of rows.slice(stripAt,stripAt+61)){const button=document.createElement('button'),thumb=document.createElement('img');button.setAttribute('class',row.mediaKey===previewKey?'active':'');button.setAttribute('aria-label',`Preview ${row.name}`);thumb.alt='';thumb.loading='lazy';thumb.decoding='async';thumbnails.bind(thumb,row,trashStripSource);button.append(thumb);button.onclick=()=>{previewKey=row.mediaKey;renderTrashReview();};strip.append(button);}
  const bar=document.createElement('div');bar.setAttribute('class','trash-bar');const keep=document.createElement('button'),trash=document.createElement('button');keep.textContent='Keep';trash.textContent='Trash';trash.setAttribute('class','preview-trash');keep.setAttribute('aria-pressed',String(item.decision==='keep'));trash.setAttribute('aria-pressed',String(item.decision==='remove'));keep.onclick=()=>selectTrashItem(item.mediaKey,false);trash.onclick=()=>selectTrashItem(item.mediaKey,true);bar.append(keep,trash);preview.append(nav,media,caption,strip,bar);reviewPanel.append(preview);back.focus();
 }
 function buildTrashTile(item){
   const tile=document.createElement('div');
   const photo=document.createElement('button'),image=document.createElement('img');photo.setAttribute('class','trash-photo');photo.dataset.key=item.mediaKey;photo.setAttribute('aria-label',`Preview ${item.name}`);image.alt=item.name;image.loading='lazy';image.decoding='async';thumbnails.bind(image,item,trashTileSource);photo.append(image);photo.onclick=()=>{if(busy)return;previewKey=item.mediaKey;renderTrashReview();};
   const check=document.createElement('button');check.setAttribute('class','trash-check');icon(check,`Keep ${item.name}`,['M5 12l4 4L19 6']);check.dataset.key=item.mediaKey;tile.append(photo,check);
   const entry={tile,check,name:item.name,decision:undefined};paintTrashTile(entry,item);reviewTiles.set(item.mediaKey,entry);
   check.onclick=()=>{selectTrashItem(item.mediaKey,entry.decision!=='remove');[...reviewGrid.querySelectorAll('.trash-check')].find(button=>button.dataset.key===item.mediaKey)?.focus();};
   if(item.type==='video'){const duration=document.createElement('span');duration.setAttribute('class','trash-duration');duration.textContent=`\u25b6 ${videoDuration(item)}`;tile.append(duration);}
   if(item.legacy){const legacy=document.createElement('span');legacy.setAttribute('class','trash-legacy');legacy.textContent='Previously marked';tile.append(legacy);}
   reviewGrid.append(tile);
 }
 function trashStripSource(fresh){const size=Math.ceil(Math.min(3,Math.max(1,Number(window.devicePixelRatio)||1))*96);return mediaURL(fresh.thumbUrl,false,{width:size,height:size});}
 function trashTileSource(fresh){const size=Math.ceil(Math.min(2,Math.max(1,Number(window.devicePixelRatio)||1))*300);return mediaURL(fresh.thumbUrl,false,{width:size,height:size});}
 function moreTrashTiles(count){
  const built=reviewTiles.size,until=Math.min(reviewOrder.length,built+count);
  for(let index=built;index<until;index++){const item=reviewLatest.get(reviewOrder[index]);if(item)buildTrashTile(item);}
  reviewMore?.disconnect();reviewMore=null;
  if(reviewTiles.size>=reviewOrder.length)return;
  if(!window.IntersectionObserver){moreTrashTiles(reviewOrder.length);return;}
  reviewMore=new window.IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))moreTrashTiles(192);},{root:reviewScroll,rootMargin:'0px 0px 1600px 0px'});
  reviewMore.observe(reviewGrid.lastElementChild);
 }
 function trashTileFor(key){const index=reviewOrder.indexOf(key);if(index>=reviewTiles.size)moreTrashTiles(index+1-reviewTiles.size);return reviewTiles.get(key);}
 function paintTrashTile(entry,item){entry.decision=item.decision;entry.tile.setAttribute('class',`trash-tile${item.decision==='remove'?'':' kept'}`);entry.check.setAttribute('aria-label',`${item.decision==='remove'?'Keep':'Trash'} ${entry.name}`);entry.check.setAttribute('aria-pressed',String(item.decision==='remove'));}
 function videoDuration(item){const seconds=Math.max(0,Math.floor((Number(item.duration)||0)/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
 function renderLists(){
  renderTrashReview();
 }

 let memoryFit='';
 function fitMemoryPlace(){const full=memoryPlace.dataset.full||'';if(memoryPlace.hidden||!full)return;memoryPlace.textContent=full;const words=full.split(' ');while(words.length>1&&memoryPlace.scrollWidth>memoryPlace.clientWidth+1){words.pop();memoryPlace.textContent=words.join(' ').replace(/[,\s]+$/,'')+'\u2026';}}
 if(window.ResizeObserver)new window.ResizeObserver(()=>fitMemoryPlace()).observe(topCard);
 function render(){
  updateOrder();const hadFocus=$('media').contains(root.activeElement)||refocus&&!root.activeElement;renderCard();if(hadFocus&&!$('media').contains(root.activeElement)){if(current()){$('card').tabIndex=-1;$('card').focus({preventScroll:true});}else $('media').querySelector('button:not(:disabled)')?.focus();}refocus=hadFocus&&!current();const item=current();if(!$('overlay').hidden)updateAmbient(item);memoryLabel.hidden=!item||$('sort').value!=='flashbacks';
  const memory=item?memoryFor(item):null;
  const place=typeof item?.locationName==='string'?item.locationName.trim():'';
  memoryDate.textContent=captureDate(item,{month:'long',year:'numeric'})||'Unknown date';const placeLabel=place.split(',')[0].trim()||place;if(memoryPlace.dataset.full!==placeLabel){memoryPlace.textContent=placeLabel;memoryPlace.dataset.full=placeLabel;}memoryPlace.hidden=!place;memoryPlace.title=place;memoryPlaceSep.textContent=place?' \u00b7 ':'';memoryPlaceSep.hidden=!place;const position=memory?.length>1?`${memory.findIndex(row=>row.mediaKey===item.mediaKey)+1} of ${memory.length}`:'';memoryPosition.textContent=position;memoryPosition.hidden=memoryPositionSep.hidden=!position;memoryPositionSep.textContent=position?' \u00b7 ':'';
  const fitKey=`${memoryLabel.hidden}|${memoryDate.textContent}|${placeLabel}|${position.length}`;if(fitKey!==memoryFit){memoryFit=fitKey;fitMemoryPlace();}
  const next=inspected?null:deck().find(candidate=>candidate.mediaKey!==item?.mediaKey);
  if(next&&underCard.querySelector('img')?.dataset?.key!==next.mediaKey){try{const preview=previewImage();preview.dataset.key=next.mediaKey;preview.alt='';preview.draggable=false;preview.decoding='async';preview.src=previewSource(next.thumbUrl);Promise.resolve(preview.decode?.()).catch(()=>{});underCard.replaceChildren(preview);}catch{underCard.replaceChildren();}}
  if(!next)underCard.replaceChildren();underCard.hidden=!next;
  preloadReview(item);refreshStalePreviews();
  renderStats();controls();renderLists();refill();fillLibrary();
  if(identity&&!$('overlay').hidden)persistResume();
 }
 let cardAnimation=null;
 function finishCardAnimation(){if(cardAnimation)cardAnimation.finish();}
 function clearCardAnimation(){if(cardAnimation){cardAnimation.cancel();cardAnimation=null;}$('card').style.visibility='';}
 async function animateCard(decision){
  clearCardAnimation();
  if(!$('card').animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const side=decision==='keep'?1:-1,center={transform:'translateX(0) rotate(0deg)',opacity:1},edge={transform:`translateX(${side*120}vw) rotate(${side*18}deg)`,opacity:0};
  $('undo').querySelector('svg')?.animate?.([{transform:'rotate(-45deg)'},{transform:'rotate(0)'}],{duration:350,easing:'cubic-bezier(.34,1.56,.64,1)'});
  const animation=$('card').animate([edge,center],{duration:350,easing:'cubic-bezier(.34,1.56,.64,1)',fill:'forwards'});cardAnimation=animation;
  let timer;
  try{await Promise.race([animation.finished,new Promise(resolve=>{timer=window.setTimeout(()=>{animation.finish();resolve();},350);})]);}catch{}finally{window.clearTimeout(timer);}
 }
 async function openSession(claim=false) {
  const requestedGeneration=leaseGeneration;
  if(closingPromise){await closingPromise;if(requestedGeneration!==leaseGeneration)return;}
  await suspendingPromise;
  if(busy||!pageVisible())return;
  const token=++leaseGeneration;
  cancelLibraryFill();stopSync();stopRenewal();libraryFailure=null;otherTab=false;useHere.hidden=true;
  await resumeWrite;preloader.clear();busy=true;controls();$('overlay').hidden=false;lockPage();$('launcher').hidden=true;buffer.clear();await syncRunning;
  try{
   await googleSignInResumed;
   const result=await rawCall('identity');
   if(token!==leaseGeneration)return;
   if(!result.ok)throw Error(result.error);
   const changed=identity?.account!==result.data.account;
   if(changed){
    await releaseLease();
    await writes.flush();writes=createWrites();writeConflict=null;leaseError=null;
    inspected=null;focused=null;clearMedia();videoURLs.clear();previousKey=null;
   }
   identity=result.data;$('account').textContent=identity.label;db=await database();
   let settings={},settingsError;try{settings=await (await pairingPromise).settings();}catch(error){settingsError=error;}
   const linkedElsewhere=!!(settings.url&&settings.token&&settings.photosAccount&&settings.photosAccount!==identity.account);
   if(settings.url&&settings.token&&!settings.photosAccount){try{await (await pairingPromise).saveSettings({...settings,photosAccount:identity.account});settings={...settings,photosAccount:identity.account};}catch{}}
   syncEnabled=!!(settings.url&&settings.token)&&!linkedElsewhere;syncClient.configure(linkedElsewhere?{}:settings);
   settingsPanel.open=true;onboarding.hidden=syncEnabled||!!settings.onboardingDismissed||!!demo;
   showSyncAccount(settings);if(settingsError)pairingNotice.textContent=`Sync storage unavailable: ${settingsError.message}`;else if(linkedElsewhere){pairingNotice.textContent='Sync is linked to another Google Photos account. Progress in this account is saved on this device only.';syncStatus.textContent='Sync off for this account \u00b7 saved locally';}
   if(!await renewLease(true,claim))return;
   const sessionGeneration=leaseGeneration;
   if(!changed){
    await writes.flush();
    if(writes.pending){if(!writeConflict)message('Local changes are still pending. Close and reopen to retry saving.');return;}
   }
   if(!refocus)$('close').focus();message('Reading local progress\u2026');
   state=await db.read(identity.account);writeRevision=state.revision;persistedItems=state.items;
   resume=await db.resume(identity.account);$('filter').value=resume.filter||'all';$('sort').value=resume.sort||'flashbacks';reviewEvery.value=String(resume.reviewEvery||25);bringBackInput.checked=resume.bringBackKept!==false;deleteMethod.value='trash';trashOptIn.checked=true;focused=resume.currentId||null;inspected=resume.inspected&&state.items.some(item=>item.mediaKey===focused)?focused:null;const missing=focused&&!state.items.some(item=>item.mediaKey===focused&&item.state==='active');if(missing){focused=null;inspected=null;}
   activeAt=Date.now();
   if(syncEnabled)await synchronize();
   if(!pageVisible()||sessionGeneration!==leaseGeneration)return;
   leaseRecoveryPending=false;takeoverPending=false;
   message(missing?'Saved item is unavailable. Continuing with the next unreviewed item.':idleMessage());
   if(demo){demo.notify?.('ready');if(!state.started&&!demoSeeding)demoSeeding=new Promise(resolve=>window.setTimeout(resolve,0)).then(()=>run(()=>loadRequested())).then(()=>{if(state.started)message('');});}
  }catch(error){
   await releaseLease();identity=null;state=emptyReview();stopMedia();buffer.clear();libraryFailure=error;
  }finally{busy=false;render();controls();}
 }
 function open(claim=false){
  takeoverPending=takeoverPending||claim;
  if(openingPromise)return openingPromise;
  if(closingPromise)return reopenAfterClose||=closingPromise.then(()=>{reopenAfterClose=null;return open();});
  openingPromise=openSession(takeoverPending).then(()=>{refreshStalePreviews();}).finally(()=>{openingPromise=null;if(resumeOpening){resumeOpening=false;if(pageVisible()&&!$('overlay').hidden&&!closingPromise)open();}});
  return openingPromise;
 }
 async function closeSession(){
  takeoverPending=false;sessionClosing=true;cancelLibraryFill();stopRenewal();stopSync();
  captureVideo();persistResume();if(!sheet.hidden)suppressViewerShortcuts();sheet.hidden=true;resumeReviewPlayback=false;
  preloader.clear();finishCardAnimation();clearCardAnimation();await openingPromise;await activeOperation;await libraryLoading;await writes.flush();
  leaseGeneration++;stopRenewal();
  $('overlay').hidden=true;unlockPage();reviewPanel.hidden=true;previewKey=null;renderTrashReview();$('launcher').hidden=false;$('launcher').focus();
  clearMedia();
  await openingPromise;await activeOperation;
  $('overlay').hidden=true;unlockPage();reviewPanel.hidden=true;previewKey=null;renderTrashReview();$('launcher').hidden=false;clearMedia();
  try{
   if(!otherTab&&(!identity||await renewLease())){
    await writes.flush();
    await synchronize(false);
   }
  }finally{
   await releaseLease();
  }
  buffer.clear();
 }
 function openLatest(){
  const opening=open();
  if(environment.autoUpdating)updateAfterOpen(opening).catch(()=>{});
  return opening;
 }
 async function updateAfterOpen(opening){
  const check=availableUpdate({fetch:environment.syncFetch,version:environment.version,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window)});
  await opening?.catch?.(()=>{});
  const swipes=reviewSwipeCount(state),latest=await check;
  if(!latest)return;
  const available=()=>message(`Photos Swipe ${latest} is available. Reload Google Photos to update.`);
  if(reviewSwipeCount(state)!==swipes||$('overlay').hidden){available();return;}
  if(!await downloadRelease({GM:environment.GM,version:latest,setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window)})||reviewSwipeCount(state)!==swipes||$('overlay').hidden||!claimUpdateReload(window.sessionStorage,latest)){available();return;}
  message(`Updating to Photos Swipe ${latest}\u2026`);
  await close();
  window.location.reload();
 }
 try{if(!releaseNewer(window.sessionStorage.getItem(updateTargetKey),environment.version))window.sessionStorage.removeItem(updateTargetKey);}catch{}
 if(consumeOpenAfterUpdate(window.sessionStorage))window.setTimeout(()=>openLatest(),0);
 function close(){
  if(demo)return Promise.resolve();
  if(closingPromise)return closingPromise;
  closingPromise=closeSession().finally(()=>{sessionClosing=false;closingPromise=null;});
  return closingPromise;
 }
 function decide(decision){
  if(busy||otherTab||!identity||leaseError||$('overlay').hidden||!reviewPanel.hidden||!sheet.hidden||(typeof shareSheet==='object'&&!shareSheet.hidden))return;
  if(inspected&&decision==='remove'){inspected=null;render();return;}
  const item=current();if(!item)return;
  try{
  swipeFeedback.dismiss(decision);window.performance?.mark('swipe');swipeAt=window.performance?.now()??null;const previous=item.decision,next=decideWithHistory(state,item,decision);if($('sort').value==='flashbacks'){const memory=resume.flashbacks||={};memory.seen=[...(memory.seen||[]),item.mediaKey];}inspected=null;focused=null;previousKey=item.mediaKey;if(decision==='remove'&&previous!=='remove')storageCapsule.update(storageSession.total(next.items),{animate:true,delta:reviewStorage([item]).bytes,free:item.takesUpSpace===false});apply(next,item.mediaKey);message([decision==='remove'?`Marked ${item.name} for Trash.`:`Kept ${item.name}.`,readyMessage()].filter(Boolean).join(' '));demo?.notify?.('decision');
  }catch(error){message(error.message);}
 }
 async function undo(){if(busy||otherTab||!identity||leaseError||$('overlay').hidden||!reviewPanel.hidden||!sheet.hidden||(typeof shareSheet==='object'&&!shareSheet.hidden))return;try{const history=structuredClone(state.history||[]);while(history.length&&!canUndoReview(state,history.at(-1)))history.pop();const last=history.pop();if(!last){message('No previous decisions can be undone.');return;}if(resume.flashbacks){resume.flashbacks.seen=(resume.flashbacks.seen||[]).filter(key=>key!==last.key);}const next=decideReview(state,last.key,last.previous,last.decision,last.revision);if(last.cooldown)next.items=next.items.map(item=>item.mediaKey===last.key?{...item,...last.cooldown}:item);const previous=[...history].reverse().find(entry=>entry.key===last.key);const restored=next.items.find(item=>item.mediaKey===last.key);if(previous&&previous.revision===last.revision-1){const revisionOffset=restored.revision-previous.revision;for(const entry of history)if(entry.key===last.key)entry.revision+=revisionOffset;}inspected=null;focused=restored.decision===null?last.key:null;apply({...next,history});await animateCard(last.decision);clearCardAnimation();message([`Last swipe undone for ${restored.name}.`,readyMessage()].filter(Boolean).join(' '));}catch(error){message(error.message);}}
 async function loadRequested(refresh=false){
  let cancel;
  const cancelled=new Promise((resolve,reject)=>{cancel=()=>reject(Error('Library loading session changed.'));});
  cancelLibraryLoading=cancel;
  try{await load(refresh,cancelled,$('sort').value==='flashbacks'?1:Infinity);}finally{if(cancelLibraryLoading===cancel)cancelLibraryLoading=null;}
 }
 let libraryPass=null;
 async function load(refresh=false,cancelled=null,maxPages=Infinity) {
  const token=leaseGeneration;
  const assertLoadSession=()=>{if(token!==leaseGeneration||(cancelled&&sessionClosing))throw Error('Library loading session changed.');};
  const loadCall=async(operation,args)=>{assertLoadSession();const request=call(operation,args);const result=await (cancelled?Promise.race([request,cancelled]):request);assertLoadSession();return result;};
  libraryFailure=null;deckItems=null;
  const savePage=async(next,page,cursor,refresh)=>{assertLoadSession();await syncRunning;assertLoadSession();await assertSaveAccount();assertLoadSession();if($('sort').value==='flashbacks'&&!inspected)focused=shown||focused;state=markSyncChanges(state,mergeReviewPage(state,page,cursor,refresh));buffer.clear(state.items);render();await writes.enqueue();if(writes.pending)throw leaseError||Error('Local changes have not been saved.');return state;};
  let result;const pass=libraryPass=refresh||!state.cursor||!libraryPass?{added:0,scanned:0}:libraryPass;
  try{result=await loadReviewPages({read:async()=>state,save:savePage,call:loadCall,refresh,maxPages,target:$('sort').value==='flashbacks'?Infinity:50,progress:scanned=>message(`Loading library \u00b7 ${pass.scanned+scanned} rows checked\u2026`)});}catch(error){if(!error?.paused&&token===leaseGeneration&&!sessionClosing&&pageVisible()){if($('sort').value==='flashbacks'&&!inspected)focused=shown||focused;libraryFailure=error;deckItems=null;}throw error;}
  assertLoadSession();pass.added+=result.added;pass.scanned+=result.scanned;
  message(`${pass.added} new items to review \u00b7 ${pass.scanned} library rows checked${result.exhausted?refresh?' \u00b7 Up to date':' \u00b7 End of library':''}${result.warning?'. '+result.warning:''}`);
 }

 mediaElement.addEventListener('wheel',event=>{if(!$('card').classList.contains('expanded'))return;if(Number($('zoom').value)>1&&!event.ctrlKey&&(event.shiftKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)))return;event.preventDefault();$('zoom').value=String(Math.max(1,Math.min(3,Number($('zoom').value)+(event.deltaY<0?.25:-.25))));$('zoom').oninput();},{passive:false});
 const fullscreenElement=()=>root.fullscreenElement||document.fullscreenElement||document.webkitFullscreenElement||null;
 const fullscreenSupported=()=>!!((document.fullscreenEnabled||document.webkitFullscreenEnabled)&&($('card').requestFullscreen||$('card').webkitRequestFullscreen));
 let fullscreenOwned=false;
 function syncFullscreen(){mediaBox=null;if(fullscreenOwned&&!fullscreenElement()){fullscreenOwned=false;if($('card').classList.contains('expanded'))toggleEnlarge();}else refreshPreviews();}
 document.addEventListener('fullscreenchange',syncFullscreen);document.addEventListener('webkitfullscreenchange',syncFullscreen);
 function toggleEnlarge(){swipeFeedback.reset();mediaBox=null;const before=$('card').getBoundingClientRect?.();const expanded=$('card').classList.toggle('expanded');if(!expanded&&Number($('zoom').value)>1){$('zoom').value='1';$('zoom').oninput();}if(expanded&&fullscreenSupported()&&!fullscreenElement()){const card=$('card'),request=card.requestFullscreen?card.requestFullscreen({navigationUI:'hide'}):card.webkitRequestFullscreen();fullscreenOwned=true;Promise.resolve(request).catch(()=>{fullscreenOwned=false;});}else if(expanded&&!fullscreenSupported()){const video=$('media').querySelector('video');if(video&&!video.hidden&&typeof video.webkitEnterFullscreen==='function'&&/iPhone|iPod/.test(window.navigator?.userAgent||'')){try{video.webkitEnterFullscreen();}catch{}}}else if(!expanded&&fullscreenOwned&&fullscreenElement()){fullscreenOwned=false;(document.exitFullscreen||document.webkitExitFullscreen)?.call(document)?.catch?.(()=>{});}updateVideoControls();if($('enlarge').setAttribute)$('enlarge').setAttribute('aria-label',expanded?'Exit fullscreen':'Fullscreen photo');if($('card').animate&&!fullscreenOwned&&!fullscreenElement()&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)$('card').animate([{transform:before?`translate(${before.left-$('card').getBoundingClientRect().left}px,${before.top-$('card').getBoundingClientRect().top}px) scale(${before.width/$('card').getBoundingClientRect().width},${before.height/$('card').getBoundingClientRect().height})`:'scale(.92)',transformOrigin:'top left'},{transform:'none',transformOrigin:'top left'}],{duration:350,easing:'cubic-bezier(.34,1.56,.64,1)'});refreshPreviews();}
 function refreshPreviews(pendingOnly){const loaded=image=>pendingOnly===true&&image.complete&&image.naturalWidth>0;const next=underCard.querySelector('img'),candidate=state.items.find(item=>item.mediaKey===next?.dataset?.key);if(candidate&&!loaded(next)){const url=previewSource(candidate.thumbUrl);if(next.src!==url)next.src=url;}if($('overlay').hidden)return;const item=current(),media=$('media').querySelector('img')||$('media').querySelector('video');if(item&&item.mediaKey===shown&&media?.tagName===(item.type==='video'?'VIDEO':'IMG')){const url=previewSource(item.thumbUrl);if(item.type==='video'){if(media.poster!==url)media.poster=url;}else{if(media.src!==url&&!loaded(media)&&!media.dataset?.sharp)media.src=url;upgradeSharp(item,generation);}}preloadReview(item);refill();}
 window.addEventListener('resize',()=>{mediaBox=null;refreshPreviews();});
 $('sync-local').onclick=()=>run(async()=>{const settings=await (await pairingPromise).settings();await (await pairingPromise).saveSettings({...settings,onboardingDismissed:true});onboarding.hidden=true;closeSettings();message(idleMessage());});

 const shareScrim=document.createElement('div'),shareSheet=document.createElement('section'),shareHead=document.createElement('div'),shareThumb=document.createElement('img'),shareTitle=document.createElement('p'),shareSub=document.createElement('p'),shareClose=document.createElement('button'),shareSend=document.createElement('button'),shareLink=document.createElement('button'),shareLinkRow=document.createElement('div'),shareLinkField=document.createElement('input'),shareCopy=document.createElement('button'),shareLinkShare=document.createElement('button'),shareNote=document.createElement('p');
 shareScrim.setAttribute('class','share-scrim');shareSheet.setAttribute('class','share-sheet');shareSheet.setAttribute('role','dialog');shareSheet.setAttribute('aria-modal','true');shareSheet.setAttribute('aria-label','Share');shareScrim.hidden=shareSheet.hidden=true;
 shareHead.setAttribute('class','share-head');shareThumb.setAttribute('class','share-thumb');shareThumb.alt='';const shareText=document.createElement('div');shareTitle.setAttribute('class','share-title');shareSub.setAttribute('class','share-sub');shareText.append(shareTitle,shareSub);icon(shareClose,'Close share',['M6 6l12 12M18 6L6 18']);shareClose.setAttribute('class','share-close');shareHead.append(shareThumb,shareText,shareClose);
 const shareAction=(button,id,paths)=>{button.setAttribute('id',id);button.setAttribute('class','share-action');const glyph=document.createElement('span');glyph.setAttribute('class','share-glyph');icon(glyph,'',paths);glyph.removeAttribute('aria-label');const label=document.createElement('span'),detail=document.createElement('small');label.setAttribute('class','share-label');detail.setAttribute('class','share-detail');const words=document.createElement('span');words.setAttribute('class','share-words');words.append(label,detail);button.append(glyph,words);return {label,detail};};
 const shareGlyph=['M12 3v12','M8 7l4-4 4 4','M6 11v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8'],copyGlyph=['M10 8h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z','M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2'],copiedGlyph=['M5 12.5l4.5 4.5L19 7.5'];
 const sendParts=shareAction(shareSend,'share-send',shareGlyph),linkParts=shareAction(shareLink,'share-link',['M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1','M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1']);
 shareLinkRow.setAttribute('class','share-link-row');shareLinkRow.hidden=true;shareLinkField.readOnly=true;shareLinkField.setAttribute('aria-label','Public link');icon(shareCopy,'Copy link',copyGlyph);shareCopy.title='Copy link';shareCopy.setAttribute('class','share-copy');icon(shareLinkShare,'Share link',shareGlyph);shareLinkShare.title='Share link';shareLinkShare.setAttribute('class','share-link-share');shareLinkRow.append(shareLinkField,shareCopy,shareLinkShare);
 shareNote.setAttribute('class','share-note');shareNote.textContent='Manage or delete public links in Google Photos under Sharing.';
 shareSheet.append(shareHead,shareSend,shareLink,shareLinkRow,shareNote);divElement4.append(shareScrim,shareSheet);
 const shareStyle=document.createElement('style');shareStyle.textContent='.share-scrim{position:absolute;inset:0;z-index:9;background:rgba(0,0,0,.45);animation:ps-share-fade .2s ease}.share-sheet{position:absolute;left:12px;right:12px;bottom:calc(12px + var(--ps-safe-bottom));z-index:10;max-width:440px;margin:0 auto;padding:16px;border-radius:24px;background:var(--ps-surface-solid);color:var(--ps-label);box-shadow:0 20px 60px rgba(0,0,0,.45);display:flex;flex-direction:column;gap:8px;animation:ps-share-up .28s cubic-bezier(.2,.8,.2,1)}.share-head{display:flex;align-items:center;gap:12px;padding-bottom:8px}.share-thumb{width:52px;height:52px;flex:none;border-radius:12px;object-fit:cover;background:var(--ps-fill)}.share-head>div{flex:1;min-width:0}.share-title{margin:0;font:600 16px/20px var(--ps-font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.share-sub{margin:2px 0 0;font:400 13px/16px var(--ps-font);color:var(--ps-label2)}.share-close{width:36px;height:36px;min-height:36px;padding:9px;border-radius:50%;flex:none;position:relative}.share-close::before{content:"";position:absolute;inset:-4px}.share-action{display:flex;align-items:center;gap:12px;width:100%;min-height:56px;padding:10px 14px;border-radius:16px;background:var(--ps-fill);text-align:left}.share-action:disabled{cursor:progress}.share-glyph{display:flex;width:36px;height:36px;flex:none;align-items:center;justify-content:center;border-radius:50%;background:var(--ps-accent);color:#fff}.share-glyph svg{width:18px;height:18px}.share-words{display:flex;flex-direction:column;min-width:0}.share-label{font:600 15px/20px var(--ps-font)}.share-detail{font:400 12px/16px var(--ps-font);color:var(--ps-label2)}.share-link-row{display:flex;gap:6px;align-items:center}.share-link-row input{flex:1;min-width:0;height:44px;font:500 14px var(--ps-font)}.share-link-row button{width:44px;height:44px;min-width:44px;flex:none;padding:11px;border-radius:12px;color:var(--ps-accent)}.share-note{margin:4px 2px 0;font:400 12px/16px var(--ps-font);color:var(--ps-label2)}.content>.share-scrim,.content>.share-sheet{grid-column:1 / -1;grid-row:1 / -1}@keyframes ps-share-up{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}@keyframes ps-share-fade{from{opacity:0}}@media (prefers-reduced-motion:reduce){.share-sheet,.share-scrim{animation:none}}';root.append(shareStyle);
 const glassStyle=document.createElement('style');glassStyle.textContent=`.launcher{border-radius:var(--ps-r-pill);padding:12px 20px;font-weight:600;background:var(--ps-accent);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),var(--ps-glass-shadow)}
.overlay{background:var(--ps-chrome)}
.ambient{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--ps-chrome)}
.ambient canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .6s ease}
.ambient canvas.on{opacity:1}
.ambient::after{content:"";position:absolute;inset:0;background:linear-gradient(var(--ps-ambient-fade),transparent 22%,transparent 70%,var(--ps-ambient-fade)),var(--ps-ambient-dim)}
.content{z-index:1;background:var(--ps-glass-fill);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),var(--ps-glass-shadow-lg);border-radius:var(--ps-r-card)}
.content > header button{width:40px;height:40px;min-height:40px;padding:9px;color:var(--ps-label);background:var(--ps-glass-solid);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),0 0 0 .5px var(--ps-glass-edge),var(--ps-glass-shadow)}
.content > header button svg{filter:drop-shadow(var(--ps-text-shadow))}
.content>header:first-child{height:60px;padding:0 16px}
.content .storage-counter{padding:7px 18px 8px;border-radius:var(--ps-r-pill);background:var(--ps-glass-solid);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),0 0 0 .5px var(--ps-glass-edge),var(--ps-glass-shadow);max-width:calc(100% - 152px)} .content>header:first-child:has(#close:not([hidden])) .storage-counter{max-width:calc(100% - 208px)}
.sv-label{font:600 10px/12px var(--ps-font);letter-spacing:.14em}
.sv-value{text-shadow:var(--ps-text-shadow)}
.trash-badge{top:-5px;right:-5px;min-width:20px;height:20px;border-radius:10px;font:700 11px/20px var(--ps-font);box-shadow:0 2px 6px var(--ps-shadow-color)}
.content .card,.content>#card,.content:has(> #caption:not([hidden]))>#card:not(.expanded){margin:6px 16px 0;border-radius:var(--ps-r-photo);background:var(--ps-glass-fill);box-shadow:var(--ps-glass-shadow-lg)}
.content:has(> #caption:not([hidden]))>#card:not(.expanded) #media,.content .media,.content .card.expanded .media{border-radius:var(--ps-r-photo)}
.content #card::after{content:"";position:absolute;inset:0;z-index:4;border-radius:inherit;box-shadow:inset 0 0 0 1px var(--ps-glass-stroke);pointer-events:none}
.top-card,.media,.content .top-card,.content #card.expanded,.content .card.expanded{background:transparent}
.media[aria-busy=true]{background:transparent}
.media[aria-busy=true]::after{color:var(--ps-label);background:var(--ps-glass-solid);border-radius:var(--ps-r-pill);padding:8px 16px;box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),var(--ps-glass-shadow)}
#card>.under-card{opacity:0}
#card>.under-card.peek{opacity:1}
.memory-label{top:14px;left:14px;max-width:calc(100% - 84px);padding:7px 14px;background:var(--ps-photo-chip);color:var(--ps-photo-label);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),var(--ps-glass-shadow);text-shadow:var(--ps-photo-shadow);font:500 15px/20px var(--ps-font);backdrop-filter:none;-webkit-backdrop-filter:none}
.card-tool,#enlarge{width:40px;height:40px;min-height:40px;padding:10px;right:14px;background:var(--ps-photo-chip);color:var(--ps-photo-label);border:0;box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),var(--ps-glass-shadow);backdrop-filter:none;-webkit-backdrop-filter:none}
#enlarge{top:14px}#open-photos{top:62px}#share{top:110px}
.card-tool svg,#enlarge svg{filter:drop-shadow(var(--ps-photo-shadow))}
.media>[data-video-control=play],.media>[data-video-control=mute]{border-radius:var(--ps-r-pill);background:var(--ps-photo-chip);color:var(--ps-photo-label);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke);text-shadow:var(--ps-photo-shadow)}
.media>[data-video-control=time]{color:var(--ps-photo-label);text-shadow:var(--ps-photo-shadow);font:500 13px/16px var(--ps-font);font-variant-numeric:tabular-nums}
.empty-deck .empty-title,.empty-deck .empty-detail,.tab-lock-card{text-shadow:var(--ps-text-shadow)}
.empty-deck .empty-action,.trash-done-continue{border-radius:var(--ps-r-pill);background:var(--ps-glass-tint-blue);color:var(--ps-on-action);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),var(--ps-glass-shadow)}
.content #caption,.content>#caption{order:1;align-self:center;max-width:calc(100% - 32px);margin:10px 16px 0;padding:6px 14px;border:0;border-radius:16px;background:var(--ps-glass-solid);color:var(--ps-label);text-align:center;font:500 13px/18px var(--ps-font);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),0 0 0 .5px var(--ps-glass-edge),var(--ps-glass-shadow)}
.content>.order-row{order:2;margin:8px 0 0}
.order-row>button{min-height:44px;padding:10px 18px;color:var(--ps-label);background:var(--ps-glass-solid);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),0 0 0 .5px var(--ps-glass-edge),var(--ps-glass-shadow);font:500 15px/20px var(--ps-font)}
#order-menu{top:auto;bottom:calc(100% + 8px);border:0;border-radius:22px;background:var(--ps-glass-solid);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),var(--ps-glass-shadow-lg)}
#order-menu button{background:none;border-bottom:1px solid var(--ps-sep)}
#order-menu button:last-child{border-bottom:0}
.content .status{order:2;color:var(--ps-label2);text-shadow:var(--ps-text-shadow);text-align:center}
.queue-pill{background:var(--ps-glass-solid);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),0 0 0 .5px var(--ps-glass-edge),var(--ps-glass-shadow);backdrop-filter:none;-webkit-backdrop-filter:none}
.content .actions{order:4;align-self:center;gap:20px;margin:10px auto calc(var(--ps-safe-bottom) + 12px);padding:11px;border-radius:var(--ps-r-pill);background:var(--ps-glass-solid);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),0 0 0 .5px var(--ps-glass-edge),var(--ps-glass-shadow-lg)}
.actions #remove,.actions #keep{box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),var(--ps-glass-shadow)}
.actions #remove{background:var(--ps-glass-fill-strong);color:var(--ps-destructive)}
.actions #keep{background:var(--ps-glass-tint-blue);color:var(--ps-on-action)}
.actions #undo{width:52px;height:52px;min-height:52px;padding:14px;background:var(--ps-glass-fill-strong);color:var(--ps-label);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}
.actions #remove svg{stroke-width:2.6}
.shortcuts{display:none}
.shortcuts h2{margin:0 0 10px;font:600 11px/14px var(--ps-font);letter-spacing:.12em;text-transform:uppercase;color:var(--ps-label2)}
.shortcuts ul{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.shortcuts li{display:flex;align-items:center;gap:12px;color:var(--ps-label2);font:400 15px/20px var(--ps-font)}
.shortcuts kbd{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:26px;padding:0 6px;border-radius:8px;background:var(--ps-keycap);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke);color:var(--ps-label);font:500 14px/20px var(--ps-font)}
#pair-onboarding{border-radius:var(--ps-r-card);background:var(--ps-glass-solid);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),var(--ps-glass-shadow)}
#pair-onboarding button{border-radius:var(--ps-r-pill);background:var(--ps-glass-fill-strong)}
#pair-onboarding #google-sign-in{background:var(--ps-glass-tint-blue)}
.settings-sheet,.review-panel,.trash-preview,.trash-done{background:var(--ps-bg)}
.settings-sheet .settings-header{background:var(--ps-glass-solid)}
.settings-sheet .group{border-radius:22px;background:var(--ps-glass-fill);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}
.settings-sheet .group h2{margin:2px 4px 10px;font:600 13px/18px var(--ps-font);letter-spacing:.06em;text-transform:uppercase;color:var(--ps-label2)}
.settings-sheet .group button,.content .settings-header button{border-radius:var(--ps-r-pill);background:var(--ps-glass-fill-strong);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}
.content .settings-header button{color:var(--ps-accent);font-weight:600}
.settings-sheet select{border:0;border-radius:12px;background-color:var(--ps-glass-fill-strong);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}
.trash-nav button{position:relative;min-height:36px;height:36px;padding:0 14px;border-radius:var(--ps-r-pill);font:600 15px/20px var(--ps-font)}
.trash-nav button::before{content:"";position:absolute;inset:-4px}
.trash-nav>button:first-child{color:var(--ps-label);background:var(--ps-glass-fill-strong);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}
.trash-nav>button:last-child{color:var(--ps-accent)}
.trash-nav{height:56px;padding:0 16px}
.content .trash-heading{padding:4px 20px 0;font:700 30px/36px var(--ps-font);text-shadow:var(--ps-text-shadow)}
.trash-size{margin:12px 16px 0;padding:18px 20px 4px;border-radius:24px 24px 0 0;background:var(--ps-glass-fill);box-shadow:inset 1px 0 0 var(--ps-glass-stroke),inset -1px 0 0 var(--ps-glass-stroke),inset 0 1px 0 var(--ps-glass-stroke);color:var(--ps-accent);font:800 44px/50px var(--ps-font);letter-spacing:-.01em}
.trash-size small{font:600 11px/14px var(--ps-font);letter-spacing:.12em;margin-bottom:4px}
.trash-subtitle{margin:0 16px 16px;padding:2px 20px 18px;border-radius:0 0 24px 24px;background:var(--ps-glass-fill);box-shadow:inset 1px 0 0 var(--ps-glass-stroke),inset -1px 0 0 var(--ps-glass-stroke),inset 0 -1px 0 var(--ps-glass-stroke);font-size:13px}
.trash-grid{gap:8px;padding:0 16px}
.trash-tile{overflow:hidden;border-radius:20px;box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}
.trash-photo{background:var(--ps-glass-fill)}
.trash-check{right:8px;bottom:8px;border:0;background:var(--ps-glass-tint-blue);color:var(--ps-on-action);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),0 2px 8px var(--ps-shadow-color)}
.trash-tile.kept .trash-check{background:var(--ps-photo-chip)}
.trash-legacy{border-radius:var(--ps-r-pill);padding:3px 8px;background:var(--ps-photo-chip);color:var(--ps-photo-label);text-shadow:var(--ps-photo-shadow)}
.trash-duration{color:var(--ps-photo-label);text-shadow:var(--ps-photo-shadow)}
.trash-help{text-shadow:var(--ps-text-shadow)}
.trash-bar{margin:0 12px calc(var(--ps-safe-bottom) + 12px);padding:10px;gap:10px;border:0;border-radius:var(--ps-r-pill);background:var(--ps-glass-solid);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),var(--ps-glass-shadow-lg)}
.trash-bar button{height:50px;border-radius:var(--ps-r-pill);color:var(--ps-label);background:var(--ps-glass-fill-strong);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke);font:600 17px/22px var(--ps-font)}
.trash-bar #move-trash,.trash-bar .preview-trash{background:var(--ps-glass-tint-red);color:var(--ps-on-action)}
.trash-preview-media{background:transparent}
.trash-strip button{border-radius:8px;overflow:hidden}
.share-sheet{border-radius:var(--ps-r-card);background:var(--ps-glass-solid);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),var(--ps-glass-shadow-lg)}
.share-action{border-radius:18px;background:var(--ps-glass-fill);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}
.share-glyph{background:var(--ps-glass-tint-blue)}
.share-close{background:var(--ps-glass-fill-strong)}
.share-scrim{background:var(--ps-glass-scrim)}
@supports ((backdrop-filter:blur(20px)) or (-webkit-backdrop-filter:blur(20px))){
.launcher{background:var(--ps-glass-tint-blue);backdrop-filter:var(--ps-blur-regular);-webkit-backdrop-filter:var(--ps-blur-regular)}
.content > header button,.content .storage-counter,.order-row>button,.content #caption,.content>#caption,.queue-pill,.content .actions,#pair-onboarding{background:var(--ps-glass-fill);backdrop-filter:var(--ps-blur-regular);-webkit-backdrop-filter:var(--ps-blur-regular)}
#order-menu,.share-sheet{background:var(--ps-glass-scrim);backdrop-filter:var(--ps-blur-thick);-webkit-backdrop-filter:var(--ps-blur-thick)}
.settings-sheet,.review-panel,.trash-preview,.trash-done{background:var(--ps-glass-scrim);backdrop-filter:var(--ps-blur-thick);-webkit-backdrop-filter:var(--ps-blur-thick)}
.settings-sheet .settings-header{background:var(--ps-glass-fill);backdrop-filter:var(--ps-blur-regular);-webkit-backdrop-filter:var(--ps-blur-regular)}
.trash-bar{background:var(--ps-glass-fill)}
@media (pointer:coarse){
.content > header button,.content .storage-counter,.order-row>button,.content #caption,.content>#caption,.queue-pill,.content .actions{backdrop-filter:var(--ps-tint-regular);-webkit-backdrop-filter:var(--ps-tint-regular)}}
}
#card:fullscreen::after,#card:-webkit-full-screen::after{display:none}
@media (max-height:700px) and (orientation:portrait){.content>header:first-child{height:52px}.content #caption,.content>#caption{margin-top:8px}.content>.order-row{margin-top:6px}.content .actions{gap:16px;margin:6px auto calc(var(--ps-safe-bottom) + 8px);padding:8px}.actions #remove,.actions #keep{width:64px;height:64px;min-height:64px;padding:18px}.actions #undo{width:48px;height:48px;min-height:48px;padding:12px}}
@media (max-width:360px){.content>header:first-child{padding:0 12px}.content .storage-counter{padding:6px 12px 7px}}
@media (max-width:600px){.content{background:transparent;box-shadow:none;border-radius:0}.settings-sheet,.review-panel{border-radius:0}}
@media (orientation:landscape) and (max-height:520px){.content,.content:has(> #card.expanded){background:transparent;box-shadow:none}.content>#card,.content:has(> #caption:not([hidden]))>#card:not(.expanded){margin:10px 0}.content>#caption,.content #caption{align-self:start;justify-self:stretch;max-width:none;margin:0;text-align:left;border-radius:16px}.content>.order-row{margin:2px 0 6px}.content .actions{justify-self:center;margin:0 0 6px;padding:8px;gap:16px}.content .actions #undo{width:44px;height:44px;min-height:44px;padding:11px}#order-menu{top:calc(100% + 8px);bottom:auto}.content>header:first-child{padding:0}}
@media (min-width:900px) and (min-height:700px){.overlay{padding:24px}
.content,.content:has(> #card.expanded){background:transparent;box-shadow:none;border-radius:0;padding:0;column-gap:24px;grid-template-columns:minmax(0,1fr) 344px;grid-template-rows:auto auto auto auto auto minmax(0,1fr) auto auto}
.content>#card,.content:has(> #caption:not([hidden]))>#card:not(.expanded){margin:0;border-radius:var(--ps-r-card)}
.content:has(> #caption:not([hidden]))>#card:not(.expanded) #media,.content>#card #media{border-radius:var(--ps-r-card)}
.content>header:first-child{height:52px;padding:0}
.content > header button{width:48px;height:48px;min-height:48px;padding:12px}
.content>header:first-child .storage-counter{position:relative;left:auto;top:auto;transform:none;flex:1 1 auto;min-width:0;max-width:none;padding:5px 18px 6px}
.content>.order-row{grid-row:2;justify-self:start;margin:16px 0 0}
.content>#pair-onboarding{grid-row:3;margin:16px 4px 0}
.content>#caption,.content #caption{grid-row:4;align-self:start;justify-self:stretch;max-width:none;margin:16px 0 0;padding:16px 20px;border-radius:24px;text-align:left;font:500 15px/21px var(--ps-font)}
.shortcuts{grid-row:5;grid-column:2;margin:16px 0 0;padding:18px 20px;border-radius:24px;background:var(--ps-glass-fill);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke),var(--ps-glass-shadow)}
.content>.queue-pill{grid-row:6;align-self:end;margin:0 0 8px}
.content>.status{grid-row:7;margin:0}
.content .actions{grid-row:8;justify-self:stretch;justify-content:space-between;margin:8px 0 0;padding:12px 22px}
.memory-label{top:20px;left:20px}
.card-tool,#enlarge{width:48px;height:48px;min-height:48px;padding:13px;right:20px}
.card-tool svg{width:20px;height:20px}
#enlarge{top:20px}#open-photos{top:80px}#share{top:140px}
#order-menu{top:calc(100% + 8px);bottom:auto;left:0;transform:none}
.review-panel,.settings-sheet{border-radius:var(--ps-r-card)}
.review-panel>.trash-bar{align-self:center;width:min(560px,calc(100% - 24px));margin-left:0;margin-right:0}}
@media (min-width:900px) and (min-height:700px) and (pointer:fine){.shortcuts{display:block}}
.content:has(> #card.expanded)>.shortcuts{display:none}
.content:has(> .review-panel:not([hidden]))>:not(.review-panel),.content:has(> .settings-sheet:not([hidden]))>:not(.settings-sheet){visibility:hidden}
.trash-done-demo{display:flex;flex-direction:column;align-items:center;gap:8px}.trash-done-demo p{margin:0;color:var(--ps-label2)}.trash-done-demo button{min-height:44px;padding:0 18px;border-radius:var(--ps-r-pill);background:var(--ps-glass-fill-strong);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}.trash-done-demo[hidden]{display:none}
@media (max-height:500px) and (orientation:landscape){.trash-nav{height:44px}.trash-size{margin-top:4px;padding:8px 16px 0;font:800 24px/30px var(--ps-font)}.trash-subtitle{padding:0 16px 8px;margin-bottom:8px}.content .trash-heading{padding-top:0;font:700 20px/26px var(--ps-font)}.trash-grid{grid-template-columns:repeat(auto-fill,minmax(100px,1fr))}.trash-bar{padding:6px;margin-bottom:calc(var(--ps-safe-bottom) + 8px)}.trash-bar button{height:44px}}
@media (prefers-reduced-transparency:reduce){.launcher,.content > header button,.content .storage-counter,.order-row>button,.content #caption,.content>#caption,.queue-pill,.content .actions,#pair-onboarding,#order-menu,.share-sheet,.settings-sheet,.review-panel,.trash-preview,.trash-done,.settings-sheet .settings-header,.trash-bar,.shortcuts{background:var(--ps-glass-solid);backdrop-filter:none;-webkit-backdrop-filter:none}.launcher{background:var(--ps-accent)}.ambient::after{background:var(--ps-glass-scrim)}.memory-label,.card-tool,#enlarge{background:var(--ps-glass-solid);color:var(--ps-label);text-shadow:none}}
@media (prefers-reduced-motion:reduce){.ambient canvas{transition:none}}
.settings-sheet .group{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px;border-radius:34px}
.settings-sheet .group>:not(button){flex:1 0 100%;margin-left:0;margin-right:0}
.settings-sheet .group>h2{margin:2px 4px}
.settings-sheet .group>p,.settings-sheet .group>details,.settings-sheet .group>label{padding-left:4px;padding-right:4px;box-sizing:border-box}
.settings-sheet .group>label{justify-content:flex-start}
@media (min-width:601px) and (min-height:521px){
.content{border-radius:36px}
.content>header:first-child{height:56px}
.settings-sheet,.review-panel{border-radius:36px}
.settings-sheet .settings-header{height:auto;min-height:0;padding:14px 14px 14px 22px;border-top-left-radius:inherit;border-top-right-radius:inherit}
.settings-sheet .settings-header button{height:44px;min-height:44px;padding:0 18px;border-radius:22px}
.trash-nav{height:auto;padding:14px}
.trash-nav button{height:44px;min-height:44px;border-radius:22px}
.review-panel>.trash-bar{align-self:center;width:min(560px,calc(100% - 96px));margin-left:0;margin-right:0}}
@media (min-width:900px) and (min-height:700px){
.content{border-radius:0}
.content>header:first-child{height:52px}
.content>#card,.content:has(> #caption:not([hidden]))>#card:not(.expanded),.content:has(> #caption:not([hidden]))>#card:not(.expanded) #media,.content>#card #media{border-radius:36px}
.memory-label{top:19px;left:19px}
.card-tool,#enlarge{right:12px}
#enlarge{top:12px}#open-photos{top:72px}#share{top:132px}
.content .actions{padding:12px}
.shortcuts{padding:16px}}

.trash-bar button:not(#move-trash):not(.preview-trash){flex:0 0 auto;padding-left:22px;padding-right:22px}
.trash-bar #move-trash,.trash-bar .preview-trash{flex:1 1 auto;padding-left:16px;padding-right:16px}
@media (max-width:359px){.trash-bar button{font-size:15px}}
`;root.append(glassStyle);const statsStyle=document.createElement('style');statsStyle.textContent=statsPanelCSS;root.append(statsStyle);const polishStyle=document.createElement('style');polishStyle.textContent=`:host{--ps-sheet-base:#F2F2F7;--ps-ease:cubic-bezier(.2,.8,.2,1)}
@media(prefers-color-scheme:dark){:host{--ps-sheet-base:#000}}
:host([data-scheme=light]){--ps-sheet-base:#F2F2F7}
:host([data-scheme=dark]){--ps-sheet-base:#000}
:host([data-input=pointer]) :focus-visible{outline:none}
.launcher{background:var(--ps-accent)}
.settings-sheet .settings-header{background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;margin-bottom:-14px;padding-bottom:34px;transition:background-color .2s var(--ps-ease)}
@media (min-width:601px) and (min-height:521px){.settings-sheet .settings-header{padding-bottom:28px}}
.settings-sheet .settings-header.scrolled{background:var(--ps-glass-solid);-webkit-mask-image:linear-gradient(#000 calc(100% - 14px),transparent);mask-image:linear-gradient(#000 calc(100% - 14px),transparent)}
@supports (background:color-mix(in srgb,red 50%,blue)){.settings-sheet .settings-header.scrolled{background:color-mix(in srgb,var(--ps-sheet-base) 50%,var(--ps-tint,var(--ps-chrome)))}}
@media (prefers-reduced-transparency:reduce){.settings-sheet .settings-header.scrolled{background:var(--ps-glass-solid);backdrop-filter:none;-webkit-backdrop-filter:none}}
.storage-details summary{display:flex;align-items:center;min-height:44px;cursor:pointer;list-style:none;color:var(--ps-accent);font:600 15px/20px var(--ps-font)}
.storage-details summary::-webkit-details-marker{display:none}
.storage-details p{margin:0 0 8px;color:var(--ps-label2);font:400 13px/18px var(--ps-font)}
.content:has(> #pair-onboarding[hidden]) #sync-local{display:none}
.content>#pair-onboarding{padding:12px;border-radius:34px}
#pair-onboarding h2{padding:4px 6px 0}
#pair-onboarding p{padding:0 6px}
.swipe-stamp{top:72px}
.card-tool,#enlarge{transition:transform .35s cubic-bezier(.34,1.56,.64,1),opacity .2s var(--ps-ease)}
.content #card:not(.expanded),.content:has(> #caption:not([hidden]))>#card:not(.expanded){overflow:visible;background:transparent;box-shadow:none}
.content #card:not(.expanded)::after{content:none}
.content #card:not(.expanded)>.top-card{border-radius:inherit;overflow:hidden;box-shadow:var(--ps-glass-shadow-lg)}
.content #card:not(.expanded)>.top-card::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--ps-glass-fill);pointer-events:none}
.content #card:not(.expanded)>.top-card::after{content:"";position:absolute;inset:0;z-index:4;border-radius:inherit;box-shadow:inset 0 0 0 1px var(--ps-glass-stroke);pointer-events:none}
.content #card:not(.expanded)>.under-card{inset:0;max-height:none;border-radius:inherit;background:var(--ps-glass-fill);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}
.content #card>.top-card.lifted{z-index:7}
.overlay.lifting{overflow:hidden}
.overlay.lifting>.content{overflow:visible}
.content #card:not(.expanded)>.top-card.lifted::before{background:linear-gradient(var(--ps-glass-fill),var(--ps-glass-fill)),var(--ps-tint,var(--ps-chrome))}
.content .status{color:var(--ps-label)}
#enlarge{display:flex;align-items:center;justify-content:center}
.content #enlarge svg,.content .card-tool svg{width:18px;height:18px;flex:none}
@media (min-width:900px) and (min-height:700px){.content #enlarge svg,.content .card-tool svg{width:20px;height:20px}}
.trash-nav button{display:inline-flex;align-items:center;gap:2px;background:var(--ps-glass-fill-strong);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}
.trash-nav>button:first-child{padding-left:8px}
.content .trash-nav svg.nav-chevron{width:20px;height:20px;flex:none}
.trash-nav>button:disabled{opacity:.4;cursor:default}
.trash-preview .trash-nav{display:grid;grid-template-columns:1fr auto 1fr;gap:8px}
.trash-preview .trash-nav>button{justify-self:start}
.trash-position{color:var(--ps-label2);font:600 15px/20px var(--ps-font);font-variant-numeric:tabular-nums}
.review-panel:has(> .trash-preview)>:not(.trash-preview),.review-panel:has(> .trash-done:not([hidden]))>:not(.trash-done){visibility:hidden}
.trash-preview,.trash-done{background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none}
.trash-preview-media{margin:0 16px}
.trash-preview-media img{width:auto;height:auto;max-width:100%;max-height:100%;border-radius:var(--ps-r-card)}
.trash-preview-media video{border-radius:var(--ps-r-card)}
.content>.order-row,.order-row{z-index:6}
.trash-strip{gap:8px;padding:12px 16px}
.trash-strip button{width:44px;height:44px;min-height:44px;border-radius:10px}
.trash-strip button.active{outline:2px solid var(--ps-accent);outline-offset:-2px}
.trash-preview .trash-bar .preview-trash[aria-pressed=false]{background:var(--ps-glass-fill-strong);color:var(--ps-destructive)}
.trash-preview .trash-bar button[aria-pressed=true]:not(.preview-trash){background:var(--ps-glass-tint-blue);color:var(--ps-on-action)}
.trash-bar button{white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
@media (min-width:601px) and (min-height:521px){.review-panel>.trash-bar,.trash-preview>.trash-bar{align-self:center;width:min(560px,calc(100% - 80px));margin-left:0;margin-right:0}}
@supports ((backdrop-filter:blur(20px)) or (-webkit-backdrop-filter:blur(20px))){#order-menu,.share-sheet{background:var(--ps-glass-solid)}}
@media (min-width:900px) and (min-height:700px){.settings-sheet .settings-header{padding-left:max(22px,calc((100% - 680px)/2 + 4px));padding-right:max(14px,calc((100% - 680px)/2))}}
.share-sheet{padding:14px;border-radius:32px}
.share-head{align-items:flex-start}
.share-head>div{align-self:center}
.share-thumb{border-radius:18px}
.share-action{padding:10px 16px 10px 10px;border-radius:28px}
.settings-sheet .toggle-row{min-height:44px}
.share-link-row{gap:8px}
.share-link-row input{height:44px;padding:0 16px;border:0;border-radius:22px;background:var(--ps-glass-fill-strong);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}
.share-link-row button{border-radius:50%;background:var(--ps-glass-fill-strong);box-shadow:inset 0 0 0 1px var(--ps-glass-stroke)}
.share-scrim{animation-duration:.28s;animation-timing-function:var(--ps-ease)}
.review-panel:not([hidden]){animation:ps-sheet-up .28s var(--ps-ease)}
.trash-preview,.trash-done:not([hidden]){animation:ps-fade-in .28s var(--ps-ease)}
#order-menu:not([hidden]){animation:ps-pop .2s var(--ps-ease)}
@keyframes ps-fade-in{from{opacity:0}}
@keyframes ps-pop{from{opacity:0;scale:.96}}
@media (prefers-reduced-motion:reduce){.review-panel:not([hidden]),.trash-preview,.trash-done:not([hidden]),#order-menu:not([hidden]){animation:none}.settings-sheet .settings-header,.card-tool,#enlarge{transition:none}}`;root.append(polishStyle);
 const ambient=document.createElement('div');ambient.setAttribute('class','ambient');ambient.setAttribute('aria-hidden','true');const ambientLayers=[0,1].map(()=>{const canvas=document.createElement('canvas');canvas.width=48;canvas.height=48;ambient.append(canvas);return canvas;});overlayElement.append(ambient);
 let demoSeeding=null,ambientKey=null,ambientLayer=0,ambientImage=null;
 const ambientSmall=document.createElement('canvas');ambientSmall.width=10;ambientSmall.height=10;
 function paintAmbient(image){const next=ambientLayers[1-ambientLayer],context=next.getContext('2d'),reduced=ambientSmall.getContext('2d'),small=ambientSmall;reduced.clearRect(0,0,10,10);reduced.imageSmoothingEnabled=true;reduced.imageSmoothingQuality='high';reduced.drawImage(image,0,0,10,10);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.clearRect(0,0,48,48);if('filter' in context)context.filter='blur(3px)';context.drawImage(small,-8,-8,64,64);tintChrome(reduced);ambientLayer=1-ambientLayer;next.classList.add('on');ambientLayers[1-ambientLayer].classList.remove('on');}
 let tintLayers=null;
 function tintChrome(source){
  let tint='';
  if(source){try{const pixels=source.getImageData(0,0,10,3).data,scheme=`${host.dataset.scheme||''}${!!window.matchMedia?.('(prefers-color-scheme: dark)')?.matches}`;if(tintLayers?.scheme!==scheme){const style=window.getComputedStyle(ambient),layer=name=>(style.getPropertyValue(name).match(/[\d.]+/g)||[]).map(Number);tintLayers={scheme,dim:layer('--ps-ambient-dim'),fade:layer('--ps-ambient-fade')};}const {dim,fade}=tintLayers,total=[0,0,0];for(let index=0;index<pixels.length;index+=4)for(let channel=0;channel<3;channel++)total[channel]+=pixels[index+channel];tint=`rgb(${total.map((sum,channel)=>{let value=sum/(pixels.length/4);for(const over of [dim,fade])if(over.length===4)value=value*(1-over[3])+over[channel]*over[3];return Math.round(value);}).join(',')})`;}catch{}}
  if(tint===chromeTint&&!pageLock?.theme)return;chromeTint=tint;for(const element of [overlayElement,ambient])element.style.backgroundColor=tint;host.style.setProperty('--ps-tint',tint);
  if(pageLock?.theme)pageLock.theme.setAttribute('content',tint||window.getComputedStyle?.(overlayElement)?.backgroundColor||'');
 }
 function updateAmbient(item){
  const key=item?.thumbUrl?item.mediaKey:null;if(key===ambientKey)return;ambientKey=key;
  if(ambientImage){ambientImage.onload=ambientImage.onerror=null;ambientImage=null;}
  if(!key){for(const layer of ambientLayers)layer.classList.remove('on');tintChrome(null);return;}
  let source;try{source=mediaURL(item.thumbUrl,false,{width:64,height:64});}catch{return;}
  const image=window.Image?new window.Image():document.createElement('img');ambientImage=image;image.decoding='async';
  image.onload=()=>{if(ambientImage!==image)return;Promise.resolve(image.decode?.()).catch(()=>{}).then(()=>swipeFeedback.finished).then(()=>{if(ambientImage!==image)return;ambientImage=null;try{paintAmbient(image);}catch{}});};image.onerror=()=>{if(ambientImage===image)ambientImage=null;};
  image.src=source;
 }
 const shortcuts=document.createElement('section');shortcuts.setAttribute('class','shortcuts');shortcuts.setAttribute('aria-label','Keyboard shortcuts');const shortcutsTitle=document.createElement('h2'),shortcutList=document.createElement('ul');shortcutsTitle.textContent='Keyboard';for(const [key,label] of [['\u2190','Mark for Trash'],['\u2192','Keep'],['Z','Undo'],['F','Fullscreen']]){const row=document.createElement('li'),cap=document.createElement('kbd');cap.textContent=key;row.append(cap,document.createTextNode(label));shortcutList.append(row);}shortcuts.append(shortcutsTitle,shortcutList);divElement4.append(shortcuts);
 if(demo){launcherElement.hidden=true;closeElement.hidden=true;googleSignIn.disabled=true;googleSettings.disabled=true;}
 const shareLinks=new Map();let sharePrepared=null,shareItem=null;
 async function prepareShare(item){
  let file=null;
  try{
   const source=item.type==='video'?smallerVideoURL(await videoURL(item)):`${item.thumbUrl}=w4096-h4096`;
   let response;try{response=await environment.fetch(source,{credentials:'include'});}catch{response=await environment.fetch(source,{credentials:'omit'});}
   if(!response.ok)throw Error('Unavailable');
   const blob=await response.blob();if(!blob.size||blob.size>300e6)throw Error('Unavailable');
   const type=blob.type||(item.type==='video'?'video/mp4':'image/jpeg'),extension={'image/png':'png','image/webp':'webp','image/heic':'heic','video/quicktime':'mov','video/webm':'webm','video/mp4':'mp4'}[type]||(item.type==='video'?'mp4':'jpg');
   file=new window.File([blob],`${String(item.name||'photo').replace(/\.[^.]+$/,'')}.${extension}`,{type});
   if(window.navigator.canShare&&!window.navigator.canShare({files:[file]}))file=null;
  }catch{}
  return {key:item.mediaKey,file};
 }
 let copiedTimer=null;
 function showCopied(copied){window.clearTimeout(copiedTimer);icon(shareCopy,copied?'Copied':'Copy link',copied?copiedGlyph:copyGlyph);shareCopy.title=copied?'Copied':'Copy link';if(copied)copiedTimer=window.setTimeout(()=>showCopied(false),1600);}
 function renderShareLink(){const url=shareLinks.get(shareItem?.mediaKey);shareLinkRow.hidden=!url;shareLink.hidden=!!url;if(url)shareLinkField.value=url;shareLinkShare.hidden=!window.navigator.share;showCopied(false);}
 function openShare(){
  const item=current();if(!item)return;swipeFeedback.reset();shareItem=item;
  shareTitle.textContent=item.name||'Untitled';shareSub.textContent=[item.type==='video'?'Video':'Photo',captureDate(item),itemSize(item)].filter(Boolean).join(' \u00b7 ');
  try{shareThumb.src=queueThumbnailSource(item);}catch{shareThumb.removeAttribute('src');}
  sendParts.label.textContent=item.type==='video'?'Send video':'Send photo';linkParts.label.textContent='Create public link';linkParts.detail.textContent='Anyone with the link can view it';shareLink.disabled=false;
  const ready=sharePrepared?.key===item.mediaKey&&sharePrepared.file;
  shareSend.hidden=!window.navigator.share;shareSend.disabled=!ready;sendParts.detail.textContent=ready?bytes(sharePrepared.file.size):'Preparing\u2026';
  renderShareLink();shareScrim.hidden=shareSheet.hidden=false;shareClose.focus?.();
  if(sharePrepared?.key!==item.mediaKey&&window.navigator.share){const token=item.mediaKey;sharePrepared={key:token,file:null,pending:true};prepareShare(item).then(result=>{if(sharePrepared?.key!==token)return;sharePrepared=result;if(shareItem?.mediaKey!==token||shareSheet.hidden)return;shareSend.disabled=!result.file;sendParts.detail.textContent=result.file?bytes(result.file.size):'Unavailable here. Create a public link instead.';});}
 }
 function closeShare(){const wasOpen=!shareSheet.hidden;shareScrim.hidden=shareSheet.hidden=true;shareItem=null;if(wasOpen&&!overlayElement.hidden&&shareElement.getClientRects().length)shareElement.focus();}
 shareSend.onclick=()=>{const file=sharePrepared?.key===shareItem?.mediaKey?sharePrepared.file:null;if(!file)return;window.navigator.share({files:[file]}).then(()=>closeShare(),error=>{if(error?.name!=='AbortError')message(`Couldn\u2019t open the share sheet: ${error?.message||'unknown error'}`);});};
 shareLink.onclick=async()=>{const item=shareItem;if(!item||shareLink.disabled)return;shareLink.disabled=true;linkParts.label.textContent='Creating link\u2026';try{const result=await call('createShareLink',{mediaKey:item.mediaKey});shareLinks.set(item.mediaKey,result.url);if(shareItem?.mediaKey===item.mediaKey){renderShareLink();shareCopy.focus?.({preventScroll:true});}}catch(error){shareLink.disabled=false;linkParts.label.textContent='Create public link';linkParts.detail.textContent=error.message;}};
 shareCopy.onclick=()=>{const url=shareLinkField.value;(window.navigator.clipboard?.writeText?Promise.resolve(window.navigator.clipboard.writeText(url)):Promise.reject(Error('Clipboard unavailable'))).then(()=>showCopied(true),()=>{showCopied(false);shareLinkField.select?.();message('Copying isn\u2019t available here. The link is selected so you can copy it.');});};
 shareLinkShare.onclick=()=>{const url=shareLinkField.value;window.navigator.share?.({url}).catch(error=>{if(error?.name!=='AbortError')message(`Couldn\u2019t open the share sheet: ${error?.message||'unknown error'}`);});};
 shareClose.onclick=closeShare;shareScrim.onclick=closeShare;
 for(const element of [shareSheet,shareScrim,shareElement,openElement])element.addEventListener('pointerdown',event=>event.stopPropagation());shareElement.onclick=()=>{if(demo)message('Demo: sharing is off.');else openShare();};if(demo)openElement.addEventListener('click',event=>{event.preventDefault();message('Demo: this opens the photo in Google Photos.');});

 if(demo){window.setTimeout(()=>open(),0);document.addEventListener?.('visibilitychange',()=>{if(!document.hidden&&$('overlay').hidden&&!openingPromise&&!closingPromise)open();});}
 $('launcher').onclick=()=>openLatest();$('close').onclick=close;$('keep').onclick=()=>decide('keep');$('remove').onclick=()=>decide('remove');$('undo').onclick=undo;$('load').onclick=()=>run(()=>loadRequested());$('refresh').onclick=()=>run(()=>loadRequested(true));$('enlarge').onclick=toggleEnlarge;
 reviewEvery.onchange=deleteMethod.onchange=()=>{trashOptIn.checked=deleteMethod.value==='trash';persistResume();render();};
 $('filter').onchange=()=>{inspected=null;focused=null;deckItems=null;buffer.clear();render();};
 $('sort').onchange=()=>{focused=shown||null;inspected=null;deckItems=null;buffer.clear();updateOrder();render();};
 $('zoom').oninput=()=>{swipeFeedback.reset();mediaElement.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'';const image=$('media').querySelector('img');if(image){const media=$('media'),centerX=media.scrollWidth?(media.scrollLeft+media.clientWidth/2)/media.scrollWidth:.5,centerY=media.scrollHeight?(media.scrollTop+media.clientHeight/2)/media.scrollHeight:.5;$('card').classList.toggle('zoomed',Number($('zoom').value)>1);image.style.maxWidth='none';image.style.maxHeight='none';image.style.width=`${Number($('zoom').value)*100}%`;image.style.touchAction=Number($('zoom').value)>1?'pan-x pan-y pinch-zoom':'';if(Number($('zoom').value)>1&&media.scrollWidth){media.scrollLeft=centerX*media.scrollWidth-media.clientWidth/2;media.scrollTop=centerY*media.scrollHeight-media.clientHeight/2;}}};let panStart=null;mediaElement.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse'||event.button!==0||Number($('zoom').value)<=1||event.target.tagName!=='IMG')return;panStart={x:event.clientX,y:event.clientY,left:mediaElement.scrollLeft,top:mediaElement.scrollTop,id:event.pointerId};mediaElement.setPointerCapture?.(event.pointerId);event.preventDefault();});mediaElement.addEventListener('pointermove',event=>{if(!panStart||event.pointerId!==panStart.id)return;mediaElement.scrollLeft=panStart.left-(event.clientX-panStart.x);mediaElement.scrollTop=panStart.top-(event.clientY-panStart.y);});for(const type of ['pointerup','pointercancel','lostpointercapture'])mediaElement.addEventListener(type,()=>{panStart=null;});
 $('send').onclick=()=>{if(busy)return;const confirmedKeys=[...(state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey))];const count=confirmedKeys.length;if(!count){message('Nothing is marked for Trash.');return;}if(!window.confirm(`Add ${count} candidates to a private review album? This does not delete media.`))return;run(async()=>{const keys=state.job?.mediaKeys||reviewQueue(state).map(item=>item.mediaKey);if(keys.length!==confirmedKeys.length||keys.some(key=>!confirmedKeys.includes(key)))throw Error('Going to Trash changed in another tab. Review it and confirm again.');message('Updating and verifying the review album\u2026');await sendReviewAlbum({read:async()=>state,save,call,title:'Photos Swipe \u00b7 Review'});inspected=null;message('Every candidate was verified in the review album. Choose Trash in Settings to use this panel, or open the review album to move items manually in Google Photos.');});};
 trashOptIn.onchange=()=>render();
 moveTrash.onclick=()=>{if(busy||reviewPanel.hidden||!trashOptIn.checked)return;const candidates=reviewRows().filter(item=>item.decision==='remove'),keys=candidates.map(item=>item.mediaKey);if(!keys.length){message('No candidates to move to Trash.');return;}if(!demo&&!window.confirm(`Move exactly ${keys.length} items to Google Photos Trash?\n\nItems stay in Google Photos Trash for 60 days.`))return;const kept=new Set(),rescued=reviewRows().filter(item=>item.decision!=='remove').length,wanted=new Set(keys),confirmed=new Set();const progress=text=>{trashProgress=text;moveTrash.textContent=text;message(text);};pauseLibraryFill();run(async()=>{let failure=null;try{if(state.job)throw Error('Finish the saved album operation before moving items to Trash.');const currentKeys=reviewRows().filter(item=>item.decision==='remove').map(item=>item.mediaKey);if(currentKeys.length!==keys.length||currentKeys.some(key=>!wanted.has(key)))throw Error('Candidates changed. Review the item list and confirm again.');const dedupKeys=new Map(state.items.filter(item=>wanted.has(item.mediaKey)).map(item=>[item.mediaKey,item.dedupKey]));if(keys.some(key=>!dedupKeys.get(key)))throw Error('Missing Trash identifiers. Refresh latest before retrying.');let batches=[];for(let index=0;index<keys.length;index+=25)batches.push(keys.slice(index,index+25));progress(`Moving ${keys.length} to Trash\u2026`);if(syncEnabled){await synchronize();const checks=await Promise.all(batches.map(batch=>syncClient.trashCheck(identity.account,batch)));if(checks.some(check=>!check.safe&&!check.kept))throw Error('Sync decisions changed. Review candidates before moving to Trash.');for(const check of checks)for(const key of check.kept||[])if(wanted.delete(key))kept.add(key);if(kept.size)await save(current=>current.items.reduce((next,item)=>kept.has(item.mediaKey)?decideWithHistory(next,item,'keep'):next,current));batches=batches.map(batch=>batch.filter(key=>wanted.has(key))).filter(batch=>batch.length);}let next=0;await Promise.all(Array.from({length:Math.min(3,batches.length)},async()=>{while(next<batches.length&&!failure){const batch=batches[next++];try{await call('moveToTrash',{dedupKeys:batch.map(key=>dedupKeys.get(key)),confirmed:true});const verified=await confirmReviewTrash(batch,call,{sleep:delay=>new Promise(resolve=>window.setTimeout(resolve,delay))});for(const key of verified)confirmed.add(key);if(verified.size<batch.length){const missing=state.items.filter(item=>batch.includes(item.mediaKey)&&!verified.has(item.mediaKey)),one=missing.length===1;throw Error(`Couldn\u2019t confirm ${one?missing[0].name:`${missing.length} items`} in Google Photos Trash. If ${one?'it was':'they were'} already deleted in Google Photos, untick ${one?'it':'them'} in Going to Trash.`);}progress(`Moving to Trash \u00b7 ${confirmed.size} of ${keys.length}`);}catch(error){failure||=error;}}}));}catch(error){failure=error;}finally{trashProgress=null;}if(confirmed.size)await save(current=>markReviewTrash(current,confirmed));if(failure){if(confirmed.size)throw Error(`${confirmed.size} of ${wanted.size} moved to Trash; ${wanted.size-confirmed.size} still marked for Trash. ${failure.message}`);throw failure;}if(!wanted.size){renderTrashReview();message(`Nothing moved to Trash. Another device kept ${kept.size===1?'that photo':'those photos'}.`);return;}storageSession.reset(state.items.filter(item=>item.state==='in_trash'||wanted.has(item.mediaKey)));storageCapsule.reset();reviewItems=reviewItems.filter(item=>!wanted.has(item.mediaKey));previewKey=null;doneSummary={freed:estimate(candidates.filter(item=>wanted.has(item.mediaKey))),deleted:wanted.size,kept:rescued+kept.size};renderTrashReview();message(demo?`Demo: nothing was deleted. ${wanted.size} sample ${wanted.size===1?'photo':'photos'} left the deck.`:`Verified ${wanted.size} items in Trash.${kept.size?` ${kept.size} kept because another device kept ${kept.size===1?'it':'them'}.`:''}`);});};doneContinue.onclick=()=>{doneSummary=null;reviewPanel.hidden=true;renderTrashReview();render();$('keep').focus?.();};
 $('trash').onclick=()=>run(async()=>{message('Reading Google Photos Trash\u2026');await save(await reconcileReviewTrash(state,call));message('Trash check complete. Unknown results leave local state unchanged.');});
 for(const target of [launcherElement,overlayElement])for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','touchstart','touchmove','touchend','touchcancel','wheel','mousedown','mouseup'])target.addEventListener(type,event=>event.stopPropagation());
 for(const type of ['keydown','keyup','keypress'])overlayElement.addEventListener(type,event=>event.stopPropagation());
 launcherElement.addEventListener('click',event=>event.stopPropagation());
 const swipeFeedback=createSwipeFeedback({window,targets:[$('media'),$('swipe')],card:topCard,under:underCard,keep:stamps[0],remove:stamps[1],canSwipe:()=>!!current()&&!busy&&!otherTab&&!leaseError&&reviewPanel.hidden&&sheet.hidden&&(typeof shareSheet!=='object'||shareSheet.hidden)&&!inspected&&!$('overlay').hidden&&Number($('zoom').value)<=1,onDecide:decide,playbackOnClick:true,stage:overlayElement});
 $('overlay').addEventListener('dragstart',event=>event.preventDefault());
 $('media').addEventListener('dblclick',event=>{if(event.target.tagName!=='VIDEO')toggleEnlarge();});
 function suspendPage(){
  pageActive=false;leaseRecoveryPending=true;
  stopRenewal();
  if(suspendingPromise)return suspendingPromise;
  const releasing=releaseLease();
  if(!writes.pending&&!writes.flushing)return releasing;
  suspendingPromise=Promise.all([releasing,writes.flush()]).finally(()=>{suspendingPromise=null;});
  return suspendingPromise;
 }
 async function resumeLease(){
  await suspendingPromise;await activeOperation;await syncRunning;
  if(takeoverPending&&pageVisible()&&!closingPromise)return open(true);
  if(!leaseRecoveryPending)await refreshLease();
  await libraryLoading;
  if(!pageVisible()||!identity||$('overlay').hidden||closingPromise)return;
  startRenewal();await refreshLease();refreshStalePreviews();
 }
 function clearMedia(){stopMedia();holdNextVideo(0);dropWarmVideo();buffer.clear();window.clearTimeout(syncTimer);}
 function leavePage(){
  const releasing=suspendPage();
  clearMedia();return releasing;
 }
 if(tabChannel)tabChannel.onmessage=async({data})=>{if(!identity||data?.account!==identity.account||data.owner===owner||!pageVisible()||$('overlay').hidden)return;try{await refreshLease();}catch{}};
 for(const event of ['pagehide','unload'])window.addEventListener(event,leavePage);
 window.addEventListener('focus',async()=>{activeAt=Date.now();if(identity&&!busy&&!activeOperation&&!$('overlay').hidden){await refreshLease();if(!otherTab)await synchronize();}});
 document.addEventListener?.('visibilitychange',()=>{if(document.hidden){captureVideo();suspendPage();clearPreviewWindow();dropWarmVideo();}else{pageActive=true;if(openingPromise&&!$('overlay').hidden)resumeOpening=true;else if(leaseRecoveryPending&&!identity&&!$('overlay').hidden&&!closingPromise)open();if(identity&&!$('overlay').hidden){lastPullAt=0;activeAt=Date.now();resumeLease();}}});
 window.addEventListener('pageshow',function restorePage(){pageActive=true;if(!document.hidden&&!$('overlay').hidden){if(openingPromise)resumeOpening=true;return open();}});
 function editingFieldFocused(event){
  const editable=element=>['INPUT','SELECT','TEXTAREA'].includes(element?.tagName)||element?.isContentEditable;
  const focused=[document.activeElement,root.activeElement];
  for(let index=0;index<focused.length;index++){const nested=focused[index]?.shadowRoot?.activeElement;if(nested)focused.push(nested);}
  return [...focused,event.target,...(event.composedPath?.()||[])].some(editable);
 }
 function handleViewerSpace(event){
  if(!sheet.hidden||!reviewPanel.hidden||(typeof shareSheet==='object'&&!shareSheet.hidden))return false;
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||event.key!==' ')return false;
  if(editingFieldFocused(event))return false;
  event.preventDefault();event.stopImmediatePropagation();
  if(Date.now()<viewerShortcutsBlockedUntil)return true;
  const video=$('media').querySelector('video');
  if(video&&event.type==='keydown'&&!event.repeat){if(video.paused)video.play().catch(()=>{});else video.pause();}
  return true;
 }
 window.addEventListener('keyup',handleViewerSpace,true);
 window.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('overlay').hidden){event.preventDefault();event.stopImmediatePropagation();if(typeof shareSheet==='object'&&!shareSheet.hidden)closeShare();else if(!sheet.hidden)closeSettings();else if(!reviewPanel.hidden){if(previewKey){previewKey=null;renderTrashReview();}else{reviewPanel.hidden=true;renderTrashReview();reviewButton.focus();}}else if(!orderMenu.hidden){orderMenu.hidden=true;updateOrder();orderButton.focus();}else if($('card').classList.contains('expanded'))toggleEnlarge();else if(demo)demo.notify?.('escape');else close();return;}
  if((!sheet.hidden||!reviewPanel.hidden||(typeof shareSheet==='object'&&!shareSheet.hidden))&&event.key!=='Tab'){event.stopImmediatePropagation();return;}
  if(!orderMenu.hidden&&!$('overlay').hidden&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.isComposing&&['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End',' ','Enter','z','Z','f','F'].includes(event.key)){
   event.preventDefault();event.stopImmediatePropagation();
   const items=[...orderMenu.querySelectorAll('button')],index=items.indexOf(root.activeElement);
   if(event.key===' '||event.key==='Enter'){if(!event.repeat)(items[index]||items[0])?.click();return;}
   const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(index+1)%items.length:event.key==='ArrowUp'?(index<=0?items.length-1:index-1):-1;
   if(next>=0)items[next]?.focus();return;
  }
  if(handleViewerSpace(event))return;
  if($('overlay').hidden||event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
  if(event.key==='Tab'){
   const focusable=[...(!sheet.hidden?sheet:!reviewPanel.hidden?(reviewPanel.querySelector('.trash-preview')||reviewPanel):overlayElement).querySelectorAll('button:not(:disabled),select,input,a[href],summary,video[controls]')].filter(element=>element.getClientRects().length);
   const index=focusable.indexOf(root.activeElement),next=event.shiftKey?(index<=0?focusable.length-1:index-1):(index+1)%focusable.length;
   event.preventDefault();event.stopImmediatePropagation();focusable[next]?.focus();return;
  }
  if(Date.now()<viewerShortcutsBlockedUntil||editingFieldFocused(event))return;
  const actions={ArrowLeft:()=>decide('remove'),ArrowRight:()=>decide('keep'),z:undo,Z:undo,f:toggleEnlarge,F:toggleEnlarge,Escape:close};
  if(actions[event.key]){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat||!['ArrowLeft','ArrowRight','z','Z'].includes(event.key))actions[event.key]();}
 },true);
}

const params=new URLSearchParams(location.search);
const embed=params.get('embed')==='1';
if(embed)document.documentElement.dataset.embed='1';
mountPhotosSwipe(createDemoEnvironment({window,document,location,base:new URL('media/',document.baseURI).href,embed,top:params.get('top'),scheme:params.get('scheme'),version:"1.2.169"}));
})();
