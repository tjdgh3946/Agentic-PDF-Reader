// Shared by the browser and server; never import Node/auth modules here.
class EvidenceError extends Error {constructor(){super('PDF 근거 정보가 올바르지 않습니다.');this.status=400;}}

export function validateEvidence(value){
  const validRegion=r=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r[0]>=0&&r[1]>=0&&r[2]>=.02&&r[3]>=.02&&r[0]+r[2]<=1.000001&&r[1]+r[3]<=1.000001;
  if(!value||!/^[a-f\d]{64}$/.test(value.snapshotId)||!Array.isArray(value.pages)||value.pages.length>60||typeof value.truncated!=='boolean'||new Set(value.pages.map(p=>p?.page)).size!==value.pages.length||value.pages.some(p=>!p||!Number.isInteger(p.page)||p.page<1||p.page>1000||typeof p.text!=='boolean'||typeof p.image!=='boolean'||!p.text&&!p.image||!Array.isArray(p.regions)||p.regions.length>5||!p.regions.every(validRegion)||!p.image&&p.regions.length))throw new EvidenceError();
  return {snapshotId:value.snapshotId,truncated:value.truncated,pages:value.pages.map(p=>({page:p.page,text:p.text,image:p.image,regions:p.regions.map(r=>[...r])}))};
}
export function recordEvidence(evidence,method,value,args){
  const pages=['read_pdf','expand_pdf'].includes(method)?value.pages.map(p=>p.page):method==='render_pdf_page'?[args.page]:[];
  for(const page of pages){
    let entry=evidence.pages.find(p=>p.page===page);
    if(!entry){if(evidence.pages.length>=60){evidence.truncated=true;continue;}entry={page,text:false,image:false,regions:[]};evidence.pages.push(entry);}
    if(['read_pdf','expand_pdf'].includes(method))entry.text=true;
    if(method==='render_pdf_page'){
      entry.image=true;const region=value.metadata.region;
      if(!entry.regions.some(r=>JSON.stringify(r)===JSON.stringify(region))){if(entry.regions.length<5)entry.regions.push([...region]);else evidence.truncated=true;}
    }
  }
  evidence.pages.sort((a,b)=>a.page-b.page);
}
export const evidenceLabel=page=>'p. '+page.page+' · '+(page.text&&page.image?'본문·이미지':page.image?'이미지':'본문');
