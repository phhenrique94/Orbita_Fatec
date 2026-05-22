import { MODULES, CATEGORIES, getRoleConfig, hasPermission } from './permissions.js';

export function setupLayout(user, role, activeModuleId, onLogout) {
  // Validar permissão (se não for o dashboard ou visitante)
  if (activeModuleId !== 'dashboard' && !hasPermission(role, activeModuleId)) {
    window.location.href = '/index.html';
    return;
  }

  const roleConfig = getRoleConfig(role);
  const name = user.displayName || user.email.split('@')[0];
  const initial = name.charAt(0).toUpperCase();

  // Criar Sidebar
  const sidebar = document.createElement('aside');
  sidebar.className = 'layout-sidebar';
  
  const sidebarHeader = document.createElement('div');
  sidebarHeader.className = 'layout-sidebar-header';
  sidebarHeader.innerHTML = `
    <a href="/index.html" class="layout-brand">
      <div class="orbit-container">
        <div class="orbit-center">F</div>
        <div class="orbit-planet"></div>
      </div>
      <span class="logo-orbita">ÓRBITA</span><span class="logo-fatec">FATEC</span>
    </a>
  `;
  sidebar.appendChild(sidebarHeader);

  // Perfil de Usuário para Mobile na Sidebar (oculto no desktop)
  const sidebarUser = document.createElement('div');
  sidebarUser.className = 'layout-sidebar-user-mobile';
  sidebarUser.innerHTML = `
    <div class="layout-user-avatar">${initial}</div>
    <div class="layout-user-details-mobile">
      <span class="layout-user-name">${name}</span>
      <span class="layout-user-role">${roleConfig.label}</span>
    </div>
  `;
  sidebar.appendChild(sidebarUser);

  const nav = document.createElement('nav');
  nav.className = 'layout-nav';
  
  // 1. Renderizar Módulos sem Categoria (Top-level)
  const topLevelModules = Object.values(MODULES).filter(mod => 
    !mod.category && roleConfig.modules.includes(mod.id)
  );

  topLevelModules.forEach(mod => {
    const link = document.createElement('a');
    link.href = mod.url;
    link.className = `layout-nav-item ${mod.id === activeModuleId ? 'active' : ''}`;
    link.innerHTML = `${mod.icon} <span>${mod.title}</span>`;
    nav.appendChild(link);
  });

  // 2. Renderizar por Categorias
  Object.entries(CATEGORIES).forEach(([catKey, catLabel]) => {
    // Filtrar módulos desta categoria que o usuário tem permissão
    const permittedInCat = Object.values(MODULES).filter(mod => 
      mod.category === catKey && roleConfig.modules.includes(mod.id)
    );

    if (permittedInCat.length > 0) {
      const catWrapper = document.createElement('div');
      catWrapper.className = 'layout-nav-section';

      // Verificar se o módulo ativo está nesta categoria para deixá-la aberta
      const hasActiveMod = permittedInCat.some(m => m.id === activeModuleId);
      const isCollapsed = !hasActiveMod;

      // Adicionar Label da Categoria (com ícone de toggle)
      const label = document.createElement('div');
      label.className = `layout-nav-category ${isCollapsed ? 'collapsed' : ''}`;
      label.innerHTML = `
        <span>${catLabel}</span>
        <svg class="category-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
      `;
      
      const group = document.createElement('div');
      group.className = `layout-nav-group ${isCollapsed ? 'collapsed' : ''}`;

      // Toggle Logic
      label.addEventListener('click', () => {
        label.classList.toggle('collapsed');
        group.classList.toggle('collapsed');
      });

      // Adicionar Módulos
      permittedInCat.forEach(mod => {
        const link = document.createElement('a');
        link.href = mod.url;
        link.className = `layout-nav-item ${mod.id === activeModuleId ? 'active' : ''}`;
        link.innerHTML = `${mod.icon} <span>${mod.title}</span>`;
        group.appendChild(link);
      });

      catWrapper.appendChild(label);
      catWrapper.appendChild(group);
      nav.appendChild(catWrapper);
    }
  });
  
  sidebar.appendChild(nav);

  // Criar Footer com botão de logout na Sidebar para Mobile (oculto no desktop)
  const sidebarFooter = document.createElement('div');
  sidebarFooter.className = 'layout-sidebar-footer-mobile';
  sidebarFooter.innerHTML = `
    <button class="layout-sidebar-logout-btn-mobile" id="layout-sidebar-logout-btn-mobile">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
      <span>Sair do Órbita</span>
    </button>
  `;
  sidebar.appendChild(sidebarFooter);

  // Criar Header
  const header = document.createElement('header');
  header.className = 'layout-header';
  const activeMod = MODULES[activeModuleId];
  header.innerHTML = `
    <div class="layout-header-left">
      <button class="layout-sidebar-toggle" id="layout-sidebar-toggle" aria-label="Abrir menu">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>
      <div class="layout-header-title">
        ${activeMod ? activeMod.title : 'Dashboard'}
      </div>
    </div>
    <div class="layout-header-actions">
      <span class="layout-user-role">${roleConfig.label}</span>
      <div class="layout-user-info">
        <div class="layout-user-avatar">${initial}</div>
        <span class="layout-user-name">${name}</span>
      </div>
      <button class="layout-logout-btn" id="layout-logout-btn" title="Sair">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </div>
  `;

  // Criar Overlay para mobile
  const overlay = document.createElement('div');
  overlay.className = 'layout-sidebar-overlay';

  // Injetar no DOM
  const wrapper = document.querySelector('.layout-wrapper');
  if (wrapper) {
    const existingSidebar = wrapper.querySelector('.layout-sidebar');
    if (existingSidebar) existingSidebar.remove();

    const existingHeader = wrapper.querySelector('.layout-header');
    if (existingHeader) existingHeader.remove();

    const existingOverlay = wrapper.querySelector('.layout-sidebar-overlay');
    if (existingOverlay) existingOverlay.remove();

    wrapper.insertBefore(sidebar, wrapper.firstChild);
    wrapper.appendChild(overlay);
    const main = wrapper.querySelector('.layout-main');
    if (main) {
      main.insertBefore(header, main.firstChild);
    }
  }

  // Toggle Sidebar Mobile
  const toggleBtn = document.getElementById('layout-sidebar-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.add('open');
      overlay.classList.add('active');
    });
  }

  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  }

  // Fechar sidebar ao clicar em um link do menu no mobile
  const navItems = sidebar.querySelectorAll('.layout-nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  });

  // Evento de Logout
  const logoutBtn = document.getElementById('layout-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      clearCachedAuth();
      if (onLogout) onLogout();
    });
  }

  // Evento de Logout Mobile
  const logoutBtnMobile = document.getElementById('layout-sidebar-logout-btn-mobile');
  if (logoutBtnMobile) {
    logoutBtnMobile.addEventListener('click', () => {
      clearCachedAuth();
      if (onLogout) onLogout();
    });
  }

  // Remover auth-guard e mostrar app
  const authGuard = document.getElementById('auth-guard');
  if (authGuard) authGuard.style.display = 'none';
  
  const app = document.getElementById('app');
  if (app) app.classList.remove('hidden');
}

// ==========================================
//  AUTH CACHING HELPERS
// ==========================================
export function getCachedAuth() {
  const uid = localStorage.getItem('orbita_uid');
  const email = localStorage.getItem('orbita_email');
  const displayName = localStorage.getItem('orbita_displayName');
  const role = localStorage.getItem('orbita_role');
  const token = localStorage.getItem('orbita_token');

  if (uid && role) {
    return {
      user: {
        uid,
        email,
        displayName,
        getIdToken: async () => localStorage.getItem('orbita_token') || token || ''
      },
      role,
      token
    };
  }
  return null;
}

export function setCachedAuth(user, role, token) {
  if (user) {
    localStorage.setItem('orbita_uid', user.uid);
    localStorage.setItem('orbita_email', user.email || '');
    localStorage.setItem('orbita_displayName', user.displayName || user.email?.split('@')[0] || '');
  }
  if (role) {
    localStorage.setItem('orbita_role', role);
  }
  if (token) {
    localStorage.setItem('orbita_token', token);
  }
}

export function clearCachedAuth() {
  localStorage.removeItem('orbita_uid');
  localStorage.removeItem('orbita_email');
  localStorage.removeItem('orbita_displayName');
  localStorage.removeItem('orbita_role');
  localStorage.removeItem('orbita_token');
}
