import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { firebaseConfig } from "../../core/firebase-config.js";
import { setupLayout, getCachedAuth, setCachedAuth, clearCachedAuth } from '../../core/layout.js';

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);

const API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.'))
  ? `http://${window.location.hostname}:3000/api`
  : '/api';

// Mesmo limite usado no backend (src/rotas/almoxarifado-saude.js) pra classificar "vencendo"
const DIAS_VENCENDO = 60;

let currentUser = null;
let currentRole = null;
let userLevel = 1;
let appInitialized = false;
let initializedRole = null;

let categoriaAtual = 'Consumível';
let itens = [];
let localizacoes = [];

let itemAtual = null;       // item aberto no modal de movimentação
let lotesAtuais = [];       // lotes do item aberto no modal de movimentação
let historicoAtual = [];
let tipoMovAtual = 'entrada';
let modoEntradaAtual = 'novo';

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
        const rawPerm = rolePerms['almoxarifado-saude'];
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

  setupLayout(user, role, 'almoxarifado-saude', async () => {
    clearCachedAuth();
    await signOut(auth);
    window.location.href = '../../auth/login.html';
  });

  document.getElementById('app').classList.remove('hidden');
  document.body.classList.toggle('categoria-permanente', categoriaAtual === 'Permanente');

  setupTabs();
  setupFiltros();
  setupModalItem();
  setupModalMovimentacao();
  setupModalConferencia();

  await loadLocalizacoes();
  await Promise.all([loadItens(), loadStats()]);
}

// ==========================================
// ABAS (Consumíveis / Patrimônio)
// ==========================================

function setupTabs() {
  document.getElementById('tab-consumivel').addEventListener('click', () => trocarAba('Consumível'));
  document.getElementById('tab-permanente').addEventListener('click', () => trocarAba('Permanente'));
}

async function trocarAba(categoria) {
  if (categoria === categoriaAtual) return;
  categoriaAtual = categoria;
  document.getElementById('tab-consumivel').classList.toggle('on', categoria === 'Consumível');
  document.getElementById('tab-permanente').classList.toggle('on', categoria === 'Permanente');
  document.body.classList.toggle('categoria-permanente', categoria === 'Permanente');
  document.getElementById('filtro-vencimento').checked = false;
  document.getElementById('filtro-baixo-estoque').checked = false;
  document.getElementById('search-itens').value = '';
  document.getElementById('filtro-localizacao').value = '';
  await Promise.all([loadItens(), loadStats()]);
}

// ==========================================
// LOCALIZAÇÕES
// ==========================================

async function loadLocalizacoes() {
  try {
    localizacoes = await apiFetch('/almoxarifado-saude/localizacoes');
  } catch (err) {
    localizacoes = [];
  }
  const selectFiltro = document.getElementById('filtro-localizacao');
  const selectItem = document.getElementById('item-localizacao');
  const opcoes = localizacoes.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
  selectFiltro.innerHTML = '<option value="">Todas as localizações</option>' + opcoes;
  selectItem.innerHTML = opcoes;
}

// ==========================================
// ITENS
// ==========================================

async function loadItens() {
  const lista = document.getElementById('itens-list');
  try {
    lista.innerHTML = '<div class="empty-state"><p>Carregando itens...</p></div>';
    itens = await apiFetch(`/almoxarifado-saude/itens?categoria=${encodeURIComponent(categoriaAtual)}`);
    aplicarFiltros();
  } catch (err) {
    lista.innerHTML = `<div class="empty-state"><p>Erro ao carregar: ${esc(err.message)}</p></div>`;
  }
}

async function loadStats() {
  try {
    const stats = await apiFetch('/almoxarifado-saude/stats');
    renderResumo(stats);
  } catch (err) {
    document.getElementById('alx-resumo').innerHTML = '';
  }
}

function renderResumo(stats) {
  const el = document.getElementById('alx-resumo');
  const totalAba = categoriaAtual === 'Consumível' ? stats.consumivel : stats.permanente;
  let html = `<div class="alx-resumo-card"><b>${totalAba}</b><span>Item${totalAba === 1 ? '' : 's'} cadastrado${totalAba === 1 ? '' : 's'}</span></div>`;
  html += `<div class="alx-resumo-card${stats.abaixoMinimo ? ' baixo' : ''}"><b>${stats.abaixoMinimo}</b><span>Com estoque baixo</span></div>`;
  if (categoriaAtual === 'Consumível') {
    html += `<div class="alx-resumo-card${stats.vencendo ? ' alerta' : ''}"><b>${stats.vencendo}</b><span>Vencendo em ${stats.diasVencendo} dias</span></div>`;
    html += `<div class="alx-resumo-card${stats.vencidos ? ' baixo' : ''}"><b>${stats.vencidos}</b><span>Lotes vencidos</span></div>`;
  }
  el.innerHTML = html;
}

function setupFiltros() {
  document.getElementById('search-itens').addEventListener('input', aplicarFiltros);
  document.getElementById('filtro-localizacao').addEventListener('change', aplicarFiltros);
  document.getElementById('filtro-baixo-estoque').addEventListener('change', aplicarFiltros);
  document.getElementById('filtro-vencimento').addEventListener('change', aplicarFiltros);
}

function statusVencimento(item) {
  if (!item.proximaValidade) return null;
  const hoje = new Date().toISOString().slice(0, 10);
  const limite = new Date(Date.now() + DIAS_VENCENDO * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (item.proximaValidade < hoje) return 'vencido';
  if (item.proximaValidade <= limite) return 'vencendo';
  return null;
}

function aplicarFiltros() {
  const query = (document.getElementById('search-itens').value || '').toLowerCase();
  const localizacao = document.getElementById('filtro-localizacao').value;
  const soBaixo = document.getElementById('filtro-baixo-estoque').checked;
  const soVencimento = document.getElementById('filtro-vencimento').checked;

  const filtrados = itens.filter(it => {
    const matchQuery = !query || it.nome.toLowerCase().includes(query);
    const matchLocal = !localizacao || it.localizacao === localizacao;
    const baixo = it.estoqueMinimo > 0 && it.quantidade <= it.estoqueMinimo;
    const matchBaixo = !soBaixo || baixo;
    const matchVencimento = !soVencimento || !!statusVencimento(it);
    return matchQuery && matchLocal && matchBaixo && matchVencimento;
  });
  renderItens(filtrados);
}

function renderItens(lista) {
  const container = document.getElementById('itens-list');
  container.innerHTML = '';

  if (!lista.length) {
    container.innerHTML = `<div class="empty-state"><p>${itens.length ? 'Nenhum item corresponde ao filtro.' : 'Nenhum item cadastrado ainda.'}</p></div>`;
    return;
  }

  lista.forEach(item => {
    const baixo = item.estoqueMinimo > 0 && item.quantidade <= item.estoqueMinimo;
    const vencimento = statusVencimento(item);
    const card = document.createElement('div');
    card.className = `item-card${baixo ? ' baixo' : ''}`;
    card.innerHTML = `
      <div class="item-card-nome">${esc(item.nome)}</div>
      <div class="item-card-local">${esc(item.localizacao)}</div>
      <div class="item-card-qtd"><span class="num">${item.quantidade}</span><span class="unid">${esc(item.unidade)}</span></div>
      ${item.estoqueMinimo > 0 ? `<div class="item-card-min">Estoque mínimo: ${item.estoqueMinimo}</div>` : ''}
      ${baixo ? '<span class="badge-baixo">⚠ Estoque baixo</span>' : ''}
      ${vencimento === 'vencido' ? '<span class="badge-baixo">⏰ Lote vencido</span>' : ''}
      ${vencimento === 'vencendo' ? '<span class="badge-vencendo">⏳ Vencendo</span>' : ''}
      ${item.categoria === 'Permanente' && item.conferidoEm ? `<div class="item-card-conf">Conferido em ${new Date(item.conferidoEm).toLocaleDateString('pt-BR')}</div>` : ''}
      <div class="item-card-actions action-execute">
        ${item.categoria === 'Consumível'
          ? '<button class="btn-mov" data-acao="mov">Movimentar</button>'
          : '<button class="btn-mov" data-acao="conferir">Conferir</button>'}
        <button data-acao="editar">Editar</button>
        <button class="btn-excluir" data-acao="excluir">Excluir</button>
      </div>
    `;
    card.querySelector('[data-acao="mov"]')?.addEventListener('click', () => abrirModalMovimentacao(item));
    card.querySelector('[data-acao="conferir"]')?.addEventListener('click', () => abrirModalConferencia(item));
    card.querySelector('[data-acao="editar"]').addEventListener('click', () => abrirModalItem(item));
    card.querySelector('[data-acao="excluir"]').addEventListener('click', () => excluirItem(item));
    container.appendChild(card);
  });
}

// ==========================================
// MODAL: NOVO / EDITAR ITEM
// ==========================================

function setupModalItem() {
  const modal = document.getElementById('modal-item');
  document.getElementById('btn-novo-item').addEventListener('click', () => abrirModalItem(null));
  document.getElementById('btn-cancelar-item').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  document.getElementById('form-item').addEventListener('submit', salvarItem);
}

function abrirModalItem(item) {
  document.getElementById('form-item').reset();
  const editando = !!item;
  const categoria = editando ? item.categoria : categoriaAtual;
  document.getElementById('item-id').value = editando ? item.id : '';
  document.getElementById('item-categoria').value = categoria;
  document.getElementById('item-nome').value = editando ? item.nome : '';
  document.getElementById('item-unidade').value = editando ? item.unidade : '';
  document.getElementById('item-localizacao').value = editando ? item.localizacao : '';
  document.getElementById('item-estoque-minimo').value = editando ? item.estoqueMinimo : '';
  document.getElementById('item-observacao').value = editando ? (item.observacao || '') : '';
  document.getElementById('modal-item-title').textContent = editando ? `Editar ${categoria === 'Consumível' ? 'Item' : 'Patrimônio'}` : `Novo ${categoria === 'Consumível' ? 'Item Consumível' : 'Item de Patrimônio'}`;
  document.getElementById('btn-salvar-item').textContent = editando ? 'Salvar alterações' : 'Cadastrar';

  // Quantidade/validade iniciais só existem no cadastro
  document.getElementById('grupo-qtd-inicial').classList.toggle('hidden', editando);
  document.getElementById('grupo-validade-inicial').classList.toggle('hidden', editando || categoria !== 'Consumível');
  document.getElementById('modal-item').classList.remove('hidden');
  document.getElementById('item-nome').focus();
}

async function salvarItem(e) {
  e.preventDefault();
  const id = document.getElementById('item-id').value;
  const categoria = document.getElementById('item-categoria').value;
  const btn = document.getElementById('btn-salvar-item');
  const dados = {
    nome: document.getElementById('item-nome').value.trim(),
    categoria,
    unidade: document.getElementById('item-unidade').value.trim(),
    localizacao: document.getElementById('item-localizacao').value,
    estoqueMinimo: document.getElementById('item-estoque-minimo').value || 0,
    observacao: document.getElementById('item-observacao').value.trim()
  };
  if (!id) {
    dados.quantidadeInicial = document.getElementById('item-qtd-inicial').value || 0;
    if (categoria === 'Consumível') {
      dados.validadeInicial = document.getElementById('item-validade-inicial').value || null;
    }
  }

  btn.disabled = true;
  btn.textContent = id ? 'Salvando...' : 'Cadastrando...';
  try {
    if (id) {
      await apiFetch(`/almoxarifado-saude/itens/${id}`, { method: 'PUT', body: JSON.stringify(dados) });
      showToast('Item atualizado');
    } else {
      await apiFetch('/almoxarifado-saude/itens', { method: 'POST', body: JSON.stringify(dados) });
      showToast('Item cadastrado');
    }
    document.getElementById('modal-item').classList.add('hidden');
    await Promise.all([loadItens(), loadStats()]);
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = id ? 'Salvar alterações' : 'Cadastrar';
  }
}

async function excluirItem(item) {
  if (!confirm(`Excluir "${item.nome}" e todo o seu histórico de lotes/movimentações? Essa ação não tem volta.`)) return;
  try {
    await apiFetch(`/almoxarifado-saude/itens/${item.id}`, { method: 'DELETE' });
    showToast('Item excluído');
    await Promise.all([loadItens(), loadStats()]);
  } catch (err) {
    showToast('Erro ao excluir: ' + err.message, 'error');
  }
}

// ==========================================
// MODAL: CONFERÊNCIA (Patrimônio — ajuste direto de quantidade)
// ==========================================

function setupModalConferencia() {
  const modal = document.getElementById('modal-conferencia');
  document.getElementById('btn-cancelar-conferencia').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  document.getElementById('form-conferencia').addEventListener('submit', salvarConferencia);
}

let itemConferenciaAtual = null;

function abrirModalConferencia(item) {
  itemConferenciaAtual = item;
  document.getElementById('modal-conferencia-title').textContent = `Conferir — ${item.nome}`;
  document.getElementById('conf-item-id').value = item.id;
  document.getElementById('conf-quantidade').value = item.quantidade;
  document.getElementById('conf-ultima-info').textContent = item.conferidoEm
    ? `Última conferência: ${new Date(item.conferidoEm).toLocaleString('pt-BR')}`
    : 'Ainda sem conferência registrada.';
  document.getElementById('modal-conferencia').classList.remove('hidden');
  document.getElementById('conf-quantidade').focus();
}

async function salvarConferencia(e) {
  e.preventDefault();
  const id = document.getElementById('conf-item-id').value;
  const quantidade = document.getElementById('conf-quantidade').value;
  const btn = document.getElementById('btn-salvar-conferencia');
  btn.disabled = true;
  btn.textContent = 'Salvando...';
  try {
    await apiFetch(`/almoxarifado-saude/itens/${id}/conferencia`, { method: 'PATCH', body: JSON.stringify({ quantidade }) });
    showToast('Conferência registrada');
    document.getElementById('modal-conferencia').classList.add('hidden');
    await Promise.all([loadItens(), loadStats()]);
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar';
  }
}

// ==========================================
// MODAL: MOVIMENTAÇÃO (Consumível — entrada/saída + lotes + histórico)
// ==========================================

function setupModalMovimentacao() {
  const modal = document.getElementById('modal-mov');
  document.getElementById('btn-fechar-mov').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  document.getElementById('btn-tipo-entrada').addEventListener('click', () => selecionarTipoMov('entrada'));
  document.getElementById('btn-tipo-saida').addEventListener('click', () => selecionarTipoMov('saida'));
  document.getElementById('btn-entrada-novo-lote').addEventListener('click', () => selecionarModoEntrada('novo'));
  document.getElementById('btn-entrada-lote-existente').addEventListener('click', () => selecionarModoEntrada('existente'));
  document.getElementById('form-mov').addEventListener('submit', registrarMovimentacao);
}

function selecionarTipoMov(tipo) {
  tipoMovAtual = tipo;
  document.getElementById('btn-tipo-entrada').classList.toggle('on', tipo === 'entrada');
  document.getElementById('btn-tipo-saida').classList.toggle('on', tipo === 'saida');
  document.getElementById('grupo-lote-saida').classList.toggle('hidden', tipo !== 'saida');
  document.getElementById('grupo-lote-entrada-modo').classList.toggle('hidden', tipo !== 'entrada');
  document.getElementById('grupo-novo-lote').classList.toggle('hidden', !(tipo === 'entrada' && modoEntradaAtual === 'novo'));
  document.getElementById('grupo-lote-entrada-existente').classList.toggle('hidden', !(tipo === 'entrada' && modoEntradaAtual === 'existente'));
}

function selecionarModoEntrada(modo) {
  modoEntradaAtual = modo;
  document.getElementById('btn-entrada-novo-lote').classList.toggle('on', modo === 'novo');
  document.getElementById('btn-entrada-lote-existente').classList.toggle('on', modo === 'existente');
  document.getElementById('grupo-novo-lote').classList.toggle('hidden', modo !== 'novo');
  document.getElementById('grupo-lote-entrada-existente').classList.toggle('hidden', modo !== 'existente');
}

async function abrirModalMovimentacao(item) {
  itemAtual = item;
  tipoMovAtual = 'entrada';
  modoEntradaAtual = 'novo';
  selecionarTipoMov('entrada');
  selecionarModoEntrada('novo');

  document.getElementById('mov-item-id').value = item.id;
  document.getElementById('mov-quantidade').value = '';
  document.getElementById('mov-motivo').value = '';
  document.getElementById('mov-lote-nome').value = '';
  document.getElementById('mov-validade').value = '';
  document.getElementById('mov-disponivel').value = `${item.quantidade} ${item.unidade}`;
  document.getElementById('modal-mov-title').textContent = `Movimentar — ${item.nome}`;
  document.getElementById('modal-mov').classList.remove('hidden');

  const lotesEl = document.getElementById('mov-lotes-atuais');
  const listaEl = document.getElementById('mov-lista');
  lotesEl.innerHTML = '<p class="mov-vazio">Carregando lotes...</p>';
  listaEl.innerHTML = '<p class="mov-vazio">Carregando histórico...</p>';
  try {
    const [lotes, historico] = await Promise.all([
      apiFetch(`/almoxarifado-saude/itens/${item.id}/lotes`),
      apiFetch(`/almoxarifado-saude/itens/${item.id}/movimentacoes`)
    ]);
    lotesAtuais = lotes;
    historicoAtual = historico;
    renderLotesAtuais(lotesAtuais);
    preencherSelectsLote(lotesAtuais);
    renderHistorico(historicoAtual);
  } catch (err) {
    lotesEl.innerHTML = `<p class="mov-vazio">Erro ao carregar lotes: ${esc(err.message)}</p>`;
    listaEl.innerHTML = '';
  }
}

function fmtValidade(validade) {
  if (!validade) return 'sem validade';
  return `val. ${validade.split('-').reverse().join('/')}`;
}

function renderLotesAtuais(lotes) {
  const el = document.getElementById('mov-lotes-atuais');
  if (!lotes.length) {
    el.innerHTML = '<p class="mov-vazio">Nenhum lote em estoque.</p>';
    return;
  }
  el.innerHTML = lotes.map(l => `
    <div class="mov-lote-row">
      <span class="mov-lote-nome">${esc(l.lote)}</span>
      <span class="mov-lote-info">${l.quantidade} · ${esc(fmtValidade(l.validade))}</span>
    </div>
  `).join('');
}

function preencherSelectsLote(lotes) {
  const opcoes = lotes.map(l => `<option value="${l.id}">${esc(l.lote)} — ${l.quantidade} (${esc(fmtValidade(l.validade))})</option>`).join('');
  document.getElementById('mov-lote-saida').innerHTML = opcoes || '<option value="">Nenhum lote disponível</option>';
  document.getElementById('mov-lote-entrada').innerHTML = opcoes || '<option value="">Nenhum lote existente</option>';
}

function renderHistorico(historico) {
  const listaEl = document.getElementById('mov-lista');
  if (!historico.length) {
    listaEl.innerHTML = '<p class="mov-vazio">Nenhuma movimentação registrada.</p>';
    return;
  }
  listaEl.innerHTML = historico.map(m => {
    const quando = new Date(m.realizadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    const sinal = m.tipo === 'entrada' ? '+' : '−';
    return `<div class="mov-row ${m.tipo}">
      <span class="mov-sinal">${sinal}${m.quantidade}</span>
      <span class="mov-info">${esc(m.motivo)} <span class="mov-lote-tag">${esc(m.lote || '')}</span><br><span class="mov-meta">${esc(quando)}</span></span>
    </div>`;
  }).join('');
}

async function registrarMovimentacao(e) {
  e.preventDefault();
  if (!itemAtual) return;
  const btn = document.getElementById('btn-registrar-mov');
  const quantidade = document.getElementById('mov-quantidade').value;
  const motivo = document.getElementById('mov-motivo').value.trim();

  const body = { tipo: tipoMovAtual, quantidade, motivo };
  if (tipoMovAtual === 'saida') {
    body.loteId = document.getElementById('mov-lote-saida').value;
    if (!body.loteId) {
      showToast('Não há lote disponível para dar saída.', 'error');
      return;
    }
  } else if (modoEntradaAtual === 'existente') {
    body.loteId = document.getElementById('mov-lote-entrada').value;
    if (!body.loteId) {
      showToast('Escolha um lote existente ou cadastre um novo.', 'error');
      return;
    }
  } else {
    body.loteNome = document.getElementById('mov-lote-nome').value.trim();
    body.validade = document.getElementById('mov-validade').value || null;
  }

  btn.disabled = true;
  btn.textContent = 'Registrando...';
  try {
    const resp = await apiFetch(`/almoxarifado-saude/itens/${itemAtual.id}/movimentacoes`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    itemAtual.quantidade = resp.quantidadeItem;
    document.getElementById('mov-disponivel').value = `${resp.quantidadeItem} ${itemAtual.unidade}`;
    document.getElementById('mov-quantidade').value = '';
    document.getElementById('mov-motivo').value = '';
    document.getElementById('mov-lote-nome').value = '';
    document.getElementById('mov-validade').value = '';
    showToast(tipoMovAtual === 'entrada' ? 'Entrada registrada' : 'Saída registrada');

    const itemNaLista = itens.find(it => it.id === itemAtual.id);
    if (itemNaLista) itemNaLista.quantidade = resp.quantidadeItem;
    aplicarFiltros();

    // Recarrega lotes e histórico do item (mudou de verdade, precisa da fonte)
    const [lotes, historico] = await Promise.all([
      apiFetch(`/almoxarifado-saude/itens/${itemAtual.id}/lotes`),
      apiFetch(`/almoxarifado-saude/itens/${itemAtual.id}/movimentacoes`)
    ]);
    lotesAtuais = lotes;
    historicoAtual = historico;
    renderLotesAtuais(lotesAtuais);
    preencherSelectsLote(lotesAtuais);
    renderHistorico(historicoAtual);
    await loadStats();
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Registrar';
  }
}

// ==========================================
// TOAST
// ==========================================

let toastTimer = null;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}
