import * as fb from './firebase-service.js';
import { SimulationEngine } from './simulation-engine.js';
import { setupLayout, getCachedAuth, setCachedAuth, clearCachedAuth } from '../core/layout.js';
import { getEffectiveLevel } from '../core/permissions.js';
import { escapeHTML as esc } from '../core/security.js';

// --- STATE MANAGEMENT ---
let currentTab = 'calendario';
let courses = [];
let classes = [];
let rooms = [];
let calendarEntries = [];
let disciplines = []; // All imported disciplines/matrices
let importType = 'matrix'; // 'matrix' or 'classes'
let parsedImportData = null; // Stored parsed data from excel before confirmation
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
      let meuOverrides = null;
      try {
        // Buscar Cargo do Usuário (e overrides individuais de permissão)
        const userSnap = await fb.getDoc(fb.doc(fb.db, 'users', user.uid));
        role = userSnap.exists() ? userSnap.data().role : 'visitante';
        meuOverrides = userSnap.exists() ? (userSnap.data().permissoes || null) : null;
      } catch (err) {
        role = cached ? cached.role : 'visitante';
      }

      // Nível EFETIVO: override individual do usuário vence o do cargo
      let userLevel = 1;
      try {
        const permSnap = await fb.getDoc(fb.doc(fb.db, 'config', 'permissions'));
        const allPerms = permSnap.exists() ? permSnap.data() : {};
        userLevel = getEffectiveLevel(allPerms[role] || {}, meuOverrides, 'ensalamento');
      } catch (err) {
        // Falha silenciosa para segurança
      }

      const token = await user.getIdToken();
      setCachedAuth(user, role, token);

      // ADM L1 entra direto. Outros precisam de 'view' (nível >= 2).
      if (role !== 'adm_l1' && userLevel < 2) {
        window.location.href = '../meu-espaco/index.html';
        return;
      }

      // Se não puder executar (nível >= 3), esconde botões
      if (role !== 'adm_l1' && userLevel < 3) {
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

const isCorruptedPeriod = (p) => /^\d{5}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(p || '');

async function autoCleanupCorruptedData() {
  const corruptedClasses = classes.filter(t => isCorruptedPeriod(t.academicPeriod));
  const corruptedDisciplines = disciplines.filter(d => isCorruptedPeriod(d.academicPeriod));
  
  if (corruptedClasses.length === 0 && corruptedDisciplines.length === 0) return;
  
  console.log(`Limpando ${corruptedClasses.length} turmas e ${corruptedDisciplines.length} disciplinas com períodos letivos corrompidos...`);
  
  for (const t of corruptedClasses) {
    try {
      await fb.remove('classes', t.id);
    } catch (e) {
      console.error(`Erro ao remover turma corrompida ${t.id}:`, e);
    }
  }
  
  const pairs = [];
  const seen = new Set();
  corruptedDisciplines.forEach(d => {
    const key = `${d.courseId}|${d.academicPeriod}`;
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ courseId: d.courseId, period: d.academicPeriod });
    }
  });
  
  for (const pair of pairs) {
    try {
      await fb.clearDisciplines(pair.courseId, pair.period);
    } catch (e) {
      console.error(`Erro ao limpar disciplinas corrompidas para curso ${pair.courseId} e período ${pair.period}:`, e);
    }
  }
  
  console.log("Limpeza de dados corrompidos concluída.");
}

let courseGroups = [];

async function loadAllData() {
  courses = await fb.getActive('courses');
  classes = await fb.getActive('classes');
  rooms = await fb.getActive('rooms');
  courseGroups = await fb.getActive('courseGroups');
  calendarEntries = await fb.getCalendarEntries();

  // Executar limpeza automática de períodos importados incorretamente no passado
  const hasCorrupted = classes.some(t => isCorruptedPeriod(t.academicPeriod));
  if (hasCorrupted) {
    await autoCleanupCorruptedData();
    // Recarregar os dados limpos
    classes = await fb.getActive('classes');
  }

  updateSelects();
  updateAcademicPeriodDropdowns();
  renderCourses();
  renderClasses();
  renderRooms();
}

function updateAcademicPeriodDropdowns() {
  const periodsFromClasses = classes.map(c => c.academicPeriod);
  const periodsFromDisciplines = disciplines.map(d => d.academicPeriod);
  const periods = [...new Set([...periodsFromClasses, ...periodsFromDisciplines].filter(Boolean))].sort((a, b) => b.localeCompare(a));
  
  const dropdownIds = ['filter-academic-period', 'filter-tab-class-academic-period', 'sim-academic-period'];
  dropdownIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    
    const prevVal = el.value;
    
    let optionsHtml = '';
    if (id === 'filter-tab-class-academic-period') {
      optionsHtml += '<option value="">Todos</option>';
    } else {
      if (periods.length === 0) {
        optionsHtml += '<option value="">Nenhum lote/período</option>';
      }
    }
    
    periods.forEach(p => {
      optionsHtml += `<option value="${p}">${p}</option>`;
    });
    
    el.innerHTML = optionsHtml;
    
    if (periods.includes(prevVal)) {
      el.value = prevVal;
    } else if (periods.length > 0) {
      el.value = periods[0];
    } else {
      el.value = '';
    }
  });
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
  ['filter-course', 'filter-room', 'filter-view-mode', 'filter-academic-period'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderCalendar);
  });

  // Course Actions
  document.getElementById('btn-add-course').addEventListener('click', () => openCourseModal());
  document.getElementById('form-course').addEventListener('submit', handleCourseSubmit);
  
  // Course Groups Actions
  document.getElementById('btn-manage-groups').addEventListener('click', () => {
    document.getElementById('modal-course-groups').style.display = 'flex';
    renderCourseGroups();
  });
  document.getElementById('form-course-group').addEventListener('submit', handleCourseGroupSubmit);

  // Class Actions
  document.getElementById('btn-add-class').addEventListener('click', () => openClassModal());
  document.getElementById('form-class').addEventListener('submit', handleClassSubmit);

  // Room Actions
  document.getElementById('btn-add-room').addEventListener('click', () => openRoomModal());
  document.getElementById('form-room').addEventListener('submit', handleRoomSubmit);

  // Tab Filters
  ['filter-tab-class-course', 'filter-tab-class-search', 'filter-tab-class-academic-period'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderClasses);
    if (document.getElementById(id).tagName === 'SELECT') {
      document.getElementById(id).addEventListener('change', renderClasses);
    }
  });

  ['filter-tab-room-type', 'filter-tab-room-equipment', 'filter-tab-room-search'].forEach(id => {
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
  document.getElementById('btn-sim-institutional').addEventListener('click', loadLessonsFromMatrix);
  document.getElementById('btn-back-to-lessons').addEventListener('click', () => {
    document.getElementById('simulation-step-1').style.display = 'block';
    document.getElementById('simulation-step-2').style.display = 'none';
  });

  // Course -> Class Select Synchronization
  document.getElementById('entry-course-id').addEventListener('change', (e) => {
    updateClassCheckboxes(e.target.value, 'entry-classes-container');
  });
  document.getElementById('sim-course-id').addEventListener('change', (e) => {
    updateClassCheckboxes(e.target.value, 'sim-classes-container');
    syncClassesCheckboxesWithCourseSemester();
    loadLessonsFromMatrix();
  });
  document.getElementById('sim-academic-period').addEventListener('change', (e) => {
    const courseId = document.getElementById('sim-course-id').value;
    updateClassCheckboxes(courseId, 'sim-classes-container');
    syncClassesCheckboxesWithCourseSemester();
    loadLessonsFromMatrix();
  });
  document.getElementById('sim-matrix-semester').addEventListener('change', () => {
    syncClassesCheckboxesWithCourseSemester();
    loadLessonsFromMatrix();
  });
  document.getElementById('sim-classes-container').addEventListener('change', (e) => {
    if (e.target.name === 'selected-classes') {
      loadLessonsFromMatrix();
    }
  });
  document.getElementById('filter-course').addEventListener('change', renderCalendar); 
  
  // Import Dialog Listeners
  document.getElementById('btn-import-classes').addEventListener('click', () => openImportModal('classes'));
  document.getElementById('btn-import-matrix').addEventListener('click', () => openImportModal('matrix'));
  document.getElementById('import-file-input').addEventListener('change', handleFileSelect);
  document.getElementById('btn-confirm-import').addEventListener('click', handleConfirmImport);
}

// --- CALENDAR RENDER ---
async function renderCalendar() {
  const container = document.getElementById('calendar-view-container');
  const viewMode = document.getElementById('filter-view-mode').value;
  const courseFilter = document.getElementById('filter-course').value;
  const roomFilter = document.getElementById('filter-room').value;
  const academicPeriodFilter = document.getElementById('filter-academic-period').value;

  const filteredEntries = calendarEntries.filter(entry => {
    if (courseFilter && entry.courseId !== courseFilter) return false;
    if (roomFilter && entry.roomId !== roomFilter) return false;
    
    // Filtrar por período letivo (academicPeriod)
    const classIds = entry.classIds || [entry.classId];
    const entryClasses = classes.filter(c => classIds.includes(c.id));
    const matchesPeriod = entryClasses.some(c => c.academicPeriod === academicPeriodFilter) || entry.academicPeriod === academicPeriodFilter;
    if (academicPeriodFilter && !matchesPeriod) return false;
    
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
      const dayEntries = group.entries.filter(e => e.weekday === day);
      if (dayEntries.length === 0) {
        return `<td style="vertical-align: top; padding-top: 15px; padding-bottom: 15px; cursor:pointer;" onclick="openManualEntryForSlot('${group.courseId}', '${group.classIds.join(',')}', ${day}, '${presencial?.roomId || ''}')">
                  <div style="display:flex; flex-direction:column; align-items:center; width:100%; opacity: 0.5; transition: opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">
                    <div class="status-pill pill-reservada" title="Adicionar aula manualmente">LIVRE</div>
                    <div style="font-size:0.6rem; color:#64748B; margin-top:6px; line-height:1.2; text-align:center; padding: 0 4px; text-transform: uppercase; max-width: 90px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">CARGA RESERVADA</div>
                  </div>
                </td>`;
      }

      let pillClass = '';
      let label = '';
      const hasPresencial = dayEntries.some(e => e.classType === 'presencial');
      const hasEad = dayEntries.some(e => e.classType === 'ead');
      
      if (hasPresencial) {
        const pEntry = dayEntries.find(e => e.classType === 'presencial');
        const room = rooms.find(r => r.id === pEntry.roomId);
        pillClass = 'pill-presencial';
        label = room ? esc(room.name) : 'SALA';
      } else if (hasEad) {
        pillClass = 'pill-ead';
        label = 'EAD';
      } else {
        pillClass = 'pill-reservada';
        label = 'RESERVADA';
      }

      const firstId = dayEntries[0].id;

      const disciplinesHtml = dayEntries.map(e => {
        if (!e.disciplineName) return '';
        const tooltip = ` title="${esc(e.disciplineName)}${e.notes ? ' - ' + esc(e.notes) : ''}"`;
        return `<div ${tooltip} onclick="openManualEntryModalById('${e.id}')" style="cursor:pointer; font-size:0.6rem; font-weight:600; color:#475569; margin-top:6px; line-height:1.2; text-align:center; padding: 0 4px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; width: 100%; max-width: 90px; text-transform: uppercase; transition: color 0.2s;" onmouseover="this.style.color='#2563EB'" onmouseout="this.style.color='#475569'">${esc(e.disciplineName)}</div>`;
      }).join('');

      return `<td style="vertical-align: top; padding-top: 15px; padding-bottom: 15px;">
                <div style="display:flex; flex-direction:column; align-items:center; width:100%;">
                  <div class="status-pill ${pillClass}" onclick="openManualEntryModalById('${firstId}')">${label}</div>
                  ${disciplinesHtml}
                </div>
              </td>`;
    }).join('');

    const entryIds = group.entries.map(e => e.id).join(',');

    return `
      <tr>
        <td class="cell-sala-header">${mainRoom}</td>
        <td class="cell-curso-header">
          <div style="display:flex; justify-content:space-between; align-items:start">
            <div>
              <div style="font-weight:900; letter-spacing:0.5px">${esc(course.name)}</div>
              <div style="font-size:0.7rem; color:#64748B; margin-top:0.2rem">${turmasNames}</div>
            </div>
            <button class="btn-icon action-execute" style="color:#ef4444; opacity:0.6; padding:4px; transition:opacity 0.2s;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.6'" onclick="deleteEntryGroup('${entryIds}')">
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
          <span class="entry-subtitle">${course ? esc(course.code) : ''}${entry.disciplineName ? ` - ${esc(entry.disciplineName)}` : ''}</span>
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
  document.getElementById('course-group-id').value = course ? (course.groupId || '') : '';
  modal.style.display = 'flex';
}

async function handleCourseSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('course-id').value;
  const data = {
    name: document.getElementById('course-name').value,
    code: document.getElementById('course-code').value.toUpperCase(),
    groupId: document.getElementById('course-group-id').value
  };

  if (id) await fb.update('courses', id, data);
  else await fb.create('courses', data);

  document.getElementById('modal-course').style.display = 'none';
  await loadAllData();
}

// --- CRUD: COURSE GROUPS ---
async function handleCourseGroupSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('course-group-name').value;
  await fb.create('courseGroups', { name });
  document.getElementById('course-group-name').value = '';
  courseGroups = await fb.getActive('courseGroups');
  updateSelects();
  renderCourseGroups();
}

window.deleteCourseGroup = async (id) => {
  if (!confirm('Deseja excluir este grupo?')) return;
  await fb.remove('courseGroups', id);
  courseGroups = await fb.getActive('courseGroups');
  updateSelects();
  renderCourseGroups();
};

function renderCourseGroups() {
  const list = document.getElementById('course-groups-list');
  list.innerHTML = courseGroups.map(g => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem; border-bottom:1px solid #E2E8F0;">
      <span style="font-weight:600; color:#1E293B;">${esc(g.name)}</span>
      <button class="btn-icon" style="color:#EF4444;" onclick="deleteCourseGroup('${g.id}')">Excluir</button>
    </div>
  `).join('') || '<div style="color:#64748B; font-size:0.8rem;">Nenhum grupo cadastrado.</div>';
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
        <button class="btn-icon action-execute" onclick="editCourse('${course.id}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon action-execute" style="color:#ef4444" onclick="toggleActive('courses', '${course.id}', true)">
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
  document.getElementById('class-academic-period').value = turma ? (turma.academicPeriod || '') : (document.getElementById('filter-academic-period').value || '2025.2');
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
    academicPeriod: document.getElementById('class-academic-period').value.trim() || '2025.2',
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
  const academicPeriodFilter = document.getElementById('filter-tab-class-academic-period').value;

  let filtered = classes.filter(t => {
    const matchesCourse = !courseFilter || t.courseId === courseFilter;
    const matchesSearch = !searchFilter || t.name.toLowerCase().includes(searchFilter);
    const matchesAcademicPeriod = !academicPeriodFilter || t.academicPeriod === academicPeriodFilter;
    return matchesCourse && matchesSearch && matchesAcademicPeriod;
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
  document.getElementById('room-equipment-type').value = sala ? (sala.equipmentType || 'UNI') : 'UNI';
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
    equipmentType: document.getElementById('room-equipment-type').value,
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
  const equipFilter = document.getElementById('filter-tab-room-equipment').value;
  const searchFilter = document.getElementById('filter-tab-room-search').value.toLowerCase();

  let filtered = rooms.filter(r => {
    const matchesType = !typeFilter || r.type === typeFilter;
    const matchesEquip = !equipFilter || (r.equipmentType || 'UNI') === equipFilter;
    const matchesSearch = !searchFilter || r.name.toLowerCase().includes(searchFilter);
    return matchesType && matchesEquip && matchesSearch;
  });

  // Ordenar alfabeticamente/numéricamente pelo nome da sala
  filtered.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const equipLabel = { UNI: 'Universitária', CCM: 'Cart. Cadeira Medicina', CC: 'Carteira e Cadeira' };

  grid.innerHTML = filtered.map(r => `
    <div class="data-card">
      <div>
        <h3 style="margin-bottom:0.2rem">${esc(r.name)}</h3>
        <span class="badge bg-green">${esc(r.type)}</span>
        <span class="badge" style="background:rgba(99,102,241,0.25); color:#a5b4fc">${esc(r.equipmentType || 'UNI')} &ndash; ${esc(equipLabel[r.equipmentType] || 'Universitária')}</span>
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

  const isReadOnly = document.body.classList.contains('hide-execute');
  const form = document.getElementById('form-manual-entry');
  
  form.querySelectorAll('input, select, textarea').forEach(el => {
    el.disabled = isReadOnly;
  });

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.style.display = isReadOnly ? 'none' : 'block';

  const deleteBtn = document.getElementById('btn-delete-entry');
  if (deleteBtn) {
    deleteBtn.style.display = (entry && !isReadOnly) ? 'block' : 'none';
  }

  if (entry) {
    document.getElementById('entry-course-id').value = entry.courseId;
    updateClassCheckboxes(entry.courseId, 'entry-classes-container');
    
    // Marcar checkboxes das turmas
    const classIds = entry.classIds || [entry.classId];
    setTimeout(() => {
      document.querySelectorAll('#entry-classes-container input[name="selected-classes"]').forEach(cb => {
        cb.checked = classIds.includes(cb.value);
        if (isReadOnly) cb.disabled = true;
      });
      document.getElementById('entry-discipline-name').value = entry.disciplineName || '';
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

  const disciplineName = document.getElementById('entry-discipline-name').value.trim();

  // Determinar o período letivo
  const matchedClass = classes.find(c => c.id === classIds[0]);
  const academicPeriod = matchedClass ? matchedClass.academicPeriod : (document.getElementById('filter-academic-period').value || '2025.2');

  const data = {
    courseId: document.getElementById('entry-course-id').value,
    classIds: classIds,
    weekday: parseInt(document.getElementById('entry-weekday').value),
    classType: document.getElementById('entry-type').value,
    periods: periods,
    roomId: document.getElementById('entry-type').value === 'presencial' ? document.getElementById('entry-room-id').value : null,
    notes: document.getElementById('entry-notes').value,
    source: 'manual',
    disciplineId: null,
    disciplineName: disciplineName || null,
    academicPeriod: academicPeriod
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
    const conflicts = await fb.checkConflict(data.weekday, data.periods, data.roomId, cid, id, data.classType);
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
async function openSimulationModal() {
  const btn = document.getElementById('btn-open-simulation');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Carregando...';
  btn.disabled = true;

  try {
    if (disciplines.length === 0) {
      disciplines = await fb.getActive('disciplines');
      updateAcademicPeriodDropdowns();
    }
  } catch (err) {
    console.error("Erro ao carregar disciplinas para simulação:", err);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }

  document.getElementById('modal-simulation').style.display = 'flex';
  document.getElementById('simulation-step-1').style.display = 'block';
  document.getElementById('simulation-step-2').style.display = 'none';
  
  // Resetar o dropdown de semestre da matriz
  document.getElementById('sim-matrix-semester').value = '';
  
  simulationLessons = [];
  renderSimulationLessons();
  
  // Mostrar gargalos iniciais
  renderBottlenecks();
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

function syncClassesCheckboxesWithCourseSemester() {
  const matrixSemesterValue = document.getElementById('sim-matrix-semester').value;
  if (!matrixSemesterValue) return;

  const academicPeriod = document.getElementById('sim-academic-period').value;

  let semestersToSelect = [];
  if (matrixSemesterValue === 'all') {
    semestersToSelect = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  } else if (matrixSemesterValue.endsWith('year')) {
    const year = parseInt(matrixSemesterValue);
    semestersToSelect = [year * 2 - 1, year * 2];
  } else {
    semestersToSelect = [parseInt(matrixSemesterValue)];
  }

  const checkboxes = document.querySelectorAll('#sim-classes-container input[name="selected-classes"]');
  checkboxes.forEach(cb => {
    const classId = cb.value;
    const c = classes.find(classItem => classItem.id === classId);
    if (c) {
      // Determinar o semestre ativo da turma para o período letivo selecionado (ex: "1 e 2º" no .2 é 2)
      const matches = [...c.name.matchAll(/\d+/g)].map(m => parseInt(m[0]));
      let activeSem = c.semester;
      if (matches.length > 1 && academicPeriod) {
        if (academicPeriod.endsWith('.2')) {
          const even = matches.find(num => num % 2 === 0);
          if (even !== undefined) activeSem = even;
        } else {
          const odd = matches.find(num => num % 2 !== 0);
          if (odd !== undefined) activeSem = odd;
        }
      }

      if (semestersToSelect.includes(activeSem)) {
        cb.checked = true;
      } else {
        cb.checked = false;
      }
    }
  });
}

function loadLessonsFromMatrix() {
  const courseId = document.getElementById('sim-course-id').value;
  const academicPeriod = document.getElementById('sim-academic-period').value;
  const matrixSemesterValue = document.getElementById('sim-matrix-semester').value;
  
  if (!courseId) {
    simulationLessons = [];
    renderSimulationLessons();
    return;
  }
  
  if (!academicPeriod) {
    simulationLessons = [];
    renderSimulationLessons();
    return;
  }
  
  if (!matrixSemesterValue) {
    simulationLessons = [];
    renderSimulationLessons();
    return;
  }
  
  // Encontrar as turmas selecionadas
  const checkedClassIds = Array.from(document.querySelectorAll('#sim-classes-container input[name="selected-classes"]:checked')).map(cb => cb.value);
  if (checkedClassIds.length === 0) {
    simulationLessons = [];
    renderSimulationLessons();
    return;
  }
  
  // Obter os semestres ativos das turmas selecionadas (ex: 1, 2, 3...)
  let selectedSemesters = [];
  if (matrixSemesterValue === 'all') {
    const allCourseSems = [...new Set(disciplines.filter(d => d.courseId === courseId).map(d => d.semester))];
    selectedSemesters = allCourseSems.length > 0 ? allCourseSems : [1];
  } else {
    selectedSemesters = [...new Set(
      checkedClassIds.flatMap(id => {
        const c = classes.find(classItem => classItem.id === id);
        if (!c) return [];
        
        // Se o nome da turma contiver múltiplos períodos (ex: "1 e 2º", "2 e 3º")
        const matches = [...c.name.matchAll(/\d+/g)].map(m => parseInt(m[0]));
        if (matches.length > 1) {
          if (academicPeriod.endsWith('.2')) {
            const even = matches.find(num => num % 2 === 0);
            return even !== undefined ? [even] : [matches[0]];
          } else {
            const odd = matches.find(num => num % 2 !== 0);
            return odd !== undefined ? [odd] : [matches[0]];
          }
        }
        
        return [c.semester];
      }).filter(Boolean)
    )];
  }
  
  // Filtrar disciplinas correspondentes à matriz para o curso, período letivo e período da turma.
  const matchedDisciplines = [];
  selectedSemesters.forEach(sem => {
    let courseSemDisciplines = disciplines.filter(d => 
      d.courseId === courseId && 
      d.semester === sem
    );
    
    // Fallback para cursos como Agronegócio, RH (Turmas Mistas que estudam juntas)
    // Se não encontrou disciplinas no semestre solicitado, busca no primeiro semestre disponível.
    if (courseSemDisciplines.length === 0) {
      const allCourseDisciplines = disciplines.filter(d => d.courseId === courseId);
      if (allCourseDisciplines.length > 0) {
        const fallbackSem = allCourseDisciplines[0].semester;
        courseSemDisciplines = allCourseDisciplines.filter(d => d.semester === fallbackSem);
      }
    }
    
    if (courseSemDisciplines.length === 0) return;
    
    const exactPeriodDisciplines = courseSemDisciplines.filter(d => d.academicPeriod === academicPeriod);
    if (exactPeriodDisciplines.length > 0) {
      matchedDisciplines.push(...exactPeriodDisciplines);
    } else {
      const currentYear = academicPeriod.split('.')[0];
      const sameYearDisciplines = courseSemDisciplines.filter(d => d.academicPeriod && d.academicPeriod.startsWith(currentYear));
      
      if (sameYearDisciplines.length > 0) {
        const bestPeriod = sameYearDisciplines[0].academicPeriod;
        matchedDisciplines.push(...sameYearDisciplines.filter(d => d.academicPeriod === bestPeriod));
      } else {
        const fallbackPeriod = courseSemDisciplines[0].academicPeriod;
        matchedDisciplines.push(...courseSemDisciplines.filter(d => d.academicPeriod === fallbackPeriod));
      }
    }
  });

  const courseDisciplines = disciplines.filter(d => d.courseId === courseId);
  console.log("loadLessonsFromMatrix debug:", {
    courseId,
    academicPeriod,
    checkedClassIds,
    selectedSemesters,
    totalDisciplines: disciplines.length,
    matchedDisciplinesCount: matchedDisciplines.length,
    courseDisciplinesCount: courseDisciplines.length,
    courseDisciplinesInDB: courseDisciplines.map(d => ({ name: d.name, period: d.academicPeriod, semester: d.semester }))
  });
  
  // Deduplicar disciplinas para o caso de importações duplicadas da matriz
  const uniqueDisciplines = [];
  const seenKeys = new Set();
  for (const d of matchedDisciplines) {
    // Usar nome da disciplina, semestre e curso como chave única
    const key = `${d.courseId}_${d.semester}_${(d.name || '').trim().toLowerCase()}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueDisciplines.push(d);
    }
  }
  
  if (uniqueDisciplines.length > 0) {
    simulationLessons = uniqueDisciplines.map((d, index) => {
      const lowerName = (d.name || '').toLowerCase();
      let classType = 'presencial';
      
      if (d.chPres > 0) {
        classType = 'presencial';
      } else if (d.chEad > 0) {
        classType = 'ead';
      } else if (d.chExt > 0 || lowerName.includes('projeto integrador') || lowerName.includes('extensão') || lowerName.includes('extensionista')) {
        classType = 'presencial';
      } else if (d.chTotal > 0) {
        classType = 'carga_reservada';
      }

      // Aulas de 60h e 80h ocupam a noite toda [1, 2]. As demais ocupam metade ('auto_half')
      let mappedPeriods = 'auto_half';
      if (d.chTotal === 60 || d.chTotal === 80 || d.chPres === 60 || d.chPres === 80) {
        mappedPeriods = [1, 2];
      }

      return {
        id: d.id || (Date.now() + Math.random()),
        lessonNumber: index + 1,
        disciplineId: d.id || null,
        disciplineName: d.name,
        classType: classType,
        periods: mappedPeriods,
        roomSelectionMode: 'auto',
        selectedRoomId: '',
        requiredRoomType: '',
        requiredResources: [],
        chPres: d.chPres || 0,
        chEad: d.chEad || 0,
        chExt: d.chExt || 0,
        chTotal: d.chTotal || 0,
        semester: d.semester
      };
    });
    renderSimulationLessons();
  } else {
    simulationLessons = [];
    renderSimulationLessons();
  }
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
  
  if (simulationLessons.length === 0) {
    list.innerHTML = `
      <div style="text-align:center; padding:2rem; border:1px dashed var(--border-color); border-radius:12px; grid-column: span 2;">
        <p style="color:#64748B; font-size:0.8rem; margin:0;">
          Nenhuma aula carregada.<br>
          Selecione o <strong>Semestre/Período do Curso</strong> e clique em <strong>Carregar da Matriz</strong> ou use o botão <strong>+ Aula</strong> para adicionar manualmente.
        </p>
      </div>
    `;
    return;
  }

  list.innerHTML = simulationLessons.map((lesson, idx) => {
    const chInfo = lesson.chTotal 
      ? `<div style="font-size:0.75rem; color:#64748B; margin-top:0.4rem; margin-bottom: 0.6rem; line-height: 1.4;">
           <strong>Carga Horária:</strong> Presencial: ${lesson.chPres}h | EAD: ${lesson.chEad}h | Extensão: ${lesson.chExt}h | Total: ${lesson.chTotal}h
           ${lesson.semester ? ` | Semestre/Período: ${lesson.semester}º` : ''}
         </div>`
      : '';

    return `
      <div class="lesson-item" style="position:relative;">
        <h5 style="padding-right:2rem; word-break:break-word;">
          Aula #${lesson.lessonNumber}${lesson.disciplineName ? `: ${esc(lesson.disciplineName)}` : ''}
        </h5>
        ${chInfo}

        <div class="filter-group" style="grid-column: span 2;">
          <label>Tipo</label>
          <select onchange="updateLesson(${idx}, 'classType', this.value)" class="form-select">
            <option value="presencial" ${lesson.classType === 'presencial' ? 'selected' : ''}>Presencial</option>
            <option value="ead" ${lesson.classType === 'ead' ? 'selected' : ''}>EAD</option>
            <option value="carga_reservada" ${lesson.classType === 'carga_reservada' ? 'selected' : ''}>Carga Reservada</option>
          </select>
        </div>

        <button class="btn-icon action-execute" onclick="removeLesson(${idx})" style="position:absolute; top:1rem; right:1rem; color:#ef4444; background:rgba(239, 68, 68, 0.1); border-radius:10px; width:35px; height:35px;" title="Remover Aula">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;
  }).join('');
}

window.updateLesson = (idx, field, value) => {
  simulationLessons[idx][field] = value;
  // Resetar modo de seleção de sala quando o tipo muda
  simulationLessons[idx].roomSelectionMode = 'auto';
  simulationLessons[idx].selectedRoomId = '';
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
    const engine = new SimulationEngine(rooms, classes, calendarEntries, courses);
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

window.openDiagnosticsModal = () => {
  const container = document.getElementById('diagnostics-content-container');
  if (!currentSimulationResults || currentSimulationResults.length === 0) {
    container.innerHTML = '<p style="color:#64748B;">Nenhuma simulação rodada recentemente. Clique em "Simular Ensalamento" para gerar diagnósticos.</p>';
  } else {
    const firstOption = currentSimulationResults[0];
    const unallocated = firstOption.allocations.filter(a => a.diagnostic);
    if (unallocated.length === 0) {
      container.innerHTML = '<p style="color:#10B981; font-weight:bold;">A simulação foi 100% alocada! Nenhum conflito ou falta de sala foi encontrado.</p>';
    } else {
      container.innerHTML = unallocated.map(a => `
        <div style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #E2E8F0;">
          <h4 style="color:#1E293B; margin-bottom: 0.5rem; text-transform:uppercase;">${esc(a.disciplineName || 'Disciplina Desconhecida')}</h4>
          <p style="font-size:0.8rem; color:#64748B; margin-bottom:0.5rem; font-weight:600;">
            ${CLASS_TYPES[a.classType] ? CLASS_TYPES[a.classType].label : a.classType}
          </p>
          <div style="font-size:0.85rem; color:#475569; white-space:pre-wrap; line-height:1.5;">${esc(a.diagnostic)}</div>
        </div>
      `).join('');
    }
  }
  document.getElementById('modal-diagnostics').style.display = 'flex';
};

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

  container.innerHTML = currentSimulationResults.slice(0, 1).map((sim, idx) => `
    <div class="suggestion-card">
      <div class="suggestion-header">
        <div style="display:flex; align-items:center; gap:1rem;">
          <span class="score-badge score-${sim.status}">${sim.status.toUpperCase()}</span>
          <div>
            <div style="font-weight:900; font-size:1.1rem; color:#1E293B">Score: ${sim.score}</div>
            <div style="font-size:0.7rem; color:#64748B">SUGESTÃO OTIMIZADA</div>
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
      
      <div class="allocation-grid" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem; align-items: stretch;">
        ${(() => {
          const grouped = {};
          sim.allocations.forEach(a => {
            const dayKey = a.weekday || 99;
            if (!grouped[dayKey]) grouped[dayKey] = [];
            grouped[dayKey].push(a);
          });
          
          const daysToRender = [1, 2, 3, 4, 5];
          if (grouped[99]) daysToRender.push(99);
          
          return daysToRender.map(dayKey => {
            const allocs = grouped[dayKey] || [];
            const isUnallocated = dayKey == 99;
            const dayLabel = isUnallocated ? 'Não Alocada' : WEEKDAYS[dayKey];
            
            if (allocs.length === 0 && !isUnallocated) {
              const isBottleneck = sim.status === 'inviavel';
              return `
                <div class="allocation-day-group" style="display:flex; flex-direction:column; gap:0.5rem; height:100%;">
                  <div class="allocation-item" style="border-left: 3px solid ${isBottleneck ? '#EF4444' : 'var(--reservada)'}; background:#F1F5F9; flex: 1; opacity: 0.7;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem">
                      <span style="font-weight:800; font-size:0.65rem; color:#64748B; text-transform:uppercase; letter-spacing:1px;">
                        ${dayLabel}
                      </span>
                    </div>
                    <div style="font-size:0.9rem; font-weight:700; color:${isBottleneck ? '#EF4444' : '#1E293B'}; margin-bottom:0.2rem">
                      ${isBottleneck ? 'Sem Salas (Gargalo)' : 'Carga Reservada'}
                    </div>
                    <div style="font-size:0.75rem; color:#64748B">
                      ${isBottleneck ? 'Todas ocupadas' : 'Dia Livre / Sem Aula'}
                    </div>
                  </div>
                </div>
              `;
            }
            
            return `
              <div class="allocation-day-group" style="display:flex; flex-direction:column; gap:0.5rem; height:100%;">
                ${allocs.map(a => `
                  <div class="allocation-item" style="border-left: 3px solid ${a.classType === 'presencial' ? 'var(--presencial)' : (a.classType === 'ead' ? 'var(--ead)' : 'var(--reservada)')}; background:#F1F5F9; flex: 1;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.3rem">
                      <span style="font-weight:800; font-size:0.65rem; color:#64748B; text-transform:uppercase; letter-spacing:1px;">
                        ${dayLabel}
                      </span>
                    </div>
                    ${a.disciplineName ? `<div style="font-size:0.75rem; font-weight:600; color:#475569; margin-bottom:0.4rem; word-break:break-word; line-height:1.2;">${esc(a.disciplineName)}</div>` : ''}
                    <div style="font-size:0.9rem; font-weight:700; color:#1E293B; margin-bottom:0.2rem">
                      ${CLASS_TYPES[a.classType] ? CLASS_TYPES[a.classType].label : a.classType}
                    </div>
                    <div style="font-size:0.75rem; color:#64748B">
                      ${a.periods && a.periods.length === 2 ? 'Noite Inteira' : (a.periods ? 'Período P' + a.periods[0] : 'Auto')}
                    </div>
                    ${a.suggestedRoomName ? `
                      <div class="entry-room" style="margin-top:0.8rem; background:#ffffff; color:#1E293B; padding:5px 10px; border-radius:8px; font-weight:800; font-size:0.7rem; border:1px solid #E2E8F0">
                        ${a.suggestedRoomName}
                      </div>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
            `;
          }).join('');
        })()}
      </div>
      
      ${(() => {
        const unallocated = sim.allocations.filter(a => a.diagnostic);
        if (unallocated.length === 0) return '';
        return `
          <div style="margin-top:2rem; padding-top:1.5rem; border-top: 1px dashed #CBD5E1;">
            <h4 style="color:#E11D48; margin-bottom: 1rem; display:flex; align-items:center; gap:0.5rem; text-transform:uppercase; font-size:0.85rem;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
              Relatório de Inviabilidade
            </h4>
            ${unallocated.map(a => `
              <div style="margin-bottom: 1rem; background:#FFF1F2; padding:1rem; border-radius:8px; border-left:4px solid #E11D48;">
                <h5 style="color:#9F1239; margin-bottom: 0.3rem; font-size:0.85rem; text-transform:uppercase;">${esc(a.disciplineName || 'Disciplina')}</h5>
                <div style="font-size:0.9rem; color:#BE123C; line-height:1.6; font-family: system-ui, -apple-system, sans-serif;">
                  ${a.diagnostic}
                </div>
              </div>
            `).join('')}
          </div>
        `;
      })()}
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
      const conflicts = await fb.checkConflict(alloc.weekday, alloc.periods, alloc.suggestedRoomId, cid, null, alloc.classType);
      if (conflicts.length > 0) {
        alert(`Conflito detectado para a Aula #${alloc.lessonNumber} na turma ${classes.find(t => t.id === cid)?.name}:\n${conflicts.join('\n')}\nA exportação foi cancelada.`);
        return;
      }
    }
  }

  // Gravar no Firebase
  const simAcademicPeriod = document.getElementById('sim-academic-period').value || '2026.1';
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
      notes: 'Exportado automaticamente do simulador.',
      disciplineId: alloc.disciplineId || null,
      disciplineName: alloc.disciplineName || null,
      academicPeriod: simAcademicPeriod
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

  let filtered = classes.filter(t => t.courseId === courseId).sort((a, b) => a.semester - b.semester);
  
  if (containerId === 'sim-classes-container') {
    const simAcademicPeriod = document.getElementById('sim-academic-period').value;
    if (simAcademicPeriod) {
      filtered = filtered.filter(t => t.academicPeriod === simAcademicPeriod);
    }
  } else if (containerId === 'entry-classes-container') {
    const calendarAcademicPeriod = document.getElementById('filter-academic-period').value;
    if (calendarAcademicPeriod) {
      filtered = filtered.filter(t => t.academicPeriod === calendarAcademicPeriod);
    }
  }
  
  if (filtered.length === 0) {
    container.innerHTML = '<p style="color:rgba(255,255,255,0.3); font-size:0.8rem; padding:0.5rem">Nenhuma turma para este curso no período letivo.</p>';
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
    'filter-course', 'class-course-id', 'entry-course-id', 'sim-course-id', 'filter-tab-class-course', 'filter-matrix-course'
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

  const groupOptions = courseGroups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  const groupSelect = document.getElementById('course-group-id');
  if (groupSelect) {
    const prev = groupSelect.value;
    groupSelect.innerHTML = '<option value="">Sem Área Definida</option>' + groupOptions;
    groupSelect.value = prev;
  }

  // Initial populate of dependent containers
  updateClassCheckboxes(document.getElementById('entry-course-id').value, 'entry-classes-container');
  updateClassCheckboxes(document.getElementById('sim-course-id').value, 'sim-classes-container');
}

// --- NEW ACADEMIC PLANNING FUNCTIONS ---

function openImportModal(type) {
  importType = type;
  parsedImportData = null;
  
  const modal = document.getElementById('modal-import-data');
  const title = document.getElementById('import-modal-title');
  const fileInput = document.getElementById('import-file-input');
  const previewContainer = document.getElementById('import-preview-container');
  const confirmBtn = document.getElementById('btn-confirm-import');
  
  fileInput.value = '';
  document.getElementById('import-classes-period-title').value = '';
  previewContainer.style.display = 'none';
  confirmBtn.disabled = true;
  
  const periodGroup = document.getElementById('import-classes-period-title').closest('.filter-group');
  const capacityGroup = document.getElementById('import-classes-default-capacity').closest('.filter-group');
  
  if (type === 'matrix') {
    title.textContent = 'Importar Matriz Curricular (.xlsx)';
    if (periodGroup) periodGroup.style.display = 'none';
    if (capacityGroup) capacityGroup.style.display = 'none';
  } else {
    title.textContent = 'Importar Turmas e Alunos (.xlsx)';
    if (periodGroup) periodGroup.style.display = 'block';
    if (capacityGroup) capacityGroup.style.display = 'block';
  }
  
  modal.style.display = 'flex';
}

function formatExcelDateToPeriod(value) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = value.getMonth() + 1;
    return `${year}.${month}`;
  }
  
  const str = String(value || '').trim();
  if (!str) return '';

  // Formatos com barra: ex "1/1/26", "2/6/26", "01/01/2026", "02/06/2026"
  const dateMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (dateMatch) {
    let year = parseInt(dateMatch[3]);
    if (year < 100) year += 2000;
    
    const part1 = parseInt(dateMatch[1]);
    const part2 = parseInt(dateMatch[2]);
    
    // Mapear o mês: no Excel, 2026.1 vira jan (mês 1) e 2026.2 vira fev (mês 2)
    let month = 1;
    if (part1 === 1 || part1 === 2) {
      month = part1;
    } else if (part2 === 1 || part2 === 2) {
      month = part2;
    } else {
      month = part1; // fallback seguro
    }
    return `${year}.${month}`;
  }

  const dmyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const month = parseInt(dmyMatch[2]);
    const year = parseInt(dmyMatch[3]);
    return `${year}.${month}`;
  }

  const myMatch = str.match(/^(\d{1,2})\/(\d{4})$/);
  if (myMatch) {
    const month = parseInt(myMatch[1]);
    const year = parseInt(myMatch[2]);
    return `${year}.${month}`;
  }
  
  const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1]);
    const month = parseInt(ymdMatch[2]);
    return `${year}.${month}`;
  }

  if (/^\d{4}\.\d+$/.test(str)) {
    return str;
  }

  if (/^\d{5}$/.test(str)) {
    const serial = parseInt(str);
    const date = new Date((serial - 25569) * 86400 * 1000);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    return `${year}.${month}`;
  }
  
  return str;
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      if (importType === 'matrix') {
        parseMatrixWorkbook(workbook);
      } else {
        parseClassesWorkbook(workbook);
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao ler a planilha: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseClassesWorkbook(workbook) {
  const result = [];
  const sheetName = workbook.SheetNames.find(n => 
    n.toLowerCase().includes('turma') || n.toLowerCase().includes('ensala') || n.toLowerCase().includes('aluno')
  ) || workbook.SheetNames[0];
  
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
  if (rows.length < 2) {
    alert('A planilha de turmas está vazia.');
    return;
  }
  
  let headerIdx = -1;
  let headers = [];
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const r = rows[i] || [];
    const rStr = r.map(c => String(c || '').toLowerCase().trim());
    if (rStr.includes('curso') || rStr.includes('periodo') || rStr.includes('período') || rStr.includes('qtde de alunos') || rStr.includes('alunos')) {
      headerIdx = i;
      headers = rStr;
      break;
    }
  }
  
  let colMapping = {
    curso: 1,
    periodo: 2,
    alunos: 3
  };
  
  if (headerIdx !== -1) {
    headers.forEach((h, idx) => {
      if (h.includes('curso')) colMapping.curso = idx;
      else if (h.includes('período') || h.includes('periodo')) colMapping.periodo = idx;
      else if (h.includes('aluno') || h.includes('qtde') || h.includes('capacidade') || h.includes('estudantes')) colMapping.alunos = idx;
    });
  }
  
  const startIndex = headerIdx !== -1 ? headerIdx + 1 : 0;
  
  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i] || [];
    if (row.length < 3) continue;
    
    const courseName = String(row[colMapping.curso] || '').trim();
    const periodStr = String(row[colMapping.periodo] || '').trim();
    const studentCount = parseInt(row[colMapping.alunos]) || 0;
    
    if (!courseName || !periodStr) continue;
    if (courseName.toLowerCase() === 'curso' || periodStr.toLowerCase().includes('período')) continue;
    
    result.push({
      courseName,
      periodStr,
      studentCount
    });
  }
  
  if (result.length === 0) {
    alert('Nenhuma turma encontrada na planilha.');
    return;
  }
  
  parsedImportData = result;
  renderImportPreview();
}

function parseMatrixWorkbook(workbook) {
  const result = [];
  
  workbook.SheetNames.forEach(sheetName => {
    // Ignorar abas de instrução ou controle interno
    const lowerSheetName = sheetName.toLowerCase();
    if (lowerSheetName.startsWith('instru') || lowerSheetName.includes('hist') || lowerSheetName.includes('readme') || lowerSheetName.startsWith('capa')) {
      return;
    }
    
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
    if (rows.length < 2) return;
    
    // Identificar a linha de cabeçalho
    let headerIdx = -1;
    let headers = [];
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const r = rows[i] || [];
      const rStr = r.map(c => String(c || '').toLowerCase().trim());
      if (rStr.includes('disciplina') && (rStr.includes('semestre') || rStr.includes('período') || rStr.includes('periodo'))) {
        headerIdx = i;
        headers = rStr;
        break;
      }
    }
    
    if (headerIdx === -1) {
      console.warn(`Cabeçalho não encontrado na aba: ${sheetName}`);
      return;
    }
    
    // Mapeamento de colunas padrão com base nos headers encontrados
    let colMapping = {
      curso: -1,
      semestre: -1,
      periodo: -1,
      disciplina: -1,
      chPres: -1,
      chEad: -1,
      chExt: -1,
      chTotal: -1
    };
    
    headers.forEach((h, idx) => {
      if (h === 'curso') colMapping.curso = idx;
      else if (h === 'semestre') colMapping.semestre = idx;
      else if (h === 'período' || h === 'periodo') colMapping.periodo = idx;
      else if (h === 'disciplina') colMapping.disciplina = idx;
      else if (h.includes('ch.pres') || h.includes('presencial')) colMapping.chPres = idx;
      else if (h.includes('ch.ead') || h.includes('ead')) colMapping.chEad = idx;
      else if (h.includes('ch.ext') || h.includes('ext')) colMapping.chExt = idx;
      else if (h.includes('ch.tota') || h.includes('total')) colMapping.chTotal = idx;
    });
    
    // Fallbacks caso os nomes exatos não batam
    if (colMapping.curso === -1) colMapping.curso = headers.findIndex(h => h.includes('curso'));
    if (colMapping.semestre === -1) colMapping.semestre = headers.findIndex(h => h.includes('semestre') || h.includes('sem.'));
    if (colMapping.periodo === -1) colMapping.periodo = headers.findIndex(h => h.includes('período') || h.includes('periodo') || h.includes('per.'));
    if (colMapping.disciplina === -1) colMapping.disciplina = headers.findIndex(h => h.includes('disciplina') || h.includes('matéria') || h.includes('materia'));
    if (colMapping.chPres === -1) colMapping.chPres = headers.findIndex(h => h.includes('ch.pres') || h.includes('presencial'));
    if (colMapping.chEad === -1) colMapping.chEad = headers.findIndex(h => h.includes('ch.ead') || h.includes('ead'));
    if (colMapping.chExt === -1) colMapping.chExt = headers.findIndex(h => h.includes('ext'));
    if (colMapping.chTotal === -1) colMapping.chTotal = headers.findIndex(h => h.includes('total') || h.includes('tota'));

    // Se colunas fundamentais não forem encontradas, ignorar aba
    if (colMapping.disciplina === -1 || colMapping.periodo === -1 || colMapping.semestre === -1) {
      console.warn(`Aba ${sheetName} ignorada por falta de colunas essenciais.`);
      return;
    }
    
    const startIndex = headerIdx + 1;
    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i] || [];
      if (row.length === 0) continue;
      
      const disciplineName = String(row[colMapping.disciplina] || '').trim();
      if (!disciplineName || disciplineName.toLowerCase() === 'disciplina' || disciplineName.toLowerCase() === 'total') continue;
      
      let courseName = colMapping.curso !== -1 ? String(row[colMapping.curso] || '').trim() : '';
      if (!courseName) courseName = sheetName; // fallback para o nome da aba
      
      let normalized = courseName.toUpperCase().trim();
      if (normalized === 'ARQUITETURA' || normalized === 'A URB.' || normalized === 'A URB' || normalized === 'ARQUITETURA URB.') normalized = 'ARQUITETURA URB.';
      if (normalized === 'ENGENHARIA CIV.' || normalized === 'ENG. CIVIL' || normalized === 'ENGENHARIA CIVIL') normalized = 'ENGENHARIA CÍVIL';
      if (normalized === 'GEST.COMERCIAL' || normalized === 'GESTÃO COMERCIAL') normalized = 'GESTÃO COMERCIAL';
      if (normalized === 'GEST.FINANCEIRA' || normalized === 'GESTÃO FINANCEIRA') normalized = 'GESTÃO FINANCEIRA';
      if (normalized === 'MED.VETERINÁRIA' || normalized === 'VETERINÁRIA' || normalized === 'MEDICINA VETERINÁRIA') normalized = 'MEDICINA VETERINÁRIA';
      if (normalized === 'CIÊNCIAS CONTÁBEIS' || normalized === 'CONTÁBEIS' || normalized === 'CONTABEIS') normalized = 'CONTÁBEIS';
      if (normalized === 'GESTÃO DE RECURSOS HUMANOS' || normalized === 'RECURSOS HUMANOS' || normalized === 'RH') normalized = 'RECURSOS HUMANOS';
      courseName = normalized;
      
      const academicPeriod = formatExcelDateToPeriod(row[colMapping.semestre]); // ex: 2026.1 ou 2026.2
      const classPeriodStr = String(row[colMapping.periodo] || '').trim(); // ex: 1, 2, 3...
      
      if (!academicPeriod || !classPeriodStr) continue;
      
      const semMatch = classPeriodStr.match(/\d+/);
      const semester = semMatch ? parseInt(semMatch[0]) : 1;
      
      const chPres = colMapping.chPres !== -1 ? (parseInt(row[colMapping.chPres]) || 0) : 0;
      const chEad = colMapping.chEad !== -1 ? (parseInt(row[colMapping.chEad]) || 0) : 0;
      const chExt = colMapping.chExt !== -1 ? (parseInt(row[colMapping.chExt]) || 0) : 0;
      const chTotal = colMapping.chTotal !== -1 ? (parseInt(row[colMapping.chTotal]) || 0) : (chPres + chEad + chExt);
      
      result.push({
        courseName,
        academicPeriod,
        semester,
        disciplineName,
        chPres,
        chEad,
        chExt,
        chTotal
      });
    }
  });
  
  if (result.length === 0) {
    alert('Nenhuma disciplina identificada nas abas da planilha.');
    return;
  }
  
  parsedImportData = result;
  renderImportPreview();
}

function renderImportPreview() {
  const container = document.getElementById('import-preview-container');
  const thead = document.getElementById('import-preview-thead');
  const tbody = document.getElementById('import-preview-tbody');
  const summary = document.getElementById('import-preview-summary');
  const confirmBtn = document.getElementById('btn-confirm-import');
  
  container.style.display = 'block';
  confirmBtn.disabled = false;
  
  if (importType === 'matrix') {
    thead.innerHTML = `
      <tr>
        <th style="text-align:left">Curso</th>
        <th style="text-align:left">Sem. Letivo</th>
        <th style="text-align:center">Período</th>
        <th style="text-align:left">Disciplina</th>
        <th style="text-align:center">CH Pres</th>
        <th style="text-align:center">CH EAD</th>
        <th style="text-align:center">CH Total</th>
      </tr>
    `;
    
    let previewRowsHtml = '';
    const previewLimit = Math.min(15, parsedImportData.length);
    for (let i = 0; i < previewLimit; i++) {
      const d = parsedImportData[i];
      previewRowsHtml += `
        <tr>
          <td>${esc(d.courseName)}</td>
          <td>${esc(d.academicPeriod)}</td>
          <td style="text-align:center">${d.semester}º</td>
          <td>${esc(d.disciplineName)}</td>
          <td style="text-align:center">${d.chPres}h</td>
          <td style="text-align:center">${d.chEad}h</td>
          <td style="text-align:center">${d.chTotal}h</td>
        </tr>
      `;
    }
    tbody.innerHTML = previewRowsHtml;
    const detectedCourses = [...new Set(parsedImportData.map(d => d.courseName))].sort();
    summary.innerHTML = `Total de <strong>${parsedImportData.length} disciplinas</strong> detectadas em todas as matrizes.<br>` +
                        `<span style="display:block; margin-top:0.4rem; font-size:0.8rem; color:#a5b4fc;">` +
                        `Cursos identificados: ${detectedCourses.join(', ')}</span>`;
  } else {
    thead.innerHTML = `
      <tr>
        <th style="text-align:left">Curso</th>
        <th style="text-align:left">Período / Nome</th>
        <th style="text-align:center">Alunos</th>
      </tr>
    `;
    
    let previewRowsHtml = '';
    const previewLimit = Math.min(15, parsedImportData.length);
    for (let i = 0; i < previewLimit; i++) {
      const c = parsedImportData[i];
      previewRowsHtml += `
        <tr>
          <td>${esc(c.courseName)}</td>
          <td>${esc(c.periodStr)}</td>
          <td style="text-align:center">${c.studentCount}</td>
        </tr>
      `;
    }
    tbody.innerHTML = previewRowsHtml;
    summary.innerHTML = `Total de <strong>${parsedImportData.length} turmas</strong> detectadas.`;
  }
}

async function handleConfirmImport() {
  if (importType === 'matrix') {
    const btn = document.getElementById('btn-confirm-import');
    const origText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Importando...';
    btn.disabled = true;
    
    try {
      const uniqueCourseNames = [...new Set(parsedImportData.map(c => c.courseName))];
      const courseMap = {};
      const coursesToCreate = [];
      
      uniqueCourseNames.forEach(name => {
        let normalized = name.toUpperCase().trim();
        if (normalized === 'ARQUITETURA' || normalized === 'A URB.' || normalized === 'A URB' || normalized === 'ARQUITETURA URB.') normalized = 'ARQUITETURA URB.';
        if (normalized === 'ENGENHARIA CIV.' || normalized === 'ENG. CIVIL' || normalized === 'ENGENHARIA CIVIL') normalized = 'ENGENHARIA CÍVIL';
        if (normalized === 'GEST.COMERCIAL' || normalized === 'GESTÃO COMERCIAL') normalized = 'GESTÃO COMERCIAL';
        if (normalized === 'GEST.FINANCEIRA' || normalized === 'GESTÃO FINANCEIRA') normalized = 'GESTÃO FINANCEIRA';
        if (normalized === 'MED.VETERINÁRIA' || normalized === 'VETERINÁRIA' || normalized === 'MEDICINA VETERINÁRIA') normalized = 'MEDICINA VETERINÁRIA';
        if (normalized === 'CIÊNCIAS CONTÁBEIS' || normalized === 'CONTÁBEIS' || normalized === 'CONTABEIS') normalized = 'CONTÁBEIS';
        if (normalized === 'GESTÃO DE RECURSOS HUMANOS' || normalized === 'RECURSOS HUMANOS' || normalized === 'RH') normalized = 'RECURSOS HUMANOS';

        const existing = courses.find(c => c.name.trim().toUpperCase() === normalized);
        if (existing) {
          courseMap[name] = existing;
        } else {
          const sigla = normalized.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, '');
          coursesToCreate.push({ name: normalized, code: sigla || 'CURS' });
        }
      });
      
      if (coursesToCreate.length > 0) {
        const created = await fb.createCoursesBatch(coursesToCreate);
        created.forEach(c => {
          courseMap[c.name] = c;
          const origExcelName = uniqueCourseNames.find(x => {
            let norm = x.toUpperCase().trim();
            if (norm === 'ARQUITETURA' || norm === 'A URB.' || norm === 'A URB' || norm === 'ARQUITETURA URB.') norm = 'ARQUITETURA URB.';
            if (norm === 'ENGENHARIA CIV.' || norm === 'ENG. CIVIL' || norm === 'ENGENHARIA CIVIL') norm = 'ENGENHARIA CÍVIL';
            if (norm === 'GEST.COMERCIAL' || norm === 'GESTÃO COMERCIAL') norm = 'GESTÃO COMERCIAL';
            if (norm === 'GEST.FINANCEIRA' || norm === 'GESTÃO FINANCEIRA') norm = 'GESTÃO FINANCEIRA';
            if (norm === 'MED.VETERINÁRIA' || norm === 'VETERINÁRIA' || norm === 'MEDICINA VETERINÁRIA') norm = 'MEDICINA VETERINÁRIA';
            if (norm === 'CIÊNCIAS CONTÁBEIS' || norm === 'CONTÁBEIS' || norm === 'CONTABEIS') norm = 'CONTÁBEIS';
            if (norm === 'GESTÃO DE RECURSOS HUMANOS' || norm === 'RECURSOS HUMANOS' || norm === 'RH') norm = 'RECURSOS HUMANOS';
            return norm === c.name;
          });
          if (origExcelName) {
            courseMap[origExcelName] = c;
          }
        });
      }
      
      const courseIds = [...new Set(Object.values(courseMap).map(c => c.id))];
      const academicPeriods = [...new Set(parsedImportData.map(d => d.academicPeriod))];
      
      // Limpar as disciplinas antigas para estes cursos e períodos letivos
      for (const courseId of courseIds) {
        for (const p of academicPeriods) {
          await fb.clearDisciplines(courseId, p);
        }
      }
      
      // Criar as novas disciplinas
      const disciplinesToCreate = parsedImportData.map(item => {
        const course = courseMap[item.courseName];
        let classType = 'ead';
        if (item.chPres > 0) {
          classType = 'presencial';
        } else if (item.chPres === 0 && item.chEad === 0 && item.chTotal > 0) {
          classType = 'carga_reservada';
        }
        
        return {
          courseId: course.id,
          academicPeriod: item.academicPeriod,
          semester: item.semester,
          name: item.disciplineName,
          chPres: item.chPres,
          chEad: item.chEad,
          chExt: item.chExt,
          chTotal: item.chTotal,
          classType: classType,
          active: true
        };
      });
      
      await fb.createDisciplinesBatch(disciplinesToCreate);
      alert('Matrizes curriculares importadas com sucesso!');
      
      document.getElementById('modal-import-data').style.display = 'none';
      await loadAllData();
    } catch (err) {
      console.error(err);
      alert('Erro ao importar as matrizes: ' + err.message);
    } finally {
      btn.textContent = origText;
      btn.disabled = false;
    }
    return;
  }

  const periodTitleInput = document.getElementById('import-classes-period-title');
  const academicPeriod = periodTitleInput.value.trim();
  if (!academicPeriod) {
    alert('Por favor, informe o título do período/lote das turmas.');
    return;
  }

  const btn = document.getElementById('btn-confirm-import');
  const origText = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span> Importando...';
  btn.disabled = true;
  
  try {
    const uniqueCourseNames = [...new Set(parsedImportData.map(c => c.courseName))];
    const courseMap = {};
    const coursesToCreate = [];
    
    uniqueCourseNames.forEach(name => {
      let normalized = name.toUpperCase().trim();
      if (normalized === 'ARQUITETURA') normalized = 'ARQUITETURA URB.';
      if (normalized === 'ENGENHARIA CIV.' || normalized === 'ENG. CIVIL') normalized = 'ENGENHARIA CÍVIL';
      if (normalized === 'GEST.COMERCIAL') normalized = 'GESTÃO COMERCIAL';
      if (normalized === 'GEST.FINANCEIRA') normalized = 'GESTÃO FINANCEIRA';
      if (normalized === 'MED.VETERINÁRIA' || normalized === 'VETERINÁRIA') normalized = 'MEDICINA VETERINÁRIA';
      if (normalized === 'CIÊNCIAS CONTÁBEIS') normalized = 'CONTÁBEIS';
      if (normalized === 'GESTÃO DE RECURSOS HUMANOS') normalized = 'RECURSOS HUMANOS';

      const existing = courses.find(c => c.name.trim().toUpperCase() === normalized);
      if (existing) {
        courseMap[name] = existing;
      } else {
        const sigla = normalized.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, '');
        coursesToCreate.push({ name: normalized, code: sigla || 'CURS' });
      }
    });
    
    if (coursesToCreate.length > 0) {
      const created = await fb.createCoursesBatch(coursesToCreate);
      created.forEach(c => {
        courseMap[c.name] = c;
        const origExcelName = uniqueCourseNames.find(x => {
          let norm = x.toUpperCase().trim();
          if (norm === 'ARQUITETURA') norm = 'ARQUITETURA URB.';
          if (norm === 'ENGENHARIA CIV.' || norm === 'ENG. CIVIL') norm = 'ENGENHARIA CÍVIL';
          if (norm === 'GEST.COMERCIAL') norm = 'GESTÃO COMERCIAL';
          if (norm === 'GEST.FINANCEIRA') norm = 'GESTÃO FINANCEIRA';
          if (norm === 'MED.VETERINÁRIA' || norm === 'VETERINÁRIA') norm = 'MEDICINA VETERINÁRIA';
          if (norm === 'CIÊNCIAS CONTÁBEIS') norm = 'CONTÁBEIS';
          if (norm === 'GESTÃO DE RECURSOS HUMANOS') norm = 'RECURSOS HUMANOS';
          return norm === c.name;
        });
        if (origExcelName) {
          courseMap[origExcelName] = c;
        }
      });
    }
    
    const oldClassesInPeriod = classes.filter(t => t.academicPeriod === academicPeriod);
    for (const t of oldClassesInPeriod) {
      await fb.remove('classes', t.id);
    }
    
    const defaultCapacity = parseInt(document.getElementById('import-classes-default-capacity').value) || 40;
    const classesToCreate = [];
    
    parsedImportData.forEach(item => {
      const course = courseMap[item.courseName];
      const semMatch = item.periodStr.match(/\d+/);
      const semester = semMatch ? parseInt(semMatch[0]) : 1;
      
      classesToCreate.push({
        courseId: course.id,
        name: `${course.name} - ${item.periodStr}º Período`,
        semester: semester,
        academicPeriod: academicPeriod,
        studentCount: item.studentCount || defaultCapacity,
        shift: 'noturno',
        active: true
      });
    });
    
    await fb.createClassesBatch(classesToCreate);
    alert('Turmas importadas com sucesso!');
    
    document.getElementById('modal-import-data').style.display = 'none';
    await loadAllData();
  } catch (err) {
    console.error(err);
    alert('Erro ao importar os dados: ' + err.message);
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}



