/* Journal Junkie — UI. Data comes from store.js (window.JJ). Everything about a person
   (name, areas, goals, habits, classes, countdowns, calendar feeds) lives in settings/main. */
(function(){
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const ymd=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parse=s=>{const[a,b,c]=s.split("-").map(Number);return new Date(a,b-1,c)};
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return ymd(d)};
const today=()=>ymd(new Date());
const weekStart=s=>{const d=parse(s);const w=(d.getDay()+6)%7;d.setDate(d.getDate()-w);return ymd(d)};
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const PRI={high:0,med:1,low:2};
const PALETTE=["#007aff","#af52de","#ff9500","#34c759","#ff3b30","#30b0c7","#ff2d55","#a2845e"];
const clone=x=>JSON.parse(JSON.stringify(x));
const slug=s=>(String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"area")+"-"+Math.random().toString(36).slice(2,6);
const fmtShort=s=>{const d=parse(s);return DOW[d.getDay()]+" "+(d.getMonth()+1)+"/"+d.getDate()};

let db=null;
/* ---------- native (Capacitor) helpers; no-ops on the web ---------- */
const CAP=window.Capacitor,NATIVE=!!(CAP&&CAP.isNativePlatform&&CAP.isNativePlatform());
const plug=n=>NATIVE&&CAP.Plugins?CAP.Plugins[n]:null;
function haptic(kind){try{const H=plug("Haptics");if(!H)return;if(kind==="success")H.notification({type:"SUCCESS"});else H.impact({style:"LIGHT"})}catch(e){}}
async function scheduleReminder(){
  const LN=plug("LocalNotifications");if(!LN)return;
  const r=cfg().reminder;
  try{
    await LN.cancel({notifications:[{id:1}]});
    if(!r.on)return;
    const perm=await LN.requestPermissions();if(perm.display!=="granted")return;
    const [hh,mm]=(r.time||"21:30").split(":").map(Number);
    await LN.schedule({notifications:[{id:1,title:"Journal Junkie",body:"Time for your nightly check-in. How did today go?",schedule:{on:{hour:hh,minute:mm},allowWhileIdle:true}}]});
  }catch(e){console.warn(e)}
}
let lastReminderKey="";
function syncReminder(){const k=JSON.stringify(cfg().reminder);if(k!==lastReminderKey){lastReminderKey=k;scheduleReminder()}}
(function nativeShell(){
  if(!NATIVE)return;
  document.documentElement.classList.add("native");
  const SB=plug("StatusBar");try{SB&&SB.setOverlaysWebView({overlay:true})}catch(e){}
  const SS=plug("SplashScreen");setTimeout(()=>{try{SS&&SS.hide()}catch(e){}},300);
})();
const S={tasks:[],logs:{},grades:[],settings:null,settingsExists:false,loaded:false};
let curDate=today(),dirty=false,form=null,tab="log";

const DEF={name:"",areas:[],workout:{on:true,restMax:2},habits:[],track:{sleep:true,mood:true,grades:true},classList:[],countdowns:[],feeds:[],reminder:{on:true,time:"21:30"},onboarded:false};
function cfg(){const s=S.settings||{};return{...DEF,...s,workout:{...DEF.workout,...(s.workout||{})},track:{...DEF.track,...(s.track||{})},reminder:{...DEF.reminder,...(s.reminder||{})}}}
const areas=()=>cfg().areas;
const areaBy=k=>areas().find(a=>a.key===k);
const areaColor=a=>PALETTE[(a&&a.color||0)%PALETTE.length];
const areaName=k=>(areaBy(k)||{}).name||k;

function toast(m){const t=$("toast");t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,1900)}

/* ---------- tabs ---------- */
const TABS=["log","tasks","stats","me"];
const TAB_TITLES={log:"Today",tasks:"To-do",stats:"Progress",me:"Me"};
function onScroll(){document.body.classList.toggle("scrolled",window.scrollY>44)}
window.addEventListener("scroll",onScroll,{passive:true});
function showTab(t){tab=t;TABS.forEach(x=>$("tab-"+x).hidden=x!==t);
  document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t));
  $("saveBar").hidden=t!=="log";$("navTitle").textContent=TAB_TITLES[t];
  if(t==="stats")renderStats();if(t==="me")renderMe();if(t==="tasks")renderTasks();
  window.scrollTo(0,0);onScroll()}
document.querySelectorAll("nav.tabs button").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));

/* ---------- task logic ---------- */
function isDone(t,day){
  if(t.repeat==="daily")return t.lastDone===day;
  if(t.repeat==="weekly")return !!t.lastDone&&t.lastDone>=weekStart(day)&&t.lastDone<=day;
  return !!t.done;
}
function countsToday(t,day){
  if(t.kind==="event")return false;
  if(t.repeat==="daily")return true;
  if(t.repeat==="weekly")return parse(day).getDay()===(t.repeatDay??1)||isDone(t,day);
  if(t.done)return t.doneDate===day;
  return !!t.due&&t.due<=day;
}
function completion(day){const c=S.tasks.filter(t=>countsToday(t,day));const d=c.filter(t=>isDone(t,day)).length;return{done:d,total:c.length,pct:c.length?Math.round(d/c.length*100):null}}
function restsInWeek(day,logs){const ws=weekStart(day);let n=0;for(let i=0;i<7;i++){const d=addDays(ws,i);if(d>day)break;if(logs[d]?.workout==="rest")n++}return n}
function goalParts(log,day,logs=S.logs){
  const c=cfg();const parts=[];
  for(const a of c.areas){if(a.hoursGoal>0)parts.push({label:`${a.name} ${a.hoursGoal}h+`,ok:(log?.hours?.[a.key]??0)>=a.hoursGoal,pending:log?.hours?.[a.key]==null||log.hours[a.key]===""})}
  if(c.workout.on)parts.push({label:"Workout",ok:log?.workout==="done"||(log?.workout==="rest"&&restsInWeek(day,logs)<=c.workout.restMax),pending:!log?.workout});
  for(const h of c.habits)parts.push({label:h.label,ok:log?.habits?.[h.key]===true,pending:log?.habits?.[h.key]==null});
  parts.push({label:"To-dos",ok:log?.completion==null||log.completion>=100,pending:false});
  return{parts,all:parts.every(p=>p.ok)};
}
function streaks(){
  const t=today();
  const run=test=>{let d=S.logs[t]?t:addDays(t,-1),n=0;while(S.logs[d]&&test(S.logs[d],d)){n++;d=addDays(d,-1)}return n};
  const best=test=>{const ds=Object.keys(S.logs).sort();let b=0,c=0,prev=null;for(const d of ds){if(!test(S.logs[d],d))c=0;else c=(prev&&c>0&&addDays(prev,1)===d)?c+1:1;prev=d;b=Math.max(b,c)}return b};
  const g=(l,d)=>goalParts(l,d).all,a=()=>true;
  return{goal:run(g),log:run(a),bestGoal:best(g),bestLog:best(a)};
}

/* ---------- grade impact ---------- */
const DEF_W={tests:50,quizzes:20,homework:30},MIN_N={test:4,quiz:6,homework:20},CAT={test:"tests",quiz:"quizzes",homework:"homework"};
function kindOf(t){
  if(t.kind)return t.kind;
  const s=(t.title||"").toLowerCase();
  if(/study|choice board|guide|prep/.test(s))return"homework";
  if(/quiz/.test(s))return"quiz";
  if(/exam|midterm|\btest\b|debate performance/.test(s))return"test";
  return"homework";
}
function weightsFor(c){const x=cfg().classList.find(k=>k.name===c)||{};return{tests:x.tests??DEF_W.tests,quizzes:x.quizzes??DEF_W.quizzes,homework:x.homework??DEF_W.homework}}
function pct(x){return x.outOf?Math.round(x.score/x.outOf*1000)/10:x.score}
function classAvg(c){const g=S.grades.filter(x=>x.class===c);if(!g.length)return null;return g.reduce((s,x)=>s+pct(x),0)/g.length}
function impactOf(t){
  if(!t.class||t.kind==="event"||!(areaBy(t.area)||{}).classes)return null;
  if(typeof t.weightPct==="number")return t.weightPct;
  const k=kindOf(t),w=weightsFor(t.class)[CAT[k]]??0;
  const n=Math.max(S.tasks.filter(x=>x.class===t.class&&kindOf(x)===k).length,MIN_N[k]);
  let p=w/n;if(/final exam/i.test(t.title))p*=1.5;return Math.round(p*100)/100;
}
function boostOf(t){const p=impactOf(t);if(p==null)return null;const a=classAvg(t.class);return{pct:p,score:p*(a==null?1:1+Math.max(0,90-a)/20),avg:a}}
const impactLabel=s=>s>=5?"High":s>=2.5?"Med":"Low";

/* ---------- log form ---------- */
function segSet(el,v){el.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.v)===String(v)))}
function blankForm(){return{hours:{},workout:null,habits:{},wHit:"",wFelt:"",prs:[],sleep:"",mood:null,note:""}}
function logToForm(l){if(!l)return blankForm();const v=x=>x==null?"":x;const h={};Object.entries(l.hours||{}).forEach(([k,x])=>h[k]=v(x));
  return{hours:h,workout:l.workout||null,habits:{...(l.habits||{})},wHit:l.workoutNotes?.hit||"",wFelt:l.workoutNotes?.felt||"",prs:(l.workoutNotes?.prs||[]).map(p=>({...p})),sleep:v(l.sleep),mood:l.mood??null,note:l.note||""}}
function buildLogForm(){
  const c=cfg();
  const hrs=c.areas;
  $("hoursSec").hidden=!hrs.length;
  $("hoursGrid").innerHTML=hrs.map(a=>`<label class="f">${esc(a.name)}<input id="h-${esc(a.key)}" data-hk="${esc(a.key)}" type="number" inputmode="decimal" min="0" step="0.25" placeholder="${a.hoursGoal>0?"goal "+a.hoursGoal:"0"}"></label>`).join("");
  $("workoutSec").hidden=!c.workout.on;
  $("habitsSec").hidden=!c.habits.length;
  $("habitList").innerHTML=c.habits.map(h=>`<div class="row" style="justify-content:space-between"><span>${esc(h.label)}</span><div class="seg yn" data-hab="${esc(h.key)}"><button type="button" data-v="yes">Yes</button><button type="button" data-v="no">No</button></div></div>`).join("");
  $("sleepRow").hidden=!c.track.sleep;$("moodRow").hidden=!c.track.mood;$("bodySec").hidden=!c.track.sleep&&!c.track.mood;
  $("gradesSec").hidden=!c.track.grades;
}
function fillForm(){
  buildLogForm();
  form=logToForm(S.logs[curDate]);
  document.querySelectorAll("#hoursGrid input").forEach(i=>i.value=form.hours[i.dataset.hk]??"");
  ["wHit","wFelt","sleep","note"].forEach(k=>$(k).value=form[k]);
  segSet($("workoutSeg"),form.workout);segSet($("moodSeg"),form.mood);
  document.querySelectorAll("[data-hab]").forEach(el=>{const v=form.habits[el.dataset.hab];segSet(el,v==null?null:v?"yes":"no")});
  renderPrs();updateWorkoutUI();renderGradeList();renderChips();dirty=false;
  $("logDate").value=curDate;
  $("logDateLabel").textContent=(curDate===today()?"Today, ":"")+parse(curDate).toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"});
  $("saveLog").textContent=S.logs[curDate]?"Update log":"Save today's log";
}
const moodSeg=$("moodSeg");for(let i=1;i<=10;i++){const b=document.createElement("button");b.type="button";b.dataset.v=i;b.textContent=i;moodSeg.appendChild(b)}
$("workoutSeg").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;form.workout=form.workout===b.dataset.v?null:b.dataset.v;segSet($("workoutSeg"),form.workout);dirty=true;updateWorkoutUI();renderChips()});
moodSeg.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;const v=Number(b.dataset.v);form.mood=form.mood===v?null:v;segSet(moodSeg,form.mood);dirty=true});
$("habitList").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;const k=b.closest("[data-hab]").dataset.hab;const v=b.dataset.v==="yes";form.habits[k]=form.habits[k]===v?null:v;segSet(b.parentNode,form.habits[k]==null?null:form.habits[k]?"yes":"no");dirty=true;renderChips()});
$("hoursGrid").addEventListener("input",e=>{const k=e.target.dataset.hk;if(!k)return;form.hours[k]=e.target.value;dirty=true;renderChips()});
["wHit","wFelt","sleep","note"].forEach(k=>$(k).addEventListener("input",e=>{form[k]=e.target.value;dirty=true}));
$("logDate").addEventListener("change",e=>{if(!e.target.value)return;curDate=e.target.value;fillForm()});
function updateWorkoutUI(){
  const c=cfg();$("workoutBox").hidden=form.workout==="skipped"||form.workout==="rest";
  const tmp={...S.logs};tmp[curDate]={...(tmp[curDate]||{}),workout:form.workout};const n=restsInWeek(curDate,tmp);
  $("restNote").textContent=form.workout==="rest"?(n<=c.workout.restMax?`Rest day ${n} of ${c.workout.restMax} this week. It still counts toward your streak.`:`That's rest day ${n} this week. Only ${c.workout.restMax} count toward your streak.`):"";
}
function renderPrs(){
  const box=$("prRows");box.innerHTML="";
  form.prs.forEach((p,i)=>{const r=document.createElement("div");r.className="pr-row";
    r.innerHTML=`<input id="prL${i}" placeholder="Lift" value="${esc(p.lift)}"><input id="prW${i}" type="number" inputmode="decimal" placeholder="lb" value="${esc(p.weight)}"><input id="prR${i}" type="number" inputmode="numeric" placeholder="reps" value="${esc(p.reps)}"><button type="button" class="del" aria-label="Remove">✕</button>`;
    r.querySelector(`#prL${i}`).oninput=e=>{p.lift=e.target.value;dirty=true};
    r.querySelector(`#prW${i}`).oninput=e=>{p.weight=e.target.value;dirty=true};
    r.querySelector(`#prR${i}`).oninput=e=>{p.reps=e.target.value;dirty=true};
    r.querySelector("button").onclick=()=>{form.prs.splice(i,1);dirty=true;renderPrs()};
    box.appendChild(r)});
}
$("addPr").onclick=()=>{form.prs.push({lift:"",weight:"",reps:""});dirty=true;renderPrs();$("prL"+(form.prs.length-1)).focus()};
function draftLog(){
  const n=v=>{const x=parseFloat(v);return isNaN(x)?null:x};
  const hours={};Object.entries(form.hours).forEach(([k,v])=>{const x=n(v);if(x!=null)hours[k]=x});
  const isToday=curDate===today(),c=completion(curDate),prev=S.logs[curDate];
  return{date:curDate,hours,workout:form.workout,habits:Object.fromEntries(Object.entries(form.habits).filter(([,v])=>v!=null)),
    workoutNotes:{hit:form.wHit.trim(),felt:form.wFelt.trim(),prs:form.prs.filter(p=>String(p.lift).trim()).map(p=>({lift:String(p.lift).trim(),weight:n(p.weight),reps:n(p.reps)}))},
    sleep:n(form.sleep),mood:form.mood,note:form.note.trim(),
    completion:isToday?c.pct:(prev?.completion??null),tasksDone:isToday?c.done:(prev?.tasksDone??null),tasksTotal:isToday?c.total:(prev?.tasksTotal??null),savedAt:new Date().toISOString()};
}
function renderChips(){
  if(!form)return;
  const d=draftLog();const tmp={...S.logs,[curDate]:d};
  const g=goalParts(d,curDate,tmp);
  $("goalChips").innerHTML=g.parts.map(p=>`<span class="chip ${p.pending?"":p.ok?"ok":"no"}"><span class="dot"></span>${esc(p.label==="To-dos"?(()=>{const c=completion(curDate);return c.total?`To-dos ${c.done}/${c.total}`:"To-dos: nothing due"})():p.label)}</span>`).join("");
  const st=streaks();$("stGoal").textContent=st.goal;$("stLog").textContent=st.log;
}
$("saveLog").onclick=async()=>{
  const prev=S.logs[curDate];
  try{const dl=draftLog();await db.doc("logs/"+curDate).set(dl);dirty=false;haptic("success");
    if(curDate===today()&&goalParts(dl,curDate,{...S.logs,[curDate]:dl}).all){const n=streaks().goal;toast(n>1?`Every goal hit. ${n}-day streak!`:"Every goal hit today. Streak started!")}else toast(prev?"Log updated":"Log saved")}catch(e){toast("Couldn't save: "+(e.message||e))}
};

/* grades */
function fmtScore(x){const p=pct(x);return x.outOf?`${x.score}/${x.outOf} · ${p}%`:`${x.score}%`}
function renderGradeList(){
  const g=S.grades.filter(x=>x.date===curDate);
  $("gradeList").innerHTML=g.length?g.map(x=>`<div class="list-line"><span>${esc(x.class)} · ${esc(x.item)}</span><span class="num">${fmtScore(x)}</span></div>`).join(""):`<div class="empty">No grades logged for this day.</div>`;
  const classes=new Set([...cfg().classList.map(c=>c.name),...S.grades.map(x=>x.class)].filter(Boolean));
  $("classList").innerHTML=[...classes].map(c=>`<option value="${esc(c)}">`).join("");
}
$("addGrade").onclick=async()=>{
  const cls=$("gClass").value.trim(),item=$("gItem").value.trim(),sc=parseFloat($("gScore").value),out=parseFloat($("gOut").value);
  if(!cls||isNaN(sc)){toast("Add a class and a score");return}
  await db.collection("grades").add({date:curDate,class:cls,item:item||"Grade",score:sc,outOf:isNaN(out)?null:out,created:new Date().toISOString()});
  ["gItem","gScore","gOut"].forEach(k=>$(k).value="");toast("Grade added");
};

/* ---------- tasks ---------- */
let openTask=null,pendingTasks=false,taskView="sections",impactOrder="asc";const showMore={};
try{const v=localStorage.getItem("jj:taskView");if(v)taskView=v}catch(e){}
function fillAreaSelects(){
  const opts=areas().map(a=>`<option value="${esc(a.key)}">${esc(a.name)}</option>`).join("");
  const sel=$("tArea");const prev=sel.value;sel.innerHTML=opts;if([...sel.options].some(o=>o.value===prev))sel.value=prev;
}
function renderTasks(){
  const ae=document.activeElement;if(ae&&ae.dataset&&ae.dataset.notes){pendingTasks=true;return}
  pendingTasks=false;
  fillAreaSelects();
  const day=today(),horizon=addDays(day,7),c=completion(day);
  $("taskSub").textContent=c.total?`${c.done} of ${c.total} due today done`:"Nothing due today";
  renderCountdowns();
  const hasClasses=areas().some(a=>a.classes);
  $("viewSeg").hidden=!hasClasses;if(!hasClasses)taskView="sections";
  document.querySelectorAll("#viewSeg button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.view===taskView));
  if(taskView==="impact"){$("taskAreas").innerHTML=renderImpact();return}
  const group=(key,name,color,list,byDue)=>{
    const open=list.filter(t=>!isDone(t,day)),doneToday=list.filter(t=>isDone(t,day)&&(t.repeat||t.doneDate===day));
    open.sort(byDue?((a,b)=>((a.due||"9999")<(b.due||"9999")?-1:(a.due===b.due?(PRI[a.priority]??1)-(PRI[b.priority]??1):1))):((a,b)=>(PRI[a.priority]??1)-(PRI[b.priority]??1)||((a.due||"9999")<(b.due||"9999")?-1:1)));
    const soon=open.filter(t=>t.repeat||!t.due||t.due<=horizon),later=open.filter(t=>!(t.repeat||!t.due||t.due<=horizon));
    let rows=[...soon,...doneToday].map(taskRow).join("");
    const doneOld=list.filter(t=>!t.repeat&&t.done&&t.doneDate!==day).sort((a,b)=>(b.doneDate||"")<(a.doneDate||"")?-1:1);
    if(later.length)rows+=showMore[key]?later.map(taskRow).join("")+`<button class="more" data-more="${key}">Hide later</button>`:`<button class="more" data-more="${key}">+ ${later.length} due after ${fmtShort(horizon)}</button>`;
    if(doneOld.length){const dk=key+"-done";rows+=showMore[dk]?doneOld.map(taskRow).join("")+`<button class="more" data-more="${dk}">Hide finished</button>`:`<button class="more" data-more="${dk}" style="display:block">Show ${doneOld.length} finished</button>`}
    return`<section><div class="area-h"><i style="background:${color}"></i>${name}<span class="muted small num" style="margin-left:auto">${open.length} open</span></div><div>${rows||`<div class="empty">Nothing here yet.</div>`}</div></section>`;
  };
  let html="";
  for(const a of areas()){
    const list=S.tasks.filter(t=>t.area===a.key);
    if(a.classes){
      html+=group(a.key+"-a",`${esc(a.name)} · quizzes &amp; tests`,"var(--bad)",list.filter(t=>t.kind!=="event"&&kindOf(t)!=="homework"),true);
      html+=group(a.key+"-h",`${esc(a.name)} · homework`,areaColor(a),list.filter(t=>t.kind==="event"||kindOf(t)==="homework"),true);
    }else html+=group(a.key,esc(a.name),areaColor(a),list,false);
  }
  const orphan=S.tasks.filter(t=>!areaBy(t.area));
  if(orphan.length)html+=group("other","Other","var(--muted)",orphan,false);
  $("taskAreas").innerHTML=html||`<section><div class="empty">Add an area on the Me tab to start your list.</div></section>`;
}
function taskRow(t){
  const day=today(),done=isDone(t,day),tags=[];
  if(t.class)tags.push(`<span class="tag cls">${esc(t.class)}</span>`);
  if(t.kind==="event")tags.push(`<span class="tag">Event</span>`);
  if(t.priority==="high"&&t.kind!=="event")tags.push(`<span class="tag high">High</span>`);else if(t.priority==="low")tags.push(`<span class="tag">Low</span>`);
  if(t.repeat==="daily")tags.push(`<span class="tag">Daily</span>`);
  if(t.repeat==="weekly")tags.push(`<span class="tag">Weekly · ${DOW[t.repeatDay??1]}</span>`);
  if(!t.repeat&&!done&&t.due){if(t.due<day)tags.push(`<span class="tag over">Overdue · ${fmtShort(t.due)}</span>`);else if(t.due===day)tags.push(`<span class="tag today">Due today</span>`);else tags.push(`<span class="tag">${t.kind==="event"?"":"Due "}${fmtShort(t.due)}</span>`)}
  if(t.dueTime&&!done&&t.due)tags.push(`<span class="tag">${esc(t.dueTime)}</span>`);
  if(!t.repeat&&!done&&t.created&&t.created.slice(0,10)<day&&(!t.due||t.due>=day)&&t.source==="me")tags.push(`<span class="tag">Carried over</span>`);
  if(t.ai==="yes")tags.push(`<span class="tag ai-yes">AI used</span>`);else if(t.ai==="no")tags.push(`<span class="tag ai-no">No AI</span>`);
  if(t.notes)tags.push(`<span class="tag note">Notes</span>`);
  const bo=!done?boostOf(t):null;if(bo){const l=impactLabel(bo.score);tags.push(`<span class="lvl lvl-${l.toLowerCase()}">${l} impact</span>`)}
  const open=openTask===t.id,id=esc(t.id),kd=kindOf(t),isClass=!!(areaBy(t.area)||{}).classes&&t.kind!=="event";
  const detail=open?`<div class="detail">
    ${t.details?`<div class="canvas">${esc(t.details)}</div>`:""}
    ${isClass?`<div class="row" style="justify-content:space-between"><span class="small">Type${bo?` · ~${bo.pct}% of grade`:""}</span><div class="seg" style="width:230px"><button type="button" data-kind="homework" data-id="${id}" aria-pressed="${kd==="homework"}">HW</button><button type="button" data-kind="quiz" data-id="${id}" aria-pressed="${kd==="quiz"}">Quiz</button><button type="button" data-kind="test" data-id="${id}" aria-pressed="${kd==="test"}">Test</button></div></div>
    <div class="row" style="justify-content:space-between"><span class="small">Used AI support?</span><div class="seg" style="width:150px"><button type="button" data-ai="yes" data-id="${id}" aria-pressed="${t.ai==="yes"}">Yes</button><button type="button" data-ai="no" data-id="${id}" aria-pressed="${t.ai==="no"}">No</button></div></div>`:""}
    <label class="f">Notes<textarea id="notes-${id}" data-notes="${id}" rows="3" placeholder="How it went, what's next…">${esc(t.notes||"")}</textarea></label>
  </div>`:"";
  return`<div class="task-wrap"><div class="task ${done?"done":""}"><button class="ck" data-tg="${id}" aria-label="${done?"Mark not done":"Mark done"}">${done?"✓":""}</button><div class="body" data-open="${id}" role="button" tabindex="0" aria-expanded="${open}"><div class="t">${esc(t.title)}</div>${tags.length?`<div class="meta">${tags.join("")}</div>`:""}</div><button class="del" data-del="${id}" aria-label="Delete">✕</button></div>${detail}</div>`;
}
function renderImpact(){
  const day=today();
  const list=S.tasks.filter(t=>!isDone(t,day)).map(t=>({t,b:boostOf(t)})).filter(x=>x.b);
  if(!list.length)return`<section><div class="empty">No class assignments to rank yet. Add classes and a Canvas feed on the Me tab.</div></section>`;
  list.sort((a,b)=>impactOrder==="asc"?a.b.score-b.b.score:b.b.score-a.b.score);
  const max=Math.max(...list.map(x=>x.b.score));
  return`<section><div class="row" style="justify-content:space-between"><h2>Ranked by grade impact</h2>
    <div class="seg" style="width:180px"><button type="button" data-ord="asc" aria-pressed="${impactOrder==="asc"}">Low → High</button><button type="button" data-ord="desc" aria-pressed="${impactOrder==="desc"}">High → Low</button></div></div>
    <div class="small muted">Each assignment's estimated share of its class grade, from the weights on the Me tab. Classes where your average is under 90% get a boost.</div>
    <div>${list.map(({t,b},i)=>{const l=impactLabel(b.score);return`<div class="imp"><div class="row" style="justify-content:space-between;gap:8px;flex-wrap:nowrap"><div style="min-width:0"><div class="t" style="overflow-wrap:anywhere"><span class="num muted">${i+1}.</span> ${esc(t.title)}</div><div class="meta"><span class="tag cls">${esc(t.class)}</span><span class="tag">${{test:"Test",quiz:"Quiz",homework:"Homework"}[kindOf(t)]}</span>${t.due?`<span class="tag ${t.due<day?"over":""}">${t.due<day?"Overdue":"Due"} ${fmtShort(t.due)}</span>`:""}</div></div><div style="text-align:right;flex:none"><span class="lvl lvl-${l.toLowerCase()}">${l}</span><div class="small num muted">~${b.pct}% of grade</div></div></div><div class="bar" style="margin-top:6px"><div style="width:${Math.max(3,b.score/max*100)}%;background:var(--imp-${l.toLowerCase()})"></div></div></div>`}).join("")}</div></section>`;
}
function renderCountdowns(){
  const cds=cfg().countdowns.filter(c=>c.at);
  $("countdowns").innerHTML=cds.map(c=>{
    const at=new Date(c.at),ms=at-new Date(),past=ms<0,days=Math.floor(Math.abs(ms)/864e5),hrs=Math.floor(Math.abs(ms)%864e5/36e5);
    const list=c.area?S.tasks.filter(t=>t.area===c.area&&!t.repeat&&t.kind!=="event"&&(!t.due||t.due<=ymd(at))):[];
    const done=list.filter(t=>t.done).length,p=list.length?Math.round(done/list.length*100):0;
    return`<div class="card cd"><div class="ben"><div style="min-width:0"><h2>${esc(c.title||"Countdown")}</h2><div class="small muted">${at.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"})}, ${at.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}</div></div><div style="text-align:right;flex:none"><b>${past?"Done":`${days}d ${hrs}h`}</b><div class="small muted">${past?"update it on Me":"to go"}</div></div></div>
    ${c.area?`<div style="margin-top:12px;display:flex;flex-direction:column;gap:6px"><div class="row" style="justify-content:space-between"><span class="small">${esc(areaName(c.area))} list before then</span><span class="small num">${done}/${list.length} done</span></div><div class="bar"><div style="width:${p}%;background:${areaColor(areaBy(c.area))}"></div></div></div>`:""}</div>`}).join("");
}
$("taskAreas").addEventListener("focusout",async e=>{
  const n=e.target.dataset&&e.target.dataset.notes;if(!n)return;
  const t=S.tasks.find(x=>x.id===n),v=e.target.value.trim();
  if(t&&(t.notes||"")!==v){await db.doc("tasks/"+n).update({notes:v});toast("Notes saved")}
  setTimeout(()=>{if(pendingTasks)renderTasks()},0);
});
$("taskAreas").addEventListener("keydown",e=>{const b=e.target.closest&&e.target.closest("[data-open]");if(b&&(e.key==="Enter"||e.key===" ")){e.preventDefault();b.click()}});
$("taskAreas").addEventListener("click",async e=>{
  const od=e.target.closest("[data-ord]");if(od){impactOrder=od.dataset.ord;renderTasks();return}
  const kb=e.target.closest("[data-kind]");if(kb){await db.doc("tasks/"+kb.dataset.id).update({kind:kb.dataset.kind});return}
  const mo=e.target.closest("[data-more]");if(mo){showMore[mo.dataset.more]=!showMore[mo.dataset.more];renderTasks();return}
  const op=e.target.closest("[data-open]");if(op){openTask=openTask===op.dataset.open?null:op.dataset.open;renderTasks();return}
  const ai=e.target.closest("[data-ai]");if(ai){const t=S.tasks.find(x=>x.id===ai.dataset.id);if(!t)return;await db.doc("tasks/"+t.id).update({ai:t.ai===ai.dataset.ai?null:ai.dataset.ai});return}
  const tg=e.target.closest("[data-tg]");if(tg){const t=S.tasks.find(x=>x.id===tg.dataset.tg);if(!t)return;const day=today(),d=isDone(t,day);haptic(d?"light":"success");await db.doc("tasks/"+t.id).update(t.repeat?{lastDone:d?null:day}:{done:!d,doneDate:d?null:day});return}
  const del=e.target.closest("[data-del]");if(del){if(!del.classList.contains("arm")){del.classList.add("arm");del.textContent="Delete";setTimeout(()=>{del.classList.remove("arm");del.textContent="✕"},3000);return}
    const t=S.tasks.find(x=>x.id===del.dataset.del);
    if(t&&t.feedUid){const s=cfg();await saveSettings({dismissed:[...(s.dismissed||[]),t.feedUid].slice(-500)})}
    await db.doc("tasks/"+del.dataset.del).delete();toast("Deleted")}
});
$("viewSeg").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(!b)return;taskView=b.dataset.view;try{localStorage.setItem("jj:taskView",taskView)}catch(err){}renderTasks()});
$("tAdd").onclick=async()=>{
  const title=$("tTitle").value.trim();if(!title)return $("tTitle").focus();
  if(!areas().length){toast("Add an area on the Me tab first");return}
  const rep=$("tRepeat").value,due=$("tDue").value||null;
  await db.collection("tasks").add({title,area:$("tArea").value,priority:$("tPri").value,due:rep?null:due,repeat:rep||null,repeatDay:rep==="weekly"?(due?parse(due).getDay():new Date().getDay()):null,done:false,doneDate:null,lastDone:null,created:new Date().toISOString(),source:"me"});
  $("tTitle").value="";$("tDue").value="";$("tRepeat").value="";toast("Task added");
};
$("tTitle").addEventListener("keydown",e=>{if(e.key==="Enter")$("tAdd").click()});

/* ---------- charts ---------- */
function lastDays(n){const t=today();return Array.from({length:n},(_,i)=>addDays(t,i-n+1))}
function barChart(days,segs,{max,goal,unit=""}){
  const W=340,H=130,L=28,B=18,T=8,n=days.length,bw=(W-L)/n,y=v=>T+(H-T-B)*(1-v/max);
  let s=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  [0,max/2,max].forEach(v=>{s+=`<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--sep)" stroke-width=".5"/><text x="${L-4}" y="${y(v)+3}" text-anchor="end">${+v.toFixed(1)}${unit}</text>`});
  days.forEach((d,i)=>{let acc=0;const x=L+i*bw+bw*.18,w=bw*.64;
    segs(d).forEach(([v,col])=>{if(!v)return;const h=(H-T-B)*(Math.min(v,max-acc)/max);if(h<=0)return;acc+=v;s+=`<rect x="${x}" y="${y(Math.min(acc,max))}" width="${w}" height="${h}" rx="3" style="fill:${col}"/>`});
    if(i%2===(n-1)%2)s+=`<text x="${x+w/2}" y="${H-5}" text-anchor="middle">${parse(d).getDate()}</text>`});
  if(goal)s+=`<line x1="${L}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" style="stroke:var(--label2)" stroke-dasharray="3 3"/>`;
  return s+"</svg>";
}
function lineChart(labels,vals,{min,max,unit="",color="var(--accent)"}){
  const W=340,H=120,L=28,B=18,T=10,R=8,n=labels.length,step=n>1?(W-L-R)/(n-1):0,x=i=>n>1?L+i*step:(L+W)/2,y=v=>T+(H-T-B)*(1-(v-min)/(max-min));
  let s=`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">`;
  [min,(min+max)/2,max].forEach(v=>{s+=`<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--sep)" stroke-width=".5"/><text x="${L-4}" y="${y(v)+3}" text-anchor="end">${+v.toFixed(1)}${unit}</text>`});
  let seg=[],paths=[];vals.forEach((v,i)=>{if(v==null){if(seg.length)paths.push(seg);seg=[]}else seg.push(`${x(i)},${y(v)}`)});if(seg.length)paths.push(seg);
  paths.forEach(p=>s+=`<polyline points="${p.join(" ")}" fill="none" style="stroke:${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  let li=-1;vals.forEach((v,i)=>{if(v!=null)li=i});
  vals.forEach((v,i)=>{if(v!=null)s+=`<circle cx="${x(i)}" cy="${y(v)}" r="${i===li?4.5:2.5}" style="fill:${color}"/>`});
  labels.forEach((l,i)=>{if(n<=8||i%2===(n-1)%2)s+=`<text x="${x(i)}" y="${H-4}" text-anchor="middle">${esc(l)}</text>`});
  return s+"</svg>";
}
const emptyChart=m=>`<div class="empty">${m}</div>`;
function renderStats(){
  const c=cfg(),st=streaks();
  $("stGoal2").textContent=st.goal;$("stLog2").textContent=st.log;$("bestGoal").textContent=st.bestGoal;$("bestLog").textContent=st.bestLog;
  const days=lastDays(14),has=days.some(d=>S.logs[d]);
  $("chComp").innerHTML=has?barChart(days,d=>{const l=S.logs[d];if(!l)return[];return[[l.completion??100,goalParts(l,d).all?"var(--accent)":"var(--fill2)"]]},{max:100,unit:"%"})+`<div class="legend"><span><i style="background:var(--accent)"></i>Hit every goal</span><span><i style="background:var(--fill2)"></i>Missed one</span></div>`:emptyChart("Bars appear after your first saved log.");
  const ar=c.areas;
  const maxH=Math.max(4,...days.map(d=>Object.values(S.logs[d]?.hours||{}).reduce((s,x)=>s+(x||0),0)));
  $("hoursLegend").innerHTML=ar.map(a=>`<span><i style="background:${areaColor(a)}"></i>${esc(a.name)}</span>`).join("");
  $("chHours").innerHTML=has?barChart(days,d=>ar.map(a=>[S.logs[d]?.hours?.[a.key],areaColor(a)]),{max:Math.ceil(maxH),unit:"h"}):emptyChart("Log your hours to start this chart.");
  $("gymStat").hidden=!c.workout.on;
  $("gymCal").innerHTML=lastDays(28).map(d=>`<div class="${S.logs[d]?.workout||""}" title="${d}">${parse(d).getDate()}</div>`).join("");
  const lab=days.map(d=>String(parse(d).getDate()));
  const sl=days.map(d=>S.logs[d]?.sleep??null),md=days.map(d=>S.logs[d]?.mood??null);
  $("sleepStat").hidden=!c.track.sleep;$("moodStat").hidden=!c.track.mood;
  $("chSleep").innerHTML=sl.some(v=>v!=null)?lineChart(lab,sl,{min:4,max:Math.max(10,...sl.filter(v=>v!=null)),unit:"h",color:"var(--blue)"}):emptyChart("No sleep logged yet.");
  $("chMood").innerHTML=md.some(v=>v!=null)?lineChart(lab,md,{min:1,max:10,color:"var(--orange)"}):emptyChart("No mood ratings yet.");
  renderLift();renderGradeStats();renderHabitStats();renderJournal();
}
let journalAll=false;
const MOOD_FACE=m=>m==null?"":m>=9?"Great":m>=7?"Good":m>=5?"Okay":m>=3?"Low":"Rough";
function renderJournal(){
  const days=Object.keys(S.logs).filter(d=>S.logs[d]&&(S.logs[d].note||S.logs[d].mood!=null)).sort().reverse();
  if(!days.length){$("journalList").innerHTML=`<div class="empty">Your journal entries will show up here. Write a few lines in today's log tonight.</div>`;return}
  const shown=journalAll?days:days.slice(0,5);
  $("journalList").innerHTML=shown.map(d=>{const l=S.logs[d],dt=parse(d);
    const date=dt.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});
    const note=(l.note||"").trim();
    return`<button type="button" class="jrow" data-jday="${d}"><div class="jtop"><span class="jdate">${esc(date)}</span>${l.mood!=null?`<span class="jmood">${esc(MOOD_FACE(l.mood))} · ${l.mood}/10</span>`:""}</div>${note?`<div class="jnote">${esc(note)}</div>`:`<div class="jnote muted">No journal entry</div>`}</button>`}).join("")
    +(days.length>5?`<button type="button" class="more" id="journalMore">${journalAll?"Show less":"Show all "+days.length+" entries"}</button>`:"");
}
$("journalList").addEventListener("click",e=>{
  if(e.target.closest("#journalMore")){journalAll=!journalAll;renderJournal();return}
  const r=e.target.closest("[data-jday]");if(!r)return;
  curDate=r.dataset.jday;fillForm();showTab("log");
});
function renderHabitStats(){
  const hs=cfg().habits,days=lastDays(14);
  $("habitStat").hidden=!hs.length;
  $("habitBox").innerHTML=hs.map(h=>{const yes=days.filter(d=>S.logs[d]?.habits?.[h.key]===true).length,logged=days.filter(d=>S.logs[d]?.habits?.[h.key]!=null).length;
    return`<div style="display:flex;flex-direction:column;gap:4px;padding:6px 0"><div class="row" style="justify-content:space-between"><span class="small">${esc(h.label)}</span><span class="small num">${yes}/${logged||0} days</span></div><div class="bar"><div style="width:${logged?yes/logged*100:0}%;background:var(--good)"></div></div></div>`}).join("");
}
function renderLift(){
  const m={};Object.keys(S.logs).sort().forEach(d=>(S.logs[d].workoutNotes?.prs||[]).forEach(p=>{if(p.weight==null)return;const k=p.lift.trim().toLowerCase();(m[k]=m[k]||{name:p.lift.trim(),pts:{}});if(m[k].pts[d]==null||p.weight>m[k].pts[d])m[k].pts[d]=p.weight}));
  const keys=Object.keys(m),sel=$("liftSel");
  $("liftStat").hidden=!cfg().workout.on;
  if(!keys.length){sel.hidden=true;$("chLift").innerHTML=emptyChart("Add a lift with a weight in your workout log and it charts here.");return}
  sel.hidden=false;const prev=sel.value;sel.innerHTML=keys.map(k=>`<option value="${esc(k)}">${esc(m[k].name)}</option>`).join("");if(keys.includes(prev))sel.value=prev;
  const L=m[sel.value],ds=Object.keys(L.pts).sort().slice(-12),vals=ds.map(d=>L.pts[d]),lo=Math.min(...vals),hi=Math.max(...vals),pv=Math.max(5,(hi-lo)*.15);
  $("chLift").innerHTML=lineChart(ds.map(d=>{const x=parse(d);return(x.getMonth()+1)+"/"+x.getDate()}),vals,{min:Math.max(0,Math.floor(lo-pv)),max:Math.ceil(hi+pv),color:"var(--green)"})+`<div class="small muted">Best: <span class="num">${hi} lb</span></div>`;
}
$("liftSel").onchange=renderLift;
function renderGradeStats(){
  $("gradeStat").hidden=!cfg().track.grades;
  const by={};S.grades.forEach(g=>(by[g.class]=by[g.class]||[]).push(g));const ks=Object.keys(by).sort();
  if(!ks.length){$("gradeStats").innerHTML=emptyChart("Grades you add in your log show up here by class.");return}
  $("gradeStats").innerHTML=ks.map(k=>{const gs=by[k].sort((a,b)=>a.date<b.date?-1:1),avg=Math.round(gs.reduce((s,g)=>s+pct(g),0)/gs.length*10)/10;
    return`<div class="card" style="display:flex;flex-direction:column;gap:4px;padding:14px"><div class="row" style="justify-content:space-between"><b>${esc(k)}</b><span class="num">avg ${avg}%</span></div>${gs.length>1?lineChart(gs.map(()=>""),gs.map(pct),{min:Math.max(0,Math.floor(Math.min(...gs.map(pct))/10)*10-10),max:100,unit:"%",color:"var(--blue)"}):""}${gs.slice(-4).reverse().map(g=>`<div class="list-line"><span>${esc(g.item)} <span class="muted small">${fmtShort(g.date)}</span></span><span class="num">${fmtScore(g)}</span></div>`).join("")}</div>`}).join("");
}

/* ---------- settings editor (used by onboarding and the Me tab) ---------- */
const AREA_PRESETS=[["School",1,true],["College apps",1,false],["Work",0,false],["Practice",0,false],["Side project",1,false],["Personal",0,false],["Reading",0.5,false]];
const HABIT_PRESETS=["Ate well","Drank enough water","Read 20 min","Stretched","No phone after 11","Called family"];
const ED={
  reminder:d=>`<div class="row" style="justify-content:space-between"><span>Nightly reminder</span><div class="seg yn"><button type="button" data-ed="rem-on" data-v="1" aria-pressed="${d.reminder.on}">On</button><button type="button" data-ed="rem-on" data-v="" aria-pressed="${!d.reminder.on}">Off</button></div></div>
    ${d.reminder.on?`<label class="f">Remind me at<input type="time" data-ed="rem-time" value="${esc(d.reminder.time)}"></label>`:""}<div class="small muted">A notification each night so you don't forget to log your day.</div>`,
  name:d=>`<label class="f">Your first name<input data-ed="name" value="${esc(d.name)}" placeholder="e.g. Sam" autocomplete="given-name"></label>`,
  areas:d=>`<div class="small muted">Areas are the buckets for your to-dos and hours. Set a daily hours goal to make it part of your streak. Turn on "Classes" for school so assignments get sorted into homework and tests.</div>
    <div class="ed-list">${d.areas.map((a,i)=>`<div class="ed-row"><button type="button" class="swatch" data-ed="area-color" data-i="${i}" style="background:${areaColor(a)}" aria-label="Change color"></button><input data-ed="area-name" data-i="${i}" value="${esc(a.name)}" placeholder="Area name" aria-label="Area name"><label class="mini">Goal<input type="number" inputmode="decimal" min="0" step="0.5" data-ed="area-goal" data-i="${i}" value="${a.hoursGoal||""}" placeholder="0"> h/day</label><label class="mini chk"><input type="checkbox" data-ed="area-classes" data-i="${i}" ${a.classes?"checked":""}> Classes</label><button type="button" class="del" data-ed="area-del" data-i="${i}" aria-label="Remove">✕</button></div>`).join("")||`<div class="empty">No areas yet. Tap one below.</div>`}</div>
    <div class="chips">${AREA_PRESETS.filter(p=>!d.areas.some(a=>a.name===p[0])).map(p=>`<button type="button" class="chip add" data-ed="area-add" data-name="${esc(p[0])}" data-goal="${p[1]}" data-classes="${p[2]?1:""}">+ ${esc(p[0])}</button>`).join("")}<button type="button" class="chip add" data-ed="area-add" data-name="">+ Custom</button></div>`,
  workout:d=>`<div class="row" style="justify-content:space-between"><span>Track workouts?</span><div class="seg yn"><button type="button" data-ed="wo-on" data-v="1" aria-pressed="${d.workout.on}">Yes</button><button type="button" data-ed="wo-on" data-v="" aria-pressed="${!d.workout.on}">No</button></div></div>
    ${d.workout.on?`<label class="f">Rest days that still count toward your streak, per week<input type="number" inputmode="numeric" min="0" max="7" data-ed="wo-rest" value="${d.workout.restMax}"></label>`:""}`,
  habits:d=>`<div class="small muted">Simple yes/no checks you answer each night.</div>
    <div class="ed-list">${d.habits.map((h,i)=>`<div class="ed-row"><input data-ed="habit-label" data-i="${i}" value="${esc(h.label)}" placeholder="Habit" aria-label="Habit"><button type="button" class="del" data-ed="habit-del" data-i="${i}" aria-label="Remove">✕</button></div>`).join("")}</div>
    <div class="chips">${HABIT_PRESETS.filter(p=>!d.habits.some(h=>h.label===p)).map(p=>`<button type="button" class="chip add" data-ed="habit-add" data-name="${esc(p)}">+ ${esc(p)}</button>`).join("")}<button type="button" class="chip add" data-ed="habit-add" data-name="">+ Custom</button></div>`,
  track:d=>[["sleep","Sleep hours"],["mood","Mood / energy (1–10)"],["grades","Grades"]].map(([k,l])=>`<div class="row" style="justify-content:space-between"><span>${l}</span><div class="seg yn"><button type="button" data-ed="track" data-k="${k}" data-v="1" aria-pressed="${!!d.track[k]}">On</button><button type="button" data-ed="track" data-k="${k}" data-v="" aria-pressed="${!d.track[k]}">Off</button></div></div>`).join(""),
  classes:d=>`<div class="small muted">Add your classes and how each one weights tests, quizzes and homework (from the syllabus or the Canvas grades page). This powers the grade impact ranking.</div>
    <div class="ed-list">${d.classList.map((c,i)=>`<div class="ed-class"><div class="ed-row"><input data-ed="class-name" data-i="${i}" value="${esc(c.name)}" placeholder="Class name" aria-label="Class name"><button type="button" class="del" data-ed="class-del" data-i="${i}" aria-label="Remove">✕</button></div><div class="grid3"><label class="mini">Tests %<input type="number" inputmode="numeric" data-ed="class-w" data-k="tests" data-i="${i}" value="${c.tests??50}"></label><label class="mini">Quizzes %<input type="number" inputmode="numeric" data-ed="class-w" data-k="quizzes" data-i="${i}" value="${c.quizzes??20}"></label><label class="mini">Homework %<input type="number" inputmode="numeric" data-ed="class-w" data-k="homework" data-i="${i}" value="${c.homework??30}"></label></div></div>`).join("")}</div>
    <button type="button" class="btn ghost sm" data-ed="class-add" style="align-self:flex-start">+ Add class</button>`,
  countdowns:d=>`<div class="small muted">Big dates to work toward: a meeting, a test, an application deadline. Link an area to see how much of that list is done before then.</div>
    <div class="ed-list">${d.countdowns.map((c,i)=>`<div class="ed-class"><div class="ed-row"><input data-ed="cd-title" data-i="${i}" value="${esc(c.title)}" placeholder="What's coming up?" aria-label="Countdown name"><button type="button" class="del" data-ed="cd-del" data-i="${i}" aria-label="Remove">✕</button></div><div class="row"><input type="datetime-local" data-ed="cd-at" data-i="${i}" value="${esc(c.at||"")}" style="flex:2" aria-label="Date and time"><select data-ed="cd-area" data-i="${i}" style="flex:1" aria-label="Linked area"><option value="">No area</option>${d.areas.map(a=>`<option value="${esc(a.key)}" ${c.area===a.key?"selected":""}>${esc(a.name)}</option>`).join("")}</select></div></div>`).join("")}</div>
    <button type="button" class="btn ghost sm" data-ed="cd-add" style="align-self:flex-start">+ Add countdown</button>`,
  feeds:d=>`<div class="small muted">Paste a calendar link and Journal Junkie pulls in what's coming up.<br><b>Canvas:</b> Calendar → Calendar Feed (bottom right) → copy the link.<br><b>Google Calendar:</b> on a computer, Settings → your calendar → "Secret address in iCal format."</div>
    <div class="ed-list">${d.feeds.map((f,i)=>`<div class="ed-class"><div class="ed-row"><input data-ed="feed-label" data-i="${i}" value="${esc(f.label)}" placeholder="Name, e.g. Canvas" aria-label="Feed name"><button type="button" class="del" data-ed="feed-del" data-i="${i}" aria-label="Remove">✕</button></div><input data-ed="feed-url" data-i="${i}" value="${esc(f.url)}" placeholder="https://… or webcal://…" inputmode="url" autocapitalize="off" spellcheck="false" aria-label="Calendar link"><div class="row"><select data-ed="feed-type" data-i="${i}" style="flex:1" aria-label="What's in it"><option value="assignments" ${f.type!=="events"?"selected":""}>Assignments (to-dos)</option><option value="events" ${f.type==="events"?"selected":""}>Events (just show them)</option></select><select data-ed="feed-area" data-i="${i}" style="flex:1" aria-label="Area">${d.areas.map(a=>`<option value="${esc(a.key)}" ${f.area===a.key?"selected":""}>${esc(a.name)}</option>`).join("")}</select></div></div>`).join("")}</div>
    <button type="button" class="btn ghost sm" data-ed="feed-add" style="align-self:flex-start">+ Add calendar link</button>`
};
function edHandle(container,draft,onChange){
  const rerender=()=>{container.querySelectorAll("[data-sec]").forEach(s=>{s.querySelector(".ed-body").innerHTML=ED[s.dataset.sec](draft)})};
  container.oninput=e=>{const t=e.target,k=t.dataset.ed,i=+t.dataset.i;if(!k)return;
    if(k==="name")draft.name=t.value;
    else if(k==="area-name")draft.areas[i].name=t.value;
    else if(k==="area-goal")draft.areas[i].hoursGoal=parseFloat(t.value)||0;
    else if(k==="wo-rest")draft.workout.restMax=Math.max(0,Math.min(7,parseInt(t.value)||0));
    else if(k==="habit-label")draft.habits[i].label=t.value;
    else if(k==="class-name")draft.classList[i].name=t.value;
    else if(k==="class-w")draft.classList[i][t.dataset.k]=parseFloat(t.value)||0;
    else if(k==="cd-title")draft.countdowns[i].title=t.value;
    else if(k==="feed-label")draft.feeds[i].label=t.value;
    else if(k==="feed-url")draft.feeds[i].url=t.value.trim();
    else return;
    onChange(false)};
  container.onchange=e=>{const t=e.target,k=t.dataset.ed,i=+t.dataset.i;if(!k)return;
    if(k==="area-classes"){draft.areas[i].classes=t.checked;onChange(true)}
    else if(k==="cd-at"){draft.countdowns[i].at=t.value;onChange(false)}
    else if(k==="cd-area"){draft.countdowns[i].area=t.value;onChange(false)}
    else if(k==="rem-time"){draft.reminder.time=t.value||"21:30";onChange(false)}
    else if(k==="feed-type"){draft.feeds[i].type=t.value;onChange(false)}
    else if(k==="feed-area"){draft.feeds[i].area=t.value;onChange(false)}};
  container.onclick=e=>{const b=e.target.closest("button[data-ed]");if(!b)return;const k=b.dataset.ed,i=+b.dataset.i;
    if(k==="area-add"){const n=b.dataset.name;draft.areas.push({key:slug(n||"area"),name:n,hoursGoal:parseFloat(b.dataset.goal)||0,classes:!!b.dataset.classes,color:(()=>{const used=new Set(draft.areas.map(a=>a.color||0));for(let c=0;c<PALETTE.length;c++)if(!used.has(c))return c;return draft.areas.length%PALETTE.length})()})}
    else if(k==="area-del")draft.areas.splice(i,1);
    else if(k==="area-color")draft.areas[i].color=((draft.areas[i].color||0)+1)%PALETTE.length;
    else if(k==="wo-on")draft.workout.on=!!b.dataset.v;
    else if(k==="rem-on")draft.reminder={...draft.reminder,on:!!b.dataset.v};
    else if(k==="habit-add")draft.habits.push({key:slug(b.dataset.name||"habit"),label:b.dataset.name});
    else if(k==="habit-del")draft.habits.splice(i,1);
    else if(k==="track")draft.track[b.dataset.k]=!!b.dataset.v;
    else if(k==="class-add")draft.classList.push({name:"",tests:50,quizzes:20,homework:30});
    else if(k==="class-del")draft.classList.splice(i,1);
    else if(k==="cd-add")draft.countdowns.push({title:"",at:"",area:""});
    else if(k==="cd-del")draft.countdowns.splice(i,1);
    else if(k==="feed-add"){const sch=draft.areas.find(a=>a.classes)||draft.areas[0];draft.feeds.push({id:slug("feed"),label:"",url:"",type:"assignments",area:sch?sch.key:""})}
    else if(k==="feed-del")draft.feeds.splice(i,1);
    else return;
    rerender();onChange(true);
    if(k.endsWith("-add")){const last=[...container.querySelectorAll(`[data-ed="${k.replace("-add","")==="area"?"area-name":k.replace("-add","")==="habit"?"habit-label":k.replace("-add","")==="class"?"class-name":k.replace("-add","")==="cd"?"cd-title":"feed-label"}"]`)].pop();if(last&&!last.value)last.focus()}
  };
  return rerender;
}
function cleanDraft(d){
  d.areas=d.areas.filter(a=>a.name.trim()).map(a=>({...a,name:a.name.trim()}));
  d.habits=d.habits.filter(h=>h.label.trim()).map(h=>({...h,label:h.label.trim()}));
  d.classList=d.classList.filter(c=>c.name.trim()).map(c=>({...c,name:c.name.trim()}));
  d.countdowns=d.countdowns.filter(c=>c.title.trim()||c.at);
  d.feeds=d.feeds.filter(f=>f.url);
  return d;
}
async function saveSettings(patch){
  const next={...cfg(),...patch};
  await db.doc("settings/main").set(next);
}

/* ---------- onboarding ---------- */
const OB=[["name","Hey! What should we call you?","Journal Junkie is your nightly check-in: log your day, keep your to-dos, and watch your streaks grow."],
  ["areas","What do you want to keep track of?",""],["workout","Workouts",""],["habits","Daily habits",""],["track","Anything else?",""],
  ["classes","Your classes","Optional. You can skip this and add them later."],["countdowns","Countdowns","Optional."],["feeds","Connect your calendars","Optional, but it's the magic part."]].concat(NATIVE?[["reminder","Want a nightly nudge?","We'll remind you to check in each night."]]:[]);
let obI=0,obDraft=null;
function startOnboarding(){
  obDraft=clone(cfg());
  const u=JJ.user();if(!obDraft.name&&u&&u.name)obDraft.name=u.name.split(" ")[0];
  if(!obDraft.areas.length)obDraft.areas=[{key:slug("School"),name:"School",hoursGoal:1,classes:true,color:0},{key:slug("Personal"),name:"Personal",hoursGoal:0,classes:false,color:2}];
  if(!obDraft.habits.length)obDraft.habits=[{key:slug("ate"),label:"Ate well"}];
  obI=0;$("onboard").hidden=false;renderOb();
}
function renderOb(){
  const [k,title,sub]=OB[obI];
  if(k==="classes"&&!obDraft.areas.some(a=>a.classes)){obI+=($("obNext").dataset.dir==="back"?-1:1);return renderOb()}
  $("obProg").style.width=((obI+1)/OB.length*100)+"%";
  $("obTitle").textContent=title;$("obSub").textContent=sub;$("obSub").hidden=!sub;
  $("obBody").innerHTML=`<div data-sec="${k}" class="ed-sec"><div class="ed-body">${ED[k](obDraft)}</div></div>`;
  edHandle($("obBody"),obDraft,()=>{});
  $("obBack").hidden=obI===0;
  $("obNext").textContent=obI===OB.length-1?"Let's go":"Next";
  const f=$("obBody").querySelector("input");if(f&&k==="name")setTimeout(()=>f.focus(),50);
}
$("obNext").onclick=async()=>{
  $("obNext").dataset.dir="next";
  if(OB[obI][0]==="areas"&&!obDraft.areas.some(a=>a.name.trim())){toast("Add at least one area");return}
  if(obI<OB.length-1){obI++;renderOb();window.scrollTo(0,0);return}
  const d=cleanDraft(obDraft);d.onboarded=true;
  await db.doc("settings/main").set(d);
  $("onboard").hidden=true;toast("You're all set");
  fillForm();renderTasks();showTab("log");
  if(d.feeds.length)syncFeeds(true);
};
$("obBack").onclick=()=>{$("obNext").dataset.dir="back";if(obI>0){obI--;renderOb()}};

/* ---------- Me tab ---------- */
let meDraft=null,meTimer=null;
function renderMe(){
  if(document.activeElement&&$("tab-me").contains(document.activeElement)&&meDraft)return;
  meDraft=clone(cfg());
  const secs=[["name","You"],...(NATIVE?[["reminder","Reminder"]]:[]),["areas","Areas & daily goals"],["workout","Workouts"],["habits","Habits"],["track","Also track"],["classes","Classes & grade weights"],["countdowns","Countdowns"],["feeds","Calendar links"]];
  $("meEditor").innerHTML=secs.filter(([k])=>k!=="classes"||meDraft.areas.some(a=>a.classes)||meDraft.classList.length).map(([k,t])=>`<section data-sec="${k}"><h2>${t}</h2><div class="ed-body">${ED[k](meDraft)}</div></section>`).join("");
  edHandle($("meEditor"),meDraft,structural=>{clearTimeout(meTimer);meTimer=setTimeout(async()=>{await db.doc("settings/main").set(cleanDraft(clone(meDraft)));$("meSaved").textContent="Saved";setTimeout(()=>$("meSaved").textContent="",1500)},structural?100:700)});
  const u=JJ.user();$("meEmail").textContent=u?u.email:"";
  const ls=lastSyncAt();$("feedStatus").textContent=cfg().feeds.length?(ls?"Calendars last synced "+new Date(ls).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"Calendars not synced yet"):"No calendar links yet";
}
$("syncNow").onclick=()=>syncFeeds(true);
$("signOut").onclick=async()=>{await JJ.signOut()};
$("deleteAccount").onclick=async()=>{const b=$("deleteAccount");if(!b.dataset.arm){b.dataset.arm="1";b.textContent="Tap again to permanently delete your account";setTimeout(()=>{delete b.dataset.arm;b.textContent="Delete account"},5000);return}
  b.disabled=true;b.textContent="Deleting…";try{await JJ.deleteAccount();toast("Your account was deleted")}catch(e){toast("Couldn't delete: "+(e.message||e))}b.disabled=false;delete b.dataset.arm;b.textContent="Delete account"};
$("deleteAll").onclick=async()=>{const b=$("deleteAll");if(!b.dataset.arm){b.dataset.arm="1";b.textContent="Tap again to erase everything";setTimeout(()=>{delete b.dataset.arm;b.textContent="Erase all my data"},4000);return}
  await JJ.deleteAll();toast("All your data was erased");startOnboarding()};

/* ---------- calendar feeds ---------- */
function unfold(t){return t.replace(/\r\n/g,"\n").replace(/\n[ \t]/g,"")}
function icsUnescape(s){return s.replace(/\\n/gi,"\n").replace(/\\,/g,",").replace(/\\;/g,";").replace(/\\\\/g,"\\")}
function parseIcsDate(prop,val){
  const p=prop.toUpperCase();
  if(/VALUE=DATE(?!-)/.test(p)||/^\d{8}$/.test(val)){return{date:`${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}`,time:null}}
  const m=val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);if(!m)return null;
  let d;
  if(m[7])d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]));
  else{const tz=(p.match(/TZID=([^;:]+)/)||[])[1];d=new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]);
    if(tz){try{const asTz=new Date(d.toLocaleString("en-US",{timeZone:tz}));const diff=d-asTz;d=new Date(d.getTime()+diff)}catch(e){}}}
  return{date:ymd(d),time:d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}),allDayMidnight:d.getHours()===0&&d.getMinutes()===0};
}
function parseIcs(text){
  const out=[];let cur=null;
  for(const line of unfold(text).split("\n")){
    if(line==="BEGIN:VEVENT"){cur={};continue}
    if(line==="END:VEVENT"){if(cur)out.push(cur);cur=null;continue}
    if(!cur)continue;
    const i=line.indexOf(":");if(i<0)continue;
    const prop=line.slice(0,i),val=line.slice(i+1),name=prop.split(";")[0].toUpperCase();
    if(name==="UID")cur.uid=val.trim();
    else if(name==="SUMMARY")cur.summary=icsUnescape(val).trim();
    else if(name==="DESCRIPTION")cur.description=icsUnescape(val).trim();
    else if(name==="DTSTART")cur.start=parseIcsDate(prop,val.trim());
    else if(name==="RRULE")cur.rrule=true;
    else if(name==="STATUS")cur.status=val.trim().toUpperCase();
  }
  return out;
}
function hash(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return(h>>>0).toString(36)}
function canvasParse(summary){
  let title=summary.replace(/^[^\p{L}\p{N}]+/u,"").trim(),cls=null;
  const code=title.match(/\s*\[([^\]]+)\]\s*$/);if(code){cls=code[1].trim();title=title.slice(0,code.index).trim()}
  const course=title.match(/\s*\(([^()]+?)(?:\s*-\s*\d+)?\)\s*$/);if(course){cls=course[1].trim();title=title.slice(0,course.index).trim()}
  return{title,cls};
}
const lastSyncAt=()=>{try{return localStorage.getItem("jj:lastSync:"+(JJ.user()||{}).id)}catch(e){return null}};
let syncing=false;
async function syncFeeds(force){
  const c=cfg();if(!c.feeds.length||syncing||!JJ.user())return;
  const ls=lastSyncAt();if(!force&&ls&&Date.now()-new Date(ls)<3*3600e3)return;
  syncing=true;if(force)toast("Syncing calendars…");
  const from=addDays(today(),-1),to=addDays(today(),120);
  const byUid={};S.tasks.forEach(t=>{if(t.feedUid)byUid[t.feedUid]=t});
  const dismissed=new Set(c.dismissed||[]);
  let added=0,updated=0,errors=[];const newClasses=new Set();
  for(const f of c.feeds){
    try{
      const evs=parseIcs(await JJ.fetchFeed(f.url));
      for(const ev of evs){
        if(!ev.uid||!ev.start||!ev.summary||ev.status==="CANCELLED"||ev.rrule)continue;
        if(ev.start.date<from||ev.start.date>to)continue;
        const uid=hash(f.url)+"-"+hash(ev.uid+"|"+ev.start.date);
        const isAssign=f.type!=="events";
        let title=ev.summary,cls=null;if(isAssign){const p=canvasParse(ev.summary);title=p.title||ev.summary;cls=p.cls}
        const dueTime=ev.start.time&&!(isAssign&&ev.start.allDayMidnight)?ev.start.time:null;
        const ex=byUid[uid];
        if(ex){if(ex.due!==ev.start.date||(ex.dueTime||null)!==dueTime){await db.doc("tasks/"+ex.id).update({due:ev.start.date,dueTime});updated++}continue}
        if(dismissed.has(uid))continue;
        if(cls&&!c.classList.some(k=>k.name===cls))newClasses.add(cls);
        await db.collection("tasks").doc("f-"+uid).set({title,area:f.area||(areas()[0]||{}).key,class:cls,kind:isAssign?null:"event",
          priority:isAssign&&/exam|midterm|test|quiz|lab report/i.test(title)?"high":"med",due:ev.start.date,dueTime,repeat:null,done:false,doneDate:null,
          created:new Date().toISOString(),source:"feed",feedId:f.id,feedUid:uid,details:(ev.description||"").replace(/\n\s*\n+/g,"\n").slice(0,700),notes:"",ai:null});
        added++;
      }
    }catch(e){errors.push(`${f.label||"Calendar"}: ${e.message||e}`)}
  }
  if(newClasses.size){await saveSettings({classList:[...cfg().classList,...[...newClasses].map(n=>({name:n,tests:50,quizzes:20,homework:30}))]})}
  try{localStorage.setItem("jj:lastSync:"+JJ.user().id,new Date().toISOString())}catch(e){}
  syncing=false;
  if(errors.length)toast("Calendar problem: "+errors[0]);
  else if(force||added)toast(added?`Added ${added} item${added>1?"s":""} from your calendars`:"Calendars are up to date");
  if(tab==="me")renderMe();
}

/* ---------- sync status, sign-in, boot ---------- */
function greet(){const h=new Date().getHours(),n=cfg().name;$("hello").textContent=(h<5?"Up late":h<12?"Good morning":h<17?"Good afternoon":"Good evening")+(n?", "+n:"")}
function ago(iso){if(!iso)return"";const m=Math.round((Date.now()-new Date(iso))/60000);return m<1?"just now":m<60?m+" min ago":new Date(iso).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}
function renderSync(s){
  if(!S.loaded){const m=$("loadingMsg");if(m)m.textContent=(s.state==="offline"||s.state==="error")?"Can't reach Journal Junkie right now. Check your connection and it will load on its own.":"Opening your journal…"}const p=s.pending?` · ${s.pending} waiting`:"";
  $("sync").textContent={idle:"",syncing:"Syncing…",saving:"Saving…",synced:"Synced "+ago(s.at),offline:"Offline"+p+" · saved on this phone",error:"Couldn't sync"+p+" · tap to retry",auth:"Signed out · tap to sign in"}[s.state]||"";
  $("sync").dataset.state=s.state}
$("sync").onclick=()=>{if(JJ.status().state==="auth")JJ.signIn();else JJ.pull()};
async function doSignIn(btn,provider){btn.disabled=true;try{await JJ.signIn(provider)}catch(e){toast("Sign-in failed: "+(e.message||e))}btn.disabled=false}
$("signInBtn").onclick=()=>doSignIn($("signInBtn"),"google");
$("appleBtn").onclick=()=>doSignIn($("appleBtn"),"apple");
$("appleBtn").hidden=!(JJ.appleEnabled&&JJ.appleEnabled());

function onData(){
  if(!S.loaded)return;
  $("loading").hidden=true;
  greet();syncReminder();
  if(!dirty)fillForm();else renderChips();
  renderTasks();if(tab==="stats")renderStats();
  if(!cfg().onboarded&&$("onboard").hidden&&JJ.status().state!=="syncing")startOnboarding();
}
function boot(){
  db=JJ.db;
  JJ.onStatus(s=>{renderSync(s);if(!S.loaded&&JJ.user()&&(s.state==="synced"||((s.state==="offline"||s.state==="error")&&S.settings))){S.loaded=true;onData();syncFeeds(false)}});
  JJ.onAuth(u=>{
    $("signin").hidden=!!u;$("app").hidden=!u;$("loading").hidden=!u||S.loaded;$("signInBtn").disabled=false;$("appleBtn").disabled=false;
    if(!JJ.configured){$("signInBtn").hidden=true;$("appleBtn").hidden=true;$("notConfigured").hidden=false}
    if(!u){S.loaded=false;$("onboard").hidden=true}
  });
  db.collection("tasks").onSnapshot(s=>{S.tasks=s.docs.map(d=>({id:d.id,...d.data()})).filter(t=>!t.hidden);if(S.loaded){renderTasks();renderChips();if(tab==="stats")renderStats()}});
  db.collection("logs").onSnapshot(s=>{const m={};s.docs.forEach(d=>m[d.id]=d.data());S.logs=m;if(S.loaded){if(!dirty)fillForm();else renderChips();if(tab==="stats")renderStats()}});
  db.collection("grades").onSnapshot(s=>{S.grades=s.docs.map(d=>({id:d.id,...d.data()}));if(S.loaded){renderGradeList();if(tab==="stats")renderStats()}});
  db.doc("settings/main").onSnapshot(s=>{S.settingsExists=s.exists;S.settings=s.exists?s.data():null;if(S.loaded)onData()});
  setInterval(()=>{const t=today();if(!dirty&&curDate!==t&&!S.logs[curDate]){curDate=t;fillForm()}if(tab==="tasks")renderCountdowns();greet();renderSync(JJ.status())},60000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")syncFeeds(false)});
  showTab("log");
  JJ.init();
}
boot();
})();
