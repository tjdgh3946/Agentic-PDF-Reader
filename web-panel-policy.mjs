export const CHATGPT_HOME='https://chatgpt.com/';
const authHosts=new Set(['chatgpt.com','auth.openai.com','auth0.openai.com','accounts.google.com','appleid.apple.com','account.apple.com','login.live.com','login.microsoftonline.com']);
export function allowedWebNavigation(value){
  try{const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && authHosts.has(url.hostname);}catch{return false;}
}
export function isChatGPTPage(value){try{return new URL(value).origin==='https://chatgpt.com';}catch{return false;}}
export function webPanelBounds(input,area,zoom=1){
  if(!input || !['x','y','width','height'].every(key=>Number.isFinite(input[key])))return null;
  const x=Math.max(0,Math.min(area.width,Math.round(input.x*zoom))),y=Math.max(0,Math.min(area.height,Math.round(input.y*zoom)));
  const width=Math.max(0,Math.min(area.width-x,Math.round(input.width*zoom))),height=Math.max(0,Math.min(area.height-y,Math.round(input.height*zoom)));
  return width>=100 && height>=100?{x,y,width,height}:null;
}
