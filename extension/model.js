export const PRIORITY = [6,4,5,7,11,12,13,14,3,8,9,10,1,2];
export const ACTIVE = ['armed','running','committing','verifying','uncertain'];
// Deliberately narrow: a generic conflict/timeout, or an existing reservation of
// our own, is not evidence that this submission was rejected.
export function explicitCourtRejection(message) {
  const s=String(message||'').replace(/\s+/g,'');
  if(s.length>180)return false;
  return /^(?:(?:预订|预约|提交)失败[：:，,！!。.]?)?(?:抱歉[，,！!。.]?)?(?:该|此|当前|所选)?(?:场地|场次|时段)(?:已经|已)被(?:他人|别人|其他用户)(?:预订|预约|占用)(?:了)?[！!。.,，]?(?:请(?:重新选择|选择其他)(?:场地|场次|时段)?[！!。.]?)?$/.test(s);
}
export function dayAtBeijing(time=Date.now()) {
  return new Date(time+8*3600000).toISOString().slice(0,10);
}
export function releaseAt(date) {
  const midnight=Date.parse(date+'T00:00:00+08:00');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(midnight)||dayAtBeijing(midnight)!==date)
    throw Error('请选择有效日期');
  return midnight-2*86400000+22*3600000;
}
export function config(input,now=Date.now()) {
  if(!input||Object.keys(input).some(k=>!['date','hour','phone','theme','purpose','participants','test','rehearsalSeconds'].includes(k)))throw Error('任务参数不兼容，请重新加载插件与学校页面');
  const release=releaseAt(input.date);
  const hour=Number(input.hour), participants=Number(input.participants);
  if(!Number.isInteger(hour)||hour<7||hour>21)throw Error('请选择 07–21 点的整点开始时间');
  if(Date.parse(input.date+'T'+String(hour).padStart(2,'0')+':00:00+08:00')<=now)throw Error('这个时段已经开始');
  if(!Number.isInteger(participants)||participants<1||participants>6)throw Error('参与人数应为 1–6');
  const phone=String(input.phone||'').trim(),theme=String(input.theme||'').trim(),purpose=String(input.purpose||'').trim();
  if(!/^\+?[\d ()-]{6,24}$/.test(phone))throw Error('请填写联系电话');
  if(!theme||theme.length>200||!purpose||purpose.length>2000)throw Error('请填写主题和用途说明');
  if(typeof input.test!=='boolean')throw Error('请选择执行方式');
  const rehearsalSeconds=Number(input.rehearsalSeconds||0);
  if(![0,10].includes(rehearsalSeconds)||(!input.test&&rehearsalSeconds))throw Error('短倒计时仅允许只填表演练');
  return {date:input.date,hour,participants,phone,theme,purpose,test:input.test,rehearsalSeconds,fireAt:rehearsalSeconds?now+rehearsalSeconds*1000:Math.max(now,release)};
}
export function matchOrder(rows,task) {
  const start=task.date+' '+String(task.hour).padStart(2,'0')+':00';
  const end=task.date+' '+String(task.hour+1).padStart(2,'0')+':00';
  const created=new Date(task.commitAt+8*3600000).toISOString().slice(0,19).replace('T',' ');
  const matches=rows.filter(r=>r.court===task.court&&r.start===start&&r.end===end&&
    r.applicant===task.identity&&r.created>=created&&['审核通过','审核中','待审核'].includes(r.status)&&/^\d+$/.test(r.id));
  return matches.length===1?matches[0]:null;
}
