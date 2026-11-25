import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as model from '../extension/model.js';
const workerSource=(await readFile(new URL('../extension/worker.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'');
const contentSource=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');

async function harness(options={}){
 let now=Date.parse('2026-11-20T21:59:58+08:00'),next=0;
 const timers=new Map(),events=[],data={},tabs=new Map([[9,{id:9,windowId:2,url:'https://booking.cuhk.edu.cn/a/field/client/main'}]]);
 const setTimer=(fn,ms=0)=>{const id=++next;timers.set(id,{at:now+ms,fn});return id;};
 const sleep=ms=>new Promise(r=>setTimer(r,ms));
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const sender={tab:{id:9},frameId:0,documentId:'doc1',url:tabs.get(9).url};
 let workerListener,contentListener,lost=false,refreshes=0,opens=0;
 const net={started:0,finished:0,pending:0,failures:0,authFailures:0,retryAt:0,lastCycleMs:30};
 const fireAt=model.releaseAt('2026-11-22');let occupied=false;
 const call=(m,s={})=>new Promise(r=>workerListener(m,s,r));
 const chrome={runtime:{onMessage:{addListener:f=>workerListener=f}},
  storage:{local:{get:async k=>({[k]:structuredClone(data[k])}),set:async v=>Object.assign(data,structuredClone(v))}},
  action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
  alarms:{create:async()=>{},clear:async()=>{},onAlarm:{addListener(){}}},
  scripting:{executeScript:async()=>{events.push(['monitor',now]);return [{result:{...net}}];}},
  tabs:{get:async id=>{if(!tabs.has(id))throw Error('missing tab');return tabs.get(id);},
   sendMessage:async(id,m)=>{if(id===9&&contentListener)return new Promise(r=>contentListener(structuredClone(m),{},r));},
   create:async cfg=>{events.push(['verify-tab',now,cfg]);const t={id:99,...cfg};tabs.set(99,t);return t;},
   update:async(id,cfg)=>{events.push(['navigate',now,id]);return Object.assign(tabs.get(id),cfg);},
   onRemoved:{addListener(){}}}
 };
 const common={Date:Clock,crypto:globalThis.crypto,URL,console,setTimeout:setTimer,clearTimeout:id=>timers.delete(id)};
 vm.runInContext(workerSource,vm.createContext({...common,chrome,...model,config:input=>model.config(input,now)}));
 const site={
  identity:()=> '测试',preflight:()=>({identity:'测试'}),formDoc:()=>null,
  dateTo:async(_date,check)=>{check();events.push(['date',now]);
   if(options.releaseDelay&&now<fireAt+options.releaseDelay)throw Object.assign(Error('date not released'),{retry:true,code:'release-pending'});
   if(options.deferredDate){
    if(now<model.releaseAt('2026-11-22'))throw Object.assign(Error('date not released'),{retry:true});
    options.deferredDate=false;net.started++;net.pending++;
    setTimer(()=>{net.finished++;net.pending--;},30);return true;
   }
   return false;
  },
  network:()=>({...net}),calendarReady:()=>{},
  refresh:()=>{events.push(['refresh',now]);refreshes++;net.started++;net.pending++;
   setTimer(()=>{net.finished++;net.pending--;
    if(refreshes<= (options.refreshFailures||0))net.failures++;
    if(options.rateLimit&&refreshes===1){net.failures++;net.retryAt=now+3000;}
    if(options.authFailure)net.authFailures++;
   },30);},
  points:()=> (options.courts||[6]).map(court=>({court,free:!(occupied&&court===6)&&!(options.availabilityDelay&&now<fireAt+options.availabilityDelay)})),
  open:async(p,check)=>{check();events.push(['open',now,p.court]);opens++;await sleep(40);
   if(options.openReleaseDelay&&now<fireAt+options.openReleaseDelay)throw Object.assign(Error('booking not open'),{retry:true,code:'release-pending'});
   if(options.conflicts?.includes(p.court))throw Object.assign(Error('court taken'),{retry:true,code:'court-gone'});
   if(options.formTimeoutCourt===p.court)throw Object.assign(Error('form timeout'),{retry:true,code:'form-timeout'});
   if(opens<=(options.openFailures||0))throw Object.assign(Error('form timeout'),{retry:true});return {};},
  fill:()=>{events.push(['fill',now]);if(options.takenDuringFill)occupied=true;if(options.stopAtFill)call({type:'stop'});},
  formResponseMs:()=>30,
  validate:()=>{},dismissForm:()=>{events.push(['dismiss',now]);if(options.closeFailure)throw Error('cannot close old form');},
  submitButton:()=>({click:()=>{events.push(['click',now]);if(options.postCommitConflict)throw Object.assign(Error('court taken after submit'),{retry:true,code:'court-gone'});if(options.clickThrows)throw Error('lost click response');}}),
  submitAndObserve:async(_doc,t,court,button)=>{
   button.click();await sleep(20);
   if(options.submitRejections?.includes(court))return {evidence:{source:'fresh-school-dialog',contextValid:true,message:'该场地已被他人预订，请重新选择场地',observedAt:now,court,date:t.date,hour:t.hour,identity:t.identity}};
   return {evidence:null};
  },
  sleep,wait:async(fn,ms=8000,label='')=>{const until=now+ms;while(now<until){const v=fn();if(v)return v;await sleep(5);}throw Error('等待'+label+'超时');},orders:()=>[]
 };
 const contentChrome={runtime:{onMessage:{addListener:f=>contentListener=f},sendMessage:async m=>{
  events.push(['message',now,m.type]);const r=await call(m,sender);
  if(options.lostCommit&&!lost&&m.type==='commit'&&r.ok){lost=true;throw Error('message port lost');}
  if(options.lostRejection&&!lost&&m.type==='submission-result'&&r.ok&&r.value.status==='running'){lost=true;throw Error('rejection acknowledgement lost');}
  return r;
 }}};
 vm.runInContext(contentSource,vm.createContext({...common,chrome:contentChrome,CourtSite:site,
  performance:{now:()=>now},requestAnimationFrame:f=>setTimer(f,16),
  document:{createElement:()=>({style:{}}),documentElement:{append(){}}},
  location:{pathname:'/a/field/client/main',reload:()=>events.push(['reload',now])}}));
 const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
 const advance=async target=>{
  await flush();let loops=0;
  while(true){
   const entry=[...timers].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
   if(!entry)break;if(++loops>10000)throw Error('timer runaway');
   const [id,t]=entry;timers.delete(id);now=t.at;t.fn();await flush();
  }
  now=target;await flush();
 };
 await flush();
 const r=await call({type:'arm',tabId:9,config:{date:'2026-11-22',hour:18,phone:'13800000000',theme:'测试',purpose:'测试',participants:2,test:!!options.test,rehearsalSeconds:options.rehearsalSeconds||0}});
 assert.ok(r.ok,r.error);await flush();
 return {events,data,call,sender,advance,fire:r.value.fireAt,wake:()=>contentListener({type:'wake'},{},()=>{})};
}
test('prepares before release, refreshes only at release, and keeps the submission tab untouched',async()=>{
 const h=await harness();await h.advance(h.fire-1);
 assert.ok(h.events.some(e=>e[0]==='date'&&e[1]<h.fire));
 assert.equal(h.events.filter(e=>e[0]==='refresh').length,0);
 assert.ok(h.data.task.preparedAt<h.fire);
 await h.advance(h.fire+1000);
 assert.equal(h.events.filter(e=>e[0]==='monitor').length,1);
 assert.equal(h.events.filter(e=>e[0]==='refresh').length,1);
 assert.equal(h.events.filter(e=>e[0]==='click').length,1);
 assert.ok(h.events.find(e=>e[0]==='refresh')[1]>=h.fire);
 assert.equal(h.events.find(e=>e[0]==='verify-tab')[2].active,false);
 assert.equal(h.events.filter(e=>e[0]==='navigate'||e[0]==='reload').length,0);
 h.wake();h.wake();await h.advance(h.fire+2000);
 assert.equal(h.events.filter(e=>e[0]==='click').length,1);
});
test('transient refresh and form errors retry before submission, test mode never clicks',async()=>{
 const h=await harness({test:true,refreshFailures:1,openFailures:1});await h.advance(h.fire+8000);
 assert.equal(h.data.task.status,'filled');
 assert.equal(h.events.filter(e=>e[0]==='click').length,0);
 assert.equal(h.events.filter(e=>e[0]==='refresh').length,3);
 assert.equal(h.data.task.timings.attempts,3);
});
test('lost durable-commit acknowledgement never retries the submit permit',async()=>{
 const h=await harness({lostCommit:true});await h.advance(h.fire+2000);
 assert.equal(h.data.task.status,'verifying');assert.ok(h.data.task.commitAt);
 assert.equal(h.events.filter(e=>e[0]==='click').length,0);
 const r=await h.call({type:'commit',id:h.data.task.id,court:6,identity:'测试'},h.sender);assert.equal(r.ok,false);
});
test('an exception after clicking only opens order lookup and cannot click twice',async()=>{
 const h=await harness({clickThrows:true});await h.advance(h.fire+2000);
 assert.equal(h.data.task.status,'verifying');
 assert.equal(h.events.filter(e=>e[0]==='click').length,1);
 h.wake();await h.advance(h.fire+3000);assert.equal(h.events.filter(e=>e[0]==='click').length,1);
});
test('stop racing with form completion is enforced by the durable commit gate',async()=>{
 const h=await harness({stopAtFill:true});await h.advance(h.fire+2000);
 assert.equal(h.data.task.status,'stopped');assert.equal(h.events.filter(e=>e[0]==='click').length,0);
});
test('date switching at release reuses its fresh query instead of fetching twice',async()=>{
 const h=await harness({test:true,deferredDate:true});await h.advance(h.fire+1000);
 assert.equal(h.data.task.status,'filled');
 assert.equal(h.events.filter(e=>e[0]==='refresh').length,0);
 assert.equal(h.events.filter(e=>e[0]==='open').length,1);
 assert.equal(h.events.filter(e=>e[0]==='click').length,0);
});
test('10 second rehearsal prepares early, fills only at deadline, repeated wakes cannot submit',async()=>{
 const h=await harness({test:true,rehearsalSeconds:10});await h.advance(h.fire-1);
 assert.ok(h.data.task.preparedAt<h.fire);
 assert.equal(h.events.filter(e=>['refresh','open','fill','click'].includes(e[0])).length,0);
 h.wake();h.wake();await h.advance(h.fire+1000);
 assert.equal(h.data.task.status,'filled');assert.equal(h.events.filter(e=>e[0]==='fill').length,1);
 assert.equal(h.events.filter(e=>e[0]==='click').length,0);
 assert.ok(h.data.task.timings.fromFireMs>=h.data.task.timings.readyMs);
 h.wake();h.wake();await h.advance(h.fire+2000);
 assert.equal(h.events.filter(e=>e[0]==='fill').length,1);
 assert.equal(h.events.filter(e=>e[0]==='click').length,0);
});
test('submit mode retries two pre-submit failures but still issues exactly one click',async()=>{
 const h=await harness({refreshFailures:1,openFailures:1});await h.advance(h.fire+8000);
 assert.equal(h.events.filter(e=>e[0]==='refresh').length,3);
 assert.equal(h.events.filter(e=>e[0]==='click').length,1);
 h.wake();h.wake();await h.advance(h.fire+10000);
 assert.equal(h.events.filter(e=>e[0]==='click').length,1);
});
test('a 20 second server release delay is retried until open without early selection',async()=>{
 const h=await harness({test:true,releaseDelay:20000});await h.advance(h.fire+19999);
 assert.equal(h.events.filter(e=>e[0]==='open').length,0);
 await h.advance(h.fire+23000);assert.equal(h.data.task.status,'filled');
 assert.equal(h.events.filter(e=>e[0]==='click').length,0);
});
test('availability can appear late, and opening permission can lag behind the calendar',async()=>{
 const h=await harness({test:true,availabilityDelay:3000,openReleaseDelay:15000});await h.advance(h.fire+18000);
 assert.equal(h.data.task.status,'filled');assert.equal(h.events.filter(e=>e[0]==='click').length,0);
 assert.ok(h.events.find(e=>e[0]==='fill')[1]>=h.fire+15000);
});
test('court conflict immediately switches to the next candidate without an extra refresh',async()=>{
 const h=await harness({courts:[6,4,5],conflicts:[6]});await h.advance(h.fire+2000);
 assert.equal(h.data.task.court,4);
 assert.deepEqual(h.events.filter(e=>e[0]==='open').map(e=>e[2]),[6,4]);
 assert.equal(h.events.filter(e=>e[0]==='refresh').length,1);
 assert.equal(h.events.filter(e=>e[0]==='click').length,1);
});
test('a court lost during filling is discarded before requesting a submit permit',async()=>{
 const h=await harness({courts:[6,4],takenDuringFill:true});await h.advance(h.fire+2000);
 assert.equal(h.data.task.court,4);assert.equal(h.events.filter(e=>e[0]==='click').length,1);
});
test('a form timeout cools down that court and the next query selects another court',async()=>{
 const h=await harness({courts:[6,4],formTimeoutCourt:6});await h.advance(h.fire+3000);
 assert.equal(h.data.task.court,4);assert.deepEqual(h.events.filter(e=>e[0]==='open').map(e=>e[2]),[6,4]);
 assert.equal(h.events.filter(e=>e[0]==='click').length,1);
});
test('server retry-after prevents an immediate second refresh; auth errors stop',async()=>{
 const limited=await harness({test:true,rateLimit:true});await limited.advance(limited.fire+5000);
 const times=limited.events.filter(e=>e[0]==='refresh').map(e=>e[1]);assert.ok(times[1]-times[0]>=3000);
 assert.equal(limited.data.task.status,'filled');
 const denied=await harness({authFailure:true});await denied.advance(denied.fire+2000);
 assert.equal(denied.data.task.status,'error');assert.equal(denied.events.filter(e=>e[0]==='open'||e[0]==='click').length,0);
});
test('release delay cannot run beyond the task deadline',async()=>{
 const h=await harness({test:true,releaseDelay:130000});await h.advance(h.fire+121500);
 assert.equal(h.data.task.status,'error');assert.equal(h.events.filter(e=>e[0]==='click').length,0);
});
test('even a conflict-shaped exception after commit cannot switch courts or submit again',async()=>{
 const h=await harness({courts:[6,4],postCommitConflict:true});await h.advance(h.fire+3000);
 assert.equal(h.data.task.status,'verifying');assert.equal(h.events.filter(e=>e[0]==='click').length,1);
 assert.deepEqual(h.events.filter(e=>e[0]==='open').map(e=>e[2]),[6]);
 h.wake();await h.advance(h.fire+5000);assert.equal(h.events.filter(e=>e[0]==='click').length,1);
});
test('failure to close a conflicting form stops instead of acting through an overlay',async()=>{
 const h=await harness({courts:[6,4],conflicts:[6],closeFailure:true});await h.advance(h.fire+2000);
 assert.equal(h.data.task.status,'error');assert.equal(h.events.filter(e=>e[0]==='click').length,0);
 assert.deepEqual(h.events.filter(e=>e[0]==='open').map(e=>e[2]),[6]);
});

test('explicit rejection after submit switches once to a new court, never repeats the rejected court',async()=>{
 const h=await harness({courts:[6,4,5],submitRejections:[6]});await h.advance(h.fire+2000);
 assert.equal(h.data.task.status,'verifying');assert.equal(h.data.task.court,4);
 assert.deepEqual(h.data.task.rejectedCourts,[6]);assert.equal(h.data.task.rejections.length,1);
 assert.deepEqual(h.events.filter(e=>e[0]==='open').map(e=>e[2]),[6,4]);
 assert.equal(h.events.filter(e=>e[0]==='click').length,2);
 assert.equal(h.events.filter(e=>e[0]==='refresh').length,1);
 h.wake();h.wake();await h.advance(h.fire+8000);
 assert.equal(h.events.filter(e=>e[0]==='click').length,2);
});

test('several explicit rejections use distinct attempts and persist excluded courts',async()=>{
 const h=await harness({courts:[6,4,5],submitRejections:[6,4]});await h.advance(h.fire+2000);
 assert.equal(h.data.task.court,5);assert.equal(h.data.task.status,'verifying');
 assert.deepEqual(h.data.task.rejectedCourts,[6,4]);
 assert.equal(new Set([...h.data.task.rejections.map(r=>r.attemptId),h.data.task.attemptId]).size,3);
 assert.equal(h.events.filter(e=>e[0]==='click').length,3);
});

test('lost rejection acknowledgement or failed dialog close cannot issue another click',async()=>{
 for(const option of [{lostRejection:true},{closeFailure:true}]){
  const h=await harness({courts:[6,4],submitRejections:[6],...option});await h.advance(h.fire+2000);
  assert.equal(h.events.filter(e=>e[0]==='click').length,1);assert.equal(h.data.task.status,'error');
 }
});
