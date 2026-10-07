import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedWebNavigation,isChatGPTPage,webPanelBounds} from '../web-panel-policy.mjs';
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
