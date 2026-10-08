/* Journal Junkie data store.
   Each user's data lives in Supabase table `docs` (user_id, coll, id, data jsonb), protected by RLS.
   Exposes a small Firestore-like API (collection/doc, set/update/delete/add, onSnapshot) used by app.js.
   Writes apply locally right away, queue in localStorage, and flush to Supabase in order; offline is fine.
   Test mode: window.JJ_CONFIG.url === "mock" keeps everything in localStorage. */
(function(){
  const CFG=window.JJ_CONFIG||{};
  const MOCK=CFG.url==="mock";
  const COLLS=["tasks","logs","grades","settings"];
  const K=k=>"jj:"+k;
  const lsGet=(k,d)=>{try{const v=localStorage.getItem(K(k));return v==null?d:JSON.parse(v)}catch(e){return d}};
  const lsSet=(k,v)=>{try{localStorage.setItem(K(k),JSON.stringify(v))}catch(e){}};
  const lsDel=k=>{try{localStorage.removeItem(K(k))}catch(e){}};

  const configured=MOCK||!!(CFG.url&&CFG.anonKey&&window.supabase);
  const sb=configured&&!MOCK?window.supabase.createClient(CFG.url,CFG.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:"pkce"}}):null;

  let user=null;                       // {id, email, name}
  let server={};                       // {coll: {id: data}} as last loaded
  let queue=[];
  let view={};
  const listeners=[], statusFns=[], authFns=[];
  let status={state:"idle",at:null,pending:0,error:null};

  const clone=x=>x==null?x:JSON.parse(JSON.stringify(x));
  const isObj=x=>x&&typeof x==="object"&&!Array.isArray(x);
  function merge(a,b){const o=isObj(a)?{...a}:{};for(const k of Object.keys(b)){o[k]=isObj(b[k])&&isObj(o[k])?merge(o[k],b[k]):b[k]}return o}
  function applyOp(docs,o){
    if(o.op==="set")docs[o.doc]=clone(o.data);
    else if(o.op==="update"){if(docs[o.doc])docs[o.doc]=merge(docs[o.doc],o.data)}
    else if(o.op==="delete")delete docs[o.doc];
  }
  function rebuild(){view={};for(const c of COLLS)view[c]=clone(server[c]||{});for(const o of queue)applyOp(view[o.coll]||(view[o.coll]={}),o)}
  function setStatus(p){status={...status,...p,pending:queue.length};statusFns.forEach(f=>{try{f(status)}catch(e){}})}
  function userKey(k){return user?k+":"+user.id:k}
  function saveLocal(){if(!user)return;lsSet(userKey("server"),server);lsSet(userKey("queue"),queue)}
  function loadLocal(){server=lsGet(userKey("server"),{});queue=lsGet(userKey("queue"),[]);rebuild()}

  /* ---------- snapshots ---------- */
  function snapDoc(id,d){const data=d===undefined?undefined:Object.freeze(clone(d));return{id,exists:d!==undefined,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}}}
  function emit(coll){
    for(const l of listeners){
      if(coll&&l.coll!==coll)continue;
      const docs=view[l.coll]||{};
      try{
        if(l.doc!==undefined)l.fn(snapDoc(l.doc,docs[l.doc]));
        else{
          let arr=Object.keys(docs).map(id=>snapDoc(id,docs[id]));
          if(l.order){const[f,dir]=l.order;arr.sort((a,b)=>{const x=a.data()[f],y=b.data()[f];if(x===y)return 0;if(x===undefined)return 1;if(y===undefined)return -1;return(x<y?-1:1)*(dir==="desc"?-1:1)})}
          if(l.limit)arr=arr.slice(0,l.limit);
          l.fn({docs:arr,size:arr.length,empty:!arr.length});
        }
      }catch(e){console.error(e)}
    }
  }
  const emitAll=()=>COLLS.forEach(emit);

  /* ---------- backend ---------- */
  async function remoteLoad(){
    if(MOCK)return lsGet("mockdb",{});
    const out={};let from=0;
    for(;;){
      const {data,error}=await sb.from("docs").select("coll,id,data").order("coll").order("id").range(from,from+999);
      if(error)throw error;
      for(const r of data)(out[r.coll]=out[r.coll]||{})[r.id]=r.data;
      if(data.length<1000)break;from+=1000;
    }
    return out;
  }
  async function remoteApply(o,docAfter){
    if(MOCK){const m=lsGet("mockdb",{});const c=m[o.coll]=m[o.coll]||{};if(docAfter===undefined)delete c[o.doc];else c[o.doc]=docAfter;lsSet("mockdb",m);return}
    if(docAfter===undefined){
      const {error}=await sb.from("docs").delete().match({user_id:user.id,coll:o.coll,id:o.doc});if(error)throw error;
    }else{
      const {error}=await sb.from("docs").upsert({user_id:user.id,coll:o.coll,id:o.doc,data:docAfter,updated_at:new Date().toISOString()});if(error)throw error;
    }
  }

  let pulling=null;
  async function pull(){
    if(!user)return;if(pulling)return pulling;
    pulling=(async()=>{
      try{
        setStatus({state:queue.length?"saving":"syncing",error:null});
        const remote=await remoteLoad();
        server={};for(const c of COLLS)server[c]=remote[c]||{};
        rebuild();saveLocal();emitAll();
        setStatus({state:queue.length?"saving":"synced",at:new Date().toISOString()});
        if(queue.length)flush();
      }catch(e){handleErr(e)}finally{pulling=null}
    })();
    return pulling;
  }
  function handleErr(e){
    console.warn(e);
    if(!navigator.onLine||(e&&(e.name==="TypeError"||/fetch/i.test(e.message||""))))setStatus({state:"offline"});
    else if(e&&(e.status===401||/JWT|auth/i.test(e.message||"")))setStatus({state:"auth",error:"Sign in again"});
    else setStatus({state:"error",error:(e&&e.message)||"Sync error"});
  }
  let flushing=false,flushTimer=null;
  function scheduleFlush(){clearTimeout(flushTimer);flushTimer=setTimeout(flush,500)}
  async function flush(){
    if(!user||flushing||!queue.length)return;
    flushing=true;setStatus({state:"saving"});
    try{
      while(queue.length){
        const o=queue[0];
        const c=server[o.coll]=server[o.coll]||{};
        const tmp={...c};applyOp(tmp,o);
        await remoteApply(o,tmp[o.doc]);
        if(tmp[o.doc]===undefined)delete c[o.doc];else c[o.doc]=tmp[o.doc];
        queue.shift();saveLocal();
      }
      rebuild();setStatus({state:"synced",at:new Date().toISOString(),error:null});
    }catch(e){handleErr(e)}
    finally{flushing=false}
  }
  function enqueue(coll,op,doc,data){
    if(!user){const e=new Error("Not signed in");e.code="auth";return Promise.reject(e)}
    if(op==="update"&&!(view[coll]&&view[coll][doc])){const e=new Error("Missing");e.code="invalid_argument";return Promise.reject(e)}
    const o={coll,op,doc,data:data===undefined?undefined:clone(data)};
    queue.push(o);saveLocal();
    applyOp(view[coll]||(view[coll]={}),o);emit(coll);
    setStatus({state:"saving"});scheduleFlush();
    return Promise.resolve();
  }
  const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,10);

  function docRef(coll,id){
    return{id,path:coll+"/"+id,
      get:async()=>snapDoc(id,(view[coll]||{})[id]),
      set:d=>enqueue(coll,"set",id,d),update:d=>enqueue(coll,"update",id,d),delete:()=>enqueue(coll,"delete",id),
      onSnapshot(fn){const l={coll,doc:id,fn};listeners.push(l);setTimeout(()=>emit(coll),0);return()=>{const i=listeners.indexOf(l);if(i>=0)listeners.splice(i,1)}}};
  }
  function query(coll,order,limit){
    return{orderBy:(f,dir)=>query(coll,[f,dir||"asc"],limit),limit:n=>query(coll,order,n),
      onSnapshot(fn){const l={coll,order,limit,fn};listeners.push(l);setTimeout(()=>emit(coll),0);return()=>{const i=listeners.indexOf(l);if(i>=0)listeners.splice(i,1)}},
      doc:id=>docRef(coll,id||newId()),
      add:async d=>{const id=newId();await enqueue(coll,"set",id,d);return docRef(coll,id)},
      all:()=>Object.entries(view[coll]||{}).map(([id,d])=>({id,...clone(d)}))};
  }
  const db={collection:n=>query(n),doc:p=>{const[c,id]=p.split("/");return docRef(c,id)}};

  /* ---------- auth ---------- */
  function setUser(u){
    const prev=user&&user.id;
    user=u?{id:u.id,email:u.email||"",name:(u.user_metadata&&(u.user_metadata.full_name||u.user_metadata.name))||""}:null;
    if(user&&user.id!==prev){loadLocal();emitAll();pull()}
    if(!user){server={};queue=[];rebuild();emitAll()}
    authFns.forEach(f=>{try{f(user)}catch(e){}});
  }
  async function initAuth(){
    if(!configured){authFns.forEach(f=>f(null));return}
    if(MOCK){const u=lsGet("mockuser",null);setUser(u);return}
    const {data}=await sb.auth.getSession();
    setUser(data.session?data.session.user:null);
    sb.auth.onAuthStateChange((_e,session)=>{const u=session?session.user:null;if((u&&u.id)!==(user&&user.id))setUser(u)});
  }

  window.JJ={
    db,configured,
    user:()=>user,
    async signIn(){
      if(MOCK){const u={id:"mock-user",email:"friend@example.com",user_metadata:{full_name:"Test Friend"}};lsSet("mockuser",u);setUser(u);return}
      const redirectTo=location.origin+location.pathname;
      const {error}=await sb.auth.signInWithOAuth({provider:"google",options:{redirectTo,queryParams:{prompt:"select_account"}}});
      if(error)throw error;
    },
    async signOut(){if(MOCK){lsDel("mockuser")}else{await sb.auth.signOut()}setUser(null)},
    async deleteAll(){
      if(!user)return;
      if(MOCK){lsSet("mockdb",{})}else{const {error}=await sb.from("docs").delete().eq("user_id",user.id);if(error)throw error}
      server={};queue=[];saveLocal();rebuild();emitAll();
    },
    async deleteAccount(){
      if(!user)return;
      if(MOCK){lsSet("mockdb",{});lsDel("mockuser")}
      else{
        const {data,error}=await sb.functions.invoke("delete-account",{body:{}});
        if(error){let msg=error.message;try{const b=await error.context.json();if(b&&b.error)msg=b.error}catch(e){}throw new Error(msg)}
        if(data&&data.error)throw new Error(data.error);
        try{await sb.auth.signOut()}catch(e){}
      }
      try{Object.keys(localStorage).filter(k=>k.startsWith("jj:")).forEach(k=>localStorage.removeItem(k))}catch(e){}
      server={};queue=[];setUser(null);
    },
    async fetchFeed(url){
      if(MOCK){const t=(window.JJ_MOCK_ICS||{})[url];if(!t)throw new Error("No mock feed");return t}
      const {data,error}=await sb.functions.invoke("fetch-ics",{body:{url}});
      if(error){let msg=error.message;try{const b=await error.context.json();if(b&&b.error)msg=b.error}catch(e){}throw new Error(msg)}
      if(data&&data.error)throw new Error(data.error);
      return data.text;
    },
    pull,flush,status:()=>status,
    onStatus(fn){statusFns.push(fn);fn(status)},
    onAuth(fn){authFns.push(fn)},
    init:initAuth
  };
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")pull()});
  window.addEventListener("online",()=>pull());
  window.addEventListener("offline",()=>setStatus({state:"offline"}));
  setInterval(()=>{if(document.visibilityState==="visible")pull()},90000);
})();
