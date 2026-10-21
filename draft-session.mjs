// Session storage keeps unsaved text through setup navigation/reload in the
// same window. It is deliberately not a substitute for a committed disk save.
export function createWindowDrafts(key,validate,{storage}={}){
  if(storage===undefined)try{storage=window.sessionStorage;}catch{}
  let map=new Map(),persistent=true;
  try{const entries=JSON.parse(storage?.getItem(key)||'[]');if(Array.isArray(entries))map=new Map(entries.filter(entry=>Array.isArray(entry)&&entry.length===2&&typeof entry[0]==='string'&&validate(entry[1])));}catch{}
  const flush=()=>{try{if(!storage)throw Error('No session storage');storage.setItem(key,JSON.stringify([...map]));persistent=true;}catch{persistent=false;}return persistent;};
  if(typeof window!=='undefined')window.addEventListener('beforeunload',event=>{if(map.size&&!flush()){event.preventDefault();event.returnValue='';}});
  return {
    get:key=>map.get(key),values:()=>map.values(),
    set(key,value){map.set(key,value);flush();},
    delete(key){const result=map.delete(key);flush();return result;},
    flush,get persistent(){return persistent;}
  };
}
