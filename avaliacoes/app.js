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
let avaliacoes = [];
let turmas = [];
let appInitialized = false;
let initializedRole = null;

// State for questions
let questoesEmEdicao = [];

function adicionarQuestao(tipo) {
  if (tipo === 'escolha') {
    questoesEmEdicao.push({
      tipo: 'escolha',
      pergunta: '',
      opcoes: { a: '', b: '', c: '', d: '', e: '' },
      corretas: { a: false, b: false, c: false, d: false, e: false }
    });
  } else {
    questoesEmEdicao.push({
      tipo: 'descritiva',
      pergunta: ''
    });
  }
  renderizarQuestoesForm();
}

function removerQuestao(index) {
  questoesEmEdicao.splice(index, 1);
  renderizarQuestoesForm();
}

function renderizarQuestoesForm() {
  const container = document.getElementById('questions-list-container');
  if (!container) return;
  container.innerHTML = '';

  if (questoesEmEdicao.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-secondary); font-size: 0.85rem; padding: 1.25rem; border: 1px dashed var(--border-color); border-radius: 8px;">Nenhuma questão adicionada a esta avaliação.</div>`;
    return;
  }

  questoesEmEdicao.forEach((q, index) => {
    const card = document.createElement('div');
    card.className = 'questao-card-form';
    
    let optionsHtml = '';
    if (q.tipo === 'escolha') {
      optionsHtml = `
        <div class="alternativas-grid-form">
          ${['a', 'b', 'c', 'd', 'e'].map(opt => `
            <div class="alternativa-item-form">
              <div class="alternativa-input-row">
                <span>${opt.toUpperCase()}</span>
                <input type="text" class="option-input-${opt}" placeholder="Texto da alternativa ${opt.toUpperCase()}..." value="${q.opcoes[opt] || ''}" required>
              </div>
              <label class="correct-checkbox-label ${q.corretas && q.corretas[opt] ? 'is-checked' : ''}">
                <input type="checkbox" class="checkbox-correct-${opt}" ${q.corretas && q.corretas[opt] ? 'checked' : ''}>
                Opção ${opt.toUpperCase()} é a verdadeira
              </label>
            </div>
          `).join('')}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="questao-header-form">
        <span class="questao-title-badge ${q.tipo === 'escolha' ? 'badge-escolha' : 'badge-descritiva'}">
          Questão ${index + 1} - ${q.tipo === 'escolha' ? 'Múltipla Escolha' : 'Descritiva'}
        </span>
        <button type="button" class="btn-remove-question" title="Remover Questão">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <textarea class="question-title-input" rows="2" placeholder="Escreva o enunciado da pergunta..." required>${q.pergunta || ''}</textarea>
      </div>
      ${optionsHtml}
    `;

    // Event listeners for inputs to keep data array in sync
    card.querySelector('.question-title-input').addEventListener('input', (e) => {
      questoesEmEdicao[index].pergunta = e.target.value;
    });

    if (q.tipo === 'escolha') {
      ['a', 'b', 'c', 'd', 'e'].forEach(opt => {
        card.querySelector(`.option-input-${opt}`).addEventListener('input', (e) => {
          questoesEmEdicao[index].opcoes[opt] = e.target.value;
        });

        const chk = card.querySelector(`.checkbox-correct-${opt}`);
        chk.addEventListener('change', (e) => {
          const isChecked = e.target.checked;
          if (isChecked) {
            // Exclusividade
            ['a', 'b', 'c', 'd', 'e'].forEach(o => {
              questoesEmEdicao[index].corretas[o] = (o === opt);
              const siblingChk = card.querySelector(`.checkbox-correct-${o}`);
              const label = siblingChk.closest('.correct-checkbox-label');
              if (siblingChk && o !== opt) {
                siblingChk.checked = false;
              }
              if (label) {
                label.classList.toggle('is-checked', o === opt);
              }
            });
          } else {
            questoesEmEdicao[index].corretas[opt] = false;
            chk.closest('.correct-checkbox-label').classList.remove('is-checked');
          }
        });
      });
    }

    card.querySelector('.btn-remove-question').onclick = () => removerQuestao(index);

    container.appendChild(card);
  });
}

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
        level = getEffectiveLevel(perms[role] || {}, meuOverrides, 'avaliacoes');
      } catch (e) {
        if (role === 'adm_l2') level = 3;
      }
    }
    userLevel = level;

    // Se não tiver permissão de visualização (nível < 2), redireciona
    if (level < 2) {
      window.location.href = '../meu-espaco/index.html';
      return;
    }

    // Se não tiver permissão de escrita (nível < 3), oculta elementos de ação
    if (level < 3) {
      document.body.classList.add('hide-execute');
      document.getElementById('btn-nova-avaliacao')?.classList.add('hidden');
    } else {
      document.body.classList.remove('hide-execute');
      document.getElementById('btn-nova-avaliacao')?.classList.remove('hidden');
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
  setupLayout(user, role, 'avaliacoes', async () => {
    clearCachedAuth();
    await signOut(auth);
    window.location.href = '../auth/login.html';
  });

  // Mostra a tela
  document.getElementById('app').classList.remove('hidden');
  
  setupFilters();
  setupEventListeners();
  await loadTurmas();
  await loadAvaliacoes();
}

// ==========================================
// CARREGAMENTO DE DADOS
// ==========================================

async function loadTurmas() {
  try {
    turmas = await apiFetch('/turmas');
    
    // Preenche selects de turmas nos filtros e modal
    const filterSelect = document.getElementById('filter-turma');
    const formSelect = document.getElementById('avaliacao-turma');
    
    if (filterSelect) {
      filterSelect.innerHTML = '<option value="">Todas as Turmas</option>' + 
        turmas.map(t => `<option value="${t.id}">${t.disciplina} (${t.periodo})</option>`).join('');
    }
    
    if (formSelect) {
      formSelect.innerHTML = '<option value="">Selecione a turma...</option>' + 
        turmas.map(t => `<option value="${t.id}">${t.disciplina} (${t.periodo})</option>`).join('');
    }
  } catch (err) {
    showToast("Erro ao carregar turmas: " + err.message, "error");
  }
}

async function loadAvaliacoes() {
  try {
    const listContainer = document.getElementById('avaliacoes-list');
    listContainer.innerHTML = '<div class="empty-state"><p>Carregando avaliações...</p></div>';

    avaliacoes = await apiFetch('/avaliacoes');
    applyFilters();
  } catch (err) {
    showToast("Erro ao carregar avaliações: " + err.message, "error");
  }
}

// ==========================================
// FILTROS E PESQUISA
// ==========================================

function applyFilters() {
  const query = (document.getElementById('search-avaliacoes')?.value || '').toLowerCase();
  const turmaId = document.getElementById('filter-turma')?.value || '';

  const filtered = avaliacoes.filter(item => {
    const matchQuery = !query || 
      (item.titulo || '').toLowerCase().includes(query) || 
      (item.curso || '').toLowerCase().includes(query) ||
      (item.turmaNome || '').toLowerCase().includes(query);
      
    const matchTurma = !turmaId || item.turmaId === turmaId;
    
    return matchQuery && matchTurma;
  });

  const hasFilters = !!(query || turmaId);
  document.getElementById('btn-clear-filters')?.classList.toggle('hidden', !hasFilters);

  renderAvaliacoes(filtered);
}

function renderAvaliacoes(lista) {
  const container = document.getElementById('avaliacoes-list');
  container.innerHTML = '';

  if (lista.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--text-secondary); opacity: 0.6;">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 14h6"/><path d="M9 16h6"/><path d="M9 10h6"/><path d="M9 12h6"/>
        </svg>
        <p>${avaliacoes.length ? 'Nenhuma avaliação corresponde aos filtros de busca.' : 'Nenhuma avaliação cadastrada.'}</p>
      </div>
    `;
    return;
  }

  lista.forEach(item => {
    const card = document.createElement('div');
    card.className = `avaliacao-card`;
    
    const numQuestoes = item.questoes ? item.questoes.length : 0;
    const temEscolha = item.questoes && item.questoes.some(q => q.tipo === 'escolha');

    card.innerHTML = `
      <div class="avaliacao-card-header">
        <span class="avaliacao-turma-badge">${item.turmaNome || 'Turma não identificada'}</span>
        <span class="avaliacao-type-badge badge-curso">${item.curso || '—'}</span>
        <h3 class="avaliacao-subject">${item.titulo}</h3>
      </div>
      <div class="avaliacao-card-body">
        <div class="avaliacao-meta-grid">
          <div class="meta-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <span>Nota/Peso: <strong class="value">${item.peso}</strong></span>
          </div>
          <div class="meta-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
            <span>Questões: <strong class="value">${numQuestoes}</strong></span>
          </div>
        </div>

        <!-- Collapse de Questões -->
        ${numQuestoes > 0 ? `
        <div class="card-questions-collapse hidden" id="collapse-${item.id}">
          <div class="card-questions-list">
            ${item.questoes.map((q, qIdx) => `
              <div class="card-question-item">
                <div class="card-question-text">Questão ${qIdx + 1}: ${q.pergunta}</div>
                ${q.tipo === 'escolha' ? `
                  <div class="card-question-options">
                    ${['a', 'b', 'c', 'd', 'e'].map(opt => {
                      const text = q.opcoes ? q.opcoes[opt] : '';
                      const isCorrect = q.corretas && q.corretas[opt];
                      return `
                        <div class="card-option-item ${isCorrect ? 'correct' : ''}">
                          <span class="card-option-badge">${opt.toUpperCase()}</span>
                          <span style="flex: 1;">${text}</span>
                          ${isCorrect ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="margin-left:auto; color:var(--green);"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
                        </div>
                      `;
                    }).join('')}
                  </div>
                ` : `
                  <div style="font-size:0.75rem; color:var(--text-secondary); font-style:italic; padding-top: 0.25rem;">
                    (Questão Descritiva)
                  </div>
                `}
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}
      </div>
      <div class="avaliacao-card-footer action-execute">
        ${numQuestoes > 0 ? `
        <button class="btn-view-questions" style="margin-right: auto;" data-id="${item.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          Questões (${numQuestoes})
        </button>
        ` : ''}
        ${temEscolha ? `
        <button class="btn-card-action btn-gabaritos-avaliacao" data-id="${item.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Gabaritos
        </button>
        ` : ''}
        <button class="btn-card-action btn-edit-avaliacao" data-id="${item.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Editar
        </button>
        <button class="btn-card-action danger btn-delete-avaliacao" data-id="${item.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          Excluir
        </button>
      </div>
    `;

    // Bind events
    card.querySelector('.btn-edit-avaliacao').onclick = () => openEditModal(item.id);
    card.querySelector('.btn-delete-avaliacao').onclick = () => deleteAvaliacao(item.id, item.titulo);
    
    const btnGabaritos = card.querySelector('.btn-gabaritos-avaliacao');
    if (btnGabaritos) {
      btnGabaritos.onclick = () => abrirModalGabaritos(item.id);
    }

    const btnView = card.querySelector('.btn-view-questions');
    if (btnView) {
      btnView.onclick = () => {
        const collapse = card.querySelector('.card-questions-collapse');
        const isHidden = collapse.classList.toggle('hidden');
        btnView.classList.toggle('active', !isHidden);
      };
    }

    container.appendChild(card);
  });
}

function setupFilters() {
  document.getElementById('search-avaliacoes')?.addEventListener('input', applyFilters);
  document.getElementById('filter-turma')?.addEventListener('change', applyFilters);
  document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
    document.getElementById('search-avaliacoes').value = '';
    document.getElementById('filter-turma').value = '';
    applyFilters();
  });
}

function setupEventListeners() {
  document.getElementById('btn-nova-avaliacao')?.addEventListener('click', openAddModal);
  document.getElementById('btn-cancelar-avaliacao')?.addEventListener('click', closeModal);
  document.getElementById('form-avaliacao')?.addEventListener('submit', handleFormSubmit);

  document.getElementById('btn-add-escolha')?.addEventListener('click', () => adicionarQuestao('escolha'));
  document.getElementById('btn-add-descritiva')?.addEventListener('click', () => adicionarQuestao('descritiva'));

  // OMR Gabaritos listeners
  document.getElementById('btn-fechar-gabaritos')?.addEventListener('click', fecharModalGabaritos);
  document.getElementById('btn-imprimir-gabaritos')?.addEventListener('click', imprimirGabaritos);
}

// ==========================================
// MODAIS E SUBMISSÕES (CRUD)
// ==========================================

function openAddModal() {
  const form = document.getElementById('form-avaliacao');
  form.reset();
  document.getElementById('avaliacao-id').value = '';
  questoesEmEdicao = [];
  renderizarQuestoesForm();
  document.getElementById('modal-title').innerText = 'Nova Avaliação';
  document.getElementById('modal-avaliacao').classList.remove('hidden');
}

function openEditModal(id) {
  const item = avaliacoes.find(a => a.id === id);
  if (!item) return;

  document.getElementById('avaliacao-id').value = item.id;
  document.getElementById('avaliacao-turma').value = item.turmaId || '';
  document.getElementById('avaliacao-titulo').value = item.titulo || '';
  document.getElementById('avaliacao-curso').value = item.curso || '';
  document.getElementById('avaliacao-peso').value = item.peso || '';

  // Carrega as questões
  questoesEmEdicao = item.questoes ? JSON.parse(JSON.stringify(item.questoes)) : [];
  renderizarQuestoesForm();

  document.getElementById('modal-title').innerText = 'Editar Avaliação';
  document.getElementById('modal-avaliacao').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-avaliacao').classList.add('hidden');
}

async function handleFormSubmit(e) {
  e.preventDefault();

  // Validação: Múltipla escolha deve ter exatamente 1 correta marcada
  for (let i = 0; i < questoesEmEdicao.length; i++) {
    const q = questoesEmEdicao[i];
    if (q.tipo === 'escolha') {
      const temCorreta = Object.values(q.corretas || {}).some(val => val === true);
      if (!temCorreta) {
        showToast(`⚠️ Selecione a resposta verdadeira para a Questão ${i + 1}`, "error");
        return;
      }
    }
  }
  
  const id = document.getElementById('avaliacao-id').value;
  const turmaSelect = document.getElementById('avaliacao-turma');
  const turmaId = turmaSelect.value;
  const turmaNome = turmaSelect.options[turmaSelect.selectedIndex].text;
  
  const data = {
    turmaId,
    turmaNome,
    titulo: document.getElementById('avaliacao-titulo').value.trim(),
    curso: document.getElementById('avaliacao-curso').value.trim(),
    peso: parseFloat(document.getElementById('avaliacao-peso').value) || 0,
    questoes: questoesEmEdicao
  };

  const submitBtn = document.getElementById('btn-salvar-avaliacao');
  const originalText = submitBtn.innerText;
  submitBtn.disabled = true;
  submitBtn.innerText = 'Processando...';

  try {
    if (id) {
      await apiFetch(`/avaliacoes/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      showToast("✅ Avaliação atualizada com sucesso!");
    } else {
      await apiFetch(`/avaliacoes`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      showToast("✅ Avaliação cadastrada com sucesso!");
    }
    closeModal();
    await loadAvaliacoes();
  } catch (err) {
    showToast("❌ Erro ao salvar: " + err.message, "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = originalText;
  }
}

async function deleteAvaliacao(id, titulo) {
  if (!confirm(`Tem certeza que deseja excluir permanentemente a avaliação "${titulo}"?`)) return;

  try {
    await apiFetch(`/avaliacoes/${id}`, {
      method: 'DELETE'
    });
    showToast("🗑️ Avaliação removida com sucesso!");
    await loadAvaliacoes();
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

// ============================================================================
// SISTEMA DE GABARITOS E LEITURA ÓTICA DE RESPOSTAS (OMR)
// ============================================================================

let currentGabaritoAvaliacao = null;
let currentGabaritoTurma = null;
let selectedAlunoNome = null;
let resultadosCarregados = [];

// Função que define as coordenadas do layout de bolhas no Canvas de 600x800
function obterCoordenadasBolhas(numQuestoes) {
  const coords = [];
  let cols = 1;
  if (numQuestoes > 10 && numQuestoes <= 20) cols = 2;
  else if (numQuestoes > 20) cols = 3;

  const rowHeight = 44; // Altura de cada linha de questão (pixels)
  const startY = 230;   // Y inicial onde começam as questões (pixels)

  for (let i = 0; i < numQuestoes; i++) {
    let colIdx = 0;
    let idxInCol = i;
    if (cols === 2) {
      colIdx = i % 2;
      idxInCol = Math.floor(i / 2);
    } else if (cols === 3) {
      colIdx = i % 3;
      idxInCol = Math.floor(i / 3);
    }

    // Centros das colunas
    let colCenter = 300;
    let labelOffset = -90;
    let spacing = 28;

    if (cols === 2) {
      colCenter = colIdx === 0 ? 155 : 445;
      labelOffset = -65;
      spacing = 24;
    } else if (cols === 3) {
      colCenter = colIdx === 0 ? 105 : (colIdx === 1 ? 300 : 495);
      labelOffset = -55;
      spacing = 18;
    }

    const y = startY + idxInCol * rowHeight;
    const optCoords = {};

    ['a', 'b', 'c', 'd', 'e'].forEach((opt, oIdx) => {
      const offset = (oIdx - 2) * spacing;
      optCoords[opt] = {
        x: Math.round(colCenter + offset),
        y: Math.round(y)
      };
    });

    coords.push({
      num: i + 1,
      labelX: Math.round(colCenter + labelOffset),
      labelY: Math.round(y),
      opcoes: optCoords
    });
  }

  return coords;
}

// 1. Abrir Modal de Gabaritos
async function abrirModalGabaritos(avaliacaoId) {
  const avaliacao = avaliacoes.find(a => a.id === avaliacaoId);
  if (!avaliacao) return;

  currentGabaritoAvaliacao = avaliacao;
  // Encontra a turma
  currentGabaritoTurma = turmas.find(t => t.id === avaliacao.turmaId);
  selectedAlunoNome = null;
  resultadosCarregados = [];

  // Define título
  document.getElementById('gabaritos-modal-title').textContent = `Gabaritos: ${avaliacao.titulo}`;
  
  // Carrega notas já existentes
  try {
    resultadosCarregados = await apiFetch(`/avaliacoes/${avaliacaoId}/respostas`);
  } catch (err) {
    console.error("Erro ao buscar respostas salvas:", err);
  }

  // Renderizar a lista de alunos
  renderizarListaAlunosGabarito();

  // Mostrar modal
  document.getElementById('modal-gabaritos').classList.remove('hidden');

  // Mostrar tela de boas-vindas do painel direito
  mostrarPainelDireitoEmpty();
}

function fecharModalGabaritos() {
  document.getElementById('modal-gabaritos').classList.add('hidden');
}

// Renderiza a lista de alunos na barra lateral do modal
function renderizarListaAlunosGabarito() {
  const container = document.getElementById('gabaritos-alunos-list');
  container.innerHTML = '';

  const alunos = (currentGabaritoTurma && currentGabaritoTurma.listaAlunos && currentGabaritoTurma.listaAlunos.length > 0)
    ? currentGabaritoTurma.listaAlunos
    : [];

  if (alunos.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:1rem; color:var(--text-secondary); font-size:0.8rem;">
        Esta turma não possui alunos. Clique em Imprimir para gerar uma folha em branco.
      </div>
    `;
    return;
  }

  // Ordena os alunos alfabeticamente
  const alunosOrdenados = [...alunos].sort();

  alunosOrdenados.forEach(nome => {
    const res = resultadosCarregados.find(r => r.alunoNome === nome);
    const item = document.createElement('div');
    item.className = `aluno-item-gabarito ${res ? 'corrected' : 'pending'} ${selectedAlunoNome === nome ? 'active' : ''}`;
    
    item.innerHTML = `
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:170px;">${nome}</span>
      <span class="nota-badge">${res ? res.nota.toFixed(1) : 'S/N'}</span>
    `;

    item.onclick = () => {
      selectedAlunoNome = nome;
      // Remove classe active dos outros
      container.querySelectorAll('.aluno-item-gabarito').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      abrirPainelCorrecaoAluno(nome, res);
    };

    container.appendChild(item);
  });
}

function mostrarPainelDireitoEmpty() {
  const main = document.getElementById('gabaritos-main-content');
  main.innerHTML = `
    <div class="gabaritos-empty-state">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
      <h3 style="margin:0 0 0.5rem 0;color:var(--text-main);">Gerenciamento de Provas OMR</h3>
      <p style="margin:0;max-width:380px;font-size:0.9rem;">Selecione um aluno na barra lateral para carregar a nota ou realizar a correção de sua folha de respostas.</p>
    </div>
  `;
}

// 2. Imprimir Gabaritos
function imprimirGabaritos() {
  if (!currentGabaritoAvaliacao) return;
  
  const avaliacao = currentGabaritoAvaliacao;
  const turma = currentGabaritoTurma;
  const questoesMCQ = avaliacao.questoes.filter(q => q.tipo === 'escolha');

  if (questoesMCQ.length === 0) {
    alert("Esta avaliação não possui questões de múltipla escolha para gerar gabaritos.");
    return;
  }

  const alunos = (turma && turma.listaAlunos && turma.listaAlunos.length > 0)
    ? [...turma.listaAlunos].sort()
    : ["Gabarito Genérico"];

  const printWindow = window.open("", "_blank");
  
  // Vamos escrever o HTML da página de impressão
  let html = `
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
      <meta charset="UTF-8">
      <title>Gabaritos - ${avaliacao.titulo}</title>
      <style>
        body {
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          margin: 0;
          padding: 0;
          background: #e2e8f0;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        
        .print-page {
          background: white;
          width: 210mm;
          height: 297mm;
          position: relative;
          margin: 0 auto 10mm auto;
          box-sizing: border-box;
          page-break-after: always;
        }
        
        @media print {
          body {
            background: white;
            margin: 0;
          }
          .print-page {
            margin: 0;
            box-shadow: none;
            page-break-after: always;
          }
        }
        
        /* Cantos de Calibração */
        .print-marker {
          position: absolute;
          width: 6mm;
          height: 6mm;
          background: black;
          box-sizing: border-box;
        }
        .print-marker::after {
          content: '';
          position: absolute;
          top: 2.5mm;
          left: 2.5mm;
          width: 1mm;
          height: 1mm;
          background: white;
          border-radius: 50%;
        }
        .print-marker-tl { top: 12mm; left: 12mm; }
        .print-marker-tr { top: 12mm; right: 12mm; }
        .print-marker-bl { bottom: 45mm; left: 12mm; }
        .print-marker-br { bottom: 45mm; right: 12mm; }
        
        /* Container Interno */
        .print-container {
          position: absolute;
          top: 15mm;
          left: 15mm;
          width: 180mm;
          height: 240mm;
          box-sizing: border-box;
        }
        
        /* Cabeçalho */
        .print-header {
          position: absolute;
          top: 5mm;
          left: 5mm;
          width: 170mm;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 0.5mm solid black;
          padding-bottom: 3mm;
        }
        
        .print-header-left h1 {
          margin: 0;
          font-size: 5mm;
          font-weight: 800;
          color: black;
          text-transform: uppercase;
        }
        
        .print-header-left p {
          margin: 1mm 0 0 0;
          font-size: 3.5mm;
          font-weight: 600;
          color: #334155;
        }
        
        .print-header-right {
          text-align: right;
          font-size: 3.2mm;
          font-weight: bold;
          color: #475569;
        }
        
        .print-header-right p {
          margin: 0.5mm 0 0 0;
        }
        
        /* Caixa de Nome */
        .print-name-box {
          position: absolute;
          top: 22mm;
          left: 5mm;
          width: 170mm;
          height: 14mm;
          border: 0.4mm solid black;
          padding: 2mm 3mm;
          box-sizing: border-box;
          background: #fafafa;
        }
        
        .print-name-box label {
          display: block;
          font-size: 2.8mm;
          font-weight: bold;
          text-transform: uppercase;
          color: #475569;
          margin-bottom: 1mm;
        }
        
        .print-name-value {
          font-size: 4.8mm;
          font-weight: 800;
          color: black;
        }
        
        .print-name-line {
          width: 100%;
          border-bottom: 0.2mm dashed black;
          height: 1mm;
          margin-top: 1mm;
        }
        
        /* Instruções */
        .print-instructions {
          position: absolute;
          top: 39mm;
          left: 5mm;
          width: 170mm;
          font-size: 2.6mm;
          color: #475569;
          line-height: 1.3;
        }
        
        .print-instructions strong {
          color: black;
        }
        
        /* Bolhas */
        .print-bubble {
          position: absolute;
          width: 5.5mm;
          height: 5.5mm;
          border: 0.45mm solid black;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 3.2mm;
          font-weight: 800;
          color: black;
          background: white;
        }
        
        .print-question-label {
          position: absolute;
          font-size: 3.8mm;
          font-weight: 800;
          color: black;
          text-align: right;
          width: 10mm;
        }
      </style>
    </head>
    <body>
  `;

  // Coordenadas calculadas
  const coords = obterCoordenadasBolhas(questoesMCQ.length);

  alunos.forEach(alunoNome => {
    html += `
      <div class="print-page">
        <!-- Marcas nos cantos -->
        <div class="print-marker print-marker-tl"></div>
        <div class="print-marker print-marker-tr"></div>
        <div class="print-marker print-marker-bl"></div>
        <div class="print-marker print-marker-br"></div>
        
        <div class="print-container">
          <div class="print-header">
            <div class="print-header-left">
              <h1>ÓRBITA FATEC - GABARITO</h1>
              <p>${avaliacao.titulo}</p>
            </div>
            <div class="print-header-right">
              <p>Turma: ${avaliacao.turmaNome}</p>
              <p>Curso: ${avaliacao.curso}</p>
              <p>Peso: ${avaliacao.peso.toFixed(1)}</p>
            </div>
          </div>
          
          <div class="print-name-box">
            <label>Nome do Aluno</label>
            ${alunoNome === "Gabarito Genérico" ? '<div class="print-name-line"></div>' : `<div class="print-name-value">${alunoNome}</div>`}
          </div>
          
          <div class="print-instructions">
            <strong>Instruções de Preenchimento:</strong> Use caneta azul ou preta. Preencha completamente os círculos das respostas desejadas, sem rasurar. Evite dobrar ou amassar esta folha para garantir a correção ótica automática corretiva.
          </div>
    `;

    // Desenha as questões e suas bolhas na escala de milímetros
    coords.forEach(q => {
      const labelX_mm = (q.labelX * 0.3).toFixed(1);
      const labelY_mm = (q.labelY * 0.3).toFixed(1);
      
      html += `
        <div class="print-question-label" style="left: ${labelX_mm}mm; top: ${(labelY_mm - 1.8).toFixed(1)}mm;">
          ${q.num.toString().padStart(2, '0')}.
        </div>
      `;

      ['a', 'b', 'c', 'd', 'e'].forEach(opt => {
        const optCoord = q.opcoes[opt];
        const bubbleX_mm = (optCoord.x * 0.3 - 2.75).toFixed(1);
        const bubbleY_mm = (optCoord.y * 0.3 - 2.75).toFixed(1);
        
        html += `
          <div class="print-bubble" style="left: ${bubbleX_mm}mm; top: ${bubbleY_mm}mm;">
            ${opt.toUpperCase()}
          </div>
        `;
      });
    });

    html += `
        </div>
      </div>
    `;
  });

  html += `
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
  
  // Aguarda carregar as fontes e renderizar, depois dispara a impressão
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}

// 3. Abrir Painel de Correção/Resultado do Aluno
function abrirPainelCorrecaoAluno(nome, resultadoExistente) {
  const main = document.getElementById('gabaritos-main-content');
  main.innerHTML = '';

  if (resultadoExistente) {
    // Exibe a nota e o review do aluno já corrigido
    main.innerHTML = `
      <div style="padding: 1rem;">
        <div class="review-score-card">
          <div class="score-info">
            <h3>Correção Concluída</h3>
            <p>Aluno: <strong>${nome}</strong></p>
            <p>Salvo em: ${new Date(resultadoExistente.updatedAt || resultadoExistente.createdAt).toLocaleString()}</p>
          </div>
          <div class="score-circle">
            ${resultadoExistente.nota.toFixed(1)}
            <span>Nota</span>
          </div>
        </div>
        
        <div style="margin-top: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
          <h4 style="margin: 0; color: var(--text-main); font-size: 0.95rem;">Respostas Registradas</h4>
          <button class="btn-secondary" id="btn-re-corrigir" style="padding:0.4rem 0.8rem; font-size:0.8rem; display:inline-flex; align-items:center; gap:0.35rem;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            Corrigir Novamente (Upload)
          </button>
        </div>

        <div class="review-questions-list" style="margin-top: 1rem; max-height: 450px;">
          ${currentGabaritoAvaliacao.questoes.map((q, qIdx) => {
            const num = qIdx + 1;
            const respAluno = resultadoExistente.respostas[num];
            
            let correctOption = null;
            if (q.tipo === 'escolha' && q.corretas) {
              correctOption = Object.keys(q.corretas).find(k => q.corretas[k] === true)?.toUpperCase();
            }

            const isMCQ = q.tipo === 'escolha';
            let statusText = '';
            let statusClass = '';

            if (isMCQ) {
              const isCorrect = respAluno && correctOption && respAluno.toUpperCase() === correctOption;
              statusText = isCorrect ? 'Correta' : (respAluno === 'B' || respAluno === 'A' || respAluno === 'C' || respAluno === 'D' || respAluno === 'E' || respAluno === '' ? (respAluno === '' ? 'Em branco' : `Errada (Resp: ${respAluno})`) : `Inválida (${respAluno})`);
              statusClass = isCorrect ? 'correct' : 'incorrect';
              if (respAluno === '') statusClass += ' warning';
            } else {
              statusText = 'Descritiva (Manual)';
              statusClass = 'descritiva';
            }

            return `
              <div class="review-question-row ${isMCQ ? (respAluno && correctOption && respAluno.toUpperCase() === correctOption ? 'correct' : 'incorrect') : ''}">
                <div class="review-question-info">
                  <span>Q${num.toString().padStart(2, '0')}</span>
                  <span style="font-weight: 500; font-size: 0.8rem; color: var(--text-secondary); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${q.pergunta}
                  </span>
                </div>
                <div class="review-question-status">
                  ${isMCQ ? `<span class="status-indicator ${respAluno && correctOption && respAluno.toUpperCase() === correctOption ? 'correct' : 'incorrect'}">
                    ${statusText} (Gabarito: ${correctOption})
                  </span>` : `<span style="font-size:0.75rem; color:var(--accent-orange); font-style:italic;">Descritiva</span>`}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    document.getElementById('btn-re-corrigir').onclick = () => {
      abrirPainelUploadGabarito(nome);
    };
  } else {
    // Aluno ainda não corrigido - Abre área de Upload
    abrirPainelUploadGabarito(nome);
  }
}

// Abre tela de upload de foto para o aluno
function abrirPainelUploadGabarito(nome) {
  const main = document.getElementById('gabaritos-main-content');
  main.innerHTML = '';
  
  const div = document.createElement('div');
  div.className = 'gabaritos-upload-container';
  div.innerHTML = `
    <div style="border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; margin-bottom: 0.5rem;">
      <h3 style="margin: 0; color: var(--text-main); font-size: 1.1rem;">Escanear Gabarito</h3>
      <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.85rem;">Aluno: <strong>${nome}</strong></p>
    </div>

    <div class="gabarito-dropzone" id="gabarito-dropzone">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <div style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">Clique para selecionar ou arraste a foto do gabarito</div>
      <div style="font-size: 0.78rem; color: var(--text-secondary);">Formatos aceitos: JPG, PNG, JPEG</div>
      <input type="file" id="gabarito-file-input" accept="image/*" style="display: none;">
    </div>
  `;

  main.appendChild(div);

  const dropZone = document.getElementById('gabarito-dropzone');
  const fileInput = document.getElementById('gabarito-file-input');

  dropZone.onclick = () => fileInput.click();

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragging');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragging');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (file) carregarImagemGabarito(file, nome);
  });

  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) carregarImagemGabarito(file, nome);
  };
}

// Carrega o arquivo de imagem e abre o editor de alinhamento
function carregarImagemGabarito(file, alunoNome) {
  if (!file.type.startsWith('image/')) {
    alert("Por favor, selecione um arquivo de imagem válido.");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      abrirEditorAlinhamento(img, alunoNome);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// 4. Editor de Alinhamento Canvas
function abrirEditorAlinhamento(img, alunoNome) {
  const main = document.getElementById('gabaritos-main-content');
  main.innerHTML = '';
  
  const div = document.createElement('div');
  div.className = 'gabarito-align-container';
  div.innerHTML = `
    <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem;">
      <div>
        <h3 style="margin: 0; color: var(--text-main); font-size: 1.1rem;">Alinhar Gabarito</h3>
        <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.85rem;">
          Arraste as alças nos cantos do papel para enquadrar a folha.
        </p>
      </div>
      <button class="btn-primary" id="btn-confirmar-alinhamento" style="padding: 0.5rem 1rem; font-size: 0.85rem;">
        Confirmar e Corrigir
      </button>
    </div>

    <div class="canvas-align-wrapper">
      <canvas id="gabarito-align-canvas"></canvas>
    </div>
  `;

  main.appendChild(div);

  const canvas = document.getElementById('gabarito-align-canvas');
  const ctx = canvas.getContext('2d');

  // Ajusta dimensões de exibição
  const maxDisplayW = 550;
  const scale = maxDisplayW / img.width;
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;

  // Pontos de alinhamento no espaço da imagem em alta resolução
  const w = img.width;
  const h = img.height;
  const points = [
    { x: w * 0.1, y: h * 0.1 }, // TL
    { x: w * 0.9, y: h * 0.1 }, // TR
    { x: w * 0.9, y: h * 0.9 }, // BR
    { x: w * 0.1, y: h * 0.9 }  // BL
  ];

  // Desenha a imagem inicial em um canvas temporário fora da tela para aplicar a busca automática
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(img, 0, 0);

  // Executa detector de centroide automático nos 4 cantos
  const searchSize = Math.round(Math.min(w, h) * 0.15); // área de busca
  for (let i = 0; i < 4; i++) {
    const res = detectarCentroideMarker(tempCtx, points[i].x, points[i].y, searchSize);
    if (res.found) {
      points[i].x = res.x;
      points[i].y = res.y;
    }
  }

  let activePointIndex = -1;
  const handleRadius = 14; // raio de clique da alça no canvas de exibição

  function draw() {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
    // Desenha linhas do retângulo de alinhamento
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(points[0].x * scale, points[0].y * scale);
    ctx.lineTo(points[1].x * scale, points[1].y * scale);
    ctx.lineTo(points[2].x * scale, points[2].y * scale);
    ctx.lineTo(points[3].x * scale, points[3].y * scale);
    ctx.closePath();
    ctx.stroke();

    // Desenha as alças nos cantos
    points.forEach((p, idx) => {
      const px = p.x * scale;
      const py = p.y * scale;
      
      // Sombra
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(px, py, handleRadius + 2, 0, Math.PI * 2);
      ctx.fill();

      // Círculo
      ctx.fillStyle = idx === activePointIndex ? '#2563eb' : '#3b82f6';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(px, py, handleRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Centro
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Eventos de drag-and-drop das alças (mouse + touch)
  function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function handleStart(e) {
    e.preventDefault();
    const pos = getMousePos(e);
    activePointIndex = points.findIndex(p => {
      const dist = Math.hypot(p.x * scale - pos.x, p.y * scale - pos.y);
      return dist <= handleRadius + 10; // margem extra para toque no celular
    });
    if (activePointIndex !== -1) {
      draw();
    }
  }

  function handleMove(e) {
    if (activePointIndex === -1) return;
    e.preventDefault();
    const pos = getMousePos(e);
    
    // Converte de volta para escala original
    let newX = pos.x / scale;
    let newY = pos.y / scale;

    // Boundary check
    newX = Math.max(0, Math.min(newX, w));
    newY = Math.max(0, Math.min(newY, h));

    points[activePointIndex].x = newX;
    points[activePointIndex].y = newY;

    draw();
  }

  function handleEnd() {
    if (activePointIndex !== -1) {
      activePointIndex = -1;
      draw();
    }
  }

  canvas.addEventListener('mousedown', handleStart);
  canvas.addEventListener('mousemove', handleMove);
  canvas.addEventListener('mouseup', handleEnd);
  canvas.addEventListener('mouseleave', handleEnd);

  canvas.addEventListener('touchstart', handleStart);
  canvas.addEventListener('touchmove', handleMove);
  canvas.addEventListener('touchend', handleEnd);

  draw();

  document.getElementById('btn-confirmar-alinhamento').onclick = () => {
    corrigirGabaritoAlinhado(img, points, alunoNome);
  };
}

// Algoritmo de busca do centroide da marca preta do gabarito (OMR Corner Finder)
function detectarCentroideMarker(tempCtx, xEst, yEst, searchSize) {
  const half = Math.round(searchSize / 2);
  const startX = Math.round(xEst - half);
  const startY = Math.round(yEst - half);
  
  if (startX < 0 || startY < 0 || startX + searchSize > tempCtx.canvas.width || startY + searchSize > tempCtx.canvas.height) {
    return { x: xEst, y: yEst, found: false };
  }

  const imgData = tempCtx.getImageData(startX, startY, searchSize, searchSize);
  const data = imgData.data;

  let sumX = 0;
  let sumY = 0;
  let count = 0;

  // Analisa pixels escuros (Threshold de brilho < 80)
  for (let y = 0; y < searchSize; y++) {
    for (let x = 0; x < searchSize; x++) {
      const idx = (y * searchSize + x) * 4;
      const brightness = (data[idx] + data[idx+1] + data[idx+2]) / 3;
      if (brightness < 80) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }

  if (count > 20) {
    return {
      x: startX + sumX / count,
      y: startY + sumY / count,
      found: true
    };
  }

  return { x: xEst, y: yEst, found: false };
}

// 5. Homografia / Transformação Perspectiva (Warp)
function processarWarpPerspectiva(img, points, destW = 600, destH = 800) {
  const x0 = points[0].x, y0 = points[0].y;
  const x1 = points[1].x, y1 = points[1].y;
  const x2 = points[2].x, y2 = points[2].y;
  const x3 = points[3].x, y3 = points[3].y;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;

  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(det) < 1e-6) return null;

  const g6 = (sx * dy2 - dx2 * sy) / det;
  const g7 = (dx1 * sy - sx * dy1) / det;

  const h6 = g6 / destW;
  const h7 = g7 / destH;
  const h0 = (x1 - x0) / destW + x1 * h6;
  const h1 = (x3 - x0) / destH + x3 * h7;
  const h2 = x0;
  const h3 = (y1 - y0) / destW + y1 * h6;
  const h4 = (y3 - y0) / destH + y3 * h7;
  const h5 = y0;

  const warpedCanvas = document.createElement('canvas');
  warpedCanvas.width = destW;
  warpedCanvas.height = destH;
  const warpedCtx = warpedCanvas.getContext('2d');

  // Desenha imagem original no canvas temporário
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(img, 0, 0);

  const srcData = srcCtx.getImageData(0, 0, img.width, img.height);
  const destData = warpedCtx.createImageData(destW, destH);

  const srcW = img.width;
  const srcH = img.height;

  for (let y = 0; y < destH; y++) {
    for (let x = 0; x < destW; x++) {
      const denom = h6 * x + h7 * y + 1;
      const sx_val = (h0 * x + h1 * y + h2) / denom;
      const sy_val = (h3 * x + h4 * y + h5) / denom;

      const ix = Math.round(sx_val);
      const iy = Math.round(sy_val);

      if (ix >= 0 && ix < srcW && iy >= 0 && iy < srcH) {
        const destIdx = (y * destW + x) * 4;
        const srcIdx = (iy * srcW + ix) * 4;
        
        destData.data[destIdx] = srcData.data[srcIdx];
        destData.data[destIdx+1] = srcData.data[srcIdx+1];
        destData.data[destIdx+2] = srcData.data[srcIdx+2];
        destData.data[destIdx+3] = srcData.data[srcIdx+3];
      }
    }
  }

  warpedCtx.putImageData(destData, 0, 0);
  return warpedCanvas;
}

// 6. Lógica de Análise OMR de Bolhas
function corrigirGabaritoAlinhado(img, points, alunoNome) {
  const destW = 600;
  const destH = 800;

  // Gera a imagem enquadrada
  const warpedCanvas = processarWarpPerspectiva(img, points, destW, destH);
  if (!warpedCanvas) {
    alert("Falha no alinhamento tridimensional. Tente ajustar os pontos.");
    return;
  }

  const warpedCtx = warpedCanvas.getContext('2d');
  const imgData = warpedCtx.getImageData(0, 0, destW, destH);
  const data = imgData.data;

  // Filtra as questões de múltipla escolha
  const questoesMCQ = currentGabaritoAvaliacao.questoes.filter(q => q.tipo === 'escolha');
  const coords = obterCoordenadasBolhas(questoesMCQ.length);

  const respostasDetectadas = {};
  const raioAnalise = 6; // raio de varredura dentro da bolha

  coords.forEach((q, qIdx) => {
    const opcoesGrayscale = {};

    ['a', 'b', 'c', 'd', 'e'].forEach(opt => {
      const optCoord = q.opcoes[opt];
      let sumGrayscale = 0;
      let count = 0;

      // Soma a intensidade de cinza na região circular da bolha
      for (let dy = -raioAnalise; dy <= raioAnalise; dy++) {
        for (let dx = -raioAnalise; dx <= raioAnalise; dx++) {
          if (dx*dx + dy*dy <= raioAnalise*raioAnalise) {
            const px = optCoord.x + dx;
            const py = optCoord.y + dy;
            if (px >= 0 && px < destW && py >= 0 && py < destH) {
              const idx = (py * destW + px) * 4;
              // Tons de cinza simplificados: (R + G + B) / 3
              const gray = (data[idx] + data[idx+1] + data[idx+2]) / 3;
              sumGrayscale += gray;
              count++;
            }
          }
        }
      }

      opcoesGrayscale[opt] = count > 0 ? (sumGrayscale / count) : 255;
    });

    // Identifica o menor valor de tom de cinza (mais escuro = candidato a preenchido)
    let minOpt = 'a';
    let minVal = opcoesGrayscale['a'];

    ['b', 'c', 'd', 'e'].forEach(opt => {
      if (opcoesGrayscale[opt] < minVal) {
        minVal = opcoesGrayscale[opt];
        minOpt = opt;
      }
    });

    // Calcula a média das outras 4 alternativas para verificar contraste
    let otherSum = 0;
    let otherCount = 0;
    ['a', 'b', 'c', 'd', 'e'].forEach(opt => {
      if (opt !== minOpt) {
        otherSum += opcoesGrayscale[opt];
        otherCount++;
      }
    });
    const otherAvg = otherSum / otherCount;
    const diff = otherAvg - minVal;

    // Critérios OMR:
    // 1. O círculo mais escuro deve ter brilho médio < 165 (caneta azul/preta).
    // 2. A diferença de brilho entre a selecionada e as outras deve ser pelo menos 25 (garante que não está em branco).
    let selecionada = '';
    if (minVal < 165 && diff > 25) {
      // 3. Verifica se o aluno marcou mais de uma opção (se outra opção for quase tão escura quanto a mínima, < 18 de diferença)
      let duplaMarcacao = false;
      ['a', 'b', 'c', 'd', 'e'].forEach(opt => {
        if (opt !== minOpt && (opcoesGrayscale[opt] - minVal) < 18) {
          duplaMarcacao = true;
        }
      });
      selecionada = duplaMarcacao ? 'MULT' : minOpt.toUpperCase();
    } else {
      selecionada = ''; // em branco
    }

    respostasDetectadas[q.num] = selecionada;
  });

  // Abre tela de revisão das notas detectadas
  abrirTelaRevisaoRespostas(alunoNome, warpedCanvas, respostasDetectadas);
}

// 7. Tela de Revisão e Correção Manual
function abrirTelaRevisaoRespostas(alunoNome, warpedCanvas, respostasDetectadas) {
  const main = document.getElementById('gabaritos-main-content');
  main.innerHTML = '';

  const totalQuestoes = currentGabaritoAvaliacao.questoes.length;
  const questoesMCQ = currentGabaritoAvaliacao.questoes.filter(q => q.tipo === 'escolha');
  
  // Cria container
  const container = document.createElement('div');
  container.className = 'gabarito-review-container';
  
  // Painel Esquerdo da revisão: Imagem Warp enquadrada
  const leftPanel = document.createElement('div');
  leftPanel.className = 'review-warped-view';
  leftPanel.innerHTML = `
    <h4 style="margin: 0; font-size: 0.85rem; color: var(--text-main); font-weight: 700;">Gabarito Enquadrado</h4>
    <p style="margin: 0; font-size: 0.72rem; color: var(--text-secondary); text-align: center;">Consulte a imagem processada abaixo para sanar dúvidas visualmente.</p>
  `;
  
  // Adiciona a imagem alinhada
  leftPanel.appendChild(warpedCanvas);
  container.appendChild(leftPanel);

  // Painel Direito: Lista de Questões e Cálculos
  const rightPanel = document.createElement('div');
  rightPanel.className = 'review-results-view';
  
  // Estrutura o Score Card Inicial (atualizado via JS)
  rightPanel.innerHTML = `
    <div class="review-score-card" id="review-score-card">
      <!-- Calculado dinamicamente -->
    </div>
    
    <h4 style="margin: 0; color: var(--text-main); font-size: 0.9rem; font-weight: 700;">Respostas Lidas pelo Sistema (Revisão)</h4>
    
    <div class="review-questions-list" id="review-questions-list-root">
      <!-- Questões injetadas abaixo -->
    </div>

    <div style="display: flex; gap: 1rem; margin-top: 1rem;">
      <button class="btn-secondary" id="btn-cancelar-revisao" style="flex: 1; justify-content: center;">Voltar</button>
      <button class="btn-primary" id="btn-salvar-resultado" style="flex: 1.5; justify-content: center;">Confirmar e Salvar</button>
    </div>
  `;

  container.appendChild(rightPanel);
  main.appendChild(container);

  // Mapeamento interno das respostas do aluno em revisão
  const respostasRevisadas = { ...respostasDetectadas };

  // Atualiza nota em tempo real
  function calcularNotaRevisao() {
    let acertos = 0;
    let totalMCQ = questoesMCQ.length;

    questoesMCQ.forEach((q, qIdx) => {
      const num = qIdx + 1;
      const resp = respostasRevisadas[num] || '';
      
      let correctOpt = '';
      if (q.corretas) {
        correctOpt = Object.keys(q.corretas).find(k => q.corretas[k] === true)?.toUpperCase() || '';
      }

      if (resp && correctOpt && resp.toUpperCase() === correctOpt) {
        acertos++;
      }
    });

    // Calcula a nota proporcional
    let notaMCQ = totalMCQ > 0 ? (acertos / totalMCQ) * currentGabaritoAvaliacao.peso : 0;
    
    // Se a prova inteira tiver questões descritivas, avisa o professor
    const temDescritiva = currentGabaritoAvaliacao.questoes.some(q => q.tipo === 'descritiva');

    const scoreCard = document.getElementById('review-score-card');
    scoreCard.innerHTML = `
      <div class="score-info">
        <h3>Nota Calculada</h3>
        <p>Aluno: <strong>${alunoNome}</strong></p>
        <p>Acertos: <strong>${acertos} de ${totalMCQ}</strong> questões MCQ</p>
        ${temDescritiva ? '<p style="color:var(--accent-orange); font-size: 0.72rem; font-weight:bold; margin-top: 0.25rem;">⚠️ Requer correção manual das descritivas.</p>' : ''}
      </div>
      <div class="score-circle">
        ${notaMCQ.toFixed(1)}
        <span>Nota</span>
      </div>
    `;

    return { nota: parseFloat(notaMCQ.toFixed(2)), acertos };
  }

  // Renderiza as questões na revisão
  const listRoot = document.getElementById('review-questions-list-root');
  listRoot.innerHTML = '';

  currentGabaritoAvaliacao.questoes.forEach((q, qIdx) => {
    const num = qIdx + 1;
    const isMCQ = q.tipo === 'escolha';
    
    const row = document.createElement('div');
    row.className = `review-question-row`;
    
    if (isMCQ) {
      const resp = respostasRevisadas[num] || '';
      const correctOpt = Object.keys(q.corretas || {}).find(k => q.corretas[k] === true)?.toUpperCase() || '';
      const isCorrect = resp && resp.toUpperCase() === correctOpt;
      
      row.className = `review-question-row ${isCorrect ? 'correct' : 'incorrect'}`;
      
      row.innerHTML = `
        <div class="review-question-info">
          <span>Q${num.toString().padStart(2, '0')}</span>
          <span style="font-weight: 500; font-size: 0.8rem; color: var(--text-secondary); max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${q.pergunta}
          </span>
        </div>
        <div class="review-question-status">
          <span style="font-size: 0.75rem; color: var(--text-secondary); margin-right: 0.5rem;">Gabarito: <strong>${correctOpt}</strong></span>
          <select class="review-override-select" data-num="${num}">
            <option value="" ${resp === '' ? 'selected' : ''}>[Branco]</option>
            <option value="A" ${resp === 'A' ? 'selected' : ''}>A</option>
            <option value="B" ${resp === 'B' ? 'selected' : ''}>B</option>
            <option value="C" ${resp === 'C' ? 'selected' : ''}>C</option>
            <option value="D" ${resp === 'D' ? 'selected' : ''}>D</option>
            <option value="E" ${resp === 'E' ? 'selected' : ''}>E</option>
            <option value="MULT" ${resp === 'MULT' ? 'selected' : ''}>Dupla</option>
          </select>
        </div>
      `;

      // Event listener para alterar resposta manual
      const select = row.querySelector('.review-override-select');
      select.onchange = (e) => {
        const selectedVal = e.target.value;
        respostasRevisadas[num] = selectedVal;
        
        const recalculada = selectedVal && selectedVal.toUpperCase() === correctOpt;
        row.className = `review-question-row ${recalculada ? 'correct' : 'incorrect'}`;
        calcularNotaRevisao();
      };
    } else {
      // Descritiva
      row.innerHTML = `
        <div class="review-question-info">
          <span>Q${num.toString().padStart(2, '0')}</span>
          <span style="font-weight: 500; font-size: 0.8rem; color: var(--text-secondary); max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${q.pergunta}
          </span>
        </div>
        <div class="review-question-status">
          <span style="font-size:0.75rem; color:var(--accent-orange); font-style:italic; font-weight:700;">Descritiva (Apenas Manual)</span>
        </div>
      `;
    }

    listRoot.appendChild(row);
  });

  // Primeira chamada de cálculo
  calcularNotaRevisao();

  // Binds dos botões de rodapé da revisão
  document.getElementById('btn-cancelar-revisao').onclick = () => {
    abrirPainelUploadGabarito(alunoNome);
  };

  document.getElementById('btn-salvar-resultado').onclick = async () => {
    const { nota } = calcularNotaRevisao();
    const btn = document.getElementById('btn-salvar-resultado');
    btn.disabled = true;
    btn.textContent = 'Gravando Nota...';

    try {
      await apiFetch(`/avaliacoes/${currentGabaritoAvaliacao.id}/respostas`, {
        method: 'POST',
        body: JSON.stringify({
          alunoNome,
          turmaId: currentGabaritoAvaliacao.turmaId,
          respostas: respostasRevisadas,
          nota: nota,
          pesoTotal: currentGabaritoAvaliacao.peso
        })
      });

      // Recarrega os dados
      resultadosCarregados = await apiFetch(`/avaliacoes/${currentGabaritoAvaliacao.id}/respostas`);
      renderizarListaAlunosGabarito();
      
      // Reabre a tela inicial de visualização do aluno
      const novoResultado = resultadosCarregados.find(r => r.alunoNome === alunoNome);
      abrirPainelCorrecaoAluno(alunoNome, novoResultado);
      
      showToast(`Nota ${nota.toFixed(1)} de ${alunoNome} salva com sucesso!`);
    } catch (err) {
      alert("Erro ao salvar nota: " + err.message);
      btn.disabled = false;
      btn.textContent = 'Confirmar e Salvar';
    }
  };
}
