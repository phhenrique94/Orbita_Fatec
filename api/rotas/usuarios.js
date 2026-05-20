const express = require('express');
const router = express.Router();
const { db, auth } = require('../firebase');
const verifyToken = require('../middlewares/auth');

// ==========================================
// USUÁRIOS (users)
// ==========================================

// GET /api/usuarios/me - Retorna apenas os dados do usuário atual (seguro para não admins)
router.get('/me', verifyToken, async (req, res) => {
    try {
        const snap = await db.collection('users').doc(req.user.uid).get();
        res.json(snap.exists ? { uid: snap.id, ...snap.data() } : { role: 'visitante' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/usuarios
router.get('/', verifyToken, async (req, res) => {
    try {
        const snap = await db.collection('users').get();
        const users = [];
        snap.forEach(doc => users.push({ uid: doc.id, ...doc.data() }));
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/usuarios - Cria no Firebase Auth e no Firestore
router.post('/', verifyToken, async (req, res) => {
    try {
        const { nome, email, senha, role } = req.body;
        
        // 1. Cria usuário no Firebase Authentication via Admin SDK
        const userRecord = await auth.createUser({
            email,
            password: senha,
            displayName: nome
        });
        
        // 2. Salva o documento no Firestore
        const userData = {
            uid: userRecord.uid,
            name: nome,
            email,
            role,
            ativo: true,
            createdAt: new Date().toISOString(),
            createdBy: req.user.uid // req.user vem do verifyToken
        };
        await db.collection('users').doc(userRecord.uid).set(userData);
        
        res.status(201).json({ message: 'Usuário criado com sucesso!', user: userData });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// PUT /api/usuarios/:uid/role
router.put('/:uid/role', verifyToken, async (req, res) => {
    try {
        const { role } = req.body;
        await db.collection('users').doc(req.params.uid).update({ role });
        res.json({ message: 'Nível atualizado com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/usuarios/:uid/status
router.put('/:uid/status', verifyToken, async (req, res) => {
    try {
        const { ativo } = req.body;
        await db.collection('users').doc(req.params.uid).update({ ativo });
        res.json({ message: `Status atualizado com sucesso!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/usuarios/:uid
router.delete('/:uid', verifyToken, async (req, res) => {
    try {
        // Deleta do Firestore
        await db.collection('users').doc(req.params.uid).delete();
        // Opcional: Pode deletar do Auth também se quiser
        // await auth.deleteUser(req.params.uid);
        res.json({ message: 'Usuário removido do sistema.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// CARGOS (roles)
// ==========================================

router.get('/roles', verifyToken, async (req, res) => {
    try {
        const snap = await db.collection('roles').get();
        const roles = [];
        snap.forEach(doc => roles.push({ id: doc.id, ...doc.data() }));
        res.json(roles);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/roles', verifyToken, async (req, res) => {
    try {
        const { id, name } = req.body;
        const docRef = db.collection('roles').doc(id);
        const snap = await docRef.get();
        if (snap.exists) return res.status(400).json({ error: 'Este ID de cargo já existe.' });
        await docRef.set({ name });
        res.json({ message: 'Cargo criado com sucesso!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/roles/:id', verifyToken, async (req, res) => {
    try {
        await db.collection('roles').doc(req.params.id).delete();
        res.json({ message: 'Cargo removido.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// PERMISSÕES GLOBAIS (config/permissions)
// ==========================================

router.get('/config/permissions', verifyToken, async (req, res) => {
    try {
        const snap = await db.collection('config').doc('permissions').get();
        res.json(snap.exists ? snap.data() : {});
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/config/permissions', verifyToken, async (req, res) => {
    try {
        await db.collection('config').doc('permissions').set(req.body);
        res.json({ message: 'Permissões atualizadas com sucesso!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
