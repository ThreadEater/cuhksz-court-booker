import {dayAtBeijing,releaseAt,ACTIVE} from './model.js';
const $=id=>document.getElementById(id);
let current=null;
const clock=n=>new Date(n).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,fractionalSecondDigits:3});
async function message(type,extra={}){
 const r=await chrome.runtime.sendMessage({type,...extra});if(!r.ok)throw Error(r.error);return r.value;
}
async function page(){
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 if(!tab?.url?.startsWith('https://booking.cuhk.edu.cn/a/'))throw Error('请先打开学校羽毛球日历页');
 try{await chrome.tabs.sendMessage(tab.id,{type:'ping'});}
 catch{await chrome.scripting.executeScript({target:{tabId:tab.id},files:['site.js','content.js']});}
 return tab;
}
function release(){
 try{$('release').textContent='放号时间（北京时间） '+clock(releaseAt($('date').value));}catch{$('release').textContent='请选择日期';}
 $('start').textContent=$('test').checked?'开始填表测试':'确认自动提交一个场地';
 try{const immediate=releaseAt($('date').value)<=Date.now();$('when').textContent=(immediate?'已过放号时间：点击后立即执行。':'按上方北京时间执行。')+($('test').checked?'仅填写并校验表单，不提交。':'将自动提交一个场地，占用学校预约配额。');}catch{$('when').textContent='';}
}
function show(t){
 current=t;
 const labels={armed:'已安排，等待放号',running:'正在执行',committing:'提交阶段',verifying:'核验订单',confirmed:'预约已核实',filled:'已填表 · 未提交',uncertain:'结果待人工核验',error:'任务异常',stopped:'已停止',reviewed:'已结束'};
 $('status').textContent=t?(labels[t.status]||t.status)+' · '+t.date+' '+t.hour+':00–'+(t.hour+1)+':00'+(t.court?' · '+t.court+' 号场':'')+(t.orderId?' · 单号 '+t.orderId:''):'先打开已登录的羽毛球日历页';
 $('events').textContent=t?.events?.map(e=>clock(e.at)+' '+e.message).join('\n')||'';
 if(t?.timings){const m=t.timings;$('events').textContent+='\n耗时：触发延迟 '+m.triggerMs+'ms；刷新 '+m.refreshMs+'ms；打开表单 '+m.openMs+'ms；填写校验 '+m.fillMs+'ms；执行到填好 '+m.readyMs+'ms；到点至填好 '+(m.fromFireMs??'未记录')+'ms；尝试 '+m.attempts+' 轮';}
 if(t?.timings){const m=t.timings;$('events').textContent+='\n其中：刷新请求周期 '+(m.networkMs??'未记录')+'ms；表单响应 '+(m.formResponseMs??'未记录')+'ms；切换场地 '+(m.switches||0)+' 次';}
 const active=ACTIVE.includes(t?.status);
 for(const key of ['date','hour','phone','theme','participants','purpose']){$(key).disabled=active;if(active)$(key).value=t[key];}
 $('test').disabled=active;if(active)$('test').checked=t.test===true;release();
 $('start').disabled=active;
 $('rehearse').disabled=ACTIVE.includes(t?.status);
 $('stop').disabled=!['armed','running'].includes(t?.status);
 $('review').disabled=!['committing','verifying','uncertain'].includes(t?.status);
 $('ack').hidden=t?.status!=='uncertain';
}
async function action(fn){try{await fn();}catch(e){$('status').textContent=e.message;}}
$('hour').innerHTML=Array.from({length:15},(_,i)=>'<option value="'+(i+7)+'">'+(i+7)+':00–'+(i+8)+':00</option>').join('');
$('hour').value='18';$('date').value=dayAtBeijing(Date.now()+2*86400000);release();
$('date').onchange=release;$('test').onchange=release;
$('form').onsubmit=e=>{e.preventDefault();action(async()=>{
 const tab=await page();
 const cfg=Object.fromEntries(['date','hour','phone','theme','participants','purpose'].map(k=>[k,$(k).value]));cfg.test=$('test').checked;
 show(await message('arm',{tabId:tab.id,config:cfg}));
});};
$('rehearse').onclick=()=>action(async()=>{
 const tab=await page();
 const cfg=Object.fromEntries(['date','hour','phone','theme','participants','purpose'].map(k=>[k,$(k).value]));
 cfg.test=true;cfg.rehearsalSeconds=10;$('test').checked=true;release();
 show(await message('arm',{tabId:tab.id,config:cfg}));
});
$('stop').onclick=()=>action(async()=>show(await message('stop')));
$('review').onclick=()=>action(async()=>show(await message('review')));
$('ack').onclick=()=>action(async()=>show(await message('acknowledge')));
$('diagnostic').onclick=()=>action(async()=>{
 const tab=await page();const data=await chrome.tabs.sendMessage(tab.id,{type:'diagnostic'});
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='court-page-structure.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
 $('status').textContent='页面结构已导出';
});
const initial=await message('get');if(initial.defaults)for(const [k,v] of Object.entries(initial.defaults))if($(k))$(k).value=v;
show(initial.task);
chrome.storage.onChanged.addListener(changes=>{if(changes.task)show(changes.task.newValue);});
