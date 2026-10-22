import {randomUUID,createHash} from 'node:crypto';
export const DELIVERY_LIMIT=40,TOTAL_DELIVERY_LIMIT=160,IMAGE_CACHE_LIMIT=32*1024*1024;
const copy=value=>JSON.parse(JSON.stringify(value));
export function deliveryEvent(method,value,time){
  const items=[];let image;
  if(['read_pdf','expand_pdf'].includes(method))for(const p of value.pages)items.push({kind:'text',delivery:p.delivery,page:p.page,passageId:p.passageId,start:p.start,end:p.end,ref:p.textRef,...(p.text!==undefined?{text:p.text}:{}),characters:p.text?.length||0});
  if(method==='render_pdf_page'){
    const item={kind:'image',delivery:value.delivery,ref:value.imageRef,...copy(value.metadata)};
    if(value.image){const bytes=Buffer.from(value.image.data,'base64');item.sha256=createHash('sha256').update(bytes).digest('hex');item.bytes=bytes.length;image={sha256:item.sha256,bytes};}
    items.push(item);
  }
  if(['search_pdf','query_pdf'].includes(method)){const data=JSON.stringify(method==='search_pdf'?value.matches:value.rows,null,2);items.push({kind:'search',delivery:'text',text:data,characters:data.length,pages:method==='search_pdf'?[...new Set(value.matches.map(p=>p.page))]:[]});}
  return {event:{id:randomUUID(),at:new Date(time).toISOString(),method,state:'complete',items},image};
}
export function validDelivery(event){
  return !!event&&typeof event.id==='string'&&/^[a-f\d-]{36}$/.test(event.id)&&Number.isFinite(Date.parse(event.at))&&['read_pdf','expand_pdf','render_pdf_page','search_pdf','query_pdf'].includes(event.method)&&['complete','error'].includes(event.state)&&Array.isArray(event.items)&&event.items.length<=5&&event.items.every(item=>item&&['text','image','search'].includes(item.kind)&&['text','reread','image','resend','reference'].includes(item.delivery)&&(!('text'in item)||typeof item.text==='string'&&item.text.length<=12000)&&(!item.sha256||/^[a-f\d]{64}$/.test(item.sha256)));
}
export function appendDelivery(records,record,event){
  record.deliveries??=[];record.deliveries.push(event);
  while(record.deliveries.length>DELIVERY_LIMIT){record.deliveries.shift();record.deliveryDropped=(record.deliveryDropped||0)+1;}
  let count=[...records.values()].reduce((n,r)=>n+(r.deliveries?.length||0),0);
  while(count>TOTAL_DELIVERY_LIMIT){const oldest=[...records.values()].filter(r=>r.deliveries?.length).sort((a,b)=>Date.parse(a.deliveries[0].at)-Date.parse(b.deliveries[0].at))[0];oldest.deliveries.shift();oldest.deliveryDropped=(oldest.deliveryDropped||0)+1;count--;}
}
