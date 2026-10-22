import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedWebNavigation,isChatGPTPage,webPanelBounds,stableChatGPTUserAgent} from '../web-panel-policy.mjs';

test('ChatGPT browser identity stays the same across Paper Reader releases',()=>{
  const old='Mozilla/5.0 PaperReader/0.9.1 Chrome/150.0.7871.250 Electron/43.7.8 Safari/537.36';
  const next=old.replace('0.9.1','0.9.2');
  assert.equal(stableChatGPTUserAgent(old),stableChatGPTUserAgent(next));
  assert.match(stableChatGPTUserAgent(next),/Chrome\/150\.0\.7871\.250 Electron\/43\.7\.8/);
  assert.equal(stableChatGPTUserAgent('Mozilla/5.0 Chrome/150 Safari/537.36'),'Mozilla/5.0 Chrome/150 Safari/537.36');
});
test('embedded web navigation keeps auth hosts isolated from local app and privileged schemes',()=>{
  for(const url of ['https://chatgpt.com/c/123','https://auth.openai.com/login','https://accounts.google.com/o/oauth2/auth'])assert.equal(allowedWebNavigation(url),true);
  for(const url of ['http://chatgpt.com/','https://chatgpt.com.evil.test/','https://evil.test/','file:///C:/','javascript:alert(1)','http://127.0.0.1:1234/','https://user:pass@chatgpt.com/'])assert.equal(allowedWebNavigation(url),false);
  assert.equal(isChatGPTPage('https://chatgpt.com/c/123'),true);assert.equal(isChatGPTPage('https://auth.openai.com/'),false);
});
test('native browser bounds stay inside window content and handle app zoom',()=>{
  assert.deepEqual(webPanelBounds({x:700,y:200,width:640,height:700},{width:1400,height:950}),{x:700,y:200,width:640,height:700});
  assert.deepEqual(webPanelBounds({x:700,y:200,width:640,height:700},{width:1400,height:950},1.25),{x:875,y:250,width:525,height:700});
  assert.equal(webPanelBounds({x:Infinity,y:0,width:400,height:600},{width:1400,height:950}),null);
  assert.equal(webPanelBounds({x:1400,y:0,width:400,height:600},{width:1400,height:950}),null);
});


test('left nonmodal note editor preserves ChatGPT while actual overlapping or modal UI remains protected',async()=>{
  const {webPanelObstructed}=await import('../web-panel-ui.mjs');
  const host={x:640,y:100,right:1280,bottom:800},bounds={x:8,y:100,right:624,bottom:800},base={host,notesOpen:false,resizing:false,readingFocus:false};
  assert.equal(webPanelObstructed({...base,overlays:[{readerEditor:true,modal:false,bounds}]}),false);
  assert.equal(webPanelObstructed({...base,overlays:[{readerEditor:true,modal:false,bounds:{...bounds,right:700}}]}),true);
  assert.equal(webPanelObstructed({...base,overlays:[{readerEditor:true,modal:true,bounds}]}),true);
  assert.equal(webPanelObstructed({...base,overlays:[{readerEditor:false,modal:false,bounds}]}),true);
  for(const key of ['notesOpen','resizing','readingFocus'])assert.equal(webPanelObstructed({...base,[key]:true,overlays:[]}),true);
});

test('small margin note markers stay separated and inside the page near its edges',async()=>{
  const {noteMarkerTop}=await import('../annotation-geometry.mjs');const occupied=[];
  for(let i=0;i<10;i++)noteMarkerTop(799,occupied,800);
  assert.equal(new Set(occupied).size,10);assert.ok(occupied.every(value=>value>=11&&value<=789));
  for(let i=0;i<occupied.length;i++)for(let j=i+1;j<occupied.length;j++)assert.ok(Math.abs(occupied[i]-occupied[j])>=22);
});
