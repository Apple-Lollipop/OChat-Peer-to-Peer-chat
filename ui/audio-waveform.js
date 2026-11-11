/* Real PCM envelopes and stable waveform bars; no microphone, Web Audio or network access. */
(() => {
  const COUNT = 48, MAX_SAMPLES = 48000 * 180;
  const clock = seconds => { const total = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };
  function pcm(input) {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer || input, input.byteOffset || 0, input.byteLength);
    if (bytes.length < 46 || bytes.length > 44 + MAX_SAMPLES * 2) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = (offset, value) => [...value].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
    if (!text(0, 'RIFF') || !text(8, 'WAVEfmt ') || !text(36, 'data') || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 48000 || view.getUint16(34, true) !== 16) return null;
    const length = view.getUint32(40, true), samples = length / 2;
    if (view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(28, true) !== 96000 || view.getUint16(32, true) !== 2) return null;
    if (length !== bytes.length - 44 || !Number.isInteger(samples) || samples > MAX_SAMPLES) return null;
    const peaks = [];
    for (let bar = 0; bar < COUNT; bar++) {
      const begin = Math.floor(bar * samples / COUNT), end = Math.max(begin + 1, Math.floor((bar + 1) * samples / COUNT));
      let sum = 0, peak = 0, count = 0;
      // Bound visual analysis so a three-minute note cannot monopolize the UI.
      const stride = Math.max(1, Math.floor((end - begin) / 2048));
      for (let i = begin; i < Math.min(end, samples); i += stride) {
        const value = Math.abs(view.getInt16(44 + i * 2, true) / 32768);
        sum += value * value; peak = Math.max(peak, value); count++;
      }
      peaks.push(Math.min(1, Math.sqrt(sum / Math.max(1, count)) * .75 + peak * .25));
    }
    return { peaks, duration: samples / 48000 };
  }
  function create({ seek, label = 'Seek voice message' } = {}) {
    const root = document.createElement('div'); root.className = 'audio-waveform'; root.dataset.signal = 'empty';
    const bars = document.createElement('div'); bars.className = 'audio-waveform-bars'; bars.setAttribute('aria-hidden', 'true');
    const nodes = Array.from({ length: COUNT }, () => { const node = document.createElement('i'); bars.append(node); return node; });
    root.append(bars);
    let slider = null;
    if (seek) {
      slider = document.createElement('input'); slider.type = 'range'; slider.className = 'audio-waveform-seek';
      slider.min = '0'; slider.max = '1000'; slider.step = '1'; slider.value = '0'; slider.disabled = true; slider.setAttribute('aria-label', label);
      slider.oninput = () => seek(Number(slider.value) / 1000); root.append(slider);
    }
    function set(peaks) {
      root.dataset.signal = peaks?.length ? 'ready' : 'empty';
      nodes.forEach((node, i) => {
        const sample = Number(peaks?.[i] || 0), height = Math.max(3, Math.min(38, Math.pow(Math.max(0, sample), .55) * 38));
        node.style.height = `${height.toFixed(2)}px`;
      });
    }
    function progress(value, duration = 0) {
      const fraction = Math.min(1, Math.max(0, value || 0));
      nodes.forEach((node, i) => node.classList.toggle('is-played', i / COUNT < fraction));
      if (slider) { slider.value = String(Math.round(fraction * 1000)); slider.setAttribute('aria-valuetext', `${clock(fraction * duration)} of ${clock(duration)}`); }
    }
    set([]);
    return { root, slider, set, progress };
  }
  window.OchatWaveform = Object.freeze({ create, pcm, clock, count: COUNT });
})();
