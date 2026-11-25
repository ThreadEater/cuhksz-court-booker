import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {config,releaseAt,matchOrder,explicitCourtRejection} from '../extension/model.js';
const siteSource=await readFile(new URL('../extension/site.js',import.meta.url),'utf8');
test('event-driven wait reacts immediately and cleans observers on success, error and timeout',async()=>{
 let observer,listener;const document={documentElement:{},addEventListener:(_e,fn)=>listener=fn,removeEventListener:()=>listener=null};
 class Observer{constructor(fn){this.fn=fn;observer=this;}observe(){}disconnect(){this.closed=true;}}
 const ctx=vm.createContext({document,MutationObserver:Observer,setTimeout,clearTimeout,setInterval,clearInterval});
 vm.runInContext(siteSource,ctx);let ready=false;
 const pending=ctx.CourtSite.wait(()=>ready,1000);ready=true;observer.fn();
 assert.equal(await pending,true);assert.ok(observer.closed);assert.equal(listener,null);
 await assert.rejects(ctx.CourtSite.wait(()=>{throw Error('cancelled');},1000),/cancelled/);
 assert.ok(observer.closed);assert.equal(listener,null);
 await assert.rejects(ctx.CourtSite.wait(()=>false,5,'test'),/超时/);assert.ok(observer.closed);assert.equal(listener,null);
});
test('only explicit school notices classify as pre-submit conflicts or delayed release',()=>{
 const ctx=vm.createContext({});vm.runInContext(siteSource,ctx);const classify=ctx.CourtSite.classifyFeedback;
 assert.equal(classify('该场地已被他人预订'),'court-gone');
 assert.equal(classify('当前尚未开放预约'),'release-pending');
 assert.equal(classify('您的配额已用完'),'fatal');
 assert.equal(classify('没有预约权限'),'fatal');
 assert.equal(classify('请重新登录'),'fatal');
 assert.equal(classify('网络超时'),null);
 assert.equal(classify('预约成功'),null);
});
function formFixture({cap='6',named=true,linked=true,hiddenNumbers=true,labels=1,editable=false,environment={}}={}){
 const field=(id,value,readOnly=true,hidden=false)=>({id,value,readOnly,disabled:false,getClientRects:()=>hidden?[]:[{}]});
 const capacity=field(named?'capacity':'',cap,!editable);
 const inputs=[field('startTime','2026-11-21 18:00'),field('endTime','2026-11-21 19:00'),
  field('userName','测试'),field('userEmail','test@example.org'),field('','羽毛球场'),field('','大学体育馆-羽毛球场02'),capacity];
 if(hiddenNumbers)inputs.push(field('','0',true,true),field('','123',true,true));
 const label={innerText:'容纳人数：',getClientRects:()=>[{}],control:linked?capacity:null,
  parentElement:{querySelectorAll:()=>[capacity]}};
 const doc={getElementById:id=>inputs.find(e=>e.id===id),querySelectorAll(selector){
  if(selector==='label')return Array(labels).fill(label);
  if(selector==='input:not([id]),input[id=""]')return inputs.filter(e=>!e.id);
  if(selector==='input,textarea,select'||selector==='input')return inputs;
  if(selector==='input[required],textarea[required],select[required]'||selector==='span,label,font')return [];
  throw Error('unexpected fixture selector '+selector);
 }};
 const ctx=vm.createContext({getComputedStyle:()=>({visibility:'visible'}),...environment});
 vm.runInContext(siteSource,ctx);
 const task={date:'2026-11-21',hour:18,identity:'测试',participants:2};
 return {check:()=>ctx.CourtSite.validate(doc,task,2),task,inputs,doc,site:ctx.CourtSite};
}

function submissionFixture(){
 let mainNotices=[],frameNotices=[],current=true,clicks=0;
 const document={documentElement:{},addEventListener(){},removeEventListener(){},querySelectorAll:s=>s==='iframe'?(current?[{contentDocument:f.doc}]:[]):mainNotices,getElementById:()=>null};
 const f=formFixture({environment:{document,Date,setTimeout:(fn,ms)=>setTimeout(fn,ms===6500?10:ms),clearTimeout,setInterval,clearInterval,MutationObserver:class{observe(){}disconnect(){}}}});
 const query=f.doc.querySelectorAll;f.doc.querySelectorAll=s=>s.startsWith('.layui-layer')?frameNotices:query(s);
 Object.assign(f.task,{phone:'13800000000',theme:'练习',purpose:'打球'});
 for(const [id,value] of Object.entries({userPhone:f.task.phone,theme:f.task.theme,useDesc:f.task.purpose,'bizFieldBookField.joinNums':'2'}))f.inputs.push({id,value});
 const notice=message=>({innerText:message,getClientRects:()=>[{}]});
 return {...f,get clicks(){return clicks;},add:(message,frame=false)=>{const n=notice(message);(frame?frameNotices:mainNotices).push(n);return n;},removeForm:()=>{current=false;},
  submit:action=>f.site.submitAndObserve(f.doc,f.task,2,{click:()=>{clicks++;action?.();}})};
}

test('real dialog collector binds fresh top-level and iframe feedback to the submitted form',async()=>{
 for(const frame of [false,true]){
  const f=submissionFixture();const r=await f.submit(()=>f.add('该场地已被他人预订',frame));
  assert.equal(f.clicks,1);assert.equal(r.evidence.contextValid,true);assert.equal(r.evidence.court,2);
  assert.equal(explicitCourtRejection(r.evidence.message),true);
 }
});

test('real dialog collector rejects stale dialogs, changed forms, ambiguous messages and no response',async()=>{
 const stale=submissionFixture();stale.add('该场地已被他人预订');
 await assert.rejects(stale.submit(),/存在学校提示/);assert.equal(stale.clicks,0);
 const changed=submissionFixture();const result=await changed.submit(()=>{changed.add('该场地已被他人预订');changed.removeForm();});
 assert.equal(result.evidence.contextValid,false);
 const multiple=submissionFixture();assert.equal((await multiple.submit(()=>{multiple.add('该场地已被他人预订');multiple.add('预约成功');})).evidence,null);
 const timeout=submissionFixture();assert.equal((await timeout.submit()).evidence,null);assert.equal(timeout.clicks,1);
 const exception=submissionFixture();await assert.rejects(exception.submit(()=>{throw Error('court-gone');}),/court-gone/);
});
test('capacity uses its visible label with named or anonymous inputs, ignoring numeric hidden fields',()=>{
 for(const named of [true,false])for(const linked of [true,false])assert.doesNotThrow(formFixture({named,linked}).check);
});
test('capacity validation still blocks missing, invalid, editable and over-capacity forms',()=>{
 assert.throws(formFixture({labels:0}).check,/容纳人数/);
 assert.throws(formFixture({cap:''}).check,/有效/);
 assert.throws(formFixture({editable:true}).check,/只读/);
 assert.throws(formFixture({cap:'1'}).check,/超过场地容量/);
 const wrong=formFixture();wrong.inputs[0].value='2026-11-21 19:00';assert.throws(wrong.check,/时段/);
});
const base={date:'2026-11-22',hour:18,phone:'13800000000',theme:'测试',purpose:'测试',participants:2,test:false};
test('release is target date minus two days at Beijing 22:00',()=>{
 assert.equal(new Date(releaseAt(base.date)).toISOString(),'2026-11-20T14:00:00.000Z');
 assert.throws(()=>releaseAt('2026-02-30'));
 assert.throws(()=>config({...base,hour:6},0));
 assert.throws(()=>config({...base,test:undefined},0));
 assert.equal(config(base,0).fireAt,releaseAt(base.date));
});
test('short countdown is explicit and cannot be enabled in submit mode',()=>{
 const now=Date.parse('2026-11-20T10:00:00+08:00');
 const cfg=config({...base,test:true,rehearsalSeconds:10},now);
 assert.equal(cfg.fireAt,now+10000);assert.equal(cfg.test,true);
 assert.throws(()=>config({...base,test:false,rehearsalSeconds:10},now),/只填表/);
 assert.throws(()=>config({...base,test:true,rehearsalSeconds:1},now));
 assert.equal(config({...base,test:true},now).fireAt,releaseAt(base.date));
});
test('old or ambiguous orders cannot confirm the attempt',()=>{
 const task={date:base.date,hour:18,court:6,identity:'测试',commitAt:Date.parse('2026-11-20T22:00:00+08:00')};
 const row={court:6,start:'2026-11-22 18:00',end:'2026-11-22 19:00',applicant:'测试',created:'2026-11-20 22:00:01',status:'审核通过',id:'1'};
 assert.equal(matchOrder([row],task).id,'1');
 assert.equal(matchOrder([{...row,created:'2026-11-20 21:59:59'}],task),null);
 assert.equal(matchOrder([row,{...row,id:'2'}],task),null);
 assert.equal(matchOrder([{...row,status:'已退订'}],task),null);
});
async function worker(initialData={}){
 const model=await import('../extension/model.js');
 const data=initialData;
 let listener;
 const chrome={
  runtime:{onMessage:{addListener:f=>listener=f}},
  storage:{local:{get:async k=>({[k]:structuredClone(data[k])}),set:async v=>Object.assign(data,structuredClone(v))}},
  action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
  alarms:{create:async()=>{},clear:async()=>{},onAlarm:{addListener(){}}},
  tabs:{get:async id=>({id,windowId:1,url:'https://booking.cuhk.edu.cn/a/field/client/main'}),create:async()=>({id:99}),sendMessage:async(_id,m)=>m.type==='preflight'?{ok:true,identity:'测试'}:{},update:async()=>{},onRemoved:{addListener(){}}}
 };
 const context=vm.createContext({chrome,crypto:globalThis.crypto,URL,Date,...model});
 let source=await readFile(new URL('../extension/worker.js',import.meta.url),'utf8');
 source=source.replace(/^import[^\n]+\n/,'');
 vm.runInContext(source,context);
 const page={tab:{id:9},frameId:0,documentId:'doc1',url:'https://booking.cuhk.edu.cn/a/field/client/main'};
 const call=(m,s={})=>new Promise(r=>listener(m,s,r));
 const today=new Date(Date.now()+8*3600000+86400000).toISOString().slice(0,10);
 const arm=async(test=false)=>{const r=await call({type:'arm',tabId:9,config:{...base,date:today,hour:21,test}});assert.ok(r.ok,r.error);return r.value;};
 return {call,page,arm,data};
}
test('durable commit rejects duplicate click permits, even across worker requests',async()=>{
 const {call,page,arm}=await worker();const t=await arm();
 assert.ok((await call({type:'claim',id:t.id},page)).ok);
 const cmd={type:'commit',id:t.id,court:6,identity:'测试'};
 const both=await Promise.all([call(cmd,page),call(cmd,page)]);
 assert.equal(both.filter(x=>x.ok).length,1);
 assert.equal((await call({type:'claim',id:t.id},page)).ok,false);
 assert.equal((await call({type:'stop'})).ok,false);
});
test('test mode terminates at filled and rejects submit transitions',async()=>{
 const {call,page,arm}=await worker();const t=await arm(true);
 await call({type:'claim',id:t.id},page);
 const end=await call({type:'commit',id:t.id,court:6,identity:'测试'},page);
 assert.equal(end.value.status,'filled');assert.equal(end.value.commitAt,undefined);
 assert.equal((await call({type:'clicked',id:t.id},page)).ok,false);
});
test('wrong tab cannot claim and stopped tasks cannot commit',async()=>{
 const {call,page,arm}=await worker();const t=await arm();
 assert.equal((await call({type:'claim',id:t.id},{...page,tab:{id:10}})).ok,false);
 await call({type:'claim',id:t.id},page);await call({type:'stop'});
 assert.equal((await call({type:'commit',id:t.id,court:6,identity:'测试'},page)).ok,false);
});
test('worker restart retains commit marker and only permits order recovery',async()=>{
 const h=await worker();const t=await h.arm();await h.call({type:'claim',id:t.id},h.page);
 await h.call({type:'commit',id:t.id,court:6,identity:'测试'},h.page);
 const restarted=await worker(structuredClone(h.data));
 assert.equal((await restarted.call({type:'claim',id:t.id},restarted.page)).ok,false);
 assert.equal((await restarted.call({type:'commit',id:t.id,court:6,identity:'测试'},restarted.page)).ok,false);
 assert.equal((await restarted.call({type:'recover',id:t.id},restarted.page)).value.verifyTabId,99);
});
test('old document errors cannot override the new owner or terminal success',async()=>{
 const h=await worker();const t=await h.arm();await h.call({type:'claim',id:t.id},h.page);
 const newer={...h.page,documentId:'doc2'};await h.call({type:'claim',id:t.id},newer);
 await h.call({type:'error',id:t.id,error:'stale error'},h.page);assert.equal(h.data.task.status,'running');
 assert.equal((await h.call({type:'commit',id:t.id,court:6,identity:'测试'},h.page)).ok,false);
 await h.call({type:'commit',id:t.id,court:6,identity:'测试'},newer);
 h.data.task.status='confirmed';
 await h.call({type:'error',id:t.id,error:'late error'},newer);assert.equal(h.data.task.status,'confirmed');
});

test('post-submit rejection classifier accepts only unambiguous other-user occupation',()=>{
 for(const s of ['该场地已被他人预订','预约失败：所选时段已被其他用户占用，请选择其他场地。','该场地已被别人预订了！'])assert.equal(explicitCourtRejection(s),true,s);
 for(const s of ['该场地已被预订','该场地已被您预订','提交失败','提交超时','预约冲突','如果该场地已被他人预订，请重新选择场地','该场地已被他人预订？','预约成功，该场地已被他人预订','未能确认该场地已被他人预订','您已存在预约','没有查询到订单'])assert.equal(explicitCourtRejection(s),false,s);
});

async function committed(){
 const h=await worker();const t=await h.arm();await h.call({type:'claim',id:t.id},h.page);
 const r=await h.call({type:'commit',id:t.id,court:6,identity:'测试'},h.page);
 const evidence={source:'fresh-school-dialog',contextValid:true,message:'该场地已被他人预订，请重新选择场地',observedAt:Date.now(),court:6,date:t.date,hour:t.hour,identity:t.identity};
 return {...h,t:r.value,result:{type:'submission-result',id:t.id,attemptId:r.value.attemptId,evidence}};
}

test('only one acknowledgement can unlock a rejected attempt, stale results cannot unlock the next',async()=>{
 const h=await committed();
 const both=await Promise.all([h.call(h.result,h.page),h.call(h.result,h.page)]);
 assert.equal(both.filter(r=>r.ok).length,1);assert.equal(h.data.task.commitAt,undefined);
 assert.equal((await h.call({type:'commit',id:h.t.id,court:6,identity:'测试'},h.page)).ok,false);
 const next=await h.call({type:'commit',id:h.t.id,court:4,identity:'测试'},h.page);assert.ok(next.ok);
 assert.notEqual(next.value.attemptId,h.t.attemptId);
 assert.equal((await h.call(h.result,h.page)).ok,false);assert.equal(h.data.task.status,'committing');
 const restarted=await worker(structuredClone(h.data));
 assert.equal((await restarted.call(h.result,restarted.page)).ok,false);
 assert.ok(restarted.data.task.commitAt);
});

test('unknown, stale, wrong-context and generic conflict evidence retain the submit lock',async()=>{
 for(const patch of [{message:'提交失败'},{message:'该场地已被预订'},{source:'exception'},{contextValid:false},{court:4},{date:'2000-01-01'},{identity:'其他人'},{observedAt:0},{observedAt:Date.now()+100000}]){
  const h=await committed();const r=await h.call({...h.result,evidence:{...h.result.evidence,...patch}},h.page);
  assert.equal(r.value.status,'verifying');assert.ok(h.data.task.commitAt);
 }
});

test('late or wrong-owner rejection cannot override verification or confirmed orders',async()=>{
 const h=await committed();
 assert.equal((await h.call(h.result,{...h.page,documentId:'stale'})).ok,false);
 await h.call({type:'clicked',id:h.t.id},h.page);
 assert.equal((await h.call(h.result,h.page)).ok,false);
 h.data.task.status='confirmed';assert.equal((await h.call(h.result,h.page)).ok,false);
 assert.equal(h.data.task.status,'confirmed');assert.ok(h.data.task.commitAt);
});

test('upgrade stops legacy active tasks and preserves ambiguous submission locks',async()=>{
 for(const status of ['armed','running','committing','verifying','uncertain']){
  const submitted=['committing','verifying','uncertain'].includes(status);
  const h=await worker({task:{schema:1,id:'legacy',status,tabId:9,owner:'doc1',events:[],...(submitted?{commitAt:Date.now(),attemptId:'old'}:{})}});
  const r=await h.call({type:'get'});
  assert.equal(r.value.task.schema,2);
  assert.equal(r.value.task.status,submitted?'uncertain':'error');
  assert.equal((await h.call({type:'commit',id:'legacy',court:6,identity:'测试'},h.page)).ok,false);
  assert.equal(Boolean(h.data.task.commitAt),submitted);
 }
});

test('missing or non-boolean mode cannot accidentally enable a real submission',async()=>{
 for(const mode of [undefined,null,'false',0])assert.throws(()=>config({...base,test:mode},0),/执行方式/);
 assert.throws(()=>config({...base,unknown:'x'},0),/不兼容/);
 const h=await worker();const t=await h.arm(true);await h.call({type:'claim',id:t.id},h.page);
 delete h.data.task.test;
 assert.equal((await h.call({type:'commit',id:t.id,court:6,identity:'测试'},h.page)).ok,false);
 assert.equal(h.data.task.commitAt,undefined);
});

test('diagnostic export excludes form values and arbitrary reservation text',()=>{
 const e=label=>({tagName:'TD',id:'cell',className:'slot',value:'PRIVATE_INPUT_VALUE',innerText:label,
  getAttribute:()=>null,getBoundingClientRect:()=>({x:0,y:0,width:1,height:1})});
 const elements=[e('18:00'),e('综合运动馆-羽毛球场06'),e('PRIVATE_NAME 羽毛球场06'),e('PRIVATE_EMAIL'),e('PRIVATE_PHONE')];
 const document={getElementById:id=>id==='calendar'?{querySelectorAll:()=>elements}:null,
  querySelector:()=>null,querySelectorAll:()=>[]};
 const context=vm.createContext({document,location:{pathname:'/a/field/client/main'}});
 vm.runInContext(siteSource,context);
 const data=context.CourtSite.diagnostic(),text=JSON.stringify(data);
 assert.ok(text.includes('18:00'));assert.ok(text.includes('综合运动馆-羽毛球场06'));
 assert.equal(text.includes('PRIVATE_'),false);
});
