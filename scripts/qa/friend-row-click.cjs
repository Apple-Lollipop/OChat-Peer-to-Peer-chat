/* Actual pointer/keyboard friend actions, with synthetic native IPC only. */
const {fixture,server}=require('./visual.cjs'),{chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  for(const theme of ['light','dark'])for(const width of [480,1180]){
   const page=await browser.newPage({viewport:{width,height:width===480?520:850},colorScheme:theme});
   await page.addInitScript(fixture,theme);
   await page.addInitScript(()=>{window.__friendChatOpens=0;const invoke=window.__TAURI__.core.invoke;window.__TAURI__.core.invoke=async(command,args)=>{
    if(command==='open_direct'){window.__friendChatOpens++;return '10000000-0000-4000-8000-000000000002';}
    if(command==='save_conversation_layout')return args.layout;
    return invoke(command,args);
   };});
   await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.body.dataset.qaReady==='true');
   const home=async()=>page.evaluate(()=>{setNavigationSection('friends');render();if(innerWidth<900)closePanel('navigation-dialog');});
   const row=page.locator('#accepted-friend-list .friend-row').first();
   await home();await row.locator('.friend-heading').click();
   await page.waitForFunction(()=>window.__friendChatOpens===1&&document.body.dataset.navigationSection==='rooms');
   assert.equal(await page.locator('#floating-profile').evaluate(node=>node.open),false);
   await home();await row.locator('.friend-more summary').click();await row.locator('.friend-profile-action').click();
   await page.locator('#floating-profile[open]').waitFor();assert.equal(await page.evaluate(()=>window.__friendChatOpens),1);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('floating-profile').open);
   await row.click({position:{x:4,y:4}});await page.waitForFunction(()=>window.__friendChatOpens===2&&document.body.dataset.navigationSection==='rooms');
   await home();await row.locator('.friend-heading').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__friendChatOpens===3&&document.body.dataset.navigationSection==='rooms');
   assert.equal(await page.locator('#floating-profile').evaluate(node=>node.open),false);await page.close();
  }
  console.log('4 real-browser friend-row flows passed: name, row padding and Enter open chat; View profile stays separate');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
