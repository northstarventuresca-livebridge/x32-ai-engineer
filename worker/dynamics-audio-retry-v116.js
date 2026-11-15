// Retry the dynamics review separately if the combined audio request or the
// focused EQ rescue omitted it. This NEVER authorizes dynamics writes.
let dynamicsRetryStatus='not_needed';
const hasDynamicsAdvice=x=>x&&typeof x==='object'&&
 typeof x.gate?.assessment==='string'&&x.gate.assessment.trim().length>=12&&
 typeof x.compressor?.assessment==='string'&&x.compressor.assessment.trim().length>=12;
if(!isSyntheticSmokeTest&&parsed.voiceDetected===true&&!hasDynamicsAdvice(parsed.dynamicsReview)){
 dynamicsRetryStatus='not_completed';
 const dynRequest={
  model:'gpt-audio-1.5',store:false,modalities:['text'],max_completion_tokens:1100,
  messages:[
   {role:'system',content:
    'You are a conservative live church sound engineer. Listen to an ACTUAL selected direct microphone audio WAV and review the gate/expander and compressor settings supplied by the X32 bridge. Judge audible cutoff of quiet word endings, noise bleed, pumping, flattened speech/singing dynamics, loudness inconsistency and clipping ONLY if supported by the recording. The input can already be processed, and you cannot know exact gain reduction, threshold headroom, or whether this is before/after dynamics. Never invent precise settings based only on generic voice averages. Return ONLY JSON of the form {"gate":{"assessment":"...","suggestedOn":null,"suggestedThresholdDb":null,"suggestedRangeDb":null,"suggestedAttackMs":null,"suggestedHoldMs":null,"suggestedReleaseMs":null,"reason":"..."},"compressor":{"assessment":"...","suggestedOn":null,"suggestedThresholdDb":null,"suggestedRatio":null,"suggestedAttackMs":null,"suggestedReleaseMs":null,"suggestedMakeupDb":null,"reason":"..."},"limitations":"..."}. Replace null suggestions with actual conservative values ONLY if the audio justifies a change; never make a guessed numeric recommendation. Make each assessment at least one useful sentence. No EQ bands, no mixer writes.'},
   {role:'user',content:[
    {type:'text',text:'Review these X32 current dynamics and actual '+analysisMode+' voice audio. Indicate current settings that should stay unchanged and where evidence is insufficient. '+JSON.stringify({channel:ch,gate:dynamicsSettings.gate,compressor:dynamicsSettings.compressor,dynamicsSource:dynamicsSettings.readbackSource,quality})},
    {type:'input_audio',input_audio:{data:encoded,format:'wav'}}
   ]}
  ]};
 const dynCtrl=new AbortController(),dynTimer=setTimeout(()=>dynCtrl.abort(),26000);
 try{
  const dynResponse=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',
   headers:{authorization:'Bearer '+env.OPENAI_API_KEY,'content-type':'application/json'},
   body:JSON.stringify(dynRequest),signal:dynCtrl.signal});
  if(dynResponse.ok){
   const out=await dynResponse.json(),message=out?.choices?.[0]?.message||{};
   const str=(typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(c=>c.text||'').join(''):'').trim();
   const a=str.indexOf('{'),b=str.lastIndexOf('}');
   if(a>=0&&b>a){
    const result=JSON.parse(str.slice(a,b+1));
    if(hasDynamicsAdvice(result)){
      parsed.dynamicsReview=result;dynamicsRetryStatus='completed';
    }
   }
  }else console.warn('X32 dynamics retry returned HTTP',dynResponse.status);
 }catch(err){console.warn('X32 dynamics review unavailable',String(err?.message||err).slice(0,110))}
 finally{clearTimeout(dynTimer)}
}
