// Keep the extracted source unchanged; geometry supplies candidate paragraph
// boundaries, not rewritten text. PDF reading order can still be imperfect.
export function extractPdfText(items){
  let raw='',lineStart=0,lineItems=[];const lines=[];
  function finish(){if(lineItems.length){const first=lineItems[0];lines.push({start:lineStart,end:raw.length,x:first.transform?.[4]||0,y:first.transform?.[5]||0,height:Math.abs(first.transform?.[3])||first.height||10,text:raw.slice(lineStart).trim()});}lineStart=raw.length;lineItems=[];}
  for(const item of items)if('str' in item){lineItems.push(item);raw+=item.str+(item.hasEOL?'\n':' ');if(item.hasEOL)finish();}
  finish();const trim=raw.length-raw.trimStart().length,text=raw.trim(),breaks=[];
  for(let i=1;i<lines.length;i++){
    const a=lines[i-1],b=lines[i],gap=a.y-b.y,height=Math.max(a.height,b.height),heading=a.text.length<95&&(/^(?:\d+(?:\.\d+)*\s|Theorem\s|Lemma\s|Proposition\s|Figure\s|Proof\b|Conclusion\b)/i.test(a.text));
    if(gap>height*1.55||gap<-height||b.x>a.x+height*.7&&/[.!?:)\]]$/.test(a.text)||heading||/^(?:Theorem|Lemma|Proposition|Corollary|Proof|Figure)\s/i.test(b.text)){
      const offset=b.start-trim;if(offset>0&&offset<text.length)breaks.push(offset);
    }
  }
  return {text,breaks};
}
