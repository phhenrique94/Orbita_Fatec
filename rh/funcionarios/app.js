// ================================================================
//  ÓRBITA — MÓDULO FUNCIONÁRIOS (RH)
//  Gestão de cadastro e turnos de colaboradores
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
// MOCK ADAPTER PARA API REST
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
const orderBy = (field, dir) => ({ type: 'orderBy', field, dir });

const getDocs = async (path) => {
    const data = await apiFetch(`/carga-horaria/${path}`);
    return { docs: data.map(d => ({
        id: d.id, 
        data: () => d
    }))};
};

const addDoc = async (col, data) => {
    const res = await apiFetch(`/carga-horaria/${col}`, { method: 'POST', body: JSON.stringify(data) });
    return { id: res.id };
};

const updateDoc = async (path, data) => {
    const [col, id] = path.split('/');
    await apiFetch(`/carga-horaria/${col}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
};

const deleteDoc = async (path) => {
    const [col, id] = path.split('/');
    await apiFetch(`/carga-horaria/${col}/${id}`, { method: 'DELETE' });
};

const serverTimestamp = () => new Date().toISOString();

const onSnapshot = (path, callback) => {
    const fetchIt = () => getDocs(path).then(callback).catch(()=>{});
    fetchIt();
    const interval = setInterval(fetchIt, 30000);
    return () => clearInterval(interval);
};

// ---- Estado global ----
let currentUser     = null;
let allFuncionarios = [];
let editingFuncId   = null;

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

    setupLayout(user, role, 'funcionarios', async () => {
      await signOut(auth);
      window.location.href = '/login.html';
    });

  } catch(e) {
    document.getElementById('auth-guard').classList.remove('hidden'); return;
  }

  document.getElementById('app').classList.remove('hidden');
  inicializar();
});

function inicializar() {
  setupModalFuncionario();
  carregarFuncionarios();
}

function carregarFuncionarios() {
  const colRef = collection(db, 'funcionarios_rh');
  onSnapshot(query(colRef, orderBy('nome')), snap => {
    allFuncionarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFuncionarios(allFuncionarios);
  });

  document.getElementById('search-func').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderFuncionarios(allFuncionarios.filter(f => f.nome.toLowerCase().includes(q) || f.cargo.toLowerCase().includes(q)));
  });
}

function renderFuncionarios(lista) {
  const el = document.getElementById('lista-funcionarios');
  
  if (!lista.length) {
    el.innerHTML = `<div class="ch-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><p>Nenhum funcionário encontrado.</p></div>`;
    return;
  }

  el.innerHTML = lista.map(f => {
    // Monta badges dos turnos
    const turnosBadges = (f.turnos && f.turnos.length)
      ? f.turnos.map(t =>
          `<span class="func-badge func-badge-turno">${TURNO_LABEL[t.id]||t.id} ${t.entrada}–${t.saida} (${t.horas}h)</span>`
        ).join('')
      : `<span class="func-badge func-badge-turno">${TURNO_LABEL[f.turno]||f.turno} · ${f.horasTurno||0}h</span>`;

    return `
    <div class="func-card">
      <div class="func-avatar">${esc(f.nome.charAt(0).toUpperCase())}</div>
      <div class="func-info">
        <div class="func-nome">${esc(f.nome)}</div>
        <div class="func-meta">
          <span class="func-badge func-badge-cargo">${esc(f.cargo)}</span>
          ${turnosBadges}
        </div>
      </div>
      <div class="func-actions">
        <div class="status-wrapper">
          <span class="status-label" id="label-status-${f.id}">${f.ativo !== false ? 'Ativo' : 'Inativo'}</span>
          <label class="switch">
            <input type="checkbox" class="toggle-ativo" data-id="${f.id}" ${f.ativo !== false ? 'checked' : ''}>
            <span class="slider round"></span>
          </label>
        </div>
        <button class="icon-btn edit-btn" data-id="${f.id}" title="Editar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn delete-btn" data-id="${f.id}" data-nome="${esc(f.nome)}" title="Excluir">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.edit-btn').forEach(btn =>
    btn.addEventListener('click', () => abrirModalEditar(btn.dataset.id)));
  el.querySelectorAll('.delete-btn').forEach(btn =>
    btn.addEventListener('click', () => excluirFuncionario(btn.dataset.id, btn.dataset.nome)));

  el.querySelectorAll('.toggle-ativo').forEach(toggle => {
    toggle.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      const novoStatus = e.target.checked;
      const label = document.getElementById(`label-status-${id}`);
      label.textContent = novoStatus ? 'Ativo' : 'Inativo';
      try {
        await updateDoc(doc(db, 'funcionarios_rh', id), { ativo: novoStatus });
        showToast(`Status atualizado com sucesso!`, 'success');
      } catch (err) {
        showToast(`Erro ao atualizar status.`, 'error');
        e.target.checked = !novoStatus;
        label.textContent = !novoStatus ? 'Ativo' : 'Inativo';
      }
    });
  });
}

// ================================================================
//  MODAL FUNCIONÁRIO (criar / editar)
// ================================================================
function calcHorasTurno(entrada, saida) {
  if (!entrada || !saida) return 0;
  const [eh, em] = entrada.split(':').map(Number);
  const [sh, sm] = saida.split(':').map(Number);
  let diff = (sh * 60 + sm) - (eh * 60 + em);
  if (diff <= 0) diff += 24 * 60; // turno atravessa meia-noite
  return Math.round(diff / 60 * 100) / 100;
}

function atualizarTotalTurnos() {
  let total = 0;
  ['manha','tarde','noite'].forEach(t => {
    if (document.getElementById(`turno-check-${t}`).checked) {
      total += calcHorasTurno(
        document.getElementById(`entrada-${t}`).value,
        document.getElementById(`saida-${t}`).value
      );
    }
  });
  document.getElementById('turno-total-horas').textContent =
    total > 0 ? `${total.toFixed(1)}h` : '0h';
}

function atualizarCalcTurno(id) {
  const h = calcHorasTurno(
    document.getElementById(`entrada-${id}`).value,
    document.getElementById(`saida-${id}`).value
  );
  const el = document.getElementById(`calc-${id}`);
  el.textContent = h > 0 ? `${h.toFixed(1)}h` : '—';
  atualizarTotalTurnos();
}

function resetarTurnos() {
  ['manha','tarde','noite'].forEach(t => {
    const check = document.getElementById(`turno-check-${t}`);
    check.checked = false;
    document.getElementById(`bloco-${t}`).classList.remove('ativo');
    document.getElementById(`horarios-${t}`).classList.add('hidden');
    document.getElementById(`entrada-${t}`).value = '';
    document.getElementById(`saida-${t}`).value = '';
    document.getElementById(`calc-${t}`).textContent = '—';
  });
  document.getElementById('turno-total-horas').textContent = '0h';
}

function setupModalFuncionario() {
  document.getElementById('btn-novo-func').addEventListener('click', () => {
    editingFuncId = null;
    document.getElementById('modal-func-titulo').textContent = 'Novo Funcionário';
    document.getElementById('form-func').reset();
    resetarTurnos();
    document.getElementById('func-btn-text').textContent = 'Salvar';
    abrirModal('modal-func');
  });
  document.getElementById('btn-fechar-modal-func').addEventListener('click', () => fecharModal('modal-func'));
  document.getElementById('btn-cancelar-modal-func').addEventListener('click', () => fecharModal('modal-func'));
  document.getElementById('form-func').addEventListener('submit', salvarFuncionario);

  // Checkboxes dos turnos
  ['manha','tarde','noite'].forEach(t => {
    const check = document.getElementById(`turno-check-${t}`);
    const bloco = document.getElementById(`bloco-${t}`);
    const horarios = document.getElementById(`horarios-${t}`);
    check.addEventListener('change', () => {
      if (check.checked) {
        bloco.classList.add('ativo');
        horarios.classList.remove('hidden');
      } else {
        bloco.classList.remove('ativo');
        horarios.classList.add('hidden');
        document.getElementById(`entrada-${t}`).value = '';
        document.getElementById(`saida-${t}`).value = '';
        document.getElementById(`calc-${t}`).textContent = '—';
        atualizarTotalTurnos();
      }
    });
    // Recalcula ao mudar horários
    document.getElementById(`entrada-${t}`).addEventListener('change', () => atualizarCalcTurno(t));
    document.getElementById(`saida-${t}`).addEventListener('change', () => atualizarCalcTurno(t));
  });
}

function abrirModalEditar(id) {
  const f = allFuncionarios.find(x => x.id === id);
  if (!f) return;
  editingFuncId = id;
  document.getElementById('modal-func-titulo').textContent = 'Editar Funcionário';
  document.getElementById('func-nome').value = f.nome;
  document.getElementById('func-cargo').value = f.cargo;
  resetarTurnos();

  // Restaura turnos
  const turnos = f.turnos || [];
  turnos.forEach(t => {
    const check = document.getElementById(`turno-check-${t.id}`);
    if (!check) return;
    check.checked = true;
    document.getElementById(`bloco-${t.id}`).classList.add('ativo');
    document.getElementById(`horarios-${t.id}`).classList.remove('hidden');
    document.getElementById(`entrada-${t.id}`).value = t.entrada || '';
    document.getElementById(`saida-${t.id}`).value = t.saida || '';
    atualizarCalcTurno(t.id);
  });

  document.getElementById('func-btn-text').textContent = 'Salvar Alterações';
  abrirModal('modal-func');
}

async function salvarFuncionario(e) {
  e.preventDefault();
  const nome    = document.getElementById('func-nome').value.trim();
  const cargo   = document.getElementById('func-cargo').value.trim();
  const errEl   = document.getElementById('func-form-error');
  const btnText = document.getElementById('func-btn-text');

  const turnos = [];
  let horasTurno = 0;
  ['manha','tarde','noite'].forEach(t => {
    const check = document.getElementById(`turno-check-${t}`);
    if (!check.checked) return;
    const entrada = document.getElementById(`entrada-${t}`).value;
    const saida   = document.getElementById(`saida-${t}`).value;
    const horas   = calcHorasTurno(entrada, saida);
    turnos.push({ id: t, entrada, saida, horas });
    horasTurno += horas;
  });

  errEl.classList.add('hidden');
  if (!turnos.length) {
    errEl.textContent = 'Selecione ao menos um turno com os horários de entrada e saída.';
    errEl.classList.remove('hidden'); return;
  }
  const semHorario = turnos.find(t => !t.entrada || !t.saida);
  if (semHorario) {
    errEl.textContent = `Preencha entrada e saída do turno de ${TURNO_LABEL[semHorario.id]}.`;
    errEl.classList.remove('hidden'); return;
  }

  btnText.textContent = 'Salvando...';
  const dados = { nome, cargo, turnos, horasTurno: Math.round(horasTurno * 100) / 100 };

  try {
    if (editingFuncId) {
      await updateDoc(doc(db, 'funcionarios_rh', editingFuncId), dados);
      showToast('✅ Funcionário atualizado!', 'success');
    } else {
      await addDoc(collection(db, 'funcionarios_rh'), {
        ...dados, totalHorasExtras: 0, criadoEm: serverTimestamp(), ativo: true
      });
      showToast('✅ Funcionário cadastrado!', 'success');
    }
    fecharModal('modal-func');
  } catch(err) {
    errEl.textContent = 'Erro ao salvar: ' + err.message;
    errEl.classList.remove('hidden');
  } finally {
    btnText.textContent = editingFuncId ? 'Salvar Alterações' : 'Salvar';
  }
}

async function excluirFuncionario(id, nome) {
  if (!confirm(`Excluir "${nome}"?\n\nOs registros de horas deste funcionário serão mantidos.`)) return;
  try {
    await deleteDoc(doc(db, 'funcionarios_rh', id));
    showToast(`🗑️ ${nome} removido.`, 'success');
  } catch(err) {
    showToast('❌ Erro ao excluir: ' + err.message, 'error');
  }
}

function showToast(msg, type) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `ch-toast toast-${type}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

window.abrirModal = (id) => document.getElementById(id).classList.remove('hidden');
window.fecharModal = (id) => document.getElementById(id).classList.add('hidden');
