import hashlib, os, re, tempfile
from pathlib import Path
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
import fitz
import pytesseract
from PIL import Image
from markitdown import MarkItDown
app=FastAPI(title='Document Processor')
TOKEN=os.environ.get('DOCUMENT_PROCESSOR_TOKEN','')
class Request(BaseModel): path:str; sha256:str

def classify(text:str):
    t=text.upper()
    if 'DESPACHO' in t and re.search(r'Albar[aá]n\s*N[°ºo]?',text,re.I): return 'delivery_note'
    if 'FACTURA' in t:return 'invoice'
    if 'DEVOLU' in t:return 'return_document'
    if 'SOLICITUD' in t:return 'request'
    if 'UNIDAD' in t and 'COMPONENTE' in t:return 'unit_list'
    if 'RESUMEN' in t:return 'summary'
    return 'other'

def ocr_page(page):
    pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
    img=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
    return pytesseract.image_to_string(img,lang=os.environ.get('OCR_LANG','spa'))

@app.post('/process')
def process(req:Request,authorization:str|None=Header(default=None)):
    if TOKEN and authorization != f'Bearer {TOKEN}': raise HTTPException(401,'unauthorized')
    path=Path(req.path)
    if not path.is_file(): raise HTTPException(400,'local file required')
    data=path.read_bytes()
    if hashlib.sha256(data).hexdigest()!=req.sha256: raise HTTPException(400,'sha256 mismatch')
    if data[:5]!=b'%PDF-': raise HTTPException(400,'not a pdf')
    doc=fitz.open(stream=data,filetype='pdf'); pages=[]; md=MarkItDown(enable_plugins=False)
    try:
        for idx,page in enumerate(doc):
            direct=page.get_text('text').strip()
            page_type=classify(direct)
            insufficient=len(direct)<80
            candidate=page_type=='delivery_note' or 'ALBAR' in direct.upper() or 'DESPACHO' in direct.upper()
            text=direct
            needs_ocr=insufficient and candidate
            if needs_ocr:
                try: text=ocr_page(page).strip() or direct
                except Exception: text=direct
                page_type=classify(text)
            # MarkItDown is applied only to a local, isolated single-page PDF.
            with tempfile.NamedTemporaryFile(suffix='.pdf',delete=False) as tmp:
                single=fitz.open(); single.insert_pdf(doc,from_page=idx,to_page=idx); single.save(tmp.name); single.close(); temp_name=tmp.name
            try:
                result=md.convert_local(temp_name)
                markdown=result.text_content or text
            except Exception:
                markdown=text
            finally:
                try: os.unlink(temp_name)
                except OSError: pass
            pages.append({'pageNumber':idx+1,'classification':page_type,'markdown':markdown,'textSufficient':len(text)>=80,'needsOcr':needs_ocr})
        return {'pages':pages,'sha256':req.sha256}
    finally: doc.close()
