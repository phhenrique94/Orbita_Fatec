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
import { setupLayout, getCachedAuth, setCachedAuth, clearCachedAuth } from "../core/layout.js";
import { escapeHTML as esc } from "../core/security.js";

const fbApp  = initializeApp(firebaseConfig);
const analytics = getAnalytics(fbApp);
const auth   = getAuth(fbApp);
const db     = getFirestore(fbApp);

const API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.')) 
  ? `http://${window.location.hostname}:3000/api` 
  : '/api';

async function apiFetch(endpoint, options = {}) {
  let token = '';
  if (currentUser && typeof currentUser.getIdToken === 'function') {
    token = await currentUser.getIdToken();
  } else if (auth.currentUser) {
    token = await auth.currentUser.getIdToken();
  }
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

// ---- Categories Management ----
let categorias = ["Notebook", "Passador", "Caixa de Som", "Projetor"];

function loadCategories() {
  const saved = localStorage.getItem('emprestimo_categorias');
  let loadedCats = ["Notebook", "Passador", "Caixa de Som", "Projetor"];
  if (saved) {
    try {
      loadedCats = JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
  }
  
  // Limpa loadedCats de valores inválidos ou legados como "Outros"
  loadedCats = loadedCats.filter(c => c && c.trim() !== '' && c.toLowerCase() !== 'outros' && c.toLowerCase() !== 'outro');
  
  // Extrai categorias exclusivas do Firestore
  const dbCats = new Set();
  notebooksDB.forEach(n => {
    if (n.tipo) {
      const normalized = n.tipo.trim();
      if (normalized && normalized.toLowerCase() !== 'outros' && normalized.toLowerCase() !== 'outro') {
        dbCats.add(normalized);
      }
    }
  });
  
  const merged = [...loadedCats];
  dbCats.forEach(c => {
    if (!merged.some(m => m.toLowerCase() === c.toLowerCase())) {
      merged.push(c);
    }
  });
  
  // Garante que "Notebook" seja a primeira categoria, e remove qualquer residual de "Outros"
  categorias = merged.filter(c => c.toLowerCase() !== 'outros' && c.toLowerCase() !== 'outro');
  // Se por algum motivo 'Notebook' não estiver na lista, adiciona no início
  if (!categorias.some(c => c.toLowerCase() === 'notebook')) {
    categorias.unshift('Notebook');
  }
}

function saveCategories() {
  localStorage.setItem('emprestimo_categorias', JSON.stringify(categorias));
}

function populateCategorySelects() {
  const cadSelect = document.getElementById('cad-tipo');
  const filterSelect = document.getElementById('filter-categoria');
  
  if (cadSelect) {
    const curVal = cadSelect.value;
    cadSelect.innerHTML = '';
    categorias.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      cadSelect.appendChild(opt);
    });
    if (curVal && categorias.includes(curVal)) {
      cadSelect.value = curVal;
    }
  }
  
  if (filterSelect) {
    const curVal = filterSelect.value || 'Todos';
    filterSelect.innerHTML = '<option value="Todos">Todos</option>';
    categorias.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      filterSelect.appendChild(opt);
    });
    if (categorias.includes(curVal)) {
      filterSelect.value = curVal;
    } else {
      filterSelect.value = 'Todos';
    }
  }
}

function setupCategoryManagement() {
  const btnAdd = document.getElementById('btn-add-tipo');
  const btnSave = document.getElementById('btn-save-tipo');
  const btnCancel = document.getElementById('btn-cancel-tipo');
  const newCatGroup = document.getElementById('new-category-group');
  const inputNewCat = document.getElementById('cad-tipo-novo');
  const selectCat = document.getElementById('cad-tipo');
  
  if (btnAdd && newCatGroup) {
    btnAdd.onclick = () => {
      newCatGroup.classList.remove('hidden');
      if (inputNewCat) {
        inputNewCat.value = '';
        inputNewCat.focus();
      }
    };
  }
  
  if (btnCancel && newCatGroup) {
    btnCancel.onclick = () => {
      newCatGroup.classList.add('hidden');
      if (inputNewCat) inputNewCat.value = '';
    };
  }
  
  if (btnSave && inputNewCat && selectCat) {
    btnSave.onclick = () => {
      const value = inputNewCat.value.trim();
      if (!value) return;
      
      const exists = categorias.some(c => c.toLowerCase() === value.toLowerCase());
      if (exists) {
        alert('Essa categoria já existe.');
        return;
      }
      
      categorias.push(value);
      saveCategories();
      populateCategorySelects();
      renderCategoryTabs();
      
      selectCat.value = value;
      newCatGroup.classList.add('hidden');
      inputNewCat.value = '';
    };
  }
}

function renderCategoryTabs() {
  const container = document.getElementById('category-tabs-container');
  if (!container) return;
  
  const currentCategory = document.getElementById('filter-categoria') 
    ? document.getElementById('filter-categoria').value 
    : 'Todos';
    
  container.innerHTML = '';
  
  // 1. Aba "Todos"
  const allTab = document.createElement('button');
  allTab.type = 'button';
  allTab.dataset.category = 'Todos';
  allTab.className = `tab-pill ${currentCategory === 'Todos' ? 'active' : ''}`;
  allTab.textContent = 'Todos os Itens';
  allTab.onclick = () => selectCategoryTab('Todos');
  container.appendChild(allTab);
  
  // 2. Abas de cada categoria
  categorias.forEach(cat => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.dataset.category = cat;
    tab.className = `tab-pill ${currentCategory === cat ? 'active' : ''}`;
    
    // Contagem de itens nessa categoria para mostrar na aba
    const count = notebooksDB.filter(n => n.tipo === cat).length;
    tab.textContent = `${cat} (${count})`;
    tab.onclick = () => selectCategoryTab(cat);
    container.appendChild(tab);
  });
}

function selectCategoryTab(category) {
  const catSelect = document.getElementById('filter-categoria');
  if (catSelect) {
    catSelect.value = category;
  }
  
  // Atualiza classe ativa das abas
  const container = document.getElementById('category-tabs-container');
  if (container) {
    container.querySelectorAll('.tab-pill').forEach(btn => {
      if (btn.dataset.category === category) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
  
  applyFilters();
}

// ================================================================
//  DETECT WHICH PAGE WE ARE ON
// ================================================================
const isDashboard   = !!document.getElementById('notebook-grid');
const isMovimentar  = !!document.getElementById('movimentacao-form');

let appInitialized = false;
let initializedRole = null;

async function initApp(user, role) {
  if (appInitialized && initializedRole === role) return;
  appInitialized = true;
  initializedRole = role;

  // Set avatar initial - Prioritiza o nome cadastrado no Perfil do Firebase
  const userName = user.displayName || user.email.split('@')[0];
  const av       = document.getElementById('header-avatar');
  const nameEl   = document.getElementById('user-name-display');
  if (av) av.textContent = userName.charAt(0).toUpperCase();
  if (nameEl) nameEl.textContent = userName;

  const roleBadge = document.getElementById('role-badge');
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

  // Esconde o bloqueio se estiver logado
  const guard = document.getElementById('auth-guard');
  if (guard) guard.classList.add('hidden');
  
  setupLayout(user, role, 'emprestimo', async () => {
    clearCachedAuth();
    await signOut(auth);
    window.location.href = '../auth/login.html';
  });

  await loadNotebooks();

  if (isDashboard)  initDashboard();
  if (isMovimentar) initMovimentar();
}

// Check cache immediately
const cached = getCachedAuth();
if (cached && ['adm_l1', 'adm_l2', 'ti'].includes(cached.role)) {
  currentUser = cached.user;
  initApp(cached.user, cached.role);
}

// ---- Auth Guard ----
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    clearCachedAuth();
    const guard = document.getElementById('auth-guard');
    if (guard) guard.classList.remove('hidden');
    const loginWrapper = document.getElementById('login-wrapper');
    if (loginWrapper) {
      const authLoading = document.getElementById('auth-loading');
      if (authLoading) authLoading.classList.add('hidden');
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
  
  currentUser = user;

  // Buscar Papel (Role) via API
  let role = 'visitante';
  try {
    const userData = await apiFetch('/usuarios/me');
    role = userData.role || 'visitante';
  } catch (err) {
    role = cached ? cached.role : 'visitante';
  }

  // Buscar Permissões Globais via API
  let userLevel = 1;
  try {
    const allPerms = await apiFetch('/usuarios/config/permissions');
    const rawPerm = allPerms[role]?.emprestimo;
    userLevel = (rawPerm !== undefined && typeof rawPerm === 'object')
      ? (rawPerm.execute ? 3 : (rawPerm.view ? 2 : 1))
      : (parseInt(rawPerm) || 1);
  } catch (err) {
    // Falha silenciosa para segurança
  }

  const token = await user.getIdToken();
  setCachedAuth(user, role, token);

  // Verifica se pode VER o módulo (nível >= 2)
  if (role !== 'adm_l1' && userLevel < 2) {
    window.location.href = '../meu-espaco/index.html';
    return;
  }

  // Se não puder EXECUTAR (nível >= 3), esconde botões globais
  if (role !== 'adm_l1' && userLevel < 3) {
    document.body.classList.add('hide-execute');
  } else {
    document.body.classList.remove('hide-execute');
  }

  if (!appInitialized || initializedRole !== role || (cached && (cached.user.displayName !== user.displayName || cached.user.email !== user.email))) {
    initApp(user, role);
  }
});

// ================================================================
//  DATA LOADING
// ================================================================
async function loadNotebooks() {
  try {
    notebooksDB = await apiFetch('/emprestimos');
    // Normaliza itens legados (sem tipo, 'Outros', 'outro', 'notbooks', etc.) para 'Notebook'
    notebooksDB.forEach(n => {
      if (!n.tipo || n.tipo.trim() === '' || n.tipo.toLowerCase() === 'outros' || n.tipo.toLowerCase() === 'outro' || n.tipo.toLowerCase() === 'notbooks' || n.tipo.toLowerCase() === 'notbook') {
        n.tipo = 'Notebook';
      }
    });

    if (isDashboard) {
      loadCategories();
      populateCategorySelects();
      renderCategoryTabs();
    }
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

  // Populate categories initially
  loadCategories();
  populateCategorySelects();
  setupCategoryManagement();
  renderCategoryTabs();

  renderGrid(notebooksDB);

  // Polling via API REST para simular realtime
  setInterval(async () => {
    if (document.hidden) return; // Ignorar se a aba estiver oculta/inativa
    try {
      notebooksDB = await apiFetch('/emprestimos');
      applyFilters();
    } catch(err) {}
  }, 120000);

  // Filters
  document.getElementById('search-input').addEventListener('input',  applyFilters);
  document.getElementById('filter-status').addEventListener('change', applyFilters);
  document.getElementById('filter-categoria').addEventListener('change', (e) => {
    selectCategoryTab(e.target.value);
  });
  document.getElementById('filter-local').addEventListener('change',  applyFilters);
  document.getElementById('filter-sala').addEventListener('change',   applyFilters);

  // Click summary cards to filter
  document.querySelectorAll('.status-summary .stat-item').forEach(item => {
    item.addEventListener('click', () => {
      const filterVal = item.dataset.filter;
      const statusSelect = document.getElementById('filter-status');
      if (statusSelect && filterVal) {
        statusSelect.value = filterVal;
        applyFilters();
      }
    });
  });

  // Cadastro form submit listener
  document.getElementById('form-cadastro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('cad-id').value.trim();
    const tipo = document.getElementById('cad-tipo').value.trim();
    const temQrCode = document.getElementById('cad-tem-qr').checked;
    
    if (!id || !tipo) return;
    
    // Validar duplicidade
    const existing = notebooksDB.find(n => n.id.toLowerCase() === id.toLowerCase());
    if (existing) {
      alert(`Erro: Já existe um item cadastrado com o identificador "${id}".`);
      return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Cadastrando...';
    submitBtn.disabled = true;
    
    const userName = currentUser.displayName || currentUser.email.split('@')[0];
    
    const newItem = {
      id,
      tipo,
      temQrCode,
      status: 'guardado',
      local: 'T.I.',
      responsavel: userName,
      updatedAt: new Date().toISOString(),
      observacao: ''
    };
    
    try {
      await apiFetch(`/emprestimos/${id}`, {
        method: 'PUT',
        body: JSON.stringify(newItem)
      });
      
      fecharCadastro();
      
      // Recarregar itens e atualizar grid
      await loadNotebooks();
      applyFilters();
    } catch (err) {
      console.error(err);
      alert('Erro ao cadastrar item: ' + err.message);
    } finally {
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;
    }
  });

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
    if (qrBtn) { abrirQR(qrBtn.dataset.id); return; }

    // Card click (Historico)
    const card = e.target.closest('.notebook-card');
    if (card && !e.target.closest('.card-actions') && !e.target.closest('a') && !e.target.closest('button')) {
      abrirHistorico(card.dataset.id);
    }
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

window.abrirHistorico = function(id) {
  const note = notebooksDB.find(n => n.id === id);
  if (!note) return;
  
  document.getElementById('historico-subtitle').textContent = `Últimas movimentações de ${id}`;
  const listEl = document.getElementById('historico-list');
  listEl.innerHTML = '';
  
  if (!note.historico || note.historico.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-muted); text-align:center;">Nenhum histórico encontrado.</p>';
  } else {
    note.historico.forEach(evento => {
      let detalhe = '';
      if (evento.status === 'emprestado') detalhe = `Sala ${esc(evento.sala)} - Req: ${esc(evento.requerente)}`;
      else if (evento.status === 'cedido') detalhe = `Para: ${esc(evento.funcionario)} (${esc(evento.setor)})`;
      else if (evento.status === 'guardado') detalhe = `Local: ${esc(evento.local)}`;
      else if (evento.status === 'reservado') detalhe = `Motivo: ${esc(evento.observacao)}`;

      const dt = evento.updatedAt ? new Date(evento.updatedAt).toLocaleString('pt-BR') : '---';
      
      const item = document.createElement('div');
      item.style.cssText = 'padding: 1rem; background: rgba(255,255,255,0.03); border-radius: 8px; border-left: 4px solid var(--c-' + evento.status + ');';
      item.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:0.5rem;">
          <strong>${esc(evento.status.toUpperCase())}</strong>
          <span style="font-size:0.8rem; color:var(--text-muted);">${dt}</span>
        </div>
        <div style="font-size:0.9rem; color:var(--text-secondary); margin-bottom:0.3rem;">
          ${detalhe}
        </div>
        <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
          <span style="color:var(--purple-bright);">👤 ${esc(evento.responsavel)}</span>
          ${evento.observacao && evento.status !== 'reservado' ? `<span style="font-style:italic; color:var(--text-muted);">💬 ${esc(evento.observacao)}</span>` : ''}
        </div>
      `;
      listEl.appendChild(item);
    });
  }
  
  document.getElementById('modal-historico').classList.add('active');
};

window.fecharModalHistorico = function() {
  document.getElementById('modal-historico').classList.remove('active');
};

window.abrirCadastro = function() {
  document.getElementById('modal-cadastro').classList.add('active');
};

window.fecharCadastro = function() {
  document.getElementById('modal-cadastro').classList.remove('active');
  document.getElementById('form-cadastro').reset();
};

function applyFilters() {
  const s   = document.getElementById('search-input').value.toLowerCase();
  const st  = document.getElementById('filter-status').value;
  const cat = document.getElementById('filter-categoria').value;
  const loc = document.getElementById('filter-local').value;
  const sa  = document.getElementById('filter-sala').value;
  const filtered = notebooksDB.filter(n => {
    if (s && !n.id.toLowerCase().includes(s)) return false;
    if (st !== 'Todos' && n.status !== st) return false;
    if (cat !== 'Todos' && n.tipo !== cat) return false;
    if (loc !== 'Todos') { if (n.status !== 'guardado' || n.local !== loc) return false; }
    if (sa !== 'Todos')  { if (n.status !== 'emprestado' || n.sala !== sa) return false; }
    return true;
  });
  renderGrid(filtered);
}

function renderGrid(list) {
  const grid = document.getElementById('notebook-grid');
  grid.innerHTML = '';

  // Stats filtrados pela categoria selecionada
  const selectedCat = document.getElementById('filter-categoria') ? document.getElementById('filter-categoria').value : 'Todos';
  const statsList = selectedCat === 'Todos'
    ? notebooksDB
    : notebooksDB.filter(n => n.tipo === selectedCat);

  const count = { guardado:0, emprestado:0, cedido:0, reservado:0 };
  statsList.forEach(n => { if(count[n.status] !== undefined) count[n.status]++; });
  
  // Atualiza labels dos cards com o nome da categoria para ficar distinto
  const labels = {
    Todos: 'Total',
    guardado: 'Disponíveis',
    emprestado: 'Emprestados',
    cedido: 'Cedidos',
    reservado: 'Reservados'
  };
  
  document.querySelectorAll('.status-summary .stat-item').forEach(item => {
    const filterVal = item.dataset.filter; // "Todos", "guardado", "emprestado", "cedido", "reservado"
    const lblEl = item.querySelector('.stat-lbl');
    if (lblEl && filterVal) {
      const baseText = labels[filterVal] || 'Status';
      lblEl.textContent = selectedCat === 'Todos' ? baseText : `${baseText} (${selectedCat})`;
    }

    // Remove qualquer breakdown residual do design anterior
    const existing = item.querySelector('.stat-breakdown');
    if (existing) existing.remove();
  });

  const elT = document.getElementById('stat-total');
  const elG = document.getElementById('stat-guardado');
  const elE = document.getElementById('stat-emprestado');
  const elC = document.getElementById('stat-cedido');
  const elR = document.getElementById('stat-reservado');

  if(elT) elT.textContent = statsList.length;
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
    card.dataset.id = n.id;
    card.style.borderTop = `4px solid var(--c-${n.status})`;
    card.style.cursor = 'pointer';

    const updateStr = n.updatedAt ? new Date(n.updatedAt).toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'}) + ', ' + new Date(n.updatedAt).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : '---';

    const qrBtnHtml = n.temQrCode !== false 
      ? `<button class="btn btn-secondary btn-qr action-execute" data-id="${n.id}" style="opacity:0.4; font-size:0.75rem">GERAR QR</button>` 
      : `<button class="btn btn-secondary action-execute" disabled style="opacity:0.2; font-size:0.75rem; cursor:not-allowed" title="Item configurado sem QR Code">SEM QR</button>`;

    card.innerHTML = `
      <div class="card-header">
        <div style="display:flex; align-items:center; gap:0.5rem">
          <span class="card-id" title="${esc(n.tipo || 'Notebook')}">${esc(n.id)} ${n.tipo ? `<span style="font-size:0.75rem; color:var(--text-secondary); font-weight:normal;">(${esc(n.tipo)})</span>` : ''}</span>
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
        ${n.observacao && n.status !== 'reservado' ? `<div style="margin-top: 5px; font-size: 0.8rem; color: var(--text-muted); font-style: italic;">💬 ${esc(n.observacao)}</div>` : ''}
      </div>

      <div class="card-footer">
        <span>🕒 ${updateStr}</span>
        <span style="font-weight:700; color:var(--purple-bright)">👤 ${esc(n.responsavel || '---')}</span>
      </div>

        <div class="card-actions">
          <a href="movimentar.html?id=${n.id}" class="btn btn-secondary action-execute">Movimentar</a>
          ${qrBtnHtml}
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
  
  let base = window.location.href.split('emprestimo/')[0];
  if (window.location.hostname.endsWith('vercel.app')) {
    base = 'https://orbita-fatec-ti.vercel.app/';
  }
  
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
    if (document.hidden) return; // Ignorar se a aba estiver oculta/inativa
    try {
      const data = await apiFetch(`/emprestimos/${notebookId}`);
      noteObj = data; 
      updateHeader(noteObj);
    } catch(err) {}
  }, 120000);

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
      let itemId = '';
      try {
        const url = new URL(decoded);
        itemId = url.searchParams.get('id');
      } catch (e) {
        const queryMatch = decoded.match(/[?&]id=([^&]+)/);
        if (queryMatch) {
          itemId = queryMatch[1];
        } else {
          itemId = decoded.trim();
        }
      }

      if (itemId) {
        if (/^not_med\d+$/i.test(itemId)) {
          itemId = 'Not_Med' + itemId.substring(7);
        }
        pararScanner();
        window.location.href = `/emprestimo/movimentar.html?id=${itemId}`;
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

