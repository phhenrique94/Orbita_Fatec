const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

// ==========================================
// NOTAS PESSOAIS (POST-ITS)
// ==========================================

router.get('/notes', verifyToken, async (req, res) => {
    try {
        const snap = await db.collection('users').doc(req.user.uid).collection('notes').orderBy('createdAt', 'desc').get();
        const notes = [];
        snap.forEach(doc => notes.push({ id: doc.id, ...doc.data() }));
        res.json(notes);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/notes', verifyToken, async (req, res) => {
    try {
        const data = {
            ...req.body,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const docRef = await db.collection('users').doc(req.user.uid).collection('notes').add(data);
        res.status(201).json({ id: docRef.id, ...data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/notes/:id', verifyToken, async (req, res) => {
    try {
        const data = {
            ...req.body,
            updatedAt: new Date().toISOString()
        };
        await db.collection('users').doc(req.user.uid).collection('notes').doc(req.params.id).update(data);
        res.json({ message: 'Nota atualizada' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/notes/:id', verifyToken, async (req, res) => {
    try {
        await db.collection('users').doc(req.user.uid).collection('notes').doc(req.params.id).delete();
        res.json({ message: 'Nota deletada' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// MURAL DE AVISOS INSTITUCIONAIS
// ==========================================

router.get('/notices', verifyToken, async (req, res) => {
    try {
        const snap = await db.collection('notices').orderBy('createdAt', 'desc').get();
        const notices = [];
        snap.forEach(doc => notices.push({ id: doc.id, ...doc.data() }));
        res.json(notices);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/notices', verifyToken, async (req, res) => {
    try {
        // Bloqueio extra: só admin pode postar avisos institucionais
        if (req.user.role !== 'adm_l1' && req.user.role !== 'adm_l2') return res.status(403).json({error: 'Apenas administradores podem criar avisos.'});
        
        const data = {
            ...req.body,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: req.user.uid
        };
        const docRef = await db.collection('notices').add(data);
        res.status(201).json({ id: docRef.id, ...data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/notices/:id', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'adm_l1' && req.user.role !== 'adm_l2') return res.status(403).json({error: 'Apenas administradores podem editar avisos.'});
        const data = { ...req.body, updatedAt: new Date().toISOString() };
        await db.collection('notices').doc(req.params.id).update(data);
        res.json({ message: 'Aviso atualizado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/notices/:id', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'adm_l1' && req.user.role !== 'adm_l2') return res.status(403).json({error: 'Apenas administradores podem excluir avisos.'});
        await db.collection('notices').doc(req.params.id).delete();
        res.json({ message: 'Aviso deletado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
