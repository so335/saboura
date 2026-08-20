








  // تهيئة PDF.js — دعم النصوص العربية والخطوط القياسية (يحل مشكلة الكلمات المكسورة)
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    window.__PDF_CMAP_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/';
    window.__PDF_STANDARD_FONT_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/';
  }







'use strict';
const State = {tool:'pen',color:'#000000',brushSize:4,shape:'free',dashed:false,highlight:false,fill:false,isDrawing:false,isPanning:false,startX:0,startY:0,lastX:0,lastY:0,snapshot:null,history:[],historyIndex:-1,maxHistory:30,editingStudentId:null,editingAnswerId:null,editingQuizId:null,editingWordId:null,selectedRating:3,selectedCorrect:-1,laserOn:false,spotlightOn:false,magnifierOn:false,curtainOpen:false,presentMode:false,timer:{mode:'stopwatch',seconds:0,running:false,interval:null,totalSec:0,volume:0.85,soundType:'elegant',tickType:'classic_clock',started:false},videoDrawOn:false,pdfDrawOn:false,pdfDoc:null,pdfPage:1,pdfTotal:0,pdfZoom:1.2,pdfFitMode:'width',currentLiveCode:null,sel:{active:false,x:0,y:0,w:0,h:0,data:null,dragging:false,dx:0,dy:0,floatX:0,floatY:0,floatW:0,floatH:0,lastDrawX:0,lastDrawY:0,hasFloat:false,clipboard:null,resizing:false,resizeDir:null,resizeStart:null},
  // ====== نظام الشرائح / الصفحات ======
  pages: [],          // مصفوفة الشرائح — كل عنصر: {id,name,canvas,stickyNotes,boardItems,mindmapHTML,mindmapVisible,history,historyIndex,bgType}
  currentPage: 0,     // فهرس الشريحة الحالية
  pageCounter: 0,     // عداد لتعيين IDs فريدة
  _suppressPageSave: false  // منع تكرار الحفظ أثناء استعادة الشريحة
};
/* ===== فصول المدرسة ===== */
const CLASSES = [
  {id:'1/1', label:'الأول - 1', grade:'الأول'},
  {id:'1/2', label:'الأول - 2', grade:'الأول'},
  {id:'2/1', label:'الثاني - 1', grade:'الثاني'},
  {id:'2/2', label:'الثاني - 2', grade:'الثاني'},
  {id:'3/1', label:'الثالث - 1', grade:'الثالث'}
];
const Data = {
  students:[],
  answers:[],
  quizzes:[],
  words:[],
  behavior:[],
  polls:[],
  exitTickets:[],
  lessonPlans:[],
  teachers:[],                // [{id,name,classes:[ids],createdAt}]
  activeTeacherId:null,       // المعلمة النشطة حالياً
  attendance:[],              // سجل الحضور والغياب — [{id,sessionId,code,sessionName,classId,startedAt,endedAt,records:[{studentKey,name,status,joinedAt,leftAt,note}}], ...]
  settings:{boardName:'حصة تفاعلية',grid:'on',bgColor:'#ffffff',fontSize:20,teacherName:'أ. سوزان كليب',bgType:'grid'}
};
/* ⭐ إصلاح: تعريض Data للنطاق العام (window) لتقرأها الألعاب التحفيزية.
   كان السكربت يبحث عن window.Data.students لكنه غير معرّف لأن const لا يلتصق بـ window. */
window.Data = Data;
/* مُساعدات الفصول */
function classLabel(id){const c=CLASSES.find(x=>x.id===id);return c?c.label:id||'—';}
function classesForActiveTeacher(){const t=Data.teachers.find(x=>x.id===Data.activeTeacherId);return t?(t.classes&&t.classes.length?t.classes:CLASSES.map(c=>c.id)):CLASSES.map(c=>c.id);}
function teacherById(id){return Data.teachers.find(x=>x.id===id);}
function activeTeacher(){return teacherById(Data.activeTeacherId);}
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d',{willReadFrequently:true});
const canvasWrap = document.getElementById('canvasWrap');
const mindmapCanvas = document.getElementById('mindmapCanvas');

/* ============================================================
   PAGES SYSTEM: نظام الشرائح / الصفحات
   - كل شريحة تحتفظ بـ: الرسم + الملاحظات اللاصقة + عناصر السبورة + الخريطة الذهنية + التاريخ
   - التنقل بين الشرائح يحفظ محتوى كل شريحة على حدة
   ============================================================ */

// إنشاء شريحة فارغة جديدة
function _createBlankPage(name){
  State.pageCounter++;
  return {
    id: 'p-' + State.pageCounter + '-' + Date.now().toString(36),
    name: name || ('شريحة ' + (State.pages.length + 1)),
    canvas: null,            // لقطة من الكانفس
    stickyNotes: [],         // الملاحظات اللاصقة
    boardItems: [],          // عناصر السبورة (PDF + صور)
    mindmapHTML: '',         // محتوى الخريطة الذهنية
    mindmapVisible: false,   // هل الخريطة ظاهرة؟
    history: [],             // تاريخ التراجع/الإعادة للشريحة
    historyIndex: -1,
    bgType: Data.settings.bgType || 'grid'
  };
}

// التقاط حالة الشريحة الحالية وحفظها في State.pages[currentPage]
function _captureCurrentPage(){
  const p = State.pages[State.currentPage];
  if(!p) return;
  // 1) الكانفس: نحفظه كصورة (dataURL)
  try{ p.canvas = canvas.toDataURL('image/png'); }catch(e){ p.canvas = null; }
  // 2) الملاحظات اللاصقة — تُحفظ من داخل حاوية notes-dock
  const _notesHost = document.getElementById('notesDockBody') || canvasWrap;
  p.stickyNotes = Array.from(_notesHost.querySelectorAll('.sticky-note')).map(n=>{
    const content = n.querySelector('.sn-content');
    // اللون: إما مخصص (CSS variable) أو صنف جاهز
    const presetClasses = ['black','yellow','pink','blue','green','purple','orange','cyan','red','gray'];
    const color = Array.from(n.classList).find(c=>presetClasses.includes(c)) || 'black';
    const customText = n.style.getPropertyValue('--note-text') || '';
    return {
      content: content ? content.innerText || content.textContent || '' : '',
      color: color,
      textColor: customText,    // لون كتابة مخصّص (hex)
      fontSize: n.dataset.fontSize || '0.95'
    };
  });
  // 3) عناصر السبورة (.board-item) — نحفظ outerHTML وخصائص الموضع
  p.boardItems = Array.from(canvasWrap.querySelectorAll(':scope > .board-item')).map(n=>{
    return {
      kind: n.dataset.kind || 'image',
      html: n.outerHTML,
      left: n.style.left || '',
      top: n.style.top || '',
      width: n.style.width || '',
      height: n.style.height || '',
      zIndex: n.style.zIndex || ''
    };
  });
  // 4) الخريطة الذهنية
  p.mindmapHTML = mindmapCanvas.innerHTML;
  p.mindmapVisible = mindmapCanvas.style.display !== 'none';
  // 5) التاريخ (للتراجع/الإعادة داخل الشريحة)
  p.history = State.history.slice();
  p.historyIndex = State.historyIndex;
  // 6) الخلفية
  p.bgType = Data.settings.bgType || 'grid';
}

// مسح محتوى الشريحة في الـ DOM (قبل استعادة شريحة أخرى)
function _clearCurrentBoardState(){
  // إزالة الملاحظات اللاصقة — من الحاوية الجديدة
  const _notesHost = document.getElementById('notesDockBody') || canvasWrap;
  _notesHost.querySelectorAll('.sticky-note').forEach(n=>n.remove());
  // قد توجد ملاحظات قديمة على canvasWrap (للنظام القديم) — نظفها أيضاً
  canvasWrap.querySelectorAll(':scope > .sticky-note').forEach(n=>n.remove());
  // تحديث عدّاد الحاوية
  if(typeof _updateNotesDockUI === 'function') _updateNotesDockUI();
  // إزالة عناصر السبورة
  canvasWrap.querySelectorAll(':scope > .board-item').forEach(n=>n.remove());
  // إزالة لوحة/عداد عناصر السبورة
  const bip = document.getElementById('boardItemsPanel');
  if(bip) bip.style.display = 'none';
  // إخفاء الخريطة الذهنية (سنستعيدها إذا كانت محفوظة)
  mindmapCanvas.innerHTML = '';
  mindmapCanvas.style.display = 'none';
}

// استعادة شريحة في الـ DOM
function _restorePage(p){
  if(!p) return;
  // علمنا أننا في طور الاستعادة — لتفادي حفظ الـ history أثناء الرسم من جديد
  State._suppressPageSave = true;
  try{
    _clearCurrentBoardState();
    // 1) الكانفس
    const dpr = window.devicePixelRatio || 1;
    if(p.canvas){
      const img = new Image();
      img.onload = ()=>{
        ctx.save();
        ctx.setTransform(1,0,0,1,0,0);
        // إصلاح: امسح بشفافية بدلاً من ملء أبيض — حتى تبقى الخلفية CSS ظاهرة من خلف رسم الشريحة
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.globalCompositeOperation='source-over';
        // ارسم مع احترام الـ DPR
        ctx.drawImage(img, 0, 0, canvas.width/dpr, canvas.height/dpr);
        ctx.restore();
      };
      img.onerror = ()=>{
        // في حالة فشل تحميل الصورة، اترك الكانفس شفافاً
        ctx.save();
        ctx.setTransform(1,0,0,1,0,0);
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.globalCompositeOperation='source-over';
        ctx.restore();
      };
      img.src = p.canvas;
    } else {
      // كانفس فارغ
      ctx.save();
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.globalCompositeOperation='source-over';
      ctx.restore();
    }
    // 2) الخلفية
    if(p.bgType && typeof applyBackground === 'function'){
      Data.settings.bgType = p.bgType;
      applyBackground(p.bgType);
    }
    // 3) الملاحظات اللاصقة — تُستعاد داخل حاوية notes-dock
    (p.stickyNotes || []).forEach(sn=>{
      if(typeof addStickyNote === 'function'){
        const created = addStickyNote({
          color: sn.color || 'black',
          textColor: sn.textColor || '',
          fontSize: sn.fontSize || 0.95,
          content: sn.content || '',
          noFocus: true
        });
        if(created && !State._suppressPageSave){
          // عطّل حفظ التاريخ أثناء الاستعادة — يتم عبر _captureCurrentPage عند التبديل
        }
      }
    });
    // 4) عناصر السبورة
    (p.boardItems || []).forEach(bi=>{
      const wrap = document.createElement('div');
      try{
        wrap.innerHTML = bi.html || '';
        const el = wrap.firstElementChild;
        if(!el) return;
        // إعادة ضبط الموضع
        if(bi.left) el.style.left = bi.left;
        if(bi.top) el.style.top = bi.top;
        if(bi.width) el.style.width = bi.width;
        if(bi.height) el.style.height = bi.height;
        if(bi.zIndex) el.style.zIndex = bi.zIndex;
        canvasWrap.appendChild(el);
        // إعادة ربط أحداث عناصر السبورة (السحب + التحجيم + التثبيت)
        if(typeof _reattachBoardItem === 'function'){
          _reattachBoardItem(el);
        }
      }catch(e){ console.warn('page restore: board item failed', e); }
    });
    // 5) الخريطة الذهنية
    if(p.mindmapHTML){
      mindmapCanvas.innerHTML = p.mindmapHTML;
      // ضمان أبعاد صحيحة بعد تبديل الشريحة (قد تكون الأبعاد قديمة)
      const r=canvasWrap.getBoundingClientRect();
      if(r.width>0 && r.height>0){
        mindmapCanvas.setAttribute('width',r.width);
        mindmapCanvas.setAttribute('height',r.height);
        mindmapCanvas.style.width=r.width+'px';
        mindmapCanvas.style.height=r.height+'px';
        if(!mindmapCanvas.getAttribute('viewBox')){
          mindmapCanvas.setAttribute('viewBox','0 0 '+r.width+' '+r.height);
        }
      }
      mindmapCanvas.style.display = p.mindmapVisible ? 'block' : 'none';
    } else {
      mindmapCanvas.innerHTML='';
      mindmapCanvas.style.display='none';
    }
    // 6) التاريخ
    State.history = Array.isArray(p.history) ? p.history.slice() : [];
    State.historyIndex = typeof p.historyIndex === 'number' ? p.historyIndex : -1;
  } finally {
    // حرر القفل بعد فريم حتى لا نمنع أي أحداث لاحقة
    setTimeout(()=>{ State._suppressPageSave = false; }, 50);
  }
}

// إعادة ربط أحداث عنصر السبورة بعد استعادته من HTML
function _reattachBoardItem(el){
  if(!el) return;
  // السحب من الشريط العلوي
  const head = el.querySelector('.bi-head');
  if(head && typeof makeDraggable === 'function'){
    try{ makeDraggable(head); }catch(e){}
  }
  // أزرار الرأس (تثبيت، إغلاق، ...)
  el.querySelectorAll('.bi-head button').forEach(btn=>{
    const cls = btn.className;
    if(cls.includes('bi-close')){
      btn.onclick = (e)=>{e.stopPropagation();el.remove();if(typeof saveHistory==='function'&&!State._suppressPageSave)saveHistory();if(typeof _refreshBoardItemsPanel==='function')_refreshBoardItemsPanel();};
    } else if(cls.includes('bi-burn')){
      btn.onclick = (e)=>{e.stopPropagation();if(typeof commitBoardItemToCanvas==='function')commitBoardItemToCanvas(el);};
    } else if(cls.includes('bi-pgbtn')){
      // أزرار التنقل بين صفحات PDF داخل العنصر
      const txt = (btn.textContent||'').trim();
      if(txt.includes('◀') && typeof _boardItemPdfPrev==='function') btn.onclick = (e)=>{e.stopPropagation();_boardItemPdfPrev(el);};
      else if(txt.includes('▶') && typeof _boardItemPdfNext==='function') btn.onclick = (e)=>{e.stopPropagation();_boardItemPdfNext(el);};
    }
  });
  // شريط التحجيم
  const zb = el.querySelector('.bi-zoombar');
  if(zb){
    const zIn = zb.querySelector('.bi-zm-in'); if(zIn) zIn.onclick = (e)=>{e.stopPropagation();if(typeof _boardItemZoom==='function')_boardItemZoom(el,1.18);};
    const zOut = zb.querySelector('.bi-zm-out'); if(zOut) zOut.onclick = (e)=>{e.stopPropagation();if(typeof _boardItemZoom==='function')_boardItemZoom(el,1/1.18);};
    const zRst = zb.querySelector('.bi-zm-rst'); if(zRst) zRst.onclick = (e)=>{e.stopPropagation();if(typeof _boardItemZoomReset==='function')_boardItemZoomReset(el);};
    const zFit = zb.querySelector('.bi-zm-fit'); if(zFit) zFit.onclick = (e)=>{e.stopPropagation();if(typeof _boardItemZoomFit==='function')_boardItemZoomFit(el);};
  }
  // التحديد عند النقر
  el.addEventListener('mousedown', ()=>{
    document.querySelectorAll('.board-item.is-selected').forEach(x=>{if(x!==el)x.classList.remove('is-selected');});
    el.classList.add('is-selected');
    if(typeof _boardItemFocus==='function') _boardItemFocus(el);
  });
  // تحديث عداد لوحة عناصر السبورة
  if(typeof _refreshBoardItemsPanel==='function') _refreshBoardItemsPanel();
}

// إعادة رسم شريط الشرائح (لوحة جانبية)
function _renderPagesBar(){
  const list = document.getElementById('pagesList');
  const info = document.getElementById('pageInfo');
  const prev = document.getElementById('pagePrev');
  const next = document.getElementById('pageNext');
  const ptBadge = document.getElementById('ptBadge');
  const ptCurrent = document.getElementById('ptCurrent');
  const ptTotal = document.getElementById('ptTotal');
  if(!list) return;
  list.innerHTML = '';
  State.pages.forEach((p, idx)=>{
    const card = document.createElement('div');
    card.className = 'page-card' + (idx === State.currentPage ? ' active' : '');
    card.dataset.index = String(idx);
    card.title = `شريحة ${idx+1}: ${p.name}\nاضغطي للتبديل — نقرة مزدوجة على الاسم لتغييره`;
    const num = document.createElement('span');
    num.className = 'pc-num';
    num.textContent = String(idx + 1);
    const name = document.createElement('input');
    name.className = 'pc-name';
    name.type = 'text';
    name.value = p.name || ('شريحة ' + (idx+1));
    name.readOnly = true;       // قابل للتعديل بنقرة مزدوجة
    name.addEventListener('dblclick', e=>{e.stopPropagation();name.readOnly=false;name.focus();name.select();});
    name.addEventListener('blur', ()=>{
      name.readOnly = true;
      const v = (name.value || '').trim();
      p.name = v || ('شريحة ' + (idx+1));
      name.value = p.name;
    });
    name.addEventListener('keydown', e=>{
      if(e.key === 'Enter'){e.preventDefault();name.blur();}
      if(e.key === 'Escape'){name.value = p.name; name.blur();}
    });
    name.addEventListener('click', e=>e.stopPropagation());
    card.appendChild(num);
    card.appendChild(name);
    // زر الحذف (ممنوع على الشريحة الوحيدة)
    if(State.pages.length > 1){
      const del = document.createElement('span');
      del.className = 'pc-del';
      del.innerHTML = '<i class="fas fa-times"></i>';
      del.title = 'احذفي هذه الشريحة';
      del.addEventListener('click', e=>{e.stopPropagation();_deletePage(idx);});
      card.appendChild(del);
    }
    // عند النقر على الشريحة: التبديل
    card.addEventListener('click', ()=>{
      if(idx !== State.currentPage) _switchToPage(idx);
    });
    list.appendChild(card);
  });
  // تحديث العداد في رأس اللوحة
  if(info) info.innerHTML = `شريحة <b>${State.currentPage+1}</b> / <b>${State.pages.length}</b>`;
  // تحديث العداد في الزر المطوي
  if(ptCurrent) ptCurrent.textContent = String(State.currentPage + 1);
  if(ptTotal)   ptTotal.textContent   = String(State.pages.length);
  if(ptBadge)   ptBadge.textContent   = String(State.pages.length);
  // أزرار التنقل
  if(prev) prev.disabled = State.currentPage <= 0;
  if(next) next.disabled = State.currentPage >= State.pages.length - 1;
  // تمرير الشريحة الحالية إلى المنتصف (داخل اللوحة)
  const activeCard = list.querySelector('.page-card.active');
  if(activeCard && typeof activeCard.scrollIntoView === 'function'){
    try{ activeCard.scrollIntoView({behavior:'smooth', block:'nearest'}); }catch(e){}
  }
}

// فتح لوحة الشرائح
function _openPagesPanel(){
  const sb = document.getElementById('pagesSidebar');
  if(sb) sb.classList.add('open');
}
// طي لوحة الشرائح
function _closePagesPanel(){
  const sb = document.getElementById('pagesSidebar');
  if(sb) sb.classList.remove('open');
}
// تبديل (طي/فتح) لوحة الشرائح
function _togglePagesPanel(){
  const sb = document.getElementById('pagesSidebar');
  if(!sb) return;
  sb.classList.toggle('open');
}

// تبديل إلى شريحة محددة
function _switchToPage(idx){
  if(idx < 0 || idx >= State.pages.length) return;
  if(idx === State.currentPage) return;
  // 1) احفظ الشريحة الحالية أولاً
  _captureCurrentPage();
  // 2) استبدل الفهرس
  State.currentPage = idx;
  // 3) استعد الشريحة الجديدة
  const p = State.pages[idx];
  _restorePage(p);
  // 4) أعد رسم الشريط
  _renderPagesBar();
  // 5) تحديث فوري للوحة عناصر السبورة
  if(typeof _refreshBoardItemsPanel === 'function') _refreshBoardItemsPanel();
  toast('info', 'شريحة ' + (idx+1) + ' — ' + (p.name||''));
}

// إضافة شريحة جديدة (تُضاف بعد الشريحة الحالية وتنتقل إليها)
function _addNewPage(){
  // احفظ الحالية أولاً
  _captureCurrentPage();
  // أنشئ صفحة فارغة
  const np = _createBlankPage();
  // أدخلها بعد الحالية
  const insertAt = State.currentPage + 1;
  State.pages.splice(insertAt, 0, np);
  // انتقل إليها
  State.currentPage = insertAt;
  // ابدأ بكانفس شفاف + خلفية افتراضية (الخلفية CSS تظهر من خلفه)
  State._suppressPageSave = true;
  try{
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.globalCompositeOperation='source-over';
    ctx.restore();
    if(typeof applyBackground === 'function'){
      applyBackground(Data.settings.bgType || 'grid');
    }
    // ابدأ تاريخ جديد
    State.history = [];
    State.historyIndex = -1;
    try{ State.history.push(canvas.toDataURL()); State.historyIndex = 0; }catch(e){}
  } finally {
    setTimeout(()=>{ State._suppressPageSave = false; }, 50);
  }
  _renderPagesBar();
  if(typeof _refreshBoardItemsPanel === 'function') _refreshBoardItemsPanel();
  toast('success', '✓ تم إضافة شريحة جديدة');
}

// حذف شريحة
async function _deletePage(idx){
  if(State.pages.length <= 1){
    toast('warning', 'لا يمكن احذفي الشريحة الوحيدة');
    return;
  }
  if(!await customConfirm('هل تريدين احذفي "' + (State.pages[idx].name||('شريحة '+(idx+1))) + '"؟', {title:'احذفي شريحة', danger:true, okText:'احذفي'})) return;
  // احفظ الحالية (في حال الحذف قبل الأخيرة)
  _captureCurrentPage();
  // احذف
  State.pages.splice(idx, 1);
  // اضبط المؤشر
  if(State.currentPage >= State.pages.length){
    State.currentPage = State.pages.length - 1;
  } else if(State.currentPage > idx){
    State.currentPage = Math.max(0, State.currentPage - 1);
  }
  // استعد الصفحة الجديدة الحالية
  const p = State.pages[State.currentPage];
  _restorePage(p);
  _renderPagesBar();
  if(typeof _refreshBoardItemsPanel === 'function') _refreshBoardItemsPanel();
  toast('warning', 'تم احذفي الشريحة');
}

// تكرار الشريحة الحالية
function _duplicatePage(){
  _captureCurrentPage();
  const src = State.pages[State.currentPage];
  State.pageCounter++;
  const copy = {
    id: 'p-' + State.pageCounter + '-' + Date.now().toString(36),
    name: (src.name || 'شريحة') + ' - نسخة',
    canvas: src.canvas,
    stickyNotes: JSON.parse(JSON.stringify(src.stickyNotes || [])),
    boardItems: JSON.parse(JSON.stringify(src.boardItems || [])),
    mindmapHTML: src.mindmapHTML || '',
    mindmapVisible: src.mindmapVisible || false,
    history: (src.history || []).slice(),
    historyIndex: src.historyIndex || -1,
    bgType: src.bgType || 'grid'
  };
  const insertAt = State.currentPage + 1;
  State.pages.splice(insertAt, 0, copy);
  State.currentPage = insertAt;
  _restorePage(copy);
  _renderPagesBar();
  if(typeof _refreshBoardItemsPanel === 'function') _refreshBoardItemsPanel();
  toast('success', '✓ تم تكرار الشريحة');
}

// تهيئة النظام — تُستدعى عند الإقلاع
function _initPages(){
  // أنشئ شريحة ابتدائية واحدة
  const p = _createBlankPage('شريحة 1');
  State.pages = [p];
  State.currentPage = 0;
  // اربط أزرار الشريط
  const addBtn = document.getElementById('pageAdd');
  const prevBtn = document.getElementById('pagePrev');
  const nextBtn = document.getElementById('pageNext');
  const dupBtn = document.getElementById('pageDup');
  const toggleBtn = document.getElementById('pagesToggle');
  const closeBtn = document.getElementById('pagesClose');
  if(addBtn) addBtn.addEventListener('click', _addNewPage);
  if(prevBtn) prevBtn.addEventListener('click', ()=>_switchToPage(State.currentPage - 1));
  if(nextBtn) nextBtn.addEventListener('click', ()=>_switchToPage(State.currentPage + 1));
  if(dupBtn) dupBtn.addEventListener('click', _duplicatePage);
  // زر الطي/الفتح
  if(toggleBtn) toggleBtn.addEventListener('click', (e)=>{e.stopPropagation();_togglePagesPanel();});
  if(closeBtn) closeBtn.addEventListener('click', (e)=>{e.stopPropagation();_closePagesPanel();});
  // طي اللوحة عند النقر خارجها
  document.addEventListener('click', (e)=>{
    const sb = document.getElementById('pagesSidebar');
    if(!sb || !sb.classList.contains('open')) return;
    if(sb.contains(e.target)) return;
    // لا تطفئ إذا كان النقر داخل عناصر السبورة أو شريط الأدوات
    if(e.target.closest('.board-item')) return;
    if(e.target.closest('.toolbar-dock')) return;
    if(e.target.closest('.top-bar')) return;
    if(e.target.closest('.celebrate-bar')) return;
    _closePagesPanel();
  });
  // ارسم الشريط
  _renderPagesBar();
  // افتح اللوحة تلقائياً في البداية حتى ترى المعلمة الميزة
  setTimeout(()=>_openPagesPanel(), 600);
  // بعد رسم الكانفس، التقط الشريحة الأولى الفارغة
  // (سيتم لاحقاً عبر _bootstrapFirstSnapshot)
}

// حفظ أول لقطة للشريحة الابتدائية — تُستدعى بعد resizeCanvas و applyBackground
function _bootstrapFirstSnapshot(){
  if(!State.pages.length) return;
  State._suppressPageSave = true;
  try{
    _captureCurrentPage();
  } finally {
    setTimeout(()=>{ State._suppressPageSave = false; }, 50);
  }
}

// حفظ تلقائي (debounced) بعد كل تغيير
let _pageAutoSaveTimer = null;
function _schedulePageSave(){
  if(State._suppressPageSave) return;
  if(_pageAutoSaveTimer) clearTimeout(_pageAutoSaveTimer);
  _pageAutoSaveTimer = setTimeout(()=>{
    _captureCurrentPage();
  }, 350);
}

// تصدير كل الشرائح كصور
function _exportAllPages(){
  // (تم استبدالها بـ _exportAllSlides الأحدث والأقوى)
  // تُحفظ هذه الدالة للتوافق الخلفي
  return _exportAllSlides('png');
}

// ============= فحص هل الشريحة تحتوي على محتوى =============
// تفحص الكانفس والملاحظات اللاصقة وعناصر السبورة والخريطة الذهنية
function _isPageHasContent(p){
  if(!p) return false;
  // 1) هل الكانفس يحتوي على رسم فعلي (وليس مجرد صورة بيضاء)؟
  if(p.canvas && _isCanvasDataNonEmpty(p.canvas)){
    return true;
  }
  // 2) هل توجد ملاحظات لاصقة بمحتوى؟
  if(p.stickyNotes && p.stickyNotes.length > 0){
    if(p.stickyNotes.some(n => n.content && _stripHtml(n.content).trim().length > 0)) return true;
  }
  // 3) هل توجد عناصر سبورة (PDF / صور)؟
  if(p.boardItems && p.boardItems.length > 0) return true;
  // 4) هل توجد خريطة ذهنية؟
  if(p.mindmapHTML && p.mindmapHTML.replace(/<[^>]+>/g,'').trim().length > 0) return true;
  return false;
}

// إزالة وسوم HTML من نص
function _stripHtml(html){
  if(!html) return '';
  try{
    const d = document.createElement('div');
    d.innerHTML = html;
    return (d.textContent || d.innerText || '');
  }catch(e){
    return String(html).replace(/<[^>]+>/g, '');
  }
}

// فحص إذا كان dataURL للكانفس يحتوي على رسم فعلي (ليس مجرد صفحة بيضاء)
// نقارن بأخذ pixels من وسط الكانفس وركن علوي — إذا كلهم أبيض فالكانفس فارغ
function _isCanvasDataNonEmpty(dataURL){
  if(!dataURL || typeof dataURL !== 'string' || dataURL.length < 100) return false;
  // فحص سريع: dataURL قصير جداً (~100 بايت) = كانفس أبيض فارغ
  // كانفس أبيض بحجم 1920×1080 PNG يكون عادة > 1KB
  // كانفس فراغ فعلي يكون ~80-200 بايت
  // نستخدم عتبة عملية 400 بايت
  if(dataURL.length < 400) return false;
  // فحوصات أعمق: فحص data:image/png;base64, واستخراج المحتوى
  // لو فككنا الـ base64 وحللنا IDAT سنستطيع معرفة إذا في رسم
  // لكن لأغراض عملية: إذا الحجم أكبر من 600 بايت على الأرجح فيه رسم
  return true;
}

// ============= تصدير كل الشرائح (PNG / JPG / PDF) =============
// format: 'png' | 'jpg' | 'pdf'
async function _exportAllSlides(format){
  if(!State.pages || State.pages.length === 0){
    toast('warning', 'لا توجد شرائح');
    return;
  }
  // 1) احفظ الشريحة الحالية أولاً
  _captureCurrentPage();
  // 2) اجمع كل الشرائح التي تحتوي على محتوى
  const validPages = [];
  for(let i = 0; i < State.pages.length; i++){
    const p = State.pages[i];
    if(_isPageHasContent(p)){
      validPages.push({page: p, index: i});
    }
  }
  if(validPages.length === 0){
    toast('warning', 'لا توجد شرائح تحتوي على محتوى مكتوب');
    return;
  }
  // 3) أغلق المودال فوراً
  closeModal('modalSave');
  // 4) PDF: افتح نافذة طباعة بكل الشرائح
  if(format === 'pdf'){
    _printAllSlides(validPages);
    return;
  }
  // 5) PNG / JPG: تنزيل كل شريحة على حدة
  const ext = format === 'jpg' ? 'jpg' : 'png';
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const quality = format === 'jpg' ? 0.92 : undefined;
  // احفظ الصفحة الحالية للعودة لها لاحقاً
  const originalPage = State.currentPage;
  // ابدأ التحميل
  toast('info', '⏳ جاري تجهيز ' + validPages.length + ' شريحة...');
  let successCount = 0;
  for(let i = 0; i < validPages.length; i++){
    const {page, index} = validPages[i];
    try{
      // انتقل للشريحة لضمان أحدث محتوى (خصوصاً لو الكود لم يلتقط بعد)
      if(State.currentPage !== index){
        _switchToPage(index);
        // انتظر فريم حتى تكتمل الاستعادة
        await new Promise(r => setTimeout(r, 250));
      } else {
        // نحن بالفعل على هذه الشريحة — التقط الآن
        _captureCurrentPage();
      }
      // اقرأ من الكانفس الحالي لضمان أحدث البيانات
      let dataURL;
      try{
        dataURL = canvas.toDataURL(mime, quality);
      }catch(e){
        // ارجع لـ p.canvas كبديل
        dataURL = page.canvas;
      }
      if(!dataURL){
        console.warn('شريحة فارغة:', index);
        continue;
      }
      // حول dataURL إلى Blob
      const blob = await _dataURLToBlob(dataURL, mime, quality);
      if(!blob) continue;
      // أنشئ رابط التنزيل
      const safeName = (page.name || ('شريحة-' + (index+1))).replace(/[^\p{L}\p{N}_\-]+/gu, '_').substring(0, 40);
      const fileName = `سبورة-${String(index+1).padStart(2,'0')}-${safeName}.${ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      // تنزيل مع تأخير لتفادي حظر المتصفح
      await new Promise(r => setTimeout(r, 350));
      a.click();
      // تنظيف
      setTimeout(() => {
        if(a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1500);
      successCount++;
    }catch(err){
      console.error('فشل تصدير الشريحة', index, err);
    }
  }
  // ارجع للصفحة الأصلية
  if(State.currentPage !== originalPage){
    _switchToPage(originalPage);
  }
  if(successCount > 0){
    toast('success', '✓ تم تنزيل ' + successCount + ' شريحة بنجاح');
  } else {
    toast('error', 'فشل تنزيل الشرائح');
  }
}

// تحويل dataURL إلى Blob
async function _dataURLToBlob(dataURL, mime, quality){
  // إذا كنا نطلب PNG وكان dataURL أصلا PNG، حول مباشرة
  if(dataURL.startsWith('data:' + mime)){
    try{
      const arr = dataURL.split(',');
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while(n--) u8arr[n] = bstr.charCodeAt(n);
      return new Blob([u8arr], {type: mime});
    }catch(e){ /* fall through */ }
  }
  // خلاف ذلك: ارسم في canvas جديد ثم صدّر بالجودة المطلوبة
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try{
        const tmp = document.createElement('canvas');
        tmp.width = img.width;
        tmp.height = img.height;
        const tctx = tmp.getContext('2d');
        tctx.fillStyle = '#ffffff';
        tctx.fillRect(0, 0, tmp.width, tmp.height);
        tctx.drawImage(img, 0, 0);
        if(typeof tmp.toBlob === 'function'){
          tmp.toBlob((b) => resolve(b), mime, quality);
        } else {
          // fallback قديم
          const data = tmp.toDataURL(mime, quality);
          const arr = data.split(',');
          const bstr = atob(arr[1]);
          let n = bstr.length;
          const u8arr = new Uint8Array(n);
          while(n--) u8arr[n] = bstr.charCodeAt(n);
          resolve(new Blob([u8arr], {type: mime}));
        }
      }catch(e){
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataURL;
  });
}

// ============= طباعة كل الشرائح كـ PDF =============
function _printAllSlides(pages){
  if(!pages || pages.length === 0){
    toast('warning', 'لا توجد شرائح');
    return;
  }
  // ابنِ HTML للطباعة
  const slidesHTML = pages.map(({page, index}) => {
    const img = page.canvas
      ? `<img src="${page.canvas}" alt="شريحة ${index+1}" style="max-width:100%;max-height:100%;display:block;margin:0 auto">`
      : `<div style="padding:80px 20px;text-align:center;color:#999;font-size:1.1rem">شريحة فارغة</div>`;
    return `
      <div class="print-slide">
        <div class="print-slide-head">
          <span><i class="fas fa-chalkboard"></i> شريحة ${index+1} من ${State.pages.length}</span>
          <span style="opacity:.9;font-weight:600">${(page.name || '').replace(/</g,'&lt;')}</span>
        </div>
        <div class="print-slide-body">${img}</div>
        <div class="print-slide-foot">${(Data.settings.teacherName || '').replace(/</g,'&lt;')} • ${Data.settings.boardName || 'حصة تفاعلية'}</div>
      </div>`;
  }).join('');
  const fullHTML = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
    <title>كل الشرائح - ${Data.settings.boardName || 'حصة تفاعلية'}</title>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;800&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{font-family:'Tajawal',sans-serif;background:#f5f5f5;color:#222;direction:rtl}
      .print-toolbar{
        position:sticky;top:0;z-index:100;
        background:linear-gradient(90deg,#0f3460,#1a5f7a);
        color:white;padding:12px 20px;
        display:flex;align-items:center;gap:12px;justify-content:space-between;
        box-shadow:0 4px 12px rgba(0,0,0,.2);
        font-family:'Tajawal',sans-serif;
      }
      .print-toolbar h2{font-size:1.05rem;font-weight:800;display:flex;align-items:center;gap:8px}
      .print-toolbar .pt-info{font-size:.8rem;opacity:.9}
      .print-toolbar button{
        background:rgba(255,255,255,.18);color:white;border:none;
        padding:8px 16px;border-radius:8px;cursor:pointer;
        font-family:inherit;font-size:.85rem;font-weight:700;
        display:inline-flex;align-items:center;gap:6px;transition:.2s;
      }
      .print-toolbar button:hover{background:rgba(255,255,255,.32)}
      .print-toolbar .pt-print{background:#27ae60}
      .print-toolbar .pt-print:hover{background:#219a52}
      .print-toolbar .pt-close{background:#e74c3c}
      .print-toolbar .pt-close:hover{background:#c0392b}
      .print-slide{
        background:white;margin:24px auto;max-width:1100px;
        box-shadow:0 6px 24px rgba(0,0,0,.12);
        border-radius:8px;overflow:hidden;
        page-break-after:always;page-break-inside:avoid;
        display:flex;flex-direction:column;
      }
      .print-slide:last-child{page-break-after:auto}
      .print-slide-head{
        background:linear-gradient(90deg,#0f3460,#1a5f7a);
        color:white;padding:12px 18px;
        font-weight:800;font-size:.95rem;
        display:flex;justify-content:space-between;align-items:center;gap:12px;
        font-family:'Tajawal',sans-serif;
      }
      .print-slide-head i{color:#f9d423}
      .print-slide-body{
        background:#fff;padding:24px;min-height:520px;
        display:flex;align-items:center;justify-content:center;
        background-image:linear-gradient(rgba(0,0,0,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,.04) 1px,transparent 1px);
        background-size:25px 25px;
      }
      .print-slide-body img{box-shadow:0 4px 16px rgba(0,0,0,.08);border-radius:4px}
      .print-slide-foot{
        background:#f8f8f8;padding:8px 18px;
        font-size:.75rem;color:#666;
        border-top:1px solid #eee;
        text-align:center;font-family:'Tajawal',sans-serif;
      }
      @media print{
        body{background:white}
        .print-toolbar{display:none !important}
        .print-slide{
          margin:0;box-shadow:none;border-radius:0;
          max-width:100%;width:100%;
          page-break-after:always;page-break-inside:avoid;
        }
        .print-slide:last-child{page-break-after:auto}
        .print-slide-body{background-image:none !important;padding:0;min-height:auto}
        @page{margin:0;size:A4 landscape}
      }
    </style>
  </head><body>
    <div class="print-toolbar" id="printToolbar">
      <h2><i class="fas fa-file-pdf"></i> كل الشرائح <span class="pt-info">(${pages.length} شريحة من أصل ${State.pages.length})</span></h2>
      <div style="display:flex;gap:8px">
        <button class="pt-print" onclick="window.print()"><i class="fas fa-print"></i> طباعة / احفظي كـ PDF</button>
        <button class="pt-close" onclick="window.close()"><i class="fas fa-times"></i> إغلاق</button>
      </div>
    </div>
    ${slidesHTML}
  </body></html>`;
  try{
    const win = window.open('', '_blank');
    if(!win){
      toast('error', 'المتصفح منع فتح النافذة. اسمحي بالنوافذ المنبثقة وحاولي مجدداً');
      return;
    }
    win.document.open();
    win.document.write(fullHTML);
    win.document.close();
    toast('success', '✓ تم فتح ' + pages.length + ' شريحة في نافذة الطباعة');
  }catch(err){
    console.error(err);
    toast('error', 'فشل فتح نافذة الطباعة');
  }
}

/* CANVAS RESIZE */
function resizeCanvas(){
  const dpr = window.devicePixelRatio || 1;
  const rect = canvasWrap.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  const temp = document.createElement('canvas');
  temp.width = canvas.width; temp.height = canvas.height;
  if(canvas.width > 0) temp.getContext('2d').drawImage(canvas,0,0);
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  mindmapCanvas.setAttribute('width', w);
  mindmapCanvas.setAttribute('height', h);
  mindmapCanvas.style.width = w + 'px'; mindmapCanvas.style.height = h + 'px';
  ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr,dpr);
  ctx.lineCap='round'; ctx.lineJoin='round';
  if(temp.width > 0) ctx.drawImage(temp,0,0,temp.width/dpr,temp.height/dpr);
  applyBackground(Data.settings.bgType||'grid');
  saveHistory();
}
window.addEventListener('resize', resizeCanvas);

// إعادة رسم PDF عند تغيير حجم النافذة إذا كان في وضع ملاءمة العرض
let _pdfResizeTimer = null;
window.addEventListener('resize', () => {
  if(!State.pdfDoc) return;
  if(State.pdfFitMode !== 'width') return;
  if(_pdfResizeTimer) clearTimeout(_pdfResizeTimer);
  _pdfResizeTimer = setTimeout(() => {
    if(typeof renderPDFPage === 'function') renderPDFPage();
  }, 150);
});

/* BACKGROUNDS */
// خزّن آخر نوع خلفية تم اختياره — مفيد لزر "تنظيف الخلفية" الذي يمسح أي رسم قديم على الكانفس
let _lastBgType = null;

// اتجاه المحور X (أفقي): خط في وسط الارتفاع
// اتجاه المحور Y (عمودي): خط في وسط العرض
// نستخدم calc() في stops — يعمل في كل المتصفحات الحديثة (Chrome/Firefox/Safari/Edge)
const _COORD_X_AXIS = 'linear-gradient(to bottom, transparent 0, transparent calc(50% - 1.5px), rgba(200,50,50,0.78) calc(50% - 1.5px), rgba(200,50,50,0.78) calc(50% + 1.5px), transparent calc(50% + 1.5px), transparent 100%)';
const _COORD_Y_AXIS = 'linear-gradient(to right, transparent 0, transparent calc(50% - 1.5px), rgba(50,50,200,0.78) calc(50% - 1.5px), rgba(50,50,200,0.78) calc(50% + 1.5px), transparent calc(50% + 1.5px), transparent 100%)';
const _GRID_FINE   = 'linear-gradient(rgba(0,0,0,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.06) 1px, transparent 1px)';

// طبقة مساعدة لإرجاع الـ canvas إلى خلفية CSS نظيفة (بدون لمس رسومات المستخدم)
function _resetCanvasBg(){
  canvas.style.backgroundColor = '#ffffff';
  canvas.style.backgroundImage = '';
  canvas.style.backgroundSize = '';
  canvas.style.backgroundPosition = '';
  canvas.style.backgroundRepeat = '';
}

function applyBackground(type){
  // تأكيد وجود الـ canvas
  if(!canvas) return;
  Data.settings.bgType = type;
  Data.settings.grid = type === 'none' ? 'off' : 'on';
  Data.settings.bgColor = '#ffffff';
  // أولاً: نظّف كل خصائص الخلفية لتجنّب تراكم خلفيات سابقة
  _resetCanvasBg();
  // محاور الإحداثيات مرسومة على الـ canvas في الإصدارات القديمة — لو كانت موجودة وأصبحت الخلفية الجديدة ليست coord، نظّفها
  if(_lastBgType === 'coord' && type !== 'coord'){
    _stripCanvasCoordAxes();
  }
  switch(type){
    case 'grid':
      canvas.style.backgroundImage = 'linear-gradient(rgba(0,0,0,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.06) 1px,transparent 1px)';
      canvas.style.backgroundSize = '25px 25px';
      break;
    case 'graph':
      canvas.style.backgroundImage = 'linear-gradient(rgba(0,0,0,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.05) 1px,transparent 1px)';
      canvas.style.backgroundSize = '10px 10px';
      break;
    case 'largegrid':
      // شبكة فرعية 10px + شبكة رئيسية 50px
      canvas.style.backgroundImage = 'linear-gradient(rgba(0,0,0,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.06) 1px,transparent 1px),linear-gradient(rgba(0,0,0,0.18) 1.5px,transparent 1.5px),linear-gradient(90deg,rgba(0,0,0,0.18) 1.5px,transparent 1.5px)';
      canvas.style.backgroundSize = '10px 10px,10px 10px,50px 50px,50px 50px';
      break;
    case 'engineering':
      // ورق هندسي: 2mm + 10mm
      canvas.style.backgroundImage = 'linear-gradient(rgba(0,0,0,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.06) 1px,transparent 1px),linear-gradient(rgba(0,0,0,0.22) 1.5px,transparent 1.5px),linear-gradient(90deg,rgba(0,0,0,0.22) 1.5px,transparent 1.5px)';
      canvas.style.backgroundSize = '8px 8px,8px 8px,40px 40px,40px 40px';
      break;
    case 'lined':
      canvas.style.backgroundImage = 'linear-gradient(transparent 30px,rgba(0,120,200,0.2) 30px,rgba(0,120,200,0.2) 31px,transparent 31px)';
      canvas.style.backgroundSize = '100% 32px';
      break;
    case 'test':
      // ورق اختبار: هامش أحمر عمودي + خطوط أفقية زرقاء كل 32px
      canvas.style.backgroundImage = 'linear-gradient(to right, transparent 0, transparent 80px, rgba(200,50,50,0.4) 80px, rgba(200,50,50,0.4) 81.5px, transparent 81.5px, transparent 100%), linear-gradient(transparent 30px, rgba(0,120,200,0.22) 30px, rgba(0,120,200,0.22) 31px, transparent 31px)';
      canvas.style.backgroundSize = '100% 100%, 100% 32px';
      canvas.style.backgroundPosition = '0 0, 0 0';
      canvas.style.backgroundRepeat = 'no-repeat, repeat';
      break;
    case 'notebook':
      // ورق مذكرات: هامش أحمر مزدوج + خطوط أفقية زرقاء
      canvas.style.backgroundImage = 'linear-gradient(to right, transparent 0, transparent 70px, rgba(200,50,50,0.55) 70px, rgba(200,50,50,0.55) 72px, transparent 72px, transparent 95px, rgba(200,50,50,0.3) 95px, rgba(200,50,50,0.3) 96px, transparent 96px, transparent 100%), linear-gradient(transparent 30px, rgba(0,120,200,0.22) 30px, rgba(0,120,200,0.22) 31px, transparent 31px)';
      canvas.style.backgroundSize = '100% 100%, 100% 32px';
      canvas.style.backgroundPosition = '0 0, 0 0';
      canvas.style.backgroundRepeat = 'no-repeat, repeat';
      break;
    case 'dots':
      canvas.style.backgroundImage = 'radial-gradient(rgba(0,0,0,0.2) 1px,transparent 1px)';
      canvas.style.backgroundSize = '20px 20px';
      break;
    case 'hexagonal':
      // نمط سداسي عبر طبقتين من نقاط بإزاحة — يعطي إحساس الشبكة السداسية
      canvas.style.backgroundImage = 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0.18) 1.2px, transparent 1.8px), radial-gradient(circle at 50% 50%, rgba(0,0,0,0.18) 1.2px, transparent 1.8px)';
      canvas.style.backgroundSize = '14px 24px, 14px 24px';
      canvas.style.backgroundPosition = '0 0, 7px 12px';
      canvas.style.backgroundRepeat = 'repeat, repeat';
      break;
    case 'triangular':
      // شبكة مثلثات متساوية الأضلاع عبر 3 طبقات (60°/-60°/0°)
      canvas.style.backgroundImage = 'linear-gradient(60deg, rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(-60deg, rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(0deg, rgba(0,0,0,0.08) 1px, transparent 1px)';
      canvas.style.backgroundSize = '30px 52px';
      break;
    case 'isometric':
      // شبكة أيزومترية 30°/90°/150° — لرسم الأشكال ثلاثية الأبعاد
      canvas.style.backgroundImage = 'linear-gradient(30deg, rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(150deg, rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.08) 1px, transparent 1px)';
      canvas.style.backgroundSize = '30px 52px, 30px 52px, 30px 52px';
      break;
    case 'sketch':
      // ورق كروكي: شبكة خفيفة جداً + نقاط مميزة كل 100px
      canvas.style.backgroundColor = '#fdfdfd';
      canvas.style.backgroundImage = 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0.25) 2px, transparent 2.5px), linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)';
      canvas.style.backgroundSize = '100px 100px, 20px 20px, 20px 20px';
      break;
    case 'music':
      canvas.style.backgroundImage = 'linear-gradient(transparent 30px,rgba(0,0,0,0.3) 30px,rgba(0,0,0,0.3) 31px,transparent 31px,transparent 50px,rgba(0,0,0,0.3) 50px,rgba(0,0,0,0.3) 51px,transparent 51px,transparent 70px,rgba(0,0,0,0.3) 70px,rgba(0,0,0,0.3) 71px,transparent 71px,transparent 90px,rgba(0,0,0,0.3) 90px,rgba(0,0,0,0.3) 91px,transparent 91px,transparent 110px,rgba(0,0,0,0.3) 110px,rgba(0,0,0,0.3) 111px,transparent 111px)';
      break;
    case 'coord':
      // ✅ الإصلاح الرئيسي: المحاور عبر CSS فقط — لا نرسم على الـ canvas
      // عندما تغيّري الخلفية إلى غير "إحداثي"، المحاور تختفي تلقائياً مع الـ backgroundImage
      canvas.style.backgroundImage = `${_COORD_X_AXIS}, ${_COORD_Y_AXIS}, ${_GRID_FINE}`;
      canvas.style.backgroundSize = '100% 100%, 100% 100%, 25px 25px, 25px 25px';
      canvas.style.backgroundPosition = '0 0, 0 0, 0 0, 0 0';
      canvas.style.backgroundRepeat = 'no-repeat, no-repeat, repeat, repeat';
      break;
    case 'none':
      canvas.style.backgroundImage = 'none';
      break;
  }
  _lastBgType = type;
  saveData();
}

// زر "تنظيف الخلفية": يمسح الـ canvas ويعيد تطبيق الخلفية الحالية (يحلّ مشكلة المحاور المرسومة في الإصدارات القديمة)
async function refreshBackground(){
  if(!canvas) return;
  const ok = await customConfirm('سيتم مسح أي رسم على السبورة مع الإبقاء على الخلفية. هل تريدين المتابعة؟', {title:'تنظيف الخلفية',okText:'نعم، نظّفي'});
  if(!ok) return;
  const dpr = window.devicePixelRatio || 1;
  // احفظ الحالة الحالية للتحويل ثم ارجع لها
  const prev = ctx.getTransform();
  ctx.setTransform(1,0,0,1,0,0);
  // إصلاح: امسح بشفافية بدلاً من ملء أبيض — حتى لا تُخفى الخلفية CSS بعد التنظيف
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(prev.a,prev.b,prev.c,prev.d,prev.e,prev.f);
  // أعد تطبيق الخلفية الحالية (CSS فقط)
  applyBackground(Data.settings.bgType || 'grid');
  // احفظ لقطة جديدة في الـ history
  State.history = State.history.slice(0, State.historyIndex+1);
  try{
    const snap = canvas.toDataURL();
    if(State.history[State.history.length-1] !== snap){
      State.history.push(snap);
      State.historyIndex++;
      if(State.history.length > State.maxHistory){
        State.history.shift();
        State.historyIndex = State.history.length - 1;
      }
    }
  }catch(e){}
  toast('success','تم تنظيف الخلفية ✓');
}

// إزالة محاور الإحداثيات المرسومة على الـ canvas من الإصدارات القديمة
// نكتشف خطاً أحمر أفقي وخطاً أزرق عمودي في وسط الكانفس ونمسحهما فقط
function _stripCanvasCoordAxes(){
  if(!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width, h = canvas.height;
  const halfW = w / 2, halfH = h / 2;
  // احصل على بكسلات المنطقة الوسطى (نطاق ضيق حول منتصف الكانفس)
  // ثم امسح شريطين رفيعين في المنتصف: أفقي (أحمر) وعمودي (أزرق)
  // المنطقة المحتملة لوجود الخطوط: 4px حول المنتصف
  const strip = 6 * dpr; // عرض الشريط الذي سنمسحه
  try{
    const prev = ctx.getTransform();
    // استخدم getImageData لمسح محدود — لكن الأسرع والأأمن: امسح مستطيلين على المنتصف
    // ملاحظة: هذه العملية قد تزيل أي رسم للمستخدم واقع في المنتصف — هذا مقبول لأن المنتصف يشمل المحاور فقط في الغالب
    // الشريط الأفقي في المنتصف
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, halfH - strip, w, strip*2);
    // الشريط العمودي في المنتصف
    ctx.clearRect(halfW - strip, 0, strip*2, h);
    // ارجع للـ transform السابق
    ctx.setTransform(prev.a, prev.b, prev.c, prev.d, prev.e, prev.f);
    // احفظ لقطة جديدة في الـ history ليعكس المستخدم التغيير
    State.history = State.history.slice(0, State.historyIndex+1);
    try{
      const snap = canvas.toDataURL();
      if(State.history[State.history.length-1] !== snap){
        State.history.push(snap);
        State.historyIndex++;
        if(State.history.length > State.maxHistory){
          State.history.shift();
          State.historyIndex = State.history.length - 1;
        }
      }
    }catch(e){}
  }catch(e){
    // في حال الفشل: لا نفعل شيئاً — الخلفية CSS ستظهر فوق المحاور القديمة
  }
}

/* HISTORY */
function saveHistory(){
  // حفظ تلقائي للشريحة الحالية (debounced) — يلتقط كل تغيير في الرسم / الملاحظات / العناصر
  if(!State._suppressPageSave && State.pages && State.pages.length){
    _schedulePageSave();
  }
  // قص أي history بعد الموقع الحالي (يعني بعد undo + رسم جديد → احذف الـ redo)
  State.history=State.history.slice(0,State.historyIndex+1);
  try{
    const snap=canvas.toDataURL();
    // تجنّب تكرار الـ snapshot الأخير (تحسين أداء + يمنع state غير ضروري)
    if(State.history[State.history.length-1]!==snap){
      State.history.push(snap);
    }
  }catch(e){}
  // ضبط historyIndex بشكل صحيح سواء حذفنا snapshot قديم أو لا
  if(State.history.length>State.maxHistory){
    State.history.shift();
    // historyIndex يبقى صحيحاً لأن shift يحذف الأقدم، والـ index يشير للنسخة الحالية
  }else{
    State.historyIndex++;
  }
  // ضمان أن historyIndex ضمن الحدود
  if(State.historyIndex>=State.history.length) State.historyIndex=State.history.length-1;
  if(State.historyIndex<0) State.historyIndex=0;
}
function undo(){
  if(State.historyIndex>0){
    State.historyIndex--;
    restoreHistory();
    toast('info','تراجعي');
  }else{
    toast('warning','لا يوجد شي للتراجع');
  }
}
function redo(){
  if(State.historyIndex<State.history.length-1){
    State.historyIndex++;
    restoreHistory();
    toast('info','أعيدي');
  }else{
    toast('warning','لا يوجد شي للإعادة');
  }
}
function restoreHistory(){
  if(!State.history[State.historyIndex]){return;}
  const img=new Image();
  img.onload=()=>{
    // مهم: احفظ الـ transform الحالي ثم ارجع له
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);  // identity transform (يتعامل مع devicePixelRatio)
    // إصلاح: امسح الكانفس بشفافية بدلاً من ملئه بأبيض — حتى تبقى الخلفية CSS ظاهرة من خلف الرسم
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.globalCompositeOperation='source-over';
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    ctx.restore();
  };
  img.onerror=()=>{toast('error','فشل استعادة السبورة');};
  img.src=State.history[State.historyIndex];
}
async function clearCanvas(){
  if(!await customConfirm('هل تريدين امسحي السبورة بالكامل؟',{title:'امسحي السبورة',danger:true,okText:'نعم، اسمحي'}))return;
  // 🛠️ إصلاح: مسح الكانفس فعلياً (مع devicePixelRatio)
  const dpr=window.devicePixelRatio||1;
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  // إصلاح: امسح بشفافية بدلاً من ملء أبيض — لتبقى الخلفية CSS ظاهرة
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.globalCompositeOperation='source-over';
  ctx.restore();
  // 🛠️ إصلاح: إعادة تعيين الـ transform للحجم الطبيعي بعد المسح
  ctx.setTransform(dpr,0,0,dpr,0,0);
  applyBackground(Data.settings.bgType||'grid');
  // 🛠️ إصلاح: حذف الـ history تماماً (وليس snapshot فارغ) لتجنّب الأشكال الشبحية
  State.history=[];
  State.historyIndex=-1;
  // احفظ snapshot فارغ كبداية جديدة
  try{State.history.push(canvas.toDataURL());State.historyIndex=0;}catch(e){}
  document.querySelectorAll('.sticky-note').forEach(n=>n.remove());
  mindmapCanvas.innerHTML='';
  toast('warning','تم امسحي السبورة');
}

/* TOOLS */
function setTool(t){
  // عند التبديل من أداة "تحديد" إلى أداة أخرى: لو فيه تحديد، نحفظه أولاً (commit) قبل التبديل
  if(State.tool==='select'&&t!=='select'&&State.sel.active){
    commitSelection();
  }
  if(t!=='select'&&State.sel.hasFloat){
    pasteFloatingSelection();
  }
  State.tool=t;
  document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===t));
  canvas.className=t+'-mode';
  if(t!=='select')setShape('free');
  closePopups();
  updateSelectMode();
  if(typeof hideSelectHover==='function')hideSelectHover();
}
function setColor(c){State.color=c;document.querySelectorAll('.c-dot[data-color]').forEach(d=>d.classList.toggle('active',d.dataset.color===c));}
function setBrushSize(s){State.brushSize=parseInt(s);document.getElementById('sizeDisplay').textContent=s;}
function setShape(s){State.shape=s;document.querySelectorAll('.shape-btn').forEach(b=>b.classList.toggle('active',b.dataset.shape===s));const sb=document.getElementById('btnShapes');if(sb){sb.classList.toggle('shape-locked',s!=='free');if(s!=='free'){const iconMap={line:'fa-minus',arrow:'fa-long-arrow-alt-right',rect:'fa-square',rectR:'fa-square-full',circle:'fa-circle',ellipse:'fa-circle-o',triangle:'fa-play',diamond:'fa-diamond',star:'fa-star',hex:'fa-hexagon',pent:'fa-pentagon',cross:'fa-plus',xmark:'fa-times',check:'fa-check',heart:'fa-heart',lightning:'fa-bolt',cloud:'fa-cloud'};const oldIcon=sb.querySelector('i');if(oldIcon){oldIcon.className='fas '+(iconMap[s]||'fa-shapes');}}}}
function toggleDashed(){State.dashed=!State.dashed;document.getElementById('btnDashed').classList.toggle('active',State.dashed);toast('info',State.dashed?'خط منقط':'خط متصل');}
function toggleFill(){
  State.fill=!State.fill;
  document.getElementById('btnFill').classList.toggle('active',State.fill);
  if(State.fill&&State.highlight){State.highlight=false;document.getElementById('btnHighlight').classList.remove('active');}
  toast(State.fill?'success':'info',State.fill?'✓ تم تفعيل التعبئة':'تم إلغاء التعبئة');
}
function toggleHighlight(){
  State.highlight=!State.highlight;
  document.getElementById('btnHighlight').classList.toggle('active',State.highlight);
  if(State.highlight&&State.fill){State.fill=false;document.getElementById('btnFill').classList.remove('active');}
  toast(State.highlight?'success':'info',State.highlight?'✓ تم تفعيل التظليل (شفافية 35%)':'تم إلغاء التظليل');
}
function togglePopup(id){
  const el=document.getElementById(id);
  if(!el)return;
  const w=el.classList.contains('active');
  closePopups();
  if(!w)el.classList.add('active');
  else el.classList.remove('active');
}
function closePopups(){
  document.querySelectorAll('.popup-panel.active').forEach(p=>p.classList.remove('active'));
}

/* DRAWING */
function getPos(e){const r=canvas.getBoundingClientRect();const t=e.touches?e.touches[0]:e;return{x:t.clientX-r.left,y:t.clientY-r.top};}
function setupCanvas(){
  canvas.addEventListener('mousedown',startDraw);canvas.addEventListener('mousemove',draw);
  canvas.addEventListener('mouseup',endDraw);canvas.addEventListener('mouseleave',e=>{endDraw();hideSelectHover();});
  canvas.addEventListener('mousemove',selectHoverUpdate);
  canvas.addEventListener('touchstart',e=>{e.preventDefault();const t=e.touches[0];startDraw({clientX:t.clientX,clientY:t.clientY});},{passive:false});
  canvas.addEventListener('touchmove',e=>{e.preventDefault();const t=e.touches[0];draw({clientX:t.clientX,clientY:t.clientY});},{passive:false});
  canvas.addEventListener('touchend',endDraw);
}

/* مؤشر hover عند التحديد: يُظهر bounding box حول العنصر تحت المؤشر */
let _selHoverEl=null;
function hideSelectHover(){
  if(_selHoverEl){_selHoverEl.remove();_selHoverEl=null;}
}
function selectHoverUpdate(e){
  // يعمل فقط في وضع التحديد، خارج الـ drag، خارج الـ marquee
  if(State.tool!=='select'){hideSelectHover();return;}
  if(State.isDrawing || State.sel.dragging || State.sel.resizing){hideSelectHover();return;}
  if(_selMarquee){hideSelectHover();return;}

  const{x,y}=getPos(e);
  // لا تعرض hover فوق التحديد الحالي (الكورسور move كافي)
  if(State.sel.active && pointInSel(x,y)){hideSelectHover();return;}

  const b=findObjectBounds(x,y);
  if(!b || b.w<8 || b.h<8){hideSelectHover();return;}
  if(!_selHoverEl){
    _selHoverEl=document.createElement('div');
    _selHoverEl.className='select-hover';
    canvasWrap.appendChild(_selHoverEl);
  }
  _selHoverEl.style.left=b.x+'px';
  _selHoverEl.style.top=b.y+'px';
  _selHoverEl.style.width=b.w+'px';
  _selHoverEl.style.height=b.h+'px';
}

/* أداة التحديد: متغير مساعد - مستطيل التحديد المؤقت (marquee) */
let _selMarquee=null;
function startDraw(e){
  const{x,y}=getPos(e);

  /* ============ أداة التحديد ============ */
  if(State.tool==='select'){
    State.isDrawing=true; // نستخدم نفس الـ flag لتتبع الماوس

    // الحالة 1: فيه تحديد بالفعل + النقرة داخل التحديد = ابدأ سحب
    if(State.sel.active && State.sel.data && pointInSel(x,y)){
      // ارفع المنطقة المختارة من الكانفس (cut) واحفظها في الـ float
      liftSelection();
      State.sel.dragging=true;
      State.sel.dx=x-State.sel.x;
      State.sel.dy=y-State.sel.y;
      State.sel.floatX=State.sel.x;
      State.sel.floatY=State.sel.y;
      State.sel.lastDrawX=State.sel.x;
      State.sel.lastDrawY=State.sel.y;
      State.sel.hasFloat=true;
      drawSelectionBox();
      return;
    }

    // الحالة 2: اضغط على محتوى مرسوم (نص/شكل/رسمة) = auto-select + drag فوري
    // نكتشف العنصر تلقائياً عن طريق فحص البكسلات
    const bounds=findObjectBounds(x,y);
    if(bounds && bounds.w>8 && bounds.h>8){
      // أكّد التحديد السابق (إن وجد)
      if(State.sel.active){
        commitSelection();
      }
      // هيّئ التحديد الجديد حول العنصر المكتشف
      State.sel.x=bounds.x;
      State.sel.y=bounds.y;
      State.sel.w=bounds.w;
      State.sel.h=bounds.h;
      State.sel.active=true;
      captureSelection();
      // ارفع العنصر وجهّزه للسحب الفوري
      liftSelection();
      State.sel.dragging=true;
      State.sel.dx=x-State.sel.x;
      State.sel.dy=y-State.sel.y;
      State.sel.floatX=State.sel.x;
      State.sel.floatY=State.sel.y;
      State.sel.lastDrawX=State.sel.x;
      State.sel.lastDrawY=State.sel.y;
      State.sel.hasFloat=true;
      drawSelectionBox();
      updateSelectMode();
      return;
    }

    // الحالة 3: نقرة على مساحة فارغة + فيه تحديد = أكّد التحديد الحالي وابدأ marquee
    if(State.sel.active){
      commitSelection();
    }
    // ابدأ marquee جديد (مخصص لمنطقة فارغة)
    State.startX=x;State.startY=y;
    if(_selMarquee)_selMarquee.remove();
    _selMarquee=document.createElement('div');
    _selMarquee.className='select-marquee';
    _selMarquee.style.left=x+'px';
    _selMarquee.style.top=y+'px';
    _selMarquee.style.width='0px';
    _selMarquee.style.height='0px';
    canvasWrap.appendChild(_selMarquee);
    State.sel.x=x;State.sel.y=y;
    return;
  }
  /* ============ بقية الأدوات ============ */
  State.startX=State.lastX=x;State.startY=State.lastY=y;State.isDrawing=true;
  if(State.tool==='pan'){State.isPanning=true;return;}
  if(State.tool==='text'){insertText(x,y);State.isDrawing=false;return;}
  if(State.shape!=='free'){State.snapshot=ctx.getImageData(0,0,canvas.width,canvas.height);return;}
  ctx.beginPath();ctx.moveTo(x,y);
  if(State.tool==='eraser'){
    // إصلاح: الممحاة تفرغ البكسلات بدلاً من رسم أبيض — حتى تبقى الخلفية CSS ظاهرة بعد المسح
    ctx.globalCompositeOperation='destination-out';
    ctx.strokeStyle='rgba(0,0,0,1)'; // اللون غير مهم مع destination-out، المهم هو القناع
  } else {
    ctx.globalCompositeOperation='source-over';
    ctx.strokeStyle=State.color;
  }
  ctx.lineWidth=State.brushSize*(State.tool==='eraser'?2:1);
  if(State.highlight){ctx.globalAlpha=.35;ctx.lineWidth=State.brushSize*3;}
  else{ctx.globalAlpha=1;}
  if(State.dashed)ctx.setLineDash([10,6]);else ctx.setLineDash([]);
}

function draw(e){
  if(!State.isDrawing)return;
  const{x,y}=getPos(e);

  /* ============ أداة التحديد: رسم marquee ============ */
  if(State.tool==='select'){
    // سحب التحديد (المنطقة المرفوعة)
    if(State.sel.dragging && State.sel.hasFloat){
      // 1) امسح المنطقة في مكانها السابق (الكانفس شفاف من تحتها)
      const dpr=window.devicePixelRatio||1;
      ctx.save();ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(State.sel.lastDrawX*dpr,State.sel.lastDrawY*dpr,State.sel.floatW*dpr,State.sel.floatH*dpr);
      ctx.restore();
      // 2) ارسم المنطقة في المكان الجديد
      const nx=x-State.sel.dx, ny=y-State.sel.dy;
      State.sel.floatX=nx;State.sel.floatY=ny;
      ctx.save();ctx.setTransform(1,0,0,1,0,0);
      ctx.drawImage(State.sel.data,nx*dpr,ny*dpr,State.sel.floatW*dpr,State.sel.floatH*dpr);
      ctx.restore();
      State.sel.lastDrawX=nx;State.sel.lastDrawY=ny;
      // 3) حدّث إطار التحديد ليتبع العائم
      State.sel.x=nx;State.sel.y=ny;
      drawSelectionBox();
      return;
    }
    // رسم marquee
    if(_selMarquee){
      const x1=Math.min(State.startX,x),y1=Math.min(State.startY,y);
      const x2=Math.max(State.startX,x),y2=Math.max(State.startY,y);
      _selMarquee.style.left=x1+'px';
      _selMarquee.style.top=y1+'px';
      _selMarquee.style.width=(x2-x1)+'px';
      _selMarquee.style.height=(y2-y1)+'px';
    }
    return;
  }

  /* ============ بقية الأدوات ============ */
  if(State.tool==='pan'&&State.isPanning){
    const dx=x-State.lastX,dy=y-State.lastY;
    State.lastX=x;State.lastY=y;
    const img=new Image();
    img.onload=()=>{ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,dx,dy);ctx.restore();};
    img.src=canvas.toDataURL();
    return;
  }
  if(State.shape!=='free'){
    if(State.snapshot)ctx.putImageData(State.snapshot,0,0);
    drawShape(State.shape,State.startX,State.startY,x,y);
    return;
  }
  ctx.lineTo(x,y);ctx.stroke();
  State.lastX=x;State.lastY=y;
}

function endDraw(){
  /* ============ أداة التحديد: إنهاء marquee أو السحب ============ */
  if(State.tool==='select'&&State.isDrawing){
    if(State.sel.dragging && State.sel.hasFloat){
      // ثبّت التحديد في مكانه الجديد واحفظ في الـ history
      State.sel.dragging=false;
      // ثبّت الإحداثيات النهائية
      State.sel.x=State.sel.floatX;
      State.sel.y=State.sel.floatY;
      State.sel.hasFloat=false; // صار جزء من الكانفس الآن
      drawSelectionBox();
      saveHistory();
      State.isDrawing=false;
      return;
    }
    // إنهاء marquee → أنشئ التحديد
    if(_selMarquee){
      const r=_selMarquee.getBoundingClientRect();
      const cr=canvas.getBoundingClientRect();
      const x=parseFloat(_selMarquee.style.left);
      const y=parseFloat(_selMarquee.style.top);
      const w=parseFloat(_selMarquee.style.width);
      const h=parseFloat(_selMarquee.style.height);
      _selMarquee.remove();_selMarquee=null;
      if(w<4||h<4){
        // marquee صغير جداً → إلغاء
        State.isDrawing=false;return;
      }
      // خزّن الإحداثيات النهائية
      State.sel.x=x;State.sel.y=y;State.sel.w=w;State.sel.h=h;
      State.sel.active=true;
      captureSelection(); // خزّن ImageData للمنطقة
      drawSelectionBox();
      updateSelectMode();
      toast('info','✓ تم التحديد — اسحبي لتحريكه، أو استخدمي الأزرار');
    }
    State.isDrawing=false;
    return;
  }

  const wasShape=State.isDrawing&&State.shape!=='free';
  if(wasShape&&State.snapshot)State.snapshot=null;
  if(State.isDrawing){
    // إعادة ضبط خصائص الرسم لوضعها الطبيعي بعد الانتهاء (خاصة بعد استخدام الممحاة destination-out)
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.setLineDash([]);
    if(wasShape){setShape('free');}
    saveHistory();
  }
  State.isDrawing=false;State.isPanning=false;
}
function drawShape(shape,x1,y1,x2,y2){ctx.save();ctx.strokeStyle=State.color;ctx.fillStyle=State.fill?State.color:'transparent';ctx.lineWidth=State.brushSize;if(State.dashed)ctx.setLineDash([10,6]);ctx.lineCap='round';ctx.lineJoin='round';const w=x2-x1,h=y2-y1;const cx=(x1+x2)/2,cy=(y1+y2)/2;const r=Math.sqrt(w*w+h*h)/2;ctx.beginPath();switch(shape){case'line':ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);break;case'arrow':ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);const a=Math.atan2(y2-y1,x2-x1);const head=18;ctx.moveTo(x2,y2);ctx.lineTo(x2-head*Math.cos(a-Math.PI/6),y2-head*Math.sin(a-Math.PI/6));ctx.moveTo(x2,y2);ctx.lineTo(x2-head*Math.cos(a+Math.PI/6),y2-head*Math.sin(a+Math.PI/6));break;case'rect':ctx.rect(x1,y1,w,h);break;case'rectR':roundRect(ctx,x1,y1,w,h,12);break;case'circle':ctx.arc(cx,cy,r,0,Math.PI*2);break;case'ellipse':ctx.ellipse(cx,cy,Math.abs(w)/2,Math.abs(h)/2,0,0,Math.PI*2);break;case'triangle':ctx.moveTo(cx,y1);ctx.lineTo(x1,y2);ctx.lineTo(x2,y2);ctx.closePath();break;case'diamond':ctx.moveTo(cx,y1);ctx.lineTo(x2,cy);ctx.lineTo(cx,y2);ctx.lineTo(x1,cy);ctx.closePath();break;case'star':drawStar(ctx,cx,cy,5,r,r/2);break;case'hex':drawPolygon(ctx,cx,cy,6,r);break;case'pent':drawPolygon(ctx,cx,cy,5,r);break;case'cross':ctx.moveTo(cx,y1);ctx.lineTo(cx,y2);ctx.moveTo(x1,cy);ctx.lineTo(x2,cy);break;case'xmark':ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.moveTo(x2,y1);ctx.lineTo(x1,y2);break;case'check':ctx.moveTo(x1,cy);ctx.lineTo(cx,y2);ctx.lineTo(x2,y1-h*.1);break;case'heart':drawHeart(ctx,cx,cy,r);break;case'lightning':drawLightning(ctx,x1,y1,x2,y2);break;case'cloud':drawCloud(ctx,cx,cy,r);break;}if(State.fill)ctx.fill();ctx.stroke();ctx.restore();}
function roundRect(ctx,x,y,w,h,r){if(w<2*r)r=w/2;if(h<2*r)r=h/2;ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function drawStar(ctx,cx,cy,sp,outerR,innerR){let rot=Math.PI/2*3,x=cx,y=cy;const step=Math.PI/sp;ctx.moveTo(cx,cy-outerR);for(let i=0;i<sp;i++){x=cx+Math.cos(rot)*outerR;y=cy+Math.sin(rot)*outerR;ctx.lineTo(x,y);rot+=step;x=cx+Math.cos(rot)*innerR;y=cy+Math.sin(rot)*innerR;ctx.lineTo(x,y);rot+=step;}ctx.lineTo(cx,cy-outerR);ctx.closePath();}
function drawPolygon(ctx,cx,cy,sides,r){ctx.moveTo(cx+r,cy);for(let i=1;i<sides;i++){const a=i*2*Math.PI/sides-Math.PI/2;ctx.lineTo(cx+r*Math.cos(a),cy+r*Math.sin(a));}ctx.closePath();}
function drawHeart(ctx,cx,cy,r){ctx.moveTo(cx,cy+r*.6);ctx.bezierCurveTo(cx+r,cy-r*.3,cx+r*.5,cy-r,cx,cy-r*.4);ctx.bezierCurveTo(cx-r*.5,cy-r,cx-r,cy-r*.3,cx,cy+r*.6);}
function drawLightning(ctx,x1,y1,x2,y2){ctx.moveTo((x1+x2)/2-(x2-x1)/4,y1);ctx.lineTo(x1,(y1+y2)/2);ctx.lineTo((x1+x2)/2-(x2-x1)/8,(y1+y2)/2);ctx.lineTo((x1+x2)/2+(x2-x1)/4,y2);}
function drawCloud(ctx,cx,cy,r){ctx.arc(cx-r*.5,cy,r*.5,0,Math.PI*2);ctx.arc(cx,cy-r*.3,r*.55,0,Math.PI*2);ctx.arc(cx+r*.5,cy,r*.5,0,Math.PI*2);ctx.arc(cx,cy+r*.3,r*.4,0,Math.PI*2);}

async function insertText(x,y){const t=await customPrompt('أدخلي النص الذي تريدين كتابته على السبورة:','','إضافة نص على السبورة');if(!t||!t.trim())return;const fs=parseInt(Data.settings.fontSize)||20;ctx.save();ctx.fillStyle=State.color;ctx.font=`${fs}px Tajawal,sans-serif`;ctx.textBaseline='top';ctx.direction='rtl';ctx.fillText(t,x,y);ctx.restore();saveHistory();toast('success','تم إضافة النص');}
async function insertSymbol(s){const t=await customPrompt('النص (اضغطي موافق لإدراج الرمز فقط، أو أضيفي نصاً بعده):',s,'إدراج رمز');if(t===null)return;const f=t===''?s:s+t;const x=canvas.width/(2*(window.devicePixelRatio||1))-100;const y=canvas.height/(2*(window.devicePixelRatio||1))-30;ctx.save();ctx.fillStyle=State.color;ctx.font='28px Tajawal,sans-serif';ctx.textBaseline='middle';ctx.direction='rtl';ctx.fillText(f,x,y);ctx.restore();saveHistory();toast('success',`تم إدراج: ${s}`);}

/* ============================================================
   🗺️ محاكاة تفاعلية لجغرافيا وعلوم الأرض
   كل محاكاة ترسم مخططاً تعليمياً عربياً على السبورة
   يناسب منهج مملكة البحرين (الأعداد المتوسط/الثانوي)
   ============================================================ */

// مساعد: مركز الرسم الحالي على السبورة
function __geoCenter(w, h){
  const dpr = window.devicePixelRatio || 1;
  return {x: canvas.width/(2*dpr) - w/2, y: canvas.height/(2*dpr) - h/2, dpr};
}

// مساعد: عنوان عربي للمخطط
function __geoHeader(ctx, x, y, w, title, subtitle){
  ctx.save();
  ctx.fillStyle = '#0e6b5a';
  ctx.font = 'bold 22px Tajawal, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.direction = 'rtl';
  ctx.fillText(title, x + w/2, y);
  if(subtitle){
    ctx.fillStyle = '#16a085';
    ctx.font = '13px Tajawal, sans-serif';
    ctx.fillText(subtitle, x + w/2, y + 30);
  }
  ctx.restore();
}

// مساعد: تسمية على المخطط مع خط منقط
function __geoLabel(ctx, x, y, text, color, targetX, targetY){
  ctx.save();
  ctx.fillStyle = color || '#0e6b5a';
  ctx.font = 'bold 14px Tajawal, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  if(targetX !== undefined){
    ctx.strokeStyle = color || '#0e6b5a';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3,3]);
    ctx.beginPath();
    ctx.moveTo(x - 8, y);
    ctx.lineTo(targetX, targetY);
    ctx.stroke();
    ctx.setLineDash([]);
    // نقطة في النهاية
    ctx.beginPath();
    ctx.arc(targetX, targetY, 3, 0, Math.PI*2);
    ctx.fillStyle = color || '#0e6b5a';
    ctx.fill();
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

// مساعد: سهم منحني (للتدفقات مثل دورة الماء)
function __geoArrow(ctx, x1, y1, x2, y2, color, curve){
  color = color || '#1a5f7a';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  const midX = (x1+x2)/2;
  const midY = (y1+y2)/2 - (curve || 30);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(midX, midY, x2, y2);
  ctx.stroke();
  // رأس السهم
  const angle = Math.atan2(y2 - midY, x2 - midX);
  const ah = 10;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ah*Math.cos(angle - Math.PI/6), y2 - ah*Math.sin(angle - Math.PI/6));
  ctx.lineTo(x2 - ah*Math.cos(angle + Math.PI/6), y2 - ah*Math.sin(angle + Math.PI/6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ----- 🇧🇭 1) خريطة مملكة البحرين ----- */
function drawBahrainMap(ctx, x, y){
  const w = 520, h = 380;
  ctx.save();
  // خلفية البحر
  ctx.fillStyle = '#d4f1ec';
  ctx.fillRect(x, y, w, h);
  // شبكة إحداثية
  ctx.strokeStyle = 'rgba(22,160,133,.25)';
  ctx.lineWidth = 1;
  for(let i=1;i<5;i++){
    ctx.beginPath(); ctx.moveTo(x + (w/5)*i, y); ctx.lineTo(x + (w/5)*i, y+h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y + (h/5)*i); ctx.lineTo(x+w, y + (h/5)*i); ctx.stroke();
  }
  // العنوان
  __geoHeader(ctx, x, y+8, w, '🇧🇭 مملكة البحرين', 'أرخبيل من 50+ جزيرة - الخليج العربي');
  // جزيرة البحرين الرئيسية (محسنة بشكل تقريبي)
  ctx.fillStyle = '#f4d49a';
  ctx.strokeStyle = '#a6743a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x+30, y+90);
  ctx.bezierCurveTo(x+50, y+70, x+120, y+60, x+200, y+80);
  ctx.bezierCurveTo(x+290, y+95, x+380, y+85, x+450, y+100);
  ctx.bezierCurveTo(x+475, y+120, x+470, y+150, x+430, y+165);
  ctx.bezierCurveTo(x+340, y+180, x+250, y+175, x+170, y+170);
  ctx.bezierCurveTo(x+90, y+160, x+40, y+150, x+25, y+130);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // شمال البحرين (محرق والمناطق)
  ctx.beginPath();
  ctx.arc(x+460, y+70, 18, 0, Math.PI*2);
  ctx.fillStyle = '#f4d49a'; ctx.fill(); ctx.stroke();
  // جزر أخرى (نقاط صغيرة)
  const islands = [
    {x:x+200, y:y+220, r:14, name:'سترة'},
    {x:x+330, y:y+240, r:10, name:'النبيه'},
    {x:x+150, y:y+250, r:7,  name:'أمالا'},
    {x:x+260, y:y+260, r:6,  name:'دوحة عراد'},
    {x:x+380, y:y+220, r:5,  name:'جدة'}
  ];
  islands.forEach(isl=>{
    ctx.beginPath();
    ctx.arc(isl.x, isl.y, isl.r, 0, Math.PI*2);
    ctx.fillStyle = '#f4d49a'; ctx.fill(); ctx.stroke();
    __geoLabel(ctx, isl.x+isl.r+40, isl.y, isl.name, '#a6743a', isl.x+isl.r, isl.y);
  });
  // مدن رئيسية على الجزيرة الرئيسية
  const cities = [
    {x:x+100, y:y+115, name:'المنامة'},
    {x:x+220, y:y+105, name:'الرفاع'},
    {x:x+340, y:y+115, name:'المحرق'},
    {x:x+150, y:y+150, name:'الجد'},
    {x:x+400, y:y+140, name:'سترة'}
  ];
  cities.forEach(c=>{
    // نقطة حمراء
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, Math.PI*2);
    ctx.fillStyle = '#c84b31'; ctx.fill();
    // مربع صغير
    ctx.fillStyle = '#c84b31';
    ctx.fillRect(c.x-2, c.y-2, 4, 4);
    __geoLabel(ctx, c.x+30, c.y, c.name, '#c84b31', c.x+3, c.y);
  });
  // سهم البوصلة
  ctx.save();
  ctx.translate(x+w-50, y+50);
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.moveTo(0,-20); ctx.lineTo(-6,8); ctx.lineTo(6,8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2c3e50';
  ctx.beginPath();
  ctx.moveTo(0,20); ctx.lineTo(-6,-8); ctx.lineTo(6,-8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2c3e50';
  ctx.font = 'bold 12px Tajawal';
  ctx.textAlign = 'center';
  ctx.fillText('ش', 0, -24);
  ctx.fillText('ج', 0, 32);
  ctx.restore();
  // المفتاح
  ctx.save();
  ctx.fillStyle = '#0e6b5a';
  ctx.font = 'bold 12px Tajawal';
  ctx.textAlign = 'right';
  ctx.fillText('🔴 مدينة رئيسية', x+w-15, y+h-40);
  ctx.fillText('🟫 جزيرة', x+w-15, y+h-22);
  ctx.fillStyle = '#1a5f7a';
  ctx.fillText('مسطحات مائية: الخليج العربي', x+w-15, y+h-4);
  ctx.restore();
  ctx.restore();
}

/* ----- 💧 2) دورة الماء في الطبيعة ----- */
function drawWaterCycle(ctx, x, y){
  const w = 500, h = 380;
  ctx.save();
  __geoHeader(ctx, x, y+8, w, '💧 دورة الماء في الطبيعة', 'التبخر - التكثف - الهطول - الجريان السطحي');
  // السماء
  ctx.fillStyle = '#e3f2fd';
  ctx.fillRect(x+30, y+50, w-60, 130);
  // الأرض
  ctx.fillStyle = '#d7b377';
  ctx.fillRect(x+30, y+200, w-60, 150);
  // البحر في الأرض
  ctx.fillStyle = '#4a90c2';
  ctx.fillRect(x+50, y+280, 150, 50);
  ctx.strokeStyle = '#1a5f7a';
  ctx.lineWidth = 2;
  ctx.strokeRect(x+50, y+280, 150, 50);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px Tajawal';
  ctx.textAlign = 'center';
  ctx.fillText('بحر', x+125, y+312);
  // الجبل (مثلث)
  ctx.beginPath();
  ctx.moveTo(x+250, y+350);
  ctx.lineTo(x+330, y+220);
  ctx.lineTo(x+410, y+350);
  ctx.closePath();
  ctx.fillStyle = '#8b7355';
  ctx.fill(); ctx.stroke();
  // قمة الجبل بيضاء
  ctx.beginPath();
  ctx.moveTo(x+315, y+235);
  ctx.lineTo(x+330, y+220);
  ctx.lineTo(x+345, y+235);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  // غيوم
  function cloud(cx, cy, scale){
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale||1, scale||1);
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    // ظل خفيف
    ctx.shadowColor = 'rgba(100,100,100,.25)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    // ارسم كل دوائر الغيمة في مسار واحد
    ctx.beginPath();
    ctx.arc(-18, 4, 14, 0, Math.PI*2);
    ctx.arc(0, -8, 18, 0, Math.PI*2);
    ctx.arc(18, 4, 14, 0, Math.PI*2);
    ctx.arc(-8, 10, 13, 0, Math.PI*2);
    ctx.arc(10, 10, 12, 0, Math.PI*2);
    ctx.fill();
    // أعد تشغيل الظل
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    // خط سفلي للغيوم
    ctx.strokeStyle = '#7a8a9a';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-30, 12);
    ctx.quadraticCurveTo(0, 24, 30, 12);
    ctx.stroke();
    ctx.restore();
  }
  cloud(x+120, y+90, 1.2);
  cloud(x+250, y+75, 1.4);
  cloud(x+380, y+100, 1.1);
  // أسهم الدورة
  // 1) تبخر (من البحر للأعلى)
  __geoArrow(ctx, x+125, y+275, x+125, y+120, '#e74c3c', 40);
  __geoLabel(ctx, x+165, y+200, 'تبخر', '#e74c3c');
  // 2) تكثف (في السحابة)
  __geoArrow(ctx, x+250, y+110, x+330, y+150, '#1a5f7a', -20);
  __geoLabel(ctx, x+270, y+100, 'تكثف', '#1a5f7a');
  // 3) هطول (مطر من السحابة)
  ctx.strokeStyle = '#3498db';
  ctx.lineWidth = 2;
  for(let i=0;i<5;i++){
    ctx.beginPath();
    ctx.moveTo(x+360+i*8, y+115);
    ctx.lineTo(x+355+i*8, y+150);
    ctx.stroke();
  }
  __geoLabel(ctx, x+400, y+175, 'هطول (مطر)', '#3498db');
  // 4) جريان سطحي (من الجبل للبحر)
  __geoArrow(ctx, x+280, y+340, x+200, y+320, '#16a085', 0);
  __geoLabel(ctx, x+260, y+360, 'جريان سطحي', '#16a085');
  // 5) تسرب
  __geoArrow(ctx, x+330, y+340, x+200, y+345, '#8b4513', 0);
  __geoLabel(ctx, x+250, y+360, 'تسرب', '#8b4513');
  ctx.restore();
}

/* ----- 🌍 3) طبقات الأرض ----- */
function drawEarthLayers(ctx, x, y){
  const w = 460, h = 460;
  ctx.save();
  __geoHeader(ctx, x, y+8, w, '🌍 طبقات الأرض الداخلية', 'القشرة - الوشاح - اللب الخارجي - اللب الداخلي');
  // الدوائر متحدة المركز
  const cx = x + w/2, cy = y + 260;
  // القشرة
  ctx.fillStyle = '#8b4513';
  ctx.beginPath();
  ctx.arc(cx, cy, 200, 0, Math.PI*2);
  ctx.fill();
  // الوشاح العلوي
  ctx.fillStyle = '#e67e22';
  ctx.beginPath();
  ctx.arc(cx, cy, 170, 0, Math.PI*2);
  ctx.fill();
  // الوشاح السفلي
  ctx.fillStyle = '#d35400';
  ctx.beginPath();
  ctx.arc(cx, cy, 130, 0, Math.PI*2);
  ctx.fill();
  // اللب الخارجي
  ctx.fillStyle = '#f1c40f';
  ctx.beginPath();
  ctx.arc(cx, cy, 90, 0, Math.PI*2);
  ctx.fill();
  // اللب الداخلي
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.arc(cx, cy, 45, 0, Math.PI*2);
  ctx.fill();
  // حدود بين الطبقات
  ctx.strokeStyle = '#2c3e50';
  ctx.lineWidth = 1.5;
  [200,170,130,90,45].forEach(r=>{
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.stroke();
  });
  // تسميات
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#2c3e50';
  ctx.lineWidth = 2;
  ctx.font = 'bold 13px Tajawal';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  const labels = [
    {r:185, t:'القشرة', sz:14},
    {r:150, t:'الوشاح', sz:14},
    {r:110, t:'اللب', sz:13},
    {r:67,  t:'خارجي', sz:11},
    {r:30,  t:'داخلي', sz:11}
  ];
  labels.forEach(l=>{
    ctx.fillText(l.t, cx, cy - l.r);
    if(l.sz>11){
      ctx.fillText(l.t, cx, cy + l.r);
    }
  });
  // خطوط منقطة للتسميات
  ctx.strokeStyle = 'rgba(0,0,0,.4)';
  ctx.setLineDash([2,3]);
  ctx.lineWidth = 1;
  // شرح جانبي
  ctx.fillStyle = '#2c3e50';
  ctx.font = '11px Tajawal';
  ctx.textAlign = 'right';
  ctx.setLineDash([]);
  const info = [
    {y:y+60, t:'القشرة (Crust): 5-70 كم', c:'#8b4513'},
    {y:y+85, t:'الوشاح (Mantle): 2900 كم', c:'#e67e22'},
    {y:y+110, t:'اللب الخارجي (سائل)', c:'#f1c40f'},
    {y:y+135, t:'اللب الداخلي (صلب) 1220 كم', c:'#e74c3c'},
    {y:y+165, t:'🌡 حرارة اللب: ~6000°م', c:'#c84b31'},
    {y:y+185, t:'(مثل حرارة سطح الشمس!)', c:'#666'}
  ];
  info.forEach(i=>{
    ctx.fillStyle = i.c;
    ctx.fillRect(x+10, i.y+10, 12, 12);
    ctx.fillStyle = '#2c3e50';
    ctx.font = 'bold 11px Tajawal';
    ctx.fillText(i.t, x+150, i.y+16);
  });
  ctx.restore();
}

/* ----- 🪐 4) المجموعة الشمسية ----- */
function drawSolarSystem(ctx, x, y){
  const w = 560, h = 360;
  ctx.save();
  __geoHeader(ctx, x, y+8, w, '🪐 المجموعة الشمسية', 'الشمس والكواكب الثمانية - يدورون حول الشمس');
  // خلفية الفضاء
  ctx.fillStyle = '#0a1838';
  ctx.fillRect(x+20, y+50, w-40, h-100);
  // نجوم عشوائية
  ctx.fillStyle = '#fff';
  for(let i=0;i<35;i++){
    const sx = x+30 + Math.random()*(w-60);
    const sy = y+60 + Math.random()*(h-120);
    ctx.beginPath();
    ctx.arc(sx, sy, Math.random()*1.5, 0, Math.PI*2);
    ctx.fill();
  }
  // الشمس + الكواكب
  const cx = x + 40, cy = y + h/2 + 20;
  const planets = [
    {dist:30,  size:6,  color:'#95a5a6', name:'عطارد'},
    {dist:60,  size:9,  color:'#e67e22', name:'الزهرة'},
    {dist:90,  size:10, color:'#3498db', name:'الأرض'},
    {dist:120, size:8,  color:'#c84b31', name:'المريخ'},
    {dist:160, size:18, color:'#d4a574', name:'المشتري'},
    {dist:200, size:16, color:'#cdb380', name:'زحل'},
    {dist:235, size:13, color:'#7ec8e3', name:'أورانوس'},
    {dist:265, size:13, color:'#4a90c2', name:'نبتون'}
  ];
  // مدارات
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.lineWidth = 1;
  planets.forEach(p=>{
    ctx.beginPath();
    ctx.arc(cx, cy, p.dist, 0, Math.PI*2);
    ctx.stroke();
  });
  // الشمس
  const sg = ctx.createRadialGradient(cx, cy, 5, cx, cy, 22);
  sg.addColorStop(0, '#fff7c0');
  sg.addColorStop(0.5, '#f9d423');
  sg.addColorStop(1, '#e67e22');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px Tajawal';
  ctx.textAlign = 'center';
  ctx.fillText('الشمس', cx, cy - 35);
  // الكواكب
  planets.forEach((p, i)=>{
    const angle = (i * 0.7) + (Date.now() / 3000) % (Math.PI*2);
    const px = cx + Math.cos(angle) * p.dist;
    const py = cy + Math.sin(angle) * p.dist * 0.55; // قطع ناقص
    // الكوكب
    const grad = ctx.createRadialGradient(px-p.size/3, py-p.size/3, 1, px, py, p.size);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.4, p.color);
    grad.addColorStop(1, '#000');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, p.size, 0, Math.PI*2);
    ctx.fill();
    // حلقة زحل
    if(p.name==='زحل'){
      ctx.strokeStyle = '#cdb380';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(px, py, p.size*1.7, p.size*0.5, 0.3, 0, Math.PI*2);
      ctx.stroke();
    }
    // اسم الكوكب
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px Tajawal';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, px, py + p.size + 12);
  });
  // الشمس أكبر من الكواكب الصخرية (ملاحظة)
  ctx.fillStyle = '#f9d423';
  ctx.font = 'bold 10px Tajawal';
  ctx.textAlign = 'left';
  ctx.fillText('💡 الشمس أكبر من كل الكواكب مجتمعة!', x+30, y+h-30);
  ctx.fillStyle = '#7ec8e3';
  ctx.fillText('🪐 الكواكب البعيدة (المشتري إلى نبتون) = عملاقة غازية', x+30, y+h-15);
  ctx.restore();
}

/* ----- 🌋 5) بركان ----- */
function drawVolcano(ctx, x, y){
  const w = 500, h = 400;
  ctx.save();
  __geoHeader(ctx, x, y+8, w, '🌋 البركان', 'اندفاع الصهارة من باطن الأرض إلى السطح');
  // السماء
  const sky = ctx.createLinearGradient(0, y+50, 0, y+250);
  sky.addColorStop(0, '#87ceeb');
  sky.addColorStop(1, '#fff5e0');
  ctx.fillStyle = sky;
  ctx.fillRect(x+20, y+50, w-40, 200);
  // الأرض
  ctx.fillStyle = '#5d4e37';
  ctx.fillRect(x+20, y+250, w-40, 130);
  // طبقات تحت الأرض
  ctx.fillStyle = '#8b4513';
  ctx.fillRect(x+20, y+250, w-40, 30);
  ctx.fillStyle = '#a0522d';
  ctx.fillRect(x+20, y+280, w-40, 30);
  // جسم البركان
  ctx.beginPath();
  ctx.moveTo(x+80, y+250);
  ctx.lineTo(x+220, y+100);
  ctx.lineTo(x+280, y+100);
  ctx.lineTo(x+420, y+250);
  ctx.closePath();
  ctx.fillStyle = '#5d4e37';
  ctx.fill();
  ctx.strokeStyle = '#3e2f1f';
  ctx.lineWidth = 2;
  ctx.stroke();
  // فوهة البركان
  ctx.beginPath();
  ctx.ellipse(x+250, y+100, 35, 12, 0, 0, Math.PI*2);
  ctx.fillStyle = '#1a1a1a';
  ctx.fill(); ctx.stroke();
  // الحمم تخرج
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.ellipse(x+250, y+100, 28, 8, 0, 0, Math.PI*2);
  ctx.fill();
  // تدفقات الحمم على الجوانب
  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x+200, y+115);
  ctx.bezierCurveTo(x+170, y+150, x+150, y+200, x+130, y+250);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x+300, y+115);
  ctx.bezierCurveTo(x+330, y+160, x+340, y+210, x+360, y+250);
  ctx.stroke();
  // عمود الرماد والدخان
  ctx.fillStyle = 'rgba(80,80,80,.7)';
  for(let i=0;i<8;i++){
    ctx.beginPath();
    ctx.arc(x+250 + (i-4)*6, y+80 - i*15, 18 - i*1.5, 0, Math.PI*2);
    ctx.fill();
  }
  // غيوم الرماد
  ctx.fillStyle = 'rgba(60,60,60,.5)';
  ctx.beginPath();
  ctx.arc(x+200, y+40, 30, 0, Math.PI*2);
  ctx.arc(x+250, y+25, 35, 0, Math.PI*2);
  ctx.arc(x+300, y+45, 28, 0, Math.PI*2);
  ctx.fill();
  // غرفة الصهارة تحت الأرض
  ctx.fillStyle = '#ff6b35';
  ctx.beginPath();
  ctx.ellipse(x+250, y+340, 70, 30, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#c84b31';
  ctx.lineWidth = 2;
  ctx.stroke();
  // مدخنة الصهارة
  ctx.strokeStyle = '#c84b31';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x+250, y+340);
  ctx.lineTo(x+250, y+105);
  ctx.stroke();
  // تسميات
  __geoLabel(ctx, x+340, y+100, 'فوهة البركان', '#c84b31', x+285, y+100);
  __geoLabel(ctx, x+340, y+60, 'سحابة الرماد', '#555', x+275, y+50);
  __geoLabel(ctx, x+170, y+170, 'حمم بركانية', '#e74c3c', x+170, y+185);
  __geoLabel(ctx, x+340, y+340, 'غرفة الصهارة', '#ff6b35', x+310, y+340);
  __geoLabel(ctx, x+340, y+200, 'مدخنة', '#c84b31', x+260, y+200);
  __geoLabel(ctx, x+60, y+220, 'صخور', '#5d4e37', x+100, y+220);
  // مفتاح
  ctx.fillStyle = '#c84b31';
  ctx.font = 'bold 12px Tajawal';
  ctx.textAlign = 'left';
  ctx.fillText('🌋 تتكون البراكين من: غرفة صهارة ← مدخنة ← فوهة', x+30, y+h-30);
  ctx.fillStyle = '#16a085';
  ctx.fillText('⚠ معظم براكين الأرض توجد على حدود الصفائح التكتونية', x+30, y+h-12);
  ctx.restore();
}

/* ----- 📈 6) زلزال ----- */
function drawEarthquake(ctx, x, y){
  const w = 500, h = 380;
  ctx.save();
  __geoHeader(ctx, x, y+8, w, '📈 الزلزال', 'الموجات الزلزالية تنتشر من بؤرة الزلزال');
  // الأرض (مستويات)
  ctx.fillStyle = '#8b6f47';
  ctx.fillRect(x+20, y+50, w-40, 100);
  ctx.fillStyle = '#a0825a';
  ctx.fillRect(x+20, y+150, w-40, 60);
  ctx.fillStyle = '#5d4e37';
  ctx.fillRect(x+20, y+210, w-40, h-240);
  // خط الصدع
  ctx.strokeStyle = '#c84b31';
  ctx.lineWidth = 3;
  ctx.setLineDash([8,5]);
  ctx.beginPath();
  ctx.moveTo(x+50, y+50);
  ctx.lineTo(x+260, y+170);
  ctx.lineTo(x+260, y+250);
  ctx.lineTo(x+w-50, y+h-30);
  ctx.stroke();
  ctx.setLineDash([]);
  // البؤرة
  const fx = x+260, fy = y+220;
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.arc(fx, fy, 10, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  // الموجات الزلزالية (دوائر)
  ctx.strokeStyle = 'rgba(231,76,60,.7)';
  ctx.lineWidth = 2;
  for(let r=25;r<=130;r+=20){
    ctx.beginPath();
    ctx.arc(fx, fy, r, 0, Math.PI*2);
    ctx.stroke();
  }
  // الموجات السطحية (أقواس فقط فوق الأرض)
  ctx.strokeStyle = 'rgba(231,76,60,.4)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4,3]);
  for(let r=25;r<=130;r+=20){
    ctx.beginPath();
    ctx.arc(fx, fy, r, Math.PI*1.15, Math.PI*1.85);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // المركز السطحي
  ctx.fillStyle = '#c84b31';
  ctx.beginPath();
  ctx.arc(fx, y+150, 6, 0, Math.PI*2);
  ctx.fill();
  // تسميات
  __geoLabel(ctx, x+340, y+145, 'المركز السطحي', '#c84b31', fx+8, y+150);
  __geoLabel(ctx, x+340, y+220, 'البؤرة', '#e74c3c', fx+15, fy);
  __geoLabel(ctx, x+340, y+260, 'الموجات الزلزالية', '#e74c3c', fx+100, fy-20);
  // قياسات على الجانب
  ctx.fillStyle = '#0e6b5a';
  ctx.font = 'bold 13px Tajawal';
  ctx.textAlign = 'right';
  ctx.fillText('📊 مقياس ريختر:', x+150, y+80);
  ctx.font = '11px Tajawal';
  ctx.fillText('• أقل من 3: غير محسوس', x+150, y+100);
  ctx.fillText('• 3-4: محسوس خفيف', x+150, y+118);
  ctx.fillText('• 5-6: متوسط - أضرار', x+150, y+136);
  ctx.fillText('• 7+: مدمر', x+150, y+154);
  ctx.fillStyle = '#c84b31';
  ctx.font = 'bold 12px Tajawal';
  ctx.fillText('⚠ البحرين: منخفضة المخاطر', x+150, y+180);
  ctx.fillStyle = '#1a5f7a';
  ctx.font = '11px Tajawal';
  ctx.fillText('(تقع بعيداً عن حدود الصفائح)', x+150, y+198);
  ctx.restore();
}

/* ----- 🌊 7) المد والجزر ----- */
function drawTides(ctx, x, y){
  const w = 520, h = 360;
  ctx.save();
  __geoHeader(ctx, x, y+8, w, '🌊 المد والجزر', 'تأثير جاذبية القمر على مياه البحر');
  // الخلفية
  ctx.fillStyle = '#0a1838';
  ctx.fillRect(x+20, y+50, w-40, h-100);
  // الأرض
  const earthCx = x + 170, earthCy = y + 220, earthR = 70;
  const eg = ctx.createRadialGradient(earthCx-20, earthCy-20, 10, earthCx, earthCy, earthR);
  eg.addColorStop(0, '#5dade2');
  eg.addColorStop(0.7, '#1a5f7a');
  eg.addColorStop(1, '#0f3460');
  ctx.fillStyle = eg;
  ctx.beginPath();
  ctx.arc(earthCx, earthCy, earthR, 0, Math.PI*2);
  ctx.fill();
  // مياه حول الأرض
  ctx.fillStyle = 'rgba(74,144,194,.4)';
  for(let r=earthR+5; r<earthR+45; r+=8){
    ctx.beginPath();
    ctx.ellipse(earthCx, earthCy, r, r*Math.abs(Math.cos(0))+10, 0, 0, Math.PI*2);
    // سنرسم المحيط بشكل مختلف
  }
  // المحيط - رسم بيضاوي
  const ocW = 350, ocH = 130;
  const ocX = earthCx - ocW/2;
  const ocY = earthCy - ocH/2;
  // المد (الانتفاخ) - جانبا الأرض
  ctx.fillStyle = 'rgba(74,144,194,.6)';
  ctx.beginPath();
  ctx.ellipse(earthCx, earthCy, ocW/2 + 25, ocH/2, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#4a90c2';
  ctx.lineWidth = 2;
  ctx.stroke();
  // انتفاخ المد على جانب القمر
  ctx.fillStyle = 'rgba(52,152,219,.7)';
  ctx.beginPath();
  ctx.ellipse(earthCx + 170, earthCy, 30, 20, 0, 0, Math.PI*2);
  ctx.fill();
  // انتفاخ المد على الجانب المقابل
  ctx.beginPath();
  ctx.ellipse(earthCx - 170, earthCy, 25, 15, 0, 0, Math.PI*2);
  ctx.fill();
  // القمر
  const moonX = earthCx + 200, moonY = earthCy - 30;
  const mg = ctx.createRadialGradient(moonX-8, moonY-8, 2, moonX, moonY, 25);
  mg.addColorStop(0, '#fff');
  mg.addColorStop(0.7, '#d5d8dc');
  mg.addColorStop(1, '#7f8c8d');
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(moonX, moonY, 25, 0, Math.PI*2);
  ctx.fill();
  // سهم جاذبية
  ctx.strokeStyle = '#f9d423';
  ctx.lineWidth = 3;
  ctx.setLineDash([6,4]);
  ctx.beginPath();
  ctx.moveTo(moonX, moonY);
  ctx.lineTo(earthCx, earthCy);
  ctx.stroke();
  ctx.setLineDash([]);
  // رأس السهم
  ctx.fillStyle = '#f9d423';
  const ang = Math.atan2(earthCy-moonY, earthCx-moonX);
  ctx.beginPath();
  ctx.moveTo(earthCx, earthCy);
  ctx.lineTo(earthCx - 10*Math.cos(ang - Math.PI/6), earthCy - 10*Math.sin(ang - Math.PI/6));
  ctx.lineTo(earthCx - 10*Math.cos(ang + Math.PI/6), earthCy - 10*Math.sin(ang + Math.PI/6));
  ctx.closePath();
  ctx.fill();
  // تسميات
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px Tajawal';
  ctx.textAlign = 'center';
  ctx.fillText('🌙 القمر', moonX, moonY - 35);
  ctx.fillText('🌍 الأرض', earthCx, earthCy + earthR + 20);
  __geoLabel(ctx, x+440, y+200, 'مد عالٍ (مواجه للقمر)', '#3498db', x+360, y+215);
  __geoLabel(ctx, x+440, y+250, 'مد عالٍ (جانب بعيد)', '#3498db', x+150, y+235);
  // شرح سفلي
  ctx.fillStyle = '#1a5f7a';
  ctx.fillRect(x+30, y+h-90, w-60, 70);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px Tajawal';
  ctx.textAlign = 'right';
  ctx.fillText('🌊 المد والجزر في البحرين:', x+w-40, y+h-70);
  ctx.font = '11px Tajawal';
  ctx.fillText('• يحدث مدّان وجزران كل يوم (نصف يوم تقريباً)', x+w-40, y+h-52);
  ctx.fillText('• المدّ العالي: عندما يقترب القمر من خط الزوال', x+w-40, y+h-37);
  ctx.fillText('• يؤثر على صيد الأسماك والملاحة البحرية', x+w-40, y+h-22);
  ctx.restore();
}

/* ----- 🌡️ 8) مناخ البحرين ----- */
function drawBahrainClimate(ctx, x, y){
  const w = 540, h = 380;
  ctx.save();
  __geoHeader(ctx, x, y+8, w, '🌡️ مناخ مملكة البحرين', 'صيف حار رطب - شتاء دافئ معتدل - معتدل طوال العام');
  // إطار
  ctx.strokeStyle = '#16a085';
  ctx.lineWidth = 2;
  ctx.strokeRect(x+15, y+50, w-30, h-90);
  // شريطان: الصيف والشتاء
  const cy_summer = y+90, cy_winter = y+220;
  // الصيف
  ctx.fillStyle = 'rgba(231,76,60,.15)';
  ctx.fillRect(x+25, cy_summer, w-50, 110);
  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth = 2;
  ctx.strokeRect(x+25, cy_summer, w-50, 110);
  // أيقونة الشمس
  ctx.fillStyle = '#f9d423';
  ctx.beginPath();
  ctx.arc(x+60, cy_summer+30, 18, 0, Math.PI*2);
  ctx.fill();
  for(let i=0;i<8;i++){
    const a = i * Math.PI/4;
    ctx.strokeStyle = '#f9d423';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x+60 + Math.cos(a)*24, cy_summer+30 + Math.sin(a)*24);
    ctx.lineTo(x+60 + Math.cos(a)*30, cy_summer+30 + Math.sin(a)*30);
    ctx.stroke();
  }
  // نص الصيف
  ctx.fillStyle = '#c84b31';
  ctx.font = 'bold 16px Tajawal';
  ctx.textAlign = 'right';
  ctx.fillText('☀️ الصيف (أبريل - أكتوبر)', x+w-35, cy_summer+25);
  ctx.fillStyle = '#2c3e50';
  ctx.font = '12px Tajawal';
  ctx.fillText('🌡 الحرارة: 35-45°م', x+w-35, cy_summer+50);
  ctx.fillText('💧 الرطوبة: 60-80% (عالية جداً)', x+w-35, cy_summer+68);
  ctx.fillText('🌧 المطر: نادر وقليل', x+w-35, cy_summer+86);
  ctx.fillText('☁ السماء: صافية معظم الأيام', x+w-35, cy_summer+104);
  // الشتاء
  ctx.fillStyle = 'rgba(52,152,219,.15)';
  ctx.fillRect(x+25, cy_winter, w-50, 110);
  ctx.strokeStyle = '#3498db';
  ctx.lineWidth = 2;
  ctx.strokeRect(x+25, cy_winter, w-50, 110);
  // أيقونة السحاب
  ctx.fillStyle = '#7a8a9a';
  for(let i=0;i<3;i++){
    ctx.beginPath();
    ctx.arc(x+50 + i*10, cy_winter+30 + i*2, 12, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x+72, cy_winter+25, 14, 0, Math.PI*2);
  ctx.fill();
  // مطر خفيف
  ctx.strokeStyle = '#3498db';
  ctx.lineWidth = 1.5;
  for(let i=0;i<5;i++){
    ctx.beginPath();
    ctx.moveTo(x+45+i*8, cy_winter+45);
    ctx.lineTo(x+42+i*8, cy_winter+55);
    ctx.stroke();
  }
  // نص الشتاء
  ctx.fillStyle = '#2980b9';
  ctx.font = 'bold 16px Tajawal';
  ctx.textAlign = 'right';
  ctx.fillText('🌧️ الشتاء (نوفمبر - مارس)', x+w-35, cy_winter+25);
  ctx.fillStyle = '#2c3e50';
  ctx.font = '12px Tajawal';
  ctx.fillText('🌡 الحرارة: 14-22°م (معتدل)', x+w-35, cy_winter+50);
  ctx.fillText('💧 الرطوبة: 50-70%', x+w-35, cy_winter+68);
  ctx.fillText('🌧 المطر: قصير لكن قد يكون غزيراً', x+w-35, cy_winter+86);
  ctx.fillText('🌪 رياح: شمالية غربية باردة', x+w-35, cy_winter+104);
  // ملاحظة سفلية
  ctx.fillStyle = '#0e6b5a';
  ctx.font = 'bold 12px Tajawal';
  ctx.textAlign = 'right';
  ctx.fillText('📌 البحرين تقع في المنطقة المدارية الجافة - مناخ صحراوي بحري', x+w-35, y+h-22);
  ctx.restore();
}

/* ----- المُدخل الموحد: يستدعي دالة الرسم المناسبة ----- */
function insertGeoSim(simId){
  const sim = GEO_SIMULATIONS.find(s=>s.id===simId);
  if(!sim){ toast('error','تعذّر العثور على المحاكاة'); return; }
  // احفظ الحالة قبل الرسم (للتراجع)
  saveHistory();
  // صوت إشعار مناسب
  try{ playStampSound('chime', sim.icon); }catch(e){}
  // حدد المركز
  const sizes = {
    'bahrain-map':    {w:520, h:380},
    'water-cycle':    {w:500, h:380},
    'earth-layers':   {w:460, h:460},
    'solar-system':   {w:560, h:360},
    'volcano':        {w:500, h:400},
    'earthquake':     {w:500, h:380},
    'tides':          {w:520, h:360},
    'bahrain-climate':{w:540, h:380}
  };
  const s = sizes[simId] || {w:500, h:380};
  const c = __geoCenter(s.w, s.h);
  const x = c.x, y = c.y;
  ctx.save();
  // استدع دالة الرسم المناسبة
  const drawFns = {
    'bahrain-map':    drawBahrainMap,
    'water-cycle':    drawWaterCycle,
    'earth-layers':   drawEarthLayers,
    'solar-system':   drawSolarSystem,
    'volcano':        drawVolcano,
    'earthquake':     drawEarthquake,
    'tides':          drawTides,
    'bahrain-climate':drawBahrainClimate
  };
  try{
    drawFns[simId](ctx, x, y);
  }catch(e){
    console.error('GeoSim error:', e);
    toast('error','حدث خطأ أثناء الرسم');
  }
  ctx.restore();
  // رسم متحرك (تأثير ظهور) — اختياري
  closePopups();
  toast('success', `محاكاة: ${sim.label}`);
}
/* ============================================================
   🔔 أختام تفاعلية بصوت وحركة — STAMP INTERACTIVITY ENGINE
   - كل ختم له: نوع صوت (sound) + نوع حركة دخول (anim) + لون جسيمات
   - يُستخدم Web Audio API لتوليد الأصوات بدون ملفات خارجية
   - الجسيمات: نجوم، قلوب، قصاصات، لهب، تصفيق حسب نوع الختم
   ============================================================ */
const __stampAC = { ctx: null, master: null, enabled: true };

function __stampGetAudio(){
  if(!__stampAC.enabled) return null;
  if(__stampAC.ctx){
    if(__stampAC.ctx.state === 'suspended') __stampAC.ctx.resume().catch(()=>{});
    return __stampAC.ctx;
  }
  try{
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if(!Ctx) return null;
    __stampAC.ctx = new Ctx();
    // master gain للتحكم في مستوى الصوت
    __stampAC.master = __stampAC.ctx.createGain();
    __stampAC.master.gain.value = 0.55;
    __stampAC.master.connect(__stampAC.ctx.destination);
    return __stampAC.ctx;
  }catch(e){ __stampAC.enabled = false; return null; }
}

// موجة جيبية بنغمة متصاعدة — صوت "دينغ" إيجابي
function __stampTone(ctx, master, freq, t, dur, type, peak){
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type || 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak || 0.18, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// ضربة سريعة — صوت "بوب" أو "طقطقة"
function __stampPop(ctx, master, freqStart, freqEnd, t, peak){
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freqStart, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 40), t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak || 0.22, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.22);
}

// ضوضاء مفلترة — صوت "تصفيق"
function __stampClap(ctx, master, t){
  const dur = 0.18;
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for(let i=0; i<data.length; i++){
    data[i] = (Math.random()*2-1) * Math.pow(1 - i/data.length, 1.8);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = 1800;
  filt.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.value = 0.35;
  src.connect(filt).connect(g).connect(master);
  src.start(t);
}

// صفارات — صوت إنذار/تحذير
function __stampBuzzer(ctx, master, t){
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(180, t);
  o.frequency.linearRampToValueAtTime(90, t + 0.25);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
  g.gain.linearRampToValueAtTime(0.16, t + 0.18);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.36);
}

// بوق احتفالي — صفارات قصيرة متتالية
function __stampFanfare(ctx, master, t){
  [0, 0.09, 0.18].forEach((dt, i) => {
    __stampTone(ctx, master, [659, 784, 988][i], t + dt, 0.22, 'triangle', 0.18);
  });
  // إضافة نغمة نهائية أطول
  __stampTone(ctx, master, 1318, t + 0.32, 0.5, 'sine', 0.16);
}

// سحر/بريق — رنين عالي سريع
function __stampSparkle(ctx, master, t){
  [1568, 1976, 2349, 2637].forEach((f, i) => {
    __stampTone(ctx, master, f, t + i*0.045, 0.18, 'sine', 0.1);
  });
}

// صرخة فرح — صوت ويـل
function __stampWhistle(ctx, master, t){
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(700, t);
  o.frequency.linearRampToValueAtTime(1500, t + 0.18);
  o.frequency.linearRampToValueAtTime(1100, t + 0.35);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.13, t + 0.02);
  g.gain.linearRampToValueAtTime(0.13, t + 0.28);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.46);
}

// رنين هادئ ثلاثي — أصوات دينية/روحانية
function __stampChime(ctx, master, t){
  [523, 659, 784].forEach((f, i) => {
    __stampTone(ctx, master, f, t + i*0.13, 0.65, 'sine', 0.12);
  });
}

// مشغل الصوت الرئيسي حسب نوع الختم
function playStampSound(kind, emoji){
  const ctx = __stampGetAudio();
  if(!ctx) return;
  const master = __stampAC.master;
  const t = ctx.currentTime;
  switch(kind){
    case 'positive':  // دينغ صاعد
      __stampTone(ctx, master, 880, t, 0.28, 'sine', 0.18);
      __stampTone(ctx, master, 1320, t + 0.05, 0.32, 'sine', 0.15);
      break;
    case 'negative':  // نفخة هبوط
      __stampPop(ctx, master, 240, 80, t, 0.2);
      break;
    case 'applause':  // تصفيق متعدد
      [0, 0.09, 0.18, 0.27].forEach(dt => __stampClap(ctx, master, t + dt));
      break;
    case 'chime':     // رنين هادئ
      __stampChime(ctx, master, t);
      break;
    case 'pop':       // فرقعة
      __stampPop(ctx, master, 320, 130, t, 0.2);
      break;
    case 'sparkle':   // بريق
      __stampSparkle(ctx, master, t);
      break;
    case 'whistle':   // صرخة
      __stampWhistle(ctx, master, t);
      break;
    case 'fanfare':   // بوق احتفالي
      __stampFanfare(ctx, master, t);
      break;
    case 'error':     // صفارة تحذير
      __stampBuzzer(ctx, master, t);
      break;
    default:          // نغمة افتراضية
      __stampPop(ctx, master, 500, 300, t, 0.16);
  }
}

// تصنيف كل ختم: صوت + حركة + لون + نوع جسيمات
const STAMP_CATEGORIES = {
  // === إيجابي قوي ===
  '✅':{sound:'positive', anim:'slam',    color:'#27ae60', particles:'sparkle'},
  '⭐':{sound:'positive', anim:'spin',    color:'#f9d423', particles:'sparkle'},
  '🌟':{sound:'sparkle',  anim:'spin',    color:'#f9d423', particles:'sparkle'},
  '❤️':{sound:'pop',      anim:'pulse',   color:'#e91e63', particles:'heart'},
  '🔥':{sound:'whistle',  anim:'rise',    color:'#ff6b35', particles:'fire'},
  '💯':{sound:'fanfare',  anim:'slam',    color:'#e74c3c', particles:'sparkle'},
  '👍':{sound:'pop',      anim:'bounce',  color:'#3498db', particles:'dot'},
  '🎯':{sound:'pop',      anim:'slam',    color:'#e74c3c', particles:'sparkle'},
  '💡':{sound:'sparkle',  anim:'pulse',   color:'#f9d423', particles:'sparkle'},
  '🏆':{sound:'fanfare',  anim:'bounce',  color:'#ffd700', particles:'confetti', celebrate:true},
  '🥇':{sound:'fanfare',  anim:'bounce',  color:'#ffd700', particles:'confetti', celebrate:true},
  '🥈':{sound:'fanfare',  anim:'bounce',  color:'#c0c0c0', particles:'confetti', celebrate:true},
  '🥉':{sound:'fanfare',  anim:'bounce',  color:'#cd7f32', particles:'confetti', celebrate:true},
  '🎁':{sound:'fanfare',  anim:'bounce',  color:'#e91e63', particles:'confetti', celebrate:true},
  '🌈':{sound:'sparkle',  anim:'rise',    color:'#16a085', particles:'confetti', celebrate:true},

  // === سلبي ===
  '❌':{sound:'error',    anim:'shake',   color:'#e74c3c', particles:'cross'},

  // === تشجيع وتقدير ===
  '👏':{sound:'applause', anim:'shake',   color:'#feca57', particles:'clap'},
  '🙌':{sound:'applause', anim:'rise',    color:'#feca57', particles:'sparkle'},
  '💪':{sound:'whistle',  anim:'pulse',   color:'#e74c3c', particles:'sparkle'},
  '🤲':{sound:'chime',    anim:'pulse',   color:'#16a085', particles:'dot'},

  // === تعليمي ===
  '📚':{sound:'pop',      anim:'bounce',  color:'#1a5f7a', particles:'dot'},
  '✏️':{sound:'pop',      anim:'shake',   color:'#1a5f7a', particles:'dot'},
  '📝':{sound:'pop',      anim:'slam',    color:'#1a5f7a', particles:'dot'},
  '🎓':{sound:'chime',    anim:'bounce',  color:'#1a5f7a', particles:'confetti', celebrate:true},
  '🤔':{sound:'pop',      anim:'pulse',   color:'#7a8a9a', particles:'dot'},
  '💭':{sound:'pop',      anim:'float',   color:'#7a8a9a', particles:'dot'},
  '⚡':{sound:'sparkle',  anim:'shake',   color:'#f9d423', particles:'sparkle'},
  '🎨':{sound:'pop',      anim:'spin',    color:'#e91e63', particles:'confetti'},
  '🚀':{sound:'whistle',  anim:'rise',    color:'#1a5f7a', particles:'fire'},
  '🔔':{sound:'chime',    anim:'shake',   color:'#f9d423', particles:'dot'},
  '⏰':{sound:'chime',    anim:'shake',   color:'#e74c3c', particles:'dot'},
  '📌':{sound:'pop',      anim:'slam',    color:'#e74c3c', particles:'dot'},
  '❓':{sound:'pop',      anim:'pulse',   color:'#7a8a9a', particles:'dot'},
  '❗':{sound:'whistle',  anim:'shake',   color:'#e74c3c', particles:'dot'},
  '💬':{sound:'pop',      anim:'float',   color:'#3498db', particles:'dot'},
  '📢':{sound:'whistle',  anim:'shake',   color:'#e74c3c', particles:'dot'},
  '🔍':{sound:'pop',      anim:'pulse',   color:'#1a5f7a', particles:'dot'},
  '📊':{sound:'pop',      anim:'rise',    color:'#1a5f7a', particles:'dot'},
  '📈':{sound:'positive', anim:'rise',    color:'#27ae60', particles:'sparkle'},
  '📉':{sound:'negative', anim:'shake',   color:'#e74c3c', particles:'dot'},
  '🎪':{sound:'pop',      anim:'bounce',  color:'#e91e63', particles:'confetti'},
  '🎭':{sound:'pop',      anim:'spin',    color:'#8e44ad', particles:'confetti'},
  '🎵':{sound:'chime',    anim:'float',   color:'#e91e63', particles:'dot'},
  '🎬':{sound:'pop',      anim:'bounce',  color:'#1a5f7a', particles:'dot'},

  // === علوم ===
  '🔬':{sound:'pop',      anim:'pulse',   color:'#1a5f7a', particles:'dot'},
  '🔭':{sound:'chime',    anim:'pulse',   color:'#1a5f7a', particles:'sparkle'},
  '🧪':{sound:'pop',      anim:'shake',   color:'#27ae60', particles:'dot'},
  '⚗️':{sound:'chime',    anim:'pulse',   color:'#8e44ad', particles:'dot'},
  '🧬':{sound:'chime',    anim:'spin',    color:'#1a5f7a', particles:'dot'},

  // === جغرافيا ===
  '🌍':{sound:'chime',    anim:'spin',    color:'#3498db', particles:'sparkle'},
  '🌎':{sound:'chime',    anim:'spin',    color:'#3498db', particles:'sparkle'},
  '🌏':{sound:'chime',    anim:'spin',    color:'#3498db', particles:'sparkle'},
  '🗺️':{sound:'pop',      anim:'bounce',  color:'#16a085', particles:'dot'},

  // === ثقافي وديني ===
  '🏛️':{sound:'chime',    anim:'rise',    color:'#8e44ad', particles:'dot'},
  '🕌':{sound:'chime',    anim:'pulse',   color:'#16a085', particles:'sparkle'},
  '📿':{sound:'chime',    anim:'spin',    color:'#16a085', particles:'sparkle'},
  '🕋':{sound:'chime',    anim:'rise',    color:'#1a5f7a', particles:'sparkle'},

  // === طبيعة ===
  '☀️':{sound:'chime',    anim:'pulse',   color:'#f9d423', particles:'sparkle'},
  '🌸':{sound:'pop',      anim:'float',   color:'#e91e63', particles:'petal'},
  '🌺':{sound:'pop',      anim:'float',   color:'#e91e63', particles:'petal'},
  '🌻':{sound:'pop',      anim:'float',   color:'#f9d423', particles:'petal'},
  '🌷':{sound:'pop',      anim:'float',   color:'#e91e63', particles:'petal'},
  '🌹':{sound:'pop',      anim:'float',   color:'#e74c3c', particles:'petal'},
  '🌼':{sound:'pop',      anim:'float',   color:'#f9d423', particles:'petal'},
  '💐':{sound:'chime',    anim:'rise',    color:'#e91e63', particles:'petal', celebrate:true},
  '🌿':{sound:'pop',      anim:'float',   color:'#27ae60', particles:'petal'},
  '🍃':{sound:'pop',      anim:'float',   color:'#27ae60', particles:'petal'},
  '🌱':{sound:'pop',      anim:'rise',    color:'#27ae60', particles:'dot'},
  '🌳':{sound:'pop',      anim:'bounce',  color:'#27ae60', particles:'leaf'},
  '🌴':{sound:'pop',      anim:'bounce',  color:'#27ae60', particles:'leaf'},
  '🌵':{sound:'pop',      anim:'pulse',   color:'#27ae60', particles:'dot'},
  '🍀':{sound:'sparkle',  anim:'float',   color:'#27ae60', particles:'sparkle'},
  '🌙':{sound:'chime',    anim:'pulse',   color:'#3498db', particles:'sparkle'},
  '⛅':{sound:'chime',    anim:'rise',    color:'#3498db', particles:'sparkle'},
  '☁️':{sound:'pop',      anim:'float',   color:'#7a8a9a', particles:'dot'},
  '🌧️':{sound:'pop',      anim:'drop',    color:'#3498db', particles:'rain'},
  '⛈️':{sound:'whistle',  anim:'shake',   color:'#7a8a9a', particles:'rain'},
  '❄️':{sound:'sparkle',  anim:'float',   color:'#3498db', particles:'snow'},
  '✨':{sound:'sparkle',  anim:'wiggle',  color:'#f9d423', particles:'sparkle'},

  // === وجوه وإيموجي ===
  '😊':{sound:'pop',      anim:'pulse',   color:'#f9d423', particles:'sparkle'},
  '😍':{sound:'positive', anim:'pulse',   color:'#e91e63', particles:'heart'},
  '🤩':{sound:'sparkle',  anim:'spin',    color:'#f9d423', particles:'sparkle'},
  '😎':{sound:'pop',      anim:'bounce',  color:'#3498db', particles:'dot'},
  '🥰':{sound:'positive', anim:'pulse',   color:'#e91e63', particles:'heart'},
  '😇':{sound:'chime',    anim:'float',   color:'#f9d423', particles:'sparkle'},
  '🤓':{sound:'pop',      anim:'bounce',  color:'#1a5f7a', particles:'dot'},
  '🧐':{sound:'pop',      anim:'pulse',   color:'#7a8a9a', particles:'dot'},
  '😋':{sound:'pop',      anim:'bounce',  color:'#f9d423', particles:'dot'},
  '😜':{sound:'whistle',  anim:'wiggle',  color:'#e91e63', particles:'dot'},
  '🤪':{sound:'whistle',  anim:'wiggle',  color:'#8e44ad', particles:'sparkle'},
  '😏':{sound:'pop',      anim:'bounce',  color:'#7a8a9a', particles:'dot'},
  '😐':{sound:'pop',      anim:'pulse',   color:'#7a8a9a', particles:'dot'},
  '😶':{sound:'pop',      anim:'pulse',   color:'#7a8a9a', particles:'dot'},
  '🙄':{sound:'pop',      anim:'wiggle',  color:'#7a8a9a', particles:'dot'},
  '😬':{sound:'pop',      anim:'shake',   color:'#f9d423', particles:'dot'},
  '😌':{sound:'chime',    anim:'float',   color:'#7a8a9a', particles:'sparkle'},
  '😔':{sound:'negative', anim:'drop',    color:'#3498db', particles:'rain'},
  '😪':{sound:'negative', anim:'drop',    color:'#7a8a9a', particles:'dot'},
  '😭':{sound:'negative', anim:'drop',    color:'#3498db', particles:'rain'},
  '😡':{sound:'error',    anim:'shake',   color:'#e74c3c', particles:'cross'},
  '🤬':{sound:'error',    anim:'shake',   color:'#e74c3c', particles:'cross'},
  '😱':{sound:'whistle',  anim:'shake',   color:'#f9d423', particles:'sparkle'},
  '🥺':{sound:'chime',    anim:'pulse',   color:'#3498db', particles:'heart'},
  '😈':{sound:'error',    anim:'shake',   color:'#8e44ad', particles:'sparkle'},
  '👻':{sound:'whistle',  anim:'float',   color:'#7a8a9a', particles:'sparkle'},
  '🤖':{sound:'sparkle',  anim:'bounce',  color:'#3498db', particles:'dot'},

  // === قلوب ===
  '🧡':{sound:'positive', anim:'pulse',   color:'#ff6b35', particles:'heart'},
  '💛':{sound:'positive', anim:'pulse',   color:'#f9d423', particles:'heart'},
  '💚':{sound:'positive', anim:'pulse',   color:'#27ae60', particles:'heart'},
  '💙':{sound:'positive', anim:'pulse',   color:'#3498db', particles:'heart'},
  '💜':{sound:'positive', anim:'pulse',   color:'#8e44ad', particles:'heart'},
  '🖤':{sound:'negative', anim:'pulse',   color:'#2c3e50', particles:'heart'},
  '🤍':{sound:'chime',    anim:'pulse',   color:'#ecf0f1', particles:'heart'},
  '💔':{sound:'negative', anim:'shake',   color:'#e74c3c', particles:'heart'},
  '💕':{sound:'positive', anim:'pulse',   color:'#e91e63', particles:'heart', celebrate:true},
  '💞':{sound:'positive', anim:'pulse',   color:'#e91e63', particles:'heart', celebrate:true},
  '💓':{sound:'positive', anim:'pulse',   color:'#e91e63', particles:'heart'},
  '💗':{sound:'positive', anim:'pulse',   color:'#e91e63', particles:'heart'},
  '💖':{sound:'positive', anim:'pulse',   color:'#e91e63', particles:'heart', celebrate:true},
  '💘':{sound:'chime',    anim:'pulse',   color:'#e91e63', particles:'heart'},
  '💝':{sound:'chime',    anim:'pulse',   color:'#e91e63', particles:'heart'},
  '💟':{sound:'chime',    anim:'pulse',   color:'#e74c3c', particles:'heart'},

  // === احتفاليات ===
  '🎉':{sound:'fanfare',  anim:'bounce',  color:'#e91e63', particles:'confetti', celebrate:true},
  '🎊':{sound:'fanfare',  anim:'bounce',  color:'#f9d423', particles:'confetti', celebrate:true},
  '🎈':{sound:'pop',      anim:'rise',    color:'#e91e63', particles:'confetti', celebrate:true},
};
const STAMP_DEFAULT = {sound:'pop', anim:'slam', color:'#1a5f7a', particles:'sparkle'};
const getStampMeta = (em) => STAMP_CATEGORIES[em] || STAMP_DEFAULT;

// حاوية حركات الأختام — تُنشأ مرة واحدة عند أول استخدام
let __stampHost = null;
function __getStampHost(){
  if(__stampHost && __stampHost.isConnected) return __stampHost;
  __stampHost = document.createElement('div');
  __stampHost.className = 'stamp-anim-host';
  document.body.appendChild(__stampHost);
  return __stampHost;
}

// إيموجي الجسيمات حسب النوع
const __PARTICLE_EMOJIS = {
  sparkle:  ['✦','✧','⋆','✩'],
  heart:    ['❤','💕','💗'],
  fire:     ['🔥','✨'],
  confetti: null,   // يستخدم ألوان وأشكال مستطيلة
  dot:      null,   // نقاط دائرية
  cross:    ['✕','✖'],
  clap:     ['👏','✨'],
  rain:     ['💧','•'],
  snow:     ['❄','✻'],
  petal:    ['✿','❀','❁'],
  leaf:     ['🍃','✿'],
};

// إطلاق جسيمات من موضع معين
function __spawnStampParticles(x, y, color, kind, count){
  count = count || 12;
  const host = __getStampHost();
  const emojis = __PARTICLE_EMOJIS[kind];
  const palette = ['#e91e63','#3498db','#f9d423','#27ae60','#8e44ad','#feca57','#ff6b35','#1abc9c','#ff4757','#5f27cd'];
  for(let i=0; i<count; i++){
    const p = document.createElement('div');
    p.className = 'stamp-particle';
    p.style.left = (x - 4) + 'px';
    p.style.top  = (y - 4) + 'px';
    p.style.color = color;
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 60 + Math.random() * 70;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist - 20;   // ميل للأعلى قليلاً
    const dur = 650 + Math.random() * 350;
    const size = 6 + Math.random() * 8;

    if(kind === 'confetti'){
      p.classList.add('confetti');
      p.style.background = palette[Math.floor(Math.random()*palette.length)];
      p.style.boxShadow = '0 0 6px ' + p.style.background;
    } else if(kind === 'dot'){
      p.classList.add('dot');
      p.style.background = color;
      p.style.boxShadow = '0 0 6px ' + color;
      p.style.width = size + 'px';
      p.style.height = size + 'px';
    } else if(emojis){
      // جسيم إيموجي
      p.style.background = 'transparent';
      p.style.boxShadow = 'none';
      p.style.fontSize = (12 + Math.random()*8) + 'px';
      p.textContent = emojis[Math.floor(Math.random()*emojis.length)];
    } else {
      p.style.background = color;
      p.style.boxShadow = '0 0 6px ' + color;
      p.style.width = size + 'px';
      p.style.height = size + 'px';
    }

    p.style.transition = `transform ${dur}ms cubic-bezier(.22,.61,.36,1), opacity ${dur}ms ease-out`;
    host.appendChild(p);

    requestAnimationFrame(() => {
      p.style.transform = `translate(${tx}px, ${ty}px) rotate(${Math.random()*540 - 270}deg) scale(${0.3 + Math.random()*0.6})`;
      p.style.opacity = '0';
    });
    setTimeout(() => p.remove(), dur + 60);
  }
}

// عرض إيموجي الختم مع حركة الدخول فوق الكانفس
function __showStampAnim(x, y, emoji, animName, color){
  const host = __getStampHost();
  const wrap = document.createElement('div');
  wrap.className = 'stamp-anim';
  wrap.dataset.anim = animName || 'slam';
  wrap.style.color = color;
  const half = 40;  // نصف عرض الإيموجي
  wrap.style.left = (x - half) + 'px';
  wrap.style.top  = (y - half) + 'px';
  wrap.style.width  = (half*2) + 'px';
  wrap.style.height = (half*2) + 'px';

  const ring = document.createElement('div');
  ring.className = 'sa-ring';
  wrap.appendChild(ring);

  const e = document.createElement('div');
  e.className = 'sa-emoji';
  e.textContent = emoji;
  wrap.appendChild(e);

  host.appendChild(wrap);
  const dur = {slam:550, bounce:700, spin:800, rise:850, pop:500, shake:600, pulse:750, float:900, drop:650, wiggle:700}[animName] || 600;
  setTimeout(() => { if(wrap.isConnected) wrap.remove(); }, dur + 50);
}

// إطلاق احتفال مصغر (قصاصات + تصفيق) للأختام الاحتفالية
function __stampMiniCelebrate(emoji, color){
  try{
    // قصاصات ملونة
    if(typeof launchConfettiRain === 'function'){
      launchConfettiRain();
    } else {
      const host = document.getElementById('confettiRainHost') || (() => {
        const h = document.createElement('div');
        h.id = 'confettiRainHost';
        h.className = 'confetti-rain-host';
        document.body.appendChild(h);
        return h;
      })();
      for(let i=0; i<30; i++){
        const c = document.createElement('div');
        c.className = 'confetti-piece';
        c.style.left = (Math.random() * 100) + 'vw';
        const colors = ['#ff3b3b','#ffaa00','#3bff6e','#3bbcff','#ff3bd4','#fff700','#9b59ff'];
        c.style.background = colors[Math.floor(Math.random()*colors.length)];
        c.style.setProperty('--sway', (Math.random()*100-50) + 'px');
        c.style.setProperty('--rot', (Math.random()*720) + 'deg');
        c.style.setProperty('--dur', (2.5 + Math.random()*1.5) + 's');
        c.style.animationDelay = (Math.random() * 0.4) + 's';
        host.appendChild(c);
        setTimeout(() => c.remove(), 4500);
      }
    }
    // تصفيق إذا كان متاحاً
    if(typeof launchApplause === 'function' && Math.random() > 0.4){
      launchApplause();
    }
  }catch(e){}
}

/* ============================================================
   placeStamp() — النسخة التفاعلية
   - عند الضغط على ختم في اللوحة: صوت + حركة دخول + جسيمات + رسم على السبورة
   - تأخير طفيف قبل الرسم ليُشاهد المستخدم الحركة كاملة
   - يحفظ الحالة في التاريخ (saveHistory) ليعمل التراجع
   ============================================================ */
function placeStamp(emoji, btn){
  const meta = getStampMeta(emoji);

  // 1) رد فعل بصري على الزر
  try{
    const b = btn || (event && event.currentTarget) || null;
    if(b){
      b.classList.remove('placing');      // لإعادة تشغيل الحركة لو ضغطنا مرتين
      void b.offsetWidth;
      b.classList.add('placing');
      setTimeout(() => b.classList.remove('placing'), 420);
    }
  }catch(e){}

  // 2) صوت مناسب لنوع الختم
  playStampSound(meta.sound, emoji);

  // 3) موضع مركز الكانفس
  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top  + rect.height / 2;

  // 4) حركة دخول + جسيمات
  __showStampAnim(cx, cy, emoji, meta.anim, meta.color);
  const particleDelay = 80;
  setTimeout(() => __spawnStampParticles(cx, cy, meta.color, meta.particles, 14), particleDelay);

  // 5) احتفال مصغر للأختام الاحتفالية
  if(meta.celebrate){
    setTimeout(() => __stampMiniCelebrate(emoji, meta.color), 350);
  }

  // 6) رسم الختم على الكانفس بعد انتهاء جزء من الحركة (يبقى متزامناً بصرياً)
  const drawDelay = ({slam:380, shake:380, bounce:520, spin:560, rise:600, pop:340, pulse:520, float:620, drop:480, wiggle:500})[meta.anim] || 420;
  setTimeout(() => {
    const x = canvas.width/2/(window.devicePixelRatio||1) - 50;
    const y = canvas.height/2/(window.devicePixelRatio||1) - 50;
    ctx.save();
    ctx.font = '80px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(emoji, x, y);
    ctx.restore();
    saveHistory();
  }, drawDelay);

  // 7) إغلاق اللوحة وإشعار
  setTimeout(() => closePopups(), 80);
  toast('success', `تم إضافة الختم ${emoji}`);
}

/* تبديل الصوت — مُزامَن مع زر الواجهة */
function __toggleStampSound(){
  __stampAC.enabled = !__stampAC.enabled;
  const icon = document.getElementById('stampSoundIcon');
  const label = document.getElementById('stampSoundLabel');
  const btn = document.getElementById('stampSoundToggle');
  if(__stampAC.enabled){
    if(icon) icon.className = 'fas fa-volume-up';
    if(label) label.textContent = 'الصوت مُفعّل';
    if(btn){
      btn.style.background = 'linear-gradient(135deg,#27ae60,#16a085)';
      btn.style.boxShadow = '0 2px 8px rgba(39,174,96,.35)';
    }
    try{ playStampSound('pop', '🔊'); }catch(e){}
  } else {
    if(icon) icon.className = 'fas fa-volume-mute';
    if(label) label.textContent = 'الصوت مُكتوم';
    if(btn){
      btn.style.background = 'linear-gradient(135deg,#7a8a9a,#5a6a7a)';
      btn.style.boxShadow = '0 2px 8px rgba(122,138,154,.3)';
    }
  }
  try{ localStorage.setItem('__stampSoundOn', __stampAC.enabled ? '1' : '0'); }catch(e){}
}

/* تهيئة حالة الصوت من التخزين + ربط hover preview */
function __initStampSound(){
  try{
    const saved = localStorage.getItem('__stampSoundOn');
    if(saved === '0'){
      __stampAC.enabled = false;
      const icon = document.getElementById('stampSoundIcon');
      const label = document.getElementById('stampSoundLabel');
      const btn = document.getElementById('stampSoundToggle');
      if(icon) icon.className = 'fas fa-volume-mute';
      if(label) label.textContent = 'الصوت مُكتوم';
      if(btn){
        btn.style.background = 'linear-gradient(135deg,#7a8a9a,#5a6a7a)';
        btn.style.boxShadow = '0 2px 8px rgba(122,138,154,.3)';
      }
    }
  }catch(e){}
  // صوت معاينة سريع عند المرور على الأزرار
  document.addEventListener('mouseover', (e) => {
    const b = e.target.closest && e.target.closest('.stamp-btn');
    if(!b || !__stampAC.enabled) return;
    if(b.dataset.__hovered === '1') return;
    b.dataset.__hovered = '1';
    setTimeout(() => { try{ b.dataset.__hovered = '0'; }catch(e){} }, 180);
    try{
      const ctx = __stampGetAudio();
      if(!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(880, t);
      o.frequency.exponentialRampToValueAtTime(1320, t + 0.06);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(__stampAC.master);
      o.start(t);
      o.stop(t + 0.15);
    }catch(e){}
  });
}

/* ============================================================
   SELECT TOOL - محرك التحديد والتحريك
   - التقاط المنطقة المختارة من الكانفس
   - رسم/تحديث إطار التحديد + لوحة الإجراءات
   - رفع/لصق/حذف/نسخ/تكرار التحديد
   ============================================================ */
let _selBoxEl=null,_selActionsEl=null;

function pointInSel(x,y){
  if(!State.sel.active)return false;
  const s=State.sel;
  return x>=s.x && x<=s.x+s.w && y>=s.y && y<=s.y+s.h;
}

/* فحص هل النقطة على محتوى مرسوم (مش خلفية بيضاء) */
function isPixelContent(px,py){
  const dpr=window.devicePixelRatio||1;
  const w=canvas.width, h=canvas.height;
  const x=Math.round(px*dpr), y=Math.round(py*dpr);
  if(x<0||y<0||x>=w||y>=h)return false;
  try{
    const data=ctx.getImageData(x,y,1,1).data;
    const a=data[3];
    if(a===0)return false;
    const r=data[0],g=data[1],b=data[2];
    return !(r>240 && g>240 && b>240);
  }catch(e){return false;}
}

/* البحث عن حدود العنصر بالنقر فوقه (auto-detect)
   - يستخدم "growing box": يبدأ بمربع صغير ويمدد كل اتجاه حتى يوصل لحواف بيضاء
   - سريع حتى على كانفس كبير */
function findObjectBounds(px,py){
  const dpr=window.devicePixelRatio||1;
  const w=canvas.width, h=canvas.height;
  const cx=Math.round(px*dpr), cy=Math.round(py*dpr);
  if(cx<0||cy<0||cx>=w||cy>=h)return null;

  let imgData;
  try{imgData=ctx.getImageData(0,0,w,h);}catch(e){return null;}
  const data=imgData.data;

  function isBg(idx){
    if(idx<0||idx>=data.length)return true;
    const a=data[idx+3];
    if(a===0)return true;
    const r=data[idx],g=data[idx+1],b=data[idx+2];
    return r>240 && g>240 && b>240;
  }

  if(isBg((cy*w+cx)*4))return null;

  // Growing box
  let minX=cx,maxX=cx,minY=cy,maxY=cy;
  let changed=true;
  let iter=0;
  const maxIter=80;

  while(changed && iter<maxIter){
    changed=false;
    iter++;
    if(minY>0){
      let has=false;
      for(let x=minX;x<=maxX;x++){if(!isBg(((minY-1)*w+x)*4)){has=true;break;}}
      if(has){minY--;changed=true;}
    }
    if(maxY<h-1){
      let has=false;
      for(let x=minX;x<=maxX;x++){if(!isBg(((maxY+1)*w+x)*4)){has=true;break;}}
      if(has){maxY++;changed=true;}
    }
    if(minX>0){
      let has=false;
      for(let y=minY;y<=maxY;y++){if(!isBg((y*w+(minX-1))*4)){has=true;break;}}
      if(has){minX--;changed=true;}
    }
    if(maxX<w-1){
      let has=false;
      for(let y=minY;y<=maxY;y++){if(!isBg((y*w+(maxX+1))*4)){has=true;break;}}
      if(has){maxX++;changed=true;}
    }
  }

  const boxW=maxX-minX, boxH=maxY-minY;
  if(boxW>h*0.7 || boxH>h*0.7)return null;

  const pad=Math.round(6*dpr);
  const rx=Math.max(0,minX-pad);
  const ry=Math.max(0,minY-pad);
  const rw=Math.min(w,maxX+pad)-rx;
  const rh=Math.min(h,maxY+pad)-ry;
  if(rw<4||rh<4)return null;

  return {x:rx/dpr, y:ry/dpr, w:rw/dpr, h:rh/dpr};
}

function captureSelection(){
  const s=State.sel;
  if(!s.w||!s.h)return;
  const dpr=window.devicePixelRatio||1;
  // خزّن المنطقة في canvas مؤقت
  const tmp=document.createElement('canvas');
  tmp.width=Math.max(1,Math.round(s.w*dpr));
  tmp.height=Math.max(1,Math.round(s.h*dpr));
  const tctx=tmp.getContext('2d');
  tctx.drawImage(canvas,Math.round(s.x*dpr),Math.round(s.y*dpr),tmp.width,tmp.height,0,0,tmp.width,tmp.height);
  s.data=tmp;
  s.floatW=s.w; s.floatH=s.h;
}

function liftSelection(){
  // امسح المنطقة من الكانفس (الخلفية CSS ستظهر من تحتها)
  const s=State.sel;
  if(!s.data)return;
  const dpr=window.devicePixelRatio||1;
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(Math.round(s.x*dpr),Math.round(s.y*dpr),Math.round(s.w*dpr),Math.round(s.h*dpr));
  ctx.restore();
}

function drawSelectionBox(){
  // احذف القديم
  if(_selBoxEl){_selBoxEl.remove();_selBoxEl=null;}
  if(_selActionsEl){_selActionsEl.remove();_selActionsEl=null;}
  if(!State.sel.active)return;
  const s=State.sel;
  // الإطار
  const box=document.createElement('div');
  box.className='select-box';
  box.style.left=s.x+'px';
  box.style.top=s.y+'px';
  box.style.width=s.w+'px';
  box.style.height=s.h+'px';
  // 8 مقابض
  const dirs=['nw','n','ne','e','se','s','sw','w'];
  dirs.forEach(d=>{
    const h=document.createElement('div');
    h.className='sb-handle h-'+d;
    h.dataset.dir=d;
    h.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();startResize(d,e);});
    h.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();const t=e.touches[0];startResize(d,{clientX:t.clientX,clientY:t.clientY});},{passive:false});
    box.appendChild(h);
  });
  // حجم التحديد
  const size=document.createElement('div');
  size.className='sb-size';
  size.textContent=`${Math.round(s.w)} × ${Math.round(s.h)}`;
  box.appendChild(size);
  canvasWrap.appendChild(box);
  _selBoxEl=box;
  // لوحة الإجراءات
  const act=document.createElement('div');
  act.className='select-actions';
  act.style.left=(s.x+s.w/2)+'px';
  act.style.top=(s.y-44)+'px';
  act.innerHTML=`
    <button class="sa-copy" onclick="copySelection()" title="نسخ"><i class="fas fa-copy"></i><span class="sa-tip">نسخ</span></button>
    <button class="sa-flip" onclick="duplicateSelection()" title="تكرار"><i class="fas fa-clone"></i><span class="sa-tip">تكرار</span></button>
    <button onclick="moveSelectionBy(0,-20)" title="أعلى"><i class="fas fa-arrow-up"></i><span class="sa-tip">أعلى</span></button>
    <button onclick="moveSelectionBy(0,20)" title="أسفل"><i class="fas fa-arrow-down"></i><span class="sa-tip">أسفل</span></button>
    <button onclick="moveSelectionBy(-20,0)" title="يسار"><i class="fas fa-arrow-left"></i><span class="sa-tip">يسار</span></button>
    <button onclick="moveSelectionBy(20,0)" title="يمين"><i class="fas fa-arrow-right"></i><span class="sa-tip">يمين</span></button>
    <button onclick="flipSelectionH()" title="انعكاس أفقي"><i class="fas fa-arrows-alt-h"></i><span class="sa-tip">انعكاس ↔</span></button>
    <button class="sa-del" onclick="deleteSelection()" title="احذفي"><i class="fas fa-trash"></i><span class="sa-tip">احذفي</span></button>
    <button onclick="clearSelection()" title="إلغاء التحديد"><i class="fas fa-times"></i><span class="sa-tip">إلغاء</span></button>
  `;
  // إيقاف الـ propagation حتى لا تلتقطه كانفس
  act.addEventListener('mousedown',e=>e.stopPropagation());
  act.addEventListener('click',e=>e.stopPropagation());
  act.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
  canvasWrap.appendChild(act);
  _selActionsEl=act;
}

function updateSelectMode(){
  canvas.classList.toggle('has-selection',State.sel.active);
}

function commitSelection(){
  // ثبّت التحديد الحالي (لو فيه float، ثبّته)
  if(State.sel.hasFloat && State.sel.data){
    State.sel.x=State.sel.floatX;
    State.sel.y=State.sel.floatY;
    State.sel.hasFloat=false;
  }
  // التحديد يظل محدداً لكن نعيد رسم الإطار
  drawSelectionBox();
}

function clearSelection(){
  // التزم ما تم (commit) أولاً
  if(State.sel.hasFloat && State.sel.data){
    // ارسم في مكانه النهائي
    const dpr=window.devicePixelRatio||1;
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    ctx.drawImage(State.sel.data,State.sel.floatX*dpr,State.sel.floatY*dpr,State.sel.floatW*dpr,State.sel.floatH*dpr);
    ctx.restore();
    State.sel.hasFloat=false;
  }
  // صفّر التحديد
  State.sel.active=false;
  State.sel.data=null;
  State.sel.dragging=false;
  State.sel.hasFloat=false;
  State.sel.x=State.sel.y=State.sel.w=State.sel.h=0;
  if(_selBoxEl){_selBoxEl.remove();_selBoxEl=null;}
  if(_selActionsEl){_selActionsEl.remove();_selActionsEl=null;}
  if(_selMarquee){_selMarquee.remove();_selMarquee=null;}
  if(typeof hideSelectHover==='function')hideSelectHover();
  updateSelectMode();
}

function copySelection(){
  if(!State.sel.data){
    if(!State.sel.active||!State.sel.w)return;
    captureSelection();
  }
  // خزّن نسخة في الـ clipboard
  const src=State.sel.data;
  const copy=document.createElement('canvas');
  copy.width=src.width;copy.height=src.height;
  copy.getContext('2d').drawImage(src,0,0);
  State.sel.clipboard=copy;
  toast('success','✓ تم نسخ التحديد');
}

function duplicateSelection(){
  if(!State.sel.data){
    if(!State.sel.active||!State.sel.w)return;
    captureSelection();
  }
  // ثبّت التحديد الحالي إن كان مرفوعاً
  if(State.sel.hasFloat){
    pasteFloatingSelection();
  }
  // أنشئ نسخة جديدة في موضع التحديد + إزاحة
  const dpr=window.devicePixelRatio||1;
  const offset=20;
  // أولاً: ارسم النسخة الجديدة في الموقع الجديد
  const newX=State.sel.x+offset;
  const newY=State.sel.y+offset;
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  ctx.drawImage(State.sel.data,newX*dpr,newY*dpr,State.sel.w*dpr,State.sel.h*dpr);
  ctx.restore();
  // ثانياً: حدّث التحديد ليشير للنسخة الجديدة
  State.sel.x=newX;State.sel.y=newY;
  // أعد التقاط بيانات النسخة الجديدة
  captureSelection();
  drawSelectionBox();
  saveHistory();
  toast('success','✓ تم التكرار');
}

function deleteSelection(){
  if(!State.sel.active)return;
  // إذا كان مرفوعاً: ببساطة امسح (الكانفس أصلاً ممسوح تحته)
  if(State.sel.hasFloat){
    // المنطقة أصلاً ممسوحة من الكانفس
  } else {
    // لو ما كان مرفوعاً، امسح المنطقة
    const dpr=window.devicePixelRatio||1;
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(Math.round(State.sel.x*dpr),Math.round(State.sel.y*dpr),Math.round(State.sel.w*dpr),Math.round(State.sel.h*dpr));
    ctx.restore();
  }
  // صفّر التحديد
  State.sel.active=false;State.sel.data=null;State.sel.hasFloat=false;
  if(_selBoxEl){_selBoxEl.remove();_selBoxEl=null;}
  if(_selActionsEl){_selActionsEl.remove();_selActionsEl=null;}
  updateSelectMode();
  saveHistory();
  toast('warning','تم الاحذفي');
}

function pasteFloatingSelection(){
  if(!State.sel.hasFloat||!State.sel.data)return;
  // ارسم التحديد العائم في مكانه النهائي
  const dpr=window.devicePixelRatio||1;
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  ctx.drawImage(State.sel.data,State.sel.floatX*dpr,State.sel.floatY*dpr,State.sel.floatW*dpr,State.sel.floatH*dpr);
  ctx.restore();
  // حدّث موقع التحديد الثابت
  State.sel.x=State.sel.floatX;
  State.sel.y=State.sel.floatY;
  State.sel.hasFloat=false;
}

function moveSelectionBy(dx,dy){
  if(!State.sel.active)return;
  // ارفع أولاً
  if(!State.sel.data)captureSelection();
  if(!State.sel.hasFloat){
    liftSelection();
    State.sel.floatX=State.sel.x;
    State.sel.floatY=State.sel.y;
    State.sel.lastDrawX=State.sel.x;
    State.sel.lastDrawY=State.sel.y;
    State.sel.hasFloat=true;
  }
  // امسح الموقع السابق
  const dpr=window.devicePixelRatio||1;
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(State.sel.lastDrawX*dpr,State.sel.lastDrawY*dpr,State.sel.floatW*dpr,State.sel.floatH*dpr);
  // ارسم في الموقع الجديد
  const nx=State.sel.floatX+dx,ny=State.sel.floatY+dy;
  ctx.drawImage(State.sel.data,nx*dpr,ny*dpr,State.sel.floatW*dpr,State.sel.floatH*dpr);
  ctx.restore();
  State.sel.floatX=nx;State.sel.floatY=ny;
  State.sel.lastDrawX=nx;State.sel.lastDrawY=ny;
  State.sel.x=nx;State.sel.y=ny;
  drawSelectionBox();
  saveHistory();
}

function flipSelectionH(){
  if(!State.sel.active)return;
  if(!State.sel.data)captureSelection();
  // اقلب الصورة
  const src=State.sel.data;
  const tmp=document.createElement('canvas');
  tmp.width=src.width;tmp.height=src.height;
  const tctx=tmp.getContext('2d');
  tctx.translate(src.width,0);
  tctx.scale(-1,1);
  tctx.drawImage(src,0,0);
  State.sel.data=tmp;
  // أعد رسمه في مكانه (لو مرفوع نمسح ثم نرسم)
  const dpr=window.devicePixelRatio||1;
  if(State.sel.hasFloat){
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(State.sel.lastDrawX*dpr,State.sel.lastDrawY*dpr,State.sel.floatW*dpr,State.sel.floatH*dpr);
    ctx.drawImage(tmp,State.sel.floatX*dpr,State.sel.floatY*dpr,State.sel.floatW*dpr,State.sel.floatH*dpr);
    ctx.restore();
  } else {
    // ثبّت ثم أعد الرسم
    liftSelection();
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    ctx.drawImage(tmp,State.sel.x*dpr,State.sel.y*dpr,State.sel.w*dpr,State.sel.h*dpr);
    ctx.restore();
    State.sel.hasFloat=true;
    State.sel.floatX=State.sel.x;State.sel.floatY=State.sel.y;
    State.sel.lastDrawX=State.sel.x;State.sel.lastDrawY=State.sel.y;
  }
  drawSelectionBox();
  saveHistory();
  toast('success','✓ تم الانعكاس');
}

function pasteClipboardAt(x,y){
  if(!State.sel.clipboard)return;
  const dpr=window.devicePixelRatio||1;
  const w=State.sel.clipboard.width/dpr;
  const h=State.sel.clipboard.height/dpr;
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  ctx.drawImage(State.sel.clipboard,x*dpr,y*dpr,w*dpr,h*dpr);
  ctx.restore();
  // أنشئ تحديداً جديداً للنسخة الملصوقة
  if(State.sel.active)clearSelection();
  State.sel.x=x;State.sel.y=y;State.sel.w=w;State.sel.h=h;
  State.sel.active=true;
  captureSelection();
  drawSelectionBox();
  saveHistory();
  toast('success','✓ تم اللصق');
}

/* تحديد كل السبورة */
function selectAll(){
  if(State.tool!=='select')setTool('select');
  clearSelection();
  const dpr=window.devicePixelRatio||1;
  const w=canvas.width/dpr, h=canvas.height/dpr;
  State.sel.x=0;State.sel.y=0;State.sel.w=w;State.sel.h=h;
  State.sel.active=true;
  captureSelection();
  drawSelectionBox();
  updateSelectMode();
  toast('info','✓ تم تحديد كل السبورة');
}

/* تغيير حجم التحديد (سحب المقابض) */
function startResize(dir,e){
  if(!State.sel.active)return;
  if(!State.sel.data)captureSelection();
  // تأكد أن التحديد مرفوع (نرسم نسخة عند التحجيم)
  if(!State.sel.hasFloat){
    liftSelection();
    State.sel.hasFloat=true;
    State.sel.floatX=State.sel.x;State.sel.floatY=State.sel.y;
    State.sel.floatW=State.sel.w;State.sel.floatH=State.sel.h;
    State.sel.lastDrawX=State.sel.x;State.sel.lastDrawY=State.sel.y;
  }
  const startMouse=getPos(e);
  State.sel.resizing=true;
  State.sel.resizeDir=dir;
  State.sel.resizeStart={mx:startMouse.x,my:startMouse.y,ox:State.sel.x,oy:State.sel.y,ow:State.sel.w,oh:State.sel.h,fx:State.sel.floatX,fy:State.sel.floatY,fw:State.sel.floatW,fh:State.sel.floatH};
  document.addEventListener('mousemove',doResize);
  document.addEventListener('mouseup',endResize);
  document.addEventListener('touchmove',e=>{e.preventDefault();const t=e.touches[0];doResize({clientX:t.clientX,clientY:t.clientY});},{passive:false});
  document.addEventListener('touchend',endResize);
  e.preventDefault();
}

function doResize(e){
  if(!State.sel.resizing)return;
  const{x,y}=getPos(e);
  const s=State.sel.resizeStart;
  const dpr=window.devicePixelRatio||1;
  const dx=x-s.mx,dy=y-s.my;
  let nx=s.ox,ny=s.oy,nw=s.ow,nh=s.oh;
  const dir=State.sel.resizeDir;
  // حساب الإحداثيات/الحجم الجديد حسب المقبض
  if(dir.includes('e'))nw=Math.max(8,s.ow+dx);
  if(dir.includes('s'))nh=Math.max(8,s.oh+dy);
  if(dir.includes('w')){nw=Math.max(8,s.ow-dx);nx=s.ox+(s.ow-nw);}
  if(dir.includes('n')){nh=Math.max(8,s.oh-dy);ny=s.oy+(s.oh-nh);}

  // امسح الموقع السابق وارسم في الجديد
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(s.ox*dpr,s.oy*dpr,s.ow*dpr,s.oh*dpr);
  ctx.drawImage(State.sel.data,nx*dpr,ny*dpr,nw*dpr,nh*dpr);
  ctx.restore();

  // حدّث الحالة
  State.sel.x=nx;State.sel.y=ny;State.sel.w=nw;State.sel.h=nh;
  State.sel.floatX=nx;State.sel.floatY=ny;State.sel.floatW=nw;State.sel.floatH=nh;
  drawSelectionBox();
}

function endResize(){
  if(!State.sel.resizing)return;
  State.sel.resizing=false;State.sel.resizeDir=null;
  document.removeEventListener('mousemove',doResize);
  document.removeEventListener('mouseup',endResize);
  document.removeEventListener('touchmove',doResize);
  document.removeEventListener('touchend',endResize);
  saveHistory();
}

/* STICKY NOTES — يدعم السحب من أي مكان، منتقي لون مخصص، إضافة عدد غير محدود */
let noteZ=1;

/* makeDraggable: تفعيل السحب بالماوس واللمس على أي عنصر.
   - يحوّل من transform إلى left/top صريحين لتجنّب تعارض الدوران.
   - يستثني منطقة الكتابة (.sn-content) ومقابض التحكم حتى يبقى التحرير مريحاً.
   - يحفظ التاريخ بعد انتهاء السحب. */
function makeDraggable(el, opts){
  opts = opts || {};
  let dragging=false, sx=0, sy=0, ox=0, oy=0, startedAt=0;
  const onDown = (clientX, clientY, e)=>{
    // إذا ضغطت على عنصر تحكم أو منطقة كتابة، لا تبدء السحب
    if(e && e.target){
      if(e.target.closest('.sn-content')) return;            // منطقة الكتابة
      if(e.target.closest('.sn-close')) return;              // زر الإغلاق
      if(e.target.closest('.sn-color')) return;              // شريط الألوان
      if(e.target.closest('.sn-resize')) return;             // مقبض التحجيم
      if(e.target.closest('button')) return;                 // أي زر
      if(e.target.closest('input,select,textarea')) return;  // حقول إدخال
      if(e.target.isContentEditable) return;
    }
    dragging=true; startedAt=Date.now();
    const r = el.getBoundingClientRect();
    sx = clientX; sy = clientY;
    // ثبّت الموضع الحالي كقيم left/top صريحة
    el.style.left = r.left + 'px';
    el.style.top  = r.top  + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.margin = '0';
    el.style.position = 'fixed';
    // ألغِ الدوران أثناء السحب لتجنّب القفزات البصرية
    const prevRot = el.style.getPropertyValue('--rot') || '0deg';
    el.dataset._prevRot = prevRot;
    el.style.setProperty('--rot', '0deg');
    ox = parseFloat(el.style.left);
    oy = parseFloat(el.style.top);
    el.classList.add('dragging');
    // ارفع z-index فوق باقي الملاحظات
    el.style.zIndex = ++noteZ;
    if(e && e.preventDefault) e.preventDefault();
  };
  const onMove = (clientX, clientY)=>{
    if(!dragging) return;
    const dx = clientX - sx, dy = clientY - sy;
    let nx = ox + dx, ny = oy + dy;
    // إبقاء داخل النافذة
    const w = el.offsetWidth || 200, h = el.offsetHeight || 120;
    nx = Math.max(-w/2, Math.min(window.innerWidth - w/2, nx));
    ny = Math.max(0, Math.min(window.innerHeight - 30, ny));
    el.style.left = nx + 'px';
    el.style.top  = ny + 'px';
  };
  const onUp = ()=>{
    if(!dragging) return;
    dragging=false;
    el.classList.remove('dragging');
    // أعد الدوران الأصلي
    if(el.dataset._prevRot !== undefined){
      el.style.setProperty('--rot', el.dataset._prevRot);
      delete el.dataset._prevRot;
    }
    // أعد position إلى absolute لتثبيت الموضع بالنسبة للسبورة
    el.style.position = 'absolute';
    if(typeof saveHistory === 'function') saveHistory();
  };
  el.addEventListener('mousedown', e=>onDown(e.clientX, e.clientY, e));
  document.addEventListener('mousemove', e=>onMove(e.clientX, e.clientY));
  document.addEventListener('mouseup', onUp);
  // دعم اللمس (موبايل/تابلت)
  el.addEventListener('touchstart', e=>{
    const t = e.touches[0]; if(t) onDown(t.clientX, t.clientY, e);
  }, {passive:false});
  document.addEventListener('touchmove', e=>{
    if(!dragging) return;
    const t = e.touches[0]; if(t) onMove(t.clientX, t.clientY);
  }, {passive:false});
  document.addEventListener('touchend', onUp);
  document.addEventListener('touchcancel', onUp);
}

/* منتقي لون -> يحوّل إلى لون فاتح وداكن متوافقين مع النص */
function _hexToRgb(hex){
  hex = String(hex || '').replace('#','');
  if(hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
  if(hex.length !== 6) return null;
  return {r:parseInt(hex.substr(0,2),16), g:parseInt(hex.substr(2,2),16), b:parseInt(hex.substr(4,2),16)};
}
function _rgbToHex(r,g,b){
  const h = n => n.toString(16).padStart(2,'0');
  return '#' + h(Math.max(0,Math.min(255,r))) + h(Math.max(0,Math.min(255,g))) + h(Math.max(0,Math.min(255,b)));
}
function _shadeHex(hex, percent){
  const rgb = _hexToRgb(hex); if(!rgb) return hex;
  const t = percent < 0 ? 0 : 255;
  const p = Math.abs(percent) / 100;
  const r = Math.round((t - rgb.r) * p + rgb.r);
  const g = Math.round((t - rgb.g) * p + rgb.g);
  const b = Math.round((t - rgb.b) * p + rgb.b);
  return _rgbToHex(r,g,b);
}
function _pickFg(hex){
  const rgb = _hexToRgb(hex); if(!rgb) return '#2c3e50';
  // حساب الإضاءة (Luminance) لتحديد لون النص
  const lum = (0.299*rgb.r + 0.587*rgb.g + 0.114*rgb.b) / 255;
  return lum > 0.6 ? '#2c3e50' : '#ffffff';
}

/* addStickyNote: ينشئ ملاحظة جديدة محتواة داخل notes-dock
   - اللون المختار يتحكم في **لون كتابة النص** لا لون الخلفية
   - الملاحظة ثابتة في حاوية مخصّصة (لا إزاحة، لا فيضان)
   - تدعم تكبير/تصغير الخط + تفريغ النص + حذف */
function _ensureNotesDock(){
  let dock = document.getElementById('notesDock');
  if(dock) return dock;
  dock = document.createElement('div');
  dock.className = 'notes-dock mode-grid';
  dock.id = 'notesDock';
  dock.innerHTML = `
    <div class="notes-dock-head" id="notesDockHead">
      <span class="ndh-title"><i class="fas fa-sticky-note"></i><span>ملاحظاتي</span><span class="ndh-count" id="notesDockCount">0</span></span>
      <div class="ndh-mode" id="notesDockMode" title="تبديل وضع العرض">
        <button data-mode="list" title="عرض قائمة"><i class="fas fa-list"></i></button>
        <button data-mode="grid" class="active" title="عرض شبكي"><i class="fas fa-th"></i></button>
      </div>
      <button class="ndh-collapse" id="notesDockOverview" title="نظرة شاملة على كل الملاحظات"><i class="fas fa-expand"></i></button>
      <button class="ndh-close" id="notesDockClose" title="إخفاء"><i class="fas fa-times"></i></button>
    </div>
    <div class="notes-templates" id="notesTemplates">
      <span class="notes-templates-label"><i class="fas fa-magic"></i>اسحبي لوناً:</span>
      <span class="nt-chip" draggable="true" data-color="black"   data-hex="#000000" style="background:#000000" title="أسود">⚫</span>
      <span class="nt-chip" draggable="true" data-color="red"     data-hex="#c62828" style="background:#c62828" title="أحمر">🔴</span>
      <span class="nt-chip" draggable="true" data-color="green"   data-hex="#2e7d32" style="background:#2e7d32" title="أخضر">🟢</span>
      <span class="nt-chip" draggable="true" data-color="blue"    data-hex="#1565c0" style="background:#1565c0" title="أزرق">🔵</span>
      <span class="nt-chip" draggable="true" data-color="yellow"  data-hex="#f57f17" style="background:#f9d423" title="أصفر">🟡</span>
      <span class="nt-chip" draggable="true" data-color="pink"    data-hex="#d81b60" style="background:#ec407a" title="وردي">🩷</span>
      <span class="nt-chip" draggable="true" data-color="purple"  data-hex="#7b1fa2" style="background:#7b1fa2" title="بنفسجي">🟣</span>
      <span class="nt-chip" draggable="true" data-color="orange"  data-hex="#e65100" style="background:#fb8c00" title="برتقالي">🟠</span>
    </div>
    <div class="notes-dock-body" id="notesDockBody">
      <div class="notes-dock-empty" id="notesDockEmpty">
        <i class="fas fa-pen-fancy"></i>
        <div>اضغطي على <b>+ ملاحظة</b> لبدء الكتابة</div>
        <div style="font-size:.7rem;margin-top:6px;color:#bbb">أو اسحبي لوناً من الأعلى إلى هنا</div>
      </div>
    </div>
    <button class="notes-dock-add" id="notesDockAdd" type="button"><i class="fas fa-plus"></i> ملاحظة جديدة</button>
  `;
  document.body.appendChild(dock);
  // سحب الحاوية من الرأس
  const head = dock.querySelector('#notesDockHead');
  let dragging = false, sx=0, sy=0, ox=0, oy=0;
  const onDown = (cx, cy, e)=>{
    if(e.target.closest('button')) return; // لا تسحب من الأزرار
    dragging = true; sx = cx; sy = cy;
    const r = dock.getBoundingClientRect();
    ox = r.left; oy = r.top;
    dock.style.transition = 'none';
    e.preventDefault();
  };
  const onMove = (cx, cy)=>{
    if(!dragging) return;
    const nx = Math.max(0, Math.min(window.innerWidth - 60, ox + (cx - sx)));
    const ny = Math.max(0, Math.min(window.innerHeight - 30, oy + (cy - sy)));
    dock.style.left = nx + 'px';
    dock.style.top  = ny + 'px';
    dock.style.right = 'auto';
    dock.style.bottom = 'auto';
  };
  const onUp = ()=>{
    if(!dragging) return;
    dragging = false;
    dock.style.transition = '';
    try{ localStorage.setItem('notesDockPos', JSON.stringify({left: dock.style.left, top: dock.style.top})); }catch(e){}
  };
  head.addEventListener('mousedown', e=>onDown(e.clientX, e.clientY, e));
  document.addEventListener('mousemove', e=>onMove(e.clientX, e.clientY));
  document.addEventListener('mouseup', onUp);
  head.addEventListener('touchstart', e=>{const t=e.touches[0]; if(t) onDown(t.clientX, t.clientY, e);}, {passive:false});
  document.addEventListener('touchmove', e=>{if(dragging){const t=e.touches[0]; if(t) onMove(t.clientX, t.clientY);}}, {passive:false});
  document.addEventListener('touchend', onUp);
  // أزرار التحكم — تم تعطيل زر الطي/الفتح لأن اللوحة تبقى مفتوحة بالكامل دائماً
  // (زر الطي أُزيل من الواجهة، نحتفظ بالكود هنا كاحتياط)
  const _collapseBtn = dock.querySelector('#notesDockCollapse');
  if(_collapseBtn){ _collapseBtn.style.display = 'none'; }
  dock.querySelector('#notesDockClose').addEventListener('click', ()=>{
    dock.style.display = 'none';
    if(typeof toast === 'function') toast('تم إخفاء لوحة الملاحظات — استخدمي زر "ملاحظة" لإظهارها مجدداً', 'info');
  });
  dock.querySelector('#notesDockAdd').addEventListener('click', ()=>addStickyNote());
  // زر النظرة الشاملة
  dock.querySelector('#notesDockOverview').addEventListener('click', ()=>openNotesOverview());
  // تبديل وضع العرض (قائمة / شبكة)
  dock.querySelectorAll('#notesDockMode button').forEach(b=>{
    b.addEventListener('click', ()=>{
      const mode = b.dataset.mode;
      dock.classList.remove('mode-list','mode-grid');
      dock.classList.add('mode-' + mode);
      dock.querySelectorAll('#notesDockMode button').forEach(x=>x.classList.toggle('active', x===b));
      try{ localStorage.setItem('notesDockMode', mode); }catch(e){}
    });
  });
  // استرجاع وضع العرض المحفوظ
  try{
    const savedMode = localStorage.getItem('notesDockMode');
    if(savedMode === 'grid' || savedMode === 'list'){
      const targetBtn = dock.querySelector(`#notesDockMode button[data-mode="${savedMode}"]`);
      if(targetBtn) targetBtn.click();
    }
  }catch(e){}
  // === شريط القوالب القابل للسحب (Drag & Drop) ===
  _setupTemplateChips(dock);
  // === Drag&Drop لاستقبال الملاحظات على جسم الحاوية ===
  const bodyEl = dock.querySelector('#notesDockBody');
  bodyEl.addEventListener('dragover', e=>{ e.preventDefault(); bodyEl.style.background = '#e3f2fd'; });
  bodyEl.addEventListener('dragleave', e=>{ bodyEl.style.background = ''; });
  bodyEl.addEventListener('drop', e=>{
    e.preventDefault();
    bodyEl.style.background = '';
    const hex = e.dataTransfer.getData('text/note-color');
    if(hex){
      addStickyNote({textColor: hex, color: 'black'});
    }
  });
  // استرجاع الموضع المحفوظ
  try{
    const saved = JSON.parse(localStorage.getItem('notesDockPos') || 'null');
    if(saved && saved.left && saved.top){
      dock.style.left = saved.left; dock.style.top = saved.top;
      dock.style.right = 'auto'; dock.style.bottom = 'auto';
    }
  }catch(e){}
  return dock;
}

/* شريط القوالب — اسحبي اللون لإنشاء ملاحظة على الفور */
function _setupTemplateChips(dock){
  const chips = dock.querySelectorAll('.nt-chip');
  chips.forEach(chip=>{
    // HTML5 drag (للماوس)
    chip.addEventListener('dragstart', e=>{
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/note-color', chip.dataset.hex);
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', e=>{
      chip.classList.remove('dragging');
    });
    // نقرة بسيطة = إضافة ملاحظة بهذا اللون
    chip.addEventListener('click', e=>{
      e.preventDefault();
      addStickyNote({textColor: chip.dataset.hex, color: 'black'});
    });
  });
  // دعم اللمس: نُظهر "شبح" يتبع الإصبع، وعند الإفلات نسأل المستخدم أين يضع الملاحظة
  let touchGhost = null;
  let touchChip = null;
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if(isTouch){
    chips.forEach(chip=>{
      chip.addEventListener('touchstart', e=>{
        const t = e.touches[0];
        touchChip = chip;
        // أنشئ شبحاً يتبع الإصبع
        touchGhost = document.createElement('div');
        touchGhost.className = 'nt-chip-ghost';
        touchGhost.style.background = chip.dataset.hex;
        touchGhost.textContent = '✎';
        touchGhost.style.left = t.clientX + 'px';
        touchGhost.style.top  = t.clientY + 'px';
        document.body.appendChild(touchGhost);
        chip.classList.add('dragging');
        e.preventDefault();
      }, {passive:false});
      chip.addEventListener('touchmove', e=>{
        if(!touchGhost) return;
        const t = e.touches[0];
        touchGhost.style.left = t.clientX + 'px';
        touchGhost.style.top  = t.clientY + 'px';
        // إن دخل منطقة الحاوية، أبرزها
        const body = dock.querySelector('#notesDockBody');
        if(body){
          const r = body.getBoundingClientRect();
          const inside = t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom;
          body.style.background = inside ? '#e3f2fd' : '';
        }
        e.preventDefault();
      }, {passive:false});
      chip.addEventListener('touchend', e=>{
        if(!touchGhost || !touchChip) return;
        const t = (e.changedTouches && e.changedTouches[0]) || null;
        const body = dock.querySelector('#notesDockBody');
        body.style.background = '';
        let dropped = false;
        if(t && body){
          const r = body.getBoundingClientRect();
          if(t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom){
            dropped = true;
          }
        }
        // أضف الملاحظة (داخل الحاوية إن أُفلت فوقها، أو في نهاية القائمة افتراضياً)
        addStickyNote({textColor: touchChip.dataset.hex, color: 'black'});
        touchGhost.remove();
        touchGhost = null;
        touchChip.classList.remove('dragging');
        touchChip = null;
        e.preventDefault();
      }, {passive:false});
    });
  }
}

/* ============================================================
   نظرة شاملة على كل الملاحظات (OVERVIEW MODAL)
   - لوحة عائمة أنيقة بكل الملاحظات كبطاقات
   - بحث + فلتر بالألوان
   ============================================================ */
let _notesOverviewFilter = {search:'', color:'all'};
function openNotesOverview(){
  let overlay = document.getElementById('notesOverview');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.className = 'notes-overview';
    overlay.id = 'notesOverview';
    overlay.innerHTML = `
      <div class="notes-overview-box" role="dialog" aria-label="نظرة شاملة على الملاحظات">
        <div class="notes-overview-head">
          <h2><i class="fas fa-th-large"></i> نظرة شاملة على ملاحظاتي</h2>
          <span class="no-stats">إجمالي: <b id="noTotalCount">0</b> ملاحظة</span>
          <button id="noCloseBtn" title="إغلاق"><i class="fas fa-times"></i></button>
        </div>
        <div class="notes-overview-toolbar">
          <div class="no-search">
            <i class="fas fa-search"></i>
            <input type="text" id="noSearch" placeholder="ابحثي في الملاحظات...">
          </div>
          <div class="no-filter-group" id="noFilterGroup">
            <button data-color="all" class="active">الكل</button>
            <button data-color="red">🔴</button>
            <button data-color="green">🟢</button>
            <button data-color="blue">🔵</button>
            <button data-color="yellow">🟡</button>
            <button data-color="pink">🩷</button>
            <button data-color="purple">🟣</button>
            <button data-color="black">⚫</button>
          </div>
          <button class="no-toolbar-action" id="noAddBtn"><i class="fas fa-plus"></i> ملاحظة</button>
          <button class="no-toolbar-action danger" id="noClearBtn" title="حذف كل الملاحظات"><i class="fas fa-trash"></i> حذف الكل</button>
        </div>
        <div class="notes-overview-body" id="noBody"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    // إغلاق
    overlay.addEventListener('click', e=>{
      if(e.target === overlay) closeNotesOverview();
    });
    overlay.querySelector('#noCloseBtn').addEventListener('click', closeNotesOverview);
    overlay.querySelector('#noAddBtn').addEventListener('click', ()=>{
      addStickyNote();
    });
    overlay.querySelector('#noClearBtn').addEventListener('click', ()=>{
      const count = (document.getElementById('notesDockBody')||{}).querySelectorAll ? document.querySelectorAll('#notesDockBody .sticky-note').length : 0;
      if(count === 0) return;
      if(confirm('هل تريدين حذف كل الملاحظات (' + count + ' ملاحظة)؟')){
        document.querySelectorAll('#notesDockBody .sticky-note').forEach(n=>n.remove());
        if(typeof _updateNotesDockUI === 'function') _updateNotesDockUI();
        if(typeof saveHistory === 'function') saveHistory();
        renderNotesOverview();
      }
    });
    // البحث
    const searchInput = overlay.querySelector('#noSearch');
    searchInput.addEventListener('input', e=>{
      _notesOverviewFilter.search = e.target.value;
      renderNotesOverview();
    });
    // فلتر الألوان
    overlay.querySelectorAll('#noFilterGroup button').forEach(b=>{
      b.addEventListener('click', ()=>{
        _notesOverviewFilter.color = b.dataset.color;
        overlay.querySelectorAll('#noFilterGroup button').forEach(x=>x.classList.toggle('active', x===b));
        renderNotesOverview();
      });
    });
    // اختصار Escape
    document.addEventListener('keydown', e=>{
      if(e.key === 'Escape' && overlay.classList.contains('active')){
        closeNotesOverview();
      }
    });
  }
  // عرض
  overlay.classList.add('active');
  // ركّز حقل البحث
  setTimeout(()=>{
    const s = overlay.querySelector('#noSearch');
    if(s) s.focus();
  }, 200);
  renderNotesOverview();
}
function closeNotesOverview(){
  const overlay = document.getElementById('notesOverview');
  if(overlay) overlay.classList.remove('active');
}
function renderNotesOverview(){
  const overlay = document.getElementById('notesOverview');
  if(!overlay) return;
  const body = overlay.querySelector('#noBody');
  const totalEl = overlay.querySelector('#noTotalCount');
  // اجلب كل الملاحظات من الحاوية
  const dockBody = document.getElementById('notesDockBody');
  if(!dockBody){ return; }
  let notes = Array.from(dockBody.querySelectorAll('.sticky-note'));
  // البحث
  const q = (_notesOverviewFilter.search || '').trim().toLowerCase();
  if(q){
    notes = notes.filter(n=>{
      const c = n.querySelector('.sn-content');
      return c && (c.textContent || '').toLowerCase().includes(q);
    });
  }
  // فلتر اللون
  if(_notesOverviewFilter.color && _notesOverviewFilter.color !== 'all'){
    notes = notes.filter(n=>{
      // إما صنف لون جاهز، أو لون مخصص
      const cls = Array.from(n.classList).find(c=>['black','red','green','blue','yellow','pink','purple','orange','cyan','gray'].includes(c));
      if(cls === _notesOverviewFilter.color) return true;
      // لون مخصص: حاول نطابقه
      const custom = n.style.getPropertyValue('--note-text');
      return custom && custom.toLowerCase().includes(_notesOverviewFilter.color);
    });
  }
  if(totalEl) totalEl.textContent = String(notes.length);
  if(notes.length === 0){
    body.innerHTML = `
      <div class="notes-overview-empty">
        <i class="fas fa-clipboard"></i>
        <h3>${q || _notesOverviewFilter.color !== 'all' ? 'لا توجد نتائج' : 'لا توجد ملاحظات بعد'}</h3>
        <p>${q || _notesOverviewFilter.color !== 'all' ? 'جرّبي كلمات بحث أخرى أو فلتر مختلف' : 'اضغطي على زر "+ ملاحظة" أعلاه لإضافة أول ملاحظة، أو استخدمي زر "ملاحظة" في شريط الأدوات'}</p>
      </div>
    `;
    return;
  }
  // شبكة البطاقات
  let html = '<div class="notes-grid">';
  notes.forEach((n, i)=>{
    // استخرج اللون لعرضه في تذييل البطاقة
    const customText = n.style.getPropertyValue('--note-text') || '';
    const cls = Array.from(n.classList).find(c=>['black','red','green','blue','yellow','pink','purple','orange','cyan','gray'].includes(c));
    // استخرج نص الملاحظة لعرضه
    const contentEl = n.querySelector('.sn-content');
    const contentHTML = contentEl ? contentEl.innerHTML : '';
    // وقت الإنشاء (إن وُجد)
    const time = n.dataset.createdAt ? new Date(parseInt(n.dataset.createdAt)).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}) : '';
    html += `
      <div class="sticky-note ${cls || ''}" data-note-idx="${i}" data-source-id="${n.dataset.noteId || ''}" style="${customText ? '--note-text:'+customText+';' : ''}">
        <div class="sn-color" style="opacity:0"></div>
        <div class="sn-close" title="حذف"><i class="fas fa-times"></i></div>
        <div class="sn-content" contenteditable="true" spellcheck="false">${contentHTML}</div>
        <div class="no-card-foot">
          <span class="no-time">${time}</span>
          <span class="no-color-dot" style="background:${customText || (cls === 'red' ? '#c62828' : cls === 'green' ? '#2e7d32' : cls === 'blue' ? '#1565c0' : '#2c3e50')}"></span>
        </div>
      </div>
    `;
  });
  html += '</div>';
  body.innerHTML = html;
  // اجعل البطاقات في النظرة الشاملة تتفاعل (تحديث، حذف)
  body.querySelectorAll('.sticky-note').forEach(card=>{
    // مزامنة الكتابة مع البطاقة الأصلية في الحاوية
    const idx = parseInt(card.dataset.noteIdx);
    const srcNotes = Array.from(dockBody.querySelectorAll('.sticky-note'));
    const original = srcNotes[idx];
    if(!original) return;
    // تحديث لون النص عند الكتابة في النظرة الشاملة (ينعكس على الأصلية)
    const origContent = original.querySelector('.sn-content');
    const cardContent = card.querySelector('.sn-content');
    if(cardContent && origContent){
      cardContent.addEventListener('input', ()=>{
        origContent.textContent = cardContent.textContent;
        // حدّث لون النص
        const newColor = getComputedStyle(cardContent).color;
        original.style.setProperty('--note-text', newColor);
        // حدّث لون الملاحظة الأصلية
        origContent.style.color = newColor;
        if(typeof saveHistory === 'function') saveHistory();
      });
    }
    // حذف
    const closeBtn = card.querySelector('.sn-close');
    if(closeBtn){
      closeBtn.addEventListener('click', e=>{
        e.stopPropagation();
        original.remove();
        if(typeof _updateNotesDockUI === 'function') _updateNotesDockUI();
        if(typeof saveHistory === 'function') saveHistory();
        renderNotesOverview();
      });
    }
    // النقر على البطاقة → إغلاق النظرة والتركيز على الأصلية
    card.addEventListener('click', e=>{
      if(e.target.closest('.sn-close')) return;
      if(e.target.closest('.sn-content')) return; // لا تنقل التركيز أثناء الكتابة
      closeNotesOverview();
      setTimeout(()=>{
        original.scrollIntoView({behavior:'smooth', block:'center'});
        const c = original.querySelector('.sn-content');
        if(c) c.focus();
      }, 200);
    });
  });
}
function _updateNotesDockUI(){
  const dock = document.getElementById('notesDock');
  if(!dock) return;
  const body = dock.querySelector('#notesDockBody');
  const empty = dock.querySelector('#notesDockEmpty');
  const count = dock.querySelector('#notesDockCount');
  if(!body) return;
  const notes = body.querySelectorAll('.sticky-note');
  if(count) count.textContent = String(notes.length);
  if(empty) empty.style.display = notes.length === 0 ? 'flex' : 'none';
  // حدّث عدّاد زر النظرة الشاملة (FAB)
  const fabBadge = document.getElementById('notesOverviewBadge');
  if(fabBadge){
    fabBadge.textContent = String(notes.length);
    fabBadge.style.display = notes.length === 0 ? 'none' : '';
  }
  // إذا كانت النظرة الشاملة مفتوحة، أعد رسمها
  const overview = document.getElementById('notesOverview');
  if(overview && overview.classList.contains('active') && typeof renderNotesOverview === 'function'){
    renderNotesOverview();
  }
}

function addStickyNote(opts){
  opts = opts || {};
  const dock = _ensureNotesDock();
  const body = dock.querySelector('#notesDockBody');
  if(!body){ return null; }
  // إظهار الحاوية إذا كانت مخفية
  if(dock.style.display === 'none') dock.style.display = '';
  // ألوان افتراضية للكتابة (نفس ألوان CSS المتغيرات)
  const palette = ['black','red','green','blue','yellow','pink','purple','orange','cyan','gray'];
  const preset = opts.color || palette[Math.floor(Math.random()*palette.length)];
  const customTextColor = opts.textColor || ''; // لون مخصص للنص (مثل #c62828)
  const n = document.createElement('div');
  n.className = 'sticky-note ' + preset;
  // معرّف فريد + وقت الإنشاء (للنظرة الشاملة)
  n.dataset.noteId = 'n-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2,5);
  n.dataset.createdAt = String(Date.now());
  // تطبيق لون نص مخصص
  if(customTextColor){
    n.style.setProperty('--note-text', customTextColor);
    n.dataset.customColor = '1';
    n.dataset.customBg = customTextColor;
  }
  // حجم خط اختياري
  const fontSize = opts.fontSize || 0.95;
  n.dataset.fontSize = fontSize;
  n.innerHTML = `
    <div class="sn-color" title="اختاري لوناً للكتابة">
      <span style="background:#000000" data-c="black" title="أسود"></span>
      <span style="background:#c62828" data-c="red" title="أحمر"></span>
      <span style="background:#2e7d32" data-c="green" title="أخضر"></span>
      <span style="background:#1976d2" data-c="blue" title="أزرق"></span>
      <span style="background:#f39c12" data-c="yellow" title="أصفر"></span>
      <span style="background:#ec407a" data-c="pink" title="وردي"></span>
      <span style="background:#7b1fa2" data-c="purple" title="بنفسجي"></span>
      <span style="background:#e65100" data-c="orange" title="برتقالي"></span>
      <span style="background:#00838f" data-c="cyan" title="سماوي"></span>
      <span style="background:#424242" data-c="gray" title="رمادي"></span>
      <label class="sn-picker" title="اختاري أي لون للكتابة" style="background:conic-gradient(from 0deg,#000,#c62828,#f39c12,#2e7d32,#1976d2,#7b1fa2,#ec407a,#000)">
        <i class="fas fa-palette"></i>
        <input type="color" value="${customTextColor || '#c62828'}" aria-label="منتقي لون مخصص للكتابة">
      </label>
    </div>
    <div class="sn-close" title="حذف الملاحظة"><i class="fas fa-times"></i></div>
    <div class="sn-content" contenteditable="true" spellcheck="false" style="font-size:${fontSize}rem"></div>
    <div class="sn-tools">
      <button class="sn-size-down" title="تصغير الخط"><i class="fas fa-minus"></i></button>
      <span class="sn-size-val">${Math.round(fontSize*100)}%</span>
      <button class="sn-size-up" title="تكبير الخط"><i class="fas fa-plus"></i></button>
      <button class="sn-clear" title="تفريغ النص"><i class="fas fa-eraser"></i></button>
    </div>
  `;
  body.appendChild(n);
  // ضع نص الملاحظة بعد البناء (لتجنب مشاكل HTML entities)
  const contentEl = n.querySelector('.sn-content');
  if(opts.content && opts.content.trim()){
    contentEl.textContent = opts.content;
  }
  // إبراز اللون النشط
  const _markActive = ()=>{
    n.querySelectorAll('.sn-color > span[data-c]').forEach(s=>{
      s.classList.toggle('active', s.dataset.c === preset || (!n.dataset.customColor && s.dataset.c === n.className.replace('sticky-note','').trim()));
    });
  };
  _markActive();
  // عند الانتهاء من تعديل النص
  let saveTimer = null;
  contentEl.addEventListener('input', ()=>{
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(()=>{ if(typeof saveHistory === 'function') saveHistory(); }, 600);
  });
  contentEl.addEventListener('blur', ()=>{
    if(typeof saveHistory === 'function') saveHistory();
  });
  // منع الإزاحة: لا نسحب الملاحظة داخل الحاوية، فقط نحرك النص
  // (الإزاحة كانت بسبب transform/rotate/mousedown)
  // زر الإغلاق
  n.querySelector('.sn-close').addEventListener('click', (e)=>{
    e.stopPropagation();
    n.remove();
    _updateNotesDockUI();
    if(typeof saveHistory === 'function') saveHistory();
  });
  // أزرار الألوان الجاهزة — تغيّر **لون النص**
  n.querySelectorAll('.sn-color > span[data-c]').forEach(s=>{
    s.addEventListener('click', (e)=>{
      e.stopPropagation();
      const c = s.dataset.c;
      // أعد ضبط الكلاسات للون الجديد فقط
      n.className = 'sticky-note ' + c;
      n.style.removeProperty('--note-text');
      delete n.dataset.customColor;
      delete n.dataset.customBg;
      _markActive();
      if(typeof saveHistory === 'function') saveHistory();
    });
  });
  // منتقي اللون المخصص — يطبّق على **لون النص**
  const colorInput = n.querySelector('.sn-color .sn-picker input[type="color"]');
  if(colorInput){
    colorInput.addEventListener('input', (e)=>{
      e.stopPropagation();
      const c = e.target.value;
      n.style.setProperty('--note-text', c);
      n.dataset.customColor = '1';
      n.dataset.customBg = c;
      // أزل كلاسات الألوان الجاهزة لتفادي التعارض
      n.className = 'sticky-note';
      _markActive();
      if(typeof saveHistory === 'function') saveHistory();
    });
    colorInput.addEventListener('mousedown', e=>e.stopPropagation());
    colorInput.addEventListener('touchstart', e=>e.stopPropagation(), {passive:true});
  }
  // تكبير/تصغير الخط
  const sizeVal = n.querySelector('.sn-size-val');
  const setSize = (delta)=>{
    let cur = parseFloat(n.dataset.fontSize || '0.95') + delta;
    cur = Math.max(0.7, Math.min(1.8, cur));
    n.dataset.fontSize = cur.toFixed(2);
    contentEl.style.fontSize = cur + 'rem';
    if(sizeVal) sizeVal.textContent = Math.round(cur*100) + '%';
    if(typeof saveHistory === 'function') saveHistory();
  };
  n.querySelector('.sn-size-up').addEventListener('click', e=>{e.stopPropagation(); setSize(0.1);});
  n.querySelector('.sn-size-down').addEventListener('click', e=>{e.stopPropagation(); setSize(-0.1);});
  // مسح النص
  n.querySelector('.sn-clear').addEventListener('click', (e)=>{
    e.stopPropagation();
    contentEl.textContent = '';
    contentEl.focus();
    if(typeof saveHistory === 'function') saveHistory();
  });
  // تحديث عدّاد الملاحظات
  _updateNotesDockUI();
  // أعطِ تركيزاً للنص
  if(!opts.noFocus){
    setTimeout(()=>{
      contentEl.focus();
      // ضع المؤشر في نهاية النص الموجود
      const range = document.createRange();
      range.selectNodeContents(contentEl);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }, 50);
  }
  return n;
}

/* BOARD TIMER - TIMER ON WHITEBOARD */
let boardTimerState={seconds:300,running:false,interval:null,el:null,urgent:false};
function addBoardTimer(){
  if(boardTimerState.el){boardTimerState.el.remove();boardTimerState.el=null;}
  const wrap=document.getElementById('canvasWrap');
  const t=document.createElement('div');
  t.className='board-timer';
  t.style.top='25%';
  t.style.left='35%';
  t.innerHTML=`
    <div class="bt-header" data-drag-handle>
      <span class="bt-title"><i class="fas fa-stopwatch-20"></i><span class="bt-title-text">⏱️ مؤقت على السبورة</span></span>
      <span class="bt-header-btns">
        <button class="bt-hbtn bt-min-btn" type="button" title="تصغير" aria-label="تصغير"><i class="fas fa-window-minimize"></i></button>
        <button class="bt-hbtn close" type="button" title="إغلاق" aria-label="إغلاق"><i class="fas fa-times"></i></button>
      </span>
    </div>
    <div class="bt-body">
      <div class="bt-time" id="btTime">05:00</div>
      <div class="bt-controls">
        <button onclick="adjustBoardTimer(-60)">-1د</button>
        <button onclick="adjustBoardTimer(-10)">-10ث</button>
        <input type="number" class="bt-input" id="btInput" value="5" min="1" max="60">
        <button onclick="setBoardTimerFromInput()">د</button>
        <button class="primary" id="btStartBtn" onclick="toggleBoardTimer()">▶ بدء</button>
        <button onclick="resetBoardTimer()">↻</button>
      </div>
      <div class="bt-volume" id="btVolumeRow">
        <button class="bt-vol-btn" type="button" title="كتم الصوت" aria-label="كتم الصوت"><i class="fas fa-volume-up"></i></button>
        <button class="bt-vol-step" type="button" title="خفض الصوت" aria-label="خفض">−</button>
        <div class="bt-vol-bar" title="اسحب لتغيير مستوى الصوت"><div class="bt-vol-fill"></div></div>
        <button class="bt-vol-step" type="button" title="رفع الصوت" aria-label="رفع">+</button>
        <span class="bt-vol-pct" id="btVolPct">85%</span>
      </div>
      <div class="bt-sound" style="display:flex;align-items:center;gap:5px;justify-content:center;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12)">
        <i class="fas fa-music" style="color:rgba(255,255,255,.85);font-size:.75rem;width:14px"></i>
        <select id="btSoundType" class="bt-sound-sel" title="نغمة الانتهاء" onchange="onTimerSoundChange(this.value)" style="flex:1;font-family:'Tajawal';font-size:.72rem;padding:4px 6px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:rgba(255,255,255,.12);font-weight:700;color:#fff;cursor:pointer;max-width:180px">
          <option value="elegant">💎 احترافية فاخرة</option>
          <option value="crystal">💠 كريستال</option>
          <option value="sweet_bell">🌸 جرس لطيف</option>
          <option value="lullaby">🌙 تهويدة</option>
          <option value="zen">🪷 وعاء زن</option>
          <option value="gentle_wake">🌅 استيقاظ</option>
          <option value="water">💧 قطرات</option>
          <option value="twinkle">✨ تويـنكل</option>
          <option value="mary">🎵 Mary</option>
          <option value="piano">🎹 بيانو</option>
          <option value="arpeggio">🌈 أربيجيو</option>
          <option value="arabic">🕌 عربي</option>
          <option value="chime">🔔 تصاعدية</option>
          <option value="school">🏫 جرس مدرسة</option>
          <option value="victory">🎉 انتصار</option>
          <option value="birds">🐦 عصافير</option>
          <option value="buzzer">📯 تنبيه قوي</option>
        </select>
        <button type="button" onclick="previewTimerSound()" title="استمع للنغمة" style="background:rgba(255,255,255,.18);color:#fff;border:none;width:24px;height:24px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-play" style="font-size:.6rem"></i></button>
      </div>
      <div class="bt-sound" style="display:flex;align-items:center;gap:5px;justify-content:center;margin-top:5px">
        <i class="fas fa-stopwatch" style="color:rgba(255,255,255,.85);font-size:.7rem;width:14px"></i>
        <select id="btTickType" class="bt-sound-sel" title="صوت الدقات" onchange="onTimerTickChange(this.value)" style="flex:1;font-family:'Tajawal';font-size:.7rem;padding:3px 5px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:rgba(255,255,255,.12);font-weight:700;color:#fff;cursor:pointer;max-width:150px">
          <option value="classic_clock">🕰 ساعة كلاسيكية</option>
          <option value="pendulum">⏱ بندول</option>
          <option value="wooden">🪵 خشبي</option>
          <option value="crystal">💎 كريستال</option>
          <option value="pulse">💓 نبضة</option>
          <option value="beep">📟 بيب</option>
          <option value="silent">🔇 صامت</option>
        </select>
        <button type="button" onclick="previewTimerTick()" title="استمع للدقات" style="background:rgba(255,255,255,.18);color:#fff;border:none;width:22px;height:22px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas fa-play" style="font-size:.55rem"></i></button>
      </div>
    </div>
  `;
  wrap.appendChild(t);
  boardTimerState.el=t;
  boardTimerState.seconds=300;
  makeBoardTimerDraggable(t);
  // ربط أزرار الشريط العلوي
  const _minBtn=t.querySelector('.bt-min-btn');
  const _closeBtn=t.querySelector('.bt-hbtn.close');
  if(_minBtn)_minBtn.addEventListener('click',e=>{e.stopPropagation();toggleBoardTimerMinimize(t);});
  if(_closeBtn)_closeBtn.addEventListener('click',e=>{e.stopPropagation();removeBoardTimer();});
  // ربط أزرار الصوت — تعمل live أثناء العد التنازلي
  const _volBtn=t.querySelector('.bt-vol-btn');
  const _volMinus=t.querySelectorAll('.bt-vol-step')[0];
  const _volPlus=t.querySelectorAll('.bt-vol-step')[1];
  const _volBar=t.querySelector('.bt-vol-bar');
  if(_volBtn)_volBtn.addEventListener('click',e=>{e.stopPropagation();toggleBoardTimerMute();});
  if(_volMinus)_volMinus.addEventListener('click',e=>{e.stopPropagation();bumpBoardTimerVolume(-10);});
  if(_volPlus)_volPlus.addEventListener('click',e=>{e.stopPropagation();bumpBoardTimerVolume(+10);});
  // سحب على شريط الصوت لتغيير المستوى مباشرة
  if(_volBar){
    let _vDragging=false;
    const setFromBar=(clientX)=>{
      const r=_volBar.getBoundingClientRect();
      const pct=Math.round(Math.max(0,Math.min(1,(clientX-r.left)/r.width))*100);
      State.timer.volume=pct/100;
      // مزامنة الشريط في النافذة المنبثقة
      const sl=document.getElementById('timerVolume');
      const lbl=document.getElementById('timerVolumeLabel');
      if(sl)sl.value=pct;
      if(lbl)lbl.textContent=pct+'%';
      const pctLbl=document.getElementById('btVolPct');
      if(pctLbl)pctLbl.textContent=pct+'%';
      updateBoardTimerVolumeUI();
    };
    _volBar.addEventListener('mousedown',e=>{_vDragging=true;setFromBar(e.clientX);e.preventDefault();e.stopPropagation();});
    document.addEventListener('mousemove',e=>{if(_vDragging){setFromBar(e.clientX);e.preventDefault();}});
    document.addEventListener('mouseup',()=>{_vDragging=false;});
    _volBar.addEventListener('touchstart',e=>{if(e.touches.length){_vDragging=true;setFromBar(e.touches[0].clientX);e.preventDefault();e.stopPropagation();}},{passive:false});
    document.addEventListener('touchmove',e=>{if(_vDragging&&e.touches.length){setFromBar(e.touches[0].clientX);e.preventDefault();}},{passive:false});
    document.addEventListener('touchend',()=>{_vDragging=false;});
  }
  // إصلاح UX: تطبيق قيمة الإدخال تلقائياً عند الضغط على Enter
  const _btInput=document.getElementById('btInput');
  if(_btInput){
    _btInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();setBoardTimerFromInput();}});
    _btInput.addEventListener('change',()=>setBoardTimerFromInput());
  }
  updateBoardTimerDisplay();
  updateBoardTimerVolumeUI();
  // مزامنة قائمة اختيار النغمة مع الحالة الحالية
  const _btSnd=t.querySelector('#btSoundType');
  if(_btSnd)_btSnd.value=State.timer.soundType||'elegant';
  const _btTick=t.querySelector('#btTickType');
  if(_btTick)_btTick.value=State.timer.tickType||'classic_clock';
  toast('success','تم إضافة مؤقت على السبورة');
}

/* سحب المؤقت عن طريق الشريط العلوي فقط — يدعم الماوس واللمس */
function makeBoardTimerDraggable(el){
  const handle=el.querySelector('.bt-header');
  if(!handle)return;
  let dragging=false, mStartX=0, mStartY=0, eStartX=0, eStartY=0, parentW=0, parentH=0, elW=0, elH=0;
  // لا تسحب إذا كان الهدف زراً داخل الشريط
  const isControlTarget=(target)=>{
    return !!(target && target.closest && target.closest('.bt-header-btns'));
  };
  const onDown=(clientX,clientY,target)=>{
    if(isControlTarget(target))return;
    dragging=true;
    // حوّل من top%/left% إلى بكسل صريح لمنع القفز
    const r=el.getBoundingClientRect();
    const parent=el.offsetParent||document.body;
    const pr=parent.getBoundingClientRect();
    el.style.left=(r.left-pr.left)+'px';
    el.style.top=(r.top-pr.top)+'px';
    el.style.right='auto';
    mStartX=clientX; mStartY=clientY;
    eStartX=r.left-pr.left; eStartY=r.top-pr.top;
    parentW=pr.width; parentH=pr.height;
    elW=r.width; elH=r.height;
    el.classList.add('dragging');
  };
  const onMove=(clientX,clientY)=>{
    if(!dragging)return;
    const dx=clientX-mStartX, dy=clientY-mStartY;
    let nx=eStartX+dx, ny=eStartY+dy;
    // قص ضمن حدود العنصر الأب
    nx=Math.max(0,Math.min(parentW-elW, nx));
    ny=Math.max(0,Math.min(parentH-elH, ny));
    el.style.left=nx+'px';
    el.style.top=ny+'px';
  };
  const onUp=()=>{dragging=false; el.classList.remove('dragging');};
  // الماوس
  handle.addEventListener('mousedown',e=>{
    if(e.button!==0)return;
    onDown(e.clientX,e.clientY,e.target);
    if(dragging){e.preventDefault();e.stopPropagation();}
  });
  document.addEventListener('mousemove',e=>{if(dragging){e.preventDefault();onMove(e.clientX,e.clientY);}});
  document.addEventListener('mouseup',onUp);
  // اللمس
  handle.addEventListener('touchstart',e=>{
    if(!e.touches.length)return;
    const t=e.touches[0];
    onDown(t.clientX,t.clientY,t.target);
    if(dragging)e.preventDefault();
  },{passive:false});
  document.addEventListener('touchmove',e=>{
    if(!dragging||!e.touches.length)return;
    const t=e.touches[0];
    onMove(t.clientX,t.clientY);
    e.preventDefault();
  },{passive:false});
  document.addEventListener('touchend',onUp);
  document.addEventListener('touchcancel',onUp);
}

/* تكبير/تصغير المؤقت: عند التصغير يبقى الشريط العلوي فقط */
function toggleBoardTimerMinimize(el){
  if(!el)return;
  const wasMin=el.classList.contains('minimized');
  el.classList.toggle('minimized');
  // غيّر أيقونة الزر بين تصغير وتكبير
  const btn=el.querySelector('.bt-min-btn i');
  if(btn){
    btn.className=wasMin?'fas fa-window-minimize':'fas fa-window-maximize';
  }
  const titleBtn=el.querySelector('.bt-min-btn');
  if(titleBtn)titleBtn.title=wasMin?'تصغير':'تكبير';
}
function setBoardTimerFromInput(){
  const v=parseInt(document.getElementById('btInput').value)||5;
  boardTimerState.seconds=v*60;
  if(boardTimerState.interval)clearInterval(boardTimerState.interval);
  boardTimerState.running=false;
  document.getElementById('btStartBtn').innerHTML='▶ بدء';
  document.getElementById('btStartBtn').className='primary';
  boardTimerState.urgent=false;
  updateBoardTimerDisplay();
}
function adjustBoardTimer(delta){
  boardTimerState.seconds=Math.max(0,boardTimerState.seconds+delta);
  updateBoardTimerDisplay();
}
function toggleBoardTimer(){
  if(!boardTimerState.el)return;
  if(boardTimerState.running){
    clearInterval(boardTimerState.interval);
    boardTimerState.running=false;
    document.getElementById('btStartBtn').innerHTML='▶ استكمال';
    document.getElementById('btStartBtn').className='primary';
  }else{
    // إصلاح: اقرأي قيمة حقل الإدخال قبل البدء (تحل "يعد من 5" عندما تختارين 6)
    const inputEl=document.getElementById('btInput');
    if(inputEl){
      const v=parseInt(inputEl.value);
      if(!isNaN(v)&&v>=1){
        const newSec=v*60;
        // حدّثي فقط إذا كانت القيمة المدخلة تختلف عن الحالية
        if(Math.abs(newSec-boardTimerState.seconds)>5)boardTimerState.seconds=newSec;
      }
    }
    if(boardTimerState.seconds<=0)boardTimerState.seconds=300;
    boardTimerState.running=true;
    document.getElementById('btStartBtn').innerHTML='⏸ إيقاف';
    document.getElementById('btStartBtn').className='danger';
    boardTimerState.interval=setInterval(()=>{
      boardTimerState.seconds--;
      if(boardTimerState.seconds<=10)boardTimerState.urgent=true;
      if(boardTimerState.seconds<=0){
        clearInterval(boardTimerState.interval);
        boardTimerState.running=false;
        boardTimerState.urgent=false;
        boardTimerState.seconds=0;
        document.getElementById('btStartBtn').innerHTML='▶ بدء';
        document.getElementById('btStartBtn').className='primary';
        playBeep();
        toast('success','⏰ انتهى الوقت!');
      }else{
        // نغمة تك خفيفة كل ثانية — يتجاوز آخر 3 ثواني (الجرس يغني)
        if(boardTimerState.seconds>3)playTick();
      }
      updateBoardTimerDisplay();
    },1000);
  }
}
function resetBoardTimer(){
  if(boardTimerState.interval)clearInterval(boardTimerState.interval);
  boardTimerState.running=false;
  boardTimerState.urgent=false;
  boardTimerState.seconds=300;
  document.getElementById('btInput').value=5;
  document.getElementById('btStartBtn').innerHTML='▶ بدء';
  document.getElementById('btStartBtn').className='primary';
  updateBoardTimerDisplay();
}
function removeBoardTimer(){
  if(boardTimerState.interval)clearInterval(boardTimerState.interval);
  if(boardTimerState.el)boardTimerState.el.remove();
  boardTimerState.el=null;
  boardTimerState.running=false;
}
function updateBoardTimerDisplay(){
  if(!boardTimerState.el)return;
  const s=Math.max(0,Math.floor(boardTimerState.seconds));
  const m=Math.floor(s/60),sec=s%60;
  const el=document.getElementById('btTime');
  if(el){
    el.textContent=`${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    el.classList.toggle('urgent',boardTimerState.urgent);
  }
}
/* ============================================================
   🛠️ GEOMETRIC TOOLS 2.0 — Interactive Drawing Engine
   آلية الرسم التفاعلي: اضغطي على الأداة → حرّكي الماوس 
   لتحديد الحجم/الزاوية → اتركي لترسيم الشكل النهائي
   مع: Snap للزوايا، معاينة حية، قياسات ذكية، دعم اللمس
   ============================================================ */
const GeoState = {
  active: false,
  tool: null,
  startX: 0, startY: 0,
  previewData: null,
  snap: true,
  measureEl: null,
  isDrawing: false
};

function createGeoTool(type){
  const wrap = document.getElementById('canvasWrap');
  document.querySelectorAll(`.geo-tool[data-type="${type}"]`).forEach(el => el.remove());

  const tool = document.createElement('div');
  tool.className = 'geo-tool';
  tool.dataset.type = type;
  tool.dataset.rotation = '0';
  tool.dataset.active = '0';

  const colors = { ruler:'#1a5f7a', protractor:'#c0392b', compass:'#8e44ad', setsquare:'#27ae60' };
  const titles = { ruler:'📏 المسطرة', protractor:'📐 المنقلة', compass:'⭕ البرجل', setsquare:'🔺 المثلث' };

  let html = '';
  if(type === 'ruler'){
    html = `<svg width="320" height="70" viewBox="0 0 320 70">
      <rect x="2" y="2" width="316" height="66" rx="6" fill="rgba(255,255,255,0.95)" stroke="${colors.ruler}" stroke-width="2.5"/>
      <line x1="20" y1="20" x2="300" y2="20" stroke="${colors.ruler}" stroke-width="1.5"/>
      ${Array.from({length:29},(_,i)=>{
        const x = 20 + i*10;
        const h = i%5===0 ? 18 : 10;
        const lbl = i%5===0 ? `<text x="${x}" y="52" text-anchor="middle" font-size="11" fill="${colors.ruler}" font-weight="800">${i}</text>` : '';
        return `<line x1="${x}" y1="20" x2="${x}" y2="${20+h}" stroke="${colors.ruler}" stroke-width="${i%5===0?1.5:0.8}"/>${lbl}`;
      }).join('')}
      <text x="160" y="64" text-anchor="middle" font-size="9" fill="#888">سحبي لتحديد الطول ←</text>
    </svg>`;
  } else if(type === 'protractor'){
    html = `<svg width="280" height="150" viewBox="0 0 280 150">
      <path d="M20,140 A120,120 0 0 1 260,140 Z" fill="rgba(255,255,255,0.95)" stroke="${colors.protractor}" stroke-width="2.5"/>
      ${Array.from({length:181},(_,a)=>{
        if(a%5!==0) return '';
        const rad = (180-a)*Math.PI/180;
        const r1=120, r2=a%10===0?105:112;
        const x1=140+r1*Math.cos(rad), y1=140-r1*Math.sin(rad);
        const x2=140+r2*Math.cos(rad), y2=140-r2*Math.sin(rad);
        const lbl = a%10===0 ? `<text x="${140+(r2-18)*Math.cos(rad)}" y="${140-(r2-18)*Math.sin(rad)+4}" text-anchor="middle" font-size="10" fill="${colors.protractor}" font-weight="800">${a}</text>` : '';
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colors.protractor}" stroke-width="${a%10===0?1.5:0.6}"/>${lbl}`;
      }).join('')}
      <line x1="140" y1="140" x2="140" y2="25" stroke="#e74c3c" stroke-width="2.5"/>
      <circle cx="140" cy="140" r="5" fill="#e74c3c"/>
      <text x="140" y="14" text-anchor="middle" font-size="11" fill="#666" font-weight="700">انقريي واسحبي لتحديد الزاوية</text>
    </svg>`;
  } else if(type === 'compass'){
    html = `<svg width="200" height="200" viewBox="0 0 200 200">
      <line x1="40" y1="180" x2="40" y2="30" stroke="${colors.compass}" stroke-width="5" stroke-linecap="round"/>
      <line x1="40" y1="180" x2="160" y2="180" stroke="${colors.compass}" stroke-width="5" stroke-linecap="round"/>
      <circle cx="40" cy="180" r="7" fill="#333"/>
      <circle cx="40" cy="30" r="5" fill="#e74c3c"/>
      <circle cx="160" cy="180" r="5" fill="#e74c3c"/>
      <line x1="40" y1="30" x2="160" y2="180" stroke="#e74c3c" stroke-width="1" stroke-dasharray="4,3" opacity="0.4"/>
      <circle cx="100" cy="105" r="70" fill="none" stroke="${colors.compass}" stroke-width="1.5" stroke-dasharray="6,4" opacity="0.3"/>
      <text x="100" y="105" text-anchor="middle" font-size="13" fill="${colors.compass}" font-weight="800">البرجل</text>
      <text x="100" y="122" text-anchor="middle" font-size="10" fill="#888">انقريي واسحبي لتحديد نصف القطر</text>
    </svg>`;
  } else if(type === 'setsquare'){
    html = `<svg width="180" height="180" viewBox="0 0 180 180">
      <polygon points="20,160 160,160 20,20" fill="rgba(173,216,230,0.25)" stroke="${colors.setsquare}" stroke-width="3" stroke-linejoin="round"/>
      <line x1="20" y1="20" x2="20" y2="160" stroke="#e74c3c" stroke-width="2"/>
      <line x1="20" y1="160" x2="160" y2="160" stroke="#e74c3c" stroke-width="2"/>
      <line x1="20" y1="20" x2="160" y2="160" stroke="#e74c3c" stroke-width="2"/>
      <text x="90" y="150" text-anchor="middle" font-size="12" fill="#333" font-weight="800">مثلث قائم 45°</text>
      <text x="90" y="100" text-anchor="middle" font-size="10" fill="#666">انقريي واسحبي لتحديد الحجم</text>
    </svg>`;
  }

  html += `<div class="geo-toolbar-mini">
    <button onclick="rotateGeoTool(this)" title="تدوير 15°"><i class="fas fa-rotate-right"></i></button>
    <button onclick="enterGeoDrawMode(this.closest('.geo-tool'))" title="وضع الرسم التفاعلي" style="background:var(--success);color:#fff;font-weight:800"><i class="fas fa-pen"></i> ارسمي</button>
    <button onclick="this.closest('.geo-tool').remove();saveHistory();" title="إزالة"><i class="fas fa-times"></i></button>
  </div>`;

  tool.innerHTML = html;
  tool.style.top = '25%';
  tool.style.left = '50%';
  tool.style.transform = 'translateX(-50%)';
  wrap.appendChild(tool);
  makeDraggable(tool);

  tool.animate([
    {transform:'translateX(-50%) scale(0.7)', opacity:0},
    {transform:'translateX(-50%) scale(1.05)', opacity:1},
    {transform:'translateX(-50%) scale(1)', opacity:1}
  ],{duration:350, easing:'cubic-bezier(.34,1.56,.64,1)'});

  toast('success', titles[type] + ' جاهزة! اضغطي "ارسمي" أو انقريي مرتين على الأداة');
  saveHistory();
}

function rotateGeoTool(btn){
  const tool = btn.closest('.geo-tool');
  let r = parseFloat(tool.dataset.rotation || 0);
  r = (r + 15) % 360;
  tool.dataset.rotation = r;
  const base = tool.style.transform.includes('translateX(-50%)') ? 'translateX(-50%)' : '';
  tool.style.transform = `${base} rotate(${r}deg)`;
}

function enterGeoDrawMode(tool){
  if(GeoState.active) exitGeoDrawMode();
  const type = tool.dataset.type;
  GeoState.active = true;
  GeoState.tool = type;
  GeoState.previewData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  tool.dataset.active = '1';
  tool.style.boxShadow = '0 0 0 3px #f9d423, 0 8px 28px rgba(0,0,0,0.25)';
  tool.style.opacity = '0.6';

  createMeasureTooltip();
  canvas.style.cursor = 'crosshair';
  toast('info', '✏️ وضع الرسم التفاعلي: حرّكي الماوس لتحديد الحجم ثم اتركي لترسيم');

  canvas.addEventListener('mousedown', geoDrawStart);
  canvas.addEventListener('mousemove', geoDrawMove);
  canvas.addEventListener('mouseup', geoDrawEnd);
  canvas.addEventListener('touchstart', geoTouchStart, {passive:false});
  canvas.addEventListener('touchmove', geoTouchMove, {passive:false});
  canvas.addEventListener('touchend', geoDrawEnd);
}

function exitGeoDrawMode(){
  GeoState.active = false;
  GeoState.tool = null;
  if(GeoState.previewData){
    ctx.putImageData(GeoState.previewData, 0, 0);
  }
  GeoState.previewData = null;
  removeMeasureTooltip();
  canvas.style.cursor = '';

  document.querySelectorAll('.geo-tool').forEach(t => {
    t.dataset.active = '0';
    t.style.boxShadow = '';
    t.style.opacity = '1';
  });

  canvas.removeEventListener('mousedown', geoDrawStart);
  canvas.removeEventListener('mousemove', geoDrawMove);
  canvas.removeEventListener('mouseup', geoDrawEnd);
  canvas.removeEventListener('touchstart', geoTouchStart);
  canvas.removeEventListener('touchmove', geoTouchMove);
  canvas.removeEventListener('touchend', geoDrawEnd);
}

function createMeasureTooltip(){
  if(GeoState.measureEl) return;
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;z-index:3000;background:rgba(15,52,96,0.92);color:#fff;padding:6px 14px;border-radius:20px;font-size:0.82rem;font-weight:800;font-family:Tajawal;pointer-events:none;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);display:none;`;
  document.body.appendChild(el);
  GeoState.measureEl = el;
}

function removeMeasureTooltip(){
  if(GeoState.measureEl){ GeoState.measureEl.remove(); GeoState.measureEl = null; }
}

function updateMeasure(x, y, text){
  if(!GeoState.measureEl) return;
  GeoState.measureEl.style.display = 'block';
  GeoState.measureEl.style.left = (x + 16) + 'px';
  GeoState.measureEl.style.top = (y - 12) + 'px';
  GeoState.measureEl.textContent = text;
}

function hideMeasure(){
  if(GeoState.measureEl) GeoState.measureEl.style.display = 'none';
}

function geoTouchStart(e){
  e.preventDefault();
  const t = e.touches[0];
  geoDrawStart({clientX: t.clientX, clientY: t.clientY});
}
function geoTouchMove(e){
  e.preventDefault();
  const t = e.touches[0];
  geoDrawMove({clientX: t.clientX, clientY: t.clientY});
}

function geoDrawStart(e){
  if(!GeoState.active) return;
  const pos = getPos(e);
  GeoState.startX = pos.x;
  GeoState.startY = pos.y;
  GeoState.isDrawing = true;
  GeoState.previewData = ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function geoDrawMove(e){
  if(!GeoState.active || !GeoState.isDrawing) return;
  const pos = getPos(e);
  let x1 = GeoState.startX, y1 = GeoState.startY;
  let x2 = pos.x, y2 = pos.y;

  if(GeoState.previewData){
    ctx.putImageData(GeoState.previewData, 0, 0);
  }

  if(GeoState.snap && GeoState.tool !== 'compass'){
    const dx = x2 - x1, dy = y2 - y1;
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const snapAngle = Math.round(angle / 15) * 15;
    const rad = snapAngle * Math.PI / 180;
    const dist = Math.sqrt(dx*dx + dy*dy);
    x2 = x1 + dist * Math.cos(rad);
    y2 = y1 + dist * Math.sin(rad);
  }

  ctx.save();
  ctx.strokeStyle = State.color;
  ctx.lineWidth = State.brushSize;
  ctx.setLineDash([6, 4]);
  ctx.globalAlpha = 0.6;

  const tool = GeoState.tool;
  let measureText = '';

  if(tool === 'ruler'){
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const len = Math.round(Math.sqrt((x2-x1)**2 + (y2-y1)**2));
    measureText = `الطول: ${len} بكسل`;

  } else if(tool === 'compass'){
    const r = Math.sqrt((x2-x1)**2 + (y2-y1)**2);
    ctx.beginPath();
    ctx.arc(x1, y1, r, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1-6, y1); ctx.lineTo(x1+6, y1);
    ctx.moveTo(x1, y1-6); ctx.lineTo(x1, y1+6);
    ctx.stroke();
    measureText = `نصف القطر: ${Math.round(r)} بكسل`;

  } else if(tool === 'protractor'){
    const dx = x2 - x1, dy = y2 - y1;
    let angle = Math.atan2(-dy, dx);
    if(angle < 0) angle += Math.PI*2;
    const deg = Math.round(angle * 180 / Math.PI);
    const r = 120;
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + r, y1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x1, y1, r, 0, -angle, true);
    ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    measureText = `الزاوية: ${deg}°`;

  } else if(tool === 'setsquare'){
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y1);
    ctx.lineTo(x1, y2);
    ctx.closePath();
    ctx.stroke();
    const m = 12;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1 + m, y1);
    ctx.lineTo(x1 + m, y1 + m);
    ctx.lineTo(x1, y1 + m);
    ctx.stroke();
    const w = Math.abs(x2-x1), h = Math.abs(y2-y1);
    measureText = `قائم: ${Math.round(w)} × ${Math.round(h)}`;
  }

  ctx.restore();
  updateMeasure(e.clientX || x2, e.clientY || y2, measureText);
}

function geoDrawEnd(e){
  if(!GeoState.active || !GeoState.isDrawing) return;
  GeoState.isDrawing = false;
  hideMeasure();

  const pos = getPos(e);
  let x1 = GeoState.startX, y1 = GeoState.startY;
  let x2 = pos.x, y2 = pos.y;

  if(GeoState.snap && GeoState.tool !== 'compass'){
    const dx = x2 - x1, dy = y2 - y1;
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;
    const snapAngle = Math.round(angle / 15) * 15;
    const rad = snapAngle * Math.PI / 180;
    const dist = Math.sqrt(dx*dx + dy*dy);
    x2 = x1 + dist * Math.cos(rad);
    y2 = y1 + dist * Math.sin(rad);
  }

  if(GeoState.previewData){
    ctx.putImageData(GeoState.previewData, 0, 0);
  }

  ctx.save();
  ctx.strokeStyle = State.color;
  ctx.fillStyle = State.fill ? State.color : 'transparent';
  ctx.lineWidth = State.brushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if(State.dashed) ctx.setLineDash([10, 6]); else ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  const tool = GeoState.tool;

  if(tool === 'ruler'){
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const len = Math.sqrt((x2-x1)**2 + (y2-y1)**2);
    const nx = (x2-x1)/len, ny = (y2-y1)/len;
    const px = -ny, py = nx;
    ctx.lineWidth = Math.max(1, State.brushSize * 0.5);
    for(let i=0; i<len; i+=10){
      const t = i/len;
      const cx = x1 + (x2-x1)*t;
      const cy = y1 + (y2-y1)*t;
      const tick = (i%50===0) ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(cx + px*tick, cy + py*tick);
      ctx.lineTo(cx - px*tick, cy - py*tick);
      ctx.stroke();
    }

  } else if(tool === 'compass'){
    const r = Math.sqrt((x2-x1)**2 + (y2-y1)**2);
    ctx.beginPath();
    ctx.arc(x1, y1, r, 0, Math.PI*2);
    if(State.fill) ctx.fill();
    ctx.stroke();
    ctx.fillStyle = State.color;
    ctx.beginPath();
    ctx.arc(x1, y1, State.brushSize*1.2, 0, Math.PI*2);
    ctx.fill();

  } else if(tool === 'protractor'){
    const dx = x2 - x1, dy = y2 - y1;
    let angle = Math.atan2(-dy, dx);
    if(angle < 0) angle += Math.PI*2;
    const r = 120;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + r, y1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x1, y1, r, 0, -angle, true);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const deg = Math.round(angle * 180 / Math.PI);
    ctx.font = `bold ${Math.max(14, State.brushSize*3)}px Tajawal`;
    ctx.fillStyle = State.color;
    ctx.textAlign = 'center';
    ctx.fillText(`${deg}°`, x1 + r*0.6*Math.cos(-angle/2), y1 + r*0.6*Math.sin(-angle/2));

  } else if(tool === 'setsquare'){
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y1);
    ctx.lineTo(x1, y2);
    ctx.closePath();
    if(State.fill) ctx.fill();
    ctx.stroke();
    const m = 12;
    ctx.beginPath();
    ctx.moveTo(x1 + m, y1);
    ctx.lineTo(x1 + m, y1 + m);
    ctx.lineTo(x1, y1 + m);
    ctx.stroke();
  }

  ctx.restore();
  saveHistory();
  playClick();
  toast('success', '✓ تم الترسيم بنجاح! ارسمي مرة أخرى أو اضغطي ESC للخروج');
}

document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && GeoState.active){
    exitGeoDrawMode();
    toast('info', 'تم الخروج من وضع الرسم التفاعلي');
  }
});

function addRuler(){ createGeoTool('ruler'); }
function addProtractor(){ createGeoTool('protractor'); }
function addCompass(){ createGeoTool('compass'); }
function addSetsquare(){ createGeoTool('setsquare'); }

/* CASIO SCIENTIFIC CALCULATOR (fx-991ES PLUS style) */
const Calc={display:'0',history:'',expression:'',reset:false,shiftOn:false,alphaOn:false,angle:'DEG',memory:0,lastAns:0};
function _formatNum(n){
  if(n===undefined||n===null)return'0';
  if(!isFinite(n))return n>0?'∞':n<0?'-∞':'NaN';
  if(Math.abs(n)<1e-10&&n!==0)return n.toExponential(6);
  // قص الأصفار الزائدة مع الحفاظ على دقة معقولة
  let s=String(n);
  if(s.includes('e'))return s;
  if(s.includes('.')){
    s=parseFloat(n.toFixed(10)).toString();
  }
  return s;
}
function _pushExpr(tok){
  if(Calc.reset&&!/[+\-*/%^×÷\(]/.test(tok)){Calc.display='0';Calc.reset=false;}
  if(Calc.display==='0'&&!/[+\-*/%^×÷\(\.!πe]/.test(tok)&&tok!==')'&&tok!=='(')Calc.display='';
  // منع تكرار العوامل
  const last=Calc.display.slice(-1);
  if(/[+\-*/%^×÷]/.test(tok)&&/[+\-*/%^×÷]/.test(last))Calc.display=Calc.display.slice(0,-1);
  if(tok==='.'){
    // لا تضع نقطتين في نفس الرقم
    const seg=Calc.display.split(/[+\-*/%^×÷()]/).pop();
    if(seg.includes('.'))return;
    if(seg==='')Calc.display+='0';
  }
  Calc.display+=tok;
  updateCalcDisplay();
}
function calcInput(v){
  // عرض × و ÷ كرموز عربية في الشاشة
  const displayMap={'*':'×','/':'÷'};
  const tok=displayMap[v]!==undefined?displayMap[v]:v;
  _pushExpr(tok);
}
function calcFunc(fn){
  try{
    // عند SHIFT: تنفيذ الوظيفة الثانوية (inverse) أو ثابت بديل
    if(Calc.shiftOn){
      Calc.shiftOn=false;
      document.querySelectorAll('.calc-key').forEach(k=>k.classList.remove('shift-active'));
      const mi=document.getElementById('calcModeShift');if(mi)mi.style.opacity='.4';
      // ثوابت بديلة: π→e, EXP→π
      if(fn==='pi'){Calc.history='e';Calc.display=_formatNum(Math.E);Calc.reset=true;updateCalcDisplay();return;}
      if(fn==='exp'){Calc.history='π';Calc.display=_formatNum(Math.PI);Calc.reset=true;updateCalcDisplay();return;}
      if(fn==='ans'){toggleCalcAngle();return;}
      // وظائف معكوسة
      let v;
      try{v=parseFloat(_evalExpr(Calc.display));}catch(e){v=parseFloat(Calc.display)||0;}
      let r;
      if(fn==='sin')r=Math.asin(v)*180/Math.PI;       // sin⁻¹
      else if(fn==='cos')r=Math.acos(v)*180/Math.PI;  // cos⁻¹
      else if(fn==='tan')r=Math.atan(v)*180/Math.PI;  // tan⁻¹
      else if(fn==='sq')r=Math.sqrt(v);                // √x
      else if(fn==='pow')r=Math.log(v)/Math.log(2);    // 2ˣ
      else if(fn==='log')r=Math.pow(10,v);             // 10ˣ
      else if(fn==='ln')r=Math.exp(v);                 // eˣ
      else if(fn==='sqrt')r=v*v;                       // x²
      else if(fn==='fact'){                            // 1/x
        r=(v===0)?(toast('error','القسمة على صفر'),0):1/v;
      }
      else if(fn==='inv')r=1/v;                        // x
      else if(fn==='pow10')r=Math.pow(10,v);           // 10ˣ
      else r=v;
      Calc.history=`${fn}⁻¹(${Calc.display}) =`;
      Calc.display=_formatNum(r);Calc.reset=true;updateCalcDisplay();return;
    }
    // وظائف تتطلب إغلاق القوس
    if(fn==='sqrt'){_pushExpr('√(');return;}
    if(fn==='pow'){_pushExpr('^(');return;}
    if(fn==='sq'){_pushExpr('²');return;}
    if(fn==='log'){_pushExpr('log(');return;}
    if(fn==='ln'){_pushExpr('ln(');return;}
    if(fn==='sin'||fn==='cos'||fn==='tan'){_pushExpr(fn+'(');return;}
    if(fn==='pi'){_pushExpr('π');return;}
    if(fn==='inv'){_pushExpr('^(-1)');return;}
    if(fn==='fact'){_pushExpr('!');return;}
    if(fn==='exp'){_pushExpr('E');return;}
    if(fn==='pow10'){_pushExpr('×10^(');return;}
    if(fn==='rand'){const r=Math.random();Calc.history='RAND =';Calc.display=_formatNum(r);Calc.reset=true;updateCalcDisplay();return;}
    if(fn==='mplus'){try{Calc.memory+=parseFloat(_evalExpr(Calc.display))||0;}catch(e){}document.getElementById('calcModeM').classList.add('on');updateCalcDisplay();toast('info','M+ → '+_formatNum(Calc.memory));return;}
    if(fn==='ans'){
      _pushExpr('Ans');
      return;
    }
  }catch(e){toast('error','خطأ');console.error(e);}
  updateCalcDisplay();
}
function calcAction(act){
  if(act==='ac'){
    Calc.display='0';Calc.history='';Calc.reset=false;
    Calc.shiftOn=false;Calc.alphaOn=false;
    document.querySelectorAll('.calc-key').forEach(k=>{k.classList.remove('shift-active');k.classList.remove('alpha-active');});
    const mi=document.getElementById('calcModeShift');if(mi)mi.style.opacity='.4';
  }
  else if(act==='clear'){
    // DEL: احذف آخر حرف
    if(Calc.display.length<=1)Calc.display='0';
    else Calc.display=Calc.display.slice(0,-1);
  }
  else if(act==='eq'){
    try{
      let expr=Calc.display;
      // استبدل الرموز الخاصة
      expr=expr.replace(/×/g,'*').replace(/÷/g,'/');
      expr=expr.replace(/π/g,'('+Math.PI+')').replace(/E/g,'e');
      // المعاملات
      expr=expr.replace(/√\(/g,'Math.sqrt(');
      expr=expr.replace(/log\(/g,'Math.log10(');
      expr=expr.replace(/ln\(/g,'Math.log(');
      expr=expr.replace(/\bsin\(/g,'(function(x){return Math.sin(x*'+(Calc.angle==='DEG'?'Math.PI/180':'1')+');})(');
      expr=expr.replace(/\bcos\(/g,'(function(x){return Math.cos(x*'+(Calc.angle==='DEG'?'Math.PI/180':'1')+');})(');
      expr=expr.replace(/\btan\(/g,'(function(x){return Math.tan(x*'+(Calc.angle==='DEG'?'Math.PI/180':'1')+');})(');
      // الأس
      expr=expr.replace(/\^/g,'**');
      // المضروب n!
      expr=expr.replace(/(\d+(?:\.\d+)?|\([^()]+\))!/g,'(function(n){if(n<0||!Number.isInteger(n))return NaN;let r=1;for(let i=2;i<=n;i++)r*=i;return r;})($1)');
      // المربع x²
      expr=expr.replace(/(\d+(?:\.\d+)?|\([^()]+\))²/g,'(($1)**2)');
      // Ans
      expr=expr.replace(/Ans/g,'('+Calc.lastAns+')');
      // أضف أقواس إغلاق تلقائياً
      let openCount=(expr.match(/\(/g)||[]).length;
      let closeCount=(expr.match(/\)/g)||[]).length;
      expr+=')'.repeat(Math.max(0,openCount-closeCount));
      // موازن
      Calc.history=Calc.display+' =';
      const r=Function('"use strict";return ('+expr+')')();
      if(!isFinite(r)&&!isNaN(r)){Calc.display=r>0?'∞':'-∞';}
      else if(isNaN(r)){Calc.display='خطأ';}
      else{
        const out=_formatNum(r);
        Calc.display=out;
        Calc.lastAns=r;
      }
      Calc.reset=true;
    }catch(e){Calc.display='خطأ';Calc.reset=true;}
  }
  else if(act==='toboard'){addCalcToBoard();return;}
  else if(act==='shift'){
    Calc.shiftOn=!Calc.shiftOn;Calc.alphaOn=false;
    document.querySelectorAll('.calc-key').forEach(k=>{k.classList.toggle('shift-active',Calc.shiftOn);k.classList.remove('alpha-active');});
    const mi=document.getElementById('calcModeShift');if(mi)mi.style.opacity=Calc.shiftOn?'1':'.4';
    return;
  }
  else if(act==='alpha'){
    Calc.alphaOn=!Calc.alphaOn;Calc.shiftOn=false;
    document.querySelectorAll('.calc-key').forEach(k=>{k.classList.toggle('alpha-active',Calc.alphaOn);k.classList.remove('shift-active');});
    const mi=document.getElementById('calcModeShift');if(mi)mi.style.opacity=Calc.shiftOn?'1':'.4';
    return;
  }
  else if(act==='sign'){
    // عكس إشارة آخر رقم
    const m=Calc.display.match(/(-?\d+(\.\d+)?|\([^()]+\))(?!.*[\d)])/);
    if(m){
      const found=m[0];
      const idx=Calc.display.lastIndexOf(found);
      if(found.startsWith('-'))Calc.display=Calc.display.slice(0,idx)+found.slice(1);
      else Calc.display=Calc.display.slice(0,idx)+'('+(-parseFloat(found))+')';
    }
  }
  else if(act==='mode'){
    // دوران بين الأوضاع: DEG → RAD → GRAD
    if(Calc.angle==='DEG')Calc.angle='RAD';
    else if(Calc.angle==='RAD')Calc.angle='GRAD';
    else Calc.angle='DEG';
    const el=document.getElementById('calcModeAngle');if(el)el.textContent=Calc.angle;
    toast('info','وحدة الزوايا: '+Calc.angle);
  }
  else if(act==='setup'){
    // امسح الذاكرة
    Calc.memory=0;
    document.getElementById('calcModeM').classList.remove('on');
    toast('info','تم مسح الذاكرة M');
  }
  updateCalcDisplay();
}
function _evalExpr(s){
  let expr=s.replace(/×/g,'*').replace(/÷/g,'/');
  expr=expr.replace(/π/g,'('+Math.PI+')').replace(/E/g,'e');
  expr=expr.replace(/√\(/g,'Math.sqrt(');
  expr=expr.replace(/log\(/g,'Math.log10(');
  expr=expr.replace(/ln\(/g,'Math.log(');
  expr=expr.replace(/\^/g,'**');
  expr=expr.replace(/Ans/g,'('+Calc.lastAns+')');
  let openCount=(expr.match(/\(/g)||[]).length;
  let closeCount=(expr.match(/\)/g)||[]).length;
  expr+=')'.repeat(Math.max(0,openCount-closeCount));
  return Function('"use strict";return ('+expr+')')();
}
function toggleCalcAngle(){
  if(Calc.angle==='DEG')Calc.angle='RAD';
  else if(Calc.angle==='RAD')Calc.angle='GRAD';
  else Calc.angle='DEG';
  const el=document.getElementById('calcModeAngle');if(el)el.textContent=Calc.angle;
  toast('info','الزوايا: '+Calc.angle);
}
function toggleCalcMode(mode){
  if(mode==='M'){
    if(Calc.memory!==0)Calc.memory=0;
    document.getElementById('calcModeM').classList.remove('on');
    toast('info','تم مسح الذاكرة');
  }
}
function addCalcToBoard(){const val=Calc.display;if(!val||val==='0'||val==='خطأ'){toast('error','لا توجد نتيجة');return;}const fs=parseInt(Data.settings.fontSize)||20;ctx.save();ctx.fillStyle=State.color;ctx.font=`bold ${fs*1.5}px Tajawal,sans-serif`;ctx.textBaseline='top';ctx.direction='rtl';const w=ctx.measureText(val).width;const dpr=window.devicePixelRatio||1;const x=canvas.width/dpr/2-w/2;const y=canvas.height/dpr/2-fs;ctx.fillText('= '+val,x,y);ctx.restore();saveHistory();toast('success','تمت الإضافة للسبورة: '+val);}
function updateCalcDisplay(){
  const dEl=document.getElementById('calcDisplay');
  const hEl=document.getElementById('calcHistory');
  if(dEl)dEl.textContent=Calc.display;
  if(hEl)hEl.textContent=Calc.history;
}
// اختصارات لوحة المفاتيح
document.addEventListener('keydown',e=>{
  if(!document.getElementById('calcPanel').classList.contains('active'))return;
  if(['0','1','2','3','4','5','6','7','8','9'].includes(e.key)){calcInput(e.key);e.preventDefault();}
  else if(e.key==='.'){calcInput('.');e.preventDefault();}
  else if(e.key==='+'){calcInput('+');e.preventDefault();}
  else if(e.key==='-'){calcInput('-');e.preventDefault();}
  else if(e.key==='*'){calcInput('*');e.preventDefault();}
  else if(e.key==='/'){calcInput('/');e.preventDefault();}
  else if(e.key==='%'){calcInput('%');e.preventDefault();}
  else if(e.key==='('||e.key===')'){calcInput(e.key);e.preventDefault();}
  else if(e.key==='Enter'||e.key==='='){calcAction('eq');e.preventDefault();}
  else if(e.key==='Backspace'){calcAction('clear');e.preventDefault();}
  else if(e.key==='Escape'||e.key==='Delete'){calcAction('ac');e.preventDefault();}
});

/* TIMER */
function openTimerModal(){
  openModal('modalTimer');
  // مزامنة عناصر التحكم بالصوت مع القيم الحالية
  const volSlider=document.getElementById('timerVolume');
  const volLabel=document.getElementById('timerVolumeLabel');
  const sndSel=document.getElementById('timerSoundType');
  const tickSel=document.getElementById('timerTickType');
  if(volSlider){volSlider.value=Math.round(State.timer.volume*100);if(volLabel)volLabel.textContent=volSlider.value+'%';}
  if(sndSel)sndSel.value=State.timer.soundType||'elegant';
  if(tickSel)tickSel.value=State.timer.tickType||'classic_clock';
  setTimerMode('stopwatch');
}
function setTimerMode(mode){
  State.timer.mode=mode;
  ['Stopwatch','Countdown','Pomodoro'].forEach(m=>document.getElementById('mode'+m).classList.remove('selected'));
  document.getElementById('mode'+mode.charAt(0).toUpperCase()+mode.slice(1)).classList.add('selected');
  document.getElementById('countdownInputs').style.display=(mode==='countdown'||mode==='pomodoro')?'block':'none';
  if(mode==='pomodoro')document.getElementById('countdownMin').value=25;
  // إصلاح: اقرأي القيمة الحالية من حقل الإدخال دائماً (تحل مشكلة "يعد من 5" عندما تختارين 6)
  State.timer.totalSec=(parseInt(document.getElementById('countdownMin').value)||5)*60;
  State.timer.seconds=State.timer.totalSec;
  bigTimerRefresh();
}
function bigTimerToggle(){
  // إصلاح رئيسي: اقرأي قيمة الدقائق من الحقل مباشرة قبل بدء العد التنازلي
  // كان الخلل أن totalSec يبقى محفوظاً من آخر وضع (5) ولا يتحدث عند كتابة 6
  if(State.timer.running){
    // إيقاف
    State.timer.running=false;
    clearInterval(State.timer.interval);
    document.getElementById('bigTimerStart').innerHTML='<i class="fas fa-play"></i> ابدئي';
    return;
  }
  // بدء: حدّثي القيم من الحقل أولاً (لحل "يعد من 5" عندما تختارين 6)
  if(State.timer.mode==='countdown'||State.timer.mode==='pomodoro'){
    const v=parseInt(document.getElementById('countdownMin').value);
    State.timer.totalSec=(isNaN(v)?5:Math.max(1,v))*60;
    // إذا انتهى العداد (seconds=0) أو القيمة المخزنة أكبر من الجديدة (تغيّر المستخدم للمدخلات) → أعيدي الضبط
    if(State.timer.seconds<=0||State.timer.seconds>State.timer.totalSec||!State.timer.started)State.timer.seconds=State.timer.totalSec;
  }else{
    // إيقاف/ستوبوتش: لا تصفري القيمة إذا كان المستخدم قد بدأ سابقاً (استكمال)
    if(!State.timer.started)State.timer.seconds=0;
  }
  State.timer.started=true;
  State.timer.running=true;
  document.getElementById('bigTimerStart').innerHTML='<i class="fas fa-pause"></i> إيقاف';
  bigTimerRefresh();
  State.timer.interval=setInterval(()=>{
    if(State.timer.mode==='stopwatch'){State.timer.seconds++;}
    else{
      State.timer.seconds--;
      if(State.timer.seconds<=0){
        clearInterval(State.timer.interval);
        State.timer.running=false;
        document.getElementById('bigTimerStart').innerHTML='<i class="fas fa-play"></i> ابدئي';
        // تشغيل الصوت المميز + إشعار مرئي قوي
        playBeep();
        toast('success','⏰ انتهى الوقت!');
        try{navigator.vibrate&&navigator.vibrate([200,100,200,100,400]);}catch(e){}
        // إصلاح: عند الانتهاء ارجعي للقيمة من حقل الإدخال (وليس totalSec القديم)
        const v=parseInt(document.getElementById('countdownMin').value);
        State.timer.totalSec=(isNaN(v)?5:Math.max(1,v))*60;
        State.timer.seconds=State.timer.totalSec;
      }
    }
    bigTimerRefresh();
  },1000);
}
function bigTimerReset(){
  State.timer.running=false;
  State.timer.started=false;
  clearInterval(State.timer.interval);
  if(State.timer.mode==='countdown'||State.timer.mode==='pomodoro'){
    const v=parseInt(document.getElementById('countdownMin').value);
    State.timer.totalSec=(isNaN(v)?5:Math.max(1,v))*60;
    State.timer.seconds=State.timer.totalSec;
  }else State.timer.seconds=0;
  bigTimerRefresh();
  document.getElementById('bigTimerStart').innerHTML='<i class="fas fa-play"></i> ابدئي';
}
function bigTimerRefresh(){
  const s=Math.max(0,Math.floor(State.timer.seconds));
  const m=Math.floor(s/60),sec=s%60;
  document.getElementById('bigTimerDisplay').textContent=`${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

// تحديث مباشر للعرض عند تغيير الدقائق (تحسين UX)
function bigTimerLiveUpdate(){
  if(State.timer.running)return; // لا نتدخل أثناء التشغيل
  const v=parseInt(document.getElementById('countdownMin').value);
  if(isNaN(v)||v<1)return;
  if(State.timer.mode==='countdown'||State.timer.mode==='pomodoro'){
    State.timer.totalSec=v*60;
    State.timer.seconds=State.timer.totalSec;
    bigTimerRefresh();
  }
}

// محدّث مستوى الصوت
function updateTimerVolume(v){
  State.timer.volume=Math.max(0,Math.min(1,v/100));
  const lbl=document.getElementById('timerVolumeLabel');
  if(lbl)lbl.textContent=v+'%';
}

// تشغيل معاينة للصوت
function previewTimerSound(){playBeep();}

// تشغيل معاينة لصوت الدقات — يعزف 3 دقات متتالية (tick, tock, tick)
function previewTimerTick(){
  if(!State.timer)State.timer={};
  if(!State.timer.tickType)State.timer.tickType='classic_clock';
  // استخدم محاكاة: نخزن الثانية الحالية مؤقتاً ونستعيدها
  const _origSec=(typeof boardTimerState!=='undefined' && boardTimerState.seconds)||0;
  // عزف 3 دقات (محاكاة الثواني المتعاقبة)
  for(let i=0;i<3;i++){
    setTimeout(()=>{
      if(typeof boardTimerState!=='undefined')boardTimerState.seconds=10-i;
      playTick();
      if(i===2)setTimeout(()=>{if(typeof boardTimerState!=='undefined')boardTimerState.seconds=_origSec;},200);
    },i*180);
  }
}

/* تغيير صوت المؤقت + معاينة فورية */
function onTimerSoundChange(val){
  State.timer.soundType=val;
  // مزامنة قائمة الاختيار الصغيرة في المؤقت على السبورة (إن وُجدت)
  const sm=document.getElementById('btSoundType');
  if(sm)sm.value=val;
  // تأثير بصري لطيف على القائمة المختارة
  const cur=document.getElementById('timerSoundType');
  if(cur){
    cur.classList.remove('sound-pulse');
    void cur.offsetWidth; // force reflow
    cur.classList.add('sound-pulse');
  }
  if(sm){
    sm.classList.remove('sound-pulse');
    void sm.offsetWidth;
    sm.classList.add('sound-pulse');
  }
  // معاينة فورية للصوت الجديد
  setTimeout(()=>playBeep(),80);
}

/* تغيير صوت الدقات + معاينة فورية */
function onTimerTickChange(val){
  if(!State.timer)State.timer={};
  State.timer.tickType=val;
  // مزامنة قائمة الاختيار الصغيرة في المؤقت على السبورة (إن وُجدت)
  const sm=document.getElementById('btTickType');
  if(sm)sm.value=val;
  const cur=document.getElementById('timerTickType');
  if(cur){
    cur.classList.remove('sound-pulse');
    void cur.offsetWidth;
    cur.classList.add('sound-pulse');
  }
  if(sm){
    sm.classList.remove('sound-pulse');
    void sm.offsetWidth;
    sm.classList.add('sound-pulse');
  }
  // معاينة فورية (3 دقات متتالية)
  previewTimerTick();
}

/* نغمة تك خفيفة تتكرر كل ثانية خلال العد التنازلي — يقرأ مستوى الصوت live كل مرة */
function playTick(){
  try{
    const tickType=(State.timer && State.timer.tickType)||'classic_clock';
    if(tickType==='silent')return; // صامت — لا صوت
    const vol=(typeof State.timer.volume==='number')?State.timer.volume:0.85;
    if(vol<=0)return; // مكتوم
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx)return;
    const ctx=new AudioCtx();
    const masterGain=ctx.createGain();
    masterGain.gain.value=1.0;
    masterGain.connect(ctx.destination);
    // احصل على رقم الثانية لتناوب صوت الساعة الكلاسيكية
    const sec=(typeof boardTimerState!=='undefined' && boardTimerState.seconds)||0;
    const isHigh=(sec%2===0); // true=tick (عالي), false=tock (منخفض)
    const t=ctx.currentTime;

    // أداة مساعدة: ضوضاء ميكانيكية قصيرة جداً (نقرة آلية)
    const playMechanismClick=(peakFreq,durSec=0.04,peak=0.20)=>{
      const bufSize=Math.floor(ctx.sampleRate*durSec);
      const buf=ctx.createBuffer(1,bufSize,ctx.sampleRate);
      const d=buf.getChannelData(0);
      for(let i=0;i<bufSize;i++){d[i]=(Math.random()*2-1)*Math.exp(-i/(ctx.sampleRate*0.005));}
      const ns=ctx.createBufferSource();ns.buffer=buf;
      const filt=ctx.createBiquadFilter();filt.type='bandpass';
      filt.frequency.value=peakFreq;filt.Q.value=2;
      const ng=ctx.createGain();
      ng.gain.setValueAtTime(peak*vol,t);
      ng.gain.exponentialRampToValueAtTime(0.0008,t+durSec);
      ns.connect(filt);filt.connect(ng);ng.connect(masterGain);
      ns.start(t);ns.stop(t+durSec+0.01);
    };

    switch(tickType){

      case 'classic_clock':{ // 🕰 ساعة كلاسيكية قديمة (tick-tock متبادل شهير)
        // نغمة tick عالية (1100Hz) أو tock منخفضة (750Hz)
        const osc=ctx.createOscillator();
        const gain=ctx.createGain();
        osc.type='sine';
        const freq=isHigh?1100:750;
        osc.frequency.setValueAtTime(freq,t);
        gain.gain.setValueAtTime(0,t);
        gain.gain.linearRampToValueAtTime(0.30*vol,t+0.003);
        gain.gain.exponentialRampToValueAtTime(0.0008,t+0.07);
        osc.connect(gain);gain.connect(masterGain);
        osc.start(t);osc.stop(t+0.08);
        // نقرة ميكانيكية لآلية الساعة (يكون التردد مختلف بين tick و tock)
        playMechanismClick(isHigh?2400:1700,0.035,0.22);
        // توافقي خفيف لتعزيز الجسم
        const osc2=ctx.createOscillator();
        const gain2=ctx.createGain();
        osc2.type='triangle';
        osc2.frequency.setValueAtTime(freq*1.5,t);
        gain2.gain.setValueAtTime(0,t);
        gain2.gain.linearRampToValueAtTime(0.10*vol,t+0.002);
        gain2.gain.exponentialRampToValueAtTime(0.0008,t+0.05);
        osc2.connect(gain2);gain2.connect(masterGain);
        osc2.start(t);osc2.stop(t+0.06);
        break;
      }

      case 'pendulum':{ // ⏱ بندول أنيق (نغمة واحدة ناعمة متكررة)
        const osc=ctx.createOscillator();
        const gain=ctx.createGain();
        osc.type='sine';
        osc.frequency.setValueAtTime(520,t);
        osc.frequency.exponentialRampToValueAtTime(380,t+0.05);
        gain.gain.setValueAtTime(0,t);
        gain.gain.linearRampToValueAtTime(0.28*vol,t+0.003);
        gain.gain.exponentialRampToValueAtTime(0.0008,t+0.09);
        osc.connect(gain);gain.connect(masterGain);
        osc.start(t);osc.stop(t+0.10);
        playMechanismClick(1800,0.03,0.14);
        break;
      }

      case 'wooden':{ // 🪵 خشبي دافئ (نقرة خشب ناعمة)
        const osc=ctx.createOscillator();
        const gain=ctx.createGain();
        osc.type='triangle';
        osc.frequency.setValueAtTime(360,t);
        osc.frequency.exponentialRampToValueAtTime(230,t+0.05);
        gain.gain.setValueAtTime(0,t);
        gain.gain.linearRampToValueAtTime(0.30*vol,t+0.003);
        gain.gain.exponentialRampToValueAtTime(0.0008,t+0.11);
        osc.connect(gain);gain.connect(masterGain);
        osc.start(t);osc.stop(t+0.12);
        const osc2=ctx.createOscillator();
        const gain2=ctx.createGain();
        osc2.type='sine';
        osc2.frequency.setValueAtTime(720,t);
        osc2.frequency.exponentialRampToValueAtTime(460,t+0.04);
        gain2.gain.setValueAtTime(0,t);
        gain2.gain.linearRampToValueAtTime(0.13*vol,t+0.002);
        gain2.gain.exponentialRampToValueAtTime(0.0008,t+0.07);
        osc2.connect(gain2);gain2.connect(masterGain);
        osc2.start(t);osc2.stop(t+0.08);
        playMechanismClick(1400,0.05,0.18);
        break;
      }

      case 'crystal':{ // 💎 كريستال (جرس زجاجي ناعم)
        const osc=ctx.createOscillator();
        const gain=ctx.createGain();
        osc.type='sine';
        osc.frequency.setValueAtTime(1480,t);
        osc.frequency.exponentialRampToValueAtTime(820,t+0.07);
        gain.gain.setValueAtTime(0,t);
        gain.gain.linearRampToValueAtTime(0.22*vol,t+0.004);
        gain.gain.exponentialRampToValueAtTime(0.0008,t+0.09);
        osc.connect(gain);gain.connect(masterGain);
        osc.start(t);osc.stop(t+0.10);
        const osc2=ctx.createOscillator();
        const gain2=ctx.createGain();
        osc2.type='triangle';
        osc2.frequency.setValueAtTime(2960,t);
        osc2.frequency.exponentialRampToValueAtTime(1640,t+0.05);
        gain2.gain.setValueAtTime(0,t);
        gain2.gain.linearRampToValueAtTime(0.10*vol,t+0.003);
        gain2.gain.exponentialRampToValueAtTime(0.0008,t+0.06);
        osc2.connect(gain2);gain2.connect(masterGain);
        osc2.start(t);osc2.stop(t+0.07);
        break;
      }

      case 'pulse':{ // 💓 نبضة عميقة (bass ناعم)
        const osc=ctx.createOscillator();
        const gain=ctx.createGain();
        osc.type='sine';
        osc.frequency.setValueAtTime(180,t);
        osc.frequency.exponentialRampToValueAtTime(120,t+0.05);
        gain.gain.setValueAtTime(0,t);
        gain.gain.linearRampToValueAtTime(0.35*vol,t+0.003);
        gain.gain.exponentialRampToValueAtTime(0.0008,t+0.10);
        osc.connect(gain);gain.connect(masterGain);
        osc.start(t);osc.stop(t+0.11);
        const osc2=ctx.createOscillator();
        const gain2=ctx.createGain();
        osc2.type='sine';
        osc2.frequency.setValueAtTime(360,t);
        osc2.frequency.exponentialRampToValueAtTime(240,t+0.04);
        gain2.gain.setValueAtTime(0,t);
        gain2.gain.linearRampToValueAtTime(0.15*vol,t+0.002);
        gain2.gain.exponentialRampToValueAtTime(0.0008,t+0.07);
        osc2.connect(gain2);gain2.connect(masterGain);
        osc2.start(t);osc2.stop(t+0.08);
        break;
      }

      case 'beep':{ // 📟 بيب إلكتروني ناعم
        const osc=ctx.createOscillator();
        const gain=ctx.createGain();
        osc.type='sine';
        osc.frequency.setValueAtTime(880,t);
        gain.gain.setValueAtTime(0,t);
        gain.gain.linearRampToValueAtTime(0.22*vol,t+0.004);
        gain.gain.exponentialRampToValueAtTime(0.0008,t+0.06);
        osc.connect(gain);gain.connect(masterGain);
        osc.start(t);osc.stop(t+0.07);
        break;
      }

      default:{
        // احتياطي: نفس النغمة الافتراضية (ساعة كلاسيكية)
        const osc=ctx.createOscillator();
        const gain=ctx.createGain();
        osc.type='sine';
        const freq=isHigh?1100:750;
        osc.frequency.setValueAtTime(freq,t);
        gain.gain.setValueAtTime(0,t);
        gain.gain.linearRampToValueAtTime(0.30*vol,t+0.003);
        gain.gain.exponentialRampToValueAtTime(0.0008,t+0.07);
        osc.connect(gain);gain.connect(masterGain);
        osc.start(t);osc.stop(t+0.08);
        playMechanismClick(isHigh?2400:1700,0.035,0.22);
      }
    }

    setTimeout(()=>{try{ctx.close();}catch(e){}},200);
  }catch(e){}
}

/* رفع/خفض مستوى الصوت مباشرةً (يحدّث State.timer.volume ويُحدّث الواجهة) */
function bumpBoardTimerVolume(delta){
  if(!boardTimerState.el)return;
  const cur=Math.round((State.timer.volume||0)*100);
  const next=Math.max(0,Math.min(100,cur+delta));
  State.timer.volume=next/100;
  // مزامنة شريط الصوت في النافذة المنبثقة إن وُجد
  const sl=document.getElementById('timerVolume');
  const lbl=document.getElementById('timerVolumeLabel');
  if(sl)sl.value=next;
  if(lbl)lbl.textContent=next+'%';
  updateBoardTimerVolumeUI();
}

function toggleBoardTimerMute(){
  if(!boardTimerState.el)return;
  // احفظ المستوى قبل الكتم لاستعادته عند إعادة الصوت
  if(typeof State.timer._savedVol!=='number'){
    State.timer._savedVol=State.timer.volume||0.85;
  }
  const isMuted=(State.timer.volume||0)<=0.001;
  const newVol=isMuted? (State.timer._savedVol||0.85) : 0;
  State.timer.volume=newVol;
  const pct=Math.round(newVol*100);
  const sl=document.getElementById('timerVolume');
  const lbl=document.getElementById('timerVolumeLabel');
  if(sl)sl.value=pct;
  if(lbl)lbl.textContent=pct+'%';
  updateBoardTimerVolumeUI();
}

/* حدّث أيقونة الكتم والـ tooltip على المؤقت */
function updateBoardTimerVolumeUI(){
  if(!boardTimerState.el)return;
  const btn=boardTimerState.el.querySelector('.bt-vol-btn');
  if(!btn)return;
  const icon=btn.querySelector('i');
  const v=State.timer.volume||0;
  if(v<=0.001){
    if(icon)icon.className='fas fa-volume-mute';
    btn.title='إعادة الصوت';
    btn.classList.add('muted');
  }else if(v<0.34){
    if(icon)icon.className='fas fa-volume-off';
    btn.title='كتم الصوت';
    btn.classList.remove('muted');
  }else if(v<0.67){
    if(icon)icon.className='fas fa-volume-down';
    btn.title='كتم الصوت';
    btn.classList.remove('muted');
  }else{
    if(icon)icon.className='fas fa-volume-up';
    btn.title='كتم الصوت';
    btn.classList.remove('muted');
  }
  // تحديث شريط المؤشر الصغير على المؤقت
  const bar=boardTimerState.el.querySelector('.bt-vol-fill');
  if(bar)bar.style.width=Math.round(v*100)+'%';
  // تحديث نسبة الصوت المعروضة لتطابق المستوى الفعلي
  const pctEl=document.getElementById('btVolPct');
  if(pctEl)pctEl.textContent=Math.round(v*100)+'%';
}

/* ⭐⭐⭐ نظام أصوات المؤقت المطوّر — 14 نغمة حلوة للاختيار من بينها ⭐⭐⭐
   - رنين صوتي (feedback delay) يجعل كل الأصوات أدفأ وأجمل
   - نغمات موسيقية حقيقية: تويـنكل، تهويدة، زن، عصفور، مقام عربي، بيانو...
   - نغمة "تك" الخفيفة أيضاً محسّنة.
*/
function playBeep(){
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx)return;
    const ctx=new AudioCtx();
    const vol=(typeof State.timer.volume==='number')?State.timer.volume:0.7;
    if(vol<=0)return; // الصوت مكتوم
    const soundType=State.timer.soundType||'elegant';

    // مضخّم رئيسي
    const masterGain=ctx.createGain();
    masterGain.gain.value=1.0;

    // ضاغط بسيط لتنعيم الذرى
    let compressor=null;
    try{
      compressor=ctx.createDynamicsCompressor();
      compressor.threshold.value=-20;
      compressor.knee.value=28;
      compressor.ratio.value=5;
      compressor.attack.value=0.003;
      compressor.release.value=0.22;
    }catch(e){}

    // 🎵 رنين صوتي ناعم (feedback delay) — يضيف عمق ودفء لكل النغمات
    const buildReverb=(wet=0.28,feedbackAmt=0.32,delaySec=0.18)=>{
      try{
        const input=ctx.createGain();
        const output=ctx.createGain();
        const delay=ctx.createDelay(1.0);
        const feedback=ctx.createGain();
        const wetGain=ctx.createGain();
        const dryGain=ctx.createGain();
        delay.delayTime.value=delaySec;
        feedback.gain.value=feedbackAmt;
        wetGain.gain.value=wet;
        dryGain.gain.value=1-wet*0.4;
        input.connect(dryGain);
        dryGain.connect(output);
        input.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wetGain);
        wetGain.connect(output);
        return {input,output};
      }catch(e){return {input:masterGain,output:masterGain};}
    };
    const reverb=buildReverb(0.32,0.35,0.18);
    // كل النغمات تذهب عبر الرنين الصوتي ثم إلى الضاغط/الوجهة
    if(compressor){
      reverb.output.connect(compressor);
      compressor.connect(ctx.destination);
    }else{
      reverb.output.connect(ctx.destination);
    }

    // أداة مساعدة: نغمة أساسية (تُرسل عبر الرنين الصوتي)
    const playTone=(freq,startTime,duration,oscType='sine',peak=0.5,detune=0)=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.type=oscType;
      osc.frequency.setValueAtTime(freq,startTime);
      if(detune)osc.detune.setValueAtTime(detune,startTime);
      gain.gain.setValueAtTime(0,startTime);
      gain.gain.linearRampToValueAtTime(peak*vol,startTime+0.018);
      gain.gain.exponentialRampToValueAtTime(0.0008,startTime+duration);
      osc.connect(gain);
      gain.connect(reverb.input);
      osc.start(startTime);
      osc.stop(startTime+duration+0.05);
    };

    // نغمة جرس غنية بالطبقات التوافقية
    const playBellTone=(freq,startTime,duration,peak=0.5,detune=0)=>{
      const fundamentals=[1,2,3,4.2,5.4];
      const weights=[1,0.5,0.32,0.18,0.08];
      fundamentals.forEach((mul,i)=>{
        const osc=ctx.createOscillator();
        const gain=ctx.createGain();
        osc.type='sine';
        osc.frequency.setValueAtTime(freq*mul,startTime);
        if(detune)osc.detune.setValueAtTime(detune,startTime);
        gain.gain.setValueAtTime(0,startTime);
        gain.gain.linearRampToValueAtTime(peak*vol*weights[i],startTime+0.006);
        gain.gain.exponentialRampToValueAtTime(0.0008,startTime+duration);
        osc.connect(gain);
        gain.connect(reverb.input);
        osc.start(startTime);
        osc.stop(startTime+duration+0.05);
      });
    };

    // نغمة بيانو (هجوم سريع + ذيل مع رنين)
    const playPianoNote=(freq,startTime,duration,peak=0.55)=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.type='triangle';
      osc.frequency.setValueAtTime(freq,startTime);
      gain.gain.setValueAtTime(0,startTime);
      gain.gain.linearRampToValueAtTime(peak*vol,startTime+0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001,startTime+duration);
      osc.connect(gain);
      gain.connect(reverb.input);
      osc.start(startTime);
      osc.stop(startTime+duration+0.05);
      // لمسة "الدق" المميزة للبيانو
      const click=ctx.createOscillator();
      const clickGain=ctx.createGain();
      click.type='sine';
      click.frequency.setValueAtTime(freq*2,startTime);
      clickGain.gain.setValueAtTime(0.2*vol,startTime);
      clickGain.gain.exponentialRampToValueAtTime(0.001,startTime+0.025);
      click.connect(clickGain);
      clickGain.connect(reverb.input);
      click.start(startTime);
      click.stop(startTime+0.03);
    };

    // صفير طائر صغير
    const playBirdChirp=(freq,startTime,peak=0.45)=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.type='sine';
      osc.frequency.setValueAtTime(freq,startTime);
      osc.frequency.linearRampToValueAtTime(freq*1.3,startTime+0.06);
      osc.frequency.linearRampToValueAtTime(freq*0.95,startTime+0.12);
      osc.frequency.linearRampToValueAtTime(freq*1.15,startTime+0.18);
      gain.gain.setValueAtTime(0,startTime);
      gain.gain.linearRampToValueAtTime(peak*vol,startTime+0.015);
      gain.gain.exponentialRampToValueAtTime(0.001,startTime+0.2);
      osc.connect(gain);
      gain.connect(reverb.input);
      osc.start(startTime);
      osc.stop(startTime+0.22);
    };

    const now=ctx.currentTime;

    // ترددات النوتات الموسيقية الأساسية (مقياس C4)
    const N={
      C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392.00, A4:440.00, B4:493.88,
      C5:523.25, D5:587.33, E5:659.25, F5:698.46, G5:783.99, A5:880.00, B5:987.77,
      C6:1046.50, D6:1174.66, E6:1318.51, F6:1396.91, G6:1567.98, A6:1760.00, B6:1975.53,
      C7:2093.00, G3:196.00, A3:220.00, Bb3:233.08, Eb3:155.56, F3:174.61, D3:146.83
    };

    switch(soundType){

      case 'elegant':{ // 💎 نغمة احترافية فاخرة — Cmaj7 متعدد الطبقات
        // 1) افتتاحية: أجراس كريستالية متلألئة (C major تصاعدي)
        [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => {
          playBellTone(f, now + i*0.11, 0.9, 0.6);
        });
        // 2) الوتر الرئيسي: Cmaj7 grand chord مع طبقتين
        const t1 = now + 0.55;
        // طبقة بيانو دافئة (الجذر + التوينات + السابع)
        [N.C4, N.E4, N.G4, N.B4].forEach(f => playPianoNote(f, t1, 3.0, 0.5));
        // طبقة أجراس متألقة فوق الوتر
        [N.G4, N.C5, N.E5, N.G5, N.B5, N.C6].forEach(f => playBellTone(f, t1+0.02, 2.6, 0.4));
        // 3) شذرات كريستالية في الخلفية
        for (let i = 0; i < 4; i++) {
          const o = i * 0.32;
          playBellTone(N.E6, t1 + 0.6 + o, 1.0, 0.42);
          playBellTone(N.G6, t1 + 0.65 + o, 0.9, 0.32);
        }
        // 4) خاتمة سماوية: C7 طويلة مع رنين
        playBellTone(N.C7, t1 + 1.6, 3.5, 0.55);
        playBellTone(N.G6, t1 + 1.7, 3.0, 0.4);
        break;
      }

      case 'crystal':{ // 💠 كريستال فاخر — صاعدة ثم وتر واسع
        // تصاعد سريع كريستالي
        [N.E5, N.G5, N.B5, N.D6, N.G6].forEach((f, i) => {
          playBellTone(f, now + i*0.09, 0.7, 0.55);
        });
        // وتر واسع Em9 (دافئ وعميق)
        const tc = now + 0.55;
        [N.E3, N.B3, N.E4, N.G4, N.B4].forEach(f => playBellTone(f, tc, 3.0, 0.5));
        [N.D5, N.F5, N.A5].forEach(f => playBellTone(f, tc+0.05, 2.5, 0.35));
        // سماوي
        playBellTone(N.B5, tc + 1.2, 2.5, 0.5);
        playBellTone(N.E6, tc + 1.4, 2.5, 0.45);
        break;
      }

      case 'sweet_bell':{ // 🌸 جرس لطيف دافئ
        for(let i=0;i<3;i++){
          const o=i*0.7;
          playBellTone(N.G5,now+o,1.4,0.85);
          playBellTone(N.E5,now+o+0.35,1.4,0.7);
        }
        break;
      }

      case 'twinkle':{ // ✨ تويـنكل توينكل (مهدئ جداً)
        const m1=[N.C4,N.C4,N.G4,N.G4,N.A4,N.A4,N.G4,N.F4,N.F4,N.E4,N.E4,N.D4,N.D4,N.C4];
        const dur=0.28;
        m1.forEach((f,i)=>playPianoNote(f,now+i*dur,dur*1.2,0.6));
        // خاتمة سماوية
        playBellTone(N.C5,now+m1.length*dur+0.05,1.6,0.6);
        playBellTone(N.G4,now+m1.length*dur+0.05,1.6,0.5);
        break;
      }

      case 'piano':{ // 🎹 وتر بيانو كبير
        // C major chord
        [N.C4,N.E4,N.G4,N.C5].forEach((f,i)=>playPianoNote(f,now,2.0,0.45));
        // تكرار أعلى
        [N.E5,N.G5,N.C6].forEach((f,i)=>playPianoNote(f,now+0.6+i*0.15,1.5,0.4));
        break;
      }

      case 'chime':{ // 🎵 نغمة تصاعدية (محسّنة بنعومة)
        const notes=[N.C5,N.E5,N.G5,N.C6];
        notes.forEach((f,i)=>playBellTone(f,now+i*0.22,1.0,0.7));
        // خاتمة مثلثة
        playBellTone(N.E6,now+1.0,1.4,0.55);
        break;
      }

      case 'lullaby':{ // 🌙 تهويدة هادئة
        // Twinkle melody هادئ
        const m=[N.C4,N.C4,N.G4,N.G4,N.A4,N.A4,N.G4];
        const m2=[N.F4,N.F4,N.E4,N.E4,N.D4,N.D4,N.C4];
        m.forEach((f,i)=>playPianoNote(f,now+i*0.45,0.7,0.4));
        m2.forEach((f,i)=>playPianoNote(f,now+(m.length+i)*0.45,0.7,0.4));
        break;
      }

      case 'zen':{ // 🪷 وعاء زن (رنين تأملي عميق)
        // رنين منخفض مع توافقيات
        playBellTone(N.G3,now,3.5,0.95);
        playBellTone(N.D4,now+0.02,3.0,0.65);
        playBellTone(N.G4,now+0.04,2.8,0.45);
        // لمسة كريستالية
        playBellTone(N.D5,now+0.08,2.5,0.4);
        break;
      }

      case 'arpeggio':{ // 🌈 أربيجيو صاعد (C major)
        const notes=[N.C4,N.E4,N.G4,N.C5,N.G5,N.C6];
        notes.forEach((f,i)=>playBellTone(f,now+i*0.18,1.0,0.65));
        // وتر ختامي
        [N.C4,N.E4,N.G4].forEach(f=>playBellTone(f,now+1.4,1.8,0.4));
        break;
      }

      case 'birds':{ // 🐦 صفير عصافير صباحي
        // 3 عصافير تغرد
        for(let i=0;i<3;i++){
          const o=i*0.55;
          playBirdChirp(2400+o*100,now+o,0.4);
          playBirdChirp(1800+o*120,now+o+0.25,0.35);
        }
        break;
      }

      case 'mary':{ // 🎵 Mary Had a Little Lamb
        // E D C D E E E D D D E G G
        const m=[N.E4,N.D4,N.C4,N.D4,N.E4,N.E4,N.E4,N.D4,N.D4,N.D4,N.E4,N.G4,N.G4];
        const dur=0.32;
        m.forEach((f,i)=>playPianoNote(f,now+i*dur,dur*1.1,0.5));
        // تكرار مرة أعلى
        const m2=[N.E5,N.D5,N.C5,N.D5,N.E5,N.E5,N.E5,N.D5,N.D5,N.D5,N.E5,N.G5,N.G5];
        m2.forEach((f,i)=>playPianoNote(f,now+(m.length+1)*dur+i*dur,dur*1.1,0.4));
        break;
      }

      case 'arabic':{ // 🕌 لمسة عربية (مقام بياتي/حجاز)
        // حجاز: D Eb F G A Bb C D
        const hijaz=[N.D4,311.13,N.F4,N.G4,N.A4,466.16,N.C5,N.D5];
        const dur=0.28;
        hijaz.forEach((f,i)=>playBellTone(f,now+i*dur,0.7,0.55));
        // خاتمة
        playBellTone(N.D5,now+hijaz.length*dur+0.05,1.5,0.7);
        playBellTone(N.A4,now+hijaz.length*dur+0.05,1.5,0.55);
        break;
      }

      case 'school':{ // 🏫 جرس المدرسة الكلاسيكي
        // 4 دقات: E5 G5 E5 G5
        const ring=[N.E5,N.G5,N.E5,N.G5,N.E5,N.G5];
        ring.forEach((f,i)=>{
          playBellTone(f,now+i*0.22,0.35,0.7);
        });
        // رنين ختامي
        playBellTone(N.E5,now+ring.length*0.22,1.2,0.65);
        break;
      }

      case 'victory':{ // 🎉 موسيقى انتصار (محسّنة)
        // صعود سريع ثم خاتمة مثلثة عظيمة
        const climb=[N.C4,N.E4,N.G4,N.C5,N.E5,N.G5,N.C6];
        climb.forEach((f,i)=>playTone(f,now+i*0.08,0.35,'square',0.35));
        // خاتمة
        [N.C4,N.E4,N.G4].forEach(f=>playBellTone(f,now+0.7,2.0,0.55));
        playBellTone(N.C6,now+0.7,2.0,0.65);
        playBellTone(N.G5,now+0.85,2.0,0.55);
        playBellTone(N.E5,now+1.0,2.0,0.5);
        break;
      }

      case 'water':{ // 💧 قطرات ماء هادئة
        for(let i=0;i<5;i++){
          const o=i*0.42;
          // نغمة عالية جداً مع اضمحلال سريع
          const osc=ctx.createOscillator();
          const g=ctx.createGain();
          osc.type='sine';
          osc.frequency.setValueAtTime(1800-i*120,now+o);
          osc.frequency.exponentialRampToValueAtTime(900-i*60,now+o+0.15);
          g.gain.setValueAtTime(0,now+o);
          g.gain.linearRampToValueAtTime(0.45*vol,now+o+0.005);
          g.gain.exponentialRampToValueAtTime(0.001,now+o+0.2);
          osc.connect(g);
          g.connect(reverb.input);
          osc.start(now+o);
          osc.stop(now+o+0.22);
        }
        break;
      }

      case 'gentle_wake':{ // 🌅 استيقاظ لطيف (تصاعد هادئ)
        // ثلاث مقامات تصاعدية في الجرس (C major triad)
        const chords=[
          [N.C4,N.E4,N.G4],
          [N.E4,N.G4,N.B4],
          [N.G4,N.B4,N.D5],
          [N.C5,N.E5,N.G5]
        ];
        chords.forEach((chord,i)=>{
          const o=i*0.5;
          chord.forEach(f=>playBellTone(f,now+o,2.5,0.45));
        });
        break;
      }

      case 'buzzer':{ // 📯 صفير تنبيه قوي (الأصل)
        for(let i=0;i<3;i++){
          const o=i*0.45;
          playTone(920,now+o,0.22,'square',0.8);
          playTone(1180,now+o+0.2,0.22,'square',0.8);
        }
        break;
      }

      default:{
        // احتياطي: نغمة احترافية فاخرة
        [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => {
          playBellTone(f, now + i*0.11, 0.9, 0.6);
        });
        const t1 = now + 0.55;
        [N.C4, N.E4, N.G4, N.B4].forEach(f => playPianoNote(f, t1, 3.0, 0.5));
        [N.G4, N.C5, N.E5, N.G5, N.B5, N.C6].forEach(f => playBellTone(f, t1+0.02, 2.6, 0.4));
        playBellTone(N.C7, t1 + 1.6, 3.5, 0.55);
      }
    }

    // تنظيف: أغلق السياق بعد انتهاء الصوت بقليل
    setTimeout(()=>{try{ctx.close();}catch(e){}},5000);
  }catch(e){console.warn('audio error',e);}
}

function playClick(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    osc.type='sine';
    osc.frequency.value=600;
    gain.gain.setValueAtTime(0.15,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime+0.1);
  }catch(e){}
}

/* ⭐⭐⭐ أصوات جذابة للأدوات التفاعلية الجديدة ⭐⭐⭐ */

// صوت عصا المعلم - نقرة خشبية لطيفة مع "فويب" صغير
function playStickTap(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    if(ctx.state==='suspended')ctx.resume();
    const now=ctx.currentTime;

    // نقرة خشبية سريعة
    const bufferSize=ctx.sampleRate*0.08;
    const buffer=ctx.createBuffer(1,bufferSize,ctx.sampleRate);
    const data=buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++){
      const env=Math.exp(-i/(ctx.sampleRate*0.012));
      data[i]=(Math.random()*2-1)*env;
    }
    const noise=ctx.createBufferSource();
    noise.buffer=buffer;
    const filter=ctx.createBiquadFilter();
    filter.type='bandpass';
    filter.frequency.value=2000;
    filter.Q.value=2;
    const noiseGain=ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4,now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001,now+0.1);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now+0.12);

    // نغمة "تك" مرحة
    const osc=ctx.createOscillator();
    const oscGain=ctx.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(900,now);
    osc.frequency.exponentialRampToValueAtTime(600,now+0.08);
    oscGain.gain.setValueAtTime(0.25,now);
    oscGain.gain.exponentialRampToValueAtTime(0.001,now+0.15);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now+0.18);

    // رنين خشبي ناعم
    const osc2=ctx.createOscillator();
    const osc2Gain=ctx.createGain();
    osc2.type='triangle';
    osc2.frequency.setValueAtTime(280,now);
    osc2Gain.gain.setValueAtTime(0.12,now);
    osc2Gain.gain.exponentialRampToValueAtTime(0.001,now+0.18);
    osc2.connect(osc2Gain);
    osc2Gain.connect(ctx.destination);
    osc2.start(now);
    osc2.stop(now+0.2);

    setTimeout(()=>ctx.close(),400);
  }catch(e){console.warn('stick audio error',e);}
}

// صوت فرقعة البالون - "بوب!" حاد مع قرقعة
function playBalloonPop(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    if(ctx.state==='suspended')ctx.resume();
    const now=ctx.currentTime;

    // الفرقعة الحادة - ضوضاء عالية التردد مع هجوم سريع
    const bufferSize=ctx.sampleRate*0.2;
    const buffer=ctx.createBuffer(1,bufferSize,ctx.sampleRate);
    const data=buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++){
      // توهين سريع جداً
      const env=Math.exp(-i/(ctx.sampleRate*0.005));
      data[i]=(Math.random()*2-1)*env;
    }
    const noise=ctx.createBufferSource();
    noise.buffer=buffer;
    const filter=ctx.createBiquadFilter();
    filter.type='highpass';
    filter.frequency.value=800;
    const noiseGain=ctx.createGain();
    noiseGain.gain.setValueAtTime(0.85,now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001,now+0.18);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now+0.22);

    // نغمة "طنق" عميقة مصاحبة
    const osc=ctx.createOscillator();
    const oscGain=ctx.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(180,now);
    osc.frequency.exponentialRampToValueAtTime(60,now+0.1);
    oscGain.gain.setValueAtTime(0.5,now);
    oscGain.gain.exponentialRampToValueAtTime(0.001,now+0.15);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now+0.18);

    // رنين صوتي مرح عالي
    const osc2=ctx.createOscillator();
    const osc2Gain=ctx.createGain();
    osc2.type='triangle';
    osc2.frequency.setValueAtTime(1400,now);
    osc2.frequency.exponentialRampToValueAtTime(800,now+0.05);
    osc2Gain.gain.setValueAtTime(0.3,now);
    osc2Gain.gain.exponentialRampToValueAtTime(0.001,now+0.12);
    osc2.connect(osc2Gain);
    osc2Gain.connect(ctx.destination);
    osc2.start(now);
    osc2.stop(now+0.15);

    setTimeout(()=>ctx.close(),400);
  }catch(e){console.warn('balloon pop audio error',e);}
}

// صوت نفخ البالون - "شششش" مستمر
function playBalloonInflate(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    if(ctx.state==='suspended')ctx.resume();
    const now=ctx.currentTime;

    // ضوضاء هواء مستمرة
    const bufferSize=ctx.sampleRate*0.5;
    const buffer=ctx.createBuffer(1,bufferSize,ctx.sampleRate);
    const data=buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++){
      data[i]=(Math.random()*2-1);
    }
    const noise=ctx.createBufferSource();
    noise.buffer=buffer;
    const filter=ctx.createBiquadFilter();
    filter.type='bandpass';
    filter.frequency.setValueAtTime(800,now);
    filter.frequency.linearRampToValueAtTime(1500,now+0.4);
    filter.Q.value=3;
    const noiseGain=ctx.createGain();
    noiseGain.gain.setValueAtTime(0,now);
    noiseGain.gain.linearRampToValueAtTime(0.15,now+0.05);
    noiseGain.gain.linearRampToValueAtTime(0.15,now+0.4);
    noiseGain.gain.exponentialRampToValueAtTime(0.001,now+0.5);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now+0.55);

    setTimeout(()=>ctx.close(),700);
  }catch(e){console.warn('balloon inflate audio error',e);}
}

// نغمة انتصار لطيفة عند جمع كل البالونات
function playFanfare(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    if(ctx.state==='suspended')ctx.resume();
    const now=ctx.currentTime;
    // نغمات تصاعدية احتفالية
    const notes=[523,659,784,1047,1319]; // C E G C E
    notes.forEach((freq,i)=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.type='triangle';
      osc.frequency.value=freq;
      const start=now+i*0.1;
      gain.gain.setValueAtTime(0,start);
      gain.gain.linearRampToValueAtTime(0.25,start+0.02);
      gain.gain.exponentialRampToValueAtTime(0.001,start+0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start+0.45);
    });
    setTimeout(()=>ctx.close(),1500);
  }catch(e){}
}

/* ⭐⭐⭐ أدوات المطرقة والعصا والبالونات ⭐⭐⭐ */

// ⭐ عبارات العصا السحرية — تظهر بصرياً أمام اختيار الصفحات (بدون قراءة صوتية)
const STICK_MAGIC_PHRASES=[
  'انطلقي يا مبدعة!',
  'ننتظر الإبداع منكِ!',
  'أبدعي يا نجمتنا!',
  'يا قمر، توهجي!',
  'بصمتكِ تصنع الفرق!',
  'أنتِ نجمة الصباح!',
  'تميّزي يا مبدعة!',
  'صباح الإبداع والتميّز!',
  'نحو القمة معاً!',
  'كل أفكاركن ثمينة!',
  'أفكاركن تُلهم العالم!',
  'شجاعتكن تصنع المستحيل!',
  'نتعلم منكن اليوم!',
  'يومكن يوم إبداع!',
  'حلقوا عالياً يا مبدعات!'
];

// ⭐ إظهار فقاعة العبارة أمام اختيار الصفحات (وسط يسار الشاشة)
function showStickMagicAtPages(phrase){
  // 1) فقاعة كبيرة وجميلة أمام اختيار الصفحات
  const sidebar=document.getElementById('pagesSidebar');
  let cx, cy;
  if(sidebar){
    const r=sidebar.getBoundingClientRect();
    // نضع العبارة أمام الشريط: على يمين الشريط (لأن RTL) — نضعها في منتصف الشاشة يسار
    cx=Math.max(280, r.right + 40);
    cy=r.top + r.height/2;
  }else{
    cx=Math.max(320, window.innerWidth*0.32);
    cy=window.innerHeight*0.5;
  }
  // ضمان أن لا تخرج من الشاشة
  cx=Math.min(cx, window.innerWidth-200);
  cy=Math.max(140, Math.min(cy, window.innerHeight-160));

  // إنشاء الفونت
  const bubble=document.createElement('div');
  bubble.className='stick-magic-bubble';
  // قصاصات نجوم على حواف الفقاعة
  const stars=['✨','⭐','🌟','💫','✨','🌟','⭐','💫'];
  const inner=document.createElement('span');
  inner.textContent=phrase;
  bubble.appendChild(inner);
  // أضف نجوم متطايرة حول الفقاعة
  for(let i=0;i<8;i++){
    const sp=document.createElement('span');
    sp.className='smb-spark';
    sp.textContent=stars[i];
    const ang=(Math.PI*2)*(i/8)+Math.random()*0.5;
    sp.style.left='50%';
    sp.style.top='50%';
    sp.style.setProperty('--dx',(Math.cos(ang)*80+Math.random()*30)+'px');
    sp.style.setProperty('--dy',(Math.sin(ang)*60+Math.random()*30)+'px');
    sp.style.animationDelay=(i*0.06)+'s';
    bubble.appendChild(sp);
  }
  bubble.style.left=cx+'px';
  bubble.style.top=cy+'px';
  document.body.appendChild(bubble);
  setTimeout(()=>bubble.classList.add('show'),30);
  setTimeout(()=>{bubble.classList.add('out');setTimeout(()=>bubble.remove(),600);},3800);

  // 2) ثلاث فقاعات صغيرة تحفيزية تنبثق حولها
  for(let i=0;i<3;i++){
    setTimeout(()=>{
      const w=MOTIV_WORDS[Math.floor(Math.random()*MOTIV_WORDS.length)];
      const el=document.createElement('div');
      el.className='motiv-word mw-'+(1+Math.floor(Math.random()*6));
      el.textContent=w;
      el.style.left=(cx+(Math.random()*120-60))+'px';
      el.style.top=(cy+(Math.random()*60-30))+'px';
      el.style.setProperty('--mx',(Math.random()*140-70)+'px');
      el.style.animationDelay=(i*0.1)+'s';
      const host=_motivHost||document.body;
      host.appendChild(el);
      setTimeout(()=>el.remove(),3400);
    },i*220);
  }

  // 3) بانر علوي سريع
  showCelebrateBanner('🪄 ' + phrase);

  // 4) العبارات تظهر بصرياً فقط (بدون قراءة صوتية)
}

// المطرقة - قابلة للسحب وعند الضغط عليها "تضرب" بصوت
function addStick(){
  const wrap=document.getElementById('canvasWrap');
  const tool=document.createElement('div');
  tool.className='stick-mb';
  // ضعي العصا في أعلى يسار السبورة
  tool.style.top='20px';
  tool.style.left='40px';
  tool.style.right='auto';
  tool.innerHTML=`
    <div class="stick-mb-tip">⭐</div>
    <div class="stick-mb-rod">
      <div class="stick-mb-stripes"><span></span><span></span><span></span><span></span><span></span><span></span></div>
    </div>
    <div class="stick-mb-handle">💫</div>
    <span class="stick-mb-spark">✨</span>
    <span class="stick-mb-spark">🌟</span>
    <span class="stick-mb-spark">💫</span>
    <span class="stick-mb-spark">⭐</span>
    <span class="stick-mb-spark">✨</span>
    <div class="stick-mb-tooltip">🪄 عصا سحرية!</div>
  `;
  wrap.appendChild(tool);
  if(typeof makeDraggable==='function'){try{makeDraggable(tool);}catch(e){}}
  tool.addEventListener('click',(e)=>{
    e.stopPropagation();
    if(tool.dataset.busy==='1')return;
    tool.dataset.busy='1';
    tool.classList.remove('tapping');
    void tool.offsetWidth;
    tool.classList.add('tapping');
    try{playStickTap();}catch(err){}
    // ⭐ اختر عبارة عشوائية من القائمة السحرية
    const phrase=STICK_MAGIC_PHRASES[Math.floor(Math.random()*STICK_MAGIC_PHRASES.length)];
    // ⭐ أظهريها أمام اختيار الصفحات مع قراءة صوتية جميلة
    showStickMagicAtPages(phrase);
    // فقاعات تحفيزية إضافية من رأس العصا
    try{
      const rect=tool.getBoundingClientRect();
      const cx=rect.left+rect.width/2;
      const cy=rect.top+30;
      showMotivWords(cx,cy,2);
    }catch(err){}
    setTimeout(()=>{
      tool.classList.remove('tapping');
      tool.dataset.busy='0';
    },500);
  });
  try{saveHistory&&saveHistory();}catch(e){}
  showCbToast('🪄','العصا السحرية جاهزة! انقريي عليها','success');
}

// بالونات صباحية - 5 بالونات عشوائية بألوان مشرقة وكلمات تحفيزية تطلع منها
const BALLOON_COLORS=['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#e91e63','#00bcd4','#ff9800','#4caf50','#ff5722','#673ab7','#ffeb3b'];
const BALLOON_COLORS_LIGHT=['#ff8aae','#74c0fc','#7fe0a8','#ffc870','#c39bd3','#ff77a9','#67d8e8','#ffc266','#80d090','#ff8a65','#9575cd','#fff176'];
const BALLOON_COLORS_DARK=['#c84b31','#1f6691','#1e7d4d','#c8820c','#6a3d8a','#ad1457','#00838f','#c66900','#2e7d32','#c0382b','#4527a0','#c6a700'];
const BALLOON_EMOJIS=['🎉','🎊','⭐','🌟','✨','💖','🎈','🏆','👏','💯','🌈','🎁'];
const BALLOON_MOTIV=['أحسنتِ!','ممتازة!','رائعة!','يا بطلة!','تألقي!','نجوم!','بالتوفيق!','نحو القمة!','يوم سعيد!','استمري!','ما شاء الله!','افتخري!','أنتِ مبدعة!','إبداع!','تميّزي!','اصنعي المعجزات!','العلم نور!','ابدئي بقوة!','فخورات بكن!','اصنعي المستحيل!'];
let _balloonsAlive=0;

function addBalloons(){
  const wrap=document.getElementById('canvasWrap');
  const host=document.createElement('div');
  host.className='balloons-host';
  host.id='balloonsHost_'+Date.now();
  host.style.left='0';
  host.style.top='0';
  wrap.appendChild(host);

  const count=5;
  for(let i=0;i<count;i++){
    spawnBalloon(host,i*180);
  }
  updateBalloonsCounter();
  saveHistory();
  // صوت نفخ جماعي عند الإنشاء
  setTimeout(()=>playBalloonInflate(),50);
  setTimeout(()=>playBalloonInflate(),300);
  toast('success','🎈 5 بالونات! انقريي عليها لتنفجر وتري الكلمات التحفيزية');
}

function spawnBalloon(host,delay=0){
  const idx=Math.floor(Math.random()*BALLOON_EMOJIS.length);
  const midIdx=Math.floor(Math.random()*BALLOON_COLORS.length);
  const color=BALLOON_COLORS[midIdx];
  const colorLight=BALLOON_COLORS_LIGHT[midIdx];
  const colorDark=BALLOON_COLORS_DARK[midIdx];
  const size=80+Math.random()*40;
  const stringLen=130+Math.random()*60;
  const startX=80+Math.random()*(window.innerWidth-200);
  const startY=window.innerHeight-220-Math.random()*100;
  const rot=(Math.random()*6-3).toFixed(1);
  const floatDur=(3.5+Math.random()*1.5).toFixed(1);
  const floatDelay=(Math.random()*1).toFixed(1);
  const swayDur=(2.5+Math.random()*1.5).toFixed(1);
  const tagText=BALLOON_EMOJIS[idx];
  const motivText=BALLOON_MOTIV[Math.floor(Math.random()*BALLOON_MOTIV.length)];

  const balloon=document.createElement('div');
  balloon.className='balloon-mb';
  balloon.dataset.alive='1';
  balloon.style.cssText=`--size:${size}px;--string-len:${stringLen}px;--col:${color};--col-light:${colorLight};--col-dark:${colorDark};--rot:${rot}deg;--float-dur:${floatDur}s;--float-delay:${floatDelay}s;--sway-dur:${swayDur}s;left:${startX}px;top:${startY}px;`;
  balloon.innerHTML=`
    <div class="balloon-mb-body">
      <div class="balloon-mb-emoji">${tagText}</div>
    </div>
    <div class="balloon-mb-string"></div>
    <div class="balloon-mb-text">${motivText}</div>
    <div class="balloon-mb-pop-effect"></div>
  `;
  // تأثير دخول من الأسفل
  balloon.style.opacity='0';
  balloon.style.transform='translateY(100px)';
  balloon.style.transition='opacity .5s ease, transform .6s cubic-bezier(.34,1.56,.64,1)';
  host.appendChild(balloon);
  setTimeout(()=>{
    balloon.style.opacity='1';
    balloon.style.transform='translateY(0)';
    setTimeout(()=>{
      balloon.style.transition='';
    },700);
  },delay);

  balloon.addEventListener('click',(e)=>{
    e.stopPropagation();
    if(balloon.dataset.alive!=='1')return;
    balloon.dataset.alive='0';
    playBalloonPop();
    balloon.classList.add('popping');
    // تأثير بصري: حلقة + قصاصات
    const eff=balloon.querySelector('.balloon-mb-pop-effect');
    eff.classList.remove('go');
    void eff.offsetWidth;
    eff.classList.add('go');
    eff.style.background=`radial-gradient(circle,${color} 0%,rgba(255,255,255,.6) 30%,transparent 70%)`;
    eff.style.borderRadius='50%';
    // قصاصات ورق
    const rect=balloon.getBoundingClientRect();
    const hostRect=host.getBoundingClientRect();
    const cx=rect.left-hostRect.left+rect.width/2;
    const cy=rect.top-hostRect.top+rect.height/2;
    for(let i=0;i<16;i++){
      const c=document.createElement('div');
      c.className='pop-mb-confetti';
      const ang=Math.random()*Math.PI*2;
      const dist=70+Math.random()*90;
      c.style.setProperty('--cx',Math.cos(ang)*dist+'px');
      c.style.setProperty('--cy',Math.sin(ang)*dist+'px');
      c.style.setProperty('--cr',(Math.random()*720-360)+'deg');
      c.style.setProperty('--c',BALLOON_COLORS[Math.floor(Math.random()*BALLOON_COLORS.length)]);
      c.style.left=cx+'px';
      c.style.top=cy+'px';
      host.appendChild(c);
      setTimeout(()=>c.remove(),1000);
    }
    // إظهار فقاعات الكلمات التحفيزية من مكان البالون
    showMotivWords(rect.left+rect.width/2, rect.top+rect.height/2, 5);
    setTimeout(()=>{
      balloon.remove();
      updateBalloonsCounter();
    },550);
  });
}

function updateBalloonsCounter(){
  const alive=document.querySelectorAll('.balloon-mb[data-alive="1"]').length;
  let counter=document.getElementById('balloonsCounter');
  if(!counter){
    counter=document.createElement('div');
    counter.id='balloonsCounter';
    counter.className='balloons-counter';
    counter.innerHTML='<i class="fas fa-balloons"></i> بالونات <span class="bc-num">0</span>';
    document.body.appendChild(counter);
  }
  counter.querySelector('.bc-num').textContent=alive;
  if(alive>0)counter.classList.add('visible');
  else counter.classList.remove('visible');
}

/* ⭐⭐⭐ فقاعات الكلمات التحفيزية - تنبثق من الأدوات عند الاستخدام ⭐⭐⭐ */
const MOTIV_WORDS=[
  'أحسنتِ! 🌟','ممتازة! 💫','رائعة! ✨','يا بطلة! 🏆','تألقي! 💖',
  'نجوم متألقة! ⭐','بالتوفيق! 🍀','نحو القمة! 🚀','يوم سعيد! ☀️','استمري! 💪',
  'ما شاء الله! 👏','افتخري! 💎','أنتِ مبدعة! 🌈','إبداع! 🎨','تميّزي! 🌸',
  'اصنعي المعجزات! ✨','العلم نور! 📚','ابدئي بقوة! 🔥','فخورات بكن! 💕','اصنعي المستحيل! 🌟',
  'صباح الأمل! 🌅','يوم جديد وإنجازات! 🎯','أنتن المستقبل! 🌷','كل الشكر لكن! 🙏',
  'استمتعي بيومكِ! 🎈','سعيدات بوجودكن! 💝','اصنعي فرقاً! 🌍','التميز عنوانكن! 👑',
  'أهلاً بالحماس! ⚡','حققين أحلامكن! 🌠','أبدعتن! 💡','بطلات! 🎖️','نجمات! ✨',
  'فخر لنا! 🥇','مثابرة! 🔥','همة! 💫','همة حتى القمة! ⛰️','شكراً لكن! 💐',
  'يومكن جميل! 🌺','اصنعين المعجزات! 🎇','بكل فخر! 💞'
];
let _motivHost;
function _ensureMotivHost(){
  if(!_motivHost){
    _motivHost=document.createElement('div');
    _motivHost.className='motiv-host';
    _motivHost.id='motivHost';
    document.body.appendChild(_motivHost);
  }
}
function showMotivWords(x,y,count){
  _ensureMotivHost();
  const used=new Set();
  for(let i=0;i<count;i++){
    let w;
    let safety=0;
    do{ w=MOTIV_WORDS[Math.floor(Math.random()*MOTIV_WORDS.length)]; safety++; }while(used.has(w)&&safety<30);
    used.add(w);
    const el=document.createElement('div');
    el.className='motiv-word mw-'+(1+Math.floor(Math.random()*6));
    el.textContent=w;
    const dx=(Math.random()*160-80);
    el.style.setProperty('--mx',dx+'px');
    el.style.left=(x+(Math.random()*40-20))+'px';
    el.style.top=(y+(Math.random()*20-10))+'px';
    el.style.animationDelay=(i*0.12)+'s';
    _motivHost.appendChild(el);
    setTimeout(()=>el.remove(),3200+(i*120));
  }
}
function showCelebrateBanner(text){
  const b=document.createElement('div');
  b.className='celebrate-banner';
  b.textContent=text;
  document.body.appendChild(b);
  setTimeout(()=>b.remove(),1600);
}

/* ⭐⭐⭐ ألعاب نارية - ألعاب نارية ضوئية على الشاشة ⭐⭐⭐ */
const FW_COLORS=['#ff3b3b','#ffaa00','#3bff6e','#3bbcff','#ff3bd4','#fff700','#9b59ff','#ff8c00','#00ffd0','#ff5e9c'];
function launchFireworks(count=5){
  const host=document.getElementById('fireworksHost');
  if(!host)return;
  for(let i=0;i<count;i++){
    setTimeout(()=>fireworkBurst(host),i*350);
  }
  playFirework();
  showCbToast('🎆','انفجار ألعاب نارية!','fireworks');
}

function fireworkBurst(host){
  const w=window.innerWidth;
  const h=window.innerHeight;
  // نقطة الانطلاق من أسفل الشاشة
  const startX=Math.random()*w*0.8+w*0.1;
  const startY=h;
  // نقطة الانفجار في الجو
  const targetX=Math.random()*w*0.7+w*0.15;
  const targetY=h*0.15+Math.random()*h*0.35;
  const color=FW_COLORS[Math.floor(Math.random()*FW_COLORS.length)];

  // صاروخ يطير للأعلى
  const rocket=document.createElement('div');
  rocket.className='firework';
  rocket.style.cssText=`left:${startX}px;top:${startY}px;background:${color};box-shadow:0 0 12px ${color},0 0 24px ${color};width:8px;height:8px;z-index:5`;
  host.appendChild(rocket);
  const dx=targetX-startX;
  const dy=targetY-startY;
  const dist=Math.sqrt(dx*dx+dy*dy);
  const dur=Math.max(400,dist*0.8);
  rocket.animate([
    {transform:'translate(0,0) scale(1)',opacity:1},
    {transform:`translate(${dx}px,${dy}px) scale(.5)`,opacity:.9}
  ],{duration:dur,easing:'cubic-bezier(.4,0,.6,1)'}).onfinish=()=>{
    rocket.remove();
    explodeFirework(host,targetX,targetY,color);
  };
}

function explodeFirework(host,x,y,color){
  // حلقة الانفجار
  const burst=document.createElement('div');
  burst.className='fw-burst';
  burst.style.cssText=`left:${x}px;top:${y}px`;
  host.appendChild(burst);

  // شعاع ضوئي أولي
  const halo=document.createElement('div');
  halo.style.cssText=`position:absolute;left:0;top:0;width:0;height:0;border-radius:50%;background:radial-gradient(circle,${color}88 0%,${color}33 40%,transparent 70%);transform:translate(-50%,-50%);pointer-events:none`;
  burst.appendChild(halo);
  halo.animate([
    {width:'0px',height:'0px',opacity:1},
    {width:'200px',height:'200px',opacity:.8},
    {width:'400px',height:'400px',opacity:0}
  ],{duration:600,easing:'ease-out',fill:'forwards'});

  // جسيمات متطايرة
  const particleCount=24+Math.floor(Math.random()*12);
  for(let i=0;i<particleCount;i++){
    const p=document.createElement('div');
    p.className='fw-particle';
    p.style.color=color;
    p.style.left='0';
    p.style.top='0';
    p.style.background=color;
    p.style.boxShadow=`0 0 8px ${color},0 0 16px ${color}66`;
    const angle=(Math.PI*2)*(i/particleCount);
    const dist=80+Math.random()*120;
    const tx=Math.cos(angle)*dist;
    const ty=Math.sin(angle)*dist;
    p.style.setProperty('--tx',tx+'px');
    p.style.setProperty('--ty',ty+'px');
    burst.appendChild(p);
    const dur=600+Math.random()*400;
    p.animate([
      {transform:'translate(0,0) scale(1)',opacity:1,offset:0},
      {transform:`translate(${tx*0.6}px,${ty*0.6}px) scale(1)`,opacity:1,offset:.2},
      {transform:`translate(${tx}px,${ty}px) scale(0)`,opacity:0,offset:1}
    ],{duration:dur,easing:'cubic-bezier(.2,.6,.4,1)',fill:'forwards'});
  }
  setTimeout(()=>burst.remove(),1200);
}

// صوت ألعاب نارية
function playFirework(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    if(ctx.state==='suspended')ctx.resume();
    const now=ctx.currentTime;
    // صوت "فششش" الصعود
    const bufferSize=ctx.sampleRate*0.4;
    const buffer=ctx.createBuffer(1,bufferSize,ctx.sampleRate);
    const data=buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++){
      data[i]=(Math.random()*2-1)*0.5;
    }
    const noise=ctx.createBufferSource();
    noise.buffer=buffer;
    const filter=ctx.createBiquadFilter();
    filter.type='bandpass';
    filter.frequency.setValueAtTime(2000,now);
    filter.frequency.exponentialRampToValueAtTime(4000,now+0.4);
    filter.Q.value=2;
    const gain=ctx.createGain();
    gain.gain.setValueAtTime(0,now);
    gain.gain.linearRampToValueAtTime(0.08,now+0.05);
    gain.gain.linearRampToValueAtTime(0.04,now+0.35);
    gain.gain.exponentialRampToValueAtTime(0.001,now+0.4);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now+0.4);

    // صوت "بانغ" الانفجار
    setTimeout(()=>{
      const ctx2=new (window.AudioContext||window.webkitAudioContext)();
      const now2=ctx2.currentTime;
      const burstBuf=ctx2.sampleRate*0.5;
      const bBuf=ctx2.createBuffer(1,burstBuf,ctx2.sampleRate);
      const bData=bBuf.getChannelData(0);
      for(let i=0;i<burstBuf;i++){
        const env=Math.exp(-i/(ctx2.sampleRate*0.15));
        bData[i]=(Math.random()*2-1)*env;
      }
      const bNoise=ctx2.createBufferSource();
      bNoise.buffer=bBuf;
      const bFilter=ctx2.createBiquadFilter();
      bFilter.type='lowpass';
      bFilter.frequency.setValueAtTime(1200,now2);
      bFilter.frequency.exponentialRampToValueAtTime(200,now2+0.4);
      const bGain=ctx2.createGain();
      bGain.gain.setValueAtTime(0.4,now2);
      bGain.gain.exponentialRampToValueAtTime(0.001,now2+0.5);
      bNoise.connect(bFilter);
      bFilter.connect(bGain);
      bGain.connect(ctx2.destination);
      bNoise.start(now2);
      bNoise.stop(now2+0.5);

      // رنين عميق
      const osc=ctx2.createOscillator();
      const oGain=ctx2.createGain();
      osc.type='sine';
      osc.frequency.setValueAtTime(80,now2);
      osc.frequency.exponentialRampToValueAtTime(30,now2+0.4);
      oGain.gain.setValueAtTime(0.3,now2);
      oGain.gain.exponentialRampToValueAtTime(0.001,now2+0.5);
      osc.connect(oGain);
      oGain.connect(ctx2.destination);
      osc.start(now2);
      osc.stop(now2+0.5);
      setTimeout(()=>ctx2.close(),800);
    },300);
    setTimeout(()=>ctx.close(),600);
  }catch(e){console.warn('firework audio error',e);}
}

/* ⭐⭐⭐ تصفيق - رموز تصفيق تملأ الشاشة ⭐⭐⭐ */
function launchApplause(){
  const host=document.getElementById('applauseHost');
  if(!host)return;
  const emojis=['👏','🙌','👏','✨','💖','⭐','🌟','💪','🎉','✨'];
  const total=24;
  for(let i=0;i<total;i++){
    setTimeout(()=>{
      const e=document.createElement('div');
      e.className='applause-emoji';
      e.textContent=emojis[Math.floor(Math.random()*emojis.length)];
      const startX=Math.random()*window.innerWidth;
      const startY=window.innerHeight+20;
      const tx=(Math.random()-.5)*120;
      const ty=-(window.innerHeight*0.6+Math.random()*150);
      const rot=(Math.random()*60-30)+'deg';
      const rot2=(Math.random()*720-360)+'deg';
      const dur=2+Math.random()*1.2;
      e.style.cssText=`left:${startX}px;top:${startY}px;--tx:${tx}px;--ty:${ty}px;--rot:${rot};--rot2:${rot2};--dur:${dur}s`;
      host.appendChild(e);
      setTimeout(()=>e.remove(),dur*1000+200);
    },i*60);
  }
  playClap();
  showCbToast('👏','موجة تصفيق حار!','applause');
}

// صوت تصفيق
function playClap(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    if(ctx.state==='suspended')ctx.resume();
    const now=ctx.currentTime;
    // سلسلة من فرقعات التصفيق
    for(let i=0;i<6;i++){
      const t=now+i*0.08+Math.random()*0.02;
      const buf=ctx.createBuffer(1,ctx.sampleRate*0.05,ctx.sampleRate);
      const d=buf.getChannelData(0);
      for(let j=0;j<d.length;j++){
        const env=Math.exp(-j/(ctx.sampleRate*0.012));
        d[j]=(Math.random()*2-1)*env;
      }
      const noise=ctx.createBufferSource();
      noise.buffer=buf;
      const filter=ctx.createBiquadFilter();
      filter.type='bandpass';
      filter.frequency.value=1500+Math.random()*500;
      filter.Q.value=3;
      const g=ctx.createGain();
      g.gain.setValueAtTime(0.35,t);
      g.gain.exponentialRampToValueAtTime(0.001,t+0.06);
      noise.connect(filter);
      filter.connect(g);
      g.connect(ctx.destination);
      noise.start(t);
      noise.stop(t+0.08);
    }
    setTimeout(()=>ctx.close(),1000);
  }catch(e){console.warn('clap audio error',e);}
}

/* ⭐⭐⭐ قصاصات ورق ملونة تنزل من أعلى الشاشة ⭐⭐⭐ */
function launchConfettiRain(){
  const host=document.getElementById('confettiRainHost');
  if(!host)return;
  const colors=['#ff3b3b','#ffaa00','#3bff6e','#3bbcff','#ff3bd4','#fff700','#9b59ff','#ff8c00','#00ffd0','#ff5e9c','#ffd700','#ff6347'];
  const total=80;
  for(let i=0;i<total;i++){
    setTimeout(()=>{
      const p=document.createElement('div');
      p.className='confetti-piece';
      const c=colors[Math.floor(Math.random()*colors.length)];
      const w=6+Math.random()*8;
      const h=10+Math.random()*10;
      const shape=Math.random()>.5?'50%':'2px';
      p.style.cssText=`left:${Math.random()*100}vw;width:${w}px;height:${h}px;background:${c};border-radius:${shape};--sway:${(Math.random()*120-60)}px;--dur:${2.5+Math.random()*2.5}s;--rot:${(Math.random()*1080-540)}deg;animation-delay:${Math.random()*.5}s;box-shadow:0 2px 4px rgba(0,0,0,.15)`;
      host.appendChild(p);
      setTimeout(()=>p.remove(),(2.5+Math.random()*2.5)*1000+500);
    },i*40);
  }
  playFanfare();
  showCbToast('🎊','سيل من القصاصات!','confetti');
}

/* ⭐⭐⭐ إشعار أسفل شريط الاحتفالات ⭐⭐⭐ */
function showCbToast(emoji,text,type='info'){
  const t=document.getElementById('cbToast');
  if(!t)return;
  t.querySelector('.ct-emoji').textContent=emoji;
  document.getElementById('cbToastText').textContent=text;
  t.style.borderRightColor=type==='success'?'#2ecc71':type==='warning'?'#f39c12':type==='fireworks'?'#ff6b35':type==='applause'?'#feca57':type==='confetti'?'#1dd1a1':'#1a5f7a';
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2400);
}

/* ⭐⭐⭐ الاحتفال الكامل - كل التأثيرات معاً! ⭐⭐⭐ */
function launchFullCelebration(){
  showCbToast('🎉','🎊 الاحتفال بدأ! 🎊','fireworks');
  playFanfare();
  // تتابع زمني للتأثيرات
  setTimeout(()=>launchFireworks(4),100);
  setTimeout(()=>launchApplause(),600);
  setTimeout(()=>launchConfettiRain(),1100);
  setTimeout(()=>launchFireworks(3),1800);
  setTimeout(()=>launchApplause(),2400);
  setTimeout(()=>addBalloons(),800);
}

/* STUDENTS */
function openStudentModal(id=null){State.editingStudentId=id;document.getElementById('studentModalTitle').textContent=id?'عدلي':'إضافة';const clsSel=document.getElementById('stuClass');const allowed=classesForActiveTeacher();clsSel.innerHTML=allowed.map(cid=>`<option value="${cid}">${classLabel(cid)}</option>`).join('');if(id){const s=Data.students.find(x=>x.id===id);if(s){document.getElementById('stuName').value=s.name;document.getElementById('stuEmail').value=s.email||'';document.getElementById('stuSeat').value=s.seat;if(allowed.includes(s.class)){clsSel.value=s.class;}else{clsSel.value=allowed[0]||'';}document.getElementById('stuStatus').value=s.status;}}else{document.getElementById('stuName').value='';document.getElementById('stuEmail').value='';document.getElementById('stuSeat').value='';document.getElementById('stuStatus').value='on';clsSel.value=allowed[0]||'';}openModal('modalStudent');}
function saveStudent(){const n=document.getElementById('stuName').value.trim();if(!n){toast('error','الاسم مطلوب');return;}const em=(document.getElementById('stuEmail').value||'').trim();if(em&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){toast('error','البريد الإلكتروني غير صالح');return;}const s=document.getElementById('stuSeat').value.trim();const c=document.getElementById('stuClass').value;const st=document.getElementById('stuStatus').value;if(State.editingStudentId){const x=Data.students.find(y=>y.id===State.editingStudentId);if(x)Object.assign(x,{name:n,email:em,seat:s,class:c,status:st});toast('success','تم التحديث');}else{Data.students.push({id:Date.now(),name:n,email:em,seat:s,class:c,status:st,teacherId:Data.activeTeacherId,points:0,createdAt:new Date().toISOString()});toast('success','تم الإضافة');}saveData();renderStudents();updateBehaviorSelect();updateAnalytics();closeModal('modalStudent');}
async function deleteStudent(id){if(!await customConfirm('هل تريدين احذفي هذه الطالبة وكل بياناتها؟',{title:'احذفي طالبة',danger:true,okText:'احذفي'}))return;Data.students=Data.students.filter(s=>s.id!==id);Data.answers=Data.answers.filter(a=>a.studentId!==id);Data.behavior=Data.behavior.filter(b=>b.studentId!==id);saveData();renderStudents();renderAnswers();renderBehavior();updateAnalytics();toast('warning','تم الاحذفي');}
function renderStudents(filter=''){const list=document.getElementById('studentsList');const allowed=classesForActiveTeacher();let f=Data.students.filter(s=>allowed.includes(s.class));const classFilterEl=document.getElementById('studentClassFilter');if(classFilterEl&&classFilterEl.value){f=f.filter(s=>s.class===classFilterEl.value);}const q=(filter||'').toLowerCase();if(q){f=f.filter(s=>(s.name||'').toLowerCase().includes(q)||(s.seat||'').toLowerCase().includes(q)||(s.email||'').toLowerCase().includes(q));}if(!f.length){list.innerHTML='<div class="empty-state"><i class="fas fa-user-graduate"></i><p>لا توجد طالبات في فصولكِ</p></div>';}else list.innerHTML=f.map(s=>`<div class="s-card"><div class="s-av">${escapeHtml((s.name||'؟').charAt(0))}</div><div class="s-info"><div class="s-name">${escapeHtml(s.name||'')}</div><div class="s-meta">رقم ${s.seat||'—'} • ${classLabel(s.class)} • ${statusText(s.status)} ${s.points?'⭐ '+s.points:''}</div>${s.email?`<div class="s-email"><i class="fas fa-envelope"></i>${escapeHtml(s.email)}</div>`:''}</div><span class="s-dot ${s.status}"></span><button class="btn btn-secondary btn-sm" onclick="openStudentModal(${s.id})" style="padding:4px 8px"><i class="fas fa-edit"></i></button><button class="btn btn-danger btn-sm" onclick="deleteStudent(${s.id})" style="padding:4px 8px"><i class="fas fa-trash"></i></button></div>`).join('');document.getElementById('studentsBadge').textContent=f.length;}
function statusText(s){return {on:'حاضرة',away:'متغيبة',off:'غائبة'}[s]||'';}

/* ANSWERS */
function openAnswerModal(id=null){State.editingAnswerId=id;document.getElementById('answerModalTitle').textContent=id?'عدلي':'إضافة';const sel=document.getElementById('ansStudent');const allowed=classesForActiveTeacher();const studs=Data.students.filter(s=>allowed.includes(s.class));sel.innerHTML='<option value="">اختاري...</option>'+studs.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');if(id){const a=Data.answers.find(x=>x.id===id);if(a){sel.value=a.studentId;document.getElementById('ansText').value=a.text;State.selectedRating=a.rating;}}else{document.getElementById('ansText').value='';State.selectedRating=3;}updateRatingChips();openModal('modalAnswer');}
function saveAnswer(){const sid=parseInt(document.getElementById('ansStudent').value);const t=document.getElementById('ansText').value.trim();if(!sid){toast('error','اختاري الطالبة');return;}if(!t){toast('error','النص مطلوب');return;}if(State.editingAnswerId){const a=Data.answers.find(x=>x.id===State.editingAnswerId);if(a)Object.assign(a,{studentId:sid,text:t,rating:State.selectedRating});}else{Data.answers.push({id:Date.now(),studentId:sid,text:t,rating:State.selectedRating,hidden:false,createdAt:new Date().toISOString()});}saveData();renderAnswers();updateAnalytics();closeModal('modalAnswer');toast('success','تم الاحفظي');}
async function deleteAnswer(id){if(!await customConfirm('هل تريدين احذفي هذه الإجابة؟',{title:'احذفي إجابتكِ',danger:true,okText:'احذفي'}))return;Data.answers=Data.answers.filter(a=>a.id!==id);saveData();renderAnswers();updateAnalytics();}
function toggleAnswerHidden(id){const a=Data.answers.find(x=>x.id===id);if(a)a.hidden=!a.hidden;saveData();renderAnswers();}
function likeAnswer(id){const a=Data.answers.find(x=>x.id===id);if(a)a.rating=Math.min(5,(a.rating||3)+1);saveData();renderAnswers();toast('success','👍');}
function renderAnswers(){const list=document.getElementById('answersList');if(!Data.answers.length){list.innerHTML='<div class="empty-state"><i class="fas fa-comments"></i><p>لا توجد إجابات</p></div>';document.getElementById('answersBadge').textContent=0;return;}const sorted=[...Data.answers].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));list.innerHTML=sorted.map(a=>{const s=Data.students.find(x=>x.id===a.studentId);return`<div class="ans-box"><div class="ans-head"><div class="ans-stu"><div class="ans-av">${s?s.name.charAt(0):'؟'}</div><div><div>${s?escapeHtml(s.name):'محذوفة'}</div><div style="font-size:.65rem;color:#888">${'⭐'.repeat(a.rating||3)}</div></div></div><div class="ans-time"><i class="fas fa-clock"></i> ${formatTime(a.createdAt)}</div></div><div class="ans-body ${a.hidden?'hidden':''}">${a.hidden?'مخفية':escapeHtml(a.text)}</div><div class="ans-act"><button class="ans-act-btn ${a.hidden?'show':'hide'}" onclick="toggleAnswerHidden(${a.id})"><i class="fas fa-${a.hidden?'eye':'eye-slash'}"></i></button><button class="ans-act-btn like" onclick="likeAnswer(${a.id})"><i class="fas fa-thumbs-up"></i></button><button class="ans-act-btn show" onclick="openAnswerModal(${a.id})"><i class="fas fa-edit"></i></button><button class="ans-act-btn hide" onclick="deleteAnswer(${a.id})"><i class="fas fa-trash"></i></button></div></div>`;}).join('');document.getElementById('answersBadge').textContent=Data.answers.length;}

/* QUIZ */
function openQuizModal(id=null){State.editingQuizId=id;State.selectedCorrect=-1;document.getElementById('quizModalTitle').textContent=id?'عدلي':'إنشاء';if(id){const q=Data.quizzes.find(x=>x.id===id);if(q){document.getElementById('qTitle').value=q.title;q.options.forEach((o,i)=>document.getElementById('qOpt'+i).value=o);State.selectedCorrect=q.correct;document.getElementById('qSubject').value=q.subject||'math';}}else{['qTitle','qOpt0','qOpt1','qOpt2','qOpt3'].forEach(id=>document.getElementById(id).value='');document.getElementById('qSubject').value='math';}updateCorrectChips();openModal('modalQuiz');}
function saveQuiz(){const t=document.getElementById('qTitle').value.trim();const o=[0,1,2,3].map(i=>document.getElementById('qOpt'+i).value.trim());const c=State.selectedCorrect;const s=document.getElementById('qSubject').value;if(!t){toast('error','السؤال مطلوب');return;}if(o.filter(x=>x).length<2){toast('error','خياران على الأقل');return;}if(c<0){toast('error','اختاري الإجابة الصحيحة');return;}if(State.editingQuizId){const q=Data.quizzes.find(x=>x.id===State.editingQuizId);if(q)Object.assign(q,{title:t,options:o,correct:c,subject:s});}else{Data.quizzes.push({id:Date.now(),title:t,options:o,correct:c,subject:s,live:false,responses:{},createdAt:new Date().toISOString()});}saveData();renderQuizzes();updateAnalytics();closeModal('modalQuiz');toast('success','تم الاحفظي');}
async function deleteQuiz(id){if(!await customConfirm('هل تريدين احذفي هذا السؤال؟',{title:'احذفي سؤالك',danger:true,okText:'احذفي'}))return;Data.quizzes=Data.quizzes.filter(q=>q.id!==id);saveData();renderQuizzes();updateAnalytics();}
function toggleQuizLive(id){const q=Data.quizzes.find(x=>x.id===id);if(q){if(!q.live)Data.quizzes.forEach(x=>x.live=false);q.live=!q.live;}saveData();renderQuizzes();}
function addQuizResponse(id,idx){const q=Data.quizzes.find(x=>x.id===id);if(!q)return;q.responses=q.responses||{};q.responses[idx]=(q.responses[idx]||0)+1;saveData();renderQuizzes();toast('success','تم');}
function renderQuizzes(){const list=document.getElementById('quizList');if(!Data.quizzes.length){list.innerHTML='<div class="empty-state"><i class="fas fa-question-circle"></i><p>لا توجد أسئلة</p></div>';document.getElementById('quizBadge').textContent=0;return;}const letters=['أ','ب','ج','د'];list.innerHTML=Data.quizzes.map(q=>{const total=Object.values(q.responses||{}).reduce((a,b)=>a+b,0);return`<div class="q-card ${q.live?'live':''}"><div class="q-title">${q.live?'<span class="live-dot"></span>':'<i class="fas fa-question-circle"></i>'} ${escapeHtml(q.title)}</div>${q.options.filter(o=>o).map((o,i)=>{const r=(q.responses||{})[i]||0;const ok=i===q.correct;return`<div class="q-opt ${ok?'ok':''}" onclick="${q.live?`addQuizResponse(${q.id},${i})`:''}"><span class="q-letter">${letters[i]}</span><span style="flex:1">${escapeHtml(o)}</span>${ok?'<i class="fas fa-check" style="color:var(--success)"></i>':''}${q.live&&r>0?`<span style="background:var(--primary);color:white;padding:2px 8px;border-radius:10px;font-size:.7rem">${r}</span>`:''}</div>`;}).join('')}<div class="q-stat"><span><i class="fas fa-users"></i> ${total}</span><span><i class="fas fa-tag"></i> ${subjectText(q.subject)}</span></div><div class="q-actions"><button class="btn ${q.live?'btn-success':'btn-secondary'}" onclick="toggleQuizLive(${q.id})"><i class="fas fa-${q.live?'stop':'play'}"></i></button><button class="btn btn-primary" onclick="openQuizModal(${q.id})"><i class="fas fa-edit"></i></button><button class="btn btn-danger" onclick="deleteQuiz(${q.id})"><i class="fas fa-trash"></i></button></div></div>`;}).join('');document.getElementById('quizBadge').textContent=Data.quizzes.length;}
function subjectText(s){return {math:'رياضيات',physics:'فيزياء',chem:'كيمياء',bio:'أحياء',arabic:'عربي',english:'إنجليزي',islamic:'إسلامية',social:'اجتماعيات',other:'أخرى'}[s]||'—';}

/* COMPREHENSIVE BEHAVIOR SYSTEM - ALL EDUCATIONAL SITUATIONS */
const BEHAVIOR_CATEGORIES = [
  {title:'الأداء الأكاديمي',icon:'fa-graduation-cap',class:'academic',items:[
    {icon:'fa-star',label:'ممتازة',pts:3,cls:'pos'},
    {icon:'fa-check',label:'جيدة جداً',pts:2,cls:'pos'},
    {icon:'fa-thumbs-up',label:'جيدة',pts:1,cls:'pos'},
    {icon:'fa-question',label:'تحتاج مساعدية',pts:0,cls:'neu'},
    {icon:'fa-times',label:'ضعيفة',pts:-1,cls:'neg'},
    {icon:'fa-exclamation',label:'لم تجب',pts:-2,cls:'neg'}
  ]},
  {title:'السلوك والانضباط',icon:'fa-user-check',class:'',items:[
    {icon:'fa-check-circle',label:'منضبطة',pts:2,cls:'pos'},
    {icon:'fa-hand-paper',label:'رفعت يدها',pts:1,cls:'pos'},
    {icon:'fa-comments',label:'شاركيت برأي',pts:2,cls:'pos'},
    {icon:'fa-volume-mute',label:'أزعجت',pts:-1,cls:'neg'},
    {icon:'fa-ban',label:'سلوك سلبي',pts:-3,cls:'neg'},
    {icon:'fa-bell',label:'تأخرت',pts:-1,cls:'neg'}
  ]},
  {title:'العمل الجماعي',icon:'fa-users',class:'special',items:[
    {icon:'fa-hands-helping',label:'ساعديت زميلتها',pts:3,cls:'pos'},
    {icon:'fa-users',label:'تعاونت',pts:2,cls:'pos'},
    {icon:'fa-crown',label:'قائدة مجموعة',pts:3,cls:'pos'},
    {icon:'fa-user-slash',label:'لم تشاركي',pts:-1,cls:'neg'}
  ]},
  {title:'المبادرة والإبداع',icon:'fa-lightbulb',class:'special',items:[
    {icon:'fa-lightbulb',label:'فكرة إبداعية',pts:3,cls:'pos'},
    {icon:'fa-rocket',label:'مشروع متميز',pts:3,cls:'pos'},
    {icon:'fa-magic',label:'حل مبتكر',pts:2,cls:'pos'},
    {icon:'fa-book',label:'قراءة إضافية',pts:2,cls:'pos'}
  ]},
  {title:'الأخلاق والقيم',icon:'fa-heart',class:'islamic',items:[
    {icon:'fa-heart',label:'حسنة',pts:2,cls:'islamic'},
    {icon:'fa-hand-holding-heart',label:'صدقة',pts:3,cls:'islamic'},
    {icon:'fa-smile',label:'طالبة خلوقة',pts:2,cls:'islamic'},
    {icon:'fa-angry',label:'أذى زميلتها',pts:-3,cls:'neg'},
    {icon:'fa-gossip',label:'نميمة',pts:-2,cls:'neg'}
  ]},
  {title:'الالتزام الديني',icon:'fa-mosque',class:'islamic',items:[
    {icon:'fa-quran',label:'احفظيت قرآن',pts:3,cls:'islamic'},
    {icon:'fa-pray',label:'حافظيت على الصلاة',pts:2,cls:'islamic'},
    {icon:'fa-star-and-crescent',label:'أخلاق إسلامية',pts:2,cls:'islamic'}
  ]},
  {title:'الواجبات والأنشطة',icon:'fa-tasks',class:'',items:[
    {icon:'fa-check-double',label:'أنجزت الواجب',pts:1,cls:'pos'},
    {icon:'fa-clipboard-check',label:'سلمت في الوقت',pts:1,cls:'pos'},
    {icon:'fa-running',label:'نشطة جداً',pts:2,cls:'pos'},
    {icon:'fa-clock',label:'تأخرت في الواجب',pts:-1,cls:'neg'},
    {icon:'fa-times-circle',label:'لم تسلم',pts:-2,cls:'neg'}
  ]}
];
function updateBehaviorSelect(){const sel=document.getElementById('behaviorStudent');if(!sel)return;const allowed=classesForActiveTeacher();const studs=Data.students.filter(s=>allowed.includes(s.class));sel.innerHTML='<option value="">اختاري طالبة...</option>'+studs.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');}
const ENCOURAGEMENTS={
voice:['صوتكِ المهدر يهز القلوب، أحسنتِ!','لما تتكلمين الكل ينتبه، إطراء حقيقي!','صوتكِ مليء بالثقة والوضوح','كلامكِ يلامس القلوب، أكملي على هذا المستوى'],
handwriting:['خطكِ رائع كاللوحة الفنية!','يداكِ ترسم حروفاً بأجمل ما يكون','خطكِ مميز، يحاكي أجمل الخطوط العربية','ما شاء الله، خطكِ يُحفظ في الذاكرة'],
idea:['أفكاركِ مبهرة كالزهور!','عقلية إبداعية استثنائية، أحسنتِ!','فكرتِ بما لم يفكر به أحد!','لمعان ذهني رائع، أنتِ مبدعة'],
participation:['مشاركتكِ تضيف للحصة قيمة كبيرة!','حضوركِ الفعال يلهم الزميلات','صوتكِ مسموع وهمومكِ في محلها','سؤالك ذكي يدل على تفكير عميق'],
achievement:['إنجاز يستحق التقدير!','نتائج مبهرة، استمري!','عملكِ يتحدث عنكِ ببلاغة','أنتِ نجمة متألقة في سماء الفصل'],
help:['روح المساعدة فيكِ تضيء الجميع','قلبكِ كبير، يداكِ تمتدان للجميع','المساعدة عادة البطلات، أحسنتِ!','خيركن خيركن لأهلكن، بوركتِ'],
creativity:['إبداعكِ يحاكي عقول العلماء','حل مبتكر يدل على ذكاء حاد','فكرتِ خارج الصندوق، رائعة!','الإبداع سمة العظيمات وأنتِ منهنهن'],
homework:['الانضباط يصنع الفرق، أحسنتِ!','إتقانكِ للواجب يدل على جدية','مسؤولية عالية، تستحقين التقدير','بذلتِ جهداً واضحاً، ما شاء الله'],
islamic:['أخلاقكِ الإسلامية تنير دربكِ','حفظكِ لكتاب الله فخر لكِ','أدائكِ للصلاة في وقتها من أجمل الأعمال','نسأل الله أن يجعل ما تعلمتِيه حجة لكِ'],
default_pos:['ممتازة، أحسنتِ!','عمل رائع، استمري!','ما شاء الله عليكِ!','أداء مبهر يستحق الإشادة!'],
default_neg:['لا تيأسي، فرصة جديدة بانتظاركِ','كل خطأ هو درس للمستقبل','المحاولة بحد ذاتها شجاعة','الكمال غاية لا تُدرك، المهم المحاولة','كل يوم فرصة جديدة تتحسنين','التغيير يبدأ بقرار صغير','أنتِ تقدرين تتغيرين، وثقي بنفسكِ','الخطوة القادمة ستكون أفضل','كل واحدة فينا تتعلم من أخطائها','المهم نصحح المسار ونكمل']
};
function getEncouragement(pts,cat,label){
if(pts<=0)return ENCOURAGEMENTS.default_neg[Math.floor(Math.random()*ENCOURAGEMENTS.default_neg.length)];
const l=String(label||'').toLowerCase();
let key='default_pos';
if(l.includes('صوت')||l.includes('رفعت'))key='voice';
else if(l.includes('خط')||l.includes('كاتب'))key='handwriting';
else if(l.includes('شاركت')||l.includes('مشاركة')||l.includes('رأي'))key='participation';
else if(l.includes('ممتازة')||l.includes('متميز')||l.includes('جيدة')||l.includes('إنجاز')||l.includes('منضبطة')||l.includes('خلوقة')||l.includes('نشطة'))key='achievement';
else if(l.includes('ساعديت')||l.includes('ساعدت')||l.includes('تعاون')||l.includes('قائد'))key='help';
else if(l.includes('إبداع')||l.includes('مبتكر')||l.includes('إبداعية'))key='creativity';
else if(l.includes('قرآن')||l.includes('صلاة')||l.includes('حسنة')||l.includes('أخلاق إسلامية')||l.includes('صدقة'))key='islamic';
else if(l.includes('واجب')||l.includes('سلمت')||l.includes('أنجزت'))key='homework';
else if(l.includes('فكرة')||l.includes('حل')||l.includes('مشروع')||l.includes('قراءة'))key='idea';
const arr=ENCOURAGEMENTS[key]||ENCOURAGEMENTS.default_pos;
return arr[Math.floor(Math.random()*arr.length)];
}

/* ⭐ نغمة إنجاز قصيرة وناعمة (بديل خفيف عن playFanfare) */
function playDing(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    if(ctx.state==='suspended')ctx.resume();
    const now=ctx.currentTime;
    // نغمة تصاعدية لطيفة: دو - مي - صول (3 أنصاف نغمات)
    const notes=[523.25,659.25,880];
    notes.forEach((freq,i)=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.type='sine';
      osc.frequency.value=freq;
      const start=now+i*0.09;
      gain.gain.setValueAtTime(0,start);
      gain.gain.linearRampToValueAtTime(0.18,start+0.015);
      gain.gain.exponentialRampToValueAtTime(0.001,start+0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start+0.4);
    });
    setTimeout(()=>ctx.close(),800);
  }catch(e){console.warn('ding audio error',e);}
}

/* 🔔 نغمة تنبيه هادئة للسلوكيات السلبية (ليست عقابية — مجرد جرس لطيف) */
function playReminder(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    if(ctx.state==='suspended')ctx.resume();
    const now=ctx.currentTime;
    // نغمة تنازلية هادئة: لا - فا - ري (3 نغمات)
    const notes=[880,698.46,587.33];
    notes.forEach((freq,i)=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.type='sine';
      osc.frequency.value=freq;
      const start=now+i*0.12;
      gain.gain.setValueAtTime(0,start);
      gain.gain.linearRampToValueAtTime(0.12,start+0.02);
      gain.gain.exponentialRampToValueAtTime(0.001,start+0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start+0.5);
    });
    setTimeout(()=>ctx.close(),1000);
  }catch(e){console.warn('reminder audio error',e);}
}

/* ⭐✨ نافذة التحفيز المنبثقة — للسلوكيات الإيجابية فقط
   تطلع في نص الشاشة بشكل احتفالي مع عبارة تحفيزية كاملة + نقاط + اسم الطالبة
   السلوكيات السلبية تظل توست صغير عادي (لاحظ: لا تستخدم هذه الدالة) */
let _motivHideTimer=null;
function showMotivationPopup(name, label, phrase, pts){
  const ov=document.getElementById('motivOverlay');
  const card=document.getElementById('motivCard');
  if(!ov||!card)return;
  // املأ المحتوى
  document.getElementById('motivName').textContent=name||'طالبة مميزة';
  document.getElementById('motivLabel').textContent=label||'';
  document.getElementById('motivPhrase').textContent=phrase||'أحسنتِ! استمري على هذا المستوى';
  document.getElementById('motivPoints').textContent='+'+pts;
  // أيقونة حسب حجم النقاط
  const iconEl=document.getElementById('motivIcon');
  if(iconEl){
    if(pts>=3)iconEl.textContent='🏆';
    else if(pts>=2)iconEl.textContent='🌟';
    else iconEl.textContent='⭐';
  }
  // أعد تشغيل أنيميشن الدخول
  card.style.animation='none';
  void card.offsetWidth;
  card.style.animation='';
  ov.classList.add('active');
  // صوت إنجاز لطيف
  playDing();
  // رشّة قصاصات صغيرة
  setTimeout(()=>spawnMotivationConfetti(),120);
  // إغلاق تلقائي بعد 4 ثواني
  if(_motivHideTimer)clearTimeout(_motivHideTimer);
  _motivHideTimer=setTimeout(closeMotivationPopup,4200);
}
function closeMotivationPopup(){
  const ov=document.getElementById('motivOverlay');
  if(ov)ov.classList.remove('active');
  if(_motivHideTimer){clearTimeout(_motivHideTimer);_motivHideTimer=null;}
}
/* رشّة قصاصات خفيفة من أعلى النافذة (بدون سيل كامل) */
function spawnMotivationConfetti(){
  const host=document.getElementById('confettiRainHost');
  if(!host)return;
  const colors=['#ff3b3b','#ffaa00','#3bff6e','#3bbcff','#ff3bd4','#fff700','#9b59ff','#ffd700','#1dd1a1','#ff5e9c'];
  const total=24;
  for(let i=0;i<total;i++){
    setTimeout(()=>{
      const p=document.createElement('div');
      p.className='confetti-piece';
      const c=colors[Math.floor(Math.random()*colors.length)];
      const w=6+Math.random()*6;
      const h=10+Math.random()*8;
      const shape=Math.random()>.5?'50%':'2px';
      // قصاصات تنزل من وسط الشاشة (فوق النافذة) فقط
      p.style.cssText=`left:${30+Math.random()*40}vw;width:${w}px;height:${h}px;background:${c};border-radius:${shape};--sway:${(Math.random()*80-40)}px;--dur:${2+Math.random()*1.5}s;--rot:${(Math.random()*720-360)}deg;animation-delay:0s;box-shadow:0 2px 4px rgba(0,0,0,.15)`;
      host.appendChild(p);
      setTimeout(()=>p.remove(),4000);
    },i*30);
  }
}

/* 🌿✨ بطاقة التصحيح — للسلوكيات السلبية
   نفس مستوى البروز، لكن بأسلوب تأملي يشجع على التعديل والتغيير.
   مو توبيخ، بل "فرصة للتحسن" — بألوان دافئة وأوراق شجر متطايرة (مو قصاصات احتفال) */
let _correctionHideTimer=null;
function showCorrectionPopup(name, label, phrase, pts){
  const ov=document.getElementById('correctionOverlay');
  const card=document.getElementById('correctionCard');
  if(!ov||!card)return;
  // املأ المحتوى
  document.getElementById('correctionName').textContent=name||'طالبة';
  document.getElementById('correctionLabel').textContent=label||'';
  document.getElementById('correctionPhrase').textContent=phrase||'كل فرصة للتغيير هي بداية جديدة';
  document.getElementById('correctionPoints').textContent=pts;
  // أيقونة حسب شدة الخصم
  const iconEl=document.getElementById('correctionIcon');
  if(iconEl){
    if(pts<=-3)iconEl.textContent='🎯';
    else if(pts<=-2)iconEl.textContent='🌱';
    else iconEl.textContent='💡';
  }
  // أعد تشغيل أنيميشن الدخول
  card.style.animation='none';
  void card.offsetWidth;
  card.style.animation='';
  ov.classList.add('active');
  // صوت تنبيه هادئ
  playReminder();
  // تساقط خفيف لأوراق شجر (مو قصاصات احتفال)
  setTimeout(()=>spawnCorrectionLeaves(),150);
  // إغلاق تلقائي بعد 5 ثواني (نعطي وقت أطول للتأمل)
  if(_correctionHideTimer)clearTimeout(_correctionHideTimer);
  _correctionHideTimer=setTimeout(closeCorrectionPopup,5000);
}
function closeCorrectionPopup(){
  const ov=document.getElementById('correctionOverlay');
  if(ov)ov.classList.remove('active');
  if(_correctionHideTimer){clearTimeout(_correctionHideTimer);_correctionHideTimer=null;}
}
/* تساقط هادئ لأوراق شجر صغيرة (أيقونات) — تذكير بالتغيير والنمو */
function spawnCorrectionLeaves(){
  const host=document.getElementById('confettiRainHost');
  if(!host)return;
  const leaves=['🍂','🍃','🌿','🍂','🍃','🌱'];
  const total=10;
  for(let i=0;i<total;i++){
    setTimeout(()=>{
      const p=document.createElement('div');
      p.className='confetti-piece';
      p.textContent=leaves[Math.floor(Math.random()*leaves.length)];
      p.style.cssText=`left:${20+Math.random()*60}vw;width:auto;height:auto;font-size:${14+Math.random()*6}px;background:transparent;border-radius:0;--sway:${(Math.random()*100-50)}px;--dur:${3+Math.random()*2}s;--rot:${(Math.random()*360-180)}deg;animation-delay:0s;box-shadow:none;line-height:1`;
      host.appendChild(p);
      setTimeout(()=>p.remove(),5500);
    },i*150);
  }
}

function buildBehaviorCategories(){const host=document.getElementById('behaviorCategories');host.innerHTML=BEHAVIOR_CATEGORIES.map(cat=>`<div class="behavior-cat-title"><i class="fas ${cat.icon}"></i> ${cat.title}</div><div class="behavior-grid">${cat.items.map(it=>`<div class="behavior-btn ${it.cls}" onclick="addBehavior(${it.pts},'${cat.title}','${it.label}')" data-pts="${it.pts}"><i class="fas ${it.icon}"></i><span>${it.label}</span><span class="bb-pts">${it.pts>0?'+':''}${it.pts}</span></div>`).join('')}</div>`).join('');}
function addBehavior(pts,cat,label){const sid=parseInt(document.getElementById('behaviorStudent').value);if(!sid){toast('error','اختاري طالبة');return;}Data.behavior.push({id:Date.now(),studentId:sid,points:pts,category:cat,label:label,createdAt:new Date().toISOString()});const s=Data.students.find(x=>x.id===sid);if(s)s.points=(s.points||0)+pts;saveData();renderBehavior();updateAnalytics();
  /* ✨ السلوكيات الإيجابية → نافذة احتفالية في النص (نجوم + قصاصات)
     🌿 السلوكيات السلبية → بطاقة تصحيح داعمة (أوراق شجر + تنبيه هادئ للتغيير) */
  const phrase=getEncouragement(pts,cat,label);
  if(pts>0){
    showMotivationPopup(s.name, label, phrase, pts);
  } else {
    showCorrectionPopup(s.name, label, phrase, pts);
  }
}
function renderBehavior(){const total=Data.behavior.reduce((a,b)=>a+b.points,0);document.getElementById('totalScore').textContent=total;const sorted=[...Data.students].sort((a,b)=>(b.points||0)-(a.points||0));const list=document.getElementById('behaviorList');if(!sorted.length){list.innerHTML='<div class="empty-state"><i class="fas fa-star"></i><p>أضيفي طالبات</p></div>';return;}list.innerHTML=sorted.map((s,i)=>{const p=s.points||0;return`<div class="s-card"><div class="s-av" style="background:${p>0?'linear-gradient(135deg,#ffd700,#ffaa00)':p<0?'linear-gradient(135deg,#e74c3c,#c0392b)':'linear-gradient(135deg,var(--primary),var(--dark))'}">${i+1}</div><div class="s-info"><div class="s-name">${escapeHtml(s.name)}</div><div class="s-meta">${p>0?`+${p}`:p} نقطة</div></div><div style="font-weight:900;color:${p>0?'var(--success)':p<0?'var(--danger)':'#888'};font-size:1.2rem">${p>0?'⭐':p<0?'⚠️':'—'}</div></div>`;}).join('');}

/* WORDS */
function openWordModal(id=null){State.editingWordId=id;document.getElementById('wordModalTitle').textContent=id?'عدلي':'إضافة';if(id){const w=Data.words.find(x=>x.id===id);if(w){document.getElementById('wWord').value=w.word;document.getElementById('wDef').value=w.def;document.getElementById('wColor').value=w.color;}}else{document.getElementById('wWord').value='';document.getElementById('wDef').value='';document.getElementById('wColor').value='yellow';}openModal('modalWord');}
function saveWord(){const w=document.getElementById('wWord').value.trim();const d=document.getElementById('wDef').value.trim();const c=document.getElementById('wColor').value;if(!w){toast('error','الكلمة مطلوبة');return;}if(State.editingWordId){const x=Data.words.find(y=>y.id===State.editingWordId);if(x)Object.assign(x,{word:w,def:d,color:c});}else{Data.words.push({id:Date.now(),word:w,def:d,color:c,createdAt:new Date().toISOString()});}saveData();renderWords();closeModal('modalWord');toast('success','تم الاحفظي');}
async function deleteWord(id){if(!await customConfirm('هل تريدين احذفي هذه الكلمة؟',{title:'احذفي كلمة',danger:true,okText:'احذفي'}))return;Data.words=Data.words.filter(w=>w.id!==id);saveData();renderWords();}
function renderWords(filter=''){const list=document.getElementById('wordsList');const f=Data.words.filter(w=>w.word.includes(filter)||w.def.includes(filter));if(!f.length){list.innerHTML='<div class="empty-state"><i class="fas fa-font"></i><p>الجدار فارغ</p></div>';return;}list.innerHTML=f.map(w=>`<div class="word-card ${w.color}"><div class="word-text">${escapeHtml(w.word)}</div><div class="word-def">${escapeHtml(w.def)}</div><div class="word-actions"><button onclick="openWordModal(${w.id})"><i class="fas fa-edit"></i></button><button onclick="deleteWord(${w.id})"><i class="fas fa-trash"></i></button></div></div>`).join('');}

/* LESSON PLAN */
function saveLessonPlan(){const p={id:Date.now(),title:document.getElementById('lessonTitle').value,date:document.getElementById('lessonDate').value,class:document.getElementById('lessonClass').value,objectives:document.getElementById('lessonObjectives').value,intro:document.getElementById('lessonIntro').value,main:document.getElementById('lessonMain').value,eval:document.getElementById('lessonEval').value,hw:document.getElementById('lessonHW').value};if(!p.title){toast('error','العنوان مطلوب');return;}Data.lessonPlans.push(p);saveData();renderLessonList();['lessonTitle','lessonObjectives','lessonIntro','lessonMain','lessonEval','lessonHW'].forEach(id=>document.getElementById(id).value='');toast('success','تم احفظي الخطة');}
function renderLessonList(){const list=document.getElementById('lessonList');if(!Data.lessonPlans.length)return;list.innerHTML='<h4 style="font-size:.85rem;font-weight:800;color:var(--dark);margin:14px 0 8px">الخطط السابقة</h4>'+Data.lessonPlans.slice().reverse().map(p=>`<div class="lesson-section"><h4><i class="fas fa-bookmark"></i> ${escapeHtml(p.title)} <small style="color:#888;font-weight:500">${p.date||''} • ${p.class||''}</small></h4>${p.objectives?`<div style="font-size:.78rem;margin-bottom:4px"><b>الأهداف:</b> ${escapeHtml(p.objectives)}</div>`:''}${p.main?`<div style="font-size:.78rem"><b>الشرح:</b> ${escapeHtml(p.main)}</div>`:''}<div style="display:flex;gap:4px;margin-top:6px"><button class="btn btn-sm btn-secondary" onclick='exportLessonPlan(${JSON.stringify(p).replace(/'/g,"&apos;")})'><i class="fas fa-download"></i></button><button class="btn btn-sm btn-danger" onclick="deleteLessonPlan(${p.id})"><i class="fas fa-trash"></i></button></div></div>`).join('');}
function deleteLessonPlan(id){Data.lessonPlans=Data.lessonPlans.filter(p=>p.id!==id);saveData();renderLessonList();}
function exportLessonPlan(p){const text=`خطة الحصة: ${p.title}\nالتاريخ: ${p.date||'—'}\nالفصل: ${p.class||'—'}\n\nالأهداف:\n${p.objectives||'—'}\n\nالتمهيد:\n${p.intro||'—'}\n\nالشرح والأنشطة:\n${p.main||'—'}\n\nالتقويم:\n${p.eval||'—'}\n\nالواجب:\n${p.hw||'—'}`;const blob=new Blob([text],{type:'text/plain;charset=utf-8'});const l=document.createElement('a');l.download=`خطة-${p.title}-${Date.now()}.txt`;l.href=URL.createObjectURL(blob);l.click();toast('success','تم الصدّري');}

/* RANDOM PICKER */
function openRandomPicker(){if(!Data.students.length){toast('error','أضيفي طالبات');return;}openModal('modalRandom');buildWheel();}
function buildWheel(){const wheel=document.getElementById('wheel');const n=Data.students.length;const segAngle=360/n;const colors=['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e','#16a085','#c0392b'];wheel.innerHTML=Data.students.map((s,i)=>{const angle=i*segAngle;const color=colors[i%colors.length];return`<div class="wheel-segment" style="transform:rotate(${angle}deg) skewY(${90-segAngle}deg);background:${color}"><span style="transform:skewY(${-(90-segAngle)}deg) rotate(${segAngle/2}deg);display:inline-block">${s.name}</span></div>`;}).join('');wheel.style.transform='rotate(0deg)';document.getElementById('wheelResult').textContent='اضغطي للتدوير';}
function spinWheel(){const wheel=document.getElementById('wheel');if(!Data.students.length)return;const n=Data.students.length;const segAngle=360/n;const winnerIdx=Math.floor(Math.random()*n);const winner=Data.students[winnerIdx];const targetAngle=360*6+(360-(winnerIdx*segAngle+segAngle/2));wheel.style.transition='transform 4s cubic-bezier(.17,.67,.12,.99)';wheel.style.transform=`rotate(${targetAngle}deg)`;document.getElementById('wheelResult').innerHTML=`🎉 ${winner.name}`;setTimeout(()=>{document.getElementById('wheelResult').style.animation='pulse 1s';toast('success',`اختاري: ${winner.name}`);},4000);}
function pickAgain(){document.getElementById('wheel').style.transition='none';document.getElementById('wheel').style.transform='rotate(0deg)';setTimeout(spinWheel,50);}
function resetWheel(){document.getElementById('wheel').style.transition='none';document.getElementById('wheel').style.transform='rotate(0deg)';document.getElementById('wheelResult').textContent='اضغطي للتدوير';}

/* GROUPS */
function openGroupMaker(){if(!Data.students.length){toast('error','أضيفي طالبات');return;}openModal('modalGroups');makeGroups();}
function makeGroups(){const n=parseInt(document.getElementById('groupCount').value)||4;if(!Data.students.length)return;const sh=[...Data.students].sort(()=>Math.random()-.5);const groups=Array.from({length:n},()=>[]);sh.forEach((s,i)=>groups[i%n].push(s));const colors=['#1a5f7a','#27ae60','#e74c3c','#f39c12','#8e44ad','#16a085','#c0392b','#2980b9','#d35400','#34495e'];const icons=['🌟','🚀','⚡','🔥','💎','🌈','🎯','🏆','💪','🌸'];document.getElementById('groupDisplay').innerHTML=groups.map((g,i)=>`<div class="group-card" style="background:linear-gradient(135deg,${colors[i%colors.length]},${colors[(i+1)%colors.length]})"><div class="g-name">${icons[i%icons.length]} المجموعة ${i+1} (${g.length})</div><div class="g-members">${g.map(s=>`<span class="g-member">${escapeHtml(s.name)}</span>`).join('')}</div></div>`).join('');toast('success','تم التوزيع');}

/* ============================================================
   NTFY.SH CROSS-DEVICE MESSAGING (FREE, NO REGISTRATION)
   ============================================================
   ntfy.sh هو خدمة مجانية تسمح بتبادل الرسائل بين الأجهزة عبر
   متصفح الويب بدون أي تسجيل. نستخدم topic فريد لكل جلسة.
   ============================================================ */
const NTFY_BASE = 'https://ntfy.sh';
/* ⭐ NTFY_FALLBACKS: قائمة خوادم ntfy بديلة في حالة حجب/بطء السيرفر الرئيسي
   نجربها بالترتيب — أول سيرفر يستجيب نستخدمه */
const NTFY_FALLBACKS = [
  'https://ntfy.sh',
  'https://ntfy.hetzner.cloud',
  'https://ntfy.fdn.fr',
  'https://ntfy.privacydev.net'
];
/* _ntfyActiveBase: السيرفر الفعّال حالياً لكل topic (يُكتشف تلقائياً) */
const _ntfyActiveBase = {};
/* _ntfyBaseProbed: هل تحقّقت من هذا السيرفر من قبل (cache لتجنّب إعادة الاختبار) */
const _ntfyBaseProbed = {};

/* _pickNtfyBase() — يختار أسرع ntfy server متاح.
   يبدأ بالـ default، ثم يجرب الفallbacks في الخلفية.
   يُستدعى في كل subscribe/publish لاستخدام السيرفر الأسرع. */
async function _pickNtfyBase(){
  // إذا الـ default اشتغل مسبقاً، استخدمه (أسرع)
  if(_ntfyBaseProbed[NTFY_BASE] === 'ok') return NTFY_BASE;
  // جرّب السيرفرات بالتوازي بأمر بسيط (HEAD على الـ homepage)
  const probes = NTFY_FALLBACKS.map(async (base) => {
    try{
      const ctrl = new AbortController();
      const timer = setTimeout(()=>ctrl.abort(), 2500);
      const r = await fetch(base + '/', {method:'HEAD', signal:ctrl.signal, cache:'no-store'});
      clearTimeout(timer);
      if(r.ok || r.status === 200 || r.status === 405) return base;
    }catch(e){}
    return null;
  });
  const results = await Promise.all(probes);
  for(let i=0;i<results.length;i++){
    if(results[i]){
      _ntfyBaseProbed[results[i]] = 'ok';
      // حدّث _ntfyActiveBase لكل topic مفتوح
      Object.keys(_ntfyActiveBase).forEach(t=>{_ntfyActiveBase[t]=results[i];});
      console.log('[ntfy] active base:', results[i]);
      return results[i];
    }
  }
  return NTFY_BASE; // fallback نهائي
}
/* ⭐ ابدأ probe فوري عند تحميل السكربت — يكتشف أسرع ntfy server قبل أول بث */
if(typeof window!=='undefined'){
  setTimeout(()=>{_pickNtfyBase().catch(()=>{});}, 100);
}
function _randId(len=8){return Math.random().toString(36).substring(2,2+len);}
function _topic(prefix){return `marifa-${prefix}-${_randId(6)}-${Date.now().toString(36)}`;}

/* ============================================================
   buildJoinUrl() — يبني رابط URL للطالبة بشكل آمن
   - يتعامل مع: http/https, file://, iframe srcdoc, sandboxed contexts
   - لما location.origin = 'null' أو pathname = 'srcdoc' (iframe)
     يرجع URL نسبي (فقط query string) — يافتحي على نفس الـ HTML
   - يُفضّل استخدام رابط مطلق في الحالات العادية
   ============================================================ */
function buildJoinUrl(mode, code, topic, qData){
  const params = `mode=${encodeURIComponent(mode)}&code=${encodeURIComponent(code)}&topic=${encodeURIComponent(topic)}`;
  let extra = '';
  if(qData && (qData.title || qData.q)){
    try{
      // base64-encode the question for embedding in URL
      // يضمن ظهور السؤال للطالبات حتى لو ntfy.sh محجوب أو بطيء
      // ⚠️ ملاحظة: لا نرسل الإجابة الصحيحة (correct) في الرابط — حتى لا تكشفها الطالبة من URL
      const qJson = JSON.stringify({t:qData.title||qData.q||'', o:qData.options||qData.opts||[], ts:Date.now()});
      const qB64 = btoa(unescape(encodeURIComponent(qJson)));
      extra = `&q=${encodeURIComponent(qB64)}`;
    }catch(e){ console.warn('embed q failed',e); }
  }
  const fullParams = params + extra;
  try{
    // استخدم رابط المعلمة المُخزّن أو رابط الموقع المرفوع على الإنترنت
    const savedUrl = localStorage.getItem('teacherBaseUrl');
    if(savedUrl && savedUrl.trim()){
      const base = savedUrl.trim().replace(/\/?$/,'');
      return `${base}?${fullParams}`;
    }
    // رابط الموقع المرفوع على GitHub Pages
    const baseUrl = 'https://so335.github.io/sabora/';
    return `${baseUrl}?${fullParams}`;
  }catch(e){
    return `https://so335.github.io/sabora/?${fullParams}`;
  }
}

/* buildJoinUrlMulti() — يبني رابط يحتوي كل الأسئلة (base64 في param 'qs') */
function buildJoinUrlMulti(mode, code, topic, qsList){
  const params = `mode=${encodeURIComponent(mode)}&code=${encodeURIComponent(code)}&topic=${encodeURIComponent(topic)}`;
  let extra = '';
  try{
    const qJson = JSON.stringify({all: qsList, ts: Date.now()});
    const qB64 = btoa(unescape(encodeURIComponent(qJson)));
    extra = `&qs=${encodeURIComponent(qB64)}`;
  }catch(e){ console.warn('embed qs failed', e); }
  const fullParams = params + extra;
  try{
    // استخدم رابط المعلمة المُخزّن أو رابط الصفحة الحالي
    const savedUrl = localStorage.getItem('teacherBaseUrl');
    if(savedUrl && savedUrl.trim()){
      const base = savedUrl.trim().replace(/\/?$/,'');
      return `${base}?${fullParams}`;
    }
    const origin = location.origin;
    const pathname = location.pathname;
    const originBad = !origin || origin === 'null' || origin === 'file://' && pathname === 'srcdoc';
    const pathBad = !pathname || pathname === 'srcdoc' || !/\.[a-z0-9]{2,5}$/i.test(pathname);
    if(originBad || pathBad){
      return `?${fullParams}`;
    }
    return `${origin}${pathname}?${fullParams}`;
  }catch(e){
    return `?${fullParams}`;
  }
}

/* parseQuestionFromUrl() — يقرأ السؤال من الـ URL parameter 'q' (base64)
   أو قائمة الأسئلة من 'qs' (base64 JSON {all: [...]}) */
function parseQuestionFromUrl(){
  try{
    const params = new URLSearchParams(location.search);
    // أولاً: تحققي من qs (قائمة الأسئلة — ضعي الكل معاً)
    const qsB64 = params.get('qs');
    if(qsB64){
      const qsJson = decodeURIComponent(escape(atob(qsB64)));
      const obj = JSON.parse(qsJson);
      if(obj && obj.all && Array.isArray(obj.all) && obj.all.length){
        return { all: obj.all, ts: obj.ts||0 };
      }
    }
    // ثانياً: q (سؤالك واحد)
    const qB64 = params.get('q');
    if(!qB64) return null;
    const qJson = decodeURIComponent(escape(atob(qB64)));
    const obj = JSON.parse(qJson);
    // صيغة مُوحّدة للطالبات
    return { title: obj.t || obj.title || '', options: obj.o || obj.options || [], correct: -1, ts: obj.ts||0 };
  }catch(e){
    console.warn('parseQuestionFromUrl failed',e);
    return null;
  }
}

/* ============================================================
   NTFY.SH v2 — SSE STREAM + DEDUP + RECONNECT
   - استخدام /sse (Server-Sent Events) مع Last-Event-ID للـ replay
   - EventSource يتصل تلقائياً عند الخطأ (مدمج في JS)
   - dedup cache يمنع تكرار الرسائل عند reconnect
   - يشتغل على file:// بدون أي CORS issues (ntfy.sh يسمح بـ *)
   ============================================================ */

/* _ntfySeenIds: cache per-topic للـ message IDs اللي شفناها (يمنع duplicates عند reconnect) */
const _ntfySeenIds = {}; // { topic: Set<id> }

/* _ntfyReconnectHints: آخر message id لكل topic (للـ manual reconnect) */
const _ntfyLastId = {}; // { topic: 'id' }

/* إرسال رسالة إلى topic — مع retry خفيف + fallback servers */
async function ntfyPublish(topic, payload, _retry=0){
  const base = _ntfyActiveBase[topic] || await _pickNtfyBase();
  _ntfyActiveBase[topic] = base;
  try{
    const r = await fetch(`${base}/${topic}`, {
      method:'POST',
      body: JSON.stringify(payload),
      headers: {'Content-Type':'text/plain','Cache':'no-store','X-Title':'marifa-board'}
    });
    if(!r.ok && _retry<2){
      // السيرفر فشل — امسح الـ probe cache وأعد المحاولة
      _ntfyBaseProbed[base] = 'fail';
      await new Promise(r=>setTimeout(r,500));
      // جرّب base مختلفة
      const newBase = await _pickNtfyBase();
      _ntfyActiveBase[topic] = newBase;
      return ntfyPublish(topic, payload, _retry+1);
    }
    return r.ok;
  }catch(e){
    if(_retry<2){
      _ntfyBaseProbed[base] = 'fail';
      await new Promise(r=>setTimeout(r,800));
      const newBase = await _pickNtfyBase();
      _ntfyActiveBase[topic] = newBase;
      return ntfyPublish(topic, payload, _retry+1);
    }
    console.warn('ntfyPublish error',e);
    return false;
  }
}

/* اشتراك في topic عبر SSE. يُرجع object فيه:
   { close(): void, ready: boolean, onMessage: function }
   EventSource يتصل تلقائياً عند الخطأ (built-in retry).
   نستخدم dedup cache لمنع تكرار الرسائل عند reconnect.
*/
function ntfySubscribe(topic, onMessage, opts){
  opts = opts || {};
  if(!_ntfySeenIds[topic]) _ntfySeenIds[topic] = new Set();
  if(!_ntfyLastId[topic]) _ntfyLastId[topic] = null;

  // ⭐ استخدم الـ active base (مع fallback) — اختار السيرفر الأسرع تلقائياً
  const base = _ntfyActiveBase[topic] || NTFY_BASE;
  _ntfyActiveBase[topic] = base;

  // نبني URL. لو عندنا last id، نطلبه منه فقط (تجنب duplicates).
  // SSE على ntfy يستخدم ?since=<id> للـ catch-up بعد reconnect.
  let url = `${base}/${topic}/sse`;
  const since = _ntfyLastId[topic];
  if(since){ url += `?since=${encodeURIComponent(since)}`; }

  let es = null;
  try{
    es = new EventSource(url, { withCredentials:false });
  }catch(e){
    console.warn('EventSource construct failed',e);
    // fallback: polling
    return ntfySubscribePolling(topic, onMessage, opts);
  }

  es.onopen = ()=>{
    if(opts.onOpen) opts.onOpen();
  };

  es.onmessage = (ev) => {
    try{
      // ev.data: JSON string من ntfy — فيه {id, time, event, topic, message}
      // ev.lastEventId: الـ id (ntfy يضعه في Last-Event-ID header تلقائياً)
      const id = ev.lastEventId || (()=>{ try{return JSON.parse(ev.data).id;}catch(e){return null;} })();
      if(id){ _ntfyLastId[topic] = id; }
      if(id && _ntfySeenIds[topic].has(id)) return; // dedup
      if(id){ _ntfySeenIds[topic].add(id); /* prune إذا كبر */ if(_ntfySeenIds[topic].size>500) _ntfySeenIds[topic] = new Set([..._ntfySeenIds[topic]].slice(-250)); }

      const data = JSON.parse(ev.data);
      if(!data.message) return;
      let payload;
      try{ payload = JSON.parse(data.message); }catch(e){ payload = data.message; }
      onMessage(payload, { id, time: data.time });
    }catch(e){ console.warn('SSE parse err',e); }
  };

  es.onerror = (ev)=>{
    // EventSource ي reconnect تلقائياً — لكن لو فشل، نحاول polling
    if(opts.onError) opts.onError(ev);
    // نبقي الـ ES يحاول، لكن لو closed نهائياً (readyState=2)، ننتقل لـ polling
    if(es.readyState === 2){
      // CLOSED — fallback
      console.warn('SSE closed permanently, switching to polling');
      // ⭐ إذا السيرفر فشل، أعيد المحاولة مع base مختلفة
      _ntfyBaseProbed[base] = 'fail';
      _pickNtfyBase().then(newBase=>{
        if(newBase !== base){
          _ntfyActiveBase[topic] = newBase;
          console.log('[ntfy] reconnecting to fallback:', newBase);
          // أغلق الـ ES الحالي وافتح جديد
          try{es.close();}catch(e){}
          // ابدأ polling على السيرفر الجديد
          ntfySubscribePolling(topic, onMessage, opts);
        } else {
          ntfySubscribePolling(topic, onMessage, opts);
        }
      });
    }
  };

  return {
    close: ()=>{ try{es.close();}catch(e){} },
    ready: true,
    mode: 'sse',
    es
  };
}

/* Polling fallback — يجلب كل X ثانية من ntfy. أبسط، لكن أبطأ.
   يُستخدم فقط لو SSE فشل نهائياً (نادر). */
function ntfySubscribePolling(topic, onMessage, opts){
  let stopped = false;
  const seen = _ntfySeenIds[topic] || (_ntfySeenIds[topic] = new Set());
  let lastId = _ntfyLastId[topic] || null;
  let currentBase = _ntfyActiveBase[topic] || NTFY_BASE;
  _ntfyActiveBase[topic] = currentBase;
  const tick = async ()=>{
    if(stopped) return;
    try{
      let url = `${currentBase}/${topic}/json?poll=1`;
      if(lastId) url += `&since=${encodeURIComponent(lastId)}`;
      const r = await fetch(url, { cache:'no-store' });
      if(!r.ok){
        // السيرفر فشل — جرّب fallback
        _ntfyBaseProbed[currentBase] = 'fail';
        const newBase = await _pickNtfyBase();
        if(newBase !== currentBase){
          currentBase = newBase;
          _ntfyActiveBase[topic] = newBase;
          console.log('[ntfy poll] switching to:', newBase);
        }
        throw new Error('poll http '+r.status);
      }
      const lines = (await r.text()).split('\n').filter(Boolean);
      for(const line of lines){
        try{
          const data = JSON.parse(line);
          if(data.event === 'message' && data.id){
            if(seen.has(data.id)) continue;
            seen.add(data.id);
            lastId = data.id;
            _ntfyLastId[topic] = lastId;
            if(seen.size>500) { const arr=[...seen].slice(-250); _ntfySeenIds[topic]=new Set(arr); seen=_ntfySeenIds[topic]; }
            let payload;
            try{ payload = JSON.parse(data.message); }catch(e){ payload = data.message; }
            onMessage(payload, { id:data.id, time:data.time });
          }
        }catch(e){}
      }
    }catch(e){
      if(opts.onError) opts.onError(e);
    }
    if(!stopped) setTimeout(tick, 2000);
  };
  tick();
  return { close: ()=>{stopped=true;}, ready:true, mode:'polling' };
}

/* ============================================================
   ⭐ LIVEBUS — حافلة أحداث محلية + جسر ntfy للطالبات عن بُعد
   ------------------------------------------------------------
   - على المعلم: .on() يستقبل محلياً + .publishRemote() يبث
     عبر ntfy إلى الطالبات اللواتي انضممن للجلسة
   - على الطالبة: .on() يستقبل من ntfy تلقائياً
   - الهدف: إضافة بث أحداث مركز الألعاب (مثل تحدي السرعة)
     للطالبات على جوالاتهن، بدون بناء قناة رسائل منفصلة
   ============================================================ */
const LiveBus = (function(){
  const subs = {};           // event -> Set<fn>
  const wildSubs = new Set(); // * subscribers

  function on(event, fn){
    if(event === '*'){
      wildSubs.add(fn);
      return () => wildSubs.delete(fn);
    }
    if(!subs[event]) subs[event] = new Set();
    subs[event].add(fn);
    return () => subs[event].delete(fn);
  }

  function emit(event, data){
    const set = subs[event];
    if(set){ set.forEach(fn => { try{ fn(data, event); }catch(e){ console.warn('LiveBus sub error', event, e); } }); }
    wildSubs.forEach(fn => { try{ fn(data, event); }catch(e){} });
  }

  // بثّ للطالبات عبر ntfy + محلياً في نفس الوقت
  // - إذا الجلسة المباشرة مفعّلة: انشر على ntfy (تستقبله الطالبات)
  // - دائماً: انشر محلياً (المعلمة ترى ردّ فعلها فوراً)
  function publishRemote(event, data){
    try{
      const topic = (typeof liveNtfyTopic!=='undefined') ? liveNtfyTopic : null;
      const broadcasting = (typeof liveBroadcasting!=='undefined') ? liveBroadcasting : false;
      if(topic && broadcasting && typeof ntfyPublish === 'function'){
        ntfyPublish(topic, { type:'livebus', event, data, ts:Date.now() });
      }
    }catch(e){ console.warn('LiveBus.publishRemote ntfy failed', event, e); }
    emit(event, data);
  }

  // معالجة رسالة ntfy واردة: إذا كانت livebus، أعد بثّها محلياً
  // تُستدعى من داخل callback الـ liveChannel والـ studentChannel
  function handleIncomingNtfy(msg){
    if(!msg) return;
    if(msg.type === 'livebus' && msg.event){
      // نتجنّب التكرار: إذا البث من نفس الجهاز، .emit يحرّك المستمعين
      // لكن المعلمة نفسها لا تثق بنوع الرسالة 'livebus' إلا إذا جاءت من ntfy
      emit(msg.event, msg.data);
    }
  }

  function clear(){
    Object.keys(subs).forEach(k => subs[k].clear());
    wildSubs.clear();
  }

  return { on, emit, publishRemote, handleIncomingNtfy, clear };
})();
/* نهاية LiveBus */

/* ============================================================
   ⭐ QBANK — بنك أسئلة الألعاب التحفيزية
   ------------------------------------------------------------
   مخزن منفصل عن بنك البث المباشر. يُستخدم في:
   - مكتبة الأسئلة (إضافة/تعديل/حذف/استيراد)
   - تحدي السرعة (محدد السؤال + عشوائي)
   - عجلة الحظ/حرب الفرق/الكنز (مستقبلاً)
   البيانات تُحفظ في localStorage تحت مفتاح mar_games_questions_v1
   ============================================================ */
const QBank = (function(){
  const KEY = 'mar_games_questions_v1';
  const DEFAULT_CATS = ['عام','رياضيات','علوم','لغة عربية','إسلامية','اجتماعيات','لغة إنجليزية'];
  let list = [];
  let customCats = [];
  const subscribers = new Set();

  // ----- load/save -----
  function load(){
    try{
      const raw = localStorage.getItem(KEY);
      if(raw){
        const parsed = JSON.parse(raw);
        if(Array.isArray(parsed.questions)) list = parsed.questions;
        if(Array.isArray(parsed.customCats)) customCats = parsed.customCats;
      }
    }catch(e){ console.warn('QBank load failed',e); list=[]; }
  }
  function save(){
    try{ localStorage.setItem(KEY, JSON.stringify({questions:list, customCats})); }
    catch(e){ console.warn('QBank save failed',e); }
  }

  // ----- subscriptions (لإعادة الرسم) -----
  function subscribe(fn){ subscribers.add(fn); return ()=>subscribers.delete(fn); }
  function notify(){ subscribers.forEach(fn => { try{ fn(); }catch(e){} }); }

  // ----- public API -----
  function all(){ return list.slice(); }
  function get(id){ return list.find(q => q.id === id) || null; }
  function add(q){
    const newQ = {
      id: 'q_' + Date.now() + '_' + Math.random().toString(36).substring(2,6),
      text: (q.text||'').trim(),
      options: Array.isArray(q.options) ? q.options.filter(o => (o||'').trim()) : [],
      correct: typeof q.correct === 'number' ? q.correct : -1,
      category: q.category || 'عام',
      difficulty: q.difficulty || 'medium',
      uses: 0,
      lastUsedAt: null,
      createdAt: Date.now()
    };
    list.push(newQ);
    save(); notify();
    return newQ;
  }
  function update(id, patch){
    const idx = list.findIndex(q => q.id === id);
    if(idx < 0) return null;
    list[idx] = Object.assign({}, list[idx], patch);
    save(); notify();
    return list[idx];
  }
  function remove(id){
    const idx = list.findIndex(q => q.id === id);
    if(idx < 0) return false;
    list.splice(idx, 1);
    save(); notify();
    return true;
  }
  function duplicate(id){
    const src = get(id);
    if(!src) return null;
    return add({
      text: src.text, options: src.options.slice(),
      correct: src.correct, category: src.category,
      difficulty: src.difficulty
    });
  }
  function use(id){
    const q = get(id);
    if(!q) return null;
    q.uses = (q.uses || 0) + 1;
    q.lastUsedAt = Date.now();
    save(); notify();
    return q;
  }
  function categories(){
    const set = new Set(DEFAULT_CATS);
    customCats.forEach(c => set.add(c));
    list.forEach(q => { if(q.category) set.add(q.category); });
    return Array.from(set);
  }
  function addCustomCategory(name){
    name = (name||'').trim();
    if(!name) return false;
    if(DEFAULT_CATS.includes(name) || customCats.includes(name)) return false;
    customCats.push(name);
    save(); notify();
    return true;
  }
  function pickRandom(filter){
    let pool = list.slice();
    if(filter && filter.category) pool = pool.filter(q => q.category === filter.category);
    if(filter && filter.difficulty) pool = pool.filter(q => q.difficulty === filter.difficulty);
    if(filter && filter.unused) pool = pool.filter(q => !q.uses);
    if(pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function mostUsed(){
    if(list.length === 0) return null;
    return list.slice().sort((a,b) => (b.uses||0) - (a.uses||0))[0];
  }
  function clearAll(){
    list = [];
    save(); notify();
  }
  function exportJson(){
    return JSON.stringify({questions: list, customCats}, null, 2);
  }
  function importJson(json){
    try{
      const data = JSON.parse(json);
      if(Array.isArray(data.questions)){
        list = data.questions.map(q => Object.assign({
          id: 'q_' + Date.now() + '_' + Math.random().toString(36).substring(2,6),
          uses: 0, lastUsedAt: null, createdAt: Date.now()
        }, q));
        if(Array.isArray(data.customCats)) customCats = data.customCats;
        save(); notify();
        return list.length;
      }
    }catch(e){ console.warn('QBank import failed',e); }
    return 0;
  }

  load();
  return { all, get, add, update, remove, duplicate, use, categories, addCustomCategory, pickRandom, mostUsed, clearAll, exportJson, importJson, subscribe, DEFAULT_CATS };
})();
/* نهاية QBank */

/* helper للاحفظي (ياحفظي كل أنواع الجلسات + استطلاعات + جلسات مباشرة) */
function _persistDataExt(){
  try{
    localStorage.setItem('mar_polls', JSON.stringify(Data.polls||[]));
    localStorage.setItem('mar_live', JSON.stringify(Data.liveSessions||[]));
  }catch(e){}
}
function _loadDataExt(){
  try{
    Data.polls = JSON.parse(localStorage.getItem('mar_polls')||'[]');
    Data.liveSessions = JSON.parse(localStorage.getItem('mar_live')||'[]');
  }catch(e){Data.polls=[];Data.liveSessions=[];}
}

/* ============================================================
   CHART.JS WRAPPER
   ============================================================ */
let _chartRegistry = {};
function destroyChart(id){
  if(_chartRegistry[id]){try{_chartRegistry[id].destroy();}catch(e){} _chartRegistry[id]=null;}
}
// تسجيل plugin datalabels عند أول استخدام
let _datalabelsRegistered = false;
function _ensureDatalabels(){
  if(_datalabelsRegistered)return;
  if(typeof Chart!=='undefined' && typeof ChartDataLabels!=='undefined'){
    try{Chart.register(ChartDataLabels);}catch(e){}
    _datalabelsRegistered = true;
  }
}
function makeBarChart(canvasId, labels, data, label, color){
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId); if(!ctx || typeof Chart==='undefined') return;
  _ensureDatalabels();
  // دعم ألوان متعددة لكل عمود (مصفوفة) أو لون واحد
  const bgColor = Array.isArray(color) ? color : color;
  _chartRegistry[canvasId] = new Chart(ctx, {
    type:'bar',
    data:{labels, datasets:[{label, data, backgroundColor:bgColor, borderRadius:6, borderWidth:0}]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}, datalabels:{anchor:'end',align:'top',color:'#222',font:{weight:'800',size:11},formatter:v=>v}},
      scales:{y:{beginAtZero:true, ticks:{precision:0}}}
    }
  });
}
function makePieChart(canvasId, labels, data, colors){
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId); if(!ctx || typeof Chart==='undefined') return;
  _ensureDatalabels();
  _chartRegistry[canvasId] = new Chart(ctx, {
    type:'doughnut',
    data:{labels, datasets:[{data, backgroundColor:colors, borderWidth:2, borderColor:'#fff'}]},
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'55%',
      plugins:{legend:{position:'bottom', labels:{font:{size:11}}}, datalabels:{color:'#fff',font:{weight:'800',size:12},formatter:v=>v>0?v:''}}
    }
  });
}
function makeHorizontalBar(canvasId, labels, data, label, color){
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId); if(!ctx || typeof Chart==='undefined') return;
  _ensureDatalabels();
  _chartRegistry[canvasId] = new Chart(ctx, {
    type:'bar',
    data:{labels, datasets:[{label, data, backgroundColor:color, borderRadius:6}]},
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}, datalabels:{anchor:'end',align:'right',color:'#222',font:{weight:'800',size:11},formatter:v=>v}},
      scales:{x:{beginAtZero:true, ticks:{precision:0}}}
    }
  });
}

/* POLLS */
let pollChannel=null,pollSessionCode=null;
let pollNtfyTopic=null;
let exitNtfyTopic=null;
let liveNtfyTopic=null;
let activePoll=null;   /* ⭐ FIX: كان غير مُعلَن → ReferenceError في الوضع الصارم ('use strict' في أعلى الملف) — كان يكسر createPoll() ويمنع توليد QR يحوي السؤال، فتظهر الطالبة صفحة "في انتظار..." بلا نهاية */
function openPollModal(){openModal('modalPoll');if(!pollSessionCode)startPollSession();showPollQR();}
function startPollSession(){
  pollSessionCode=Math.random().toString(36).substring(2,8).toUpperCase();
  pollNtfyTopic=_topic('poll-'+pollSessionCode);
  if(pollChannel){try{pollChannel.close();}catch(e){} pollChannel=null;}
  pollChannel = ntfySubscribe(pollNtfyTopic, (msg)=>{
    if(msg.type==='vote') addPollVote(msg.name,msg.option);
  });
  // احفظي في Data.polls إذا بدأ استطلاع
  toast('info','بدأ الاستطلاع - الكود: '+pollSessionCode);
}
function showPollQR(){
  if(!pollSessionCode)startPollSession();
  const q=document.getElementById('pollQ').value.trim()||'الاستطلاع';
  const opts=document.getElementById('pollOpts').value.split('\n').map(o=>o.trim()).filter(Boolean);
  const qData = (q && q !== 'الاستطلاع' && opts.length) ? {title:q, options:opts} : null;
  const joinUrl=buildJoinUrl('poll', pollSessionCode, pollNtfyTopic, qData);
  const urlWarning = document.getElementById('qrUrlWarning');
  if(urlWarning){
    const isInvalid = joinUrl.startsWith('?') || joinUrl.includes('localhost') || joinUrl.includes('127.0.0.1') || joinUrl.includes('file://') || joinUrl.includes('srcdoc');
    urlWarning.style.display = isInvalid ? 'block' : 'none';
    if(isInvalid){ showToast('⚠️ رابط QR غير صالح للطالبات! اضبطي رابط الصفحة أولاً', 'warning'); }
  }
  makeQR('pollQRImg', joinUrl, {width:220, height:220});
  document.getElementById('pollLiveResponses').style.display='block';
  const host = document.getElementById('pollQRImg');
  if(host){
    host.dataset.url=joinUrl;
    host.dataset.q=q;
    host.dataset.opts=JSON.stringify(opts);
  }
  updatePollQuestionPreview();
  if(opts.length && pollNtfyTopic){
    ntfyPublish(pollNtfyTopic, {type:'pollQ', q:q, opts:opts, ts:Date.now()});
  }
  let urlBox = document.getElementById('pollUrlBox');
  if(!urlBox){
    urlBox = document.createElement('div');
    urlBox.id = 'pollUrlBox';
    urlBox.style.cssText = 'margin-top:10px;text-align:center';
    host.parentNode.parentNode.appendChild(urlBox);
  }
  urlBox.innerHTML = `
    <div style="background:#fff;border:2px solid #1a5f7a;border-radius:8px;padding:8px;margin-top:8px;word-break:break-all;font-size:.7rem;direction:ltr;text-align:left" id="pollUrlText">${joinUrl}</div>
    <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;justify-content:center">
      <button class="btn btn-success btn-sm" onclick="sharePollUrl('whatsapp')" title="مشاركة عبر واتساب"><i class="fab fa-whatsapp"></i> واتساب</button>
      <button class="btn btn-primary btn-sm" onclick="copyPollLink()" title="انسخي الرابط"><i class="fas fa-copy"></i> نسخ</button>
    </div>
    <div style="font-size:.7rem;color:#888;margin-top:4px">💡 لو الطالبات ما قدرن يمسحن الـ QR، ابعثي الرابط عبر واتساب</div>
  `;
}
/* sharePollUrl() — يفتح واتساب/تلقرام/إيميل مع الرابط */
function sharePollUrl(channel){
  const host=document.getElementById('pollQRImg');
  if(!host||!host.dataset.url){toast('error','لا يوجد رابط');return;}
  const url = host.dataset.url;
  const q = host.dataset.q || 'الاستطلاع';
  const text = `📊 استطلاع: ${q}\n${url}`;
  if(channel==='whatsapp'){
    // wa.me يفتح واتساب مباشرة بالجوال أو نسخة الويب
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
    toast('success','تم فتح واتساب — ابعثي الرسالة');
  }
}
function updatePollQuestionPreview(){
  const q=document.getElementById('pollQ').value.trim()||'الاستطلاع';
  const preview=document.getElementById('pollCurrentQPreview');
  const text=document.getElementById('pollCurrentQText');
  if(!preview||!text)return;
  text.textContent=q;
  preview.style.display='block';
}
function copyPollLink(){
  const host=document.getElementById('pollQRImg');
  if(!host)return;
  const url=host.dataset.url;
  navigator.clipboard.writeText(url).then(()=>toast('success','تم انسخي الرابط'));
}
function addPollVote(name,optionIdx){
  if(!activePoll)return;
  activePoll.votes[optionIdx]=(activePoll.votes[optionIdx]||0)+1;
  if(!activePoll.voters)activePoll.voters=[];
  activePoll.voters.push({name:name,option:optionIdx,time:new Date().toISOString()});
  // احفظي في Data.polls (مصدر التقرير الإحصائي)
  Data.polls = Data.polls || [];
  // ابحثي عن نفس poll النشط أو أضيفي سجلّاً جديداً
  let pollRec = Data.polls.find(p=>p.code===pollSessionCode && !p.endedAt);
  if(!pollRec){
    pollRec = {code:pollSessionCode, q:activePoll.q, opts:activePoll.opts, votes:JSON.parse(JSON.stringify(activePoll.votes)), voters:[], createdAt:new Date().toISOString(), endedAt:null};
    Data.polls.push(pollRec);
  }
  pollRec.votes[optionIdx] = activePoll.votes[optionIdx];
  pollRec.voters = activePoll.voters.slice();
  _persistDataExt();
  renderPoll();
  renderPollLive();
  toast('info','صوت جديد: '+name);
}
function renderPollLive(){
  const list=document.getElementById('pollLiveList');
  if(!list||!activePoll)return;
  if(!activePoll.voters||!activePoll.voters.length){list.innerHTML='<div style="text-align:center;padding:14px;color:#888">في انتظار أصوات الطالبات...</div>';return;}
  const recent=activePoll.voters.slice(-15).reverse();
  list.innerHTML=recent.map(v=>{
    const optText=activePoll.opts[v.option]||'?';
    const safe=escapeHtml(v.name||'طالبة');
    return `<div class="live-response-item"><div class="lr-av" title="${safe}"><i class="fas fa-user"></i></div><div class="lr-name" title="${safe}">${safe}</div><div class="lr-ans">${escapeHtml(optText)}</div><div class="lr-time">${formatTime(v.time)}</div></div>`;
  }).join('');
}
function addPollQRToBoard(){
  const host=document.getElementById('pollQRImg');
  if(!host||!host.querySelector('canvas')){toast('error','أنشئيي الاستطلاع أولاً');return;}
  const qrCanvas=host.querySelector('canvas');
  const url=host.dataset.url;
  const q=host.dataset.q;
  const opts=JSON.parse(host.dataset.opts||'[]');
  const tmp=document.createElement('canvas');
  tmp.width=520;tmp.height=300;
  const tctx=tmp.getContext('2d');
  tctx.fillStyle='#ffffff';tctx.fillRect(0,0,tmp.width,tmp.height);
  tctx.drawImage(qrCanvas,20,20,200,200);
  tctx.fillStyle='#1a5f7a';
  tctx.font='bold 20px Tajawal,sans-serif';
  tctx.textBaseline='top';
  tctx.direction='rtl';
  tctx.fillText('📊 استطلاع: '+q,tmp.width-20,30);
  tctx.fillStyle='#3498db';
  tctx.font='bold 16px Tajawal,sans-serif';
  tctx.fillText('الكود: '+pollSessionCode,tmp.width-20,68);
  tctx.fillStyle='#666';
  tctx.font='bold 12px Tajawal,sans-serif';
  tctx.fillText('📱 اسمحي للتصويت',tmp.width-20,95);
  if(opts.length){
    tctx.fillStyle='#444';
    tctx.font='12px Tajawal,sans-serif';
    opts.forEach((o,i)=>{
      tctx.fillText('• '+o,tmp.width-20,125+i*18);
    });
  }
  tctx.fillStyle='#999';
  tctx.font='10px Tajawal,sans-serif';
  const maxW=tmp.width-240;
  const words=url.split('');
  let line='',y=tmp.height-50;
  for(let i=0;i<words.length;i++){
    const test=line+words[i];
    if(tctx.measureText(test).width>maxW&&i>0){
      tctx.fillText(line,tmp.width-20,y);
      line=words[i];
      y+=14;
    }else line=test;
  }
  tctx.fillText(line,tmp.width-20,y);
  const dpr=window.devicePixelRatio||1;
  const w=Math.min(tmp.width,canvas.width/dpr*.6);
  const h=tmp.height*(w/tmp.width);
  const x=canvas.width/dpr/2-w/2;
  const yc=canvas.height/dpr/2-h/2;
  ctx.drawImage(tmp,x,yc,w,h);
  saveHistory();
  toast('success','تم إضافة QR الاستطلاع للسبورة');
}
function createPoll(){
  const q=document.getElementById('pollQ').value.trim();
  const opts=document.getElementById('pollOpts').value.split('\n').map(o=>o.trim()).filter(Boolean);
  if(!q||!opts.length){toast('error','أدخلي السؤال والخيارات');return;}
  if(!pollSessionCode)startPollSession();
  activePoll={q,opts,votes:new Array(opts.length).fill(0),voters:[]};
  // ابدئي سجلاً في Data.polls
  Data.polls = Data.polls || [];
  // أنهِ أي استطلاع سابق بنفس الكود
  Data.polls.forEach(p=>{if(p.code===pollSessionCode&&!p.endedAt)p.endedAt=new Date().toISOString();});
  Data.polls.push({code:pollSessionCode, q, opts, votes:new Array(opts.length).fill(0), voters:[], createdAt:new Date().toISOString(), endedAt:null});
  _persistDataExt();
  renderPoll();
  showPollQR();
  // بث السؤال للطالبات المنتظِرات — مع تحقّق من النتيجة
  if(pollNtfyTopic){
    ntfyPublish(pollNtfyTopic, {type:'pollQ', q, opts, ts:Date.now()}).then(ok=>{
      if(!ok){
        toast('warning','⚠️ تعذّر بث السؤال عبر ntfy — حدّثي صفحة الطالبة يدوياً أو أعيدي مسح الـ QR المُحدّث');
      }
    });
  }
  // ** مُهم: حدّث QR ليشمل السؤال — يضمن ظهوره للطالبة حتى لو ntfy محجوب **
  const pollHost = document.getElementById('pollQRImg');
  if(pollHost){
    const joinUrl = buildJoinUrl('poll', pollSessionCode, pollNtfyTopic, {title:q, options:opts});
    pollHost.innerHTML='';
    // ⭐ QR 320px + مستوى تصحيح منخفض (L) — يقبل روابط طويلة بسهولة
    try{ new QRCode(pollHost,{text:joinUrl,width:220,height:220,colorDark:'#1a5f7a',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.L}); }catch(e){}
    pollHost.dataset.url = joinUrl;
    pollHost.dataset.q = q;
    pollHost.dataset.opts = JSON.stringify(opts);
    // ⭐ أعرضي/أحدّثي صندوق الرابط تحت الـ QR
    let urlBox = document.getElementById('pollUrlBox');
    if(!urlBox){
      urlBox = document.createElement('div');
      urlBox.id = 'pollUrlBox';
      urlBox.style.cssText = 'margin-top:10px;text-align:center';
      pollHost.parentNode.parentNode.appendChild(urlBox);
    }
    urlBox.innerHTML = `
      <div style="background:#fff;border:2px solid #1a5f7a;border-radius:8px;padding:8px;margin-top:8px;word-break:break-all;font-size:.7rem;direction:ltr;text-align:left" id="pollUrlText">${joinUrl}</div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;justify-content:center">
        <button class="btn btn-success btn-sm" onclick="sharePollUrl('whatsapp')" title="مشاركة عبر واتساب"><i class="fab fa-whatsapp"></i> واتساب</button>
        <button class="btn btn-primary btn-sm" onclick="copyPollLink()" title="انسخي الرابط"><i class="fas fa-copy"></i> نسخ</button>
      </div>
      <div style="font-size:.7rem;color:#888;margin-top:4px">💡 لو الطالبات ما قدرن يمسحن الـ QR، ابعثي الرابط عبر واتساب</div>
    `;
    const linkEl = document.getElementById('pollSessionUrl') || document.getElementById('pollLinkTxt');
    if(linkEl) linkEl.textContent = joinUrl;
  }
  toast('success','بدأ الاستطلاع! ااعرضي QR للطالبات');
}
function votePoll(idx){if(!activePoll)return;activePoll.votes[idx]++;if(!activePoll.voters)activePoll.voters=[];activePoll.voters.push({name:"المعلمة (اختبار)",option:idx,time:new Date().toISOString()});renderPoll();}
function renderPoll(){
  if(!activePoll)return;
  const total=activePoll.votes.reduce((a,b)=>a+b,0)||1;
  document.getElementById('pollDisplay').innerHTML=`<h4 style="margin-bottom:10px;color:var(--dark)">${escapeHtml(activePoll.q)}</h4><div style="font-size:.78rem;color:#666;margin-bottom:8px">إجمالي الأصوات: ${total}</div>`+activePoll.opts.map((o,i)=>{const pct=Math.round(activePoll.votes[i]/total*100);return`<div class="poll-bar" ><div class="pb-fill" style="width:${pct}%">${o}</div><div class="pb-percent">${pct}% (${activePoll.votes[i]})</div></div>`;}).join('');
  renderPollLive();
}

/* ==================== PERIODIC TABLE — Interactive, All 118 ==================== */
// Element data: z=atomic number, s=symbol, ar=Arabic name, en=English name, m=mass, c=category,
// g=group (1-18), p=period (1-7), b=block (s/p/d/f), e=electron config,
// desc=description, uses=uses, state=state at 20°C, dens=density (g/cm³ or g/L for gases),
// mp=melting pt (°C), bp=boiling pt (°C), eneg=electronegativity, ar2=atomic radius (pm), ie=1st ionization (kJ/mol)
const ELEMENTS = [
{z:1,s:'H',ar:'هيدروجين',en:'Hydrogen',m:1.008,c:'nonmetal',g:1,p:1,b:'s',e:'1s¹',desc:'أخف العناصر وأكثرها وفرة في الكون. غاز عديم اللون والرائحة.',uses:'وقود الصواريخ، إنتاج الأمونيا، تكرير النفط، خلايا الوقود.',state:'gas',dens:0.00008988,mp:-259.16,bp:-252.879,eneg:2.20,ar2:53,ie:1312.0},
{z:2,s:'He',ar:'هيليوم',en:'Helium',m:4.0026,c:'noble',g:18,p:1,b:'s',e:'1s²',desc:'غاز نبيل خامل جداً. ثاني أخف العناصر. ينتج من تحلل اليورانيوم.',uses:'بالونات المناطيد، غاز التنفس في أعماق البحار، تبريد أجهزة MRI، اللحام.',state:'gas',dens:0.0001785,mp:-272.2,bp:-268.928,eneg:'—',ar2:31,ie:2372.3},
{z:3,s:'Li',ar:'ليثيوم',en:'Lithium',m:6.94,c:'alkali',g:1,p:2,b:'s',e:'[He] 2s¹',desc:'أخف الفلزات. فلز قلوي فضي ناعم يتفاعل بشدة مع الماء.',uses:'بطاريات الليثيوم أيون، أدوية الاضطرابات النفسية، سبائك خفيفة.',state:'solid',dens:0.534,mp:180.50,bp:1342,eneg:0.98,ar2:167,ie:520.2},
{z:4,s:'Be',ar:'بريليوم',en:'Beryllium',m:9.0122,c:'alkaline',g:2,p:2,b:'s',e:'[He] 2s²',desc:'فلز قلوي ترابي صلب رمادي. خفيف وقوي، سام.',uses:'مكونات الطائرات والفضاء، نوافذ الأشعة السينية، السبائك.',state:'solid',dens:1.85,mp:1287,bp:2469,eneg:1.57,ar2:112,ie:899.5},
{z:5,s:'B',ar:'بورون',en:'Boron',m:10.81,c:'metalloid',g:13,p:2,b:'p',e:'[He] 2s² 2p¹',desc:'شبه فلز. صلبة جداً ومقاومة للحرارة. ضروري للنباتات.',uses:'زجاج البورسليكات، مغناطيسات NdB، مكونات أشباه الموصلات.',state:'solid',dens:2.34,mp:2075,bp:4000,eneg:2.04,ar2:87,ie:800.6},
{z:6,s:'C',ar:'كربون',en:'Carbon',m:12.011,c:'nonmetal',g:14,p:2,b:'p',e:'[He] 2s² 2p²',desc:'أساس الكيمياء العضوية. يوجد كألماس، جرافيت، فوليرين، جرافين.',uses:'الوقود الأحفوري، البوليمرات، الأدوية، أقلام الرصاص، الألياف الكربونية.',state:'solid',dens:2.267,mp:3550,bp:4027,eneg:2.55,ar2:67,ie:1086.5},
{z:7,s:'N',ar:'نيتروجين',en:'Nitrogen',m:14.007,c:'nonmetal',g:15,p:2,b:'p',e:'[He] 2s² 2p³',desc:'78% من الغلاف الجوي. غاز خامل يستخدم في التبريد والتجميد.',uses:'الأسمية (الأمونيا، النترات)، التبريد، الحشو في الإطارات، النيتروجين السائل.',state:'gas',dens:0.0012506,mp:-210.0,bp:-195.795,eneg:3.04,ar2:56,ie:1402.3},
{z:8,s:'O',ar:'أوكسجين',en:'Oxygen',m:15.999,c:'nonmetal',g:16,p:2,b:'p',e:'[He] 2s² 2p⁴',desc:'ضروري للتنفس والاحتراق. 21% من الغلاف الجوي.',uses:'التنفس الطبي، اللحام، صناعة الصلب، دعم الحياة في المستشفيات.',state:'gas',dens:0.001429,mp:-218.79,bp:-182.962,eneg:3.44,ar2:48,ie:1313.9},
{z:9,s:'F',ar:'فلور',en:'Fluorine',m:18.998,c:'halogen',g:17,p:2,b:'p',e:'[He] 2s² 2p⁵',desc:'أكثر العناصر كهرسلبية. غاز أصفر شاحب سام جداً.',uses:'معجون الأسنان (الفلورايد)، Teflon، تكييف الهواء (CFCs)، الأدوية.',state:'gas',dens:0.001696,mp:-219.62,bp:-188.12,eneg:3.98,ar2:42,ie:1681.0},
{z:10,s:'Ne',ar:'نيون',en:'Neon',m:20.180,c:'noble',g:18,p:2,b:'p',e:'[He] 2s² 2p⁶',desc:'غاز نبيل ينبعث منه ضوء برتقالي محمر عند التفريغ الكهربائي.',uses:'لافتات الإعلانات المضيئة، الليزر، مؤشرات الجهد العالي.',state:'gas',dens:0.0008999,mp:-248.59,bp:-246.046,eneg:'—',ar2:38,ie:2080.7},
{z:11,s:'Na',ar:'صوديوم',en:'Sodium',m:22.990,c:'alkali',g:1,p:3,b:'s',e:'[Ne] 3s¹',desc:'فلز قلوي فضي ناعم. ضروري للأعصاب وتنظيم السوائل في الجسم.',uses:'ملح الطعام، الصابون، مصابيح بخار الصوديوم، تبريد المفاعلات.',state:'solid',dens:0.97,mp:97.794,bp:882.940,eneg:0.93,ar2:190,ie:495.8},
{z:12,s:'Mg',ar:'مغنيسيوم',en:'Magnesium',m:24.305,c:'alkaline',g:2,p:3,b:'s',e:'[Ne] 3s²',desc:'فلز خفيف قابل للاشتعال، يشتعل بضوء أبيض ساطع.',uses:'سبائك خفيفة، الألعاب النارية، الطب (مكملات، حموضة)، سيارات.',state:'solid',dens:1.738,mp:650,bp:1091,eneg:1.31,ar2:145,ie:737.7},
{z:13,s:'Al',ar:'ألمنيوم',en:'Aluminium',m:26.982,c:'post',g:13,p:3,b:'p',e:'[Ne] 3s² 3p¹',desc:'أكثر الفلزات وفرة في القشرة الأرضية. خفيف ومقاوم للتآكل.',uses:'علب المشروبات، هياكل الطائرات، رقائق الألومنيوم، أسلاك الكهرباء.',state:'solid',dens:2.70,mp:660.32,bp:2519,eneg:1.61,ar2:118,ie:577.5},
{z:14,s:'Si',ar:'سيليكون',en:'Silicon',m:28.085,c:'metalloid',g:14,p:3,b:'p',e:'[Ne] 3s² 3p²',desc:'شبه فلز. ثاني أكثر العناصر وفرة في القشرة. أساس الإلكترونيات.',uses:'رقائق الكمبيوتر، الخلايا الشمسية، الزجاج، السليكون، مواد البناء.',state:'solid',dens:2.3296,mp:1414,bp:3265,eneg:1.90,ar2:111,ie:786.5},
{z:15,s:'P',ar:'فوسفور',en:'Phosphorus',m:30.974,c:'nonmetal',g:15,p:3,b:'p',e:'[Ne] 3s² 3p³',desc:'لا فلز أساسي لـ DNA و ATP. يوجد بأشكال متعددة (أبيض، أحمر، أسود).',uses:'الأسمدة، أعواد الثقاب، المبيدات، المنظفات، الصلب.',state:'solid',dens:1.823,mp:44.15,bp:280.5,eneg:2.19,ar2:98,ie:1011.8},
{z:16,s:'S',ar:'كبريت',en:'Sulfur',m:32.06,c:'nonmetal',g:16,p:3,b:'p',e:'[Ne] 3s² 3p⁴',desc:'لا فلز أصفر. مركباته مسؤولة عن رائحة البيض الفاسد.',uses:'حمض الكبريتيك، الأسمدة، الفلكنة (المطاط)، المبيدات، البارود.',state:'solid',dens:2.07,mp:115.21,bp:444.61,eneg:2.58,ar2:88,ie:999.6},
{z:17,s:'Cl',ar:'كلور',en:'Chlorine',m:35.45,c:'halogen',g:17,p:3,b:'p',e:'[Ne] 3s² 3p⁵',desc:'غاز أصفر مخضر سام. مطهر قوي.',uses:'تعقيم المياه، تصنيع PVC، المبيضات، الملح (NaCl).',state:'gas',dens:0.003214,mp:-101.5,bp:-34.04,eneg:3.16,ar2:79,ie:1251.2},
{z:18,s:'Ar',ar:'أرجون',en:'Argon',m:39.948,c:'noble',g:18,p:3,b:'p',e:'[Ne] 3s² 3p⁶',desc:'غاز نبيل. ثالث أكثر الغازات في الغلاف الجوي (0.93%).',uses:'اللحام بالغاز الخامل، المصابيح الكهربائية، احفظي الأغذية، حماية اللحام.',state:'gas',dens:0.0017837,mp:-189.34,bp:-185.848,eneg:'—',ar2:71,ie:1520.6},
{z:19,s:'K',ar:'بوتاسيوم',en:'Potassium',m:39.098,c:'alkali',g:1,p:4,b:'s',e:'[Ar] 4s¹',desc:'فلز قلوي ناعم. ضروري لعمل الأعصاب والعضلات.',uses:'الأسمية، نترات البوتاسيوم (البارود)، الصابون، أملاح بديلة.',state:'solid',dens:0.862,mp:63.5,bp:759,eneg:0.82,ar2:243,ie:418.8},
{z:20,s:'Ca',ar:'كالسيوم',en:'Calcium',m:40.078,c:'alkaline',g:2,p:4,b:'s',e:'[Ar] 4s²',desc:'فلز قلوي ترابي. ضروري للعظام والأسنان.',uses:'الأسمنت والجير، الطب (مكملات، حموضة)، صناعة الصلب.',state:'solid',dens:1.55,mp:842,bp:1484,eneg:1.00,ar2:194,ie:589.8},
{z:21,s:'Sc',ar:'سكانديوم',en:'Scandium',m:44.956,c:'transition',g:3,p:4,b:'d',e:'[Ar] 3d¹ 4s²',desc:'فلز انتقالي فضي. نادر وقوي.',uses:'إضاءة المسارح (مصابيح الهاليد)، سبائك الألومنيوم (الدراجات، المضارب).',state:'solid',dens:2.985,mp:1541,bp:2836,eneg:1.36,ar2:184,ie:633.1},
{z:22,s:'Ti',ar:'تيتانيوم',en:'Titanium',m:47.867,c:'transition',g:4,p:4,b:'d',e:'[Ar] 3d² 4s²',desc:'فلز قوي خفيف مقاوم للتآكل. حيوي التوافق.',uses:'زراعة الأسنان والعظام، الطائرات، الغواصات، الساعات، الدهانات.',state:'solid',dens:4.506,mp:1668,bp:3287,eneg:1.54,ar2:176,ie:658.8},
{z:23,s:'V',ar:'فاناديوم',en:'Vanadium',m:50.942,c:'transition',g:5,p:4,b:'d',e:'[Ar] 3d³ 4s²',desc:'فلز صلب. يقوي السبائك.',uses:'سبائك الفاناديوم (أدوات القطع، الينابيع)، المحفزات.',state:'solid',dens:6.0,mp:1910,bp:3407,eneg:1.63,ar2:171,ie:650.9},
{z:24,s:'Cr',ar:'كروم',en:'Chromium',m:51.996,c:'transition',g:6,p:4,b:'d',e:'[Ar] 3d⁵ 4s¹',desc:'فلز لامع مقاوم للتآكل. لونه مميز.',uses:'الطلاء الكروم، الفولاذ المقاوم للصدأ، الأصباغ، دباغة الجلود.',state:'solid',dens:7.19,mp:1907,bp:2671,eneg:1.66,ar2:166,ie:652.9},
{z:25,s:'Mn',ar:'منغنيز',en:'Manganese',m:54.938,c:'transition',g:7,p:4,b:'d',e:'[Ar] 3d⁵ 4s²',desc:'فلز هش صلب رمادي. ضروري لعلم الأحياء.',uses:'سبائك الصلب (الفولاذ Mn)، البطاريات الجافة، المغذيات النباتية.',state:'solid',dens:7.21,mp:1246,bp:2061,eneg:1.55,ar2:161,ie:717.3},
{z:26,s:'Fe',ar:'حديد',en:'Iron',m:55.845,c:'transition',g:8,p:4,b:'d',e:'[Ar] 3d⁶ 4s²',desc:'أكثر فلزات الأرض وفرة. أساس صناعة الصلب.',uses:'الصلب والمباني، الدم (الهيموجلوبين)، المغناطيسات، الجسور.',state:'solid',dens:7.874,mp:1538,bp:2861,eneg:1.83,ar2:156,ie:762.5},
{z:27,s:'Co',ar:'كوبالت',en:'Cobalt',m:58.933,c:'transition',g:9,p:4,b:'d',e:'[Ar] 3d⁷ 4s²',desc:'فلز مغناطيسي أزرق فضي.',uses:'بطاريات الليثيوم أيون، السبائك فائقة القوة، الأصباغ الزرقاء، نظائر مشعة للسرطان.',state:'solid',dens:8.90,mp:1495,bp:2927,eneg:1.88,ar2:152,ie:760.4},
{z:28,s:'Ni',ar:'نيكل',en:'Nickel',m:58.693,c:'transition',g:10,p:4,b:'d',e:'[Ar] 3d⁸ 4s²',desc:'فلز أبيض فضي مقاوم للتآكل. مغناطيسي.',uses:'طلاء النيكل، العملات المعدنية، البطاريات، السبائك المقاومة للحرارة.',state:'solid',dens:8.908,mp:1455,bp:2913,eneg:1.91,ar2:149,ie:737.1},
{z:29,s:'Cu',ar:'نحاس',en:'Copper',m:63.546,c:'transition',g:11,p:4,b:'d',e:'[Ar] 3d¹⁰ 4s¹',desc:'موصل ممتازة للكهرباء والحرارة. فلز أحمر.',uses:'الأسلاك الكهربائية، السباكة، السبائك (النحاس، البرونز)، الإلكترونيات.',state:'solid',dens:8.96,mp:1084.62,bp:2562,eneg:1.90,ar2:145,ie:745.5},
{z:30,s:'Zn',ar:'زنك',en:'Zinc',m:65.38,c:'transition',g:12,p:4,b:'d',e:'[Ar] 3d¹⁰ 4s²',desc:'فلز أبيض مزرق. يستخدم لطلاء الحديد (الجلفنة).',uses:'الجلفنة، النحاس الأصفر (Zn+Cu)، البطاريات، أكسيد الزنك (مراهم وكريمات).',state:'solid',dens:7.14,mp:419.527,bp:907,eneg:1.65,ar2:142,ie:906.4},
{z:31,s:'Ga',ar:'غاليوم',en:'Gallium',m:69.723,c:'post',g:13,p:4,b:'p',e:'[Ar] 3d¹⁰ 4s² 4p¹',desc:'فلز ينصهر في راحة اليد (29.76°C).',uses:'أشباه الموصلات (GaAs)، LEDs، الثرمومترات، المرايا الساخنة.',state:'solid',dens:5.91,mp:29.7646,bp:2204,eneg:1.81,ar2:136,ie:578.8},
{z:32,s:'Ge',ar:'جرمانيوم',en:'Germanium',m:72.630,c:'metalloid',g:14,p:4,b:'p',e:'[Ar] 3d¹⁰ 4s² 4p²',desc:'شبه فلز. مهم في الإلكترونيات وأشعة تحت الحمراء.',uses:'أشباه الموصلات، كواشف الأشعة تحت الحمراء، الألياف البصرية، الخلايا الشمسية.',state:'solid',dens:5.323,mp:938.25,bp:2833,eneg:2.01,ar2:125,ie:762.0},
{z:33,s:'As',ar:'زرنيخ',en:'Arsenic',m:74.922,c:'metalloid',g:15,p:4,b:'p',e:'[Ar] 3d¹⁰ 4s² 4p³',desc:'شبه فلز سام جداً.',uses:'سبائك الرصاص (بطاريات)، المبيدات (قديماً)، أشباه الموصلات (GaAs).',state:'solid',dens:5.727,mp:817,bp:614,eneg:2.18,ar2:114,ie:947.0},
{z:34,s:'Se',ar:'سيلينيوم',en:'Selenium',m:78.971,c:'nonmetal',g:16,p:4,b:'p',e:'[Ar] 3d¹⁰ 4s² 4p⁴',desc:'لا فلز ضروري بكميات ضئيلة. موصل ضوئي.',uses:'الخلايا الشمسية، استنشاخ الوثائق (آلات التصوير)، شامبو قشرة الرأس.',state:'solid',dens:4.81,mp:221,bp:685,eneg:2.55,ar2:103,ie:941.0},
{z:35,s:'Br',ar:'بروم',en:'Bromine',m:79.904,c:'halogen',g:17,p:4,b:'p',e:'[Ar] 3d¹⁰ 4s² 4p⁵',desc:'هالوجين سائل بني محمر. أبخرة سامّة.',uses:'مثبطات اللهب، المبيدات، الأدوية، التصوير الفوتوغرافي، تعقيم المسابح.',state:'liquid',dens:3.1028,mp:-7.2,bp:58.8,eneg:2.96,ar2:94,ie:1139.9},
{z:36,s:'Kr',ar:'كريبتون',en:'Krypton',m:83.798,c:'noble',g:18,p:4,b:'p',e:'[Ar] 3d¹⁰ 4s² 4p⁶',desc:'غاز نبيل نادر. ينبعث منه ضوء أبيض.',uses:'مصابيح الفلاش عالية السرعة، الإضاءة المضيئة، ليزر العيون.',state:'gas',dens:0.003733,mp:-157.37,bp:-153.415,eneg:3.00,ar2:88,ie:1350.8},
{z:37,s:'Rb',ar:'روبيديوم',en:'Rubidium',m:85.468,c:'alkali',g:1,p:5,b:'s',e:'[Kr] 5s¹',desc:'فلز قلوي ناعم جداً. يشتعل تلقائياً في الهواء.',uses:'الساعات الذرية، الخلايا الكهروضوئية، الأبحاث الطبية.',state:'solid',dens:1.532,mp:39.31,bp:688,eneg:0.82,ar2:265,ie:403.0},
{z:38,s:'Sr',ar:'سترونشيوم',en:'Strontium',m:87.62,c:'alkaline',g:2,p:5,b:'s',e:'[Kr] 5s²',desc:'فلز يحترق بلون أحمر فاتح.',uses:'الألعاب النارية الحمراء، شاشات CRT (قديماً)، نظائر للسرطان.',state:'solid',dens:2.64,mp:777,bp:1377,eneg:0.95,ar2:219,ie:549.5},
{z:39,s:'Y',ar:'إتريوم',en:'Yttrium',m:88.906,c:'transition',g:3,p:5,b:'d',e:'[Kr] 4d¹ 5s²',desc:'فلز انتقالي فضي.',uses:'شاشات LED حمراء (Y₂O₃:Eu)، ليزر YAG، سبائك فائقة التوصيل.',state:'solid',dens:4.472,mp:1526,bp:3345,eneg:1.22,ar2:212,ie:600.0},
{z:40,s:'Zr',ar:'زركونيوم',en:'Zirconium',m:91.224,c:'transition',g:4,p:5,b:'d',e:'[Kr] 4d² 5s²',desc:'فلز قوي مقاوم للتآكل. لا يمتص النيوترونات.',uses:'بطانات قضبان الوقود النووي، الأطراف الصناعية، المجوهرات (الزركون المكعب).',state:'solid',dens:6.52,mp:1855,bp:4377,eneg:1.33,ar2:206,ie:640.1},
{z:41,s:'Nb',ar:'نيوبيوم',en:'Niobium',m:92.906,c:'transition',g:5,p:5,b:'d',e:'[Kr] 4d⁴ 5s¹',desc:'فلز رمادي. موصل فائق في درجات منخفضة.',uses:'سبائك الفولاذ للجسور والأنابيب، الموصلات الفائقة (أجهزة MRI).',state:'solid',dens:8.57,mp:2477,bp:4744,eneg:1.6,ar2:198,ie:652.1},
{z:42,s:'Mo',ar:'موليبدنوم',en:'Molybdenum',m:95.95,c:'transition',g:6,p:5,b:'d',e:'[Kr] 4d⁵ 5s¹',desc:'فلز بنقطة انصهار عالية جداً.',uses:'سبائك الصلب القوي، المحفزات، زيوت التشحيم، الأسلاك المقاومة للحرارة.',state:'solid',dens:10.28,mp:2623,bp:4639,eneg:2.16,ar2:190,ie:684.3},
{z:43,s:'Tc',ar:'تكنيشيوم',en:'Technetium',m:98,c:'transition',g:7,p:5,b:'d',e:'[Kr] 4d⁵ 5s²',desc:'أول عنصر اصطناعي. مشع.',uses:'التصوير الطبي (Tc-99m)، درع إشعاع، اختبارات التآكل.',state:'solid',dens:11.0,mp:2157,bp:4265,eneg:1.9,ar2:183,ie:702.0},
{z:44,s:'Ru',ar:'روثينيوم',en:'Ruthenium',m:101.07,c:'transition',g:8,p:5,b:'d',e:'[Kr] 4d⁷ 5s¹',desc:'فلز من مجموعة البلاتين. صلب جداً.',uses:'محفزات صناعية، سبائك تقوية البلاتين والبلاديوم، إلكترونيات.',state:'solid',dens:12.45,mp:2334,bp:4150,eneg:2.2,ar2:178,ie:710.2},
{z:45,s:'Rh',ar:'روديوم',en:'Rhodium',m:102.91,c:'transition',g:9,p:5,b:'d',e:'[Kr] 4d⁸ 5s¹',desc:'من أندر وأغلى المعادن. مقاوم للتآكل.',uses:'المحولات الحفازة (السيارات)، طلاء المرايا، سبائك.',state:'solid',dens:12.41,mp:1964,bp:3695,eneg:2.28,ar2:173,ie:719.7},
{z:46,s:'Pd',ar:'بلاديوم',en:'Palladium',m:106.42,c:'transition',g:10,p:5,b:'d',e:'[Kr] 4d¹⁰',desc:'يمتص الهيدروجين. معدن ثمين.',uses:'المحولات الحفازة، إلكترونيات، طب الأسنان، تخزين الهيدروجين.',state:'solid',dens:12.023,mp:1554.9,bp:2963,eneg:2.20,ar2:169,ie:804.4},
{z:47,s:'Ag',ar:'فضة',en:'Silver',m:107.87,c:'transition',g:11,p:5,b:'d',e:'[Kr] 4d¹⁰ 5s¹',desc:'أفضل موصل للكهرباء. مضاد للبكتيريا.',uses:'المجوهرات، العملات، الإلكترونيات، التصوير الفوتوغرافي، الأدوية.',state:'solid',dens:10.49,mp:961.78,bp:2162,eneg:1.93,ar2:165,ie:731.0},
{z:48,s:'Cd',ar:'كادميوم',en:'Cadmium',m:112.41,c:'transition',g:12,p:5,b:'d',e:'[Kr] 4d¹⁰ 5s²',desc:'فلز سام. يماثل الزنك.',uses:'بطاريات NiCd (تناقصاً)، أصباغ صفراء، طلاء مقاوم للتآكل.',state:'solid',dens:8.65,mp:321.07,bp:767,eneg:1.69,ar2:161,ie:867.8},
{z:49,s:'In',ar:'إنديوم',en:'Indium',m:114.82,c:'post',g:13,p:5,b:'p',e:'[Kr] 4d¹⁰ 5s² 5p¹',desc:'فلز ناعم جداً. صرخة عندما ينثني.',uses:'شاشات LCD (ITO)، سبائك، لحام منخفض الانصهار.',state:'solid',dens:7.31,mp:156.60,bp:2072,eneg:1.78,ar2:156,ie:558.3},
{z:50,s:'Sn',ar:'قصدير',en:'Tin',m:118.71,c:'post',g:14,p:5,b:'p',e:'[Kr] 4d¹⁰ 5s² 5p²',desc:'فلز قديم. طلاء علب الصلب.',uses:'علب احفظي الطعام، لحام، برونز (Sn+Cu)، سبائك.',state:'solid',dens:7.265,mp:231.93,bp:2602,eneg:1.96,ar2:145,ie:708.6},
{z:51,s:'Sb',ar:'إثمد',en:'Antimony',m:121.76,c:'metalloid',g:15,p:5,b:'p',e:'[Kr] 4d¹⁰ 5s² 5p³',desc:'شبه فلز. يستخدم في السبائك.',uses:'مثبطات اللهب، سبائك البطاريات والرصاص، الأدوية (القديمة).',state:'solid',dens:6.685,mp:630.63,bp:1587,eneg:2.05,ar2:133,ie:834.0},
{z:52,s:'Te',ar:'تيلوريوم',en:'Tellurium',m:127.60,c:'metalloid',g:16,p:5,b:'p',e:'[Kr] 4d¹⁰ 5s² 5p⁴',desc:'شبه فلز نادر.',uses:'سبائك النحاس والفولاذ، الخلايا الشمسية CdTe، الأقراص الضوئية.',state:'solid',dens:6.232,mp:449.51,bp:988,eneg:2.1,ar2:123,ie:869.3},
{z:53,s:'I',ar:'يود',en:'Iodine',m:126.90,c:'halogen',g:17,p:5,b:'p',e:'[Kr] 4d¹⁰ 5s² 5p⁵',desc:'هالوجين صلب بنفسجي. ضروري للغدة الدرقية.',uses:'مطهر للجروح، صبغات، علاج الغدة الدرقية، التصوير الشعاعي.',state:'solid',dens:4.933,mp:113.7,bp:184.3,eneg:2.66,ar2:115,ie:1008.4},
{z:54,s:'Xe',ar:'زينون',en:'Xenon',m:131.29,c:'noble',g:18,p:5,b:'p',e:'[Kr] 4d¹⁰ 5s² 5p⁶',desc:'غاز نبيل. ينبعث منه ضوء أزرق.',uses:'مصابيح القوس، دفع الأقمار الصناعية، التخدير، كواشف الجسيمات.',state:'gas',dens:0.005887,mp:-111.8,bp:-108.099,eneg:2.6,ar2:108,ie:1170.4},
{z:55,s:'Cs',ar:'سيزيوم',en:'Caesium',m:132.91,c:'alkali',g:1,p:6,b:'s',e:'[Xe] 6s¹',desc:'فلز قلوي ذهبي ناعم جداً. ينصهر قرب درجة حرارة الجسم.',uses:'الساعات الذرية (تعريف الثانية)، خلايا ضوئية، الحفر النفطي.',state:'solid',dens:1.93,mp:28.44,bp:671,eneg:0.79,ar2:298,ie:375.7},
{z:56,s:'Ba',ar:'باريوم',en:'Barium',m:137.33,c:'alkaline',g:2,p:6,b:'s',e:'[Xe] 6s²',desc:'فلز يحترق بلون أخضر.',uses:'الأشعة السينية (BaSO₄)، الألعاب النارية الخضراء، السبائك.',state:'solid',dens:3.51,mp:727,bp:1845,eneg:0.89,ar2:253,ie:502.9},
{z:57,s:'La',ar:'لانثانوم',en:'Lanthanum',m:138.91,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 5d¹ 6s²',desc:'أول اللانثانيدات. فلز فضي طري.',uses:'بطاريات NiMH (الهجينة)، عدسات الكاميرا، محفزات تكرير النفط.',state:'solid',dens:6.162,mp:920,bp:3464,eneg:1.10,ar2:'—',ie:538.1},
{z:58,s:'Ce',ar:'سيريوم',en:'Cerium',m:140.12,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 4f¹ 5d¹ 6s²',desc:'أكثر اللانثانيدات وفرة.',uses:'ولاعات السجائر (سيريك الحديد)، المحفزات، طلاء الزجاج، شاشات الاعرضي.',state:'solid',dens:6.770,mp:799,bp:3443,eneg:1.12,ar2:'—',ie:534.4},
{z:59,s:'Pr',ar:'براسيوديميوم',en:'Praseodymium',m:140.91,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 4f³ 6s²',desc:'فلز لانثانيدي طري.',uses:'سبائك المغناطيسات (مع Nd)، نظارات اللحام، السيراميك الأصفر.',state:'solid',dens:6.77,mp:931,bp:3520,eneg:1.13,ar2:247,ie:527.0},
{z:60,s:'Nd',ar:'نيوديميوم',en:'Neodymium',m:144.24,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 4f⁴ 6s²',desc:'يصنع أقوى المغناطيسات الدائمة.',uses:'مغناطيسات NdFeB (السماعات، المحركات، محركات الهارد ديسك).',state:'solid',dens:7.01,mp:1021,bp:3074,eneg:1.14,ar2:206,ie:533.1},
{z:61,s:'Pm',ar:'بروميثيوم',en:'Promethium',m:145,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 4f⁵ 6s²',desc:'العنصر الوحيد المشع بين اللانثانيدات.',uses:'البطاريات الذرية (الأقمار الصناعية)، شاشات الإضاءة الذاتية.',state:'solid',dens:7.26,mp:1042,bp:3000,eneg:1.13,ar2:205,ie:540.0},
{z:62,s:'Sm',ar:'ساماريوم',en:'Samarium',m:150.36,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 4f⁶ 6s²',desc:'مقاوم للتآكل. يصنع مغناطيسات قوية في درجات حرارة عالية.',uses:'مغناطيسات SmCo (محركات النفاثة)، علاج السرطان.',state:'solid',dens:7.52,mp:1072,bp:1794,eneg:1.17,ar2:238,ie:544.5},
{z:63,s:'Eu',ar:'يوروبيوم',en:'Europium',m:151.96,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 4f⁷ 6s²',desc:'يعطي اللون الأحمر في شاشات CRT.',uses:'مضاد للاختزال (فلورسنت)، علامات اليورو (ضد التزييف)، LEDs.',state:'solid',dens:5.244,mp:822,bp:1529,eneg:1.2,ar2:231,ie:547.1},
{z:64,s:'Gd',ar:'غادولينيوم',en:'Gadolinium',m:157.25,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 4f⁷ 5d¹ 6s²',desc:'مغناطيسي حتى في درجة حرارة الغرفة.',uses:'صبغات MRI (GBCA)، المفاعلات النووية، أقراص البيانات البصرية.',state:'solid',dens:7.90,mp:1313,bp:3273,eneg:1.20,ar2:233,ie:593.4},
{z:65,s:'Tb',ar:'تربيوم',en:'Terbium',m:158.93,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 4f⁹ 6s²',desc:'يعطي اللون الأخضر في شاشات.',uses:'المصابيح الفلورية، السبائك، الخلايا الشمسية، الإلكترونيات.',state:'solid',dens:8.23,mp:1356,bp:3230,eneg:1.2,ar2:225,ie:565.8},
{z:66,s:'Dy',ar:'ديسبروسيوم',en:'Dysprosium',m:162.50,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 4f¹⁰ 6s²',desc:'يحتفظ بالمغناطيسية في درجات الحرارة العالية.',uses:'سبائك المغناطيسات (السيارات الكهربائية، التوربينات الريحية).',state:'solid',dens:8.540,mp:1412,bp:2567,eneg:1.22,ar2:228,ie:573.0},
{z:67,s:'Ho',ar:'هولميوم',en:'Holmium',m:164.93,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 4f¹¹ 6s²',desc:'أعلى لحظة مغناطيسية بين العناصر.',uses:'ليزر Ho:YAG (الطب)، سبائك المغناطيسات، المفاعلات النووية.',state:'solid',dens:8.79,mp:1474,bp:2700,eneg:1.23,ar2:226,ie:581.0},
{z:68,s:'Er',ar:'إربيوم',en:'Erbium',m:167.26,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 4f¹² 6s²',desc:'يعزز الألياف البصرية.',uses:'مضخمات الألياف البصرية (EDFA)، ليزر طبي، زجاج ملون وردي.',state:'solid',dens:9.066,mp:1529,bp:2868,eneg:1.24,ar2:226,ie:589.3},
{z:69,s:'Tm',ar:'ثوليوم',en:'Thulium',m:168.93,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 4f¹³ 6s²',desc:'أندر اللانثانيدات المستقرة.',uses:'الأشعة السينية المحمولة، الليزر الطبي، المصابيح الموفرة.',state:'solid',dens:9.32,mp:1545,bp:1950,eneg:1.25,ar2:222,ie:596.7},
{z:70,s:'Yb',ar:'إتيربيوم',en:'Ytterbium',m:173.05,c:'lanthanide',g:3,p:6,b:'f',e:'[Xe] 4f¹⁴ 6s²',desc:'الساعات الذرية الأكثر دقة.',uses:'الساعات الذرية البصرية، ألياف ليزر، علاج السرطان.',state:'solid',dens:6.90,mp:824,bp:1196,eneg:1.1,ar2:222,ie:603.4},
{z:71,s:'Lu',ar:'لوتيشيوم',en:'Lutetium',m:174.97,c:'lanthanide',g:3,p:6,b:'d',e:'[Xe] 4f¹⁴ 5d¹ 6s²',desc:'أندر وأغلى اللانثانيدات.',uses:'PET scanners (Lu-177)، محفزات تكسير النفط، شاشات LED.',state:'solid',dens:9.841,mp:1663,bp:3402,eneg:1.27,ar2:217,ie:523.5},
{z:72,s:'Hf',ar:'هافنيوم',en:'Hafnium',m:178.49,c:'transition',g:4,p:6,b:'d',e:'[Xe] 4f¹⁴ 5d² 6s²',desc:'يمتص النيوترونات بقوة.',uses:'قضبان التحكم في المفاعلات النووية، ترانزستورات، شرائح الكمبيوتر.',state:'solid',dens:13.31,mp:2233,bp:4603,eneg:1.3,ar2:208,ie:658.5},
{z:73,s:'Ta',ar:'تانتالوم',en:'Tantalum',m:180.95,c:'transition',g:5,p:6,b:'d',e:'[Xe] 4f¹⁴ 5d³ 6s²',desc:'نقطة انصهار عالية جداً. مقاوم للتآكل.',uses:'مكثفات الهواتف الذكية وأجهزة الكمبيوتر، الأطراف الصناعية، السبائك.',state:'solid',dens:16.69,mp:3017,bp:5458,eneg:1.5,ar2:200,ie:761.0},
{z:74,s:'W',ar:'تنغستن',en:'Tungsten',m:183.84,c:'transition',g:6,p:6,b:'d',e:'[Xe] 4f¹⁴ 5d⁴ 6s²',desc:'أعلى نقطة انصهار بين الفلزات (3422°C).',uses:'خيوط المصابيح المتوهجة، أقطاب اللحام، الرؤوس الحربية الخارقة، سبائك الصلب.',state:'solid',dens:19.25,mp:3422,bp:5555,eneg:2.36,ar2:193,ie:770.0},
{z:75,s:'Re',ar:'رينيوم',en:'Rhenium',m:186.21,c:'transition',g:7,p:6,b:'d',e:'[Xe] 4f¹⁴ 5d⁵ 6s²',desc:'نقطة انصهار ثالث أعلى.',uses:'شفرات التوربينات النفاثة، محركات الصواريخ، محفزات البترول، مسبارات الحرارة.',state:'solid',dens:21.02,mp:3186,bp:5596,eneg:1.9,ar2:188,ie:760.0},
{z:76,s:'Os',ar:'أوزميوم',en:'Osmium',m:190.23,c:'transition',g:8,p:6,b:'d',e:'[Xe] 4f¹⁴ 5d⁶ 6s²',desc:'أثقل العناصر (أعلى كثافة).',uses:'رؤوس أقلام الحبر الفاخرة، المفاصل الكهربائية، محفزات.',state:'solid',dens:22.59,mp:3033,bp:5012,eneg:2.2,ar2:185,ie:840.0},
{z:77,s:'Ir',ar:'إريديوم',en:'Iridium',m:192.22,c:'transition',g:9,p:6,b:'d',e:'[Xe] 4f¹⁴ 5d⁷ 6s²',desc:'أكثر العناصر مقاومة للتآكل.',uses:'شمعات الإشعال، السبائك فائقة القوة، قضبان CANDU، الأطراف الصناعية.',state:'solid',dens:22.56,mp:2446,bp:4428,eneg:2.20,ar2:180,ie:880.0},
{z:78,s:'Pt',ar:'بلاتين',en:'Platinum',m:195.08,c:'transition',g:10,p:6,b:'d',e:'[Xe] 4f¹⁴ 5d⁹ 6s¹',desc:'معدن ثمين. محفز مهم.',uses:'المحولات الحفازة (السيارات)، المجوهرات، الأطراف الصناعية، الأقطاب الكهربائية.',state:'solid',dens:21.45,mp:1768.3,bp:3825,eneg:2.28,ar2:177,ie:870.0},
{z:79,s:'Au',ar:'ذهب',en:'Gold',m:196.97,c:'transition',g:11,p:6,b:'d',e:'[Xe] 4f¹⁴ 5d¹⁰ 6s¹',desc:'معدن ثمين لا يصدأ. ممتازة للتوصيل.',uses:'المجوهرات، الإلكترونيات، طب الأسنان، احتياطيات النقد، علاج التهاب المفاصل.',state:'solid',dens:19.30,mp:1064.18,bp:2856,eneg:2.54,ar2:174,ie:890.1},
{z:80,s:'Hg',ar:'زئبق',en:'Mercury',m:200.59,c:'transition',g:12,p:6,b:'d',e:'[Xe] 4f¹⁴ 5d¹⁰ 6s²',desc:'الفلز السائل الوحيد في درجة حرارة الغرفة. سام.',uses:'الثرمومترات (القديمة)، البطاريات، أضواء الفلورسنت، المفاتيح الكهربائية.',state:'liquid',dens:13.534,mp:-38.83,bp:356.73,eneg:2.00,ar2:171,ie:1007.1},
{z:81,s:'Tl',ar:'ثاليوم',en:'Thallium',m:204.38,c:'post',g:13,p:6,b:'p',e:'[Xe] 4f¹⁴ 5d¹⁰ 6s² 6p¹',desc:'فلز سام جداً. عديم الطعم والرائحة.',uses:'كاشف في الطب الشرعي، المبيدات (محظور)، الزجاج، الإلكترونيات بالأشعة تحت الحمراء.',state:'solid',dens:11.85,mp:304,bp:1473,eneg:1.62,ar2:156,ie:589.4},
{z:82,s:'Pb',ar:'رصاص',en:'Lead',m:207.2,c:'post',g:14,p:6,b:'p',e:'[Xe] 4f¹⁴ 5d¹⁰ 6s² 6p²',desc:'فلز ثقيل سام. كثيف وقابل للطرق.',uses:'بطاريات الرصاص الحمضية، درع الأشعة السينية، الذخيرة، الأنابيب (القديمة).',state:'solid',dens:11.34,mp:327.46,bp:1749,eneg:1.87,ar2:154,ie:715.6},
{z:83,s:'Bi',ar:'بزموت',en:'Bismuth',m:208.98,c:'post',g:15,p:6,b:'p',e:'[Xe] 4f¹⁴ 5d¹⁰ 6s² 6p³',desc:'بلورات قزحية جميلة. بديل للرصاص.',uses:'الأدوية (Pepto-Bismol)، السبائك منخفضة الانصهار، مستحضرات التجميل.',state:'solid',dens:9.78,mp:271.3,bp:1564,eneg:2.02,ar2:143,ie:703.0},
{z:84,s:'Po',ar:'بولونيوم',en:'Polonium',m:209,c:'post',g:16,p:6,b:'p',e:'[Xe] 4f¹⁴ 5d¹⁰ 6s² 6p⁴',desc:'مشع جداً. اكتشفته ماري كوري.',uses:'مضاد للكهرباء الساكنة، مصادر النيوترونات، علاج الأورام (تاريخي).',state:'solid',dens:9.196,mp:254,bp:962,eneg:2.0,ar2:135,ie:812.1},
{z:85,s:'At',ar:'أستاتين',en:'Astatine',m:210,c:'halogen',g:17,p:6,b:'p',e:'[Xe] 4f¹⁴ 5d¹⁰ 6s² 6p⁵',desc:'أندر العناصر الطبيعية. مشع جداً.',uses:'علاج بعض السرطانات (At-211 - تجريبي)، الأبحاث النووية.',state:'solid',dens:7,mp:302,bp:337,eneg:2.2,ar2:127,ie:899.0},
{z:86,s:'Rn',ar:'رادون',en:'Radon',m:222,c:'noble',g:18,p:6,b:'p',e:'[Xe] 4f¹⁴ 5d¹⁰ 6s² 6p⁶',desc:'غاز مشع ناتج عن تحلل اليورانيوم. سبب رئيس لسرطان الرئة.',uses:'علاج السرطان (تاريخي)، كشف التسرب الجيولوجي، التنبؤ بالزلازل.',state:'gas',dens:0.00973,mp:-71.15,bp:-61.7,eneg:2.2,ar2:120,ie:1037.0},
{z:87,s:'Fr',ar:'فرانسيوم',en:'Francium',m:223,c:'alkali',g:1,p:7,b:'s',e:'[Rn] 7s¹',desc:'أندر العناصر الطبيعية. مشع جداً. لا يُرى في الطبيعة.',uses:'الأبحاث العلمية فقط، تصوير الهياكل الذرية.',state:'solid',dens:1.87,mp:27,bp:677,eneg:0.7,ar2:'—',ie:380.0},
{z:88,s:'Ra',ar:'راديوم',en:'Radium',m:226,c:'alkaline',g:2,p:7,b:'s',e:'[Rn] 7s²',desc:'فلز مشع يتوهج في الظلام. اكتشفته ماري كوري.',uses:'ساعات مضيئة (قديمة - محظور)، علاج السرطان (تاريخي).',state:'solid',dens:5.5,mp:700,bp:1737,eneg:0.9,ar2:'—',ie:509.3},
{z:89,s:'Ac',ar:'أكتينيوم',en:'Actinium',m:227,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 6d¹ 7s²',desc:'أول الأكتينيدات. مشع.',uses:'العلاج الإشعاعي للسرطان (Ac-225 - تجريبي)، مصادر النيوترونات.',state:'solid',dens:10.07,mp:1050,bp:3198,eneg:1.1,ar2:'—',ie:499.0},
{z:90,s:'Th',ar:'ثوريوم',en:'Thorium',m:232.04,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 6d² 7s²',desc:'مشع ضعيف. وقود نووي محتمل.',uses:'الوقود النووي (المفاعلات المولدة)، سبيكة Mg، أقطاب اللحام.',state:'solid',dens:11.72,mp:1750,bp:4788,eneg:1.3,ar2:'—',ie:587.0},
{z:91,s:'Pa',ar:'بروتكتينيوم',en:'Protactinium',m:231.04,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 5f² 6d¹ 7s²',desc:'نادر ومشع جداً وسام.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:15.37,mp:1572,bp:4000,eneg:1.5,ar2:'—',ie:568.0},
{z:92,s:'U',ar:'يورانيوم',en:'Uranium',m:238.03,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 5f³ 6d¹ 7s²',desc:'الوقود النووي الرئيسي. مشع.',uses:'وقود المفاعلات النووية، الرؤوس الحربية النووية، الذخيرة الخارقة، الأبحاث.',state:'solid',dens:19.1,mp:1132,bp:4131,eneg:1.38,ar2:'—',ie:597.6},
{z:93,s:'Np',ar:'نبتونيوم',en:'Neptunium',m:237,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 5f⁴ 6d¹ 7s²',desc:'أول العناصر الاصطناعية بعد اليورانيوم.',uses:'كواشف النيوترونات، الأبحاث النووية.',state:'solid',dens:20.45,mp:644,bp:3902,eneg:1.36,ar2:'—',ie:604.5},
{z:94,s:'Pu',ar:'بلوتونيوم',en:'Plutonium',m:244,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 5f⁶ 7s²',desc:'مشع. يُستخدم في الأسلحة النووية والمفاعلات.',uses:'الأسلحة النووية، وقود المفاعلات، بطاريات الفضاء (RTGs)، الأقمار الصناعية.',state:'solid',dens:19.85,mp:640,bp:3228,eneg:1.28,ar2:'—',ie:584.7},
{z:95,s:'Am',ar:'أمريكيوم',en:'Americium',m:243,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 5f⁷ 7s²',desc:'مشع. يُستخدم في كاشفات الدخان.',uses:'كاشفات الدخان (Am-241)، مصادر النيوترونات، الأبحاث.',state:'solid',dens:13.67,mp:1176,bp:2011,eneg:1.3,ar2:'—',ie:578.0},
{z:96,s:'Cm',ar:'كوريوم',en:'Curium',m:247,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 5f⁷ 6d¹ 7s²',desc:'ساطع من تلقاء نفسه. سُمّي تكريماً لكوري.',uses:'مولدات الحرارة الكهربية النظائرية (RTGs)، الأبحاث الفضائية، مصادر ألفا.',state:'solid',dens:13.51,mp:1345,bp:3110,eneg:1.3,ar2:'—',ie:581.0},
{z:97,s:'Bk',ar:'بركليوم',en:'Berkelium',m:247,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 5f⁹ 7s²',desc:'مشع. سُمّي نسبة لجامعة بيركلي.',uses:'الأبحاث النووية، اكتشاف العناصر الأثقل.',state:'solid',dens:14.78,mp:986,bp:2627,eneg:1.3,ar2:'—',ie:601.0},
{z:98,s:'Cf',ar:'كاليفورنيوم',en:'Californium',m:251,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 5f¹⁰ 7s²',desc:'مشع قوي. ينتج نيوترونات بكثرة.',uses:'كاشفات المعادن، علاج السرطان، بدء مفاعلات نووية، الأبحاث.',state:'solid',dens:15.1,mp:900,bp:1472,eneg:1.3,ar2:'—',ie:608.0},
{z:99,s:'Es',ar:'آينشتاينيوم',en:'Einsteinium',m:252,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 5f¹¹ 7s²',desc:'اكتُشف في بقايا أول اختبار نووي. سُمّي تكريماً لأينشتاين.',uses:'الأبحاث العلمية فقط، تصنيع العناصر الأثقل.',state:'solid',dens:8.84,mp:860,bp:996,eneg:1.3,ar2:'—',ie:619.0},
{z:100,s:'Fm',ar:'فيرميوم',en:'Fermium',m:257,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 5f¹² 7s²',desc:'آخر العنصر الذي يُنتج بكميات مرئية.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:'—',mp:1527,bp:'—',eneg:1.3,ar2:'—',ie:627.0},
{z:101,s:'Md',ar:'مندليفيوم',en:'Mendelevium',m:258,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 5f¹³ 7s²',desc:'سُمّي تكريماً لمندليف، مصمم الجدول الدوري.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:'—',mp:827,bp:'—',eneg:1.3,ar2:'—',ie:635.0},
{z:102,s:'No',ar:'نوبليوم',en:'Nobelium',m:259,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 5f¹⁴ 7s²',desc:'سُمّي تكريماً لآلفرد نوبل.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:'—',mp:827,bp:'—',eneg:1.3,ar2:'—',ie:642.0},
{z:103,s:'Lr',ar:'لورنسيوم',en:'Lawrencium',m:266,c:'actinide',g:3,p:7,b:'f',e:'[Rn] 5f¹⁴ 7s² 7p¹',desc:'سُمّي تكريماً لفيرنر هايزنبيرغ/إرنست لورنس.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:'—',mp:1627,bp:'—',eneg:1.3,ar2:'—',ie:470.0},
{z:104,s:'Rf',ar:'رذرفورديوم',en:'Rutherfordium',m:267,c:'transition',g:4,p:7,b:'d',e:'[Rn] 5f¹⁴ 6d² 7s²',desc:'أول العناصر فوق اليورانية الانتقالية.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:23.2,mp:2100,bp:5500,eneg:'—',ar2:'—',ie:580.0},
{z:105,s:'Db',ar:'دوبنيوم',en:'Dubnium',m:268,c:'transition',g:5,p:7,b:'d',e:'[Rn] 5f¹⁴ 6d³ 7s²',desc:'سُمّي تكريماً لمدينة دوبنا الروسية.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:29.3,mp:'—',bp:'—',eneg:'—',ar2:'—',ie:665.0},
{z:106,s:'Sg',ar:'سيبورجيوم',en:'Seaborgium',m:269,c:'transition',g:6,p:7,b:'d',e:'[Rn] 5f¹⁴ 6d⁴ 7s²',desc:'سُمّي تكريماً لغلين سيبورغ.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:35.0,mp:'—',bp:'—',eneg:'—',ar2:'—',ie:757.0},
{z:107,s:'Bh',ar:'بوريوم',en:'Bohrium',m:270,c:'transition',g:7,p:7,b:'d',e:'[Rn] 5f¹⁴ 6d⁵ 7s²',desc:'سُمّي تكريماً لنييلز بور.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:37.1,mp:'—',bp:'—',eneg:'—',ar2:'—',ie:740.0},
{z:108,s:'Hs',ar:'هاسيوم',en:'Hassium',m:269,c:'transition',g:8,p:7,b:'d',e:'[Rn] 5f¹⁴ 6d⁶ 7s²',desc:'سُمّي تكريماً لولاية هيسن الألمانية.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:40.7,mp:'—',bp:'—',eneg:'—',ar2:'—',ie:730.0},
{z:109,s:'Mt',ar:'مايتنريوم',en:'Meitnerium',m:278,c:'unknown',g:9,p:7,b:'d',e:'[Rn] 5f¹⁴ 6d⁷ 7s²',desc:'سُمّي تكريماً لليز مايتنر.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:37.4,mp:'—',bp:'—',eneg:'—',ar2:'—',ie:800.0},
{z:110,s:'Ds',ar:'دارمشتاتيوم',en:'Darmstadtium',m:281,c:'unknown',g:10,p:7,b:'d',e:'[Rn] 5f¹⁴ 6d⁸ 7s²',desc:'سُمّي نسبة لمدينة دارمشتات.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:34.8,mp:'—',bp:'—',eneg:'—',ar2:'—',ie:960.0},
{z:111,s:'Rg',ar:'روينتجينيوم',en:'Roentgenium',m:282,c:'unknown',g:11,p:7,b:'d',e:'[Rn] 5f¹⁴ 6d⁹ 7s²',desc:'سُمّي تكريماً للأشعة السينية (رونتجن).',uses:'الأبحاث العلمية فقط.',state:'solid',dens:28.7,mp:'—',bp:'—',eneg:'—',ar2:'—',ie:1020.0},
{z:112,s:'Cn',ar:'كوبرنيسيوم',en:'Copernicium',m:285,c:'transition',g:12,p:7,b:'d',e:'[Rn] 5f¹⁴ 6d¹⁰ 7s²',desc:'سُمّي تكريماً لكوبرنيكوس. يتوقع أن يكون سائلاً.',uses:'الأبحاث العلمية فقط.',state:'liquid',dens:23.7,mp:'—',bp:67,eneg:'—',ar2:'—',ie:1155.0},
{z:113,s:'Nh',ar:'نيهونيوم',en:'Nihonium',m:286,c:'unknown',g:13,p:7,b:'p',e:'[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p¹',desc:'أول عنصر اكتشف في شرق آسيا (في اليابان).',uses:'الأبحاث العلمية فقط.',state:'solid',dens:16,mp:430,bp:1100,eneg:'—',ar2:'—',ie:704.0},
{z:114,s:'Fl',ar:'فليروفيوم',en:'Flerovium',m:289,c:'unknown',g:14,p:7,b:'p',e:'[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p²',desc:'سُمّي تكريماً لمختبر فليروف.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:14,mp:67,bp:147,eneg:'—',ar2:'—',ie:832.0},
{z:115,s:'Mc',ar:'موسكوفيوم',en:'Moscovium',m:290,c:'unknown',g:15,p:7,b:'p',e:'[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p³',desc:'سُمّي تكريماً لمنطقة موسكو.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:13.5,mp:400,bp:1100,eneg:'—',ar2:'—',ie:538.0},
{z:116,s:'Lv',ar:'ليفرموريوم',en:'Livermorium',m:293,c:'unknown',g:16,p:7,b:'p',e:'[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p⁴',desc:'سُمّي تكريماً لمختبر ليفرمور.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:12.9,mp:364,bp:762,eneg:'—',ar2:'—',ie:723.0},
{z:117,s:'Ts',ar:'تينيسين',en:'Tennessine',m:294,c:'unknown',g:17,p:7,b:'p',e:'[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p⁵',desc:'سُمّي تكريماً لولاية تينيسي.',uses:'الأبحاث العلمية فقط.',state:'solid',dens:7.17,mp:350,bp:883,eneg:'—',ar2:'—',ie:736.0},
{z:118,s:'Og',ar:'أوغانيسون',en:'Oganesson',m:294,c:'unknown',g:18,p:7,b:'p',e:'[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p⁶',desc:'أثقل عنصر مكتشف. سُمّي تكريماً للعالم أوغانيسيان.',uses:'الأبحاث العلمية فقط.',state:'gas',dens:5.0,mp:'—',bp:350,eneg:'—',ar2:'—',ie:839.4}
];

const PT_CAT = {
  alkali:    {ar:'فلزات قلوية',     color:'#ff5252', cls:'pt-cat-alkali'},
  alkaline:  {ar:'فلزات قلوية ترابية', color:'#ff9800', cls:'pt-cat-alkaline'},
  transition:{ar:'فلزات انتقالية',   color:'#fdd835', cls:'pt-cat-transition'},
  post:      {ar:'فلزات بعد انتقالية', color:'#42a5f5', cls:'pt-cat-post'},
  metalloid: {ar:'أشباه فلزات',      color:'#66bb6a', cls:'pt-cat-metalloid'},
  nonmetal:  {ar:'لا فلزات',         color:'#9ccc65', cls:'pt-cat-nonmetal'},
  halogen:   {ar:'هالوجينات',        color:'#ffc107', cls:'pt-cat-halogen'},
  noble:     {ar:'غازات نبيلة',      color:'#ab47bc', cls:'pt-cat-noble'},
  lanthanide:{ar:'لانثانيدات',       color:'#ec407a', cls:'pt-cat-lanthanide'},
  actinide:  {ar:'أكتينيدات',        color:'#ff7043', cls:'pt-cat-actinide'},
  unknown:   {ar:'خصائص غير معروفة', color:'#90a4ae', cls:'pt-cat-unknown'}
};

let ptZoomLevel = 100; // %
let ptLoupeEnabled = true;
let ptActiveCategory = null;
let ptSelectedEl = null;
let ptSearchTerm = '';

function ptCellSize(){ return Math.round(64 * (ptZoomLevel/100)); }

function openPeriodicTable(){
  openModal('modalPeriodic');
  ptRenderLegend();
  ptRenderGrid();
  // wire search + loupe events
  const wrap = document.getElementById('ptWrap');
  if(wrap && !wrap.dataset.louped){
    wrap.addEventListener('mousemove', ptLoupeMove);
    wrap.addEventListener('mouseleave', ptHideLoupe);
    wrap.dataset.louped = '1';
  }
  // Auto-select first element to show in detail
  setTimeout(()=>{ if(!ptSelectedEl) ptSelect(ELEMENTS[0].z); }, 60);
}

function ptRenderLegend(){
  const leg = document.getElementById('ptLegend');
  let html = '<span style="font-size:.7rem;font-weight:800;color:#64748b;margin-left:6px"><i class="fas fa-palette"></i> المجموعات:</span>';
  Object.keys(PT_CAT).forEach(k=>{
    const c = PT_CAT[k];
    html += `<span class="pt-legend-item ${ptActiveCategory===k?'':'muted'}" data-cat="${k}" onclick="ptFilterCategory('${k}')" style="background:${c.color}22;border-color:${c.color}66">
      <span class="pt-legend-swatch" style="background:${c.color}"></span>${c.ar}
    </span>`;
  });
  html += `<button class="pt-legend-item" onclick="ptFilterCategory(null)" style="background:#f1f5f9;color:#475569"><i class="fas fa-times-circle"></i> اعرضي الكل</button>`;
  leg.innerHTML = html;
}

function ptFilterCategory(cat){
  ptActiveCategory = (ptActiveCategory===cat) ? null : cat;
  ptRenderLegend();
  ptRenderGrid();
  // re-apply search filter
  if(ptSearchTerm) ptFilterSearch(ptSearchTerm);
}

function ptFilterSearch(q){
  ptSearchTerm = (q||'').trim().toLowerCase();
  const wrap = document.getElementById('ptSearchWrap');
  if(wrap) wrap.classList.toggle('has-val', !!ptSearchTerm);
  ptRenderGrid();
  // jump to first match
  if(ptSearchTerm){
    const hit = ELEMENTS.find(x =>
      x.s.toLowerCase()===ptSearchTerm ||
      x.ar.includes(ptSearchTerm) ||
      x.en.toLowerCase().includes(ptSearchTerm) ||
      String(x.z)===ptSearchTerm
    );
    if(hit){
      ptSelect(hit.z);
      const el = document.querySelector(`.pt-cell[data-z="${hit.z}"]`);
      if(el) el.scrollIntoView({behavior:'smooth',block:'center',inline:'center'});
    }
  }
}

function ptRenderGrid(){
  const host = document.getElementById('periodicTable');
  if(!host) return;
  const cell = ptCellSize();
  // Group label row
  const groups = ['','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18'];
  let html = `<div class="pt-grid" style="--cell:${cell}px;grid-template-columns:repeat(18,${cell}px);grid-auto-rows:${cell}px">`;
  for(let p=1;p<=7;p++){
    // group numbers row only once at top
    if(p===1){
      for(let g=1;g<=18;g++){ html += `<div class="pt-label">${g}</div>`; }
    } else {
      for(let g=1;g<=18;g++){ html += `<div class="pt-label"></div>`; }
    }
    // Row p: place elements by group, leave lanthanide/actinide placeholders at group 3
    for(let g=1;g<=18;g++){
      let el = ELEMENTS.find(x=>x.p===p && x.g===g && x.c!=='lanthanide' && x.c!=='actinide');
      if(el){
        const cat = PT_CAT[el.c];
        const dim = (ptActiveCategory && ptActiveCategory!==el.c) ? 'dim' : '';
        const searchHidden = ptSearchTerm && !(
          el.s.toLowerCase().includes(ptSearchTerm) ||
          el.ar.includes(ptSearchTerm) ||
          el.en.toLowerCase().includes(ptSearchTerm) ||
          String(el.z)===ptSearchTerm
        ) ? 'dim' : '';
        const active = (ptSelectedEl && ptSelectedEl.z===el.z) ? 'active' : '';
        html += `<div class="pt-cell ${cat.cls} ${dim} ${searchHidden} ${active}" data-z="${el.z}" style="--cell:${cell}px"
          onclick="ptSelect(${el.z})" draggable="true" ondragstart="ptDragStart(event,${el.z})"
          onmouseenter="ptShowLoupe(${el.z},event)">
          <div class="pt-num">${el.z}</div>
          <div class="pt-sym">${el.s}</div>
          <div class="pt-name">${el.ar}</div>
          <div class="pt-mass">${el.m}</div>
        </div>`;
      } else if(p===6 && g===3){
        // La placeholder in main table
        const cat = PT_CAT.lanthanide;
        html += `<div class="pt-cell ${cat.cls}" style="--cell:${cell}px;cursor:default;opacity:.85"
          onclick="ptSelect(57)">
          <div class="pt-num">57-71</div>
          <div class="pt-sym">La</div>
          <div class="pt-name">لانثانيدات</div>
        </div>`;
      } else if(p===7 && g===3){
        const cat = PT_CAT.actinide;
        html += `<div class="pt-cell ${cat.cls}" style="--cell:${cell}px;cursor:default;opacity:.85"
          onclick="ptSelect(89)">
          <div class="pt-num">89-103</div>
          <div class="pt-sym">Ac</div>
          <div class="pt-name">أكتينيدات</div>
        </div>`;
      } else {
        html += `<div class="pt-label"></div>`;
      }
    }
  }
  html += `</div>`;
  // Lanthanide row (period 8)
  html += `<div class="pt-grid lanth-row" style="--cell:${cell}px;grid-template-columns:repeat(18,${cell}px);grid-auto-rows:${cell}px;margin-top:10px">`;
  for(let g=1;g<=18;g++){
    if(g<=2 || g===3){ html += `<div class="pt-label"></div>`; continue; }
    // 57..71
    const z = 55 + g - 2; // g=4->57, g=5->58 ... g=18->71
    const el = ELEMENTS.find(x=>x.z===z);
    if(el){
      const cat = PT_CAT[el.c];
      const dim = (ptActiveCategory && ptActiveCategory!==el.c) ? 'dim' : '';
      const searchHidden = ptSearchTerm && !(
        el.s.toLowerCase().includes(ptSearchTerm) ||
        el.ar.includes(ptSearchTerm) ||
        el.en.toLowerCase().includes(ptSearchTerm) ||
        String(el.z)===ptSearchTerm
      ) ? 'dim' : '';
      const active = (ptSelectedEl && ptSelectedEl.z===el.z) ? 'active' : '';
      html += `<div class="pt-cell ${cat.cls} ${dim} ${searchHidden} ${active}" data-z="${el.z}" style="--cell:${cell}px"
        onclick="ptSelect(${el.z})" draggable="true" ondragstart="ptDragStart(event,${el.z})"
        onmouseenter="ptShowLoupe(${el.z},event)">
        <div class="pt-num">${el.z}</div>
        <div class="pt-sym">${el.s}</div>
        <div class="pt-name">${el.ar}</div>
        <div class="pt-mass">${el.m}</div>
      </div>`;
    } else { html += `<div class="pt-label"></div>`; }
  }
  html += `</div>`;
  // Actinide row (period 9)
  html += `<div class="pt-grid lanth-row" style="--cell:${cell}px;grid-template-columns:repeat(18,${cell}px);grid-auto-rows:${cell}px">`;
  for(let g=1;g<=18;g++){
    if(g<=2 || g===3){ html += `<div class="pt-label"></div>`; continue; }
    const z = 87 + g - 2; // g=4->89, ... g=18->103
    const el = ELEMENTS.find(x=>x.z===z);
    if(el){
      const cat = PT_CAT[el.c];
      const dim = (ptActiveCategory && ptActiveCategory!==el.c) ? 'dim' : '';
      const searchHidden = ptSearchTerm && !(
        el.s.toLowerCase().includes(ptSearchTerm) ||
        el.ar.includes(ptSearchTerm) ||
        el.en.toLowerCase().includes(ptSearchTerm) ||
        String(el.z)===ptSearchTerm
      ) ? 'dim' : '';
      const active = (ptSelectedEl && ptSelectedEl.z===el.z) ? 'active' : '';
      html += `<div class="pt-cell ${cat.cls} ${dim} ${searchHidden} ${active}" data-z="${el.z}" style="--cell:${cell}px"
        onclick="ptSelect(${el.z})" draggable="true" ondragstart="ptDragStart(event,${el.z})"
        onmouseenter="ptShowLoupe(${el.z},event)">
        <div class="pt-num">${el.z}</div>
        <div class="pt-sym">${el.s}</div>
        <div class="pt-name">${el.ar}</div>
        <div class="pt-mass">${el.m}</div>
      </div>`;
    } else { html += `<div class="pt-label"></div>`; }
  }
  html += `</div>`;
  host.innerHTML = html;
}

function ptSelect(z){
  const el = ELEMENTS.find(x=>x.z===z);
  if(!el) return;
  ptSelectedEl = el;
  // Re-render to show active state
  const cells = document.querySelectorAll('.pt-cell');
  cells.forEach(c => c.classList.toggle('active', parseInt(c.dataset.z)===z));
  ptRenderDetail(el);
}

function ptRenderDetail(el){
  const detail = document.getElementById('ptDetail');
  detail.style.display = 'grid';
  const cat = PT_CAT[el.c];
  // top card
  document.getElementById('ptDetailCard').style.setProperty('--accent-color', cat.color);
  const sym = document.getElementById('ptDetailSym');
  sym.textContent = el.s;
  sym.style.background = `linear-gradient(135deg, ${cat.color}, ${cat.color}cc)`;
  sym.style.boxShadow = `0 6px 16px ${cat.color}66`;
  document.getElementById('ptDetailName').textContent = el.ar;
  document.getElementById('ptDetailCat').textContent = cat.ar;
  document.getElementById('ptDetailEn').textContent = el.en + ' • ' + (el.state==='gas'?'غاز':el.state==='liquid'?'سائل':'صلب') + ' • بلوك ' + el.b;
  document.getElementById('ptDetailPG').innerHTML = `<span>المجموعة: ${el.g}</span><span>الدورة: ${el.p}</span><span>الكتلة: ${el.m}</span>`;
  document.getElementById('ptConfig').textContent = el.e;
  document.getElementById('ptDesc').textContent = el.desc;
  // grid
  const grid = document.getElementById('ptDetailGrid');
  grid.innerHTML = `
    <div class="pt-detail-row"><span class="lbl">العدد الذري (Z)</span><span class="val">${el.z}</span></div>
    <div class="pt-detail-row"><span class="lbl">الكتلة الذرية</span><span class="val">${el.m}</span></div>
    <div class="pt-detail-row"><span class="lbl">الرمز</span><span class="val">${el.s}</span></div>
    <div class="pt-detail-row"><span class="lbl">المجموعة</span><span class="val">${el.g}</span></div>
    <div class="pt-detail-row"><span class="lbl">الدورة</span><span class="val">${el.p}</span></div>
    <div class="pt-detail-row"><span class="lbl">البلوك</span><span class="val">${el.b}</span></div>
  `;
  // physical
  const phys = document.getElementById('ptPhysProps');
  phys.innerHTML = `
    <div class="pt-detail-row"><span class="lbl">الحالة عند 20°C</span><span class="val">${el.state==='gas'?'غاز 💨':el.state==='liquid'?'سائل 💧':'صلب 🧊'}</span></div>
    <div class="pt-detail-row"><span class="lbl">الكثافة</span><span class="val">${el.dens==='—'?'غير معروفة':el.dens + ' g/cm³'}</span></div>
    <div class="pt-detail-row"><span class="lbl">نقطة الانصهار</span><span class="val">${el.mp==='—'?'غير معروفة':el.mp+' °C'}</span></div>
    <div class="pt-detail-row"><span class="lbl">نقطة الغليان</span><span class="val">${el.bp==='—'?'غير معروفة':el.bp+' °C'}</span></div>
  `;
  // atomic
  const at = document.getElementById('ptAtomProps');
  at.innerHTML = `
    <div class="pt-detail-row"><span class="lbl">الكهرسلبية</span><span class="val">${el.eneg}</span></div>
    <div class="pt-detail-row"><span class="lbl">نصف القطر الذري</span><span class="val">${el.ar2==='—'?'غير معروف':el.ar2+' pm'}</span></div>
    <div class="pt-detail-row"><span class="lbl">طاقة التأين الأولى</span><span class="val">${el.ie==='—'?'غير معروفة':el.ie+' kJ/mol'}</span></div>
    <div class="pt-detail-row"><span class="lbl">التوزيع الإلكتروني</span><span class="val" style="font-family:'Courier New',monospace;font-size:.7rem">${el.e}</span></div>
  `;
  // uses
  document.getElementById('ptUses').textContent = el.uses;
}

function ptZoom(delta){
  ptZoomLevel = Math.max(60, Math.min(180, ptZoomLevel + delta));
  document.getElementById('ptZoomVal').textContent = ptZoomLevel + '%';
  ptRenderGrid();
}
function ptZoomReset(){
  ptZoomLevel = 100;
  document.getElementById('ptZoomVal').textContent = '100%';
  ptRenderGrid();
}
function ptToggleLoupe(){
  ptLoupeEnabled = !ptLoupeEnabled;
  document.getElementById('ptLoupeBtn').classList.toggle('on', ptLoupeEnabled);
  if(!ptLoupeEnabled) ptHideLoupe();
}
function ptToggleFullscreen(){
  const m = document.getElementById('modalPeriodic');
  if(!m) return;
  const fs = m.classList.toggle('pt-fullscreen');
  document.getElementById('ptFullscreenBtn').innerHTML = fs ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
}

function ptShowLoupe(z, ev){
  if(!ptLoupeEnabled) return;
  const el = ELEMENTS.find(x=>x.z===z);
  if(!el) return;
  const loupe = document.getElementById('ptLoupe');
  const inner = document.getElementById('ptLoupeInner');
  const cat = PT_CAT[el.c];
  inner.innerHTML = `
    <div style="position:absolute;inset:0;background:linear-gradient(135deg, ${cat.color}, ${cat.color}cc);display:flex;align-items:center;justify-content:center;flex-direction:column;color:white">
      <div style="position:absolute;top:24px;left:30px;font-size:2.2rem;font-weight:900;opacity:.9">${el.z}</div>
      <div style="font-size:9rem;font-weight:900;line-height:1;text-shadow:0 4px 12px rgba(0,0,0,.3)">${el.s}</div>
      <div style="font-size:2.4rem;font-weight:800;margin-top:6px">${el.ar}</div>
      <div style="position:absolute;bottom:36px;font-size:1.6rem;font-weight:800;opacity:.95">${el.m}</div>
      <div style="position:absolute;bottom:80px;font-size:1.2rem;font-weight:600;opacity:.85">${cat.ar}</div>
    </div>
  `;
  loupe.style.background = `linear-gradient(135deg, ${cat.color}, ${cat.color}cc)`;
  loupe.classList.add('show');
  ptLoupeMove(ev);
}
function ptLoupeMove(ev){
  const loupe = document.getElementById('ptLoupe');
  if(!loupe.classList.contains('show')) return;
  loupe.style.left = ev.clientX + 'px';
  loupe.style.top = ev.clientY + 'px';
}
function ptHideLoupe(){
  document.getElementById('ptLoupe').classList.remove('show');
}

// Drag element to canvas
function ptDragStart(ev, z){
  const el = ELEMENTS.find(x=>x.z===z);
  if(!el) return;
  ev.dataTransfer.setData('text/plain', `element:${el.s}|${el.ar}|${el.z}|${el.m}`);
  ev.dataTransfer.effectAllowed = 'copy';
  // visual
  ev.target.classList.add('dragging');
  setTimeout(()=>ev.target.classList.remove('dragging'), 200);
}

// Backward-compat: old function names referenced elsewhere
function showElement(num){ ptSelect(num); }

/* PT: extra helpers (print / send to canvas) */
function ptPrintTable(){
  const host = document.getElementById('periodicTable');
  if(!host) return;
  const win = window.open('','_blank','width=1400,height=900');
  const styles = `
    <style>
      body{font-family:'Tajawal',Arial,sans-serif;background:#fff;padding:20px;direction:rtl}
      h1{color:#1a5f7a;text-align:center;margin-bottom:6px}
      .pt-grid{display:grid;grid-template-columns:repeat(18,58px);grid-auto-rows:58px;gap:4px;direction:ltr;width:max-content;margin:0 auto}
      .pt-cell{border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2px;color:#fff;font-family:'Tajawal'}
      .pt-cell .pt-num{position:absolute;font-size:.7rem;font-weight:800;opacity:.85;align-self:flex-start;margin:2px 0 0 4px}
      .pt-cell{position:relative}
      .pt-cell .pt-sym{font-size:1.1rem;font-weight:900;line-height:1}
      .pt-cell .pt-name{font-size:.5rem;font-weight:600;margin-top:1px;line-height:1.05}
      .pt-cell .pt-mass{position:absolute;bottom:2px;font-size:.5rem;opacity:.75}
      .pt-cat-alkali{background:#ff5252}.pt-cat-alkaline{background:#ff9800}
      .pt-cat-transition{background:#fdd835;color:#5d4037}.pt-cat-post{background:#42a5f5}
      .pt-cat-metalloid{background:#66bb6a}.pt-cat-nonmetal{background:#9ccc65;color:#1b5e20}
      .pt-cat-halogen{background:#ffc107;color:#5d4037}.pt-cat-noble{background:#ab47bc}
      .pt-cat-lanthanide{background:#ec407a}.pt-cat-actinide{background:#ff7043}
      .pt-cat-unknown{background:#90a4ae}
      .pt-label{display:flex;align-items:center;justify-content:center;font-size:.6rem;color:#94a3b8}
      .pt-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin:14px 0}
      .pt-legend-item{font-size:.7rem;padding:3px 8px;border-radius:5px;font-weight:700}
    </style>`;
  let legend = '<div class="pt-legend">';
  Object.keys(PT_CAT).forEach(k=>{
    legend += `<span class="pt-legend-item" style="background:${PT_CAT[k].color}22;color:${PT_CAT[k].color}">● ${PT_CAT[k].ar}</span>`;
  });
  legend += '</div>';
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><title>الجدول الدوري</title>${styles}</head><body>
    <h1>الجدول الدوري للعناصر</h1>${legend}<div>${host.innerHTML}</div></body></html>`);
  win.document.close();
  setTimeout(()=>{win.print();},400);
}

function ptSendToCanvas(){
  // Render the periodic table grid into the main canvas at high resolution
  if(!ctx) {toast('error','السبورة غير جاهزة');return;}
  const grid = document.getElementById('periodicTable');
  if(!grid) return;
  // Use html2canvas-style fallback: just render a snapshot
  const rect = canvasWrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio||1;
  // Create offscreen canvas at 2x for crisp output
  const off = document.createElement('canvas');
  const scale = 2;
  off.width = 1700*scale;
  off.height = 950*scale;
  const ox = off.getContext('2d');
  ox.fillStyle = '#ffffff';
  ox.fillRect(0,0,off.width,off.height);
  // title
  ox.fillStyle = '#0f3460';
  ox.font = `bold ${32*scale}px Tajawal,sans-serif`;
  ox.textAlign = 'center';
  ox.fillText('الجدول الدوري للعناصر', off.width/2, 40*scale);
  // legend
  const cats = Object.keys(PT_CAT);
  let lx = 30*scale; const ly = 60*scale;
  ox.textAlign = 'right';
  ox.font = `bold ${11*scale}px Tajawal,sans-serif`;
  cats.forEach(k=>{
    const c = PT_CAT[k];
    ox.fillStyle = c.color;
    ox.fillRect(lx, ly, 16*scale, 16*scale);
    ox.fillStyle = '#333';
    ox.fillText(c.ar, lx + 20*scale, ly + 12*scale);
    lx += 130*scale;
    if(lx > off.width - 130*scale){ lx = 30*scale; }
  });
  // cells
  const cells = grid.querySelectorAll('.pt-cell');
  cells.forEach(cell=>{
    const r = cell.getBoundingClientRect();
    const gr = grid.getBoundingClientRect();
    const x = (r.left - gr.left) * scale + 30*scale;
    const y = (r.top - gr.top) * scale + 90*scale;
    const w = (r.width) * scale;
    const h = (r.height) * scale;
    const cat = cell.className.match(/pt-cat-(\w+)/);
    const color = cat ? PT_CAT[cat[1]].color : '#90a4ae';
    ox.fillStyle = color;
    ox.fillRect(x, y, w-2, h-2);
    // num
    const num = cell.dataset.z || '';
    const sym = cell.querySelector('.pt-sym')?.textContent || '';
    const name = cell.querySelector('.pt-name')?.textContent || '';
    const mass = cell.querySelector('.pt-mass')?.textContent || '';
    ox.fillStyle = '#fff';
    if(num){
      ox.textAlign = 'left'; ox.font = `bold ${9*scale}px Tajawal`;
      ox.fillText(num, x + 4*scale, y + 11*scale);
    }
    ox.textAlign = 'center';
    ox.font = `900 ${18*scale}px Tajawal`;
    ox.fillText(sym, x + w/2, y + h/2 - 2*scale);
    ox.font = `600 ${7*scale}px Tajawal`;
    ox.fillText(name, x + w/2, y + h/2 + 11*scale);
    ox.font = `700 ${7*scale}px Tajawal`;
    ox.textAlign = 'right';
    ox.fillText(mass, x + w - 3*scale, y + h - 3*scale);
  });
  // draw onto main canvas
  const maxW = rect.width * 0.92;
  const maxH = rect.height * 0.88;
  const ratio = Math.min(maxW / off.width, maxH / off.height);
  const tw = off.width * ratio;
  const th = off.height * ratio;
  const tx = (rect.width - tw)/2;
  const ty = (rect.height - th)/2;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(tx-10, ty-10, tw+20, th+20);
  ctx.drawImage(off, tx, ty, tw, th);
  if(typeof saveHistory === 'function') saveHistory();
  closeModal('modalPeriodic');
  toast('success','تم إرسال الجدول الدوري إلى السبورة');
}

function ptPrintElement(){
  if(!ptSelectedEl) return;
  const el = ptSelectedEl;
  const cat = PT_CAT[el.c];
  const win = window.open('','_blank','width=600,height=800');
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><title>${el.ar}</title>
    <style>body{font-family:'Tajawal',Arial,sans-serif;padding:24px;background:${cat.color}11}
    h1{color:${cat.color};font-size:2rem;margin-bottom:8px}
    .sym{font-size:5rem;font-weight:900;color:#fff;background:${cat.color};width:120px;height:120px;border-radius:18px;display:flex;align-items:center;justify-content:center;margin:10px auto;box-shadow:0 8px 24px ${cat.color}66}
    table{width:100%;border-collapse:collapse;margin:14px 0}
    td{padding:8px;border-bottom:1px solid #e2e8f0;font-size:.9rem}
    td:first-child{font-weight:700;color:#475569;width:40%}
    td:last-child{font-weight:800;color:#0f3460}
    .config{background:#0f3460;color:#a5d8ff;padding:12px;border-radius:8px;font-family:monospace;text-align:center;font-size:1rem;font-weight:700}
    p{line-height:1.7;color:#334155}</style></head><body>
    <h1>${el.ar} (${el.en})</h1>
    <div class="sym">${el.s}</div>
    <table>
      <tr><td>العدد الذري</td><td>${el.z}</td></tr>
      <tr><td>الكتلة الذرية</td><td>${el.m}</td></tr>
      <tr><td>المجموعة / الدورة</td><td>${el.g} / ${el.p}</td></tr>
      <tr><td>البلوك</td><td>${el.b}</td></tr>
      <tr><td>الفئة</td><td>${cat.ar}</td></tr>
      <tr><td>الحالة عند 20°C</td><td>${el.state==='gas'?'غاز':el.state==='liquid'?'سائل':'صلب'}</td></tr>
      <tr><td>الكثافة</td><td>${el.dens==='—'?'غير معروفة':el.dens+' g/cm³'}</td></tr>
      <tr><td>نقطة الانصهار</td><td>${el.mp==='—'?'غير معروفة':el.mp+' °C'}</td></tr>
      <tr><td>نقطة الغليان</td><td>${el.bp==='—'?'غير معروفة':el.bp+' °C'}</td></tr>
      <tr><td>الكهرسلبية</td><td>${el.eneg}</td></tr>
      <tr><td>طاقة التأين</td><td>${el.ie==='—'?'غير معروفة':el.ie+' kJ/mol'}</td></tr>
    </table>
    <h3>التوزيع الإلكتروني</h3><div class="config">${el.e}</div>
    <h3>نبذة</h3><p>${el.desc}</p>
    <h3>الاستخدامات</h3><p>${el.uses}</p>
    </body></html>`);
  win.document.close();
  setTimeout(()=>{win.print();},400);
}

function ptSendElementToCanvas(){
  if(!ptSelectedEl || !ctx) {toast('error','لا يوجد عنصر محدد');return;}
  const el = ptSelectedEl;
  const cat = PT_CAT[el.c];
  const rect = canvasWrap.getBoundingClientRect();
  const cx = rect.width/2, cy = rect.height/2;
  // Big card 700x420
  const w = 700, h = 420;
  const x = cx - w/2, y = cy - h/2;
  // background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = cat.color;
  ctx.lineWidth = 6;
  ctx.strokeRect(x, y, w, h);
  // top color band
  ctx.fillStyle = cat.color;
  ctx.fillRect(x, y, w, 8);
  // symbol
  const sx = x + 60, sy = y + 60, sw = 180, sh = 180;
  const grad = ctx.createLinearGradient(sx, sy, sx+sw, sy+sh);
  grad.addColorStop(0, cat.color);
  grad.addColorStop(1, cat.color + 'cc');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(sx, sy, sw, sh, 18) : ctx.rect(sx, sy, sw, sh);
  ctx.fill();
  // symbol text
  ctx.fillStyle = '#fff';
  ctx.font = '900 110px Tajawal, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(el.s, sx + sw/2, sy + sh/2 + 6);
  // top-left atomic number
  ctx.font = 'bold 24px Tajawal, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(el.z, sx + 12, sy + 12);
  // title
  ctx.fillStyle = '#0f3460';
  ctx.textAlign = 'right';
  ctx.font = '900 38px Tajawal, sans-serif';
  ctx.fillText(el.ar, x + w - 30, y + 50);
  ctx.fillStyle = '#64748b';
  ctx.font = 'bold 18px Tajawal, sans-serif';
  ctx.fillText(el.en + ' • ' + cat.ar, x + w - 30, y + 96);
  // electron config
  ctx.fillStyle = '#0f3460';
  ctx.fillRect(x + 30, y + 270, w - 60, 44);
  ctx.fillStyle = '#a5d8ff';
  ctx.font = 'bold 18px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(el.e, x + w/2, y + 292);
  // small info grid
  const items = [
    ['العدد الذري', el.z], ['الكتلة', el.m],
    ['المجموعة', el.g], ['الدورة', el.p],
    ['الحالة', el.state==='gas'?'غاز 💨':el.state==='liquid'?'سائل 💧':'صلب 🧊'],
    ['البلوك', el.b]
  ];
  ctx.font = 'bold 14px Tajawal, sans-serif';
  items.forEach((it, i)=>{
    const ix = x + 30 + (i%3)*((w-60)/3);
    const iy = y + 340 + Math.floor(i/3)*32;
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(it[0]+':', ix + ((w-60)/3) - 8, iy);
    ctx.fillStyle = '#0f3460';
    ctx.textAlign = 'left';
    ctx.fillText(String(it[1]), ix + 8, iy);
  });
  if(typeof saveHistory === 'function') saveHistory();
  toast('success','تم إرسال ' + el.ar + ' إلى السبورة');
}

// RoundRect polyfill
if(!CanvasRenderingContext2D.prototype.roundRect){
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
    if(w<2*r) r=w/2;
    if(h<2*r) r=h/2;
    this.beginPath();
    this.moveTo(x+r,y);
    this.arcTo(x+w,y,x+w,y+h,r);
    this.arcTo(x+w,y+h,x,y+h,r);
    this.arcTo(x,y+h,x,y,r);
    this.arcTo(x,y,x+w,y,r);
    this.closePath();
    return this;
  };
}

/* REFERENCE */
const REFERENCES={math:[{n:'مساحة المستطيل',f:'م = ط × ع',d:'الطول × الاعرضي'},{n:'مساحة المثلث',f:'م = ½ × ق × ع',d:'½ × القاعدة × الارتفاع'},{n:'مساحة الدائرة',f:'م = π × نق²',d:'π × نصف القطر تربيع'},{n:'محيط الدائرة',f:'م = 2 × π × نق',d:''},{n:'فيثاغورس',f:'أ² + ب² = جـ²',d:'في المثلث القائم'},{n:'المتوسط',f:'Σ ÷ ن',d:'مجموع القيم ÷ عددها'},{n:'الانحراف المعياري',f:'σ = √(Σ(x-μ)²/n)',d:''}],physics:[{n:'نيوتن الثاني',f:'ق = ك × ت',d:'F = ma'},{n:'السرعة',f:'ع = ف ÷ ز',d:'v = d/t'},{n:'الطاقة الحركية',f:'ط.ح = ½ × ك × ع²',d:'KE = ½mv²'},{n:'الطاقة الكامنة',f:'ط.ك = ك × ج × ف',d:'PE = mgh'},{n:'القدرة',f:'قد = ش ÷ ز',d:'P = W/t'},{n:'قانون أوم',f:'ج = م × ت',d:'V = IR'},{n:'العمل',f:'ش = ق × ف',d:'W = Fd'}],chem:[{n:'أفوجادرو',f:'6.022 × 10²³',d:'عدد الجسيمات في المول'},{n:'الغاز المثالي',f:'ض × ح = ن × ر × ز',d:'PV = nRT'},{n:'التركيز المولي',f:'ت = مول ÷ حجم',d:'M = n/V'},{n:'pH',f:'pH = -log[H⁺]',d:'قياس الحموضة'}]};
function openReference(){openModal('modalReference');showRef('math');}
function showRef(cat){document.querySelectorAll('#modalReference .chip').forEach(c=>c.classList.toggle('selected',c.dataset.ref===cat));document.getElementById('referenceList').innerHTML=REFERENCES[cat].map(r=>`<div class="ref-card"><h4>${r.n}</h4><div class="formula">${r.f}</div>${r.d?`<div class="ref-desc">${r.d}</div>`:''}</div>`).join('');}

/* MINDMAP */
function openMindMap(){openModal('modalMindMap');}
function clearMindMap(){mindmapCanvas.innerHTML='';mindmapCanvas.style.display='none';}
function generateMindMap(){
  const root=document.getElementById('mmRoot').value.trim();
  const branches=document.getElementById('mmBranches').value.split('\n').map(b=>b.trim()).filter(Boolean);
  if(!root||!branches.length){toast('error','أدخلي العنوان والفروع');return;}
  // ضمان أن resizeCanvas() نفّذت لتكون أبعاد SVG مطابقة للكانفس
  if(typeof resizeCanvas==='function' && (mindmapCanvas.getAttribute('width')==='0' || !mindmapCanvas.style.width)){
    try{resizeCanvas();}catch(e){}
  }
  // تنظيف أي محتوى قديم
  mindmapCanvas.innerHTML='';
  mindmapCanvas.style.display='block';
  const rect=canvasWrap.getBoundingClientRect();
  const cx=rect.width/2,cy=rect.height/2;
  const radius=Math.min(rect.width,rect.height)*.3;
  // ضبط viewBox لضمان رسم كل العناصر في الإطار المرئي (مهم عند التكبير/التصغير)
  mindmapCanvas.setAttribute('viewBox','0 0 '+rect.width+' '+rect.height);
  mindmapCanvas.setAttribute('preserveAspectRatio','xMidYMid meet');
  branches.forEach((b,i)=>{
    const a=(i/branches.length)*Math.PI*2-Math.PI/2;
    const x=cx+Math.cos(a)*radius;
    const y=cy+Math.sin(a)*radius;
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',cx);line.setAttribute('y1',cy);
    line.setAttribute('x2',x);line.setAttribute('y2',y);
    line.setAttribute('stroke','#1a5f7a');line.setAttribute('stroke-width','2');
    mindmapCanvas.appendChild(line);
    const node=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');
    node.setAttribute('x',x-50);node.setAttribute('y',y-15);
    node.setAttribute('width','100');node.setAttribute('height','30');
    node.innerHTML=`<div xmlns="http://www.w3.org/1999/xhtml" style="background:white;border:2px solid #1a5f7a;border-radius:15px;padding:5px 10px;font-weight:700;font-size:.85rem;text-align:center;font-family:Tajawal;color:#1a5f7a">${b}</div>`;
    mindmapCanvas.appendChild(node);
  });
  const rootNode=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');
  rootNode.setAttribute('x',cx-70);rootNode.setAttribute('y',cy-18);
  rootNode.setAttribute('width','140');rootNode.setAttribute('height','36');
  rootNode.innerHTML=`<div xmlns="http://www.w3.org/1999/xhtml" style="background:#1a5f7a;color:white;border-radius:18px;padding:8px 16px;font-weight:800;font-size:1rem;text-align:center;font-family:Tajawal">${root}</div>`;
  mindmapCanvas.appendChild(rootNode);
  // حفظ فوري في الـ State حتى لا تضيع الخريطة عند التنقل بين الشرائح قبل "للسبورة"
  if(typeof State!=='undefined' && State.pages && State.pages[State.currentPage]!==undefined){
    State.pages[State.currentPage].mindmapHTML=mindmapCanvas.innerHTML;
    State.pages[State.currentPage].mindmapVisible=true;
  }
  closeModal('modalMindMap');
  toast('success','تم الإنشاء — الخريطة ظاهرة فوق السبورة. اضغطي "للسبورة" لتسجيلها كجزء دائم.');
}
function saveMindMapToCanvas(){
  // تأكد أن الخريطة موجودة فعلاً
  if(!mindmapCanvas.children.length){
    toast('error','لا توجد خريطة. أنشئي واحدة أولاً.');
    return;
  }
  const rect=canvasWrap.getBoundingClientRect();
  const dpr=window.devicePixelRatio||1;
  const fo=Array.from(mindmapCanvas.children);
  if(!fo.length){toast('error','الخريطة فارغة');return;}

  // 1) احسب المربع المحيط بالخريطة في الـ overlay (نفس نظام الإحداثيات)
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  fo.forEach(el=>{
    if(el.tagName==='line'){
      const x1=parseFloat(el.getAttribute('x1')),y1=parseFloat(el.getAttribute('y1'));
      const x2=parseFloat(el.getAttribute('x2')),y2=parseFloat(el.getAttribute('y2'));
      minX=Math.min(minX,x1,x2);minY=Math.min(minY,y1,y2);
      maxX=Math.max(maxX,x1,x2);maxY=Math.max(maxY,y1,y2);
    } else if(el.tagName==='foreignObject'){
      const x=parseFloat(el.getAttribute('x')),y=parseFloat(el.getAttribute('y'));
      const w=parseFloat(el.getAttribute('width')),h=parseFloat(el.getAttribute('height'));
      minX=Math.min(minX,x);minY=Math.min(minY,y);
      maxX=Math.max(maxX,x+w);maxY=Math.max(maxY,y+h);
    }
  });
  const pad=24;
  minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);
  maxX=Math.min(rect.width,maxX+pad);maxY=Math.min(rect.height,maxY+pad);
  const bboxW=maxX-minX,bboxH=maxY-minY;

  // 2) ارسم الخريطة على الكانفس (نسخة احتياطية دائمة — لا تتأثر بالسحب)
  drawMindMapToCtx(ctx, fo, minX, minY, bboxW, bboxH);

  // 3) أنشئ عنصر سبورة قابل للسحب والتحجيم يحتوي SVG بنفس المحتوى
  const itemW=Math.max(280, Math.min(bboxW+40, rect.width-40));
  const itemH=Math.max(200, Math.min(bboxH+90, rect.height-40));
  const startX = Math.max(0, (rect.width  - itemW) / 2);
  const startY = Math.max(0, (rect.height - itemH) / 2);

  const wrap = document.createElement('div');
  wrap.className = 'board-item board-item-mindmap';
  wrap.style.left   = startX + 'px';
  wrap.style.top    = startY + 'px';
  wrap.style.width  = itemW + 'px';
  wrap.style.height = itemH + 'px';
  wrap.dataset.kind = 'mindmap';
  // خزّن البيانات الأولية لإعادة رسم SVG عند التحجيم
  wrap.dataset.mapData = JSON.stringify({
    minX, minY, bboxW, bboxH,
    fo: fo.map(el=>{
      if(el.tagName==='line'){
        return {t:'line', x1:el.getAttribute('x1'), y1:el.getAttribute('y1'), x2:el.getAttribute('x2'), y2:el.getAttribute('y2')};
      } else if(el.tagName==='foreignObject'){
        const d=el.querySelector('div');
        return {
          t:'node',
          x:el.getAttribute('x'), y:el.getAttribute('y'),
          w:el.getAttribute('width'), h:el.getAttribute('height'),
          text:(d?.textContent||'').trim(),
          isRoot:(d?.style?.background||'').includes('1a5f7a') || (d?.style?.backgroundColor||'')==='#1a5f7a' || (d?.style?.background||'').includes('rgb(26, 95, 122)')
        };
      }
      return null;
    }).filter(Boolean)
  });

  // عنوان الخريطة (الجذر) إن وُجد
  const rootNode = fo.find(el=>el.tagName==='foreignObject' && el.querySelector('div')?.style?.background?.includes('1a5f7a'));
  const rootTitle = rootNode?.querySelector('div')?.textContent?.trim() || 'خريطة ذهنية';

  wrap.innerHTML = `
    <div class="bi-head">
      <span class="bi-title"><i class="fas fa-project-diagram"></i> ${escapeHtml(rootTitle)}</span>
      <span class="bi-pg">خريطة</span>
      <button class="bi-burn" title="تثبيت في السبورة (تحويل لجزء من الرسم)"><i class="fas fa-check"></i></button>
      <button class="bi-close" title="حذف"><i class="fas fa-times"></i></button>
    </div>
    <div class="bi-body mindmap-bi-body"></div>
    <div class="bi-foot">
      <span class="bi-info"><i class="fas fa-hand-pointer"></i> اسحبي الشريط الأزرق للتحريك — استخدمي المقابض للتحجيم</span>
      <span class="bi-actions">
        <button class="bi-burn-sm" title="تثبيت في السبورة"><i class="fas fa-check"></i> تثبيت</button>
      </span>
    </div>
    <div class="bi-handle h-nw"></div><div class="bi-handle h-n"></div><div class="bi-handle h-ne"></div>
    <div class="bi-handle h-w"></div><div class="bi-handle h-e"></div>
    <div class="bi-handle h-sw"></div><div class="bi-handle h-s"></div><div class="bi-handle h-se"></div>
  `;

  // ارسم SVG داخل bi-body (مقياس يناسب حجم العنصر)
  const body = wrap.querySelector('.mindmap-bi-body');
  redrawMindMapInBody(body, wrap.dataset.mapData);

  // أضف العنصر للسبورة
  canvasWrap.appendChild(wrap);

  // اربط أحداث السحب + التحديد + الحذف + التثبيت
  if(typeof makeBoardItemInteractive === 'function'){
    makeBoardItemInteractive(wrap);
  } else if(typeof _reattachBoardItem === 'function'){
    _reattachBoardItem(wrap);
  } else {
    // fallback يدوي إن لم تتوفر أي منهما
    const head = wrap.querySelector('.bi-head');
    if(head && typeof makeDraggable === 'function'){
      try{ makeDraggable(head); }catch(e){}
    }
  }

  // اجعل العنصر محدداً فوراً
  wrap.classList.add('is-selected');
  if(typeof _boardItemFocus === 'function') _boardItemFocus(wrap);

  // اجعل السحب يُعيد رسم الـ SVG وفق الحجم الجديد (debounce)
  let resizeTimer = null;
  const ro = new ResizeObserver(()=>{
    if(resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(()=>redrawMindMapInBody(body, wrap.dataset.mapData), 80);
  });
  ro.observe(body);

  // احفظ في التاريخ ثم نظّف الـ SVG الكبير (النسخة على الكانفس + board-item يبقون)
  saveHistory();
  clearMindMap();
  // صفّر محتوى الـ State لمنع استعادتها عند العودة للشريحة
  if(typeof State!=='undefined' && State.pages && State.pages[State.currentPage]!==undefined){
    State.pages[State.currentPage].mindmapHTML='';
    State.pages[State.currentPage].mindmapVisible=false;
  }
  // حدّث لوحة عناصر السبورة
  if(typeof _refreshBoardItemsPanel === 'function') _refreshBoardItemsPanel();
  toast('success','تم حفظ الخريطة على السبورة — اسحبيها من الشريط الأزرق 📌');
}

/* ارسم الخريطة على الكانفس الرئيسي (دائمة، لا تتأثر بالتحريك) */
function drawMindMapToCtx(ctx, fo, ox, oy, w, h){
  ctx.save();
  // خلفية بيضاء + إطار
  ctx.fillStyle='#ffffff';
  ctx.fillRect(ox,oy,w,h);
  ctx.strokeStyle='#1a5f7a';
  ctx.lineWidth=2;
  ctx.strokeRect(ox+1,oy+1,w-2,h-2);
  // الخطوط
  ctx.strokeStyle='#1a5f7a';
  ctx.lineWidth=2;
  ctx.lineCap='round';
  fo.forEach(el=>{
    if(el.tagName==='line'){
      const x1=parseFloat(el.getAttribute('x1')),y1=parseFloat(el.getAttribute('y1'));
      const x2=parseFloat(el.getAttribute('x2')),y2=parseFloat(el.getAttribute('y2'));
      ctx.beginPath();
      ctx.moveTo(x1,y1);
      ctx.lineTo(x2,y2);
      ctx.stroke();
    }
  });
  // البطاقات والنصوص
  fo.forEach(el=>{
    if(el.tagName==='foreignObject'){
      const x=parseFloat(el.getAttribute('x')),y=parseFloat(el.getAttribute('y'));
      const cw=parseFloat(el.getAttribute('width')),ch=parseFloat(el.getAttribute('height'));
      const div=el.querySelector('div');
      const txt=(div?.textContent||'').trim();
      const isRoot=(div?.style?.background||'').includes('1a5f7a') || (div?.style?.backgroundColor||'')==='#1a5f7a' || (div?.style?.background||'').includes('rgb(26, 95, 122)');
      const r=ch/2;
      ctx.beginPath();
      ctx.moveTo(x+r,y);
      ctx.lineTo(x+cw-r,y);
      ctx.quadraticCurveTo(x+cw,y,x+cw,y+r);
      ctx.lineTo(x+cw,y+ch-r);
      ctx.quadraticCurveTo(x+cw,y+ch,x+cw-r,y+ch);
      ctx.lineTo(x+r,y+ch);
      ctx.quadraticCurveTo(x,y+ch,x,y+ch-r);
      ctx.lineTo(x,y+r);
      ctx.quadraticCurveTo(x,y,x+r,y);
      ctx.closePath();
      ctx.fillStyle=isRoot?'#1a5f7a':'#ffffff';
      ctx.fill();
      ctx.strokeStyle='#1a5f7a';
      ctx.lineWidth=2;
      ctx.stroke();
      ctx.fillStyle=isRoot?'#ffffff':'#1a5f7a';
      ctx.font=`bold ${isRoot?14:12}px Tajawal, sans-serif`;
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      const maxChars=Math.max(4,Math.floor(cw/9));
      const displayTxt=txt.length>maxChars?txt.slice(0,maxChars-1)+'…':txt;
      ctx.fillText(displayTxt,x+cw/2,y+ch/2);
    }
  });
  ctx.restore();
}

/* أعد رسم الخريطة داخل body عند التحجيم */
function redrawMindMapInBody(body, dataStr){
  if(!body || !dataStr) return;
  let data;
  try{ data = JSON.parse(dataStr); }catch(e){ return; }
  const W = body.clientWidth || 400;
  const H = body.clientHeight || 300;
  if(W < 20 || H < 20) return;

  // مقياس لتحويل من نظام overlay (0..canvasWidth) إلى نظام body (0..W)
  const sx = W / (data.bboxW || 1);
  const sy = H / (data.bboxH || 1);
  const s = Math.min(sx, sy) * 0.92;  // هامش بسيط
  // إزاحة الإطار ضمن body
  const offsetX = (W - (data.bboxW || 1) * s) / 2 - (data.minX || 0) * s;
  const offsetY = (H - (data.bboxH || 1) * s) / 2 - (data.minY || 0) * s;

  // أبني SVG
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns,'svg');
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.cssText = 'display:block;width:100%;height:100%;background:#fff;';

  // إطار
  const frame = document.createElementNS(ns,'rect');
  frame.setAttribute('x', offsetX + (data.minX||0)*s - 4);
  frame.setAttribute('y', offsetY + (data.minY||0)*s - 4);
  frame.setAttribute('width',  (data.bboxW||0)*s + 8);
  frame.setAttribute('height', (data.bboxH||0)*s + 8);
  frame.setAttribute('fill','#ffffff');
  frame.setAttribute('stroke','#1a5f7a');
  frame.setAttribute('stroke-width','1.5');
  svg.appendChild(frame);

  // العناصر
  (data.fo||[]).forEach(item=>{
    if(item.t==='line'){
      const x1 = (parseFloat(item.x1)||0)*s + offsetX;
      const y1 = (parseFloat(item.y1)||0)*s + offsetY;
      const x2 = (parseFloat(item.x2)||0)*s + offsetX;
      const y2 = (parseFloat(item.y2)||0)*s + offsetY;
      const ln = document.createElementNS(ns,'line');
      ln.setAttribute('x1',x1); ln.setAttribute('y1',y1);
      ln.setAttribute('x2',x2); ln.setAttribute('y2',y2);
      ln.setAttribute('stroke','#1a5f7a');
      ln.setAttribute('stroke-width', Math.max(1, 2*s));
      svg.appendChild(ln);
    } else if(item.t==='node'){
      const x = (parseFloat(item.x)||0)*s + offsetX;
      const y = (parseFloat(item.y)||0)*s + offsetY;
      const w = (parseFloat(item.w)||100)*s;
      const h = (parseFloat(item.h)||30)*s;
      const r = h/2;
      // كبسولة
      const p = document.createElementNS(ns,'path');
      const d = `M ${x+r} ${y} L ${x+w-r} ${y} Q ${x+w} ${y} ${x+w} ${y+r} L ${x+w} ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h} L ${x+r} ${y+h} Q ${x} ${y+h} ${x} ${y+h-r} L ${x} ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;
      p.setAttribute('d', d);
      p.setAttribute('fill', item.isRoot ? '#1a5f7a' : '#ffffff');
      p.setAttribute('stroke','#1a5f7a');
      p.setAttribute('stroke-width', Math.max(1, 1.5*s));
      svg.appendChild(p);
      // نص
      const t = document.createElementNS(ns,'text');
      t.setAttribute('x', x + w/2);
      t.setAttribute('y', y + h/2);
      t.setAttribute('text-anchor','middle');
      t.setAttribute('dominant-baseline','middle');
      t.setAttribute('font-family','Tajawal, sans-serif');
      t.setAttribute('font-weight','800');
      t.setAttribute('font-size', (item.isRoot ? 14 : 12) * Math.max(0.5, s));
      t.setAttribute('fill', item.isRoot ? '#ffffff' : '#1a5f7a');
      // قطع النص الطويل
      const maxChars = Math.max(4, Math.floor(w / (8 * Math.max(0.5,s))));
      t.textContent = (item.text||'').length > maxChars ? (item.text||'').slice(0, maxChars-1) + '…' : (item.text||'');
      svg.appendChild(t);
    }
  });

  body.innerHTML = '';
  body.appendChild(svg);
}

/* helper بسيط - تأكد من توافر escapeHtml */
if(typeof window !== 'undefined' && typeof window.escapeHtml !== 'function' && typeof escapeHtml === 'function'){
  window.escapeHtml = escapeHtml;
}

/* EXIT TICKET */
let exitChannel=null;
let exitSessionCode=null;
function openExitTicket(){
  openModal('modalExit');
  renderExitResults();
  if(!exitSessionCode){
    startExitSession();
  }
}
function startExitSession(){
  exitSessionCode=Math.random().toString(36).substring(2,8).toUpperCase();
  exitNtfyTopic=_topic('exit-'+exitSessionCode);
  if(exitChannel){try{exitChannel.close();}catch(e){} exitChannel=null;}
  exitChannel = ntfySubscribe(exitNtfyTopic, (msg)=>{
    if(msg.type==='answer') addExitResponse(msg.name,msg.answer,msg.q||'تقييم الفهم');
  });
  // بث السؤال الحالي للطالبات
  showExitQR();
  toast('success','بدأت تذكرة الخروج - الكود: '+exitSessionCode);
}
function showExitQR(){
  if(!exitSessionCode)startExitSession();
  const sel=document.getElementById('exitQ');
  const qText = sel ? (sel.options[sel.selectedIndex]?.text || sel.value || 'تقييم الفهم') : 'تقييم الفهم';
  const joinUrl=buildJoinUrl('exit', exitSessionCode, exitNtfyTopic, {title:qText, options:[]});
  const urlWarning = document.getElementById('qrUrlWarning');
  if(urlWarning){
    const isInvalid = joinUrl.startsWith('?') || joinUrl.includes('localhost') || joinUrl.includes('127.0.0.1') || joinUrl.includes('file://') || joinUrl.includes('srcdoc');
    urlWarning.style.display = isInvalid ? 'block' : 'none';
    if(isInvalid){ showToast('⚠️ رابط QR غير صالح للطالبات! اضبطي رابط الصفحة أولاً', 'warning'); }
  }
  makeQR('exitQRImg', joinUrl, {width:140, height:140});
  document.getElementById('exitLiveResponses').style.display='block';
  const linkEl=document.getElementById('exitSessionUrl');
  if(linkEl)linkEl.textContent=joinUrl;
  const host = document.getElementById('exitQRImg');
  if(host) host.dataset.url=joinUrl;
  updateExitQuestionPreview();
  if(exitNtfyTopic){
    ntfyPublish(exitNtfyTopic, {type:'exitQ', q: qText, ts:Date.now()});
  }
}

/* ⭐ رمز جلسة البث المباشر — يولّد رمز قصير للطالبات */
function _genCode(len){
  len = len || 6;
  return Math.random().toString(36).substring(2, 2+len).toUpperCase();
}
let _liveCode = null;

/* ⭐ showLiveQR() — يفتح مودال برمز QR للبث المباشر (للطالبات للانضمام) */
function showLiveQR(){
  const code = _liveCode || (_liveCode = _genCode());
  const topic = _topic('live-'+code);
  const url = buildJoinUrl('student', code, topic, {title: 'البث المباشر'});
  // أنشئ/حدّث مودال عام ديناميكي
  let modal = document.getElementById('liveQrModal');
  if(!modal){
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'liveQrModal';
    document.body.appendChild(modal);
    modal.addEventListener('click',(e)=>{ if(e.target===modal) modal.classList.remove('active'); });
  }
  modal.innerHTML = `
    <div class="modal-box" style="max-width:480px">
      <div class="modal-head"><h2><i class="fas fa-broadcast-tower"></i> رمز QR — البث المباشر</h2>
        <button class="modal-close" onclick="document.getElementById('liveQrModal').classList.remove('active')"><i class="fas fa-times"></i></button>
      </div>
      <div class="modal-body">
        <div class="poll-qr-wrap">
          <div class="poll-qr-box" id="liveQrBox"></div>
          <p class="poll-qr-hint"><i class="fas fa-qrcode"></i> صوّري الكود بالجوال للانضمام للبث المباشر</p>
          <p style="font-size:.78rem;color:#666;text-align:center;margin-top:6px;word-break:break-all;direction:ltr"><b>الرابط:</b> <a href="${url}" target="_blank">${url}</a></p>
          <button class="btn btn-primary btn-sm" onclick="copyLiveLink()" style="margin-top:8px"><i class="fas fa-copy"></i> نسخ الرابط</button>
        </div>
      </div>
    </div>`;
  modal.classList.add('active');
  setTimeout(()=>makeQR('liveQrBox', url, {width:220, height:220}), 100);
}
function copyLiveLink(){
  const box = document.getElementById('liveQrBox');
  if(box && box.dataset && box.dataset.url){
    navigator.clipboard.writeText(box.dataset.url).then(()=>showToast('✅ تم نسخ رابط البث','success'));
  }
}
function updateExitQuestionPreview(){
  const sel=document.getElementById('exitQ');
  if(!sel)return;
  const preview=document.getElementById('exitCurrentQPreview');
  const text=document.getElementById('exitCurrentQText');
  if(!preview||!text)return;
  text.textContent = sel.options[sel.selectedIndex]?.text || sel.value;
  preview.style.display='block';
}
function copyExitLink(){
  const host=document.getElementById('exitQRImg');
  if(!host)return;
  const url=host.dataset.url||buildJoinUrl('exit', exitSessionCode, exitNtfyTopic);
  navigator.clipboard.writeText(url).then(()=>toast('success','تم انسخي الرابط'));
}
function addExitResponse(name,answer,q){
  Data.exitTickets=Data.exitTickets||[];
  // q قد يكون مفتاح (understood) أو نص — حوّله لنص السؤال إذا كان مفتاحاً
  let qText = q;
  const sel = document.getElementById('exitQ');
  if(sel && (q===sel.value || ['understood','loved','confused','apply'].includes(q))){
    qText = sel.options[sel.selectedIndex]?.text || q;
  }
  Data.exitTickets.push({id:Date.now(),name:name||'طالبة',q:qText,answer:answer,createdAt:new Date().toISOString()});
  saveData();
  renderExitResults();
  renderExitLiveResponses();
  toast('success','إجابتكِ جديدة من '+(name||'طالبة'));
}
function renderExitLiveResponses(){
  const list=document.getElementById('exitLiveList');
  if(!list)return;
  Data.exitTickets=Data.exitTickets||[];
  const recent=Data.exitTickets.slice(-15).reverse();
  if(!recent.length){list.innerHTML='<div style="text-align:center;padding:14px;color:#888">في انتظار إجابات الطالبات...</div>';return;}
  list.innerHTML=recent.map(t=>{const safe=escapeHtml(t.name||'طالبة');return`<div class="live-response-item"><div class="lr-av" title="${safe}"><i class="fas fa-user"></i></div><div class="lr-name" title="${safe}">${safe}</div><div class="lr-ans">${escapeHtml(t.answer||'')}</div><div class="lr-time">${formatTime(t.createdAt)}</div></div>`;}).join('');
}
function addExitQRToBoard(){
  const host=document.getElementById('exitQRImg');
  if(!host||!host.querySelector('canvas')){toast('error','أنشئيي الرمز أولاً');return;}
  const url=host.dataset.url||buildJoinUrl('exit', exitSessionCode, exitNtfyTopic);
  const qrCanvas=host.querySelector('canvas');
  const linkDiv=document.createElement('div');
  linkDiv.style.cssText='position:absolute;left:-9999px';
  linkDiv.textContent=url;
  // ارسم الرمز + الكود + الرابط على السبورة
  const tmp=document.createElement('canvas');
  tmp.width=520;tmp.height=240;
  const tctx=tmp.getContext('2d');
  tctx.fillStyle='#ffffff';tctx.fillRect(0,0,tmp.width,tmp.height);
  tctx.drawImage(qrCanvas,20,20,200,200);
  tctx.fillStyle='#1a5f7a';
  tctx.font='bold 22px Tajawal,sans-serif';
  tctx.textBaseline='top';
  tctx.direction='rtl';
  tctx.fillText('تذكرة الخروج - اسمحي للتفاعل',tmp.width-20,30);
  tctx.fillStyle='#666';
  tctx.font='bold 14px Tajawal,sans-serif';
  tctx.fillText('الكود: '+exitSessionCode,tmp.width-20,70);
  tctx.fillStyle='#333';
  tctx.font='11px Tajawal,sans-serif';
  // التفاف النص
  const maxW=tmp.width-240;
  const words=url.split('');
  let line='',y=100;
  for(let i=0;i<words.length;i++){
    const test=line+words[i];
    if(tctx.measureText(test).width>maxW&&i>0){
      tctx.fillText(line,tmp.width-20,y);
      line=words[i];
      y+=16;
    }else line=test;
  }
  tctx.fillText(line,tmp.width-20,y);
  const dpr=window.devicePixelRatio||1;
  const w=Math.min(tmp.width,canvas.width/dpr*.6);
  const h=tmp.height*(w/tmp.width);
  const x=canvas.width/dpr/2-w/2;
  const yc=canvas.height/dpr/2-h/2;
  ctx.drawImage(tmp,x,yc,w,h);
  saveHistory();
  closeModal('modalExit');
  toast('success','تم إضافة QR تذكرة الخروج للسبورة');
}
async function recordExit(a){
  Data.exitTickets=Data.exitTickets||[];
  const name=(await customPrompt('اسم الطالبة (اختاري - اتركيه فارغاً إذا لا تريدين تسجيل اسم):','','تسجيل إجابتكِ طالبة'))||'مجهولة';
  const sel=document.getElementById('exitQ');
  const qText = sel ? (sel.options[sel.selectedIndex]?.text || sel.value) : 'تقييم الفهم';
  Data.exitTickets.push({id:Date.now(),name:name,q:qText,answer:a,createdAt:new Date().toISOString()});
  saveData();
  renderExitResults();
  toast('success','تم تسجيل إجابتكِ '+name);
}
function renderExitResults(){
  Data.exitTickets=Data.exitTickets||[];
  const recent=Data.exitTickets.slice(-50);
  if(!recent.length){document.getElementById('exitResults').innerHTML='<p style="text-align:center;color:#888">لا نتائج بعد</p>';return;}
  const c={};recent.forEach(t=>c[t.answer]=(c[t.answer]||0)+1);
  const total=recent.length;
  document.getElementById('exitResults').innerHTML=Object.entries(c).map(([k,v])=>`<div style="display:flex;justify-content:space-between;padding:8px;background:white;border-radius:8px;margin-bottom:5px"><span>${k}</span><span style="font-weight:800;color:var(--primary)">${v} (${Math.round(v/total*100)}%)</span></div>`).join('')+`<div style="text-align:center;color:#888;font-size:.78rem;margin-top:8px">إجمالي: ${total} إجابتكِ</div>`;
  renderExitLiveResponses();
}

/* ============================================================
   STATISTICS REPORT (مخططات بيانية لكل من: تذكرة الخروج / الاستطلاع / الجلسة المباشرة)
   ============================================================ */
let _statsCurrentTab = 'exit';
function openStatsReport(tab){
  _statsCurrentTab = tab || 'exit';
  switchStatsTab(_statsCurrentTab);
  openModal('modalStatsReport');
}
function switchStatsTab(tab){
  _statsCurrentTab = tab;
  document.querySelectorAll('#statsTabs .chip').forEach(c=>{
    c.classList.toggle('active', c.dataset.stab===tab);
  });
  renderStatsTab(tab);
}
function renderStatsTab(tab){
  const container = document.getElementById('statsTabContent');
  if(!container)return;
  if(tab==='exit'){renderStatsExit(container);}
  else if(tab==='poll'){renderStatsPoll(container);}
  else if(tab==='live'){renderStatsLive(container);}
}

/* --- EXIT TICKET STATS --- */
function renderStatsExit(container){
  Data.exitTickets = Data.exitTickets || [];
  const all = Data.exitTickets;
  if(!all.length){
    container.innerHTML = `<div class="stats-empty"><i class="fas fa-inbox"></i><h3>لا توجد إجابات بعد</h3><p>ستظهر الإحصائيات هنا عند ورود إجابات من الطالبات</p></div>`;
    return;
  }
  // تجميع حسب الإجابة
  const byAnswer = {};
  all.forEach(t=>{byAnswer[t.answer]=(byAnswer[t.answer]||0)+1;});
  const labels = Object.keys(byAnswer);
  const data = labels.map(l=>byAnswer[l]);
  const total = all.length;
  // تجميع حسب السؤال
  const byQ = {};
  all.forEach(t=>{const k = t.q || 'غير محدد'; byQ[k]=(byQ[k]||0)+1;});
  // تجميع حسب اليوم
  const byDay = {};
  all.forEach(t=>{
    const d = new Date(t.createdAt).toLocaleDateString('ar-SA',{day:'numeric',month:'short'});
    byDay[d]=(byDay[d]||0)+1;
  });
  // الطالبات النشطات
  const byStudent = {};
  all.forEach(t=>{byStudent[t.name||'مجهولة']=(byStudent[t.name||'مجهولة']||0)+1;});
  const topStudents = Object.entries(byStudent).sort((a,b)=>b[1]-a[1]).slice(0,8);

  const colors = ['#27ae60','#f39c12','#e74c3c','#3498db','#9b59b6','#1abc9c','#e67e22'];
  container.innerHTML = `
    <div class="stats-summary">
      <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-lbl">إجمالي الإجابات</div></div>
      <div class="stat-card"><div class="stat-num">${Object.keys(byQ).length}</div><div class="stat-lbl">أسئلة مختلفة</div></div>
      <div class="stat-card"><div class="stat-num">${Object.keys(byStudent).length}</div><div class="stat-lbl">طالبة مشاركية</div></div>
      <div class="stat-card"><div class="stat-num">${labels.length}</div><div class="stat-lbl">خيارات الإجابة</div></div>
    </div>
    <h4 style="margin:14px 0 10px;color:var(--dark);font-weight:800"><i class="fas fa-chart-pie"></i> توزيع الإجابات</h4>
    <div class="chart-wrap"><canvas id="exitChartPie"></canvas></div>
    <h4 style="margin:14px 0 10px;color:var(--dark);font-weight:800"><i class="fas fa-chart-bar"></i> مقارنة الإجابات</h4>
    <div class="chart-wrap"><canvas id="exitChartBar"></canvas></div>
    <h4 style="margin:14px 0 10px;color:var(--dark);font-weight:800"><i class="fas fa-question"></i> توزيع الأسئلة</h4>
    <div class="chart-wrap"><canvas id="exitChartQ"></canvas></div>
    <h4 style="margin:14px 0 10px;color:var(--dark);font-weight:800"><i class="fas fa-calendar"></i> الإجابات عبر الأيام</h4>
    <div class="chart-wrap"><canvas id="exitChartDay"></canvas></div>
    <h4 style="margin:14px 0 10px;color:var(--dark);font-weight:800"><i class="fas fa-users"></i> أكثر الطالبات مشاركية</h4>
    <div class="chart-wrap tall"><canvas id="exitChartStudents"></canvas></div>
  `;
  // رندر المخططات بعد رسم الـ HTML
  setTimeout(()=>{
    if(typeof Chart==='undefined')return;
    _ensureDatalabels();
    makePieChart('exitChartPie', labels, data, colors.slice(0, labels.length));
    makeBarChart('exitChartBar', labels, data, 'عدد الإجابات', '#1a5f7a');
    makeHorizontalBar('exitChartQ', Object.keys(byQ), Object.values(byQ), 'عدد الإجابات', '#f39c12');
    makeBarChart('exitChartDay', Object.keys(byDay), Object.values(byDay), 'إجابات اليوم', '#27ae60');
    if(topStudents.length) makeHorizontalBar('exitChartStudents', topStudents.map(s=>s[0]), topStudents.map(s=>s[1]), 'إجابات', '#9b59b6');
  }, 50);
}

/* --- POLL STATS --- */
function renderStatsPoll(container){
  Data.polls = Data.polls || [];
  const all = Data.polls;
  if(!all.length){
    container.innerHTML = `<div class="stats-empty"><i class="fas fa-inbox"></i><h3>لا توجد استطلاعات بعد</h3><p>ستظهر الإحصائيات هنا عند بدء استطلاع</p></div>`;
    return;
  }
  // إجمالي الأصوات + عدد الاستطلاعات
  const totalVotes = all.reduce((s,p)=>s + (p.votes?p.votes.reduce((a,b)=>a+b,0):0), 0);
  const totalPolls = all.length;
  // كل سؤالك وخياراته
  let html = `
    <div class="stats-summary">
      <div class="stat-card"><div class="stat-num">${totalPolls}</div><div class="stat-lbl">إجمالي الاستطلاعات</div></div>
      <div class="stat-card"><div class="stat-num">${totalVotes}</div><div class="stat-lbl">إجمالي الأصوات</div></div>
      <div class="stat-card"><div class="stat-num">${all.reduce((s,p)=>s+(p.voters?p.voters.length:0),0)}</div><div class="stat-lbl">طالبة صوّتت</div></div>
    </div>
  `;
  // اعرضي كل استطلاع بمخطط منفصل
  all.slice().reverse().forEach((p, idx)=>{
    const num = totalPolls - idx;
    const total = p.votes ? p.votes.reduce((a,b)=>a+b,0) : 0;
    const colors = ['#27ae60','#f39c12','#e74c3c','#3498db','#9b59b6','#1abc9c','#e67e22','#34495e'];
    html += `
      <div style="background:#fafbfc;border:1px solid #eaeaea;border-radius:12px;padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
          <h4 style="color:var(--dark);font-weight:800;margin:0"><i class="fas fa-vote-yea"></i> استطلاع #${num}: ${escapeHtml(p.q||'—')}</h4>
          <div style="display:flex;gap:6px;align-items:center">
            <span style="background:#1a5f7a;color:white;padding:3px 10px;border-radius:8px;font-size:.78rem">كود: ${p.code||'—'}</span>
            <span style="background:#27ae60;color:white;padding:3px 10px;border-radius:8px;font-size:.78rem">${total} صوت</span>
            ${p.endedAt?'':'<span style="background:#f39c12;color:white;padding:3px 10px;border-radius:8px;font-size:.78rem">نشط</span>'}
          </div>
        </div>
        <div style="font-size:.78rem;color:#666;margin-bottom:10px"><i class="fas fa-clock"></i> ${new Date(p.createdAt).toLocaleString('ar-SA')}</div>
        <div class="chart-wrap" style="height:240px"><canvas id="pollChart_${idx}"></canvas></div>
      </div>
    `;
  });
  // مخطط إجمالي لكل الاستطلاعات
  html += `<h4 style="margin:14px 0 10px;color:var(--dark);font-weight:800"><i class="fas fa-chart-line"></i> مقارنة عدد الأصوات بين الاستطلاعات</h4><div class="chart-wrap"><canvas id="pollChartAll"></canvas></div>`;
  container.innerHTML = html;
  setTimeout(()=>{
    if(typeof Chart==='undefined')return;
    _ensureDatalabels();
    all.slice().reverse().forEach((p, idx)=>{
      const labels = p.opts || [];
      const data = p.votes || [];
      const total = data.reduce((a,b)=>a+b,0)||1;
      const colors = ['#27ae60','#f39c12','#e74c3c','#3498db','#9b59b6','#1abc9c','#e67e22','#34495e'];
      makeBarChart(`pollChart_${idx}`, labels, data, 'عدد الأصوات', colors[0]);
    });
    const pollLabels = all.map((p,i)=>'#'+(all.length-i)+': '+(p.q||'—').substring(0,18)+(p.q&&p.q.length>18?'…':''));
    const pollData = all.map(p=>p.votes?p.votes.reduce((a,b)=>a+b,0):0);
    if(pollData.length) makeBarChart('pollChartAll', pollLabels, pollData, 'أصوات', '#1a5f7a');
  }, 50);
}

/* --- LIVE SESSION STATS --- */
function renderStatsLive(container){
  Data.liveSessions = Data.liveSessions || [];
  const all = Data.liveSessions;
  if(!all.length){
    container.innerHTML = `<div class="stats-empty"><i class="fas fa-inbox"></i><h3>لا توجد جلسات مباشرة بعد</h3><p>ستظهر الإحصائيات هنا عند انتهاء جلسة</p></div>`;
    return;
  }
  const totalAnswers = all.reduce((s,l)=>s+(l.answers?l.answers.length:0),0);
  let html = `
    <div class="stats-summary">
      <div class="stat-card"><div class="stat-num">${all.length}</div><div class="stat-lbl">إجمالي الجلسات</div></div>
      <div class="stat-card"><div class="stat-num">${totalAnswers}</div><div class="stat-lbl">إجابات الطالبات</div></div>
      <div class="stat-card"><div class="stat-num">${all.filter(l=>l.endedAt).length}</div><div class="stat-lbl">جلسات منتهية</div></div>
      <div class="stat-card"><div class="stat-num">${all.filter(l=>!l.endedAt).length}</div><div class="stat-lbl">جلسات نشطة</div></div>
    </div>
  `;
  // توزيع الإجابات عبر الجلسات
  const labels = all.map((l,i)=>'#'+(all.length-i)+': '+(l.q?.title||'—').substring(0,18));
  const data = all.map(l=>l.answers?l.answers.length:0);
  html += `<h4 style="margin:14px 0 10px;color:var(--dark);font-weight:800"><i class="fas fa-chart-bar"></i> عدد الإجابات لكل جلسة</h4><div class="chart-wrap"><canvas id="liveChartBar"></canvas></div>`;

  // تجميع الإجابات الصحيحة والخاطئة عبر كل الجلسات
  let totalCorrect = 0, totalWrong = 0, totalGraded = 0;
  all.forEach(s => {
    if(s.answers){
      s.answers.forEach(a => {
        if(a.isCorrect === true){ totalCorrect++; totalGraded++; }
        else if(a.hasCorrect === true){ totalWrong++; totalGraded++; }
      });
    }
  });
  if(totalGraded > 0){
    const pct = totalGraded > 0 ? Math.round((totalCorrect / totalGraded) * 100) : 0;
    html += `
      <h4 style="margin:18px 0 8px;color:var(--dark);font-weight:800"><i class="fas fa-chart-pie"></i> الإجابات الصحيحة والخاطئة</h4>
      <div style="background:linear-gradient(135deg,#f8fbfc,#fff);border:1px solid #e0eef3;border-radius:12px;padding:14px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-around;align-items:stretch;gap:14px;margin-bottom:14px;flex-wrap:wrap">
          <div style="flex:1;min-width:140px;background:linear-gradient(135deg,#e8f8f0,#d4f4e0);border:2px solid #27ae60;border-radius:12px;padding:14px;text-align:center">
            <div style="font-size:.85rem;font-weight:800;color:#1e8449;margin-bottom:6px"><i class="fas fa-check-circle"></i> إجابات صحيحة</div>
            <div style="font-size:2.2rem;font-weight:900;color:#27ae60;line-height:1">${totalCorrect}</div>
            <div style="font-size:.78rem;color:#1e8449;margin-top:4px">طالبة</div>
          </div>
          <div style="flex:1;min-width:140px;background:linear-gradient(135deg,#fdebe9,#fadbd8);border:2px solid #e74c3c;border-radius:12px;padding:14px;text-align:center">
            <div style="font-size:.85rem;font-weight:800;color:#922b21;margin-bottom:6px"><i class="fas fa-times-circle"></i> إجابات خاطئة</div>
            <div style="font-size:2.2rem;font-weight:900;color:#e74c3c;line-height:1">${totalWrong}</div>
            <div style="font-size:.78rem;color:#922b21;margin-top:4px">طالبة</div>
          </div>
          <div style="flex:1;min-width:140px;background:linear-gradient(135deg,#eaf2f8,#d4e6f1);border:2px solid #1a5f7a;border-radius:12px;padding:14px;text-align:center">
            <div style="font-size:.85rem;font-weight:800;color:#0f3460;margin-bottom:6px"><i class="fas fa-percentage"></i> نسبة الصحة</div>
            <div style="font-size:2.2rem;font-weight:900;color:#1a5f7a;line-height:1">${pct}<span style="font-size:1.1rem">%</span></div>
            <div style="font-size:.78rem;color:#0f3460;margin-top:4px">من ${totalGraded} إجابتكِ مُقَوَّمة</div>
          </div>
        </div>
        <div class="chart-wrap" style="height:260px"><canvas id="liveChartCorrectWrong"></canvas></div>
      </div>
    `;
  } else {
    html += `<div style="background:#fafbfc;border:1px dashed #ccc;border-radius:10px;padding:18px;margin:14px 0;text-align:center;color:#888"><i class="fas fa-info-circle"></i> لا توجد إجابات مُقَوَّمة بعد (تتطلب أسئلة اختاري مع حدّدي الإجابة الصحيحة)</div>`;
  }
  // تفاصيل كل جلسة
  all.slice().reverse().forEach((s, idx)=>{
    const num = all.length - idx;
    const total = s.answers? s.answers.length:0;
    const students = s.answers ? [...new Set(s.answers.map(a=>a.name))] : [];
    html += `
      <div style="background:#fafbfc;border:1px solid #eaeaea;border-radius:12px;padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
          <h4 style="color:var(--dark);font-weight:800;margin:0"><i class="fas fa-broadcast-tower"></i> جلسة #${num}: ${escapeHtml(s.q?.title||'—')}</h4>
          <div style="display:flex;gap:6px;align-items:center">
            <span style="background:#1a5f7a;color:white;padding:3px 10px;border-radius:8px;font-size:.78rem">كود: ${s.code||'—'}</span>
            <span style="background:#27ae60;color:white;padding:3px 10px;border-radius:8px;font-size:.78rem">${total} إجابتكِ</span>
            ${s.endedAt?'<span style="background:#7f8c8d;color:white;padding:3px 10px;border-radius:8px;font-size:.78rem">منتهية</span>':'<span style="background:#f39c12;color:white;padding:3px 10px;border-radius:8px;font-size:.78rem">نشطة</span>'}
          </div>
        </div>
        <div style="font-size:.78rem;color:#666;margin-bottom:10px"><i class="fas fa-clock"></i> بدأت: ${new Date(s.createdAt).toLocaleString('ar-SA')}${s.endedAt?` • انتهت: ${new Date(s.endedAt).toLocaleString('ar-SA')}`:''}</div>
        ${(()=>{
          // حساب الإجابات الصحيحة/الخاطئة لهذه الجلسة
          let c=0, w=0, hasGraded=false;
          if(s.answers){
            s.answers.forEach(a=>{
              if(a.isCorrect===true){c++; hasGraded=true;}
              else if(a.hasCorrect===true){w++; hasGraded=true;}
            });
          }
          if(!hasGraded) return '';
          const total2 = c+w;
          const pct2 = total2>0 ? Math.round((c/total2)*100) : 0;
          const cH = total2>0 ? Math.max(28, Math.round((c/total2)*100)) : 28;
          const wH = total2>0 ? Math.max(28, Math.round((w/total2)*100)) : 28;
          return `
            <div style="background:white;padding:10px;border-radius:10px;margin-bottom:10px;border:1px solid #e8e8e8">
              <div style="font-size:.8rem;font-weight:800;color:var(--dark);margin-bottom:8px;display:flex;align-items:center;gap:6px"><i class="fas fa-chart-bar" style="color:var(--primary)"></i> نتائج هذه الجلسة (نسبة الصحة: ${pct2}%)</div>
              <div style="display:flex;align-items:flex-end;gap:12px;height:120px;padding:0 6px">
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px">
                  <div style="font-size:.95rem;font-weight:900;color:#27ae60">${c}</div>
                  <div style="width:100%;max-width:90px;height:${cH}px;background:linear-gradient(180deg,#2ecc71,#27ae60);border-radius:8px 8px 0 0;display:flex;align-items:flex-start;justify-content:center;padding-top:6px;color:white;font-weight:800;font-size:.78rem;box-shadow:0 2px 6px rgba(39,174,96,.3)">صحيحة</div>
                </div>
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px">
                  <div style="font-size:.95rem;font-weight:900;color:#e74c3c">${w}</div>
                  <div style="width:100%;max-width:90px;height:${wH}px;background:linear-gradient(180deg,#ec7063,#e74c3c);border-radius:8px 8px 0 0;display:flex;align-items:flex-start;justify-content:center;padding-top:6px;color:white;font-weight:800;font-size:.78rem;box-shadow:0 2px 6px rgba(231,76,60,.3)">خاطئة</div>
                </div>
              </div>
            </div>
          `;
        })()}
        ${students.length?`<div style="background:white;padding:8px;border-radius:8px;margin-bottom:8px;font-size:.85rem"><i class="fas fa-users" style="color:var(--primary)"></i> ${students.length} طالبة: ${students.slice(0,8).map(escapeHtml).join('، ')}${students.length>8?` و ${students.length-8} غيرها`:''}</div>`:''}
        ${s.answers && s.answers.length?`<details style="background:white;padding:8px;border-radius:8px"><summary style="cursor:pointer;font-weight:700;color:var(--primary)">اعرضي كل الإجابات (${s.answers.length})</summary><div style="margin-top:8px;max-height:200px;overflow-y:auto">${s.answers.map(a=>`<div style="padding:6px;border-bottom:1px solid #f0f0f0;font-size:.85rem"><strong>${escapeHtml(a.name||'طالبة')}:</strong> ${escapeHtml(a.answer||'')} <span style="color:#888;font-size:.75rem">${a.time||''}</span></div>`).join('')}</div></details>`:''}
      </div>
    `;
  });
  container.innerHTML = html;
  setTimeout(()=>{
    if(typeof Chart==='undefined')return;
    _ensureDatalabels();
    if(data.length) makeBarChart('liveChartBar', labels, data, 'إجابات', '#1abc9c');
    if(totalGraded > 0){
      makeBarChart('liveChartCorrectWrong', ['إجابتكِ صحيحة', 'إجابتكِ خاطئة'], [totalCorrect, totalWrong], 'عدد الطالبات', ['#27ae60', '#e74c3c']);
    }
  }, 50);
}

function exportStatsAsPNG(){
  const node = document.getElementById('statsReportBody');
  if(!node){toast('error','لا يوجد تقرير');return;}
  if(typeof html2canvas==='undefined'){
    // بديل: نافذة طباعة
    printStatsReport();
    return;
  }
  html2canvas(node,{backgroundColor:'#fff',scale:2}).then(canvas=>{
    const a=document.createElement('a');
    a.download=`تقرير-إحصائي-${Date.now()}.png`;
    a.href=canvas.toDataURL('image/png');
    a.click();
    toast('success','تم احفظي الصورة');
  }).catch(()=>toast('error','فشل الصدّري'));
}
function printStatsReport(){
  const node = document.getElementById('statsReportBody');
  if(!node)return;
  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html dir="rtl"><head><title>تقرير إحصائي</title>
    <style>body{font-family:Tajawal,sans-serif;padding:20px;background:#fff}
    .stats-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
    .stat-card{background:#f8fbfc;padding:14px;border-radius:10px;text-align:center;border:1px solid #e0eef3}
    .stat-card .stat-num{font-size:1.7rem;font-weight:900;color:#1a5f7a}
    .stat-card .stat-lbl{font-size:.78rem;color:#666}
    .chart-wrap{margin:14px 0;page-break-inside:avoid}
    h4{color:#1a5f7a;margin:14px 0 8px}
    @media print{canvas{max-height:300px}}/* INTERACTIVE GEOMETRIC TOOLS */
.geo-tool.interactive-geo{position:absolute;z-index:180;cursor:grab;user-select:none;box-shadow:0 8px 28px rgba(0,0,0,.18);border-radius:8px;overflow:visible;transition:box-shadow .2s,transform .2s}
.geo-tool.interactive-geo:active{cursor:grabbing}
.geo-tool.interactive-geo:hover{box-shadow:0 12px 36px rgba(0,0,0,.25)}
.geo-tool.interactive-geo .geo-toolbar-mini{position:absolute;top:-38px;right:0;display:flex;gap:4px;opacity:0;transition:opacity .2s;z-index:10}
.geo-tool.interactive-geo:hover .geo-toolbar-mini{opacity:1}
.geo-tool.interactive-geo .geo-toolbar-mini button{width:32px;height:32px;border:none;background:rgba(0,0,0,.7);color:white;border-radius:6px;cursor:pointer;font-size:.75rem;display:flex;align-items:center;justify-content:center;transition:.15s}
.geo-tool.interactive-geo .geo-toolbar-mini button:hover{background:var(--danger);transform:scale(1.1)}
.geo-tool.interactive-geo .geo-toolbar-mini button:nth-child(2):hover{background:var(--success)}
.geo-tool.interactive-geo .ruler-svg,.geo-tool.interactive-geo svg{background:rgba(255,255,255,.96);border-radius:6px}
.geo-tool.interactive-geo.ruler-tool{width:auto;min-width:520px;height:70px}
.geo-tool.interactive-geo.protractor-tool.geo-tool.interactive-geo.protractor-tool{width:280px;height:160px}
.geo-tool.interactive-geo.compass-tool{width:320px;height:320px}
.geo-tool.interactive-geo.setsquare-tool{width:220px;height:220px}
</style></head><body>
    <h1 style="text-align:center;color:#1a5f7a">التقرير الإحصائي — ${new Date().toLocaleString('ar-SA')}</h1>
    ${node.innerHTML}
    </body></html>`);
  win.document.close();
  setTimeout(()=>{win.print();}, 500);
}

/* ============================================================
   PDF VIEWER
   ============================================================ */
let pdfRenderTask=null;
let pdfTextRenderTask = null;
let _pdfTextVisible = false;

function togglePDFTextMode(){
  // فتح لوحة استخراج النص (الطريقة الموثوقة للنسخ بدون تشابك الحروف)
  pdfOpenExtractPanel();
}

/* فتح لوحة استخراج النص — نصوص نظيفة قابلة للنسخ بدون تشابك */
let _pdfExtractedCache = null;
async function pdfOpenExtractPanel(){
  if(!State.pdfDoc){toast('error','حملي ملف PDF أولاً');return;}
  const panel = document.getElementById('pdfExtractPanel');
  if(!panel) return;
  panel.classList.add('active');
  // إغلاق اللوحة بالضغط على الخلفية
  if(!panel._bgSetup){
    panel._bgSetup = true;
    panel.addEventListener('click', (e) => {
      if(e.target === panel) pdfCloseExtractPanel();
    });
  }
  const body = document.getElementById('pdfExtractBody');
  if(!body) return;
  body.innerHTML = '<div style="text-align:center;padding:30px;color:#666"><i class="fas fa-spinner fa-spin" style="font-size:1.5rem;color:var(--primary)"></i><div style="margin-top:10px;font-weight:700">جاري استخراج النص...</div></div>';
  try{
    // استخراج النص من جميع الصفحات
    const pages = [];
    for(let p = 1; p <= State.pdfTotal; p++){
      const page = await State.pdfDoc.getPage(p);
      const tc = await page.getTextContent();
      // إعادة بناء النص بشكل صحيح: تجميع الكلمات حسب موقعها
      const items = tc.items;
      let pageText = '';
      let lastY = null;
      let lastX = null;
      for(let i = 0; i < items.length; i++){
        const it = items[i];
        if(!it.str) continue;
        // كشف انتقال سطر: إذا تغير الإحداثي Y
        if(lastY !== null && it.transform && lastX !== null){
          const dy = Math.abs((it.transform[5] || 0) - lastY);
          const dx = (it.transform[4] || 0) - lastX;
          // إذا كان التغيير في Y كبير = سطر جديد
          if(dy > 5){
            pageText += '\n';
          } else if(dx > 1 && !pageText.endsWith(' ')){
            // إضافة مسافة بين الكلمات إذا لزم
            pageText += ' ';
          }
        }
        pageText += it.str;
        if(it.transform){
          lastY = it.transform[5] || 0;
          lastX = (it.transform[4] || 0) + (it.width || 0);
        }
      }
      pages.push(pageText.trim());
    }
    _pdfExtractedCache = pages;
    // عرض الصفحات
    body.innerHTML = '';
    pages.forEach((text, idx) => {
      const pageNum = idx + 1;
      const pageDiv = document.createElement('div');
      pageDiv.className = 'pdf-extract-page';
      pageDiv.id = 'pdf-extract-page-' + pageNum;
      pageDiv.innerHTML = `
        <div class="pdf-extract-page-head">
          <div class="pdf-extract-page-title"><i class="fas fa-file-alt"></i> صفحة ${pageNum}</div>
          <div class="pdf-extract-page-actions">
            <button class="pdf-extract-jump" onclick="pdfGoToPage(${pageNum});pdfCloseExtractPanel();"><i class="fas fa-arrow-left"></i> اذهبي</button>
            <button class="pdf-extract-copy" onclick="pdfCopyPageText(${pageNum})"><i class="fas fa-copy"></i> انسخي</button>
          </div>
        </div>
        <div class="pdf-extract-text" id="pdf-extract-text-${pageNum}">${escapeHtml(text)}</div>
      `;
      body.appendChild(pageDiv);
    });
  } catch(err){
    console.error(err);
    body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--danger)"><i class="fas fa-exclamation-triangle" style="font-size:1.5rem"></i><div style="margin-top:10px;font-weight:700">فشل استخراج النص: ' + (err.message || '') + '</div></div>';
  }
}

function pdfCloseExtractPanel(){
  const panel = document.getElementById('pdfExtractPanel');
  if(panel) panel.classList.remove('active');
}

function pdfCopyPageText(pageNum){
  if(!_pdfExtractedCache || !_pdfExtractedCache[pageNum-1]){
    toast('error','لا يوجد نص منسوخ');
    return;
  }
  const text = _pdfExtractedCache[pageNum-1];
  // استخدام Clipboard API أو fallback
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(() => {
      toast('success','تم نسخ نص صفحة ' + pageNum);
    }).catch(() => {
      _pdfCopyFallback(text);
    });
  } else {
    _pdfCopyFallback(text);
  }
}

function pdfCopyAllText(){
  if(!_pdfExtractedCache){
    toast('error','لا يوجد نص منسوخ');
    return;
  }
  const all = _pdfExtractedCache.join('\n\n--- صفحة ').replace(/^/, 'صفحة 1\n\n');
  const final = 'صفحة 1\n\n' + _pdfExtractedCache.join('\n\n--- ');
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(final).then(() => {
      toast('success','تم نسخ نص كل الصفحات (' + _pdfExtractedCache.length + ' صفحة)');
    }).catch(() => {
      _pdfCopyFallback(final);
    });
  } else {
    _pdfCopyFallback(final);
  }
}

function _pdfCopyFallback(text){
  // طريقة احتياطية: استخدام textarea مؤقت
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try{
    document.execCommand('copy');
    toast('success','تم نسخ النص');
  } catch(e){
    toast('error','فشل النسخ — انسخي يدوياً');
  }
  document.body.removeChild(ta);
}

/* إغلاق/حذف ملف PDF الحالي */
function pdfCloseFile(){
  if(!State.pdfDoc){
    toast('info','لا يوجد ملف مفتوح');
    return;
  }
  if(!confirm('هل تريدين فعلاً إغلاق ملف PDF الحالي؟\n(سيتم مسح كل الرسوم والتعليقات أيضاً)')){
    return;
  }
  // تنظيف الحالة
  State.pdfDoc = null;
  State.pdfPage = 1;
  State.pdfTotal = 0;
  State.pdfZoom = 1.2;
  State.pdfFitMode = 'width';
  State.pdfDrawOn = false;
  _pdfTextVisible = false;
  _pdfExtractedCache = null;
  // تنظيف canvas الصفحة
  const canvas = document.getElementById('pdfCanvas');
  if(canvas){
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
    canvas.style.width = '0';
    canvas.style.height = '0';
  }
  // تنظيف canvas الرسم
  const drawCanvas = document.getElementById('pdfDrawCanvas');
  if(drawCanvas){
    const dctx = drawCanvas.getContext('2d');
    dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCanvas.width = 0;
    drawCanvas.height = 0;
    drawCanvas.style.display = 'none';
  }
  // تنظيف طبقة النص
  const textLayer = document.getElementById('pdfTextLayer');
  if(textLayer) textLayer.innerHTML = '';
  // إخفاء لوحة الاستخراج
  pdfCloseExtractPanel();
  // إعادة الواجهة لحالة الإفلات
  document.getElementById('pdfViewerContainer').style.display = 'none';
  document.getElementById('pdfPageInput').value = '1';
  document.getElementById('pdfTotalPages').textContent = '0';
  document.getElementById('pdfZoomLevel').textContent = '100%';
  const sel = document.getElementById('pdfZoomPreset');
  if(sel) sel.value = '';
  document.getElementById('pdfFileInput').value = '';
  // إعادة أزرار الرسم والنص
  const drawBtn = document.getElementById('pdfDrawBtn');
  if(drawBtn) drawBtn.classList.remove('active');
  const textBtn = document.getElementById('pdfTextToggle');
  if(textBtn){
    textBtn.classList.remove('active');
    textBtn.innerHTML = '<i class="fas fa-font"></i> استخراج النص';
  }
  // إخفاء زر FAB العائم
  _hidePdfBoardFab();
  toast('success','تم إغلاق ملف PDF');
}

/* دالة مساعدة للهروب من HTML في النص المستخرج */
function escapeHtml(s){
  if(s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ⭐ QR Helpers — clearQR & makeQR */
function clearQR(hostId){
  const host = typeof hostId === 'string' ? document.getElementById(hostId) : hostId;
  if(host) host.innerHTML = '';
}
function makeQR(hostId, url, opts){
  opts = opts || {};
  const host = typeof hostId === 'string' ? document.getElementById(hostId) : hostId;
  if(!host) return;
  host.innerHTML = '';
  try{
    new QRCode(host, {
      text: url,
      width: opts.width || 200,
      height: opts.height || 200,
      colorDark: opts.colorDark || '#1a5f7a',
      colorLight: opts.colorLight || '#ffffff',
      correctLevel: opts.correctLevel || QRCode.CorrectLevel.L
    });
  }catch(e){ console.warn('QR generation failed', e); }
  if(host.dataset) host.dataset.url = url;
}
function openPDFViewer(){
  openModal('modalPDF');
  setupPDFDropzone();
  setupPDFWheelZoom();
  if(typeof pdfjsLib!=='undefined'){
    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  // إعادة الضبط على وضع "ملاءمة العرض" عند الفتح إذا لم يُفتح ملف بعد
  if(!State.pdfDoc){
    State.pdfFitMode = 'width';
  }
}
function closePDFViewer(){closeModal('modalPDF');}
function setupPDFDropzone(){const dz=document.getElementById('pdfDropZone');const fi=document.getElementById('pdfFileInput');if(dz._setup)return;dz._setup=true;dz.addEventListener('click',()=>fi.click());dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('dragover');const f=e.dataTransfer.files[0];if(f&&f.type==='application/pdf')loadPDFFile(f);});fi.addEventListener('change',e=>{const f=e.target.files[0];if(f)loadPDFFile(f);});}

/* تكبير/تصغير بالماوس عند الضغط على Ctrl — يتيح تكبير سلس وسريع */
let _pdfWheelTimer = null;
function setupPDFWheelZoom(){
  const wrap = document.getElementById('pdfViewerWrap');
  if(!wrap || wrap._wheelSetup) return;
  wrap._wheelSetup = true;
  wrap.addEventListener('wheel', (e) => {
    if(!State.pdfDoc) return;
    // فقط عند الضغط على Ctrl (تجنب التداخل مع سكرول الصفحة)
    if(e.ctrlKey || e.metaKey){
      e.preventDefault();
      // خطوة تكبير ذكية: تتناسب مع المستوى الحالي
      const step = State.pdfZoom < 0.5 ? 0.1 : (State.pdfZoom < 1.5 ? 0.15 : 0.25);
      if(e.deltaY < 0){
        State.pdfZoom = Math.min(5, +(State.pdfZoom + step).toFixed(2));
      } else {
        State.pdfZoom = Math.max(0.25, +(State.pdfZoom - step).toFixed(2));
      }
      State.pdfFitMode = null;
      // Throttle: تأخير بسيط لتفادي إعادة الرسم المتكرر
      if(_pdfWheelTimer) clearTimeout(_pdfWheelTimer);
      _pdfWheelTimer = setTimeout(()=>{ renderPDFPage(); updatePDFZoomDisplay(); }, 60);
    }
  }, { passive: false });
  // pinch zoom للـ touch
  let _touchDist = 0;
  wrap.addEventListener('touchstart', (e) => {
    if(e.touches.length === 2){
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      _touchDist = Math.hypot(dx, dy);
    }
  }, { passive: true });
  wrap.addEventListener('touchmove', (e) => {
    if(e.touches.length === 2 && _touchDist > 0 && State.pdfDoc){
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / _touchDist;
      State.pdfZoom = Math.max(0.25, Math.min(5, +(State.pdfZoom * ratio).toFixed(2)));
      State.pdfFitMode = null;
      _touchDist = dist;
      if(_pdfWheelTimer) clearTimeout(_pdfWheelTimer);
      _pdfWheelTimer = setTimeout(()=>{ renderPDFPage(); updatePDFZoomDisplay(); }, 60);
    }
  }, { passive: false });
}
function updatePDFZoomDisplay(){
  const lvl = document.getElementById('pdfZoomLevel');
  if(lvl) lvl.textContent = Math.round(State.pdfZoom*100)+'%';
  const sel = document.getElementById('pdfZoomPreset');
  if(sel) sel.value = String(Math.round(State.pdfZoom*100));
}
function loadPDFFile(file){const reader=new FileReader();reader.onload=async e=>{try{const data=new Uint8Array(e.target.result);
  // تمرير خرائط الحروف والخطوط القياسية لإصلاح النصوص العربية المكسورة
  const loadingTask = pdfjsLib.getDocument({
    data,
    cMapUrl: window.__PDF_CMAP_URL || 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: window.__PDF_STANDARD_FONT_URL || 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/',
    disableAutoFetch: false,
    disableStream: false,
    // إعدادات إضافية: استخدام خاصية verbosity لتسريع التحميل
    verbosity: 0
  });
  State.pdfDoc=await loadingTask.promise;State.pdfTotal=State.pdfDoc.numPages;State.pdfPage=1;
  document.getElementById('pdfTotalPages').textContent=State.pdfTotal;
  document.getElementById('pdfViewerContainer').style.display='block';
  // ابدأ بملاءمة العرض تلقائياً
  State.pdfFitMode = 'width';
  renderPDFPage();
  // أظهر زر FAB العائم للـ PDF على السبورة
  _showPdfBoardFab(true);
  toast('success',`تم تحميل ${State.pdfTotal} صفحة`);}catch(err){console.error(err);toast('error','فشل تحميل الملف: '+(err&&err.message?err.message:''));}};reader.readAsArrayBuffer(file);}

/* إظهار/إخفاء زر FAB للـ PDF على السبورة */
function _showPdfBoardFab(show){
  const fab = document.getElementById('fabPdfBoard');
  if(!fab) return;
  fab.classList.toggle('visible', !!show);
}
function _hidePdfBoardFab(){ _showPdfBoardFab(false); }

/* عرض مؤشر تحميل أثناء إعادة الرسم */
function _showPDFLoading(visible){
  const wrap = document.getElementById('pdfCanvasWrap');
  if(!wrap) return;
  let ov = wrap.querySelector('.pdf-loading-overlay');
  if(visible){
    if(!ov){
      ov = document.createElement('div');
      ov.className = 'pdf-loading-overlay';
      ov.innerHTML = '<div class="spinner"></div>';
      wrap.appendChild(ov);
    }
    ov.style.display = 'flex';
  } else if(ov){
    ov.style.display = 'none';
  }
}

/* إصلاح طبقة النص بعد رسمها — منع تشابك الحروف العربية */
function _fixArabicTextLayer(layer, viewport){
  if(!layer) return;
  // التأكد من أن الطبقة تأخذ اتجاه النص من PDF نفسه
  layer.style.direction = 'inherit';
  layer.style.unicodeBidi = 'isolate';
  // ضبط أبعاد الطبقة بدقة
  layer.style.width = Math.floor(viewport.width) + 'px';
  layer.style.height = Math.floor(viewport.height) + 'px';
  // معالجة كل عنصر span داخل الطبقة
  const spans = layer.querySelectorAll('span');
  spans.forEach(sp => {
    // ضمان أن الفونت يدعم العربية
    sp.style.fontFamily = "'Tajawal','Amiri','Noto Naskh Arabic','Cairo','Segoe UI',sans-serif";
    // ضمان خصائص OpenType لتفكيك الحروف
    sp.style.fontFeatureSettings = '"kern" 1,"liga" 1,"calt" 1,"rlig" 1';
    sp.style.webkitFontFeatureSettings = '"kern" 1,"liga" 1,"calt" 1';
    sp.style.fontVariantLigatures = 'common-ligatures contextual';
    sp.style.webkitFontVariantLigatures = 'common-ligatures contextual';
    // إعادة ضبط أي letter-spacing/word-spacing قادم من inline style
    if(sp.style.letterSpacing && sp.style.letterSpacing !== 'normal'){
      sp.style.letterSpacing = 'normal';
    }
    if(sp.style.wordSpacing && sp.style.wordSpacing !== 'normal'){
      sp.style.wordSpacing = 'normal';
    }
  });
}

async function renderPDFPage(){
  if(!State.pdfDoc)return;
  if(pdfRenderTask){try{pdfRenderTask.cancel();}catch(e){}}
  if(pdfTextRenderTask){try{pdfTextRenderTask.cancel();}catch(e){}}
  const canvas=document.getElementById('pdfCanvas');
  const drawCanvas=document.getElementById('pdfDrawCanvas');
  const textLayerDiv=document.getElementById('pdfTextLayer');
  if(!canvas) return;
  // willReadFrequently:true يُلغِم تسريع العتاد على Canvas في Chromium
  // — يحل مشكلة تشابك حروف PDF.js على اللوحة (race condition في fillText)
  const ctx2=canvas.getContext('2d',{alpha:false,willReadFrequently:true});
  const page=await State.pdfDoc.getPage(State.pdfPage);

  // === حساب مستوى التكبير ===
  let cssScale = State.pdfZoom;
  // وضع "ملاءمة العرض": يُحسب تلقائياً ليتناسب مع عرض النافذة
  if(State.pdfFitMode === 'width'){
    const wrap = document.getElementById('pdfViewerWrap');
    if(wrap){
      // العرض المتاح = عرض النافذة - الحاشية (36px) - كانفاس-واب المحتمل
      const wrapWidth = Math.max(280, (wrap.clientWidth || 800) - 36);
      const baseViewport = page.getViewport({scale: 1});
      cssScale = wrapWidth / baseViewport.width;
      // حد أدنى وأقصى معقول
      cssScale = Math.max(0.3, Math.min(5, cssScale));
      State.pdfZoom = +cssScale.toFixed(2);
    }
  }

  // === تجهيز canvas بدقة عالية (الحد الأقصى DPR=2 للأداء) ===
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewport=page.getViewport({scale:cssScale});
  const outputScale = dpr;

  canvas.width=Math.floor(viewport.width*outputScale);
  canvas.height=Math.floor(viewport.height*outputScale);
  canvas.style.width=Math.floor(viewport.width)+'px';
  canvas.style.height=Math.floor(viewport.height)+'px';

  drawCanvas.width=Math.floor(viewport.width*outputScale);
  drawCanvas.height=Math.floor(viewport.height*outputScale);
  drawCanvas.style.width=Math.floor(viewport.width)+'px';
  drawCanvas.style.height=Math.floor(viewport.height)+'px';

  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
  document.getElementById('pdfPageInput').value=State.pdfPage;
  updatePDFZoomDisplay();

  _showPDFLoading(true);
  try{
    // 1) رسم الصفحة على canvas بجودة عالية
    pdfRenderTask=page.render({canvasContext:ctx2,viewport,transform,imageSmoothingEnabled:true});
    await pdfRenderTask.promise;

    // 2) لا نرسم طبقة النص — كانت تكسر تشكيل الحروف العربية
    //    (PDF.js يستخدم transform: scale() لكل حرف فيكسر ligatures العربية)
    //    النص للقراءة والنسخ متاح عبر لوحة "استخراج النص" المنفصلة
    if(textLayerDiv){
      textLayerDiv.innerHTML='';
      textLayerDiv.style.width=Math.floor(viewport.width)+'px';
      textLayerDiv.style.height=Math.floor(viewport.height)+'px';
    }
  } finally {
    _showPDFLoading(false);
  }
  if(State.pdfDrawOn)setupPDFDrawCanvas();
}
function pdfPrevPage(){if(State.pdfPage>1){State.pdfPage--;renderPDFPage();}}
function pdfNextPage(){if(State.pdfPage<State.pdfTotal){State.pdfPage++;renderPDFPage();}}
function pdfGoToPage(p){p=parseInt(p);if(p>=1&&p<=State.pdfTotal){State.pdfPage=p;renderPDFPage();}}
function pdfZoomIn(){
  // تكبير بخطوة ذكية حسب المستوى الحالي
  const step = State.pdfZoom < 0.5 ? 0.1 : (State.pdfZoom < 1.5 ? 0.15 : 0.25);
  State.pdfZoom=Math.min(5, +(State.pdfZoom+step).toFixed(2));
  State.pdfFitMode = null;
  renderPDFPage();
}
function pdfZoomOut(){
  const step = State.pdfZoom < 0.5 ? 0.1 : (State.pdfZoom < 1.5 ? 0.15 : 0.25);
  State.pdfZoom=Math.max(0.25, +(State.pdfZoom-step).toFixed(2));
  State.pdfFitMode = null;
  renderPDFPage();
}
function pdfZoomReset(){
  State.pdfZoom = 1.0;
  State.pdfFitMode = null;
  renderPDFPage();
  toast('info','تم إعادة الضبط على 100%');
}
function pdfFitWidth(){
  if(!State.pdfDoc){toast('error','حملي ملف PDF أولاً');return;}
  State.pdfFitMode = 'width';
  renderPDFPage();
  toast('success','ملاءمة عرض الصفحة: ' + Math.round(State.pdfZoom*100) + '%');
}
function pdfSetZoomPreset(val){
  const z = parseFloat(val);
  if(isNaN(z) || z <= 0) return;
  State.pdfZoom = z;
  State.pdfFitMode = null;
  renderPDFPage();
}
function togglePDFDraw(){State.pdfDrawOn=!State.pdfDrawOn;const dc=document.getElementById('pdfDrawCanvas');dc.style.display=State.pdfDrawOn?'block':'none';document.getElementById('pdfDrawBtn').classList.toggle('active',State.pdfDrawOn);if(State.pdfDrawOn)setupPDFDrawCanvas();}
function setupPDFDrawCanvas(){const dc=document.getElementById('pdfDrawCanvas');const dctx=dc.getContext('2d',{willReadFrequently:true});let drawing=false,lastX=0,lastY=0;dc.onmousedown=e=>{drawing=true;const r=dc.getBoundingClientRect();lastX=e.clientX-r.left;lastY=e.clientY-r.top;dctx.beginPath();dctx.moveTo(lastX,lastY);};dc.onmousemove=e=>{if(!drawing)return;const r=dc.getBoundingClientRect();dctx.strokeStyle=State.color;dctx.lineWidth=State.brushSize;dctx.lineCap='round';dctx.lineTo(e.clientX-r.left,e.clientY-r.top);dctx.stroke();};dc.onmouseup=()=>{drawing=false;};dc.onmouseleave=()=>{drawing=false;};}
function clearPDFAnnotations(){const dc=document.getElementById('pdfDrawCanvas');dc.getContext('2d',{willReadFrequently:true}).clearRect(0,0,dc.width,dc.height);toast('info','تم امسحي الرسوم');}
function addPDFToCanvas(){
  if(!State.pdfDoc){toast('error','حملي ملف PDF أولاً');return;}
  const pc=document.getElementById('pdfCanvas');
  const dc=document.getElementById('pdfDrawCanvas');
  // أنشئ لوحة مؤقتة بالحجم الفعلي (يشمل دقة الـ DPR) لضمان أعلى جودة
  const tmp=document.createElement('canvas');
  tmp.width=pc.width;tmp.height=pc.height;
  const tctx=tmp.getContext('2d');
  tctx.imageSmoothingEnabled=true;
  tctx.imageSmoothingQuality='high';
  tctx.fillStyle='#ffffff';
  tctx.fillRect(0,0,tmp.width,tmp.height);
  tctx.drawImage(pc,0,0);
  if(dc && dc.width>0) tctx.drawImage(dc,0,0);
  // حوّل من بكسل canvas إلى البكسل المنطقي للسبورة (لأن ctx.use scale(dpr,dpr))
  const dpr=window.devicePixelRatio||1;
  const cssW = pc.width/dpr;
  const cssH = pc.height/dpr;
  const x=(canvas.width/dpr)/2 - cssW/2;
  const y=(canvas.height/dpr)/2 - cssH/2;
  ctx.save();
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(tmp, x, y, cssW, cssH);
  ctx.restore();
  saveHistory();
  closePDFViewer();
  toast('success','تم الإضافة للسبورة بجودة عالية');
}

/* إضافة صفحة PDF الحالية كقطعة قابلة للتحريك والتحجيم على السبورة */
function addPDFToBoardMovable(){
  if(!State.pdfDoc){toast('error','حملي ملف PDF أولاً');return;}
  const el = createBoardPdfPage(State.pdfDoc, State.pdfPage, {
    title: 'صفحة PDF'
  });
  if(el){
    closePDFViewer();
    _showPdfBoardHint(el);
    toast('success','📄 تم وضع الصفحة على السبورة — اسحبيها وكبّريها، ثم اضغطي "تثبيت"');
  }
}

/* إضافة كل صفحات PDF كقطع دفعة واحدة على السبورة (مفيدة للملفات القصيرة) */
function addAllPDFPagesToBoard(){
  if(!State.pdfDoc){toast('error','حملي ملف PDF أولاً');return;}
  const total = State.pdfDoc.numPages;
  if(total > 12){
    if(!confirm('الملف يحتوي على ' + total + ' صفحة. هل تريدين إضافة كل الصفحات للسبورة؟')) return;
  }
  // ضع الصفحة الأولى في الموضع الافتراضي
  const wrap = document.getElementById('canvasWrap');
  if(!wrap) return;
  const wr = wrap.getBoundingClientRect();
  const cols = Math.min(3, total);
  const w = 360, h = 460;
  const gap = 20;
  let firstEl = null;
  for(let i=1; i<=total; i++){
    const col = (i-1) % cols, row = Math.floor((i-1)/cols);
    const x = wr.width/2 - (cols*(w+gap) - gap)/2 + col*(w+gap);
    const y = Math.max(20, wr.height/2 - 2*(h+gap)/2 + row*(h+gap));
    const el = createBoardPdfPage(State.pdfDoc, i, {
      title: 'صفحة PDF', x, y, width: w, height: h
    });
    if(i===1) firstEl = el;
  }
  closePDFViewer();
  if(firstEl) _showPdfBoardHint(firstEl);
  toast('success','📄 تم إضافة ' + total + ' صفحة PDF على السبورة');
}

/* ============================================================
   VIDEO PLAYER
   ============================================================ */
function openVideoPlayer(){openModal('modalVideo');setupVideoDropzone();}
function switchVideoTab(t){document.querySelectorAll('.video-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.vtab===t));document.getElementById('videoTabLocal').style.display=t==='local'?'block':'none';document.getElementById('videoTabYoutube').style.display=t==='youtube'?'block':'none';}
function setupVideoDropzone(){const dz=document.getElementById('videoDropZone');const fi=document.getElementById('videoFileInput');if(dz._setup)return;dz._setup=true;dz.addEventListener('click',()=>fi.click());dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('dragover');const f=e.dataTransfer.files[0];if(f&&f.type.startsWith('video/'))loadVideoFile(f);});fi.addEventListener('change',e=>{const f=e.target.files[0];if(f)loadVideoFile(f);});}
function loadVideoFile(file){const url=URL.createObjectURL(file);const v=document.getElementById('localVideo');v.src=url;v.style.display='block';document.getElementById('youtubePlayer').style.display='none';document.getElementById('videoContainer').style.display='block';document.getElementById('videoControlsBar').style.display='flex';const canvas=document.getElementById('videoDrawCanvas');canvas.width=v.videoWidth||800;canvas.height=v.videoHeight||450;canvas.style.width='100%';canvas.style.height='100%';toast('success','تم تحميل الفيديو');}
function updateYoutubeEmbed(){const url=document.getElementById('youtubeUrl').value.trim();if(!url)return;const v=extractYoutubeId(url);if(!v){toast('error','رابط يوتيوب غير صحيح');return;}document.getElementById('youtubePlayer').src=`https://www.youtube.com/embed/${v}`;document.getElementById('youtubePlayer').style.display='block';document.getElementById('localVideo').style.display='none';document.getElementById('videoContainer').style.display='block';document.getElementById('videoControlsBar').style.display='flex';}
function extractYoutubeId(url){const m=url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);return m?m[1]:null;}
function toggleVideoPlay(){const v=document.getElementById('localVideo');if(v.style.display!=='none'){v.paused?v.play():v.pause();}}
function toggleVideoDraw(){State.videoDrawOn=!State.videoDrawOn;const c=document.getElementById('videoDrawCanvas');c.classList.toggle('active',State.videoDrawOn);document.getElementById('vidDrawBtn').classList.toggle('active',State.videoDrawOn);if(State.videoDrawOn)setupVideoDrawCanvas();}
function setupVideoDrawCanvas(){const c=document.getElementById('videoDrawCanvas');const cctx=c.getContext('2d');let drawing=false,lastX=0,lastY=0;c.onmousedown=e=>{drawing=true;const r=c.getBoundingClientRect();lastX=e.clientX-r.left;lastY=e.clientY-r.top;cctx.beginPath();cctx.moveTo(lastX,lastY);};c.onmousemove=e=>{if(!drawing)return;const r=c.getBoundingClientRect();cctx.strokeStyle=State.color;cctx.lineWidth=State.brushSize;cctx.lineCap='round';cctx.lineTo(e.clientX-r.left,e.clientY-r.top);cctx.stroke();};c.onmouseup=()=>drawing=false;c.onmouseleave=()=>drawing=false;}
function clearVideoDrawing(){const c=document.getElementById('videoDrawCanvas');c.getContext('2d').clearRect(0,0,c.width,c.height);toast('info','تم الامسحي');}
function captureVideoFrame(){
  const v=document.getElementById('localVideo');
  if(v.style.display==='none'){toast('error','لا يوجد فيديو محلي');return;}
  const tmp=document.createElement('canvas');
  tmp.width=v.videoWidth;tmp.height=v.videoHeight;
  const tctx=tmp.getContext('2d');
  tctx.drawImage(v,0,0);
  // ادمج رسومات الـ overlay إن وُجدت
  const dc=document.getElementById('videoDrawCanvas');
  if(dc && dc.width>0) tctx.drawImage(dc,0,0,tmp.width,tmp.height);
  // أنشئ عنصر صورة قابل للتحريك والتحجيم على السبورة
  try{
    createBoardImage(tmp.toDataURL('image/png'), {
      title: 'لقطة فيديو', icon: 'fas fa-camera',
      kind: 'video-snapshot'
    });
    closeModal('modalVideo');
    toast('success','📸 تم إضافة اللقطة — اسحبيها لمكانها وكبّريها، ثم اضغطي "تثبيت"');
  }catch(err){
    console.error(err);
    toast('error','تعذر إنشاء اللقطة');
  }
}

/* ============================================================
   VIDEO ON BOARD: فيديو مباشر فوق السبورة + لقطات
   - openVideoOnBoard: ينشئ طبقة فيديو قابلة للسحب فوق السبورة
   - snapshotBoardVideo: يلتقط الإطار الحالي ويضيفه للسبورة
   - sendBoardVideoAsStatic: يحول الفيديو لصورة ثابتة على السبورة
   ============================================================ */
let _boardVideoLayer = null;

function _getActiveVideoSource(){
  // يرجع مصدر الفيديو النشط: إما ملف محلي أو يوتيوب
  const lv = document.getElementById('localVideo');
  if(lv && lv.style.display!=='none' && lv.src){
    return {type:'local', src:lv.src, el:lv};
  }
  const yp = document.getElementById('youtubePlayer');
  if(yp && yp.style.display!=='none' && yp.src){
    return {type:'youtube', src:yp.src, el:yp};
  }
  return null;
}

function openVideoOnBoard(){
  const src = _getActiveVideoSource();
  if(!src){toast('error','لا يوجد فيديو مفتوح');return;}
  // أغلق أي طبقة فيديو سابقة على السبورة
  closeBoardVideo();
  // أنشئ طبقة جديدة
  const layer = document.createElement('div');
  layer.className = 'board-video-layer';
  layer.style.width = '640px';
  layer.style.height = '420px';
  layer.innerHTML = `
    <div class="bv-head">
      <span class="bv-title"><i class="fas fa-video"></i> فيديو على السبورة</span>
      <button class="bv-snap" onclick="snapshotBoardVideo()" title="التقاط الإطار الحالي وإضافته للسبورة كقطعة قابلة للتحريك والتحجيم"><i class="fas fa-camera"></i> لقطة</button>
      <button class="bv-close" onclick="closeBoardVideo()" title="إغلاق"><i class="fas fa-times"></i></button>
    </div>
    <div class="bv-body">
      <div id="bvMediaHost" style="width:100%;height:100%"></div>
    </div>
    <div class="bv-foot">
      <button id="bvPlayBtn" onclick="toggleBoardVideoPlay()"><i class="fas fa-play"></i></button>
      <button onclick="snapshotBoardVideo()"><i class="fas fa-camera"></i> لقطة (قابلة للتحريك)</button>
      <button class="bv-send" onclick="sendBoardVideoAsStatic()" title="التقاط الإطار كقطعة قابلة للتحريك ثم إغلاق الفيديو"><i class="fas fa-download"></i> لقطة + إغلاق</button>
      <span style="flex:1"></span>
      <button onclick="closeBoardVideo()" style="background:rgba(231,76,60,.85)"><i class="fas fa-times"></i> إغلاق</button>
    </div>
  `;
  // ضع الطبقة كطفل لـ body لتظهر فوق كل شيء (فوق المودال)
  document.body.appendChild(layer);
  // ضعها في وسط الشاشة
  const initialW = 640, initialH = 420;
  layer.style.left = (window.innerWidth - initialW) / 2 + 'px';
  layer.style.top = (window.innerHeight - initialH) / 2 + 'px';
  layer.style.transform = 'none';
  _boardVideoLayer = layer;
  // انقل الفيديو إلى داخل الطبقة (نقل العقدة يحافظ على حالة التشغيل)
  const host = layer.querySelector('#bvMediaHost');
  if(src.type==='local'){
    host.appendChild(src.el);
    src.el.style.display='block';
    src.el.style.width='100%';
    src.el.style.height='100%';
    src.el.style.maxHeight='none';
    src.el.controls = true;
  } else {
    // يوتيوب: استبدل بـ iframe جديد بنفس الـ src ليعمل داخل الـ layer
    const newIframe = document.createElement('iframe');
    newIframe.src = src.src + (src.src.includes('?')?'&':'?') + 'autoplay=1';
    newIframe.setAttribute('allow','accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
    newIframe.setAttribute('allowfullscreen','');
    newIframe.style.cssText = 'width:100%;height:100%;border:none;display:block';
    newIframe.id = 'youtubePlayer';
    host.appendChild(newIframe);
  }
  // فعّل السحب من الشريط العلوي
  _makeDraggable(layer, layer.querySelector('.bv-head'));
  // أغلق المودال ليظهر الفيديو على السبورة
  closeModal('modalVideo');
  toast('success','تم عرض الفيديو على السبورة — اسحب الشريط الأزرق لتحريكه');
}

function closeBoardVideo(){
  if(!_boardVideoLayer) return;
  const layer = _boardVideoLayer;
  try{
    // أعد الفيديو للـ modal
    const lv = document.getElementById('localVideo');
    const yp = document.getElementById('youtubePlayer');
    if(lv && layer.contains(lv)){
      const localHost = document.getElementById('videoContainer') || document.body;
      if(localHost) localHost.appendChild(lv);
      lv.style.display='';
    }
    if(yp && layer.contains(yp)){
      const ytHost = document.getElementById('videoContainer') || document.body;
      if(ytHost) ytHost.appendChild(yp);
      yp.style.display='';
    }
  }catch(e){ console.warn('closeBoardVideo:', e); }
  layer.remove();
  _boardVideoLayer = null;
  toast('info','تم إغلاق الفيديو من السبورة');
}

function toggleBoardVideoPlay(){
  const lv = document.getElementById('localVideo');
  if(lv && lv.style.display!=='none'){
    if(lv.paused){ lv.play(); toast('info','▶ تشغيل'); }
    else{ lv.pause(); toast('info','⏸ إيقاف'); }
  } else {
    // لا يمكن التحكم بيوتيوب مباشرة (يحتاج API)
    toast('warning','استخدمي أزرار المشغل داخل يوتيوب');
  }
}

function snapshotBoardVideo(){
  const lv = document.getElementById('localVideo');
  if(!lv || lv.style.display==='none' || !lv.videoWidth){
    toast('error','لا يوجد فيديو محلي لالتقاط لقطة منه');
    return;
  }
  try{
    // التقط الإطار بجودة كاملة
    const tmp = document.createElement('canvas');
    tmp.width = lv.videoWidth;
    tmp.height = lv.videoHeight;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(lv, 0, 0);
    // أنشئ عنصر صورة قابل للتحريك والتحجيم على السبورة
    createBoardImage(tmp.toDataURL('image/png'), {
      title: 'لقطة فيديو', icon: 'fas fa-camera',
      kind: 'video-snapshot'
    });
    toast('success','📸 تم إضافة اللقطة على السبورة — اسحبيها وكبّريها ثم "تثبيت"');
  }catch(err){
    console.error(err);
    toast('error','تعذر التقاط الإطار');
  }
}

function sendBoardVideoAsStatic(){
  // ثبّت الإطار الحالي كصورة ثابتة على السبورة (بدون الإبقاء على الفيديو)
  const lv = document.getElementById('localVideo');
  if(lv && lv.style.display!=='none' && lv.videoWidth){
    snapshotBoardVideo();
  } else {
    // لو يوتيوب: التقط iframe عبر html2canvas لاحقاً — الآن علّم المستخدم
    toast('warning','هذه الميزة تعمل مع الملفات المحلية فقط');
    return;
  }
  closeBoardVideo();
}

function _makeDraggable(el, handle){
  let dragging=false, sx=0, sy=0, ox=0, oy=0;
  handle.addEventListener('mousedown', e=>{
    dragging=true;
    const r = el.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY;
    // حوّل من transform translate(-50%,-50%) إلى left/top صريحين
    el.style.left = r.left + 'px';
    el.style.top = r.top + 'px';
    el.style.transform = 'none';
    el.style.position = 'fixed';
    ox = parseFloat(el.style.left); oy = parseFloat(el.style.top);
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener('mousemove', e=>{
    if(!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    let nx = ox + dx, ny = Math.max(0, oy + dy);
    // لا تخرج من حدود النافذة
    nx = Math.max(0, Math.min(window.innerWidth - 100, nx));
    ny = Math.max(0, Math.min(window.innerHeight - 50, ny));
    el.style.left = nx + 'px';
    el.style.top = ny + 'px';
  });
  document.addEventListener('mouseup', ()=>{ dragging=false; });
}


/* ============================================================
   BOARD ITEMS — عناصر قابلة للتحريك والتحجيم فوق السبورة
   - createBoardImage: ينشئ عنصر صورة قابل للسحب والتحجيم
   - createBoardPdfPage: ينشئ عنصر صفحة PDF قابل للسحب والتحجيم مع تنقل بين الصفحات
   - makeBoardItemInteractive: يفعّل السحب والتحجيم + تحديد العنصر
   - commitBoardItemToCanvas: يحوّل العنصر لجزء من الرسم (حرق)
   - commitAllBoardItemsToCanvas: يحوّل كل العناصر دفعة واحدة
   ============================================================ */
let _boardItemZ = 600;  // z-index ابتدائي لعناصر السبورة

function _boardItemFocus(el){
  document.querySelectorAll('.board-item.is-selected').forEach(e=>{if(e!==el)e.classList.remove('is-selected');});
  el.classList.add('is-selected');
  el.style.zIndex = ++_boardItemZ;
}

function _clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

/* إنشاء عنصر صورة قابل للسحب والتحجيم على السبورة */
function createBoardImage(dataURL, opts){
  opts = opts || {};
  const wrap = document.getElementById('canvasWrap');
  if(!wrap){ toast('error','السبورة غير متاحة'); return null; }

  const wrapRect = wrap.getBoundingClientRect();
  const w = opts.width  || 420;
  const h = opts.height || 280;
  // ابدأ من وسط منطقة السبورة المرئية (بدل وسط الشاشة حتى لا يختفي خلف الشريط العلوي)
  const startX = opts.x !== undefined ? opts.x : (wrapRect.width/2  - w/2);
  const startY = opts.y !== undefined ? opts.y : (wrapRect.height/2 - h/2);

  const el = document.createElement('div');
  el.className = 'board-item';
  el.style.left   = _clamp(startX, 0, Math.max(0, wrapRect.width  - w)) + 'px';
  el.style.top    = _clamp(startY, 0, Math.max(0, wrapRect.height - h)) + 'px';
  el.style.width  = w + 'px';
  el.style.height = h + 'px';
  el.dataset.kind = opts.kind || 'image';
  el.dataset.title = opts.title || 'لقطة';

  el.innerHTML = `
    <div class="bi-head">
      <span class="bi-title"><i class="${opts.icon || 'fas fa-image'}"></i> ${el.dataset.title}</span>
      ${opts.badge ? `<span class="bi-pg">${opts.badge}</span>` : ''}
      <button class="bi-burn" title="تثبيت في السبورة (تحويل لجزء من الرسم)"><i class="fas fa-check"></i></button>
      <button class="bi-close" title="حذف"><i class="fas fa-times"></i></button>
    </div>
    <div class="bi-zoombar">
      <button class="bi-zm-out" title="تصغير (Ctrl + -)"><i class="fas fa-search-minus"></i></button>
      <span class="bi-zoom-val">100%</span>
      <button class="bi-zm-in" title="تكبير (Ctrl + +)"><i class="fas fa-search-plus"></i></button>
      <span class="bi-zoom-sep"></span>
      <button class="bi-zm-fit" title="ملاءمة للحجم الحالي"><i class="fas fa-expand"></i></button>
      <button class="bi-zm-rst" title="الحجم الأصلي"><i class="fas fa-redo"></i></button>
    </div>
    <div class="bi-body"><img alt="" draggable="false"></div>
    <div class="bi-foot">
      <span class="bi-info"><i class="fas fa-hand-pointer"></i> اسحبي الشريط الأزرق للتحريك — استخدمي المقابض الصفراء للتحجيم</span>
      <span class="bi-actions">
        <button class="bi-burn-sm" title="تثبيت في السبورة"><i class="fas fa-check"></i> تثبيت</button>
      </span>
    </div>
    <div class="bi-handle h-nw"></div>
    <div class="bi-handle h-n"></div>
    <div class="bi-handle h-ne"></div>
    <div class="bi-handle h-w"></div>
    <div class="bi-handle h-e"></div>
    <div class="bi-handle h-sw"></div>
    <div class="bi-handle h-s"></div>
    <div class="bi-handle h-se"></div>
  `;
  wrap.appendChild(el);
  const img = el.querySelector('img');
  img.onload = ()=>{
    // اضبط الحجم الابتدائي بناءً على نسبة الصورة إذا لم يحدد المستخدم
    if(!opts.width || !opts.height){
      const ar = img.naturalWidth / img.naturalHeight;
      const maxW = Math.min(640, wrapRect.width  * 0.6);
      const maxH = Math.min(420, wrapRect.height * 0.6);
      let nw = maxW, nh = maxW / ar;
      if(nh > maxH){ nh = maxH; nw = maxH * ar; }
      el.style.width  = nw + 'px';
      el.style.height = nh + 'px';
    }
    // خزّن الأبعاد الأصلية لتستخدمها أزرار التكبير
    el._origW = el.offsetWidth;
    el._origH = el.offsetHeight;
    _updateZoomLabel(el);
  };
  img.src = dataURL;

  // أزرار التثبيت والحذف
  el.querySelector('.bi-close').addEventListener('click', ()=>{ el.remove(); toast('info','تم الحذف'); });
  el.querySelector('.bi-burn').addEventListener('click',  ()=>{ commitBoardItemToCanvas(el); });
  el.querySelector('.bi-burn-sm').addEventListener('click',()=>{ commitBoardItemToCanvas(el); });

  makeBoardItemInteractive(el);
  _boardItemFocus(el);
  return el;
}

/* إنشاء عنصر صفحة PDF قابل للسحب والتحجيم على السبورة مع تنقل بين الصفحات */
let _boardPdfItemCounter = 0;
function createBoardPdfPage(pdfDoc, pageNum, opts){
  opts = opts || {};
  const wrap = document.getElementById('canvasWrap');
  if(!wrap || !pdfDoc){ toast('error','لا يوجد ملف PDF'); return null; }

  pageNum = _clamp(parseInt(pageNum)||1, 1, pdfDoc.numPages);
  const wrapRect = wrap.getBoundingClientRect();
  const id = ++_boardPdfItemCounter;

  const w = opts.width  || 480;
  const h = opts.height || 620;
  const startX = opts.x !== undefined ? opts.x : (wrapRect.width/2  - w/2);
  const startY = opts.y !== undefined ? opts.y : (wrapRect.height/2 - h/2);

  const el = document.createElement('div');
  el.className = 'board-item board-item-pdf';
  el.style.left   = _clamp(startX, 0, Math.max(0, wrapRect.width  - w)) + 'px';
  el.style.top    = _clamp(startY, 0, Math.max(0, wrapRect.height - h)) + 'px';
  el.style.width  = w + 'px';
  el.style.height = h + 'px';
  el.dataset.kind = 'pdf';
  el.dataset.pdfId = String(id);
  el.dataset.page = String(pageNum);

  el.innerHTML = `
    <div class="bi-head">
      <span class="bi-title"><i class="fas fa-file-pdf"></i> ${opts.title || 'صفحة PDF'}</span>
      <span class="bi-pgctrl">
        <button class="bi-pgprev" title="صفحة سابقة"><i class="fas fa-chevron-right"></i></button>
        <span class="bi-pglabel">${pageNum} / ${pdfDoc.numPages}</span>
        <button class="bi-pgnext" title="صفحة تالية"><i class="fas fa-chevron-left"></i></button>
      </span>
      <button class="bi-burn" title="تثبيت الصفحة الحالية في السبورة"><i class="fas fa-check"></i></button>
      <button class="bi-close" title="حذف"><i class="fas fa-times"></i></button>
    </div>
    <div class="bi-zoombar">
      <button class="bi-zm-out" title="تصغير"><i class="fas fa-search-minus"></i></button>
      <span class="bi-zoom-val">100%</span>
      <button class="bi-zm-in" title="تكبير"><i class="fas fa-search-plus"></i></button>
      <span class="bi-zoom-sep"></span>
      <button class="bi-zm-fit" title="ملاءمة للمشهد"><i class="fas fa-expand"></i></button>
      <button class="bi-zm-rst" title="الحجم الأصلي"><i class="fas fa-redo"></i></button>
    </div>
    <div class="bi-body"><canvas></canvas></div>
    <div class="bi-foot">
      <span class="bi-info"><i class="fas fa-hand-pointer"></i> اسحبي للتحريك — كبّري/صغّري من المقابض</span>
      <span class="bi-actions">
        <button class="bi-burn-sm" title="تثبيت في السبورة"><i class="fas fa-check"></i> تثبيت</button>
      </span>
    </div>
    <div class="bi-handle h-nw"></div>
    <div class="bi-handle h-n"></div>
    <div class="bi-handle h-ne"></div>
    <div class="bi-handle h-w"></div>
    <div class="bi-handle h-e"></div>
    <div class="bi-handle h-sw"></div>
    <div class="bi-handle h-s"></div>
    <div class="bi-handle h-se"></div>
  `;
  wrap.appendChild(el);
  // خزّن الحجم الأصلي للرجوع إليه من زر "الحجم الأصلي"
  el._origW = w;
  el._origH = h;

  // ارسم الصفحة الحالية على canvas داخلي
  const cvs = el.querySelector('canvas');
  function _renderPdfPage(num){
    el.dataset.page = String(num);
    el.querySelector('.bi-pglabel').textContent = num + ' / ' + pdfDoc.numPages;
    el.querySelector('.bi-pgprev').disabled = (num<=1);
    el.querySelector('.bi-pgnext').disabled = (num>=pdfDoc.numPages);
    pdfDoc.getPage(num).then(page=>{
      // احسب المقياس ليلائم مساحة الجسم مع هامش بسيط
      const bodyEl = el.querySelector('.bi-body');
      const v1 = page.getViewport({scale:1});
      const cw = bodyEl.clientWidth  - 8;
      const ch = bodyEl.clientHeight - 8;
      const scale = Math.min(cw/v1.width, ch/v1.height);
      const vp = page.getViewport({scale});
      const dpr = window.devicePixelRatio || 1;
      cvs.width  = Math.max(1, Math.floor(vp.width  * dpr));
      cvs.height = Math.max(1, Math.floor(vp.height * dpr));
      cvs.style.width  = vp.width  + 'px';
      cvs.style.height = vp.height + 'px';
      const cctx = cvs.getContext('2d',{willReadFrequently:true});
      cctx.setTransform(1,0,0,1,0,0);
      cctx.clearRect(0,0,cvs.width,cvs.height);
      page.render({canvasContext:cctx, viewport:vp}).promise.catch(()=>{});
    });
  }
  el._renderPdfPage = _renderPdfPage;
  _renderPdfPage(pageNum);

  // أزرار التنقل بين الصفحات
  el.querySelector('.bi-pgprev').addEventListener('click', e=>{
    e.stopPropagation();
    const cur = parseInt(el.dataset.page)||1;
    if(cur>1) _renderPdfPage(cur-1);
  });
  el.querySelector('.bi-pgnext').addEventListener('click', e=>{
    e.stopPropagation();
    const cur = parseInt(el.dataset.page)||1;
    if(cur<pdfDoc.numPages) _renderPdfPage(cur+1);
  });

  el.querySelector('.bi-close').addEventListener('click',  ()=>{ el.remove(); toast('info','تم الحذف'); });
  el.querySelector('.bi-burn').addEventListener('click',   ()=>{ commitBoardItemToCanvas(el); });
  el.querySelector('.bi-burn-sm').addEventListener('click', ()=>{ commitBoardItemToCanvas(el); });

  makeBoardItemInteractive(el);
  _boardItemFocus(el);
  return el;
}

/* تفعيل السحب من الشريط العلوي + التحجيم من 8 مقابض + تحديد العنصر
   يستخدم مستمع document واحد مشترك لكل العناصر (بدون تكرار) */
const _boardDragState = {el:null, mode:null, sx:0, sy:0, ox:0, oy:0, ow:0, oh:0};

function _boardDragStart(el, mode, e){
  if(e.button!==undefined && e.button!==0) return;
  const p = _boardPt(e);
  _boardDragState.el = el;
  _boardDragState.mode = mode;
  _boardDragState.sx = p.x; _boardDragState.sy = p.y;
  _boardDragState.ox = el.offsetLeft; _boardDragState.oy = el.offsetTop;
  if(mode!=='drag'){
    _boardDragState.ow = el.offsetWidth; _boardDragState.oh = el.offsetHeight;
  }
  _boardItemFocus(el);
  e.preventDefault(); e.stopPropagation();
}
function _boardDragMove(e){
  const s = _boardDragState;
  if(!s.el || !s.mode) return;
  const p = _boardPt(e);
  const dx = p.x - s.sx, dy = p.y - s.sy;
  const wrap = document.getElementById('canvasWrap');
  const wr = wrap.getBoundingClientRect();
  const el = s.el;
  const minW = 120, minH = 90;

  if(s.mode==='drag'){
    let nx = s.ox + dx, ny = s.oy + dy;
    nx = _clamp(nx, -el.offsetWidth*0.5,  wr.width  - el.offsetWidth*0.5);
    ny = _clamp(ny, 0,                     wr.height - 40);
    el.style.left = nx + 'px';
    el.style.top  = ny + 'px';
  } else {
    const dir = s.mode;  // e.g. 'nw', 'se', 'e', 's'
    let nx = s.ox, ny = s.oy, nw = s.ow, nh = s.oh;
    if(dir.includes('e')) nw = Math.max(minW, s.ow + dx);
    if(dir.includes('s')) nh = Math.max(minH, s.oh + dy);
    if(dir.includes('w')){ nw = Math.max(minW, s.ow - dx); nx = s.ox + (s.ow - nw); }
    if(dir.includes('n')){ nh = Math.max(minH, s.oh - dy); ny = s.oy + (s.oh - nh); }
    el.style.left = nx + 'px';
    el.style.top  = ny + 'px';
    el.style.width  = nw + 'px';
    el.style.height = nh + 'px';
    // أعد رسم صفحة PDF بالحجم الجديد (مع debounce بسيط لتفادي رسم متكرر)
    if(el.dataset.kind==='pdf' && el._renderPdfPage){
      if(el._rzTimer) clearTimeout(el._rzTimer);
      el._rzTimer = setTimeout(()=>{
        el._renderPdfPage(parseInt(el.dataset.page)||1);
        _updateZoomLabel(el);
      }, 60);
    } else {
      _updateZoomLabel(el);
    }
  }
  e.preventDefault();
}
function _boardDragEnd(){
  const s = _boardDragState;
  if(!s.el) return;
  s.el = null; s.mode = null;
}
function _boardPt(e){
  if(e.touches && e.touches[0]) return {x:e.touches[0].clientX, y:e.touches[0].clientY};
  return {x:e.clientX, y:e.clientY};
}

/* يثبّت المستمعين العامّين مرة واحدة فقط */
function _ensureBoardDragListeners(){
  if(_boardDragState._installed) return;
  _boardDragState._installed = true;
  document.addEventListener('mousemove',  _boardDragMove);
  document.addEventListener('touchmove',  _boardDragMove, {passive:false});
  document.addEventListener('mouseup',    _boardDragEnd);
  document.addEventListener('touchend',   _boardDragEnd);
  document.addEventListener('touchcancel',_boardDragEnd);
}

function makeBoardItemInteractive(el){
  _ensureBoardDragListeners();
  const head = el.querySelector('.bi-head');

  head.addEventListener('mousedown',  e=>_boardDragStart(el, 'drag', e));
  head.addEventListener('touchstart', e=>_boardDragStart(el, 'drag', e), {passive:false});
  el.querySelectorAll('.bi-handle').forEach(h=>{
    const dirs = h.className.split(' ').filter(c=>c.startsWith('h-') && c!=='bi-handle').map(c=>c.slice(2)).join('');
    h.addEventListener('mousedown',  e=>_boardDragStart(el, dirs, e));
    h.addEventListener('touchstart', e=>_boardDragStart(el, dirs, e), {passive:false});
  });

  // أزرار شريط التحجيم السريع
  const zb = el.querySelector('.bi-zoombar');
  if(zb){
    zb.querySelector('.bi-zm-in').addEventListener('click', e=>{e.stopPropagation(); _boardItemZoom(el, +1.18);});
    zb.querySelector('.bi-zm-out').addEventListener('click', e=>{e.stopPropagation(); _boardItemZoom(el, 1/1.18);});
    zb.querySelector('.bi-zm-rst').addEventListener('click', e=>{e.stopPropagation(); _boardItemZoomReset(el);});
    zb.querySelector('.bi-zm-fit').addEventListener('click', e=>{e.stopPropagation(); _boardItemZoomFit(el);});
    // امنع السحب عند بدء الضغط على شريط التحجيم
    zb.addEventListener('mousedown',  e=>e.stopPropagation());
    zb.addEventListener('touchstart', e=>e.stopPropagation(), {passive:false});
  }

  // عند الضغط على العنصر (وليس الشريط أو الأزرار) حدّديه — مع إيقاف الفقاعة حتى لا تُرسم على السبورة
  el.addEventListener('mousedown', e=>{
    if(e.target.closest('.bi-head') || e.target.closest('.bi-foot') || e.target.closest('.bi-zoombar') || e.target.classList.contains('bi-handle')) return;
    _boardItemFocus(el);
    e.stopPropagation();
  });
  // أوقف الفقاعة على الكلك بصرف النظر
  el.addEventListener('click',     e=>e.stopPropagation());
  el.addEventListener('dblclick',  e=>e.stopPropagation());
  el.addEventListener('contextmenu', e=>e.stopPropagation());
  // عند بدء اللمس على العنصر، امنع الـ canvas من التقاطه
  el.addEventListener('touchstart', e=>{ if(!e.target.closest('.bi-pgctrl button') && !e.target.closest('.bi-head') && !e.target.classList.contains('bi-handle')) e.stopPropagation(); }, {passive:false});

  // دعم اختصارات لوحة المفاتيح للعنصر المحدّد
  el.addEventListener('keydown', e=>{
    if(!el.classList.contains('is-selected')) return;
    const step = e.shiftKey ? 20 : 5;
    let handled = true;
    if(e.key==='+' || e.key==='=' ) _boardItemZoom(el, 1.15);
    else if(e.key==='-' || e.key==='_') _boardItemZoom(el, 1/1.15);
    else if(e.key==='0') _boardItemZoomReset(el);
    else if(e.key==='ArrowLeft')  el.style.left = (el.offsetLeft - step) + 'px';
    else if(e.key==='ArrowRight') el.style.left = (el.offsetLeft + step) + 'px';
    else if(e.key==='ArrowUp')    el.style.top  = (el.offsetTop  - step) + 'px';
    else if(e.key==='ArrowDown')  el.style.top  = (el.offsetTop  + step) + 'px';
    else if(e.key==='Delete' || e.key==='Backspace'){ el.remove(); _refreshBoardItemsPanel(); toast('info','تم الحذف'); }
    else handled = false;
    if(handled){ e.preventDefault(); e.stopPropagation(); }
  });
  el.setAttribute('tabindex','-1');
}

/* تكبير/تصغير نسبي مع تثبيت المركز (المقابل للمقبض h-se) */
function _boardItemZoom(el, factor){
  if(!el || !el._origW) el._origW = el.offsetWidth;
  if(!el._origH) el._origH = el.offsetHeight;
  const newW = Math.max(120, Math.round(el.offsetWidth * factor));
  const newH = Math.max(90,  Math.round(el.offsetHeight * factor));
  // ثبّت الزاوية اليسرى العليا
  el.style.width  = newW + 'px';
  el.style.height = newH + 'px';
  if(el.dataset.kind==='pdf' && el._renderPdfPage){
    el._renderPdfPage(parseInt(el.dataset.page)||1);
  }
  _updateZoomLabel(el);
}

/* إعادة للحجم الأصلي */
function _boardItemZoomReset(el){
  if(!el._origW) el._origW = el.offsetWidth;
  if(!el._origH) el._origH = el.offsetHeight;
  el.style.width  = el._origW + 'px';
  el.style.height = el._origH + 'px';
  if(el.dataset.kind==='pdf' && el._renderPdfPage){
    el._renderPdfPage(parseInt(el.dataset.page)||1);
  }
  _updateZoomLabel(el);
}

/* ملاءمة للمشهد (لوحة الرسم) */
function _boardItemZoomFit(el){
  const wrap = document.getElementById('canvasWrap');
  if(!wrap) return;
  const wr = wrap.getBoundingClientRect();
  const ar = (el._origW||el.offsetWidth) / (el._origH||el.offsetHeight);
  const margin = 0.78;
  let nw = wr.width * margin, nh = nw / ar;
  if(nh > wr.height * margin){ nh = wr.height * margin; nw = nh * ar; }
  el.style.width  = Math.round(nw) + 'px';
  el.style.height = Math.round(nh) + 'px';
  // توسيط
  el.style.left = Math.round((wr.width  - el.offsetWidth)/2) + 'px';
  el.style.top  = Math.round((wr.height - el.offsetHeight)/2) + 'px';
  if(el.dataset.kind==='pdf' && el._renderPdfPage){
    el._renderPdfPage(parseInt(el.dataset.page)||1);
  }
  _updateZoomLabel(el);
}

function _updateZoomLabel(el){
  const v = el.querySelector('.bi-zoom-val');
  if(!v) return;
  const base = el._origW || el.offsetWidth;
  if(!base) return;
  const pct = Math.round((el.offsetWidth / base) * 100);
  v.textContent = pct + '%';
}

/* دليل توضيحي عائم يظهر عند أول إضافة PDF للسبورة */
function _showPdfBoardHint(el){
  // لا نُظهر الدليل إلا مرة واحدة لكل عنصر PDF
  if(el._hintShown) return;
  el._hintShown = true;
  const hint = document.createElement('div');
  hint.className = 'pdf-board-hint';
  hint.innerHTML = `
    <button class="pbtn-close" type="button" aria-label="إغلاق"><i class="fas fa-times"></i></button>
    <div class="pbtn-title"><i class="fas fa-magic"></i> PDF قابل للتحريك والتحجيم</div>
    <div class="pbtn-row"><i class="fas fa-arrows-alt"></i> اسحبي <b>الشريط الأزرق</b> لتحريك الصفحة</div>
    <div class="pbtn-row"><i class="fas fa-expand-arrows-alt"></i> اسحبي <b>المقابض الصفراء</b> (8 مقابض) للتحجيم</div>
    <div class="pbtn-row"><i class="fas fa-search-plus"></i> استخدمي <b>شريط التكبير</b> أو مفاتيح <b>+ / -</b></div>
    <div class="pbtn-row"><i class="fas fa-check" style="color:#27ae60"></i> اضغطي <b>تثبيت</b> لدمجها في الرسم</div>
  `;
  // ضع الدليل فوق العنصر بقليل
  el.appendChild(hint);
  const rect = el.getBoundingClientRect();
  hint.style.right = '20px';
  hint.style.top   = '40px';
  // إغلاق الدليل
  const close = ()=>{ hint.style.transition='opacity .25s, transform .25s'; hint.style.opacity='0'; hint.style.transform='translateY(-6px)'; setTimeout(()=>hint.remove(), 280); };
  hint.querySelector('.pbtn-close').addEventListener('click', close);
  // إغلاق تلقائي بعد 8 ثوانٍ
  setTimeout(close, 8000);
}

/* الضغط على السبورة (خارج أي عنصر) يلغي التحديد */
document.addEventListener('mousedown', e=>{
  if(e.target.closest('.board-item')) return;
  // إذا كان النقرة على الـ canvas نفسه
  if(e.target === canvas || e.target === canvasWrap || e.target === mindmapCanvas){
    document.querySelectorAll('.board-item.is-selected').forEach(el=>el.classList.remove('is-selected'));
  }
});

/* لوحة عائمة سريعة لتثبيت كل العناصر المؤقتة (تظهر فقط عند وجود عناصر) */
function _ensureBoardItemsPanel(){
  let p = document.getElementById('boardItemsPanel');
  if(p) return p;
  p = document.createElement('div');
  p.id = 'boardItemsPanel';
  p.style.cssText = 'position:fixed;bottom:88px;left:14px;z-index:700;display:flex;flex-direction:column;gap:6px;background:rgba(15,52,96,.94);color:#fff;padding:8px 10px;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.25);font-family:Tajawal,sans-serif;font-size:.78rem;border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(6px)';
  p.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;font-weight:800">
      <i class="fas fa-layer-group" style="color:#f9d423"></i>
      <span>عناصر مؤقتة على السبورة: <b id="biCount" style="color:#f9d423">0</b></span>
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">
      <button id="biBurnAll" style="background:rgba(39,174,96,.92);color:#fff;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:800;font-size:.72rem;display:inline-flex;align-items:center;gap:4px"><i class="fas fa-check-double"></i> تثبيت الكل في السبورة</button>
      <button id="biClearAll" style="background:rgba(231,76,60,.85);color:#fff;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;font-family:inherit;font-weight:700;font-size:.72rem;display:inline-flex;align-items:center;gap:4px"><i class="fas fa-trash"></i> مسح الكل</button>
    </div>
  `;
  document.body.appendChild(p);
  p.querySelector('#biBurnAll').addEventListener('click', commitAllBoardItemsToCanvas);
  p.querySelector('#biClearAll').addEventListener('click', clearAllBoardItems);
  return p;
}
function _refreshBoardItemsPanel(){
  const p = _ensureBoardItemsPanel();
  const n = document.querySelectorAll('.board-item').length;
  p.querySelector('#biCount').textContent = n;
  p.style.display = n>0 ? 'flex' : 'none';
}

/* راقب تغييرات عناصر السبورة لتحديث اللوحة العائمة */
function _startBoardItemsWatcher(){
  const wrap = document.getElementById('canvasWrap');
  if(!wrap || wrap._biWatch) return;
  wrap._biWatch = true;
  const obs = new MutationObserver(_refreshBoardItemsPanel);
  obs.observe(wrap, {childList:true, subtree:true});
  _refreshBoardItemsPanel();
}

/* تثبيت عنصر في السبورة (حرق في الرسم) — يرسم المحتوى في موضعه الحالي ثم يحذف العنصر */
function commitBoardItemToCanvas(el){
  if(!el) return;
  const wrap = document.getElementById('canvasWrap');
  const wr = wrap.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  // الإحداثيات المنطقية داخل الـ canvas
  const dpr = window.devicePixelRatio || 1;
  const x = (elRect.left - wr.left);
  const y = (elRect.top  - wr.top);
  const w = elRect.width;
  const h = elRect.height;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if(el.dataset.kind === 'pdf'){
    // ارسم canvas الداخلي
    const cvs = el.querySelector('canvas');
    if(cvs && cvs.width>0){
      ctx.drawImage(cvs, x, y, w, h);
    }
    toast('success','✅ تم تثبيت صفحة PDF في السبورة');
  } else if(el.dataset.kind === 'mindmap'){
    // الخريطة الذهنية: حوّل الـ SVG إلى صورة ثم ارسمها على الكانفس
    const svg = el.querySelector('.mindmap-bi-body svg');
    if(svg){
      try{
        const xml = new XMLSerializer().serializeToString(svg);
        const svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
        const img = new Image();
        img.onload = ()=>{
          ctx.drawImage(img, x, y, w, h);
          el.remove();
          saveHistory();
        };
        img.onerror = ()=>{
          // fallback: ارسم إطار بسيط
          ctx.fillStyle='#fff';ctx.fillRect(x,y,w,h);
          ctx.strokeStyle='#1a5f7a';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);
          el.remove();saveHistory();
        };
        img.src = svg64;
        ctx.restore();
        return; // الإزالة والتاريخ يتمان داخل onload
      }catch(e){
        ctx.fillStyle='#fff';ctx.fillRect(x,y,w,h);
        ctx.strokeStyle='#1a5f7a';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);
        toast('error','تعذر تثبيت الخريطة');
      }
    } else {
      ctx.fillStyle='#fff';ctx.fillRect(x,y,w,h);
      ctx.strokeStyle='#1a5f7a';ctx.lineWidth=2;ctx.strokeRect(x,y,w,h);
    }
  } else {
    // صور (لقطة فيديو / صورة عادية)
    const img = el.querySelector('img');
    if(img && img.complete && img.naturalWidth>0){
      ctx.drawImage(img, x, y, w, h);
    } else if(img){
      img.onload = ()=>{
        ctx.drawImage(img, x, y, w, h);
        saveHistory();
      };
      el.remove();
      return;
    }
    toast('success','✅ تم تثبيت الصورة في السبورة');
  }
  ctx.restore();
  el.remove();
  saveHistory();
}

/* تثبيت كل عناصر السبورة دفعة واحدة (مفيد قبل التصدير أو الحفظ) */
function commitAllBoardItemsToCanvas(){
  const items = document.querySelectorAll('.board-item');
  if(!items.length){ toast('info','لا توجد عناصر للتثبيت'); return; }
  items.forEach(commitBoardItemToCanvas);
}

/* مسح كل عناصر السبورة دون تثبيت */
function clearAllBoardItems(){
  const items = document.querySelectorAll('.board-item');
  if(!items.length) return;
  items.forEach(e=>e.remove());
  toast('info','تم مسح كل العناصر المؤقتة');
}


/* ============================================================
   ⭐⭐⭐ EXCELLENCE CUP - كأس التفوق على السبورة ⭐⭐⭐
   - لوحة أبطال تفاعلية قابلة للسحب والتحجيم على السبورة
   - تعرض أفضل 3 طالبات على منصة تتويج
   - أزرار سريعة لمنح نقاط تشجيعية (إيجابية/سلبية)
   - يحتفل مع البطل/ة عند كل تكريم + رسائل تشجيعية
   - يحدّث تلقائياً عند أي تعديل على نقاط الطالبات
   ============================================================ */
let _cupItemCounter = 0;  // لتتبع عدد أكواب التفوق على السبورة

function createBoardExcellenceCup(opts){
  opts = opts || {};
  const wrap = document.getElementById('canvasWrap');
  if(!wrap){ toast('error','السبورة غير متاحة'); return null; }

  // منع إنشاء أكثر من كأس في الوقت نفسه (يمكن تعليق هذا للسماح بأكثر من واحد)
  if(!opts.allowMultiple){
    const existing = wrap.querySelectorAll('.cup-board-item');
    if(existing.length){
      // أبرز الكأس الموجود بدلًا من إنشاء واحد جديد
      existing.forEach(e=>{ e.classList.add('is-selected'); e.style.zIndex = ++_boardItemZ; });
      toast('info','🥇 كأس التفوق مفتوح بالفعل على السبورة');
      return existing[0];
    }
  }

  const wrapRect = wrap.getBoundingClientRect();
  const w = opts.width  || 360;
  const h = opts.height || 460;
  const startX = opts.x !== undefined ? opts.x : (wrapRect.width/2  - w/2);
  const startY = opts.y !== undefined ? opts.y : (wrapRect.height/2 - h/2);

  const el = document.createElement('div');
  el.className = 'board-item cup-board-item';
  el.style.left   = _clamp(startX, 0, Math.max(0, wrapRect.width  - w)) + 'px';
  el.style.top    = _clamp(startY, 0, Math.max(0, wrapRect.height - h)) + 'px';
  el.style.width  = w + 'px';
  el.style.height = h + 'px';
  el.dataset.kind = 'excellence-cup';
  el.dataset.title = 'كأس التفوق';
  el.dataset.cupId = String(++_cupItemCounter);

  el.innerHTML = `
    <div class="bi-head">
      <span class="bi-title"><i class="fas fa-trophy"></i> كأس التفوق</span>
      <span class="bi-pg" style="background:rgba(58,42,0,.25);color:#3a2a00">🏆 على السبورة</span>
      <button class="bi-burn" title="تثبيت كأس التفوق في السبورة (تحويل لجزء من الرسم)"><i class="fas fa-check"></i></button>
      <button class="bi-close" title="إغلاق الكأس"><i class="fas fa-times"></i></button>
    </div>
    <div class="bi-zoombar">
      <button class="bi-zm-out" title="تصغير"><i class="fas fa-search-minus"></i></button>
      <span class="bi-zoom-val">100%</span>
      <button class="bi-zm-in" title="تكبير"><i class="fas fa-search-plus"></i></button>
      <span class="bi-zoom-sep"></span>
      <button class="bi-zm-fit" title="ملاءمة"><i class="fas fa-expand"></i></button>
      <button class="bi-zm-rst" title="الحجم الأصلي"><i class="fas fa-redo"></i></button>
    </div>
    <div class="cup-body" id="cupBody-${el.dataset.cupId}">
      <div class="cup-header">
        <div class="cup-trophy-big">🏆</div>
        <div class="cup-title">كأس التفوق</div>
      </div>
      <div class="cup-total-row">
        <span class="ctr-label">إجمالي نقاط الفصل:</span>
        <span class="ctr-num" data-cup-total>0</span>
        <span style="font-size:1.05rem">⭐</span>
      </div>
      <div class="cup-podium" data-cup-podium>
        <!-- يتم ملؤه ديناميكياً -->
      </div>
      <div class="cup-students-list">
        <div class="cup-students-list-title">
          <i class="fas fa-users" style="color:#b8860b"></i>
          <span>طالبات الفصل</span>
        </div>
        <div data-cup-students>
          <!-- يتم ملؤه ديناميكياً -->
        </div>
      </div>
      <div class="cup-foot-actions">
        <button class="cup-celebrate" data-cup-celebrate>
          <i class="fas fa-party-popper"></i> احتفال!
        </button>
        <button data-cup-pick>
          <i class="fas fa-bullseye"></i> اختيار طالبة
        </button>
        <button data-cup-reset-month>
          <i class="fas fa-undo"></i> تصفير
        </button>
      </div>
    </div>
    <div class="bi-foot">
      <span class="bi-info"><i class="fas fa-hand-pointer"></i> اسحبي الكأس — كبّري/صغّري — اضغطي + لمنح نقاط</span>
      <span class="bi-actions">
        <button class="bi-burn-sm" title="تثبيت في السبورة"><i class="fas fa-check"></i> تثبيت</button>
      </span>
    </div>
    <div class="bi-handle h-nw"></div>
    <div class="bi-handle h-n"></div>
    <div class="bi-handle h-ne"></div>
    <div class="bi-handle h-w"></div>
    <div class="bi-handle h-e"></div>
    <div class="bi-handle h-sw"></div>
    <div class="bi-handle h-s"></div>
    <div class="bi-handle h-se"></div>
  `;
  wrap.appendChild(el);

  // تخزين الأبعاد الأصلية
  el._origW = w;
  el._origH = h;

  // ربط الأحداث
  el.querySelector('.bi-close').addEventListener('click', ()=>{ el.remove(); toast('info','تم إغلاق كأس التفوق'); });
  el.querySelector('.bi-burn').addEventListener('click',  ()=>{ commitBoardItemToCanvas(el); });
  el.querySelector('.bi-burn-sm').addEventListener('click',()=>{ commitBoardItemToCanvas(el); });

  // أزرار الكأس
  el.querySelector('[data-cup-celebrate]').addEventListener('click', ()=>{
    if(typeof launchFullCelebration === 'function'){
      launchFullCelebration();
      toast('success','🎉🎊🎉 يحيا التفوق!');
    }
  });
  el.querySelector('[data-cup-pick]').addEventListener('click', ()=>{
    if(typeof openRandomPicker === 'function'){ openRandomPicker(); }
  });
  el.querySelector('[data-cup-reset-month]').addEventListener('click', async ()=>{
    if(!Data || !Data.students) return;
    if(typeof customConfirm === 'function' && !await customConfirm('هل تريدين تصفير نقاط جميع الطالبات؟ هذا الإجراء لا يمكن التراجع عنه.',{title:'⚠️ تصفير النقاط',danger:true,okText:'نعم، صفّري'})) return;
    if(!customConfirm && !confirm('هل تريدين تصفير نقاط جميع الطالبات؟')) return;
    Data.students.forEach(s=>{ s.points = 0; });
    Data.behavior = [];
    if(typeof saveData === 'function') saveData();
    if(typeof renderBehavior === 'function') renderBehavior();
    if(typeof updateAnalytics === 'function') updateAnalytics();
    _cupRenderAll();
    toast('success','✅ تم تصفير النقاط');
  });

  // عرض المحتوى
  _cupRender(el);

  // عند تغيير حجم العنصر → أعد العرض
  let _cupResizeT = null;
  const ro = new ResizeObserver(()=>{
    clearTimeout(_cupResizeT);
    _cupResizeT = setTimeout(()=>_cupRender(el), 80);
  });
  ro.observe(el);

  // تفاعلية السحب/التحجيم
  makeBoardItemInteractive(el);
  _boardItemFocus(el);

  // تحديث تلقائي دوري (كل 3 ثوان) لمزامنة النقاط من لوحة السلوك
  const _cupInterval = setInterval(()=>{
    if(!el.isConnected){ clearInterval(_cupInterval); return; }
    _cupRender(el, true);  // true = تحديث هادئ بدون احتفال
  }, 3000);
  el._cupInterval = _cupInterval;

  // احتفال عند الظهور لأول مرة
  setTimeout(()=>{
    if(el.isConnected && typeof launchConfettiRain === 'function'){
      launchConfettiRain();
    }
  }, 400);

  return el;
}

/* حساب الطالبات المرتبات (أعلى نقاط) */
function _cupGetRanked(){
  if(typeof Data === 'undefined' || !Data.students) return [];
  // فلترة حسب فصول المعلمة النشطة إن وُجدت
  let studs = Data.students;
  try{
    if(typeof classesForActiveTeacher === 'function'){
      const allowed = classesForActiveTeacher();
      if(allowed && allowed.length) studs = studs.filter(s => allowed.includes(s.class));
    }
  }catch(e){}
  return [...studs].sort((a,b)=>(b.points||0)-(a.points||0));
}

/* رسم/إعادة رسم محتوى كأس التفوق لعنصر معيّن */
function _cupRender(el, silent){
  if(!el || !el.isConnected) return;
  const id = el.dataset.cupId;
  const body = el.querySelector('.cup-body') || document.getElementById('cupBody-'+id);
  if(!body) return;
  const ranked = _cupGetRanked();
  const total = ranked.reduce((a,s)=>a+(s.points||0),0);
  const totalEl = body.querySelector('[data-cup-total]');
  if(totalEl) totalEl.textContent = total;

  // المنصة: أفضل 3
  const podium = body.querySelector('[data-cup-podium]');
  if(podium){
    // الترتيب: الثاني (يسار), الأول (وسط), الثالث (يمين)
    const slots = [
      {idx:1, klass:'second'},
      {idx:0, klass:'first'},
      {idx:2, klass:'third'},
    ];
    podium.innerHTML = slots.map(s=>{
      const stu = ranked[s.idx];
      if(!stu){
        return `<div class="cup-podium-spot">
          <div class="cup-spot">
            <div class="cup-rank ${s.klass}">${s.idx+1}</div>
            <div class="cup-avatar" style="opacity:.4">—</div>
            <div class="cup-spot-name ${s.klass}" style="opacity:.5">—</div>
          </div>
          <div class="cup-podium-block ${s.klass} empty">${s.idx+1}</div>
        </div>`;
      }
      const p = stu.points || 0;
      const isChampion = s.idx === 0;
      const rankClass = s.klass;
      const initial = (stu.name||'؟').trim().charAt(0) || '؟';
      const emoji = p > 0 ? '🌟' : (p < 0 ? '⚠️' : '⭐');
      return `<div class="cup-podium-spot">
        <div class="cup-spot${isChampion?' champion':''}">
          <div class="cup-rank ${rankClass}">${s.idx+1}</div>
          <div class="cup-avatar ${rankClass}">${escapeHtml(initial)}</div>
          <div class="cup-spot-name" title="${escapeHtml(stu.name)}">${escapeHtml(stu.name)}</div>
          <div class="cup-spot-score"><span>${p>0?'+':''}${p}</span> <span style="font-size:.85rem">${emoji}</span></div>
        </div>
        <div class="cup-podium-block ${rankClass}" title="${escapeHtml(stu.name)}">
          <span class="cpb-num">${s.idx+1}</span>
          <span class="cpb-name">${escapeHtml(stu.name)}</span>
        </div>
      </div>`;
    }).join('');
  }

  // قائمة الطالبات (أعلى 8 أو كلهن)
  const listEl = body.querySelector('[data-cup-students]');
  if(listEl){
    if(!ranked.length){
      listEl.innerHTML = '<div class="cup-empty">📭 أضيفي طالبات من اللوحة الجانبية أولاً</div>';
    } else {
      listEl.innerHTML = ranked.slice(0, 8).map((s,i)=>{
        const p = s.points || 0;
        const scoreClass = p < 0 ? 'neg' : '';
        return `<div class="cup-student-row" data-sid="${s.id}">
          <span class="csr-rank">${i+1}</span>
          <span class="csr-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
          <span class="csr-score ${scoreClass}">${p>0?'+':''}${p}</span>
          <span class="csr-btns">
            <button class="csr-pop" data-cup-action="custom" data-sid="${s.id}" title="تخصيص الجائزة">⭐</button>
            <button class="csr-plus" data-cup-action="plus" data-sid="${s.id}" title="+1 نقطة">+1</button>
            <button class="csr-minus" data-cup-action="minus" data-sid="${s.id}" title="-1 نقطة">−1</button>
          </span>
        </div>`;
      }).join('');

      // ربط أحداث النقر على الأزرار
      listEl.querySelectorAll('button[data-cup-action]').forEach(btn=>{
        btn.addEventListener('click', e=>{
          e.stopPropagation();
          const action = btn.dataset.cupAction;
          const sid = parseInt(btn.dataset.sid);
          _cupOnAction(el, sid, action, btn);
        });
      });
    }
  }
}

/* إعادة رسم كل أكواب التفوق على السبورة (تستخدم بعد تحديث البيانات) */
function _cupRenderAll(silent){
  document.querySelectorAll('.cup-board-item').forEach(el=>_cupRender(el, silent));
}

/* معالج إجراء على طالبة (إضافة/إنقاص نقطة) */
function _cupOnAction(cupEl, sid, action, btnEl){
  if(typeof Data === 'undefined') return;
  const stu = Data.students.find(x=>x.id===sid);
  if(!stu){ toast('error','لم يتم العثور على الطالبة'); return; }
  const prevPoints = stu.points || 0;

  if(action === 'plus' || action === 'minus'){
    const delta = action === 'plus' ? 1 : -1;
    const newPts = prevPoints + delta;
    _cupApplyPoint(cupEl, stu, newPts, delta, action === 'plus' ? 'تشجيع' : 'تنبيه', prevPoints);
  } else if(action === 'custom'){
    // نافذة تخصيص سريعة
    const input = prompt(`منح نقاط لـ "${stu.name}" — أدخلي قيمة النقاط (يمكن بالسالب، مثلاً: 5 أو -3):`);
    if(input === null) return;
    const n = parseInt(input);
    if(isNaN(n) || n === 0){ toast('warning','القيمة يجب أن تكون رقماً صحيحاً غير صفر'); return; }
    const newPts = prevPoints + n;
    _cupApplyPoint(cupEl, stu, newPts, n, n > 0 ? 'تشجيع' : 'تنبيه', prevPoints);
  }
}

/* تطبيق إضافة نقطة مع الاحتفال والتسجيل */
function _cupApplyPoint(cupEl, stu, newPts, delta, label, prevPoints){
  // تحديث البيانات
  stu.points = newPts;
  const pts = delta;  // عدد النقاط المضافة/المخصومة
  if(typeof Data !== 'undefined' && Data.behavior){
    Data.behavior.push({
      id: Date.now(),
      studentId: stu.id,
      points: pts,
      category: 'كأس التفوق',
      label: label,
      createdAt: new Date().toISOString()
    });
  }
  if(typeof saveData === 'function') saveData();
  if(typeof renderBehavior === 'function') renderBehavior();
  if(typeof updateAnalytics === 'function') updateAnalytics();

  // إعادة رسم الكأس
  _cupRender(cupEl);

  // تأثير اهتزاز/تمييز الصف
  const row = cupEl.querySelector(`[data-sid="${stu.id}"]`);
  if(row){
    const scoreEl = row.querySelector('.csr-score');
    if(scoreEl){
      scoreEl.classList.remove('cup-score-bump');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('cup-score-bump');
    }
  }

  // جسيمات + احتفال
  if(delta > 0){
    if(typeof launchApplause === 'function' && Math.random() > 0.5) launchApplause();
    if(typeof placeStamp === 'function'){
      try{ placeStamp('⭐', null); }catch(e){}
    }
    toast('success',`⭐ ${stu.name}: +${pts} نقطة${label?' — '+label:''}`);
  } else {
    if(typeof placeStamp === 'function'){
      try{ placeStamp('⚠️', null); }catch(e){}
    }
    toast('warning',`${stu.name}: ${pts} نقطة`);
  }

  // عند تجاوز عتبة (10, 25, 50, 100) — احتفال أكبر
  const milestones = [10, 25, 50, 100, 200];
  for(const m of milestones){
    if(prevPoints < m && newPts >= m){
      _cupMilestoneCelebrate(cupEl, stu, m);
      break;
    }
  }
}

/* احتفال عند تجاوز عتبة نقاط */
function _cupMilestoneCelebrate(cupEl, stu, milestone){
  // تأثير وميض داخل الكأس
  const flash = document.createElement('div');
  flash.className = 'cup-milestone-flash';
  cupEl.querySelector('.cup-body').appendChild(flash);
  setTimeout(()=>flash.remove(), 1300);

  // احتفال شامل
  if(typeof launchFullCelebration === 'function') launchFullCelebration();
  if(typeof launchConfettiRain === 'function') launchConfettiRain();
  if(typeof launchFireworks === 'function') launchFireworks(5);

  setTimeout(()=>{
    toast('success',`🎉 ${stu.name} تجاوز ${milestone} نقطة! عمل بطولي! 🏆`, 5000);
  }, 300);
}

/* فتح كأس التفوق (تُستدعى من الزر في شريط الاحتفالات) */
function openExcellenceCup(){
  const el = createBoardExcellenceCup();
  if(el){
    // تحديث فوري للبيانات
    _cupRender(el);
  }
}

/* ============================================================
   GOOGLE MAPS (interactive embed)
   ============================================================ */
let gmapCurrentQ = "مدرسة المعرفة الثانوية";
let gmapZoomLevel = 12;
let gmapMapType = "roadmap";   // roadmap | satellite
let gmapSatellite = false;
let gmapHistory = ["مدرسة المعرفة الثانوية"];

function _gmapBuildUrl(q, zoom, typeStr){
  const enc = encodeURIComponent(q);
  const t = typeStr === "satellite" ? "k" : "m";
  // استخدام نمط embed بدون مفتاح — خرائط جوجل التفاعلية
  return "https://maps.google.com/maps?q=" + enc + "&t=" + t + "&z=" + zoom + "&ie=UTF8&iwloc=&output=embed";
}
function _gmapSetLabel(q){
  const el = document.getElementById("gmapCurrentLabel");
  if(el) el.textContent = q;
}
function _gmapShowLoading(){
  const ld = document.getElementById("gmapLoading");
  if(ld){ ld.classList.remove("hide"); setTimeout(()=>{ ld.classList.add("hide"); }, 800); }
}
function gmapSearch(){
  const input = document.getElementById("gmapSearchInput");
  if(!input) return;
  const q = input.value.trim();
  if(!q){ toast("error","اكتبي اسم مكان للبحث"); return; }
  gmapLoad(q, 12);
}
function gmapPreset(btn, q){
  document.querySelectorAll(".gmap-preset-btn").forEach(b => b.classList.remove("active"));
  if(btn) btn.classList.add("active");
  gmapLoad(q, 12);
}
function gmapLoad(q, zoom){
  zoom = zoom || gmapZoomLevel;
  gmapCurrentQ = q;
  gmapZoomLevel = zoom;
  gmapHistory.push(q);
  if(gmapHistory.length > 12) gmapHistory.shift();
  _gmapSetLabel(q);
  _gmapShowLoading();
  const frame = document.getElementById("gmapFrame");
  if(frame){
    frame.src = _gmapBuildUrl(q, zoom, gmapSatellite ? "satellite" : "roadmap");
  }
  const input = document.getElementById("gmapSearchInput");
  if(input) input.value = q;
}
function gmapZoomIn(){
  gmapZoomLevel = Math.min(20, gmapZoomLevel + 1);
  gmapLoad(gmapCurrentQ, gmapZoomLevel);
}
function gmapZoomOut(){
  gmapZoomLevel = Math.max(2, gmapZoomLevel - 1);
  gmapLoad(gmapCurrentQ, gmapZoomLevel);
}
function gmapResetView(){
  gmapZoomLevel = 12;
  gmapLoad(gmapCurrentQ, 12);
}
function gmapToggleType(){
  gmapSatellite = !gmapSatellite;
  const btn = document.getElementById("gmapTypeBtn");
  if(btn){
    btn.innerHTML = gmapSatellite ? '<i class="fas fa-map"></i>' : '<i class="fas fa-layer-group"></i>';
    btn.title = gmapSatellite ? "الخريطة العادية" : "القمر الصناعي";
  }
  gmapLoad(gmapCurrentQ, gmapZoomLevel);
  toast("info", gmapSatellite ? "وضع القمر الصناعي" : "وضع الخريطة العادية");
}
function gmapOpenNewTab(){
  const url = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(gmapCurrentQ);
  window.open(url, "_blank");
}
function gmapMyLocation(){
  if(!navigator.geolocation){
    toast("error", "الموقع الجغرافي غير مدعوم في هذا المتصفح");
    return;
  }
  toast("info", "جاري تحديد موقعك...");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      const q = lat + ", " + lng;
      gmapLoad(q, 15);
      toast("success", "تم تحديد موقعك بنجاح");
    },
    (err) => {
      toast("error", "تعذر تحديد الموقع: " + (err.message || "خطأ غير معروف"));
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}
function openMapModal(){
  openModal("modalMap");
  // تحميل الخريطة عند فتح النافذة أول مرة فقط
  const frame = document.getElementById("gmapFrame");
  if(frame && !frame.dataset.loaded){
    gmapLoad("مدرسة المعرفة الثانوية", 12);
    frame.dataset.loaded = "1";
  }
}
function captureMap(){
  // إضافة بطاقة تعريف بالمكان الحالي على السبورة
  const q = gmapCurrentQ;
  const url = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  const fs = parseInt(Data.settings.fontSize) || 20;
  ctx.save();
  // خلفية البطاقة
  const padding = 18;
  const cardW = 480;
  const cardH = 110;
  const dpr = window.devicePixelRatio || 1;
  const x0 = (canvas.width/dpr - cardW) / 2;
  const y0 = (canvas.height/dpr - cardH) / 2;
  // ظل
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = "white";
  _roundRect(ctx, x0, y0, cardW, cardH, 14);
  ctx.fill();
  ctx.shadowColor = "transparent";
  // خط ملون أعلى
  const grad = ctx.createLinearGradient(x0, y0, x0 + cardW, y0);
  grad.addColorStop(0, "#1a5f7a");
  grad.addColorStop(1, "#16a085");
  ctx.fillStyle = grad;
  _roundRectTop(ctx, x0, y0, cardW, 8, 14);
  ctx.fill();
  // أيقونة دبوس
  ctx.fillStyle = "#e74c3c";
  ctx.beginPath();
  ctx.arc(x0 + 32, y0 + 52, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(x0 + 32, y0 + 52, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.moveTo(x0 + 22, y0 + 50);
  ctx.lineTo(x0 + 32, y0 + 70);
  ctx.lineTo(x0 + 42, y0 + 50);
  ctx.closePath();
  ctx.fill();
  // العنوان
  ctx.fillStyle = "#0f3460";
  ctx.font = "bold " + (fs * 1.1) + "px Tajawal, sans-serif";
  ctx.textBaseline = "top";
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.fillText("📍 " + q, x0 + cardW - padding, y0 + 28);
  // الرابط
  ctx.fillStyle = "#666";
  ctx.font = (fs * 0.65) + "px Tajawal, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("خرائط جوجل التفاعلية", x0 + cardW - padding, y0 + 62);
  // المستوى
  ctx.fillStyle = "#1a5f7a";
  ctx.font = "bold " + (fs * 0.6) + "px Tajawal, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("مستوى التكبير: " + gmapZoomLevel, x0 + padding, y0 + 88);
  ctx.restore();
  saveHistory();
  closeModal("modalMap");
  toast("success", "تم إضافة الموقع للسبورة: " + q);
}
function _roundRect(c, x, y, w, h, r){
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function _roundRectTop(c, x, y, w, h, r){
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.lineTo(x + w, y + h);
  c.lineTo(x, y + h);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
}
// مهام قديمة محفوظة لتفادي كسر النداءات
function switchMapTab(t){ /* deprecated */ }
function mapZoomIn(){ gmapZoomIn(); }
function mapZoomOut(){ gmapZoomOut(); }
function mapReset(){ gmapResetView(); }
function mapToggleLabels(){ gmapToggleType(); }
function mapTogglePen(){ toast("info","استخدمي قلم السبورة الرئيسي للكتابة على الخريطة"); }
function mapClearPen(){ /* deprecated */ }
function mapPenColorPicker(){ /* deprecated */ }
function setupMapInteraction(){ /* deprecated */ }
function applyMapTransform(){ /* deprecated */ }
function updateMapZoomInfo(){ /* deprecated */ }
function showMapInfo(){ /* deprecated */ }
function setupMapPen(){ /* deprecated */ }
function redrawMapPen(){ /* deprecated */ }

/* ============================================================
   LIVE SESSION
   ============================================================ */
let liveChannel=null;
let liveQuiz=null;
let _liveCorrectIdx=-1;
let _liveQType='mcq';
let liveQuestionQueue=[];   // مصفوفة الأسئلة المحضّرة قبل/اثناء البث
let liveQueueCurrentIdx=-1;  // مؤشر السؤال الذي يتم بثه حالياً
let _queuePersistKey='mar_liveQueue';

/* === ضعي الجلسة (واحد / الكل / بعض) === */
let liveSessionMode = 'all';   // 'single' | 'all' | 'subset'
let liveQueueSubset = [];      // مصفوفة مؤشرات الأسئلة المختارة (الأصلية في liveQuestionQueue)
let liveQueueSubsetPos = -1;    // مضعي السؤال الحالي داخل المجموعة الفرعية
let liveBroadcasting = false;   // هل الجلسة بدأت؟

/* === QUEUE: إدارة قائمة الأسئلة === */

function _loadQueueFromStorage(){
  try{ liveQuestionQueue = JSON.parse(localStorage.getItem(_queuePersistKey)||'[]')||[]; }catch(e){ liveQuestionQueue=[]; }
}
function _saveQueueToStorage(){
  try{ localStorage.setItem(_queuePersistKey, JSON.stringify(liveQuestionQueue)); }catch(e){}
}
function _queueTypeLabel(t){
  return t==='free'?'<i class="fas fa-keyboard"></i> نص حر':(t==='bank'?'<i class="fas fa-database"></i> بنك':'<i class="fas fa-list-ol"></i> اختاري');
}
function _queueShortTitle(t,max=55){
  if(!t) return '(بدون عنوان)';
  t = String(t).replace(/\s+/g,' ').trim();
  return t.length>max ? t.slice(0,max)+'…' : t;
}
function _renderQueueItem(q, idx, ctx){
  // ctx: 'setup' | 'active'
  const isBroadcasting = ctx==='active' && idx===liveQueueCurrentIdx;
  const optCount = (q.options||[]).length;
  const meta = [];
  meta.push(_queueTypeLabel(q.qType||'mcq'));
  if(optCount>0) meta.push(`<span><i class="fas fa-list"></i> ${optCount} خيارات</span>`);
  if(q.fromBankId) meta.push('<span><i class="fas fa-bookmark"></i> بنك</span>');

  // هل ناعرضي خانة الاختاري (في ضعي subset وقسم الإعداد)؟
  const showChk = (ctx==='setup' && liveSessionMode==='subset');
  const inSubset = liveQueueSubset.includes(idx);
  const subsetClass = (showChk ? (inSubset ? 'subset-on' : 'subset-pending') : '');

  // في الجلسة النشطة: هل هذا السؤال ضمن المجموعة الفرعية؟
  const inActiveSubset = !liveBroadcasting
    || liveSessionMode==='single'
    || (liveSessionMode==='all')
    || (liveSessionMode==='subset' && liveQueueSubset.includes(idx));

  return `<div class="queue-item ${isBroadcasting?'broadcasting':''} ${subsetClass}" data-idx="${idx}">
    ${showChk ? `<input type="checkbox" class="qi-chk" ${inSubset?'checked':''} onchange="toggleQueueSubsetItem(${idx}, this.checked)" title="تضمين في الجلسة">` : ''}
    <div class="qi-num">${idx+1}</div>
    <div class="qi-content">
      <div class="qi-title" title="${escapeHtml(q.title||'')}">${escapeHtml(_queueShortTitle(q.title))}</div>
      <div class="qi-meta">${meta.join('')}</div>
    </div>
    <div class="qi-actions">
      ${ctx==='active' && inActiveSubset ? (isBroadcasting
        ? `<button class="success" disabled title="يبثّ حالياً"><i class="fas fa-broadcast-tower"></i></button>`
        : `<button onclick="broadcastQueueItem(${idx})" title="بث هذا السؤال"><i class="fas fa-play"></i></button>`
      ) : ''}
      <button onclick="moveQueueItem(${idx},-1)" title="رفع" ${idx===0?'disabled':''}><i class="fas fa-arrow-up"></i></button>
      <button onclick="moveQueueItem(${idx},1)" title="إنزال" ${idx===liveQuestionQueue.length-1?'disabled':''}><i class="fas fa-arrow-down"></i></button>
      <button onclick="editQueueItem(${idx})" title="تحميل في النموذج للعدلي"><i class="fas fa-pen"></i></button>
      <button class="danger" onclick="removeQueueItem(${idx})" title="احذفي"><i class="fas fa-times"></i></button>
    </div>
  </div>`;
}
function renderQueue(){
  // قائمة الإعداد
  const setupList = document.getElementById('queueSetupList');
  const setupCount = document.getElementById('queueSetupCount');
  const clearBtn = document.getElementById('queueClearBtn');
  const subsetInfo = document.getElementById('queueSetupSubsetInfo');
  const subsetSelected = document.getElementById('queueSubsetSelected');
  const bulkActions = document.getElementById('subsetBulkActions');
  if(setupList){
    if(!liveQuestionQueue.length){
      setupList.innerHTML = '<div class="queue-empty"><i class="fas fa-clipboard-list"></i>القائمة فارغة — أضيفي سؤالك من النموذج أعلاه أو من بنك الأسئلة</div>';
    } else {
      setupList.innerHTML = liveQuestionQueue.map((q,i)=>_renderQueueItem(q,i,'setup')).join('');
    }
  }
  if(setupCount) setupCount.textContent = liveQuestionQueue.length;
  if(clearBtn) clearBtn.style.display = liveQuestionQueue.length ? 'inline-flex' : 'none';
  // اعرضي معلومات احدّدي الفرعي
  if(subsetInfo){
    subsetInfo.style.display = (liveSessionMode==='subset' && liveQuestionQueue.length) ? 'inline' : 'none';
  }
  if(subsetSelected) subsetSelected.textContent = liveQueueSubset.length;
  if(bulkActions) bulkActions.style.display = (liveSessionMode==='subset' && liveQuestionQueue.length) ? 'flex' : 'none';
  // قائمة الجلسة النشطة
  const activeBox = document.getElementById('liveQueueCompact');
  const activeList = document.getElementById('queueActiveList');
  const activeCount = document.getElementById('queueActiveCount');
  if(activeBox){
    const showActiveQueue = liveBroadcasting && liveSessionMode!=='single';
    activeBox.style.display = (showActiveQueue && liveQuestionQueue.length) ? 'block' : 'none';
  }
  if(activeList && liveQuestionQueue.length && liveBroadcasting && liveSessionMode!=='single'){
    activeList.innerHTML = liveQuestionQueue.map((q,i)=>_renderQueueItem(q,i,'active')).join('');
  } else if(activeList) {
    activeList.innerHTML = '';
  }
  if(activeCount) activeCount.textContent = getActiveSubset().length;
  // تحديث شريط التنقل
  updateNavBar();
}

/* === إدارة ضعي الجلسة === */
function setSessionMode(mode){
  if(liveBroadcasting){
    toast('warning','لا يمكن تغيير ضعي الجلسة أثناء البث — أنهي الجلسة أولاً');
    return;
  }
  if(!['single','all','subset','all-at-once'].includes(mode)) return;
  liveSessionMode = mode;
  // تحديث بصري للبطاقات
  document.querySelectorAll('#sessionModeGrid .sm-card').forEach(c=>{
    c.classList.toggle('active', c.dataset.mode===mode);
  });
  // تحديث التلميح
  const hintText = document.getElementById('sessionModeHintText');
  if(hintText){
    if(mode==='single'){
      hintText.textContent = 'سيتم بث السؤال الموجود في النموذج فقط. لن تظهر قائمة الأسئلة في الجلسة.';
    } else if(mode==='all'){
      hintText.textContent = 'سيتم بث كل الأسئلة في القائمة بالتتابع. استخدمي ◀ ▶ في الجلسة للتنقل.';
    } else if(mode==='subset'){
      hintText.textContent = 'حدّدي الأسئلة التي تريدين تضمينها في الجلسة بعلامة ✓. استخدمي ◀ ▶ في الجلسة للتنقل.';
    } else if(mode==='all-at-once'){
      hintText.textContent = 'كل الأسئلة تظهر للطالبات دفعة واحدة في قائمة على جوالهن. كل سؤالك يجاب عنه لحاله.';
    }
  }
  // ضبط الـ subset الافتراضي
  if(mode==='all' || mode==='all-at-once'){
    liveQueueSubset = liveQuestionQueue.map((_,i)=>i);
  } else if(mode==='subset'){
    // إذا لم يكن هناك اختاري سابق، حدد الكل افتراضياً
    if(!liveQueueSubset.length) liveQueueSubset = liveQuestionQueue.map((_,i)=>i);
  } else {
    liveQueueSubset = [];
  }
  liveQueueSubsetPos = -1;
  renderQueue();
  // حدّث المعاينة لو كنا في ضعي الجلسة النشطة
  if(typeof updateLiveSessionModeBadge === 'function') updateLiveSessionModeBadge();
}

function toggleQueueSubsetItem(idx, checked){
  if(checked){
    if(!liveQueueSubset.includes(idx)) liveQueueSubset.push(idx);
    liveQueueSubset.sort((a,b)=>a-b);
  } else {
    liveQueueSubset = liveQueueSubset.filter(i=>i!==idx);
  }
  document.getElementById('queueSubsetSelected').textContent = liveQueueSubset.length;
  // حدّث صف واحد فقط (بدون أعيدي رسم كل القائمة حتى لا نفقد تركيز الـ checkbox)
  // لكن نعيد الرسم لأن العدد يتغير
  renderQueue();
}

function subsetSelectAll(){
  liveQueueSubset = liveQuestionQueue.map((_,i)=>i);
  renderQueue();
}
function subsetSelectNone(){
  liveQueueSubset = [];
  renderQueue();
}
function subsetInvert(){
  liveQueueSubset = liveQuestionQueue.map((_,i)=>i).filter(i=>!liveQueueSubset.includes(i));
  renderQueue();
}

/* === الحصول على المؤشرات الفعّالة حسب الضعي === */
function getActiveSubset(){
  if(liveSessionMode==='single') return [];
  if(liveSessionMode==='all' || liveSessionMode==='all-at-once') return liveQuestionQueue.map((_,i)=>i);
  return liveQueueSubset.slice().sort((a,b)=>a-b);
}

/* === ضبط الـ subset ليبقى متّسقاً مع liveQuestionQueue (بعد احذفي/نقل/إضافة) === */
function _remapSubsetAfterQueueChange(){
  // نعيد بناء الـ subset لتبقى المؤشرات صحيحة بعد الاحذفي/النقل.
  // الطريقة: نخزّن السؤال نفسه ونبحث عنه في القائمة الجديدة.
  // لكن الأبطأ والأسهل: نخزّن انسخية من الأسئلة المختارة ونعيد مطابقتها.
  // سنستخدم طريقة بديلة: نطابق بناءً على المعرّف الفريد (id) عند توفّره.
  const subsetItems = liveQueueSubset.map(i => liveQuestionQueue[i]).filter(Boolean);
  const usedNewIndices = new Set();
  const newSubset = [];
  subsetItems.forEach(item => {
    const newIdx = liveQuestionQueue.findIndex((q, i) => !usedNewIndices.has(i) && q.id === item.id);
    if(newIdx >= 0){
      newSubset.push(newIdx);
      usedNewIndices.add(newIdx);
    }
  });
  liveQueueSubset = newSubset;
  // اضبط المضعي الحالي إن كان ضمن الـ subset الجديد
  if(liveQueueCurrentIdx >= 0){
    const pos = liveQueueSubset.indexOf(liveQueueCurrentIdx);
    liveQueueSubsetPos = pos;
  }
}
function addCurrentToQueue(){
  const q = _buildLiveQuizFromInputs();
  if(!q){
    if(_liveQType==='bank'){toast('error','اختاري سؤالك من البنك');return;}
    if(!document.getElementById('liveQText')?.value?.trim()){toast('error','اكتبي نص السؤال أولاً');return;}
    if(_liveQType==='mcq'){toast('error','أدخلي خيارين على الأقل');return;}
    return;
  }
  // بناء عنصر قائمة موحّد
  const item = {
    id: 'q_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
    title: q.title,
    options: q.options||[],
    correct: (q.correct!==undefined ? q.correct : -1),
    freeText: !!q.freeText,
    qType: _liveQType,
    fromBankId: (_liveQType==='bank' ? q.id : null)
  };
  liveQuestionQueue.push(item);
  // ضمّه للـ subset حسب الضعي
  if(liveSessionMode==='all' || liveSessionMode==='all-at-once' || liveSessionMode==='subset'){
    const newIdx = liveQuestionQueue.length - 1;
    if(liveSessionMode==='all' || liveSessionMode==='all-at-once'){
      liveQueueSubset.push(newIdx);
    } else {
      // في ضعي subset: الإضافة تُختار افتراضياً (يمكن إلغاء احدّدي لاحقاً)
      liveQueueSubset.push(newIdx);
    }
  }
  _saveQueueToStorage();
  renderQueue();
  // نظف النموذج للاستعداد للسؤالك التالي
  document.getElementById('liveQText').value='';
  [0,1,2,3].forEach(i=>{const el=document.getElementById('liveOpt'+i);if(el)el.value='';});
  _liveCorrectIdx=-1;
  [0,1,2,3].forEach(i=>{const b=document.getElementById('liveCorrect'+i);if(b)b.classList.remove('active');});
  setLiveQType('mcq');
  toast('success','تمت الإضافة — أكملي السؤال التالي أو ابدئي البث');
}
function quickAddToQueue(){
  const el = document.getElementById('liveQuickAddTitle');
  if(!el) return;
  const title = (el.value||'').trim();
  if(!title){toast('error','اكتبي نص السؤال');el.focus();return;}
  const item = {
    id: 'q_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
    title, options:[], correct:-1, freeText:true, qType:'free', fromBankId:null
  };
  liveQuestionQueue.push(item);
  // أضيفيه للـ subset حسب الضعي
  if(liveSessionMode==='all' || liveSessionMode==='all-at-once' || liveSessionMode==='subset'){
    const newIdx = liveQuestionQueue.length - 1;
    if(liveSessionMode==='all' || liveSessionMode==='all-at-once' || !liveQueueSubset.length){
      liveQueueSubset.push(newIdx);
    } else {
      // في ضعي subset: الإضافة السريعة تُختار افتراضياً (سهلة الإزالة)
      liveQueueSubset.push(newIdx);
    }
  }
  _saveQueueToStorage();
  renderQueue();
  el.value='';
  el.focus();
  toast('success','تمت إضافة سؤالك نصي سريع ✨');
}
function removeQueueItem(idx){
  if(idx<0||idx>=liveQuestionQueue.length) return;
  const wasBroadcasting = (idx===liveQueueCurrentIdx);
  // ااحفظي الـ id لتحديث الـ subset بعد الاحذفي
  const removedId = liveQuestionQueue[idx]?.id;
  liveQuestionQueue.splice(idx,1);
  if(wasBroadcasting){
    liveQueueCurrentIdx=-1;
    liveQuiz=null;
    const prev = document.getElementById('liveCurrentQPreview');
    if(prev) prev.style.display='none';
  } else if(idx < liveQueueCurrentIdx){
    liveQueueCurrentIdx--;
  }
  // أعد ضبط الـ subset
  _remapSubsetAfterQueueChange();
  _saveQueueToStorage();
  renderQueue();
}
function moveQueueItem(idx, dir){
  const newIdx = idx + dir;
  if(newIdx<0 || newIdx>=liveQuestionQueue.length) return;
  const wasCurrent = (idx===liveQueueCurrentIdx);
  const movedItem = liveQuestionQueue[idx];
  liveQuestionQueue.splice(idx,1);
  liveQuestionQueue.splice(newIdx,0,movedItem);
  if(wasCurrent) liveQueueCurrentIdx = newIdx;
  else if(liveQueueCurrentIdx===idx) liveQueueCurrentIdx = newIdx;
  else if(liveQueueCurrentIdx===newIdx) liveQueueCurrentIdx = idx;
  // أعد ضبط الـ subset
  _remapSubsetAfterQueueChange();
  _saveQueueToStorage();
  renderQueue();
}
function editQueueItem(idx){
  const q = liveQuestionQueue[idx];
  if(!q) return;
  // حمّل السؤال في النموذج
  document.getElementById('liveQText').value = q.title||'';
  // نظف الخيارات ثم عبّي الموجود
  [0,1,2,3].forEach(i=>{const el=document.getElementById('liveOpt'+i);if(el)el.value='';});
  (q.options||[]).forEach((o,i)=>{
    if(i<4){const el=document.getElementById('liveOpt'+i);if(el)el.value=o;}
  });
  // اضبط النوع
  setLiveQType(q.qType||(q.freeText?'free':(q.options&&q.options.length?'mcq':'free')));
  // اضبط علامة الإجابة الصحيحة
  _liveCorrectIdx = (q.correct!==undefined ? q.correct : -1);
  [0,1,2,3].forEach(i=>{
    const b=document.getElementById('liveCorrect'+i);
    if(b) b.classList.toggle('active', i===_liveCorrectIdx && _liveQType==='mcq');
  });
  // ااحذفيه من القائمة (المعلمة ستعيد إضافته بعد العدلي لتحديث الانسخية)
  liveQuestionQueue.splice(idx,1);
  if(idx===liveQueueCurrentIdx) liveQueueCurrentIdx=-1;
  // أعد ضبط الـ subset
  _remapSubsetAfterQueueChange();
  _saveQueueToStorage();
  renderQueue();
  // اقلبي لقسم الإعداد
  document.getElementById('liveEditPanel')?.style && (document.getElementById('liveEditPanel').style.display='none');
  document.getElementById('liveSessionSetup').style.display='block';
  document.getElementById('liveSessionActive').style.display='none';
  document.getElementById('liveQText').focus();
  toast('info','تم تحميل السؤال في النموذج — عدّليه ثم أضيفيه للقائمة من جديد');
}
function clearQueue(silent){
  if(!liveQuestionQueue.length) return;
  if(!silent && !confirm('هل تريدين فعلاً امسحي كل الأسئلة من القائمة؟')) return;
  liveQuestionQueue = [];
  liveQueueCurrentIdx = -1;
  liveQueueSubset = [];
  liveQueueSubsetPos = -1;
  _saveQueueToStorage();
  renderQueue();
  if(!silent) toast('info','تم امسحي القائمة');
}
function loadQueueFromBank(){
  if(!Data.quizzes.length){toast('warning','بنك الأسئلة فارغ');return;}
  let added=0;
  Data.quizzes.forEach(q=>{
    if(!q.title) return;
    liveQuestionQueue.push({
      id: 'q_'+Date.now()+'_'+Math.random().toString(36).slice(2,6)+added,
      title: q.title,
      options: (q.options||[]).slice(),
      correct: (q.correct!==undefined ? q.correct : -1),
      freeText: !q.options || q.options.length===0,
      qType: (q.options && q.options.length) ? 'mcq' : 'free',
      fromBankId: q.id
    });
    added++;
  });
  // أعد بناء الـ subset حسب الضعي
  if(liveSessionMode==='all' || liveSessionMode==='all-at-once'){
    liveQueueSubset = liveQuestionQueue.map((_,i)=>i);
  } else if(liveSessionMode==='subset'){
    // في ضعي subset: ضمّ الأسئلة الجديدة افتراضياً
    const startIdx = liveQuestionQueue.length - added;
    for(let i=startIdx; i<liveQuestionQueue.length; i++){
      if(!liveQueueSubset.includes(i)) liveQueueSubset.push(i);
    }
    liveQueueSubset.sort((a,b)=>a-b);
  }
  if(added){
    _saveQueueToStorage();
    renderQueue();
    toast('success',`تم استوردي ${added} سؤالك من البنك للقائمة`);
  } else {
    toast('info','لا توجد أسئلة صالحة في البنك');
  }
}
function toggleLiveQueue(){
  const body = document.getElementById('liveQueueCompactBody');
  const tog = document.getElementById('liveQueueToggle');
  if(!body) return;
  const isOpen = body.classList.toggle('open');
  if(tog) tog.classList.toggle('open', isOpen);
}

/* === تحديث شريط التنقل في الجلسة النشطة === */
function updateNavBar(){
  const bar = document.getElementById('queueNavBar');
  if(!bar) return;
  // الشريط يظهر فقط في ضعي 'all' أو 'subset' وأثناء البث
  if(!liveBroadcasting || liveSessionMode==='single'){
    bar.style.display = 'none';
    return;
  }
  // في ضعي الكل معاً: الشريط يخبر المعلمة فقط (بدون تنقل)
  const sub = getActiveSubset();
  if(!sub.length){
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  const pos = liveQueueSubsetPos;
  const total = sub.length;
  const count = document.getElementById('qnavCount');
  const title = document.getElementById('qnavTitle');
  const prev = document.getElementById('qnavPrev');
  const next = document.getElementById('qnavNext');
  if(liveSessionMode==='all-at-once'){
    if(count) count.textContent = `${total} سؤالك`;
    if(title) title.textContent = 'في ضعي الكل معاً — كل الأسئلة مرسلة دفعة واحدة';
    if(prev) prev.disabled = true;
    if(next) next.disabled = true;
    return;
  }
  if(count) count.textContent = (pos>=0 && pos<total) ? `${pos+1} / ${total}` : `— / ${total}`;
  if(title){
    const curIdx = (pos>=0 && pos<total) ? sub[pos] : -1;
    title.textContent = (curIdx>=0 && liveQuestionQueue[curIdx]) ? _queueShortTitle(liveQuestionQueue[curIdx].title, 30) : '—';
  }
  if(prev) prev.disabled = !(pos>0);
  if(next) next.disabled = !(pos>=0 && pos<total-1);
}

/* === التالي / السابق في الجلسة النشطة === */
function nextQueueItem(){
  if(!liveBroadcasting){toast('error','لا توجد جلسة نشطة');return;}
  if(liveSessionMode==='single'){toast('info','ضعي السؤال الواحد لا يدعم التنقل');return;}
  if(liveSessionMode==='all-at-once'){toast('info','ضعي الكل معاً لا يحتاج تنقل — الأسئلة كلها مرسلة بالفعل');return;}
  const sub = getActiveSubset();
  if(!sub.length){toast('warning','لا توجد أسئلة في الجلسة');return;}
  if(liveQueueSubsetPos < sub.length-1){
    liveQueueSubsetPos++;
    broadcastQueueItem(sub[liveQueueSubsetPos]);
  } else {
    toast('info','آخر سؤالك في الجلسة ✨');
  }
}
function prevQueueItem(){
  if(!liveBroadcasting){toast('error','لا توجد جلسة نشطة');return;}
  if(liveSessionMode==='single'){toast('info','ضعي السؤال الواحد لا يدعم التنقل');return;}
  if(liveSessionMode==='all-at-once'){toast('info','ضعي الكل معاً لا يحتاج تنقل — الأسئلة كلها مرسلة بالفعل');return;}
  const sub = getActiveSubset();
  if(!sub.length){toast('warning','لا توجد أسئلة في الجلسة');return;}
  if(liveQueueSubsetPos > 0){
    liveQueueSubsetPos--;
    broadcastQueueItem(sub[liveQueueSubsetPos]);
  } else {
    toast('info','أول سؤالك في الجلسة');
  }
}

function broadcastQueueItem(idx){
  if(!liveNtfyTopic){toast('error','لا توجد جلسة نشطة — ابدئي البث أولاً');return;}
  // في ضعي الكل معاً: كل الأسئلة تُبث دفعة عند startLiveSession
  if(liveSessionMode==='all-at-once'){toast('info','في ضعي الكل معاً — كل الأسئلة تُبث مرة واحدة عند بدء الجلسة');return;}
  // في ضعي subset: تحققي أن المؤشر موجود فعلاً في المجموعة
  if(liveSessionMode==='subset' && !liveQueueSubset.includes(idx)){
    toast('warning','هذا السؤال غير مختار لهذه الجلسة — حدّديه من الإعداد أولاً');
    return;
  }
  const q = liveQuestionQueue[idx];
  if(!q){toast('error','هذا السؤال لم يعد موجوداً');renderQueue();return;}
  if(idx===liveQueueCurrentIdx){toast('info','هذا السؤال هو المُبَثّ حالياً');return;}
  // ⭐ الإصلاح: ناحفظي الإجابة الصحيحة محلياً عند المعلمة (لا تُرسل للطالبات)
  liveQuiz = {id:Date.now(), title:q.title, options:q.options||[], correct:(q.correct!==undefined?q.correct:-1), freeText: !!q.freeText};
  // بث للطالبات (لا نرسل الإجابة الصحيحة — تبقى فقط في الذاكرة المحلية للمعلمة)
  ntfyPublish(liveNtfyTopic, {type:'newq', q:{title:q.title, options:q.options||[], correct:-1, freeText:!!q.freeText}, ts:Date.now()});
  liveQueueCurrentIdx = idx;
  // حدّث المضعي داخل الـ subset
  const sub = getActiveSubset();
  liveQueueSubsetPos = sub.indexOf(idx);
  // حدّث سجل الجلسة
  Data.liveSessions = Data.liveSessions || [];
  const rec = Data.liveSessions.find(s=>s.code===State.currentLiveCode && !s.endedAt);
  if(rec){ rec.q = liveQuiz; _persistDataExt(); }
  updateLiveQuestionPreview();
  // حدّث QR ليشمل السؤال الجديد (مهم — الطالبات الجدد يحصلون عليه من الرابط)
  const joinUrl=buildJoinUrl('student', State.currentLiveCode, liveNtfyTopic, liveQuiz);
  document.getElementById('liveSessionUrl').textContent=joinUrl;
  document.getElementById('liveQRCode').innerHTML='';
  try{ new QRCode('liveQRCode',{text:joinUrl,width:160,height:160,colorDark:'#1a5f7a'}); }catch(e){}
  // ⭐ أعد تهيئة زر كشف الحل عند بث سؤالك جديد
  const revealBtn = document.getElementById('btnRevealSolution');
  if(revealBtn){
    revealBtn.innerHTML = '<i class="fas fa-lightbulb"></i> كشف الحل للطالبات';
    revealBtn.disabled = false;
    revealBtn.style.opacity = '';
  }
  renderQueue();
  toast('success','تم بث السؤال ✨');
}

function setLiveQType(t){
  _liveQType=t;
  document.getElementById('liveTypeMCQ').classList.toggle('selected',t==='mcq');
  document.getElementById('liveTypeFree').classList.toggle('selected',t==='free');
  document.getElementById('liveTypeBank').classList.toggle('selected',t==='bank');
  document.getElementById('liveChoicesArea').style.display=(t==='mcq')?'block':'none';
  document.getElementById('liveBankArea').style.display=(t==='bank')?'block':'none';
  if(t==='free'){
    // في ضعي النص الحر: نظف الخيارات
    [0,1,2,3].forEach(i=>{const el=document.getElementById('liveOpt'+i);if(el)el.value='';});
    _liveCorrectIdx=-1;
    [0,1,2,3].forEach(i=>{const b=document.getElementById('liveCorrect'+i);if(b)b.classList.remove('active');});
  }
}
function setLiveCorrect(idx){
  _liveCorrectIdx=(_liveCorrectIdx===idx)?-1:idx;
  [0,1,2,3].forEach(i=>{const b=document.getElementById('liveCorrect'+i);if(b)b.classList.toggle('active',i===_liveCorrectIdx);});
}
function openLiveSession(){
  openModal('modalLiveSession');
  refreshLiveQuizSelect();
  document.getElementById('liveSessionSetup').style.display='block';
  document.getElementById('liveSessionActive').style.display='none';
  _liveCorrectIdx=-1;
  [0,1,2,3].forEach(i=>{const b=document.getElementById('liveCorrect'+i);if(b)b.classList.remove('active');});
  setLiveQType('mcq');
  _loadQueueFromStorage();
  // أعد ضبط الـ subset حسب الضعي الحالي وحجم القائمة
  if(liveSessionMode==='all' || liveSessionMode==='all-at-once'){
    liveQueueSubset = liveQuestionQueue.map((_,i)=>i);
  } else if(liveSessionMode==='subset'){
    // إذا المؤشرات لم تعد صالحة، أعد احدّدي الافتراضي (الكل)
    const max = liveQuestionQueue.length;
    liveQueueSubset = liveQueueSubset.filter(i => i>=0 && i<max);
    if(!liveQueueSubset.length) liveQueueSubset = liveQuestionQueue.map((_,i)=>i);
  }
  liveQueueSubsetPos = -1;
  // أعد بناء بطاقات الضعي بصرياً
  setSessionMode(liveSessionMode);
}
function refreshLiveQuizSelect(){const sel=document.getElementById('liveQuizSelect');if(!sel)return;sel.innerHTML='<option value="">— من بنك الأسئلة —</option>'+Data.quizzes.map(q=>`<option value="${q.id}">${escapeHtml(q.title)}</option>`).join('');}
function _buildLiveQuizFromInputs(){
  const title=(document.getElementById('liveQText')?.value||'').trim();
  if(!title) return null;
  if(_liveQType==='bank'){
    const qid=document.getElementById('liveQuizSelect')?.value;
    if(!qid) return null;
    return Data.quizzes.find(q=>q.id===parseInt(qid));
  }
  if(_liveQType==='free'){
    return {id:Date.now(),title,options:[],correct:-1,freeText:true};
  }
  // MCQ
  const opts=[0,1,2,3].map(i=>(document.getElementById('liveOpt'+i)?.value||'').trim()).filter(Boolean);
  if(opts.length<2) return null;
  return {id:Date.now(),title,options:opts,correct:_liveCorrectIdx,freeText:false};
}
function startLiveSession(){
  // === اختاري أول سؤالك حسب الضعي ===
  // single: من النموذج فقط (بدون قائمة)
  // all: أول سؤالك في القائمة
  // subset: أول سؤالك في المجموعة المختارة
  let firstFromQueue = null;
  let firstIdx = -1;

  if(liveSessionMode==='single'){
    // سؤالك واحد فقط — من النموذج
    liveQuiz=_buildLiveQuizFromInputs();
    if(!liveQuiz){
      if(_liveQType==='bank'){toast('error','اختاري سؤالك من البنك');return;}
      if(!document.getElementById('liveQText')?.value?.trim()){toast('error','اكتبي نص السؤال');return;}
      if(_liveQType==='mcq'){toast('error','أدخلي خيارين على الأقل');return;}
      return;
    }
  } else {
    // ضعي 'all' أو 'subset' أو 'all-at-once' — تأكد أن المجموعة الفرعية فيها أسئلة
    const sub = getActiveSubset();
    if(!sub.length){
      toast('warning', liveSessionMode==='subset' ? 'لم تختاري أي سؤالك — حدّدي ✓ على الأقل سؤالك واحداً' : 'القائمة فارغة — أضيفي سؤالك أولاً');
      return;
    }
    firstIdx = sub[0];
    firstFromQueue = liveQuestionQueue[firstIdx];
    // ⭐ الإصلاح: ناحفظي الإجابة الصحيحة محلياً عند المعلمة لتقييم إجابات الطالبات
    liveQuiz = {id:Date.now(), title:firstFromQueue.title, options:firstFromQueue.options||[], correct:(firstFromQueue.correct!==undefined?firstFromQueue.correct:-1), freeText:!!firstFromQueue.freeText};
    liveQueueCurrentIdx = firstIdx;
    liveQueueSubsetPos = 0;
  }

  State.currentLiveCode=Math.random().toString(36).substring(2,8).toUpperCase();
  liveNtfyTopic=_topic('live-'+State.currentLiveCode);
  document.getElementById('liveSessionSetup').style.display='none';
  document.getElementById('liveSessionActive').style.display='block';
  document.getElementById('liveCodeDisplay').textContent=State.currentLiveCode;
  let joinUrl;
  if(liveSessionMode==='all-at-once'){
    // بناء رابط يحتوي كل الأسئلة (مدمجة في URL)
    const sub = getActiveSubset();
    const allQsLite = sub.map(qIdx => {
      const q = liveQuestionQueue[qIdx];
      return { title: q.title, options: q.options||[], freeText: !!q.freeText };
    });
    joinUrl = buildJoinUrlMulti('student', State.currentLiveCode, liveNtfyTopic, allQsLite);
  } else {
    joinUrl = buildJoinUrl('student', State.currentLiveCode, liveNtfyTopic, liveQuiz);
  }
  document.getElementById('liveSessionUrl').textContent=joinUrl;
  document.getElementById('liveQRCode').innerHTML='';
  new QRCode('liveQRCode',{text:joinUrl,width:160,height:160,colorDark:'#1a5f7a'});
  if(liveChannel){try{liveChannel.close();}catch(e){} liveChannel=null;}
  liveChannel = ntfySubscribe(liveNtfyTopic, (msg)=>{
    if(msg.type==='answer'){
      const studentName = msg.student || msg.name || msg.sender || '';
      const answerText = msg.answer || msg.text || msg.ans || '';
      if(studentName && answerText){
        showLiveResponse(studentName, answerText, msg.time, msg.qRef);
      }
    } else if(msg.type === 'join'){
      // ⭐ طالبة دخلت الجلسة → سجّليها حضور تلقائياً
      const name = msg.name || 'طالبة';
      _markStudentJoined(name);
    } else if(msg.type === 'leave'){
      // ⭐ طالبة غادرت الجلسة → سجّلي وقت المغادرة
      const name = msg.name || 'طالبة';
      _markStudentLeft(name);
    } else if(msg.type === 'livebus'){
      // ⭐ رسالة من LiveBus واردة من طالبة (مثل: ضغطة على تحدي السرعة)
      LiveBus.handleIncomingNtfy(msg);
    }
  });
  // بث السؤال الحالي للطالبات
  if(liveNtfyTopic){
    // ⚠️ لا نرسل الإجابة الصحيحة في البث — تبقى فقط في الذاكرة المحلية للمعلمة
    if(liveSessionMode==='all-at-once'){
      // بث كل الأسئلة دفعة واحدة — type:'allq'
      const sub = getActiveSubset();
      const allQs = sub.map((qIdx, pos) => {
        const q = liveQuestionQueue[qIdx];
        return {
          pos: pos,
          title: q.title,
          options: q.options||[],
          freeText: !!q.freeText
        };
      });
      ntfyPublish(liveNtfyTopic, {type:'allq', mode:'all-at-once', qs:allQs, ts:Date.now()});
    } else {
      ntfyPublish(liveNtfyTopic, {type:'newq', q:{title:liveQuiz.title, options:liveQuiz.options||[], correct:-1, freeText:!!liveQuiz.freeText}, ts:Date.now()});
    }
  }
  // ابدئي سجل الجلسة في Data.liveSessions
  Data.liveSessions = Data.liveSessions || [];
  Data.liveSessions.push({code:State.currentLiveCode, q:liveQuiz, answers:[], createdAt:new Date().toISOString(), endedAt:null, queueSize:getActiveSubset().length, mode:liveSessionMode});
  _persistDataExt();
  // ⭐ ابدئي سجل الحضور تلقائياً (يضم طالبات فصول المعلمة)
  try{ _createAttendanceSession(); }catch(e){ console.warn('attendance init',e); }
  // إظهار السؤال الحالي في المعاينة
  updateLiveQuestionPreview();
  document.getElementById('liveEditPanel').style.display='none';
  document.getElementById('liveResponsesStream').innerHTML='<div style="text-align:center;padding:20px;color:#888">في انتظار إجابات الطالبات...</div>';
  // ⭐ أعد تهيئة زر كشف الحل عند بدء جلسة جديدة
  const revealBtn = document.getElementById('btnRevealSolution');
  if(revealBtn){
    revealBtn.innerHTML = '<i class="fas fa-lightbulb"></i> كشف الحل للطالبات';
    revealBtn.disabled = false;
    revealBtn.style.opacity = '';
  }
  // علّم أن البث بدأ
  liveBroadcasting = true;
  // ⭐ حدّث شارة "مباشر للطالبات" في مركز الألعاب (إن كان مفتوحاً)
  try{ if(typeof updateGamesLiveBadge === 'function') updateGamesLiveBadge(); }catch(e){}
  // ااعرضي القائمة وشريط التنقل في ضعي الجلسة النشطة
  if(liveSessionMode!=='single' && liveQuestionQueue.length){
    document.getElementById('liveQueueCompact').style.display='block';
    document.getElementById('liveQueueCompactBody').classList.add('open');
    document.getElementById('liveQueueToggle').classList.add('open');
  }
  renderQueue();
  // ==== أظهر اللوحة العائمة على السبورة الرئيسية ====
  // هذه الخطوة تحل المشكلة الأساسية: المعلمة تشوف الإجابات حتى لو سكّرت نافذة البث
  showLiveActivityPanel();

  // رسالة ترحيب حسب الضعي
  let msg;
  if(liveSessionMode==='single'){
    msg = 'بدأت الجلسة — سؤالك واحد ظاهر للطالبات في الـ QR: '+State.currentLiveCode;
  } else if(liveSessionMode==='all-at-once'){
    const total = getActiveSubset().length;
    msg = `بدأت الجلسة — ${total} سؤالك كلها معروضة على جوال الطالبة دفعة واحدة`;
  } else {
    const total = getActiveSubset().length;
    const modeLabel = liveSessionMode==='subset' ? 'مختارة' : 'محضّرة';
    msg = `بدأت الجلسة — يبثّ السؤال 1/${total} (${modeLabel})`;
  }
  toast('success',msg);
}
function rebroadcastCurrent(){
  if(!liveQuiz||!liveNtfyTopic){toast('error','لا توجد جلسة نشطة');return;}
  // ⚠️ لا نرسل الإجابة الصحيحة في البث — تبقى فقط في الذاكرة المحلية للمعلمة
  if(liveSessionMode==='all-at-once'){
    // أعد بث كل الأسئلة دفعة واحدة
    const sub = getActiveSubset();
    const allQs = sub.map((qIdx, pos) => {
      const q = liveQuestionQueue[qIdx];
      return { pos, title: q.title, options: q.options||[], freeText: !!q.freeText };
    });
    ntfyPublish(liveNtfyTopic, {type:'allq', mode:'all-at-once', qs:allQs, ts:Date.now()});
  } else {
    ntfyPublish(liveNtfyTopic, {type:'newq', q:{title:liveQuiz.title, options:liveQuiz.options||[], correct:-1, freeText:!!liveQuiz.freeText}, ts:Date.now()});
  }
  toast('success','تم أعيدي بث السؤال للطالبات 📡');
}

/* ============== بث الحل (الإجابة الصحيحة) للطالبات ==============
   ⭐ الميزة الجديدة: عندما تريد المعلمة كشف الحل للطالبات بعد جمع الإجابات
   - تتحققي من وجود إجابتكِ صحيحة محددة
   - تبث رسالة 'solution' على ntfy تحتوي على نص الحل
   - الطالبات يستقبلنها وياعرضينها على جوالاتهن
   - يتم تسجيل أن الحل تم كشفه (solutionRevealed=true) لمنع الإرسال المتكرر */
function revealSolutionToStudents(){
  if(!liveNtfyTopic){toast('error','لا توجد جلسة نشطة');return;}
  if(!liveQuiz){toast('error','لا يوجد سؤالك مُبَثّ');return;}
  // تحقّق من وجود إجابتكِ صحيحة
  const hasCorrect = !!(liveQuiz.options && liveQuiz.options.length>0 && liveQuiz.correct!==undefined && liveQuiz.correct>=0);
  if(!hasCorrect){
    toast('warning','لم تُحدَّد إجابتكِ صحيحة لهذا السؤال — اضغطي ✓ على الخيار الصحيح أولاً');
    return;
  }
  const letters=['أ','ب','ج','د','هـ','و','ز','ح'];
  const solIdx = liveQuiz.correct;
  const solLetter = letters[solIdx] || String(solIdx+1);
  const solText = liveQuiz.options[solIdx] || '';
  // بث الحل على قناة ntfy
  ntfyPublish(liveNtfyTopic, {
    type:'solution',
    qTitle: liveQuiz.title,
    correctIndex: solIdx,
    correctLetter: solLetter,
    correctText: solText,
    options: liveQuiz.options||[],
    ts: Date.now()
  });
  // إشعار للمعلمة + تأكيد بصري
  toast('success',`تم بث الحل للطالبات 💡 ${solLetter}: ${solText.substring(0,30)}${solText.length>30?'…':''}`);
  // علّم الزر أنه تم الكشف (لتجنب الإرسال المتكرر)
  const btn = document.getElementById('btnRevealSolution');
  if(btn){
    btn.innerHTML = '<i class="fas fa-check"></i> تم بث الحل ✓';
    btn.disabled = true;
    btn.style.opacity = '0.6';
  }
}
function showLiveEditPanel(){
  if(!liveQuiz) return;
  document.getElementById('liveQText2').value = liveQuiz.title || '';
  document.getElementById('liveOpts2').value = (liveQuiz.options||[]).join('\n');
  document.getElementById('liveEditPanel').style.display='block';
}
function broadcastNewQuestion(){
  if(!liveNtfyTopic){toast('error','لا توجد جلسة نشطة');return;}
  const title=(document.getElementById('liveQText2')?.value||'').trim();
  if(!title){toast('error','اكتبي نص السؤال');return;}
  const opts=(document.getElementById('liveOpts2')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
  // ⭐ الإصلاح: ناحفظي الإجابة الصحيحة محلياً (_liveCorrectIdx) لتقييم إجابات الطالبات
  liveQuiz = {id:Date.now(), title, options:opts, correct:_liveCorrectIdx, freeText: opts.length===0};
  // بث للطالبات (لا نرسل الإجابة الصحيحة)
  ntfyPublish(liveNtfyTopic, {type:'newq', q:{title, options:opts, correct:-1, freeText:opts.length===0}, ts:Date.now()});
  // ملاحظة: البث اليدوي خارج القائمة — اسمحي التظليل من القائمة
  liveQueueCurrentIdx = -1;
  liveQueueSubsetPos = -1;
  renderQueue();
  // حدّث سجل الجلسة
  Data.liveSessions = Data.liveSessions || [];
  const rec = Data.liveSessions.find(s=>s.code===State.currentLiveCode && !s.endedAt);
  if(rec){ rec.q = liveQuiz; _persistDataExt(); }
  updateLiveQuestionPreview();
  document.getElementById('liveEditPanel').style.display='none';
  // حدّث QR ليشمل السؤال الجديد (مهم — الطالبات الجدد يحصلون عليه من الرابط)
  const joinUrl=buildJoinUrl('student', State.currentLiveCode, liveNtfyTopic, liveQuiz);
  document.getElementById('liveSessionUrl').textContent=joinUrl;
  document.getElementById('liveQRCode').innerHTML='';
  try{ new QRCode('liveQRCode',{text:joinUrl,width:160,height:160,colorDark:'#1a5f7a'}); }catch(e){}
  toast('success','تم بث السؤال الجديد للطالبات ✨');
}
function updateLiveQuestionPreview(){
  const preview=document.getElementById('liveCurrentQPreview');
  const text=document.getElementById('liveCurrentQText');
  if(!preview||!text)return;
  // في ضعي الكل معاً: ااعرضي معاينة لكل الأسئلة
  if(liveSessionMode==='all-at-once'){
    const sub = getActiveSubset();
    if(!sub.length){ preview.style.display='none'; return; }
    const list = sub.map((qIdx, pos) => {
      const q = liveQuestionQueue[qIdx];
      if(!q) return '';
      const opts = q.options||[];
      return `<div style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.2);font-size:.82rem;display:flex;gap:8px;align-items:flex-start"><div style="background:rgba(255,255,255,.25);border-radius:50%;min-width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.7rem;flex-shrink:0">${pos+1}</div><div style="flex:1"><b>${escapeHtml(q.title||'سؤالك '+(pos+1))}</b><div style="font-size:.68rem;opacity:.8;margin-top:2px">${opts.length ? opts.length+' خيارات' : 'نص حر'}</div></div></div>`;
    }).join('');
    text.innerHTML = `<div style="margin-bottom:8px;font-size:.85rem;opacity:.95"><i class="fas fa-bars-staggered" style="margin-left:4px"></i> ${sub.length} سؤالك — كلها معروضة على جوال الطالبة</div><div style="background:rgba(0,0,0,.1);border-radius:8px;max-height:200px;overflow-y:auto">${list}</div><div style="margin-top:6px;font-size:.72rem;opacity:.85">📱 كل سؤالك يجاب عنه لحاله على جوال الطالبة</div>`;
    preview.style.display='block';
    return;
  }
  if(!liveQuiz)return;
  const opts = liveQuiz.options||[];
  // ⚠️ ملاحظة: لا ناعرضي الخيارات فوق الـ QR أبداً
  // السبب: أي خيار من الخيارات قد يكون الإجابة الصحيحة، فإذا رأتها الطالبة على السبورة
  // ستعرف الإجابة ضمنياً. الخيارات تُرسل فقط للطالبات على جوالاتهن بعد امسحي الـ QR.
  let html = `<b>${escapeHtml(liveQuiz.title||'سؤالك مفتوح')}</b>`;
  if(opts.length){
    html += `<div style="margin-top:6px;font-size:.72rem;opacity:.8"><i class="fas fa-mobile-screen" style="margin-left:4px"></i> الخيارات تظهر للطالبات على جوالاتهن بعد امسحي الـ QR</div>`;
  } else {
    html += `<div style="margin-top:4px;font-size:.72rem;opacity:.8">📝 سؤالك نص حر — الطالبات تكتب إجاباتها</div>`;
  }
  text.innerHTML = html;
  preview.style.display='block';
}
/* ============== LIVE ACTIVITY FLOATING PANEL ==============
   لوحة عائمة على السبورة الرئيسية — تظهر أثناء البث المباشر.
   تحل المشكلة: "الطالبة تجيب وما في تواصل" — المعلمة تشوف عدّاد
   الإجابات + آخر الإجابات + إشعار صوتي/مرئي عند كل إجابتكِ جديدة،
   حتى لو نافذة البث (modalLiveSession) مغلقة. */

let _liveRecent = [];        // آخر الإجابات للاعرضي في اللوحة
let _liveUniqueNames = new Set();  // أسماء الطالبات الفريدات
let _liveCorrectCount = 0;   // عدد الإجابات الصحيحة
let _livePanelOpen = false;  // هل اللوحة مفتوحة؟
let _liveAudioCtx = null;    // Web Audio context (يُنشأ عند أول تفاعل)
let _liveAudioEnabled = true; // هل الإشعار الصوتي مفعّل؟

function _getLiveAudioCtx(){
  if(!_liveAudioCtx){
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      if(AC) _liveAudioCtx = new AC();
    }catch(e){ _liveAudioCtx = null; }
  }
  return _liveAudioCtx;
}

/* playLiveBeep: صوت تنبيه لطيف عند ورود إجابتكِ جديدة.
   tone: 'normal' | 'correct' | 'wrong' (يغير الـ pitch)
   ملاحظة: المتصفحات تحظر Audio قبل تفاعل المستخدم — أول beep
   قد لا يصدر، الباقي يصدر عادي. */
function playLiveBeep(tone){
  if(!_liveAudioEnabled) return;
  const ctx = _getLiveAudioCtx();
  if(!ctx) return;
  try{
    // استأنف لو متوقف (متصفح يوقفه بعد فترة خمول)
    if(ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    // نغمة قصيرة — 2 oscillators لنغمة أكثر دفئاً
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    let freq = 660; // E5
    if(tone === 'correct') freq = 880;  // A5 — أعلى = فرح
    if(tone === 'wrong') freq = 440;    // A4 — أخفض
    o1.type = 'sine';
    o1.frequency.setValueAtTime(freq, now);
    o2.type = 'sine';
    o2.frequency.setValueAtTime(freq * 1.5, now);
    // envelope: attack سريع، decay بطيء — صوت "بينغ" لطيف
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.18, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    o1.connect(g); o2.connect(g); g.connect(ctx.destination);
    o1.start(now); o2.start(now);
    o1.stop(now + 0.4); o2.stop(now + 0.4);
  }catch(e){ /* صامت لو فشل الصوت — لا تكسر التدفق */ }
}

/* showLiveActivityPanel: تُظهر اللوحة العائمة على السبورة الرئيسية
   + تحدّث الإحصائيات + تستعيد آخر الإجابات من Data.liveSessions
   (يعني حتى لو افتحيت اللوحة متأخر، تشوف كل اللي جاوبوا) */
function showLiveActivityPanel(){
  const fab = document.getElementById('liveActivityFab');
  if(!fab) return;
  fab.classList.add('visible');
  document.getElementById('lapCodeLabel').textContent = 'كود: ' + (State.currentLiveCode || '—');
  // استعد آخر الإجابات من السجل (لو افتحينا اللوحة بعد فترة)
  try{
    const rec = (Data.liveSessions||[]).find(s => s.code===State.currentLiveCode && !s.endedAt);
    if(rec && rec.answers && rec.answers.length){
      _liveRecent = [];
      _liveUniqueNames = new Set();
      _liveCorrectCount = 0;
      // رتب من الأحدث للأقدم
      rec.answers.slice().reverse().forEach(a => {
        _liveRecent.push({name:a.name, answer:a.answer, time:a.time, isCorrect:a.isCorrect, hasCorrect:a.hasCorrect, qRef:a.qRef, solution:a.solution, solutionLetter:a.solutionLetter, solutionText:a.solutionText});
        if(a.name) _liveUniqueNames.add(a.name);
        if(a.isCorrect) _liveCorrectCount++;
      });
    }
  }catch(e){}
  updateLiveActivityPanel();
}

/* hideLiveActivityPanel: تخفي اللوحة العائمة + تامسحي الحالة */
function hideLiveActivityPanel(){
  const fab = document.getElementById('liveActivityFab');
  if(fab) fab.classList.remove('visible');
  const panel = document.getElementById('liveActivityPanel');
  if(panel) panel.classList.remove('open');
  _livePanelOpen = false;
  _liveRecent = [];
  _liveUniqueNames = new Set();
  _liveCorrectCount = 0;
}

/* toggleLiveActivityPanel: افتحي/طي اللوحة */
function toggleLiveActivityPanel(){
  const panel = document.getElementById('liveActivityPanel');
  if(!panel) return;
  _livePanelOpen = !_livePanelOpen;
  if(_livePanelOpen){
    panel.classList.add('open');
  } else {
    panel.classList.remove('open');
  }
}

/* updateLiveActivityPanel: تحدّث الإحصائيات + قائمة الإجابات في اللوحة العائمة.
   تُستدعى من showLiveResponse() عند ورود كل إجابتكِ جديدة. */
function updateLiveActivityPanel(){
  const count = _liveRecent.length;
  const fab = document.getElementById('liveActivityFab');
  if(!fab || !fab.classList.contains('visible')) return;
  // عدّاد الزر العائم
  const laCount = document.getElementById('laCount');
  if(laCount) laCount.textContent = count;
  // الإحصائيات
  const lapStatCount = document.getElementById('lapStatCount');
  const lapStatUnique = document.getElementById('lapStatUnique');
  const lapStatCorrect = document.getElementById('lapStatCorrect');
  if(lapStatCount) lapStatCount.textContent = count;
  if(lapStatUnique) lapStatUnique.textContent = _liveUniqueNames.size;
  if(lapStatCorrect) lapStatCorrect.textContent = _liveCorrectCount;
  // قائمة الإجابات (آخر 50)
  const list = document.getElementById('lapList');
  if(list){
    if(!_liveRecent.length){
      list.innerHTML = '<div class="lap-empty"><i class="fas fa-hourglass-half"></i>في انتظار إجابات الطالبات...</div>';
    } else {
      list.innerHTML = _liveRecent.slice(0, 50).map(r => {
        const safeName = (r.name||'طالبة').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
        const initial = safeName.charAt(0);
        let cls = '';
        if(r.hasCorrect && r.answer){
          cls = r.isCorrect ? 'lap-correct' : 'lap-wrong';
        }
        const safeAns = (r.answer||'').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
        const status = (r.hasCorrect && r.answer)
          ? `<div class="lap-item-status"><i class="fas fa-${r.isCorrect?'check-circle':'times-circle'}" style="color:${r.isCorrect?'#27ae60':'#e74c3c'}"></i></div>`
          : '';
        // ⭐ إضافة سطر الحل أسفل إجابتكِ الطالبة في اللوحة العائمة
        const solutionRow = r.solutionText
          ? `<div class="lap-item-solution"><i class="fas fa-lightbulb" style="color:#f39c12"></i> <span>الحل:</span> <b>${r.solutionLetter||''}</b> ${r.solutionText}</div>`
          : '';
        return `<div class="lap-item ${cls}"><div class="lap-item-av">${initial}</div><div class="lap-item-body"><div class="lap-item-name">${safeName}</div><div class="lap-item-ans">${safeAns}</div>${solutionRow}</div>${status}<div class="lap-item-time">${r.time||''}</div></div>`;
      }).join('');
    }
  }
}

/* showLiveAnswerNotif: إشعار طافٍ يظهر في أعلى الشاشة عند ورود إجابتكِ جديدة.
   tone: 'normal' | 'correct' | 'wrong' — يغير الصوت واللون.
   يختفي تلقائياً بعد 3 ثوان. */
function showLiveAnswerNotif(name, answer, tone){
  const notif = document.getElementById('liveNotif');
  if(!notif) return;
  notif.classList.remove('ln-correct','ln-wrong');
  if(tone === 'correct') notif.classList.add('ln-correct');
  if(tone === 'wrong') notif.classList.add('ln-wrong');
  const title = document.getElementById('liveNotifTitle');
  const body = document.getElementById('liveNotifBody');
  const safeName = (name||'طالبة').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
  const safeAns = (answer||'').toString().replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
  if(tone === 'correct'){
    if(title) title.textContent = '✅ إجابتكِ صحيحة';
    if(body) body.innerHTML = `<b>${safeName}</b> أجابت: ${safeAns}`;
  } else if(tone === 'wrong'){
    if(title) title.textContent = '❌ إجابتكِ خاطئة';
    if(body) body.innerHTML = `<b>${safeName}</b> أجابت: ${safeAns}`;
  } else {
    if(title) title.textContent = '💬 إجابتكِ جديدة';
    if(body) body.innerHTML = `<b>${safeName}</b>: ${safeAns}`;
  }
  // أعد التشغيل حتى لو الإشعار ظاهر (إجابات متلاحقة)
  notif.classList.add('show');
  clearTimeout(notif._hideTimer);
  notif._hideTimer = setTimeout(()=>{ notif.classList.remove('show'); }, 3000);
}

function showLiveResponse(name,answer,time,qRef){
  // ⭐ إزالة الاستجابات الوهمية/الفارغة
  if(!name || name.trim()==='' || name==='طالبة' || name==='undefined'){
    console.warn('تم تجاهل استجابة بدون اسم:', name, answer);
    return;
  }
  if(!answer || answer.trim()===''){
    return;
  }

  const lapList = document.getElementById('lapList');
  if(!lapList) return;

  // إزالة رسالة "لا توجد استجابات"
  const emptyMsg = lapList.querySelector('.lap-empty');
  if(emptyMsg) emptyMsg.remove();

  // التحقق من عدم التكرار بنفس الاسم ونفس الإجابة في آخر 3 ثوانٍ
  const now = Date.now();
  const dupKey = name+'::'+answer;
  if(window._lastLiveResponses && window._lastLiveResponses[dupKey] && (now - window._lastLiveResponses[dupKey] < 3000)){
    return; // تجاهل التكرار
  }
  if(!window._lastLiveResponses) window._lastLiveResponses = {};
  window._lastLiveResponses[dupKey] = now;

  const item = document.createElement('div');
  item.className = 'lap-item lap-just-in';
  const initial = (name.charAt(0) || '?');
  const isCorrect = (typeof qRef==='object' && qRef.correct && answer===qRef.correct);
  if(isCorrect) item.classList.add('lap-correct');

  item.innerHTML = `
    <div class="lap-item-av">${escapeHtml(initial)}</div>
    <div class="lap-item-body">
      <div class="lap-item-name">${escapeHtml(name)}</div>
      <div class="lap-item-ans">${escapeHtml(answer)}</div>
      ${qRef && qRef.solution ? `<div class="lap-item-solution"><b>الحل:</b> ${escapeHtml(qRef.solution)}</div>` : ''}
    </div>
    <div class="lap-item-time">${time || formatTime(new Date().toISOString())}</div>
  `;
  lapList.insertBefore(item, lapList.firstChild);
  setTimeout(()=>item.classList.remove('lap-just-in'), 1200);

  // تحديث العدادات
  const countEl = document.getElementById('lapStatCount');
  const uniqueEl = document.getElementById('lapStatUnique');
  if(countEl){
    let c = parseInt(countEl.textContent)||0;
    countEl.textContent = (c+1);
  }
  if(uniqueEl){
    // حساب عدد فريد من الأسماء
    const allNames = new Set();
    lapList.querySelectorAll('.lap-item-name').forEach(el => allNames.add(el.textContent.trim()));
    uniqueEl.textContent = allNames.size;
  }

  // تأثير النبضة على الزر
  const btn = document.getElementById('liveActivityBtn');
  if(btn){
    btn.classList.add('has-new');
    setTimeout(()=>btn.classList.remove('has-new'), 1500);
  }

  // إشعار طافٍ
  showLiveNotif(name, answer);
}
function copyJoinLink(){const url=document.getElementById('liveSessionUrl').textContent;navigator.clipboard.writeText(url).then(()=>toast('success','تم انسخي الرابط'));}
function endLiveSession(){
  // بث الانتهاء وأغلق
  if(liveNtfyTopic){ntfyPublish(liveNtfyTopic, {type:'end', ts:Date.now()});}
  if(liveChannel){try{liveChannel.close();}catch(e){} liveChannel=null;}
  // أنهِ سجل الجلسة
  Data.liveSessions = Data.liveSessions || [];
  const rec = Data.liveSessions.find(s=>s.code===State.currentLiveCode && !s.endedAt);
  if(rec) rec.endedAt = new Date().toISOString();
  _persistDataExt();
  // ⭐ أنهِ سجل الحضور (من لم تنضم = غائبة)
  try{ _endAttendanceSession(); }catch(e){ console.warn('attendance end',e); }
  liveNtfyTopic=null;
  State.currentLiveCode=null;
  liveQueueCurrentIdx=-1;
  liveQueueSubsetPos=-1;
  liveBroadcasting=false;
  // ⭐ حدّث شارة "مباشر للطالبات" في مركز الألعاب
  try{ if(typeof updateGamesLiveBadge === 'function') updateGamesLiveBadge(); }catch(e){}
  // لا نامسحي القائمة — قد تريدين البث مرة ثانية أو عدليها
  renderQueue();
  // ==== أخفِ اللوحة العائمة عند إنهاء الجلسة ====
  hideLiveActivityPanel();
  closeModal('modalLiveSession');
  toast('info','انتهت الجلسة — يمكنكِ بدء جلسة جديدة مع نفس القائمة');
}
function addLiveQRToBoard(){
  const qrHost=document.getElementById('liveQRCode');
  if(!qrHost||!qrHost.querySelector('canvas')){toast('error','انطلقي الجلسة أولاً');return;}
  const qrCanvas=qrHost.querySelector('canvas');
  const url=document.getElementById('liveSessionUrl').textContent;
  const code=document.getElementById('liveCodeDisplay').textContent;
  const tmp=document.createElement('canvas');
  tmp.width=520;tmp.height=240;
  const tctx=tmp.getContext('2d');
  tctx.fillStyle='#ffffff';tctx.fillRect(0,0,tmp.width,tmp.height);
  tctx.drawImage(qrCanvas,20,20,200,200);
  tctx.fillStyle='#0f3460';
  tctx.font='bold 22px Tajawal,sans-serif';
  tctx.textBaseline='top';
  tctx.direction='rtl';
  tctx.fillText('🔴 جلسة أسئلة مباشرة',tmp.width-20,30);
  tctx.fillStyle='#e74c3c';
  tctx.font='bold 20px Tajawal,sans-serif';
  tctx.fillText('الكود: '+code,tmp.width-20,68);
  tctx.fillStyle='#666';
  tctx.font='bold 13px Tajawal,sans-serif';
  tctx.fillText('📱 اسمحي للاشتراك',tmp.width-20,100);
  tctx.fillStyle='#333';
  tctx.font='10px Tajawal,sans-serif';
  const maxW=tmp.width-240;
  const words=url.split('');
  let line='',y=130;
  for(let i=0;i<words.length;i++){
    const test=line+words[i];
    if(tctx.measureText(test).width>maxW&&i>0){
      tctx.fillText(line,tmp.width-20,y);
      line=words[i];
      y+=14;
    }else line=test;
  }
  tctx.fillText(line,tmp.width-20,y);
  const dpr=window.devicePixelRatio||1;
  const w=Math.min(tmp.width,canvas.width/dpr*.6);
  const h=tmp.height*(w/tmp.width);
  const x=canvas.width/dpr/2-w/2;
  const yc=canvas.height/dpr/2-h/2;
  ctx.drawImage(tmp,x,yc,w,h);
  saveHistory();
  toast('success','تم إضافة QR الجلسة للسبورة');
}

/* STUDENT MODE */
let studentMode=0;

/* _stuLastQuestion: يخزن آخر سؤالك وصل من المعلمة (لكي لا يضيع لو وصلت الطالبة متأخرة) */
window._stuLastQuestion = null; // {type:'newq'|'pollQ'|'exitQ', q, opts}
window._stuSessionEnded = false;

/* helper لتحديث badge حالة الاتصال */
window._setStuStatus = function(text, kind){
  const el = document.getElementById('stuConnBadge');
  if(!el) return;
  el.classList.remove('stu-conn-ok','stu-conn-err','stu-conn-pending');
  el.classList.add('stu-conn-' + (kind||'pending'));
  let icon = 'fa-circle-notch fa-spin';
  if(kind==='ok') icon = 'fa-circle-check';
  if(kind==='err') icon = 'fa-triangle-exclamation';
  el.innerHTML = `<i class="fas ${icon}"></i> <span>${text}</span>`;
};

/* ⭐ showStudentError() — ياعرضي خطأ للطالبة مع زر إعادة المحاولة */
function showStudentError(msg, icon){
  icon = icon || '⚠️';
  const wrap = document.getElementById('studentCard');
  if(!wrap) return;
  wrap.innerHTML = '<div class="student-waiting" style="color:#e74c3c"><div style="font-size:3rem;margin-bottom:10px">'+icon+'</div><h3>عذراً!</h3><p style="color:#c0392b;font-weight:700">'+escapeHtml(msg)+'</p><button class="btn btn-secondary" onclick="location.reload()" style="margin-top:10px"><i class="fas fa-redo"></i> إعادة المحاولة</button></div>';
}

/* ⭐ renderStudentJoin() — نموذج اسم + انضمام للجلسة الحية */
function renderStudentJoin(code, topic){
  window._stuCode = code;
  window._stuTopic = topic;
  const wrap = document.getElementById('studentCard');
  if(!wrap) return;
  const label = document.getElementById('studentSessionLabel');
  if(label) label.textContent = 'الجلسة: ' + code;
  wrap.innerHTML = `
    <div class="stu-q-hero">
      <div class="sgh-label"><i class="fas fa-broadcast-tower"></i> جلسة أسئلة مباشرة</div>
      <div class="sgh-title">👋 مرحباً بك</div>
      <div class="sgh-meta"><span class="sgh-pill live"><i class="fas fa-circle" style="color:#2ecc71"></i> مباشر</span><span class="sgh-pill"><i class="fas fa-keyboard"></i> ${escapeHtml(code)}</span></div>
    </div>
    <h2 style="text-align:center;margin:14px 0 6px">أدخلي اسمك للمشاركة</h2>
    <p style="text-align:center;color:#666;margin-bottom:14px">المعلمة في انتظارك</p>
    <input type="text" class="student-name-input" id="stuNameInput" placeholder="اسمك الثلاثي" autofocus>
    <button class="btn btn-primary btn-block btn-lg" onclick="studentJoin('${code}','student')"><i class="fas fa-sign-in-alt"></i> انضمي للجلسة</button>
  `;
  setTimeout(()=>{const i=document.getElementById('stuNameInput'); if(i) i.focus();}, 50);
}

/* ⭐ renderStudentLive() — يعرض شاشة الانتظار للجلسة الحية (مفعّلة عبر ntfy) */
function renderStudentLive(code, topic){
  window._stuCode = code;
  window._stuTopic = topic;
  const wrap = document.getElementById('studentCard');
  if(!wrap) return;
  const label = document.getElementById('studentSessionLabel');
  if(label) label.textContent = 'البث: ' + code;
  wrap.innerHTML = `
    <div class="stu-q-hero">
      <div class="sgh-label"><i class="fas fa-broadcast-tower"></i> البث المباشر</div>
      <div class="sgh-title">في انتظار بدء البث من المعلمة...</div>
      <div class="sgh-meta"><span class="sgh-pill live"><i class="fas fa-circle" style="color:#2ecc71"></i> متصل</span><span class="sgh-pill"><i class="fas fa-wifi"></i> ${escapeHtml(code)}</span></div>
    </div>
    <div class="student-waiting">
      <div class="spin"><i class="fas fa-hourglass-half"></i></div>
      <p>ستظهر الأسئلة هنا فور بثّها من المعلمة</p>
    </div>
  `;
}

/* ⭐ handleStudentMessage() — معالج رسائل ntfy الموحد حسب الـ mode */
function handleStudentMessage(data, mode){
  if(!data) return;
  if(mode==='exit'){
    if(data.type==='exitQ'){
      // حدّث السؤال وأعد رسم التذكرة
      const q = data.q || 'تقييم الفهم';
      const opts = data.opts || data.options || [];
      renderStudentExit(q, opts, {title:q, options:opts});
    }
  } else if(mode==='poll'){
    if(data.type==='pollQ'){
      const q = data.q || 'الاستطلاع';
      const opts = data.opts || data.options || [];
      renderStudentExit(q, opts, {title:q, options:opts}); // يمكن تخصيصه
    }
    if(data.type==='pollEnd'){
      const wrap = document.getElementById('studentCard');
      if(wrap) wrap.innerHTML = `<div class="student-success"><i class="fas fa-check-circle"></i><h3>انتهى الاستطلاع</h3><p>شكراً لمشاركتكِ</p></div>`;
    }
  } else if(mode==='student' || mode==='live'){
    if(data.type==='newq'){
      if(typeof renderStudentQuestion === 'function'){
        renderStudentQuestion(data.q || data);
      }
    } else if(data.type==='allq' && data.qs){
      if(typeof renderStudentMultiQ === 'function'){
        renderStudentMultiQ(data.qs);
      }
    } else if(data.type==='end'){
      const wrap = document.getElementById('studentCard');
      if(wrap) wrap.innerHTML = `<div class="student-success"><i class="fas fa-check-circle"></i><h3>انتهت الجلسة</h3><p>شكراً لمشاركتكِ</p></div>`;
    }
  }
}

function initStudentMode(){
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode');
  const code = params.get('code') || '';
  const topic = params.get('topic') || '';
  const qParam = params.get('q');
  let qData = null;
  try { if(qParam) qData = JSON.parse(decodeURIComponent(qParam)); } catch(e) { qData = null; }

  if(!mode){
    showStudentError('رابط غير مكتمل: يجب تحديد وضع الجلسة (mode).', '🔗');
    return;
  }
  if(!code){
    showStudentError('رابط غير مكتمل: يجب تحديد رمز الجلسة (code).', '🔢');
    return;
  }
  if(!topic){
    showStudentError('رابط غير مكتمل: يجب تحديد قناة الاتصال (topic).', '📡');
    return;
  }

  const validModes = ['student', 'poll', 'exit', 'live'];
  if(!validModes.includes(mode)){
    showStudentError('وضع غير معروف: "' + escapeHtml(mode) + '". الأوضاع المتاحة: ' + validModes.join(', ') + '.', '❓');
    return;
  }

  // ثبّت الـ state العام
  window._stuMode = mode;
  window._stuCode = code;
  window._stuTopic = topic;
  window._stuLastQuestion = null;
  window._stuSessionEnded = false;

  document.body.classList.add('student-mode');
  const tb = document.querySelector('.top-bar'); if(tb) tb.style.display='none';
  const cw = document.querySelector('.canvas-wrap'); if(cw) cw.style.display='none';
  const td = document.querySelector('.toolbar-dock'); if(td) td.style.display='none';
  document.querySelectorAll('.side-fab').forEach(el=>el.style.display='none');
  const cb = document.querySelector('.celebrate-bar'); if(cb) cb.classList.add('hidden');
  const mb = document.querySelector('.motivation-banner'); if(mb) mb.classList.add('hidden');
  const tbs = document.getElementById('topBarStudent'); if(tbs) tbs.style.display='flex';
  const sc = document.getElementById('studentContent'); if(sc){ sc.style.display='flex'; sc.classList.add('active'); }
  const label = document.getElementById('studentSessionLabel');
  if(label){
    const labels = {student:'الجلسة', poll:'الاستطلاع', exit:'تذكرة الخروج', live:'البث المباشر'};
    label.textContent = (labels[mode] || 'الجلسة') + ': ' + code;
  }

  // استدعِ الرندر حسب الوضع
  if(mode==='student'){
    renderStudentJoin(code, topic);
  } else if(mode==='poll'){
    // poll: لو عندنا qData من URL، اعرضي السؤال فوراً؛ وإلا شاشة انتظار
    if(qData && qData.title){
      renderStudentExit(qData.title, qData.options || qData.opts || [], qData);
    } else {
      renderStudentLive(code, topic);
    }
  } else if(mode==='exit'){
    if(qData && qData.title){
      renderStudentExit(qData.title, qData.options || qData.opts || [], qData);
    } else {
      renderStudentExit('في انتظار السؤال من المعلمة...', []);
    }
  } else if(mode==='live'){
    renderStudentLive(code, topic);
  }

  // اشترك في ntfy مع منطق إعادة الاتصال
  let reconAttempts = 0;
  const maxRecon = 5;
  function tryReconnect(){
    if(reconAttempts >= maxRecon){
      showStudentError('فشل الاتصال بالخادم بعد ' + maxRecon + ' محاولات. تحققي من اتصال الإنترنت وأعيدي المحاولة.', '📡');
      if(window._setStuStatus) window._setStuStatus('انقطع الاتصال','err');
      return;
    }
    reconAttempts++;
    try{
      if(window._stuChannel){ try{window._stuChannel.close();}catch(e){} window._stuChannel=null; }
      window._stuChannel = ntfySubscribe(topic, (data)=>{
        reconAttempts = 0;
        // خزّن السؤال الأخير
        if(data && (data.type==='newq'||data.type==='pollQ'||data.type==='exitQ'||data.type==='allq')){
          window._stuLastQuestion = data;
        } else if(data && (data.type==='end'||data.type==='pollEnd')){
          window._stuSessionEnded = true;
        }
        handleStudentMessage(data, mode);
        if(window._setStuStatus) window._setStuStatus('متصل','ok');
      }, {
        onOpen: ()=>{ reconAttempts = 0; if(window._setStuStatus) window._setStuStatus('متصل','ok'); },
        onError: ()=>{ if(window._setStuStatus) window._setStuStatus('إعادة المحاولة...','err'); }
      });
      window._stuPublish = (payload)=>ntfyPublish(topic, payload);
    }catch(e){
      console.warn('stu subscribe failed', e);
      setTimeout(tryReconnect, 2000);
    }
  }
  tryReconnect();

  // حدّث الـ badge الأولي
  const badge = document.getElementById('stuConnBadge');
  if(badge){
    badge.className = 'stu-conn-badge stu-conn-ok';
    badge.innerHTML = '<i class="fas fa-wifi"></i> متصل';
  }

  // فحص دوري (silent ping placeholder)
  setInterval(()=>{
    if(badge && badge.classList.contains('stu-conn-ok')){
      // يمكن إضافة فحص ping هنا لاحقاً
    }
  }, 30000);
}

/* ============================================================
   syncStuPollQuestion() — للطالبة: تعيد الاشتراك وتجلب آخر سؤالك
   يحل مشكلة "ntfy محجوب" أو "الرسالة وصلت قبل الأوان"
   - يغلق القناة الحالية
   - يعيد فتح SSE على نفس الـ topic (يجلب كل الرسائل منذ آخر id)
   - يتحقق من URL param (النسخة الاحتياطية)
   - يُستدعى يدوياً عبر زر "تحديث" أو تلقائياً بعد 5 ثوانٍ
   ============================================================ */
function syncStuPollQuestion(){
  if(!window._stuTopic) return;
  try{
    // أغلق القناة الحالية أولاً لتفادي التكرار
    if(window._stuChannel){try{window._stuChannel.close();}catch(e){} window._stuChannel=null;}
    // أعد الاشتراك (EventSource يلتقط since تلقائياً من _ntfyLastId)
    window._stuChannel = ntfySubscribe(window._stuTopic, (msg)=>{
      if(msg.type==='newq' || msg.type==='pollQ' || msg.type==='exitQ' || msg.type==='allq'){
        window._stuLastQuestion = msg;
      }else if(msg.type==='end' || msg.type==='pollEnd'){
        window._stuSessionEnded = true;
      }
      if(msg.type === 'livebus'){
        try{ LiveBus.handleIncomingNtfy(msg); }catch(e){ console.warn('stu livebus handle failed',e); }
      }
      if(!window._stuName) return;
      handleStuMessage(msg);
    }, {
      onOpen: ()=>{ if(window._setStuStatus) window._setStuStatus('متصل ✅','ok'); },
      onError: ()=>{ if(window._setStuStatus) window._setStuStatus('انقطع الاتصال — يعيد المحاولة...','err'); }
    });
    // احترازي: تحقق من URL — لو QR المُحدّث يحوي السؤال، اعرضيه فوراً
    const urlQ = parseQuestionFromUrl();
    if(urlQ && window._stuMode === 'poll' && urlQ.title && urlQ.options && urlQ.options.length){
      window._stuLastQuestion = {type:'pollQ', q:urlQ.title, opts:urlQ.options};
      if(window._stuName) renderStudentPoll(urlQ.title, urlQ.options);
      // أوقف المزامنة التلقائية لأننا وجدنا السؤال
      if(window._stuPollAutoSync){clearTimeout(window._stuPollAutoSync); window._stuPollAutoSync=null;}
    }
  }catch(e){
    console.warn('syncStuPollQuestion failed',e);
  }
}

/* معالج الرسائل الموحد (يُستدعى بعد الاشتراك) */
function handleStuMessage(msg){
  const mode = window._stuMode;
  if(!mode) return;
  if(mode==='exit'){
    if(msg.type==='exitQ'){
      const titleEl = document.getElementById('stuExitQText');
      if(titleEl) titleEl.textContent = msg.q || 'تقييم الفهم';
    }
  }else if(mode==='poll'){
    if(msg.type==='pollQ'){
      // ⭐ أوقف المزامنة التلقائية — وصلنا السؤال
      if(window._stuPollAutoSync){clearTimeout(window._stuPollAutoSync); window._stuPollAutoSync=null;}
      if(window._stuName) renderStudentPoll(msg.q, msg.opts);
    }
    if(msg.type==='pollEnd'){
      if(window._stuPollAutoSync){clearTimeout(window._stuPollAutoSync); window._stuPollAutoSync=null;}
      document.getElementById('studentCard').innerHTML=`<div class="student-success"><i class="fas fa-check-double"></i><h3>انتهى الاستطلاع</h3><p>شكراً ${escapeHtml(window._stuName)} على المشاركية!</p></div>`;
    }
  }else{
    if(msg.type==='newq'){
      if(window._stuName) renderStudentQuestion(msg.q);
    }
    if(msg.type==='allq'){
      if(window._stuName) renderStudentMultiQ(msg.qs);
    }
    if(msg.type==='end'){
      document.getElementById('studentCard').innerHTML=`<div class="student-success"><i class="fas fa-check-circle"></i><h3>انتهت الجلسة</h3><p>شكراً ${escapeHtml(window._stuName)}!</p></div>`;
    }
    // ⭐ بث الحل من المعلمة → اعرضيه للطالبة على جوالها
    if(msg.type==='solution'){
      if(window._stuName) renderStudentSolution(msg);
    }
  }
}

/* ============================================================
   ⭐⭐⭐ STUDENT-SIDE: تحدي السرعة عن بُعد (ألعاب تحفيزية) ⭐⭐⭐
   ------------------------------------------------------------
   تستقبل الطالبة (على جوالها) أحداث LiveBus من نوع:
   - games:speed:start   → اعرض زر "اضغطي هنا" كبير مع مؤقت
   - games:speed:end     → أخفِ الزر واعرض رسالة انتهاء
   - games:speed:winner  → اعرضي إعلان الفائز (+ رسالة خاصة لو الطالبة نفسها)
   ============================================================ */
function renderStudentSpeedChallenge(data){
  const card = document.getElementById('studentCard');
  if(!card) return;
  const myName = window._stuName || '';
  const duration = (data && data.duration) ? data.duration : 30;
  const question = (data && data.question) ? data.question : '';
  const students = (data && Array.isArray(data.students)) ? data.students : [];
  // لو المعلمة بثت قائمة طالبات وما كان اسم الطالبة بينها — نظهر تنبيه لطيف
  const inList = !myName || students.length === 0 || students.includes(myName);

  // مؤقت عدّ تنازلي للضغط (محلي عند الطالبة)
  const endAt = Date.now() + duration * 1000;
  window._stuSpeedEndAt = endAt;
  window._stuSpeedActive = true;

  const qBlock = question
    ? `<div class="stu-speed-q"><i class="fas fa-question-circle"></i> ${escapeHtml(question)}</div>`
    : '';
  const warnBlock = inList ? '' :
    `<div class="stu-speed-warn"><i class="fas fa-info-circle"></i> اسمك غير موجود في قائمة الحل — اضغطي واتأكدي مع المعلمة</div>`;

  card.innerHTML = `
    <div class="stu-speed-host">
      <div class="stu-speed-head">
        <span class="ssh-emoji">⚡</span>
        <span class="ssh-title">تحدي السرعة!</span>
      </div>
      ${qBlock}
      <div class="stu-speed-timer" id="stuSpeedTimer">${duration}</div>
      <button class="stu-speed-btn" id="stuSpeedBtn" type="button">
        <span class="ssb-emoji">✋</span>
        <span class="ssb-text">اضغطي هنا فوراً!</span>
      </button>
      ${warnBlock}
      <div class="stu-speed-hint"><i class="fas fa-bolt"></i> أول من تضغط هي الفائزة 🏆</div>
    </div>
  `;

  // زر الضغط
  const btn = document.getElementById('stuSpeedBtn');
  if(btn){
    let pressed = false;
    const press = (e) => {
      e.preventDefault();
      if(pressed) return;
      if(!window._stuSpeedActive) return;
      pressed = true;
      btn.classList.add('pressed');
      btn.querySelector('.ssb-text').textContent = 'تم الإرسال ✅';
      if(window._stuPublish){
        window._stuPublish({ type:'livebus', event:'games:speed:tap', data:{ name: window._stuName, ts: Date.now() } });
      } else {
        console.warn('No _stuPublish available');
      }
      // اهتزاز الجوال (إن أمكن)
      try{ if(navigator.vibrate) navigator.vibrate(120); }catch(e){}
    };
    btn.addEventListener('click', press);
    btn.addEventListener('touchstart', press, { passive:false });
  }

  // مؤقت تنازلي على الجوال
  if(window._stuSpeedTimerInt) clearInterval(window._stuSpeedTimerInt);
  window._stuSpeedTimerInt = setInterval(()=>{
    if(!window._stuSpeedActive){ clearInterval(window._stuSpeedTimerInt); return; }
    const left = Math.max(0, Math.round((window._stuSpeedEndAt - Date.now())/1000));
    const t = document.getElementById('stuSpeedTimer');
    if(t){
      t.textContent = left;
      t.className = 'stu-speed-timer' + (left <= 5 ? ' danger' : (left <= 10 ? ' warn' : ''));
    }
    if(left <= 0){
      clearInterval(window._stuSpeedTimerInt);
      window._stuSpeedActive = false;
      const b = document.getElementById('stuSpeedBtn');
      if(b){ b.classList.add('disabled'); b.querySelector('.ssb-text').textContent = 'انتهى الوقت ⏱️'; }
    }
  }, 250);
}

function endStudentSpeedChallenge(winnerName){
  window._stuSpeedActive = false;
  if(window._stuSpeedTimerInt){ clearInterval(window._stuSpeedTimerInt); window._stuSpeedTimerInt = null; }
  const card = document.getElementById('studentCard');
  if(!card) return;
  const myName = window._stuName || '';
  const iWon = winnerName && myName && (winnerName === myName);
  if(iWon){
    card.innerHTML = `
      <div class="stu-speed-end win">
        <div class="sse-emoji">🏆</div>
        <h2>أنتِ الفائزة!</h2>
        <p>أحسنتِ، كنتي الأسرع في الحل ⚡</p>
        <div class="sse-msg">في انتظار الجولة التالية من المعلمة...</div>
      </div>`;
    // صوت احتفال
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      if(AC){
        const ctx = new AC();
        [523,659,784,1047].forEach((f,i)=>setTimeout(()=>{
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type='triangle';
          o.frequency.value = f;
          g.gain.setValueAtTime(0, ctx.currentTime);
          g.gain.linearRampToValueAtTime(0.18, ctx.currentTime+0.02);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.3);
          o.connect(g); g.connect(ctx.destination);
          o.start(); o.stop(ctx.currentTime+0.3);
        }, i*100));
      }
    }catch(e){}
    try{ if(navigator.vibrate) navigator.vibrate([120, 80, 120, 80, 200]); }catch(e){}
  } else if(winnerName){
    card.innerHTML = `
      <div class="stu-speed-end lose">
        <div class="sse-emoji">👏</div>
        <h2>${escapeHtml(winnerName)} هي الأسرع</h2>
        <p>حظاً أوفر في الجولة التالية ⚡</p>
        <div class="sse-msg">استعدّي للتحدي القادم...</div>
      </div>`;
  } else {
    // انتهى الوقت بدون فائز
    card.innerHTML = `
      <div class="stu-speed-end empty">
        <div class="sse-emoji">⏱️</div>
        <h2>انتهى الوقت</h2>
        <p>لا أحد ضغط أولاً هذه المرة</p>
        <div class="sse-msg">استعدّي للجولة التالية...</div>
      </div>`;
  }
}

// ⭐ اشترك بأحداث LiveBus على جانب الطالبة — يعمل فقط لو الطالبة انضمت للجلسة
function _stuBindLiveBusGames(){
  if(window._stuBusBound) return;
  window._stuBusBound = true;
  LiveBus.on('games:speed:start', (data)=>{
    if(!window._stuName) return;        // لازم تكون دخلت اسمها
    if(window._stuMode !== 'student') return;  // فقط في وضع الجلسة المباشرة
    renderStudentSpeedChallenge(data);
  });
  LiveBus.on('games:speed:end', (data)=>{
    if(!window._stuName) return;
    if(window._stuMode !== 'student') return;
    endStudentSpeedChallenge(data && data.winner);
  });
  LiveBus.on('games:speed:winner', (data)=>{
    if(!window._stuName) return;
    if(window._stuMode !== 'student') return;
    endStudentSpeedChallenge(data && data.name);
  });
}

/* ⭐ اعرضي الحل (الإجابة الصحيحة) للطالبة بعد بث المعلمة له
   تظهر بعد الإجابة كشريط بارز — مع توضيح هل إجابتها صحيحة أو خاطئة */
function renderStudentSolution(msg){
  const card = document.getElementById('studentCard');
  if(!card) return;
  const letters=['أ','ب','ج','د','هـ','و','ز','ح'];

  // ضعي multi-Q: الحل لسؤالك معيّن (qRef) — ناعرضي بطاقة منبثقة على السؤال
  if(msg.qRef !== undefined && msg.qRef !== null){
    const qIdx = msg.qRef;
    const item = document.getElementById('stuMultiQItem_' + qIdx);
    if(item){
      // ضع شريط حل أسفل عنوان السؤال
      let solDiv = item.querySelector('.smqi-solution');
      if(!solDiv){
        solDiv = document.createElement('div');
        solDiv.className = 'smqi-solution';
        // أدخليه بعد smqi-head
        const head = item.querySelector('.smqi-head');
        if(head) head.insertAdjacentElement('afterend', solDiv);
      }
      const solLetter = msg.correctLetter || (letters[msg.correctIndex]||'');
      const solText = msg.correctText || '';
      const myAns = (window._stuMyAnswers||{})[qIdx] || '';
      const myIdx = myAns ? letters.indexOf(myAns.trim().charAt(0)) : -1;
      const isMine = (myIdx >= 0 && msg.correctIndex !== undefined && myIdx === msg.correctIndex);
      let mineStatus = '';
      if(myAns){
        mineStatus = isMine
          ? `<div class="smqi-mine ok"><i class="fas fa-check-circle"></i> إجابتك صحيحة ✓</div>`
          : `<div class="smqi-mine bad"><i class="fas fa-times-circle"></i> إجابتك خاطئة ✗ — إجابتك: ${escapeHtml(myAns)}</div>`;
      }
      solDiv.innerHTML = `
        <div class="smqi-sol-head"><i class="fas fa-lightbulb"></i> كشفتِ المعلمة الحل</div>
        ${mineStatus}
        <div class="smqi-sol-ans"><b>الحل الصحيح: ${solLetter}</b> — ${escapeHtml(solText)}</div>`;
      // صوت تنبيه
      try{
        const AC = window.AudioContext || window.webkitAudioContext;
        if(AC){
          const ctx = new AC();
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type='sine';
          o.frequency.setValueAtTime(isMine?880:520, ctx.currentTime);
          g.gain.setValueAtTime(0, ctx.currentTime);
          g.gain.linearRampToValueAtTime(0.12, ctx.currentTime+0.02);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.4);
          o.connect(g); g.connect(ctx.destination);
          o.start(); o.stop(ctx.currentTime+0.4);
        }
      }catch(e){}
    }
    return;
  }

  // ضعي single-Q: الحل للسؤالك الحالي
  const myAnswer = window._stuMyAnswer || null;
  const myIdx = myAnswer ? letters.indexOf((myAnswer||'').trim().charAt(0)) : -1;
  const isMineCorrect = (myIdx >= 0 && msg.correctIndex !== undefined && myIdx === msg.correctIndex);
  let mineStatus = '';
  if(myAnswer){
    if(isMineCorrect){
      mineStatus = `<div class="stu-sol-mine stu-sol-correct"><i class="fas fa-check-circle"></i> إجابتك صحيحة ✓</div>`;
    }else{
      mineStatus = `<div class="stu-sol-mine stu-sol-wrong"><i class="fas fa-times-circle"></i> إجابتك خاطئة ✗ (${escapeHtml(myAnswer)})</div>`;
    }
  }else{
    mineStatus = `<div class="stu-sol-mine"><i class="fas fa-info-circle"></i> لم تجيبي بعد</div>`;
  }
  // بناء HTML للحل
  const optsHtml = (msg.options||[]).map((o,i)=>{
    const isCorrect = (i === msg.correctIndex);
    return `<div class="stu-sol-opt ${isCorrect?'stu-sol-opt-correct':''}"><span class="stu-sol-letter">${letters[i]||(i+1)}</span><span>${escapeHtml(o)}</span>${isCorrect?'<i class="fas fa-check" style="color:#27ae60;margin-right:auto"></i>':''}</div>`;
  }).join('');
  // ااعرضي شريط الحل في الأعلى
  const html = `
    <div class="stu-solution-box">
      <div class="stu-sol-head"><i class="fas fa-lightbulb"></i> كشفتِ المعلمة الحل</div>
      ${mineStatus}
      <div class="stu-sol-q">${escapeHtml(msg.qTitle||'السؤال')}</div>
      <div class="stu-sol-list">${optsHtml}</div>
      <div class="stu-sol-wait">في انتظار السؤال التالي...</div>
    </div>`;
  card.innerHTML = html;
  // إشعار صوتي لطيف
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    if(AC){
      const ctx = new AC();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type='sine';
      o.frequency.setValueAtTime(isMineCorrect?880:520, ctx.currentTime);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.15, ctx.currentTime+0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.5);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime+0.5);
    }
  }catch(e){}
}

/* stuPasteAndGo() — لو الطالبة لصقت رابط في حقل "ما زال ما يشتغل"، حلّلي الرابط وانقليها
   يتعامل مع: URL كامل، أو مجرد query string (?mode=poll&code=...) */
function stuPasteAndGo(){
  const ta = document.getElementById('stuPasteUrl');
  if(!ta) return;
  let raw = ta.value.trim();
  if(!raw){toast('error','الصقيي الرابط أولاً');return;}
  // لو فيه URL كامل + query
  let searchPart = '';
  try{
    if(raw.startsWith('?') || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('file://')){
      const u = new URL(raw, location.href);
      searchPart = u.search;
    } else {
      // افترضي: مجرد كود
      const code = raw.toUpperCase().trim();
      if(code.length >= 4 && code.length <= 12){
        searchPart = '?mode=poll&code='+encodeURIComponent(code);
        toast('info','بحث بالكود: '+code+' — لو ما اشتغل، ابعثي رابط كامل من المعلمة');
      } else {
        toast('error','الرابط غير صحيح — ابعثي رابط كامل من المعلمة');
        return;
      }
    }
  }catch(e){
    // محاولة أخيرة: استخراج ? يدوياً
    const qIdx = raw.indexOf('?');
    if(qIdx >= 0) searchPart = raw.substring(qIdx);
    else {
      toast('error','الرابط غير مفهوم — ابعثي رابط كامل من المعلمة');
      return;
    }
  }
  // انتقل لنفس الصفحة مع الـ query الجديد (سيُعيد initStudentMode)
  const baseUrl = 'https://so335.github.io/sabora/';
  window.location.href = baseUrl + searchPart;
}

function studentJoin(code,mode){
  const name=document.getElementById('stuNameInput').value.trim();
  if(!name){toast('error','أدخلي اسمك');return;}
  window._stuName=name;window._stuCode=code;

  // إذا الجلسة انتهت (buffer وصل end)
  if(window._stuSessionEnded){
    document.getElementById('studentCard').innerHTML=`<div class="student-success"><i class="fas fa-check-circle"></i><h3>انتهت الجلسة</h3><p>شكراً ${escapeHtml(name)}!</p></div>`;
    return;
  }

  // أرسل join فوراً (المعلمة تعرف إن الطالبة دخلت)
  if(window._stuPublish){
    window._stuPublish({type:'join', name:name, ts:Date.now()});
  }

  // ⭐ شغّل معالجات المغادرة — حتى لو الطالبة سكّرت الصفحة نعرف المعلمة
  setupStuLeaveHandlers();

  // ااعرضي الـ UI حسب الـ mode، مع إظهار السؤال المخزّن (إن وُجد)
  if(mode==='exit'){
    const initialQ = (window._stuLastQuestion && window._stuLastQuestion.type==='exitQ') ? window._stuLastQuestion.q : 'في انتظار السؤال من المعلمة...';
    document.getElementById('studentCard').innerHTML=`
      <div class="stu-q-hero" style="background:linear-gradient(135deg,#e67e22,#d35400)">
        <div class="sgh-label"><i class="fas fa-ticket-alt"></i> تذكرة الخروج</div>
        <div class="sgh-title" id="stuExitQText">${escapeHtml(initialQ)}</div>
        <div class="sgh-meta"><span class="sgh-pill"><i class="fas fa-graduation-cap"></i> تقييم نهاية الحصة</span></div>
      </div>
      <p style="text-align:center;color:#666;margin-bottom:10px;font-weight:700">اختاري مستوى فهميك:</p>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
        <button class="btn btn-success btn-lg" onclick="submitExitTicket('كلياً')" style="flex-direction:column;padding:18px 8px"><span style="font-size:2.2rem">😊</span><span>كلياً</span></button>
        <button class="btn btn-warning btn-lg" onclick="submitExitTicket('جزئياً')" style="flex-direction:column;padding:18px 8px"><span style="font-size:2.2rem">😐</span><span>جزئياً</span></button>
        <button class="btn btn-danger btn-lg" onclick="submitExitTicket('لا')" style="flex-direction:column;padding:18px 8px"><span style="font-size:2.2rem">😕</span><span>لا</span></button>
      </div>
      <p style="text-align:center;color:#888;font-size:.85rem;margin-bottom:8px">أو اكتبي إجابتك بحرية:</p>
      <textarea class="student-text-input" id="exitCustomAnswer" placeholder="إجابتكِ حرة (اختاري)"></textarea>
      <button class="btn btn-primary btn-block" onclick="submitExitTicketCustom()"><i class="fas fa-paper-plane"></i> إرسال الإجابة</button>`;
  }else if(mode==='poll'){
    // لو وصل سؤالك قبل ما تكتب الاسم، ااعرضيه فوراً
    if(window._stuLastQuestion && window._stuLastQuestion.type==='pollQ'){
      renderStudentPoll(window._stuLastQuestion.q, window._stuLastQuestion.opts);
    }else{
      document.getElementById('studentCard').innerHTML=`
        <div class="stu-q-hero" style="background:linear-gradient(135deg,#7b1fa2,#4a148c)">
          <div class="sgh-label"><i class="fas fa-vote-yea"></i> استطلاع</div>
          <div class="sgh-title">في انتظار بدء الاستطلاع من المعلمة...</div>
        </div>
        <div class="student-waiting">
          <div class="spin"><i class="fas fa-hourglass-half"></i></div>
          <h3 style="color:#fff">أهلاً ${escapeHtml(name)}! 👋</h3>
          <p style="color:#eee;font-size:.85rem;margin:6px 0 14px">لو المعلمة بدأت الاستطلاع بالفعل، اضغطي الزر للبحث عن سؤالك</p>
          <button class="btn btn-primary btn-lg" onclick="syncStuPollQuestion()" style="margin-top:4px"><i class="fas fa-sync"></i> تحديث / ابحثي عن سؤالك</button>
          <details style="margin-top:14px;text-align:right">
            <summary style="color:#fff;cursor:pointer;font-size:.85rem;padding:6px;background:rgba(0,0,0,.2);border-radius:6px">🔧 ما زال ما يشتغل؟ جربي لصق رابط جديد</summary>
            <div style="background:rgba(255,255,255,.95);padding:10px;border-radius:8px;margin-top:8px">
              <p style="font-size:.78rem;color:#444;margin-bottom:6px">📋 انسخي الرابط من رسالة المعلمة في واتساب والصقيه هنا:</p>
              <textarea id="stuPasteUrl" placeholder="https://...او?mode=poll&code=..." style="width:100%;min-height:60px;font-size:.7rem;direction:ltr;text-align:left;padding:6px;border:1px solid #ccc;border-radius:4px;resize:vertical"></textarea>
              <button class="btn btn-success btn-sm" onclick="stuPasteAndGo()" style="margin-top:6px;width:100%"><i class="fas fa-arrow-right"></i> اذهبي للرابط</button>
            </div>
          </details>
        </div>`;
      // ⭐ FIX: مزامنة تلقائية بعد 4 ثوانٍ لو ما وصل سؤالك — يحل مشكلة "ntfy محجوب" أو تأخر الرسالة
      if(window._stuPollAutoSync){clearTimeout(window._stuPollAutoSync); window._stuPollAutoSync=null;}
      window._stuPollAutoSync = setTimeout(()=>{
        if(!window._stuLastQuestion || window._stuLastQuestion.type !== 'pollQ'){
          syncStuPollQuestion();
        }
      }, 4000);
      // ⭐ مزامنات إضافية عند 8 و 15 ثانية — أكثر عدوانية في إعادة المحاولة
      window._stuPollAutoSync2 = setTimeout(()=>{
        if(!window._stuLastQuestion || window._stuLastQuestion.type !== 'pollQ'){
          syncStuPollQuestion();
        }
      }, 8000);
      window._stuPollAutoSync3 = setTimeout(()=>{
        if(!window._stuLastQuestion || window._stuLastQuestion.type !== 'pollQ'){
          syncStuPollQuestion();
        }
      }, 15000);
    }
  }else{
    // live mode
    if(window._stuLastQuestion && window._stuLastQuestion.type==='allq' && window._stuLastQuestion.qs){
      renderStudentMultiQ(window._stuLastQuestion.qs);
    } else if(window._stuLastQuestion && window._stuLastQuestion.type==='newq' && window._stuLastQuestion.q){
      renderStudentQuestion(window._stuLastQuestion.q);
    }else{
      renderStudentQuestion();
    }
  }
}

/* ⭐ معالجات مغادرة الطالبة — نُرسل "leave" للمعلمة عند إغلاق/تحديث/إخفاء الصفحة
   نستخدم navigator.sendBeacon للإغلاق (مضمون حتى لو تم قتل الـ JS)
   و fetch عادي مع keepalive لـ beforeunload العادي */
let _stuLeaveHandlersInstalled = false;
let _stuLeftSent = false;
function setupStuLeaveHandlers(){
  if(_stuLeaveHandlersInstalled) return;
  _stuLeaveHandlersInstalled = true;
  const topic = window._stuTopic;
  const name = window._stuName;
  if(!topic || !name) return;
  const payload = JSON.stringify({type:'leave', name:name, ts:Date.now()});
  // ntfy يقبل POST مع body كنص — استخدم الـ active base (مع fallback للحجب)
  const base = _ntfyActiveBase[topic] || NTFY_BASE;
  _ntfyActiveBase[topic] = base;
  const url = `${base}/${topic}`;
  // sendBeacon (الأضمن عند إغلاق الصفحة)
  const sendBeacon = ()=>{
    if(_stuLeftSent) return;
    try{
      const ok = navigator.sendBeacon && navigator.sendBeacon(url, new Blob([payload], {type:'text/plain'}));
      if(ok) _stuLeftSent = true;
    }catch(e){}
  };
  // fetch مع keepalive (احتياطي)
  const sendFetch = ()=>{
    if(_stuLeftSent) return;
    try{
      fetch(url, {method:'POST', body:payload, headers:{'Content-Type':'text/plain'}, keepalive:true});
      _stuLeftSent = true;
    }catch(e){}
  };
  window.addEventListener('beforeunload', sendFetch);
  window.addEventListener('pagehide', sendBeacon);
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden') sendBeacon();
  });
  // عند تركيز النافذة — نسمح بإرسال leave جديد (لو الطالبة رجعت ثم خرجت)
  window.addEventListener('focus', ()=>{ _stuLeftSent = false; });
}
function renderStudentPoll(q,opts){
  const card=document.getElementById('studentCard');
  const letters=['أ','ب','ج','د','هـ','و','ز','ح'];
  const o=(opts||[]).filter(Boolean);
  card.innerHTML=`
    <div class="stu-q-hero" style="background:linear-gradient(135deg,#7b1fa2,#4a148c)">
      <div class="sgh-label"><i class="fas fa-vote-yea"></i> استطلاع من المعلمة</div>
      <div class="sgh-title">${escapeHtml(q||'في انتظار بدء الاستطلاع...')}</div>
      <div class="sgh-meta"><span class="sgh-pill"><i class="fas fa-list-ol"></i> ${o.length} خيارات</span></div>
    </div>
    <div class="stu-choices">${o.map((x,i)=>`<div class="stu-choice" onclick="submitPollVote(this,${i})"><span class="sc-letter">${letters[i]||(i+1)}</span><span class="sc-text">${escapeHtml(x)}</span></div>`).join('')}</div>`;
}

/* ⭐ renderStudentExit() — ياعرضي تذكرة الخروج على جوال الطالبة (مع أو بدون خيارات)
   يقبل ثلاث أنماط من الاستدعاء:
     - renderStudentExit(q, opts)
     - renderStudentExit(code, topic, qData)              ← من initStudentMode
     - renderStudentExit(q, opts, qData) (توسعة مستقبلية) */
function renderStudentExit(q, opts, qData){
  const wrap = document.getElementById('studentCard');
  if(!wrap) return;
  // تطبيع المُدخلات: لو كان qData موجوداً (الاستدعاء الجديد) استخرج السؤال/الخيارات منه
  if(qData && typeof qData === 'object'){
    q = (qData.title || qData.q || q || 'تقييم الفهم');
    opts = (qData.options || qData.opts || opts || []);
  } else if(Array.isArray(q) && typeof opts === 'string'){
    // renderStudentExit(code, topic, qData) — args بترتيب غلط: q=code, opts=topic
    q = (qData && (qData.title || qData.q)) || 'تقييم الفهم';
    opts = (qData && (qData.options || qData.opts)) || [];
  }
  if(typeof q !== 'string') q = 'تقييم الفهم';
  let html = '<div class="student-q-display" style="text-align:right"><div class="sq-title">'+escapeHtml(q)+'</div>';
  if(opts && opts.length){
    html += '<div class="sq-opts">';
    opts.forEach((o,i)=>{
      html += '<div class="sq-opt" onclick="submitExitAnswer(this)"><span class="sq-letter">'+String.fromCharCode(65+i)+'</span><span class="sq-text">'+escapeHtml(o)+'</span></div>';
    });
    html += '</div>';
  } else {
    html += '<textarea class="student-text-input" id="exitTextAns" placeholder="اكتبي إجابتكِ هنا..."></textarea>';
    html += '<button class="btn btn-primary btn-block" onclick="submitExitText()" style="margin-top:10px"><i class="fas fa-paper-plane"></i> إرسال الإجابة</button>';
  }
  html += '</div>';
  wrap.innerHTML = html;
}

/* ⭐ submitExitAnswer() — إرسال إجابة MCQ لتذكرة الخروج */
function submitExitAnswer(el){
  if(!window._stuPublish){toast('error','لا يوجد اتصال');return;}
  if(el.dataset.submitted) return;
  el.dataset.submitted = '1';
  el.classList.add('selected');
  document.querySelectorAll('.sq-opt').forEach(o=>o.style.pointerEvents='none');
  const text = el.querySelector('.sq-text')?.textContent || el.textContent || '';
  const qEl = document.querySelector('.sq-title');
  const qText = qEl ? qEl.textContent : 'تقييم الفهم';
  window._stuPublish({type:'answer', name: window._stuName || 'طالبة', answer: text, q: qText, ts: Date.now()});
  const card = document.getElementById('studentCard');
  if(card){
    setTimeout(()=>{
      card.innerHTML = `<div class="student-success"><i class="fas fa-check-circle"></i><h3>شكراً ${escapeHtml(window._stuName||'')}!</h3><p>تم تسجيل إجابتك ✅</p></div>`;
    }, 600);
  }
}

/* ⭐ submitExitText() — إرسال إجابة نصية حرة لتذكرة الخروج */
function submitExitText(){
  const ta = document.getElementById('exitTextAns');
  if(!ta) return;
  const t = ta.value.trim();
  if(!t){toast('error','اكتبي إجابتكِ');return;}
  if(!window._stuPublish){toast('error','لا يوجد اتصال');return;}
  const qEl = document.querySelector('.sq-title');
  const qText = qEl ? qEl.textContent : 'تقييم الفهم';
  window._stuPublish({type:'answer', name: window._stuName || 'طالبة', answer: t, q: qText, ts: Date.now()});
  const card = document.getElementById('studentCard');
  if(card){
    card.innerHTML = `<div class="student-success"><i class="fas fa-check-circle"></i><h3>شكراً ${escapeHtml(window._stuName||'')}!</h3><p>تم تسجيل إجابتك ✅</p></div>`;
  }
}
function submitPollVote(el,optionIdx){
  if(el.dataset.voted)return;
  document.querySelectorAll('.sq-opt').forEach(o=>o.style.pointerEvents='none');
  el.dataset.voted=1;
  el.classList.add('selected');
  if(window._stuPublish){
    if(!window._stuName || window._stuName.trim()===''){
      toast('error','اكتبي اسمكِ أولاً');
      return;
    }
    window._stuPublish({type:'vote', student: window._stuName, name: window._stuName, option: optionIdx, ts: Date.now()});
  }
  setTimeout(()=>{
    document.getElementById('studentCard').innerHTML=`<div class="student-success"><i class="fas fa-check-circle"></i><h3>شكراً ${window._stuName}!</h3><p>تم تسجيل صوتك ✅</p></div>`;
  },800);
}
function submitExitTicket(answer){
  if(!window._stuPublish)return;
  if(!window._stuName || window._stuName.trim()===''){
    toast('error','اكتبي اسمكِ أولاً');
    return;
  }
  const qEl = document.getElementById('stuExitQText');
  const qText = qEl ? qEl.textContent : 'تقييم الفهم';
  window._stuPublish({type:'answer', student: window._stuName, name: window._stuName, answer: answer, q: qText, ts: Date.now()});
  document.getElementById('studentCard').innerHTML=`<div class="student-success"><i class="fas fa-check-circle"></i><h3>شكراً ${window._stuName}!</h3><p>تم تسجيل إجابتك ✅</p><p style="font-size:.85rem;color:#666;margin-top:8px">يمكنك أغلقي هذه الصفحة</p></div>`;
}
function submitExitTicketCustom(){
  const t=document.getElementById('exitCustomAnswer').value.trim();
  if(!t){toast('error','اكتبي إجابتكِ');return;}
  if(!window._stuName || window._stuName.trim()===''){
    toast('error','اكتبي اسمكِ أولاً');
    return;
  }
  if(!window._stuPublish)return;
  const qEl = document.getElementById('stuExitQText');
  const qText = qEl ? qEl.textContent : 'إجابتكِ حرة';
  window._stuPublish({type:'answer', student: window._stuName, name: window._stuName, answer: t, q: qText, ts: Date.now()});
  document.getElementById('studentCard').innerHTML=`<div class="student-success"><i class="fas fa-check-circle"></i><h3>شكراً ${window._stuName}!</h3><p>تم تسجيل إجابتك ✅</p></div>`;
}
function renderStudentQuestion(q){
  const card=document.getElementById('studentCard');
  if(!q){q={title:'في انتظار السؤال من المعلمة...',options:[]}}
  if(!q.options||!q.options.length){
    card.innerHTML=`
      <div class="stu-q-hero">
        <div class="sgh-label"><i class="fas fa-broadcast-tower"></i> سؤالك مباشر من المعلمة</div>
        <div class="sgh-title">${escapeHtml(q.title||'في انتظار السؤال من المعلمة...')}</div>
        <div class="sgh-meta"><span class="sgh-pill live"><i class="fas fa-circle" style="color:#2ecc71"></i> مباشر</span><span class="sgh-pill"><i class="fas fa-keyboard"></i> نص حر</span></div>
        <div class="stu-sync-row"><span>معرف الجلسة: ${escapeHtml(window._stuCode||'')}</span><button onclick="syncStudentQuestion()"><i class="fas fa-sync"></i> تحديث السؤال</button></div>
      </div>
      <textarea class="student-text-input" id="stuAnswer" placeholder="اكتبي إجابتك هنا..."></textarea>
      <button class="btn btn-success btn-block btn-lg" onclick="submitStudentAnswer()"><i class="fas fa-paper-plane"></i> إرسال الإجابة</button>`;
  }else{
    const letters=['أ','ب','ج','د','هـ','و','ز','ح'];
    const opts=q.options.filter(o=>o);
    card.innerHTML=`
      <div class="stu-q-hero">
        <div class="sgh-label"><i class="fas fa-broadcast-tower"></i> سؤالك مباشر من المعلمة</div>
        <div class="sgh-title">${escapeHtml(q.title||'في انتظار السؤال من المعلمة...')}</div>
        <div class="sgh-meta"><span class="sgh-pill live"><i class="fas fa-circle" style="color:#2ecc71"></i> مباشر</span><span class="sgh-pill"><i class="fas fa-list-ol"></i> ${opts.length} خيارات</span></div>
        <div class="stu-sync-row"><span>معرف الجلسة: ${escapeHtml(window._stuCode||'')}</span><button onclick="syncStudentQuestion()"><i class="fas fa-sync"></i> تحديث السؤال</button></div>
      </div>
      <div class="stu-choices">${opts.map((o,i)=>`<div class="stu-choice" data-idx="${i}" onclick="selectStudentOption(this,${i})"><span class="sc-letter">${letters[i]||(i+1)}</span><span class="sc-text">${escapeHtml(o)}</span></div>`).join('')}</div>
      <div class="stu-q-actions"><button class="btn btn-success btn-block btn-lg" id="stuSubmitBtn" onclick="submitStudentOption()" disabled><i class="fas fa-paper-plane"></i> إرسال الإجابة</button></div>`;
  }
}

/* renderStudentMultiQ() — ياعرضي كل الأسئلة دفعة على جوال الطالبة
   qs: array of {pos, title, options, freeText} */
function renderStudentMultiQ(qs){
  const card=document.getElementById('studentCard');
  if(!qs || !qs.length){
    card.innerHTML=`<div class="stu-q-hero"><div class="sgh-label"><i class="fas fa-bars-staggered"></i> ضعي الكل معاً</div><div class="sgh-title">في انتظار الأسئلة من المعلمة...</div></div>`;
    return;
  }
  const letters=['أ','ب','ج','د','هـ','و','ز','ح'];
  // بناء عناصر القائمة
  const itemsHtml = qs.map((q, i) => {
    const opts = (q.options||[]).filter(Boolean);
    const isFree = !opts.length;
    const optsHtml = isFree ? '' : `<div class="smqi-choices">${opts.map((o, j) => `<div class="stu-choice" data-qidx="${i}" data-optidx="${j}" onclick="selectMultiQOption(this,${i},${j})"><span class="sc-letter">${letters[j]||(j+1)}</span><span class="sc-text">${escapeHtml(o)}</span></div>`).join('')}</div>`;
    const freeHtml = isFree ? `<textarea class="smqi-text-input" id="stuMultiQAns_${i}" placeholder="اكتبي إجابتك للسؤالك ${i+1} هنا..." data-qidx="${i}"></textarea>` : '';
    const submitBtn = isFree ? `<button class="btn btn-success" onclick="submitMultiQAnswerFree(${i})" data-qidx="${i}" id="stuMultiQSubmit_${i}"><i class="fas fa-paper-plane"></i> إرسال</button>` : `<button class="btn btn-success" disabled onclick="submitMultiQAnswer(${i})" id="stuMultiQSubmit_${i}" data-qidx="${i}"><i class="fas fa-paper-plane"></i> إرسال</button>`;
    return `<div class="stu-multiq-item" id="stuMultiQItem_${i}" data-qidx="${i}">
      <div class="smqi-head">
        <div class="smqi-num">${i+1}</div>
        <div class="smqi-title">${escapeHtml(q.title||'سؤالك '+(i+1))}</div>
        <div class="smqi-status" id="stuMultiQStatus_${i}">لم يُجَب</div>
      </div>
      ${optsHtml}
      ${freeHtml}
      <div class="smqi-actions">${submitBtn}</div>
    </div>`;
  }).join('');

  card.innerHTML = `
    <div class="stu-q-hero" style="background:linear-gradient(135deg,#16a085,#0e6655)">
      <div class="sgh-label"><i class="fas fa-bars-staggered"></i> ضعي الكل معاً</div>
      <div class="sgh-title">${qs.length} سؤالك — أجيبي عن كل واحد</div>
      <div class="sgh-meta"><span class="sgh-pill live"><i class="fas fa-circle" style="color:#2ecc71"></i> مباشر</span><span class="sgh-pill"><i class="fas fa-list-ol"></i> ${qs.length} أسئلة</span></div>
      <div class="stu-sync-row"><span>معرف الجلسة: ${escapeHtml(window._stuCode||'')}</span><button onclick="syncStudentQuestion()"><i class="fas fa-sync"></i> تحديث</button></div>
    </div>
    <div class="stu-multiq-wrap">${itemsHtml}</div>
    <div id="stuMultiQSummary"></div>`;
}

/* selectMultiQOption: تختار خيار في سؤالك معيّن (i = question index) */
function selectMultiQOption(el, qIdx, optIdx){
  // ألغِ حدّدي الباقي في نفس السؤال
  const item = document.getElementById('stuMultiQItem_' + qIdx);
  if(!item) return;
  item.querySelectorAll('.stu-choice').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  window['_stuMultiQSel_' + qIdx] = optIdx;
  const btn = document.getElementById('stuMultiQSubmit_' + qIdx);
  if(btn) btn.disabled = false;
}

/* submitMultiQAnswer: إرسال إجابتكِ سؤالك اختاري (MCQ) */
function submitMultiQAnswer(qIdx){
  const optIdx = window['_stuMultiQSel_' + qIdx];
  if(optIdx === undefined || optIdx === null){toast('error','اختاري إجابتكِ');return;}
  const letters = ['أ','ب','ج','د','هـ','و','ز','ح'];
  // نص الخيار (للاعرضي في رسالة المعلمة)
  const item = document.getElementById('stuMultiQItem_' + qIdx);
  const choiceEl = item ? item.querySelector('.stu-choice.selected') : null;
  const optText = choiceEl ? choiceEl.textContent.trim() : '';
  // استخرج معرّف السؤال (من URL qs أو الـ pos)
  const qs = (window._stuLastQuestion && window._stuLastQuestion.qs) || [];
  const q = qs[qIdx] || {};
  // qRef: نرسل pos (المؤشر في القائمة الفرعية للمعلمة) لتعرف المعلمة أي سؤالك
  sendMultiQAnswer(qIdx, letters[optIdx] + ' - ' + optText);
}

/* submitMultiQAnswerFree: إرسال إجابتكِ سؤالك نص حر */
function submitMultiQAnswerFree(qIdx){
  if(!window._stuName || window._stuName.trim()===''){
    toast('error','اكتبي اسمكِ أولاً');
    return;
  }
  const ta = document.getElementById('stuMultiQAns_' + qIdx);
  if(!ta){return;}
  const t = ta.value.trim();
  if(!t){toast('error','اكتبي إجابتكِ');return;}
  sendMultiQAnswer(qIdx, t);
}

/* sendMultiQAnswer: ينشر الإجابة لـ ntfy مع qRef (مؤشر السؤال) */
function sendMultiQAnswer(qIdx, answerText){
  if(!window._stuPublish){toast('error','لا يوجد اتصال');return;}
  if(!window._stuName || window._stuName.trim()===''){
    toast('error','اكتبي اسمكِ أولاً');
    return;
  }
  // ⭐ ناحفظي إجابات الطالبة محلياً عشان نقارنها مع الحلول عند بثها
  if(!window._stuMyAnswers) window._stuMyAnswers = {};
  window._stuMyAnswers[qIdx] = answerText;
  window._stuPublish({
    type:'answer',
    student: window._stuName,
    name: window._stuName,
    answer: answerText,
    time: formatTime(new Date().toISOString()),
    qRef: qIdx, // مؤثر السؤال في القائمة الفرعية
    ts: Date.now()
  });
  // علّم السؤال كـ "أُجيب عنه" في الـ UI
  const item = document.getElementById('stuMultiQItem_' + qIdx);
  if(item) item.classList.add('answered');
  const status = document.getElementById('stuMultiQStatus_' + qIdx);
  if(status){ status.textContent = '✅ تم الإرسال'; }
  // عطّل زر الإرسال لمنع الإرسال المكرر
  const btn = document.getElementById('stuMultiQSubmit_' + qIdx);
  if(btn) btn.disabled = true;
  // تحققي هل كل الأسئلة تم الإجابة عنها
  const totalItems = document.querySelectorAll('.stu-multiq-item').length;
  const answeredItems = document.querySelectorAll('.stu-multiq-item.answered').length;
  if(totalItems > 0 && answeredItems === totalItems){
    const summary = document.getElementById('stuMultiQSummary');
    if(summary && !summary.innerHTML){
      summary.innerHTML = `<div class="stu-multiq-summary"><h3>🎉 أحسنتِ! أتممتِ كل الأسئلة</h3><p>شكراً ${escapeHtml(window._stuName||'')} — إجاباتك وصلت للمعلمة</p></div>`;
    }
  }
}

/* syncStudentQuestion() — تسحب آخر سؤالك من السيرفر (للطالبة لو فقدته) */
function syncStudentQuestion(){
  if(!window._stuTopic){toast('error','لا يوجد اتصال');return;}
  // أعد الاشتراك لجلب آخر الرسائل (SSE + since)
  if(window._stuChannel){try{window._stuChannel.close();}catch(e){} window._stuChannel=null;}
  window._stuChannel = ntfySubscribe(window._stuTopic, (msg)=>{
    if(msg.type==='newq'){ window._stuLastQuestion=msg; if(window._stuName) renderStudentQuestion(msg.q); }
    if(msg.type==='allq'){ window._stuLastQuestion=msg; if(window._stuName) renderStudentMultiQ(msg.qs); }
    if(msg.type==='end' || msg.type==='pollEnd'){ window._stuSessionEnded=true; }
  }, {
    onOpen: ()=>{ if(window._setStuStatus) window._setStuStatus('متصل ✅','ok'); }
  });
  // أيضاً: حاول من الـ URL param (السؤال مدمج في الرابط — يعمل حتى لو ntfy محجوب)
  const urlQ = parseQuestionFromUrl();
  if(urlQ && (!window._stuLastQuestion || (window._stuLastQuestion.q && urlQ.ts >= (window._stuLastQuestion.q.ts||0)))){
    window._stuLastQuestion = {type:'newq', q:urlQ};
    if(window._stuName) renderStudentQuestion(urlQ);
  }
  toast('info','جاري المزامنة...');
}
function selectStudentOption(el,idx){document.querySelectorAll('.sq-opt').forEach(o=>o.classList.remove('selected'));el.classList.add('selected');window._stuOption=idx;document.getElementById('stuSubmitBtn').disabled=false;}
function submitStudentOption(){if(window._stuOption===undefined){toast('error','اختاري إجابتكِ');return;}const letters=['أ','ب','ج','د'];const opts=document.querySelectorAll('.sq-opt');const txt=opts[window._stuOption]?opts[window._stuOption].textContent.trim():'';sendStudentAnswer(letters[window._stuOption]+' - '+txt);}
function submitStudentAnswer(){
  const t=document.getElementById('stuAnswer').value.trim();
  if(!t){toast('error','اكتبي إجابتكِ');return;}
  if(!window._stuName || window._stuName.trim()===''){
    toast('error','اكتبي اسمكِ أولاً في الأعلى');
    const nameInput = document.getElementById('stuName');
    if(nameInput) nameInput.focus();
    return;
  }
  sendStudentAnswer(t);
}
function sendStudentAnswer(ans){
  if(!window._stuPublish)return;
  // ⭐ ناحفظي إجابتكِ الطالبة محلياً عشان نقدر نقارنها مع الحل عند بثه
  window._stuMyAnswer = ans;
  window._stuPublish({type:'answer',student:window._stuName,answer:ans,time:formatTime(new Date().toISOString()),ts:Date.now()});
  document.getElementById('studentCard').innerHTML=`<div class="student-success"><i class="fas fa-check-circle"></i><h3>تم إرسال إجابتك!</h3><p>شكراً ${window._stuName}</p><p style="font-size:.85rem;color:#666">في انتظار السؤال التالي أو بث الحل من المعلمة...</p></div>`;
}

/* ANALYTICS */
function updateAnalytics(){document.getElementById('anStudents').textContent=Data.students.length;document.getElementById('anAnswers').textContent=Data.answers.length;document.getElementById('anQuizzes').textContent=Data.quizzes.length;const pts=Data.behavior.reduce((a,b)=>a+b.points,0);document.getElementById('anPoints').textContent=pts;document.getElementById('anStreak').textContent=Math.min(7,Math.floor((Data.answers.length+Data.behavior.length)/3));const days=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس'];const counts=[0,0,0,0,0];[...Data.answers,...Data.behavior].forEach(a=>{const d=new Date(a.createdAt).getDay();if(d>=0&&d<=4)counts[d]++;});const max=Math.max(...counts,1);document.getElementById('weeklyChart').innerHTML=days.map((d,i)=>`<div class="an-bar" style="height:${(counts[i]/max)*100}%"><span class="an-val">${counts[i]}</span><span class="an-lbl">${d}</span></div>`).join('');const cs={};Data.answers.forEach(a=>cs[a.studentId]=(cs[a.studentId]||0)+1);const top=Object.entries(cs).map(([id,c])=>({id,count:c,student:Data.students.find(s=>s.id===parseInt(id))})).filter(x=>x.student).sort((a,b)=>b.count-a.count).slice(0,5);if(!top.length)document.getElementById('topStudents').innerHTML='<div class="empty-state"><i class="fas fa-trophy"></i><p>لا توجد بيانات</p></div>';else{const ranks=['gold','silver','bronze','other','other'];const medals=['🥇','🥈','🥉','🏅','🏅'];document.getElementById('topStudents').innerHTML=top.map((t,i)=>`<div class="top-item"><div class="top-rank ${ranks[i]}">${i+1}</div><div class="top-name">${medals[i]} ${escapeHtml(t.student.name)}</div><div class="top-score">${t.count}</div></div>`).join('');}}

/* SIDE PANEL */
function openSidePanel(tab='students'){document.getElementById('sidePanel').classList.add('active');switchTab(tab);}
function closeSidePanel(){document.getElementById('sidePanel').classList.remove('active');}
function switchTab(tab){document.querySelectorAll('.sp-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));document.querySelectorAll('.sp-section').forEach(s=>s.classList.toggle('active',s.id==='sec-'+tab));const titles={students:'الطالبات',answers:'الإجابات',quiz:'الاختبارات',behavior:'السلوك والمكافآت',words:'جدار المفردات',plan:'خطة الحصة',attendance:'الحضور والغياب',analytics:'التحليلات'};const icons={students:'user-graduate',answers:'comments',quiz:'question-circle',behavior:'star',words:'font',plan:'clipboard-list',attendance:'user-check',analytics:'chart-line'};document.getElementById('spTitle').innerHTML=`<i class="fas fa-${icons[tab]}"></i> ${titles[tab]}`;if(tab==='analytics')updateAnalytics();if(tab==='attendance')renderAttendance();}

/* MODAL */
function openModal(id){
  document.getElementById(id).classList.add('active');
  // تحديث عدد الشرائح في مودال الحفظ
  if(id === 'modalSave'){
    const cnt = document.getElementById('allPagesCount');
    if(cnt){
      const valid = (State.pages || []).filter(p => _isPageHasContent(p)).length;
      cnt.textContent = valid + ' / ' + (State.pages || []).length;
    }
  }
}
function closeModal(id){document.getElementById(id).classList.remove('active');}
document.querySelectorAll('.modal-overlay').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id);}));

/* EXPORT */
function exportPNG(){const l=document.createElement('a');l.download=`سبورة-${Date.now()}.png`;l.href=canvas.toDataURL('image/png');l.click();toast('success','تم الصدّري');closeModal('modalSave');}
function exportJPG(){const l=document.createElement('a');l.download=`سبورة-${Date.now()}.jpg`;l.href=canvas.toDataURL('image/jpeg',.92);l.click();toast('success','تم الصدّري');closeModal('modalSave');}
function exportSVG(){const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="background:#fff;width:100%;height:100%"><img src="${canvas.toDataURL('image/png')}" style="width:100%;height:100%"/></div></foreignObject></svg>`;const blob=new Blob([svg],{type:'image/svg+xml'});const l=document.createElement('a');l.download=`سبورة-${Date.now()}.svg`;l.href=URL.createObjectURL(blob);l.click();toast('success','تم الصدّري');closeModal('modalSave');}
function generateQR(){const link=document.getElementById('qrLink').value.trim();if(!link){toast('error','أدخلي الرابط');return;}document.getElementById('qrcode').innerHTML='';try{new QRCode('qrcode',{text:link,width:180,height:180,colorDark:'#1a5f7a'});toast('success','تم');}catch(e){toast('error','خطأ');}}
function exportXLSX(type){try{const wb=XLSX.utils.book_new();if(type==='students'||type==='all'){const ws=XLSX.utils.json_to_sheet(Data.students.map(s=>({'الاسم':s.name,'البريد الإلكتروني':s.email||'','رقم الجلوس':s.seat,'الفصل':s.class,'الحالة':statusText(s.status),'النقاط':s.points||0})));XLSX.utils.book_append_sheet(wb,ws,'الطالبات');}if(type==='answers'||type==='all'){const ws=XLSX.utils.json_to_sheet(Data.answers.map(a=>{const s=Data.students.find(x=>x.id===a.studentId);return{'الطالبة':s?s.name:'محذوفة','الإجابة':a.text,'التقييم':'⭐'.repeat(a.rating||3),'التاريخ':new Date(a.createdAt).toLocaleString('ar-SA')};}));XLSX.utils.book_append_sheet(wb,ws,'الإجابات');}if(type==='quizzes'||type==='all'){const ws=XLSX.utils.json_to_sheet(Data.quizzes.map(q=>({'السؤال':q.title,'الخيار أ':q.options[0]||'','الخيار ب':q.options[1]||'','الخيار ج':q.options[2]||'','الخيار د':q.options[3]||'','الإجابة':q.options[q.correct]||'','التصنيف':subjectText(q.subject)})));XLSX.utils.book_append_sheet(wb,ws,'الأسئلة');}if(type==='behavior'||type==='all'){const ws=XLSX.utils.json_to_sheet(Data.behavior.map(b=>{const s=Data.students.find(x=>x.id===b.studentId);return{'الطالبة':s?s.name:'محذوفة','السلوك':b.label||'',التصنيف:b.category||'','النقاط':b.points,'التاريخ':new Date(b.createdAt).toLocaleString('ar-SA')};}));XLSX.utils.book_append_sheet(wb,ws,'السلوك');}if(type==='teachers'||type==='all'){const ws=XLSX.utils.json_to_sheet((Data.teachers||[]).map(t=>({'المعلمة':t.name,'عدد الفصول':t.classes?t.classes.length:0,'الفصول':(t.classes||[]).map(c=>classLabel(c)).join('، ')})));XLSX.utils.book_append_sheet(wb,ws,'المعلمات');}XLSX.writeFile(wb,`بيانات-${type}-${Date.now()}.xlsx`);toast('success','تم الصدّري');}catch(e){toast('error','خطأ');}}

/* SAVE/LOAD */
function saveData(){try{localStorage.setItem('mar_students',JSON.stringify(Data.students));localStorage.setItem('mar_answers',JSON.stringify(Data.answers));localStorage.setItem('mar_quizzes',JSON.stringify(Data.quizzes));localStorage.setItem('mar_words',JSON.stringify(Data.words));localStorage.setItem('mar_behavior',JSON.stringify(Data.behavior));localStorage.setItem('mar_exit',JSON.stringify(Data.exitTickets));localStorage.setItem('mar_lessons',JSON.stringify(Data.lessonPlans||[]));localStorage.setItem('mar_settings',JSON.stringify(Data.settings));localStorage.setItem('mar_polls',JSON.stringify(Data.polls||[]));localStorage.setItem('mar_live',JSON.stringify(Data.liveSessions||[]));localStorage.setItem('mar_teachers',JSON.stringify(Data.teachers||[]));localStorage.setItem('mar_active_teacher',JSON.stringify(Data.activeTeacherId||null));localStorage.setItem('mar_attendance',JSON.stringify(Data.attendance||[]));}catch(e){}}
function loadData(){try{Data.students=JSON.parse(localStorage.getItem('mar_students')||'[]');Data.answers=JSON.parse(localStorage.getItem('mar_answers')||'[]');Data.quizzes=JSON.parse(localStorage.getItem('mar_quizzes')||'[]');Data.words=JSON.parse(localStorage.getItem('mar_words')||'[]');Data.behavior=JSON.parse(localStorage.getItem('mar_behavior')||'[]');Data.exitTickets=JSON.parse(localStorage.getItem('mar_exit')||'[]');Data.lessonPlans=JSON.parse(localStorage.getItem('mar_lessons')||'[]');Data.polls=JSON.parse(localStorage.getItem('mar_polls')||'[]');Data.liveSessions=JSON.parse(localStorage.getItem('mar_live')||'[]');Data.teachers=JSON.parse(localStorage.getItem('mar_teachers')||'[]');Data.activeTeacherId=JSON.parse(localStorage.getItem('mar_active_teacher')||'null');Data.attendance=JSON.parse(localStorage.getItem('mar_attendance')||'[]');const s=JSON.parse(localStorage.getItem('mar_settings')||'{}');Data.settings={...Data.settings,...s};document.getElementById('setTeacherName').value=Data.settings.teacherName||'';document.getElementById('setBoardName').value=Data.settings.boardName||'حصة تفاعلية';document.getElementById('setFontSize').value=Data.settings.fontSize||20;updateTeacherNameDisplay();ensureActiveTeacher();}catch(e){}}
/* ضمان وجود معلمة نشطة */
function ensureActiveTeacher(){
  if(!Data.teachers||!Data.teachers.length){
    // إنشاء معلمة افتراضية ترث الاسم من الإعدادات وفصولها = جميع الفصول الخمسة
    Data.teachers=[{id:Date.now(),name:Data.settings.teacherName||'المعلمة',classes:CLASSES.map(c=>c.id),createdAt:new Date().toISOString()}];
    Data.activeTeacherId=Data.teachers[0].id;
    saveData();
  } else if(!Data.activeTeacherId || !Data.teachers.find(t=>t.id===Data.activeTeacherId)){
    Data.activeTeacherId=Data.teachers[0].id;
    saveData();
  }
  renderActiveTeacherSelect();
}
function updateTeacherNameDisplay(){const t=Data.settings.teacherName||'';document.getElementById('teacherNameText').textContent=t||'—';}
async function openTeacherNameEdit(){const t=await customPrompt('اسم المعلمة (اتركيه فارغاً لإخفاء الاسم):',Data.settings.teacherName||'','عدلي اسم المعلمة');if(t===null)return;Data.settings.teacherName=t.trim();updateTeacherNameDisplay();document.getElementById('setTeacherName').value=Data.settings.teacherName;saveData();toast('success','تم التحديث');}
function exportData(){const data={...Data,exportedAt:new Date().toISOString()};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const l=document.createElement('a');l.download=`marifa-backup-${Date.now()}.json`;l.href=URL.createObjectURL(blob);l.click();toast('success','تم الصدّري');}
function importData(e){const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const d=JSON.parse(ev.target.result);Object.assign(Data,d);saveData();updateAll();toast('success','تم الاستوردي');}catch(err){toast('error','ملف غير صالح');}};r.readAsText(f);}
async function clearAllData(){if(!await customConfirm('هل تريدين امسحي كل البيانات نهائياً؟ لا يمكن التراجعي!',{title:'تحذير - امسحي كل البيانات',danger:true,okText:'نعم، اسمحي كل شيء'}))return;if(!await customConfirm('تأكيد أخير: هل أنتِ متأكدة تماماً من احذفي جميع البيانات؟',{title:'التأكيد الأخير',danger:true,okText:'نعم، ااحذفي'}))return;Object.keys(Data).forEach(k=>{if(Array.isArray(Data[k]))Data[k]=[];});ensureActiveTeacher();saveData();updateAll();toast('warning','تم الامسحي');}
function saveSettings(){Data.settings.boardName=document.getElementById('setBoardName').value||'حصة تفاعلية';Data.settings.fontSize=parseInt(document.getElementById('setFontSize').value);Data.settings.teacherName=document.getElementById('setTeacherName').value.trim();updateTeacherNameDisplay();saveData();closeModal('modalSettings');toast('success','تم الاحفظي');}
function updateAll(){renderStudents();renderAnswers();renderQuizzes();renderBehavior();renderWords();renderLessonList();updateAnalytics();updateBehaviorSelect();renderActiveTeacherSelect();renderClassFilter();if(typeof renderAttendance==='function'&&document.getElementById('sec-attendance'))renderAttendance();if(document.getElementById('teachersList'))renderTeachersList();}
/* تعبئة قائمة الفصول أعلى الطالبات حسب فصول المعلمة النشطة */
function renderClassFilter(){
  const sel=document.getElementById('studentClassFilter');
  if(!sel)return;
  const allowed=classesForActiveTeacher();
  const cur=sel.value||'';
  sel.innerHTML='<option value="">جميع الفصول</option>'+allowed.map(cid=>`<option value="${cid}">${classLabel(cid)}</option>`).join('');
  if(allowed.includes(cur))sel.value=cur;
}
/* تحديث قائمة المعلمات في الشريط العلوي */
function renderActiveTeacherSelect(){
  const sel=document.getElementById('activeTeacherSelect');
  if(!sel)return;
  const cur=Data.activeTeacherId||'';
  if(!Data.teachers||!Data.teachers.length){
    sel.innerHTML='<option value="">لا توجد معلمات</option>';
  } else {
    sel.innerHTML=Data.teachers.map(t=>`<option value="${t.id}">${escapeHtml(t.name)}${t.classes&&t.classes.length===CLASSES.length?' (الكل)':` (${t.classes?t.classes.length:0})`}</option>`).join('');
  }
  if(cur!==''&&Data.teachers.find(t=>t.id===cur))sel.value=cur;
}
/* تبديل المعلمة النشطة */
function switchActiveTeacher(id){
  if(!id)return;
  const t=teacherById(parseInt(id));
  if(!t){toast('error','المعلمة غير موجودة');return;}
  Data.activeTeacherId=parseInt(id);
  // تحديث الاسم في الإعدادات لمتغيرات العرض فقط
  Data.settings.teacherName=t.name;
  document.getElementById('setTeacherName').value=t.name;
  updateTeacherNameDisplay();
  saveData();
  updateAll();
  renderTeachersList();
  toast('success','المعلمة النشطة: '+t.name);
}

/* ============ إدارة المعلمات ============ */
let _editingTeacherId=null;
function openTeacherForm(id=null){
  _editingTeacherId=id;
  const area=document.getElementById('teacherFormArea');
  const title=document.getElementById('teacherFormTitle');
  area.style.display='block';
  if(id){
    const t=teacherById(id);
    if(t){document.getElementById('tchName').value=t.name;}
    title.textContent='عدلي بيانات المعلمة';
  } else {
    document.getElementById('tchName').value='';
    title.textContent='معلمة جديدة';
  }
  renderTeacherClassesCheckboxes(id?teacherById(id).classes:[]);
  document.getElementById('tchName').focus();
}
function cancelTeacherForm(){
  document.getElementById('teacherFormArea').style.display='none';
  _editingTeacherId=null;
}
function renderTeacherClassesCheckboxes(selected=[]){
  const box=document.getElementById('tchClassesBox');
  const sel=Array.isArray(selected)?selected:[];
  box.innerHTML=CLASSES.map(c=>{
    const checked=sel.includes(c.id);
    return `<div class="cls-chk ${checked?'checked':''}"><input type="checkbox" id="tchCls_${c.id}" value="${c.id}" ${checked?'checked':''} onchange="this.parentElement.classList.toggle('checked',this.checked)"><label for="tchCls_${c.id}">${escapeHtml(c.label)}</label></div>`;
  }).join('');
}
function setTeacherClassesPreset(mode){
  const cbs=document.querySelectorAll('#tchClassesBox input[type=checkbox]');
  if(mode==='all'){cbs.forEach((c,i)=>{c.checked=true;c.parentElement.classList.add('checked');});}
  else if(mode==='none'){cbs.forEach(c=>{c.checked=false;c.parentElement.classList.remove('checked');});}
  else if(mode==='one'){cbs.forEach((c,i)=>{const on=i===0;c.checked=on;c.parentElement.classList.toggle('checked',on);});}
}
function getSelectedTeacherClasses(){
  return Array.from(document.querySelectorAll('#tchClassesBox input[type=checkbox]:checked')).map(c=>c.value);
}
function saveTeacher(){
  const name=document.getElementById('tchName').value.trim();
  if(!name){toast('error','أدخلي اسم المعلمة');return;}
  const classes=getSelectedTeacherClasses();
  if(!classes.length){toast('error','اختاري فصلاً واحداً على الأقل');return;}
  if(_editingTeacherId){
    const t=teacherById(_editingTeacherId);
    if(t){t.name=name;t.classes=classes;toast('success','تم التحديث');}
  } else {
    const newId=Date.now()+Math.floor(Math.random()*1000);
    Data.teachers.push({id:newId,name,classes,createdAt:new Date().toISOString()});
    Data.activeTeacherId=newId;
    Data.settings.teacherName=name;
    document.getElementById('setTeacherName').value=name;
    updateTeacherNameDisplay();
    toast('success','تمت إضافة المعلمة');
  }
  saveData();
  cancelTeacherForm();
  renderTeachersList();
  renderActiveTeacherSelect();
  renderClassFilter();
  updateAll();
}
async function deleteTeacher(id){
  if(!await customConfirm('هل تريدين احذفي هذه المعلمة؟ طالباتها سيبقين لكن لن تكون مرتبطة بها.',{title:'احذفي معلمة',danger:true,okText:'احذفي'}))return;
  Data.teachers=Data.teachers.filter(t=>t.id!==id);
  if(Data.activeTeacherId===id){
    Data.activeTeacherId=Data.teachers.length?Data.teachers[0].id:null;
    ensureActiveTeacher();
  }
  saveData();
  renderTeachersList();
  renderActiveTeacherSelect();
  renderClassFilter();
  updateAll();
  toast('warning','تم الحذف');
}
function renderTeachersList(){
  const box=document.getElementById('teachersList');
  if(!box)return;
  if(!Data.teachers||!Data.teachers.length){
    box.innerHTML='<div class="tch-empty"><i class="fas fa-user-tie"></i><div>لا توجد معلمات بعد. أضيفي أول معلمة لتبدئي.</div></div>';
    return;
  }
  box.innerHTML=Data.teachers.map(t=>{
    const isActive=Data.activeTeacherId===t.id;
    const clsList=(t.classes||[]).map(c=>`<span class="tch-class-pill">${escapeHtml(classLabel(c))}</span>`).join('');
    return `<div class="tch-card ${isActive?'active':''}">
      <div class="tch-av">${escapeHtml((t.name||'؟').charAt(0))}</div>
      <div class="tch-info">
        <div class="tch-name">${escapeHtml(t.name||'')} ${isActive?'<span style="font-size:.65rem;background:var(--success);color:white;padding:2px 8px;border-radius:8px;margin-right:4px">نشطة</span>':''}</div>
        <div class="tch-meta">${(t.classes&&t.classes.length===CLASSES.length)?'<b>تدرّس جميع الفصول</b>':`<b>تدرّس ${t.classes?t.classes.length:0} فصول:</b>`}</div>
        <div>${clsList}</div>
      </div>
      <div class="tch-actions">
        ${!isActive?`<button class="tch-act" onclick="switchActiveTeacher(${t.id})" title="تفعيل"><i class="fas fa-check"></i></button>`:''}
        <button class="tch-act" onclick="openTeacherForm(${t.id})" title="عدلي"><i class="fas fa-edit"></i></button>
        <button class="tch-del" onclick="deleteTeacher(${t.id})" title="احذفي"><i class="fas fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}

/* ============ استيراد الطالبات من إكسل ============ */
let _importRows=[];
function openImportStudentsModal(){
  if(!Data.teachers.length){toast('error','أضيفي معلمة أولاً');openModal('modalTeachers');return;}
  const sel=document.getElementById('importTargetClass');
  const allowed=classesForActiveTeacher();
  sel.innerHTML='<option value="">جميع فصولي</option>'+allowed.map(c=>`<option value="${c}">${classLabel(c)}</option>`).join('');
  document.getElementById('importPreview').innerHTML='<div style="text-align:center;color:#888;padding:20px"><i class="fas fa-file-excel" style="font-size:2rem;opacity:.3;display:block;margin-bottom:6px"></i>اختاري ملف إكسل لعرض المعاينة</div>';
  document.getElementById('importCount').textContent='0';
  document.getElementById('importStudentBtn').disabled=true;
  _importRows=[];
  document.getElementById('importStudentFile').value='';
  openModal('modalImportStudents');
  // ربط حدث الملف
  const fi=document.getElementById('importStudentFile');
  fi.onchange=onImportFileChosen;
}
function onImportFileChosen(e){
  const f=e.target.files[0];
  if(!f)return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const data=new Uint8Array(ev.target.result);
      const wb=XLSX.read(data,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
      _importRows=rows.map(parseStudentRow).filter(r=>r&&r.name);
      renderImportPreview();
    }catch(err){toast('error','تعذّر قراءة الملف: '+err.message);}
  };
  r.readAsArrayBuffer(f);
}
function parseStudentRow(row){
  if(!row||typeof row!=='object')return null;
  const keys=Object.keys(row);
  const find=re=>{for(const k of keys){if(re.test(k))return row[k];}return '';};
  const nameRaw=(find(/^(الاسم|اسم|name|student\s*name|اسم الطالبة|الاسمل)$/i)||'').toString().trim();
  if(!nameRaw)return null;
  const name=nameRaw;
  const email=(find(/^(البريد|بريد|email|البريد الإلكتروني|e-?mail|إيميل|ايميل)$/i)||'').toString().trim().toLowerCase();
  const clsRaw=(find(/^(الفصل|فصل|class|الشعبة|شعبة|section)$/i)||'').toString().trim();
  const seat=(find(/^(رقم الجلوس|جلوس|seat|رقم|number)$/i)||'').toString().trim();
  return {name,email,class:normalizeClassInput(clsRaw),seat};
}
function normalizeClassInput(v){
  if(!v)return '';
  const s=v.toString().trim();
  // قبول "1/1" أو "الأول - 1" أو "1-1"
  let m=s.match(/^(\d)[\/\-\s]+(\d)$/);
  if(m)return m[1]+'/'+m[2];
  const labelMatch=CLASSES.find(c=>c.label===s||c.id===s||c.grade===s);
  return labelMatch?labelMatch.id:'';
}
function renderImportPreview(){
  const box=document.getElementById('importPreview');
  const btn=document.getElementById('importStudentBtn');
  const cnt=document.getElementById('importCount');
  if(!_importRows.length){
    box.innerHTML='<div style="text-align:center;color:#c0392b;padding:14px"><i class="fas fa-exclamation-triangle"></i> لم يتم العثور على بيانات صالحة. تأكدي أن الملف يحوي عمود "الاسم".</div>';
    btn.disabled=true;cnt.textContent='0';return;
  }
  const validEmails=_importRows.filter(r=>!r.email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
  cnt.textContent=_importRows.length;
  btn.disabled=false;
  const allowed=classesForActiveTeacher();
  const target=document.getElementById('importTargetClass').value;
  box.innerHTML=`<div style="margin-bottom:8px;color:var(--success)"><b><i class="fas fa-check-circle"></i> تم العثور على ${_importRows.length} طالبة</b>${validEmails.length<_importRows.length?` <span style="color:#e67e22;font-size:.75rem">(${_importRows.length-validEmails.length} بدون بريد صالح)</span>`:''}</div>
  <table style="width:100%;border-collapse:collapse;font-size:.78rem">
    <thead><tr style="background:#eee"><th style="padding:6px;text-align:right">الاسم</th><th style="padding:6px;text-align:right">البريد</th><th style="padding:6px;text-align:right">الفصل</th></tr></thead>
    <tbody>${_importRows.slice(0,30).map(r=>{
      const cls=r.class||target||allowed[0];
      const valid=r.email?(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)?'<i class="fas fa-check" style="color:var(--success)"></i>':'<i class="fas fa-times" style="color:var(--danger)"></i>'):'<span style="color:#999">—</span>';
      return `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:6px">${escapeHtml(r.name)}</td><td style="padding:6px;direction:ltr;text-align:left">${r.email?escapeHtml(r.email)+' '+valid:'—'}</td><td style="padding:6px">${classLabel(cls)}</td></tr>`;
    }).join('')}</tbody>
  </table>
  ${_importRows.length>30?`<div style="text-align:center;color:#888;padding:6px">...و ${_importRows.length-30} أخريات</div>`:''}`;
}
function confirmImportStudents(){
  if(!_importRows.length){toast('error','لا توجد بيانات للاستيراد');return;}
  const target=document.getElementById('importTargetClass').value;
  const allowed=classesForActiveTeacher();
  let added=0,skipped=0;
  _importRows.forEach(r=>{
    let cls=r.class;
    if(!cls||!allowed.includes(cls))cls=target||allowed[0];
    if(!cls){skipped++;return;}
    Data.students.push({
      id:Date.now()+added+Math.floor(Math.random()*1000),
      name:r.name,
      email:r.email||'',
      seat:r.seat||'',
      class:cls,
      status:'on',
      teacherId:Data.activeTeacherId,
      points:0,
      createdAt:new Date().toISOString()
    });
    added++;
  });
  saveData();
  renderStudents();
  updateBehaviorSelect();
  updateAnalytics();
  closeModal('modalImportStudents');
  toast('success',`تم استيراد ${added} طالبة${skipped?` (تم تخطي ${skipped})`:''}`);
  _importRows=[];
}

/* ============================================================
   نظام الحضور والغياب — ربط تلقائي مع الطالبات في السبورة
   - عند بدء جلسة (Session) تُسجَّل كل طالبات الفصل كـ "لم تحضر"
   - عند دخول الطالبة (join) → تتحول إلى "حاضرة" + timestamp
   - عند خروجها (leave) → يُحفظ وقت المغادرة
   - عند انتهاء الجلسة → تُحسم الغياب (من لم يدخل = غائبة)
   - تقرير + رسم بياني + تصدير
   ============================================================ */

/* سجل الجلسة الحالية في الذاكرة (يُستخدم أثناء البث الحي) */
let _activeAttendanceSession = null;

function _normalizeName(s){ return (s||'').trim().toLowerCase().replace(/\s+/g,' '); }

function _getAttendanceSession(){
  // ابحث عن سجل مفتوح (endedAt === null) بنفس الكود
  if(_activeAttendanceSession && !_activeAttendanceSession.endedAt) return _activeAttendanceSession;
  if(!State.currentLiveCode) return null;
  Data.attendance = Data.attendance || [];
  _activeAttendanceSession = Data.attendance.find(a => a.code === State.currentLiveCode && !a.endedAt) || null;
  return _activeAttendanceSession;
}

function _createAttendanceSession(){
  if(!State.currentLiveCode) return null;
  Data.attendance = Data.attendance || [];
  // لو في جلسة مكررة بنفس الكود، استخدمها
  let sess = Data.attendance.find(a => a.code === State.currentLiveCode && !a.endedAt);
  if(sess) return sess;

  // أي طالبات الفصل المعلنة (active teacher) أو فصل واحد
  // لو المعلمة تختار فصل واحد في البث (single)، نستخدمه، وإلا نأخذ فصول المعلمة كلها
  const allowedClasses = classesForActiveTeacher();
  const roster = Data.students.filter(s => allowedClasses.includes(s.class))
    .map(s => ({ studentKey: String(s.id), name: s.name, class: s.class, status: 'absent', joinedAt: null, leftAt: null, note: '' }));

  sess = {
    id: 'a-' + Date.now() + '-' + Math.random().toString(36).slice(2,7),
    code: State.currentLiveCode,
    sessionName: liveQuiz?.title || Data.settings.boardName || 'حصة مباشرة',
    classIds: allowedClasses,
    startedAt: new Date().toISOString(),
    endedAt: null,
    roster
  };
  Data.attendance.push(sess);
  _activeAttendanceSession = sess;
  saveData();
  return sess;
}

function _markStudentJoined(name){
  const sess = _getAttendanceSession();
  if(!sess) return;
  const key = _normalizeName(name);
  // ابحث بالـ key (id) أو بالاسم المُطبّع
  let rec = sess.roster.find(r => _normalizeName(r.name) === key || r.studentKey === key);
  if(!rec){
    // طالبة جديدة لم تكن في القائمة — أضفها
    rec = { studentKey: key, name: name, class: '', status: 'present', joinedAt: Date.now(), leftAt: null, note: '' };
    sess.roster.push(rec);
  } else {
    rec.status = 'present';
    rec.joinedAt = rec.joinedAt || Date.now();
    rec.leftAt = null;
  }
  saveData();
  if(typeof renderAttendance === 'function' && document.getElementById('sec-attendance')?.classList.contains('active')){
    renderAttendance();
  }
  if(typeof _flashLiveAttendance === 'function') _flashLiveAttendance(name, 'in');
}

function _markStudentLeft(name){
  const sess = _getAttendanceSession();
  if(!sess) return;
  const key = _normalizeName(name);
  let rec = sess.roster.find(r => _normalizeName(r.name) === key);
  if(rec){
    rec.leftAt = Date.now();
    saveData();
    if(typeof renderAttendance === 'function' && document.getElementById('sec-attendance')?.classList.contains('active')){
      renderAttendance();
    }
  }
  if(typeof _flashLiveAttendance === 'function') _flashLiveAttendance(name, 'out');
}

function _endAttendanceSession(){
  const sess = _getAttendanceSession();
  if(!sess) return;
  // كل من لم تنضم تظل غائبة
  sess.endedAt = new Date().toISOString();
  _activeAttendanceSession = null;
  saveData();
  if(typeof renderAttendance === 'function' && document.getElementById('sec-attendance')?.classList.contains('active')){
    renderAttendance();
  }
}

/* لمحة فورية للحضور في اللوحة العائمة */
function _flashLiveAttendance(name, kind){
  // ابقها خفيفة — فقط نعرض إشعار صغير أو نُحدّث الإحصائيات في اللوحة العائمة
  if(typeof updateLiveActivityStats === 'function'){
    updateLiveActivityStats();
  }
}

/* إحصائيات الجلسة الحالية */
function _attendanceSessionStats(sess){
  const total = sess.roster.length;
  const present = sess.roster.filter(r => r.status === 'present').length;
  const absent = total - present;
  const rate = total ? Math.round((present/total)*100) : 0;
  return { total, present, absent, rate };
}

/* عرض القسم بالكامل */
function renderAttendance(){
  // البيانات
  Data.attendance = Data.attendance || [];
  // شارة البث المباشر
  const liveBadge = document.getElementById('attLiveBadge');
  if(liveBadge){
    liveBadge.style.display = (_activeAttendanceSession && !_activeAttendanceSession.endedAt) ? 'flex' : 'none';
  }

  // إحصائيات الجلسة الحالية (إن وُجدت) أو آخر جلسة
  let displaySess = _activeAttendanceSession && !_activeAttendanceSession.endedAt
    ? _activeAttendanceSession
    : (Data.attendance.filter(a => a.endedAt).sort((a,b)=> new Date(b.startedAt)-new Date(a.startedAt))[0] || null);
  let stats = { total:0, present:0, absent:0, rate:0 };
  if(displaySess){
    stats = _attendanceSessionStats(displaySess);
  }
  document.getElementById('attNumPresent').textContent = stats.present;
  document.getElementById('attNumAbsent').textContent = stats.absent;
  document.getElementById('attNumRate').textContent = stats.rate + '%';

  // قائمة الجلسات (الأحدث أولاً) — مع فلتر اختياري
  const listEl = document.getElementById('attSessions');
  if(!listEl) return;
  let sessions = Data.attendance.slice().sort((a,b)=> new Date(b.startedAt)-new Date(a.startedAt));
  // فلتر الفصل لو متوفر
  const classFilter = document.getElementById('attClassFilter');
  if(classFilter && classFilter.value){
    const cf = classFilter.value;
    sessions = sessions.filter(s => !s.classIds || s.classIds.includes(cf));
  }
  // حد أقصى 20 جلسة في العرض
  sessions = sessions.slice(0, 20);

  if(!sessions.length){
    listEl.innerHTML = `<div class="att-empty"><i class="fas fa-clipboard-list"></i><div>لا توجد جلسات حضور بعد</div><div style="font-size:.7rem;margin-top:4px">ابدئي جلسة مباشرة من نافذة البث وستظهر هنا تلقائياً</div></div>`;
  } else {
    listEl.innerHTML = sessions.map(s => _renderAttendanceSessionHTML(s)).join('');
  }

  // زر بدء/إنهاء الجلسة (لو في بث نشط)
  _renderAttendanceControlBtn();

  // الرسم البياني
  renderAttendanceChart();
}

function _renderAttendanceSessionHTML(s){
  const stats = _attendanceSessionStats(s);
  const date = new Date(s.startedAt);
  const dateStr = date.toLocaleDateString('ar-SA', { day:'numeric', month:'short' });
  const timeStr = date.toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' });
  const classes = (s.classIds||[]).map(c => classLabel(c)).join('، ') || '—';
  const isLive = !s.endedAt;
  const statusPill = isLive
    ? '<span class="att-pill" style="background:#28a745"><i class="fas fa-circle" style="font-size:.5rem"></i> نشطة</span>'
    : '<span class="att-pill" style="background:#888">منتهية</span>';
  const presentPct = stats.total ? (stats.present/stats.total*100) : 0;
  const absentPct = 100 - presentPct;
  // تفصيل الطالبات
  const detailId = 'attDet-' + s.id;
  const records = s.roster.map(r => {
    const joined = r.joinedAt ? new Date(r.joinedAt).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }) : '—';
    const left = r.leftAt ? new Date(r.leftAt).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }) : '';
    return `<div class="att-record">
      <div class="att-record-status ${r.status}"><i class="fas fa-${r.status==='present'?'check':'times'}"></i></div>
      <div class="att-record-name">${escapeHtml(r.name)}</div>
      <div class="att-record-time">${joined}${left?(' → '+left):''}</div>
      <div class="att-record-actions">
        <button class="att-record-btn" onclick="toggleAttStatus('${s.id}','${r.studentKey}')" title="تبديل الحالة"><i class="fas fa-exchange-alt"></i></button>
      </div>
    </div>`;
  }).join('');
  return `<div class="att-session">
    <div class="att-session-head">
      <div class="att-session-title"><i class="fas fa-chalkboard-teacher"></i> ${escapeHtml(s.sessionName||'حصة')} ${statusPill}</div>
      <div class="att-session-meta">${dateStr} • ${timeStr}</div>
    </div>
    <div class="att-session-bar">
      <div class="bar-present" style="width:${presentPct}%"></div>
      <div class="bar-absent" style="width:${absentPct}%"></div>
    </div>
    <div class="att-session-stats">
      <span class="present-stat"><i class="fas fa-user-check"></i> ${stats.present} حاضرة</span>
      <span class="absent-stat"><i class="fas fa-user-times"></i> ${stats.absent} غائبة</span>
      <span>${stats.rate}%</span>
    </div>
    <div class="att-note"><i class="fas fa-users"></i> ${classes} • <b>${stats.total}</b> طالبة</div>
    <div class="att-session-detail" id="${detailId}">${records || '<div style="text-align:center;color:#999;padding:8px">لا توجد سجلات</div>'}</div>
    <div style="display:flex;gap:4px;margin-top:6px">
      <button class="btn btn-sm" onclick="toggleAttDetail('${detailId}', this)" style="flex:1;background:#f0f3f5;color:#1a5f7a"><i class="fas fa-list"></i> عرض الطالبات (${s.roster.length})</button>
      <button class="btn btn-sm" onclick="exportAttendanceSession('${s.id}')" style="background:#28a745;color:white" title="تصدير هذه الجلسة"><i class="fas fa-download"></i></button>
      <button class="btn btn-sm" onclick="deleteAttendanceSession('${s.id}')" style="background:#dc3545;color:white" title="حذف"><i class="fas fa-trash"></i></button>
    </div>
  </div>`;
}

function toggleAttDetail(id, btn){
  const el = document.getElementById(id);
  if(!el) return;
  const open = el.classList.toggle('open');
  if(btn) btn.innerHTML = `<i class="fas fa-list"></i> ${open?'إخفاء':'عرض'} الطالبات (${el.children.length})`;
}

function toggleAttStatus(sessionId, studentKey){
  const sess = Data.attendance.find(a => a.id === sessionId);
  if(!sess) return;
  const rec = sess.roster.find(r => r.studentKey === studentKey || _normalizeName(r.name) === _normalizeName(studentKey));
  if(!rec) return;
  rec.status = rec.status === 'present' ? 'absent' : 'present';
  if(rec.status === 'present' && !rec.joinedAt) rec.joinedAt = Date.now();
  saveData();
  renderAttendance();
  toast('info', `${rec.name}: ${rec.status === 'present' ? 'حاضرة' : 'غائبة'}`);
}

async function deleteAttendanceSession(sessionId){
  if(!await customConfirm('هل تريدين حذف سجل هذه الجلسة من الحضور؟', {title:'حذف جلسة حضور', danger:true, okText:'احذفي'})) return;
  Data.attendance = Data.attendance.filter(a => a.id !== sessionId);
  if(_activeAttendanceSession && _activeAttendanceSession.id === sessionId) _activeAttendanceSession = null;
  saveData();
  renderAttendance();
  toast('warning','تم الحذف');
}

function _renderAttendanceControlBtn(){
  // (احتياطي) — الفتح يتم من تاب الحضور — لا حاجة لزر ثابت هنا
}

/* الرسم البياني — يعرض حضور آخر 10 جلسات */
let _attChart = null;
function renderAttendanceChart(){
  const canvas = document.getElementById('attChart');
  if(!canvas || typeof Chart === 'undefined') return;
  Data.attendance = Data.attendance || [];
  const sessions = Data.attendance.slice().sort((a,b)=> new Date(a.startedAt)-new Date(b.startedAt)).slice(-10);
  if(!sessions.length){
    if(_attChart){ try{_attChart.destroy();}catch(e){} _attChart = null; }
    return;
  }
  const labels = sessions.map(s => {
    const d = new Date(s.startedAt);
    return d.toLocaleDateString('ar-SA', { day:'numeric', month:'short' });
  });
  const presentData = sessions.map(s => _attendanceSessionStats(s).present);
  const absentData = sessions.map(s => _attendanceSessionStats(s).absent);
  if(_attChart){ try{_attChart.destroy();}catch(e){} }
  _attChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'حاضرة', data: presentData, backgroundColor: '#28a745', borderRadius: 5, stack: 'a' },
        { label: 'غائبة', data: absentData, backgroundColor: '#dc3545', borderRadius: 5, stack: 'a' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { font: { family: 'Tajawal', size: 11 }, usePointStyle: true, padding: 8 } },
        tooltip: { rtl: true, textDirection: 'rtl' }
      },
      scales: {
        x: { stacked: true, ticks: { font: { family: 'Tajawal', size: 10 } }, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { font: { family: 'Tajawal', size: 10 }, precision: 0 } }
      }
    }
  });
}

/* تصدير */
function exportAttendanceCSV(){
  if(!Data.attendance || !Data.attendance.length){toast('info','لا توجد بيانات للتصدير');return;}
  const rows = [['الجلسة','الكود','التاريخ','الوقت','الفصل','اسم الطالبة','الحالة','وقت الدخول','وقت المغادرة','ملاحظة']];
  Data.attendance.forEach(s => {
    const date = new Date(s.startedAt);
    const d = date.toLocaleDateString('ar-SA');
    const t = date.toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' });
    const classes = (s.classIds||[]).map(c => classLabel(c)).join('، ');
    if(!s.roster.length){
      rows.push([s.sessionName||'حصة', s.code, d, t, classes, '—', '—', '—', '—', '']);
    } else {
      s.roster.forEach(r => {
        rows.push([
          s.sessionName||'حصة',
          s.code,
          d,
          t,
          classes,
          r.name,
          r.status === 'present' ? 'حاضرة' : 'غائبة',
          r.joinedAt ? new Date(r.joinedAt).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }) : '',
          r.leftAt ? new Date(r.leftAt).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }) : '',
          r.note || ''
        ]);
      });
    }
  });
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `حضور-${Date.now()}.csv`;
  a.click();
  toast('success','تم تصدير CSV');
}

function exportAttendanceXLSX(){
  if(typeof XLSX === 'undefined'){toast('error','مكتبة الإكسل غير متاحة');return;}
  if(!Data.attendance || !Data.attendance.length){toast('info','لا توجد بيانات للتصدير');return;}
  try{
    const wb = XLSX.utils.book_new();
    // ورقة 1: ملخص
    const summary = Data.attendance.map(s => {
      const st = _attendanceSessionStats(s);
      return {
        'الجلسة': s.sessionName || 'حصة',
        'الكود': s.code,
        'التاريخ': new Date(s.startedAt).toLocaleDateString('ar-SA'),
        'وقت البدء': new Date(s.startedAt).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }),
        'وقت الانتهاء': s.endedAt ? new Date(s.endedAt).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }) : 'مستمرة',
        'الفصل': (s.classIds||[]).map(c => classLabel(c)).join('، '),
        'إجمالي': st.total,
        'حاضرة': st.present,
        'غائبة': st.absent,
        'نسبة الحضور %': st.rate
      };
    });
    const ws1 = XLSX.utils.json_to_sheet(summary);
    XLSX.utils.book_append_sheet(wb, ws1, 'ملخص الجلسات');
    // ورقة 2: تفصيل
    const detail = [];
    Data.attendance.forEach(s => {
      s.roster.forEach(r => {
        detail.push({
          'الجلسة': s.sessionName || 'حصة',
          'الكود': s.code,
          'التاريخ': new Date(s.startedAt).toLocaleDateString('ar-SA'),
          'اسم الطالبة': r.name,
          'الحالة': r.status === 'present' ? 'حاضرة' : 'غائبة',
          'وقت الدخول': r.joinedAt ? new Date(r.joinedAt).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }) : '—',
          'وقت المغادرة': r.leftAt ? new Date(r.leftAt).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }) : '—',
          'مدة الحضور (دقيقة)': (r.joinedAt && r.leftAt) ? Math.round((r.leftAt - r.joinedAt) / 60000) : ''
        });
      });
    });
    const ws2 = XLSX.utils.json_to_sheet(detail);
    XLSX.utils.book_append_sheet(wb, ws2, 'تفاصيل الطالبات');
    XLSX.writeFile(wb, `حضور-${Date.now()}.xlsx`);
    toast('success','تم تصدير Excel');
  }catch(e){ toast('error','خطأ في التصدير'); }
}

function exportAttendanceSession(sessionId){
  const sess = Data.attendance.find(a => a.id === sessionId);
  if(!sess){toast('error','الجلسة غير موجودة');return;}
  const rows = [['اسم الطالبة','الحالة','وقت الدخول','وقت المغادرة','مدة الحضور (دقيقة)']];
  sess.roster.forEach(r => {
    rows.push([
      r.name,
      r.status === 'present' ? 'حاضرة' : 'غائبة',
      r.joinedAt ? new Date(r.joinedAt).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }) : '—',
      r.leftAt ? new Date(r.leftAt).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }) : '—',
      (r.joinedAt && r.leftAt) ? Math.round((r.leftAt - r.joinedAt) / 60000) : ''
    ]);
  });
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `حضور-${sess.code}-${Date.now()}.csv`;
  a.click();
  toast('success','تم تصدير الجلسة');
}

function printAttendance(){
  if(!Data.attendance || !Data.attendance.length){toast('info','لا توجد بيانات للطباعة');return;}
  const w = window.open('', '_blank');
  if(!w){toast('error','فشل فتح نافذة الطباعة');return;}
  const rows = Data.attendance.map(s => {
    const st = _attendanceSessionStats(s);
    const date = new Date(s.startedAt).toLocaleString('ar-SA');
    return `<tr>
      <td>${escapeHtml(s.sessionName||'حصة')}</td>
      <td>${escapeHtml(s.code)}</td>
      <td>${date}</td>
      <td>${st.total}</td>
      <td style="color:#28a745;font-weight:800">${st.present}</td>
      <td style="color:#dc3545;font-weight:800">${st.absent}</td>
      <td><b>${st.rate}%</b></td>
    </tr>`;
  }).join('');
  w.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>تقرير الحضور والغياب</title>
  <style>
    body{font-family:'Tajawal',Arial,sans-serif;padding:20px;color:#333}
    h1{color:#1a5f7a;text-align:center;margin:0 0 8px}
    .sub{text-align:center;color:#666;margin-bottom:18px;font-size:.9rem}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    th,td{border:1px solid #ddd;padding:8px 10px;text-align:right;font-size:.85rem}
    th{background:#1a5f7a;color:white}
    tr:nth-child(even){background:#f8f9fa}
    .footer{margin-top:30px;display:flex;justify-content:space-between;font-size:.85rem;color:#666;border-top:1px solid #ddd;padding-top:10px}
    @media print{body{padding:0}}
  </style></head><body>
  <h1>📋 تقرير الحضور والغياب</h1>
  <div class="sub">مدرسة المعرفة الثانوية للبنات — ${Data.settings.teacherName||''} — ${new Date().toLocaleDateString('ar-SA')}</div>
  <table>
    <thead><tr><th>الجلسة</th><th>الكود</th><th>التاريخ والوقت</th><th>إجمالي</th><th>حاضرة</th><th>غائبة</th><th>نسبة الحضور</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    <div>إجمالي الجلسات: ${Data.attendance.length}</div>
    <div>طُبع في: ${new Date().toLocaleString('ar-SA')}</div>
  </div>
  <script>window.onload=()=>setTimeout(()=>window.print(),300);<\/script>
  </body></html>`);
  w.document.close();
}

/* CLOCK */
function startClock(){function tick(){const n=new Date();document.getElementById('liveClock').textContent=n.toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'});document.getElementById('liveDate').textContent=n.toLocaleDateString('ar-SA',{weekday:'short',day:'numeric',month:'short'});}tick();setInterval(tick,30000);}

/* TOAST */
function toast(t,m){const icons={success:'check-circle',error:'times-circle',info:'info-circle',warning:'exclamation-triangle'};const el=document.createElement('div');el.className=`toast ${t}`;el.innerHTML=`<i class="fas fa-${icons[t]}"></i> ${m}`;document.getElementById('toastContainer').appendChild(el);setTimeout(()=>{el.classList.add('hide');setTimeout(()=>el.remove(),300);},3000);}

/* KEYBOARD */
function setupKeyboard(){document.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;if(e.target.isContentEditable)return;
  // اختصارات الصفحات / الشرائح (تعمل في أي مكان ولا تتعارض مع ctrl+S/Z/Y)
  // PageDown = الشريحة التالية، PageUp = السابقة (تعمل حتى في fullscreen)
  if(e.key==='PageDown' && !e.ctrlKey && !e.metaKey && !e.altKey){
    if(typeof _switchToPage==='function' && State.pages && State.currentPage < State.pages.length-1){
      e.preventDefault(); _switchToPage(State.currentPage+1); return;
    }
  }
  if(e.key==='PageUp' && !e.ctrlKey && !e.metaKey && !e.altKey){
    if(typeof _switchToPage==='function' && State.pages && State.currentPage > 0){
      e.preventDefault(); _switchToPage(State.currentPage-1); return;
    }
  }
  if((e.ctrlKey||e.metaKey) && (e.key==='ArrowRight' || e.key==='ArrowLeft' || e.key==='PageDown' || e.key==='PageUp')){
    e.preventDefault();
    if(e.key==='ArrowRight' || e.key==='PageUp') _switchToPage(State.currentPage-1);
    else _switchToPage(State.currentPage+1);
    return;
  }
  if((e.ctrlKey||e.metaKey) && (e.key==='n' || e.key==='N') && e.shiftKey){
    e.preventDefault(); _addNewPage(); return;
  }
  if(e.ctrlKey||e.metaKey){if(e.key==='z'){e.preventDefault();undo();return;}if(e.key==='y'){e.preventDefault();redo();return;}if(e.key==='s'){e.preventDefault();openModal('modalSave');return;}if(e.key==='c'&&State.sel.active&&State.tool==='select'){e.preventDefault();copySelection();return;}if(e.key==='d'&&State.sel.active&&State.tool==='select'){e.preventDefault();duplicateSelection();return;}if(e.key==='a'&&State.tool==='select'){e.preventDefault();selectAll();return;}}if(e.key==='Escape'){if(State.sel.active){e.preventDefault();e.stopPropagation();clearSelection();return;}closePopups();document.querySelectorAll('.modal-overlay.active').forEach(m=>closeModal(m.id));closeSidePanel();document.getElementById('calcPanel').classList.remove('active');if(State.laserOn)toggleLaser();if(State.spotlightOn)toggleSpotlight();if(State.magnifierOn)toggleMagnifier();if(State.curtainOpen)toggleCurtain();return;}if(e.key==='Delete'||e.key==='Backspace'){if(State.sel.active){e.preventDefault();e.stopPropagation();deleteSelection();return;}}switch(e.key){case'1':setTool('pen');break;case'2':setTool('eraser');break;case'3':setTool('text');break;case'4':setTool('pan');break;case'5':setTool('select');break;case'+':case'=':document.getElementById('brushSize').value=Math.min(40,State.brushSize+1);setBrushSize(State.brushSize+1);break;case'-':document.getElementById('brushSize').value=Math.max(1,State.brushSize-1);setBrushSize(State.brushSize-1);break;case'l':case'L':toggleLaser();break;case'p':case'P':toggleSpotlight();break;case'm':case'M':toggleMagnifier();break;case'c':case'C':toggleCurtain();break;case't':case'T':openTimerModal();break;case'r':case'R':openRandomPicker();break;case'g':case'G':openGroupMaker();break;}});}

/* UTILS */
function escapeHtml(t){if(!t)return '';return String(t).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

/* CUSTOM DIALOGS (replace native prompt/confirm which are blocked in some contexts) */
let _custPromptOk=null,_custPromptCancel=null,_custPromptKey=null;
let _custConfirmOk=null,_custConfirmCancel=null,_custConfirmKey=null;
function customPrompt(message,defaultValue,title){
  return new Promise(resolve=>{
    const overlay=document.getElementById('custPrompt');
    const msgEl=document.getElementById('custPromptMsg');
    const titleEl=document.getElementById('custPromptTitle');
    const input=document.getElementById('custPromptInput');
    msgEl.textContent=message||'أدخلي النص:';
    titleEl.textContent=title||'إدخال نص';
    input.value=defaultValue||'';
    overlay.classList.add('on');
    setTimeout(()=>{input.focus();input.select();},60);
    const ok=document.getElementById('custPromptOk');
    const cancel=document.getElementById('custPromptCancel');
    const close=val=>{
      overlay.classList.remove('on');
      ok.onclick=null;cancel.onclick=null;input.onkeydown=null;
      resolve(val);
    };
    ok.onclick=()=>close(input.value);
    cancel.onclick=()=>close(null);
    input.onkeydown=e=>{
      if(e.key==='Enter'){e.preventDefault();close(input.value);}
      else if(e.key==='Escape'){e.preventDefault();close(null);}
    };
  });
}
function customConfirm(message,opts){
  opts=opts||{};
  return new Promise(resolve=>{
    const overlay=document.getElementById('custConfirm');
    document.getElementById('custConfirmMsg').textContent=message||'هل أنتِ متأكدة؟';
    document.getElementById('custConfirmTitle').textContent=opts.title||'تأكيد';
    const head=document.getElementById('custConfirmHead');
    head.style.background=opts.danger?'linear-gradient(90deg,var(--danger),#c0392b)':'linear-gradient(90deg,var(--dark),var(--primary))';
    const okBtn=document.getElementById('custConfirmOk');
    okBtn.className='btn '+(opts.danger?'btn-danger':'btn-primary');
    okBtn.innerHTML='<i class="fas fa-check"></i> '+(opts.okText||'موافق');
    const cancelBtn=document.getElementById('custConfirmCancel');
    cancelBtn.innerHTML='<i class="fas fa-times"></i> '+(opts.cancelText||'إلغاء');
    overlay.classList.add('on');
    setTimeout(()=>okBtn.focus(),60);
    const close=val=>{
      overlay.classList.remove('on');
      okBtn.onclick=null;cancelBtn.onclick=null;document.onkeydown=null;
      resolve(val);
    };
    okBtn.onclick=()=>close(true);
    cancelBtn.onclick=()=>close(false);
    document.onkeydown=e=>{
      if(e.key==='Enter'){e.preventDefault();close(true);}
      else if(e.key==='Escape'){e.preventDefault();close(false);}
    };
  });
}
function formatTime(iso){if(!iso)return '';return new Date(iso).toLocaleString('ar-SA',{hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'});}
function roundRect(ctx,x,y,w,h,r){if(w<2*r)r=w/2;if(h<2*r)r=h/2;ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

/* SPECIAL EFFECTS */
function toggleLaser(){State.laserOn=!State.laserOn;document.getElementById('laserDot').classList.toggle('on',State.laserOn);if(State.laserOn){document.addEventListener('mousemove',moveLaser);toast('info','ليزر');}else{document.removeEventListener('mousemove',moveLaser);}}
function moveLaser(e){document.getElementById('laserDot').style.left=e.clientX+'px';document.getElementById('laserDot').style.top=e.clientY+'px';}
function toggleSpotlight(){State.spotlightOn=!State.spotlightOn;document.getElementById('spotlight').classList.toggle('on',State.spotlightOn);if(State.spotlightOn){document.addEventListener('mousemove',moveSpotlight);toast('info','إضاءة');}else{document.removeEventListener('mousemove',moveSpotlight);}}
function moveSpotlight(e){const h=document.getElementById('spotHole');h.style.left=e.clientX+'px';h.style.top=e.clientY+'px';}
function toggleMagnifier(){State.magnifierOn=!State.magnifierOn;document.getElementById('magnifier').classList.toggle('on',State.magnifierOn);if(State.magnifierOn){document.addEventListener('mousemove',moveMagnifier);toast('info','مكبرة');}else{document.removeEventListener('mousemove',moveMagnifier);}}
function moveMagnifier(e){const mag=document.getElementById('magnifier');const mc=document.getElementById('magCanvas');const mctx=mc.getContext('2d');mag.style.left=(e.clientX-85)+'px';mag.style.top=(e.clientY-85)+'px';mctx.clearRect(0,0,340,340);mctx.drawImage(canvas,e.clientX*2-85,e.clientY*2-85,85,85,0,0,340,340);}
function toggleCurtain(){State.curtainOpen=!State.curtainOpen;document.getElementById('curtainTop').classList.toggle('open',State.curtainOpen);document.getElementById('curtainBottom').classList.toggle('open',State.curtainOpen);toast('info',State.curtainOpen?'افتحي':'أغلقي');}
function togglePresentMode(){State.presentMode=!State.presentMode;document.getElementById('topBar').classList.toggle('hidden',State.presentMode);document.getElementById('toolbar').style.opacity=State.presentMode?'.1':'1';document.getElementById('toolbar').style.pointerEvents=State.presentMode?'none':'auto';document.querySelectorAll('.side-fab').forEach(f=>f.style.opacity=State.presentMode?'0':'1');toast(State.presentMode?'success':'info',State.presentMode?'ضعي الاعرضي':'انتهى');}

/* RATING CHIPS */
function updateRatingChips(){document.querySelectorAll('#ratingChips .chip').forEach(c=>c.classList.toggle('selected',parseInt(c.dataset.rating)===State.selectedRating));}
function updateCorrectChips(){document.querySelectorAll('#qCorrectChips .chip').forEach(c=>c.classList.toggle('selected',parseInt(c.dataset.correct)===State.selectedCorrect));}

/* STAMPS & EMOJIS - COMPREHENSIVE */
const STAMPS=['✅','❌','⭐','🌟','❤️','🔥','💯','👍','🎯','💡','🏆','🥇','🥈','🥉','📚','✏️','📝','🎓','💪','👏','🙌','🤔','💭','⚡','🎨','🚀','🔔','⏰','📌','🎁','🌈','☀️','❓','❗','💬','📢','🔍','📊','📈','📉','🎪','🎭','🎵','🎬','🔬','🔭','🧪','⚗️','🧬','🌍','🌎','🌏','🗺️','🏛️','🕌','📿','🤲','🕋'];
const EMOJIS=['😊','😍','🤩','😎','🥰','😇','🤓','🧐','🤔','😋','😜','🤪','😏','😐','😶','🙄','😬','😌','😔','😪','😭','😡','🤬','😱','🥺','😈','👻','🤖','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕','💞','💓','💗','💖','💘','💝','💟','✨','🎉','🎊','🎈','🎁','🌟','⭐','☀️','🌙','⛅','☁️','🌧️','⛈️','❄️','🌈','🌸','🌺','🌻','🌷','🌹','🌼','💐','🌿','🍃','🌱','🌳','🌴','🌵','🍀'];

const SHAPES_DATA=[{id:'free',name:'حر',icon:'fa-pen-fancy'},{id:'line',name:'خط'},{id:'arrow',name:'سهم'},{id:'rect',name:'مستطيل'},{id:'rectR',name:'مستطيل مدور'},{id:'circle',name:'دائرة'},{id:'ellipse',name:'بيضاوي'},{id:'triangle',name:'مثلث'},{id:'diamond',name:'معين'},{id:'star',name:'نجمة'},{id:'hex',name:'سداسي'},{id:'pent',name:'خماسي'},{id:'cross',name:'+'},{id:'xmark',name:'✗'},{id:'check',name:'✓'},{id:'heart',name:'♥'},{id:'lightning',name:'⚡'},{id:'cloud',name:'☁'}];
function shapeSVG(id){const svgs={line:'<line x1="4" y1="20" x2="20" y2="4"/>',arrow:'<line x1="4" y1="12" x2="18" y2="12"/><polyline points="12,6 18,12 12,18"/>',rect:'<rect x="3" y="5" width="18" height="14"/>',rectR:'<rect x="3" y="5" width="18" height="14" rx="4"/>',circle:'<circle cx="12" cy="12" r="9"/>',ellipse:'<ellipse cx="12" cy="12" rx="10" ry="6"/>',triangle:'<polygon points="12,3 22,21 2,21"/>',diamond:'<polygon points="12,2 22,12 12,22 2,12"/>',star:'<polygon points="12,2 15,9 22,9 16,14 18,21 12,17 6,21 8,14 2,9 9,9"/>',hex:'<polygon points="12,2 21,7 21,17 12,22 3,17 3,7"/>',pent:'<polygon points="12,2 22,9 18,21 6,21 2,9"/>',cross:'<line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/>',xmark:'<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>',check:'<polyline points="3,12 9,18 21,6"/>',heart:'<path d="M12,21 C12,21 4,15 4,9 C4,6 6,4 9,4 C10,4 11,5 12,6 C13,5 14,4 15,4 C18,4 20,6 20,9 C20,15 12,21 12,21 Z"/>',lightning:'<polygon points="13,2 4,14 11,14 9,22 20,10 13,10 15,2"/>',cloud:'<path d="M6,18 C3,18 2,15 4,13 C3,10 6,8 9,9 C10,6 15,6 16,9 C19,9 21,12 19,15 C21,17 19,18 17,18 Z"/>'};return `<svg viewBox="0 0 24 24">${svgs[id]||''}</svg>`;}

const MATH_SYMBOLS=['±','∛','∞','∑','∏','∫','∂','∇','∝','≈','≠','≤','≥','∠','⊥','∥','°','α','β','γ','θ','λ','μ','σ','Ω','²','³','½','⅓','¼','⅔','¾','%','‰','ℝ','ℕ','ℤ','∈','∉','⊂','⊃','∪','∩','∀','∃','⊕','⊗'];
const PHYS_SYMBOLS=['→','⇌','↑','↓','Δ','·','⁺','⁻','₀','₁','₂','₃','₄','₅','₆','₇','₈','₉','H₂O','CO₂','NaCl','O₂','Φ','ℏ','℃','℉','kg','m/s','N','J','W','Hz','mol','kWh'];
const BIO_SYMBOLS=['♀','♂','⚥','☀','☁','☂','❄','🌱','🌿','🌳','🌸','🌺','🌻','🍃','DNA','RNA','ATP','pH','mol','g','L','μm','mm'];

// 🗺️ رموز جغرافيا وعلوم الأرض — مناسبة لمناهج مملكة البحرين
const GEO_SYMBOLS=[
  // خرائط واتجاهات
  '🗺️','🌍','🌎','🌏','🧭','🧭','🧭','🧭',
  // مظاهر سطح الأرض
  '⛰️','🏔️','🏕️','🏖️','🏜️','🏝️','🏞️','🌋','🗻',
  // ماء وغلاف جوي
  '🌊','☀️','☁️','⛅','🌤️','🌥️','🌦️','🌧️','⛈️','🌩️','❄️','🌨️','💨','🌪️','🌫️','🌈','🌡️',
  // فضاء
  '🌞','🌝','🌙','⭐','🌟','✨','💫','☄️','🪐','🌠','🚀','🛰️',
  // بيئة ومظاهر طبيعية
  '🛢️','🌴','🐟','🐠','🐚','🪨','🪵','🌱','🌿','🌾','🌵','🌳','🍂','🌺','🏛️','🕌',
  // رموز إضافية
  '🌡️','🧭','🧭','🌐','📍','🗿','⛺','🏔️'
];

// 🌋 محاكاة تفاعلية — مخططات تعليمية تناسب منهج البحرين
const GEO_SIMULATIONS = [
  {id:'bahrain-map',   icon:'🇧🇭', label:'خريطة البحرين',   desc:'أرخبيل البحرين - 50+ جزيرة'},
  {id:'water-cycle',   icon:'💧',  label:'دورة الماء',     desc:'التبخر - التكثف - الهطول'},
  {id:'earth-layers',  icon:'🌍',  label:'طبقات الأرض',    desc:'القشرة - الوشاح - اللب'},
  {id:'solar-system',  icon:'🪐',  label:'المجموعة الشمسية', desc:'الشمس والكواكب الثمانية'},
  {id:'volcano',       icon:'🌋',  label:'بركان',          desc:'ثورة بركان والحمم'},
  {id:'earthquake',    icon:'📈',  label:'زلزال',          desc:'الموجات الزلزالية'},
  {id:'tides',         icon:'🌊',  label:'المد والجزر',    desc:'تأثير جاذبية القمر'},
  {id:'bahrain-climate', icon:'🌡️', label:'مناخ البحرين', desc:'صيف حار - شتاء معتدل'}
];

const TEMPLATES=[
  {id:'grid',name:'شبكة',cls:'template-preview-grid'},
  {id:'graph',name:'رسم بياني',cls:'template-preview-grid'},
  {id:'largegrid',name:'شبكة كبيرة',cls:'template-preview-largegrid'},
  {id:'engineering',name:'ورق هندسي',cls:'template-preview-engineering'},
  {id:'lined',name:'ورق مسطر',cls:'template-preview-lined'},
  {id:'test',name:'ورقة اختبار',cls:'template-preview-test'},
  {id:'notebook',name:'مذكرات',cls:'template-preview-notebook'},
  {id:'dots',name:'نقاط',cls:'template-preview-dots'},
  {id:'hexagonal',name:'سداسيات',cls:'template-preview-hexagonal'},
  {id:'triangular',name:'مثلثات',cls:'template-preview-triangular'},
  {id:'isometric',name:'أيزومتري',cls:'template-preview-isometric'},
  {id:'sketch',name:'كروكي',cls:'template-preview-sketch'},
  {id:'music',name:'ورق موسيقي',cls:'template-preview-music'},
  {id:'coord',name:'مستوى إحداثي',cls:'template-preview-coord'},
  {id:'none',name:'بدون',cls:''}
];

function buildUI(){
  document.getElementById('mathGrid').innerHTML=MATH_SYMBOLS.map(s=>`<button class="sc-btn math" data-insert="${s}">${s}</button>`).join('');
  document.getElementById('physGrid').innerHTML=PHYS_SYMBOLS.map(s=>`<button class="sc-btn chem" data-insert="${s}">${s}</button>`).join('');
  document.getElementById('bioGrid').innerHTML=BIO_SYMBOLS.map(s=>`<button class="sc-btn bio" data-insert="${s}">${s}</button>`).join('');
  document.getElementById('shapesGrid').innerHTML=SHAPES_DATA.map(s=>`<button class="shape-btn ${s.id==='free'?'active':''}" data-shape="${s.id}" title="${s.name}">${s.id==='free'?`<i class="fas ${s.icon}"></i>`:shapeSVG(s.id)}</button>`).join('');
  // أختام تفاعلية — نمرر `this` للحصول على رد فعل بصري عند الضغط
  document.getElementById('stampsGrid').innerHTML=STAMPS.map(s=>`<button class="stamp-btn" onclick="placeStamp('${s}',this)">${s}</button>`).join('');
  document.getElementById('emojisGrid').innerHTML=EMOJIS.map(s=>`<button class="stamp-btn" onclick="placeStamp('${s}',this)">${s}</button>`).join('');
  document.getElementById('templatesGrid').innerHTML=TEMPLATES.map(t=>`<div class="template-card" onclick="applyBackground('${t.id}');closePopups()"><div class="t-preview ${t.cls}"></div><div class="t-name">${t.name}</div></div>`).join('');
  // 🗺️ قسم الجغرافيا — محاكاة تفاعلية + رموز سريعة
  document.getElementById('geoSimGrid').innerHTML=GEO_SIMULATIONS.map(s=>`<button class="geo-sim-btn" onclick="insertGeoSim('${s.id}')" title="${s.desc}"><span class="gs-icon">${s.icon}</span><span class="gs-label">${s.label}</span></button>`).join('');
  document.getElementById('geoGrid').innerHTML=GEO_SYMBOLS.map(s=>`<button class="sc-btn geo" data-insert="${s}">${s}</button>`).join('');
  document.querySelectorAll('.sc-btn[data-insert]').forEach(b=>b.addEventListener('click',()=>insertSymbol(b.dataset.insert)));
  document.querySelectorAll('.shape-btn').forEach(b=>b.addEventListener('click',()=>{setShape(b.dataset.shape);toast('info','شكل');closePopups();}));
}

/* INIT */
let _audioUnlocked=false;
function unlockAudio(){
  if(_audioUnlocked)return;
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx)return;
    const ctx=new AudioCtx();
    if(ctx.state==='suspended')ctx.resume();
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    gain.gain.value=0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime+0.01);
    _audioUnlocked=true;
  }catch(e){}
}
document.addEventListener('pointerdown',unlockAudio,{once:true});
document.addEventListener('keydown',unlockAudio,{once:true});

document.addEventListener('DOMContentLoaded',()=>{
  // تحميل رابط المعلمة المحفوظ
  const savedUrl = localStorage.getItem('teacherBaseUrl');
  const urlInput = document.getElementById('teacherBaseUrl');
  if(urlInput && savedUrl){ urlInput.value = savedUrl; }
  if(urlInput){
    urlInput.addEventListener('change', function(){
      const val = this.value.trim();
      if(val){ localStorage.setItem('teacherBaseUrl', val); showToast('تم حفظ رابط الصفحة ✅', 'success'); }
      else { localStorage.removeItem('teacherBaseUrl'); }
    });
  }

  const _mode=new URLSearchParams(location.search).get('mode');
  if(_mode==='student'||_mode==='exit'||_mode==='poll'){initStudentMode();return;}
  resizeCanvas();
  setupCanvas();
  loadData();
  _loadQueueFromStorage();
  buildUI();
  __initStampSound();
  buildBehaviorCategories();
  updateAll();
  applyBackground(Data.settings.bgType||'grid');
  // تهيئة نظام الشرائح
  _initPages();
  _bootstrapFirstSnapshot();
  renderLessonList();
  startClock();
  setupKeyboard();
  _startBoardItemsWatcher();

  // Tools
  document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
  document.querySelectorAll('.c-dot[data-color]').forEach(d=>d.addEventListener('click',()=>setColor(d.dataset.color)));
  document.getElementById('customColor').addEventListener('input',e=>{setColor(e.target.value);});
  document.getElementById('brushSize').addEventListener('input',e=>setBrushSize(e.target.value));
  document.getElementById('btnShapes').addEventListener('click',()=>togglePopup('shapePanel'));
  document.getElementById('btnScience').addEventListener('click',()=>togglePopup('sciencePanel'));
  document.getElementById('btnStamps').addEventListener('click',()=>togglePopup('stampsPanel'));
  document.getElementById('btnBackgrounds').addEventListener('click',()=>togglePopup('bgPanel'));
  document.getElementById('btnSticky').addEventListener('click',()=>{
    // أنشئ/أظهر حاوية الملاحظات، ثم أضف ملاحظة جديدة
    const dock = _ensureNotesDock();
    if(dock.style.display === 'none') dock.style.display = '';
    if(dock.classList.contains('collapsed')){
      dock.classList.remove('collapsed');
      const btn = dock.querySelector('#notesDockCollapse i');
      if(btn) btn.className = 'fas fa-chevron-down';
    }
    addStickyNote();
  });
  // زر الإضافة السريعة للملاحظات (يعمل نفس الشيء)
  const _snQuick = document.getElementById('btnStickyQuick');
  if(_snQuick){
    _snQuick.addEventListener('click', ()=>{
      const dock = _ensureNotesDock();
      if(dock.style.display === 'none') dock.style.display = '';
      addStickyNote();
    });
  }
  // أنشئ حاوية الملاحظات مسبقاً عند التحميل
  setTimeout(()=>_ensureNotesDock(), 100);
  // اختصار لوحة المفاتيح: N لإضافة ملاحظة جديدة (يدعم الإضافة المتعددة)
  document.addEventListener('keydown', e=>{
    if(e.ctrlKey || e.altKey || e.metaKey) return;
    // تجاهل إذا التركيز على حقل نص أو منطقة قابلة للتحرير
    const tag = (e.target && e.target.tagName) || '';
    if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if(e.target && (e.target.isContentEditable || e.target.closest && e.target.closest('.sn-content'))) return;
    if(e.key === 'n' || e.key === 'N' || e.key === 'ن'){
      e.preventDefault();
      addStickyNote();
    }
  });
  document.getElementById('btnRuler').addEventListener('click', addRuler);
document.getElementById('btnProtractor').addEventListener('click', addProtractor);
document.getElementById('btnCompass').addEventListener('click', addCompass);
document.getElementById('btnSetsquare').addEventListener('click', addSetsquare);
  document.getElementById('btnBoardTimer').addEventListener('click',addBoardTimer);
  // إصلاح المؤقت: تحديث مباشر للعرض عند تغيير الدقائق (يحل "يعد من 5" عندما تختارين 6)
  const _cdMin=document.getElementById('countdownMin');
  if(_cdMin){
    _cdMin.addEventListener('input',bigTimerLiveUpdate);
    _cdMin.addEventListener('change',bigTimerLiveUpdate);
  }
  document.getElementById('btnFill').addEventListener('click',toggleFill);
  document.getElementById('btnDashed').addEventListener('click',toggleDashed);
  document.getElementById('btnHighlight').addEventListener('click',toggleHighlight);
  document.getElementById('fabCalc').addEventListener('click',()=>document.getElementById('calcPanel').classList.toggle('active'));
  document.getElementById('calcClose').addEventListener('click',()=>document.getElementById('calcPanel').classList.remove('active'));
  document.querySelectorAll('.calc-key').forEach(k=>k.addEventListener('click',()=>{if(k.dataset.val!==undefined)calcInput(k.dataset.val);else if(k.dataset.act)calcAction(k.dataset.act);else if(k.dataset.fn)calcFunc(k.dataset.fn);}));
  document.getElementById('fabStudents').addEventListener('click',()=>openSidePanel('students'));
  document.getElementById('fabAnswers').addEventListener('click',()=>openSidePanel('answers'));
  document.getElementById('fabQuiz').addEventListener('click',()=>openSidePanel('quiz'));
  document.getElementById('fabBehavior').addEventListener('click',()=>openSidePanel('behavior'));
  document.getElementById('fabTools').addEventListener('click',()=>openModal('modalTools'));
  document.getElementById('fabSave').addEventListener('click',()=>openModal('modalSave'));
  document.getElementById('fabPresent').addEventListener('click',togglePresentMode);
  // زر نظرة شاملة على كل الملاحظات (FAB)
  const _fabNotes = document.getElementById('fabNotesOverview');
  if(_fabNotes){
    _fabNotes.addEventListener('click', ()=>{
      _ensureNotesDock();
      openNotesOverview();
    });
  }
  document.getElementById('spClose').addEventListener('click',closeSidePanel);
  document.querySelectorAll('.sp-tab').forEach(t=>t.addEventListener('click',()=>switchTab(t.dataset.tab)));
  document.getElementById('btnUndo').addEventListener('click',undo);
  document.getElementById('btnRedo').addEventListener('click',redo);
  document.getElementById('btnClear').addEventListener('click',clearCanvas);
  document.getElementById('btnSettings').addEventListener('click',()=>openModal('modalSettings'));
  document.getElementById('btnToggleBar').addEventListener('click',()=>{document.getElementById('topBar').classList.toggle('hidden');document.getElementById('celebrateBar').classList.toggle('hidden');document.getElementById('motivationBanner')?.classList.toggle('hidden');document.getElementById('canvasWrap').classList.toggle('full');});
  document.getElementById('cbToggle').addEventListener('click',()=>{const cb=document.getElementById('celebrateBar');cb.classList.toggle('hidden');const ico=document.getElementById('cbToggle').querySelector('i');ico.className=cb.classList.contains('hidden')?'fas fa-chevron-down':'fas fa-chevron-up';});

  // ⭐⭐⭐ شريط العبارة التحفيزية — بداية الحصة ⭐⭐⭐
  (function initMotivationBanner(){
    const banner = document.getElementById('motivationBanner');
    const text   = document.getElementById('motivationText');
    const close  = document.getElementById('mbClose');
    const reset  = document.getElementById('mbReset');
    const picker = document.getElementById('mbPicker');
    const showFab= document.getElementById('mbShowFab');
    const canvas = document.getElementById('canvasWrap');
    const phrasePanel = document.getElementById('mbPhrasePanel');
    const phraseList  = document.getElementById('mbPhraseList');
    const phraseClose = document.getElementById('mbPhraseClose');
    const phraseRandom= document.getElementById('mbPhraseRandom');
    const phraseCustom= document.getElementById('mbPhraseCustom');
    if(!banner || !text || !close || !reset || !showFab) return;

    const PHRASES = [
      {text:'كل يوم فرصة جديدة للتعلّم والإبداع — معاً نحو التميّز يا بطلات!', emoji:'🌟'},
      {text:'التعليم ليس تحضيراً للحياة، التعليم هو الحياة نفسها!', emoji:'📚'},
      {text:'لا تيأسي أبداً، فالنجاح يبدأ بخطوة شجاعة!', emoji:'💪'},
      {text:'أنتِ قادرة على تحقيق ما تريدين، فقط صدّقي بنفسك!', emoji:'✨'},
      {text:'العلم نور، والجهل ظلام — استنيري بالمعرفة!', emoji:'💡'},
      {text:'كل سؤال تجيبين عنه يقربك خطوة من حلمك!', emoji:'🎯'},
      {text:'بطلات المعرفة لا يستسلمن أبداً!', emoji:'👑'},
      {text:'اجعلي كل يوم دراسي قصة نجاح جديدة!', emoji:'📖'},
      {text:'التميز ليس هبة، بل هو نتاج جهد وإصرار!', emoji:'🏆'},
      {text:'تعلّمي اليوم لتُبدعي غداً!', emoji:'🚀'},
      {text:'الطالبة المجتهعة تبني مستقبلها بيديها!', emoji:'🌸'},
      {text:'لا حدود لما يمكنكِ تحقيقه — ابدئي الآن!', emoji:'🌈'},
      {text:'كل تحدي هو فرصة للنمو والتطور!', emoji:'🦋'},
      {text:'أنتِ أقوى مما تظنين، وأذكى مما تتخيلين!', emoji:'💎'},
      {text:'اجعلي فضولكِ دليلكِ نحو المعرفة!', emoji:'🔍'},
      {text:'النجاح ليس نهاية المطاف، بل بداية رحلة جديدة!', emoji:'🎓'},
      {text:'ثقي بنفسكِ، فأنتِ أهل للتميز!', emoji:'❤️'},
      {text:'العقول المستنيرة تبني الأمم — كني منهن!', emoji:'🌍'},
      {text:'لا تخافي من الخطأ، فهو أول درجات التعلم!', emoji:'🌱'},
      {text:'أنتِ بطلة قصتكِ الخاصة — اكتبيها بإبداع!', emoji:'✍️'}
    ];

    const DEFAULT = PHRASES[0].text;
    const STORAGE_KEY = '__motivation_banner_state_v2';

    let saved = { hidden: false, text: DEFAULT, phraseIndex: 0 };
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(raw) saved = Object.assign(saved, JSON.parse(raw));
    }catch(e){}

    function applyState(){
      const hidden = banner.classList.contains('hidden');
      canvas.classList.toggle('has-motivation', !hidden);
      showFab.classList.toggle('visible', hidden);
    }

    if(saved.text && saved.text.trim()) text.textContent = saved.text;
    if(saved.hidden) banner.classList.add('hidden');
    applyState();

    function persistState(){
      try{
        const cur = { hidden: banner.classList.contains('hidden'), text: text.textContent, phraseIndex: saved.phraseIndex };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cur));
      }catch(e){}
    }

    function buildPhraseList(){
      if(!phraseList) return;
      phraseList.innerHTML = PHRASES.map((p,i)=>{
        const isActive = text.textContent.trim() === p.text.trim();
        return `<div class="mb-phrase-item ${isActive?'active':''}" data-index="${i}"><span class="mb-pi-emoji">${p.emoji}</span>${p.text}</div>`;
      }).join('');
      phraseList.querySelectorAll('.mb-phrase-item').forEach(item=>{
        item.addEventListener('click', ()=>{
          const idx = parseInt(item.dataset.index);
          selectPhrase(idx);
        });
      });
    }

    function selectPhrase(idx){
      const phrase = PHRASES[idx];
      if(!phrase) return;
      text.textContent = phrase.text;
      saved.phraseIndex = idx;
      persistState();
      closePhrasePanel();
      if(typeof toast === 'function') toast('success',`${phrase.emoji} تم اختيار العبارة التحفيزية!`);
    }

    function randomPhrase(){
      let idx;
      do{ idx = Math.floor(Math.random()*PHRASES.length); }
      while(PHRASES.length>1 && PHRASES[idx].text.trim()===text.textContent.trim());
      selectPhrase(idx);
    }

    function openPhrasePanel(){ buildPhraseList(); if(phrasePanel) phrasePanel.classList.add('active'); }
    function closePhrasePanel(){ if(phrasePanel) phrasePanel.classList.remove('active'); }

    let saveTimer = null;
    text.addEventListener('input', ()=>{ clearTimeout(saveTimer); saveTimer = setTimeout(persistState, 300); });
    text.addEventListener('blur', ()=>{ const t = text.textContent.trim(); if(!t) text.textContent = DEFAULT; persistState(); });
    text.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); text.blur(); } });
    banner.addEventListener('click', (e)=>{ if(e.target === text) return; if(e.target.closest('.mb-text')) text.focus(); });

    close.addEventListener('click', ()=>{
      banner.classList.add('hidden');
      applyState();
      persistState();
      if(typeof toast === 'function') toast('success','✨ تم إخفاء الشريط — تستطيعين إرجاعه من الزر الصغير في الأعلى');
    });

    reset.addEventListener('click', ()=>{
      text.textContent = DEFAULT;
      saved.phraseIndex = 0;
      text.focus();
      const range = document.createRange();
      range.selectNodeContents(text);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      persistState();
    });

    if(picker) picker.addEventListener('click', (e)=>{ e.stopPropagation(); openPhrasePanel(); });
    if(phraseClose) phraseClose.addEventListener('click', closePhrasePanel);
    if(phraseRandom) phraseRandom.addEventListener('click', randomPhrase);
    if(phraseCustom){
      phraseCustom.addEventListener('click', ()=>{
        closePhrasePanel();
        text.focus();
        const range = document.createRange();
        range.selectNodeContents(text);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
    }
    document.addEventListener('click', (e)=>{
      if(phrasePanel && phrasePanel.classList.contains('active') &&
         !phrasePanel.contains(e.target) && e.target !== picker && !picker.contains(e.target)){
        closePhrasePanel();
      }
    });

    showFab.addEventListener('click', ()=>{
      banner.classList.remove('hidden');
      applyState();
      persistState();
      if(typeof toast === 'function') toast('success','🌟 عاد الشريط التحفيزي! اختاري عبارة جديدة من الزر 💡');
    });
  })();
  // أزرار شريط الاحتفالات
    document.getElementById('cbStick').addEventListener('click',addStick);
  document.getElementById('cbBalloons').addEventListener('click',addBalloons);
  document.getElementById('cbFireworks').addEventListener('click',()=>launchFireworks(5));
  document.getElementById('cbApplause').addEventListener('click',launchApplause);
  document.getElementById('cbConfetti').addEventListener('click',launchConfettiRain);
  document.getElementById('cbFanfare').addEventListener('click',launchFullCelebration);
  // ⭐ كأس التفوق على السبورة
  const cbCupEl = document.getElementById('cbCup');
  if(cbCupEl) cbCupEl.addEventListener('click', openExcellenceCup);
  document.getElementById('btnFullscreen').addEventListener('click',()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen();else document.exitFullscreen();});
  // تحديث معاينة السؤال عند تغيير select/textarea
  const exitQEl = document.getElementById('exitQ');
  if(exitQEl) exitQEl.addEventListener('change', ()=>{updateExitQuestionPreview();if(exitNtfyTopic){const txt=exitQEl.options[exitQEl.selectedIndex]?.text||'تقييم الفهم';ntfyPublish(exitNtfyTopic,{type:'exitQ',q:txt,ts:Date.now()});}});
  const pollQEl = document.getElementById('pollQ');
  const pollOptsEl = document.getElementById('pollOpts');
  function refreshPollPreview(){
    const q = pollQEl?.value.trim()||'الاستطلاع';
    const opts = pollOptsEl?.value.split('\n').map(o=>o.trim()).filter(Boolean)||[];
    const preview=document.getElementById('pollCurrentQPreview');
    const text=document.getElementById('pollCurrentQText');
    if(preview&&text){text.textContent = q + (opts.length?` (${opts.length} خيارات)`:'');preview.style.display='block';}
    if(pollNtfyTopic && opts.length){ntfyPublish(pollNtfyTopic,{type:'pollQ',q,opts,ts:Date.now()});}
  }
  if(pollQEl) pollQEl.addEventListener('input', refreshPollPreview);
  if(pollOptsEl) pollOptsEl.addEventListener('input', refreshPollPreview);
  document.getElementById('stuSaveBtn').addEventListener('click',saveStudent);
  document.getElementById('ansSaveBtn').addEventListener('click',saveAnswer);
  document.getElementById('qSaveBtn').addEventListener('click',saveQuiz);
  document.getElementById('wSaveBtn').addEventListener('click',saveWord);
  document.querySelectorAll('#ratingChips .chip').forEach(c=>c.addEventListener('click',()=>{State.selectedRating=parseInt(c.dataset.rating);updateRatingChips();}));
  document.querySelectorAll('#qCorrectChips .chip').forEach(c=>c.addEventListener('click',()=>{State.selectedCorrect=parseInt(c.dataset.correct);updateCorrectChips();}));
  document.querySelectorAll('#modalReference .chip').forEach(c=>c.addEventListener('click',()=>showRef(c.dataset.ref)));
  document.getElementById('studentSearch').addEventListener('input',e=>renderStudents(e.target.value));
  document.getElementById('wordSearch').addEventListener('input',e=>renderWords(e.target.value));
  document.getElementById('wheelSpin').addEventListener('click',spinWheel);
  setInterval(saveData,30000);
  setTimeout(()=>toast('success','🌟 مرحباً! السبورة جاهزة'),500);
  setTimeout(()=>toast('info','اضغطي F12 أو زر الأدوات (🔧) لاستكشاف كل الميزات'),3500);

  // Virtual Tours
  renderVirtualTours();
});

/* ====== 🌍 VIRTUAL TOURS - رحلات افتراضية ====== */
// قاعدة بيانات المواقع الأثرية
const VT_SITES = {
  bahrain: [
    {id:'qal-at', name:'قلعة البحرين (قَلْعَة)', loc:'المنامة، البحرين', country:'🇧🇭 البحرين', period:'العصر الدلموني - الإسلامي', year:'حوالي 2300 ق.م - القرن السادس عشر الميلادي', tags:['unesco','dilmun','islamic'], tagsLabel:['تراث عالمي','دلمون','إسلامي'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d0/Qal%27at_al-Bahrain_-_Northern_Fortifications.jpg/640px-Qal%27at_al-Bahrain_-_Northern_Fortifications.jpg', lat:26.0064, lng:50.5147, zoom:17, desc:'موقع التراث العالمي لليونسكو منذ عام 2005. كانت عاصمة حضارة دلمون القديمة، وتضم آثاراً من 7 حضارات متعاقبة. تطل القلعة على البحر وتحتوي على مخازن دلمون، ومعابد، وقلعة برتغالية.', facts:[{l:'التصنيف',v:'تراث عالمي'},{l:'المساحة',v:'30 هكتار'},{l:'الحضارات',v:'7 حضارات'},{l:'الاعتراف',v:'2005'}], stops:[{n:'البوابة الشمالية',d:'أحد المداخل الرئيسية للقلعة، بنيت في العصر الإسلامي'},{n:'مخازن دلمون',d:'مخازن تجارية قديمة من حضارة دلمون'},{n:'الفناء المركزي',d:'قلب القلعة وتظهر فيه طبقات الحضارات المختلفة'},{n:'الإطلالة البحرية',d:'مطل على الخليج العربي'}]},
    {id:'dilmun', name:'مدافن دلمون (آثار)', loc:'عالي، البحرين', country:'🇧🇭 البحرين', period:'حضارة دلمون', year:'حوالي 2050 - 1750 ق.م', tags:['unesco','dilmun'], tagsLabel:['تراث عالمي','دلمون'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/Dilmun_Burial_Mounds_2.jpg/640px-Dilmun_Burial_Mounds_2.jpg', lat:26.1625, lng:50.5167, zoom:15, desc:'مجموعة من 11 موقعاً للدفن تضم أكثر من 17000 تلة دفن، أدرجت في قائمة اليونسكو للتراث العالمي عام 2019. تكشف عن طقوس دفن حضارة دلمون.', facts:[{l:'التصنيف',v:'تراث عالمي'},{l:'عدد التلال',v:'+17000'},{l:'المواقع',v:'11 موقعاً'},{l:'الاعتراف',v:'2019'}], stops:[{n:'تلال عالي',d:'أكبر مجمع للمدافن في البحرين'},{n:'مقابر ملكية',d:'تلال كبيرة مخصصة للنخبة'}]},
    {id:'museum', name:'متحف البحرين الوطني', loc:'المنامة، البحرين', country:'🇧🇭 البحرين', period:'جميع العصور', year:'تأسس 1988', tags:['museum'], tagsLabel:['متحف'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/Bahrain_National_Museum_2018.jpg/640px-Bahrain_National_Museum_2018.jpg', lat:26.2375, lng:50.5878, zoom:17, desc:'يعد أول متحف وطني في الخليج العربي. يحوي آثاراً من حضارة دلمون، والفترة الإسلامية، وعصر اللؤلؤ. ويضم قاعة الخط الإسلامي ومعرضين رئيسيين.', facts:[{l:'تأسس',v:'1988'},{l:'القاعات',v:'9 قاعات'},{l:'المقتنيات',v:'+6000 قطعة'}], stops:[{n:'قاعة دلمون',d:'آثار حضارة دلمون العريقة'},{n:'قاعة العصور الإسلامية',d:'نقوش ومخطوطات إسلامية'},{n:'قاعة اللؤلؤ',d:'تاريخ صناعة اللؤلؤ'}]},
    {id:'arad', name:'قلعة عراد', loc:'عراد، البحرين', country:'🇧🇭 البحرين', period:'العصر الإسلامي', year:'القرن الخامس عشر الميلادي', tags:['islamic'], tagsLabel:['إسلامي'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Arad_Fort_in_Bahrain.jpg/640px-Arad_Fort_in_Bahrain.jpg', lat:26.2583, lng:50.6289, zoom:17, desc:'قلعة إسلامية من القرن الخامس عشر، بنيت بأمر من السلاطين العزريين. تتميز بأبراجها المستديرة وفنائها الواسع. كانت محطة على طريق قوافل الحج.', facts:[{l:'القرن',v:'15 الميلادي'},{l:'الأبراج',v:'4 أبراج'},{l:'الشكل',v:'مربع'}], stops:[{n:'الأبراج الأربعة',d:'أبراج دائرية للمراقبة'},{n:'الفناء الداخلي',d:'فناء واسع للاجتماعات'}]},
    {id:'isa', name:'بيت الشيخ عيسى بن علي آل خليفة', loc:'المحرق، البحرين', country:'🇧🇭 البحرين', period:'العصر الإسلامي الحديث', year:'1800 - 1923', tags:['islamic'], tagsLabel:['إسلامي'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Sheikh_Isa_bin_Ali_Al_Khalifa_House_2017.jpg/640px-Sheikh_Isa_bin_Ali_Al_Khalifa_House_2017.jpg', lat:26.2311, lng:50.5722, zoom:17, desc:'قصر تاريخي فخم، يعد من أجمل نماذج العمارة الإسلامية في الخليج. يحتوي على فناءين ومجلس للرجال وقسم للنساء. يفتح اليوم كمتحف يعرض حياة حكام البحرين.', facts:[{l:'العصر',v:'العثماني'},{l:'الفناءات',v:'فناءان'},{l:'الغرف',v:'+60 غرفة'}], stops:[{n:'المجلس الرجالي',d:'مكان استقبال الضيوف'},{n:'الحريم',d:'القسم المخصص للنساء'},{n:'الفناء الكبير',d:'بئر وسط الفناء'}]},
    {id:'tree', name:'شجرة الحياة (شجرة الحياة)', loc:'الجنوب، البحرين', country:'🇧🇭 البحرين', period:'طبيعة', year:'تعود لحوالي 400 عام', tags:['nature'], tagsLabel:['طبيعة'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Tree_of_Life_Bahrain_2014.jpg/480px-Tree_of_Life_Bahrain_2014.jpg', lat:26.0286, lng:50.5500, zoom:16, desc:'شجرة وحيدة تقف وسط صحراء بلا ماء ظاهر. ترمز للحياة والصمود. يصل عمرها إلى 400 عام، ويحيط بها جدار قديم. واحدة من أكثر مناطق الجذب السياحي غرابة.', facts:[{l:'العمر',v:'~400 سنة'},{l:'النوع',v:'بروسوبيس'},{l:'الارتفاع',v:'9.75 م'}], stops:[{n:'الشجرة المركزية',d:'الشجرة الأسطورية'},{n:'الجدار القديم',d:'سور قديم حول الشجرة'}]},
    {id:'barbar', name:'معبد باربار', loc:'باربار، البحرين', country:'🇧🇭 البحرين', period:'حضارة دلمون', year:'حوالي 3000 - 2000 ق.م', tags:['dilmun'], tagsLabel:['دلمون'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Barbar_Temple_Bahrain_1968.jpg/640px-Barbar_Temple_Bahrain_1968.jpg', lat:26.1964, lng:50.4833, zoom:16, desc:'أقدم معبد في الخليج العربي. كان مركزاً لعبادة الإله إنكي إله المياه. يضم ثلاثة معابد متعاقبة تعود لآلاف السنين. اكتشفه الفريق الدنماركي عام 1954.', facts:[{l:'التاريخ',v:'~5000 سنة'},{l:'الآلهة',v:'إنكي'},{l:'المعابد',v:'3 معابد'}], stops:[{n:'المعبد الأول',d:'أقدم معبد (3000 ق.م)'},{n:'المعبد الثاني',d:'إعادة بناء من 2500 ق.م'},{n:'المعبد الثالث',d:'من 2000 ق.م'}]},
    {id:'saar', name:'مستوطنة سار', loc:'سار، البحرين', country:'🇧🇭 البحرين', period:'حضارة دلمون', year:'حوالي 2000 ق.م', tags:['dilmun'], tagsLabel:['دلمون'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Saar_temple_in_Bahrain.jpg/640px-Saar_temple_in_Bahrain.jpg', lat:26.1811, lng:50.4844, zoom:16, desc:'مستوطنة أثرية من حضارة دلمون تضم معابد ومقابر ومبانٍ سكنية. تكشف عن الحياة اليومية لسكان البحرين القدماء قبل 4000 عام.', facts:[{l:'المعابد',v:'3 معابد'},{l:'المقابر',v:'عدة مقابر'}], stops:[{n:'المعبد الرئيسي',d:'معبد متطور ببئر ماء'},{n:'المنطقة السكنية',d:'بقايا بيوت السكان'}]}
  ],
  world: [
    {id:'pyramids', name:'أهرامات الجيزة', loc:'الجيزة، مصر', country:'🇪🇬 مصر', period:'الدولة القديمة الفرعونية', year:'حوالي 2580 - 2510 ق.م', tags:['unesco'], tagsLabel:['تراث عالمي'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Kheops-Pyramid.jpg/640px-Kheops-Pyramid.jpg', lat:29.9792, lng:31.1342, zoom:15, desc:'أهرامات خوفو وخفرع ومنقرع، أحد عجائب الدنيا السبع القديمة. ضريح الملك خوفو يبلغ ارتفاعه 146 متراً، ويعد من أعظم الإنجازات الهندسية في التاريخ.', facts:[{l:'الارتفاع',v:'146 م'},{l:'الحجارة',v:'+2.3 مليون'},{l:'العمر',v:'~4500 سنة'}], stops:[{n:'هرم خوفو الأكبر',d:'أكبر هرم وأعجوبة قديمة'},{n:'أبو الهول',d:'تمثال بجسم أسد ورأس إنسان'},{n:'هرم خفرع',d:'الهرم الثاني بالارتفاع'}]},
    {id:'petra', name:'البتراء (المدينة الوردية)', loc:'معان، الأردن', country:'🇯🇴 الأردن', period:'الأنباط', year:'حوالي 4 ق.م - 106 م', tags:['unesco'], tagsLabel:['تراث عالمي'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Roman_Treasury_in_Petra.jpg/640px-The_Roman_Treasury_in_Petra.jpg', lat:30.3285, lng:35.4444, zoom:15, desc:'مدينة منحوتة في الصخر الوردي، عاصمة مملكة الأنباط. تشتهر بالخزنة والسيق والدير. أحد عجائب الدنيا السبع الجديدة.', facts:[{l:'التأسيس',v:'~4 ق.م'},{l:'اللون',v:'الصخر الوردي'},{l:'الطول',v:'~3 كم'}], stops:[{n:'السيق (الممر)',d:'ممر صخري ضيق بين الجبال'},{n:'الخزنة',d:'واجهة منحوتة مشهورة'},{n:'الدير',d:'صحن واسع منحوت'}]},
    {id:'acropolis', name:'الأكروبول في أثينا', loc:'أثينا، اليونان', country:'🇬🇷 اليونان', period:'اليونان القديمة', year:'القرن الخامس ق.م', tags:['unesco'], tagsLabel:['تراث عالمي'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Acropolis_of_Athens_--_13-04-2011.jpg/640px-Acropolis_of_Athens_--_13-04-2011.jpg', lat:37.9715, lng:23.7257, zoom:16, desc:'موقع أثري فوق تلة، يضم البارثينون ومعبد إيركتيون. رمز الديمقراطية اليونانية القديمة ومهد الحضارة الغربية.', facts:[{l:'الارتفاع',v:'150 م'},{l:'البناء',v:'438 ق.م'}], stops:[{n:'البارثينون',d:'معبد الإلهة أثينا'},{n:'معبد إيركتيون',d:'يضم كارياتيد'},{n:'مسرح ديونيسوس',d:'مهد المسرح'}]},
    {id:'angkor', name:'أنغكور وات', loc:'سيem ريب، كمبوديا', country:'🇰🇭 كمبوديا', period:'إمبراطورية الخمير', year:'القرن الثاني عشر الميلادي', year2:'~1113 - 1150 م', tags:['unesco'], tagsLabel:['تراث عالمي'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Angkor_wat_temple.jpg/640px-Angkor_wat_temple.jpg', lat:13.4125, lng:103.8670, zoom:15, desc:'أكبر معبد ديني في العالم. بُني في عهد الملك Suryavarman الثاني. رمز كمبوديا ويظهر على علمها. من عجائب الدنيا السبع الجديدة.', facts:[{l:'المساحة',v:'~400 كم²'},{l:'القرن',v:'12 الميلادي'},{l:'البحيرة',v:'190 م عرضاً'}], stops:[{n:'البرج المركزي',d:'يضم 5 أبراج على شكل لوتس'},{n:'الحيطان المنقوشة',d:'نقوش حجرية لقصص إسلامية'},{n:'البحيرة المحيطة',d:'محيط مائي يعكس المعبد'}]},
    {id:'machu', name:'ماتشو بيتشو', loc:'كوسكو، بيرو', country:'🇵🇪 بيرو', period:'حضارة الإنكا', year:'~1450 م', tags:['unesco'], tagsLabel:['تراث عالمي'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Machu_Picchu%2C_Peru.jpg/640px-Machu_Picchu%2C_Peru.jpg', lat:-13.1631, lng:-72.5450, zoom:14, desc:'مدينة الإنكا المفقودة في قمم جبال الأنديز. اكتشفها العالم بيرشام عام 1911. عجائب الدنيا السبع الجديدة.', facts:[{l:'الارتفاع',v:'2430 م'},{l:'الاكتشاف',v:'1911'}], stops:[{n:'المعبد الشمسي',d:'مرصد فلكي'},{n:'الميدان الرئيسي',d:'ميدان الطقوس'},{n:'حي السكن',d:'منازل الإنكا'}]},
    {id:'stone', name:'ستونهنج', loc:'ويلتشير، إنجلترا', country:'🇬🇧 المملكة المتحدة', period:'العصر الحجري الحديث', year:'~3000 - 2000 ق.م', tags:['unesco'], tagsLabel:['تراث عالمي'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Stonehenge_back_wide.jpg/640px-Stonehenge_back_wide.jpg', lat:51.1789, lng:-1.8262, zoom:15, desc:'دائرة حجرية ضخمة من العصر الحجري. لا يزال الغرض الدقيق منها مجهولاً، لكن يعتقد أنها مرصد فلكي أو موقع طقسي.', facts:[{l:'العمر',v:'~5000 سنة'},{l:'الحجارة',v:'~100 حجر'}], stops:[{n:'الدائرة الخارجية',d:'حجارة ضخمة عمودية'},{n:'مركز الدائرة',d:'حجر الغلاف'}]},
    {id:'colosseum', name:'الكولوسيوم', loc:'روما، إيطاليا', country:'🇮🇹 إيطاليا', period:'الإمبراطورية الرومانية', year:'70 - 80 م', tags:['unesco'], tagsLabel:['تراث عالمي'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Colosseo_2020.jpg/640px-Colosseo_2020.jpg', lat:41.8902, lng:12.4922, zoom:16, desc:'أكبر مدرج روماني، كان يستوعب 80,000 متفرج. شهد معارك المصارعين والحيوانات. رمز الإمبراطورية الرومانية.', facts:[{l:'السعة',v:'~80,000'},{l:'الارتفاع',v:'48 م'},{l:'الافتتاح',v:'80 م'}], stops:[{n:'المدرج',d:'أرضية المعارك'},{n:'الأنفاق',d:'ممرات تحت الأرض'},{n:'المدرجات',d:'مقاعد الجمهور'}]},
    {id:'taj', name:'تاج محل', loc:'أغرا، الهند', country:'🇮🇳 الهند', period:'الإمبراطورية المغولية', year:'~1632 - 1653 م', tags:['unesco'], tagsLabel:['تراث عالمي'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Taj_Mahal%2C_Agra%2C_India_edit3.jpg/640px-Taj_Mahal%2C_Agra%2C_India_edit3.jpg', lat:27.1751, lng:78.0421, zoom:16, desc:'ضريح الإمبراطور شاه جهان لزوجته ممتاز محل. رمز الحب الأبدي. عجائب الدنيا السبع الجديدة. يجمع بين العمارة الفارسية والإسلامية والهندية.', facts:[{l:'البناء',v:'~22 سنة'},{l:'الارتفاع',v:'73 م'},{l:'العمّال',v:'~20,000'}], stops:[{n:'الضريح الرئيسي',d:'قبر ممتاز محل'},{n:'الحدائق',d:'حدائق على الطراز الفارسي'},{n:'المسجد',d:'مسجد أحمر'}]},
    {id:'alhambra', name:'قصر الحمراء', loc:'غرناطة، إسبانيا', country:'🇪🇸 إسبانيا', period:'المورسكيون', year:'~1238 - 1492 م', tags:['unesco'], tagsLabel:['تراث عالمي'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Alhambra_Granada_Spain_3.jpg/640px-Alhambra_Granada_Spain_3.jpg', lat:37.1761, lng:-3.5881, zoom:15, desc:'مجمع قصور على التل الأحمر، شيده ملوك بني نصر. تحفة الفن الإسلامي في الأندلس، تشتهر بزخارفها وقصر الحمراء وقصر الريف.', facts:[{l:'الاسم',v:'القلعة الحمراء'},{l:'العصر',v:'المورسكي'}], stops:[{n:'قصر الريف',d:'أعمال جبسية مذهلة'},{n:'قصر الحمراء',d:'قصر الاستقبالات'},{n:'حدائق جنراليف',d:'حدائق هندسية'}]},
    {id:'wall', name:'السور العظيم (بادالينغ)', loc:'بكين، الصين', country:'🇨🇳 الصين', period:'سلالات مينغ', year:'~1368 - 1644 م', tags:['unesco'], tagsLabel:['تراث عالمي'], img:'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/The_Great_Wall_of_China_at_Jinshanling-edit.jpg/640px-The_Great_Wall_of_China_at_Jinshanling-edit.jpg', lat:40.4319, lng:116.5704, zoom:15, desc:'سور ضخم يمتد لآلاف الكيلومترات، بناه أباطرة الصين لحماية الإمبراطورية من الغزاة. أحد عجائب الدنيا السبع الجديدة.', facts:[{l:'الطول',v:'+21,000 كم'},{l:'الارتفاع',v:'~9 م'}], stops:[{n:'برج المراقبة',d:'أبراج على طول السور'},{n:'الممر العلوي',d:'طريق للسير'}]}
  ]
};

// فيديوهات يوتيوب 360° - روابط حقيقية مُتحقَّق منها (تعمل فعلياً على يوتيوب)
// جميع المعرّفات تم التحقق منها يدوياً عبر youtube.com/oembed قبل الإدراج
const VT_VIDEOS = [
  {id:'yt1',  title:'جولة افتراضية 360° - أهرامات الجيزة',  videoId:'RMPMQih0BTM', desc:'جولة 360° في أهرامات الجيزة وأبو الهول — مصر'},
  {id:'yt2',  title:'جولة 360° - تاج محل',                  videoId:'pDLzAwXOt9c', desc:'تجول داخل تاج Mahal من الهند — رمز الحب'},
  {id:'yt3',  title:'جولة 360° - الكولوسيوم',                videoId:'Yn1DVpoNk1E', desc:'داخل الكولوسيوم في روما — المدرج الروماني'},
  {id:'yt4',  title:'جولة 360° - الأكروبول (البارثينون)',     videoId:'yobITBWHgh0', desc:'البارثينون في أثينا — اليونان القديمة'},
  {id:'yt5',  title:'جولة 360° - البتراء (المدينة الوردية)',  videoId:'5oh-fMWtyUM', desc:'التيزري / الخزنة في البتراء — الأردن'},
  {id:'yt6',  title:'جولة 360° - أنغكور وات',                 videoId:'B8UzsVY1IE8', desc:'معبد أنغكور وات في كمبوديا — عجائب الدنيا'},
  {id:'yt7',  title:'جولة 360° - ماتشو بيتشو',                videoId:'cOCsYafCQCk', desc:'مدينة الإنكا المفقودة في جبال الأنديز — بيرو'},
  {id:'yt8',  title:'جولة 360° - قلعة البحرين (قَلْعَة)',      videoId:'MjF2nX-PZ6k', desc:'قلعة البحرين — موقع تراث عالمي UNESCO'},
  {id:'yt9',  title:'جولة 360° - داخل الهرم الأكبر',          videoId:'TMzouTzim0o', desc:'داخل هرم خوفو الأكبر — BBC 360°'},
  {id:'yt10', title:'جولة 360° - سور الصين العظيم',            videoId:'1k3zyuTYiF0', desc:'على سور الصين العظيم — 8K VR Walking Tour'}
];

let currentTour = null;

function getEmbedUrl(site){
  // استخدام Google Maps embed بإحداثيات دقيقة - يعمل للجميع
  return `https://maps.google.com/maps?q=${site.lat},${site.lng}&hl=ar&z=${site.zoom||17}&t=k&output=embed`;
}
function getExternalUrl(site){
  return `https://www.google.com/maps/place/${site.lat},${site.lng}/@${site.lat},${site.lng},${site.zoom||17}z`;
}
function getStreetViewUrl(site){
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${site.lat},${site.lng}`;
}

function openVirtualTours(){
  openModal('modalVirtualTours');
}

function renderVirtualTours(){
  // Bahrain
  const bh = document.getElementById('vtGridBahrain');
  if(bh){
    bh.innerHTML = VT_SITES.bahrain.map(s=>vtCardHtml(s)).join('');
    document.getElementById('vt-count-bahrain').textContent = VT_SITES.bahrain.length;
  }
  // World
  const wd = document.getElementById('vtGridWorld');
  if(wd){
    wd.innerHTML = VT_SITES.world.map(s=>vtCardHtml(s)).join('');
    document.getElementById('vt-count-world').textContent = VT_SITES.world.length;
  }
  // Videos
  const vd = document.getElementById('vtGridVideo');
  if(vd){
    vd.innerHTML = VT_VIDEOS.map(v=>`
      <div class="vt-yt-card" onclick="openVideoTour('${v.id}')">
        <div class="vt-yt-thumb">
          <img src="https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg" alt="${v.title}" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg'">
          <span class="vt-yt-play"><i class="fab fa-youtube"></i></span>
          <span class="vt-yt-360">360°</span>
        </div>
        <div class="vt-yt-info">
          <div class="vt-yt-title">${v.title}</div>
          <div class="vt-yt-meta"><i class="fas fa-play-circle"></i> ${v.desc}</div>
        </div>
      </div>
    `).join('');
  }
}

function vtCardHtml(s){
  const isUnesco = (s.tags||[]).includes('unesco');
  return `
    <div class="vt-card" onclick="openTour('${s.id}')" data-name="${s.name}">
      <div class="vt-thumb">
        <img src="${s.img}" alt="${s.name}" loading="lazy" onerror="this.style.display='none'">
        <div class="vt-thumb-overlay"><span class="vt-country">${s.country}</span></div>
        <div class="vt-360"><i class="fas fa-vr-cardboard"></i> 360°</div>
        ${isUnesco?'<div class="vt-unesco"><i class="fas fa-globe"></i> UNESCO</div>':''}
      </div>
      <div class="vt-info">
        <div class="vt-name">${s.name}</div>
        <div class="vt-loc"><i class="fas fa-map-marker-alt"></i> ${s.loc}</div>
        <div class="vt-desc">${s.desc.substring(0,90)}...</div>
        <div class="vt-tags">
          ${(s.tagsLabel||[]).map((t,i)=>`<span class="vt-tag ${s.tags[i]||''}">${t}</span>`).join('')}
        </div>
      </div>
      <div class="vt-go"><i class="fas fa-play"></i></div>
    </div>
  `;
}

function switchVtTab(tab, btn){
  document.querySelectorAll('.vt-tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  ['bahrain','world','video'].forEach(t=>{
    const el = document.getElementById('vtTab'+t.charAt(0).toUpperCase()+t.slice(1));
    if(el) el.style.display = t===tab ? 'block' : 'none';
  });
}

function filterVtSites(){
  const q = (document.getElementById('vtSearch').value||'').trim().toLowerCase();
  ['bahrain','world'].forEach(cat=>{
    const grid = document.getElementById('vtGrid'+cat.charAt(0).toUpperCase()+cat.slice(1));
    if(!grid)return;
    let visible = 0;
    grid.querySelectorAll('.vt-card').forEach(card=>{
      const name = (card.dataset.name||'').toLowerCase();
      const match = !q || name.includes(q);
      card.style.display = match ? '' : 'none';
      if(match) visible++;
    });
    if(visible === 0 && q){
      // Empty state
      if(!grid.querySelector('.vt-empty')){
        const empty = document.createElement('div');
        empty.className = 'vt-empty';
        empty.innerHTML = '<i class="fas fa-search"></i><p>لا توجد نتائج لـ "'+q+'"</p>';
        grid.appendChild(empty);
      }
    } else {
      const e = grid.querySelector('.vt-empty');
      if(e) e.remove();
    }
  });
}

function findSite(id){
  return [...VT_SITES.bahrain, ...VT_SITES.world].find(s=>s.id===id);
}

function openTour(id){
  const site = findSite(id);
  if(!site)return;
  currentTour = {...site, isVideo:false};
  const frame = document.getElementById('vtViewerFrame');
  const loading = document.getElementById('vtViewerLoading');
  loading.classList.remove('hide');
  document.getElementById('vtViewerTitle').innerHTML = `<i class="fas fa-vr-cardboard"></i> <span>${site.name}</span>`;
  document.getElementById('vtViewerExternalBtn').onclick = (e)=>{ e.preventDefault(); window.open(getStreetViewUrl(site), '_blank'); };
  document.getElementById('vtViewerExternalBtn').href = getStreetViewUrl(site);
  const infoBar = document.getElementById('vtViewerInfoBar');
  infoBar.innerHTML = `
    <div class="vt-icon"><i class="fas fa-landmark"></i></div>
    <div class="vt-text">
      <h3>${site.name} ${site.tags&&site.tags.includes('unesco')?'<span style="background:linear-gradient(135deg,#f9d423,#c8a415);color:#3a2a00;padding:2px 8px;border-radius:8px;font-size:.65rem">UNESCO</span>':''}</h3>
      <div class="vt-loc-line"><i class="fas fa-map-marker-alt"></i> ${site.loc} • ${site.country} • <i class="fas fa-calendar"></i> ${site.period}</div>
    </div>
    <div class="vt-badges">
      <span class="vt-badge"><i class="fas fa-vr-cardboard"></i> 360°</span>
      <span class="vt-badge"><i class="fas fa-globe"></i> ${site.year}</span>
    </div>
  `;
  // Set iframe src
  frame.src = getEmbedUrl(site);
  frame.onload = ()=>{setTimeout(()=>loading.classList.add('hide'),800);};
  // Populate info panes
  renderTourOverview(site);
  renderTourHistory(site);
  renderTourStops(site);
  renderTourClassroom(site);
  // Reset to overview tab
  document.querySelectorAll('.vt-tab-mini').forEach(t=>t.classList.remove('active'));
  document.querySelector('.vt-tab-mini[data-pane="overview"]').classList.add('active');
  document.querySelectorAll('.vt-content-pane').forEach(p=>p.classList.remove('active'));
  document.getElementById('vtPaneOverview').classList.add('active');
  closeModal('modalVirtualTours');
  setTimeout(()=>openModal('modalTourViewer'),200);
}

function openVideoTour(videoId){
  const v = VT_VIDEOS.find(x=>x.id===videoId);
  if(!v)return;
  currentTour = {...v, isVideo:true};

  const wrap = document.getElementById('vtViewerWrap');
  const frame = document.getElementById('vtViewerFrame');
  const loading = document.getElementById('vtViewerLoading');
  // نظّف أي محتوى سابق (iframe + رسائل خطأ + كارت سابق)
  if(frame){ frame.src = 'about:blank'; frame.style.display = 'none'; }
  if(loading) loading.classList.add('hide');
  if(wrap){
    const prev = wrap.querySelector('.vt-video-card, .vt-video-error');
    if(prev) prev.remove();
  }

  const ytWatchUrl = `https://www.youtube.com/watch?v=${v.videoId}`;

  // عنوان + زر "فتح في يوتيوب" في الشريط العلوي
  document.getElementById('vtViewerTitle').innerHTML = `<i class="fab fa-youtube"></i> <span>${v.title}</span>`;
  document.getElementById('vtViewerExternalBtn').onclick = (e)=>{ e.preventDefault(); window.open(ytWatchUrl,'_blank','noopener,noreferrer'); };
  document.getElementById('vtViewerExternalBtn').href = ytWatchUrl;
  const infoBar = document.getElementById('vtViewerInfoBar');
  infoBar.innerHTML = `
    <div class="vt-icon" style="background:linear-gradient(135deg,#e74c3c,#c0392b)"><i class="fab fa-youtube"></i></div>
    <div class="vt-text">
      <h3>${v.title} <span style="background:#e74c3c;color:white;padding:2px 8px;border-radius:8px;font-size:.65rem">360° VR</span></h3>
      <div class="vt-loc-line"><i class="fas fa-globe"></i> فيديو تفاعلي من يوتيوب • <i class="fas fa-vr-cardboard"></i> يمكنكِ التدوير والرؤية من كل الزوايا</div>
    </div>
    <div class="vt-badges">
      <span class="vt-badge" style="background:linear-gradient(135deg,#e74c3c,#c0392b)"><i class="fab fa-youtube"></i> YouTube</span>
    </div>
  `;

  // ════════════════════════════════════════════════════════════════════════
  // لا تضمين iframe بعد الآن — نعرض كارت معلوماتي أنيق:
  //  - صورة مصغّرة حقيقية من يوتيوب (img.youtube.com)
  //  - زر "تشغيل في يوتيوب" يفتح في تبويب جديد
  //  - يضمن العمل في 100% من البيئات (بدون أخطاء 153/101/150)
  // ════════════════════════════════════════════════════════════════════════
  if(wrap){
    const card = document.createElement('div');
    card.className = 'vt-video-card';
    card.setAttribute('dir','rtl');
    card.innerHTML = `
      <div class="vt-vc-thumb">
        <img src="https://img.youtube.com/vi/${v.videoId}/maxresdefault.jpg"
             alt="${v.title}"
             loading="lazy"
             referrerpolicy="no-referrer"
             onerror="this.onerror=null;this.src='https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg'">
        <div class="vt-vc-thumb-overlay">
          <a class="vt-vc-play" href="${ytWatchUrl}" target="_blank" rel="noopener noreferrer" aria-label="تشغيل في يوتيوب">
            <i class="fab fa-youtube"></i>
            <span>تشغيل</span>
          </a>
        </div>
        <span class="vt-vc-badge">360° VR</span>
      </div>
      <div class="vt-vc-body">
        <h3 class="vt-vc-title">${v.title}</h3>
        <p class="vt-vc-desc">${v.desc}</p>
        <div class="vt-vc-actions">
          <a class="vt-vc-btn vt-vc-btn-primary" href="${ytWatchUrl}" target="_blank" rel="noopener noreferrer">
            <i class="fab fa-youtube"></i>
            <span>افتحي الفيديو في يوتيوب</span>
          </a>
          <button class="vt-vc-btn vt-vc-btn-ghost" onclick="vtCopyVideoLink('${v.videoId}', this)" type="button">
            <i class="fas fa-link"></i>
            <span>نسخ الرابط</span>
          </button>
        </div>
        <div class="vt-vc-hint">
          <i class="fas fa-info-circle"></i>
          يتم تشغيل الفيديو داخل يوتيوب مباشرة لتجربة عرض مستقرة وبدون أي قيود تضمين.
        </div>
      </div>
    `;
    wrap.appendChild(card);
  }

  // For video tours, show simple content in side tabs
  document.getElementById('vtPaneOverview').innerHTML = `
    <div class="vt-history">
      <h4><i class="fas fa-info-circle"></i> حول هذا الفيديو</h4>
      <p>${v.desc}</p>
      <p>هذا فيديو <b>360° تفاعلي</b> من يوتيوب. يمكن للطالبات تحريك زاوية الرؤية بالماوس أو اللمس، واستكشاف الموقع من جميع الاتجاهات.</p>
      <p><b>للاستفادة القصوى:</b> شغلي الفيديو على وضع ملء الشاشة داخل يوتيوب، ودعي الطالبات يأخذن أدواراً في وصف ما يرينه.</p>
    </div>
  `;
  document.getElementById('vtPaneHistory').innerHTML = `<div class="vt-history"><p>الفيديو لا يحتوي على معلومات تاريخية مفصلة. استخدمي معلوماتكِ أو وزّعي على الطالبات مهمة بحث سريعة عن هذا الموقع.</p></div>`;
  document.getElementById('vtPaneStops').innerHTML = `<div class="vt-history"><p>الفيديو جولة واحدة متكاملة. يمكن للطالبات تدوين ما يلاحظن من تفاصيل معمارية وثقافية.</p></div>`;
  document.getElementById('vtPaneClassroom').innerHTML = `
    <div class="vt-history">
      <h4><i class="fas fa-chalkboard-teacher"></i> أنشطة مقترحة</h4>
      <p>• توقفي عند مشهد معين واسألي الطالبات: ما الذي ترينه؟</p>
      <p>• اطلبي من الطالبات رسم ما يرينه في دفاترهن</p>
      <p>• ناقشي الفرق بين المعمار القديم والحديث</p>
    </div>
  `;
  document.querySelectorAll('.vt-tab-mini').forEach(t=>t.classList.remove('active'));
  document.querySelector('.vt-tab-mini[data-pane="overview"]').classList.add('active');
  document.querySelectorAll('.vt-content-pane').forEach(p=>p.classList.remove('active'));
  document.getElementById('vtPaneOverview').classList.add('active');
  closeModal('modalVirtualTours');
  setTimeout(()=>openModal('modalTourViewer'),200);
}

/** vtCopyVideoLink — ينسخ رابط فيديو يوتيوب للحافظة مع تأكيد بصري */
function vtCopyVideoLink(videoId, btn){
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const showOk = ()=>{
    if(!btn) return;
    const span = btn.querySelector('span');
    const old = span ? span.textContent : '';
    if(span) span.textContent = '✓ تم النسخ';
    btn.classList.add('vt-vc-btn-ok');
    setTimeout(()=>{
      if(span) span.textContent = old || 'نسخ الرابط';
      btn.classList.remove('vt-vc-btn-ok');
    }, 1600);
  };
  const fallback = ()=>{
    const ta = document.createElement('textarea');
    ta.value = url; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); showOk(); }catch(e){}
    document.body.removeChild(ta);
  };
  if(navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(url).then(showOk).catch(fallback);
  } else {
    fallback();
  }
}

function closeTourViewer(){
  closeModal('modalTourViewer');
  setTimeout(()=>{
    // أعد تهيئة الـ iframe لاستخدامه في جولات Street View القادمة
    const frame = document.getElementById('vtViewerFrame');
    if(frame){
      frame.src = 'about:blank';
      frame.style.display = 'block';
    }
    // نظّف كارت الفيديو (إن وُجد) ليستخدم الـ iframe بدلاً منه في الجولات الأخرى
    const wrap = document.getElementById('vtViewerWrap');
    if(wrap){
      const card = wrap.querySelector('.vt-video-card, .vt-video-error');
      if(card) card.remove();
    }
    document.getElementById('vtViewerLoading').classList.remove('hide');
  },300);
}

// معالج موحّد لزر "فتح كامل" — يفتح الرابط الحالي للزر في تبويب جديد
function vtOpenExternal(e){
  e.preventDefault();
  const a = document.getElementById('vtViewerExternalBtn');
  if(!a) return;
  const href = a.getAttribute('href');
  if(!href || href === '#' || href === 'about:blank'){
    // محاولة احتياطية: استخدم currentTour
    if(currentTour){
      const url = currentTour.isVideo
        ? `https://www.youtube.com/watch?v=${currentTour.videoId}`
        : (currentTour.lat ? `https://www.google.com/maps/place/${currentTour.lat},${currentTour.lng}/@${currentTour.lat},${currentTour.lng},${currentTour.zoom||17}z` : null);
      if(url) window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      console.warn('vtOpenExternal: no current tour loaded yet');
    }
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}

function switchVtInfoTab(pane, btn){
  document.querySelectorAll('.vt-tab-mini').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.vt-content-pane').forEach(p=>p.classList.remove('active'));
  document.getElementById('vtPane'+pane.charAt(0).toUpperCase()+pane.slice(1)).classList.add('active');
}

function renderTourOverview(site){
  const facts = (site.facts||[]).map(f=>`<div class="vt-fact"><div class="vt-fact-label">${f.l}</div><div class="vt-fact-value">${f.v}</div></div>`).join('');
  document.getElementById('vtPaneOverview').innerHTML = `
    <div class="vt-history">
      <h4><i class="fas fa-info-circle"></i> نبذة عن الموقع</h4>
      <p>${site.desc}</p>
      <div class="vt-facts">${facts}</div>
    </div>
  `;
}

function renderTourHistory(site){
  document.getElementById('vtPaneHistory').innerHTML = `
    <div class="vt-history">
      <h4><i class="fas fa-scroll"></i> السياق التاريخي</h4>
      <p><b>الفترة:</b> ${site.period}</p>
      <p><b>التاريخ:</b> ${site.year}</p>
      <p>يعد هذا الموقع من أهم المعالم ${site.tags&&site.tags.includes('unesco')?'التراثية العالمية المسجلة في اليونسكو ':''}، ويجذب ملايين الزوار سنوياً لدراسة تاريخه وفنونه المعمارية الفريدة.</p>
      ${site.tags&&site.tags.includes('dilmun')?'<p><b>عن حضارة دلمون:</b> حضارة قديمة ازدهرت في البحرين قبل أكثر من 4000 عام، وكانت مركزاً تجارياً مهماً يربط بلاد الرافدين بوادي السند.</p>':''}
      ${site.tags&&site.tags.includes('islamic')?'<p><b>العمارة الإسلامية:</b> يتميز هذا الموقع بخصائص العمارة الإسلامية من أقواس وقباب وزخارف هندسية ونباتية دقيقة.</p>':''}
    </div>
  `;
}

function renderTourStops(site){
  const stops = (site.stops||[]).map((s,i)=>`
    <div class="vt-stop" onclick="vtScrollToStop(${i})">
      <div class="vt-stop-num">${i+1}</div>
      <div class="vt-stop-info">
        <div class="vt-stop-name">${s.n}</div>
        <div class="vt-stop-desc">${s.d}</div>
      </div>
      <div class="vt-stop-arrow"><i class="fas fa-chevron-left"></i></div>
    </div>
  `).join('');
  document.getElementById('vtPaneStops').innerHTML = `
    <div class="vt-history">
      <h4><i class="fas fa-map-marker-alt"></i> محطات الجولة (${(site.stops||[]).length} محطات)</h4>
      <p>اضغطي على أي محطة لمشاهدتها في الجولة الافتراضية، أو استخدمي أزرار التحريك داخل الخريطة للتنقل.</p>
      <div class="vt-stops">${stops}</div>
    </div>
  `;
}

function renderTourClassroom(site){
  const activities = site.country && site.country.includes('البحرين') ? [
    'اقرئي نصاً تعريفياً عن الموقع قبل الجولة',
    'اسألي الطالبات: ماذا تتوقعن أن نرى؟',
    'بعد الجولة: اكتبوا معاً قائمة بأهم 5 أشياء رأيتموها',
    'نشاط بحثي: ابحثي عن قصة أسطورية مرتبطة بالموقع',
    'مقارنة: ما الفرق بين هذا الموقع وموقع آخر درستموه؟',
    'نشاط رسم: ارسمي الموقع من وجهة نظركِ'
  ] : [
    'استخدمي الجولة كمدخل لدرس عن الحضارات القديمة',
    'اسألي الطالبات: ما الذي يميز هذا الموقع عن تراثنا في البحرين؟',
    'نشاط خريطة: حددي موقع الموقع على خريطة العالم',
    'نشاط لغوي: تعلمي 5 كلمات بلغة هذا الشعب',
    'مقارنة ثقافية: قارني العادات والتقاليد',
    'مشروع بحثي: كل طالبة تختار معلومة وتعرضها'
  ];
  const list = activities.map(a=>`<p>• ${a}</p>`).join('');
  document.getElementById('vtPaneClassroom').innerHTML = `
    <div class="vt-history">
      <h4><i class="fas fa-chalkboard-teacher"></i> أنشطة وأنماط تعلّم مقترحة</h4>
      ${list}
      <h4 style="margin-top:14px"><i class="fas fa-question-circle"></i> أسئلة للنقاش</h4>
      <p>• ما أهم ميزة معمارية لاحظتِ في هذا الموقع؟</p>
      <p>• كيف بنى الإنسان القديم هذه التحفة بدون تكنولوجيا حديثة؟</p>
      <p>• ما الذي يجعل هذا الموقع يستحق الحماية من اليونسكو؟</p>
      <p>• لو زرتي هذا الموقع حقيقة، ما الذي ستفعلينه أولاً؟</p>
    </div>
  `;
}

function vtScrollToStop(idx){
  // Could implement panning to coordinates - for now, just notify
  toast('info',`محطة ${idx+1}: استخدمي أزرار الخريطة للتنقل يدوياً`);
}

function vtCaptureToBoard(){
  // Capture the current iframe content to canvas
  // Since we can't directly capture cross-origin iframes, we put a notification card on board
  if(!currentTour) return;
  const site = currentTour;
  const x = 100, y = 100;
  // Create a rich note on the board
  const note = {
    id: 'vt-'+Date.now(),
    type: 'vt-capture',
    x, y, w: 420, h: 280,
    site: site.name,
    loc: site.loc,
    year: site.year,
    country: site.country,
    img: site.img || ''
  };
  State.stickies = State.stickies || [];
  State.stickies.push(note);
  drawVTCapture(note);
  toast('success','✓ تم إرسال الجولة للسبورة');
  closeTourViewer();
}

function drawVTCapture(note){
  // Draw a rich card on the canvas
  const x = note.x, y = note.y, w = note.w, h = note.h;
  // Save current state
  ctx.save();
  // Background
  ctx.fillStyle = 'white';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#1a5f7a';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  // Header
  const grad = ctx.createLinearGradient(x, y, x+w, y);
  grad.addColorStop(0, '#1a5f7a');
  grad.addColorStop(1, '#0f3460');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, 40);
  // Title
  ctx.fillStyle = 'white';
  ctx.font = 'bold 16px Tajawal, Arial';
  ctx.textAlign = 'center';
  ctx.fillText('🌍 جولة افتراضية', x+w/2, y+26);
  // Site name
  ctx.fillStyle = '#1a5f7a';
  ctx.font = 'bold 18px Tajawal, Arial';
  ctx.fillText(note.site, x+w/2, y+70);
  // Location
  ctx.fillStyle = '#666';
  ctx.font = '13px Tajawal, Arial';
  ctx.fillText('📍 ' + note.loc, x+w/2, y+92);
  ctx.fillText('🌐 ' + note.country + '  •  📅 ' + note.year, x+w/2, y+112);
  // Try to draw image
  if(note.img){
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = ()=>{
      const imgW = w-40, imgH = 100;
      const imgX = x+20, imgY = y+130;
      try{
        ctx.drawImage(img, imgX, imgY, imgW, imgH);
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        ctx.strokeRect(imgX, imgY, imgW, imgH);
      }catch(e){
        ctx.fillStyle = '#e8e8e8';
        ctx.fillRect(imgX, imgY, imgW, imgH);
        ctx.fillStyle = '#999';
        ctx.font = '14px Tajawal';
        ctx.textAlign = 'center';
        ctx.fillText('🖼️ '+note.site, imgX+imgW/2, imgY+imgH/2);
      }
      // Footer
      ctx.fillStyle = '#1a5f7a';
      ctx.font = 'bold 13px Tajawal, Arial';
      ctx.fillText('— جولة افتراضية 360° —', x+w/2, y+250);
      ctx.fillStyle = '#888';
      ctx.font = '11px Tajawal, Arial';
      ctx.fillText(new Date().toLocaleDateString('ar-BH'), x+w/2, y+268);
      ctx.restore();
      saveCanvas();
    };
    img.onerror = ()=>{
      // Fallback without image
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(x+20, y+130, w-40, 100);
      ctx.fillStyle = '#999';
      ctx.font = 'bold 14px Tajawal, Arial';
      ctx.textAlign = 'center';
      ctx.fillText('🏛️ '+note.site, x+w/2, y+185);
      ctx.fillStyle = '#1a5f7a';
      ctx.font = 'bold 13px Tajawal, Arial';
      ctx.fillText('— جولة افتراضية 360° —', x+w/2, y+250);
      ctx.fillStyle = '#888';
      ctx.font = '11px Tajawal, Arial';
      ctx.fillText(new Date().toLocaleDateString('ar-BH'), x+w/2, y+268);
      ctx.restore();
      saveCanvas();
    };
    img.src = note.img;
  } else {
    // For video tours
    ctx.fillStyle = '#e74c3c';
    ctx.fillRect(x+20, y+130, w-40, 100);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 30px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('▶', x+w/2, y+185);
    ctx.font = 'bold 14px Tajawal';
    ctx.fillText(note.site, x+w/2, y+210);
    ctx.fillStyle = '#1a5f7a';
    ctx.font = 'bold 13px Tajawal, Arial';
    ctx.fillText('— جولة افتراضية 360° —', x+w/2, y+250);
    ctx.restore();
    saveCanvas();
  }
}

function saveCanvas(){
  if(typeof saveHistory === 'function'){
    saveHistory();
  }else if(typeof State !== 'undefined' && State.history){
    // احتياطي: قص أي redo ثم ادفع snapshot
    State.history=State.history.slice(0,State.historyIndex+1);
    State.history.push(canvas.toDataURL());
    State.historyIndex++;
    if(State.history.length > State.maxHistory){
      State.history.shift();
      if(State.historyIndex>0) State.historyIndex--;
    }
  }
}

function vtShareTour(){
  if(!currentTour)return;
  // Build share URL
  const url = currentTour.isVideo 
    ? `https://www.youtube.com/watch?v=${currentTour.videoId}`
    : getStreetViewUrl(currentTour);
  // Use existing QR if available
  if(typeof generateQR === 'function'){
    document.getElementById('qrLink').value = url;
    closeTourViewer();
    setTimeout(()=>{
      openModal('modalSave');
      setTimeout(generateQR,300);
    },300);
    toast('success','✓ تم توليد رمز QR للمشاركة');
  } else {
    navigator.clipboard.writeText(url);
    toast('success','✓ تم نسخ الرابط');
  }
}

function vtFullscreen(){
  const frame = document.getElementById('vtViewerFrame');
  if(frame.requestFullscreen) frame.requestFullscreen();
  else if(frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
  else if(frame.mozRequestFullScreen) frame.mozRequestFullScreen();
}

function vtOpenRandom(){
  const all = [...VT_SITES.bahrain, ...VT_SITES.world, ...VT_VIDEOS.map(v=>({...v, isVideo:true, name:v.title}))];
  const pick = all[Math.floor(Math.random()*all.length)];
  if(pick.isVideo) openVideoTour(pick.id);
  else openTour(pick.id);
  toast('success','🎲 جولة عشوائية: '+pick.name);
}
console.log('%c🌟 سبورة المعرفة التفاعلية v4.0 🌟','color:#1a5f7a;font-size:18px;font-weight:bold');

/* ============================================================
   PhET PANEL — أضيفت بواسطة Mavis
   يفتح لوحة محاكيات PhET كـ data: URL داخل iframe
   (تجنّب مشاكل CORS وملفات iFrame المحظورة)
   ============================================================ */

const PHET_SIMS = {
  physics: [
    {n:'forces-and-motion-basics',  e:'🚀', t:'القوى والحركة: أساسيات',      d:'استكشاف قوى الدفع والاحتكاك وتأثيرها على حركة الأجسام.',                   g:'الصف 7-9'},
    {n:'wave-on-a-string',          e:'🎸', t:'موجة على وتر',                  d:'دراسة الموجات المستعرضة: السعة، التردد، سرعة الموجة، والتداخل.',           g:'الصف 10-12'},
    {n:'circuit-construction-kit-dc',e:'⚡', t:'الدارات الكهربائية DC',       d:'بناء دوائر كهربائية بمقاومات وبطاريات ومصابيح، وقياس التيار والجهد.',     g:'الصف 9-11'},
    {n:'gravity-and-orbits',        e:'🌍', t:'الجاذبية والمدارات',            d:'استكشاف قانون الجذب العام لنيوتن وحركة الكواكب حول الشمس.',               g:'الصف 10-12'},
    {n:'energy-skate-park-basics',  e:'🛹', t:'حديقة التزلج: أساسيات الطاقة',  d:'تحولات الطاقة بين الحركية والوضع والجاذبية عبر مسار تزلج.',              g:'الصف 9-11'},
    {n:'friction',                  e:'🧱', t:'الاحتكاك',                      d:'فهم قوى الاحتكاك الساكن والمتحرك وكيف تؤثر على حركة الأجسام.',          g:'الصف 7-9'},
    {n:'wave-interference',         e:'〰️', t:'تداخل الموجات',                d:'دراسة التداخل البناء والهدام للموجات المائية والضوئية.',                  g:'الصف 11-12'},
    {n:'bending-light',             e:'💡', t:'انكسار الضوء',                  d:'استكشاف قوانين الانكسار والانعكاس، العدسات، والألوان.',                    g:'الصف 10-12'}
  ],
  chem: [
    {n:'build-an-atom',                       e:'⚛️', t:'بناء ذرة',                    d:'تركيب الذرة من بروتونات ونيوترونات وإلكترونات وبناء عناصر مختلفة.',     g:'الصف 8-10'},
    {n:'molecule-shapes',                     e:'🔷', t:'أشكال الجزيئات',              d:'استكشاف الأشكال الهندسية للجزيئات ونظرية VSEPR.',                          g:'الصف 10-12'},
    {n:'acid-base-solutions',                 e:'🧪', t:'محاليل الحموض والقواعد',      d:'فهم مفهوم pH والمحاليل الحمضية والقاعدية والمعايرة.',                    g:'الصف 10-12'},
    {n:'reactants-products-and-leftovers',    e:'⚗️', t:'المتفاعلات والنواتج',         d:'دراسة التفاعلات الكيميائية وحساب المواد المتفاعلة والنواتج.',             g:'الصف 9-11'},
    {n:'states-of-matter',                    e:'💧', t:'حالات المادة',                d:'استكشاف الحالات الثلاث للمادة وتحولاتها بتغير الحرارة والضغط.',          g:'الصف 7-9'},
    {n:'molarity',                            e:'📊', t:'التركيز المولي',              d:'فهم مفهوم المولارية وتحضير المحاليل بتراكيز مختلفة.',                      g:'الصف 11-12'},
    {n:'molecule-polarity',                   e:'🔗', t:'قطبية الجزيئات',              d:'دراسة القطبية في الجزيئات والعزوم ثنائية القطب.',                          g:'الصف 11-12'},
    {n:'balancing-chemical-equations',        e:'⚖️', t:'موازنة المعادلات الكيميائية', d:'تدريب عملي على موازنة المعادلات الكيميائية بتصحيح فوري.',                g:'الصف 9-11'}
  ],
  math: [
    {n:'graphing-lines',           e:'📈', t:'تمثيل الخطوط المستقيمة', d:'رسم وتحليل المعادلات الخطية، فهم الميل والتقاطع.',                                   g:'الصف 8-10'},
    {n:'graphing-quadratics',      e:'📉', t:'تمثيل الدوال التربيعية', d:'استكشاف خصائص القطع المكافئ وتأثير المعاملات على شكله.',                            g:'الصف 10-11'},
    {n:'proportion-playground',    e:'🎨', t:'ملعب التناسب',           d:'فهم مفهوم التناسب والنسبة من خلال أنشطة بصرية ممتعة.',                              g:'الصف 6-8'},
    {n:'trig-tour',                e:'📏', t:'جولة في حساب المثلثات',  d:'استكشاف الدوال المثلثية (sin, cos, tan) والدائرة الوحدوية.',                          g:'الصف 10-12'},
    {n:'area-builder',             e:'🟦', t:'بناء المساحة',           d:'حساب مساحات الأشكال الهندسية المختلفة.',                                            g:'الصف 5-8'},
    {n:'fraction-matcher',         e:'🍕', t:'مطابقة الكسور',          d:'تدريب بصري على الكسور المتكافئة والمقارنة والجمع.',                                  g:'الصف 3-6'},
    {n:'vector-addition',          e:'➡️', t:'جمع المتجهات',          d:'فهم المتجهات (المقدار والاتجاه) وجمعها بطريقة الرأس والذيل.',                       g:'الصف 11-12'}
  ],
  science: [
    {n:'gene-expression-essentials',e:'🧬', t:'تعبير الجينات: أساسيات', d:'استكشاف كيفية تحويل الجينات إلى بروتينات عبر النسخ والترجمة.',                       g:'الصف 11-12'},
    {n:'greenhouse-effect',         e:'🌡️', t:'تأثير الاحتباس الحراري',d:'فهم آلية تأثير غازات الاحتباس الحراري على مناخ الأرض.',                              g:'الصف 9-11'},
    {n:'gas-properties',            e:'💨', t:'خواص الغاز',              d:'دراسة العلاقة بين الضغط والحجم ودرجة الحرارة.',                                       g:'الصف 10-12'},
    {n:'sound',                     e:'🔊', t:'الموجات الصوتية',         d:'استكشاف خصائص الموجات الصوتية: التردد، السعة، طول الموجة.',                         g:'الصف 10-12'}
  ]
};

const PHET_CAT_META = {
  physics: {label:'الفيزياء', icon:'⚛️', color:'#e74c3c', sub:'القوى • الحركة • الكهرباء • الموجات • الضوء'},
  chem:    {label:'الكيمياء', icon:'🧪', color:'#3498db', sub:'الذرة • الجزيئات • المحاليل • التفاعلات'},
  math:    {label:'الرياضيات', icon:'📐', color:'#9b59b6', sub:'الدوال • الهندسة • النسب • المتجهات'},
  science: {label:'العلوم العامة', icon:'🔬', color:'#27ae60', sub:'الجينات • الغلاف الجوي • خواص الغاز'}
};

function phetUrl(name){
  return 'https://phet.colorado.edu/sims/html/'+name+'/latest/'+name+'_ar.html';
}

function buildPhetPanelHTML(){
  const tabs = Object.keys(PHET_SIMS).map((cat,i)=>{
    const m = PHET_CAT_META[cat];
    return `<button class="phet-tab ${i===0?'active':''}" data-cat="${cat}" style="--c:${m.color}"><span class="pt-emoji">${m.icon}</span><span class="pt-label">${m.label}</span><span class="pt-count">${PHET_SIMS[cat].length}</span></button>`;
  }).join('');

  const panels = Object.keys(PHET_SIMS).map((cat,i)=>{
    const m = PHET_CAT_META[cat];
    const cards = PHET_SIMS[cat].map(s=>(
      `<div class="phet-card" data-url="${phetUrl(s.n)}" data-title="${s.e} ${s.t}">`+
        `<div class="pc-emoji">${s.e}</div>`+
        `<div class="pc-title">${s.t}</div>`+
        `<div class="pc-desc">${s.d}</div>`+
        `<div class="pc-foot"><span class="pc-grade">${s.g}</span><span class="pc-go">▶ افتح</span></div>`+
      `</div>`
    )).join('');
    return `<div class="phet-panel ${i===0?'active':''}" data-panel="${cat}">`+
      `<div class="phet-phead" style="--c:${m.color}"><div class="pph-icon">${m.icon}</div><div><h2>محاكيات ${m.label}</h2><div class="pph-sub">${m.sub}</div></div></div>`+
      `<div class="phet-grid">${cards}</div>`+
    `</div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap" rel="stylesheet"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Tajawal',sans-serif;background:linear-gradient(135deg,#0f3460 0%,#1a5f7a 50%,#2a7f9a 100%);color:#fff;min-height:100vh}
.phet-tabs{position:sticky;top:0;z-index:50;background:rgba(15,52,96,.95);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);padding:12px 18px;display:flex;gap:8px;border-bottom:2px solid rgba(255,215,0,.35);overflow-x:auto;flex-wrap:wrap}
.phet-tabs::-webkit-scrollbar{height:5px}.phet-tabs::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:3px}
.phet-tab{border:none;cursor:pointer;padding:9px 16px;border-radius:22px;font-family:'Tajawal',sans-serif;font-size:.9rem;font-weight:700;color:#fff;display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.08);border:2px solid transparent;transition:.2s;white-space:nowrap}
.phet-tab .pt-count{background:rgba(0,0,0,.3);padding:1px 8px;border-radius:11px;font-size:.68rem;font-weight:800}
.phet-tab.active{background:var(--c);border-color:#ffd700;box-shadow:0 4px 14px rgba(0,0,0,.3);transform:scale(1.04)}
.phet-tab:hover:not(.active){background:rgba(255,255,255,.18);transform:translateY(-2px)}
.phet-hero{text-align:center;padding:30px 18px 20px}
.phet-hero h1{font-size:1.8rem;font-weight:900;margin-bottom:8px;background:linear-gradient(135deg,#ffd700,#ffed4e);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.phet-hero p{font-size:.95rem;opacity:.9;max-width:680px;margin:0 auto;line-height:1.6}
.phet-panel{display:none;padding:16px 20px 26px;max-width:1320px;margin:0 auto}
.phet-panel.active{display:block;animation:phFade .3s}
@keyframes phFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.phet-phead{display:flex;align-items:center;gap:12px;margin-bottom:14px;padding:12px 16px;border-radius:12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-right:4px solid var(--c)}
.pph-icon{width:44px;height:44px;border-radius:12px;background:var(--c);display:flex;align-items:center;justify-content:center;font-size:1.4rem;box-shadow:0 4px 12px rgba(0,0,0,.3)}
.phet-phead h2{font-size:1.15rem;font-weight:800;margin-bottom:1px}
.phet-phead .pph-sub{font-size:.78rem;opacity:.85}
.phet-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.phet-card{background:rgba(255,255,255,.96);color:#2c3e50;border-radius:12px;padding:15px;cursor:pointer;transition:.22s;display:flex;flex-direction:column;gap:6px;min-height:160px;border:2px solid transparent;box-shadow:0 3px 12px rgba(0,0,0,.15)}
.phet-card:hover{transform:translateY(-3px);border-color:#ffd700;box-shadow:0 10px 24px rgba(0,0,0,.25)}
.pc-emoji{font-size:1.85rem;line-height:1}
.pc-title{font-size:.95rem;font-weight:800;color:#0f3460;line-height:1.3}
.pc-desc{font-size:.78rem;color:#555;line-height:1.5;flex:1}
.pc-foot{display:flex;justify-content:space-between;align-items:center;margin-top:4px}
.pc-grade{background:rgba(26,95,122,.1);color:#1a5f7a;padding:2px 9px;border-radius:11px;font-size:.68rem;font-weight:700}
.pc-go{background:linear-gradient(135deg,#1a5f7a,#0f3460);color:#fff;padding:4px 11px;border-radius:9px;font-size:.7rem;font-weight:700}
.phet-card:hover .pc-go{background:linear-gradient(135deg,#ffd700,#f39c12);color:#0f3460}
.phet-footer{text-align:center;padding:14px;font-size:.72rem;opacity:.75;border-top:1px solid rgba(255,255,255,.15);margin-top:10px}
.phet-footer a{color:#ffd700;text-decoration:none;font-weight:700}
@media(max-width:768px){.phet-hero h1{font-size:1.3rem}.phet-hero p{font-size:.85rem}.phet-tab{padding:7px 12px;font-size:.78rem}.phet-grid{grid-template-columns:1fr}.phet-panel{padding:12px}}
</style></head><body>
<div class="phet-hero"><h1>🌟 محاكيات PhET التفاعلية</h1><p>منصة تعليمية تفاعلية لمحاكيات PhET المصممة لمناهج مملكة البحرين</p></div>
<div class="phet-tabs">${tabs}</div>
${panels}
<div class="phet-footer">المحاكيات من <a href="https://phet.colorado.edu/ar_SA/" target="_blank">PhET Interactive Simulations</a> • ترجمة: جامعة الملك سعود</div>
<script>
(function(){
  document.querySelectorAll('.phet-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      const cat=tab.dataset.cat;
      document.querySelectorAll('.phet-tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.phet-panel').forEach(p=>p.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector('.phet-panel[data-panel="'+cat+'"]').classList.add('active');
    });
  });
  document.querySelectorAll('.phet-card').forEach(card=>{
    card.addEventListener('click',()=>{
      const url=card.dataset.url, title=card.dataset.title;
      try{ window.parent.postMessage({type:'phet-open',url:url,title:title},'*'); }catch(e){}
    });
  });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ try{window.parent.postMessage({type:'phet-close'},'*');}catch(_){} } });

})();
<\/script>
</body></html>`;
}

let phetPanelInited = false;
function openPhetPanel(){
  const overlay = document.getElementById('phetOverlay');
  const frame = document.getElementById('phetFrame');
  if(!phetPanelInited){
    const html = buildPhetPanelHTML();
    // ترميز المحتوى كـ data: URL — يعمل بدون ملفات خارجية
    frame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    phetPanelInited = true;
  } else if(!frame.src){
    frame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(buildPhetPanelHTML());
  }
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  // إظهار اللودر وإخفاؤه عند اكتمال التحميل
  const loader = document.getElementById('phetLoader');
  loader.classList.remove('hidden');
  frame.onload = ()=> setTimeout(()=> loader.classList.add('hidden'), 250);
}

function closePhetPanel(){
  document.getElementById('phetOverlay').classList.remove('active');
  document.body.style.overflow = '';
  const frame = document.getElementById('phetFrame');
  // إفراغ الـ iframe لإيقاف أي محاكية قيد التشغيل
  if(frame) frame.src = 'about:blank';
  if(document.fullscreenElement) document.exitFullscreen();
}

function refreshPhet(){
  const frame = document.getElementById('phetFrame');
  // إعادة بناء اللوحة بالكامل (أضمن من reload لأن src=data:)
  frame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(buildPhetPanelHTML());
  document.getElementById('phetLoader').classList.remove('hidden');
  frame.onload = ()=> setTimeout(()=> document.getElementById('phetLoader').classList.add('hidden'), 250);
  if(typeof toast === 'function') toast('info','🔄 تم تحديث لوحة المحاكيات');
}

function togglePhetFs(){
  const modal = document.querySelector('.phet-modal');
  if(!document.fullscreenElement) modal.requestFullscreen().catch(()=>{});
  else document.exitFullscreen();
}

/* ============================================================
   capturePhetToBoard — أرسلي محاكية PhET الحالية للسبورة ثم ارجعي للسبورة
   - تنشئ بطاقة PhET مرئية على السبورة (قابلة للسحب والحذف)
   - تغلق لوحة PhET تلقائياً بعد الإضافة (= ترجعك للسبورة)
   - تعمل حتى لو html2canvas غير محمّل (fallback إلى رسم canvas)
   ============================================================ */
let _phetCurrentSim = null; // يحتفظ بآخر محاكية اختارها المستخدم
function capturePhetToBoard(){
  // 1) تحديد عنوان المحاكية الحالية
  let simTitle = 'محاكيات PhET التفاعلية';
  let simUrl = '';
  let simEmoji = '🧪';
  if(_phetCurrentSim && _phetCurrentSim.title){
    simTitle = _phetCurrentSim.title;
    simUrl = _phetCurrentSim.url || '';
    // استخرجي الإيموجي من العنوان إن وُجد
    const m = simTitle.match(/^(\S+)/);
    if(m) simEmoji = m[1];
  }

  // 2) أضيفي بطاقة على السبورة
  const wrap = document.getElementById('canvasWrap');
  if(!wrap || typeof ctx === 'undefined'){
    if(typeof toast === 'function') toast('error','تعذّر الوصول إلى السبورة');
    return;
  }
  const wr = wrap.getBoundingClientRect();
  const cardW = 420, cardH = 240;
  // تموضع عشوائي خفيف لتجنب التكدس
  const offset = (Math.random() * 60) - 30;
  const x = Math.max(20, (wr.width/2 - cardW/2) + offset);
  const y = Math.max(20, (wr.height/2 - cardH/2) + offset);

  const note = {
    id: 'phet-'+Date.now(),
    type: 'phet-info',
    x, y, w: cardW, h: cardH,
    title: simTitle,
    url: simUrl,
    emoji: simEmoji
  };
  if(typeof State !== 'undefined'){
    State.stickies = State.stickies || [];
    State.stickies.push(note);
  }
  if(typeof drawPhetCapture === 'function') drawPhetCapture(note);
  if(typeof saveCanvas === 'function') saveCanvas();
  if(typeof toast === 'function') toast('success','🧪 تم إرسال المحاكية للسبورة — ارجعتِ للسبورة');

  // 3) أغلق لوحة PhET لإرجاع المعلمة للسبورة
  closePhetPanel();
}

/* drawPhetCapture — ارسم بطاقة PhET جميلة على canvas السبورة */
function drawPhetCapture(note){
  if(typeof ctx === 'undefined') return;
  const x = note.x, y = note.y, w = note.w, h = note.h;
  ctx.save();
  // ظل ناعم
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;
  // الخلفية
  const bg = ctx.createLinearGradient(x, y, x, y+h);
  bg.addColorStop(0, '#0f3460');
  bg.addColorStop(1, '#1a5f7a');
  ctx.fillStyle = bg;
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  // الإطار الذهبي
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 3;
  ctx.roundRect(x, y, w, h, 14);
  ctx.stroke();
  // الشريط العلوي
  const head = ctx.createLinearGradient(x, y, x+w, y);
  head.addColorStop(0, '#ffd700');
  head.addColorStop(1, '#f39c12');
  ctx.fillStyle = head;
  // تقريب الزوايا العلوية فقط — نرسم مستطيل علوي ثم نقنع
  ctx.beginPath();
  ctx.moveTo(x+14, y);
  ctx.lineTo(x+w-14, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+14);
  ctx.lineTo(x+w, y+44);
  ctx.lineTo(x, y+44);
  ctx.lineTo(x, y+14);
  ctx.quadraticCurveTo(x, y, x+14, y);
  ctx.closePath();
  ctx.fill();
  // أيقونة القارورة + العنوان
  ctx.fillStyle = '#0f3460';
  ctx.font = 'bold 17px Tajawal, Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🧪 محاكية PhET تفاعلية', x+w/2, y+22);
  // اسم المحاكية
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 20px Tajawal, Arial';
  ctx.fillText((note.emoji || '⚗️') + ' ' + (note.title || 'محاكية PhET'), x+w/2, y+80);
  // خط فاصل زخرفي
  ctx.strokeStyle = 'rgba(255,215,0,.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x+30, y+108);
  ctx.lineTo(x+w-30, y+108);
  ctx.stroke();
  // الوصف
  ctx.fillStyle = '#fff';
  ctx.font = '14px Tajawal, Arial';
  ctx.fillText('اسحبي البطاقة وكبّريها على السبورة', x+w/2, y+135);
  ctx.fillText('اضغطي مطوّلاً للحذف', x+w/2, y+158);
  // الفوتر
  ctx.fillStyle = 'rgba(255,215,0,.85)';
  ctx.font = 'bold 12px Tajawal, Arial';
  ctx.fillText('— مناهج البحرين — PhET —', x+w/2, y+195);
  // التاريخ
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.font = '11px Tajawal, Arial';
  ctx.fillText(new Date().toLocaleDateString('ar-BH'), x+w/2, y+218);
  ctx.restore();
}

// استقبال الرسائل من iframe
window.addEventListener('message',(e)=>{
  if(!e.data || !e.data.type) return;
  if(e.data.type === 'phet-open'){
    // احفظي بيانات المحاكية المختارة
    _phetCurrentSim = { url: e.data.url, title: e.data.title || 'محاكية PhET' };
    // افتحي المحاكية في تبويب جديد (أضمن من الـ iframe داخل iframe)
    const w = window.open(e.data.url, '_blank', 'noopener,noreferrer');
    if(!w){
      // لو المتصفح منع الـ popup، افتحي في نفس الـ iframe
      const frame = document.getElementById('phetFrame');
      frame.src = e.data.url;
      const loader = document.getElementById('phetLoader');
      loader.classList.remove('hidden');
      frame.onload = ()=> setTimeout(()=> loader.classList.add('hidden'), 300);
      if(typeof toast === 'function') toast('info','💡 جاري فتح المحاكية...');
    } else {
      if(typeof toast === 'function') toast('success','🧪 تم فتح: ' + (e.data.title||'محاكية PhET') + ' — اضغطي "للسبورة" للعودة');
      // أوقفي الـ iframe الداخلي لتخفيف الحمل (المحاكية الآن في تبويب جديد)
      // لا نغلق اللوحة تلقائياً — المعلمة قد تحتاج تجرّب محاكيات أخرى قبل الإغلاق
    }
  } else if(e.data.type === 'phet-close'){
    closePhetPanel();
  }
});

// ربط أزرار التحكم — نأخّر الربط حتى يجهز DOM (العناصر التالية للوسم)
function bindPhetControls(){
  const $ = id => document.getElementById(id);
  $('phetClose')?.addEventListener('click', closePhetPanel);
  $('phetFs')?.addEventListener('click', togglePhetFs);
  $('phetRefresh')?.addEventListener('click', refreshPhet);
  $('phetCaptureBtn')?.addEventListener('click', capturePhetToBoard);
  $('phetOverlay')?.addEventListener('click',(e)=>{
    if(e.target.id === 'phetOverlay') closePhetPanel();
  });
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', bindPhetControls, {once:true});
} else {
  bindPhetControls();
}

// اختصارات لوحة المفاتيح
document.addEventListener('keydown',(e)=>{
  // Alt+P لفتح/إغلاق
  if(e.altKey && (e.key==='p' || e.key==='P' || e.key==='ح')){
    e.preventDefault();
    const ov = document.getElementById('phetOverlay');
    if(ov && ov.classList.contains('active')) closePhetPanel();
    else openPhetPanel();
  }
  // Esc للإغلاق
  if(e.key === 'Escape'){
    const ov = document.getElementById('phetOverlay');
    if(ov && ov.classList.contains('active')) closePhetPanel();
  }
});

console.log('%c🧪 PhET Panel: مدمج — 27 محاكية عربية','color:#8e44ad;font-size:13px;font-weight:bold');



/* ============================================================
   ⭐⭐⭐ GAMES HUB - LOGIC ⭐⭐⭐
   ============================================================ */
(function(){
  'use strict';

  const GAMES_KEY = 'board_games_state_v1';

  // ---- State ----
  let state = {
    points: {},      // studentName -> number
    medals: {},      // studentName -> {gold, silver, bronze}
    teams: [],       // [{name, score, members:[]}]
    starHistory: [], // [{name, stars, time}]
    lastWinner: null,
    roundCount: 0,
    openedChests: new Set()
  };

  // ---- Persistence ----
  function loadState(){
    try{
      const raw = localStorage.getItem(GAMES_KEY);
      if(raw){
        const parsed = JSON.parse(raw);
        state = Object.assign(state, parsed);
        if(!(state.openedChests instanceof Set)){
          state.openedChests = new Set(parsed.openedChests || []);
        }
      }
    }catch(e){ console.warn('Games state load failed', e); }
  }
  function saveState(){
    try{
      const s = Object.assign({}, state);
      s.openedChests = Array.from(state.openedChests || []);
      localStorage.setItem(GAMES_KEY, JSON.stringify(s));
    }catch(e){ console.warn('Games state save failed', e); }
  }

  // ---- Sound (Web Audio API) ----
  let audioCtx = null;
  function getAudioCtx(){
    if(!audioCtx){
      try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){}
    }
    return audioCtx;
  }
  function playTone(freq, dur=0.15, type='sine', vol=0.2){
    const ctx = getAudioCtx();
    if(!ctx) return;
    try{
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    }catch(e){}
  }
  function playWin(){ [523,659,784,1047].forEach((f,i)=>setTimeout(()=>playTone(f, 0.18, 'triangle', 0.18), i*100)); }
  function playClick(){ playTone(800, 0.08, 'square', 0.1); }
  function playSuccess(){ [659,784,988].forEach((f,i)=>setTimeout(()=>playTone(f, 0.14, 'sine', 0.18), i*80)); }
  function playFail(){ playTone(200, 0.3, 'sawtooth', 0.15); }
  function playStar(){ playTone(1200, 0.1, 'sine', 0.15); setTimeout(()=>playTone(1500, 0.1, 'sine', 0.15), 80); }
  function playSpin(){ [400,500,600,700,800].forEach((f,i)=>setTimeout(()=>playTone(f, 0.06, 'square', 0.1), i*40)); }

  // ---- Students ----
  function getStudents(){
    if(window.Data && Array.isArray(window.Data.students)) return window.Data.students;
    return [];
  }
  function studentName(s){ return s && s.name ? s.name : (typeof s === 'string' ? s : ''); }
  function ensurePoints(name){
    if(!state.points[name]) state.points[name] = 0;
    if(!state.medals[name]) state.medals[name] = {gold:0, silver:0, bronze:0};
  }

  // ---- Toast ----
  let toastTimer = null;
  function gameToast(icon, text, type){
    const t = document.getElementById('gameToast');
    const i = document.getElementById('gameToastText');
    if(!t || !i) return;
    t.className = 'game-toast' + (type ? ' ' + type : '');
    t.querySelector('.gt-icon').textContent = icon;
    i.textContent = text;
    clearTimeout(toastTimer);
    requestAnimationFrame(()=> t.classList.add('show'));
    toastTimer = setTimeout(()=> t.classList.remove('show'), 2400);
  }

  // ---- Confetti ----
  function gameConfetti(count=40, x=null, y=null){
    const colors = ['#ff6b9d','#c44569','#feca57','#48dbfb','#1dd1a1','#5f27cd','#ff9ff3','#ff6348','#786fa6','#feca57'];
    const cx = x !== null ? x : window.innerWidth / 2;
    const cy = y !== null ? y : window.innerHeight / 2;
    for(let i=0;i<count;i++){
      const el = document.createElement('div');
      el.className = 'game-confetti';
      el.style.background = colors[Math.floor(Math.random()*colors.length)];
      el.style.left = (cx - 5) + 'px';
      el.style.top = (cy - 5) + 'px';
      const angle = (Math.PI*2) * (i/count) + Math.random()*0.5;
      const dist = 100 + Math.random()*200;
      const tx = Math.cos(angle)*dist;
      const ty = Math.sin(angle)*dist + 300;
      el.style.transition = 'transform 1.2s cubic-bezier(.2,.6,.3,1), opacity 1.2s';
      document.body.appendChild(el);
      requestAnimationFrame(()=>{
        el.style.transform = `translate(${tx}px, ${ty}px) rotate(${Math.random()*720}deg)`;
        el.style.opacity = '0';
      });
      setTimeout(()=> el.remove(), 1400);
    }
  }

  // ---- Tabs ----
  function switchTab(name){
    document.querySelectorAll('.games-tab').forEach(t=>{
      t.classList.toggle('active', t.dataset.tab === name);
    });
    document.querySelectorAll('.game-panel').forEach(p=>{
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
    // refresh content
    if(name==='heroes') renderHeroes();
    if(name==='speed') renderSpeedList();
    if(name==='star') renderStarPick();
    if(name==='team') renderTeamArena();
    if(name==='treasure') renderTreasure();
    if(name==='baamboozle'){ bamRenderBoard(); bamUpdateStats(); }
    if(name==='battleship'){ bsInit(); bsFilterQuestions(); }
    if(name==='ladders'){ ladInit(); }
    if(name==='hub') updateStats();
    playClick();
  }

  // ---- Open / Close ----
  function openGames(){
    document.getElementById('gamesOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    updateStats();
    renderHub();
    renderHeroes();
    renderSpeedList();
    renderTreasure();
    renderStarPick();
    renderTeamArena();
    // ⭐ هيّئ بامبوزل عند فتح المركز
    try{
      if(bam.cells.length === 0) bamRenderBoard();
      bamUpdateStats();
    }catch(e){}
    // ⭐ حدّث مكتبة الأسئلة عند فتح المركز
    try{ renderQBank(); }catch(e){}
    // ⭐ حدّث شارة البث المباشر عند فتح المركز
    try{ if(typeof updateGamesLiveBadge === 'function') updateGamesLiveBadge(); }catch(e){}
    playClick();
  }
  function closeGames(){
    document.getElementById('gamesOverlay').classList.remove('active');
    document.body.style.overflow = '';
  }

  // ---- Stats Footer ----
  function updateStats(){
    document.getElementById('gStatStudents').textContent = getStudents().length;
    document.getElementById('gStatRounds').textContent = state.roundCount;
    const total = Object.values(state.points).reduce((a,b)=>a+(+b||0), 0);
    document.getElementById('gStatPoints').textContent = total;
  }

  function renderHub(){
    updateStats();
  }

  // ===== WHEEL OF FORTUNE =====
  let wheelSpinning = false;
  function renderWheelLabels(){
    const wheel = document.getElementById('gameWheel');
    if(!wheel) return;
    const students = getStudents();
    if(students.length === 0){
      wheel.style.background = 'conic-gradient(from 0deg, #dfe6e9 0deg 360deg)';
      return;
    }
    const n = students.length;
    const colors = ['#ff6b9d','#feca57','#48dbfb','#1dd1a1','#5f27cd','#ff9ff3','#ff6348','#786fa6','#10ac84','#ee5a6f','#ff9f43','#0abde3','#a29bfe','#fd79a8','#ffeaa7','#00b894','#e17055','#74b9ff','#fab1a0','#81ecec'];
    let grad = 'conic-gradient(from 0deg';
    const segAngle = 360/n;
    for(let i=0;i<n;i++){
      grad += `, ${colors[i%colors.length]} ${i*segAngle}deg ${(i+1)*segAngle}deg`;
    }
    grad += ')';
    wheel.style.background = grad;
  }
  function spinGameWheel(){
    if(wheelSpinning) return;
    const students = getStudents();
    if(students.length === 0){
      gameToast('⚠️', 'لا توجد طالبات مسجلات! أضيفي طالبات أولاً', 'gold');
      return;
    }
    wheelSpinning = true;
    playSpin();
    renderWheelLabels();
    const n = students.length;
    const winnerIdx = Math.floor(Math.random() * n);
    const winner = students[winnerIdx];
    const segAngle = 360 / n;
    const targetAngle = 360*6 + (360 - (winnerIdx * segAngle + segAngle/2));
    const wheel = document.getElementById('gameWheel');
    wheel.style.transition = 'transform 4s cubic-bezier(.17,.67,.12,.99)';
    wheel.style.transform = `rotate(${targetAngle}deg)`;
    const resultEl = document.getElementById('gameWheelResult');
    resultEl.innerHTML = '<span style="font-size:1.5rem">🎰</span> تدور العجلة...';
    setTimeout(()=>{
      resultEl.innerHTML = `🎉 <span style="color:#c44569">${escapeHtml(winner.name)}</span> هي من ستجيب! 🌟`;
      state.lastWinner = winner.name;
      state.roundCount++;
      saveState();
      updateStats();
      playWin();
      gameConfetti(35);
      gameToast('🎯', `${winner.name} - حظاً موفقاً!`, 'success');
      wheelSpinning = false;
    }, 4100);
  }
  function rewardLastWinner(){
    if(!state.lastWinner){
      gameToast('⚠️', 'ديري العجلة أولاً لاختيار طالبة!', 'gold');
      return;
    }
    ensurePoints(state.lastWinner);
    state.points[state.lastWinner] += 10;
    state.roundCount++;
    saveState();
    playSuccess();
    gameToast('🏆', `+10 نقاط لـ ${state.lastWinner}!`, 'success');
    gameConfetti(25);
    renderHeroes();
    updateStats();
  }
  function resetGameWheel(){
    const wheel = document.getElementById('gameWheel');
    wheel.style.transition = 'none';
    wheel.style.transform = 'rotate(0deg)';
    document.getElementById('gameWheelResult').innerHTML = '🎯 اضغطي لتدوير العجلة!';
    state.lastWinner = null;
    playClick();
  }

  // ===== SPEED CHALLENGE =====
  let speedInterval = null;
  let speedTimeLeft = 30;
  let speedRunning = false;
  let speedWinner = null;
  function renderSpeedList(){
    const list = document.getElementById('gameSpeedList');
    if(!list) return;
    const students = getStudents();
    if(students.length === 0){
      list.innerHTML = '<div class="game-empty-state" style="padding:20px"><span class="ges-emoji">👩‍🎓</span><p>أضيفي طالبات أولاً من قائمة الطالبات</p></div>';
      return;
    }
    list.innerHTML = students.map(s=>{
      const name = escapeHtml(s.name);
      const pts = state.points[s.name] || 0;
      return `<button class="speed-student-btn" data-name="${name}">👩‍🎓 ${name}<span class="speed-points">${pts} نقطة</span></button>`;
    }).join('');
    list.querySelectorAll('.speed-student-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(!speedRunning) return;
        if(speedWinner) return;
        const name = btn.dataset.name;
        speedWinner = name;
        ensurePoints(name);
        const bonus = speedTimeLeft > 20 ? 5 : (speedTimeLeft > 10 ? 4 : 3);
        state.points[name] += bonus;
        state.roundCount++;
        saveState();
        playWin();
        btn.classList.add('winner');
        gameToast('⚡', `${name} هي الأسرع! +${bonus} نقاط`, 'success');
        gameConfetti(30);
        renderHeroes();
        updateStats();
        stopSpeedTimer();
      });
    });
  }
  function startSpeedTimer(){
    if(speedRunning) return;
    speedTimeLeft = 30;
    speedRunning = true;
    speedWinner = null;
    const timerEl = document.getElementById('gameSpeedTimer');
    timerEl.textContent = speedTimeLeft;
    timerEl.className = 'speed-timer';
    playClick();
    clearInterval(speedInterval);
    speedInterval = setInterval(()=>{
      speedTimeLeft--;
      timerEl.textContent = speedTimeLeft;
      if(speedTimeLeft <= 10){
        timerEl.className = 'speed-timer danger';
      } else if(speedTimeLeft <= 20){
        timerEl.className = 'speed-timer warning';
      }
      if(speedTimeLeft <= 5 && speedTimeLeft > 0) playTone(800, 0.05, 'square', 0.1);
      if(speedTimeLeft <= 0){
        stopSpeedTimer();
        if(!speedWinner) gameToast('⏱️', 'انتهى الوقت! لا أحد ضغط أولاً 😅', 'gold');
        playFail();
      }
    }, 1000);
    renderSpeedList();
    // ⭐ بثّ حدث "بدء تحدي السرعة" للطالبات عن بُعد
    const qText = (document.getElementById('gameSpeedQuestion')?.value || '').trim();
    const students = getStudents().map(s => s.name);
    LiveBus.publishRemote('games:speed:start', {
      duration: 30,
      question: qText,
      students: students,
      ts: Date.now()
    });
    // ⭐ تتبّع استخدام السؤال من المكتبة (إن كان مختاراً من القائمة)
    try{
      const sel = document.getElementById('gameSpeedQPick');
      if(sel && sel.value) QBank.use(sel.value);
    }catch(e){}
  }
  function stopSpeedTimer(){
    const wasRunning = speedRunning;
    clearInterval(speedInterval);
    speedInterval = null;
    speedRunning = false;
    // ⭐ بثّ "انتهاء/إيقاف التحدي" للطالبات — يخفي زر الضغط عندهن
    if(wasRunning){
      LiveBus.publishRemote('games:speed:end', { winner: speedWinner, ts: Date.now() });
    }
  }
  function resetSpeedTimer(){
    stopSpeedTimer();
    speedTimeLeft = 30;
    speedWinner = null;
    const timerEl = document.getElementById('gameSpeedTimer');
    timerEl.textContent = '30';
    timerEl.className = 'speed-timer';
    document.getElementById('gameSpeedList').querySelectorAll('.speed-student-btn').forEach(b=>b.classList.remove('winner'));
    playClick();
  }

  // ⭐ معالج ضغطة الطالبة عن بُعد على تحدي السرعة
  // تستقبل رسالة LiveBus من نوع games:speed:tap
  // تحدد الفائز (إن لم يكن أحد) وتضيف النقاط مثل الضغط المحلي تماماً
  LiveBus.on('games:speed:tap', (data)=>{
    if(!data) return;
    const name = data.name;
    if(!name) return;
    if(!speedRunning) return;          // التحدي انتهى أو لم يبدأ
    if(speedWinner) return;            // أحد ضغط قبلها
    if(speedTimeLeft <= 0) return;     // الوقت انتهى

    speedWinner = name;
    ensurePoints(name);
    const bonus = speedTimeLeft > 20 ? 5 : (speedTimeLeft > 10 ? 4 : 3);
    state.points[name] += bonus;
    state.roundCount++;
    saveState();
    playWin();
    gameConfetti(30);
    gameToast('⚡', `${name} هي الأسرع! +${bonus} نقاط (من الجوال)`, 'success');

    // إبراز زر الطالبة الفائزة في قائمة المعلم
    const list = document.getElementById('gameSpeedList');
    if(list){
      list.querySelectorAll('.speed-student-btn').forEach(b => {
        if(b.dataset.name === name) b.classList.add('winner');
        else b.classList.remove('winner');
      });
    }
    renderHeroes();
    updateStats();
    stopSpeedTimer();
    // بثّ إعلان الفائزة للطالبات (تظهر رسالة احتفال)
    LiveBus.publishRemote('games:speed:winner', { name, bonus, ts: Date.now() });
  });

  // ===== HEROES BOARD =====
  function renderHeroes(){
    const list = document.getElementById('gameHeroesList');
    if(!list) return;
    const students = getStudents();
    if(students.length === 0){
      list.innerHTML = '<div class="heroes-empty"><span class="he-emoji">🏆</span><p>لا توجد طالبات بعد. أضيفي طالبات من قائمة الطالبات.</p></div>';
      return;
    }
    // Combine all known names (students + custom points)
    const allNames = new Set(students.map(s=>s.name));
    Object.keys(state.points).forEach(n => allNames.add(n));
    const rows = Array.from(allNames).map(name=>{
      ensurePoints(name);
      const pts = state.points[name] || 0;
      const medals = state.medals[name] || {gold:0, silver:0, bronze:0};
      return {name, pts, medals};
    }).sort((a,b)=> b.pts - a.pts);

    if(rows.length === 0 || rows[0].pts === 0){
      list.innerHTML = '<div class="heroes-empty"><span class="he-emoji">🎯</span><p>لم تبدأ المنافسة بعد! شغلي لعبة "عجلة الحظ" أو "نجمة الحل" لبدء التسجيل.</p></div>';
      return;
    }

    const initial = (rows[0].name || '؟').charAt(0);
    list.innerHTML = rows.map((r, idx)=>{
      const rank = idx + 1;
      let rankClass = 'normal';
      if(rank === 1) rankClass = 'gold';
      else if(rank === 2) rankClass = 'silver';
      else if(rank === 3) rankClass = 'bronze';
      const initialHere = (r.name || '؟').charAt(0);
      const placeClass = rank === 1 ? 'first-place' : '';
      const medalsStr = [
        r.medals.gold ? `<span class="hero-medal">🥇${r.medals.gold}</span>` : '',
        r.medals.silver ? `<span class="hero-medal">🥈${r.medals.silver}</span>` : '',
        r.medals.bronze ? `<span class="hero-medal">🥉${r.medals.bronze}</span>` : ''
      ].filter(Boolean).join('');
      return `<div class="hero-row ${placeClass}" data-name="${escapeHtml(r.name)}">
        <div class="hero-rank ${rankClass}">${rank}</div>
        <div class="hero-avatar">${escapeHtml(initialHere)}</div>
        <div class="hero-info">
          <div class="hero-name">${escapeHtml(r.name)}</div>
          <div class="hero-score"><i class="fas fa-star" style="color:#feca57"></i> ${r.pts} نقطة</div>
        </div>
        <div class="hero-medals">${medalsStr}</div>
        <button class="gbtn gbtn-primary" data-action="plus5" data-name="${escapeHtml(r.name)}" style="padding:6px 10px;font-size:.7rem">+5</button>
        <button class="gbtn gbtn-ghost" data-action="reset" data-name="${escapeHtml(r.name)}" style="padding:6px 10px;font-size:.7rem;border-color:#c44569;color:#c44569"><i class="fas fa-undo"></i></button>
      </div>`;
    }).join('');

    // Bind row actions
    list.querySelectorAll('[data-action]').forEach(btn=>{
      btn.addEventListener('click', e=>{
        e.stopPropagation();
        const name = btn.dataset.name;
        const action = btn.dataset.action;
        if(action === 'plus5'){
          ensurePoints(name);
          state.points[name] += 5;
          // Track medal if reaches milestone
          const newPts = state.points[name];
          if(newPts >= 50 && newPts < 55) state.medals[name].gold++;
          else if(newPts >= 30 && newPts < 35) state.medals[name].silver++;
          else if(newPts >= 15 && newPts < 20) state.medals[name].bronze++;
          saveState();
          playSuccess();
          gameToast('⭐', `+5 نقاط لـ ${name}!`, 'success');
          renderHeroes();
          updateStats();
        } else if(action === 'reset'){
          if(confirm('هل تريدين إعادة نقاط ' + name + ' إلى صفر؟')){
            state.points[name] = 0;
            state.medals[name] = {gold:0, silver:0, bronze:0};
            saveState();
            playClick();
            renderHeroes();
            updateStats();
          }
        }
      });
    });
  }

  // ===== TREASURE HUNT =====
  const TREASURE_REWARDS = [
    {emoji:'⭐', text:'نجمة إضافية! +5 نقاط', points:5, type:'points'},
    {emoji:'🎁', text:'جائزة مفاجأة! اختاري زميلتكِ لتجيب بدلاً منكِ', points:0, type:'pass'},
    {emoji:'🏆', text:'بطلة اليوم! +15 نقطة', points:15, type:'points'},
    {emoji:'💡', text:'مساعدة! استخدمي دليلاً للإجابة', points:0, type:'help'},
    {emoji:'🌟', text:'نجمة ذهبية! +10 نقاط', points:10, type:'points'},
    {emoji:'🎯', text:'تحدي سريع! أجيبي في 10 ثوانٍ لتحظي بـ +20', points:20, type:'challenge'},
    {emoji:'👑', text:'ملكة الفصل! +25 نقطة', points:25, type:'points'},
    {emoji:'🎈', text:'احتفال! انقري 3 زميلات ليحصلن على نجوم', points:0, type:'share'},
    {emoji:'💎', text:'كنز ثمين! +30 نقطة', points:30, type:'points'},
    {emoji:'🌈', text:'دعوة للحظ! اختاري لونكِ المفضل', points:0, type:'lucky'},
    {emoji:'📚', text:'معلومة ممتعة! اقرئيها بصوت عالٍ', points:0, type:'fact'},
    {emoji:'✨', text:'دعاء! ادعي لمن حولكِ +3 نقاط', points:3, type:'points'}
  ];
  const TREASURE_FACTS = [
    'هل تعلمين أن النحل يرقص ليخبر صديقاتهِ بمكان الزهور؟ 🐝',
    'الضوء من الشمس يستغرق 8 دقائق ليصل إلينا ☀️',
    'قلب الإنسان ينبض 100,000 مرة في اليوم ❤️',
    'أطول نهر في العالم هو نهر النيل في مصر 🇪🇬',
    'الفراشات تتذوق بأقدامها 🦋',
    'عدد عظام الطفل حديث الولادة 300 عظمة، وتقل إلى 206 عند البلوغ 👶'
  ];
  const TREASURE_COLORS = [
    {name:'الأحمر', emoji:'🔴'},
    {name:'الأزرق', emoji:'🔵'},
    {name:'الأخضر', emoji:'🟢'},
    {name:'الوردي', emoji:'🌸'},
    {name:'البنفسجي', emoji:'🟣'},
    {name:'الذهبي', emoji:'🟡'}
  ];
  function renderTreasure(){
    const grid = document.getElementById('gameTreasureGrid');
    if(!grid) return;
    if(!(state.openedChests instanceof Set)) state.openedChests = new Set();
    grid.innerHTML = '';
    for(let i=0;i<12;i++){
      const opened = state.openedChests.has(i);
      const chest = document.createElement('div');
      chest.className = 'treasure-chest' + (opened ? ' opened' : '');
      chest.innerHTML = opened ? '✨' : '🎁';
      chest.dataset.idx = i;
      if(!opened){
        chest.addEventListener('click', ()=> openChest(i));
      }
      grid.appendChild(chest);
    }
    if(state.openedChests.size >= 12){
      document.getElementById('gameTreasureDisplay').innerHTML = '🏆 تم فتح كل الصناديق! اضغطي "إعادة ملء" لبدء مغامرة جديدة';
    } else {
      document.getElementById('gameTreasureDisplay').innerHTML = '🎁 اختاري صندوقاً لتبدأ المغامرة!';
    }
  }
  function openChest(idx){
    if(!state.openedChests) state.openedChests = new Set();
    if(state.openedChests.has(idx)) return;
    const reward = TREASURE_REWARDS[idx % TREASURE_REWARDS.length];
    state.openedChests.add(idx);
    saveState();
    playStar();
    gameConfetti(20);

    const grid = document.getElementById('gameTreasureGrid');
    const chest = grid.querySelector(`[data-idx="${idx}"]`);
    if(chest){
      chest.classList.add('opened');
      chest.innerHTML = reward.emoji;
    }

    const display = document.getElementById('gameTreasureDisplay');
    let msg = `<span style="font-size:2rem;margin-left:10px">${reward.emoji}</span> <span>${reward.text}</span>`;
    if(reward.type === 'fact'){
      const fact = TREASURE_FACTS[Math.floor(Math.random()*TREASURE_FACTS.length)];
      msg = `<span style="font-size:2rem;margin-left:10px">📚</span> <span>${fact}</span>`;
    } else if(reward.type === 'lucky'){
      const color = TREASURE_COLORS[Math.floor(Math.random()*TREASURE_COLORS.length)];
      msg = `<span style="font-size:2rem;margin-left:10px">${color.emoji}</span> <span>لونكِ المحظوظ اليوم هو ${color.name}! +5 نقاط</span>`;
      awardPointsToAll(5);
    } else if(reward.type === 'points' && reward.points > 0){
      // Award to the last student, or the first student, or 5 to all
      const students = getStudents();
      if(state.lastWinner){
        ensurePoints(state.lastWinner);
        state.points[state.lastWinner] += reward.points;
        gameToast('💎', `+${reward.points} نقطة لـ ${state.lastWinner}!`, 'success');
      } else if(students.length > 0){
        const target = students[Math.floor(Math.random()*students.length)].name;
        ensurePoints(target);
        state.points[target] += reward.points;
        gameToast('💎', `+${reward.points} نقطة لـ ${target}!`, 'success');
      }
      saveState();
    } else if(reward.type === 'share'){
      gameToast('🎈', 'اختاري 3 زميلات لمنحهن نجوم!', 'gold');
    } else if(reward.type === 'challenge'){
      gameToast('🎯', 'تحدي السرعة! من ستجيب أولاً؟', 'gold');
    } else if(reward.type === 'help'){
      gameToast('💡', 'استخدمي دليلاً للإجابة!', 'gold');
    } else if(reward.type === 'pass'){
      gameToast('🎁', 'جواز مرور! اختاري زميلتكِ', 'gold');
    }
    display.innerHTML = msg;

    if(state.openedChests.size >= 12){
      setTimeout(()=>{
        gameToast('🏆', 'أكملتِ كل الصناديق! أحسنتِ!', 'success');
        playWin();
        gameConfetti(50);
      }, 800);
    }
  }
  function resetTreasure(){
    if(state.openedChests) state.openedChests.clear();
    saveState();
    renderTreasure();
    playClick();
  }
  function awardPointsToAll(points){
    const students = getStudents();
    students.forEach(s=>{
      ensurePoints(s.name);
      state.points[s.name] += points;
    });
    saveState();
    renderHeroes();
    updateStats();
  }
  function treasureAwardAll(){
    awardPointsToAll(15);
    playSuccess();
    gameToast('🏆', 'تم منح +15 نقطة لكل الطالبات!', 'success');
    gameConfetti(40);
  }

  // ===== TEAM BATTLE =====
  const TEAM_COLORS = [
    {name:'الفريق الوردي', c1:'#ff6b9d', c2:'#c44569', icon:'💗'},
    {name:'الفريق السماوي', c1:'#48dbfb', c2:'#0abde3', icon:'💙'},
    {name:'الفريق الأخضر', c1:'#1dd1a1', c2:'#10ac84', icon:'💚'},
    {name:'الفريق الذهبي', c1:'#feca57', c2:'#ff9f43', icon:'💛'},
    {name:'الفريق البنفسجي', c1:'#a29bfe', c2:'#6c5ce7', icon:'💜'},
    {name:'الفريق البرتقالي', c1:'#ff9f43', c2:'#ee5a6f', icon:'🧡'}
  ];
  function renderTeamArena(){
    const arena = document.getElementById('gameTeamArena');
    if(!arena) return;
    if(!state.teams || state.teams.length === 0){
      arena.innerHTML = '<div class="game-empty-state" style="grid-column:1/-1"><span class="ges-emoji">👯</span><p>اضغطي "توزيع تلقائي" لتقسيم الطالبات على فرق!</p></div>';
      return;
    }
    const maxScore = Math.max(...state.teams.map(t=>t.score), 0);
    arena.innerHTML = state.teams.map((t, i)=>{
      const colors = TEAM_COLORS[i % TEAM_COLORS.length];
      const glowClass = (maxScore > 0 && t.score >= maxScore && t.score > 0) ? ' winner-glow' : '';
      return `<div class="team-card" style="background:linear-gradient(135deg,${colors.c1},${colors.c2})${glowClass}">
        <div class="tc-name">${colors.icon} ${t.name}</div>
        <div class="tc-score">${t.score}</div>
        <div class="tc-members">${t.members.length} طالبة: ${t.members.slice(0,4).map(m=>escapeHtml(m)).join('، ')}${t.members.length > 4 ? '...' : ''}</div>
        <div class="tc-actions">
          <button class="tc-btn" data-team="${i}" data-action="plus10">+10 ✓</button>
          <button class="tc-btn" data-team="${i}" data-action="plus5">+5 ✓</button>
          <button class="tc-btn" data-team="${i}" data-action="minus">-1</button>
        </div>
      </div>`;
    }).join('');
    arena.querySelectorAll('[data-team]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const i = parseInt(btn.dataset.team);
        const action = btn.dataset.action;
        if(action === 'plus10'){
          state.teams[i].score += 10;
          playSuccess();
          gameToast('🎯', `+10 نقطة لـ ${state.teams[i].name}!`, 'success');
          checkTeamWin();
        } else if(action === 'plus5'){
          state.teams[i].score += 5;
          playClick();
          checkTeamWin();
        } else if(action === 'minus'){
          state.teams[i].score = Math.max(0, state.teams[i].score - 1);
          playFail();
        }
        saveState();
        renderTeamArena();
        updateStats();
      });
    });
  }
  function setupTeams(count){
    const students = getStudents();
    if(students.length === 0){
      gameToast('⚠️', 'لا توجد طالبات! أضيفي طالبات أولاً', 'gold');
      return;
    }
    count = Math.max(2, Math.min(6, count || 2));
    const shuffled = [...students].sort(()=> Math.random() - 0.5);
    const teams = [];
    for(let i=0;i<count;i++){
      teams.push({name: TEAM_COLORS[i].name, score: 0, members: []});
    }
    shuffled.forEach((s, i)=>{
      teams[i % count].members.push(s.name);
    });
    state.teams = teams;
    state.roundCount++;
    saveState();
    playSuccess();
    gameToast('🎉', `تم توزيع الطالبات على ${count} فرق!`, 'success');
    gameConfetti(30);
    renderTeamArena();
    updateStats();
  }
  function clearTeams(){
    state.teams = [];
    saveState();
    playClick();
    renderTeamArena();
  }
  function checkTeamWin(){
    const max = Math.max(...state.teams.map(t=>t.score));
    if(max >= 100){
      const winners = state.teams.filter(t=>t.score >= 100);
      setTimeout(()=>{
        playWin();
        gameConfetti(60);
        gameToast('🏆', `${winners.map(w=>w.name).join(' و ')} فازوا بالمعركة!`, 'success');
        // Award medal to each member
        winners.forEach(w=>{
          w.members.forEach(m=>{
            ensurePoints(m);
            state.medals[m] = state.medals[m] || {gold:0, silver:0, bronze:0};
            state.medals[m].gold++;
            state.points[m] += 25;
          });
        });
        saveState();
        renderHeroes();
      }, 300);
    }
  }

  // ===== STAR REWARD =====
  let selectedStars = 0;
  let selectedStarStudent = null;
  function renderStarPick(){
    const pick = document.getElementById('gameStarStudentPick');
    if(!pick) return;
    const students = getStudents();
    pick.innerHTML = '<span style="font-weight:900;color:#5f27cd"><i class="fas fa-user-graduate"></i> اختاري الطالبة:</span>';
    if(students.length === 0){
      pick.innerHTML += ' <span style="color:#7a5a8a">لا توجد طالبات</span>';
      return;
    }
    students.slice(0, 12).forEach(s=>{
      const btn = document.createElement('button');
      btn.className = 'star-pick-btn' + (selectedStarStudent === s.name ? ' active' : '');
      btn.dataset.name = s.name;
      btn.innerHTML = '👩‍🎓 ' + escapeHtml(s.name);
      btn.addEventListener('click', ()=>{
        selectedStarStudent = s.name;
        playClick();
        renderStarPick();
      });
      pick.appendChild(btn);
    });
    renderStarHistory();
  }
  function selectStars(n){
    selectedStars = n;
    document.querySelectorAll('#gameStarRating .star-icon').forEach(el=>{
      const v = parseInt(el.dataset.star);
      el.classList.toggle('filled', v <= n);
    });
    playStar();
  }
  function awardStars(){
    if(!selectedStarStudent){
      gameToast('⚠️', 'اختاري طالبة أولاً!', 'gold');
      return;
    }
    if(selectedStars === 0){
      gameToast('⚠️', 'اختاري عدد النجوم أولاً!', 'gold');
      return;
    }
    const stars = selectedStars;
    const name = selectedStarStudent;
    ensurePoints(name);
    const points = stars * 3; // 3 points per star
    state.points[name] += points;
    state.starHistory.unshift({name, stars, time: Date.now()});
    state.starHistory = state.starHistory.slice(0, 20);
    state.roundCount++;
    // Award medals for high star counts
    if(stars === 5) state.medals[name].gold++;
    else if(stars >= 4) state.medals[name].silver++;
    else if(stars >= 3) state.medals[name].bronze++;
    saveState();
    playWin();
    gameConfetti(35);
    gameToast('⭐', `${name} حصلت على ${stars} ${'⭐'.repeat(stars)}! +${points} نقطة`, 'success');
    selectedStars = 0;
    selectedStarStudent = null;
    document.querySelectorAll('#gameStarRating .star-icon').forEach(el=>el.classList.remove('filled'));
    renderStarPick();
    renderHeroes();
    updateStats();
  }
  function resetStar(){
    selectedStars = 0;
    selectedStarStudent = null;
    document.querySelectorAll('#gameStarRating .star-icon').forEach(el=>el.classList.remove('filled'));
    playClick();
    renderStarPick();
  }
  function renderStarHistory(){
    const list = document.getElementById('gameStarHistoryList');
    if(!list) return;
    if(!state.starHistory || state.starHistory.length === 0){
      list.innerHTML = '<div style="text-align:center;padding:14px;color:#7a5a8a;font-size:.85rem">لا توجد سجلات بعد 🌱</div>';
      return;
    }
    list.innerHTML = state.starHistory.map(h=>{
      const time = new Date(h.time);
      const t = time.toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'});
      return `<div class="star-history-item">
        <span class="shi-name">${escapeHtml(h.name)}</span>
        <span class="shi-stars">${'⭐'.repeat(h.stars)}</span>
        <span class="shi-time">${t}</span>
      </div>`;
    }).join('');
  }

  // ===== BAAMBOOZLE =====
  // شبكة 5×4 = 20 مربع:
  //  - 4 مربعات مفاجئة "بَـمْ!" (واحد في كل عمود من الأعمدة 0-3 + مربع إضافي)
  //  - 16 مربع سؤال، 4 مربعات لكل فئة من 4 فئات (5/10/15/20 نقطة)
  // الفئات تُسحب من QBank تلقائياً، أو من قائمة افتراضية عند فراغ المكتبة.

  const BAM_PTS = [5, 10, 15, 20];
  const BAM_DEFAULT_CATS = [
    {name:'معلومات عامة', emoji:'🧠'},
    {name:'علوم وطبيعة', emoji:'🔬'},
    {name:'لغة وأدب', emoji:'📖'},
    {name:'تاريخ وجغرافيا', emoji:'🌍'}
  ];

  let bam = {
    cols: 5,           // عدد الأعمدة
    rows: 4,           // عدد الصفوف
    cells: [],         // {idx, col, row, cat, points, isSurprise, opened, answered, qId}
    categories: [],    // 4 فئات بأسمائها وأيقوناتها
    totalPoints: 0,
    roundCount: 0,
    active: false,     // هل هناك جولة جارية؟
    currentCell: null, // المربع قيد الإجابة
    skipNext: false    // عقوبة المفاجأة: تخطي الجولة التالية
  };

  function bamGetCategories(){
    // اسحبي فئات حقيقية من QBank أولاً
    const all = (typeof QBank !== 'undefined' && QBank.all) ? QBank.all() : [];
    const used = new Set();
    if(all.length){
      // نأخذ الفئات الأكثر استخداماً
      const byCat = {};
      all.forEach(q => {
        const c = (q.category || 'عام').trim();
        byCat[c] = (byCat[c] || 0) + 1;
      });
      const sorted = Object.keys(byCat).sort((a,b) => byCat[b] - byCat[a]);
      // نأخذ 4 فئات مختلفة ونضيف إيموجي
      const emojiMap = {'رياضيات':'🔢','علوم':'🔬','لغة عربية':'📖','إسلامية':'🕌','اجتماعيات':'🌍','لغة إنجليزية':'🌐','عام':'🧠'};
      sorted.slice(0, 4).forEach((c, i) => {
        const emoji = emojiMap[c] || ['🧠','🔬','📖','🌍','🕌','🌐','🎨','🎵','⚽','🌸'][i % 10];
        bam.categories.push({name: c, emoji});
        used.add(c);
      });
    }
    // أكملي حتى 4 فئات بالافتراضية
    for(const def of BAM_DEFAULT_CATS){
      if(bam.categories.length >= 4) break;
      bam.categories.push(def);
    }
    // لو ما زلنا أقل من 4 (المكتبة فارغة تماماً) نملأ افتراضياً
    let i = 0;
    while(bam.categories.length < 4){
      const def = BAM_DEFAULT_CATS[i % BAM_DEFAULT_CATS.length];
      bam.categories.push({name: def.name + ' ' + (Math.floor(i/4)+1), emoji: def.emoji});
      i++;
    }
  }

  function bamShuffle(arr){
    const a = arr.slice();
    for(let i = a.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function bamBuildCells(){
    // 20 مربع:
    //  - 5 أعمدة × 4 صفوف
    //  - 4 مربعات مفاجئة (واحد في كل عمود من الأعمدة 0-3 + 1 في العمود 4)
    //  - بقية 16 مربع = أسئلة (4 مربعات × 4 نقاط = 16)
    bam.cells = [];
    bam.categories = [];
    bamGetCategories();

    // مواقع المربعات المفاجئة: صف عشوائي لكل عمود من 0-3، وصف 0 في العمود 4
    const surpriseSpots = [];
    for(let c=0; c<4; c++){
      surpriseSpots.push({col:c, row: Math.floor(Math.random() * 4)});
    }
    surpriseSpots.push({col:4, row: Math.floor(Math.random() * 4)});

    for(let row=0; row<4; row++){
      for(let col=0; col<5; col++){
        const isSurprise = surpriseSpots.some(s => s.col === col && s.row === row);
        const cat = col < 4 ? bam.categories[col] : bam.categories[Math.floor(Math.random() * bam.categories.length)];
        const points = isSurprise ? 0 : BAM_PTS[row];
        bam.cells.push({
          idx: row * 5 + col,
          col, row, cat, points,
          isSurprise,
          opened: false,
          answered: null,   // 'correct' | 'wrong' | 'surprise-hit' | null
          qId: null
        });
      }
    }
  }

  function bamRenderBoard(){
    const board = document.getElementById('bamBoard');
    if(!board) return;
    if(bam.cells.length === 0){
      board.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:#fff;font-weight:700">انقري "ابدأ جولة جديدة" لبدء اللعب! 🎮</div>';
      return;
    }
    board.innerHTML = bam.cells.map(cell => {
      const cls = ['bam-cell'];
      if(cell.isSurprise) cls.push('surprise');
      if(cell.opened) cls.push('opened');
      if(cell.answered === 'correct') cls.push('answered-correct');
      else if(cell.answered === 'wrong') cls.push('answered-wrong');
      else if(cell.answered === 'surprise-hit') cls.push('surprise-hit');
      const catIdx = bam.categories.indexOf(cell.cat);
      const catLabel = cell.cat ? cell.cat.emoji + ' ' + escapeHtml(cell.cat.name) : 'مفاجأة';
      const pts = cell.isSurprise ? '🎲' : (cell.points + '');
      return `<button class="${cls.join(' ')}" data-idx="${cell.idx}" data-cat="${catIdx >= 0 ? catIdx : 0}" type="button" ${cell.opened ? 'disabled aria-disabled="true"' : ''}>
        <span class="bam-pts">${pts}</span>
        <span class="bam-cat">${cell.isSurprise ? 'بَـمْ!' : catLabel}</span>
      </button>`;
    }).join('');

    // إعادة ربط النقر
    board.querySelectorAll('.bam-cell:not(.opened)').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        bamOpenCell(idx);
      });
    });
  }

  function bamUpdateStats(){
    const total = bam.cells.length || 20;
    const opened = bam.cells.filter(c => c.opened).length;
    const totalEl = document.getElementById('bamTotalCells');
    const openedEl = document.getElementById('bamOpenedCells');
    const pointsEl = document.getElementById('bamTotalPoints');
    const roundEl = document.getElementById('bamRoundCount');
    if(totalEl) totalEl.textContent = total;
    if(openedEl) openedEl.textContent = opened;
    if(pointsEl) pointsEl.textContent = bam.totalPoints;
    if(roundEl) roundEl.textContent = bam.roundCount;

    // شارة المصدر في التبويب
    const srcEl = document.getElementById('bamSourceLabel');
    if(srcEl){
      const qbCount = (typeof QBank !== 'undefined' && QBank.all) ? QBank.all().length : 0;
      srcEl.textContent = qbCount > 0 ? `مكتبة الأسئلة (${qbCount} سؤال)` : 'مكتبة فارغة (ستظهر أسئلة عامة)';
    }
  }

  function bamStart(){
    bamBuildCells();
    bam.active = true;
    bam.totalPoints = 0;
    bam.skipNext = false;
    bamRenderBoard();
    bamUpdateStats();
    playSuccess();
    gameToast('🎲', 'بدأت جولة بامبوزل جديدة! اختاري مربعاً لتبدأي', 'success');
  }

  function bamShuffleBoard(){
    if(bam.cells.length === 0) return;
    bam.cells = bamShuffle(bam.cells);
    // إعادة تعيين المواقع كأنها جديدة
    bam.cells.forEach((c, i) => { c.idx = i; c.opened = false; c.answered = null; c.qId = null; });
    bam.totalPoints = 0;
    bam.active = true;
    bam.skipNext = false;
    bamRenderBoard();
    bamUpdateStats();
    playClick();
    gameToast('🔀', 'تم إعادة ترتيب المربعات!', 'success');
  }

  function bamResetStats(){
    if(!confirm('هل تريدين تصفير إحصائيات بامبوزل فقط؟')) return;
    bam.cells = [];
    bam.totalPoints = 0;
    bam.roundCount = 0;
    bam.active = false;
    bam.skipNext = false;
    bamRenderBoard();
    bamUpdateStats();
    playClick();
    gameToast('🧹', 'تم تصفير إحصائيات بامبوزل', 'gold');
  }

  function bamOpenCell(idx){
    if(!bam.active){
      gameToast('⚠️', 'اضغطي "ابدأ جولة جديدة" أولاً!', 'gold');
      return;
    }
    const cell = bam.cells[idx];
    if(!cell || cell.opened) return;

    if(bam.skipNext){
      // عقوبة المفاجأة: لا نقاط، فقط افتحي المربع واظهري السبب
      cell.opened = true;
      cell.answered = 'wrong';
      bam.skipNext = false;
      bamRenderBoard();
      bamUpdateStats();
      playFail();
      gameToast('😵', 'تم تخطي هذه الجولة بسبب مفاجأة سابقة!', 'gold');
      bamCheckEnd();
      return;
    }

    if(cell.isSurprise){
      bamTriggerSurprise(cell);
    } else {
      bamShowQuestion(cell);
    }
  }

  function bamShowQuestion(cell){
    bam.currentCell = cell;
    // اختاري سؤالاً من QBank بنفس الفئة إن أمكن
    const all = (typeof QBank !== 'undefined' && QBank.all) ? QBank.all() : [];
    let pool = all;
    if(cell.cat && all.length){
      const catName = cell.cat.name;
      pool = all.filter(q => (q.category || '').trim() === catName);
      if(pool.length === 0) pool = all;
    }
    let q = null;
    if(pool.length){
      q = pool[Math.floor(Math.random() * pool.length)];
    }

    const overlay = document.getElementById('bamQuestionOverlay');
    const body = document.getElementById('bamQuestionBody');
    const headEmoji = document.getElementById('bamQuestionEmoji');
    const headTitle = document.getElementById('bamQuestionHeadTitle');
    if(!overlay || !body) return;

    if(!q){
      // لا توجد أسئلة في المكتبة — استخدمي سؤالاً افتراضياً مرحاً
      headEmoji.textContent = '🎲';
      headTitle.textContent = 'سؤال بامبوزل';
      body.innerHTML = `
        <div class="bam-q-meta">
          <span class="bam-q-tag">📁 ${escapeHtml(cell.cat ? cell.cat.name : 'عام')}</span>
          <span class="bam-q-pts">+${cell.points} نقطة</span>
        </div>
        <div class="bam-q-skip">
          <span class="bam-skip-emoji">📚</span>
          <div style="font-size:1.05rem;font-weight:800;margin-bottom:6px">المكتبة فارغة!</div>
          <div style="font-size:.88rem">أضيفي أسئلة في <b>مكتبة الأسئلة</b> أولاً لتحظي بتجربة كاملة ومخصصة.</div>
          <div style="margin-top:14px"><button class="gbtn gbtn-primary" id="bamGoQBank2"><i class="fas fa-book"></i> اذهبي للمكتبة</button></div>
        </div>
        <div class="bam-q-actions">
          <button class="gbtn gbtn-ghost" id="bamQCloseOnly"><i class="fas fa-times"></i> إغلاق</button>
        </div>
      `;
      cell.opened = true;
      cell.answered = 'wrong';
      cell.qId = null;
      overlay.classList.add('active');
      bamRenderBoard();
      bamUpdateStats();
      playClick();

      document.getElementById('bamQCloseOnly')?.addEventListener('click', () => {
        overlay.classList.remove('active');
        bamCheckEnd();
      });
      document.getElementById('bamGoQBank2')?.addEventListener('click', () => {
        overlay.classList.remove('active');
        document.querySelector('.games-tab[data-tab="questions"]')?.click();
      });
      return;
    }

    cell.qId = q.id;
    headEmoji.textContent = cell.cat ? cell.cat.emoji : '❓';
    headTitle.textContent = cell.cat ? cell.cat.name : 'سؤال';

    const opts = (q.options || []);
    const letters = ['أ','ب','ج','د','هـ','و','ز','ح'];
    const hasOptions = opts.length > 0;

    let html = `
      <div class="bam-q-meta">
        <span class="bam-q-tag">📁 ${escapeHtml(q.category || (cell.cat ? cell.cat.name : 'عام'))}</span>
        <span class="bam-q-tag">${q.difficulty === 'easy' ? '🟢 سهل' : q.difficulty === 'hard' ? '🔴 صعب' : '🟡 متوسط'}</span>
        <span class="bam-q-pts">+${cell.points} نقطة</span>
      </div>
      <div class="bam-q-text">${escapeHtml(q.text || '(بدون نص)')}</div>
    `;
    if(hasOptions){
      html += `<div class="bam-q-opts">`;
      opts.forEach((opt, i) => {
        html += `<button class="bam-q-opt" data-idx="${i}" data-letter="${letters[i] || (i+1)}" type="button">${escapeHtml(opt)}</button>`;
      });
      html += `</div>`;
    } else {
      // سؤال نص حر — لا توجد خيارات
      html += `
        <div class="bam-q-empty">
          <i class="fas fa-comments"></i>
          <div style="font-size:.95rem;font-weight:800">سؤال نصي حر</div>
          <div style="font-size:.8rem;margin-top:6px;color:#7a5a8a">اسألي الطالبات شفهياً وعلّمي الزر أدناه لإجابة "صحيحة" أو "خاطئة".</div>
        </div>
        <div class="bam-q-actions">
          <button class="gbtn gbtn-success" id="bamManualCorrect"><i class="fas fa-check"></i> إجابة صحيحة (+${cell.points})</button>
          <button class="gbtn gbtn-danger" id="bamManualWrong"><i class="fas fa-times"></i> إجابة خاطئة</button>
        </div>
      `;
    }

    body.innerHTML = html;
    overlay.classList.add('active');
    playClick();

    if(hasOptions){
      body.querySelectorAll('.bam-q-opt').forEach(btn => {
        btn.addEventListener('click', () => {
          const chosen = parseInt(btn.dataset.idx, 10);
          bamAnswerQuestion(cell, q, chosen);
        });
      });
    } else {
      document.getElementById('bamManualCorrect')?.addEventListener('click', () => bamAnswerQuestion(cell, q, -2));
      document.getElementById('bamManualWrong')?.addEventListener('click', () => bamAnswerQuestion(cell, q, -3));
    }
  }

  function bamAnswerQuestion(cell, q, chosenIdx){
    // chosenIdx: -2 = manual correct, -3 = manual wrong
    const correctIdx = (q.correct != null && q.correct >= 0) ? q.correct : -1;
    let isCorrect = false;
    if(chosenIdx === -2) isCorrect = true;            // manual correct
    else if(chosenIdx === -3) isCorrect = false;      // manual wrong
    else if(correctIdx === -1) isCorrect = true;      // no correct marked → always correct
    else isCorrect = (chosenIdx === correctIdx);

    // علّمي الأزرار
    const body = document.getElementById('bamQuestionBody');
    if(body){
      body.querySelectorAll('.bam-q-opt').forEach(btn => {
        const i = parseInt(btn.dataset.idx, 10);
        btn.disabled = true;
        if(correctIdx >= 0 && i === correctIdx) btn.classList.add('correct');
        else if(i === chosenIdx && !isCorrect) btn.classList.add('wrong');
      });
    }

    cell.opened = true;
    cell.answered = isCorrect ? 'correct' : 'wrong';
    bamRenderBoard();

    if(isCorrect){
      bam.totalPoints += cell.points;
      bam.roundCount++;
      // امنحي النقاط للطالبة الفائزة الأخيرة، أو اختاري عشوائياً
      const target = state.lastWinner || (() => {
        const ss = getStudents();
        return ss.length ? ss[Math.floor(Math.random()*ss.length)].name : null;
      })();
      if(target){
        ensurePoints(target);
        state.points[target] += cell.points;
        saveState();
        state.lastWinner = target;
      }
      try{ if(q.qId) QBank.use(q.id); }catch(e){}
      playWin();
      gameConfetti(30);
      gameToast('✅', `+${cell.points} نقطة${target ? ' لـ ' + target : ''}! أحسنتِ!`, 'success');
    } else {
      bam.roundCount++;
      playFail();
      gameToast('❌', 'لا بأس! الجولة القادمة أفضل 💪', 'gold');
    }
    bamUpdateStats();
    updateStats();
    renderHeroes();

    // أغلق المودال بعد لحظة
    setTimeout(() => {
      document.getElementById('bamQuestionOverlay').classList.remove('active');
      bamCheckEnd();
    }, isCorrect ? 1400 : 1000);
  }

  // ===== BAAMBOOZLE SURPRISES =====
  // بَـمْ! قد تكون مكافأة أو عقبة!
  const BAM_SURPRISES = [
    {
      emoji:'🎁',
      title:'مكافأة!',
      desc:'حصلتِ على +10 نقاط إضافية! كافئي الطالبة الفائزة الأخيرة أو أي طالبة.',
      effect:'bonus10'
    },
    {
      emoji:'🌟',
      title:'نجمة ذهبية!',
      desc:'ضاعفي النقاط! ستحصلين على +20 نقطة بدلاً من أي سؤال تفتحينه بعدها.',
      effect:'double'
    },
    {
      emoji:'⏭️',
      title:'تخطي الجولة!',
      desc:'لا يمكنك الإجابة عن السؤال التالي! اضغطي مربعاً آخر.',
      effect:'skip'
    },
    {
      emoji:'💔',
      title:'خسارة!',
      desc:'خسرتِ 5 نقاط 😱 لا تقلقي، يمكنك تعويضها في المربعات التالية!',
      effect:'minus5'
    },
    {
      emoji:'👯',
      title:'تبديل!',
      desc:'تبادلي النقاط مع طالبة أخرى اختاريها!',
      effect:'swap'
    },
    {
      emoji:'🎯',
      title:'سؤال إضافي!',
      desc:'احصلي على سؤال إضافي! +15 نقطة إذا أجبتِ صح.',
      effect:'extra'
    },
    {
      emoji:'👑',
      title:'ملكة المربع!',
      desc:'كل الطالبات يحصلن على +5 نقاط! تفضلي 🥰',
      effect:'allPlus5'
    },
    {
      emoji:'🎲',
      title:'حظ الحظ!',
      desc:'اقلب العملة! إذا ظهرت الصورة = +15، إذا ظهرت الكتابة = -5.',
      effect:'coin'
    }
  ];

  function bamTriggerSurprise(cell){
    bam.currentCell = cell;
    const surprise = BAM_SURPRISES[Math.floor(Math.random() * BAM_SURPRISES.length)];
    cell.opened = true;
    cell.answered = 'surprise-hit';
    cell.qId = null;
    bamRenderBoard();
    bamUpdateStats();
    playStar();
    gameConfetti(25);
    bamShowSurprise(surprise);
  }

  function bamShowSurprise(surprise){
    const overlay = document.getElementById('bamSurpriseOverlay');
    const body = document.getElementById('bamSurpriseBody');
    if(!overlay || !body) return;
    let extraHtml = '';
    if(surprise.effect === 'swap'){
      const students = getStudents();
      if(students.length >= 2){
        extraHtml = `<div style="margin-top:8px"><label style="font-weight:800;color:#5f27cd;display:block;margin-bottom:6px">اختاري الطالبة لتبادلي النقاط معها:</label><select id="bamSwapSel" style="padding:8px;border:2px solid #ff6b9d;border-radius:10px;width:100%;max-width:300px;font-family:'Tajawal',sans-serif;font-weight:700">${students.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)} (${state.points[s.name] || 0} نقطة)</option>`).join('')}</select></div>`;
      }
    }
    body.innerHTML = `
      <div class="bam-surprise-content">
        <span class="bam-surprise-emoji">${surprise.emoji}</span>
        <div class="bam-surprise-title">${escapeHtml(surprise.title)}</div>
        <div class="bam-surprise-desc">${escapeHtml(surprise.desc)}</div>
        ${extraHtml}
        <div class="bam-q-actions">
          <button class="gbtn gbtn-success" id="bamSurpriseAccept"><i class="fas fa-check"></i> تطبيق!</button>
        </div>
      </div>
    `;
    overlay.classList.add('active');
    playStar();

    document.getElementById('bamSurpriseAccept')?.addEventListener('click', () => {
      bamApplySurprise(surprise);
    });
  }

  function bamApplySurprise(surprise){
    const overlay = document.getElementById('bamSurpriseOverlay');
    let applied = false;
    const students = getStudents();

    switch(surprise.effect){
      case 'bonus10':{
        const target = state.lastWinner || (students.length ? students[Math.floor(Math.random()*students.length)].name : null);
        if(target){
          ensurePoints(target);
          state.points[target] += 10;
          bam.totalPoints += 10;
          state.lastWinner = target;
          gameToast('🎁', `+10 نقطة لـ ${target}!`, 'success');
          playWin();
          gameConfetti(20);
        } else {
          bam.totalPoints += 10;
          gameToast('🎁', '+10 نقطة للجولة!', 'success');
        }
        applied = true;
        break;
      }
      case 'double':{
        bam.totalPoints += 20;
        const target = state.lastWinner || (students.length ? students[Math.floor(Math.random()*students.length)].name : null);
        if(target){
          ensurePoints(target);
          state.points[target] += 20;
          state.lastWinner = target;
        }
        gameToast('🌟', '+20 نقطة! مضاعَفة!', 'success');
        playWin();
        gameConfetti(35);
        applied = true;
        break;
      }
      case 'skip':{
        bam.skipNext = true;
        gameToast('⏭️', 'سيتم تخطي السؤال التالي!', 'gold');
        playFail();
        applied = true;
        break;
      }
      case 'minus5':{
        const target = state.lastWinner;
        if(target && state.points[target] > 0){
          state.points[target] = Math.max(0, state.points[target] - 5);
          bam.totalPoints = Math.max(0, bam.totalPoints - 5);
          gameToast('💔', `-5 نقاط من ${target}`, 'gold');
        } else {
          bam.totalPoints = Math.max(0, bam.totalPoints - 5);
          gameToast('💔', '-5 نقاط من الجولة', 'gold');
        }
        playFail();
        applied = true;
        break;
      }
      case 'swap':{
        const sel = document.getElementById('bamSwapSel');
        const target = sel ? sel.value : null;
        const last = state.lastWinner;
        if(target && last && target !== last && state.points[last] != null){
          const a = state.points[last] || 0;
          const b = state.points[target] || 0;
          state.points[last] = b;
          state.points[target] = a;
          gameToast('👯', `تم تبديل النقاط بين ${last} و ${target}!`, 'success');
          playStar();
        } else {
          gameToast('⚠️', 'لا يمكن التبديل — اختاري طالبة مختلفة عن الفائزة الأخيرة', 'gold');
          playFail();
          break;
        }
        applied = true;
        break;
      }
      case 'extra':{
        bam.totalPoints += 15;
        const target = state.lastWinner || (students.length ? students[Math.floor(Math.random()*students.length)].name : null);
        if(target){
          ensurePoints(target);
          state.points[target] += 15;
          state.lastWinner = target;
        }
        gameToast('🎯', '+15 نقطة إضافية!', 'success');
        playWin();
        gameConfetti(20);
        applied = true;
        break;
      }
      case 'allPlus5':{
        students.forEach(s => {
          ensurePoints(s.name);
          state.points[s.name] += 5;
        });
        bam.totalPoints += 5 * students.length;
        gameToast('👑', '+5 نقاط لكل الطالبات!', 'success');
        playWin();
        gameConfetti(45);
        applied = true;
        break;
      }
      case 'coin':{
        // flip
        const won = Math.random() < 0.5;
        if(won){
          bam.totalPoints += 15;
          const target = state.lastWinner || (students.length ? students[Math.floor(Math.random()*students.length)].name : null);
          if(target){
            ensurePoints(target);
            state.points[target] += 15;
            state.lastWinner = target;
          }
          gameToast('🪙', 'ظهرت الصورة! +15 نقطة!', 'success');
          playWin();
          gameConfetti(25);
        } else {
          bam.totalPoints = Math.max(0, bam.totalPoints - 5);
          gameToast('🪙', 'ظهرت الكتابة! -5 نقاط', 'gold');
          playFail();
        }
        applied = true;
        break;
      }
    }

    if(applied){
      saveState();
      bamUpdateStats();
      updateStats();
      renderHeroes();
    }
    overlay.classList.remove('active');
    bamCheckEnd();
  }

  function bamCheckEnd(){
    if(bam.cells.length === 0) return;
    const opened = bam.cells.filter(c => c.opened).length;
    if(opened >= bam.cells.length){
      setTimeout(bamShowVictory, 600);
    }
  }

  function bamShowVictory(){
    const overlay = document.getElementById('bamVictoryOverlay');
    const body = document.getElementById('bamVictoryBody');
    if(!overlay || !body) return;
    const opened = bam.cells.filter(c => c.opened).length;
    const correct = bam.cells.filter(c => c.answered === 'correct').length;
    const wrong = bam.cells.filter(c => c.answered === 'wrong').length;
    const surprises = bam.cells.filter(c => c.isSurprise).length;
    const hitSurprises = bam.cells.filter(c => c.answered === 'surprise-hit').length;
    const accuracy = opened > 0 ? Math.round((correct / Math.max(1, correct + wrong)) * 100) : 0;
    let title = 'انتهت الجولة!';
    let subtitle = 'أحسنتِ يا بطلات! 🌟';
    if(accuracy >= 80) { title = 'أداء مذهل! 🏆'; subtitle = 'دقّتك في الإجابات رائعة!'; }
    else if(accuracy >= 60) { title = 'عمل رائع! 🌟'; subtitle = 'استمري في التحسن!'; }
    else if(accuracy >= 40) { title = 'جيد! 💪'; subtitle = 'المحاولة القادمة ستكون أفضل!'; }
    else { title = 'استمري وحاولي! 🌱'; subtitle = 'كل خطأ يعلّمنا شيئاً جديداً'; }

    body.innerHTML = `
      <div class="bam-victory-content">
        <span class="bam-victory-trophy">🏆</span>
        <div class="bam-victory-title">${escapeHtml(title)}</div>
        <div style="color:#7a5a8a;font-weight:700;margin-bottom:8px">${escapeHtml(subtitle)}</div>
        <div class="bam-victory-stats">
          <div class="bam-victory-stat"><span class="vs-emoji">📦</span><span class="vs-val">${opened}</span><span class="vs-label">مربع مفتوح</span></div>
          <div class="bam-victory-stat"><span class="vs-emoji">✅</span><span class="vs-val">${correct}</span><span class="vs-label">إجابة صحيحة</span></div>
          <div class="bam-victory-stat"><span class="vs-emoji">❌</span><span class="vs-val">${wrong}</span><span class="vs-label">إجابة خاطئة</span></div>
          <div class="bam-victory-stat"><span class="vs-emoji">🎲</span><span class="vs-val">${hitSurprises}/${surprises}</span><span class="vs-label">مفاجآت</span></div>
          <div class="bam-victory-stat"><span class="vs-emoji">🎯</span><span class="vs-val">${accuracy}%</span><span class="vs-label">نسبة الدقة</span></div>
          <div class="bam-victory-stat"><span class="vs-emoji">💰</span><span class="vs-val">${bam.totalPoints}</span><span class="vs-label">مجموع النقاط</span></div>
        </div>
        <div class="bam-q-actions">
          <button class="gbtn gbtn-success" id="bamNewGame"><i class="fas fa-redo"></i> جولة جديدة</button>
          <button class="gbtn gbtn-primary" id="bamShareQBank"><i class="fas fa-book"></i> أضيفي أسئلة للمكتبة</button>
          <button class="gbtn gbtn-ghost" id="bamCloseVictory"><i class="fas fa-times"></i> إغلاق</button>
        </div>
      </div>
    `;
    overlay.classList.add('active');
    playWin();
    gameConfetti(60);
    setTimeout(() => gameConfetti(40), 800);

    document.getElementById('bamNewGame')?.addEventListener('click', () => {
      overlay.classList.remove('active');
      bamStart();
    });
    document.getElementById('bamShareQBank')?.addEventListener('click', () => {
      overlay.classList.remove('active');
      document.querySelector('.games-tab[data-tab="questions"]')?.click();
    });
    document.getElementById('bamCloseVictory')?.addEventListener('click', () => {
      overlay.classList.remove('active');
    });
  }

  // ===== RESET ALL =====
  function resetAllGames(){
    if(!confirm('هل تريدين مسح كل بيانات الألعاب؟ (النقاط، الميداليات، الفرق، السجل)')) return;
    state = {
      points: {},
      medals: {},
      teams: [],
      starHistory: [],
      lastWinner: null,
      roundCount: 0,
      openedChests: new Set()
    };
    // ⭐ صفّر بامبوزل أيضاً
    bam.cells = [];
    bam.totalPoints = 0;
    bam.roundCount = 0;
    bam.active = false;
    bam.skipNext = false;
    // ⭐ صفّر البارجة أيضاً
    bsState = {active:false, ended:false, shots:0, hits:0, points:0, revealed:new Set()};
    bsShips = [];
    const bsCells = document.querySelectorAll('.bs-cell');
    bsCells.forEach(c => c.className = 'bs-cell');
    const bsStartBtn = document.getElementById('bsStartBtn');
    if(bsStartBtn) bsStartBtn.innerHTML = '<i class="fas fa-play"></i> ابدئي لعبة جديدة';
    const bsReshuffleBtn = document.getElementById('bsReshuffleBtn');
    if(bsReshuffleBtn) bsReshuffleBtn.style.display = 'none';
    const bsVictoryOverlay = document.getElementById('bsVictoryOverlay');
    if(bsVictoryOverlay) bsVictoryOverlay.classList.remove('active');
    // ⭐ صفّر سلّم الأبطال أيضاً
    ladPlayers = [];
    ladCurrent = 0;
    ladRound = 1;
    ladCorrect = 0;
    ladLaddersClimbed = 0;
    ladGameOver = false;
    ladRenderPlayers();
    ladRenderTokens();
    ladSetStatus('🎲 أضيفي لاعبتين على الأقل وابدئي اللعب', '');
    const ladV = document.getElementById('ladVictoryOverlay');
    if(ladV) ladV.classList.remove('active');
    const ladQ = document.getElementById('ladQuestionOverlay');
    if(ladQ) ladQ.classList.remove('active');
    const ladP = document.getElementById('ladPlayersOverlay');
    if(ladP) ladP.classList.remove('active');
    const turnEl = document.getElementById('ladTurnName');
    if(turnEl) turnEl.textContent = 'دوري';
    saveState();
    playClick();
    renderHeroes();
    renderSpeedList();
    renderTreasure();
    renderStarPick();
    renderTeamArena();
    bamRenderBoard();
    bamUpdateStats();
    bsRenderFleet();
    bsUpdateStats();
    updateStats();
    gameToast('🗑️', 'تم مسح كل البيانات', 'gold');
  }

  // ---- Helpers ----
  function escapeHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---- Bindings ----
  function bind(){
    document.getElementById('cbGames').addEventListener('click', openGames);
    document.getElementById('gamesClose').addEventListener('click', closeGames);
    document.getElementById('gamesOverlay').addEventListener('click', e=>{
      if(e.target.id === 'gamesOverlay') closeGames();
    });
    document.querySelectorAll('.games-tab').forEach(t=>{
      t.addEventListener('click', ()=> switchTab(t.dataset.tab));
    });
    document.querySelectorAll('[data-goto]').forEach(el=>{
      el.addEventListener('click', ()=> switchTab(el.dataset.goto));
    });

    // Wheel
    document.getElementById('gameWheelBtn').addEventListener('click', spinGameWheel);
    document.getElementById('gameWheelSpin').addEventListener('click', spinGameWheel);
    document.getElementById('gameWheelReward').addEventListener('click', rewardLastWinner);
    document.getElementById('gameWheelReset').addEventListener('click', resetGameWheel);

    // Speed
    document.getElementById('gameSpeedStart').addEventListener('click', startSpeedTimer);
    document.getElementById('gameSpeedStop').addEventListener('click', stopSpeedTimer);
    document.getElementById('gameSpeedReset').addEventListener('click', resetSpeedTimer);

    // Treasure
    document.getElementById('gameTreasureReset').addEventListener('click', resetTreasure);
    document.getElementById('gameTreasureAward').addEventListener('click', treasureAwardAll);

    // Team
    document.getElementById('gameTeamSetup').addEventListener('click', ()=>{
      const n = parseInt(document.getElementById('gameTeamCount').value) || 2;
      setupTeams(n);
    });
    document.getElementById('gameTeamClear').addEventListener('click', clearTeams);

    // Star
    document.querySelectorAll('#gameStarRating .star-icon').forEach(el=>{
      el.addEventListener('click', ()=> selectStars(parseInt(el.dataset.star)));
    });
    document.getElementById('gameStarAward').addEventListener('click', awardStars);
    document.getElementById('gameStarReset').addEventListener('click', resetStar);

    // ⭐ Baamboozle
    document.getElementById('bamStartBtn')?.addEventListener('click', bamStart);
    document.getElementById('bamShuffleBtn')?.addEventListener('click', bamShuffleBoard);
    document.getElementById('bamResetBtn')?.addEventListener('click', bamResetStats);
    document.getElementById('bamGoQBank')?.addEventListener('click', ()=>{
      document.querySelector('.games-tab[data-tab="questions"]')?.click();
    });
    // إغلاق مودالات بامبوزل
    document.getElementById('bamQuestionClose')?.addEventListener('click', ()=>{
      document.getElementById('bamQuestionOverlay').classList.remove('active');
      // إذا لم تُفتح الخلية بعد (مثال: مستخدم أغلق يدوياً قبل الإجابة)، نتركها كما هي
    });
    document.getElementById('bamSurpriseClose')?.addEventListener('click', ()=>{
      document.getElementById('bamSurpriseOverlay').classList.remove('active');
      bamCheckEnd();
    });
    document.getElementById('bamVictoryClose')?.addEventListener('click', ()=>{
      document.getElementById('bamVictoryOverlay').classList.remove('active');
    });
    // إغلاق بالنقر خارج المودال
    ['bamQuestionOverlay','bamSurpriseOverlay','bamVictoryOverlay'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', e => {
        if(e.target.id === id) {
          document.getElementById(id).classList.remove('active');
          if(id === 'bamSurpriseOverlay') bamCheckEnd();
        }
      });
    });

    // Footer
    document.getElementById('gamesResetAll').addEventListener('click', resetAllGames);

    // Esc
    document.addEventListener('keydown', e=>{
      if(e.key === 'Escape'){
        // أغلق مودال بامبوزل أولاً إن كان مفتوحاً
        if(document.getElementById('bamVictoryOverlay')?.classList.contains('active')){
          document.getElementById('bamVictoryOverlay').classList.remove('active');
          return;
        }
        if(document.getElementById('bamSurpriseOverlay')?.classList.contains('active')){
          document.getElementById('bamSurpriseOverlay').classList.remove('active');
          bamCheckEnd();
          return;
        }
        if(document.getElementById('bamQuestionOverlay')?.classList.contains('active')){
          // لا نسمح بإغلاق مودال السؤال بـ Esc لتفادي ضياع الإجابات
          return;
        }
        if(document.getElementById('gamesOverlay').classList.contains('active')){
          closeGames();
        }
      }
    });
  }

  // ---- Init ----
  loadState();
  if(typeof state.openedChests === 'undefined' || !(state.openedChests instanceof Set)){
    state.openedChests = new Set();
  }
  bind();
  updateStats();
  // ⭐ ابدئي لوحة بامبوزل فارغة (تظهر رسالة "انقري ابدأ جولة جديدة")
  try{ bamRenderBoard(); bamUpdateStats(); }catch(e){}

  // ============================================================
  // ⭐⭐⭐ QBANK UI — مكتبة الأسئلة (داخل IIFE للوصول لـ state/playClick) ⭐⭐⭐
  // ============================================================
  let qbankEditing = null;  // id of question being edited, or null for new
  const _qbiLetters = ['أ','ب','ج','د','هـ','و','ز','ح'];

  function _diffLabel(d){ return d==='easy'?'سهل':d==='hard'?'صعب':'متوسط'; }
  function _diffEmoji(d){ return d==='easy'?'🟢':d==='hard'?'🔴':'🟡'; }

  function renderQBankStats(){
    const all = QBank.all();
    const el = (id) => document.getElementById(id);
    if(el('qbsTotal')) el('qbsTotal').textContent = all.length;
    if(el('qbsCategories')) el('qbsCategories').textContent = QBank.categories().length;
    if(el('qbsMostUsed')){
      const top = QBank.mostUsed();
      el('qbsMostUsed').textContent = (top && top.uses) ? (top.uses + '×') : '—';
      el('qbsMostUsed').title = top ? top.text : '';
    }
    // شارة العدّ في التبويب
    if(el('gtQuestionsCount')) el('gtQuestionsCount').textContent = all.length;
    // ⭐ حدّث ملصق مصدر أسئلة بامبوزل
    try{
      const src = document.getElementById('bamSourceLabel');
      if(src) src.textContent = all.length > 0 ? `مكتبة الأسئلة (${all.length} سؤال)` : 'مكتبة فارغة (ستظهر أسئلة عامة)';
    }catch(e){}
  }

  function _qbankGetFilters(){
    return {
      search: (document.getElementById('qbankSearch')?.value || '').trim().toLowerCase(),
      cat: document.getElementById('qbankFilterCat')?.value || '',
      diff: document.getElementById('qbankFilterDiff')?.value || '',
      sort: document.getElementById('qbankSortBy')?.value || 'newest'
    };
  }

  function renderQBank(){
    renderQBankStats();
    // populate category filter
    const sel = document.getElementById('qbankFilterCat');
    if(sel){
      const cur = sel.value;
      const cats = QBank.categories();
      sel.innerHTML = '<option value="">📁 كل الفئات</option>' + cats.map(c => `<option value="${c.replace(/"/g,'&quot;')}">${c}</option>`).join('');
      sel.value = cur;
    }
    // populate speed challenge picker
    populateSpeedQPicker();

    // list
    const items = document.getElementById('qbankItems');
    const empty = document.getElementById('qbankEmpty');
    if(!items) return;
    const all = QBank.all();
    const f = _qbankGetFilters();

    let filtered = all.slice();
    if(f.search){
      filtered = filtered.filter(q => {
        const inText = (q.text||'').toLowerCase().includes(f.search);
        const inOpts = (q.options||[]).some(o => (o||'').toLowerCase().includes(f.search));
        const inCat = (q.category||'').toLowerCase().includes(f.search);
        return inText || inOpts || inCat;
      });
    }
    if(f.cat) filtered = filtered.filter(q => q.category === f.cat);
    if(f.diff) filtered = filtered.filter(q => q.difficulty === f.diff);

    if(f.sort === 'newest') filtered.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
    else if(f.sort === 'oldest') filtered.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
    else if(f.sort === 'most-used') filtered.sort((a,b) => (b.uses||0) - (a.uses||0));
    else if(f.sort === 'least-used') filtered.sort((a,b) => (a.uses||0) - (b.uses||0));
    else if(f.sort === 'alpha') filtered.sort((a,b) => (a.text||'').localeCompare((b.text||''), 'ar'));

    if(all.length === 0){
      empty.style.display = 'block';
      empty.innerHTML = `
        <div class="qbe-emoji">📚</div>
        <h3>لا توجد أسئلة بعد</h3>
        <p>اضغطي على "إضافة سؤال" أو "استيراد جماعي" للبدء</p>`;
      items.innerHTML = '';
      return;
    }
    if(filtered.length === 0){
      empty.style.display = 'block';
      empty.innerHTML = `
        <div class="qbe-emoji">🔍</div>
        <h3>لا توجد نتائج للبحث</h3>
        <p>جربي تغيير الفلاتر أو ابحثي بكلمات مختلفة</p>`;
      items.innerHTML = '';
      return;
    }
    empty.style.display = 'none';

    items.innerHTML = filtered.map((q, idx) => {
      const opts = (q.options||[]).map((o,i) => {
        const isCorrect = i === q.correct;
        return `<span class="qb-opt-pill${isCorrect?' correct':''}">${_qbiLetters[i]||(i+1)}. ${escapeHtml(o)}${isCorrect?' ✓':''}</span>`;
      }).join('');
      const lastUsed = q.lastUsedAt ? new Date(q.lastUsedAt).toLocaleDateString('ar-EG',{day:'numeric',month:'short'}) : '';
      return `<div class="qb-card" data-id="${q.id}">
        <div class="qb-num">${idx+1}</div>
        <div class="qb-body">
          <div class="qb-text">${escapeHtml(q.text || '(بدون نص)')}</div>
          ${opts ? `<div class="qb-opts">${opts}</div>` : ''}
          <div class="qb-meta">
            <span class="qb-tag cat"><i class="fas fa-folder"></i> ${escapeHtml(q.category||'عام')}</span>
            <span class="qb-tag diff-${q.difficulty}">${_diffEmoji(q.difficulty)} ${_diffLabel(q.difficulty)}</span>
            ${q.uses ? `<span class="qb-tag" title="عدد مرات الاستخدام"><i class="fas fa-bolt"></i> ${q.uses}× استخدام</span>` : ''}
            ${lastUsed ? `<span class="qb-tag"><i class="fas fa-clock"></i> ${lastUsed}</span>` : ''}
          </div>
        </div>
        <div class="qb-actions">
          <button class="qb-use" title="استخدمي هذا السؤال في تحدي السرعة" data-action="use"><i class="fas fa-play"></i></button>
          <button class="qb-edit" title="تعديل" data-action="edit"><i class="fas fa-pen"></i></button>
          <button class="qb-dup" title="تكرار" data-action="dup"><i class="fas fa-copy"></i></button>
          <button class="qb-del" title="حذف" data-action="del"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
    }).join('');

    // bind actions
    items.querySelectorAll('.qb-card').forEach(card => {
      const id = card.dataset.id;
      card.querySelectorAll('.qb-actions button').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const act = btn.dataset.action;
          if(act === 'use'){
            const q = QBank.get(id);
            if(!q) return;
            // اذهبي لتحدي السرعة وضعي السؤال
            const input = document.getElementById('gameSpeedQuestion');
            if(input){ input.value = q.text; input.focus(); }
            // ضع الـ id في محدد الأسئلة
            const sel = document.getElementById('gameSpeedQPick');
            if(sel){ sel.value = id; }
            // افتحي تبويب تحدي السرعة
            document.querySelector('.games-tab[data-tab="speed"]')?.click();
            playSuccess();
            gameToast('⚡', 'تم اختيار السؤال لتحدي السرعة', 'success');
          } else if(act === 'edit'){
            openQBankForm(id);
          } else if(act === 'dup'){
            const dup = QBank.duplicate(id);
            if(dup){ playClick(); gameToast('📋', 'تم تكرار السؤال', 'success'); }
          } else if(act === 'del'){
            if(confirm('هل تريدين حذف هذا السؤال؟')){
              QBank.remove(id);
              playClick();
              gameToast('🗑️', 'تم الحذف', 'success');
            }
          }
        });
      });
    });
  }

  function populateSpeedQPicker(){
    const sel = document.getElementById('gameSpeedQPick');
    if(!sel) return;
    const cur = sel.value;
    const all = QBank.all();
    if(all.length === 0){
      sel.innerHTML = '<option value="">📚 المكتبة فارغة — أضيفي أسئلة أولاً</option>';
      return;
    }
    // تجميع حسب الفئة
    const byCat = {};
    all.forEach(q => {
      const c = q.category || 'عام';
      byCat[c] = byCat[c] || [];
      byCat[c].push(q);
    });
    let html = '<option value="">📚 اختاري سؤالاً من المكتبة (اختياري)...</option>';
    Object.keys(byCat).sort().forEach(cat => {
      html += `<optgroup label="📁 ${escapeHtml(cat)}">`;
      byCat[cat].forEach(q => {
        const text = (q.text||'').length > 60 ? q.text.substring(0,57)+'…' : q.text;
        const used = q.uses ? ` (${q.uses}×)` : '';
        html += `<option value="${q.id}">${escapeHtml(text)}${used}</option>`;
      });
      html += '</optgroup>';
    });
    sel.innerHTML = html;
    if(cur && QBank.get(cur)) sel.value = cur;
  }

  // ---- Form: open/close/save ----
  function openQBankForm(id){
    qbankEditing = id || null;
    const form = document.getElementById('qbankForm');
    if(!form) return;
    form.style.display = 'block';
    document.getElementById('qbfTitle').textContent = id ? 'تعديل السؤال' : 'إضافة سؤال جديد';

    // populate categories
    const catSel = document.getElementById('qbfCategory');
    if(catSel){
      const cats = QBank.categories();
      catSel.innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    }

    // reset
    document.getElementById('qbfText').value = '';
    document.getElementById('qbfDifficulty').value = 'medium';
    document.getElementById('qbfCorrect').innerHTML = '<option value="-1">بدون إجابة صحيحة محددة</option>';
    const optsHost = document.getElementById('qbfOpts');
    optsHost.innerHTML = `
      <div class="qbf-opt-row"><span class="qbf-letter">أ</span><input type="text" class="qbf-opt-input" placeholder="الخيار الأول"></div>
      <div class="qbf-opt-row"><span class="qbf-letter">ب</span><input type="text" class="qbf-opt-input" placeholder="الخيار الثاني"></div>
    `;

    if(id){
      const q = QBank.get(id);
      if(q){
        document.getElementById('qbfText').value = q.text || '';
        document.getElementById('qbfDifficulty').value = q.difficulty || 'medium';
        document.getElementById('qbfCategory').value = q.category || 'عام';
        const opts = q.options || [];
        optsHost.innerHTML = '';
        const targetCount = Math.max(opts.length, 2);
        for(let i=0; i<targetCount; i++){
          _qbankAddOptRow(opts[i] || '', _qbiLetters[i] || (i+1));
        }
        // populate correct select
        _qbankRefreshCorrect();
        document.getElementById('qbfCorrect').value = String(q.correct != null ? q.correct : -1);
      }
    } else {
      _qbankRefreshCorrect();
    }
    document.getElementById('qbfText').focus();
    form.scrollIntoView({behavior:'smooth', block:'nearest'});
  }

  function _qbankAddOptRow(value, letter){
    const host = document.getElementById('qbfOpts');
    const row = document.createElement('div');
    row.className = 'qbf-opt-row';
    row.innerHTML = `
      <span class="qbf-letter">${letter}</span>
      <input type="text" class="qbf-opt-input" value="${escapeHtml(value||'')}" placeholder="نص الخيار">
      <button type="button" class="qbf-opt-remove" title="احذف الخيار"><i class="fas fa-times"></i></button>
    `;
    row.querySelector('.qbf-opt-remove').addEventListener('click', () => {
      row.remove();
      _qbankRefreshLetters();
      _qbankRefreshCorrect();
    });
    row.querySelector('.qbf-opt-input').addEventListener('input', _qbankRefreshCorrect);
    host.appendChild(row);
  }
  function _qbankRefreshLetters(){
    const host = document.getElementById('qbfOpts');
    if(!host) return;
    Array.from(host.children).forEach((row, i) => {
      const l = row.querySelector('.qbf-letter');
      if(l) l.textContent = _qbiLetters[i] || (i+1);
    });
  }
  function _qbankRefreshCorrect(){
    const host = document.getElementById('qbfOpts');
    const sel = document.getElementById('qbfCorrect');
    if(!host || !sel) return;
    const rows = Array.from(host.querySelectorAll('.qbf-opt-input'));
    const filled = rows.filter(i => (i.value||'').trim());
    const cur = sel.value;
    if(filled.length === 0){
      sel.innerHTML = '<option value="-1">بدون إجابة صحيحة محددة (أضيفي خيارات أولاً)</option>';
      return;
    }
    sel.innerHTML = '<option value="-1">بدون إجابة صحيحة محددة</option>' +
      filled.map((inp,i) => {
        const idx = rows.indexOf(inp);
        return `<option value="${idx}">${_qbiLetters[idx]||(idx+1)}. ${escapeHtml((inp.value||'').substring(0,30))}</option>`;
      }).join('');
    sel.value = cur;
  }

  function closeQBankForm(){
    document.getElementById('qbankForm').style.display = 'none';
    qbankEditing = null;
  }

  function saveQBankForm(){
    const text = (document.getElementById('qbfText').value || '').trim();
    if(!text){ alert('اكتبي نص السؤال'); document.getElementById('qbfText').focus(); return; }
    const category = document.getElementById('qbfCategory').value || 'عام';
    const difficulty = document.getElementById('qbfDifficulty').value || 'medium';
    const correct = parseInt(document.getElementById('qbfCorrect').value || '-1', 10);
    const options = Array.from(document.querySelectorAll('#qbfOpts .qbf-opt-input'))
      .map(i => (i.value||'').trim())
      .filter(Boolean);

    if(qbankEditing){
      QBank.update(qbankEditing, {text, options, correct, category, difficulty});
      gameToast('✅', 'تم تحديث السؤال', 'success');
    } else {
      QBank.add({text, options, correct, category, difficulty});
      gameToast('✅', 'تم إضافة السؤال', 'success');
    }
    playSuccess();
    closeQBankForm();
  }

  // ---- Import (Bulk) ----
  let _qbiParsed = [];
  function parseQBankImport(text, defaultCat, defaultDiff){
    _qbiParsed = [];
    if(!text || !text.trim()) return _qbiParsed;
    const lines = text.split(/\r?\n/);
    let curCat = defaultCat;
    let curDiff = defaultDiff;
    let curQ = null;
    let curOpts = [];
    let curCorrect = -1;
    const flush = () => {
      if(curQ){
        _qbiParsed.push({
          text: curQ,
          options: curOpts,
          correct: curCorrect,
          category: curCat,
          difficulty: curDiff
        });
      }
      curQ = null; curOpts = []; curCorrect = -1;
    };
    for(const raw of lines){
      const line = raw.trim();
      if(!line){ continue; }
      // meta line
      const meta = line.match(/^(?:الفئة|فئة|Category)\s*:\s*([^|]+?)(?:\s*\|\s*(?:المستوى|مستوى|Difficulty)\s*:\s*(سهل|متوسط|صعب|easy|medium|hard))?\s*$/i);
      if(meta){
        flush();
        curCat = (meta[1]||'').trim() || defaultCat;
        const lvl = (meta[2]||'').trim().toLowerCase();
        if(lvl === 'سهل' || lvl === 'easy') curDiff = 'easy';
        else if(lvl === 'صعب' || lvl === 'hard') curDiff = 'hard';
        else if(lvl === 'متوسط' || lvl === 'medium') curDiff = 'medium';
        else curDiff = defaultDiff;
        continue;
      }
      // option line: starts with - • * or ✓ (✓ marks correct)
      const optMatch = line.match(/^[-•*✓]\s+(.+)$/);
      if(optMatch){
        let opt = optMatch[1].trim();
        let isCorrect = line.startsWith('✓');
        // also support ✓ at end of text
        if(/\s*✓\s*$/.test(opt)){
          isCorrect = true;
          opt = opt.replace(/\s*✓\s*$/, '').trim();
        }
        curOpts.push(opt);
        if(isCorrect) curCorrect = curOpts.length - 1;
        continue;
      }
      // new question
      flush();
      curQ = line;
    }
    flush();
    return _qbiParsed;
  }

  // ---- Bind UI ----
  function bindQBankUI(){
    // open/close form
    document.getElementById('qbankAddBtn')?.addEventListener('click', () => openQBankForm(null));
    document.getElementById('qbfClose')?.addEventListener('click', closeQBankForm);
    document.getElementById('qbfCancel')?.addEventListener('click', closeQBankForm);
    document.getElementById('qbfSave')?.addEventListener('click', saveQBankForm);

    // add/remove options
    document.getElementById('qbfAddOpt')?.addEventListener('click', () => {
      const host = document.getElementById('qbfOpts');
      const i = host.children.length;
      _qbankAddOptRow('', _qbiLetters[i] || (i+1));
      _qbankRefreshCorrect();
      host.lastElementChild?.querySelector('.qbf-opt-input')?.focus();
    });

    // add custom category
    document.getElementById('qbfAddCat')?.addEventListener('click', () => {
      const name = prompt('اسم الفئة الجديدة:');
      if(name && QBank.addCustomCategory(name.trim())){
        openQBankForm(qbankEditing); // re-render to update dropdown
        gameToast('📁', 'تمت إضافة الفئة', 'success');
      } else if(name){
        alert('هذه الفئة موجودة مسبقاً');
      }
    });

    // search/filter
    ['qbankSearch','qbankFilterCat','qbankFilterDiff','qbankSortBy'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.addEventListener('input', renderQBank);
      if(el && el.tagName === 'SELECT') el.addEventListener('change', renderQBank);
    });

    // random
    document.getElementById('qbankRandomBtn')?.addEventListener('click', () => {
      const q = QBank.pickRandom();
      if(!q){ gameToast('⚠️', 'لا توجد أسئلة في المكتبة بعد', 'gold'); return; }
      // fill speed challenge
      const input = document.getElementById('gameSpeedQuestion');
      if(input) input.value = q.text;
      const sel = document.getElementById('gameSpeedQPick');
      if(sel) sel.value = q.id;
      document.querySelector('.games-tab[data-tab="speed"]')?.click();
      playSuccess();
      gameToast('🎲', `سؤال عشوائي: ${q.text.substring(0,40)}...`, 'success');
    });

    // open library from speed challenge
    document.getElementById('gameSpeedQOpen')?.addEventListener('click', () => {
      document.querySelector('.games-tab[data-tab="questions"]')?.click();
    });

    // speed challenge picker
    document.getElementById('gameSpeedQPick')?.addEventListener('change', (e) => {
      const id = e.target.value;
      if(!id) return;
      const q = QBank.get(id);
      if(!q) return;
      const input = document.getElementById('gameSpeedQuestion');
      if(input) input.value = q.text;
      playClick();
    });

    // speed challenge random
    document.getElementById('gameSpeedQRandom')?.addEventListener('click', () => {
      const q = QBank.pickRandom();
      if(!q){ gameToast('⚠️', 'لا توجد أسئلة في المكتبة بعد', 'gold'); return; }
      const input = document.getElementById('gameSpeedQuestion');
      if(input) input.value = q.text;
      const sel = document.getElementById('gameSpeedQPick');
      if(sel) sel.value = q.id;
      playSuccess();
      gameToast('🎲', 'تم اختيار سؤال عشوائي', 'success');
    });

    // export
    document.getElementById('qbankExportBtn')?.addEventListener('click', () => {
      const json = QBank.exportJson();
      const blob = new Blob([json], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `games_questions_${new Date().toISOString().substring(0,10)}.json`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
      gameToast('💾', 'تم تنزيل الملف', 'success');
    });

    // clear all
    document.getElementById('qbankClearAllBtn')?.addEventListener('click', () => {
      if(!confirm('هل تريدين مسح كل الأسئلة؟ لا يمكن التراجع.')) return;
      QBank.clearAll();
      gameToast('🗑️', 'تم مسح كل الأسئلة', 'success');
    });

    // import
    const importBtn = document.getElementById('qbankImportBtn');
    const importPanel = document.getElementById('qbankImport');
    const importClose = document.getElementById('qbiClose');
    const importCancel = document.getElementById('qbiCancel');
    const importParse = document.getElementById('qbiParse');
    const importText = document.getElementById('qbiText');
    const importPreview = document.getElementById('qbiPreview');

    importBtn?.addEventListener('click', () => {
      importPanel.style.display = 'block';
      importPanel.scrollIntoView({behavior:'smooth'});
    });
    const closeImport = () => { importPanel.style.display = 'none'; importPreview.style.display='none'; importText.value=''; };
    importClose?.addEventListener('click', closeImport);
    importCancel?.addEventListener('click', closeImport);
    importParse?.addEventListener('click', () => {
      const text = importText.value || '';
      const cat = document.getElementById('qbiDefaultCat').value;
      const diff = document.getElementById('qbiDefaultDiff').value;
      const parsed = parseQBankImport(text, cat, diff);
      if(parsed.length === 0){
        importPreview.style.display = 'block';
        importPreview.innerHTML = '<b style="color:#c0392b">⚠️ لم يتم العثور على أسئلة. تحققي من الصيغة.</b>';
        return;
      }
      // معاينة + تأكيد
      importPreview.style.display = 'block';
      importPreview.innerHTML = `
        <b style="color:#0a3d62">✅ تم العثور على ${parsed.length} سؤال:</b>
        <ol style="margin:8px 0;padding-right:20px;max-height:200px;overflow-y:auto">
          ${parsed.slice(0,50).map(q => `<li style="margin:3px 0"><b>${escapeHtml(q.text.substring(0,60))}${q.text.length>60?'…':''}</b>${q.options.length?` <small>(${q.options.length} خيارات${q.correct>=0?' ✓':''})</small>`:''} <small style="color:#7a5a8a">[${escapeHtml(q.category)}]</small></li>`).join('')}
        </ol>
        ${parsed.length > 50 ? `<small>... و ${parsed.length-50} سؤال آخر</small><br>` : ''}
        <button type="button" class="gbtn gbtn-success" id="qbiConfirm" style="margin-top:8px"><i class="fas fa-check"></i> تأكيد الاستيراد (${parsed.length} سؤال)</button>
        <button type="button" class="gbtn gbtn-ghost" id="qbiCancel2" style="margin-top:8px;margin-right:6px">إلغاء</button>
      `;
      document.getElementById('qbiConfirm')?.addEventListener('click', () => {
        parsed.forEach(q => QBank.add(q));
        gameToast('📥', `تم استيراد ${parsed.length} سؤال بنجاح`, 'success');
        playSuccess();
        closeImport();
      });
      document.getElementById('qbiCancel2')?.addEventListener('click', closeImport);
    });

    // re-render whenever QBank changes
    QBank.subscribe(renderQBank);
  }

  // اربط الـ UI عند التحميل + حدّث العداد عند فتح الألعاب
  bindQBankUI();
  renderQBank();

  // ============================================================
  // ⭐⭐⭐ BATTLESHIP - البارجة التعليمية ⭐⭐⭐
  // ============================================================
  const BS_GRID_SIZE = 10;
  const BS_SHIPS = [
    {name:'حاملة الطائرات', size:5, icon:'🛩️'},
    {name:'البارجة',         size:4, icon:'🚢'},
    {name:'الطراد',          size:3, icon:'🛳️'},
    {name:'الغواصة',         size:3, icon:'🛥️'},
    {name:'المدمرة',         size:2, icon:'⛵'}
  ];
  let bsShips = [];
  let bsFilteredQs = [];
  let bsState = {active:false, ended:false, shots:0, hits:0, points:0, revealed:new Set()};
  let bsCurrentQ = null;
  let bsGridBuilt = false;

  function bsFilterQuestions(){
    const catSel = document.getElementById('bsCategoryFilter');
    const diffSel = document.getElementById('bsDifficultyFilter');
    // حدّث قائمة الفئات من QBank عند أول استدعاء أو عند تغيّر البنك
    if(catSel && typeof QBank !== 'undefined' && QBank.categories){
      const cats = QBank.categories();
      const currentVal = catSel.value;
      const defaultOpt = catSel.querySelector('option[value=""]');
      catSel.innerHTML = '';
      if(defaultOpt) catSel.appendChild(defaultOpt);
      else { const o = document.createElement('option'); o.value=''; o.textContent='📚 كل الفئات'; catSel.appendChild(o); }
      cats.forEach(c => {
        const o = document.createElement('option');
        o.value = c;
        o.textContent = c;
        catSel.appendChild(o);
      });
      // استعد القيمة المختارة إن كانت لا تزال متوفرة
      if([...catSel.options].some(o => o.value === currentVal)) catSel.value = currentVal;
    }
    const cat = catSel?.value || '';
    const diff = diffSel?.value || '';
    const all = (typeof QBank !== 'undefined' && QBank.all) ? QBank.all() : [];
    bsFilteredQs = all.filter(q => {
      const catMatch = !cat || (q.category || '') === cat;
      const diffMatch = !diff || (q.difficulty || '') === diff;
      return catMatch && diffMatch;
    });
    // حدّث ملصق المصدر
    const lbl = document.getElementById('bsSourceLabel');
    if(lbl){
      lbl.textContent = all.length > 0
        ? `مكتبة الأسئلة (${bsFilteredQs.length}/${all.length})`
        : 'مكتبة فارغة';
    }
    // إحصائيات مرئية
    const countBadge = document.getElementById('gtBsCount');
    if(countBadge){ countBadge.textContent = all.length; countBadge.style.display = all.length ? 'inline-block' : 'none'; }
    bsUpdateEmptyState();
  }

  function bsUpdateEmptyState(){
    const empty = document.getElementById('bsEmptyQbank');
    if(!empty) return;
    empty.style.display = (bsFilteredQs.length === 0) ? 'block' : 'none';
  }

  function bsBuildGrid(){
    const gridEl = document.getElementById('bsGrid');
    if(!gridEl) return;
    gridEl.innerHTML = '';
    for(let r=0; r<BS_GRID_SIZE; r++){
      for(let c=0; c<BS_GRID_SIZE; c++){
        const cell = document.createElement('div');
        cell.className = 'bs-cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.addEventListener('click', () => bsCellClick(r, c));
        gridEl.appendChild(cell);
      }
    }
    bsGridBuilt = true;
  }

  function bsInit(){
    if(!bsGridBuilt) bsBuildGrid();
    bsFilterQuestions();
    bsRenderFleet();
    bsUpdateStats();
  }

  function bsPlaceShips(){
    bsShips = BS_SHIPS.map(s => ({...s, cells:[], hits:0, sunk:false}));
    const occupied = new Set();
    for(const ship of bsShips){
      let placed = false, attempts = 0;
      while(!placed && attempts < 1000){
        attempts++;
        const vertical = Math.random() < 0.5;
        const maxR = vertical ? BS_GRID_SIZE - ship.size : BS_GRID_SIZE;
        const maxC = vertical ? BS_GRID_SIZE : BS_GRID_SIZE - ship.size;
        const r0 = Math.floor(Math.random() * maxR);
        const c0 = Math.floor(Math.random() * maxC);
        const cells = [];
        for(let i=0; i<ship.size; i++){
          const r = vertical ? r0 + i : r0;
          const c = vertical ? c0 : c0 + i;
          cells.push({r, c});
        }
        const overlap = cells.some(p => occupied.has(`${p.r},${p.c}`));
        if(!overlap){
          ship.cells = cells;
          cells.forEach(p => occupied.add(`${p.r},${p.c}`));
          placed = true;
        }
      }
    }
  }

  function bsRenderFleet(){
    const fleetEl = document.getElementById('bsFleet');
    if(!fleetEl) return;
    if(!bsShips.length){
      fleetEl.innerHTML = '<div style="text-align:center;padding:14px;color:#7a5a8a;font-size:.82rem">اضغطي "ابدئي لعبة جديدة" لتوزيع الأسطول 🚢</div>';
      return;
    }
    fleetEl.innerHTML = '';
    bsShips.forEach(ship => {
      const row = document.createElement('div');
      row.className = 'bs-ship-row' + (ship.sunk ? ' sunk' : '');
      row.innerHTML = `
        <span class="bs-ship-icon">${ship.icon}</span>
        <div class="bs-ship-info">
          <div class="bs-ship-name">${ship.name}</div>
          <div class="bs-ship-size">${ship.size} خلايا</div>
        </div>
        <div class="bs-ship-status">${ship.sunk ? '⚓ غرقت' : '🌊 تعوم'}</div>`;
      fleetEl.appendChild(row);
    });
  }

  function bsUpdateStats(){
    const shots = bsState.shots || 0;
    const hits  = bsState.hits  || 0;
    const sunk  = bsShips.filter(s => s.sunk).length;
    const total = bsShips.length;
    const points = (hits * 10) + (sunk * 50);
    bsState.points = points;
    const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    set('bsShotsFired', shots);
    set('bsHits', hits);
    set('bsShipsSunk', sunk);
    set('bsShipsTotal', total);
    set('bsTotalPoints', points);
  }

  function bsCellClick(r, c){
    if(!bsState.active || bsState.ended) return;
    const key = `${r},${c}`;
    if(bsState.revealed && bsState.revealed.has(key)) return;
    if(!bsState.revealed) bsState.revealed = new Set();
    bsState.revealed.add(key);
    bsState.shots = (bsState.shots || 0) + 1;

    const hitShip = bsShips.find(s => s.cells.some(p => p.r === r && p.c === c));
    const cell = document.querySelector(`.bs-cell[data-r="${r}"][data-c="${c}"]`);

    if(hitShip){
      hitShip.hits = (hitShip.hits || 0) + 1;
      bsState.hits = (bsState.hits || 0) + 1;
      if(cell) cell.classList.add('hit');
      if(hitShip.hits >= hitShip.size){
        // غرقت السفينة
        hitShip.sunk = true;
        hitShip.cells.forEach(p => {
          const pc = document.querySelector(`.bs-cell[data-r="${p.r}"][data-c="${p.c}"]`);
          if(pc){ pc.classList.remove('hit'); pc.classList.add('sunk'); }
        });
        bsShowStatus(`💥 غرقت ${hitShip.name}!`, 'success');
        try{ if(typeof gameConfetti === 'function') gameConfetti(20); }catch(e){}
        bsRenderFleet();
        bsUpdateStats();
        bsCheckVictory();
      } else {
        // إصابة — اسألي سؤالاً للتأكيد
        bsShowQuestion(r, c, true);
        return;
      }
    } else {
      // إخفاق — اسألي سؤالاً للتعلّم
      if(cell) cell.classList.add('miss');
      bsShowQuestion(r, c, false);
      return;
    }
  }

  function bsShowQuestion(r, c, isHit){
    if(bsFilteredQs.length === 0){
      bsShowStatus('⚠️ لا توجد أسئلة في الفلتر الحالي!', 'gold');
      return;
    }
    const overlay = document.getElementById('bsQuestionOverlay');
    const q = bsFilteredQs[Math.floor(Math.random() * bsFilteredQs.length)];
    bsCurrentQ = {q, r, c, isHit};

    document.getElementById('bsQuestionEmoji').textContent = isHit ? '🔥' : '❓';
    document.getElementById('bsQuestionHeadTitle').textContent = isHit
      ? 'إصابة! أجيبي للتأكيد'
      : 'أخطأتِ! أجيبي للتعلّم';
    document.getElementById('bsQuestionText').textContent = q.text || '—';

    const optsEl = document.getElementById('bsQuestionOpts');
    optsEl.innerHTML = '';
    const letters = ['أ','ب','ج','د','هـ','و','ز','ح'];
    (q.options || []).forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'bs-q-opt';
      btn.innerHTML = `<span class="bs-q-opt-letter">${letters[i] || (i+1)}</span><span>${escapeHtml(opt)}</span>`;
      btn.addEventListener('click', () => bsAnswerQuestion(i));
      optsEl.appendChild(btn);
    });

    const resultEl = document.getElementById('bsQuestionResult');
    resultEl.className = 'bs-q-result';
    resultEl.style.display = 'none';
    resultEl.innerHTML = '';

    overlay.classList.add('active');
  }

  function bsAnswerQuestion(idx){
    if(!bsCurrentQ) return;
    const resultEl = document.getElementById('bsQuestionResult');
    const opts = document.querySelectorAll('.bs-q-opt');
    opts.forEach((b, i) => {
      b.disabled = true;
      if(i === bsCurrentQ.q.correct) b.classList.add('correct');
      else if(i === idx && i !== bsCurrentQ.q.correct) b.classList.add('wrong');
    });
    const correct = idx === bsCurrentQ.q.correct;
    resultEl.className = 'bs-q-result ' + (correct ? 'ok' : 'bad') + ' show';
    if(correct){
      resultEl.innerHTML = '✅ إجابة صحيحة! استمري في الغرق!';
      if(!bsCurrentQ.isHit){
        bsState.points = (bsState.points || 0) + 5;
      }
    } else {
      const correctTxt = (bsCurrentQ.q.options || [])[bsCurrentQ.q.correct] || '';
      resultEl.innerHTML = '❌ الإجابة الصحيحة: ' + escapeHtml(correctTxt);
    }
    // سجّل استخدام السؤال
    try{ if(typeof QBank !== 'undefined' && QBank.use) QBank.use(bsCurrentQ.q.id); }catch(e){}
    bsUpdateStats();
  }

  function bsCloseQuestion(){
    const overlay = document.getElementById('bsQuestionOverlay');
    if(overlay) overlay.classList.remove('active');
    const cur = bsCurrentQ;
    bsCurrentQ = null;
    if(cur){
      const {r, c, isHit} = cur;
      if(isHit){
        // تأكدي من تحديث الحالة بعد الإجابة
        const hitShip = bsShips.find(s => s.cells.some(p => p.r === r && p.c === c));
        if(hitShip && hitShip.hits >= hitShip.size && !hitShip.sunk){
          hitShip.sunk = true;
          hitShip.cells.forEach(p => {
            const pc = document.querySelector(`.bs-cell[data-r="${p.r}"][data-c="${p.c}"]`);
            if(pc){ pc.classList.remove('hit'); pc.classList.add('sunk'); }
          });
          bsRenderFleet();
        }
        bsCheckVictory();
      }
      bsRenderFleet();
      bsUpdateStats();
    }
  }

  function bsCheckVictory(){
    if(bsShips.length && bsShips.every(s => s.sunk)){
      bsState.ended = true;
      bsState.active = false;
      setTimeout(bsShowVictory, 600);
    }
  }

  function bsShowVictory(){
    const overlay = document.getElementById('bsVictoryOverlay');
    if(!overlay) return;
    const shots = bsState.shots || 0;
    const hits  = bsState.hits  || 0;
    const sunk  = bsShips.length;
    const accuracy = shots > 0 ? Math.round((hits / shots) * 100) : 0;
    const points = (hits * 10) + (sunk * 50);
    const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    set('bsVictoryShots', shots);
    set('bsVictoryHits', hits);
    set('bsVictoryAccuracy', accuracy + '%');
    set('bsVictoryPoints', points);
    overlay.classList.add('active');
    try{ if(typeof gameConfetti === 'function') gameConfetti(60); }catch(e){}
    try{ if(typeof gameToast === 'function') gameToast('🎉','أسطول العدو غرق بالكامل! أحسنتِ يا بطلة!','gold'); }catch(e){}
    try{ if(typeof playSuccess === 'function') playSuccess(); }catch(e){}
  }

  function bsCloseVictory(){
    const overlay = document.getElementById('bsVictoryOverlay');
    if(overlay) overlay.classList.remove('active');
  }

  function bsShowStatus(msg, type){
    const el = document.getElementById('bsStatusArea');
    if(!el) return;
    el.textContent = msg;
    el.style.color = type === 'success' ? '#27ae60' : '#c44569';
    if(el._bsTimer) clearTimeout(el._bsTimer);
    el._bsTimer = setTimeout(() => {
      if(el.textContent === msg) el.textContent = '';
    }, 2500);
  }

  function bsStartGame(){
    bsState = {active:true, ended:false, shots:0, hits:0, points:0, revealed:new Set()};
    bsPlaceShips();
    // صفّر كل الخلايا
    const cells = document.querySelectorAll('.bs-cell');
    cells.forEach(c => c.className = 'bs-cell');
    bsRenderFleet();
    bsUpdateStats();
    const startBtn = document.getElementById('bsStartBtn');
    if(startBtn) startBtn.innerHTML = '<i class="fas fa-redo"></i> لعبة جديدة';
    const resh = document.getElementById('bsReshuffleBtn');
    if(resh) resh.style.display = 'inline-flex';
    bsShowStatus('🚢 بدأت المعركة! اضربي البحر بالإجابات!', 'success');
    try{ if(typeof playClick === 'function') playClick(); }catch(e){}
  }

  function bsReshuffleShips(){
    if(!bsState.active || bsState.ended) return;
    bsPlaceShips();
    const cells = document.querySelectorAll('.bs-cell');
    cells.forEach(c => c.className = 'bs-cell');
    bsState.revealed = new Set();
    bsRenderFleet();
    bsUpdateStats();
    bsShowStatus('🔄 أُعيد توزيع الأسطول!', 'success');
    try{ if(typeof playClick === 'function') playClick(); }catch(e){}
  }

  function bsRevealAll(){
    if(!bsShips.length){
      bsShowStatus('⚠️ ابدئي لعبة أولاً!', 'gold');
      return;
    }
    bsShips.forEach(s => {
      s.cells.forEach(p => {
        const c = document.querySelector(`.bs-cell[data-r="${p.r}"][data-c="${p.c}"]`);
        if(c) c.classList.add('revealed');
      });
    });
    bsShowStatus('👁️ كُشفت السفن (وضع تدريب)', 'success');
    try{ if(typeof playClick === 'function') playClick(); }catch(e){}
  }

  // ---- Battleship bindings ----
  function bindBattleshipUI(){
    document.getElementById('bsStartBtn')?.addEventListener('click', bsStartGame);
    document.getElementById('bsReshuffleBtn')?.addEventListener('click', bsReshuffleShips);
    document.getElementById('bsRevealBtn')?.addEventListener('click', bsRevealAll);
    document.getElementById('bsGoQBank')?.addEventListener('click', () => switchTab('questions'));
    document.getElementById('bsGoQBankEmpty')?.addEventListener('click', () => switchTab('questions'));
    document.getElementById('bsCategoryFilter')?.addEventListener('change', bsFilterQuestions);
    document.getElementById('bsDifficultyFilter')?.addEventListener('change', bsFilterQuestions);
    document.getElementById('bsQuestionCloseBtn')?.addEventListener('click', bsCloseQuestion);
    document.getElementById('bsQuestionNextBtn')?.addEventListener('click', bsCloseQuestion);
    document.getElementById('bsVictoryCloseBtn')?.addEventListener('click', () => {
      bsCloseVictory();
      bsStartGame();
    });
    // أغلق بضغط Escape
    document.addEventListener('keydown', (e) => {
      if(e.key !== 'Escape') return;
      const ovQ = document.getElementById('bsQuestionOverlay');
      const ovV = document.getElementById('bsVictoryOverlay');
      if(ovV && ovV.classList.contains('active')){ bsCloseVictory(); bsStartGame(); }
      else if(ovQ && ovQ.classList.contains('active')){ bsCloseQuestion(); }
    });
    // أضغط على خلفية الـ overlay = إغلاق
    document.getElementById('bsQuestionOverlay')?.addEventListener('click', (e) => {
      if(e.target === e.currentTarget) bsCloseQuestion();
    });
  }

  bindBattleshipUI();
  // ابني الشبكة وعرض حالة فارغة مبدئياً
  bsBuildGrid();
  bsRenderFleet();
  bsUpdateStats();
  bsFilterQuestions();

  // أعد التصفية عند تغيّر بنك الأسئلة
  try{
    if(typeof QBank !== 'undefined' && QBank.subscribe){
      QBank.subscribe(() => { bsFilterQuestions(); bsUpdateStats(); });
    }
  }catch(e){}

  // ============================================================
  // ⭐⭐⭐ SNAKES & LADDERS - سلّم الأبطال ⭐⭐⭐
  // ============================================================
  const LAD_BOARD_SIZE = 100;
  const LAD_MAX_PLAYERS = 4;
  const LAD_COLORS = [
    {name:'pink',  dot:'#ff6b9d', border:'#c44569', gradient:'linear-gradient(135deg,#ff6b9d,#c44569)'},
    {name:'blue',  dot:'#48dbfb', border:'#0abde3', gradient:'linear-gradient(135deg,#48dbfb,#0abde3)'},
    {name:'green', dot:'#1dd1a1', border:'#10ac84', gradient:'linear-gradient(135deg,#1dd1a1,#10ac84)'},
    {name:'amber', dot:'#feca57', border:'#ff9f43', gradient:'linear-gradient(135deg,#feca57,#ff9f43)'}
  ];
  // سلالم (لأعلى) وثعابين (لأسفل) — مواضع تقليدية
  const LAD_LADDERS = {
    4:25, 9:31, 21:42, 28:56, 36:57, 51:72, 62:81, 71:91, 80:99
  };
  const LAD_SNAKES = {
    17:7, 24:5, 33:11, 49:23, 54:34, 61:44, 78:65, 87:67, 95:73
  };
  // خلايا الأسئلة: كل 5 خلايا من 3
  const LAD_Q_CELLS = new Set();
  for(let i=3; i<=LAD_BOARD_SIZE; i+=5) LAD_Q_CELLS.add(i);

  let ladPlayers = [];     // [{id, name, pos, color, correct, ladders}]
  let ladCurrent = 0;       // index of current player
  let ladRound = 1;
  let ladCorrect = 0;       // total correct answers this game
  let ladLaddersClimbed = 0;
  let ladGameOver = false;
  let ladBoardBuilt = false;
  let ladFilteredQs = [];
  let ladCurrentQ = null;
  let ladCurrentCell = 0;
  let ladPending = null;    // {kind:'move'|'ladder'|'snake'|'q', value, playerIdx, qCell}
  let ladRolling = false;
  let ladPickedStudents = new Set();

  // ----- Helpers -----
  // حوّلي رقم الخلية إلى إحداثيات (col, row) حيث row 1 = أسفل
  function ladCellPos(n){
    const rowFromBottom = Math.floor((n-1) / 10); // 0..9
    const colInRow = (n-1) % 10; // 0..9
    // الصفوف الزوجية من الأسفل: من اليسار لليمين، الفردية: من اليمين لليسار
    const col = (rowFromBottom % 2 === 0) ? colInRow : (9 - colInRow);
    return { col, row: rowFromBottom }; // 0..9 لكل منهما
  }

  function ladCellCenter(n){
    // النسبة المئوية داخل لوحة 10x10
    const p = ladCellPos(n);
    // نضيف 0.5 لتكون في مركز الخلية
    return { x: (p.col + 0.5) * 10, y: (9 - p.row + 0.5) * 10 };
  }

  function ladFilteredQuestions(){
    const all = (typeof QBank !== 'undefined' && QBank.all) ? QBank.all() : [];
    if(all.length === 0) return [];
    // نختار عشوائياً من كل البنك (لا فلتر — لأن المعلمة قد تختار لاعبات من فئات مختلفة)
    return all.slice();
  }

  function ladUpdateSourceLabel(){
    const lbl = document.getElementById('ladSourceLabel');
    if(!lbl) return;
    const all = (typeof QBank !== 'undefined' && QBank.all) ? QBank.all() : [];
    lbl.textContent = all.length > 0 ? `مكتبة الأسئلة (${all.length} سؤال)` : 'مكتبة فارغة';
    const badge = document.getElementById('gtLadCount');
    if(badge){ badge.textContent = all.length; badge.style.display = all.length ? 'inline-block' : 'none'; }
  }

  function ladSetStatus(msg, type){
    const el = document.getElementById('ladStatus');
    if(!el) return;
    el.textContent = msg;
    el.className = 'lad-status' + (type ? ' ' + type : '');
  }

  // ----- Board construction -----
  function ladBuildBoard(){
    const board = document.getElementById('ladBoard');
    const lines = document.getElementById('ladLines');
    if(!board || !lines) return;
    board.innerHTML = '';
    // build 100 cells
    for(let n=1; n<=LAD_BOARD_SIZE; n++){
      const cell = document.createElement('div');
      cell.className = 'lad-cell';
      cell.dataset.n = n;
      // الموضع: الصف 1 (CSS) = الأعلى، فالخليّة n=1 يجب أن تكون في الأسفل (CSS row 10)
      const p = ladCellPos(n);
      cell.style.gridRow = (p.row + 1); // 1..10 (top to bottom)
      cell.style.gridColumn = (p.col + 1); // 1..10 (left to right)

      // رقم الخلية
      const numEl = document.createElement('div');
      numEl.className = 'lc-num';
      numEl.textContent = n;
      cell.appendChild(numEl);

      // أيقونة إذا سلم/ثعبان
      if(LAD_LADDERS[n]){
        cell.classList.add('has-ladder');
        const ic = document.createElement('div');
        ic.className = 'lc-icon';
        ic.textContent = '🪜';
        cell.appendChild(ic);
      } else if(LAD_SNAKES[n]){
        cell.classList.add('has-snake');
        const ic = document.createElement('div');
        ic.className = 'lc-icon';
        ic.textContent = '🐍';
        cell.appendChild(ic);
      } else if(n === LAD_BOARD_SIZE){
        cell.classList.add('has-finish');
        const ic = document.createElement('div');
        ic.className = 'lc-icon';
        ic.textContent = '🏆';
        cell.appendChild(ic);
      } else if(n === 1){
        const ic = document.createElement('div');
        ic.className = 'lc-icon';
        ic.textContent = '🏁';
        cell.appendChild(ic);
      }

      // شارة سؤال
      if(LAD_Q_CELLS.has(n)){
        const qb = document.createElement('div');
        qb.className = 'lc-q';
        qb.textContent = '?';
        cell.appendChild(qb);
      }
      board.appendChild(cell);
    }

    // SVG paths للسلالم والثعابين
    let pathHtml = '<defs><linearGradient id="ladGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#27ae60"/><stop offset="100%" stop-color="#1e8449"/></linearGradient><linearGradient id="snkGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e74c3c"/><stop offset="100%" stop-color="#922b21"/></linearGradient></defs>';
    // سلالم
    Object.entries(LAD_LADDERS).forEach(([from, to]) => {
      const a = ladCellCenter(+from);
      const b = ladCellCenter(+to);
      // خط سلم: خطان متوازيان + قضبان عرضية
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      const nx = -dy / len * 0.18, ny = dx / len * 0.18;
      pathHtml += `<line x1="${a.x+nx}" y1="${a.y+ny}" x2="${b.x+nx}" y2="${b.y+ny}" stroke="#27ae60" stroke-width="0.32" stroke-linecap="round"/>`;
      pathHtml += `<line x1="${a.x-nx}" y1="${a.y-ny}" x2="${b.x-nx}" y2="${b.y-ny}" stroke="#27ae60" stroke-width="0.32" stroke-linecap="round"/>`;
      // قضبان كل 0.6 وحدة
      const steps = Math.max(2, Math.floor(len / 0.7));
      for(let i=1; i<steps; i++){
        const t = i / steps;
        const px = a.x + dx*t, py = a.y + dy*t;
        pathHtml += `<line x1="${px+nx}" y1="${py+ny}" x2="${px-nx}" y2="${py-ny}" stroke="#1e8449" stroke-width="0.18" stroke-linecap="round"/>`;
      }
    });
    // ثعابين
    Object.entries(LAD_SNAKES).forEach(([from, to]) => {
      const a = ladCellCenter(+from);
      const b = ladCellCenter(+to);
      const mx = (a.x + b.x) / 2 + (Math.random() - 0.5) * 1.4;
      const my = (a.y + b.y) / 2 + (Math.random() - 0.5) * 1.4;
      // منحنى متموج (cubic)
      const c1x = a.x + (mx - a.x) * 0.5;
      const c1y = a.y + (b.y - a.y) * 0.2;
      const c2x = b.x - (b.x - mx) * 0.5;
      const c2y = b.y + (a.y - b.y) * 0.2;
      pathHtml += `<path d="M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}" fill="none" stroke="url(#snkGrad)" stroke-width="0.45" stroke-linecap="round" opacity="0.9"/>`;
      // رأس الثعبان
      pathHtml += `<circle cx="${a.x}" cy="${a.y}" r="0.4" fill="#e74c3c"/>`;
      // عيون الثعبان
      pathHtml += `<circle cx="${a.x-0.12}" cy="${a.y-0.1}" r="0.07" fill="#fff"/>`;
      pathHtml += `<circle cx="${a.x+0.12}" cy="${a.y-0.1}" r="0.07" fill="#fff"/>`;
    });
    lines.innerHTML = pathHtml;
    ladBoardBuilt = true;
  }

  // ----- Tokens -----
  function ladRenderTokens(){
    const wrap = document.getElementById('ladTokens');
    if(!wrap) return;
    wrap.innerHTML = '';
    // ضع كل قطعة كعنصر مطلق بالنسبة للوحة
    ladPlayers.forEach((p, i) => {
      const tok = document.createElement('div');
      tok.className = 'lad-token t' + i + (i === ladCurrent && !ladGameOver ? ' is-active' : '');
      tok.dataset.pid = p.id;
      // ضع القطعة حسب موقعها
      if(p.pos === 0){
        // مخفية في البداية
        tok.style.display = 'none';
      } else {
        const c = ladCellCenter(p.pos);
        // احسب الموضع بالنسبة للحاوي (نفس إحداثيات الـ SVG)
        tok.style.left = `calc(${c.x}% - 9px)`;
        tok.style.top  = `calc(${c.y}% - 9px)`;
        // قلل إزاحة القطع إن كانت متعددة على نفس الخلية
        const same = ladPlayers.filter(x => x.pos === p.pos);
        const idx = same.indexOf(p);
        if(same.length > 1){
          const offset = (idx - (same.length-1)/2) * 14;
          tok.style.transform = `translate(${offset}px, 0)`;
        }
        tok.title = p.name + ' — خلية ' + p.pos;
      }
      tok.textContent = (p.name || '?').charAt(0);
      wrap.appendChild(tok);
    });
  }

  // ----- Players UI -----
  function ladRenderPlayers(){
    const list = document.getElementById('ladPlayers');
    const count = document.getElementById('ladPlayerCount');
    if(!list) return;
    if(count) count.textContent = ladPlayers.length;
    list.innerHTML = '';
    ladPlayers.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'lad-player' + (i === ladCurrent && !ladGameOver ? ' is-current' : '') + (ladGameOver && ladPlayers[ladCurrent] === p ? ' is-winner' : '');
      const init = (p.name || '?').charAt(0);
      row.innerHTML = `
        <div class="lad-player-dot" style="background:${LAD_COLORS[i].gradient}">${escapeHtml(init)}</div>
        <div class="lad-player-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
        <div class="lad-player-pos">${p.pos === 0 ? 'بداية' : '📍 ' + p.pos}</div>
        <button class="lad-player-remove" data-pid="${p.id}" title="إزالة"><i class="fas fa-times"></i></button>`;
      list.appendChild(row);
    });
    list.querySelectorAll('.lad-player-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.pid;
        const idx = ladPlayers.findIndex(x => x.id === pid);
        if(idx >= 0){
          ladPlayers.splice(idx, 1);
          if(ladCurrent >= ladPlayers.length) ladCurrent = 0;
          ladRenderPlayers();
          ladRenderTokens();
          ladUpdateTurnLabel();
        }
      });
    });
    const addBtn = document.getElementById('ladAddPlayer');
    if(addBtn) addBtn.disabled = ladPlayers.length >= LAD_MAX_PLAYERS;
    const rollBtn = document.getElementById('ladRollBtn');
    if(rollBtn) rollBtn.disabled = ladPlayers.length < 2 || ladGameOver || ladRolling;
  }

  function ladUpdateTurnLabel(){
    const turn = document.getElementById('ladTurnName');
    if(!turn) return;
    if(ladPlayers.length === 0){ turn.textContent = 'دوري'; return; }
    const p = ladPlayers[ladCurrent];
    turn.textContent = p ? p.name : '—';
    const wrap = document.getElementById('ladTurn');
    if(wrap && p) wrap.style.background = LAD_COLORS[ladCurrent] ? LAD_COLORS[ladCurrent].gradient : '';
    else if(wrap) wrap.style.background = '';
    document.getElementById('ladRound').textContent = ladRound;
  }

  // ----- Player picker modal -----
  function ladOpenPlayersModal(){
    const overlay = document.getElementById('ladPlayersOverlay');
    const list = document.getElementById('ladStudentsList');
    if(!overlay || !list) return;
    const students = (typeof getStudents === 'function') ? getStudents() : [];
    if(students.length === 0){
      list.innerHTML = '<div style="text-align:center;padding:30px;color:#7a5a8a"><i class="fas fa-user-graduate" style="font-size:2rem;display:block;margin-bottom:10px;opacity:.4"></i><b>لا توجد طالبات مسجّلات</b><br><small>أضيفي طالبات أولاً من تبويب الطالبات</small></div>';
    } else {
      ladPickedStudents = new Set(ladPlayers.map(p => p.name));
      list.innerHTML = '';
      students.forEach((s, idx) => {
        const row = document.createElement('div');
        const isPicked = ladPickedStudents.has(s.name);
        const isFull = ladPlayers.length >= LAD_MAX_PLAYERS && !isPicked;
        const colorIdx = ladPlayers.findIndex(p => p.name === s.name);
        row.className = 'lad-student-row' + (isPicked ? ' is-picked' : '');
        if(isFull) row.style.opacity = '0.4';
        row.innerHTML = `
          <div class="ls-color" style="background:${isPicked ? LAD_COLORS[colorIdx >= 0 ? colorIdx : 0].gradient : '#e0e0e0'}"></div>
          <div class="ls-name">${escapeHtml(s.name)}</div>
          <div class="ls-pick">${isPicked ? '✓ مختارة' : '+ اختيار'}</div>`;
        row.addEventListener('click', () => {
          if(isPicked){
            // أزِليها
            ladPlayers = ladPlayers.filter(p => p.name !== s.name);
          } else {
            if(ladPlayers.length >= LAD_MAX_PLAYERS){
              ladSetStatus('⚠️ الحد الأقصى 4 لاعبات!', 'warn');
              return;
            }
            const colorIdx = ladPlayers.length;
            ladPlayers.push({
              id: 'p_' + Date.now() + '_' + idx,
              name: s.name,
              pos: 0,
              correct: 0,
              ladders: 0,
              color: colorIdx
            });
          }
          ladOpenPlayersModal(); // أعد الرسم
        });
        list.appendChild(row);
      });
    }
    overlay.classList.add('active');
  }

  function ladClosePlayersModal(){
    const overlay = document.getElementById('ladPlayersOverlay');
    if(overlay) overlay.classList.remove('active');
    ladRenderPlayers();
    ladRenderTokens();
    ladUpdateTurnLabel();
    if(ladPlayers.length >= 2){
      ladSetStatus(`🎲 دور ${ladPlayers[ladCurrent].name} — ارمي النرد!`, '');
    } else {
      ladSetStatus('🎲 أضيفي لاعبتين على الأقل وابدئي اللعب', '');
    }
  }

  // ----- Dice -----
  function ladShowDice(v){
    const dice = document.getElementById('ladDice');
    if(!dice) return;
    dice.dataset.v = v;
  }

  function ladRollDice(){
    if(ladRolling || ladGameOver) return;
    if(ladPlayers.length < 2){
      ladSetStatus('⚠️ تحتاجين لاعبتين على الأقل!', 'warn');
      return;
    }
    const currentPlayer = ladPlayers[ladCurrent];
    if(!currentPlayer){ ladCurrent = 0; return; }
    ladRolling = true;
    const dice = document.getElementById('ladDice');
    if(dice) dice.classList.add('rolling');
    // أنيميشن سريع للنرد
    let ticks = 0;
    const animInt = setInterval(() => {
      ladShowDice(1 + Math.floor(Math.random() * 6));
      ticks++;
    }, 70);
    setTimeout(() => {
      clearInterval(animInt);
      const v = 1 + Math.floor(Math.random() * 6);
      ladShowDice(v);
      if(dice) dice.classList.remove('rolling');
      ladRolling = false;
      ladHandleMove(v);
    }, 750);
  }

  // ----- Movement -----
  function ladHandleMove(steps){
    const player = ladPlayers[ladCurrent];
    if(!player) return;
    let target = player.pos + steps;
    if(target > LAD_BOARD_SIZE){
      // يجب أن يرقى بالضبط — يرتد للخلف
      target = LAD_BOARD_SIZE - (target - LAD_BOARD_SIZE);
      ladSetStatus(`⚠️ ${player.name} تجاوزت 100 — ترجعت إلى ${target}`, 'warn');
    }
    ladSetStatus(`🎲 ${player.name} رمى ${steps} — ينتقل إلى ${target}`, '');
    player.pos = target;
    ladRenderTokens();
    setTimeout(() => {
      // تحقّق من سلّم/ثعبان/سؤال
      if(target === LAD_BOARD_SIZE){
        ladWin();
      } else if(LAD_LADDERS[target]){
        const upTo = LAD_LADDERS[target];
        ladSetStatus(`🪜 ${player.name} صعد السلم من ${target} إلى ${upTo}!`, '');
        player.pos = upTo;
        player.ladders++;
        ladLaddersClimbed++;
        try{ if(typeof gameToast === 'function') gameToast('🪜', `${player.name} صعد سلماً!`, 'success'); }catch(e){}
        ladRenderTokens();
        setTimeout(ladNextTurn, 800);
      } else if(LAD_SNAKES[target]){
        const downTo = LAD_SNAKES[target];
        ladSetStatus(`🐍 ${player.name} انزلق بثعبان من ${target} إلى ${downTo}!`, 'warn');
        player.pos = downTo;
        try{ if(typeof gameToast === 'function') gameToast('🐍', `${player.name} انزلقت بثعبان!`, 'gold'); }catch(e){}
        ladRenderTokens();
        setTimeout(ladNextTurn, 900);
      } else if(LAD_Q_CELLS.has(target)){
        ladAskQuestion(target, () => ladNextTurn());
      } else {
        setTimeout(ladNextTurn, 500);
      }
    }, 600);
  }

  function ladNextTurn(){
    ladCurrent = (ladCurrent + 1) % ladPlayers.length;
    if(ladCurrent === 0) ladRound++;
    ladRenderPlayers();
    ladRenderTokens();
    ladUpdateTurnLabel();
  }

  // ----- Question popup -----
  function ladAskQuestion(cell, afterCallback){
    const all = (typeof QBank !== 'undefined' && QBank.all) ? QBank.all() : [];
    if(all.length === 0){
      ladSetStatus('⚠️ لا توجد أسئلة في البنك! أضيفي أسئلة أولاً.', 'warn');
      setTimeout(afterCallback, 1200);
      return;
    }
    const q = all[Math.floor(Math.random() * all.length)];
    ladCurrentQ = {q, cell, after: afterCallback, player: ladPlayers[ladCurrent]};
    const overlay = document.getElementById('ladQuestionOverlay');
    document.getElementById('ladQuestionBigEmoji').textContent = '❓';
    document.getElementById('ladQuestionHeadTitle').textContent = (ladCurrentQ.player?.name || 'اللاعبة') + ' — سؤالك!';
    document.getElementById('ladQuestionText').textContent = q.text || '—';
    const optsEl = document.getElementById('ladQuestionOpts');
    optsEl.innerHTML = '';
    const letters = ['أ','ب','ج','د','هـ','و','ز','ح'];
    (q.options || []).forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'bs-q-opt';
      btn.innerHTML = `<span class="bs-q-opt-letter">${letters[i] || (i+1)}</span><span>${escapeHtml(opt)}</span>`;
      btn.addEventListener('click', () => ladAnswerQuestion(i));
      optsEl.appendChild(btn);
    });
    const resultEl = document.getElementById('ladQuestionResult');
    resultEl.className = 'bs-q-result';
    resultEl.style.display = 'none';
    resultEl.innerHTML = '';
    overlay.classList.add('active');
  }

  function ladAnswerQuestion(idx){
    if(!ladCurrentQ) return;
    const resultEl = document.getElementById('ladQuestionResult');
    const opts = document.querySelectorAll('#ladQuestionOpts .bs-q-opt');
    opts.forEach((b, i) => {
      b.disabled = true;
      if(i === ladCurrentQ.q.correct) b.classList.add('correct');
      else if(i === idx && i !== ladCurrentQ.q.correct) b.classList.add('wrong');
    });
    const correct = idx === ladCurrentQ.q.correct;
    resultEl.className = 'bs-q-result ' + (correct ? 'ok' : 'bad') + ' show';
    if(correct){
      resultEl.innerHTML = '✅ إجابة صحيحة! +1 مكافأة';
      ladCorrect++;
      if(ladCurrentQ.player) ladCurrentQ.player.correct++;
      // مكافأة: تقدّم خطوة إضافية
      if(ladCurrentQ.player){
        const p = ladCurrentQ.player;
        if(p.pos < LAD_BOARD_SIZE) p.pos = Math.min(LAD_BOARD_SIZE, p.pos + 1);
        ladRenderTokens();
      }
      try{ if(typeof gameToast === 'function') gameToast('✅','إجابة صحيحة! +1 مكافأة','success'); }catch(e){}
    } else {
      const correctTxt = (ladCurrentQ.q.options || [])[ladCurrentQ.q.correct] || '';
      resultEl.innerHTML = '❌ الإجابة الصحيحة: ' + escapeHtml(correctTxt) + '<br><small>سيتم خصم خطوة</small>';
      // عقوبة: تراجعي خطوة
      if(ladCurrentQ.player){
        const p = ladCurrentQ.player;
        if(p.pos > 1) p.pos -= 1;
        ladRenderTokens();
      }
      try{ if(typeof gameToast === 'function') gameToast('❌','إجابة خاطئة','gold'); }catch(e){}
    }
    // سجّلي استخدام السؤال
    try{ if(typeof QBank !== 'undefined' && QBank.use) QBank.use(ladCurrentQ.q.id); }catch(e){}
    // بعد ثانيتين: أغلق وكمّل
    setTimeout(() => {
      ladCloseQuestion(true);
    }, 1800);
  }

  function ladCloseQuestion(advance){
    const overlay = document.getElementById('ladQuestionOverlay');
    if(overlay) overlay.classList.remove('active');
    const cb = ladCurrentQ?.after;
    ladCurrentQ = null;
    if(advance && typeof cb === 'function'){
      // بعد خصم/مكافأة الخلية، تحقّق من فوز
      const p = ladPlayers[ladCurrent];
      if(p && p.pos === LAD_BOARD_SIZE){ ladWin(); return; }
      cb();
    }
  }

  // ----- Victory -----
  function ladWin(){
    ladGameOver = true;
    const winner = ladPlayers[ladCurrent];
    ladRenderPlayers();
    ladRenderTokens();
    document.getElementById('ladWinner').textContent = winner?.name || '—';
    document.getElementById('ladVictoryName').textContent = (winner?.name || '—') + ' فازت بالسباق! 🏆';
    document.getElementById('ladVRounds').textContent = ladRound;
    document.getElementById('ladVCorrect').textContent = ladCorrect;
    document.getElementById('ladVLadders').textContent = ladLaddersClimbed;
    const ov = document.getElementById('ladVictoryOverlay');
    if(ov) ov.classList.add('active');
    try{ if(typeof gameConfetti === 'function') gameConfetti(60); }catch(e){}
    try{ if(typeof gameToast === 'function') gameToast('🏆',`${winner?.name || ''} فازت! مبروك!`,'gold'); }catch(e){}
    try{ if(typeof playSuccess === 'function') playSuccess(); }catch(e){}
    const rollBtn = document.getElementById('ladRollBtn');
    if(rollBtn) rollBtn.disabled = true;
  }

  function ladResetGame(){
    // أبقِ على اللاعبات، لكن أصفري المواقع
    ladPlayers.forEach(p => { p.pos = 0; p.correct = 0; p.ladders = 0; });
    ladCurrent = 0;
    ladRound = 1;
    ladCorrect = 0;
    ladLaddersClimbed = 0;
    ladGameOver = false;
    const ov = document.getElementById('ladVictoryOverlay');
    if(ov) ov.classList.remove('active');
    const ovQ = document.getElementById('ladQuestionOverlay');
    if(ovQ) ovQ.classList.remove('active');
    document.getElementById('ladWinner').textContent = '—';
    ladRenderPlayers();
    ladRenderTokens();
    ladUpdateTurnLabel();
    ladSetStatus(`🎲 دور ${ladPlayers[0]?.name || '—'} — ارمي النرد!`, '');
  }

  // ----- Init -----
  function ladInit(){
    if(!ladBoardBuilt) ladBuildBoard();
    ladUpdateSourceLabel();
    ladRenderPlayers();
    ladRenderTokens();
    ladUpdateTurnLabel();
    ladShowDice(1);
    if(ladPlayers.length < 2){
      ladSetStatus('🎲 أضيفي لاعبتين على الأقل وابدئي اللعب', '');
    }
  }

  // ----- Bindings -----
  function bindLaddersUI(){
    document.getElementById('ladAddPlayer')?.addEventListener('click', ladOpenPlayersModal);
    document.getElementById('ladPlayersCloseBtn')?.addEventListener('click', ladClosePlayersModal);
    document.getElementById('ladPlayersCancelBtn')?.addEventListener('click', ladClosePlayersModal);
    document.getElementById('ladPlayersOkBtn')?.addEventListener('click', ladClosePlayersModal);
    document.getElementById('ladRollBtn')?.addEventListener('click', ladRollDice);
    document.getElementById('ladResetBtn')?.addEventListener('click', () => {
      if(ladPlayers.length === 0){ ladSetStatus('لا يوجد لاعبون لتصفيرهم', 'warn'); return; }
      if(confirm('هل تريدين بداية جديدة؟ ستبقى اللاعبات لكن المواقع ستصفر.')) ladResetGame();
    });
    document.getElementById('ladGoQBank')?.addEventListener('click', () => switchTab('questions'));
    document.getElementById('ladVictoryCloseBtn')?.addEventListener('click', () => {
      document.getElementById('ladVictoryOverlay').classList.remove('active');
      ladResetGame();
    });
    document.getElementById('ladQuestionCloseBtn')?.addEventListener('click', () => {
      // إغلاق = إجابة خاطئة
      if(!ladCurrentQ) return;
      ladAnswerQuestion(-1);
    });
    // انقري على النرد = رمي
    document.getElementById('ladDice')?.addEventListener('click', ladRollDice);
    // Escape لإغلاق
    document.addEventListener('keydown', (e) => {
      if(e.key !== 'Escape') return;
      const v = document.getElementById('ladVictoryOverlay');
      const q = document.getElementById('ladQuestionOverlay');
      const p = document.getElementById('ladPlayersOverlay');
      if(v && v.classList.contains('active')){ v.classList.remove('active'); ladResetGame(); }
      else if(q && q.classList.contains('active')){ /* don't close question via escape — prevents accidents */ }
      else if(p && p.classList.contains('active')){ ladClosePlayersModal(); }
    });
    // Backdrop click
    document.getElementById('ladPlayersOverlay')?.addEventListener('click', (e) => {
      if(e.target === e.currentTarget) ladClosePlayersModal();
    });
  }

  bindLaddersUI();
  ladInit();

  // حدّث عند تغيّر البنك
  try{
    if(typeof QBank !== 'undefined' && QBank.subscribe){
      QBank.subscribe(() => ladUpdateSourceLabel());
    }
  }catch(e){}

  console.log('%c🎮 Games Hub: تم تحميل 8 ألعاب تشجيعية للطالبات (بما فيها بامبوزل، البارجة، وسلّم الأبطال)','color:#ff6b9d;font-size:13px;font-weight:bold');

})();
/* ============================================================
   ⭐ GAMES REMOTE — مساعدات عامة لربط مركز الألعاب بـ LiveBus
   (دوال عامة — يمكن استدعاؤها من أي مكان في الصفحة)
   ============================================================ */

// ⭐ حدّث شارة "مباشر للطالبات" في رأس مركز الألعاب حسب حالة الجلسة
function updateGamesLiveBadge(){
  const badge = document.getElementById('gamesLiveBadge');
  if(!badge) return;
  const on = (typeof liveBroadcasting !== 'undefined' && liveBroadcasting)
          && (typeof liveNtfyTopic !== 'undefined' && !!liveNtfyTopic);
  badge.style.display = on ? 'inline-flex' : 'none';
  if(on){
    badge.title = 'الألعاب مفعّلة عن بُعد — الطالبات على جوالاتهن يقدروا يشاركوا';
  }
}

// ⭐ إشعار المعلمة بأن طالبة ضغطت من جوالها في تحدي السرعة
let _speedRemoteToastTimer = null;
function showSpeedRemoteToast(text){
  const el = document.getElementById('speedRemoteToast');
  const txt = document.getElementById('speedRemoteToastText');
  if(!el || !txt) return;
  txt.textContent = text || 'طالبة ضغطت من جوالها';
  el.classList.add('show');
  if(_speedRemoteToastTimer) clearTimeout(_speedRemoteToastTimer);
  _speedRemoteToastTimer = setTimeout(()=>{
    el.classList.remove('show');
  }, 2500);
}

// ⭐ اربط: عند ورود ضغطة من طالبة (games:speed:tap) — اعرضي إشعار المعلمة
// الـ score handling الفعلي يحدث داخل الـ IIFE للمركز الألعاب (يحتاج الوصول للمتغيرات الداخلية).
// هنا فقط نعرض الإشعار البصري للمعلمة بأن النقرة وصلت.
LiveBus.on('games:speed:tap', (data)=>{
  if(!data || !data.name) return;
  // لو المركز مفتوح، الـ handler الداخلي سيعالج النقاط ونحتاج فقط إشعار بسيط
  // لو المركز مغلق، نظهر إشعار بارز على الشاشة
  const gamesOpen = document.getElementById('gamesOverlay')?.classList.contains('active');
  if(!gamesOpen){
    showSpeedRemoteToast(`📱 ${data.name} ضغطت من جوالها!`);
  } else {
    // خفيف: لا نزعج المعلمة بإشعار كبير — يكفي ما يحدث داخل المركز
  }
});

console.log('%c📡 LiveBus + Games Remote: تم التفعيل','color:#1a5f7a;font-size:12px;font-weight:bold');
console.log('%c🌟 سبورة المعرفة التفاعلية — الإصدار المحسّن 2026','color:#c84b31;font-size:13px;font-weight:bold');
console.log('%c💡 نصيحة: لتجربة وضع الطالبة، افتحي الرابط في نافذة خاصة وأضيفي ?mode=poll&code=ABC123&topic=test','color:#666;font-size:11px');

/* ⭐ إخفاء شاشة التحميل بعد جاهزية الصفحة */
(function(){
  function hideLoading(){
    const el = document.getElementById('appLoading');
    if(el){
      el.classList.add('hidden');
      setTimeout(()=>{ if(el.parentNode) el.parentNode.removeChild(el); }, 600);
    }
  }
  if(document.readyState === 'complete'){
    setTimeout(hideLoading, 300);
  } else {
    window.addEventListener('load', ()=> setTimeout(hideLoading, 300));
  }
  // أمان: إخفاء قسري بعد 5 ثوانٍ حتى لو في خطأ
  setTimeout(hideLoading, 5000);
})();

/* ⭐ showToast() محسّن — يستخدم الـ container المركزي إن وُجد */
window.showToast = function(msg, type, duration){
  type = type || 'info';
  duration = duration || 3500;
  const container = document.getElementById('toastContainer');
  if(!container){
    // fallback للدالة الأصلية
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(()=> t.remove(), duration);
    return;
  }
  const icons = {success:'check-circle', error:'times-circle', warning:'exclamation-triangle', info:'info-circle'};
  const t = document.createElement('div');
  t.className = 'toast-item ' + type;
  t.innerHTML = '<i class="fas fa-' + (icons[type] || 'info-circle') + '"></i><span>' + String(msg).replace(/</g,'&lt;') + '</span>';
  container.appendChild(t);
  setTimeout(()=>{
    t.classList.add('fade-out');
    setTimeout(()=> t.remove(), 300);
  }, duration);
};
