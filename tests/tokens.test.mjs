import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateInput,cleanUsage} from '../tokens.mjs';
import {responseEvents} from '../stream.mjs';
import {createChats} from '../chats.mjs';
test('local tokenizer counts Korean and literal special-token text without model requests',()=>{
  assert.equal(estimateInput('hello world',false).tokens,2);
  const korean=estimateInput('한국어 논문의 문맥을 설명하세요.',false);
  assert.ok(korean.tokens>2);assert.equal(korean.estimated,true);assert.equal(korean.encoding,'o200k_base');
  assert.ok(estimateInput('hello world',true).tokens>2);
  assert.ok(estimateInput('<|endoftext|>',false).tokens>0);
});
test('usage distinguishes unknown from zero, preserves streamed usage, and saves it with conversation',async()=>{
  assert.deepEqual(cleanUsage(null),{inputTokens:null,cachedTokens:null});
  assert.deepEqual(cleanUsage({input_tokens:0,input_tokens_details:{cached_tokens:0}}),{inputTokens:0,cachedTokens:0});
  const usage={input_tokens:1234,input_tokens_details:{cached_tokens:1000}};
  const response=new Response('data: '+JSON.stringify({type:'response.completed',response:{usage}})+'\n\n');
  const events=[];for await(const event of responseEvents(response.body))events.push(event);
  assert.deepEqual(events,[{type:'complete',usage:{inputTokens:1234,cachedTokens:1000}}]);
  const chats=await createChats(),chat=await chats.create({documentId:'test',fileName:'test.pdf'}),entry=await chats.begin(chat.id,{question:'why',selection:'quote',pageLabel:'p. 1'});
  await chats.update(chat.id,entry.id,'answer','complete',events[0].usage);
  assert.equal((await chats.get(chat.id)).entries[0].usage.inputTokens,1234);
});
