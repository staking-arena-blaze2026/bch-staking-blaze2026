// Read-only browser verification; blocked sockets prevent blockchain or wallet activity.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Markdown from 'react-markdown';
import {launchOptions} from './browser-options.mjs';
const source=await readFile(new URL('../../ABOUT.md',import.meta.url),'utf8');
const expected=renderToStaticMarkup(createElement(Markdown,{children:source}));
let server;
let base=process.argv[2];
if(!base){
 const root=resolve('.pages-production'),prefix='/staking-arena-blaze-site/';
 server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=resolve(root,pathname.slice(prefix.length)||'index.html');
  if(!pathname.startsWith(prefix)||!file.startsWith(root+'/')){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 base=`http://127.0.0.1:${server.address().port}${prefix}`;
}
const browser=await chromium.launch(launchOptions);
try{
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:844}});
  await context.routeWebSocket(/^wss?:\/\//,socket=>socket.close());
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.addInitScript(()=>localStorage.setItem('stake-arena-welcome-dismissed','1'));
  await page.goto(base+'#/about');
  await page.locator('.about-document').waitFor();
  const normalized=await page.evaluate(html=>{const element=document.createElement('div');element.innerHTML=html;const section=[...element.querySelectorAll('strong')].find(node=>node.textContent==='Zero-Interest, Redemption-Protected Stablecoin Minting');section?.setAttribute('id','stablecoin');section?.setAttribute('tabindex','-1');return element.innerHTML;},expected);
  assert.equal(await page.locator('.about-document').innerHTML(),normalized,'Exact Markdown rendering');
  assert.equal(await page.locator('.about-document ol > li').count(),4);
  assert.equal(await page.locator('.about-document > ul > li').count(),4);
  assert(await page.getByRole('link',{name:'About',exact:true}).isVisible());
  assert(await page.getByRole('link',{name:'← Back to marketplace'}).isVisible());
  assert.equal(await page.getByRole('button',{name:/connect wallet/i}).count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.reload();await page.locator('.about-document').waitFor();
  await page.getByRole('link',{name:'← Back to marketplace'}).click();
  await page.getByRole('link',{name:'Make an Offer',exact:true}).waitFor();
  await page.getByRole('link',{name:'About',exact:true}).click();
  await page.locator('.about-document').waitFor();
  await page.goBack();await page.getByRole('link',{name:'Make an Offer',exact:true}).waitFor();
  await page.goForward();await page.locator('.about-document').waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({base,width,exactDocument:true,directLink:true,reload:true,navigation:true,overflow:false,pageErrors:errors}));
  await context.close();
 }
}finally{await browser.close();if(server)await new Promise(done=>server.close(done));}
