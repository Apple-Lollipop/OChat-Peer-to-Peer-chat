/* Private-chat recency is local. Reorder existing friend rows, preserving focus and controls. */
(() => {
  const activity=new Map(),cleared=new Set();let api=null,epoch=0,loading=false;
  const timestamp=value=>Number.isSafeInteger(value)&&value>0?value:0;
  function merge(friends){for(const friend of friends||[])if(friend.status==='accepted'&&friend.direct_room&&!cleared.has(friend.direct_room)){const at=timestamp(friend.last_message_at);if(at)activity.set(friend.direct_room,Math.max(at,activity.get(friend.direct_room)||0));}}
  function render(friends){
    merge(friends);
    const list=document.getElementById('accepted-friend-list');if(!list)return;
    let recent=list.querySelector('.friend-group[data-label="Recent conversations"]');
    if(!recent){recent=document.createElement('div');recent.className='friend-group';recent.dataset.label='Recent conversations';const title=document.createElement('h3');title.className='friend-group-title';recent.append(title);list.prepend(recent);}
    const rows=[...list.querySelectorAll('.friend-row')],online=list.querySelector('.friend-group[data-label="Online"]'),offline=list.querySelector('.friend-group[data-label="Offline"]');
    const focused=document.activeElement;
    const at=row=>cleared.has(row.dataset.room)?0:activity.get(row.dataset.room)||0;
    rows.sort((a,b)=>at(b)-at(a)||(a.dataset.search||'').localeCompare(b.dataset.search||'')||a.dataset.peer.localeCompare(b.dataset.peer));
    for(const group of [recent,online,offline].filter(Boolean)){
      const members=rows.filter(row=>(at(row)>0?recent:row.dataset.online==='true'?online:offline)===group);
      let previous=group.firstElementChild;
      for(const row of members){
        if(previous.nextElementSibling!==row){if(typeof group.moveBefore==='function'&&row.isConnected)group.moveBefore(row,previous.nextSibling);else group.insertBefore(row,previous.nextSibling);}
        previous=row;
      }
      group.hidden=!members.length;group.firstElementChild.textContent=group.dataset.label+' — '+members.length;
    }
    if(focused?.isConnected&&document.activeElement!==focused)focused.focus({preventScroll:true});
    window.OchatCommunity?.refresh();
  }
  function clear(room){activity.delete(room);cleared.add(room);render(api?.context().friends);}
  function onEvent(event){
    if(!api?.context().unlocked)return;
    if(event.type==='room_deleted'){clear(event.room);return;}
    const friend=api.context().friends.find(f=>f.status==='accepted'&&f.direct_room===event.room);if(!friend)return;
    if(event.type==='message'){
      const at=timestamp(event.timestamp);if(!at)return;
      cleared.delete(event.room);activity.set(event.room,Math.max(at,activity.get(event.room)||0));render(api.context().friends);
    }else if(event.type==='file_offered'&&!loading){
      // File offers have no wire timestamp. Read the native persisted original time
      // rather than promoting an old offer replayed during a reconnection.
      const token=epoch,previous=activity.get(event.room)||0;loading=true;
      api.invoke('list_friends').then(friends=>{if(token===epoch&&api.context().unlocked){cleared.delete(event.room);merge(friends);if((activity.get(event.room)||0)>previous)api.promote?.(event.room);render(api.context().friends);}},()=>{}).finally(()=>{if(token===epoch)loading=false;});
    }
  }
  function reset(){epoch++;loading=false;activity.clear();cleared.clear();}
  window.OchatFriendRecency=Object.freeze({init(callbacks){api=callbacks;},render,onEvent,clear,reset});
})();
