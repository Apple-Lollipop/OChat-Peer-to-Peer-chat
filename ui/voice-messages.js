/* Explicit native microphone capture. Drafts and previews never leave this device before Send. */
(() => {
  let api, button, panel, label, stop, send, cancel, player, meter;
  let liveWave, previewWave, previewWrap, previewPlay, previewClock, recordingLevels = [], previewDuration = 0;
  let epoch = 0, id = null, target = null, mode = 'idle', timer = null, url = null, polling = false;
  const valid = token => token === epoch && api.context().unlocked;
  function release() {
    clearInterval(timer); timer = null;
    player.pause(); player.removeAttribute('src'); player.load();
    if (url) URL.revokeObjectURL(url);
    url = null;
    recordingLevels = []; previewDuration = 0;
    liveWave?.set([]); previewWave?.set([]); previewWave?.progress(0);
  }
  function reset() {
    epoch++;
    const previous = id, wasActive = mode !== 'idle';
    id = null; target = null; mode = 'idle'; polling = false;
    release(); panel.hidden = true; button.setAttribute('aria-pressed', 'false');
    if (previous || wasActive) api.invoke('cancel_voice_message', { id: previous }).catch(() => {});
    update();
  }
  function update() {
    if (!api) return;
    const context = api.context();
    if (target && (!context.unlocked || context.room !== target.room || context.channel !== target.channel || context.voice)) {
      reset(); return;
    }
    button.disabled = mode !== 'idle' || !context.unlocked || !context.room || !context.connected || context.voice;
    button.title = context.voice ? 'Leave the call to record a voice message' : 'Record a voice message';
    panel.hidden = mode === 'idle'; panel.dataset.mode = mode;
    stop.hidden = mode !== 'recording'; send.hidden = mode !== 'ready';
    player.hidden = true;
    previewWrap.hidden = mode !== 'ready'; meter.hidden = mode !== 'recording';
    cancel.disabled = mode === 'sending';
  }
  async function finish() {
    if (mode !== 'recording') return;
    const token = epoch, recording = id;
    mode = 'stopping'; clearInterval(timer); label.textContent = 'Preparing voice message…'; update();
    try {
      const bytes = await api.invoke('finish_voice_message', { id: recording });
      if (!valid(token)) return;
      const audioBytes = new Uint8Array(bytes), signal = window.OchatWaveform.pcm(audioBytes);
      previewDuration = signal?.duration || 0; previewWave.slider.disabled = !previewDuration; previewWave.set(signal?.peaks || []); previewWave.progress(0, previewDuration);
      previewClock.textContent = window.OchatWaveform.clock(previewDuration);
      url = URL.createObjectURL(new Blob([audioBytes], { type: 'audio/wav' }));
      player.src = url; mode = 'ready'; label.textContent = 'Ready to send'; update();
    } catch (error) { if (valid(token)) { reset(); api.error(error); } }
  }
  async function poll() {
    update();
    if (mode !== 'recording' || polling) return;
    const token = epoch;
    polling = true;
    try {
      const status = await api.invoke('voice_message_status', { id });
      if (!valid(token) || mode !== 'recording') return;
      const seconds = Math.floor(status.seconds);
      label.textContent = `Recording · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} / 3:00`;
      recordingLevels.push(Math.min(1, Math.max(0, Number(status.level) || 0)));
      if (recordingLevels.length > window.OchatWaveform.count) recordingLevels.shift();
      liveWave.set([...Array(window.OchatWaveform.count - recordingLevels.length).fill(0), ...recordingLevels]);
      if (status.full) await finish();
    } catch (error) { if (valid(token)) { reset(); api.error(error); } }
    finally { if (token === epoch) polling = false; }
  }
  async function start() {
    if (button.disabled || mode !== 'idle') return;
    const token = ++epoch;
    target = api.context(); mode = 'starting'; label.textContent = 'Opening microphone…'; update();
    try {
      const recording = await api.invoke('start_voice_message', { room: target.room, channel: target.channel });
      if (!valid(token)) { await api.invoke('cancel_voice_message', { id: recording }); return; }
      id = recording; mode = 'recording'; button.setAttribute('aria-pressed', 'true');
      label.textContent = 'Recording · 0:00 / 3:00'; update();
      timer = setInterval(poll, 200);
    } catch (error) { if (valid(token)) { reset(); api.error(error); } }
  }
  async function submit() {
    if (mode !== 'ready') return;
    const token = epoch;
    mode = 'sending'; label.textContent = 'Sending voice message…'; update();
    try {
      await api.invoke('send_voice_message', { id });
      if (valid(token)) { reset(); button.focus(); }
    } catch (error) {
      if (valid(token)) { mode = 'ready'; label.textContent = 'Not sent · you can retry'; update(); api.error(error); }
    }
  }
  window.OchatVoiceMessages = Object.freeze({
    init(callbacks) {
      api = callbacks;
      const get = name => document.getElementById(name);
      button = get('voice-message-button'); panel = get('voice-message-panel'); label = get('voice-message-status');
      stop = get('voice-message-stop'); send = get('voice-message-send'); cancel = get('voice-message-cancel');
      player = get('voice-message-preview'); meter = get('voice-message-level');
      liveWave = window.OchatWaveform.create(); meter.append(liveWave.root);
      previewWave = window.OchatWaveform.create({seek:fraction => { if (previewDuration) { player.currentTime = fraction * previewDuration; paintPreview(); } }});
      get('voice-preview-wave').append(previewWave.root);
      previewWrap = get('voice-message-preview-wrap'); previewPlay = get('voice-preview-play'); previewClock = get('voice-preview-clock');
      const paintPreview = () => {
        const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : previewDuration;
        previewWave.progress(duration ? player.currentTime / duration : 0, duration);
        previewWave.slider.disabled = !duration;
        previewClock.textContent = window.OchatWaveform.clock(player.currentTime > 0 ? Math.max(0, duration - player.currentTime) : duration);
        previewPlay.setAttribute('aria-label', player.paused ? 'Play voice preview' : 'Pause voice preview');
        previewPlay.querySelector('path').setAttribute('d', player.paused ? 'M9 5v14l11-7z' : 'M7 5h4v14H7zm6 0h4v14h-4z');
      };
      previewPlay.onclick = () => { if (player.paused) player.play().catch(api.error); else player.pause(); };
      for (const event of ['timeupdate','play','pause','ended','loadedmetadata']) player.addEventListener(event, paintPreview);
      player.addEventListener('error', () => { if (mode === 'ready') api.error('This voice preview could not be played. You can discard and record again.'); });
      button.onclick = start; stop.onclick = finish; cancel.onclick = () => { reset(); button.focus(); }; send.onclick = submit;
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && mode !== 'idle' && mode !== 'sending') { event.preventDefault(); reset(); button.focus(); } });
      window.addEventListener('beforeunload', reset);
      update();
    }, update, reset
  });
})();
