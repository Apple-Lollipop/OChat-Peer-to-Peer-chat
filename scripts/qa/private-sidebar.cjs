/* Actual Private sidebar, isolated bridge; no profile or peer connections. */
const {fixture,server}=require('./visual.cjs'),{chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  fs.mkdirSync('releases/reports/private-sidebar',{recursive:true});
  for(const theme of ['light','dark'])for(const width of [480,780,1180,1600]){
   const page=await browser.newPage({viewport:{width,height:width===480?520:850},colorScheme:theme});
   await page.addInitScript(fixture,theme);
   await page.addInitScript(()=>{const invoke=window.__TAURI__.core.invoke;window.__TAURI__.core.invoke=async(command,args)=>{if(command==='save_conversation_layout'){window.__sidebarSaved=args.layout;return args.layout;}return invoke(command,args);};});
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.body.dataset.qaReady==='true');
   const pinned=await page.evaluate(async()=>{
    const pinned=rooms.find(room=>room.capacity===2).id;
    rooms.push({id:'sidebar-alpha',name:'Alex',capacity:2},{id:'sidebar-beta',name:'Sam',capacity:2});
    state.voice=true;state.voice_channel=state.channels.find(channel=>channel.kind==='voice').id;roomSnapshots.set(state.room.id,state);
    await saveLayout({order:[pinned,'sidebar-alpha','sidebar-beta',state.room.id],pinned:[pinned]});
    document.getElementById('message').value='Keep this draft';window.__sidebarSelected=selectedRoom;
    setNavigationSection('friends');render();return pinned;
   });
   if(width<900)await page.evaluate(()=>openNavigation());
   const focus=page.locator('#private-conversation-tabs [data-key="sidebar-beta"] [role=tab]');await focus.focus();assert.equal(await focus.evaluate(node=>node===document.activeElement),true,'Private tab must be focused before the message');
   await page.evaluate(()=>handleEvent({type:'message',room:'sidebar-beta',peer:'beta-peer',name:'Sam',id:'sidebar-beta-live',text:'New private message',timestamp:Date.now(),emojis:[]}));
   await page.waitForFunction(()=>window.__sidebarSaved?.order?.[1]==='sidebar-beta');
   assert.deepEqual(await page.locator('#private-conversation-tabs > [data-key]').evaluateAll(nodes=>nodes.map(node=>node.dataset.key)),[pinned,'sidebar-beta','sidebar-alpha']);
   assert.equal(await focus.evaluate(node=>node===document.activeElement),true,JSON.stringify(await page.evaluate(()=>({width:innerWidth,focus:document.activeElement?.outerHTML.slice(0,400),dialogs:[...document.querySelectorAll('dialog[open]')].map(node=>node.id)}))));
   assert.equal(await page.evaluate(()=>selectedRoom===window.__sidebarSelected&&document.getElementById('message').value==='Keep this draft'&&state.voice),true);
   assert.equal(await focus.isVisible(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:`releases/reports/private-sidebar/${theme}-${width}.png`});await page.close();
  }
  console.log('8 Private sidebar layouts passed: visible list reorders, pinned stays first, focus/draft/voice preserved');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
