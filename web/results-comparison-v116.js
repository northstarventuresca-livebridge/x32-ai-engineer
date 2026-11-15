/* V116 operator comparison: numbers, EQ curves, and dynamics in one result. */
function x32CompareResults(c,data,reliable){
 c.el.querySelector('.x32-audio-compare')?.remove();
 const make=(tag,cls,txt)=>{
  const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;
 };
 const fmt=(x,unit='',digits=1)=>Number.isFinite(x)?Number(x).toFixed(digits)+unit:'—';
 const yn=x=>x===true?'ON':x===false?'OFF':'—';
 const hz=x=>Number.isFinite(x)?Math.round(x)+' Hz':'—';
 const box=make('div','x32-audio-compare');
 const eq=make('section','x32-compare-section');
 eq.append(make('h4','','EQ · Before vs Suggested'));
 eq.append(make('p','x32-compare-help',reliable?'Numbers and modeled curves compare current X32 settings (red) with AI suggestions (green).':'Analysis incomplete. Showing only current mixer EQ; no AI suggestion available.'));
 const table=make('table','x32-compare-table'),head=make('thead'),header=make('tr');
 ['Band','Current on X32','AI Suggestion','What changes'].forEach(t=>header.append(make('th','',t)));
 head.append(header);table.append(head);
 const body=make('tbody');
 if(Array.isArray(c.baseline?.bands))for(let i=0;i<c.baseline.bands.length;i++){
  const old=c.baseline.bands[i],next=reliable?data.suggestions?.find(s=>s.band===i+1):null;
  const values=b=>(b?.type||'?')+' · '+hz(b?.frequencyHz)+' · '+fmt(b?.gainDb,' dB')+' · Q '+fmt(b?.q,'',2);
  const change=[];
  if(next){
   if(old.type!==next.type)change.push('Type: '+next.type);
   if(Math.abs(old.frequencyHz-next.frequencyHz)>Math.max(3,old.frequencyHz*.018))change.push('Freq: '+hz(next.frequencyHz-old.frequencyHz));
   if(Math.abs(old.gainDb-next.gainDb)>.24)change.push('Gain: '+(next.gainDb>old.gainDb?'+':'')+fmt(next.gainDb-old.gainDb,' dB'));
   if(Math.abs(old.q-next.q)>.04)change.push('Q: '+fmt(next.q-old.q,'',2));
  }
  const tr=make('tr');
  tr.append(make('td','','B'+(i+1)),make('td','x32-current',values(old)),make('td',next?'x32-suggested':'',next?values(next):'No target available'),make('td',change.length?'x32-changed':'',next?(change.join(' · ')||'No change'):'Not assessed'));
  body.append(tr);
 }
 table.append(body);eq.append(table);box.append(eq);
 const dynamics=make('section','x32-dyn-comparisons');
 dynamics.append(make('h4','','Gate & Compressor · Before vs Suggested'));
 dynamics.append(make('p','x32-compare-help','Recommendations only: Apply EQ does NOT change gate or compressor. An em dash (—) means no supported numeric adjustment was provided; it does not prove the current value is optimal.'));
 const d=data?.dynamicsReview;
 const draw=(label,current,review,kind)=>{
  const card=make('div','x32-dyn-card');
  card.append(make('h5','',label));
  const hasReview=typeof review?.assessment==='string'&&review.assessment.trim().length>8;
  card.append(make('p','x32-dyn-summary',hasReview?review.assessment:'AI dynamics audio review unavailable for this microphone.'));
  const fields=kind==='gate'?[
   ['Enabled','on','on','',null],['Threshold','thresholdDb','thresholdDb',' dB',[-80,0]],
   ['Range','rangeDb','rangeDb',' dB',null],['Attack','attackMs','attackMs',' ms',null],
   ['Hold','holdMs','holdMs',' ms',null],['Release','releaseMs','releaseMs',' ms',null]
  ]:[
   ['Enabled','on','on','',null],['Threshold','thresholdDb','thresholdDb',' dB',[-60,0]],
   ['Ratio','ratio','ratio',':1',null],['Attack','attackMs','attackMs',' ms',null],
   ['Release','releaseMs','releaseMs',' ms',null],['Makeup','makeupDb','makeupDb',' dB',null]
  ];
  const tab=make('table','x32-compare-table'),th=make('thead'),tr=make('tr');
  ['Setting','Current on X32','AI Suggestion'].forEach(t=>tr.append(make('th','',t)));
  th.append(tr);tab.append(th);const tb=make('tbody');
  const suggested=review?.suggested||{};
  for(const [title,k,sk,unit,scale] of fields){
   const orig=current?.[k],next=suggested[sk];
   const r=make('tr');
   const before=k==='on'?yn(orig):fmt(orig,unit);
   const after=next===null||next===undefined?'—':sk==='on'?yn(next):fmt(next,unit);
   r.append(make('td','',title),make('td','x32-current',before),make('td',next==null?'':'x32-suggested',after));
   tb.append(r);
   if(scale&&Number.isFinite(orig)){
    const plotRow=make('tr','x32-visual-row'),plotCell=make('td');
    plotCell.colSpan=3;
    const track=make('div','x32-threshold-track'),pct=x=>Math.max(0,Math.min(100,(x-scale[0])/(scale[1]-scale[0])*100));
    const cur=make('span','x32-threshold-now');cur.style.left=pct(orig)+'%';cur.title='Current '+fmt(orig,' dB');track.append(cur);
    if(Number.isFinite(next)){const sug=make('span','x32-threshold-ai');sug.style.left=pct(next)+'%';sug.title='AI proposed '+fmt(next,' dB');track.append(sug);}
    plotCell.append(track);plotRow.append(plotCell);tb.append(plotRow);
   }
  }
  tab.append(tb);card.append(tab);
  if(typeof review?.reason==='string'&&review.reason.trim())card.append(make('p','x32-dyn-reason',review.reason));
  return card;
 };
 dynamics.append(draw('Gate',Object.assign({},c.baseline?.gate||{},d?.gate?.current||{}),d?.gate,'gate'));
 dynamics.append(draw('Compressor',Object.assign({},c.baseline?.compressor||{},d?.compressor?.current||{}),d?.compressor,'compressor'));
 if(d?.limitations)dynamics.append(make('p','x32-compare-help',d.limitations));
 box.append(dynamics);c.notes.after(box);
 const overlay=c.el.querySelector('.x32-multi-overlay');
 if(overlay)eq.after(overlay);
}
(function(){
 if(document.getElementById('x32-compare-css'))return;
 const s=document.createElement('style');s.id='x32-compare-css';
 s.textContent=[
 '.x32-audio-compare{margin:12px 0 7px}',
 '.x32-compare-section,.x32-dyn-comparisons{margin:12px 0;padding:10px;border:1px solid #33586b;border-radius:10px;background:#0a2532;min-width:0}',
 '.x32-compare-section h4,.x32-dyn-comparisons h4{font-size:14px;margin:1px 0 7px;color:#e9f8f7}',
 '.x32-compare-help{font-size:11px;line-height:1.5;color:#abc7d0;margin:5px 0 10px}',
 '.x32-compare-table{width:100%;border-collapse:collapse;font-size:11px;line-height:1.5}',
 '.x32-compare-table th{font-weight:700;color:#aac8d0;text-align:left;border-bottom:1px solid #3b6977;padding:7px 6px}',
 '.x32-compare-table td{border-bottom:1px solid #1e4555;padding:7px 6px;vertical-align:top;overflow-wrap:anywhere}',
 '.x32-compare-table .x32-current{color:#ff9999;font-weight:650}',
 '.x32-compare-table .x32-suggested{color:#75efb8;font-weight:650}',
 '.x32-compare-table .x32-changed{color:#ffd28b}',
 '.x32-dyn-card{border:1px solid #355766;background:#0c2b37;border-radius:9px;padding:10px;margin:9px 0}',
 '.x32-dyn-card h5{font-size:14px;margin:0 0 7px}',
 '.x32-dyn-summary{font-size:12px;color:#d6e6ec;margin:0 0 10px;line-height:1.4}',
 '.x32-dyn-reason{font-size:11px;color:#b7d1d7;margin:9px 2px 0}',
 '.x32-visual-row td{padding:0 8px 7px!important}',
 '.x32-threshold-track{height:7px;position:relative;background:linear-gradient(90deg,#203e4c,#3c6671);border-radius:8px;margin:7px 5px 5px}',
 '.x32-threshold-now,.x32-threshold-ai{position:absolute;top:-3px;width:4px;height:13px;border-radius:3px;transform:translateX(-50%)}',
 '.x32-threshold-now{background:#ff7979;box-shadow:0 0 0 1px #572c33}',
 '.x32-threshold-ai{background:#62efad;box-shadow:0 0 0 1px #1d634e;top:0;width:5px;height:9px}',
 '@media(max-width:520px){.x32-compare-table{font-size:10px}.x32-compare-table td,.x32-compare-table th{padding:5px 3px}}'
 ].join('\n');
 document.head.append(s);
})();
