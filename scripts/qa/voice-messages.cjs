/* Synthetic visual bridge: never opens a microphone or a real profile. */
const {fixture,server}=require('./visual.cjs');
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:'msedge',args:['--mute-audio']});
 try{
  fs.mkdirSync('releases/reports/voice-messages',{recursive:true});
  for(const theme of ['light','dark'])for(const width of [480,780,1180,1600]){
   const page=await browser.newPage({viewport:{width,height:width===480?520:850},colorScheme:theme});
   await page.addInitScript(fixture,theme);
   await page.addInitScript(()=>{
    const invoke=window.__TAURI__.core.invoke;
    let voiceBytes;
    const recording=()=>{
     if(voiceBytes)return voiceBytes;

      const n=48000*4, bytes=new Uint8Array(44+n*2),v=new DataView(bytes.buffer);
      for(const [offset,text] of [[0,'RIFF'],[8,'WAVEfmt '],[36,'data']])for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i);
      v.setUint32(4,bytes.length-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,n*2,true);
      for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.sin(i*.045)*Math.abs(Math.sin(i/7600))*14000,true);
      return voiceBytes=bytes;
    };
    window.__TAURI__.core.invoke=async(command,args)=>{
     if(command==='start_voice_message')return 'synthetic-recording';
     if(command==='voice_message_status')return {seconds:2,level:.12,full:false};
     if(command==='finish_voice_message')return recording().buffer;
     if(command==='chat_media_info' && args.id==='qa-voice-message')return {size:recording().byteLength,mime:'audio/wav',too_large:false};
     if(command==='chat_media_chunk' && args.id==='qa-voice-message')return recording().buffer;
     if(command==='cancel_voice_message'||command==='send_voice_message')return;
     return invoke(command,args);
    };
   });
   await page.goto('http://127.0.0.1:'+server.address().port);
   await page.waitForFunction(()=>document.body.dataset.qaReady==='true');
   await page.locator('#voice-message-button').click();
   await page.locator('#voice-message-stop').waitFor({state:'visible'});
   for(const id of ['voice-message-stop','voice-message-cancel','message']){
    const box=await page.locator('#'+id).boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<= (width===480?520:850),id+' outside viewport at '+width);
   }
   await page.waitForTimeout(450);
   await page.screenshot({path:`releases/reports/voice-messages/recording-${theme}-${width}.png`});
   await page.locator('#voice-message-stop').click();
   await page.locator('#voice-message-send').waitFor({state:'visible'});
   await page.locator('#voice-preview-play').click();
   await page.waitForFunction(()=>document.getElementById('voice-preview-play').getAttribute('aria-label')==='Pause voice preview');
   await page.evaluate(()=>{const slider=document.querySelector('#voice-preview-wave input');slider.value='500';slider.dispatchEvent(new Event('input'));document.getElementById('voice-message-preview').pause();});
   assert.ok(await page.evaluate(()=>Math.abs(document.getElementById('voice-message-preview').currentTime-2)<.1));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:`releases/reports/voice-messages/${theme}-${width}.png`});
   await page.locator('#voice-message-cancel').click();
   assert.equal(await page.locator('#voice-message-panel').isVisible(),false);
   await page.evaluate(()=>addFile({room:selectedRoom,peer:state.peers[0].id,name:state.peers[0].name,channel:selectedChannel(),offer:{id:'qa-voice-message',name:'Voice message.wav',size:384044,hash:'a'.repeat(64)},outgoing:false},true));
   const card=page.locator('.voice-message-card').last();
   await card.locator('.voice-play').waitFor({state:'visible'});
   assert.equal(await card.locator(':scope > strong').isVisible(),false);
   assert.equal(await card.locator(':scope > small').isVisible(),false);
   await card.locator('.voice-play').click();
   await card.locator('.voice-note[data-state=ready]').waitFor();
   await page.evaluate(()=>{const audio=document.querySelector('.voice-message-card audio');audio.pause();audio.currentTime=1.8;audio.dispatchEvent(new Event('timeupdate'));});
   await page.waitForTimeout(200);
   await page.screenshot({path:`releases/reports/voice-messages/bubble-${theme}-${width}.png`});
   assert.ok(await card.locator('.audio-waveform-bars .is-played').count()>0);
   await page.close();
  }
  console.log('8 voice-message layouts passed (synthetic native bridge; no microphone opened)');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
