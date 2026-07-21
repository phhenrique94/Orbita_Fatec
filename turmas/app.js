import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { firebaseConfig } from "../core/firebase-config.js";
import { setupLayout, getCachedAuth, setCachedAuth, clearCachedAuth } from '../core/layout.js';
import { getEffectiveLevel } from '../core/permissions.js';

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);

const API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.')) 
  ? `http://${window.location.hostname}:3000/api` 
  : '/api';

let currentUser = null;
let currentRole = null;
let userLevel = 1;
let turmas = [];
let appInitialized = false;
let initializedRole = null;

async function apiFetch(endpoint, options = {}) {
  const token = await currentUser.getIdToken();
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erro na API: ${res.status}`);
  }
  return res.json();
}

// ==========================================
// AUTH GUARD E INICIALIZAÇÃO
// ==========================================
const cached = getCachedAuth();
if (cached && (cached.role === 'adm_l1' || cached.role === 'adm_l2')) {
  currentUser = cached.user;
  currentRole = cached.role;
  initApp(cached.user, cached.role);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    clearCachedAuth();
    window.location.href = '../auth/login.html';
    return;
  }
  
  currentUser = user;
  try {
    const token = await user.getIdToken();
    let role = 'visitante';
    let meuOverrides = null;
    try {
      const userData = await apiFetch('/usuarios/me');
      role = userData.role || 'visitante';
      meuOverrides = userData.permissoes || null;
    } catch (err) {
      role = cached ? cached.role : 'visitante';
    }

    setCachedAuth(user, role, token);

    // Nível EFETIVO: override individual do usuário vence o do cargo
    let level = 1;
    if (role === 'adm_l1') {
      level = 3;
    } else {
      try {
        const perms = await apiFetch('/usuarios/config/permissions');
        level = getEffectiveLevel(perms[role] || {}, meuOverrides, 'turmas');
      } catch (e) {
        // Fallback para defaults do middleware
        if (role === 'adm_l2') level = 3;
      }
    }
    userLevel = level;

    // Se não tiver permissão de visualização (nível < 2), manda pro meu espaço
    if (level < 2) {
      window.location.href = '../meu-espaco/index.html';
      return;
    }

    // Se não tiver permissão de escrita (nível < 3), oculta elementos de ação
    if (level < 3) {
      document.body.classList.add('hide-execute');
      document.getElementById('btn-nova-turma')?.classList.add('hidden');
    } else {
      document.body.classList.remove('hide-execute');
      document.getElementById('btn-nova-turma')?.classList.remove('hidden');
    }

    if (!appInitialized || initializedRole !== role || (cached && (cached.user.displayName !== user.displayName || cached.user.email !== user.email))) {
      currentRole = role;
      initApp(user, role);
    }
  } catch (err) {
    console.error("Erro na revalidação de auth:", err);
  }
});

async function initApp(user, role) {
  if (appInitialized && initializedRole === role) return;
  appInitialized = true;
  initializedRole = role;

  // Inicializa a navegação
  setupLayout(user, role, 'turmas', async () => {
    clearCachedAuth();
    await signOut(auth);
    window.location.href = '../auth/login.html';
  });

  // Mostra a tela
  document.getElementById('app').classList.remove('hidden');
  
  setupFilters();
  setupEventListeners();
  setupCSVModal();
  await loadTurmas();
}

// ==========================================
// FUNÇÕES DO MÓDULO (CRUD & FILTROS)
// ==========================================

async function loadTurmas() {
  try {
    const listContainer = document.getElementById('turmas-list');
    listContainer.innerHTML = '<div class="empty-state"><p>Carregando turmas...</p></div>';

    turmas = await apiFetch('/turmas');

    // Se o banco estiver vazio e formos administradores, criar dados iniciais (seeding)
    if (turmas.length === 0 && userLevel >= 3) {
      const seeds = [
        {
          disciplina: "Algoritmos e Estrutura de Dados",
          curso: "Análise e Desenvolvimento de Sistemas",
          codigo: "ADS1A",
          periodo: "M",
          sala: "Lab 3",
          alunos: 38,
          professor: "Prof. Dr. Valdinei Junior"
        },
        {
          disciplina: "Programação Orientada a Objetos",
          curso: "Análise e Desenvolvimento de Sistemas",
          codigo: "ADS2B",
          periodo: "N",
          sala: "Lab 2",
          alunos: 32,
          professor: "Prof. Dr. Valdinei Junior"
        },
        {
          disciplina: "Engenharia de Software",
          curso: "Análise e Desenvolvimento de Sistemas",
          codigo: "ADS3A",
          periodo: "M",
          sala: "Sala 204",
          alunos: 40,
          professor: "Prof. Esp. Valdinei Junior"
        }
      ];

      for (const item of seeds) {
        await apiFetch('/turmas', {
          method: 'POST',
          body: JSON.stringify(item)
        });
      }

      // Recarregar após o seeding
      turmas = await apiFetch('/turmas');
    }

    applyFilters();
  } catch (err) {
    showToast("Erro ao carregar turmas: " + err.message, "error");
  }
}

function applyFilters() {
  const query = (document.getElementById('search-turmas')?.value || '').toLowerCase();
  const periodo = document.getElementById('filter-periodo')?.value || '';

  const filtered = turmas.filter(item => {
    const matchQuery = !query ||
      (item.disciplina || '').toLowerCase().includes(query) ||
      (item.curso || '').toLowerCase().includes(query) ||
      (item.codigo || '').toLowerCase().includes(query) ||
      (item.professor || '').toLowerCase().includes(query) ||
      (item.sala || '').toLowerCase().includes(query);

    const matchPeriodo = !periodo || item.periodo === periodo;
    return matchQuery && matchPeriodo;
  });

  const hasFilters = !!(query || periodo);
  document.getElementById('btn-clear-filters')?.classList.toggle('hidden', !hasFilters);

  renderTurmas(filtered);
}

function renderTurmas(lista) {
  const container = document.getElementById('turmas-list');
  container.innerHTML = '';

  if (lista.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--text-secondary); opacity: 0.6;">
          <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
          <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
        </svg>
        <p>${turmas.length ? 'Nenhuma turma corresponde aos filtros de busca.' : 'Nenhuma turma cadastrada.'}</p>
      </div>
    `;
    return;
  }

  lista.forEach(item => {
    const card = document.createElement('div');
    card.className = `turma-card period-${item.periodo}`;
    
    const periodoExtenso = item.periodo === 'M' ? 'Matutino' : item.periodo === 'V' ? 'Vespertino' : 'Noturno';

    card.innerHTML = `
      <div class="turma-card-header">
        <span class="turma-badge">${item.sala}</span>
        <div class="turma-period-badge">${periodoExtenso}</div>
        <h3 class="turma-subject">${item.disciplina} <span class="turma-code">${item.codigo}</span></h3>
        <div class="turma-course">${item.curso}</div>
      </div>
      <div class="turma-card-body">
        <div class="info-item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          <span class="info-label">Professor:</span>
          <strong>${item.professor}</strong>
        </div>
        <div class="info-item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span class="info-label">Alunos:</span>
          <strong>${item.alunos} matriculados</strong>
        </div>
      </div>
      <div class="turma-card-footer action-execute">
        <button class="btn-card-action btn-edit-turma" data-id="${item.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Editar
        </button>
        <button class="btn-card-action danger btn-delete-turma" data-id="${item.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          Excluir
        </button>
      </div>
    `;

    // Ações dos botões dentro do card
    card.querySelector('.btn-edit-turma').onclick = () => openEditModal(item.id);
    card.querySelector('.btn-delete-turma').onclick = () => deleteTurma(item.id, item.disciplina);

    container.appendChild(card);
  });
}

function setupFilters() {
  document.getElementById('search-turmas')?.addEventListener('input', applyFilters);
  document.getElementById('filter-periodo')?.addEventListener('change', applyFilters);
  document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
    document.getElementById('search-turmas').value = '';
    document.getElementById('filter-periodo').value = '';
    applyFilters();
  });
}

function setupEventListeners() {
  document.getElementById('btn-nova-turma')?.addEventListener('click', openAddModal);
  document.getElementById('btn-cancelar-turma')?.addEventListener('click', closeModal);
  document.getElementById('form-turma')?.addEventListener('submit', handleFormSubmit);
}

function openAddModal() {
  const form = document.getElementById('form-turma');
  form.reset();
  document.getElementById('turma-id').value = '';
  document.getElementById('modal-title').innerText = 'Nova Turma';
  document.getElementById('modal-turma').classList.remove('hidden');
}

function openEditModal(id) {
  const item = turmas.find(t => t.id === id);
  if (!item) return;

  document.getElementById('turma-id').value = item.id;
  document.getElementById('turma-disciplina').value = item.disciplina || '';
  document.getElementById('turma-curso').value = item.curso || '';
  document.getElementById('turma-codigo').value = item.codigo || '';
  document.getElementById('turma-periodo').value = item.periodo || '';
  document.getElementById('turma-sala').value = item.sala || '';
  document.getElementById('turma-alunos').value = item.alunos || 0;
  document.getElementById('turma-professor').value = item.professor || '';

  document.getElementById('modal-title').innerText = 'Editar Turma';
  document.getElementById('modal-turma').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-turma').classList.add('hidden');
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('turma-id').value;
  const data = {
    disciplina: document.getElementById('turma-disciplina').value.trim(),
    curso: document.getElementById('turma-curso').value.trim(),
    codigo: document.getElementById('turma-codigo').value.trim().toUpperCase(),
    periodo: document.getElementById('turma-periodo').value,
    sala: document.getElementById('turma-sala').value.trim(),
    alunos: parseInt(document.getElementById('turma-alunos').value) || 0,
    professor: document.getElementById('turma-professor').value.trim()
  };

  const submitBtn = document.getElementById('btn-salvar-turma');
  submitBtn.disabled = true;
  submitBtn.innerText = 'Processando...';

  try {
    if (id) {
      await apiFetch(`/turmas/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      showToast("✅ Turma atualizada com sucesso!");
    } else {
      await apiFetch(`/turmas`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      showToast("✅ Turma criada com sucesso!");
    }
    closeModal();
    await loadTurmas();
  } catch (err) {
    showToast("❌ Erro ao salvar: " + err.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = 'Salvar';
  }
}

async function deleteTurma(id, disciplina) {
  if (!confirm(`Tem certeza que deseja excluir permanentemente a turma de "${disciplina}"?`)) return;

  try {
    await apiFetch(`/turmas/${id}`, {
      method: 'DELETE'
    });
    showToast("🗑️ Turma removida com sucesso!");
    await loadTurmas();
  } catch (err) {
    showToast("❌ Erro ao excluir: " + err.message, "error");
  }
}

// Toast helper
let toastTimer = null;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = msg;
  toast.className = `toast toast-${type}`;
  toast.classList.remove('hidden');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

// ==========================================
// IMPORTAÇÃO VIA CSV
// ==========================================

let parsedCSVData = null;

function setupCSVModal() {
  const btnImport   = document.getElementById('btn-importar-csv');
  const modalCSV    = document.getElementById('modal-csv');
  const dropZone    = document.getElementById('csv-drop-zone');
  const fileInput   = document.getElementById('csv-file-input');
  const btnFechar   = document.getElementById('btn-fechar-csv');
  const btnVoltar   = document.getElementById('btn-voltar-csv');
  const btnConfirm  = document.getElementById('btn-confirmar-csv');

  btnImport?.addEventListener('click', () => {
    resetCSVModal();
    modalCSV.classList.remove('hidden');
  });

  btnFechar?.addEventListener('click', () => modalCSV.classList.add('hidden'));

  // Fecha ao clicar no overlay (fora do modal)
  modalCSV?.addEventListener('click', (e) => {
    if (e.target === modalCSV) modalCSV.classList.add('hidden');
  });

  btnVoltar?.addEventListener('click', () => showCSVStep(1));
  btnConfirm?.addEventListener('click', importarTurmaCSV);

  // Drag and Drop
  dropZone?.addEventListener('click', () => fileInput.click());

  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragging');
  });

  dropZone?.addEventListener('dragleave', (e) => {
    if (!dropZone.contains(e.relatedTarget)) {
      dropZone.classList.remove('dragging');
    }
  });

  dropZone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (file) processCSVFile(file);
  });

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processCSVFile(file);
  });
}

function resetCSVModal() {
  parsedCSVData = null;
  const fileInput = document.getElementById('csv-file-input');
  if (fileInput) fileInput.value = '';
  const dropZone = document.getElementById('csv-drop-zone');
  dropZone?.classList.remove('dragging', 'has-file');
  showCSVStep(1);
}

function showCSVStep(step) {
  // Atualiza visibilidade das etapas
  document.querySelectorAll('.csv-step').forEach(s => s.classList.add('hidden'));
  document.getElementById(`csv-step-${step}`)?.classList.remove('hidden');

  // Atualiza indicador de progresso
  const dot1 = document.getElementById('step-dot-1');
  const dot2 = document.getElementById('step-dot-2');
  const line = document.querySelector('.csv-step-line');

  if (step === 1) {
    dot1?.classList.add('active'); dot1?.classList.remove('done');
    dot2?.classList.remove('active', 'done');
    line?.classList.remove('done');
  } else {
    dot1?.classList.remove('active'); dot1?.classList.add('done');
    dot2?.classList.add('active');
    line?.classList.add('done');
  }
}

function processCSVFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showToast('❌ Selecione um arquivo .csv válido', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const arrayBuffer = e.target.result;
      let text = '';
      
      try {
        // Tenta decodificar como UTF-8 estrito
        const decoderUTF8 = new TextDecoder('utf-8', { fatal: true });
        text = decoderUTF8.decode(arrayBuffer);
      } catch (err) {
        // Fallback para ISO-8859-1 (muito comum em exportações SIGA no Brasil)
        const decoderISO = new TextDecoder('iso-8859-1');
        text = decoderISO.decode(arrayBuffer);
      }

      parsedCSVData = parseAlunosCSV(text);

      // Marca a drop zone como com arquivo
      const dropZone = document.getElementById('csv-drop-zone');
      dropZone?.classList.add('has-file');

      renderCSVStep2(parsedCSVData);
      showCSVStep(2);
    } catch (err) {
      showToast('❌ Erro ao processar CSV: ' + err.message, 'error');
    }
  };
  reader.onerror = () => showToast('❌ Não foi possível ler o arquivo.', 'error');
  reader.readAsArrayBuffer(file);
}

/**
 * Parseia o CSV no formato exportado pelo SIGA/sistema acadêmico:
 *   Linha 0: "ALUNOS DA TURMA"
 *   Linha 1: "Turma,Sem.,Período"
 *   Linha 2: "AGRONOMIA 1 - 2026/1,2026/1,1"
 *   Linha 3: "Nome"
 *   Linhas 4+: nomes dos alunos
 */
function parseAlunosCSV(text) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim());

  // Filtra linhas completamente vazias mas mantém índices
  if (lines.length < 4) {
    throw new Error('Arquivo CSV inválido ou muito curto. Verifique o formato.');
  }

  // Linha 2: dados da turma
  const turmaLine = lines[2].split(',');
  const turmaNome  = turmaLine[0]?.trim() || '';
  const semestre   = turmaLine[1]?.trim() || '';
  const periodoNum = turmaLine[2]?.trim() || '';

  if (!turmaNome) {
    throw new Error('Não foi possível detectar o nome da turma no CSV.');
  }

  // Extrai o nome base: "AGRONOMIA 1 - 2026/1" → "AGRONOMIA 1"
  const turmaBase  = turmaNome.split(' - ')[0].trim();

  // Extrai o curso: remove dígitos do final para obter só o nome do curso
  // "AGRONOMIA 1" → "AGRONOMIA", "ADS 2" → "ADS"
  const cursoNome = turmaBase.replace(/\s+\d+$/, '').trim() || turmaBase;

  // Mapeamento do número do período: 1→Matutino, 2→Vespertino, 3→Noturno
  const periodoMap = { '1': 'M', '2': 'V', '3': 'N' };
  const periodo = periodoMap[periodoNum] || '';

  // Encontra o índice do cabeçalho "Nome"
  const headerIdx = lines.findIndex(l => l.toLowerCase() === 'nome');
  const startIdx  = headerIdx >= 0 ? headerIdx + 1 : 4;

  // Coleta nomes dos alunos (ignora linhas vazias)
  const alunos = lines.slice(startIdx).filter(l => l.length > 0);

  if (alunos.length === 0) {
    throw new Error('Nenhum aluno encontrado no arquivo CSV.');
  }

  return {
    turmaNome,
    turmaBase,
    cursoNome,
    semestre,
    periodoNum,
    periodo,
    alunos,
    totalAlunos: alunos.length
  };
}

function renderCSVStep2(data) {
  // Preenche os cards de info detectada
  document.getElementById('csv-info-turma').textContent    = data.turmaNome || '—';
  document.getElementById('csv-info-semestre').textContent = data.semestre  || '—';
  document.getElementById('csv-info-alunos').textContent   = `${data.totalAlunos} aluno${data.totalAlunos !== 1 ? 's' : ''}`;

  // Pré-preenche o formulário com dados detectados
  document.getElementById('csv-disciplina').value = data.turmaBase;
  document.getElementById('csv-curso').value       = data.cursoNome;
  document.getElementById('csv-periodo').value     = data.periodo;
  document.getElementById('csv-professor').value   = '';

  // Renderiza a lista de alunos no preview collapsível
  const ul = document.getElementById('csv-alunos-list');
  if (ul) {
    ul.innerHTML = data.alunos
      .map((nome, i) => `<li><strong style="color:var(--text-secondary);font-size:0.75rem;min-width:20px">${i + 1}.</strong> ${nome}</li>`)
      .join('');
  }
}

async function importarTurmaCSV() {
  if (!parsedCSVData) return;

  const disciplina = document.getElementById('csv-disciplina').value.trim();
  const curso      = document.getElementById('csv-curso').value.trim();
  const periodo    = document.getElementById('csv-periodo').value;
  const professor  = document.getElementById('csv-professor').value.trim();

  if (!disciplina || !curso || !periodo || !professor) {
    showToast('❌ Preencha todos os campos obrigatórios antes de importar.', 'error');
    return;
  }

  const btn = document.getElementById('btn-confirmar-csv');
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `
    <svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg> Importando...
  `;

  try {
    await apiFetch('/turmas/import', {
      method: 'POST',
      body: JSON.stringify({
        disciplina,
        curso,
        codigo: '',
        periodo,
        sala: '',
        professor,
        alunos:      parsedCSVData.totalAlunos,
        listaAlunos: parsedCSVData.alunos,
        semestre:    parsedCSVData.semestre
      })
    });

    document.getElementById('modal-csv').classList.add('hidden');
    showToast(`✅ "${disciplina}" importada com ${parsedCSVData.totalAlunos} alunos!`);
    await loadTurmas();
  } catch (err) {
    showToast('❌ Erro ao importar: ' + err.message, 'error');
  } finally {
    btn.disabled  = false;
    btn.innerHTML = originalHTML;
  }
}
