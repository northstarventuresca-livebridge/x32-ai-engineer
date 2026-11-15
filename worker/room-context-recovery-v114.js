const clip=s=>String(s||'').slice(0,300);
let roomAssessment=null,roomAnalysisStatus=useRoomMic?'unavailable':'not_requested',roomFallbackUsed=false;
const parseRoom=rr=>{
 if(!rr||typeof rr!=='object'||Array.isArray(rr))return null;
 const audible=typeof rr.audibleRoomObservations==='string'?rr.audibleRoomObservations.trim():'';
 const influence=typeof rr.impactOnEQ==='string'?rr.impactOnEQ.trim():'';
 const limits=typeof rr.limitations==='string'&&rr.limitations.trim().length>=8?rr.limitations.trim():
   'Room sound is not a calibrated measurement of the selected microphone or its post-EQ output.';
 if(audible.length<8||influence.length<8)return null;
 return {audibleRoomObservations:clip(audible),impactOnEQ:clip(influence),limitations:clip(limits)};
};
if(useRoomMic){
 roomAssessment=parseRoom(parsed?.roomAssessment);
 if(!roomAssessment&&!isSyntheticSmokeTest){
  const roomRequest={model:'gpt-audio-1.5',store:false,modalities:['text'],max_completion_tokens:900,
   messages:[
    {role:'system',content:'You are a live sound engineer reviewing a real ROOM microphone recording. Listen to the attached audio. Return ONLY a JSON object with exactly three keys whose values are strings at least 15 characters: audibleRoomObservations, impactOnEQ, limitations. The first describes sounds ACTUALLY AUDIBLE in the recording, including uncertainty. The second explains how useful, limited, or unhelpful these sounds are for EQ of ONE selected person. The last states why a full room mix cannot isolate one microphone or verify its post-EQ PA sound. Never invent voice, instruments, calibrated data, or EQ improvements. Do not give numerical settings.'},
    {role:'user',content:[
     {type:'text',text:'Assess this room microphone audio as context for '+(analysisMode==='singing'?'singing':'speaking')+' EQ. Be explicit if the selected voice is not independently audible.'},
     {type:'input_audio',input_audio:{data:roomEncoded,format:'wav'}}
    ]}
   ]};
  const roomCtrl=new AbortController(),roomTimeout=setTimeout(()=>roomCtrl.abort(),24000);
  try{
   const res=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',
     headers:{authorization:'Bearer '+env.OPENAI_API_KEY,'content-type':'application/json'},
     body:JSON.stringify(roomRequest),signal:roomCtrl.signal});
   if(res.ok){
    const result=await res.json(),m=result.choices?.[0]?.message||{};
    const text=typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.map(x=>x.text||'').join(''):'';
    const a=text.indexOf('{'),b=text.lastIndexOf('}');
    if(a>=0&&b>a){roomAssessment=parseRoom(JSON.parse(text.slice(a,b+1)));roomFallbackUsed=!!roomAssessment;}
   }else console.warn('X32 room fallback HTTP',res.status);
  }catch(e){console.warn('X32 room fallback unavailable',String(e?.message||e).slice(0,100))}
  finally{clearTimeout(roomTimeout)}
 }
 if(roomAssessment)roomAnalysisStatus='complete';
}
