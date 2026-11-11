/* Locked-account recovery only. No local path or decrypted identity crosses this interface. */
(() => {
  let api, current = '', epoch = 0, busy = false, resetToken = null;
  const get = id => document.getElementById(id);
  const fresh = (token, generation) => epoch === token && !api.context().unlocked && api.context().generation === generation;
  function clear() {
    for (const id of ['recover-account-key','recover-account-password','recover-account-confirm','reset-account-confirmation']) get(id).value = '';
    get('reset-account-ack').checked = false;
    for (const id of ['recover-password-form','reset-local-account-form']) get(id).querySelector('.form-error').textContent = '';
    resetToken = null;
  }
  function readyToReset() {
    get('reset-local-account-form').querySelector('[type=submit]').disabled = busy || !resetToken || !get('reset-account-ack').checked || get('reset-account-confirmation').value !== 'DELETE MY ACCOUNT';
  }
  async function run(form, task) {
    if (busy || api.context().unlocked) return;
    const token = epoch, generation = api.context().generation, originalMode = current;
    busy = true;
    const controls = [...get('auth-dialog').querySelectorAll('button,input,textarea')].map(node => [node,node.disabled]);
    controls.forEach(([node]) => { node.disabled = true; });
    const submit = form?.querySelector('[type=submit]'), label = submit?.textContent;
    if (form) { form.querySelector('.form-error').textContent = ''; form.setAttribute('aria-busy','true'); }
    if(submit)submit.textContent=form.id==='recover-password-form'?'Updating password…':resetToken?'Deleting account…':'Preparing confirmation…';
    try { await task(() => fresh(token, generation)); }
    catch (error) { if (fresh(token, generation)) { if(current==='reset-account')resetToken=null; if (form) form.querySelector('.form-error').textContent = String(error?.message || error); else api.toast(error); } }
    finally {
      controls.forEach(([node,disabled]) => { node.disabled = disabled; }); if(submit)submit.textContent=label;form?.removeAttribute('aria-busy');busy = false; readyToReset();
      if(current!==originalMode){const target=current==='unlock'?'unlock-password':current==='create'?'account-name':null;if(target)get(target).focus();}
    }
  }
  function modeChanged(mode) {
    epoch++; current = mode;
    if (!api) return;
    clear(); api.clearPasswords(); readyToReset();
    if (mode === 'recover-key') get('recover-account-key').focus();
    if (mode === 'reset-account') get('reset-account-ack').focus();
  }
  window.OchatAccountRecovery = Object.freeze({
    init(callbacks) {
      api = callbacks;
      get('auth-forgot').onclick = () => { if (!busy) api.mode('recover'); };
      get('recover-with-key').onclick = () => { if (!busy) api.mode('recover-key'); };
      get('reset-account-choice').onclick = () => {
        if (busy) return;
        api.mode('reset-account');
        run(get('reset-local-account-form'), async alive => {
          const token = await api.invoke('prepare_account_reset');
          if (alive()) resetToken = token;
        });
      };
      get('reset-account-ack').onchange = readyToReset;
      get('reset-account-confirmation').oninput = readyToReset;
      get('recover-password-form').onsubmit = event => {
        event.preventDefault();
        if (get('recover-account-password').value !== get('recover-account-confirm').value) {
          event.currentTarget.querySelector('.form-error').textContent = 'Passwords do not match.'; return;
        }
        run(event.currentTarget, async alive => {
          await api.invoke('recover_local_password', {recoveryKey:get('recover-account-key').value.trim(),password:get('recover-account-password').value});
          if (!alive()) return;
          api.mode('unlock'); api.toast('Password updated. Your account and data are preserved. Unlock with your new password.');
          get('unlock-password').focus();
        });
      };
      get('reset-local-account-form').onsubmit = event => {
        event.preventDefault();
        if (!resetToken || !get('reset-account-ack').checked || get('reset-account-confirmation').value !== 'DELETE MY ACCOUNT') return;
        run(event.currentTarget, async alive => {
          await api.invoke('reset_local_account', {token:resetToken,confirmation:get('reset-account-confirmation').value,acknowledged:get('reset-account-ack').checked});
          if (!alive()) return;
          api.accountRemoved(); api.mode('create'); api.toast('Local account deleted. You can now create a new account.');
          get('account-name').focus();
        });
      };
      get('auth-dialog').addEventListener('close', () => { epoch++; clear(); });
      readyToReset();
    }, modeChanged,
    back() {
      if(busy)return true;
      if(current==='recover-key' || current==='reset-account'){api.mode('recover');return true;}
      return false;
    },
    reset() { epoch++; if (api) clear(); }
  });
})();
