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

let empresas = [];

let appInitialized = false;
let initializedRole = null;

// ==========================================
// AUTH GUARD E INICIALIZAÇÃO
// ==========================================
const cached = getCachedAuth();
if (cached && (cached.role === 'adm_l1' || cached.role === 'adm_l2')) {
  currentUser = cached.user;
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
    let userLevel = 3;
    if (role !== 'adm_l1') {
      try {
        const perms = await apiFetch('/usuarios/config/permissions');
        userLevel = getEffectiveLevel(perms[role] || {}, meuOverrides, 'empresas');
      } catch (e) {
        // Fallback: comportamento anterior (só ADM N1/N2)
        userLevel = role === 'adm_l2' ? 3 : 1;
      }
      if (userLevel < 2) {
        window.location.href = '../meu-espaco/index.html';
        return;
      }
      document.body.classList.toggle('hide-execute', userLevel < 3);
    }

    if (!appInitialized || initializedRole !== role || (cached && (cached.user.displayName !== user.displayName || cached.user.email !== user.email))) {
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
  setupLayout(user, role, 'empresas', async () => {
    clearCachedAuth();
    await signOut(auth);
    window.location.href = '../auth/login.html';
  });

  // Mostra a tela
  document.getElementById('app-root').classList.remove('hidden');
  setupFilters();
  await loadEmpresas();
}

// ==========================================
// FUNÇÕES DO MÓDULO
// ==========================================
async function loadEmpresas() {
    try {
        empresas = await apiFetch('/empresas');
        applyFilters();
    } catch (err) {
        alert("Erro ao carregar parceiros: " + err.message);
    }
}

function applyFilters() {
    const texto = (document.getElementById('filter-texto')?.value || '').toLowerCase();
    const cat   = document.getElementById('filter-categoria')?.value || '';

    const filtered = empresas.filter(emp => {
        const matchTexto = !texto ||
            (emp.nome        || '').toLowerCase().includes(texto) ||
            (emp.descricao   || '').toLowerCase().includes(texto) ||
            (emp.localizacao || '').toLowerCase().includes(texto) ||
            (emp.desconto    || '').toLowerCase().includes(texto);
        const matchCat = !cat || emp.categoria === cat;
        return matchTexto && matchCat;
    });

    const hasFilter = !!(texto || cat);
    document.getElementById('btn-clear-filters')?.classList.toggle('hidden', !hasFilter);
    renderTable(filtered);
}

function setupFilters() {
    document.getElementById('filter-texto')?.addEventListener('input', applyFilters);
    document.getElementById('filter-categoria')?.addEventListener('change', applyFilters);
}

window.clearFilters = function() {
    document.getElementById('filter-texto').value = '';
    document.getElementById('filter-categoria').value = '';
    applyFilters();
};

function renderTable(lista = empresas) {
    const tbody = document.getElementById('empresas-list');
    if (!lista.length) {
        const msg = empresas.length
            ? 'Nenhum parceiro encontrado com esses filtros.'
            : 'Nenhum parceiro cadastrado.';
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color:#64748b;">${msg}</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(emp => `
        <tr>
            <td><strong>${emp.nome}</strong></td>
            <td><span class="badge-categoria">${emp.categoria || 'Geral'}</span></td>
            <td>${emp.descricao}</td>
            <td>${emp.localizacao}</td>
            <td><span class="badge-discount">${emp.desconto}</span></td>
            <td>
                <button class="btn-sm" onclick="editEmpresa('${emp.id}')">Editar</button>
                <button class="btn-sm danger" onclick="deleteEmpresa('${emp.id}')">Excluir</button>
            </td>
        </tr>
    `).join('');
}

window.openModal = function() {
    document.getElementById('form-empresa').reset();
    document.getElementById('empresa-id').value = '';
    document.getElementById('modal-title').innerText = 'Novo Parceiro';
    document.getElementById('modal-empresa').classList.remove('hidden');
}

window.closeModal = function() {
    document.getElementById('modal-empresa').classList.add('hidden');
}

window.editEmpresa = function(id) {
    const emp = empresas.find(e => e.id === id);
    if (!emp) return;
    document.getElementById('empresa-id').value = emp.id;
    document.getElementById('empresa-nome').value = emp.nome;
    document.getElementById('empresa-categoria').value = emp.categoria || '';
    document.getElementById('empresa-descricao').value = emp.descricao;
    document.getElementById('empresa-localizacao').value = emp.localizacao;
    document.getElementById('empresa-desconto').value = emp.desconto;
    document.getElementById('modal-title').innerText = 'Editar Parceiro';
    document.getElementById('modal-empresa').classList.remove('hidden');
}

window.deleteEmpresa = async function(id) {
    if (!confirm('Tem certeza que deseja remover este parceiro?')) return;
    try {
        await apiFetch(`/empresas/${id}`, { method: 'DELETE' });
        await loadEmpresas();
    } catch (err) {
        alert("Erro ao remover: " + err.message);
    }
}

document.getElementById('form-empresa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('empresa-id').value;
    const data = {
        nome: document.getElementById('empresa-nome').value,
        categoria: document.getElementById('empresa-categoria').value,
        descricao: document.getElementById('empresa-descricao').value,
        localizacao: document.getElementById('empresa-localizacao').value,
        desconto: document.getElementById('empresa-desconto').value,
    };

    try {
        if (id) {
            await apiFetch(`/empresas/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            await apiFetch(`/empresas`, {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }
        closeModal();
        await loadEmpresas();
    } catch (err) {
        alert("Erro ao salvar: " + err.message);
    }
});
