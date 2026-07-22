import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { firebaseConfig } from "../../core/firebase-config.js";
import { setupLayout, getCachedAuth, setCachedAuth, clearCachedAuth } from '../../core/layout.js';

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);

const API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.'))
  ? `http://${window.location.hostname}:3000/api`
  : '/api';

let currentUser = null;
let currentRole = null;
let userLevel = 1;
let appInitialized = false;
let initializedRole = null;

let state = [];          // [{ curso, total, done, alunos: null | [{id, nome, turma, disciplina, professor, periodo, financeiro, status}] }]
let activeCourse = '';
let searchTerm = '';
let todosCarregados = false; // true depois que já buscamos os alunos de TODOS os cursos (busca global)

const STATUS_ORDER = ['A_CURSAR', 'CURSANDO', 'CURSOU', 'CANCELOU'];
const STATUS_LABEL = {
  A_CURSAR: 'A cursar',
  CURSANDO: 'Cursando',
  CURSOU: 'Cursou',
  CANCELOU: 'Cancelou/Trancou'
};

// Resolve quando a sessão REAL do Firebase (via onAuthStateChanged) estiver
// disponível — usado pra sanar o token do cache otimista (getCachedAuth), que
// não sabe se renovar sozinho e pode estar vencido (>1h) na 1ª leva de chamadas.
let authReadyResolve;
const authReady = new Promise(res => { authReadyResolve = res; });

async function apiFetch(endpoint, options = {}, _retentativa = false) {
  const token = await currentUser.getIdToken(_retentativa);
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers || {})
  };
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  if (res.status === 401 && !_retentativa) {
    // Token do cache otimista vencido: espera a sessão real do Firebase e tenta 1x com token novo.
    await authReady;
    return apiFetch(endpoint, options, true);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erro na API: ${res.status}`);
  }
  return res.json();
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    window.location.href = '../../auth/login.html';
    return;
  }

  currentUser = user;
  authReadyResolve();
  try {
    const token = await user.getIdToken();
    let role = 'visitante';
    try {
      const userData = await apiFetch('/usuarios/me');
      role = userData.role || 'visitante';
    } catch (err) {
      role = cached ? cached.role : 'visitante';
    }

    setCachedAuth(user, role, token);

    let level = 1;
    if (role === 'adm_l1') {
      level = 3;
    } else {
      try {
        const perms = await apiFetch('/usuarios/config/permissions');
        const rolePerms = perms[role] || {};
        const rawPerm = rolePerms['relatorio-dp'];
        level = (rawPerm !== undefined && typeof rawPerm === 'object')
          ? (rawPerm.execute ? 3 : (rawPerm.view ? 2 : 1))
          : (parseInt(rawPerm) || 1);
      } catch (e) {
        if (role === 'adm_l2') level = 3;
      }
    }
    userLevel = level;

    if (level < 2) {
      window.location.href = '../../meu-espaco/index.html';
      return;
    }

    document.body.classList.toggle('hide-execute', level < 3);

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

  setupLayout(user, role, 'relatorio-dp', async () => {
    clearCachedAuth();
    await signOut(auth);
    window.location.href = '../../auth/login.html';
  });

  document.getElementById('app').classList.remove('hidden');

  // relatorio.html reaproveita este app.js só pra auth/layout + a própria tela
  if (document.getElementById('dp-relatorio-conteudo')) {
    initPaginaRelatorio();
    return;
  }

  setupBusca();
  setupImportacaoCsv();
  setupModalDisciplina();
  setupModalEditarAluno();
  await loadData();
}

// ==========================================
// CARREGAMENTO E AGRUPAMENTO
// ==========================================

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.toggle('toast-error', !!isError);
  clearTimeout(showToast._timer);
  const duracao = Math.min(9000, Math.max(3200, msg.length * 60));
  showToast._timer = setTimeout(() => t.classList.add('hidden'), duracao);
}

function setSaveStatus(mode) {
  const el = document.getElementById('dp-save-status');
  if (!el) return;
  if (mode === 'saving') { el.className = 'dp-save-status saving'; el.textContent = 'Salvando…'; }
  else if (mode === 'saved') {
    el.className = 'dp-save-status saved';
    const hh = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    el.textContent = `Salvo às ${hh}`;
  } else if (mode === 'error') { el.className = 'dp-save-status error'; el.textContent = 'Erro ao salvar'; }
  else { el.className = 'dp-save-status'; el.textContent = ''; }
}

function groupByCurso(records) {
  const map = new Map();
  records.forEach(rec => {
    const curso = rec.curso;
    if (!map.has(curso)) map.set(curso, []);
    map.get(curso).push(mapeiaAluno(rec));
  });
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
    .map(([curso, alunos]) => ({ curso, alunos }));
}

function mapeiaAluno(rec) {
  return {
    id: rec.id,
    nome: rec.nome,
    turma: rec.turma,
    disciplina: rec.disciplina,
    professor: rec.professor || '',
    periodo: rec.periodo || '',
    financeiro: rec.financeiro || '',
    status: rec.status || 'A_CURSAR'
  };
}

// Carrega só a contagem por curso (leve — sem nome/disciplina de ninguém) e
// depois busca os alunos apenas do curso escolhido como ativo.
// preferCurso: se informado, tenta abrir esse curso (ex.: recém-importado/adicionado).
async function refreshResumo(preferCurso) {
  const resumo = await apiFetch('/secretaria-dp/resumo');
  const cursosAntigos = new Map(state.map(c => [c.curso, c]));
  state = resumo
    .map(r => {
      const antigo = cursosAntigos.get(r.curso);
      return { curso: r.curso, total: r.total, done: r.done, alunos: antigo ? antigo.alunos : null };
    })
    .sort((a, b) => a.curso.localeCompare(b.curso, 'pt-BR'));
  todosCarregados = false;

  // Só reabre um curso automaticamente se já havia um ativo (ex.: depois de importar/editar)
  // ou se foi pedido explicitamente (preferCurso). Na 1ª abertura da tela, não seleciona nenhum —
  // o usuário escolhe o curso que quer ver.
  const alvo = (preferCurso && state.find(c => c.curso.trim().toUpperCase() === preferCurso.trim().toUpperCase()))
    || state.find(c => c.curso === activeCourse);

  searchTerm = '';
  const searchInput = document.getElementById('dp-search');
  if (searchInput) searchInput.value = '';

  if (alvo) {
    await selecionarCurso(alvo.curso);
  } else {
    activeCourse = '';
    render();
  }
}

// Troca o curso ativo, buscando os alunos dele na API só se ainda não tiverem sido carregados.
async function selecionarCurso(curso) {
  activeCourse = curso;
  const c = state.find(x => x.curso === curso);
  if (!c) { render(); return; }

  if (c.alunos === null) {
    renderSidebar();
    document.getElementById('dp-course-title').textContent = curso;
    document.getElementById('dp-table-wrap').innerHTML = '<div class="dp-empty">Carregando alunos…</div>';
    try {
      const registros = await apiFetch(`/secretaria-dp/registros?curso=${encodeURIComponent(curso)}`);
      c.alunos = registros.map(mapeiaAluno);
      c.total = c.alunos.length;
      c.done = c.alunos.filter(a => a.status !== 'A_CURSAR').length;
    } catch (err) {
      showToast('Erro ao carregar alunos do curso: ' + err.message, true);
      c.alunos = [];
    }
  }
  render();
}

// Garante que TODOS os cursos tenham os alunos carregados — usado só quando o
// usuário busca por nome em todos os cursos (não dá pra buscar sob demanda).
async function garantirTodosCarregados() {
  if (todosCarregados) return;
  const registros = await apiFetch('/secretaria-dp/registros');
  const porCurso = groupByCurso(registros);
  porCurso.forEach(({ curso, alunos }) => {
    let c = state.find(x => x.curso === curso);
    if (!c) { c = { curso, total: 0, done: 0, alunos: null }; state.push(c); }
    c.alunos = alunos;
    c.total = alunos.length;
    c.done = alunos.filter(a => a.status !== 'A_CURSAR').length;
  });
  state.sort((a, b) => a.curso.localeCompare(b.curso, 'pt-BR'));
  todosCarregados = true;
}

async function loadData() {
  renderLoading();
  try {
    await refreshResumo();
  } catch (err) {
    renderLoadError(err.message);
  }
}

function renderLoading() {
  const list = document.getElementById('dp-course-list');
  if (list) list.innerHTML = '';
  document.getElementById('dp-course-title').textContent = 'Carregando…';
  document.getElementById('dp-table-wrap').innerHTML = '<div class="dp-empty">Carregando dados…</div>';
}

function renderLoadError(msg) {
  document.getElementById('dp-course-title').textContent = 'Erro ao carregar';
  document.getElementById('dp-table-wrap').innerHTML = `
    <div class="dp-empty">
      Não foi possível carregar os dados.<br>
      <span style="font-size:12px;">${esc(msg)}</span><br><br>
      <button type="button" class="btn-secondary" id="btn-tentar-novamente">Tentar novamente</button>
    </div>
  `;
  document.getElementById('btn-tentar-novamente')?.addEventListener('click', loadData);
}

// ==========================================
// RENDERIZAÇÃO
// ==========================================

function courseStats(c) {
  return { total: c.total, done: c.done };
}

function render() {
  renderSidebar();
  renderTable();
}

function renderSidebar() {
  const list = document.getElementById('dp-course-list');
  list.innerHTML = '';
  let totalAll = 0, doneAll = 0;
  state.forEach(c => {
    const { total, done } = courseStats(c);
    totalAll += total; doneAll += done;
    const li = document.createElement('li');
    li.className = 'dp-course-item' + (c.curso === activeCourse ? ' active' : '');
    const pct = total ? Math.round(100 * done / total) : 0;
    li.innerHTML = `
      <div class="dp-course-row"><span>${esc(c.curso)}</span><span class="dp-course-count">${done}/${total}</span></div>
      <div class="dp-mini-bar"><div class="dp-mini-bar-inner" style="width:${pct}%"></div></div>
    `;
    li.addEventListener('click', () => {
      if (c.curso === activeCourse && !searchTerm.trim()) return;
      searchTerm = '';
      document.getElementById('dp-search').value = '';
      selecionarCurso(c.curso);
    });
    list.appendChild(li);
  });
  document.getElementById('dp-overall-num').textContent = `${doneAll}/${totalAll}`;
  document.getElementById('dp-overall-bar').style.width = (totalAll ? Math.round(100 * doneAll / totalAll) : 0) + '%';
}

function groupRows(rows, showCourseCol) {
  const map = new Map();
  const groups = [];
  rows.forEach(a => {
    const key = (showCourseCol ? a.curso + '||' : '') + a.nome.trim().toUpperCase() + '||' + a.turma.trim();
    let g = map.get(key);
    if (!g) {
      g = { key, items: [] };
      map.set(key, g);
      groups.push(g);
    }
    g.items.push(a);
  });
  groups.forEach(g => g.items.sort((x, y) => x.disciplina.localeCompare(y.disciplina, 'pt-BR')));
  groups.sort((a, b) => {
    const x = a.items[0], y = b.items[0];
    return (x.nome + x.turma).localeCompare(y.nome + y.turma, 'pt-BR');
  });
  return groups;
}

function renderTable() {
  const wrap = document.getElementById('dp-table-wrap');
  const titleEl = document.getElementById('dp-course-title');
  const canEdit = userLevel >= 3;

  let rows = [];
  if (searchTerm.trim()) {
    state.forEach(c => (c.alunos || []).forEach(a => {
      if (a.nome.toLowerCase().includes(searchTerm.toLowerCase())) rows.push({ ...a, curso: c.curso });
    }));
    rows.sort((a, b) => (a.curso + a.nome).localeCompare(b.curso + b.nome));
    titleEl.textContent = `Resultados da busca: "${searchTerm}" (${rows.length})`;
  } else if (!activeCourse) {
    titleEl.textContent = 'Selecione um curso';
    wrap.innerHTML = '<div class="dp-empty">Escolha um curso na lista ao lado para ver os alunos em dependência.</div>';
    return;
  } else {
    const c = state.find(c => c.curso === activeCourse);
    titleEl.textContent = c ? c.curso : '';
    rows = (c && c.alunos ? c.alunos : []).map(a => ({ ...a, curso: c.curso }));
  }

  if (!rows.length) {
    wrap.innerHTML = '<div class="dp-empty">Nenhum aluno em dependência nesta lista.</div>';
    return;
  }

  const showCourseCol = !!searchTerm.trim();
  const groups = groupRows(rows, showCourseCol);

  const bodyRows = groups.map(group => {
    return group.items.map((a, j) => {
      const first = j === 0;
      const span = group.items.length;
      const statusCell = canEdit
        ? `<div class="dp-status-btns">${STATUS_ORDER.map(s => `<button type="button" class="dp-status-btn ${a.status === s ? 'sel' : ''}" data-status="${s}" data-id="${a.id}">${STATUS_LABEL[s]}</button>`).join('')}</div>`
        : `<span class="dp-status-badge">${esc(STATUS_LABEL[a.status] || a.status)}</span>`;
      const campoLivre = (field, valor) => canEdit
        ? `<input type="text" class="dp-mini-input" data-field="${field}" data-id="${a.id}" value="${esc(valor)}">`
        : `<span class="dp-readonly-text">${esc(valor) || '—'}</span>`;
      const groupIds = group.items.map(x => x.id).join(',');
      const nomeCell = canEdit
        ? `<div class="dp-nome-cell">
            <span class="dp-nome-text">${esc(a.nome)}</span>
            <div class="dp-nome-actions">
              <button type="button" class="dp-edit-aluno-btn" data-ids="${groupIds}" data-nome="${esc(a.nome)}" data-turma="${esc(a.turma)}" title="Editar aluno">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button type="button" class="dp-del-aluno-btn" data-ids="${groupIds}" data-nome="${esc(a.nome)}" title="Remover aluno da lista de DP">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          </div>`
        : esc(a.nome);
      return `
        <tr data-id="${a.id}">
          ${first ? `<td class="dp-group-cell" rowspan="${span}">${nomeCell}</td>` : ''}
          ${showCourseCol && first ? `<td class="dp-group-cell" rowspan="${span}">${esc(a.curso)}</td>` : ''}
          ${first ? `<td class="dp-group-cell" rowspan="${span}">${esc(a.turma)}</td>` : ''}
          <td class="dp-status-cell status-${a.status}">${esc(a.disciplina)}</td>
          <td class="dp-status-cell status-${a.status}">${statusCell}</td>
          <td class="dp-status-cell status-${a.status}">${campoLivre('periodo', a.periodo)}</td>
          <td class="dp-status-cell status-${a.status}">${campoLivre('professor', a.professor)}</td>
          <td class="dp-status-cell status-${a.status}">${campoLivre('financeiro', a.financeiro)}</td>
        </tr>
      `;
    }).join('');
  }).join('');

  wrap.innerHTML = `
    <div class="dp-table-scroll">
      <table class="dp-table">
        <thead>
          <tr>
            <th>Nome</th>
            ${showCourseCol ? '<th>Curso</th>' : ''}
            <th>Turma</th>
            <th>Disciplina</th>
            <th>Status</th>
            <th>Período contemplado</th>
            <th>Professor</th>
            <th>Financeiro</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;

  if (!canEdit) return;

  wrap.querySelectorAll('.dp-status-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const status = btn.dataset.status;
      const aluno = findAluno(id);
      if (!aluno) return;
      const curso = findCursoDoAluno(id);
      const eraPendente = aluno.status === 'A_CURSAR';
      aluno.status = status;
      if (curso) {
        const agoraPendente = status === 'A_CURSAR';
        if (eraPendente && !agoraPendente) curso.done++;
        else if (!eraPendente && agoraPendente) curso.done--;
      }
      renderSidebar();
      renderTable();
      await persistUpdate(id, 'status', status);
    });
  });
  wrap.querySelectorAll('.dp-del-aluno-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ids = btn.dataset.ids.split(',');
      const nome = btn.dataset.nome;
      const confirmMsg = ids.length > 1
        ? `Remover ${nome} da lista de DP? Isso vai excluir as ${ids.length} disciplinas dele(a) nesta turma. Essa ação não pode ser desfeita.`
        : `Remover ${nome} da lista de DP? Essa ação não pode ser desfeita.`;
      if (!confirm(confirmMsg)) return;

      btn.disabled = true;
      try {
        await Promise.all(ids.map(id => apiFetch(`/secretaria-dp/registros/${id}`, { method: 'DELETE' })));

        const curso = findCursoDoAluno(ids[0]);
        if (curso && curso.alunos) {
          const pendentesRemovidos = curso.alunos.filter(x => ids.includes(x.id) && x.status === 'A_CURSAR').length;
          curso.alunos = curso.alunos.filter(x => !ids.includes(x.id));
          curso.total -= ids.length;
          curso.done -= (ids.length - pendentesRemovidos);
        }

        showToast(`${nome} removido(a) da lista de DP.`);
        renderSidebar();
        renderTable();
      } catch (err) {
        showToast('Erro ao remover aluno: ' + err.message, true);
        btn.disabled = false;
      }
    });
  });
  wrap.querySelectorAll('.dp-mini-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const id = inp.dataset.id;
      const aluno = findAluno(id);
      if (aluno) {
        aluno[inp.dataset.field] = inp.value;
        scheduleSave(id, inp.dataset.field, inp.value);
      }
    });
  });
  wrap.querySelectorAll('.dp-edit-aluno-btn').forEach(btn => {
    btn.addEventListener('click', () => abrirModalEditarAluno(btn.dataset.ids.split(','), btn.dataset.nome, btn.dataset.turma));
  });
}

function findAluno(id) {
  for (const c of state) {
    const a = (c.alunos || []).find(x => x.id === id);
    if (a) return a;
  }
  return null;
}

function findCursoDoAluno(id) {
  return state.find(c => (c.alunos || []).some(x => x.id === id)) || null;
}

function setupBusca() {
  document.getElementById('dp-search').addEventListener('input', async (e) => {
    searchTerm = e.target.value;
    if (searchTerm.trim() && !todosCarregados) {
      document.getElementById('dp-table-wrap').innerHTML = '<div class="dp-empty">Carregando todos os alunos para a busca…</div>';
      try {
        await garantirTodosCarregados();
      } catch (err) {
        showToast('Erro ao buscar: ' + err.message, true);
        return;
      }
    }
    renderTable();
  });
}

// ==========================================
// PERSISTÊNCIA (Firestore via API)
// ==========================================

const saveTimers = {};

function scheduleSave(id, field, value) {
  const key = id + '_' + field;
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(() => persistUpdate(id, field, value), 700);
}

async function persistUpdate(id, field, value) {
  setSaveStatus('saving');
  try {
    await apiFetch(`/secretaria-dp/registros/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ [field]: value })
    });
    setSaveStatus('saved');
  } catch (err) {
    console.error(err);
    setSaveStatus('error');
    showToast('Erro ao salvar: ' + err.message, true);
  }
}

// ==========================================
// IMPORTAÇÃO EDUBOX (CSV)
// ==========================================

const CODE_TO_COURSE = {
  'AGRO': 'AGRONEGÓCIO',
  'AGRON': 'AGRONOMIA',
  'ARQUIT': 'ARQUITETURA E URBANISMO',
  'BIOMED': 'BIOMEDICINA',
  'CI.CONT': 'C. CONTABEIS',
  'DIR': 'DIREITO',
  'ENFER': 'ENFERMAGEM',
  'ENG.CIV': 'ENGENHARIA CIVIL',
  'FINAN': 'GEST FINANCEIRA',
  'FISIO': 'FISIOTERAPIA',
  'GEST.COM': 'GEST COMERCIAL',
  'MED.VET.': 'MED.VET',
  'PED': 'PEDAGOGIA',
  'PSICO': 'PSICOLOGIA',
  'RH': 'RH'
};

function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function parseEduboxCsv(text) {
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.length > 0);
  let currentTurmaRaw = null, currentCode = null, currentNome = null;
  const records = [];
  const semRe = /(\d{4}\/\d)/;
  for (const rawLine of lines) {
    const r = parseCsvLine(rawLine).map(c => c.trim());
    if (r.length === 2 && r[0] === 'Turma' && r[1] === 'Id.Curso') continue;
    if (r.length === 3 && r[0] === 'Aluno(a)' && r[1] === 'Fone' && r[2] === 'Status') continue;
    if (r.length === 1 && /registros de Alunos/.test(r[0])) { currentNome = null; continue; }
    if (r.length === 2 && CODE_TO_COURSE[r[1]]) {
      currentTurmaRaw = r[0]; currentCode = r[1]; currentNome = null; continue;
    }
    if (r.length === 10 && r[0] === 'Disciplina') continue;
    if (r.length === 3) { currentNome = r[0]; continue; }
    if (r.length === 10) {
      const disciplina = r[0];
      const m = semRe.exec(currentTurmaRaw || '');
      const turma = m ? m[1] : (currentTurmaRaw || '');
      const curso = CODE_TO_COURSE[currentCode] || currentCode;
      if (currentNome && disciplina) {
        records.push({ curso, turma, nome: currentNome, disciplina });
      }
    }
  }
  return records;
}

// Guarda o que foi parseado do CSV enquanto o usuário revisa antes de confirmar.
let importPendente = null;

// Agrupa em curso > aluno > disciplinas, guardando o índice de cada disciplina
// em importPendente.toSend (é o que liga o checkbox de volta ao registro original).
function agruparParaPreview(toSend) {
  const porCurso = new Map();
  toSend.forEach((rec, idx) => {
    if (!porCurso.has(rec.curso)) porCurso.set(rec.curso, new Map());
    const alunosDoCurso = porCurso.get(rec.curso);
    const key = rec.nome.trim().toUpperCase() + '||' + rec.turma.trim();
    if (!alunosDoCurso.has(key)) alunosDoCurso.set(key, { nome: rec.nome, turma: rec.turma, disciplinas: [] });
    alunosDoCurso.get(key).disciplinas.push({ disciplina: rec.disciplina, idx });
  });

  return Array.from(porCurso.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
    .map(([curso, alunosMap]) => ({
      curso,
      alunos: Array.from(alunosMap.values()).sort((a, b) => (a.nome + a.turma).localeCompare(b.nome + b.turma, 'pt-BR'))
    }));
}

function abrirPreviewImportacao(toSend, totalLido, skippedCourses) {
  importPendente = { toSend, totalLido, skippedCourses };

  const grupos = agruparParaPreview(toSend);
  const totalAlunos = grupos.reduce((soma, g) => soma + g.alunos.length, 0);

  let resumo = `${toSend.length} disciplina(s) de ${totalAlunos} aluno(s), em ${grupos.length} curso(s) — ${totalLido} linha(s) lidas no arquivo.`;
  if (skippedCourses.size) resumo += ` Cursos não reconhecidos (ignorados): ${Array.from(skippedCourses).join(', ')}.`;
  document.getElementById('preview-resumo').textContent = resumo;

  document.getElementById('preview-lista').innerHTML = grupos.map(g => `
    <div class="preview-curso">
      <div class="preview-curso-head">
        <label class="preview-check">
          <input type="checkbox" class="chk-curso" checked>
          <strong>${esc(g.curso)}</strong>
        </label>
        <span class="preview-curso-count">${g.alunos.length} aluno(s) · ${g.alunos.reduce((s, a) => s + a.disciplinas.length, 0)} disciplina(s)</span>
      </div>
      <ul class="preview-alunos">
        ${g.alunos.map(a => `
          <li class="preview-aluno-row">
            <label class="preview-check preview-aluno-check">
              <input type="checkbox" class="chk-aluno" checked>
            </label>
            <div class="preview-aluno-info">
              <span class="preview-aluno-nome">${esc(a.nome)}</span>
              <span class="preview-aluno-turma">(${esc(a.turma)})</span>
              <div class="preview-disc-chips">
                ${a.disciplinas.map(d => `
                  <label class="preview-disc-chip">
                    <input type="checkbox" class="chk-disc" data-idx="${d.idx}" checked> ${esc(d.disciplina)}
                  </label>
                `).join('')}
              </div>
            </div>
          </li>
        `).join('')}
      </ul>
    </div>
  `).join('');

  atualizarContadorPreview();
  document.getElementById('modal-preview-import').classList.remove('hidden');
}

function sincronizarCheckboxAluno(row) {
  const chkAluno = row.querySelector('.chk-aluno');
  const discs = Array.from(row.querySelectorAll('.chk-disc'));
  const marcados = discs.filter(cb => cb.checked).length;
  chkAluno.checked = marcados > 0;
  chkAluno.indeterminate = marcados > 0 && marcados < discs.length;
}

function sincronizarCheckboxCurso(bloco) {
  const chkCurso = bloco.querySelector('.chk-curso');
  const alunos = Array.from(bloco.querySelectorAll('.chk-aluno'));
  const todosMarcados = alunos.every(cb => cb.checked && !cb.indeterminate);
  const algumMarcado = alunos.some(cb => cb.checked || cb.indeterminate);
  chkCurso.checked = todosMarcados;
  chkCurso.indeterminate = !todosMarcados && algumMarcado;
}

function atualizarContadorPreview() {
  const total = document.querySelectorAll('#preview-lista .chk-disc').length;
  const marcados = document.querySelectorAll('#preview-lista .chk-disc:checked').length;
  const contador = document.getElementById('preview-contador');
  if (contador) contador.textContent = `${marcados} de ${total} selecionada(s) para importar`;
  const btnConfirmar = document.getElementById('btn-confirmar-preview');
  if (btnConfirmar) btnConfirmar.disabled = marcados === 0;
}

async function confirmarImportacao() {
  if (!importPendente) return;
  const idxSelecionados = new Set(
    Array.from(document.querySelectorAll('#preview-lista .chk-disc:checked')).map(cb => Number(cb.dataset.idx))
  );
  const selecionados = importPendente.toSend.filter((_, idx) => idxSelecionados.has(idx));
  if (!selecionados.length) {
    showToast('Nenhuma disciplina selecionada para importar.', true);
    return;
  }

  const { totalLido, skippedCourses } = importPendente;
  const btn = document.getElementById('btn-confirmar-preview');
  btn.disabled = true;

  try {
    const data = await apiFetch('/secretaria-dp/importar-csv', {
      method: 'POST',
      body: JSON.stringify({ records: selecionados })
    });

    await refreshResumo();

    let msg = `✅ Importação concluída: ${data.added} disciplina(s) nova(s) adicionada(s)`;
    if (data.duplicados) msg += `, ${data.duplicados} já existiam (ignoradas)`;
    msg += `. (${selecionados.length} selecionada(s) de ${totalLido} linha(s) lidas no arquivo)`;
    if (skippedCourses.size) msg += ' — cursos não reconhecidos: ' + Array.from(skippedCourses).join(', ');
    showToast(msg);

    document.getElementById('modal-preview-import').classList.add('hidden');
    importPendente = null;
  } catch (err) {
    console.error(err);
    showToast('Erro ao importar CSV: ' + err.message, true);
  } finally {
    btn.disabled = false;
  }
}

function setupModalPreviewImportacao() {
  document.getElementById('btn-cancelar-preview').addEventListener('click', () => {
    document.getElementById('modal-preview-import').classList.add('hidden');
    importPendente = null;
  });
  document.getElementById('btn-confirmar-preview').addEventListener('click', confirmarImportacao);

  document.getElementById('btn-preview-selecionar-todos').addEventListener('click', () => {
    document.querySelectorAll('#preview-lista .chk-curso, #preview-lista .chk-aluno, #preview-lista .chk-disc')
      .forEach(cb => { cb.checked = true; cb.indeterminate = false; });
    atualizarContadorPreview();
  });
  document.getElementById('btn-preview-selecionar-nenhum').addEventListener('click', () => {
    document.querySelectorAll('#preview-lista .chk-curso, #preview-lista .chk-aluno, #preview-lista .chk-disc')
      .forEach(cb => { cb.checked = false; cb.indeterminate = false; });
    atualizarContadorPreview();
  });

  document.getElementById('preview-lista').addEventListener('change', (e) => {
    if (e.target.classList.contains('chk-disc')) {
      const row = e.target.closest('.preview-aluno-row');
      sincronizarCheckboxAluno(row);
      sincronizarCheckboxCurso(row.closest('.preview-curso'));
    } else if (e.target.classList.contains('chk-aluno')) {
      const row = e.target.closest('.preview-aluno-row');
      row.querySelectorAll('.chk-disc').forEach(cb => { cb.checked = e.target.checked; });
      e.target.indeterminate = false;
      sincronizarCheckboxCurso(row.closest('.preview-curso'));
    } else if (e.target.classList.contains('chk-curso')) {
      const bloco = e.target.closest('.preview-curso');
      bloco.querySelectorAll('.chk-aluno').forEach(cb => { cb.checked = e.target.checked; cb.indeterminate = false; });
      bloco.querySelectorAll('.chk-disc').forEach(cb => { cb.checked = e.target.checked; });
      e.target.indeterminate = false;
    } else {
      return;
    }
    atualizarContadorPreview();
  });
}

function setupImportacaoCsv() {
  setupModalPreviewImportacao();
  document.getElementById('edubox-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const text = new TextDecoder('iso-8859-1').decode(buffer);
      const records = parseEduboxCsv(text);
      const knownCourses = new Set(Object.values(CODE_TO_COURSE));
      const skippedCourses = new Set();
      const toSend = [];
      records.forEach(rec => {
        if (!knownCourses.has(rec.curso)) { skippedCourses.add(rec.curso); return; }
        toSend.push(rec);
      });

      if (!toSend.length) {
        let msg = `Nenhum registro reconhecido para importar (${records.length} lidos no arquivo).`;
        if (skippedCourses.size) msg += ' Cursos não reconhecidos: ' + Array.from(skippedCourses).join(', ');
        showToast(msg);
        e.target.value = '';
        return;
      }

      abrirPreviewImportacao(toSend, records.length, skippedCourses);
    } catch (err) {
      console.error(err);
      showToast('Erro ao ler o CSV: ' + err.message, true);
    }
    e.target.value = '';
  });
}

// ==========================================
// ADICIONAR DISCIPLINA MANUALMENTE
// ==========================================

function updateCursosDatalist() {
  const datalist = document.getElementById('dp-cursos-datalist');
  const cursos = new Set([...state.map(c => c.curso), ...Object.values(CODE_TO_COURSE)]);
  datalist.innerHTML = Array.from(cursos).sort().map(c => `<option value="${esc(c)}">`).join('');
}

function setupModalDisciplina() {
  const modal = document.getElementById('modal-disciplina');
  const form = document.getElementById('form-disciplina');

  document.getElementById('btn-nova-disciplina').addEventListener('click', () => {
    form.reset();
    updateCursosDatalist();
    modal.classList.remove('hidden');
  });
  document.getElementById('btn-cancelar-disciplina').addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      curso: document.getElementById('disc-curso').value.trim(),
      nome: document.getElementById('disc-nome').value.trim(),
      turma: document.getElementById('disc-turma').value.trim(),
      disciplina: document.getElementById('disc-disciplina').value.trim(),
      professor: document.getElementById('disc-professor').value.trim(),
      periodo: document.getElementById('disc-periodo').value.trim(),
      financeiro: document.getElementById('disc-financeiro').value.trim(),
      status: document.getElementById('disc-status').value
    };
    try {
      await apiFetch('/secretaria-dp/registros', { method: 'POST', body: JSON.stringify(body) });
      modal.classList.add('hidden');
      await refreshResumo(body.curso);
      showToast('Disciplina adicionada com sucesso!');
    } catch (err) {
      showToast('Erro ao adicionar: ' + err.message, true);
    }
  });
}

// ==========================================
// EDITAR ALUNO (nome/turma — aplica em todas as disciplinas dele)
// ==========================================

let alunoEditandoIds = [];

function abrirModalEditarAluno(ids, nome, turma) {
  alunoEditandoIds = ids;
  document.getElementById('edit-aluno-nome').value = nome;
  document.getElementById('edit-aluno-turma').value = turma;
  document.getElementById('modal-editar-aluno').classList.remove('hidden');
}

function setupModalEditarAluno() {
  const modal = document.getElementById('modal-editar-aluno');
  const form = document.getElementById('form-editar-aluno');

  document.getElementById('btn-cancelar-editar-aluno').addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const novoNome = document.getElementById('edit-aluno-nome').value.trim();
    const novaTurma = document.getElementById('edit-aluno-turma').value.trim();
    if (!novoNome || !novaTurma || !alunoEditandoIds.length) return;

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await Promise.all(alunoEditandoIds.map(id => apiFetch(`/secretaria-dp/registros/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ nome: novoNome, turma: novaTurma })
      })));

      const curso = findCursoDoAluno(alunoEditandoIds[0]);
      if (curso && curso.alunos) {
        curso.alunos.forEach(al => {
          if (alunoEditandoIds.includes(al.id)) { al.nome = novoNome; al.turma = novaTurma; }
        });
      }

      modal.classList.add('hidden');
      showToast('Dados do aluno atualizados com sucesso!');
      renderTable();
    } catch (err) {
      showToast('Erro ao salvar: ' + err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}

// ==========================================
// TELA "RELATÓRIO" (relatorio.html) — impressão com logo, no padrão
// dos demais módulos (ex.: Gestão Saúde / Ferida)
// ==========================================

const COLUNA_LABEL = {
  turma: 'Turma',
  disciplina: 'Disciplina',
  status: 'Status',
  periodo: 'Período',
  professor: 'Professor',
  financeiro: 'Financeiro'
};

// Agrupa por aluno (nome + turma) independentemente da ordem de chegada,
// para o mesmo aluno nunca aparecer em blocos repetidos no relatório.
function agruparParaImpressao(alunos) {
  const map = new Map();
  const groups = [];
  alunos.forEach(a => {
    const key = a.nome.trim().toUpperCase() + '||' + a.turma.trim();
    let g = map.get(key);
    if (!g) { g = { items: [] }; map.set(key, g); groups.push(g); }
    g.items.push(a);
  });
  groups.forEach(g => g.items.sort((x, y) => x.disciplina.localeCompare(y.disciplina, 'pt-BR')));
  groups.sort((a, b) => {
    const x = a.items[0], y = b.items[0];
    return (x.nome + x.turma).localeCompare(y.nome + y.turma, 'pt-BR');
  });
  return groups;
}

// A tela do relatório NUNCA busca todos os alunos de todos os cursos sozinha —
// só carrega a contagem (resumo) de cara, e só busca alunos de um curso quando
// ele é escolhido no select. "Todos os cursos" só é buscado se o usuário
// escolher essa opção explicitamente.
let relatorioTodosCarregados = false;

async function initPaginaRelatorio() {
  const msg = document.getElementById('dp-relatorio-msg');
  const opcoes = document.getElementById('dp-relatorio-opcoes');
  const btnImprimir = document.getElementById('btn-imprimir-relatorio');
  btnImprimir.disabled = true;

  try {
    const resumo = await apiFetch('/secretaria-dp/resumo');
    state = resumo
      .map(r => ({ curso: r.curso, total: r.total, done: r.done, alunos: null }))
      .sort((a, b) => a.curso.localeCompare(b.curso, 'pt-BR'));

    popularSelectCursoRelatorio();
    popularSelectAlunoRelatorio();
    document.getElementById('dp-relatorio-conteudo').innerHTML = '<p class="rel-vazio">Selecione um curso (ou "Todos os cursos") para gerar o relatório.</p>';

    document.getElementById('dp-rel-curso').addEventListener('change', async () => {
      const valor = document.getElementById('dp-rel-curso').value;
      document.getElementById('dp-relatorio-conteudo').innerHTML = '<p class="rel-vazio">Carregando…</p>';
      try {
        if (valor === '__ALL__') await garantirTodosCarregadosRelatorio();
        else if (valor) await carregarCursoRelatorio(valor);
      } catch (err) {
        showToast('Erro ao carregar curso: ' + err.message, true);
      }
      popularSelectAlunoRelatorio();
      renderRelatorioConteudo();
    });
    document.getElementById('dp-rel-aluno').addEventListener('change', renderRelatorioConteudo);
    document.getElementById('dp-rel-situacao').addEventListener('change', renderRelatorioConteudo);
    opcoes.querySelectorAll('.rel-opcoes-lista input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', renderRelatorioConteudo);
    });

    msg.classList.add('hidden');
    opcoes.classList.remove('hidden');
    btnImprimir.disabled = false;
    btnImprimir.addEventListener('click', () => window.print());
  } catch (err) {
    console.error('Falha ao montar o relatório DP:', err);
    msg.innerHTML = `<p class="hint" style="margin:0; color:#b3453c">Erro ao carregar relatório: ${esc(err.message)}</p>`;
  }
}

// Busca os alunos de UM curso só (na hora que ele é escolhido), evitando ler a coleção inteira.
async function carregarCursoRelatorio(curso) {
  const c = state.find(x => x.curso === curso);
  if (!c || c.alunos !== null) return;
  const registros = await apiFetch(`/secretaria-dp/registros?curso=${encodeURIComponent(curso)}`);
  c.alunos = registros.map(mapeiaAluno);
}

// Só usado quando o usuário escolhe explicitamente "Todos os cursos" no select.
async function garantirTodosCarregadosRelatorio() {
  if (relatorioTodosCarregados) return;
  const registros = await apiFetch('/secretaria-dp/registros');
  const porCurso = groupByCurso(registros);
  porCurso.forEach(({ curso, alunos }) => {
    let c = state.find(x => x.curso === curso);
    if (!c) { c = { curso, total: alunos.length, done: 0, alunos: [] }; state.push(c); }
    c.alunos = alunos;
  });
  relatorioTodosCarregados = true;
}

function popularSelectCursoRelatorio() {
  const sel = document.getElementById('dp-rel-curso');
  sel.innerHTML = '<option value="" disabled selected>Selecione um curso...</option>'
    + '<option value="__ALL__">Todos os cursos</option>'
    + state.map(c => `<option value="${esc(c.curso)}">${esc(c.curso)}</option>`).join('');
}

function popularSelectAlunoRelatorio() {
  const cursoSel = document.getElementById('dp-rel-curso').value;
  const alunoSel = document.getElementById('dp-rel-aluno');

  if (!cursoSel || cursoSel === '__ALL__') {
    alunoSel.innerHTML = '<option value="">Selecione um curso específico para filtrar por aluno</option>';
    alunoSel.disabled = true;
    alunoSel.value = '';
    return;
  }

  const curso = state.find(c => c.curso === cursoSel);
  const nomes = Array.from(new Set((curso && curso.alunos ? curso.alunos : []).map(a => a.nome.trim())))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  alunoSel.disabled = false;
  alunoSel.innerHTML = '<option value="">Todos os alunos</option>' +
    nomes.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
}

function renderRelatorioConteudo() {
  const cursoSel = document.getElementById('dp-rel-curso').value;
  if (!cursoSel) {
    document.getElementById('dp-relatorio-conteudo').innerHTML = '<p class="rel-vazio">Selecione um curso (ou "Todos os cursos") para gerar o relatório.</p>';
    return;
  }
  const cursoFiltro = cursoSel === '__ALL__' ? '' : cursoSel;
  const alunoFiltro = document.getElementById('dp-rel-aluno').value;
  const somentePendentes = document.getElementById('dp-rel-situacao').value === 'pendentes';
  const colunas = Array.from(document.querySelectorAll('#dp-relatorio-opcoes .rel-opcoes-lista input:checked')).map(i => i.value);

  const cursos = cursoFiltro ? state.filter(c => c.curso === cursoFiltro) : state;
  const hoje = new Date().toLocaleDateString('pt-BR');
  const cols = colunas.length ? colunas : ['disciplina', 'status'];

  const blocos = cursos.map(c => {
    let alunos = c.alunos;
    if (alunoFiltro) alunos = alunos.filter(a => a.nome.trim().toUpperCase() === alunoFiltro.trim().toUpperCase());
    if (somentePendentes) alunos = alunos.filter(a => a.status === 'A_CURSAR' || a.status === 'CURSANDO');
    if (!alunos.length) return '';

    const grupos = agruparParaImpressao(alunos);
    const linhas = grupos.map(g => g.items.map((a, j) => {
      const first = j === 0;
      return `<tr>
        ${first ? `<td rowspan="${g.items.length}" class="rel-nome">${esc(a.nome)}</td>` : ''}
        ${cols.map(col => `<td>${esc(col === 'status' ? (STATUS_LABEL[a.status] || a.status) : a[col])}</td>`).join('')}
      </tr>`;
    }).join('')).join('');

    return `
      <h2 class="rel-secao">${esc(c.curso)} <span class="rel-secao-count">— ${alunos.length} disciplina(s) em DP</span></h2>
      <table class="rel-tabela">
        <thead><tr><th>Nome</th>${cols.map(col => `<th>${COLUNA_LABEL[col]}</th>`).join('')}</tr></thead>
        <tbody>${linhas}</tbody>
      </table>
    `;
  }).filter(Boolean).join('');

  const subtitulo = ['Secretaria · FATEC Ivaiporã', cursoFiltro, alunoFiltro].filter(Boolean).join(' · ');

  document.getElementById('dp-relatorio-conteudo').innerHTML = `
    <div class="rel-cabecalho">
      <img src="/img/fateclogoazul.png" alt="Fatec Ivaiporã" class="rel-logo">
      <div class="rel-titulo">
        <h1>Relatório de Dependência (DP)</h1>
        <p>${esc(subtitulo)}</p>
      </div>
      <div class="rel-data-emissao">Emitido em ${hoje}</div>
    </div>
    ${blocos || '<p class="rel-vazio">Nenhum registro encontrado para os filtros selecionados.</p>'}
  `;
}
