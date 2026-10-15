"""Build the illustrated Korean Windows guide from actual app screenshots.

Requires reportlab and Pillow on the documentation builder only.
Usage: python scripts/build-user-guide.py
"""
from pathlib import Path
from html import escape
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'docs' / 'guide-images'
OUT = ROOT / 'output' / 'pdf' / 'Agentic-PDF-Reader-0.11.1-설치-사용설명서.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('Korean', 'C:/Windows/Fonts/malgun.ttf'))
pdfmetrics.registerFont(TTFont('KoreanBold', 'C:/Windows/Fonts/malgunbd.ttf'))
pdfmetrics.registerFont(TTFont('Code', 'C:/Windows/Fonts/consola.ttf'))
pdfmetrics.registerFontFamily('Korean', normal='Korean', bold='KoreanBold')
W, H = A4
M, WIDTH = 40, W-80
INK, MUTED, RULE, SAGE = map(HexColor, ['#211b18','#766e66','#ded9d2','#edf1e9'])
BODY = ParagraphStyle('Body', fontName='Korean', fontSize=10.3, leading=17, textColor=INK, wordWrap='CJK', spaceAfter=9)
SMALL = ParagraphStyle('Small', parent=BODY, fontSize=8.4, leading=13, textColor=MUTED)
TITLE = ParagraphStyle('Title', parent=BODY, fontName='KoreanBold', fontSize=23, leading=32)
SUB = ParagraphStyle('Sub', parent=BODY, fontName='KoreanBold', fontSize=12.5, leading=20)
c = canvas.Canvas(str(OUT), pagesize=A4)
c.setTitle('Agentic PDF Reader 0.11.1 설치·사용설명서')
c.setAuthor('Agentic PDF Reader')
page = 0
y = H-75

def para(text, style=BODY, x=M, width=WIDTH):
    global y
    p = Paragraph(text, style)
    _, height = p.wrap(width, H)
    if y-height < 52: raise ValueError(f'Page {page} overflows: {text[:60]}')
    p.drawOn(c,x,y-height); y -= height + style.spaceAfter

def begin(title, lead):
    global page,y
    if page: c.showPage()
    page+=1; y=H-78
    c.setFillColor(MUTED);c.setFont('Korean',8)
    c.drawString(M,H-32,'AGENTIC PDF READER / 설치·사용설명서')
    c.setStrokeColor(RULE);c.line(M,H-43,W-M,H-43)
    c.setFillColor(MUTED);c.drawString(M,28,'Windows x64 · 0.11.1 · 2026-10-15')
    c.drawRightString(W-M,28,f'{page:02d} / 08')
    para(title,TITLE);para(lead,SMALL)

def heading(text):
    global y
    y-=5;para(text,SUB)

def step(n,title,text):
    global y
    c.setFillColor(SAGE);c.roundRect(M,y-21,24,24,3,fill=1,stroke=0)
    c.setFillColor(INK);c.setFont('KoreanBold',9);c.drawCentredString(M+12,y-13,str(n))
    para(f'<b>{escape(title)}</b><br/>{text}',x=M+35,width=WIDTH-35)

def picture(name,caption,max_height=280,width=WIDTH):
    global y
    file=ASSETS/name
    with Image.open(file) as im:iw,ih=im.size
    scale=min(width/iw,max_height/ih);dw,dh=iw*scale,ih*scale
    if y-dh-28<52:raise ValueError(f'Image overflows page {page}: {name}')
    x=M+(WIDTH-dw)/2
    c.setStrokeColor(RULE);c.rect(x-1,y-dh-1,dw+2,dh+2)
    c.drawImage(str(file),x,y-dh,width=dw,height=dh,mask='auto')
    y-=dh+8;para(caption,SMALL)

begin('논문을 읽고, 묻고, 기억하기','설치부터 첫 질문까지. 앱 화면은 0.11.1과 1806.07572v4.pdf로 촬영했습니다. ChatGPT 화면은 실제 연결 검증 기록입니다.')
para('Agentic PDF Reader',ParagraphStyle('Hero',fontName='Times-Roman',fontSize=29,leading=36,textColor=INK,spaceAfter=10))
picture('reader.png','PDF 왼쪽, 질문 작성 아래쪽, ChatGPT 또는 질문 기록 오른쪽. 로그인하지 않아도 PDF와 노트를 사용할 수 있습니다.',max_height=254)
heading('처음 쓰는 분은 이 순서로')
step(1,'설치하고 인증 시점 선택','지금 연결하거나 나중에 설정합니다. → 2쪽')
step(2,'필요한 계정과 Link 연결','ChatGPT 로그인과 논문 검색용 터널은 각각 설정합니다. → 3쪽')
step(3,'PDF를 열고 질문하기','선택 문장·현재 페이지·AI 문맥 검색 중 필요한 범위로 묻습니다. → 4-5쪽')
step(4,'노트와 질문 기록 다시 읽기','원문으로 이동하고 Markdown·수식을 확인합니다. → 6-7쪽')
para('문제가 생기면 8쪽의 오류별 조치부터 확인하세요.',SMALL)

begin('01 / 설치와 인증 시점','설치 프로그램에는 API 키나 비밀번호를 입력하지 않습니다.')
step(1,'설치 EXE 실행','Agentic-PDF-Reader-0.11.1-install.exe를 실행하고 설치 위치를 선택합니다. Node.js나 별도 터널 실행기 설치는 필요 없습니다.')
step(2,'지금 인증 설정 또는 나중에 설정','<b>지금 인증 설정</b>은 설치 후 계정 연결 화면을 엽니다. <b>나중에 설정</b>은 바로 읽기로 이동합니다. 기본값은 나중에 설정입니다.')
step(3,'설치 완료 후 앱 실행','바탕 화면 또는 시작 메뉴의 Agentic PDF Reader를 사용합니다. 설치 완료 화면에서 실행을 해제했다면 인증 선택은 다음 실행에 적용됩니다.')
picture('welcome-tight.png','앱 첫 실행의 연결 선택 화면. 설치 프로그램의 선택 페이지와 별개의 앱 화면입니다.',max_height=238)
heading('건너뛴 인증을 다시 설정하려면')
para('상단 <b>환경 설정 → 인증·Link 설정 열기</b>를 누릅니다. 연결 화면의 <b>나중에 설정</b>을 누르면 읽기로 돌아옵니다. 인증 전에도 PDF 열기, 읽던 위치 복원, 하이라이트와 노트를 사용할 수 있습니다.')

begin('02 / ChatGPT와 Link 연결','ChatGPT 웹 로그인과 Runtime API key는 서로 다른 인증입니다.')
step(1,'ChatGPT 계정 로그인','<b>ChatGPT 로그인 화면 열기</b>를 누르고 오른쪽 실제 ChatGPT에서 로그인합니다. 웹 계정과 모델도 그 화면에서 선택합니다. 기존 앱 전용 로그인 세션이 있으면 재사용합니다.')
step(2,'논문 검색용 Link 준비','각 입력란 옆 <b>터널 만들기 · ID 찾는 방법</b>, <b>키 발급 · 권한 설정 방법</b>을 누르면 앱 안의 단계별 설명이 열립니다. 설명 안에서 터널·API 키 관리와 공식 안내로 바로 이동할 수 있습니다.')
picture('link-setup.png','입력란 옆의 설정 방법 링크. 설명을 열고 닫아도 작성 중인 ID와 키가 유지됩니다.',max_height=265)
step(3,'키 저장하고 Link 시작','키를 앱의 Runtime API key 입력란에만 붙여넣습니다. ChatGPT 플러그인/작업 공간도 <b>같은 터널</b>에 연결합니다. 실행 중 표시는 프로세스 상태이며 실제 도구 연결은 ChatGPT에서 확인합니다.')
para('저장된 키는 Windows 계정에 묶어 암호화합니다. 같은 터널의 저장된 키가 있으면 입력을 비워두거나 저장된 설정으로 시작하세요. 설정을 마치고 읽기 시작을 누릅니다.',SMALL)

begin('03 / PDF 열기와 질문 작성','원본 PDF를 수정하지 않고, 문서별 읽기 위치와 노트를 이 PC에 저장합니다.')
step(1,'PDF 열기','상단 <b>PDF 열기</b>에서 파일을 선택합니다. 뷰어의 페이지 입력과 확대/축소로 이동합니다. 같은 PDF를 다시 열면 읽던 페이지·배율·회전·질문 초안을 복원합니다.')
step(2,'선택 문장 또는 현재 페이지 기준','PDF에서 문장을 선택하면 해당 문장을 기준으로 묻습니다. 선택이 없으면 현재 페이지를 기준으로 합니다. 설명·번역·수식 질문 버튼은 질문 초안을 만듭니다.')
picture('composer.png','질문 작성 영역. 초안 버튼을 누른 뒤 입력 내용을 확인하고 전송합니다.',max_height=224)
step(3,'오른쪽 ChatGPT로 보내기','Windows 앱에서는 <b>ChatGPT에 질문 보내기</b>를 누릅니다. 오른쪽 로그인과 입력창이 준비돼 있어야 합니다. 작성 중인 웹 초안이나 생성 중인 답변이 있으면 먼저 마칩니다.')
para('Ctrl+Enter는 현재 질문 동작을 실행합니다. localhost를 일반 브라우저에서 열면 내장 ChatGPT 패널이 없으므로 질문 복사 후 붙여넣습니다. 설명·번역·수식 버튼만으로 질문이 자동 전송되지는 않습니다.',SMALL)
heading('긴 논문을 읽을 때')
para('집중 읽기(F8)로 PDF를 넓히고, 논문 노트를 열어 수식과 답변을 대조합니다. 가운데 경계를 드래그해 오른쪽 영역의 폭을 조절할 수 있습니다.')

begin('04 / 모델이 문맥과 그림 찾기','Paper Reader Link를 연결하면 사용자가 페이지를 미리 고르지 않아도 모델이 필요한 자료를 찾습니다.')
step(1,'AI가 문맥 찾기 켜기','문맥 설정에서 <b>AI가 문맥 찾기 · PDF 전체/이미지</b>를 선택합니다. 질문 당시 PDF를 고정본으로 공유하고 모델은 이 고정본을 검색합니다.')
step(2,'구체적으로 질문하기','예: “Figure 3(c)에서 작은 네트워크가 더 빨리 수렴하는 이유를 Figure 1과 연결해 설명해 주세요. 축과 범례를 실제 그림으로 확인하고 근거 PDF 페이지를 표시해 주세요.”')
picture('model-figure.png','실제 내장 ChatGPT에서 그림을 확인한 답변의 수식과 주의점 부분. 계정 메뉴와 다른 대화 목록은 없습니다.',max_height=279)
step(3,'근거와 저장 여부 확인','Link 활동 안내에서 본문 검색·이미지 확인 상태와 읽은 페이지를 확인합니다. <b>답변을 PDF 주석으로 저장</b>을 켠 질문은 모델에 노트 저장도 요청합니다. 실제 저장 성공 후 노트를 확인하세요.')
para('모델은 inspect_pdf → query_pdf → read_pdf → render_pdf_page 순으로 필요한 도구를 선택합니다. 검색된 페이지가 곧 정확한 인용을 보장하지는 않습니다. 근거 버튼으로 원문을 직접 대조하세요.',SMALL)

begin('05 / 논문 노트와 원문 이동','질문 위치와 답변을 함께 보관하고 나중에 원문으로 돌아갑니다.')
picture('notes.png','같은 Markdown/수식 렌더러로 표시한 실제 NTK 답변의 사본. 사용자 원본 기록은 수정하지 않았습니다.',max_height=327)
step(1,'노트 열고 찾기','상단 <b>논문 노트</b>를 누릅니다. 원문·답변 검색으로 필요한 노트를 찾고 페이지 버튼으로 질문 위치에 이동합니다. PDF의 페이지 질문 마커도 해당 노트를 엽니다.')
step(2,'근거 대조하고 수정하기','모델이 읽은 페이지가 있으면 노트의 근거 버튼으로 이동합니다. 수정을 눌러 Markdown 원문을 편집하고 미리보기로 확인합니다. 수동 노트와 하이라이트도 추가할 수 있습니다.')
step(3,'노트 내보내기','<b>노트 내보내기</b>는 해당 PDF의 노트를 Markdown 파일로 저장합니다. 원본 PDF에 주석을 덧쓰는 기능이 아닙니다. 중요한 기록은 내보내기로 별도 보관하세요.')

begin('06 / 질문 기록과 수식','질문 기록은 앱이 보관한 대화입니다. 오른쪽 ChatGPT 웹의 전체 대화를 자동 복제하지는 않습니다.')
picture('history-math.png','기존 NTK 답변의 수식을 질문 기록에서 렌더링한 화면. 제목·목록·강조·표·코드도 지원합니다.',max_height=316)
step(1,'질문 기록으로 전환','오른쪽 <b>질문 기록</b>을 선택합니다. 저장된 대화 목록과 당시 선택 문장·문맥을 확인합니다. 원문 페이지 버튼으로 질문 위치로 돌아갈 수 있습니다.')
step(2,'답변을 기록에 보관','Link에서 저장한 노트는 같은 질문 기록에도 반영됩니다. 웹 답변 미등록 상태라면 <b>답변 붙여넣기</b>로 직접 가져옵니다. 저장된 답변은 다음 질문의 대화 문맥에도 사용할 수 있습니다.')
step(3,'수식은 구분자를 포함해 입력',r'인라인은 <font name="Code">$e^{-\lambda_i t}$</font>, 큰 수식은 <font name="Code">$$...$$</font> 형식으로 입력합니다. 입력창과 편집창에는 원문이 남고 기록·노트에서는 수식으로 표시합니다.')
para('0.11.1은 과거 저장된 명확한 괄호 수식도 화면에서만 복구합니다. 일반 문장과 코드는 바꾸지 않고 저장 원문 및 내보내기 파일도 유지합니다. 잘못 작성된 수식은 노트 수정이나 가져온 답변 수정에서 직접 고칠 수 있습니다.',SMALL)

begin('07 / 문제가 생겼을 때','먼저 오른쪽 ChatGPT 상태와 Link 상태를 구분해서 확인하세요.')
rows=[['증상','조치'],
['ChatGPT 입력창을 찾지 못함','오른쪽 로그인을 마치고 페이지 로딩을 기다립니다. 새로고침 후에도 실패하면 질문을 복사해 직접 보냅니다.'],
['입력했지만 전송 버튼 사용 불가','오른쪽 초안·생성 중인 답변·비활성 전송 버튼을 확인합니다. 직접 전송했다면 중복으로 다시 누르지 않습니다.'],
['Link 실행 중인데 PDF 도구가 안 보임','ChatGPT 플러그인과 터널 ID가 같은지, 조직 및 Tunnels Read + Use 권한이 맞는지 확인합니다. 실행 표시만으로 연결 완료가 보장되지는 않습니다.'],
['절전 또는 인터넷 복구 후 오류','앱과 ChatGPT를 새로고침하고 저장된 설정으로 Link를 다시 시작합니다. 실패하면 연결 설정 화면의 상태 메시지를 확인합니다.'],
['PDF에서 검색 결과가 없음','원문 언어의 키워드·동의어로 바꿉니다. 스캔 PDF는 검색할 텍스트가 없을 수 있어 페이지 이미지로 확인해야 합니다. 현재 OCR 자동 변환은 제공하지 않습니다.'],
['질문 기록에 웹 답변이 없음','ChatGPT 웹 답변은 자동 수집하지 않습니다. Link 노트 저장이 성공했는지 확인하거나 답변 붙여넣기를 사용합니다.']]
table=Table([[Paragraph(escape(cell),SMALL if i else SUB) for cell in row] for i,row in enumerate(rows)],colWidths=[150,WIDTH-150],hAlign='LEFT')
table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),SAGE),('GRID',(0,0),(-1,-1),.5,RULE),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
_,th=table.wrap(WIDTH,H);table.drawOn(c,M,y-th);y-=th+15
heading('업데이트·다른 PC·제거')
para('업데이트 전에 앱을 정상 종료합니다. 같은 Windows 계정의 고정 프로필에서 웹 로그인과 노트를 재사용합니다. 다른 PC에서는 ChatGPT 로그인과 터널 키를 다시 설정해야 합니다. 설치 파일에는 개인 인증 정보가 들어 있지 않습니다.')
para('앱 데이터: %APPDATA%\\Paper Reader<br/>Link 암호화 키: %LOCALAPPDATA%\\PaperReaderLink<br/>Windows 설치된 앱에서 제거해도 사용자 프로필은 남습니다. 필요한 노트는 먼저 Markdown으로 내보내세요.',SMALL)
c.save()
print(OUT)
