import * as fb from './firebase-service.js';
import { SimulationEngine } from './simulation-engine.js';
import { setupLayout, getCachedAuth, setCachedAuth, clearCachedAuth } from '../core/layout.js';
import { escapeHTML as esc } from '../core/security.js';

// --- STATE MANAGEMENT ---
let currentTab = 'calendario';
let courses = [];
let classes = [];
let rooms = [];
let calendarEntries = [];
let currentUser = null;
let simulationLessons = []; // Temp lessons for simulator
let currentSimulationResults = [];


// --- CONSTANTS ---
const WEEKDAYS = {
  1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado'
};

const CLASS_TYPES = {
  presencial: { label: 'Presencial', class: 'entry-presencial', bg: 'bg-blue' },
  ead: { label: 'EAD', class: 'entry-ead', bg: 'bg-green' },
  carga_reservada: { label: 'Carga Reservada', class: 'entry-reservada', bg: 'bg-yellow' }
};

let appInitialized = false;
let initializedRole = null;

async function initApp(role) {
  if (appInitialized && initializedRole === role) return;
  appInitialized = true;
  initializedRole = role;

  setupLayout(currentUser, role, 'ensalamento', async () => {
    clearCachedAuth();
    await fb.auth.signOut();
    window.location.href = '../auth/login.html';
  });

  setupEventListeners();
  await loadAllData();
  renderCalendar();
}

// Check cache immediately
const cached = getCachedAuth();
if (cached && ['adm_l1', 'adm_l2', 'ti'].includes(cached.role)) {
  currentUser = cached.user;
  initApp(cached.role);
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  fb.auth.onAuthStateChanged(async user => {
    if (user) {
      currentUser = user;
      
      let role = 'visitante';
      try {
        // Buscar Cargo do Usuário
        const userSnap = await fb.getDoc(fb.doc(fb.db, 'users', user.uid));
        role = userSnap.exists() ? userSnap.data().role : 'visitante';
      } catch (err) {
        role = cached ? cached.role : 'visitante';
      }

      // Buscar Permissões Globais
      let perms = { view: false, execute: false };
      try {
        const permSnap = await fb.getDoc(fb.doc(fb.db, 'config', 'permissions'));
        if (permSnap.exists()) {
          const allPerms = permSnap.data();
          perms = allPerms[role]?.ensalamento || { view: false, execute: false };
        }
      } catch (err) {
        // Falha silenciosa para segurança
      }

      const token = await user.getIdToken();
      setCachedAuth(user, role, token);

      // ADM L1 entra direto. Outros precisam de 'view'.
      if (role !== 'adm_l1' && !perms.view) {
        window.location.href = '../meu-espaco/index.html';
        return;
      }

      // Se não puder executar, esconde botões
      if (role !== 'adm_l1' && !perms.execute) {
        document.body.classList.add('hide-execute');
      } else {
        document.body.classList.remove('hide-execute');
      }

      if (!appInitialized || initializedRole !== role || (cached && (cached.user.displayName !== user.displayName || cached.user.email !== user.email))) {
        initApp(role);
      }
    } else {
      clearCachedAuth();
      window.location.href = '../auth/login.html';
    }
  });
});

async function loadAllData() {
  courses = await fb.getActive('courses');
  classes = await fb.getActive('classes');
  rooms = await fb.getActive('rooms');
  calendarEntries = await fb.getCalendarEntries();

  updateSelects();
  renderCourses();
  renderClasses();
  renderRooms();
}

// --- TAB NAVIGATION ---
function setupEventListeners() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      const tabId = `tab-${btn.dataset.tab}`;
      document.getElementById(tabId).classList.add('active');
      currentTab = btn.dataset.tab;
    });
  });


  // Modal Close Buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-overlay').style.display = 'none';
    });
  });

  // Filters
  ['filter-course', 'filter-room', 'filter-view-mode'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderCalendar);
  });

  // Course Actions
  document.getElementById('btn-add-course').addEventListener('click', () => openCourseModal());
  document.getElementById('form-course').addEventListener('submit', handleCourseSubmit);

  // Class Actions
  document.getElementById('btn-add-class').addEventListener('click', () => openClassModal());
  document.getElementById('form-class').addEventListener('submit', handleClassSubmit);

  // Room Actions
  document.getElementById('btn-add-room').addEventListener('click', () => openRoomModal());
  document.getElementById('form-room').addEventListener('submit', handleRoomSubmit);

  // Tab Filters
  ['filter-tab-class-course', 'filter-tab-class-search'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderClasses);
    if (document.getElementById(id).tagName === 'SELECT') {
      document.getElementById(id).addEventListener('change', renderClasses);
    }
  });

  ['filter-tab-room-type', 'filter-tab-room-block', 'filter-tab-room-search'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderRooms);
    if (document.getElementById(id).tagName === 'SELECT') {
      document.getElementById(id).addEventListener('change', renderRooms);
    }
  });

  // Manual Entry Actions
  document.getElementById('btn-open-manual-entry').addEventListener('click', () => openManualEntryModal());
  document.getElementById('form-manual-entry').addEventListener('submit', handleManualEntrySubmit);
  document.getElementById('btn-delete-entry').addEventListener('click', handleDeleteEntry);
  document.getElementById('entry-type').addEventListener('change', (e) => {
    const roomGroup = document.getElementById('entry-room-group');
    roomGroup.style.display = e.target.value === 'presencial' ? 'block' : 'none';
  });

  // Simulation Actions
  document.getElementById('btn-open-simulation').addEventListener('click', openSimulationModal);
  document.getElementById('btn-sim-add-lesson').addEventListener('click', addLessonToSimulation);
  document.getElementById('btn-run-simulation').addEventListener('click', runSimulation);
  document.getElementById('btn-sim-institutional').addEventListener('click', applyInstitutionalPattern);
  document.getElementById('btn-back-to-lessons').addEventListener('click', () => {
    document.getElementById('simulation-step-1').style.display = 'block';
    document.getElementById('simulation-step-2').style.display = 'none';
  });

  // Course -> Class Select Synchronization
  document.getElementById('entry-course-id').addEventListener('change', (e) => updateClassCheckboxes(e.target.value, 'entry-classes-container'));
  document.getElementById('sim-course-id').addEventListener('change', (e) => updateClassCheckboxes(e.target.value, 'sim-classes-container'));
  document.getElementById('filter-course').addEventListener('change', renderCalendar); 
}

// --- CALENDAR RENDER ---
async function renderCalendar() {
  const container = document.getElementById('calendar-view-container');
  const viewMode = document.getElementById('filter-view-mode').value;
  const courseFilter = document.getElementById('filter-course').value;
  const roomFilter = document.getElementById('filter-room').value;

  const filteredEntries = calendarEntries.filter(entry => {
    if (courseFilter && entry.courseId !== courseFilter) return false;
    if (roomFilter && entry.roomId !== roomFilter) return false;
    return true;
  });

  if (viewMode === 'ocupacao') {
    renderOccupancyTable(container, filteredEntries, courseFilter);
  } else {
    renderPeriodGrid(container, filteredEntries);
  }
}

function renderOccupancyTable(container, entries, courseFilter) {
  const roomFilter = document.getElementById('filter-room').value;

  // AGRUPAMENTO: Agrupar entradas que compartilham exatamente o mesmo conjunto de turmas e salas
  // Em vez de iterar por Turmas, vamos iterar pelas Entradas únicas
  const entryGroups = {};
  
  entries.forEach(e => {
    // Identificador único da "Linha": Curso + Conjunto de Turmas + Sala Principal (presencial)
    const classIdsKey = (e.classIds || [e.classId]).sort().join(',');
    const groupKey = `${e.courseId}|${classIdsKey}`;
    
    if (!entryGroups[groupKey]) {
      entryGroups[groupKey] = {
        courseId: e.courseId,
        classIds: e.classIds || [e.classId],
        entries: []
      };
    }
    entryGroups[groupKey].entries.push(e);
  });

  const sortedGroups = Object.values(entryGroups).sort((a, b) => {
    const courseA = courses.find(c => c.id === a.courseId);
    const courseB = courses.find(c => c.id === b.courseId);
    const nameA = courseA ? courseA.name : '';
    const nameB = courseB ? courseB.name : '';
    const courseCompare = nameA.localeCompare(nameB);
    if (courseCompare !== 0) return courseCompare;

    // Desempate pelas turmas
    const turmasA = a.classIds.map(id => classes.find(t => t.id === id)?.name || '').sort().join('');
    const turmasB = b.classIds.map(id => classes.find(t => t.id === id)?.name || '').sort().join('');
    return turmasA.localeCompare(turmasB);
  });

  const tableRows = sortedGroups.map(group => {
    const course = courses.find(c => c.id === group.courseId);
    if (!course) return '';
    
    // Nomes das turmas
    const turmas = group.classIds.map(id => classes.find(t => t.id === id)).filter(Boolean);
    const semesters = [...new Set(turmas.map(t => t.semester))].sort((a, b) => a - b);
    const semestersStr = semesters.length > 1 ? `${semesters[0]}º e ${semesters[semesters.length-1]}º` : `${semesters[0]}º`;
    const turmasNames = turmas.map(t => esc(t.name)).join(' / ');

    // Sala Principal (baseada no primeiro dia presencial)
    const presencial = group.entries.find(e => e.classType === 'presencial');
    const mainRoom = presencial ? esc(rooms.find(r => r.id === presencial.roomId)?.name) : '-';
    
    if (roomFilter && !group.entries.some(e => e.roomId === roomFilter)) return '';

    const daysHtml = [1, 2, 3, 4, 5].map(day => {
      const dayEntry = group.entries.find(e => e.weekday === day);
      if (!dayEntry) {
        // Encontrar uma sala válida para este grupo (se houver presencial em outro dia)
        return `<td><div class="cell-empty" style="cursor:pointer; width:100%; height:40px; display:flex; align-items:center; justify-content:center;" onclick="openManualEntryForSlot('${group.courseId}', '${group.classIds.join(',')}', ${day}, '${presencial?.roomId || ''}')">-</div></td>`;
      }

      let pillClass = '';
      let label = '';
      if (dayEntry.classType === 'presencial') {
        const room = rooms.find(r => r.id === dayEntry.roomId);
        pillClass = 'pill-presencial';
        label = room ? esc(room.name) : 'SALA';
      } else if (dayEntry.classType === 'ead') {
        pillClass = 'pill-ead';
        label = 'EAD';
      } else {
        pillClass = 'pill-reservada';
        label = 'RESERVADA';
      }

      return `<td><div class="status-pill ${pillClass}" onclick="openManualEntryModalById('${dayEntry.id}')">${label}</div></td>`;
    }).join('');

    const entryIds = group.entries.map(e => e.id).join(',');

    return `
      <tr>
        <td class="cell-sala-header">${mainRoom}</td>
        <td class="cell-curso-header">
          <div style="display:flex; justify-content:space-between; align-items:start">
            <div>
              <div style="font-weight:900; letter-spacing:0.5px">${esc(course.name)}</div>
              <div style="font-size:0.7rem; color:rgba(255,255,255,0.4); margin-top:0.2rem">${turmasNames}</div>
            </div>
            <button class="btn-icon" style="color:#ef4444; opacity:0.3; padding:4px" onclick="deleteEntryGroup('${entryIds}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
        <td class="cell-periodo-header">${semestersStr} Período</td>
        ${daysHtml}
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <div class="occupancy-table-container">
      <table class="occupancy-table">
        <thead>
          <tr>
            <th>Sala</th>
            <th style="text-align:left">Curso / Turmas</th>
            <th>Período</th>
            <th>SEG</th>
            <th>TER</th>
            <th>QUA</th>
            <th>QUI</th>
            <th>SEX</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows || '<tr><td colspan="8" class="cell-empty" style="padding:4rem">Nenhum ensalamento encontrado para os filtros selecionados.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function renderPeriodGrid(container, entries) {
  container.innerHTML = `
    <div class="calendar-grid" id="calendar-grid">
      <div class="calendar-header">Período</div>
      <div class="calendar-header">Segunda</div>
      <div class="calendar-header">Terça</div>
      <div class="calendar-header">Quarta</div>
      <div class="calendar-header">Quinta</div>
      <div class="calendar-header">Sexta</div>
      <div class="calendar-header">Sábado</div>

      <div class="calendar-time-col"><strong>P1</strong><span>19:30 - 20:40</span></div>
      <div class="calendar-cell" data-weekday="1" data-period="1"></div>
      <div class="calendar-cell" data-weekday="2" data-period="1"></div>
      <div class="calendar-cell" data-weekday="3" data-period="1"></div>
      <div class="calendar-cell" data-weekday="4" data-period="1"></div>
      <div class="calendar-cell" data-weekday="5" data-period="1"></div>
      <div class="calendar-cell" data-weekday="6" data-period="1"></div>

      <div class="calendar-time-col"><strong>P2</strong><span>21:00 - 22:30</span></div>
      <div class="calendar-cell" data-weekday="1" data-period="2"></div>
      <div class="calendar-cell" data-weekday="2" data-period="2"></div>
      <div class="calendar-cell" data-weekday="3" data-period="2"></div>
      <div class="calendar-cell" data-weekday="4" data-period="2"></div>
      <div class="calendar-cell" data-weekday="5" data-period="2"></div>
      <div class="calendar-cell" data-weekday="6" data-period="2"></div>
    </div>
  `;

  entries.forEach(entry => {
    const course = courses.find(c => c.id === entry.courseId);
    const turma = classes.find(c => c.id === entry.classId);
    const sala = rooms.find(r => r.id === entry.roomId);
    const typeCfg = CLASS_TYPES[entry.classType] || CLASS_TYPES.presencial;

    entry.periods.forEach(period => {
      const cell = container.querySelector(`.calendar-cell[data-weekday="${entry.weekday}"][data-period="${period}"]`);
      if (cell) {
        const div = document.createElement('div');
        div.className = `calendar-entry ${typeCfg.class}`;
        div.innerHTML = `
          <span class="entry-title">${turma ? esc(turma.name) : 'Turma N/A'}</span>
          <span class="entry-subtitle">${course ? esc(course.code) : ''}</span>
          ${entry.roomId ? `<span class="entry-room">${sala ? esc(sala.name) : 'N/A'}</span>` : ''}
        `;
        div.onclick = () => openManualEntryModal(entry);
        cell.appendChild(div);
      }
    });
  });
}

window.openManualEntryModalById = (id) => {
  const entry = calendarEntries.find(e => e.id === id);
  if (entry) openManualEntryModal(entry);
};

// --- CRUD: COURSES ---
function openCourseModal(course = null) {
  const modal = document.getElementById('modal-course');
  document.getElementById('course-modal-title').textContent = course ? 'Editar Curso' : 'Novo Curso';
  document.getElementById('course-id').value = course ? course.id : '';
  document.getElementById('course-name').value = course ? course.name : '';
  document.getElementById('course-code').value = course ? course.code : '';
  modal.style.display = 'flex';
}

async function handleCourseSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('course-id').value;
  const data = {
    name: document.getElementById('course-name').value,
    code: document.getElementById('course-code').value.toUpperCase()
  };

  if (id) await fb.update('courses', id, data);
  else await fb.create('courses', data);

  document.getElementById('modal-course').style.display = 'none';
  await loadAllData();
}

function renderCourses() {
  const grid = document.getElementById('courses-grid');
  grid.innerHTML = courses.map(course => `
    <div class="data-card">
      <div>
        <h3 style="margin-bottom:0.2rem">${esc(course.name)}</h3>
        <span class="badge" style="background:rgba(255,255,255,0.1)">${esc(course.code)}</span>
      </div>
      <div class="card-actions">
        <button class="btn-icon" onclick="editCourse('${course.id}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon" style="color:#ef4444" onclick="toggleActive('courses', '${course.id}', true)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

window.editCourse = (id) => openCourseModal(courses.find(c => c.id === id));

// --- CRUD: CLASSES ---
function openClassModal(turma = null) {
  const modal = document.getElementById('modal-class');
  document.getElementById('class-modal-title').textContent = turma ? 'Editar Turma' : 'Nova Turma';
  document.getElementById('class-id').value = turma ? turma.id : '';
  document.getElementById('class-course-id').value = turma ? turma.courseId : '';
  document.getElementById('class-name').value = turma ? turma.name : '';
  document.getElementById('class-semester').value = turma ? turma.semester : 1;
  document.getElementById('class-student-count').value = turma ? turma.studentCount : '';
  document.getElementById('class-shift').value = turma ? turma.shift : 'noturno';
  modal.style.display = 'flex';
}

async function handleClassSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('class-id').value;
  const data = {
    courseId: document.getElementById('class-course-id').value,
    name: document.getElementById('class-name').value,
    semester: parseInt(document.getElementById('class-semester').value),
    studentCount: parseInt(document.getElementById('class-student-count').value),
    shift: document.getElementById('class-shift').value
  };

  if (id) await fb.update('classes', id, data);
  else await fb.create('classes', data);

  document.getElementById('modal-class').style.display = 'none';
  await loadAllData();
}

function renderClasses() {
  const grid = document.getElementById('classes-grid');
  const courseFilter = document.getElementById('filter-tab-class-course').value;
  const searchFilter = document.getElementById('filter-tab-class-search').value.toLowerCase();

  let filtered = classes.filter(t => {
    const matchesCourse = !courseFilter || t.courseId === courseFilter;
    const matchesSearch = !searchFilter || t.name.toLowerCase().includes(searchFilter);
    return matchesCourse && matchesSearch;
  });

  // Ordenar numericamente por semestre
  filtered.sort((a, b) => a.semester - b.semester);

  grid.innerHTML = filtered.map(t => {
    const course = courses.find(c => c.id === t.courseId);
    return `
      <div class="data-card">
        <div>
          <h3 style="margin-bottom:0.2rem">${esc(t.name)}</h3>
          <span class="badge bg-blue">${course ? esc(course.code) : 'N/A'}</span>
          <span class="badge" style="background:rgba(255,255,255,0.05)">${esc(t.studentCount)} alunos</span>
          <span class="badge" style="background:rgba(255,255,255,0.05)">${esc(t.semester)}º Sem.</span>
        </div>
        <div class="card-actions">
          <button class="btn-icon action-execute" onclick="editClass('${t.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon action-execute" style="color:#ef4444" onclick="toggleActive('classes', '${t.id}', true)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.editClass = (id) => openClassModal(classes.find(c => c.id === id));

// --- CRUD: SALAS ---
function openRoomModal(sala = null) {
  const modal = document.getElementById('modal-room');
  document.getElementById('room-modal-title').textContent = sala ? 'Editar Sala' : 'Nova Sala';
  document.getElementById('room-id').value = sala ? sala.id : '';
  document.getElementById('room-name').value = sala ? sala.name : '';
  document.getElementById('room-block').value = sala ? sala.block : '';
  document.getElementById('room-capacity').value = sala ? sala.capacity : '';
  document.getElementById('room-type').value = sala ? sala.type : 'sala';
  document.getElementById('room-resources').value = sala ? (sala.resources || []).join(', ') : '';
  modal.style.display = 'flex';
}

async function handleRoomSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('room-id').value;
  const resources = document.getElementById('room-resources').value.split(',').map(s => s.trim()).filter(s => s);
  
  const data = {
    name: document.getElementById('room-name').value,
    block: document.getElementById('room-block').value.toUpperCase(),
    capacity: parseInt(document.getElementById('room-capacity').value),
    type: document.getElementById('room-type').value,
    resources
  };

  if (id) await fb.update('rooms', id, data);
  else await fb.create('rooms', data);

  document.getElementById('modal-room').style.display = 'none';
  await loadAllData();
}

function renderRooms() {
  const grid = document.getElementById('rooms-grid');
  const typeFilter = document.getElementById('filter-tab-room-type').value;
  const blockFilter = document.getElementById('filter-tab-room-block').value.toLowerCase();
  const searchFilter = document.getElementById('filter-tab-room-search').value.toLowerCase();

  let filtered = rooms.filter(r => {
    const matchesType = !typeFilter || r.type === typeFilter;
    const matchesBlock = !blockFilter || r.block.toLowerCase().includes(blockFilter);
    const matchesSearch = !searchFilter || r.name.toLowerCase().includes(searchFilter);
    return matchesType && matchesBlock && matchesSearch;
  });

  // Ordenar alfabeticamente/numéricamente pelo nome da sala
  filtered.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  grid.innerHTML = filtered.map(r => `
    <div class="data-card">
      <div>
        <h3 style="margin-bottom:0.2rem">${esc(r.name)} - Bloco ${esc(r.block)}</h3>
        <span class="badge bg-green">${esc(r.type)}</span>
        <span class="badge" style="background:rgba(255,255,255,0.05)">Cap: ${esc(r.capacity)}</span>
      </div>
      <div style="font-size:0.75rem; color:rgba(255,255,255,0.5)">
        ${(r.resources || []).map(res => `• ${esc(res)}`).join(' ')}
      </div>
      <div class="card-actions">
        <button class="btn-icon action-execute" onclick="editRoom('${r.id}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon action-execute" style="color:#ef4444" onclick="toggleActive('rooms', '${r.id}', true)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>
  `).join('');
}

window.editRoom = (id) => openRoomModal(rooms.find(r => r.id === id));

async function handleCleanRooms() {
  if (!confirm('Esta ação irá mesclar salas com nomes similares (ex: Sala 1 e SALA 01) e excluir as duplicadas do banco de dados. Deseja continuar?')) return;

  const btn = document.getElementById('btn-clean-rooms');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Limpando...';
  btn.disabled = true;

  try {
    const rawRooms = await fb.getActive('rooms');
    const groups = {};

    function normalize(name) {
      return name.toUpperCase()
        .replace(/\s+/g, '') 
        .replace(/0(\d+)/g, '$1'); 
    }

    // Agrupar por nome normalizado
    rawRooms.forEach(r => {
      const norm = normalize(r.name);
      if (!groups[norm]) groups[norm] = [];
      groups[norm].push(r);
    });

    let totalDeleted = 0;
    let totalMerged = 0;

    for (const norm in groups) {
      const roomList = groups[norm];
      if (roomList.length > 1) {
        // Manter a primeira, excluir as outras
        const keep = roomList[0];
        const toDelete = roomList.slice(1);

        for (const target of toDelete) {
          // 1. Encontrar agendamentos desta sala e migrar para a 'keep'
          const entriesToMigrate = calendarEntries.filter(e => e.roomId === target.id);
          for (const entry of entriesToMigrate) {
            await fb.update('calendarEntries', entry.id, { roomId: keep.id });
            totalMerged++;
          }
          // 2. Deletar a sala duplicada
          await fb.remove('rooms', target.id);
          totalDeleted++;
        }
      }
    }

    alert(`Limpeza concluída!\n- ${totalDeleted} salas duplicadas removidas.\n- ${totalMerged} agendamentos migrados.`);
    await loadAllData();
  } catch (error) {
    console.error(error);
    alert('Erro ao limpar salas: ' + error.message);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

window.toggleActive = async (col, id, current) => {
  if (confirm('Deseja realmente inativar este registro?')) {
    await fb.update(col, id, { active: false });
    await loadAllData();
  }
};

// --- MANUAL ENTRY ---
function openManualEntryModal(entry = null) {
  const modal = document.getElementById('modal-manual-entry');
  document.getElementById('entry-modal-title').textContent = entry ? 'Editar Lançamento' : 'Lançamento Manual';
  document.getElementById('entry-id').value = entry ? entry.id : '';
  document.getElementById('btn-delete-entry').style.display = entry ? 'block' : 'none';

  if (entry) {
    document.getElementById('entry-course-id').value = entry.courseId;
    updateClassCheckboxes(entry.courseId, 'entry-classes-container');
    
    // Marcar checkboxes das turmas
    const classIds = entry.classIds || [entry.classId];
    setTimeout(() => {
      document.querySelectorAll('#entry-classes-container input[name="selected-classes"]').forEach(cb => {
        cb.checked = classIds.includes(cb.value);
      });
    }, 100);

    document.getElementById('entry-weekday').value = entry.weekday;
    document.getElementById('entry-type').value = entry.classType;
    document.getElementById('entry-room-id').value = entry.roomId || '';
    document.getElementById('entry-notes').value = entry.notes || '';
    
    document.querySelectorAll('input[name="entry-periods"]').forEach(cb => {
      cb.checked = entry.periods.includes(parseInt(cb.value));
    });
  } else {
    document.getElementById('form-manual-entry').reset();
    document.getElementById('entry-classes-container').innerHTML = '<p style="color:rgba(255,255,255,0.3); font-size:0.8rem; padding:0.5rem">Selecione um curso...</p>';
  }

  modal.style.display = 'flex';
  document.getElementById('entry-type').dispatchEvent(new Event('change'));
}

async function handleManualEntrySubmit(e) {
  e.preventDefault();
  const id = document.getElementById('entry-id').value;
  const periods = Array.from(document.querySelectorAll('input[name="entry-periods"]:checked')).map(cb => parseInt(cb.value));
  
  if (periods.length === 0) {
    alert('Selecione pelo menos um período.');
    return;
  }

  const classIds = Array.from(document.querySelectorAll('#entry-classes-container input[name="selected-classes"]:checked')).map(cb => cb.value);
  
  if (classIds.length === 0) {
    alert('Selecione pelo menos uma turma.');
    return;
  }

  const data = {
    courseId: document.getElementById('entry-course-id').value,
    classIds: classIds,
    weekday: parseInt(document.getElementById('entry-weekday').value),
    classType: document.getElementById('entry-type').value,
    periods: periods,
    roomId: document.getElementById('entry-type').value === 'presencial' ? document.getElementById('entry-room-id').value : null,
    notes: document.getElementById('entry-notes').value,
    source: 'manual'
  };

  // --- LÓGICA DE INVERSÃO/SWAP ---
  // Se estamos editando um registro existente e o novo horário já está ocupado por OUTRO registro deste MESMO grupo de turmas, 
  // nós invertemos eles em vez de dar conflito.
  if (id) {
    const existingEntry = calendarEntries.find(e => e.id === id);
    // Procurar por um registro que esteja no destino e que pertença às mesmas turmas
    const conflictEntry = calendarEntries.find(e => 
      e.id !== id &&
      e.weekday === data.weekday &&
      e.periods.some(p => data.periods.includes(p)) &&
      (e.classIds || [e.classId]).sort().join(',') === data.classIds.sort().join(',')
    );

    if (conflictEntry) {
      if (confirm(`O horário de ${WEEKDAYS[data.weekday]} já está ocupado por este grupo. Deseja INVERTER as aulas (Trocar ${WEEKDAYS[existingEntry.weekday]} por ${WEEKDAYS[data.weekday]})?`)) {
        // Mover o registro conflitante para o lugar onde o atual estava
        await fb.update('calendarEntries', conflictEntry.id, {
          weekday: existingEntry.weekday,
          periods: existingEntry.periods,
          roomId: existingEntry.roomId,
          classType: existingEntry.classType
        });
        // Agora o lugar está livre, o código abaixo salvará o registro 'id' normalmente
      }
    }
  }

  // Validar conflitos para CADA turma selecionada (exceto se for o swap que acabamos de resolver)
  for (const cid of classIds) {
    const conflicts = await fb.checkConflict(data.weekday, data.periods, data.roomId, cid, id);
    if (conflicts.length > 0) {
      alert(`Conflito para a turma ${classes.find(t => t.id === cid)?.name}:\n` + conflicts.join('\n'));
      return;
    }
  }

  if (id) await fb.update('calendarEntries', id, data);
  else await fb.create('calendarEntries', data);

  document.getElementById('modal-manual-entry').style.display = 'none';
  await loadAllData();
  renderCalendar();
}

window.openManualEntryForSlot = (courseId, classIdsStr, weekday, roomId) => {
  openManualEntryModal(); // Abre resetado
  document.getElementById('entry-course-id').value = courseId;
  updateClassCheckboxes(courseId, 'entry-classes-container');
  
  const classIds = classIdsStr.split(',');
  setTimeout(() => {
    document.querySelectorAll('#entry-classes-container input[name="selected-classes"]').forEach(cb => {
      cb.checked = classIds.includes(cb.value);
    });
    document.getElementById('entry-weekday').value = weekday;
    document.getElementById('entry-room-id').value = roomId;
    document.getElementById('entry-type').value = roomId ? 'presencial' : 'ead';
  }, 100);
};

window.deleteEntryGroup = async (idsStr) => {
  if (!confirm('Deseja excluir TODOS os lançamentos desta linha? Esta ação não pode ser desfeita.')) return;
  const ids = idsStr.split(',');
  for (const id of ids) {
    await fb.remove('calendarEntries', id);
  }
  await loadAllData();
  renderCalendar();
};

async function handleDeleteEntry() {
  const id = document.getElementById('entry-id').value;
  if (id && confirm('Excluir este lançamento?')) {
    await fb.remove('calendarEntries', id);
    document.getElementById('modal-manual-entry').style.display = 'none';
    await loadAllData();
    renderCalendar();
  }
}

// --- SIMULATION FLOW ---
function openSimulationModal() {
  document.getElementById('modal-simulation').style.display = 'flex';
  document.getElementById('simulation-step-1').style.display = 'block';
  document.getElementById('simulation-step-2').style.display = 'none';
  
  simulationLessons = [];
  renderSimulationLessons();
  
  // Mostrar gargalos iniciais
  renderBottlenecks();

  // Add 1 initial lesson
  addLessonToSimulation();
}

function renderBottlenecks() {
  const container = document.getElementById('sim-bottlenecks');
  if (!container) return;

  const engine = new SimulationEngine(rooms, classes, calendarEntries);
  const bottlenecks = engine.bottlenecks;

  container.innerHTML = `
    <h5 style="margin-bottom:1.2rem; font-size:0.7rem; color:#64748B; font-weight:800; letter-spacing:1px; text-transform:uppercase;">Capacidade Institucional Disponível</h5>
    <div class="bottleneck-container">
      ${Object.entries(bottlenecks).map(([day, data]) => `
        <div class="bottleneck-card">
          <h6>${WEEKDAYS[day]}</h6>
          <div class="bottleneck-value" style="color:#1E293B">${data.available}</div>
          <div style="font-size:0.6rem; color:#64748B; margin-bottom:0.8rem; text-transform:uppercase">salas livres</div>
          <span class="bottleneck-status status-${data.status}">${data.status.toUpperCase()}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function applyInstitutionalPattern() {
  simulationLessons = [
    { id: 1, lessonNumber: 1, classType: 'presencial', periods: [1, 2], roomSelectionMode: 'auto', selectedRoomId: '', requiredRoomType: '', requiredResources: [] },
    { id: 2, lessonNumber: 2, classType: 'presencial', periods: [1, 2], roomSelectionMode: 'auto', selectedRoomId: '', requiredRoomType: '', requiredResources: [] },
    { id: 3, lessonNumber: 3, classType: 'presencial', periods: [1, 2], roomSelectionMode: 'auto', selectedRoomId: '', requiredRoomType: '', requiredResources: [] },
    { id: 4, lessonNumber: 4, classType: 'ead', periods: [1, 2], roomSelectionMode: 'auto', selectedRoomId: '', requiredRoomType: '', requiredResources: [] },
    { id: 5, lessonNumber: 5, classType: 'carga_reservada', periods: [1, 2], roomSelectionMode: 'auto', selectedRoomId: '', requiredRoomType: '', requiredResources: [] }
  ];
  renderSimulationLessons();
}

function addLessonToSimulation() {
  simulationLessons.push({
    id: Date.now() + Math.random(),
    lessonNumber: simulationLessons.length + 1,
    classType: 'presencial',
    periods: [1, 2],
    selectedRoomId: '',
    roomSelectionMode: 'auto',
    requiredRoomType: '',
    requiredResources: []
  });
  renderSimulationLessons();
}

function renderSimulationLessons() {
  const list = document.getElementById('sim-lessons-list');
  const roomOptions = [...rooms]
    .sort((a, b) => a.name.toUpperCase().localeCompare(b.name.toUpperCase(), undefined, { numeric: true }))
    .map(r => `<option value="${r.id}">${r.name}</option>`)
    .join('');

  list.innerHTML = simulationLessons.map((lesson, idx) => `
    <div class="lesson-item">
      <h5>Aula #${lesson.lessonNumber}</h5>
      
      <div class="filter-group">
        <label>Tipo</label>
        <select onchange="updateLesson(${idx}, 'classType', this.value)" class="form-select">
          <option value="presencial" ${lesson.classType === 'presencial' ? 'selected' : ''}>Presencial</option>
          <option value="ead" ${lesson.classType === 'ead' ? 'selected' : ''}>EAD</option>
          <option value="carga_reservada" ${lesson.classType === 'carga_reservada' ? 'selected' : ''}>Reservada</option>
        </select>
      </div>
      
      <div class="filter-group">
        <label>Período</label>
        <select onchange="updateLesson(${idx}, 'periods', this.value)" class="form-select">
          <option value="1" ${lesson.periods.join(',') === '1' ? 'selected' : ''}>P1 (19:30 - 20:40)</option>
          <option value="2" ${lesson.periods.join(',') === '2' ? 'selected' : ''}>P2 (21:00 - 22:30)</option>
          <option value="1,2" ${lesson.periods.join(',') === '1,2' ? 'selected' : ''}>P1 & P2 (Noite Inteira)</option>
        </select>
      </div>
      
      <div class="filter-group" style="${lesson.classType !== 'presencial' ? 'display:none' : ''}">
        <label>Modo de Sala</label>
        <select onchange="updateLesson(${idx}, 'roomSelectionMode', this.value)" class="form-select">
          <option value="auto" ${lesson.roomSelectionMode === 'auto' ? 'selected' : ''}>Automático (I.A.)</option>
          <option value="preferred" ${lesson.roomSelectionMode === 'preferred' ? 'selected' : ''}>Preferência (Tenta 1º)</option>
          <option value="required" ${lesson.roomSelectionMode === 'required' ? 'selected' : ''}>Obrigatória (Não Troca)</option>
        </select>
      </div>
      
      <div class="filter-group" style="${lesson.roomSelectionMode === 'auto' || lesson.classType !== 'presencial' ? 'display:none' : ''}">
        <label>Sala Específica</label>
        <select onchange="updateLesson(${idx}, 'selectedRoomId', this.value)" class="form-select">
          <option value="">Selecione...</option>
          ${roomOptions.replace(`value="${lesson.selectedRoomId}"`, `value="${lesson.selectedRoomId}" selected`)}
        </select>
      </div>

      <div class="filter-group" style="${lesson.classType !== 'presencial' ? 'display:none' : ''}">
        <label>Tipo de Sala Requerido</label>
        <select onchange="updateLesson(${idx}, 'requiredRoomType', this.value)" class="form-select">
          <option value="">Qualquer</option>
          <option value="sala" ${lesson.requiredRoomType === 'sala' ? 'selected' : ''}>Sala Comum</option>
          <option value="laboratorio" ${lesson.requiredRoomType === 'laboratorio' ? 'selected' : ''}>Laboratório</option>
          <option value="auditorio" ${lesson.requiredRoomType === 'auditorio' ? 'selected' : ''}>Auditório</option>
        </select>
      </div>
      <button class="btn-icon action-execute" onclick="removeLesson(${idx})" style="position:absolute; top:1rem; right:1rem; color:#ef4444; background:rgba(239, 68, 68, 0.1); border-radius:10px; width:35px; height:35px;" title="Remover Aula">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  `).join('');
}

window.updateLesson = (idx, field, value) => {
  if (field === 'periods') {
    simulationLessons[idx].periods = value.split(',').map(Number);
  } else {
    simulationLessons[idx][field] = value;
  }
  
  if (field === 'classType' && value !== 'presencial') {
    simulationLessons[idx].roomSelectionMode = 'auto';
    simulationLessons[idx].selectedRoomId = '';
  }
  
  renderSimulationLessons();
};

window.removeLesson = (idx) => {
  simulationLessons.splice(idx, 1);
  // Reindex lesson numbers
  simulationLessons.forEach((l, i) => l.lessonNumber = i + 1);
  renderSimulationLessons();
};

async function runSimulation() {
  const courseId = document.getElementById('sim-course-id').value;
  const classIds = Array.from(document.querySelectorAll('#sim-classes-container input[name="selected-classes"]:checked')).map(cb => cb.value);

  if (!courseId || classIds.length === 0) {
    alert('Selecione o curso e as turmas.');
    return;
  }

  if (simulationLessons.length === 0) {
    alert('Adicione pelo menos uma aula.');
    return;
  }

  const btn = document.getElementById('btn-run-simulation');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Simulando...';
  btn.disabled = true;

  try {
    const engine = new SimulationEngine(rooms, classes, calendarEntries);
    currentSimulationResults = engine.generateSuggestions(courseId, classIds, simulationLessons);

    // Persistir a simulação no Firebase
    await fb.create('simulations', {
      courseId,
      classIds,
      lessons: simulationLessons,
      suggestions: currentSimulationResults,
      status: 'gerado',
      createdBy: currentUser.uid
    });

    renderSimulationResults();
    
    document.getElementById('simulation-step-1').style.display = 'none';
    document.getElementById('simulation-step-2').style.display = 'block';
  } catch (error) {
    console.error(error);
    alert('Erro ao rodar simulação: ' + error.message);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function renderSimulationResults() {
  const container = document.getElementById('sim-results-container');
  
  if (currentSimulationResults.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:4rem;">
        <div style="font-size:3rem; margin-bottom:1rem;">⚠️</div>
        <h4 style="color:var(--text-main)">Nenhuma sugestão viável</h4>
        <p style="color:var(--text-secondary)">Tente mudar o dia das aulas presenciais ou verificar se há salas suficientes para a capacidade das turmas.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = currentSimulationResults.map((sim, idx) => `
    <div class="suggestion-card">
      <div class="suggestion-header">
        <div style="display:flex; align-items:center; gap:1rem;">
          <span class="score-badge score-${sim.status}">${sim.status.toUpperCase()}</span>
          <div>
            <div style="font-weight:900; font-size:1.1rem; color:#1E293B">Score: ${sim.score}</div>
            <div style="font-size:0.7rem; color:#64748B">OPÇÃO #${idx + 1}</div>
          </div>
        </div>
        <button class="btn-primary" onclick="exportSimulation('${sim.id}')" style="padding:0.6rem 1.2rem; font-size:0.8rem;">
          Aplicar Sugestão
        </button>
      </div>
      
      <p style="font-size:0.95rem; line-height:1.6; margin-bottom:1.5rem; color:#475569; background:#F1F5F9; padding:1.2rem; border-radius:12px; border-left:4px solid var(--primary-blue);">
        <strong style="color:#1E293B; display:block; margin-bottom:0.4rem; font-size:0.8rem; text-transform:uppercase; letter-spacing:1px;">Por que esta sugestão?</strong>
        ${sim.summary}
      </p>

      <div class="suggestion-points" style="margin-bottom:1.5rem;">
        ${(sim.reasons || []).map(r => `<div class="point-item"><span class="point-icon icon-plus">✓</span> <span style="color:#475569">${r}</span></div>`).join('')}
        ${(sim.warnings || []).map(w => `<div class="point-item"><span class="point-icon icon-warn">!</span> <span style="color:#64748B">${w}</span></div>`).join('')}
      </div>
      
      <div class="allocation-grid">
        ${sim.allocations.map(a => `
          <div class="allocation-item" style="border-left: 3px solid ${a.classType === 'presencial' ? 'var(--presencial)' : (a.classType === 'ead' ? 'var(--ead)' : 'var(--reservada)')}; background:#F1F5F9">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem">
              <span style="font-weight:800; font-size:0.65rem; color:#64748B; text-transform:uppercase; letter-spacing:1px;">
                ${a.weekday ? WEEKDAYS[a.weekday] : 'Não Alocada'}
              </span>
            </div>
            <div style="font-size:0.9rem; font-weight:700; color:#1E293B; margin-bottom:0.2rem">
              ${CLASS_TYPES[a.classType].label}
            </div>
            <div style="font-size:0.75rem; color:#64748B">
              ${a.periods.length === 2 ? 'Noite Inteira' : 'Período P' + a.periods[0]}
            </div>
            ${a.suggestedRoomName ? `
              <div class="entry-room" style="margin-top:0.8rem; background:#ffffff; color:#1E293B; padding:5px 10px; border-radius:8px; font-weight:800; font-size:0.7rem; border:1px solid #E2E8F0">
                ${a.suggestedRoomName}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}
window.exportSimulation = async (simId) => {
  const sim = currentSimulationResults.find(s => s.id === simId);
  if (!sim) return;

  if (!confirm('Deseja exportar esta simulação para o calendário oficial? Isso criará novos registros.')) return;

  const courseId = document.getElementById('sim-course-id').value;
  const classIds = Array.from(document.querySelectorAll('#sim-classes-container input[name="selected-classes"]:checked')).map(cb => cb.value);

  // Re-validar antes de exportar para CADA turma
  for (const alloc of sim.allocations) {
    if (!alloc.weekday) continue;
    if (alloc.classType === 'presencial') {
      if (alloc.roomSelectionMode === 'required' && alloc.suggestedRoomId !== alloc.selectedRoomId) {
        alert(`A sala obrigatória para a Aula #${alloc.lessonNumber} não pôde ser respeitada (ocupada). Exportação cancelada.`);
        return;
      }
    }
    for (const cid of classIds) {
      const conflicts = await fb.checkConflict(alloc.weekday, alloc.periods, alloc.suggestedRoomId, cid);
      if (conflicts.length > 0) {
        alert(`Conflito detectado para a Aula #${alloc.lessonNumber} na turma ${classes.find(t => t.id === cid)?.name}:\n${conflicts.join('\n')}\nA exportação foi cancelada.`);
        return;
      }
    }
  }

  // Gravar no Firebase
  for (const alloc of sim.allocations) {
    if (!alloc.weekday) continue;
    await fb.create('calendarEntries', {
      courseId,
      classIds,
      weekday: alloc.weekday,
      periods: alloc.periods,
      classType: alloc.classType,
      roomId: alloc.suggestedRoomId,
      source: 'simulation',
      simulationId: sim.id,
      notes: 'Exportado automaticamente do simulador.'
    });
  }

  alert('Simulação exportada com sucesso!');
  document.getElementById('modal-simulation').style.display = 'none';
  await loadAllData();
  renderCalendar();
};

// --- HELPERS ---
// Update classes dropdowns as checkboxes
function updateClassCheckboxes(courseId, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (!courseId) {
    container.innerHTML = '<p style="color:rgba(255,255,255,0.3); font-size:0.8rem; padding:0.5rem">Selecione um curso...</p>';
    return;
  }

  const filtered = classes.filter(t => t.courseId === courseId).sort((a, b) => a.semester - b.semester);
  
  if (filtered.length === 0) {
    container.innerHTML = '<p style="color:rgba(255,255,255,0.3); font-size:0.8rem; padding:0.5rem">Nenhuma turma para este curso.</p>';
    return;
  }

  container.innerHTML = filtered.map(t => `
    <label class="checkbox-item">
      <input type="checkbox" name="selected-classes" value="${t.id}">
      <span>${t.name} (${t.semester}º Período)</span>
    </label>
  `).join('');
}

function updateSelects() {
  // Ordenar cursos por nome
  const sortedCourses = [...courses].sort((a, b) => a.name.localeCompare(b.name));
  const courseOptions = sortedCourses.map(c => `<option value="${c.id}">${c.name} (${c.code})</option>`).join('');
  
  // Ordenar salas por nome (numérico e case-insensitive)
  const sortedRooms = [...rooms].sort((a, b) => 
    a.name.toUpperCase().localeCompare(b.name.toUpperCase(), undefined, { numeric: true })
  );
  const roomOptions = sortedRooms.map(r => `<option value="${r.id}">${r.name} - ${r.block} (Cap: ${r.capacity})</option>`).join('');

  const selects = [
    'filter-course', 'class-course-id', 'entry-course-id', 'sim-course-id', 'filter-tab-class-course'
  ];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = '<option value="">Selecione um curso</option>' + courseOptions;
    el.value = prev;
  });

  const roomSelects = ['filter-room', 'entry-room-id'];
  roomSelects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const prev = el.value;
    el.innerHTML = '<option value="">Selecione uma sala</option>' + roomOptions;
    el.value = prev;
  });

  // Initial populate of dependent containers
  updateClassCheckboxes(document.getElementById('entry-course-id').value, 'entry-classes-container');
  updateClassCheckboxes(document.getElementById('sim-course-id').value, 'sim-classes-container');
}



