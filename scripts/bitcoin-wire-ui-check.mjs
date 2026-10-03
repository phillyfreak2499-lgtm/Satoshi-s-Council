import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const server=spawn(process.execPath,['.output/server/index.mjs'],{cwd:root,env:{...process.env,PORT:'8123', DATABASE_URL:'', NEWS_DATABASE_URL:'', DESK_DATA_DIR:'/tmp/council-wire-ui-data'},stdio:'ignore'});
let browser;
try{
for(let i=0;i<40;i++){try{await fetch('http://127.0.0.1:8123/healthz');break;}catch{await new Promise(r=>setTimeout(r,200));}}
// Synthetic fixtures test rendering only; these are never ingested or sent to production.
const fixtures=['btc','ai'].flatMap(feed=>Array.from({length:30},(_,i)=>({id:`${feed}-${i}`,feed,title:`${feed.toUpperCase()} fixture headline ${i}: context from its own publisher`,source:feed==='btc'?'CoinDesk':'TechCrunch AI',url:feed==='btc'?`https://www.coindesk.com/${i}`:`https://techcrunch.com/${i}`,published_at:new Date(Date.now()-60000).toISOString(),fetched_at:new Date().toISOString()})));
for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || chromium.executablePath(),args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer','--single-process','--no-zygote'],headless:true});
 const context=await browser.newContext({viewport});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let requests=0;
 await page.route('**/api/news?feed=all',r=>{requests++;return r.fulfill({contentType:'application/json',body:JSON.stringify(fixtures)});});
 await page.goto('http://127.0.0.1:8123/news');
 await page.getByRole('link',{name:/BTC fixture headline/}).first().waitFor();
 assert.equal(await page.getByRole('link',{name:/BTC fixture headline/}).count(),30);assert.equal(await page.getByRole('link',{name:/AI fixture headline/}).count(),0);
 await page.evaluate(()=>{window.wireMarker='retained';window.scrollTo(0,650);});await page.waitForTimeout(100);
 const btcScroll=await page.evaluate(()=>window.scrollY);
 await page.getByRole('tab',{name:'AI',exact:true}).click();await page.getByRole('link',{name:/AI fixture headline/}).first().waitFor();
 assert.ok(page.url().endsWith('?feed=ai'));assert.equal(await page.evaluate(()=>window.wireMarker),'retained');assert.equal(requests,1);
 assert.equal(await page.getByRole('link',{name:/BTC fixture headline/}).count(),0);assert.equal(await page.getByRole('link',{name:/AI fixture headline/}).count(),30);
 assert.equal(await page.evaluate(()=>window.scrollY),0);
 await page.evaluate(()=>window.scrollTo(0,1000));await page.waitForTimeout(100);const aiScroll=await page.evaluate(()=>window.scrollY);
 await page.getByRole('tab',{name:'Bitcoin',exact:true}).click();await page.getByRole('link',{name:/BTC fixture headline/}).first().waitFor();await page.waitForTimeout(100);
 assert.ok(Math.abs(await page.evaluate(()=>window.scrollY)-btcScroll)<3,'BTC scroll restored');
 await page.getByRole('tab',{name:'AI',exact:true}).click();await page.getByRole('link',{name:/AI fixture headline/}).first().waitFor();await page.waitForTimeout(100);
 assert.ok(Math.abs(await page.evaluate(()=>window.scrollY)-aiScroll)<3,'AI scroll restored');assert.equal(requests,1);
 const tabBox=await page.getByRole('tab',{name:'AI',exact:true}).boundingBox();
 const headerBox=await page.locator('.council-site-header').boundingBox();
 assert.ok(tabBox.y >= headerBox.y + headerBox.height,'sticky tabs stay below header');
 await page.goBack();await page.getByRole('link',{name:/BTC fixture headline/}).first().waitFor();await page.waitForTimeout(100);
 assert.ok(Math.abs(await page.evaluate(()=>window.scrollY)-btcScroll)<3,'browser back restores Bitcoin scroll');
 if(process.env.WIRE_SCREENSHOT_DIR)await page.screenshot({path:`${process.env.WIRE_SCREENSHOT_DIR}/wire-${viewport.width}.png`,fullPage:false});
 await page.goto('http://127.0.0.1:8123/news?feed=ai');await page.getByRole('link',{name:/AI fixture headline/}).first().waitFor();assert.equal(await page.getByRole('tab',{name:'AI',exact:true}).getAttribute('aria-selected'),'true');
 await page.getByRole('tab',{name:'AI',exact:true}).focus();await page.keyboard.press('ArrowLeft');await page.getByRole('link',{name:/BTC fixture headline/}).first().waitFor();assert.equal(await page.getByRole('tab',{name:'Bitcoin',exact:true}).getAttribute('aria-selected'),'true');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'no horizontal overflow');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({viewport,passed:true,initialFetchesBeforeReload:1,checks:['default BTC','strict tag separation','no reload/request on switch','per-tab scroll','direct AI URL','keyboard','no horizontal overflow','no browser errors']}));
 await context.close();await browser.close();browser=undefined;
}
}finally{await browser?.close();server.kill("SIGKILL");}
