const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function setup(t,{info={size:6,mime:'video/mp4',too_large:false},chunks=[new Uint8Array([1,2,3,4]).buffer,[5,6]],saved=true,name='',receive=false}={}){
 const {Window}=await import('happy-dom');const w=new Window({url:'http://tauri.localhost',settings:{enableJavaScriptEvaluation:true,suppressInsecureJavaScriptEnvironmentWarning:true}});t.after(()=>w.happyDOM.close());
 w.document.body.innerHTML='<div id="host"><div class="file-card"><strong>clip.mp4</strong><div class="file-progress"></div></div></div>';
 const calls=[],blobs=[],revoked=[],toasts=[];let next=0;
 w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:video-'+blobs.length;};w.URL.revokeObjectURL=url=>revoked.push(url);
 w.HTMLMediaElement.prototype.load=function(){};w.HTMLMediaElement.prototype.pause=function(){this.__paused=true;this.dispatchEvent(new w.Event('pause'));};
 w.HTMLMediaElement.prototype.play=async function(){this.__paused=false;this.dispatchEvent(new w.Event('play'));};
 Object.defineProperty(w.HTMLMediaElement.prototype,'paused',{configurable:true,get(){return this.__paused!==false;}});
 Object.defineProperty(w.HTMLMediaElement.prototype,'duration',{configurable:true,get(){return this.__duration??100;}});
 const fullscreen=[],fullscreenOptions=[];w.OchatFullscreen={active:()=>false,exit:async()=>{},toggle:async(target,options)=>{fullscreen.push(target);fullscreenOptions.push(options);}};
 w.eval(fs.readFileSync('ui/audio-waveform.js','utf8'));
 w.eval(fs.readFileSync('ui/chat-media.js','utf8'));
 const invoke=async(command,args)=>{calls.push([command,args]);if(command==='chat_media_info')return receive&&!calls.some(c=>c[0]==='receive_chat_media')?null:info;if(command==='receive_chat_media')return true;if(command==='chat_media_chunk')return chunks[next++];if(command==='save_chat_media')return saved;throw Error('Unexpected '+command);};
 w.OchatChatMedia.init({invoke,toast:message=>toasts.push(String(message))});
 const card=w.document.querySelector('.file-card'),source={room:'room-a',peer:'peer-a',id:'file-a',name:'clip.mp4'};
 if(name)source.name=name;
 return {w,card,source,calls,blobs,revoked,toasts,fullscreen,fullscreenOptions,player:()=>card.querySelector('.chat-media'),video:()=>card.querySelector('video')};
}
const click=(s,selector)=>s.card.querySelector(selector).dispatchEvent(new s.w.MouseEvent('click',{bubbles:true}));
async function started(s){s.w.OchatChatMedia.attach(s.card,s.source);await tick();click(s,'.chat-media-start');for(let i=0;i<6;i++)await tick();}

test('a video file gains a player and loads nothing until the user presses play',async t=>{
 const s=await setup(t);s.w.OchatChatMedia.attach(s.card,s.source);await tick();
 assert.ok(s.player());assert.equal(s.player().dataset.state,'idle');assert.ok(s.card.classList.contains('has-media'));
 assert.deepEqual(s.calls.map(c=>c[0]),['chat_media_info']);assert.equal(s.blobs.length,0);
 assert.equal(s.card.querySelector('.chat-media').nextElementSibling,s.card.querySelector('.file-progress'));
});
test('other files and offers the backend cannot play stay plain file cards',async t=>{
 const other=await setup(t);other.w.OchatChatMedia.attach(other.card,{...other.source,name:'notes.pdf'});await tick();assert.equal(other.player(),null);assert.equal(other.calls.length,0);
 const missing=await setup(t,{info:null});missing.w.OchatChatMedia.attach(missing.card,missing.source);await tick();assert.equal(missing.player(),null);
});
test('a finished download shows the player without waiting for the saved path',async t=>{
 const s=await setup(t,{info:null});s.w.OchatChatMedia.attach(s.card,s.source);await tick();assert.equal(s.player(),null);
 s.w.OchatChatMedia.received(s.card);assert.ok(s.player());s.w.OchatChatMedia.received(s.card);assert.equal(s.card.querySelectorAll('.chat-media').length,1);
});
test('pressing play assembles every chunk into one typed blob and accepts each IPC binary shape',async t=>{
 const s=await setup(t);await started(s);
 assert.deepEqual(s.calls.filter(c=>c[0]==='chat_media_chunk').map(c=>c[1].offset),[0,4]);
 assert.deepEqual({...s.calls.at(-1)[1]},{room:'room-a',peer:'peer-a',id:'file-a',offset:4});
 assert.equal(s.blobs.length,1);assert.equal(s.blobs[0].type,'video/mp4');assert.equal(s.blobs[0].size,6);
 assert.equal(s.video().getAttribute('src'),'blob:video-1');assert.equal(s.player().dataset.state,'ready');assert.equal(s.video().paused,false);
});
test('the controls drive playback, seeking, volume and fullscreen',async t=>{
 const s=await setup(t);await started(s);const video=s.video();
 click(s,'.chat-media-controls .chat-media-button');assert.equal(video.paused,true);
 assert.equal(s.card.querySelector('.chat-media-jump'),null);
 const seek=s.card.querySelector('.chat-media-seek');seek.value='250';seek.dispatchEvent(new s.w.Event('input'));seek.dispatchEvent(new s.w.Event('change'));assert.equal(video.currentTime,25);
 const volume=s.card.querySelector('.chat-media-volume');volume.value='0.25';volume.dispatchEvent(new s.w.Event('input'));assert.equal(video.volume,.25);
 click(s,'.chat-media-right .chat-media-button');assert.equal(video.muted,true);
 click(s,'.chat-media-right .chat-media-button:last-child');await tick();assert.deepEqual(s.fullscreen,[s.player()]);assert.equal(s.fullscreenOptions[0].closeButton,false);
});
test('keyboard shortcuts stay inside the focused player and leave sliders alone',async t=>{
 const s=await setup(t);await started(s);let escaped=0;s.w.document.body.addEventListener('keydown',()=>escaped++);const video=s.video(),press=(target,key)=>target.dispatchEvent(new s.w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
 video.currentTime=50;press(s.player(),'ArrowLeft');assert.equal(video.currentTime,45);press(s.player(),'k');assert.equal(video.paused,true);press(s.player(),'m');assert.equal(video.muted,true);assert.equal(escaped,0);
 press(s.card.querySelector('.chat-media-seek'),'ArrowLeft');assert.equal(video.currentTime,45);assert.equal(escaped,1);
 press(s.player(),'x');assert.equal(escaped,2);
});
test('only one video stays loaded and a detached player releases its memory',async t=>{
 const s=await setup(t,{chunks:[[1,2,3,4,5,6],[1,2,3,4,5,6]]});await started(s);
 const second=s.card.cloneNode(false);second.innerHTML='<div class="file-progress"></div>';s.card.parentElement.append(second);s.w.OchatChatMedia.attach(second,{...s.source,id:'file-b'});await tick();
 second.querySelector('.chat-media-start').dispatchEvent(new s.w.MouseEvent('click',{bubbles:true}));for(let i=0;i<6;i++)await tick();
 assert.deepEqual(s.revoked,['blob:video-1']);assert.equal(s.player().dataset.state,'idle');assert.equal(s.video().getAttribute('src'),null);assert.equal(second.querySelector('.chat-media').dataset.state,'ready');
 second.remove();second.querySelector('video').dispatchEvent(new s.w.Event('timeupdate'));assert.deepEqual(s.revoked,['blob:video-1','blob:video-2']);
});
test('removing a card while loading abandons the remaining chunks',async t=>{
 const s=await setup(t);s.w.OchatChatMedia.attach(s.card,s.source);await tick();click(s,'.chat-media-start');s.card.remove();for(let i=0;i<6;i++)await tick();
 assert.equal(s.calls.filter(c=>c[0]==='chat_media_chunk').length,0);assert.equal(s.blobs.length,0);
});
test('locking the account stops playback and frees the blob',async t=>{
 const s=await setup(t);await started(s);s.w.OchatChatMedia.reset();assert.deepEqual(s.revoked,['blob:video-1']);assert.equal(s.video().paused,true);assert.equal(s.video().getAttribute('src'),null);
});
test('oversized and unreadable videos explain why and never reach the player',async t=>{
 const big=await setup(t,{info:{size:9e9,mime:'video/mp4',too_large:true}});await started(big);assert.equal(big.player().dataset.state,'error');assert.match(big.card.querySelector('.chat-media-status').textContent,/too large/);assert.ok(!big.calls.some(c=>c[0]==='chat_media_chunk'));assert.equal(big.card.querySelector('.chat-media-start').hidden,true);
 const bad=await setup(t);await started(bad);bad.video().dispatchEvent(new bad.w.Event('error'));assert.equal(bad.player().dataset.state,'error');assert.match(bad.card.querySelector('.chat-media-status').textContent,/cannot play/);assert.deepEqual(bad.revoked,['blob:video-1']);
});
test('only videos within the preview limit are stored inside the app',async t=>{
 const s=await setup(t),{storesInline}=s.w.OchatChatMedia,limit=512*1024*1024;
 assert.equal(storesInline({name:'clip.MP4',size:limit}),true);assert.equal(storesInline({name:'clip.mp4',size:limit+1}),false);assert.equal(storesInline({name:'notes.pdf',size:10}),false);
});
test('the save button copies the video without loading it, and reports only a completed save',async t=>{
 const s=await setup(t);s.w.OchatChatMedia.attach(s.card,s.source);await tick();click(s,'.chat-media-save');await tick();
 assert.deepEqual({...s.calls.at(-1)[1]},{room:'room-a',peer:'peer-a',id:'file-a',name:'clip.mp4'});assert.equal(s.calls.at(-1)[0],'save_chat_media');assert.equal(s.blobs.length,0);assert.deepEqual(s.toasts,['Copy saved']);assert.equal(s.card.querySelector('.chat-media-save').disabled,false);
 const cancelled=await setup(t,{saved:false});cancelled.w.OchatChatMedia.attach(cancelled.card,cancelled.source);await tick();click(cancelled,'.chat-media-save');await tick();assert.deepEqual(cancelled.toasts,[]);
});
test('a video already stored on this device replaces the download prompt',async t=>{
 const s=await setup(t);const actions=s.w.document.createElement('div');actions.className='file-actions';s.card.append(actions);s.w.OchatChatMedia.attach(s.card,s.source);await tick();
 assert.equal(s.card.querySelector('.file-actions'),null);assert.equal(s.card.querySelector('.file-progress').textContent,'Received and verified');
});
const audioInfo={size:6,mime:'audio/mpeg',too_large:false};
async function audio(t,options={}){const s=await setup(t,{info:audioInfo,name:'song.mp3',...options});s.w.OchatChatMedia.attach(s.card,s.source);await tick();return s;}
test('an audio file gets a compact bar that starts from its own play button',async t=>{
 const s=await audio(t),root=s.player();
 assert.ok(root.classList.contains('chat-media-audio'));assert.ok(root.querySelector('audio'));assert.equal(root.querySelector('video'),null);assert.equal(root.querySelector('.chat-media-start'),null);assert.equal(root.querySelector('[aria-label="Fullscreen"]'),null);
 assert.equal(root.querySelector('.chat-media-volume').value,'1');
 assert.equal(root.querySelector('.chat-media-right .chat-media-save').getAttribute('aria-label'),'Save a copy…');assert.equal(root.querySelector('.chat-media-seek').disabled,true);assert.equal(s.blobs.length,0);
 root.querySelector('.chat-media-controls .chat-media-button').dispatchEvent(new s.w.MouseEvent('click',{bubbles:true}));for(let i=0;i<6;i++)await tick();
 assert.equal(root.dataset.state,'ready');assert.equal(s.blobs[0].type,'audio/mpeg');assert.equal(root.querySelector('audio').paused,false);assert.equal(root.querySelector('.chat-media-seek').disabled,false);
 root.querySelector('.chat-media-controls .chat-media-button').dispatchEvent(new s.w.MouseEvent('click',{bubbles:true}));assert.equal(root.querySelector('audio').paused,true);
});
test('audio in a shared container is typed as audio, and F does nothing without fullscreen',async t=>{
 const s=await audio(t,{info:{...audioInfo,mime:'video/mp4'},name:'voice.m4a'}),root=s.player();
 root.querySelector('.chat-media-controls .chat-media-button').dispatchEvent(new s.w.MouseEvent('click',{bubbles:true}));for(let i=0;i<6;i++)await tick();
 assert.equal(s.blobs[0].type,'audio/mp4');root.dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'f',bubbles:true,cancelable:true}));await tick();assert.deepEqual(s.fullscreen,[]);
});
test('audio names are stored inside the app like videos',async t=>{
 const s=await setup(t),{storesInline}=s.w.OchatChatMedia;for(const name of ['a.mp3','a.m4a','a.aac','a.FLAC','a.wav','a.ogg','a.oga','a.opus','a.weba'])assert.equal(storesInline({name,size:10}),true,name);assert.equal(storesInline({name:'a.mp3.exe',size:10}),false);
});


test('received voice messages fetch nothing until Play and then use verified encrypted media',async t=>{
 const s=await setup(t,{name:'Voice message.wav',info:{size:6,mime:'audio/wav',too_large:false},receive:true});
 s.w.OchatChatMedia.attach(s.card,s.source);await tick();assert.ok(s.player());
 assert.equal(s.calls.some(c=>c[0]==='receive_chat_media'),false);
 click(s,'.chat-media-controls .chat-media-button');for(let i=0;i<8;i++)await tick();
 assert.equal(s.calls.filter(c=>c[0]==='receive_chat_media').length,1);
 assert.equal(s.player().dataset.state,'ready');assert.equal(s.blobs[0].type,'audio/wav');
});


test('voice notes use a compact waveform with seek, duration and discreet secondary controls',async t=>{
 const s=await setup(t,{name:'Voice message.wav',info:{size:6,mime:'audio/wav',too_large:false}});
 s.w.OchatChatMedia.attach(s.card,{...s.source,size:960044});await tick();
 assert.ok(s.card.classList.contains('voice-message-card'));assert.equal(s.player().getAttribute('aria-label'),'Voice message');
 assert.equal(s.card.querySelectorAll('.audio-waveform-bars i').length,48);
 assert.ok(s.card.querySelector('.voice-options-menu .chat-media-volume'));assert.ok(s.card.querySelector('.voice-options-menu .chat-media-save'));
 const menu=s.card.querySelector('.voice-options');menu.open=true;menu.dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(menu.open,false);
 click(s,'.voice-play');for(let i=0;i<8;i++)await tick();
 const seek=s.card.querySelector('.audio-waveform-seek');assert.equal(seek.disabled,false);seek.value='500';seek.dispatchEvent(new s.w.Event('input'));
 assert.equal(s.card.querySelector('audio').currentTime,50);assert.equal(s.card.querySelectorAll('.is-played').length,24);
});
