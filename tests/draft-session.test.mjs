import test from 'node:test';
import assert from 'node:assert/strict';
import {createWindowDrafts} from '../draft-session.mjs';
test('unsaved text survives same-window setup navigation/reload and committed drafts are removed',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const first=createWindowDrafts('drafts',value=>typeof value==='string',{storage});first.set('note','**한국어** $e^{-\\lambda_i t}$');
  const next=createWindowDrafts('drafts',value=>typeof value==='string',{storage});assert.equal(next.get('note'),first.get('note'));next.delete('note');
  assert.equal(createWindowDrafts('drafts',()=>true,{storage}).get('note'),undefined);
});
test('unavailable session storage preserves the in-memory draft and malformed entries do not break reading',()=>{
  const unavailable={getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('quota');}},drafts=createWindowDrafts('drafts',()=>true,{storage:unavailable});
  drafts.set('key','unsaved');assert.equal(drafts.get('key'),'unsaved');assert.equal(drafts.flush(),false);
  const storage={getItem:()=>JSON.stringify([[42,'bad'],['good','source'],['invalid',null]]),setItem(){}};
  const restored=createWindowDrafts('drafts',value=>typeof value==='string',{storage});assert.equal(restored.get('good'),'source');assert.equal(restored.get('invalid'),undefined);
});
