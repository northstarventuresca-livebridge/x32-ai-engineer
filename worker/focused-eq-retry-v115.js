// If the first audio reply lost its four-band numeric targets, re-listen to the SAME
// direct microphone clip with a short EQ-only task. The formatting model is not
// permitted to invent missing targets, and its "no targets recoverable" result is
// NOT evidence that there was no singer or speaker.
let eqRetryStatus='not_needed',eqRetryFailure=null;
const validEqTargets=a=>Array.isArray(a)&&a.length===4&&
 new Set(a.map(x=>x?.band)).size===4&&
 a.every(x=>x&&Number.isInteger(x.band)&&x.band>=1&&x.band<=4&&
  ['PEQ','VEQ','LShv','HShv','LCut','HCut'].includes(x.type)&&
  !(x.band===4&&x.type==='LCut')&&
  typeof x.frequencyHz==='number'&&Number.isFinite(x.frequencyHz)&&x.frequencyHz>=20&&x.frequencyHz<=20000&&
  typeof x.gainDb==='number'&&Number.isFinite(x.gainDb)&&x.gainDb>=-15&&x.gainDb<=15&&
  typeof x.q==='number'&&Number.isFinite(x.q)&&x.q>=.3&&x.q<=10);
const incompleteEq=normalizerUsed&&/no safe eq targets|no safe eq|not recoverable|no eq targets/i.test(String(parsed?.summary||''))||
 parsed?.voiceDetected===true&&!validEqTargets(parsed?.suggestions);
if(!isSyntheticSmokeTest&&incompleteEq){
 eqRetryStatus='failed';
 const eqRetrySystem=
 'You are a professional live engineer listening to ONE selected X32 DIRECT microphone. The user needs a conservative voice-specific 4-band EQ STARTING POINT, not a fabricated optimum. Listen carefully. First determine whether the selected voice is actually clearly audible as '+
 (analysisMode==='singing'?'SINGING':'SPEAKING')+
 ', distinguishing it from background, bleed, noise or silence. If there is no clear selected voice, return voiceDetected:false, confidence:"low", summary explaining why, suggestions:[], bandReviews:[], audibleFindings:[], hpfReview:"Not assessable", hpfSuggestion:null. '+
 'If audible, return ONLY a compact valid JSON object with exactly: voiceDetected:true; confidence:"medium" or "high"; summary one sentence; audibleFindings array of up to 3 short strings; bandReviews array of four {band:1..4,assessment:string}; hpfReview one sentence; suggestions exactly four objects, one per band 1,2,3,4, each {band:integer,type:"PEQ"|"VEQ"|"LShv"|"HShv"|"LCut"|"HCut",frequencyHz:number,gainDb:number,q:number,reason:string}; hpfSuggestion:null. '+
 'For targets, frequencyHz 20..20000, gainDb -15..15, Q 0.3..10; avoid low cut as band 4. Neutral/unmodified target bands are allowed; do not force boosts or changes. The X32 channel may already be EQ processed: tap is unverified. Do not claim you measured PA, room acoustics, post-EQ output or feedback stability. No mixer actions. JSON ONLY, no code fences or commentary.';
 const retryBody={model:'gpt-audio-1.5',store:false,modalities:['text'],max_completion_tokens:2200,
  messages:[{role:'system',content:eqRetrySystem},
   {role:'user',content:[{type:'text',text:'Direct '+analysisMode+' microphone WAV for channel '+ch+'. Analyze this actual audio and provide a four-band voice-specific EQ target only when warranted.'},
    {type:'input_audio',input_audio:{data:encoded,format:'wav'}}]}]};
 const eqCtl=new AbortController(),eqTimeout=setTimeout(()=>eqCtl.abort(),42000);
 try{
  const res=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',
   headers:{authorization:'Bearer '+env.OPENAI_API_KEY,'content-type':'application/json'},
   body:JSON.stringify(retryBody),signal:eqCtl.signal});
  if(!res.ok){eqRetryFailure='Audio retry HTTP '+res.status;}
  else{
   const response2=await res.json(),m=response2?.choices?.[0]?.message||{};
   const raw2=(typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.map(p=>p.text||'').join(''):'').trim();
   const parsed2=parseVoiceReport(raw2).report;
   const confidentVoice=parsed2.voiceDetected===true&&['medium','high'].includes(parsed2.confidence);
   const genuineNoVoice=parsed2.voiceDetected===false&&parsed2.confidence==='low'&&
      Array.isArray(parsed2.suggestions)&&parsed2.suggestions.length===0&&
      typeof parsed2.summary==='string'&&parsed2.summary.length>12;
   if(confidentVoice&&validEqTargets(parsed2.suggestions)||genuineNoVoice){
    // Room and dynamics independently supplied by the first call are retained if present.
    parsed={...parsed,...parsed2,
      roomAssessment:parsed2.roomAssessment||parsed.roomAssessment,
      dynamicsReview:parsed2.dynamicsReview||parsed.dynamicsReview};
    eqRetryStatus=genuineNoVoice?'no_clear_voice':'recovered';
    eqRetryFailure=null;
   }else{
    eqRetryFailure='Focused audio retry did not contain four complete EQ bands or a defensible no-voice finding';
   }
  }
 }catch(e){eqRetryFailure='Focused audio retry could not be completed: '+(e?.name==='AbortError'?'timeout':String(e?.message||e).slice(0,90))}
 finally{clearTimeout(eqTimeout)}
 if(eqRetryStatus==='failed'){
  console.warn('X32 focused EQ retry unavailable',eqRetryFailure);
  // Prevent an "output format failed" placeholder from being presented as
  // an actual audio finding that there was no voice.
  parsed={...parsed,voiceDetected:false,confidence:'low',
   summary:'AI did not return a valid four-band voice EQ result after automatic audio retry. This is an analysis error, not evidence that the channel EQ is good or that speech was absent.',
   suggestions:[],bandReviews:[]};
 }
}
