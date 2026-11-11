const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(t,override){
 const {Window}=await import('happy-dom');
 const w=new Window({settings:{enableJavaScriptEvaluation:true,suppressInsecureJavaScriptEnvironmentWarning:true}});
 t.after(()=>w.happyDOM.close());
 const html=fs.readFileSync('ui/index.html','utf8');
 w.document.body.innerHTML=html.match(/<section id="voice-message-panel"[\s\S]*?<\/section>/)[0]+html.match(/<button type="button" id="voice-message-button"[\s\S]*?<\/button>/)[0]+'<textarea id="draft">Keep my draft</textarea>';
 w.HTMLMediaElement.prototype.pause=function(){};w.HTMLMediaElement.prototype.load=function(){};
 const blobs=[],revoked=[],calls=[],errors=[];
 w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:recording'};w.URL.revokeObjectURL=url=>revoked.push(url);
 const context={unlocked:true,room:'room-a',channel:'text-a',connected:true,voice:false};
 w.eval(fs.readFileSync('ui/audio-waveform.js','utf8'));
 w.eval(fs.readFileSync('ui/voice-messages.js','utf8'));
 w.OchatVoiceMessages.init({context:()=>({...context}),error:error=>errors.push(String(error)),invoke:async(command,args)=>{
  calls.push({command,args});if(override){const result=override(command,args);if(result!==undefined)return result;}
  if(command==='start_voice_message')return 'recording-a';
  if(command==='finish_voice_message')return new Uint8Array([82,73,70,70]).buffer;
  if(command==='voice_message_status')return {seconds:1,level:.1,full:false};
  return null;
 }});
 const get=id=>w.document.getElementById(id);
 return {w,context,calls,errors,blobs,revoked,get,click:async id=>{get(id).click();await flush();}};
}
test('explicit start, stop, preview and Send preserve the written draft and captured channel',async t=>{
 const a=await setup(t);assert.equal(a.calls.length,0);
 await a.click('voice-message-button');assert.equal(a.get('voice-message-button').getAttribute('aria-pressed'),'true');
 assert.deepEqual(JSON.parse(JSON.stringify(a.calls[0])),{command:'start_voice_message',args:{room:'room-a',channel:'text-a'}});
 await a.click('voice-message-stop');assert.equal(a.blobs.length,1);assert.equal(a.get('voice-message-preview-wrap').hidden,false);
 assert.ok(!a.calls.some(c=>c.command==='send_voice_message'));
 await a.click('voice-message-send');assert.ok(a.calls.some(c=>c.command==='send_voice_message'&&c.args.id==='recording-a'));
 assert.equal(a.get('draft').value,'Keep my draft');assert.equal(a.get('voice-message-panel').hidden,true);assert.deepEqual(a.revoked,['blob:recording']);
});
test('channel changes, calls and Lock discard the recording without sending',async t=>{
 for(const change of [a=>a.context.channel='text-b',a=>a.context.voice=true,a=>a.context.unlocked=false]){
  const a=await setup(t);await a.click('voice-message-button');change(a);a.w.OchatVoiceMessages.update();await flush();
  assert.equal(a.get('voice-message-panel').hidden,true);assert.ok(a.calls.some(c=>c.command==='cancel_voice_message'));assert.ok(!a.calls.some(c=>c.command==='send_voice_message'));
 }
});
test('discard during microphone permission cancels the late native capture',async t=>{
 let resolve;const a=await setup(t,command=>command==='start_voice_message'?new Promise(r=>resolve=r):undefined);
 await a.click('voice-message-button');await a.click('voice-message-cancel');resolve('late-recording');await flush();
 assert.ok(a.calls.some(c=>c.command==='cancel_voice_message'&&c.args.id==='late-recording'));assert.equal(a.blobs.length,0);
});
test('failed sends retain the preview for retry; Escape discards it',async t=>{
 const a=await setup(t,command=>command==='send_voice_message'?Promise.reject(Error('Peer unavailable')):undefined);
 await a.click('voice-message-button');await a.click('voice-message-stop');await a.click('voice-message-send');
 assert.match(a.get('voice-message-status').textContent,/retry/);assert.equal(a.get('voice-message-preview-wrap').hidden,false);
 a.w.document.dispatchEvent(new a.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(a.get('voice-message-panel').hidden,true);assert.deepEqual(a.revoked,['blob:recording']);
});
test('calls, locked accounts and offline rooms cannot start the microphone',async t=>{
 const a=await setup(t);for(const property of ['voice','connected','unlocked']){
  a.context.voice=false;a.context.connected=true;a.context.unlocked=true;
  a.context[property]=property==='voice';a.w.OchatVoiceMessages.update();await a.click('voice-message-button');
  assert.equal(a.calls.length,0);
 }
});

test('microphone failure discards capture and the three-minute limit produces a preview',async t=>{
 const a=await setup(t,command=>command==='voice_message_status'?Promise.reject(Error('Microphone disconnected')):undefined);
 await a.click('voice-message-button');await new Promise(r=>setTimeout(r,240));await flush();
 assert.equal(a.get('voice-message-panel').hidden,true);assert.match(a.errors[0],/disconnected/);
 const b=await setup(t,command=>command==='voice_message_status'?{seconds:180,level:0,full:true}:undefined);
 await b.click('voice-message-button');await new Promise(r=>setTimeout(r,240));await flush();
 assert.equal(b.get('voice-message-preview-wrap').hidden,false);assert.ok(b.calls.some(c=>c.command==='finish_voice_message'));assert.ok(!b.calls.some(c=>c.command==='send_voice_message'));
});
