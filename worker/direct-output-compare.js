async function x32CompareOutput(request,env){
 const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
 const reply=(o,status=200)=>Response.json(o,{status,headers});
 if(request.method!=='POST')return reply({error:'POST required'},405);
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'Origin not allowed'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'JSON required'},415);
 let data;try{const raw=await request.text();if(raw.length>2350000)return reply({error:'Audio request too large'},413);data=JSON.parse(raw)}catch{return reply({error:'Invalid audio request'},400)}
 const ch=data?.channel,roomOn=data?.useRoomMic===true,outputOn=data?.usePostEq===true;
 if(![1,2,3,4,5,6,13,14,15,16].includes(ch)||!['speaking','singing'].includes(data?.analysisMode)||outputOn!==true||typeof data?.useRoomMic!=='boolean')return reply({error:'Select mapped vocal channel, Speaking/Singing mode and Compare Output'},422);
 if(roomOn!==Boolean(data?.roomWavBase64)||!data?.postEqWavBase64)return reply({error:'Output and room selections do not match recorded audio'},422);
 const source=data?.postEqSource;
 if(!source||source.x32Channel!==ch||![0,1].includes(source.lane)||typeof source.deviceLabel!=='string'||typeof source.userConfirmed!=='boolean')return reply({error:'Output Dante source must correspond to selected mixer channel'},422);
 const eq=data?.readback;
 if(!eq||eq.channel!==ch||!Array.isArray(eq.bands)||eq.bands.length!==4||eq.bands.some(b=>!['PEQ','VEQ','LShv','HShv','LCut','HCut'].includes(b.type)||!Number.isFinite(b.frequencyHz)||!Number.isFinite(b.gainDb)||!Number.isFinite(b.q)))return reply({error:'Current channel EQ readback required'},422);
 const types=['PEQ','VEQ','LShv','HShv','LCut','HCut'];
 function validate(encoded,label){
  if(typeof encoded!=='string'||encoded.length<180000||encoded.length>1000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error(label+': invalid audio data size or encoding');
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),four=i=>String.fromCharCode(...bytes.slice(i,i+4));
  if(bytes.length<44||four(0)!=='RIFF'||four(8)!=='WAVE'||four(12)!=='fmt '||four(36)!=='data'||view.getUint16(20,true)!==1||view.getUint16(22,true)!==1||view.getUint16(34,true)!==16||view.getUint32(24,true)!==16000||view.getUint32(40,true)!==bytes.length-44)throw Error(label+': 16 kHz PCM16 mono WAV required');
  const count=(bytes.length-44)/2,duration=count/16000;
  if(duration<8||duration>20)throw Error(label+': requires 8–20 seconds');
  let sq=0,peak=0;
  const powers=[];
  for(let i=0;i<count;i+=320){
   let partial=0;const len=Math.min(320,count-i);
   for(let j=i;j<i+len;j++){const x=view.getInt16(44+j*2,true)/32768;partial+=x*x;peak=Math.max(peak,Math.abs(x));}
   sq+=partial;powers.push(20*Math.log10(Math.max(1e-9,Math.sqrt(partial/len))));
  }
  const sorted=[...powers].sort((a,b)=>a-b),floor=sorted[Math.floor(sorted.length*.15)]||-120;
  const activity=powers.filter(v=>v>Math.max(-84,floor+8)).length*.02;
  const quality={durationSeconds:+duration.toFixed(1),peakDbfs:+(20*Math.log10(Math.max(1e-9,peak))).toFixed(1),rmsDbfs:+(20*Math.log10(Math.max(1e-9,Math.sqrt(sq/count)))).toFixed(1),activitySeconds:+activity.toFixed(1)};
  if(quality.peakDbfs>-.5)throw Error(label+' is clipping; no recommendation allowed');
  if(quality.peakDbfs<-82||activity<1.5)throw Error(label+' is too quiet for comparison');
  return {encoded,quality};
 }
 let direct,output,room;
 try{direct=validate(data.wavBase64,'Direct microphone');output=validate(data.postEqWavBase64,'Selected output');room=roomOn?validate(data.roomWavBase64,'Room microphone'):null}
 catch(e){return reply({error:e.message},422)}
 // Do not compare an identical WAV file to itself; this guards accidental copying of the direct capture.
 if(data.wavBase64===data.postEqWavBase64)return reply({error:'Output recording is identical to the input file; use a separate after-EQ feed'},422);
 if(!env.OPENAI_API_KEY)return reply({error:'Audio AI is not configured'},503);
 const auth=request.headers.get('Cf-Access-Jwt-Assertion')||'';
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(auth)));
 const key='x32-direct-output-check-60-'+Array.from(digest.slice(0,10),x=>x.toString(16).padStart(2,'0')).join('')+'-ch'+ch;
 if(env.DATA){if(await env.DATA.get(key))return reply({error:'Wait 60 seconds before repeating a direct/output comparison on this channel'},429);try{await env.DATA.put(key,'1',{expirationTtl:60})}catch{return reply({error:'AI cooldown service unavailable'},503)}}
 const unlock=async()=>{if(env.DATA)try{await env.DATA.delete(key)}catch{}};
 const system=`You are an experienced live X32 church sound engineer comparing actual separately captured audio, not just EQ curves. FIRST is the direct vocal microphone for X32 CH${ch}. SECOND is an operator-selected Dante receive stream CLAIMED to be the SAME microphone AFTER X32 EQ. This claim has NOT been independently verified from mixer routing; do NOT state the tap is verified. The latest actual X32 EQ parameters are supplied separately. THIRD, when present, is room microphone CH28/Input15 picking up PA, crowd, reflections and potentially full worship mix. Analyze whether the direct and output sounds plausibly contain the same human voice, compare tonal differences and decide how (or WHETHER) EQ ought to change. Do not ascribe different volume, dynamics, accompaniment, PA loudspeaker or reverberation differences to channel EQ. For singing, keep natural musical tone; during worship the room sound is NOT one isolated singer. No source should be called independently verified post-EQ. If voices are not clear or output not plausibly the same source, report low confidence, no suggestions and sameSourceLikely:false. If defensible, make FOUR COMPLETE absolute Behringer X32 band EQ suggestions, one for each band 1-4 with type, frequencyHz (20–20000), gainDb (-15..15), q (.3..10), and a distinct short reason. KEEP a band unchanged when no change is justified. The current band settings are available only as parameter readback and do not establish actual output tap location. Do not alter HPF or claim feedback safety. You MUST include outputAssessment:{audibleOutputObservations:string >=25 chars describing SECOND audio,differencesVsDirect:string >=25 chars explaining actual differences,impactOnEQ:string >=25 chars explaining how differences affected OR did NOT affect suggested EQ,limitations:string >=15 chars including output provenance, sameSourceLikely:boolean}. ${roomOn?'You MUST include roomAssessment:{audibleRoomObservations:string >=25 chars,impactOnEQ:string >=25 chars,limitations:string >=15 chars}. Only attribute room sound to this singer if meaningfully isolated; during worship likely not.':'No room recording was supplied, so do not invent room details.'} Return valid JSON ONLY: voiceDetected:boolean, confidence:'low'|'medium'|'high',summary:string,audibleFindings:string[],bandReviews:[{band,assessment}] for four bands when voice audible,hpfReview:string,hpfSuggestion:null,suggestions:[{band,type,frequencyHz,gainDb,q,reason}] exactly four only when supported, outputAssessment object,${roomOn?'roomAssessment object,':''} no extraneous narrative.`;
 const parts=[
  {type:'text',text:'FIRST audio DIRECT microphone. Channel '+ch+' mode '+data.analysisMode+'; X32 readback '+JSON.stringify({eqOn:eq.eqOn,hpf:eq.hpf,bands:eq.bands})+'. No mic tap verified.'},
  {type:'input_audio',input_audio:{data:direct.encoded,format:'wav'}},
  {type:'text',text:'SECOND audio CANDIDATE POST-EQ output from a distinct operator-selected Dante input. Operator-confirmed selector: '+Boolean(source.userConfirmed)+'. This does NOT prove the route is post EQ.'},
  {type:'input_audio',input_audio:{data:output.encoded,format:'wav'}}
 ];
 if(room)parts.push(
  {type:'text',text:'THIRD audio ROOM microphone CH28 physical Input15, operator-identified. May contain full church mix; compare only cautious audible room context.'},
  {type:'input_audio',input_audio:{data:room.encoded,format:'wav'}}
 );
 const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),70000);
 let response;try{response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+env.OPENAI_API_KEY,'content-type':'application/json'},body:JSON.stringify({model:'gpt-audio-1.5',store:false,modalities:['text'],max_completion_tokens:4200,messages:[{role:'system',content:system},{role:'user',content:parts}]}),signal:abort.signal})}
 catch{await unlock();return reply({error:'The three-way audio comparison did not finish; mixer unchanged'},503)}
 finally{clearTimeout(timeout)}
 if(!response.ok){await unlock();return reply({error:'Audio model rejected output comparison (HTTP '+response.status+'); no EQ applied'},503)}
 let obj;try{obj=await response.json()}catch{await unlock();return reply({error:'Could not parse AI output comparison'},502)}
 const content=obj.choices?.[0]?.message?.content;
 const str=typeof content==='string'?content:Array.isArray(content)?content.map(x=>x.text||'').join(''):'';
 let model;try{const start=str.indexOf('{'),end=str.lastIndexOf('}');if(start<0||end<start)throw Error('JSON missing');model=JSON.parse(str.slice(start,end+1))}catch{await unlock();return reply({error:'AI did not provide valid comparison JSON. No EQ suggestion accepted.'},502)}
 const text=x=>String(x||'').trim().slice(0,300);
 const validAssessment=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&keys.every(([k,n])=>typeof x[k]==='string'&&x[k].trim().length>=n);
 const a=model.outputAssessment;
 if(!validAssessment(a,[['audibleOutputObservations',25],['differencesVsDirect',25],['impactOnEQ',25],['limitations',15]])||typeof a.sameSourceLikely!=='boolean'){
  await unlock();return reply({error:'AI did not describe audible output differences and their EQ impact; suggestions withheld'},502);
 }
 const outputAssessment={audibleOutputObservations:text(a.audibleOutputObservations),differencesVsDirect:text(a.differencesVsDirect),impactOnEQ:text(a.impactOnEQ),limitations:text(a.limitations),sameSourceLikely:a.sameSourceLikely};
 let roomAssessment=null;
 if(room){
  const x=model.roomAssessment;
  if(!validAssessment(x,[['audibleRoomObservations',25],['impactOnEQ',25],['limitations',15]])){await unlock();return reply({error:'AI did not explain how room audio affected EQ; suggestions withheld'},502)}
  roomAssessment={audibleRoomObservations:text(x.audibleRoomObservations),impactOnEQ:text(x.impactOnEQ),limitations:text(x.limitations)};
 }
 const detected=model.voiceDetected===true,confidence=['low','medium','high'].includes(model.confidence)?model.confidence:'low',suggestions=Array.isArray(model.suggestions)?model.suggestions:[];
 const complete=suggestions.length===4&&new Set(suggestions.map(x=>x?.band)).size===4&&suggestions.every(x=>x&&Number.isInteger(x.band)&&x.band>=1&&x.band<=4&&types.includes(x.type)&&!(x.band===4&&x.type==='LCut')&&Number.isFinite(x.frequencyHz)&&x.frequencyHz>=20&&x.frequencyHz<=20000&&Number.isFinite(x.gainDb)&&x.gainDb>=-15&&x.gainDb<=15&&Number.isFinite(x.q)&&x.q>=.3&&x.q<=10);
 const ready=detected&&confidence!=='low'&&outputAssessment.sameSourceLikely&&source.userConfirmed===true&&complete;
 if(detected&&confidence!=='low'&&outputAssessment.sameSourceLikely&&source.userConfirmed===true&&!complete){await unlock();return reply({error:'AI failed to provide complete safe numeric EQ suggestions; no Apply enabled'},502)}
 const safeWarnings=['A separate output recording was compared with the direct mic. Its EQ tap position is operator-declared but NOT verified by X32 routing readback.','EQ filter overlays are modeled, not calibrated room or PA frequency responses.'];
 if(room)safeWarnings.push('Room captures full PA and crowd; during worship it cannot verify a particular vocalist in isolation.');
 if(!outputAssessment.sameSourceLikely)safeWarnings.push('AI could not establish that output and direct mic are the same voice; EQ Apply is disabled.');
 if(source.userConfirmed!==true)safeWarnings.push('The operator has not confirmed that this Dante receive lane is the selected post-EQ channel. EQ Apply remains disabled.');
 return reply({channel:ch,analysisMode:data.analysisMode,voiceDetected:detected,confidence,summary:text(model.summary),audibleFindings:Array.isArray(model.audibleFindings)?model.audibleFindings.slice(0,4).map(text):[],bandReviews:Array.isArray(model.bandReviews)?model.bandReviews.filter(x=>Number.isInteger(x.band)&&x.band>=1&&x.band<=4).slice(0,4).map(x=>({band:x.band,assessment:text(x.assessment)})):[],hpfReview:text(model.hpfReview),hpfSuggestion:null,
  suggestions:ready?suggestions.sort((x,y)=>x.band-y.band).map(x=>({band:x.band,type:x.type,frequencyHz:x.frequencyHz,gainDb:x.gainDb,q:x.q,reason:text(x.reason)})):[],
  previewSuggestions:ready?suggestions:[],reviewComplete:ready,analysisBasis:'real_voice_audio',targetMethod:'direct_output_room_audio_comparison',currentSettingsUsedForTarget:true,
  usePostEq:true,outputAudioIncluded:true,outputAssessment,postQuality:output.quality,postEqSourceUserConfirmed:source.userConfirmed===true,postEqTapVerified:false,preEqTapVerified:false,
  roomMicUsed:roomOn,roomAudioIncluded:roomOn,roomAssessment,roomQuality:room?.quality||null,roomMicTapVerified:false,
  quality:direct.quality,roomReferenceVerified:false,writesAllowed:false,safetyWarnings:safeWarnings});
}