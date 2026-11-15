async function x32PlaybackEq(request,env){
 const h={'cache-control':'no-store','x-content-type-options':'nosniff'};
 const respond=(obj,status=200)=>Response.json(obj,{status,headers:h});
 if(request.method!=='POST')return respond({error:'POST required'},405);
 if(request.headers.get('origin')!==new URL(request.url).origin)return respond({error:'Invalid origin'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return respond({error:'JSON required'},415);
 let v;try{const raw=await request.text();if(raw.length>2400000)return respond({error:'Too large'},413);v=JSON.parse(raw)}catch{return respond({error:'Invalid request'},400)}
 const ch=v?.channel,roomOn=v?.useRoomMic===true,eq=v?.readback;
 if(![26,27].includes(ch)||v?.sourceKind!=='computer_playback'||typeof v?.useRoomMic!=='boolean')return respond({error:'Only X32 CH26 Mac and CH27 Windows playback supported'},422);
 if(roomOn!==Boolean(v.roomWavBase64))return respond({error:'Room audio and toggle mismatch'},422);
 if(!eq||eq.channel!==ch||typeof eq.eqOn!=='boolean'||!Array.isArray(eq.bands)||eq.bands.length!==4||
  !eq.bands.every((b,i)=>b&&Number(b.band||i+1)===i+1&&['PEQ','VEQ','LShv','HShv','LCut','HCut'].includes(b.type)&&Number.isFinite(b.frequencyHz)&&b.frequencyHz>=20&&b.frequencyHz<=20000&&Number.isFinite(b.gainDb)&&Math.abs(b.gainDb)<=15&&Number.isFinite(b.q)&&b.q>=.3&&b.q<=10))return respond({error:'A fresh four-band readback from this X32 channel is required'},422);
 function wav(base64,label){
  if(typeof base64!=='string'||base64.length<180000||base64.length>1000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw Error(label+' WAV encoding invalid');
  const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  if(data.length<44)throw Error(label+' WAV too short');
  const dv=new DataView(data.buffer,data.byteOffset,data.byteLength),tag=i=>String.fromCharCode(...data.slice(i,i+4));
  if(tag(0)!=='RIFF'||tag(8)!=='WAVE'||tag(12)!=='fmt '||tag(36)!=='data'||dv.getUint16(20,true)!==1||dv.getUint16(22,true)!==1||dv.getUint16(34,true)!==16||dv.getUint32(24,true)!==16000||dv.getUint32(40,true)!==data.length-44)throw Error(label+' must be 16kHz mono 16-bit PCM WAV');
  const count=(data.length-44)/2,duration=count/16000;if(duration<8||duration>20)throw Error(label+' must last 8–20 seconds');
  let energy=0,peak=0;const levels=[];
  for(let i=0;i<count;i+=320){let power=0,n=Math.min(320,count-i);for(let j=i;j<i+n;j++){const x=dv.getInt16(44+j*2,true)/32768;power+=x*x;energy+=x*x;peak=Math.max(peak,Math.abs(x))}levels.push(20*Math.log10(Math.max(1e-9,Math.sqrt(power/n))))}
  const sorted=[...levels].sort((a,b)=>a-b),floor=sorted[Math.floor(levels.length*.15)]||-120;
  return {base64,quality:{durationSeconds:+duration.toFixed(1),peakDbfs:+(20*Math.log10(Math.max(1e-9,peak))).toFixed(1),rmsDbfs:+(20*Math.log10(Math.max(1e-9,Math.sqrt(energy/count)))).toFixed(1),activitySeconds:+(levels.filter(x=>x>Math.max(-84,floor+8)).length*.02).toFixed(1)}};
 }
 let direct,room;try{direct=wav(v.wavBase64,'Computer');room=roomOn?wav(v.roomWavBase64,'Room'):null}catch(e){return respond({error:e.message},422)}
 if(direct.quality.peakDbfs<-65||direct.quality.activitySeconds<2.5)return respond({error:'Computer audio too quiet or inactive; confirm the Dante device and lane.',quality:direct.quality},422);
 if(direct.quality.peakDbfs>-.5)return respond({error:'Computer audio clipping; fix level before EQ.'},422);
 if(room&&(room.quality.peakDbfs<-85||room.quality.peakDbfs>-.5))return respond({error:'Room mic silent or clipping; verify room input and lane.',roomQuality:room.quality},422);
 if(!env.OPENAI_API_KEY)return respond({error:'AI audio unavailable'},503);
 const tok=request.headers.get('Cf-Access-Jwt-Assertion')||'';
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tok)));
 const key='x32-computer-eq-60-'+Array.from(bytes.slice(0,8),x=>x.toString(16).padStart(2,'0')).join('')+'-ch'+ch;
 if(env.DATA){if(await env.DATA.get(key))return respond({error:'Wait 60 seconds between checks on this computer channel'},429);try{await env.DATA.put(key,'1',{expirationTtl:60})}catch{return respond({error:'AI cooldown unavailable'},503)}}
 const release=async()=>{if(env.DATA)try{await env.DATA.delete(key)}catch{}};
 const instructions=[
  "You are an experienced Behringer X32 engineer analyzing COMPUTER PLAYBACK, not a live singer. First WAV is independently recorded program audio for mixer CH"+ch+" ("+(ch===26?"Mac, physical Input 5":"Windows PC, physical Input 6")+"). Input-to-Dante routing and pre/post EQ tap are unverified. Analyze what is actually audible: tonal balance, low-mid, intelligibility and harshness. Mastered computer playback usually requires little or no EQ. Do not invent issues or blindly EQ a flat reference. You have the current X32 band readback; propose a safe ABSOLUTE target for EACH of four mixer EQ bands. Avoid more than 6dB change per band and do not change HPF. If no clearly audible program signal, sourceDetected:false and suggestions:[]; confidence low.",
  roomOn?"Second WAV is a room recording from a selectable, UNVERIFIED Dante source reportedly attached to room mic X32 CH28 / Input 15. Room audio during worship may contain FULL MIX, not the isolated computer playback. Only use ambient audio to influence this specific computer's EQ when clearly attributable. You MUST return roomAssessment={audibleRoomObservations:string of >=25 characters describing real room content,impactOnEQ:string of >=25 characters explaining HOW room affected or deliberately did not affect the channel-EQ recommendations,limitations:string >=15 characters,computerSourceAudibleInRoom:boolean}. If full mix prevents attribution, mark false, base proposed EQ on the direct input alone. No verified PA response measurement.":"No room audio provided; do not claim to hear room.",
  "Return valid JSON only: {sourceDetected:boolean,confidence:'low'|'medium'|'high',summary:string,audibleFindings:string[],suggestions:exactly four objects {band:1|2|3|4,type:'PEQ'|'VEQ'|'LShv'|'HShv'|'LCut'|'HCut',frequencyHz:number,gainDb:number,q:number,reason:string},roomAssessment:object|null}. Empty suggestions when undetected. Do not include Markdown."
 ].join(" ");
 const content=[{type:'text',text:'FIRST: computer program channel '+ch+'. Current EQ: '+JSON.stringify(eq)},{type:'input_audio',input_audio:{data:direct.base64,format:'wav'}}];
 if(room)content.push({type:'text',text:'SECOND: optional ROOM mic reported as CH28 Input15 (Dante lane not verified). Compare cautiously; could contain entire worship mix.'},{type:'input_audio',input_audio:{data:room.base64,format:'wav'}});
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),70000);
 let model;try{model=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+env.OPENAI_API_KEY,'content-type':'application/json'},body:JSON.stringify({model:'gpt-audio-1.5',modalities:['text'],max_completion_tokens:3200,messages:[{role:'system',content:instructions},{role:'user',content}]}),signal:ctrl.signal})}catch{await release();return respond({error:'AI playback analysis failed or timed out. Mixer unchanged.'},503)}finally{clearTimeout(timer)}
 if(!model.ok){await release();return respond({error:'AI playback model responded HTTP '+model.status+'. Mixer unchanged.'},503)}
 let data;try{data=await model.json()}catch{await release();return respond({error:'AI playback response unreadable'},502)}
 const message=data.choices?.[0]?.message||{},t=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(x=>x.text||'').join(''):'';
 let parsed;try{const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a<0||b<a)throw Error('invalid');parsed=JSON.parse(t.slice(a,b+1))}catch{await release();return respond({error:'AI did not return valid EQ JSON. No suggestion accepted.'},502)}
 const clip=x=>String(x||'').trim().slice(0,320);
 let roomAssessment=null;
 if(roomOn){
  const ra=parsed.roomAssessment;
  if(!ra||typeof ra.audibleRoomObservations!=='string'||ra.audibleRoomObservations.trim().length<25||
   typeof ra.impactOnEQ!=='string'||ra.impactOnEQ.trim().length<25||typeof ra.limitations!=='string'||ra.limitations.trim().length<15||
   typeof ra.computerSourceAudibleInRoom!=='boolean'){await release();return respond({error:'AI could not explain what the room mic heard and how it affected EQ; suggestion withheld.'},502)}
  roomAssessment={audibleRoomObservations:clip(ra.audibleRoomObservations),impactOnEQ:clip(ra.impactOnEQ),limitations:clip(ra.limitations),computerSourceAudibleInRoom:ra.computerSourceAudibleInRoom};
 }
 const detected=parsed.sourceDetected===true,confidence=['low','medium','high'].includes(parsed.confidence)?parsed.confidence:'low',suggestions=Array.isArray(parsed.suggestions)?parsed.suggestions:[];
 const valid=suggestions.length===4&&new Set(suggestions.map(x=>x?.band)).size===4&&suggestions.every(x=>x&&Number.isInteger(x.band)&&x.band>=1&&x.band<=4&&['PEQ','VEQ','LShv','HShv','LCut','HCut'].includes(x.type)&&Number.isFinite(x.frequencyHz)&&x.frequencyHz>=20&&x.frequencyHz<=20000&&Number.isFinite(x.gainDb)&&Math.abs(x.gainDb)<=15&&Number.isFinite(x.q)&&x.q>=.3&&x.q<=10);
 const safe=valid&&suggestions.every(x=>Math.abs(x.gainDb-eq.bands[x.band-1].gainDb)<=6.25);
 const warnings=['Pre/post-EQ and physical Dante source attribution unverified. Modeled EQ adjustments must be auditioned.'];
 if(roomOn)warnings.push('Room mic may contain all PA sources. Do not EQ this computer feed to correct unrelated room or loudspeaker issues.');
 if(valid&&!safe)warnings.push('Suggested gain differs by over 6 dB; Apply disabled.');
 return respond({channel:ch,sourceKind:'computer_playback',sourceName:ch===26?'Mac Audio':'Windows PC Audio',physicalInput:ch===26?5:6,sourceDetected:detected,confidence,summary:clip(parsed.summary),audibleFindings:Array.isArray(parsed.audibleFindings)?parsed.audibleFindings.slice(0,5).map(clip):[],suggestions:valid?suggestions.sort((a,b)=>a.band-b.band).map(x=>({...x,reason:clip(x.reason)})):[],roomMicUsed:roomOn,roomAssessment,quality:direct.quality,roomQuality:room?.quality||null,preEqTapVerified:false,postEqTapVerified:false,roomMicRouteVerified:false,reviewComplete:detected&&confidence!=='low'&&valid&&safe,writesAllowed:false,safetyWarnings:warnings});
}