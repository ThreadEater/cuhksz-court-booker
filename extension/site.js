/* Page controls only. No login cookies or direct booking requests. */
(() => {
if(globalThis.CourtSite)return;
const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
const text=e=>(e?.innerText||e?.textContent||'').trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function wait(fn,ms=8000,label='页面加载'){
 // React to DOM/load events immediately. Polling also covers property-only value changes.
 return new Promise((resolve,reject)=>{
  let done=false,timer,poll,observer;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(poll);observer?.disconnect();document.removeEventListener('load',probe,true);error?reject(error):resolve(value);};
  const probe=()=>{if(done)return;try{const v=fn();if(v)finish(null,v);}catch(e){finish(e);}};
  observer=new MutationObserver(probe);observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true});
  document.addEventListener('load',probe,true);
  timer=setTimeout(()=>finish(Error('等待'+label+'超时')),ms);poll=setInterval(probe,25);probe();
 });
}
function classifyFeedback(message){
 const s=String(message).replace(/\s+/g,'');
 if(/(配额|额度|次数|时长).{0,12}(不足|用完|上限|超)|无.{0,4}权限|没有.{0,4}权限|登录|验证码/.test(s))return 'fatal';
 if(/(尚未|暂未|还未|未到).{0,12}(开放|开始|放号|预[订约])|不在.{0,8}(预[订约]|开放).{0,6}时间|只能.{0,8}提前/.test(s))return 'release-pending';
 if(/(场地|场次|时段).{0,16}(已被.{0,6}(预[订约]|占用)|已.{0,3}(占用|预订)|冲突|不可预订)|预[订约].{0,6}(冲突|已满)/.test(s))return 'court-gone';
 return null;
}
function notices(){return [...document.querySelectorAll('.layui-layer-dialog .layui-layer-content,.layui-layer-msg .layui-layer-content,[role="alert"]')].filter(visible);}
function noticeSnapshot(){return new Map(notices().map(e=>[e,text(e)]));}
function checkFeedback(before){
 for(const node of notices()){
  const message=text(node);if(before.get(node)===message)continue;
  const code=classifyFeedback(message);if(!code)continue;
  throw Object.assign(Error('学校提示：'+message.slice(0,180)),{code,retry:code!=='fatal',notice:node});
 }
}
function byText(doc,selector,name){return [...doc.querySelectorAll(selector)].filter(visible).find(e=>text(e)===name);}
function unique(list,label){if(list.length!==1)throw Error(label+'定位不唯一');return list[0];}
function identity(){
 const header=document.querySelector('#kt_header,.kt-header,.navbar,header,.header');
 if(!header)return '';
 // Confirmed through the installed extension diagnostic before live use.
 const candidates=[...header.querySelectorAll('a,span')].filter(e=>visible(e)&&e.children.length===0);
 const user=candidates.find(e=>e.previousElementSibling?.matches('.icon-user,.fa-user,.fa-user-circle,[class*="user"]'));
 return text(user);
}
function preflight(){
 if(location.pathname!=='/a/field/client/main'||!document.getElementById('selectDate')||!document.getElementById('calendar'))
   throw Error('请先进入羽毛球场日历页');
 if(!document.body.innerText.includes('羽毛球场'))throw Error('当前页面未显示羽毛球场');
 return {identity:identity(),date:document.getElementById('selectDate').value};
}
function geometry(){
 const root=document.getElementById('calendar');
 const resource=root.querySelector('.fc-datagrid-body');
 const timeArea=root;
 if(!resource||!timeArea)throw Error('日历布局需要校准，请导出页面结构');
 const rows=[];
 for(const tr of resource.querySelectorAll('tbody tr')){
   const m=text(tr).match(/羽毛球场\s*0?(\d+)\s*$/);
   if(m&&visible(tr))rows.push({court:Number(m[1]),element:tr});
 }
 if(new Set(rows.map(r=>r.court)).size!==14)throw Error('请把区域和场地筛选设为全部，确保显示 14 个场地');
 const columns=[...timeArea.querySelectorAll('[data-date]')].filter(e=>visible(e)&&/^\d{4}-\d\d-\d\dT\d\d:00:00/.test(e.getAttribute('data-date')||''));
 if(!columns.length)throw Error('无法识别整点时间列');
 return {root,timeArea,rows,columns};
}
function points(hour){
 const g=geometry();
 const cols=g.columns.filter(e=>Number(e.getAttribute('data-date').slice(11,13))===hour);
 const col=cols.sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0];
 if(!col)throw Error('日历未显示目标时间列');
 const cr=col.getBoundingClientRect();
 if(cr.width<=5)throw Error('时间列未完成布局');
 const blocked=[...g.timeArea.querySelectorAll('.fc-event,.fc-bg-event,.fc-bgevent,.fc-nonbusiness')].filter(visible).map(e=>e.getBoundingClientRect());
 return g.rows.map(({court,element})=>{
   const r=element.getBoundingClientRect();
   const point={court,x:cr.left+cr.width*.25,y:r.top+r.height*.5,width:cr.width};
   point.free=!blocked.some(b=>b.width>0&&b.height>0&&b.left<cr.right-2&&b.right>cr.left+2&&b.top<r.bottom-2&&b.bottom>r.top+2);
   return point;
 });
}
async function dateTo(date,check){
 const value=()=>document.getElementById('selectDate')?.value;
 const original=value();
 for(let n=0;value()!==date;n++){
   if(n>=14)throw Error('日历日期切换超过 14 天');
   await check();
   if(network().pending){
    try{await wait(()=>{check();return network().pending===0;},6500,'日期请求完成');}
    catch(e){if(e.message.startsWith('等待日期请求完成超时'))throw Object.assign(e,{retry:true});throw e;}
   }
   const next=value()<date;
   const button=document.querySelector(next?'.fc-next-button':'.fc-prev-button');
   if(!visible(button)||button.disabled)throw Object.assign(Error('目标日期尚不可切换'),{retry:true,code:'release-pending'});
   const before=value(),messages=noticeSnapshot();button.click();
   try{await wait(()=>{checkFeedback(messages);return value()!==before;},2500,'日期切换');}
   catch(e){if(e.code)throw e;throw Object.assign(e,{retry:true,code:'release-pending'});}
 }
 return original!==date;
}
function refresh(){const button=byText(document,'button,a','刷新');if(!button)throw Error('找不到日历刷新按钮');button.click();}
function network(){
 const raw=document.documentElement.getAttribute('data-court-network');
 if(!raw)throw Error('刷新监测尚未准备');
 return JSON.parse(raw);
}
function calendarReady(date,hour){
 if(document.getElementById('selectDate')?.value!==date)throw Object.assign(Error('日历日期尚未就绪'),{retry:true});
 const g=geometry();
 if(g.columns.some(e=>!e.getAttribute('data-date').startsWith(date+'T')))throw Object.assign(Error('时间列仍是旧日期'),{retry:true});
 points(hour);
}
function formDoc(){
 for(const frame of document.querySelectorAll('iframe')){
  try{if(frame.contentDocument?.getElementById('startTime'))return frame.contentDocument;}catch{}
 }
 if(document.getElementById('bizFieldBookMainForm'))return document;
 return null;
}
async function open(point,check){
 const g=geometry();
 const row=g.rows.find(r=>r.court===point.court);
 row.element.scrollIntoView({block:'center',inline:'nearest'});
 const p=points(point.hour).find(r=>r.court===point.court);
 if(!p?.free)throw Object.assign(Error('场次刚被占用'),{retry:true,code:'court-gone'});
 await check();
 const target=document.elementFromPoint(p.x,p.y);
 if(!target||!g.timeArea.contains(target))throw Error('日历被遮挡，请关闭覆盖日历的弹窗');
 const event=(type,x,buttons)=>new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:p.y,button:0,buttons});
 const messages=noticeSnapshot();
 target.dispatchEvent(event('mousedown',p.x,1));
 document.dispatchEvent(event('mousemove',p.x+Math.max(8,p.width*.12),1));
 document.elementFromPoint(p.x+Math.max(8,p.width*.12),p.y)?.dispatchEvent(event('mouseup',p.x+Math.max(8,p.width*.12),0));
 try{return await wait(()=>{
  checkFeedback(messages);check();
  const doc=formDoc();
  return doc&&doc.readyState==='complete'&&['startTime','endTime','userName','userPhone','theme','bizFieldBookField.joinNums','useDesc'].every(id=>doc.getElementById(id))&&doc.getElementById('startTime').value?doc:null;
 },4000,'预约表单');}catch(e){if(e.code||!e.message.startsWith('等待预约表单超时'))throw e;throw Object.assign(e,{retry:true,code:'form-timeout'});}
}
async function dismissForm(error){
 const notice=error?.notice;
 if(notice?.isConnected){
  const layer=notice.closest('.layui-layer');
  const close=layer?.querySelector('.layui-layer-close');
  const ok=[...layer?.querySelectorAll('.layui-layer-btn0')||[]].find(e=>/^(确定|知道了|关闭|OK)$/.test(text(e)));
  (close||ok)?.click();
 }
 for(const frame of document.querySelectorAll('iframe')){
  let path;try{path=new URL(frame.src,location.href).pathname;}catch{continue;}
  if(path!=='/a/field/client/bookForm')continue;
  const close=frame.closest('.layui-layer')?.querySelector('.layui-layer-close');
  if(!close)throw Error('表单未能自动关闭，请先关闭预订信息窗口');
  close.click();
 }
 await wait(()=>!formDoc(),1200,'旧预约表单关闭');
}
function formResponseMs(doc){
 try{const n=doc.defaultView.performance.getEntriesByType('navigation')[0];return n&&n.responseEnd>=n.requestStart&&n.requestStart>0?Math.round(n.responseEnd-n.requestStart):null;}catch{return null;}
}
function readForm(doc){
 const values=Object.fromEntries([...doc.querySelectorAll('input,textarea,select')].filter(e=>e.id).map(e=>[e.id,e.value]));
 const anonymous=[...doc.querySelectorAll('input:not([id]),input[id=""]')].map(e=>e.value);
 return {values,anonymous};
}
function capacity(doc){
 // Identify the capacity by its label, never by unrelated numeric hidden fields.
 const labels=[...doc.querySelectorAll('label')].filter(e=>visible(e)&&text(e).replace(/[\s:：*]/g,'')==='容纳人数');
 const controls=new Set();
 for(const label of labels){
  const linked=label.control;
  if(linked&&visible(linked))controls.add(linked);
  else for(let group=label.parentElement;group&&group!==doc.body;group=group.parentElement){
   const fields=[...group.querySelectorAll('input:not([type="hidden"])')].filter(visible);
   if(fields.length===1){controls.add(fields[0]);break;}
   if(fields.length>1)break;
  }
 }
 const field=unique([...controls],'容纳人数');
 if(!field.readOnly&&!field.disabled)throw Error('容纳人数字段不是只读信息');
 const raw=field.value.trim();
 if(!/^\d+$/.test(raw)||Number(raw)<1)throw Error('学校表单尚未显示有效的容纳人数');
 return Number(raw);
}
function validate(doc,task,court,filled=false){
 const {values:v,anonymous}=readForm(doc);
 const date=task.date+' '+String(task.hour).padStart(2,'0')+':00';
 const end=task.date+' '+String(task.hour+1).padStart(2,'0')+':00';
 if(v.startTime!==date||v.endTime!==end)throw Error('学校表单的日期或时段与任务不符');
 if(v.userName!==task.identity||!v.userEmail)throw Error('当前登录身份与开始任务时不符');
 const fields=[...doc.querySelectorAll('input')].filter(e=>e.readOnly||e.disabled||!e.id).map(e=>e.value);
 const courtNames=fields.map(v=>v.match(/羽毛球场\s*0?(\d+)$/)).filter(Boolean);
 if(!fields.includes('羽毛球场')||courtNames.length!==1||Number(courtNames[0][1])!==court)throw Error('学校表单的场地与选择不符');
 const cap=capacity(doc);
 if(cap<task.participants)throw Error('参与人数超过场地容量（'+cap+' 人）');
 if(filled){
  const expected={userPhone:task.phone,theme:task.theme,'bizFieldBookField.joinNums':String(task.participants),useDesc:task.purpose};
  for(const [id,value] of Object.entries(expected))if(v[id]!==value)throw Error('必填项回读失败 '+id);
  for(const e of doc.querySelectorAll('input[required],textarea[required],select[required]'))if(visible(e)&&!e.value.trim())throw Error('还有学校必填项未填写');
  for(const mark of [...doc.querySelectorAll('span,label,font')].filter(e=>visible(e)&&text(e)==='*')){
   const group=mark.closest('.form-group,tr,.row')||mark.parentElement.parentElement;
   const controls=[...group.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(visible);
   if(!controls.length||controls.some(e=>!e.value.trim()))throw Error('发现新增或未填写的必填项');
  }
 }
 return {name:v.userName,email:v.userEmail};
}
function fill(doc,task,court){
 validate(doc,task,court);
 const mapping={userPhone:task.phone,theme:task.theme,'bizFieldBookField.joinNums':String(task.participants),useDesc:task.purpose};
 for(const [id,value] of Object.entries(mapping)){
  const e=doc.getElementById(id);if(!e||e.readOnly||e.disabled)throw Error('必填项不可编辑 '+id);
  const proto=e.tagName==='TEXTAREA'?doc.defaultView.HTMLTextAreaElement.prototype:doc.defaultView.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);
  e.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));e.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));
 }
 return validate(doc,task,court,true);
}
function submitButton(){return unique([...document.querySelectorAll('a,button')].filter(e=>visible(e)&&text(e)==='提交预订'),'提交预订按钮');}
async function submitAndObserve(doc,task,court,button){
 // Only the site's own new dialogs count. Calendar titles, stale toasts and
 // JavaScript exceptions never release the persisted submit lock.
 const dialogs=()=>[...new Set([document,doc])].flatMap(d=>[...d.querySelectorAll('.layui-layer-dialog .layui-layer-content,.layui-layer-msg .layui-layer-content')].filter(visible));
 if(formDoc()!==doc)throw Error('提交前表单已变化');
 validate(doc,task,court,true);
 const before=new Map(dialogs().map(e=>[e,text(e)]));
 if(before.size)throw Error('提交前存在学校提示，请先检查');
 button.click();
 let result;
 try{result=await wait(()=>{
  const fresh=dialogs().filter(e=>!before.has(e)&&text(e));
  if(fresh.length){
   if(fresh.length!==1)return {evidence:null};
   const notice=fresh[0];let contextValid=formDoc()===doc;
   try{validate(doc,task,court,true);}catch{contextValid=false;}
   return {notice,evidence:{source:'fresh-school-dialog',contextValid,message:text(notice),observedAt:Date.now(),court,date:task.date,hour:task.hour,identity:task.identity}};
  }
  if(formDoc()!==doc)return {evidence:null};
  return null;
 },6500,'提交结果');}catch(e){if(!e.message.startsWith('等待提交结果超时'))throw e;return {evidence:null};}
 return result;
}
function orders(){
 const headers=['场地','创建时间','开始时间','结束时间','申请人','单号','是否重复预订','状态','操作'];
 const table=[...document.querySelectorAll('table')].find(t=>headers.every(h=>[...t.querySelectorAll('th')].some(e=>text(e)===h)));
 if(!table)return null;
 const names=[...table.querySelectorAll('thead th')].map(text);
 return [...table.querySelectorAll('tbody tr')].flatMap(tr=>{
  const cells=[...tr.querySelectorAll('td')].map(text);
  const o=Object.fromEntries(names.map((n,i)=>[n,cells[i]||'']));
  const court=o['场地']?.match(/羽毛球场\s*0?(\d+)/);
  if(!court)return [];
  return [{court:Number(court[1]),created:o['创建时间'],start:o['开始时间'].slice(0,16),end:o['结束时间'].slice(0,16),applicant:o['申请人'],id:o['单号'],status:o['状态']}];
 });
}
function diagnostic(){
 const root=document.getElementById('calendar');
 const info=e=>({tag:e.tagName,id:e.id,cls:typeof e.className==='string'?e.className:'',role:e.getAttribute('role'),
  date:e.getAttribute('data-date'),resource:e.getAttribute('data-resource-id'),
  label:/^(?:\d\d:\d\d|(?:(?:大学体育馆|综合运动馆|音乐学院运动馆)-)?羽毛球场(?:0?[1-9]|1[0-4])?|刷新|返回|提交预订)$/.test(text(e))&&text(e).length<45?text(e):null,
  box:{x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}});
 const header=document.querySelector('#kt_header,.kt-header,.navbar,header,.header');
 return {path:location.pathname,calendar:root?[...root.querySelectorAll('*')].slice(0,3000).map(info):[],
  header:header?[...header.querySelectorAll('*')].map(e=>({tag:e.tagName,id:e.id,cls:e.className,children:e.children.length})):[],
  controls:[...document.querySelectorAll('button,input,select')].map(info),
  form:formDoc()?[...formDoc().querySelectorAll('input,textarea,label,select')].map(info):[]};
}
globalThis.CourtSite={preflight,identity,geometry,points,dateTo,refresh,network,calendarReady,formDoc,open,dismissForm,formResponseMs,fill,validate,submitButton,submitAndObserve,orders,diagnostic,wait,sleep,classifyFeedback};
})();
