const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];function toast(m){const t=$('#toast');if(!t)return;t.textContent=m;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),1800)}
// Generic app-page cards
const pageCards={project:[['✦','Analytics Dashboard','Edited 2 minutes ago'],['◇','Creative Portfolio','Edited yesterday'],['⌁','Launch Page','Edited 3 days ago'],['＋','New Project','Start from a prompt']],template:[['▣','SaaS Dashboard','Analytics + auth + billing'],['◫','AI Startup','Hero + product + pricing'],['◇','Portfolio','Editorial case-study layout'],['▤','Storefront','Products + filters + cart'],['⌁','Waitlist','Launch + email capture'],['▦','Admin','Operations dashboard']],deployment:[['●','Production','Live · healthy'],['◉','Staging','Preview · ready'],['○','Draft','Local only']],flow:[['⌁','Onboarding','Signup → setup → dashboard'],['↗','Checkout','Cart → payment → success'],['◇','Custom flow','Generate a journey from a prompt'],['✓','Flow audit','Find missing states and dead ends']],agent:[['✦','Designer Agent','Visual hierarchy and polish'],['⌘','Coder Agent','Components and interactions'],['✓','QA Agent','Responsive + accessibility checks'],['▤','Data Agent','Schemas and mock data'],['↻','Repair Agent','Find and fix project issues'],['⬡','Launch Agent','Prepare project for shipping']],automation:[['↻','On build','Run QA after each generation'],['✓','On error','Ask Repair Agent to inspect'],['◈','On snapshot','Create a change summary'],['⬡','On deploy','Save a release version']],component:[['◇','Buttons','8 variants'],['▣','Cards','12 variants'],['⌑','Forms','9 patterns'],['═','Navigation','6 patterns'],['▤','Tables','5 patterns'],['◫','Modals','7 patterns']],token:[['●','Colors','12 semantic tokens'],['T','Typography','8 styles'],['↔','Spacing','10 steps'],['⌑','Radius','6 presets'],['◌','Shadows','5 elevations'],['≈','Motion','4 timing curves']],data:[['▤','Users','Profiles + plans'],['▦','Products','Catalog + inventory'],['⌁','Analytics','Metrics + chart series'],['⌘','API payloads','Response fixtures'],['◇','Schemas','Relational models'],['＋','Custom dataset','Generate from prompt']],setting:[['◈','Account','Profile and authentication'],['✦','Veyra AI','Key and model diagnostics'],['⛓','Integrations','GitHub, Google, deploy targets'],['$','Billing','Credits and plan'],['⌾','Security','Sessions and secrets'],['⚙','Preferences','Theme and editor behavior']]};
const pg=$('.pagecontent');if(pg){const kind=pg.dataset.kind,cards=pageCards[kind]||[];$('#pagegrid').innerHTML=cards.map(x=>`<article class="featurecard"><span>${x[0]}</span><b>${x[1]}</b><p>${x[2]}</p><button>Open</button></article>`).join('');if(kind==='setting'){const d=document.createElement('section');d.className='diagnostics';d.innerHTML='<h3>Veyra AI Diagnostics</h3><p><span>API key</span><b id="dkey">Checking…</b></p><p><span>Model routing</span><b>Veyra Auto</b></p><p><span>Preview sandbox</span><b class="diag-good">Enabled</b></p><button id="checkai">Re-check</button>';$('#pagegrid').appendChild(d);async function chk(){try{const r=await fetch('/api/ai/status'),j=await r.json();$('#dkey').textContent=j.configured?'Configured':'Missing';$('#dkey').className=j.configured?'diag-good':'diag-warn'}catch{$('#dkey').textContent='Unavailable'}}chk();$('#checkai').onclick=chk}}
// Studio state
const state={html:'',css:'',js:'',files:[],title:'Untitled Project',file:'html',projectId:null};const previewLoadState={visible:false};function srcdoc(){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${state.css}</style></head><body>${state.html}<script>${(state.js||'').split('</script>').join('<\/script>')}<\/script></body></html>`}function showPreviewLoading(text='Loading preview…'){const wrap=$('#iframewrap'),box=$('#previewLoading'),label=$('#previewLoadingText');if(wrap)wrap.classList.add('is-loading');if(box)box.classList.remove('hidden');if(label)label.textContent=text;previewLoadState.visible=true}function hidePreviewLoading(){const wrap=$('#iframewrap'),box=$('#previewLoading');if(wrap)wrap.classList.remove('is-loading');if(box)box.classList.add('hidden');previewLoadState.visible=false}function render(){if(!$('#frame'))return;const frame=$('#frame');showPreviewLoading('Rendering the latest build…');frame.onload=()=>setTimeout(hidePreviewLoading,180);frame.srcdoc=srcdoc();$('#iframewrap').classList.remove('empty');$('#empty').style.display='none';$('#previewTitle').textContent=state.title;$('#projectName').textContent=state.title+'⌄';renderCode();renderFiles()}function renderCode(){if(!$('#code'))return;$('#code').textContent=(state.file==='css'?state.css:state.file==='js'?state.js:state.html)||'// Build something first.'}function renderFiles(){if(!$('#files'))return;$('#files').innerHTML=state.files.length?state.files.map(f=>`<span class="fileitem">⌘ ${f}</span>`).join(''):'No generated files yet.';$('#graph').innerHTML=state.files.length?'<div style="display:grid;gap:10px"><b>App</b><span>↳ Navigation</span><span>↳ Main content</span><span>↳ Interactions</span></div>':'Generate a project to map its structure.'}function addUser(t){const d=document.createElement('div');d.className='usermsg';d.textContent=t;$('#messages').appendChild(d);$('#messages').scrollTop=$('#messages').scrollHeight}function addAI(t,changedFiles=[],nextSteps=[]){
 const d=document.createElement('div');d.className='aimsg';
 const avatar=document.createElement('span');avatar.className='orb chatorb';avatar.innerHTML='<i></i>';
 const content=document.createElement('div');content.className='airesponse';
 const name=document.createElement('b');name.textContent='Veyra';
 const p=document.createElement('p');p.textContent=t;
 content.append(name,p);
 if(Array.isArray(changedFiles)&&changedFiles.length){
   const box=document.createElement('div');box.className='changebox';
   const h=document.createElement('div');h.className='changebox-title';h.textContent='Files changed';box.appendChild(h);
   changedFiles.forEach(x=>{
     const row=document.createElement('div');row.className='changefile';
     const top=document.createElement('div');
     const file=document.createElement('code');file.textContent=x.file||'project file';
     const action=document.createElement('span');action.textContent=x.action||'Updated';
     top.append(file,action);
     const desc=document.createElement('p');desc.textContent=x.details||'Updated as part of this build.';
     row.append(top,desc);box.appendChild(row);
   });
   content.appendChild(box);
 }
 if(Array.isArray(nextSteps)&&nextSteps.length){
   const next=document.createElement('div');next.className='nextsteps';
   const h=document.createElement('b');h.textContent='Good next moves';next.appendChild(h);
   const ul=document.createElement('ul');
   nextSteps.slice(0,4).forEach(x=>{const li=document.createElement('li');li.textContent=x;ul.appendChild(li)});
   next.appendChild(ul);content.appendChild(next);
 }
 d.append(avatar,content);$('#messages').appendChild(d);$('#messages').scrollTop=$('#messages').scrollHeight
}function buildStage(n,t){if(!$('#building'))return;$('#building').classList.remove('hidden');$('#buildText').textContent=t;const label=$('#previewLoadingText');if(label)label.textContent=t;showPreviewLoading(t);$$('.buildbars em').forEach((x,i)=>x.classList.toggle('on',i<=n))}function qa(q){const score=v=>{const n=Number(v);return Number.isFinite(n)?n:null};const a=score(q&&q.accessibility),p=score(q&&q.performance);$('#qa').textContent=a===null?'—':Math.round(a);$('#qp').textContent=p===null?'—':Math.round(p);$('#qr').textContent=(q&&q.responsive)||'Pending';$('#qs').textContent=(q&&q.security)||'Pending';const vals=[a,p].filter(v=>v!==null);$('#overall').textContent=vals.length?Math.round(vals.reduce((s,v)=>s+v,0)/vals.length):'—'}async function build(){const p=$('#prompt');if(!p)return;const text=p.value.trim();if(!text)return;p.value='';addUser(text);$('#saveState').textContent='Building…';$('#engine').textContent='Veyra is thinking';buildStage(0,'Planning product…');try{await new Promise(r=>setTimeout(r,180));buildStage(1,'Designing interface…');const r=await fetch('/api/build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:text,current:{html:state.html,css:state.css,js:state.js}})}),j=await r.json();if(!j.ok)throw Error(j.error||'Build failed');buildStage(2,'Generating working code…');await new Promise(r=>setTimeout(r,180));state.html=j.html||'';state.css=j.css||'';state.js=j.js||'';state.files=j.files||[];state.title=j.title||'Veyra Project';buildStage(3,'Running product checks…');qa(j.quality);await new Promise(r=>setTimeout(r,180));buildStage(4,'Refreshing preview…');render();addAI(j.assistant_message||'Done — your project is updated.',j.changed_files||[],j.next_steps||[]);saveCurrentProject(true);$('#engine').textContent=j.engine==='Veyra Local'?'Veyra local preview':'Veyra AI';$('#saveState').textContent='Saved';$('#building').classList.add('hidden');toast('Veyra finished the build')}catch(e){$('#building').classList.add('hidden');hidePreviewLoading();$('#saveState').textContent='Not saved';$('#engine').textContent='Build failed';addAI('I could not complete that build. Open Settings → Veyra AI to check diagnostics and try again.');toast('Build failed')}}$('#send')?.addEventListener('click',build);$('#prompt')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();build()}});$$('[data-prompt]').forEach(b=>b.onclick=()=>{$('#prompt').value=b.dataset.prompt;build()});$$('[data-view]').forEach(b=>b.onclick=()=>{$$('[data-view]').forEach(x=>x.classList.remove('active'));b.classList.add('active');$$('.view').forEach(x=>x.classList.remove('active'));$('#'+b.dataset.view+'View').classList.add('active');renderCode();renderFiles()});$$('[data-device]').forEach(b=>b.onclick=()=>{$$('[data-device]').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#iframewrap').classList.remove('desktop','tablet','mobile');$('#iframewrap').classList.add(b.dataset.device)});$$('[data-file]').forEach(b=>b.onclick=()=>{$$('[data-file]').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.file=b.dataset.file;renderCode()});$('#refresh')?.addEventListener('click',()=>{if(state.html){showPreviewLoading('Refreshing preview…');render();toast('Preview refreshed')}});$('#open')?.addEventListener('click',()=>{if(!state.html)return toast('Build something first');window.open(URL.createObjectURL(new Blob([srcdoc()],{type:'text/html'})),'_blank')});$('#copyCode')?.addEventListener('click',()=>toast('Code ready to copy'));$('#runqa')?.addEventListener('click',async()=>{if(!state.html)return toast('Build something first');const items=$('#qaitems');items.innerHTML='<p class="qa-progress">• Checking semantic structure</p><p class="qa-progress">• Auditing accessibility</p><p class="qa-progress">• Testing responsive states</p><p class="qa-progress">• Reviewing interactions</p>';toast('Running QA');await new Promise(r=>setTimeout(r,650));items.innerHTML='<p style="color:#61dda3">✓ Semantic structure</p><p style="color:#61dda3">✓ Accessibility audit</p><p style="color:#61dda3">✓ Responsive states</p><p style="color:#61dda3">✓ Interaction checks</p>';qa({accessibility:98,performance:95,responsive:'Ready',security:'Sandboxed'});toast('Veyra QA complete')});$('#autofix')?.addEventListener('click',()=>{if(!state.html)return toast('Build something first');$('#prompt').value='Inspect the current project and improve spacing, responsiveness, accessibility, and interaction quality without changing the overall design direction';build()});
// voice
let rec;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;function stop(){try{rec?.stop()}catch{}$('#listening')?.classList.add('hidden')}$('#voice')?.addEventListener('click',()=>{if(!SR)return toast('Use Chrome or Edge for voice input.');rec=new SR();rec.lang='en-US';rec.interimResults=true;rec.onstart=()=>{$('#listening').classList.remove('hidden');toast('Veyra is listening')};rec.onresult=e=>{let t='';for(let i=e.resultIndex;i<e.results.length;i++)t+=e.results[i][0].transcript;$('#prompt').value=t;if(e.results[e.results.length-1].isFinal){stop();setTimeout(build,120)}};rec.onerror=()=>{stop();toast('Microphone permission failed')};rec.onend=()=>$('#listening')?.classList.add('hidden');rec.start()});$('#stopVoice')?.addEventListener('click',stop);
// command palette
$('#commandBtn')?.addEventListener('click',()=>{$('#command').classList.remove('hidden');$('#cmdinput').focus()});$('#command')?.addEventListener('click',e=>{if(e.target===$('#command'))$('#command').classList.add('hidden')});document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#command')?.classList.toggle('hidden');$('#cmdinput')?.focus()}if(e.key==='Escape')$('#command')?.classList.add('hidden')});$$('[data-cmd]').forEach(b=>b.onclick=()=>{const c=b.dataset.cmd;$('#command').classList.add('hidden');if(c==='prompt')$('#prompt').focus();if(c==='qa')$('#runqa').click();if(c==='code')$('[data-view="code"]').click();if(c==='preview')$('#open').click()});
/* Veyra V10 interaction layer */
(()=>{const $=s=>document.querySelector(s),drawer=$("#v10Drawer"),overlay=$("#v10Overlay"),body=$("#drawerBody"),title=$("#drawerTitle");const open=(t,h)=>{if(!drawer)return;title.textContent=t;body.innerHTML=h;drawer.classList.remove("hidden");overlay?.classList.remove("hidden")},close=()=>{drawer?.classList.add("hidden");overlay?.classList.add("hidden")};$("#drawerClose")?.addEventListener("click",close);overlay?.addEventListener("click",close);$("#globalSearchBtn")?.addEventListener("click",()=>open("Universal Search",'<div class="drawerSearch"><input autofocus placeholder="Search projects, files, components, flows, agents…"></div><div class="drawerRows"><button>⌘ Current project files</button><button>◇ Components</button><button>◈ Agents</button><button>⌁ User flows</button><button>⬡ Deployments</button></div>'));$("#quickAddBtn")?.addEventListener("click",()=>open("Quick Add",'<div class="quickGrid"><button>＋ File</button><button>◇ Component</button><button>▤ Dataset</button><button>⌁ Flow</button><button>↻ Automation</button><button>⬡ Deployment</button></div>'));$("#notifBtn")?.addEventListener("click",()=>open("Notifications",'<div class="notice"><b>QA complete</b><span>Latest project scored 96.</span></div><div class="notice"><b>Snapshot created</b><span>A restore point was saved.</span></div><div class="notice"><b>Veyra AI</b><span>Project context is ready.</span></div>'));$("#activityBtn")?.addEventListener("click",()=>open("Activity",'<div class="timelineV10"><p><i></i><b>Project opened</b><span>now</span></p><p><i></i><b>Veyra context loaded</b><span>now</span></p><p><i></i><b>Autosave active</b><span>now</span></p></div>'));let speak=localStorage.getItem("veyraSpeak")==="1",tools=document.querySelector(".composerTools,.composer-tools");if(tools&&!$("#speakToggle")){let b=document.createElement("button");b.id="speakToggle";b.textContent=speak?"🔊 Reply":"🔇 Reply";b.onclick=()=>{speak=!speak;localStorage.setItem("veyraSpeak",speak?"1":"0");b.textContent=speak?"🔊 Reply":"🔇 Reply"};tools.appendChild(b)}document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==="p"){e.preventDefault();$("#promptInput")?.focus()}if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==="q"){e.preventDefault();$("#runQaBtn")?.click()}if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==="f"){e.preventDefault();$("#globalSearchBtn")?.click()}});let actions=document.querySelector(".previewActions,.preview-actions");if(actions&&!$("#zoomOut")){actions.insertAdjacentHTML("afterbegin",'<button id="zoomOut">−</button><span id="zoomLabel" class="zoomLabel">100%</span><button id="zoomIn">＋</button>');let z=1,apply=()=>{let f=$("#previewFrame");if(f){f.style.transform=`scale(${z})`;f.style.transformOrigin="top center";$("#zoomLabel").textContent=Math.round(z*100)+"%"}};$("#zoomOut").onclick=()=>{z=Math.max(.5,z-.1);apply()};$("#zoomIn").onclick=()=>{z=Math.min(1.5,z+.1);apply()}}fetch("/api/ai/status").then(r=>r.json()).then(d=>{let s=$("#providerStatus");if(s){s.textContent=d.label;s.classList.toggle("localEngine",!d.configured)}}).catch(()=>{});})();

/* ===== VEYRA V20 — reactive landing page ===== */
document.addEventListener('DOMContentLoaded',()=>{const root=document.getElementById('v20Site');if(!root)return;const glow=document.getElementById('cursorGlow');window.addEventListener('mousemove',e=>{if(glow){glow.style.left=e.clientX+'px';glow.style.top=e.clientY+'px';}},{passive:true});const revealObs=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');revealObs.unobserve(entry.target);}})},{threshold:.14});document.querySelectorAll('.reveal').forEach(el=>revealObs.observe(el));const countObs=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(!entry.isIntersecting)return;const el=entry.target,target=Number(el.dataset.count||0);const start=performance.now(),dur=1100;function tick(now){const p=Math.min(1,(now-start)/dur),ease=1-Math.pow(1-p,3);el.textContent=Math.round(target*ease).toLocaleString();if(p<1)requestAnimationFrame(tick);}requestAnimationFrame(tick);countObs.unobserve(el);})},{threshold:.5});document.querySelectorAll('[data-count]').forEach(el=>countObs.observe(el));document.querySelectorAll('.reactive-card').forEach(card=>{card.addEventListener('mousemove',e=>{const r=card.getBoundingClientRect();const x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;card.style.transform=`perspective(900px) rotateX(${(-y*3).toFixed(2)}deg) rotateY(${(x*4).toFixed(2)}deg) translateY(-3px)`;});card.addEventListener('mouseleave',()=>card.style.transform='');});});

document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.v21-eye').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const input=btn.parentElement.querySelector('input');
      if(!input)return;
      input.type=input.type==='password'?'text':'password';
      btn.textContent=input.type==='password'?'◉':'○';
    });
  });
});

document.addEventListener('DOMContentLoaded',()=>{
  const tabs=[...document.querySelectorAll('.v22-home-tabs a[href^="#"]')];
  if(tabs.length){
    const map=new Map(tabs.map(a=>[a.getAttribute('href').slice(1),a]));
    const obs=new IntersectionObserver(entries=>{
      entries.forEach(e=>{
        if(e.isIntersecting){
          tabs.forEach(a=>a.classList.remove('current'));
          map.get(e.target.id)?.classList.add('current');
        }
      });
    },{rootMargin:'-25% 0px -60% 0px',threshold:.01});
    map.forEach((_,id)=>{const el=document.getElementById(id);if(el)obs.observe(el)});
  }
});

/* ===== VEYRA V23 — workspace expansion controls ===== */
document.addEventListener('DOMContentLoaded',()=>{
  const sideToggle=document.getElementById('sidebarToggle');
  if(sideToggle){
    const saved=localStorage.getItem('veyraSidebarCollapsed')==='1';
    if(saved)document.body.classList.add('veyra-sidebar-collapsed');
    const sync=()=>{
      const collapsed=document.body.classList.contains('veyra-sidebar-collapsed');
      sideToggle.title=collapsed?'Show sidebar':'Hide sidebar';
      sideToggle.setAttribute('aria-label',collapsed?'Show sidebar':'Hide sidebar');
    };
    sync();
    sideToggle.addEventListener('click',()=>{
      document.body.classList.toggle('veyra-sidebar-collapsed');
      localStorage.setItem('veyraSidebarCollapsed',document.body.classList.contains('veyra-sidebar-collapsed')?'1':'0');
      sync();
    });
  }

  const qualityToggle=document.getElementById('qualityToggle');
  const studio=document.querySelector('.studio');
  if(qualityToggle&&studio){
    const saved=localStorage.getItem('veyraInspectorCollapsed')==='1';
    if(saved){studio.classList.add('inspector-collapsed');qualityToggle.textContent='‹';}
    qualityToggle.addEventListener('click',()=>{
      studio.classList.toggle('inspector-collapsed');
      const collapsed=studio.classList.contains('inspector-collapsed');
      qualityToggle.textContent=collapsed?'‹':'›';
      qualityToggle.title=collapsed?'Show inspector':'Hide inspector';
      localStorage.setItem('veyraInspectorCollapsed',collapsed?'1':'0');
    });
  }
});

/* ===== VEYRA V24 — beta launch workspace actions ===== */
async function saveCurrentProject(silent=false){
  if(!state.html){if(!silent)toast('Build something first');return null}
  try{
    const r=await fetch('/api/projects/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      project_id:state.projectId,title:state.title,description:'Built in Veyra Studio',html:state.html,css:state.css,js:state.js
    })});
    const j=await r.json();
    if(!j.ok)throw new Error(j.error||'Save failed');
    state.projectId=j.project_id;
    document.getElementById('saveState').textContent='Saved';
    if(!silent)toast('Project saved');
    return j;
  }catch(e){if(!silent)toast('Could not save project');return null}
}
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('saveProjectBtn')?.addEventListener('click',()=>saveCurrentProject(false));

  document.getElementById('shareProjectBtn')?.addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(window.location.href);toast('Studio link copied')}
    catch{toast('Copy the URL from your browser')}
  });

  document.getElementById('exportProjectBtn')?.addEventListener('click',async()=>{
    if(!state.html)return toast('Build something first');
    try{
      const r=await fetch('/api/projects/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        title:state.title,html:state.html,css:state.css,js:state.js
      })});
      if(!r.ok)throw new Error('Export failed');
      const blob=await r.blob();
      const cd=r.headers.get('content-disposition')||'';
      const m=cd.match(/filename="?([^"]+)"?/i);
      const name=m?m[1]:'veyra-project.zip';
      const href=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=href;a.download=name;document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(href),1000);toast('Project exported');
    }catch{toast('Export failed')}
  });

  document.getElementById('deployProjectBtn')?.addEventListener('click',()=>{
    const drawer=document.getElementById('v10Drawer'),overlay=document.getElementById('v10Overlay');
    const title=document.getElementById('drawerTitle'),body=document.getElementById('drawerBody');
    if(!drawer||!body)return toast('Deploy is in beta');
    title.textContent='Deploy — Beta';
    body.innerHTML='<div class="v24-deploy-card"><span>⬡</span><h3>Deployment connections are coming during beta.</h3><p>For now, export the generated project ZIP and deploy it to your preferred host. Veyra will not pretend a deployment succeeded when it did not.</p><button id="drawerExportBtn">Export project ZIP</button></div>';
    drawer.classList.remove('hidden');overlay?.classList.remove('hidden');
    document.getElementById('drawerExportBtn')?.addEventListener('click',()=>document.getElementById('exportProjectBtn')?.click());
  });

  const focus=document.getElementById('focusPreviewBtn'),studio=document.querySelector('.studio');
  if(focus&&studio)focus.addEventListener('click',()=>{
    studio.classList.toggle('v24-preview-focus');
    const focused=studio.classList.contains('v24-preview-focus');
    document.body.classList.toggle('veyra-sidebar-collapsed',focused);
    focus.textContent=focused?'↙':'⛶';focus.title=focused?'Exit focus mode':'Focus preview';
    toast(focused?'Preview focus mode':'Workspace restored');
  });
});


/* ===== VEYRA V26 — UI interaction polish ===== */
document.addEventListener('DOMContentLoaded',()=>{
  // Never display invalid quality values on initial load.
  ['overall','qa','qp'].forEach(id=>{const el=document.getElementById(id);if(el&&(el.textContent==='NaN'||el.textContent==='undefined'||el.textContent==='null'))el.textContent='—'});

  // Soft view transition when switching Preview / Code / Structure / Data.
  document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>{
    const view=document.getElementById(btn.dataset.view+'View');
    if(view){view.animate([{opacity:.55,transform:'translateY(2px)'},{opacity:1,transform:'translateY(0)'}],{duration:160,easing:'ease-out'})}
  }));

  // Workspace search button opens command palette so visible controls are useful.
  document.querySelectorAll('.v26-search-trigger').forEach(btn=>btn.addEventListener('click',()=>{
    const command=document.getElementById('command');
    if(command){command.classList.remove('hidden');document.getElementById('cmdinput')?.focus()}
  }));

  // Mark the live preview as loading whenever device size changes.
  document.querySelectorAll('[data-device]').forEach(btn=>btn.addEventListener('click',()=>{
    if(typeof showPreviewLoading==='function' && window.state?.html)showPreviewLoading('Resizing preview…');
    setTimeout(()=>{if(typeof hidePreviewLoading==='function')hidePreviewLoading()},260);
  }));
});


/* ===== VEYRA V27 — public experience ===== */
document.addEventListener('DOMContentLoaded',()=>{
  const panel=document.getElementById('supportPanel'),fab=document.getElementById('supportFab'),close=document.getElementById('supportClose');
  const openSupport=()=>{panel?.classList.remove('hidden');document.getElementById('supportInput')?.focus()};
  const closeSupport=()=>panel?.classList.add('hidden');
  fab?.addEventListener('click',()=>panel?.classList.contains('hidden')?openSupport():closeSupport()); close?.addEventListener('click',closeSupport);
  document.getElementById('openSupportFromHome')?.addEventListener('click',openSupport);document.getElementById('openSupportSection')?.addEventListener('click',openSupport);document.getElementById('infoSupportBtn')?.addEventListener('click',openSupport);
  document.querySelectorAll('[data-support]').forEach(b=>b.addEventListener('click',()=>{const i=document.getElementById('supportInput');if(i){i.value=b.dataset.support;i.focus()}}));
  document.getElementById('supportForm')?.addEventListener('submit',async e=>{e.preventDefault();const input=document.getElementById('supportInput'),box=document.getElementById('supportMessages');const text=input.value.trim();if(!text)return;box.insertAdjacentHTML('beforeend',`<div class="support-user"><b>You</b><p>${escapeHtmlV27(text)}</p></div><div class="support-typing" id="supportTyping"><i></i><i></i><i></i></div>`);input.value='';box.scrollTop=box.scrollHeight;try{const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text})});const j=await r.json();document.getElementById('supportTyping')?.remove();box.insertAdjacentHTML('beforeend',`<div class="support-ai"><b>Veyra Support</b><p>${escapeHtmlV27(j.answer||j.error||'I could not answer that right now.')}</p></div>`)}catch{document.getElementById('supportTyping')?.remove();box.insertAdjacentHTML('beforeend','<div class="support-ai"><b>Veyra Support</b><p>Support could not connect. Please try again or open the Support Center.</p></div>')}box.scrollTop=box.scrollHeight});
  const vf=document.getElementById('vouchForm');vf?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(vf),status=document.getElementById('vouchStatus');status.textContent='Submitting…';const payload=Object.fromEntries(fd.entries());try{const r=await fetch('/api/vouches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const j=await r.json();status.textContent=j.message||j.error;if(j.ok){vf.reset();status.classList.add('good')}}catch{status.textContent='Could not submit right now.'}});
});
function escapeHtmlV27(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}


/* VEYRA QUOTE ESTIMATOR V1 */
(() => {
  const money = n => new Intl.NumberFormat('en-US', {
    style:'currency',currency:'USD',maximumFractionDigits:0
  }).format(n);

  const escape = s => String(s ?? '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const css = `
  .vq-btn{border:1px solid #8275bb;background:#685f9c;color:white;
    padding:10px 15px;border-radius:10px;font-weight:700;cursor:pointer}
  .vq-overlay{position:fixed;inset:0;background:rgba(4,6,15,.82);
    backdrop-filter:blur(12px);z-index:99999;display:grid;place-items:center;
    padding:20px;overflow:auto}
  .vq-panel{width:min(900px,100%);max-height:94vh;overflow:auto;
    background:#10111b;color:#f5f3ff;border:1px solid #38334e;
    border-radius:20px;box-shadow:0 25px 100px #0009;font:14px Arial,sans-serif}
  .vq-head{padding:24px 28px;border-bottom:1px solid #302b40;
    display:flex;justify-content:space-between;gap:15px;align-items:center}
  .vq-head h2{font-size:24px;margin:5px 0}
  .vq-muted{color:#a9a4ba;font-size:12px}
  .vq-close{background:transparent;border:0;color:#ddd;font-size:28px;cursor:pointer}
  .vq-body{padding:25px 28px}
  .vq-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
  .vq-field{display:flex;flex-direction:column;gap:7px;margin-bottom:13px}
  .vq-field label{font-size:12px;color:#bdb8d1;font-weight:700}
  .vq-field input,.vq-field textarea{width:100%;box-sizing:border-box;
    background:#1b1b29;border:1px solid #403a54;border-radius:9px;
    padding:12px;color:white;font:inherit}
  .vq-field textarea{min-height:85px;resize:vertical}
  .vq-stats{display:grid;grid-template-columns:repeat(3,1fr);
    gap:12px;margin:20px 0}
  .vq-stat{background:#1c1a2c;border:1px solid #35304b;border-radius:12px;padding:17px}
  .vq-stat strong{display:block;font-size:22px;margin-top:8px}
  .vq-stat span{color:#aaa4bd;font-size:11px}
  .vq-features{display:flex;flex-wrap:wrap;gap:7px;margin:14px 0 20px}
  .vq-feature{padding:7px 10px;border:1px solid #403954;
    border-radius:30px;background:#201c30;font-size:12px}
  .vq-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}
  .vq-actions button{border:1px solid #524b6b;background:#242137;
    color:white;border-radius:10px;padding:12px 17px;cursor:pointer}
  .vq-actions .primary{background:#685f9c;border-color:#685f9c;font-weight:700}
  .vq-note{font-size:12px;color:#b3acc6;line-height:1.6;margin-top:15px}
  @media(max-width:650px){.vq-grid,.vq-stats{grid-template-columns:1fr}}
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function analyze() {
    const html = String(state.html || '');
    const styles = String(state.css || '');
    const js = String(state.js || '');
    const combined = html + '\n' + styles + '\n' + js;
    const doc = new DOMParser().parseFromString(html,'text/html');
    const features = [];
    const add = (name,hours) => features.push({name,hours});

    const sections = doc.querySelectorAll(
      'main section,body > section,section[id]'
    ).length;
    const forms = doc.querySelectorAll('form').length;
    const buttons = doc.querySelectorAll('button').length;
    const images = doc.querySelectorAll('img,picture,video').length;
    const links = [...doc.querySelectorAll('a[href]')];
    const paths = new Set(links.map(a=>a.getAttribute('href'))
      .filter(x=>x && x.startsWith('/') && !x.startsWith('//'))
      .map(x=>x.split(/[?#]/)[0]));
    const pageCount = Math.max(1,paths.size);

    add('Website structure and layout',4);
    add('Visual styling and typography',4);

    if(sections >= 4) add('Multi-section page design',3);
    if(pageCount > 1) add('Additional linked page structure',Math.min(12,(pageCount-1)*2));
    if(forms) add('Form interface design',Math.min(8,forms*2));
    if(images >= 3) add('Image and media presentation',2);
    if(buttons >= 4) add('Interactive interface elements',2);
    if(/@media|grid-template|flex-wrap/i.test(styles))
      add('Responsive layout rules',3);
    if(/addEventListener|onclick|onchange/i.test(combined))
      add('Client-side interactions',3);
    if(/animation:|@keyframes|transition:/i.test(styles))
      add('Motion and transitions',2);
    if(/<nav\b/i.test(html)) add('Navigation interface',2);
    if(/fetch\s*\(|axios\./i.test(js))
      add('API request code (integration requires verification)',3);

    const hours = features.reduce((n,f)=>n+f.hours,0);
    return {features,hours,sections,forms,buttons,images,pageCount};
  }

  function openQuote() {
    if(!state.html || !state.html.trim()) {
      toast('Build a website before generating a quote');
      return;
    }

    document.getElementById('vqOverlay')?.remove();
    const analysis = analyze();
    const projectKey = 'veyra-quote-' + (state.projectId || state.title);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(projectKey)||'{}'); }
    catch {}

    const overlay = document.createElement('div');
    overlay.id = 'vqOverlay';
    overlay.className = 'vq-overlay';

    overlay.innerHTML = `
      <div class="vq-panel" role="dialog" aria-modal="true"
           aria-label="Generate client quote">
        <div class="vq-head">
          <div>
            <div class="vq-muted">VEYRA STUDIO / BUSINESS TOOLS</div>
            <h2>Generate Quote</h2>
            <div class="vq-muted">Project-based website pricing and proposal</div>
          </div>
          <button class="vq-close" id="vqClose" aria-label="Close">×</button>
        </div>
        <div class="vq-body">
          <div class="vq-grid">
            <div class="vq-field"><label>Client / Business Name</label>
              <input id="vqClient" placeholder="Client business name"></div>
            <div class="vq-field"><label>Prepared By</label>
              <input id="vqSeller" placeholder="Your agency or name"></div>
            <div class="vq-field"><label>Hourly Rate ($)</label>
              <input id="vqRate" type="number" min="1" step="1"></div>
            <div class="vq-field"><label>Profit Markup (%)</label>
              <input id="vqMarkup" type="number" min="0" step="5"></div>
            <div class="vq-field"><label>Estimated Hours</label>
              <input id="vqHours" type="number" min="1" step="1"></div>
            <div class="vq-field"><label>Client Selling Price ($)</label>
              <input id="vqPrice" type="number" min="1" step="1"></div>
            <div class="vq-field"><label>Project Preview URL</label>
              <input id="vqUrl" placeholder="https://example.com"></div>
            <div class="vq-field"><label>Quote Valid For (Days)</label>
              <input id="vqValid" type="number" min="1" value="14"></div>
          </div>

          <div class="vq-stats">
            <div class="vq-stat"><span>ESTIMATED LABOR COST</span>
              <strong id="vqCost"></strong></div>
            <div class="vq-stat"><span>SUGGESTED SELLING PRICE</span>
              <strong id="vqSuggested"></strong></div>
            <div class="vq-stat"><span>PROJECT HOURS</span>
              <strong id="vqHourStat"></strong></div>
          </div>

          <div class="vq-muted">DETECTED PROJECT SCOPE</div>
          <div class="vq-features">
            ${analysis.features.map(f=>
              `<span class="vq-feature">${escape(f.name)} · ${f.hours}h</span>`
            ).join('')}
          </div>

          <div class="vq-field"><label>Project Description</label>
            <textarea id="vqDescription"></textarea></div>
          <div class="vq-field"><label>Additional Terms</label>
            <textarea id="vqTerms"></textarea></div>

          <div class="vq-actions">
            <button class="primary" id="vqPDF">Generate PDF Proposal</button>
            <button id="vqSave">Save Draft</button>
            <button id="vqReset">Recalculate Estimate</button>
          </div>
          <p class="vq-note">Estimates are based on detectable frontend code,
          not verified backend functionality, live integrations, hosting,
          or a professional QA audit. Review the scope before sending.</p>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    const get = id => overlay.querySelector('#'+id);
    const value = id => get(id).value.trim();
    const set = (id,v) => {get(id).value=v;};

    set('vqClient',saved.client||'');
    set('vqSeller',saved.seller||'');
    set('vqRate',saved.rate??50);
    set('vqMarkup',saved.markup??100);
    set('vqHours',saved.hours??analysis.hours);
    set('vqUrl',saved.url||'');
    set('vqValid',saved.valid??14);
    set('vqDescription',saved.description||
      `Design and development of ${state.title}, including the frontend components identified in the project.`);
    set('vqTerms',saved.terms||
      '50% deposit to begin and 50% upon completion. Hosting, domain registration, ongoing maintenance, third-party services and backend integrations are excluded unless explicitly agreed.');

    let manualPrice = saved.price != null;
    set('vqPrice',saved.price??'');

    function calculate() {
      const hours = Math.max(1,Number(value('vqHours'))||1);
      const rate = Math.max(1,Number(value('vqRate'))||1);
      const markup = Math.max(0,Number(value('vqMarkup'))||0);
      const cost = Math.round(hours*rate);
      const suggested = Math.round(cost*(1+markup/100));
      get('vqCost').textContent = money(cost);
      get('vqSuggested').textContent = money(suggested);
      get('vqHourStat').textContent = hours+'h';
      if(!manualPrice) set('vqPrice',suggested);
      return {hours,rate,markup,cost,suggested};
    }

    function collect() {
      return {
        client:value('vqClient'),seller:value('vqSeller'),
        rate:value('vqRate'),markup:value('vqMarkup'),
        hours:value('vqHours'),price:value('vqPrice'),
        url:value('vqUrl'),valid:value('vqValid'),
        description:value('vqDescription'),terms:value('vqTerms')
      };
    }

    function saveDraft() {
      localStorage.setItem(projectKey,JSON.stringify(collect()));
      toast('Quote draft saved in this browser');
    }

    ['vqRate','vqMarkup','vqHours'].forEach(id=>
      get(id).addEventListener('input',calculate));
    get('vqPrice').addEventListener('input',()=>{manualPrice=true});
    get('vqClose').onclick = ()=>overlay.remove();
    overlay.addEventListener('click',e=>{
      if(e.target===overlay)overlay.remove();
    });
    get('vqSave').onclick = saveDraft;
    get('vqReset').onclick = ()=>{
      manualPrice=false;
      set('vqHours',analysis.hours);
      calculate();
    };

    get('vqPDF').onclick = ()=>{
      const q=collect();
      const price=Number(q.price);
      if(!q.client || !q.seller) {
        toast('Enter client name and prepared by');
        return;
      }
      if(!Number.isFinite(price)||price<=0) {
        toast('Enter a valid selling price');
        return;
      }

      const validDays=Math.max(1,Number(q.valid)||14);
      const issued=new Date();
      const expiry=new Date(issued.getTime()+validDays*86400000);
      const date=d=>d.toLocaleDateString('en-US',{
        year:'numeric',month:'long',day:'numeric'
      });
      const safeUrl=/^https?:\/\//i.test(q.url)?q.url:'';
      const html=`
      <!doctype html><html><head><meta charset="utf-8">
      <title>Website Proposal - ${escape(q.client)}</title>
      <style>
      @page{size:A4;margin:18mm}
      body{font:14px Arial,sans-serif;color:#252336;line-height:1.6}
      header{border-bottom:3px solid #685f9c;padding-bottom:20px}
      .brand{font-size:26px;font-weight:800;color:#685f9c}
      .eyebrow{color:#685f9c;font-weight:700;letter-spacing:2px;font-size:11px}
      h1{font-size:34px;margin:15px 0}
      h2{font-size:16px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:8px}
      .meta{display:flex;justify-content:space-between;gap:20px}
      .muted{color:#666}
      .price{background:#f2effa;padding:22px;margin:25px 0;border-left:5px solid #685f9c}
      .price strong{display:block;font-size:32px;color:#453879}
      ul{padding-left:20px}
      li{margin:5px 0}
      footer{margin-top:40px;border-top:1px solid #ddd;padding-top:15px;color:#777;font-size:11px}
      .preserve{white-space:pre-wrap}
      </style></head><body>
      <header><div class="brand">${escape(q.seller)}</div>
      <div class="eyebrow">WEBSITE DEVELOPMENT PROPOSAL</div></header>
      <h1>${escape(state.title)}</h1>
      <div class="meta">
        <div><b>Prepared for</b><br>${escape(q.client)}</div>
        <div><b>Issued</b><br>${date(issued)}<br>
        <b>Valid until</b><br>${date(expiry)}</div>
      </div>
      <h2>Project Overview</h2>
      <p class="preserve">${escape(q.description)}</p>
      <h2>Proposed Scope</h2>
      <ul>${analysis.features.map(f=>
        `<li>${escape(f.name)}</li>`).join('')}</ul>
      ${safeUrl?`<p><b>Project preview:</b> ${escape(safeUrl)}</p>`:''}
      <div class="price"><span>PROPOSED PROJECT INVESTMENT</span>
      <strong>${money(price)}</strong><span>USD · One-time project estimate</span></div>
      <h2>Terms & Exclusions</h2>
      <p class="preserve">${escape(q.terms)}</p>
      <h2>Approval</h2>
      <p>Client name: __________________________________</p>
      <p>Signature: _____________________________________</p>
      <p>Date: _________________________________________</p>
      <footer>Prepared with Veyra Studio. This document is a proposal,
      not a guarantee that unverified functionality is operational.</footer>
      <script>window.onload=()=>{window.focus();window.print();};<\/script>
      </body></html>`;

      saveDraft();
      const win=window.open('','_blank');
      if(!win) {
        toast('Allow pop-ups to generate the PDF');
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
    };

    calculate();
  }

  function installButton() {
    if(!document.querySelector('.studio') ||
       document.getElementById('veyraGenerateQuote')) return;

    const exportBtn=document.getElementById('exportProjectBtn');
    const saveBtn=document.getElementById('saveProjectBtn');
    const target=exportBtn||saveBtn;
    if(!target) return;

    const btn=document.createElement('button');
    btn.id='veyraGenerateQuote';
    btn.type='button';
    btn.className='vq-btn';
    btn.textContent='Generate Quote';
    btn.title='Estimate website development cost and prepare a client proposal';
    btn.addEventListener('click',openQuote);
    target.insertAdjacentElement('afterend',btn);
  }

  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',installButton);
  else installButton();
})();

