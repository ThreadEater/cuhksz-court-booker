import {ACTIVE,config,matchOrder,explicitCourtRejection} from './model.js';
let queue=Promise.resolve();
const read=async()=> {
  const t=(await chrome.storage.local.get('task')).task||null;
  if(t&&t.schema!==2){
    t.schema=2;
    if(ACTIVE.includes(t.status)){
      t.status=t.commitAt?'uncertain':'error';
      await save(t,'版本已更新，请先核对原任务，再重新安排预约');
    }else await chrome.storage.local.set({task:t});
  }
  return t;
};
async function save(task,message) {
  task.revision=(task.revision||0)+1;
  if(message)task.events=[...(task.events||[]),{at:Date.now(),message}].slice(-100);
  await chrome.storage.local.set({task});
  await chrome.action.setBadgeText({text:({armed:'等待',running:'执行',committing:'查单',verifying:'查单',confirmed:'成功',filled:'填好',uncertain:'待查',error:'异常'})[task.status]||''});
  await chrome.action.setBadgeBackgroundColor({color:task.status==='error'?'#a84646':'#61326b'});
  if(task.tabId)chrome.tabs.sendMessage(task.tabId,{type:'changed',task}).catch(()=>{});
  if(task.verifyTabId)chrome.tabs.sendMessage(task.verifyTabId,{type:'changed',task}).catch(()=>{});
  return task;
}
function belongs(t,s,verification=false) {
  if(!t||!(s.tab?.id===t.tabId||(verification&&s.tab?.id===t.verifyTabId))||s.frameId!==0||!s.url?.startsWith('https://booking.cuhk.edu.cn/a/'))throw Error('任务页面已变化');
}
async function verifier(t,refresh=false){
  if(t.verifyTabId){
    try{await chrome.tabs.get(t.verifyTabId);
      if(refresh)await chrome.tabs.update(t.verifyTabId,{url:'https://booking.cuhk.edu.cn/a/system/myReservations'});
      else chrome.tabs.sendMessage(t.verifyTabId,{type:'wake'}).catch(()=>{});
      return t;
    }catch{t.verifyTabId=null;}
  }
  const source=await chrome.tabs.get(t.tabId);
  const tab=await chrome.tabs.create({windowId:source.windowId,active:false,url:'https://booking.cuhk.edu.cn/a/system/myReservations'});
  t.verifyTabId=tab.id;
  return save(t,'后台查单已打开，保留原提交页面');
}
async function handle(m,s) {
  let t=await read();
  if(m.type==='network'){
    if(s.frameId!==0||!s.url?.startsWith('https://booking.cuhk.edu.cn/a/'))throw Error('页面不匹配');
    const result=await chrome.scripting.executeScript({target:{tabId:s.tab.id},world:'MAIN',func:()=>{
      if(!window.jQuery)throw Error('页面加载状态接口不可用');
      if(!window.__courtReadinessV3){
        const data={started:0,finished:0,pending:0,failures:0,authFailures:0,retryAt:0,lastCycleMs:0};
        let cycleStart=0;
        const publish=()=>document.documentElement.setAttribute('data-court-network',JSON.stringify(data));
        const tracked=new WeakSet();
        window.jQuery(document).on('ajaxSend.courtReadiness',(_e,xhr,settings)=>{
          const u=new URL(settings.url,location.href);
          if(u.origin!==location.origin||!u.pathname.startsWith('/a/field/'))return;
          if(data.pending===0)cycleStart=performance.now();
          tracked.add(xhr);data.started++;data.pending++;publish();
        }).on('ajaxComplete.courtReadiness',(_e,xhr)=>{
          if(!tracked.has(xhr))return;
          tracked.delete(xhr);data.pending--;data.finished++;
          if(xhr.status<200||xhr.status>=400)data.failures++;
          if(xhr.status===401||xhr.status===403)data.authFailures++;
          if(xhr.status===429||xhr.status===503){
            const raw=xhr.getResponseHeader('Retry-After');
            const until=raw&&/^\d+$/.test(raw)?Date.now()+Number(raw)*1000:Date.parse(raw||'');
            data.retryAt=Math.max(data.retryAt,Number.isFinite(until)?until:Date.now()+1500);
          }
          if(data.pending===0)data.lastCycleMs=Math.round(performance.now()-cycleStart);
          publish();
        });
        window.__courtReadinessV3=data;publish();
      }
      return {...window.__courtReadinessV3};
    }});
    return result[0].result;
  }
  if(m.type==='get')return {task:t,defaults:(await chrome.storage.local.get('defaults')).defaults};
  if(m.type==='arm'){
    if(ACTIVE.includes(t?.status))throw Error('已有任务待执行或订单待核验，请先停止或处理');
    const cfg=config(m.config);
    const tab=await chrome.tabs.get(m.tabId);
    if(new URL(tab.url).pathname!=='/a/field/client/main')throw Error('请先打开羽毛球日历页');
    const probe=await chrome.tabs.sendMessage(tab.id,{type:'preflight'});
    if(!probe?.ok)throw Error(probe?.error||'日历页尚未就绪');
    if(!probe.identity)throw Error('页面未识别到登录姓名，请先检查页面');
    t={...cfg,schema:2,id:crypto.randomUUID(),tabId:tab.id,identity:probe.identity,status:'armed',events:[],deadline:cfg.fireAt+120000};
    await chrome.storage.local.set({defaults:{phone:cfg.phone,theme:cfg.theme,purpose:cfg.purpose,participants:cfg.participants}});
    await save(t,cfg.test?'已开启只填表测试':'已授权本时段一个场地的自动提交');
    if(cfg.rehearsalSeconds)await save(t,'10 秒倒计时演练；计划触发 '+new Date(t.fireAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,fractionalSecondDigits:3})+'；强制只填表');
    await chrome.alarms.create('court-start',{when:t.fireAt});
    await chrome.alarms.create('court-expire',{when:t.deadline});
    chrome.tabs.sendMessage(tab.id,{type:'wake'}).catch(()=>{});
    return t;
  }
  if(m.type==='stop'){
    if(!t)return null;
    if(['committing','verifying','uncertain'].includes(t.status))throw Error('已进入提交阶段，请先查看学校订单；此时停止无法撤回提交');
    t.status='stopped';await chrome.alarms.clear('court-start');
    return save(t,'任务已停止');
  }
  if(m.type==='review'){
    if(!t||!['committing','verifying','uncertain'].includes(t.status))throw Error('没有待核验提交');
    t.status='verifying';t.checks=0;
    await save(t,'重新核验本次提交');
    return verifier(t,true);
  }
  if(m.type==='acknowledge'){
    if(t?.status!=='uncertain')throw Error('当前没有待人工处理的结果');
    t.status='reviewed';return save(t,'用户已查看学校订单并结束本次任务');
  }
  belongs(t,s,['bound','orders','verify-error'].includes(m.type));
  if(m.id!==t.id)throw Error('任务已经变化');
  if(m.type==='bound')return {verification:s.tab.id===t.verifyTabId};
  if(m.type==='prepare'){
    if(t.commitAt||!['armed','running'].includes(t.status))throw Error('任务已停止或已提交');
    t.owner=s.documentId;return save(t,'正在提前检查日历并切换目标日期');
  }
  if(m.type==='prepared'){
    if(t.owner!==s.documentId||t.commitAt||!['armed','running'].includes(t.status))throw Error('准备任务已变化');
    t.preparedAt=Date.now();t.preparedDate=m.date;
    return save(t,'准备完成：身份、目标日期、时间列与刷新监测已就绪');
  }
  if(m.type==='claim'){
    if(Date.now()<t.fireAt)throw Error('尚未到执行时间');
    if(Date.now()>t.deadline)throw Error('任务执行窗口已结束');
    if(t.status==='running'&&t.owner===s.documentId)return t;
    if(t.commitAt||(t.status!=='armed'&&t.status!=='running'))throw Error('任务已结束或已提交');
    t.status='running';t.owner=s.documentId;
    t.startedAt=Date.now();
    return save(t,'开始刷新目标日期（触发延迟 '+Math.max(0,t.startedAt-t.fireAt)+'ms）');
  }
  if(m.type==='commit'){
    if(t.commitAt||t.status!=='running'||t.owner!==s.documentId||Date.now()>t.deadline)throw Error('任务已停止或已结束');
    if(m.identity!==t.identity||!Number.isInteger(m.court)||m.court<1||m.court>14)throw Error('表单身份或场地不匹配');
    if((t.rejectedCourts||[]).includes(m.court))throw Error('本次任务已确认该场地被他人占用');
    t.court=m.court;
    t.timings=Object.fromEntries(Object.entries(m.timings||{}).filter(([k,v])=>['triggerMs','refreshMs','networkMs','openMs','formResponseMs','fillMs','readyMs','fromFireMs','attempts','switches'].includes(k)&&Number.isFinite(v)&&v>=0));
    if(typeof t.test!=='boolean')throw Error('任务执行方式无效，请停止并重新安排');
    if(t.test){t.status='filled';return save(t,'必填项已填写并回读，停在提交前');}
    t.status='committing';t.commitAt=Date.now();t.attemptId=crypto.randomUUID();
    await save(t,'已保存提交标记，准备点击一次提交预订');
    await chrome.alarms.create('court-verify',{when:Date.now()+15000});
    return t;
  }
  if(m.type==='submission-result'){
    // Compare-and-set for exactly this click. Old responses, new documents,
    // verifier results and worker recovery can never unlock another attempt.
    if(t.status!=='committing'||t.owner!==s.documentId||!t.attemptId||m.attemptId!==t.attemptId||t.test)throw Error('提交结果不属于当前尝试');
    const e=m.evidence;
    const rejected=e?.source==='fresh-school-dialog'&&e.contextValid===true&&
      e.court===t.court&&e.date===t.date&&e.hour===t.hour&&e.identity===t.identity&&
      Number.isFinite(e.observedAt)&&e.observedAt>=t.commitAt&&e.observedAt<=Date.now()&&
      Date.now()-t.commitAt<=10000&&!t.verifyTabId&&explicitCourtRejection(e.message);
    if(rejected){
      t.rejections=[...(t.rejections||[]),{attemptId:t.attemptId,court:t.court,commitAt:t.commitAt,at:e.observedAt,message:e.message}];
      t.rejectedCourts=[...new Set([...(t.rejectedCourts||[]),t.court])];
      delete t.commitAt;delete t.attemptId;
      t.status=Date.now()<t.deadline?'running':'error';
      await chrome.alarms.clear('court-verify');
      return save(t,t.court+' 号场提交被明确拒绝：'+e.message+(t.status==='running'?'；已记录拒绝，尝试下一场地':'；尝试窗口已结束'));
    }
    t.status='verifying';t.checks=0;
    await save(t,'提交结果未明确证明被拒绝，保留提交锁并核验订单');
    return verifier(t);
  }
  if(m.type==='clicked'){
    if(t.status!=='committing'||t.owner!==s.documentId)throw Error('提交状态已变化');
    t.status='verifying';t.checks=0;
    await save(t,'已点击提交，开始核验订单');
    return verifier(t);
  }
  if(m.type==='recover'){
    if(!t.commitAt||!['committing','verifying','uncertain'].includes(t.status))return t;
    t.status='verifying';await save(t,'提交阶段恢复：只查单，不再次提交');return verifier(t);
  }
  if(m.type==='orders'){
    if(!['committing','verifying','uncertain'].includes(t.status))throw Error('当前无需核验');
    const matched=matchOrder(m.rows,t);
    if(matched){t.status='confirmed';t.orderId=matched.id;return save(t,matched.status==='审核通过'?'学校订单已审核通过':'学校订单已生成，等待审核');}
    t.checks=(t.checks||0)+1;
    if(t.checks>=5){t.status='uncertain';return save(t,'学校订单暂未唯一匹配，请人工检查，任务已停止自动提交');}
    t.status='verifying';return save(t,'订单尚未匹配，继续查询');
  }
  if(m.type==='verify-error'){
    if(!t.commitAt||!['committing','verifying','uncertain'].includes(t.status))return t;
    t.status='uncertain';return save(t,'查单失败：'+String(m.error).slice(0,160)+'；不会再次提交');
  }
  if(m.type==='error'){
    if(['confirmed','filled','stopped','reviewed'].includes(t.status)||t.owner!==s.documentId)return t;
    t.status=t.commitAt?'uncertain':'error';
    return save(t,String(m.error||'页面操作失败').slice(0,200));
  }
  if(m.type==='note'){
    if(t.owner!==s.documentId||!['armed','running'].includes(t.status))return t;
    return save(t,String(m.message).slice(0,200));
  }
  throw Error('未知操作');
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  const operation=queue.then(()=>handle(m,s));
  queue=operation.catch(()=>{});
  operation.then(value=>reply({ok:true,value}),error=>reply({ok:false,error:error.message}));
  return true;
});
// Recover scheduling after service-worker suspension without overwriting task state.
queue=queue.then(async()=>{
 const t=await read();if(!t)return;
 if(['armed','running'].includes(t.status)){
  await chrome.alarms.create('court-start',{when:Math.max(Date.now()+100,t.fireAt)});
  await chrome.alarms.create('court-expire',{when:Math.max(Date.now()+200,t.deadline)});
 }else if(['committing','verifying'].includes(t.status)){
  await chrome.alarms.create('court-verify',{when:Date.now()+1000});
 }
}).catch(()=>{});
chrome.alarms.onAlarm.addListener(alarm=>{
  queue=queue.then(async()=>{
    const t=await read();if(!t)return;
    if(alarm.name==='court-expire'&&['armed','running'].includes(t.status)){
      t.status='error';await save(t,'尝试窗口结束，未进入提交阶段');
    }else if(alarm.name==='court-verify'&&['committing','verifying'].includes(t.status)){
      // A reload after the durable commit marker must only inspect orders.
      await verifier(t).catch(()=>{});
    }else if(alarm.name==='court-start'){
      chrome.tabs.sendMessage(t.tabId,{type:'wake'}).catch(()=>{});
    }
  }).catch(()=>{});
});
chrome.tabs.onRemoved.addListener(tabId=>{
  queue=queue.then(async()=>{const t=await read();if(t&&[t.tabId,t.verifyTabId].includes(tabId)&&ACTIVE.includes(t.status)){
    if(tabId===t.verifyTabId)t.verifyTabId=null;
    t.status=t.commitAt?'uncertain':'error';
    await save(t,'任务或查单标签页已关闭');
  }}).catch(()=>{});
});
