/* Locked UI fixtures only: never reads or deletes a real account. */
const {server}=require('./visual.cjs'),{chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  fs.mkdirSync('releases/reports/account-recovery',{recursive:true});
  for(const theme of ['light','dark'])for(const width of [480,780,1180,1600]){
   const page=await browser.newPage({viewport:{width,height:width===480?520:850},colorScheme:theme}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{
    window.__accountCalls=[];let exists=true;
    window.__TAURI__={event:{listen:async()=>()=>{}},core:{invoke:async(command,args)=>{
     window.__accountCalls.push(command);
     if(command==='account_status')return exists;
     if(command==='prepare_account_reset')return 'synthetic-reset-token';
     if(command==='reset_local_account'){if(!args.acknowledged||args.confirmation!=='DELETE MY ACCOUNT')throw Error('Missing confirmation');exists=false;}
     return null;
    }}};
   });
   await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#auth-dialog[open]').waitFor();
   await page.evaluate(theme=>applyTheme(theme),theme);
   await page.locator('#auth-forgot').click();await page.screenshot({path:`releases/reports/account-recovery/choices-${theme}-${width}.png`});
   await page.locator('#recover-with-key').click();
   await page.locator('#recover-account-key').fill('synthetic recovery key');
   await page.locator('#recover-account-password').fill('new long password 123');await page.locator('#recover-account-confirm').fill('new long password 123');
   const submit=page.locator('#recover-password-form [type=submit]');await submit.scrollIntoViewIfNeeded();
   const box=await submit.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=(width===480?520:850));
   await page.screenshot({path:`releases/reports/account-recovery/key-${theme}-${width}.png`});
   await submit.click();await page.locator('#unlock-form').waitFor({state:'visible'});assert.equal(await page.locator('#recover-account-key').inputValue(),'');
   await page.locator('#auth-forgot').click();await page.locator('#reset-account-choice').click();
   const reset=page.locator('#reset-local-account-form [type=submit]');assert.equal(await reset.isDisabled(),true);
   await page.locator('#reset-account-ack').check();await page.locator('#reset-account-confirmation').fill('DELETE MY ACCOUNT');
   assert.equal(await reset.isDisabled(),false);await reset.scrollIntoViewIfNeeded();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:`releases/reports/account-recovery/reset-${theme}-${width}.png`});
   await reset.click();await page.locator('#create-account-form').waitFor({state:'visible'});
   assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.__accountCalls.filter(c=>c==='reset_local_account').length),1);
   await page.close();
  }
  console.log('8 locked account recovery layouts and explicit recovery/reset flows passed (synthetic IPC only)');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
