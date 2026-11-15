(()=>{'use strict';
if(document.getElementById('x32-one-ui'))return;
const $=id=>document.getElementById(id),engine=window.X32UnifiedEngine;
if(!engine)return;
const root=document.createElement('section');root.id='x32-one-ui';
root.innerHTML='<div class="x32-one-header"><div><div class="x32-one-eyebrow">GREAT CHURCH · AUDIO ENGINEER</div><h2>Live Microphone EQ</h2><p>Choose microphones, choose a mode, and listen.</p></div><span id="x32-one-connection"></span></div>'+
 '<div id="x32-one-connect"></div>'+
 '<div class="x32-one-subhead"><b>1 · Select microphones</b><span id="x32-one-count">None selected</span></div><div id="x32-one-channels"></div>'+
 '<label class="x32-one-room"><input type="checkbox" id="x32-one-room"> <b>Use Room Mic</b><small>Include how the sound is heard in the room</small></label>'+
 '<div class="x32-one-subhead"><b>2 · Choose a mode</b></div>'+
 '<div class="x32-one-modes">'+
 '<button type="button" data-one-mode="speaking"><b>Check EQ Speaking</b><small>Pastors · spoken voice</small></button>'+
 '<button type="button" data-one-mode="singing"><b>Check EQ Singing</b><small>Worship vocals</small></button>'+
 '<button type="button" data-one-mode="live"><b>Live Suggestions</b><small>Listen continuously · approve EQ changes</small></button>'+
 '<button type="button" data-one-mode="auto"><b>Live Auto EQ</b><small>Listen continuously · make gradual EQ changes</small></button></div>'+
 '<div class="x32-one-action"><button type="button" id="x32-one-stop" disabled>■ Stop Listening</button><strong id="x32-one-work">Ready · select microphones and choose a mode</strong></div>'+
 '<section id="x32-one-results" hidden><h3 id="x32-one-results-title">Results</h3><div id="x32-one-native-state"></div><div id="x32-one-native-results"></div></section>'+
 '<details class="x32-one-advanced"><summary>Advanced / diagnostics</summary><div id="x32-one-advanced-content"></div></details>';
const css=document.createElement('style');
css.textContent=[
 '#x32-one-ui{margin:4px 0 18px;background:linear-gradient(135deg,#113242,#081e2c);border:1px solid #397287;border-radius:18px;padding:18px;color:#e5f8fa}',
 '#x32-one-ui .x32-one-header{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:12px}',
 '#x32-one-ui h2{font-size:22px;margin:1px 0 3px}',
 '#x32-one-ui .x32-one-header p{margin:0;font-size:12px;color:#a5c6d2}',
 '#x32-one-ui .x32-one-eyebrow{font-size:10px;letter-spacing:1.5px;color:#70cbd4;font-weight:700}',
 '#x32-one-ui #x32-one-connection{font-size:12px;color:#8fe9c8}',
 '#x32-one-ui #x32-one-connect .toolbar{margin:6px 0 16px!important;padding:9px;background:#0b2534;border:1px solid #31546a;border-radius:10px}',
 '#x32-one-ui #x32-one-connect .toolbar .small{font-size:11px}',
 '#x32-one-ui #x32-one-connect input{width:min(240px,42vw)}',
 '#x32-one-ui .x32-one-subhead{display:flex;justify-content:space-between;align-items:center;margin:14px 0 10px;font-size:14px}',
 '#x32-one-ui #x32-one-count{color:#9bc9d2;font-size:12px}',
 '#x32-one-ui #x32-one-channels{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:7px}',
 '#x32-one-ui #x32-one-channels button{min-height:42px;margin:0;border-radius:9px;white-space:normal;text-align:left;font-size:13px}',
 '#x32-one-ui .x32-one-room{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:15px 0 20px;padding:11px;border:1px solid #335d6a;border-radius:10px;background:#112d37;cursor:pointer}',
 '#x32-one-ui .x32-one-room input{width:19px;height:19px;accent-color:#4bdbb2}',
 '#x32-one-ui .x32-one-room small{font-size:11px;color:#a7c6cd}',
 '#x32-one-ui .x32-one-modes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}',
 '#x32-one-ui .x32-one-modes button{padding:17px 12px;border:1px solid #3e6d7d;background:#153544;text-align:left;color:#eafffd;min-height:88px;cursor:pointer}',
 '#x32-one-ui .x32-one-modes button b{display:block;font-size:16px;margin-bottom:6px}',
 '#x32-one-ui .x32-one-modes button small{display:block;color:#b7ced8;font-size:12px;font-weight:400}',
 '#x32-one-ui .x32-one-modes button.active{border:2px solid #55e2b7;background:#195143}',
 '#x32-one-ui .x32-one-action{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:16px 0 4px}',
 '#x32-one-ui #x32-one-stop{background:#643038;border:1px solid #a65e65;color:#ffdedf}',
 '#x32-one-ui #x32-one-work{font-size:12px;font-weight:500;color:#a8d8d5}',
 '#x32-one-ui #x32-one-results{margin-top:16px;border-top:1px solid #356479;padding-top:15px}',
 '#x32-one-ui #x32-one-results>h3{font-size:15px;color:#e2f9f4}',
 '#x32-one-ui #x32-one-native-results{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:8px}',
 '#x32-one-ui .x32-one-advanced{margin-top:18px;color:#9bb7c2;font-size:12px}',
 '#x32-one-ui .x32-one-advanced summary{cursor:pointer}',
 '#x32-one-ui #x32-one-advanced-content{padding-top:8px}',
 '#x32-quick,#x32-playback-panel,#x32-multi-panel,#x32-stage,#live-panel,#log-panel,main>.tabs{display:none!important}',
 '#x32-one-ui #x32-one-advanced-content #x32-stage{display:block!important}',
 '#x32-one-ui #x32-one-advanced-content #x32-stage .board-grid{max-height:240px;overflow:auto}',
 '@media(max-width:550px){#x32-one-ui{padding:12px}#x32-one-ui .x32-one-modes{grid-template-columns:1fr}#x32-one-ui #x32-one-channels{grid-template-columns:repeat(2,minmax(0,1fr))}}'
].join('\n');
document.head.appendChild(css);
document.querySelector('main > header')?.after(root);
const pill=document.querySelector('main > header .pill');if(pill)pill.textContent='4 EQ MODES';
const strip=$('x32-board-status');if(strip)$('x32-one-connection').append(strip);
const key=$('x32-key');if(key?.parentElement)$('x32-one-connect').append(key.parentElement);
const choices=$('x32-multi-options');if(choices)$('x32-one-channels').append(choices);
const state=$('x32-multi-state'),results=$('x32-multi-results');
if(state)$('x32-one-native-state').append(state);
if(results)$('x32-one-native-results').append(results);
if($('x32-stage'))$('x32-one-advanced-content').append($('x32-stage'));
const room=$('x32-one-room'),nativeRoom=$('x32-multi-room'),stop=$('x32-one-stop'),note=$('x32-one-work'),panel=$('x32-one-results'),title=$('x32-one-results-title');
let active='idle',lastAnalysis='speaking';
function refreshSelection(){
 const ids=engine.selected();
 $('x32-one-count').textContent=ids.length?ids.length+' microphone'+(ids.length===1?'':'s')+' selected':'None selected';
 try{localStorage.setItem('x32-one-selected',JSON.stringify(ids))}catch{}
}
$('x32-one-channels').addEventListener('click',()=>setTimeout(refreshSelection,0));
try{
 const ids=JSON.parse(localStorage.getItem('x32-one-selected')||'[]');
 if(Array.isArray(ids)&&choices){
  for(const id of ids.slice(0,engine.max)){
   const el=Array.from(choices.querySelectorAll('button')).find(b=>Number(b.textContent.match(/CH(\d+)/)?.[1])===Number(id));
   if(el&&el.getAttribute('aria-pressed')!=='true')el.click();
  }
 }
}catch{}
refreshSelection();
try{const saved=localStorage.getItem('x32-one-room');room.checked=saved===null?nativeRoom?.checked===true:saved==='true'}catch{room.checked=nativeRoom?.checked===true}
function syncRoom(){
 if(nativeRoom&&nativeRoom.checked!==room.checked){nativeRoom.checked=room.checked;nativeRoom.dispatchEvent(new Event('change',{bubbles:true}))}
 try{localStorage.setItem('x32-one-room',String(room.checked))}catch{}
}
room.addEventListener('change',syncRoom);syncRoom();
function setMode(next){
 active=next;
 for(const b of root.querySelectorAll('[data-one-mode]'))b.classList.toggle('active',b.dataset.oneMode===next);
 stop.disabled=next==='idle';panel.hidden=next==='idle';
 title.textContent=next==='speaking'?'Speaking EQ results':next==='singing'?'Singing EQ results':next==='live'?'Live suggestions':'Live automatic EQ';
}
for(const b of root.querySelectorAll('[data-one-mode]'))b.onclick=()=>{
 const mode=b.dataset.oneMode,selected=engine.selected();
 if(!selected.length){note.textContent='Select at least one microphone first.';return;}
 if(mode==='speaking')lastAnalysis='speaking';
 if(mode==='singing')lastAnalysis='singing';
 engine.stop();setMode(mode);syncRoom();
 const kind=mode==='speaking'||mode==='singing'?'check':mode;
 try{
  engine.start(kind,lastAnalysis);
  note.textContent=kind==='check'?'Listening to '+selected.length+' microphone(s)…':mode==='live'?'Live suggestions · listening continuously':'Live Auto EQ · gradual verified cuts · Stop anytime';
 }catch(e){note.textContent=e.message;setMode('idle')}
};
stop.onclick=()=>{engine.stop();setMode('idle');note.textContent='Stopped. No further EQ changes will be sent.'};
$('x32-one-channels').addEventListener('click',()=>{
 if(active!=='idle'){engine.stop();setMode('idle');note.textContent='Selection changed. Choose a mode to begin.'}
});
setInterval(()=>{
 if(active!=='idle'&&engine.active()==='idle'){setMode('idle');note.textContent='Auto EQ stopped. See channel results for details.'}
 if(['speaking','singing'].includes(active)&&!engine.busy()&&/^(EQ Check Complete|Analysis Failed or Incomplete)/.test(state?.textContent||'')){
  stop.disabled=true;note.textContent=state.textContent;
 }
},900);
})();