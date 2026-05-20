export const CATEGORIES = {
  ti: "Gestão de T.I.",
  rh: "Recursos Humanos",
  admin: "Administrativo"
};

export const MODULES = {
  dashboard: {
    id: "dashboard",
    title: "Meu Espaço",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    url: "/meu-espaco/index.html"
  },
  emprestimo: {
    id: "emprestimo",
    category: "ti",
    title: "Empréstimos",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    url: "/emprestimo/index.html"
  },
  usuarios: {
    id: "usuarios",
    category: "admin",
    title: "Usuários",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    url: "/usuarios/index.html"
  },
  ensalamento: {
    id: "ensalamento",
    category: "admin",
    title: "Ensalamento",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    url: "/ensalamento/index.html"
  },
  "carga-horaria": {
    id: "carga-horaria",
    category: "rh",
    title: "Carga Horária",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    url: "/rh/carga-horaria/index.html"
  },
  funcionarios: {
    id: "funcionarios",
    category: "rh",
    title: "Funcionários",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    url: "/rh/funcionarios/index.html"
  },
  empresas: {
    id: "empresas",
    category: "admin",
    title: "Parceiros",
    icon: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M3 7v14M21 7v14M6 21V7M18 21V7M9 7h6M9 11h6M9 15h6M9 19h6"/></svg>`,
    url: "/empresas/index.html"
  }
};

export const ROLE_PERMISSIONS = {
  adm_l1: {
    label: "ADM N1",
    modules: ["dashboard", "emprestimo", "usuarios", "ensalamento", "carga-horaria", "funcionarios", "empresas"]
  },
  adm_l2: {
    label: "ADM N2",
    modules: ["dashboard", "emprestimo", "usuarios", "ensalamento", "carga-horaria", "funcionarios", "empresas"]
  },
  ti: {
    label: "T.I.",
    modules: ["dashboard", "emprestimo", "usuarios"]
  },
  rh: {
    label: "RH",
    modules: ["dashboard", "carga-horaria", "funcionarios"]
  },
  visitante: {
    label: "Visitante",
    modules: ["dashboard"]
  }
};

export function hasPermission(role, moduleId) {
  const roleConfig = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS["visitante"];
  return roleConfig.modules.includes(moduleId);
}

export function getRoleConfig(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS["visitante"];
}
