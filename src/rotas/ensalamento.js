const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

// ==========================================
// ROTAS CUSTOMIZADAS (Para evitar conflito com /:colName)
// ==========================================

router.get('/custom/calendarEntries', verifyToken, verifyToken.requireModulePermission('ensalamento'), async (req, res) => {
    try {
        let q = db.collection('calendarEntries').where('active', '==', true);
        
        if (req.query.courseId) q = q.where('courseId', '==', req.query.courseId);
        if (req.query.classId) q = q.where('classId', '==', req.query.classId);
        if (req.query.roomId) q = q.where('roomId', '==', req.query.roomId);
        if (req.query.weekday) q = q.where('weekday', '==', parseInt(req.query.weekday));

        const snap = await q.get();
        const entries = [];
        snap.forEach(doc => entries.push({ id: doc.id, ...doc.data() }));
        res.json(entries);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/custom/checkConflict', verifyToken, verifyToken.requireModulePermission('ensalamento'), async (req, res) => {
    try {
        const { weekday, periods, roomId, classId, excludeId, classType } = req.body;
        
        const q = db.collection('calendarEntries')
                    .where('active', '==', true)
                    .where('weekday', '==', parseInt(weekday));
                    
        const snap = await q.get();
        const conflicts = [];
        
        snap.forEach(doc => {
            if (excludeId && doc.id === excludeId) return;
            const entry = { id: doc.id, ...doc.data() };
            
            const hasPeriodOverlap = entry.periods.some(p => periods.includes(p));
            if (hasPeriodOverlap) {
                const entryClassIds = entry.classIds || [entry.classId];
                if (entryClassIds.includes(classId)) {
                    // Só há conflito de dia/período de aula se ambas forem bloqueantes (presencial ou ead)
                    const entryType = entry.classType || 'presencial';
                    const newType = classType || 'presencial';
                    const entryIsBlocking = entryType === 'presencial' || entryType === 'ead';
                    const newIsBlocking = newType === 'presencial' || newType === 'ead';
                    if (entryIsBlocking && newIsBlocking) {
                        conflicts.push('A turma já possui aula presencial ou EAD neste período.');
                    }
                }
                if (roomId && entry.roomId === roomId) {
                    // Só há conflito de sala se ambas forem presenciais
                    const entryType = entry.classType || 'presencial';
                    const newType = classType || 'presencial';
                    if (entryType === 'presencial' && newType === 'presencial') {
                        conflicts.push('A sala já está ocupada neste período.');
                    }
                }
            }
        });
        
        res.json(conflicts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/custom/disciplines', verifyToken, verifyToken.requireModulePermission('ensalamento'), async (req, res) => {
    try {
        const { courseId, matrixName } = req.query;
        if (!courseId) return res.status(400).json({ error: 'Falta o parâmetro courseId' });
        
        let q = db.collection('disciplines').where('courseId', '==', courseId);
        const snap = await q.get();
        const batch = db.batch();
        let count = 0;
        
        snap.forEach(doc => {
            const data = doc.data();
            if (matrixName) {
                if (data.matrixName === matrixName || data.academicPeriod === matrixName) {
                    batch.delete(doc.ref);
                    count++;
                }
            } else {
                batch.delete(doc.ref);
                count++;
            }
        });
        
        await batch.commit();
        res.json({ message: `${count} disciplinas removidas com sucesso.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/custom/disciplines/batch', verifyToken, verifyToken.requireModulePermission('ensalamento'), async (req, res) => {
    try {
        const { disciplines } = req.body;
        if (!Array.isArray(disciplines)) return res.status(400).json({ error: 'disciplines deve ser uma lista.' });
        
        const batch = db.batch();
        const created = [];
        
        disciplines.forEach(item => {
            const docRef = db.collection('disciplines').doc();
            const data = {
                ...item,
                active: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            batch.set(docRef, data);
            created.push({ id: docRef.id, ...data });
        });
        
        await batch.commit();
        res.status(201).json(created);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/custom/courses/batch', verifyToken, verifyToken.requireModulePermission('ensalamento'), async (req, res) => {
    try {
        const { courses } = req.body;
        if (!Array.isArray(courses)) return res.status(400).json({ error: 'courses deve ser uma lista.' });
        
        const batch = db.batch();
        const created = [];
        
        courses.forEach(item => {
            const docRef = db.collection('courses').doc();
            const data = {
                ...item,
                active: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            batch.set(docRef, data);
            created.push({ id: docRef.id, ...data });
        });
        
        await batch.commit();
        res.status(201).json(created);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/custom/classes/batch', verifyToken, verifyToken.requireModulePermission('ensalamento'), async (req, res) => {
    try {
        const { classes } = req.body;
        if (!Array.isArray(classes)) return res.status(400).json({ error: 'classes deve ser uma lista.' });
        
        const batch = db.batch();
        const created = [];
        
        classes.forEach(item => {
            const docRef = db.collection('classes').doc();
            const data = {
                ...item,
                active: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            batch.set(docRef, data);
            created.push({ id: docRef.id, ...data });
        });
        
        await batch.commit();
        res.status(201).json(created);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// CRUD GENÉRICO DE ENSALAMENTO
// ==========================================
const ALLOWED_COLS = ['courses', 'classes', 'rooms', 'calendarEntries', 'disciplines', 'simulations', 'courseGroups'];

router.get('/:colName', verifyToken, verifyToken.requireModulePermission('ensalamento'), async (req, res) => {
    try {
        const { colName } = req.params;
        if (!ALLOWED_COLS.includes(colName)) return res.status(403).json({error: 'Coleção não permitida'});

        let q = db.collection(colName);
        if (req.query.active === 'true') {
            q = q.where('active', '==', true);
        } else {
            q = q.orderBy('createdAt', 'desc');
        }

        const snap = await q.get();
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:colName/:id', verifyToken, verifyToken.requireModulePermission('ensalamento'), async (req, res) => {
    try {
        const { colName, id } = req.params;
        if (!ALLOWED_COLS.includes(colName)) return res.status(403).json({error: 'Coleção não permitida'});

        const snap = await db.collection(colName).doc(id).get();
        res.json(snap.exists ? { id: snap.id, ...snap.data() } : null);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:colName', verifyToken, verifyToken.requireModulePermission('ensalamento'), async (req, res) => {
    try {
        const { colName } = req.params;
        if (!ALLOWED_COLS.includes(colName)) return res.status(403).json({error: 'Coleção não permitida'});

        const data = {
            ...req.body,
            active: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const docRef = await db.collection(colName).add(data);
        res.status(201).json({ id: docRef.id, ...data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:colName/:id', verifyToken, verifyToken.requireModulePermission('ensalamento'), async (req, res) => {
    try {
        const { colName, id } = req.params;
        if (!ALLOWED_COLS.includes(colName)) return res.status(403).json({error: 'Coleção não permitida'});

        const data = {
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        await db.collection(colName).doc(id).update(data);
        res.json({ message: 'Atualizado com sucesso' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:colName/:id', verifyToken, verifyToken.requireModulePermission('ensalamento'), async (req, res) => {
    try {
        const { colName, id } = req.params;
        if (!ALLOWED_COLS.includes(colName)) return res.status(403).json({error: 'Coleção não permitida'});

        await db.collection(colName).doc(id).delete();
        res.json({ message: 'Removido com sucesso' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
