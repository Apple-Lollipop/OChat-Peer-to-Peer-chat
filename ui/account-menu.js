/* The account button shows the current availability and opens the status menu. */
(() => {
  const byId=id=>document.getElementById(id);
  const toggle=byId('account-menu-toggle'),menu=byId('account-status-menu');
  const statuses=[...menu.querySelectorAll('[data-availability]')];
  const hints={busy:'Messages and calls arrive silently.',invisible:'Appears offline. Calls and messages can still reveal activity.'};
  const enabled=()=>[...menu.querySelectorAll('button:not(:disabled)')];
  const outside=target=>!menu.contains(target)&&!toggle.contains(target);
  for(const item of statuses)if(hints[item.dataset.availability])item.title=hints[item.dataset.availability];

  function close(restore=false){
    menu.hidden=true;toggle.setAttribute('aria-expanded','false');
    if(restore)toggle.focus({preventScroll:true});
  }
  function open(){
    if(toggle.disabled)return;
    menu.hidden=false;toggle.setAttribute('aria-expanded','true');
    (statuses.find(item=>item.getAttribute('aria-checked')==='true')||enabled()[0])?.focus();
  }
  function choose(item){
    const status=item.dataset.availability;
    close(true);
    if(status===(settings?.availability||'available'))return;
    action(item,async()=>{
      const generation=sessionGeneration;
      await invoke('set_availability',{status});
      if(!unlocked||generation!==sessionGeneration)return;
      settings.availability=status;render();
    });
  }
  function render(){
    const stored=settings?.availability||'available',active=statuses.find(item=>item.dataset.availability===stored)||statuses[0];
    const label=active.querySelector('.account-status-label').textContent;
    for(const item of statuses)item.setAttribute('aria-checked',String(item===active));
    byId('profile-status').textContent=label;
    toggle.disabled=!unlocked;
    toggle.title=hints[active.dataset.availability]||'Set status';
    toggle.setAttribute('aria-label',`${byId('profile-name').textContent}, ${label}. Set status`);
  }
  function reset(){
    close();
    toggle.disabled=true;toggle.removeAttribute('title');toggle.removeAttribute('aria-label');
    for(const item of statuses)item.setAttribute('aria-checked','false');
  }

  toggle.addEventListener('click',()=>{if(menu.hidden)open();else close(true);});
  menu.addEventListener('click',event=>{
    const item=event.target.closest('button');if(!item)return;
    if(item.dataset.availability){choose(item);return;}
    close(true);byId('copy-contact-id').click();
  });
  document.addEventListener('pointerdown',event=>{if(!menu.hidden&&outside(event.target))close();});
  document.addEventListener('focusin',event=>{if(!menu.hidden&&outside(event.target))close();});
  document.addEventListener('keydown',event=>{
    if(menu.hidden){
      if(event.target===toggle&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();open();}
      return;
    }
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close(true);}
    else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      const items=enabled(),index=items.indexOf(document.activeElement);
      event.preventDefault();
      items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
    }
  },true);
  byId('navigation-dialog')?.addEventListener('close',()=>close());
  window.addEventListener('resize',()=>close());
  window.OchatAccountMenu={render,reset};
})();
