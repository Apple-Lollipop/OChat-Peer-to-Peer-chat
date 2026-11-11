const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(t,override){
 const {Window}=await import('happy-dom');const w=new Window({settings:{enableJavaScriptEvaluation:true,suppressInsecureJavaScriptEnvironmentWarning:true}});t.after(()=>w.happyDOM.close());
 w.document.write(fs.readFileSync('ui/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,''));
 w.eval(fs.readFileSync('ui/passwords.js','utf8'));w.eval(fs.readFileSync('ui/account-recovery.js','utf8'));
 const context={unlocked:false,generation:1,exists:true},calls=[],modes=[],toasts=[];
 const api={context:()=>context,clearPasswords:()=>w.OchatPasswords.reset(),toast:value=>toasts.push(String(value)),accountRemoved:()=>context.exists=false,mode:mode=>{modes.push(mode);w.OchatAccountRecovery.modeChanged(mode);},invoke:async(command,args)=>{
  calls.push({command,args});if(override){const result=override(command,args);if(result!==undefined)return result;}
  return command==='prepare_account_reset'?'challenge-a':null;
 }};
 w.OchatAccountRecovery.init(api);w.OchatAccountRecovery.modeChanged('unlock');
 const get=id=>w.document.getElementById(id),click=async id=>{get(id).click();await flush();},submit=async id=>{get(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();};
 return {w,context,calls,modes,toasts,api,get,click,submit};
}
test('Forgot password is an explicit choice and recovery saves a new password without sending the old one',async t=>{
 const a=await setup(t);assert.equal(a.calls.length,0);await a.click('auth-forgot');assert.equal(a.modes.at(-1),'recover');
 await a.click('recover-with-key');a.get('recover-account-key').value=' ochat-recovery1:synthetic.key ';a.get('recover-account-password').value='new long password 123';a.get('recover-account-confirm').value='different';
 await a.submit('recover-password-form');assert.match(a.get('recover-password-form').textContent,/Passwords do not match/);assert.equal(a.calls.length,0);
 a.get('recover-account-confirm').value='new long password 123';await a.submit('recover-password-form');
 assert.deepEqual(JSON.parse(JSON.stringify(a.calls[0])),{command:'recover_local_password',args:{recoveryKey:'ochat-recovery1:synthetic.key',password:'new long password 123'}});
 assert.equal(a.modes.at(-1),'unlock');assert.equal(a.context.exists,true);assert.equal(a.get('recover-account-key').value,'');assert.equal(a.get('recover-account-password').value,'');assert.equal(a.get('recover-account-confirm').value,'');
});
test('invalid recovery leaves the account in place and exposes a retryable inline error',async t=>{
 const a=await setup(t,command=>command==='recover_local_password'?Promise.reject(Error('Recovery key does not match')):undefined);
 await a.click('recover-with-key');a.get('recover-account-key').value='wrong key';a.get('recover-account-password').value=a.get('recover-account-confirm').value='new password 123';await a.submit('recover-password-form');
 assert.match(a.get('recover-password-form').querySelector('.form-error').textContent,/does not match/);assert.equal(a.context.exists,true);assert.equal(a.modes.at(-1),'recover-key');assert.equal(a.get('recover-password-form').querySelector('[type=submit]').disabled,false);
});
test('local deletion requires a fresh challenge, exact text and acknowledgement before creating a new account',async t=>{
 const a=await setup(t);await a.click('reset-account-choice');assert.deepEqual(a.calls.map(c=>c.command),['prepare_account_reset']);
 const button=a.get('reset-local-account-form').querySelector('[type=submit]');assert.equal(button.disabled,true);
 a.get('reset-account-confirmation').value='DELETE MY ACCOUNT';a.get('reset-account-confirmation').dispatchEvent(new a.w.Event('input'));await a.submit('reset-local-account-form');assert.equal(a.calls.length,1);
 a.get('reset-account-ack').checked=true;a.get('reset-account-ack').dispatchEvent(new a.w.Event('change'));assert.equal(button.disabled,false);
 await a.submit('reset-local-account-form');assert.equal(a.calls.at(-1).command,'reset_local_account');
 assert.deepEqual(JSON.parse(JSON.stringify(a.calls.at(-1).args)),{token:'challenge-a',confirmation:'DELETE MY ACCOUNT',acknowledged:true});
 assert.equal(a.context.exists,false);assert.equal(a.modes.at(-1),'create');assert.equal(a.get('reset-account-confirmation').value,'');assert.equal(a.get('reset-account-ack').checked,false);
});
test('Back discards a delayed reset challenge and all sensitive recovery fields',async t=>{
 let resolve;const a=await setup(t,command=>command==='prepare_account_reset'?new Promise(r=>resolve=r):undefined);
 await a.click('reset-account-choice');a.api.mode('unlock');resolve('old-challenge');await flush();
 a.get('reset-account-ack').checked=true;a.get('reset-account-confirmation').value='DELETE MY ACCOUNT';await a.submit('reset-local-account-form');assert.ok(!a.calls.some(c=>c.command==='reset_local_account'));
 a.api.mode('recover-key');a.get('recover-account-key').value='private key';a.get('recover-account-password').value='password';a.api.mode('unlock');assert.equal(a.get('recover-account-key').value,'');assert.equal(a.get('recover-account-password').value,'');
});
test('a stale recovery response cannot reopen the login page after account state changes',async t=>{
 let resolve;const a=await setup(t,command=>command==='recover_local_password'?new Promise(r=>resolve=r):undefined);
 await a.click('recover-with-key');a.get('recover-account-key').value='private key';a.get('recover-account-password').value=a.get('recover-account-confirm').value='new password 123';
 await a.submit('recover-password-form');a.context.unlocked=true;a.context.generation++;a.get('auth-dialog').dispatchEvent(new a.w.Event('close'));resolve();await flush();
 assert.equal(a.modes.at(-1),'recover-key');assert.equal(a.toasts.length,0);assert.equal(a.get('recover-account-key').value,'');
});
