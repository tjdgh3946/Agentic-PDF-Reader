import {getDocument,GlobalWorkerOptions} from './pdfjs/build/pdf.mjs';
import {extractPdfText} from './pdf-text.mjs';
GlobalWorkerOptions.workerSrc=new URL('./pdfjs/build/pdf.worker.mjs',import.meta.url).href;
let pdf;
window.pdfProcessing.onRequest(async({id,method,bytes,limits,page,region,extractText=true})=>{
  try{
    let value;
    if(method==='load'){
      pdf=await getDocument({data:new Uint8Array(bytes),isEvalSupported:false,cMapUrl:new URL('./pdfjs/web/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./pdfjs/web/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./pdfjs/web/wasm/',import.meta.url).href}).promise;
      if(pdf.numPages>limits.pages)throw Error('PDF는 최대 1,000페이지까지 지원합니다.');
      const pages=[],paragraphBreaks=[];let length=0;
      for(let number=1;extractText&&number<=pdf.numPages;number++){
        const target=await pdf.getPage(number),content=await target.getTextContent();
        const {text,breaks}=extractPdfText(content.items);
        length+=text.length;if(length>limits.text)throw Error('PDF 본문이 12M자 추출 한도를 넘었습니다.');pages.push(text);paragraphBreaks.push(breaks);
      }
      value={...(extractText?{pages,paragraphBreaks}:{}),pageCount:pdf.numPages,documentId:pdf.fingerprints[0]};
    }else if(method==='render'){
      const target=await pdf.getPage(page),base=target.getViewport({scale:1}),[x,y,w,h]=region;
      const overviewScale=2000/Math.max(base.width,base.height),scale=Math.min(2000/Math.max(w*base.width,h*base.height),overviewScale*8),viewport=target.getViewport({scale});
      // Render directly into a bounded crop canvas at increased resolution.
      // Do not allocate the much larger full-page canvas at this zoom level.
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*viewport.width));canvas.height=Math.max(1,Math.round(h*viewport.height));
      await target.render({canvasContext:canvas.getContext('2d'),viewport,transform:[1,0,0,1,-x*viewport.width,-y*viewport.height],background:'white'}).promise;
      value={image:{data:canvas.toDataURL('image/png').split(',')[1],mimeType:'image/png'},metadata:{page,region,width:canvas.width,height:canvas.height,zoom:scale/overviewScale,rotation:target.rotate,coordinates:'top-left 0–1 on intrinsic PDF rotation; independent of viewer rotation'}};
      canvas.width=canvas.height=0;
    }else throw Error('지원하지 않는 PDF 렌더 동작입니다.');
    window.pdfProcessing.reply({id,value});
  }catch(error){window.pdfProcessing.reply({id,error:error.name==='PasswordException'?'암호화된 PDF는 잠금을 해제한 원본으로 다시 열어주세요.':error.message});}
});
window.pdfProcessing.ready();
