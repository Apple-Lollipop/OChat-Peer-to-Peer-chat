/* Plays verified local audio and video inside their file card. Bytes are loaded only after a click. */
(() => {
  // MAX_PREVIEW mirrors MAX_MEDIA_PREVIEW in the core, which enforces it.
  const VIDEO_NAME=/\.(mp4|m4v|mov|webm|ogv)$/i,AUDIO_NAME=/\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|weba)$/i,MAX_PREVIEW=512*1024*1024,KEY_SECONDS=5,IDLE_MS=2500;
  const ICONS={
    play:'M8 5v14l11-7z',
    pause:'M6 5h4v14H6zm8 0h4v14h-4z',
    volume:'M4 9v6h4l5 4V5L8 9H4zm12 .5v5a3.5 3.5 0 0 0 0-5zM16 5.3v2.1a7 7 0 0 1 0 9.2v2.1a9 9 0 0 0 0-13.4z',
    muted:'M4 9v6h4l5 4V5L8 9H4zm11.5.4 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1z',
    fullscreen:'M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zM4 15h2v3h3v2H4zm14 3v-3h2v5h-5v-2z',
    save:'M11 4h2v9l3.5-3.5 1.4 1.4-5.9 5.9-5.9-5.9 1.4-1.4L11 13zM5 18h14v2H5z'
  };
  let api=null,epoch=0,active=null,volume=1,muted=false;
  const sources=new WeakMap();

  function node(tag,className,text){const item=document.createElement(tag);if(className)item.className=className;if(text!==undefined)item.textContent=text;return item;}
  function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',ICONS[name]);svg.append(path);return svg;}
  function setIcon(button,name,label){button.replaceChildren(icon(name));button.title=label;button.setAttribute('aria-label',label);}
  function iconButton(name,label,run){const button=node('button','chat-media-button');button.type='button';setIcon(button,name,label);button.onclick=event=>{event.stopPropagation();run();};return button;}
  function range(className,label,max,step){const input=node('input','chat-media-range '+className);input.type='range';input.min='0';input.max=String(max);input.step=String(step);input.value='0';input.setAttribute('aria-label',label);return input;}
  function fill(input){input.style.setProperty('--fill',(Number(input.value)/Number(input.max||1))*100+'%');}
  function kindOf(name){return VIDEO_NAME.test(name||'')?'video':AUDIO_NAME.test(name||'')?'audio':null;}
  function clock(seconds){if(!Number.isFinite(seconds)||seconds<0)return '0:00';const whole=Math.floor(seconds),hours=Math.floor(whole/3600),minutes=Math.floor(whole/60)%60,rest=String(whole%60).padStart(2,'0');return hours?`${hours}:${String(minutes).padStart(2,'0')}:${rest}`:`${minutes}:${rest}`;}

  function unload(player){
    player.load++;if(active===player)active=null;
    if(window.OchatFullscreen?.active()&&player.root.classList.contains('ochat-fullscreen'))window.OchatFullscreen.exit().catch(()=>{});
    clearTimeout(player.idle);player.media.pause();player.media.removeAttribute('src');player.media.load();
    if(player.url){URL.revokeObjectURL(player.url);player.url='';}
    player.root.classList.remove('chat-media-idle');player.root.style.removeProperty('aspect-ratio');paint(player);
  }
  function show(player,state,message=''){player.root.dataset.state=state;player.seek.disabled=state!=='ready';if(player.wave)player.wave.slider.disabled=state!=='ready';player.status.textContent=message;player.status.hidden=!message;}
  function fail(player,message,retry=true){unload(player);show(player,'error',message);player.start.hidden=!retry;}
  function releaseDetached(){if(active&&!active.root.isConnected)unload(active);}

  async function start(player){
    if(active&&active!==player){const previous=active;unload(previous);show(previous,'idle');}
    const run=++player.load,session=epoch,alive=()=>run===player.load&&session===epoch&&player.root.isConnected;
    active=player;show(player,'loading','Loading…');
    try{
      let info=await api.invoke('chat_media_info',player.scope);
      if(!alive())return;
      if(!info && player.name==='Voice message.wav') {
        show(player,'loading','Receiving voice message…');
        await api.invoke('receive_chat_media',player.scope);
        if(!alive())return;
        info=await api.invoke('chat_media_info',player.scope);
      }
      if(!alive())return;
      if(!info)return fail(player,'This file is no longer available on this device.',false);
      if(info.too_large)return fail(player,'This file is too large to play in chat. Open the saved file instead.',false);
      const parts=[];let offset=0;
      while(offset<info.size){
        // Tauri delivers an ArrayBuffer or, over Linux's fallback IPC, a plain number array.
        const chunk=new Uint8Array(await api.invoke('chat_media_chunk',{...player.scope,offset}));
        if(!alive())return;
        if(!chunk.length)throw Error('The file ended unexpectedly.');
        parts.push(new Blob([chunk]));offset+=chunk.length;
        show(player,'loading',`Loading… ${Math.floor(offset*100/info.size)}%`);
      }
      player.url=URL.createObjectURL(new Blob(parts,{type:player.kind==='audio'?info.mime.replace(/^video\//,'audio/'):info.mime}));
      if(player.wave) {
        const waveform=window.OchatWaveform.pcm(new Uint8Array(await new Blob(parts).arrayBuffer()));
        if(!alive()) { URL.revokeObjectURL(player.url); player.url=''; return; }
        player.wave.set(waveform?.peaks || []);
        if(waveform)player.voiceDuration=waveform.duration;
      }
      player.media.src=player.url;player.media.volume=volume;player.media.muted=muted;
      show(player,'ready');paint(player);
      // A long load can outlive the click's activation: stay ready and let the user press play.
      await player.media.play().catch(()=>{});
      if(alive())player.root.focus({preventScroll:true});
    }catch(error){if(alive())fail(player,String(error?.message||error));}
  }

  function paint(player){
    const {media,seek,clockLabel,toggle,mute,loudness}=player,duration=Number.isFinite(media.duration)?media.duration:0;
    if(!player.dragging){seek.value=String(duration?Math.round(media.currentTime/duration*1000):0);fill(seek);}
    clockLabel.textContent=`${clock(media.currentTime)} / ${clock(duration)}`;
    if(player.wave) {
      const voiceDuration=duration || player.voiceDuration || 0;
      player.wave.progress(voiceDuration?media.currentTime/voiceDuration:0,voiceDuration);
      player.wave.slider.disabled=player.root.dataset.state!=='ready';
      clockLabel.textContent=voiceDuration?clock(media.currentTime>0?Math.max(0,voiceDuration-media.currentTime):voiceDuration):'—:—';
      player.root.dataset.playing=String(!media.paused);
    }
    seek.setAttribute('aria-valuetext',clock(media.currentTime));
    setIcon(toggle,media.paused?'play':'pause',media.paused?'Play':'Pause');
    setIcon(mute,media.muted||!media.volume?'muted':'volume',media.muted?'Unmute':'Mute');
    loudness.value=String(media.muted?0:media.volume);fill(loudness);
  }
  function jump(player,seconds){const {media}=player,limit=Number.isFinite(media.duration)?media.duration:media.currentTime+Math.max(seconds,0);media.currentTime=Math.min(limit,Math.max(0,media.currentTime+seconds));paint(player);}
  function playOrPause(player){if(player.media.paused)player.media.play().catch(error=>api.toast(error));else player.media.pause();}
  function setVolume(player,value){volume=Math.min(1,Math.max(0,value));muted=volume===0;player.media.volume=volume;player.media.muted=muted;paint(player);}
  function toggleMute(player){muted=!player.media.muted;if(!muted&&!player.media.volume){volume=.5;player.media.volume=volume;}player.media.muted=muted;paint(player);}
  async function saveCopy(player){
    player.save.disabled=true;
    try{if(await api.invoke('save_chat_media',{...player.scope,name:player.name}))api.toast('Copy saved');}
    catch(error){api.toast(error);}
    finally{player.save.disabled=false;}
  }
  async function toggleFullscreen(player){try{await window.OchatFullscreen.toggle(player.root,{closeButton:false});player.root.focus({preventScroll:true});}catch(error){api.toast(error);}}
  function wake(player){
    if(player.kind!=='video')return;
    player.root.classList.remove('chat-media-idle');clearTimeout(player.idle);
    if(!player.media.paused)player.idle=setTimeout(()=>{if(!player.root.matches(':hover')||player.root.classList.contains('ochat-fullscreen'))player.root.classList.add('chat-media-idle');},IDLE_MS);
  }
  function onKey(player,event){
    if(player.root.dataset.state!=='ready'||event.ctrlKey||event.metaKey||event.altKey)return;
    const onSlider=event.target.matches?.('input[type=range]'),onButton=event.target.closest?.('button'),key=event.key.toLowerCase();
    if((key===' '&&!onButton)||key==='k')playOrPause(player);
    else if(key==='m')toggleMute(player);
    else if(key==='f'&&player.kind==='video')toggleFullscreen(player);
    else if(key==='arrowleft'&&!onSlider)jump(player,-KEY_SECONDS);
    else if(key==='arrowright'&&!onSlider)jump(player,KEY_SECONDS);
    else if(key==='arrowup'&&!onSlider)setVolume(player,player.media.volume+.1);
    else if(key==='arrowdown'&&!onSlider)setVolume(player,player.media.volume-.1);
    else return;
    event.preventDefault();event.stopPropagation();wake(player);
  }

  function create(card,source){
    const kind=kindOf(source.name),isVideo=kind==='video',root=node('div',isVideo?'chat-media':'chat-media chat-media-audio'),media=node(kind),begin=iconButton('play','Play',()=>start(player)),status=node('div','chat-media-status'),controls=node('div','chat-media-controls');
    root.tabIndex=0;root.setAttribute('role','group');root.setAttribute('aria-label',(isVideo?'Video':'Audio')+' player: '+source.name);
    begin.classList.add('chat-media-start');status.hidden=true;status.setAttribute('role','status');media.preload='auto';
    if(isVideo){media.playsInline=true;media.disablePictureInPicture=true;}
    const seek=range('chat-media-seek','Seek',1000,1),clockLabel=node('span','chat-media-clock','0:00 / 0:00'),loudness=range('chat-media-volume','Volume',1,.01);
    const toggle=iconButton('play','Play',()=>{if(root.dataset.state==='ready')playOrPause(player);else if(root.dataset.state!=='loading')start(player);}),mute=iconButton('volume','Mute',()=>toggleMute(player)),expand=iconButton('fullscreen','Fullscreen',()=>toggleFullscreen(player)),save=iconButton('save','Save a copy…',()=>saveCopy(player));
    save.classList.add('chat-media-save');
    const player={root,media,kind,save,name:source.name,start:isVideo?begin:toggle,status,seek,clockLabel,toggle,mute,loudness,scope:{room:source.room,peer:source.peer,id:source.id},load:0,url:'',dragging:false,idle:0};
    seek.oninput=()=>{player.dragging=true;fill(seek);const duration=media.duration;if(Number.isFinite(duration)){clockLabel.textContent=`${clock(Number(seek.value)/1000*duration)} / ${clock(duration)}`;}};
    seek.onchange=()=>{player.dragging=false;if(Number.isFinite(media.duration))media.currentTime=Number(seek.value)/1000*media.duration;paint(player);};
    loudness.oninput=()=>setVolume(player,Number(loudness.value));
    const right=node('div','chat-media-right');right.append(mute,loudness,isVideo?expand:save);
    controls.append(toggle,seek,clockLabel,right);controls.onclick=event=>event.stopPropagation();controls.ondblclick=event=>event.stopPropagation();
    if(isVideo)root.append(media,status,begin,save,controls);else root.append(media,controls,status);
    media.onclick=()=>{if(root.dataset.state==='ready')playOrPause(player);};
    media.ondblclick=()=>{if(root.dataset.state==='ready')toggleFullscreen(player);};
    media.onloadedmetadata=()=>{if(media.videoWidth&&media.videoHeight)root.style.aspectRatio=String(Math.min(2.4,Math.max(.8,media.videoWidth/media.videoHeight)));paint(player);window.OchatTimeline?.settle?.();};
    media.ontimeupdate=()=>{if(!root.isConnected){unload(player);return;}paint(player);};
    media.ondurationchange=()=>paint(player);
    media.onplay=()=>{paint(player);wake(player);};
    media.onpause=()=>{paint(player);wake(player);};
    media.onended=()=>{paint(player);wake(player);};
    media.onerror=()=>{if(media.getAttribute('src'))fail(player,'This device cannot play this format. Open the saved file in another player instead.',false);};
    root.onpointermove=()=>wake(player);
    root.onfocusin=()=>wake(player);
    root.addEventListener('keydown',event=>onKey(player,event));
    show(player,'idle');media.volume=volume;media.muted=muted;paint(player);
    card.querySelector('.file-progress').before(root);card.classList.add('has-media');
    if(source.name==='Voice message.wav' && window.OchatWaveform) {
      card.classList.add('voice-message-card'); root.classList.add('voice-note');
      root.setAttribute('aria-label','Voice message');
      player.voiceDuration=source.size>=46 && source.size<=17280044?(source.size-44)/96000:0;
      player.wave=window.OchatWaveform.create({seek:fraction=>{const duration=media.duration;if(Number.isFinite(duration)){media.currentTime=fraction*duration;paint(player);}}});
      player.wave.root.classList.add('voice-note-wave');
      const options=node('details','voice-options'),summary=node('summary','voice-options-toggle','•••'),menu=node('div','voice-options-menu');
      summary.setAttribute('aria-label','Voice message options');summary.title='Voice message options';
      menu.append(right);
      for(const extra of [...card.querySelectorAll(':scope > .file-progress, :scope > .file-recipients, :scope > .file-actions')])menu.append(extra);
      options.append(summary,menu);options.onclick=event=>event.stopPropagation();
      options.addEventListener('keydown',event=>{if(event.key==='Escape'){options.open=false;summary.focus();event.stopPropagation();}});
      controls.replaceChildren(toggle,player.wave.root,clockLabel,options);
      toggle.classList.add('voice-play'); seek.hidden=true; paint(player);
    }
    window.OchatTimeline?.settle?.();
  }

  function markReceived(card){const actions=card.querySelector('.file-actions');if(card.dataset.outgoing==='true'||!actions)return;actions.remove();card.querySelector('.file-progress').textContent='Received and verified';}
  function insert(card){const source=sources.get(card);if(source&&card.isConnected&&!card.querySelector('.chat-media'))create(card,source);}
  function attach(card,source){
    if(!api||!kindOf(source.name))return;
    releaseDetached();sources.set(card,source);
    const session=epoch;
    if(source.name==='Voice message.wav')queueMicrotask(()=>{if(session===epoch)insert(card);});
    api.invoke('chat_media_info',{room:source.room,peer:source.peer,id:source.id}).then(info=>{if(session===epoch){if(info)markReceived(card);if(info||source.name==='Voice message.wav')insert(card);}},()=>{});
  }
  document.addEventListener('pointerdown',event=>{for(const menu of document.querySelectorAll('.voice-options[open]'))if(!menu.contains(event.target))menu.open=false;});
  function reset(){epoch++;if(active)unload(active);active=null;volume=1;muted=false;}
  function remove(card){if(active&&card.contains(active.root))unload(active);sources.delete(card);card.remove();}
  window.OchatChatMedia=Object.freeze({init(callbacks){api=callbacks;},attach,received:insert,storesInline:offer=>!!kindOf(offer?.name)&&offer.size<=MAX_PREVIEW,reset,remove});
})();
