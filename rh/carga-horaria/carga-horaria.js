// ================================================================
//  ÓRBITA — MÓDULO CARGA HORÁRIA (RH)
//  Abas: Funcionários | Lançar Horas | Histórico
// ================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { firebaseConfig } from "../../core/firebase-config.js";
import { setupLayout } from "../../core/layout.js";
import { escapeHTML as esc } from "../../core/security.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);

const API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.')) 
  ? `http://${window.location.hostname}:3000/api` 
  : '/api';

async function apiFetch(endpoint, options = {}) {
  const token = await auth.currentUser.getIdToken();
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  if (!res.ok) throw new Error(`Erro na API: ${res.status}`);
  return res.json();
}

// ==========================================
// FIRESTORE MOCK ADAPTER (MIGRAÇÃO REST)
// ==========================================
const db = {};
const doc = (d, col, id) => `${col}/${id}`;
const collection = (d, col) => col;
const getDoc = async (path) => {
    if (path.startsWith('users/')) {
        const user = await apiFetch('/usuarios/me');
        return { exists: () => true, data: () => user };
    }
    const [col, id] = path.split('/');
    const data = await apiFetch(`/carga-horaria/${col}/${id}`);
    return { exists: () => !!data, data: () => data, id };
};

const query = (col, ...args) => {
    const qParams = new URLSearchParams();
    args.forEach(a => {
        if (a.type === 'where') qParams.append(a.field, a.val);
    });
    return `${col}?${qParams.toString()}`;
};
const where = (field, op, val) => ({ type: 'where', field, val });
const orderBy = (field, dir) => ({ type: 'orderBy', field, dir });

const getDocs = async (path) => {
    const data = await apiFetch(`/carga-horaria/${path}`);
    return { docs: data.map(d => ({
        id: d.id, 
        data: () => {
            const cloned = {...d};
            if (cloned.entrada) cloned.entrada = { toDate: () => new Date(cloned.entrada) };
            if (cloned.saida) cloned.saida = { toDate: () => new Date(cloned.saida) };
            if (cloned.criadoEm) cloned.criadoEm = { toDate: () => new Date(cloned.criadoEm) };
            if (cloned.lancadoEm) cloned.lancadoEm = { toDate: () => new Date(cloned.lancadoEm) };
            return cloned;
        }
    }))};
};

const addDoc = async (col, data) => {
    const cleanData = {...data};
    if (cleanData.entrada?.toDate) cleanData.entrada = cleanData.entrada.toDate().toISOString();
    if (cleanData.saida?.toDate) cleanData.saida = cleanData.saida.toDate().toISOString();
    const res = await apiFetch(`/carga-horaria/${col}`, { method: 'POST', body: JSON.stringify(cleanData) });
    return { id: res.id };
};

const updateDoc = async (path, data) => {
    const [col, id] = path.split('/');
    const cleanData = {...data};
    if (cleanData.entrada?.toDate) cleanData.entrada = cleanData.entrada.toDate().toISOString();
    if (cleanData.saida?.toDate) cleanData.saida = cleanData.saida.toDate().toISOString();
    await apiFetch(`/carga-horaria/${col}/${id}`, { method: 'PUT', body: JSON.stringify(cleanData) });
};

const deleteDoc = async (path) => {
    const [col, id] = path.split('/');
    await apiFetch(`/carga-horaria/${col}/${id}`, { method: 'DELETE' });
};

const serverTimestamp = () => 'TIMESTAMP';
const Timestamp = { fromDate: (date) => ({ toDate: () => date }) };

const onSnapshot = (path, callback) => {
    const fetchIt = () => getDocs(path).then(callback).catch(()=>{});
    fetchIt();
    const interval = setInterval(fetchIt, 30000);
    return () => clearInterval(interval);
};

// ---- Estado global ----
let currentUser     = null;
let allFuncionarios = [];       // cache dos funcionários
let eventoState     = {};       // { [funcId]: { docId, status, entrada } }
let currentEventId  = null;     // ID do evento sendo visualizado
let currentEventData = null;    // Objeto com dados do evento (datas, etc)
let histFuncAtual   = null;     // funcionário selecionado no histórico

const TURNO_LABEL = { manha:'Manhã', tarde:'Tarde', noite:'Noite', integral:'Integral' };

// ================================================================
//  AUTH GUARD
// ================================================================
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = '/login.html'; return; }
  currentUser = user;

  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const role = snap.exists() ? (snap.data().role || 'visitante') : 'visitante';
    const rolesPermitidos = ['adm_l1', 'adm_l2', 'rh'];

    if (!rolesPermitidos.includes(role)) {
      document.getElementById('auth-guard').classList.remove('hidden');
      return;
    }

    // Inicializar o layout
    setupLayout(user, role, 'carga-horaria', async () => {
      await signOut(auth);
      window.location.href = '/login.html';
    });

  } catch(e) {
    document.getElementById('auth-guard').classList.remove('hidden'); return;
  }

  document.getElementById('main-content').classList.remove('hidden');
  inicializar();
});

// (Logout is now handled by layout.js)

// ================================================================
//  INICIALIZAÇÃO
// ================================================================
function inicializar() {
  setupTabs();
  carregarFuncionarios();
  setupModoLancar();
  setupFormManual();
  setupHistorico();
}

// ================================================================
//  ABAS
// ================================================================
function setupTabs() {
  document.querySelectorAll('.ch-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ch-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.ch-section').forEach(s => s.classList.add('hidden'));
      btn.classList.add('active');
      const secId = 'tab-' + btn.dataset.tab;
      document.getElementById(secId).classList.remove('hidden');
      // Ao abrir histórico, popula o select
      if (btn.dataset.tab === 'historico') popularSelectHistorico();
      // Ao abrir lançar, popula o select do manual
      if (btn.dataset.tab === 'lancar') popularDatalistManual();
    });
  });
}

// ================================================================
//  ABA 1 — FUNCIONÁRIOS
// ================================================================
function carregarFuncionarios() {
  const colRef = collection(db, 'funcionarios_rh');
  onSnapshot(query(colRef, orderBy('nome')), snap => {
    allFuncionarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    popularDatalistManual();
    popularSelectHistorico();
  });
}

// ================================================================
//  ABA 2 — LANÇAR HORAS
// ================================================================
function setupModoLancar() {
  // Tabs internas
  document.querySelectorAll('.modo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modo-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const modo = btn.dataset.modo;
      document.getElementById('modo-evento').classList.toggle('hidden', modo !== 'evento');
      document.getElementById('modo-manual').classList.toggle('hidden', modo !== 'manual');
      if (modo === 'evento') carregarEventosAtivos();
    });
  });

  // Eventos: Lista
  document.getElementById('btn-criar-evento').addEventListener('click', criarNovoEvento);
  document.getElementById('novo-nome-evento').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); criarNovoEvento(); }
  });

  // Eventos: Detalhe
  document.getElementById('btn-voltar-lista').addEventListener('click', () => {
    document.getElementById('evento-lista-container').classList.remove('hidden');
    document.getElementById('evento-detalhe-container').classList.add('hidden');
    currentEventId = null;
    currentEventData = null;
  });

  document.getElementById('btn-excluir-evento-atual').addEventListener('click', excluirEventoAtual);

  carregarEventosAtivos();
}

// ---- Gestão da Lista de Eventos ----
function carregarEventosAtivos() {
  const colRef = collection(db, 'eventos_rh');
  onSnapshot(query(colRef, orderBy('criadoEm', 'desc')), snap => {
    const eventos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderListaEventos(eventos);
  });
}

function renderListaEventos(eventos) {
  const el = document.getElementById('lista-eventos-ativos');
  if (!eventos.length) {
    el.innerHTML = `
      <div class="ch-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p>Nenhum evento ativo. Crie um acima para começar.</p>
      </div>`;
    return;
  }

  el.innerHTML = eventos.map(e => {
    const dIni = e.dataInicio ? new Date(e.dataInicio + 'T12:00:00').toLocaleDateString('pt-BR') : '?';
    const dFim = e.dataFim ? new Date(e.dataFim + 'T12:00:00').toLocaleDateString('pt-BR') : '?';
    
    return `
      <div class="evento-card" data-id="${e.id}">
        <div class="evento-card-info">
          <div class="evento-card-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </div>
          <div>
            <div class="evento-card-nome">${esc(e.nome)}</div>
            <div class="evento-card-data">${dIni} até ${dFim}</div>
          </div>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="opacity:.3"><polyline points="9 18 15 12 9 6"/></svg>
      </div>`;
  }).join('');

  el.querySelectorAll('.evento-card').forEach(card => {
    card.addEventListener('click', () => abrirDetalheEvento(card.dataset.id));
  });
}

async function criarNovoEvento() {
  const nome = document.getElementById('novo-nome-evento').value.trim();
  const dataInicio = document.getElementById('evento-data-inicio').value;
  const dataFim = document.getElementById('evento-data-fim').value;

  if (!nome || !dataInicio || !dataFim) { 
    showToast('⚠️ Preencha nome e ambas as datas.', 'error'); return; 
  }

  try {
    await addDoc(collection(db, 'eventos_rh'), {
      nome,
      dataInicio,
      dataFim,
      criadoEm: serverTimestamp(),
      criadoPor: currentUser.uid
    });
    document.getElementById('novo-nome-evento').value = '';
    document.getElementById('evento-data-inicio').value = '';
    document.getElementById('evento-data-fim').value = '';
    showToast('✅ Evento criado com sucesso!', 'success');
  } catch (err) {
    showToast('❌ Erro ao criar evento: ' + err.message, 'error');
  }
}

async function abrirDetalheEvento(id) {
  try {
    const docSnap = await getDoc(doc(db, 'eventos_rh', id));
    if (!docSnap.exists()) return;
    
    currentEventData = { id: docSnap.id, ...docSnap.data() };
    currentEventId = id;

    const dIni = new Date(currentEventData.dataInicio + 'T12:00:00').toLocaleDateString('pt-BR');
    const dFim = new Date(currentEventData.dataFim + 'T12:00:00').toLocaleDateString('pt-BR');

    document.getElementById('detalhe-evento-nome').textContent = currentEventData.nome;
    document.getElementById('detalhe-evento-periodo').textContent = `${dIni} a ${dFim}`;
    document.getElementById('evento-lista-container').classList.add('hidden');
    document.getElementById('evento-detalhe-container').classList.remove('hidden');

    await carregarEstadoEvento(id);
  } catch(err) {
    showToast('❌ Erro ao abrir: ' + err.message, 'error');
  }
}

async function excluirEventoAtual() {
  if (!currentEventId) return;
  if (!confirm(`Excluir evento?\n\nIsso remove apenas o gerenciador de entrada/saída. As horas já registradas nos funcionários permanecem intactas.`)) return;

  try {
    await deleteDoc(doc(db, 'eventos_rh', currentEventId));
    document.getElementById('btn-voltar-lista').click();
    showToast('🗑️ Evento excluído.', 'success');
  } catch (err) {
    showToast('❌ Erro ao excluir: ' + err.message, 'error');
  }
}

// ---- Lógica de Entrada/Saída Interna ----
async function carregarEstadoEvento(eventId) {
  const lista = document.getElementById('evento-lista-funcionarios');
  lista.innerHTML = '<div class="ch-loading">Carregando ponto do dia...</div>';
  eventoState = {};

  const hoje = new Date().toISOString().split('T')[0];
  document.getElementById('dia-atual-label').textContent = `DIA: ${hoje.split('-').reverse().slice(0,2).join('/')}`;

  try {
    // Busca APENAS registros do DIA ATUAL para este evento
    const q = query(
      collection(db, 'registros_carga_horaria'),
      where('eventoId', '==', eventId),
      where('dataEvento', '==', hoje)
    );
    const snap = await getDocs(q);
    snap.forEach(d => {
      const data = d.data();
      if (!eventoState[data.funcionarioId]) eventoState[data.funcionarioId] = {};
      
      const key = data.turnoId || 'default';
      eventoState[data.funcionarioId][key] = {
        docId: d.id,
        status: data.saida ? 'finalizado' : 'andamento',
        entrada: data.entrada?.toDate() || null,
        turnoHoras: data.turnoHoras || 0
      };
    });

    renderEventoFuncLista();
  } catch (err) {
    showToast('❌ Erro ao carregar estado: ' + err.message, 'error');
  }
}

function renderEventoFuncLista() {
  const lista = document.getElementById('evento-lista-funcionarios');
  if (!allFuncionarios.length) {
    lista.innerHTML = `<div class="evento-placeholder"><p>Nenhum funcionário cadastrado.</p></div>`;
    return;
  }

  const hoje = new Date().toISOString().split('T')[0];
  const foraDoPeriodo = (hoje < currentEventData.dataInicio || hoje > currentEventData.dataFim);

  lista.innerHTML = allFuncionarios.map(f => {
    const hoje = new Date().toISOString().split('T')[0];
    const foraDoPeriodo = (hoje < currentEventData.dataInicio || hoje > currentEventData.dataFim);
    const fState = eventoState[f.id] || {};

    // Se tiver turnos declarados, renderiza uma linha para cada
    const turnosParaRenderizar = (f.turnos && f.turnos.length) 
      ? f.turnos 
      : [{ id: 'default', label: 'Geral', horas: f.horasTurno || 0 }];

    // Verifica se tem algo em andamento ou finalizado para mostrar no header
    const hasAndamento = Object.values(fState).some(s => s.status === 'andamento');
    const allFinalizado = turnosParaRenderizar.every(t => fState[t.id]?.status === 'finalizado');
    const someFinalizado = Object.values(fState).some(s => s.status === 'finalizado');

    let statusDot = '';
    if (hasAndamento) statusDot = '<span class="status-dot andamento"></span>';
    else if (allFinalizado) statusDot = '<span class="status-dot finalizado"></span>';
    else if (someFinalizado) statusDot = '<span class="status-dot finalizado-parcial"></span>';

    const rowsHtml = turnosParaRenderizar.map(t => {
      const estado = fState[t.id] || { status: 'aguardando' };
      const { status } = estado;
      const badgeMap = { 
        aguardando: 'badge-aguardando Aguardando', 
        andamento: 'badge-andamento Em Andamento', 
        finalizado: 'badge-finalizado Finalizado' 
      };
      const [badgeClass, badgeLabel] = badgeMap[status].split(' ').reduce((a,v,i) => i===0?[v,a[1]]:[a[0],a[1]+' '+v], ['','']);
      
      const entradaBtn = status === 'aguardando' && !foraDoPeriodo;
      const saidaBtn   = status === 'andamento' && !foraDoPeriodo;
      const tLabel = t.id === 'default' ? '' : `<div class="shift-name">${TURNO_LABEL[t.id] || t.id}</div>`;

      return `
        <div class="evento-shift-row status-${status}">
          <div class="shift-info">
            ${tLabel}
            <span class="evento-status-badge ${badgeClass}">${badgeLabel.trim()}</span>
          </div>
          <div class="evento-func-btns">
            <button class="btn-entrada" ${!entradaBtn?'disabled':''} data-id="${f.id}" data-turno="${t.id}" data-horas="${t.horas}">
              ▶ Entrada
            </button>
            <button class="btn-saida" ${!saidaBtn?'disabled':''} data-id="${f.id}" data-turno="${t.id}">
              ■ Saída
            </button>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="evento-func-card accordion-card ${foraDoPeriodo?'opacity-50':''}" id="ecard-${f.id}">
        <div class="evento-func-header accordion-toggle" data-id="${f.id}">
          <div class="evento-func-info">
            <div class="evento-func-nome">${esc(f.nome)} ${statusDot}</div>
            <div class="evento-func-cargo">${esc(f.cargo)}</div>
          </div>
          <div class="accordion-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
        <div class="evento-func-shifts accordion-content hidden" id="shifts-${f.id}">
          ${rowsHtml}
        </div>
      </div>`;
  }).join('');

  if (foraDoPeriodo) {
    lista.insertAdjacentHTML('afterbegin', `<div class="alert-warning" style="margin-bottom:1rem; padding:0.8rem; background:rgba(249,115,22,0.1); border:1px solid var(--ch-orange); border-radius:8px; color:var(--ch-orange); text-align:center; font-size:0.85rem;">⚠️ Este evento está fora da data de vigência (${hoje < currentEventData.dataInicio ? 'Ainda não começou' : 'Já encerrou'}). Registros bloqueados.</div>`);
  }

  // Listeners de Acordeon
  lista.querySelectorAll('.accordion-toggle').forEach(header => {
    header.addEventListener('click', () => {
      const id = header.dataset.id;
      const content = document.getElementById(`shifts-${id}`);
      const card = header.closest('.accordion-card');
      const isHidden = content.classList.contains('hidden');
      
      // Fecha outros? (Opcional, vamos deixar livre pra abrir vários)
      content.classList.toggle('hidden');
      card.classList.toggle('expanded');
    });
  });

  lista.querySelectorAll('.btn-entrada').forEach(btn =>
    btn.addEventListener('click', () => registrarEntrada(btn.dataset.id, btn.dataset.turno, btn.dataset.horas)));
  lista.querySelectorAll('.btn-saida').forEach(btn =>
    btn.addEventListener('click', () => registrarSaida(btn.dataset.id, btn.dataset.turno)));
}

async function registrarEntrada(funcId, turnoId, turnoHoras) {
  if (!currentEventId) return;
  const func = allFuncionarios.find(f => f.id === funcId);
  if (!func || (eventoState[funcId] && eventoState[funcId][turnoId])) return;

  // Feedback visual no botão clicado
  const btn = document.querySelector(`.btn-entrada[data-id="${funcId}"][data-turno="${turnoId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  try {
    const agora = new Date();
    const docRef = await addDoc(collection(db, 'registros_carga_horaria'), {
      funcionarioId:   funcId,
      funcionarioNome: func.nome,
      tipo:            'evento',
      eventoId:        currentEventId,
      descricao:       currentEventData.nome + (turnoId !== 'default' ? ` — ${TURNO_LABEL[turnoId] || turnoId}` : ''),
      dataEvento:      agora.toISOString().split('T')[0],
      entrada:         Timestamp.fromDate(agora),
      saida:           null,
      turnoId:         turnoId,
      turnoHoras:      parseFloat(turnoHoras || 0),
      horasExtras:     0,
      lancadoPor:      currentUser.uid,
      lancadoEm:       Timestamp.fromDate(agora)
    });

    if (!eventoState[funcId]) eventoState[funcId] = {};
    eventoState[funcId][turnoId] = { docId: docRef.id, status: 'andamento', entrada: agora, turnoHoras: parseFloat(turnoHoras || 0) };
    renderEventoFuncLista();
    const tLabel = turnoId === 'default' ? '' : ` (${TURNO_LABEL[turnoId] || turnoId})`;
    showToast(`✅ Entrada: ${func.nome}${tLabel}`, 'success');
  } catch (err) {
    showToast('❌ Erro: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '▶ Entrada'; }
  }
}

async function registrarSaida(funcId, turnoId) {
  const func  = allFuncionarios.find(f => f.id === funcId);
  const estado = (eventoState[funcId] && eventoState[funcId][turnoId]) ? eventoState[funcId][turnoId] : null;
  if (!func || !estado || estado.status !== 'andamento') return;

  const btn = document.querySelector(`.btn-saida[data-id="${funcId}"][data-turno="${turnoId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  try {
    const agora = new Date();
    const diffHoras   = (agora - estado.entrada) / 3600000;
    
    // Usa as horas do turno específico, ou o total se for legado
    const horasEsperadas = parseFloat(estado.turnoHoras || 0);
    const horasExtras = Math.max(0, Math.round((diffHoras - horasEsperadas) * 100) / 100);

    console.log(`[PONTO] Saída: ${func.nome} | Turno: ${turnoId}`);
    console.log(`[PONTO] Entrada: ${estado.entrada.toLocaleTimeString()} | Agora: ${agora.toLocaleTimeString()}`);
    console.log(`[PONTO] Horas Trabalhadas: ${diffHoras.toFixed(4)} | Horas Esperadas: ${horasEsperadas.toFixed(4)}`);
    console.log(`[PONTO] Cálculo: ${diffHoras.toFixed(4)} - ${horasEsperadas.toFixed(4)} = ${(diffHoras - horasEsperadas).toFixed(4)}`);
    console.log(`[PONTO] Extras calculados: ${horasExtras}`);

    await updateDoc(doc(db, 'registros_carga_horaria', estado.docId), {
      saida: Timestamp.fromDate(agora),
      horasExtras
    });

    const novoTotal = (func.totalHorasExtras || 0) + horasExtras;
    await updateDoc(doc(db, 'funcionarios_rh', funcId), { totalHorasExtras: novoTotal });

    const idx = allFuncionarios.findIndex(f => f.id === funcId);
    if (idx >= 0) allFuncionarios[idx].totalHorasExtras = novoTotal;

    eventoState[funcId][turnoId] = { ...estado, status: 'finalizado', saida: agora };
    renderEventoFuncLista();
    const tLabel = turnoId === 'default' ? '' : ` (${TURNO_LABEL[turnoId] || turnoId})`;
    showToast(`✅ Saída registrada para ${func.nome}${tLabel}`, 'success');
  } catch (err) {
    showToast('❌ Erro: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '■ Saída'; }
  }
}

// ---- Lançamento Manual ----
function popularDatalistManual() {
  const dl = document.getElementById('lista-funcs-datalist');
  dl.innerHTML = allFuncionarios.map(f => `<option value="${esc(f.nome)}">`).join('');
}

function setupFormManual() {
  document.getElementById('form-manual').addEventListener('submit', async e => {
    e.preventDefault();
    const nomeBusca = document.getElementById('manual-func-search').value.trim();
    const descricao = document.getElementById('manual-descricao').value.trim();
    const horas     = parseFloat(document.getElementById('manual-horas').value);
    const tipoOp    = document.querySelector('input[name="manual-tipo-op"]:checked').value;
    
    // Encontra funcionário pelo nome (autocomplete)
    const func = allFuncionarios.find(f => f.nome.toLowerCase() === nomeBusca.toLowerCase());

    if (!func) {
      showToast('⚠️ Funcionário não encontrado. Selecione da lista.', 'error'); return;
    }
    if (!descricao || isNaN(horas) || horas <= 0) {
      showToast('⚠️ Preencha todos os campos corretamente.', 'error'); return;
    }

    const valorFinal = tipoOp === 'debito' ? -horas : horas;

    const btn = document.getElementById('btn-manual-submit');
    btn.disabled = true;
    try {
      await addDoc(collection(db, 'registros_carga_horaria'), {
        funcionarioId:   func.id,
        funcionarioNome: func.nome,
        tipo:            tipoOp === 'debito' ? 'debito' : 'manual',
        descricao,
        entrada:         null,
        saida:           null,
        horasExtras:     valorFinal,
        lancadoPor:      currentUser.uid,
        lancadoEm:       serverTimestamp(),
        dataEvento:      new Date().toISOString().split('T')[0]
      });

      const novoTotal = Math.max(0, (func.totalHorasExtras || 0) + valorFinal);
      await updateDoc(doc(db, 'funcionarios_rh', func.id), { totalHorasExtras: novoTotal });

      const idx = allFuncionarios.findIndex(f => f.id === func.id);
      if (idx >= 0) allFuncionarios[idx].totalHorasExtras = novoTotal;

      e.target.reset();
      showToast(`✅ ${Math.abs(valorFinal)}h ${tipoOp === 'debito' ? 'retiradas' : 'lançadas'} para ${func.nome}`, 'success');
    } catch (err) {
      showToast('❌ Erro: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

// ================================================================
//  ABA 3 — HISTÓRICO
// ================================================================
function setupHistorico() {
  const searchInput = document.getElementById('hist-func-search');
  
  searchInput.addEventListener('input', async e => {
    const nomeBusca = e.target.value.trim();
    // Encontra funcionário pelo nome (autocomplete)
    const f = allFuncionarios.find(x => x.nome.toLowerCase() === nomeBusca.toLowerCase());
    
    histFuncAtual = f || null;
    document.getElementById('btn-exportar-csv').disabled = !histFuncAtual;
    
    if (histFuncAtual) {
      await carregarHistorico(histFuncAtual.id);
    } else {
      document.getElementById('hist-resumo').classList.add('hidden');
      document.getElementById('hist-lista').innerHTML = `<div class="evento-placeholder"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>Selecione um funcionário.</p></div>`;
    }
  });

  document.getElementById('btn-exportar-csv').addEventListener('click', exportarCSV);
}

function popularSelectHistorico() {
  const dl = document.getElementById('hist-funcs-datalist');
  dl.innerHTML = allFuncionarios.map(f => `<option value="${esc(f.nome)}">`).join('');
}

let todosRegistros = [];

async function carregarHistorico(funcId) {
  document.getElementById('hist-lista').innerHTML = '<div class="ch-loading">Carregando...</div>';
  try {
    const q = query(
      collection(db, 'registros_carga_horaria'),
      where('funcionarioId', '==', funcId),
      orderBy('lancadoEm', 'desc')
    );
    const snap = await getDocs(q);
    todosRegistros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHistorico(todosRegistros);
    renderResumo();
  } catch(err) {
    if (err.message.includes('index')) {
      showToast('⚠️ O banco de dados precisa de uma configuração inicial. Clique no link do erro no console ou aguarde a aplicação do índice.', 'error');
    } else {
      showToast('❌ Erro ao carregar histórico: ' + err.message, 'error');
    }
    console.error("Erro Firestore:", err);
  }
}

function renderResumo() {
  if (!histFuncAtual) return;
  document.getElementById('hist-resumo').classList.remove('hidden');
  document.getElementById('resumo-avatar').textContent = histFuncAtual.nome.charAt(0).toUpperCase();
  document.getElementById('resumo-nome').textContent   = histFuncAtual.nome;
  
  const turnoInfo = (histFuncAtual.turnos && histFuncAtual.turnos.length) 
    ? `${histFuncAtual.turnos.length} Turnos` 
    : (TURNO_LABEL[histFuncAtual.turno] || histFuncAtual.turno || 'Geral');

  document.getElementById('resumo-cargo').textContent  = histFuncAtual.cargo + ' · ' + turnoInfo;
  document.getElementById('resumo-total-horas').textContent    = fmtHoras(histFuncAtual.totalHorasExtras || 0);
  document.getElementById('resumo-total-registros').textContent = todosRegistros.length;
}

function renderHistorico(registros) {
  const lista = document.getElementById('hist-lista');
  if (!registros.length) {
    lista.innerHTML = `<div class="ch-empty"><p>Nenhum registro encontrado.</p></div>`; return;
  }

  // Agrupar por mês/ano
  const grupos = {};
  registros.forEach(r => {
    const dataObj = r.lancadoEm?.toDate ? r.lancadoEm.toDate() : new Date();
    const mesAno = dataObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    if (!grupos[mesAno]) grupos[mesAno] = [];
    grupos[mesAno].push(r);
  });

  let html = '';
  for (const [mesAno, items] of Object.entries(grupos)) {
    const mesCapitalizado = mesAno.charAt(0).toUpperCase() + mesAno.slice(1);
    html += `<div class="hist-mes-header">${mesCapitalizado}</div>`;
    
    html += items.map(r => {
      const data = r.lancadoEm?.toDate ? r.lancadoEm.toDate().toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
      const tipo = r.tipo === 'evento' ? 'tipo-evento Evento' : 'tipo-manual Manual';
      const [tipoClass, tipoLabel] = tipo.split(' ');
      
      const valor = Number(r.horasExtras || 0);
      const valorFormatado = (valor >= 0 ? '+' : '') + fmtHoras(valor);
      const valorClasse = valor >= 0 ? 'hist-horas-pos' : 'hist-horas-neg';

      return `
        <div class="hist-registro-card">
          <span class="hist-tipo-badge ${tipoClass}">${tipoLabel}</span>
          <div class="hist-registro-info">
            <div class="hist-registro-desc">${esc(r.descricao)}</div>
            <div class="hist-registro-data">${data}</div>
          </div>
          <div class="hist-registro-horas">
            <span class="hist-horas-valor ${valorClasse}">${valorFormatado}</span>
            <span class="hist-horas-label">${valor >= 0 ? 'extras' : 'ajuste'}</span>
          </div>
        </div>`;
    }).join('');
  }
  
  lista.innerHTML = html;
}

function exportarCSV() {
  if (!histFuncAtual || !todosRegistros.length) return;

  const linhas = [
    ['Data', 'Tipo', 'Descrição', 'Horas Extras', 'Funcionário'],
    ...todosRegistros.map(r => {
      const data = r.lancadoEm?.toDate ? r.lancadoEm.toDate().toLocaleString('pt-BR') : '';
      return [data, r.tipo, r.descricao, Number(r.horasExtras||0).toFixed(2), histFuncAtual.nome];
    })
  ];

  const csv = linhas.map(l => l.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `historico_${histFuncAtual.nome.replace(/\s+/g,'_')}_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('📥 CSV exportado com sucesso!', 'success');
}

// ================================================================
//  UTILITÁRIOS
// ================================================================
function abrirModal(id)  { document.getElementById(id).classList.add('active'); }
function fecharModal(id) { document.getElementById(id).classList.remove('active'); }

// Converte 1.5 -> "1h 30m"
function fmtHoras(decimal) {
  const totalMinutos = Math.round(Math.abs(decimal) * 60);
  const h = Math.floor(totalMinutos / 60);
  const m = totalMinutos % 60;
  const sinal = decimal < 0 ? '-' : '';
  return `${sinal}${h}h ${m < 10 ? '0' : ''}${m}m`;
}

let toastTimer = null;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `ch-toast ch-toast toast-${type}`;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}
