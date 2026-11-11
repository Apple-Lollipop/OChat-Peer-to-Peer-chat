const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(t){
 const {Window}=await import('happy-dom');const w=new Window({settings:{enableJavaScriptEvaluation:true,suppressInsecureJavaScriptEnvironmentWarning:true}});t.after(()=>w.happyDOM.close());
 const friends=[{peer:'a',name:'Alpha',status:'accepted',direct_room:'dm-a',last_message_at:20},{peer:'b',name:'Beta',status:'accepted',direct_room:'dm-b',last_message_at:50},{peer:'c',name:'Charlie',status:'accepted',direct_room:'dm-c',last_message_at:0}];
 const doc=w.document;doc.body.innerHTML='<div id="accepted-friend-list"><div class="friend-group" data-label="Online"><h3></h3></div><div class="friend-group" data-label="Offline"><h3></h3></div></div><div id="sent-friend-list">Pending request</div>';
 for(const [i,friend]of friends.entries()){const row=doc.createElement('div');row.className='friend-row';row.dataset.peer=friend.peer;row.dataset.room=friend.direct_room;row.dataset.online=String(i!==1);row.dataset.search=friend.name.toLowerCase();row.innerHTML='<button>'+friend.name+'</button>';doc.querySelector('[data-label="'+(i===1?'Offline':'Online')+'"]').append(row);}
 let active=true,reply=friends;const calls=[],promoted=[];w.OchatCommunity={refresh(){}};
 w.eval(fs.readFileSync('ui/friend-recency.js','utf8'));const api=w.OchatFriendRecency;
 api.init({promote:room=>promoted.push(room),context:()=>({unlocked:active,friends}),invoke:async command=>{calls.push(command);return typeof reply==='function'?reply():reply;}});
 api.render(friends);
 return {w,doc,api,friends,calls,promoted,order:()=>[...doc.querySelectorAll('#accepted-friend-list .friend-row')].map(row=>row.dataset.peer),setActive:value=>active=value,setReply:value=>reply=value};
}
test('recent private conversations precede presence groups and live sent/received messages move existing rows',async t=>{
 const a=await setup(t);assert.deepEqual(a.order(),['b','a','c']);
 const row=a.doc.querySelector('[data-peer="a"]'),button=row.querySelector('button');button.focus();
 a.api.onEvent({type:'message',room:'dm-a',peer:'self',timestamp:70});
 assert.deepEqual(a.order(),['a','b','c']);assert.equal(a.doc.querySelector('[data-peer="a"]'),row);assert.equal(a.doc.activeElement,button);
 a.api.onEvent({type:'message',room:'dm-b',peer:'b',timestamp:100});assert.deepEqual(a.order(),['b','a','c']);
 a.api.onEvent({type:'message',room:'dm-a',peer:'a',timestamp:30});assert.deepEqual(a.order(),['b','a','c']);
 assert.equal(a.doc.getElementById('sent-friend-list').textContent,'Pending request');
});
test('group activity and transient typing/presence never promote a private conversation',async t=>{
 const a=await setup(t);for(const event of [{type:'message',room:'group',peer:'a',timestamp:200},{type:'room_state',room:'dm-a',timestamp:200},{type:'typing',room:'dm-a',timestamp:200}])a.api.onEvent(event);
 assert.deepEqual(a.order(),['b','a','c']);assert.deepEqual(a.calls,[]);
});
test('file activity uses the saved original time and ignores a stale response after Lock',async t=>{
 const a=await setup(t);a.setReply(a.friends.map(friend=>({...friend,last_message_at:friend.peer==='a'?200:friend.last_message_at})));
 a.api.onEvent({type:'file_offered',room:'dm-a'});await flush();assert.deepEqual(a.order(),['a','b','c']);
 let resolve;a.setReply(()=>new Promise(r=>resolve=r));a.api.onEvent({type:'file_offered',room:'dm-b'});a.setActive(false);a.api.reset();
 resolve(a.friends.map(friend=>({...friend,last_message_at:1000})));await flush();
 a.friends.forEach(friend=>friend.last_message_at=0);a.api.render(a.friends);
 assert.deepEqual(a.order(),['a','c','b']);assert.equal(a.doc.querySelector('[data-label="Recent conversations"]').hidden,true);
});
test('explicit history clearing removes recent placement until a genuinely new message',async t=>{
 const a=await setup(t);a.api.clear('dm-b');assert.deepEqual(a.order(),['a','c','b']);
 a.api.render(a.friends);assert.deepEqual(a.order(),['a','c','b']);
 a.api.onEvent({type:'message',room:'dm-b',timestamp:300});assert.deepEqual(a.order(),['b','a','c']);
});


test('a genuinely new private file promotes the sidebar once, not on replay',async t=>{
 const a=await setup(t);a.setReply(a.friends.map(friend=>({...friend,last_message_at:friend.peer==='a'?200:friend.last_message_at})));
 a.api.onEvent({type:'file_offered',room:'dm-a'});await flush();assert.deepEqual(a.promoted,['dm-a']);
 a.api.onEvent({type:'file_offered',room:'dm-a'});await flush();assert.deepEqual(a.promoted,['dm-a']);
});
