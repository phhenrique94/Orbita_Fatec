import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { firebaseConfig } from "../core/firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const API_BASE = (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.')) 
  ? `http://${window.location.hostname}:3000/api` 
  : '/api';

export async function apiFetch(endpoint, options = {}) {
  const token = await auth.currentUser.getIdToken();
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

// Mock methods para não quebrar a linha 35 do ensalamento.js original
export const db = {};
export const doc = (dbMock, col, id) => `${col}/${id}`;
export const getDoc = async (path) => {
    // Isso intercepta fb.getDoc(fb.doc(fb.db, 'users', uid))
    if (path.startsWith('users/')) {
        const user = await apiFetch('/usuarios/me');
        return {
            exists: () => true,
            data: () => user
        };
    }
    if (path === 'config/permissions') {
        const data = await apiFetch('/usuarios/config/permissions');
        return {
            exists: () => Object.keys(data).length > 0,
            data: () => data
        };
    }
    return { exists: () => false, data: () => ({}) };
};


// CRUD Helpers
export async function getAll(colName) {
  return await apiFetch(`/ensalamento/${colName}`);
}

export async function getActive(colName) {
  return await apiFetch(`/ensalamento/${colName}?active=true`);
}

export async function getById(colName, id) {
  return await apiFetch(`/ensalamento/${colName}/${id}`);
}

export async function create(colName, data) {
  return await apiFetch(`/ensalamento/${colName}`, {
      method: 'POST',
      body: JSON.stringify(data)
  });
}

export async function update(colName, id, data) {
  return await apiFetch(`/ensalamento/${colName}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
  });
}

export async function remove(colName, id) {
  return await apiFetch(`/ensalamento/${colName}/${id}`, {
      method: 'DELETE'
  });
}

export async function toggleActive(colName, id, currentState) {
  return await update(colName, id, { active: !currentState });
}

// Specific Queries
export async function getCalendarEntries(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  return await apiFetch(`/ensalamento/custom/calendarEntries?${params}`);
}

export async function checkConflict(weekday, periods, roomId, classId, excludeId = null) {
  return await apiFetch(`/ensalamento/custom/checkConflict`, {
      method: 'POST',
      body: JSON.stringify({ weekday, periods, roomId, classId, excludeId })
  });
}
