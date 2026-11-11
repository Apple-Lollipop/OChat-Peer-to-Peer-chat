const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
function wav(samples=48000){
 const bytes=new Uint8Array(44+samples*2),v=new DataView(bytes.buffer);
 for(const [offset,text]of [[0,'RIFF'],[8,'WAVEfmt '],[36,'data']])for(let i=0;i<text.length;i++)bytes[offset+i]=text.charCodeAt(i);
 v.setUint32(4,bytes.length-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,samples*2,true);
 for(let i=Math.floor(samples/2);i<samples;i++)v.setInt16(44+i*2,Math.round(Math.sin(i*.07)*16000),true);
 return bytes;
}
async function setup(t){
 const {Window}=await import('happy-dom');const w=new Window({settings:{enableJavaScriptEvaluation:true,suppressInsecureJavaScriptEnvironmentWarning:true}});t.after(()=>w.happyDOM.close());
 w.eval(fs.readFileSync('ui/audio-waveform.js','utf8'));return w;
}
test('the envelope represents actual silence and voice, with duration and strict PCM bounds',async t=>{
 const w=await setup(t),bytes=wav(),result=w.OchatWaveform.pcm(bytes);
 assert.equal(result.duration,1);assert.equal(result.peaks.length,48);
 assert.ok(result.peaks.slice(0,24).every(value=>value===0));assert.ok(result.peaks.slice(24).every(value=>value>.3));
 assert.equal(w.OchatWaveform.pcm(bytes.slice(0,-2)),null);
 const wrong=bytes.slice();wrong[22]=2;assert.equal(w.OchatWaveform.pcm(wrong),null);
 assert.equal(w.OchatWaveform.pcm(new Uint8Array(44+48000*181*2)),null);
});
test('stable waveform bars support accessible seeking and playback progress without random animation',async t=>{
 const w=await setup(t),seeks=[],wave=w.OchatWaveform.create({seek:fraction=>seeks.push(fraction)});w.document.body.append(wave.root);
 const first=wave.root.querySelector('i');wave.set(Array(48).fill(.4));wave.set(Array(48).fill(.2));assert.equal(wave.root.querySelector('i'),first);
 wave.progress(.5,60);assert.equal(wave.root.querySelectorAll('.is-played').length,24);assert.equal(wave.slider.getAttribute('aria-valuetext'),'0:30 of 1:00');
 wave.slider.disabled=false;wave.slider.value='750';wave.slider.dispatchEvent(new w.Event('input'));assert.deepEqual(seeks,[.75]);
 wave.set([]);assert.equal(wave.root.dataset.signal,'empty');assert.ok([...wave.root.querySelectorAll('i')].every(bar=>parseFloat(bar.style.height)===3));
});
