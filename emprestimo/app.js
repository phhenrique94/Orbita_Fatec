// ================================================================
//  ÓRBITA — MÓDULO EMPRÉSTIMO
//  Firebase Firestore + Auth Guard
// ================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAnalytics }  from "https://www.gstatic.com/firebasejs/10.9.0/firebase-analytics.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDocs, onSnapshot, getDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

import { firebaseConfig } from "../core/firebase-config.js";
import { setupLayout } from "../core/layout.js";
import { escapeHTML as esc } from "../core/security.js";

const fbApp  = initializeApp(firebaseConfig);
const analytics = getAnalytics(fbApp);
const auth   = getAuth(fbApp);
const db     = getFirestore(fbApp);

const API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.')) 
  ? `http://${window.location.hostname}:3000/api` 
  : '/api';

async function apiFetch(endpoint, options = {}) {
  const token = await currentUser.getIdToken();
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  if (!res.ok) throw new Error(`Erro na API: ${res.status}`);
  return res.json();
}


// ---- Constants ----
const SALAS = [
  "LAB SOLOS","LAB-INF20","LAB. SEMIO","LF-MED","LAB. ARQ",
  "M.A. 1","M.A. 2","1","2","3","4","5","6","7","9","10",
  "13","21","22","23","24","25","26","27","28","29","30",
  "31","32","33","34","35","36","37"
];

let notebooksDB = [];
let currentUser  = null;

// ================================================================
//  DETECT WHICH PAGE WE ARE ON
// ================================================================
const isDashboard   = !!document.getElementById('notebook-grid');
const isMovimentar  = !!document.getElementById('movimentacao-form');

// ---- Auth Guard ----
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    document.getElementById('auth-guard').classList.remove('hidden');
    const loginWrapper = document.getElementById('login-wrapper');
    if (loginWrapper) {
      document.getElementById('auth-loading').classList.add('hidden');
      loginWrapper.classList.remove('hidden');
      
      const loginForm = document.getElementById('login-form-movimentar');
      if (loginForm) {
        loginForm.onsubmit = async (e) => {
          e.preventDefault();
          const em = document.getElementById('login-email-mov').value;
          const pw = document.getElementById('login-pw-mov').value;
          const btn = loginForm.querySelector('button');
          btn.textContent = 'Autenticando...';
          btn.disabled = true;
          try {
            await signInWithEmailAndPassword(auth, em, pw);
            // onAuthStateChanged will naturally fire again and hide the modal
          } catch (err) {
            alert('Erro ao fazer login: ' + err.message);
            btn.textContent = 'Entrar e Movimentar';
            btn.disabled = false;
          }
        };
      }
    } else {
      if (!isMovimentar) window.location.href = '../meu-espaco/index.html';
    }
    return;
  }
  document.getElementById('auth-guard').classList.add('hidden');
  currentUser = user;

  // Set avatar initial - Prioritiza o nome cadastrado no Perfil do Firebase
  const userName = user.displayName || user.email.split('@')[0];
  const av       = document.getElementById('header-avatar');
  const nameEl   = document.getElementById('user-name-display');
  if (av) av.textContent = userName.charAt(0).toUpperCase();
  if (nameEl) nameEl.textContent = userName;

  // Buscar Papel (Role) via API
  let role = 'visitante';
  try {
    const userData = await apiFetch('/usuarios/me');
    role = userData.role || 'visitante';
  } catch (err) {}

  const roleBadge = document.getElementById('role-badge');

  // Buscar Permissões Globais via API
  let perms = { view: false, execute: false };
  try {
    const allPerms = await apiFetch('/usuarios/config/permissions');
    perms = allPerms[role]?.emprestimo || { view: false, execute: false };
  } catch (err) {
    // Falha silenciosa para segurança
  }

  if (roleBadge) {
    roleBadge.textContent = (role === 'adm_l1' ? 'ADM N1' : (role === 'adm_l2' ? 'ADM N2' : role.toUpperCase()));
    if (role === 'adm_l1' || role === 'adm_l2') {
      roleBadge.style.background = 'rgba(235, 112, 37, 0.1)';
      roleBadge.style.color = 'var(--orange)';
    } else {
      roleBadge.style.background = 'rgba(124, 58, 237, 0.1)';
      roleBadge.style.color = 'var(--purple-bright)';
    }
  }

  // Verifica se pode VER o módulo
  if (role !== 'adm_l1' && !perms.view) {
    window.location.href = '../meu-espaco/index.html';
    return;
  }

  // Se não puder EXECUTAR, esconde botões globais
  if (role !== 'adm_l1' && !perms.execute) {
    document.body.classList.add('hide-execute');
  }

  // Esconde o bloqueio se estiver logado
  const guard = document.getElementById('auth-guard');
  if (guard) guard.classList.add('hidden');
  
  setupLayout(user, role, 'emprestimo', async () => {
    await signOut(auth);
    window.location.href = '../auth/login.html';
  });

  await loadNotebooks();

  if (isDashboard)  initDashboard();
  if (isMovimentar) initMovimentar();
});

// ================================================================
//  DATA LOADING
// ================================================================
async function loadNotebooks() {
  try {
    notebooksDB = await apiFetch('/emprestimos');
  } catch (err) {
    console.error("Erro ao buscar da API:", err);
  }
}

function fmt(iso) {
  return new Date(iso).toLocaleString('pt-BR',{ day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ================================================================
//  DASHBOARD
// ================================================================
function initDashboard() {
  const mainEl  = document.getElementById('dashboard-view');
  mainEl.classList.remove('hidden');

  // Populate sala filter
  const selSala = document.getElementById('filter-sala');
  SALAS.forEach(s => { const o=document.createElement('option'); o.value=s; o.textContent=s; selSala.appendChild(o); });

  renderGrid(notebooksDB);

  // Polling via API REST para simular realtime
  setInterval(async () => {
    try {
      notebooksDB = await apiFetch('/emprestimos');
      applyFilters();
    } catch(err) {}
  }, 5000);

  // Filters
  document.getElementById('search-input').addEventListener('input',  applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-local').addEventListener('change',  applyFilters);
  document.getElementById('filter-sala').addEventListener('change',   applyFilters);

  // Grid click delegation
  const grid = document.getElementById('notebook-grid');

  grid.addEventListener('click', async (e) => {
    // Lock button
    const lockBtn = e.target.closest('.btn-lock');
    if (lockBtn) {
      const id   = lockBtn.dataset.id;
      const note = notebooksDB.find(n => n.id === id);
      if (!note) return;
      if (note.status === 'reservado') {
        if (confirm(`Deseja LIBERAR o ${id}? Ele voltará para Guardado.`)) {
          note.status='guardado'; note.observacao=''; note.updatedAt=new Date().toISOString();
          await apiFetch(`/emprestimos/${id}`, { method: 'PUT', body: JSON.stringify(note) });
          applyFilters(); // Atualiza UI rapidamente
        }
      } else {
        document.getElementById('reserva-notebook-id').value = id;
        document.getElementById('reserva-subtitle').textContent = `Reservando ${id}`;
        document.getElementById('modal-reserva').classList.add('active');
      }
      return;
    }
    // QR button
    const qrBtn = e.target.closest('.btn-qr');
    if (qrBtn) { abrirQR(qrBtn.dataset.id); }
  });

  // Reserva form
  document.getElementById('form-reserva').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id     = document.getElementById('reserva-notebook-id').value;
    const dia    = document.getElementById('reserva-dia').value;
    const motivo = document.getElementById('reserva-motivo').value;
    const note   = notebooksDB.find(n => n.id === id);
    if (!note) return;
    note.status='reservado'; note.observacao=motivo; note.updatedAt=new Date().toISOString();
    await apiFetch(`/emprestimos/${id}`, { method: 'PUT', body: JSON.stringify(note) });
    applyFilters();
    fecharModalReserva();
  });

  // QR modal buttons
  const qrC = document.getElementById('qr-modal');
  document.getElementById('btn-imprimir-qr').addEventListener('click', () => window.print());
  document.getElementById('btn-baixar-qr').addEventListener('click', () => {
    let sourceElement = document.querySelector('#qr-code-canvas canvas');
    if (!sourceElement || sourceElement.style.display === 'none') {
      sourceElement = document.querySelector('#qr-code-canvas img');
    }
    
    if (sourceElement) {
      const notebookId = document.getElementById('qr-label-name').textContent;
      const compCanvas = document.createElement('canvas');
      const ctx = compCanvas.getContext('2d');
      
      const qrSize = 200; 
      const padding = 20;
      const textHeight = 40;
      
      compCanvas.width = qrSize + (padding * 2);
      compCanvas.height = qrSize + (padding * 2) + textHeight;
      
      // Fundo branco
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, compCanvas.width, compCanvas.height);
      
      try {
        // Desenha o QR
        ctx.drawImage(sourceElement, padding, padding, qrSize, qrSize);
        
        // Desenha o nome do notebook
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(notebookId, compCanvas.width / 2, compCanvas.height - padding - 5);
        
        // Dispara o download
        const a = document.createElement('a');
        a.href = compCanvas.toDataURL('image/png');
        a.download = `${notebookId}_etiqueta.png`;
        a.click();
      } catch (err) {
        console.error("Erro ao gerar a etiqueta:", err);
      }
    }
  });
}

window.fecharModalReserva = function() {
  document.getElementById('modal-reserva').classList.remove('active');
  document.getElementById('form-reserva').reset();
};

function applyFilters() {
  const s   = document.getElementById('search-input').value.toLowerCase();
  const st  = document.getElementById('filter-status').value;
  const loc = document.getElementById('filter-local').value;
  const sa  = document.getElementById('filter-sala').value;
  const filtered = notebooksDB.filter(n => {
    if (s && !n.id.toLowerCase().includes(s)) return false;
    if (st !== 'Todos' && n.status !== st) return false;
    if (loc !== 'Todos') { if (n.status !== 'guardado' || n.local !== loc) return false; }
    if (sa !== 'Todos')  { if (n.status !== 'emprestado' || n.sala !== sa) return false; }
    return true;
  });
  renderGrid(filtered);
}

function renderGrid(list) {
  const grid = document.getElementById('notebook-grid');
  grid.innerHTML = '';

  // Stats
  const count = { guardado:0, emprestado:0, cedido:0, reservado:0 };
  notebooksDB.forEach(n => { if(count[n.status] !== undefined) count[n.status]++; });
  
  const elT = document.getElementById('stat-total');
  const elG = document.getElementById('stat-guardado');
  const elE = document.getElementById('stat-emprestado');
  const elC = document.getElementById('stat-cedido');
  const elR = document.getElementById('stat-reservado');

  if(elT) elT.textContent = notebooksDB.length;
  if(elG) elG.textContent = count.guardado;
  if(elE) elE.textContent = count.emprestado;
  if(elC) elC.textContent = count.cedido;
  if(elR) elR.textContent = count.reservado;
  
  const elGC = document.getElementById('grid-count');
  if(elGC) elGC.textContent = `${list.length} ite${list.length===1?'m':'ns'}`;

  if (!list.length) {
    grid.innerHTML = `<p style="color:var(--text-muted);padding:2rem;grid-column:1/-1;text-align:center;">Nenhum equipamento encontrado.</p>`;
    return;
  }

  list.forEach(n => {
    const card = document.createElement('div');
    card.className = 'notebook-card';
    card.style.borderTop = `4px solid var(--c-${n.status})`;

    const updateStr = n.updatedAt ? new Date(n.updatedAt).toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'}) + ', ' + new Date(n.updatedAt).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : '---';

    card.innerHTML = `
      <div class="card-header">
        <div style="display:flex; align-items:center; gap:0.5rem">
          <span class="card-id">${esc(n.id)}</span>
          <span class="badge badge-${n.status}">${esc(n.status.toUpperCase())}</span>
        </div>
        <button class="btn-lock action-execute ${n.status==='reservado'?'active':''}" data-id="${n.id}" title="${n.status==='reservado'?'Liberar':'Reservar'}" style="background:none; border:none; color:var(--text-muted); cursor:pointer; padding:5px; display:flex; align-items:center; transition:0.2s">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </button>
      </div>
      
      <div class="card-detail">
        <span>${
          n.status === 'emprestado' ? `🏫 Sala ${esc(n.sala)}` :
          n.status === 'cedido'     ? `👤 ${esc(n.funcionario)} — ${esc(n.setor)}` :
          n.status === 'reservado'  ? `🔒 ${esc(n.observacao || 'Reservado')}` :
          `📦 ${esc(n.local || 'T.I.')}`
        }</span>
      </div>

      <div class="card-footer">
        <span>🕒 ${updateStr}</span>
        <span style="font-weight:700; color:var(--purple-bright)">👤 ${esc(n.responsavel || '---')}</span>
      </div>

        <div class="card-actions">
          <a href="movimentar.html?id=${n.id}" class="btn btn-secondary action-execute">Movimentar</a>
          <button class="btn btn-secondary btn-qr action-execute" data-id="${n.id}" style="opacity:0.4; font-size:0.75rem">GERAR QR</button>
        </div>
    `;
    grid.appendChild(card);
  });
}

function abrirQR(id) {
  const label = document.getElementById('qr-label-name');
  if (label) label.textContent = id;
  const container = document.getElementById('qr-code-canvas');
  container.innerHTML = '';
  const base = window.location.href.split('emprestimo/')[0];
  const url  = `${base}emprestimo/movimentar.html?id=${id}`;
  new QRCode(container, { text:url, width:200, height:200, correctLevel: QRCode.CorrectLevel.H });
  document.getElementById('qr-modal').classList.add('active');
}

// ================================================================
//  MOVIMENTAR (MOBILE FORM)
// ================================================================
function initMovimentar() {
  const mainEl = document.getElementById('emprestimo-main-section');
  mainEl.classList.remove('hidden');

  const urlParams  = new URLSearchParams(window.location.search);
  const notebookId = urlParams.get('id') || notebooksDB[0]?.id;
  const isManage   = urlParams.get('manage') === 'true';

  let noteObj = notebooksDB.find(n => n.id === notebookId) || notebooksDB[0];

  function updateHeader(n) {
    if (!n) return;
    const nameEl = document.getElementById('notebook-name');
    const badgeEl = document.getElementById('current-status-badge');
    const updateEl = document.getElementById('last-update');
    const alertBox = document.getElementById('reservation-alert');

    if (nameEl) nameEl.textContent = n.id;
    if (badgeEl) {
      badgeEl.textContent = n.status.toUpperCase();
      badgeEl.className = `badge badge-${n.status}`;
    }
    
    let extra = '';
    if (n.status==='emprestado') extra = `(${n.sala})`;
    if (n.status==='cedido')     extra = `(${n.funcionario})`;
    if (n.status==='reservado')  extra = `(Reservado)`;
    
    const updateStr = n.updatedAt ? new Date(n.updatedAt).toLocaleDateString('pt-BR') : '---';
    if (updateEl) updateEl.textContent = `${updateStr} ${extra}`;

    if (alertBox) {
      if (n.status === 'reservado') {
        alertBox.classList.remove('hidden');
        const msgEl = document.getElementById('reservation-msg');
        if (msgEl) msgEl.textContent = n.observacao || 'Reservado pela T.I.';
        
        const modal = document.getElementById('reserved-locked-modal');
        if (modal) {
           const lMsg = document.getElementById('locked-reservation-msg');
           if (lMsg) lMsg.textContent = n.observacao || 'Sem motivo especificado.';
           modal.classList.add('active');
        }
      } else {
        alertBox.classList.add('hidden');
        const modal = document.getElementById('reserved-locked-modal');
        if (modal) modal.classList.remove('active');
      }
    }
  }

  updateHeader(noteObj);

  // Polling listener via API para o equipamento atual (Reduzido para economizar recursos do servidor)
  setInterval(async () => {
    try {
      const data = await apiFetch(`/emprestimos/${notebookId}`);
      noteObj = data; 
      updateHeader(noteObj);
    } catch(err) {}
  }, 30000);

  // Dynamic fields
  const radios   = document.querySelectorAll('input[name="status"]');
  const dynFields= document.getElementById('dynamic-fields');

  function renderFields(status) {
    dynFields.innerHTML = '';
    if (status==='guardado') {
      dynFields.innerHTML=`<div class="form-group"><label class="form-label">Local <span style="color:red">*</span></label><select class="form-control" name="local" required><option value="" disabled selected>Selecione</option><option>Carrinho</option><option>T.I.</option></select></div>`;
    } else if (status==='emprestado') {
      const opts = SALAS.map(s=>`<option value="${s}">`).join('');
      dynFields.innerHTML=`
        <div class="form-group">
          <label class="form-label">Sala <span style="color:red">*</span></label>
          <input type="text" class="form-control" name="sala" list="salas-list" placeholder="Busque a sala..." required autocomplete="off">
          <datalist id="salas-list">${opts}</datalist>
        </div>
        <div class="form-group">
          <label class="form-label">Nome do Requerente <span style="color:red">*</span></label>
          <input type="text" class="form-control" name="requerente" placeholder="Quem está retirando..." required>
        </div>
      `;
    } else if (status==='cedido') {
      dynFields.innerHTML=`<div class="form-group"><label class="form-label">Funcionário <span style="color:red">*</span></label><input type="text" class="form-control" name="funcionario" placeholder="Ex: João da Silva" required></div><div class="form-group"><label class="form-label">Setor <span style="color:red">*</span></label><input type="text" class="form-control" name="setor" placeholder="Ex: Secretaria" required></div>`;
    }
  }

  // Pre-select current status
  const cur = Array.from(radios).find(r => r.value === noteObj?.status);
  if (cur) cur.checked = true;
  renderFields(noteObj?.status || 'guardado');

  radios.forEach(r => r.addEventListener('change', e => renderFields(e.target.value)));

  // Submit
  document.getElementById('movimentacao-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    btn.textContent = 'Salvando...'; btn.disabled = true;

    const fd      = new FormData(e.target);
    const status  = fd.get('status');
    const userName= currentUser.displayName || currentUser.email.split('@')[0];

    noteObj.status      = status;
    noteObj.responsavel = userName;
    noteObj.updatedAt   = new Date().toISOString();
    noteObj.observacao  = fd.get('observacao') || '';
    noteObj.local=''; noteObj.sala=''; noteObj.funcionario=''; noteObj.setor=''; noteObj.requerente='';

    let sumHtml = `Status: <b>${status.charAt(0).toUpperCase()+status.slice(1)}</b><br>`;
    if (status==='guardado')   { noteObj.local=fd.get('local'); sumHtml+=`Local: <b>${noteObj.local}</b>`; }
    if (status==='emprestado') { 
      noteObj.sala=fd.get('sala'); 
      noteObj.requerente=fd.get('requerente'); 
      sumHtml+=`Sala: <b>${noteObj.sala}</b><br>Requerente: <b>${noteObj.requerente}</b>`; 
    }
    if (status==='cedido')     { noteObj.funcionario=fd.get('funcionario'); noteObj.setor=fd.get('setor'); sumHtml+=`Funcionário: <b>${noteObj.funcionario}</b><br>Setor: <b>${noteObj.setor}</b>`; }

    await apiFetch(`/emprestimos/${noteObj.id}`, { method: 'PUT', body: JSON.stringify(noteObj) });

    btn.textContent='Confirmar Mudança'; btn.disabled=false;
    
    const mTitle = document.getElementById('modal-title');
    const mDesc  = document.getElementById('modal-desc');
    const mSum   = document.getElementById('modal-summary');
    
    if (mTitle) mTitle.textContent = 'Atualizado!';
    if (mDesc)  mDesc.textContent  = `${noteObj.id} registrado com sucesso.`;
    if (mSum)   mSum.innerHTML     = sumHtml;

    document.getElementById('success-modal').classList.add('active');
  });
}

// ----------------------------------------------------------------
//  Scanner (global — used in both pages)
// ----------------------------------------------------------------
let scannerInstance = null;

window.abrirScanner = function() {
  document.getElementById('success-modal')?.classList.remove('active');
  document.getElementById('reserved-locked-modal')?.classList.remove('active');
  document.getElementById('scanner-modal').classList.add('active');

  scannerInstance = new Html5Qrcode('reader');
  scannerInstance.start(
    { facingMode:'environment' },
    { fps:10, qrbox:{ width:240, height:240 } },
    (decoded) => {
      if (decoded.includes('id=')) {
        pararScanner();
        window.location.href = decoded;
      } else {
        alert('QR Code inválido: ' + decoded);
      }
    }
  ).catch(() => alert('Permita o acesso à câmera para escanear.'));
};

window.fecharScanner = function() { pararScanner(); };

function pararScanner() {
  if (scannerInstance) {
    scannerInstance.stop().finally(() => {
      document.getElementById('scanner-modal').classList.remove('active');
      scannerInstance = null;
    });
  } else {
    document.getElementById('scanner-modal').classList.remove('active');
  }
}

window.fecharModalESair = function() {
  document.getElementById('success-modal').classList.remove('active');
  window.location.href = './';
};

window.fecharQR = function() {
  document.getElementById('qr-modal').classList.remove('active');
};

