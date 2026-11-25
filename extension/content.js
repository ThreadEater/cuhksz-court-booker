(() => {
if(globalThis.courtExtensionLoaded)return;
globalThis.courtExtensionLoaded=true;
const site=CourtSite,priority=[6,4,5,7,11,12,13,14,3,8,9,10,1,2];
let task=null,busy=false,timer=null,preparedId=null,verification=false,warmedId=null,lastDisplay=0;
const badge=document.createElement('div');
badge.id='court-extension-status';
Object.assign(badge.style,{position:'fixed',bottom:'12px',right:'12px',padding:'10px 14px',background:'#61326b',color:'white',font:'13px Segoe UI,sans-serif',borderRadius:'8px',zIndex:'2147483600',pointerEvents:'none',maxWidth:'440px'});
document.documentElement.append(badge);
async function send(type,extra={},id=task?.id){
 const r=await chrome.runtime.sendMessage({type,id,...extra});
 if(!r?.ok)throw Error(r?.error||'插件后台未响应');
 return r.value;
}
function accept(t){
 if(t?.id===task?.id&&(t?.revision||0)<(task?.revision||0))return;
 task=t;
}
function display(force=false){
 if(!force&&Date.now()-lastDisplay<100)return;
 lastDisplay=Date.now();
 if(!task){badge.hidden=true;return;}badge.hidden=false;
 const titles={armed:preparedId===task.id?(task.preparedDate===task.date?'已准备 · 等待放号':'监测已准备 · 放号后切日期'):'正在提前准备',running:'正在选场填表',committing:'正在提交',verifying:'正在查单',confirmed:'预约已核实',filled:'表单已填好 · 未提交',uncertain:'结果待核验',error:'任务异常',stopped:'任务已停止',reviewed:'已结束'};
 badge.textContent=(titles[task.status]||task.status)+' · '+task.date+' '+String(task.hour).padStart(2,'0')+':00'+
  (task.status==='armed'?' · '+Math.max(0,(task.fireAt-Date.now())/1000).toFixed(1)+' 秒':'');
}
function check(id,armed=false,identity=true){
 if(task?.id!==id||!(armed?['armed','running']:['running']).includes(task.status))throw Error('任务已停止或已变化');
 if(Date.now()>task.deadline)throw Error('尝试窗口结束');
 if(identity&&site.identity()!==task.identity)throw Error('登录账号已变化');
}
async function idle(id,armed=false){
 const end=Date.now()+6500;
 while(site.network().pending){
  check(id,armed,false);
  if(Date.now()>=end)throw Object.assign(Error('上一轮日历请求仍未完成'),{retry:true});
  await site.sleep(25);
 }
 while((site.network().retryAt||0)>Date.now()){
  check(id,armed,false);await site.sleep(Math.min(250,site.network().retryAt-Date.now()));
 }
}
async function prepare(id){
 accept(await send('prepare',{},id));
 check(id,true);site.preflight();
 if(site.formDoc())throw Error('请先关闭上次预约表单，再开始任务');
 await send('network',{},id);
 let retries=0;
 while(true){
  try{
   await site.dateTo(task.date,()=>check(id,true));
   await idle(id,true);check(id,true);site.calendarReady(task.date,task.hour);
   accept(await send('prepared',{date:task.date},id));break;
  }catch(e){
   check(id,true);
   if(!e.retry)throw e;
   if(e.code==='release-pending'||Date.now()<task.fireAt){
    await site.dismissForm(e);
    await send('note',{message:'刷新监测已准备；日期切换将在放号后重试：'+e.message},id);break;
   }
   if(++retries>=3)throw e;
   await site.sleep(200*retries);
  }
 }
 preparedId=id;
}
async function readyRefresh(id){
 await idle(id);check(id);
 const before=site.network();site.refresh();
 return waitRefresh(id,before);
}
async function waitRefresh(id,before){
 let n;
 try{n=await site.wait(()=>{
  check(id,false,false);const state=site.network();
  return state.started>before.started&&state.finished>=state.started&&state.pending===0?state:null;
 },6500,'学校日历刷新');}catch(e){
  if(e.message.startsWith('等待学校日历刷新超时'))throw Object.assign(e,{retry:true});throw e;
 }
 if((n.authFailures||0)>(before.authFailures||0))throw Error('学校拒绝访问或登录已失效，请检查权限');
 if(n.failures>before.failures)throw Object.assign(Error('学校刷新请求失败'),{retry:true});
 // Keep the layout barrier: server response alone does not mean FullCalendar has rendered it.
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 check(id);site.calendarReady(task.date,task.hour);
}
async function run(id){
 const began=performance.now(),timings={triggerMs:Math.max(0,Date.now()-task.fireAt),attempts:0,switches:0};
 accept(await send('claim',{},id));
 let consecutive=0,lastWaitNote=0;
 const cooldown=new Map();
 while(Date.now()<task.deadline){
  check(id);timings.attempts++;
  try{
   await idle(id);
   const r=performance.now(),before=site.network();
   const switched=await site.dateTo(task.date,()=>check(id));
   // Date navigation already requests fresh availability. Do not fetch it a second time.
   if(switched)await waitRefresh(id,before);else await readyRefresh(id);
   timings.refreshMs=Math.round(performance.now()-r);
   timings.networkMs=site.network().lastCycleMs;
   const candidates=site.points(task.hour).filter(p=>p.free&&!(task.rejectedCourts||[]).includes(p.court)&&(cooldown.get(p.court)||0)<=Date.now()).sort((a,b)=>priority.indexOf(a.court)-priority.indexOf(b.court));
   if(!candidates.length){consecutive=0;
    if(Date.now()-lastWaitNote>5000){await send('note',{message:'目标时段暂未出现可用场地，继续等待放号或空场'},id);lastWaitNote=Date.now();}
    await site.sleep((Date.now()-task.fireAt<10000?250:650)+Math.random()*100);continue;
   }
   for(const p of candidates){
    let permitRequested=false;
    try{
     check(id);const o=performance.now();
     const doc=await site.open({...p,hour:task.hour},()=>check(id));timings.openMs=Math.round(performance.now()-o);
     const response=site.formResponseMs(doc);if(response!==null)timings.formResponseMs=response;
     check(id);const f=performance.now();site.fill(doc,task,p.court);
     const submit=site.submitButton();
     check(id);site.validate(doc,task,p.court,true);
     if(!site.points(task.hour).find(s=>s.court===p.court)?.free)throw Object.assign(Error('填写期间场次已被占用'),{retry:true,code:'court-gone'});
     timings.fillMs=Math.round(performance.now()-f);timings.readyMs=Math.round(performance.now()-began);
     timings.fromFireMs=Math.max(0,Date.now()-task.fireAt);
     permitRequested=true;
     accept(await send('commit',{court:p.court,identity:task.identity,timings},id));
     display(true);if(task.test)return;
     const attemptId=task.attemptId;
     const outcome=await site.submitAndObserve(doc,task,p.court,submit);
     accept(await send('submission-result',{attemptId,evidence:outcome.evidence},id));
     if(task.status==='running'&&!task.commitAt){
      // Only the worker can unlock a documented rejection. Keep every other
      // exception after a permit on the order-recovery path.
      cooldown.set(p.court,Infinity);timings.switches++;
      await site.dismissForm(outcome);check(id);
      continue;
     }
     return;
    }catch(e){
     if(permitRequested){e.retry=false;throw e;}
     if(e.code==='court-gone'){
      cooldown.set(p.court,Date.now()+5000);timings.switches++;
      await site.dismissForm(e);check(id);
      await send('note',{message:p.court+' 号场在提交前被占用，立即尝试下一优先级场地'},id);continue;
     }
     if(e.code==='form-timeout'){cooldown.set(p.court,Date.now()+2500);timings.switches++;}
     throw e;
    }
   }
   await site.sleep(150+Math.random()*100);
  }catch(e){
   if(task?.id!==id||!e.retry||task.status!=='running')throw e;
   await site.dismissForm(e);
   if(e.code==='release-pending'){
    if(Date.now()-lastWaitNote>2000){await send('note',{message:'日期或预订入口尚未开放，继续等待：'+e.message},id);lastWaitNote=Date.now();}
    await site.sleep((Date.now()-task.fireAt<10000?250:750)+Math.random()*100);continue;
   }
   if(++consecutive>=4)throw e;
   await send('note',{message:e.message+'；提交前第 '+consecutive+' 次重试'},id);
   await site.sleep(Math.min(1500,200*2**(consecutive-1))+Math.random()*100);
  }
 }
 throw Error('所选时段在尝试窗口内没有可用场地');
}
async function verify(id){
 const rows=await site.wait(site.orders,10000,'学校订单列表');
 await site.sleep(1000);
 accept(await send('orders',{rows:site.orders()||rows},id));
 if(task?.id===id&&task.status==='verifying'){await site.sleep(2000);location.reload();}
}
async function tick(){
 clearTimeout(timer);display();
 if(busy||!task)return;
 const id=task.id;
 if(!['armed','running','committing','verifying'].includes(task.status))return;
 busy=true;
 try{
  if(['committing','verifying'].includes(task.status)){
   if(verification)await verify(id);
   else if(!task.verifyTabId)accept(await send('recover',{},id));
   return;
  }
  if(verification)return;
  if(preparedId!==id)await prepare(id);
  check(id,true);
  if(task.status==='armed'&&Date.now()<task.fireAt){
   if(task.fireAt-Date.now()<5000&&warmedId!==id){await send('bound',{},id);warmedId=id;}
   timer=setTimeout(tick,Math.max(5,Math.min(task.fireAt-Date.now()<1000?10:1000,task.fireAt-Date.now())));return;
  }
  await run(id);
 }catch(e){
  try{
   const result=await send(verification?'verify-error':'error',{error:e.message},id);
   if(task?.id===id){accept(result);
    if(!verification&&task?.commitAt&&task.status==='uncertain')accept(await send('recover',{},id));
   }
  }catch{}
 }finally{
  busy=false;display();
  if(task?.id!==id)timer=setTimeout(tick,0);
 }
}
async function wake(){
 const result=await send('get');accept(result.task||null);
 if(task){
  try{const owner=await send('bound');verification=owner.verification;}
  catch{task=null;display(true);return;}
 }
 tick();
}
chrome.runtime.onMessage.addListener((m,_s,reply)=>{
 if(m.type==='preflight'){
  try{const result=site.preflight();reply({ok:true,...result});}catch(e){reply({ok:false,error:e.message});}return;
 }
 if(m.type==='diagnostic'){reply(site.diagnostic());return;}
 if(m.type==='changed'){accept(m.task);display(true);if(!busy)tick();reply({ok:true});return;}
 if(m.type==='wake'){wake();reply({ok:true});return;}
 if(m.type==='ping'){reply({ok:true});}
});
wake().catch(()=>{});
})();
