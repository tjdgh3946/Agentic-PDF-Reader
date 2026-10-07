import {cleanUsage} from './tokens.mjs';
export async function* responseEvents(body) {
  const decoder=new TextDecoder(); let buffer='';
  function parse(block) {
    const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data || data==='[DONE]') return;
    let event; try {event=JSON.parse(data);} catch {throw new Error('invalid_stream');}
    if(event.type==='response.output_text.delta') return {type:'delta',text:event.delta || ''};
    if(event.type==='response.completed') return {type:'complete',...(event.response?.usage?{usage:cleanUsage(event.response.usage)}:{})};
    if(event.type==='response.failed' || event.type==='error') return {type:'error',code:event.response?.error?.code || event.code || 'response_failed'};
    if(event.type==='response.incomplete') return {type:'error',code:'response_incomplete'};
  }
  for await(const chunk of body) {
    buffer+=decoder.decode(chunk,{stream:true}).replace(/\r/g,'');
    let index;
    while((index=buffer.indexOf('\n\n'))!==-1) {const event=parse(buffer.slice(0,index));buffer=buffer.slice(index+2);if(event)yield event;}
    if(buffer.length>2_000_000) throw new Error('invalid_stream');
  }
  buffer+=decoder.decode();
  if(buffer.trim()) {const event=parse(buffer);if(event)yield event;}
}
export function responseError(code) {
  if(['subscription_sharing_usage_limit_exceeded','subscription_sharing_usage_unavailable','rate_limit_exceeded'].includes(code)) return 'ChatGPT 사용 한도 또는 구독 사용 가능 상태를 확인하세요. ChatGPT 사용량 설정에서 관리할 수 있습니다.';
  if(['context_length_exceeded','input_too_long'].includes(code)) return '논문과 질문이 모델 입력 한도를 넘었습니다. 더 짧은 문서로 시도하세요.';
  if(code==='response_incomplete') return '응답이 끝까지 완료되지 않았습니다. 아래 내용은 부분 응답입니다.';
  return '응답을 완료하지 못했습니다. 잠시 후 다시 시도하세요.';
}
