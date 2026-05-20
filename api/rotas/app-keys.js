const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');
const crypto = require('crypto');

// ================================================================
//  GET /api/app-keys — Lista chaves (apenas ADM)
// ================================================================
router.get('/', verifyToken, async (req, res) => {
    if (req.user.role !== 'adm_l1' && req.user.role !== 'adm_l2') {
        return res.status(403).json({ error: 'Acesso negado.' });
    }
    try {
        const snap = await db.collection('app_keys').get();
        const keys = snap.docs.map(d => ({
            id: d.id,
            ...d.data(),
            // Não retorna a chave completa na listagem por segurança
            key: d.data().key.substring(0, 8) + '...'
        }));
        res.json(keys);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================================================================
//  POST /api/app-keys — Gera uma nova chave (apenas ADM)
// ================================================================
router.post('/', verifyToken, async (req, res) => {
    if (req.user.role !== 'adm_l1' && req.user.role !== 'adm_l2') {
        return res.status(403).json({ error: 'Acesso negado.' });
    }
    try {
        const { nome, descricao } = req.body;
        const key = 'orbita_' + crypto.randomBytes(24).toString('hex');
        const newDoc = db.collection('app_keys').doc();
        await newDoc.set({
            nome: nome || 'App Clube',
            descricao: descricao || 'Chave de acesso para o aplicativo móvel',
            key,
            ativa: true,
            criadaEm: new Date().toISOString(),
            criadaPor: req.user.uid
        });
        // Retorna a chave COMPLETA apenas na criação
        res.status(201).json({ id: newDoc.id, key, message: 'Chave gerada com sucesso. Guarde-a em local seguro!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================================================================
//  DELETE /api/app-keys/:id — Revoga uma chave (apenas ADM)
// ================================================================
router.delete('/:id', verifyToken, async (req, res) => {
    if (req.user.role !== 'adm_l1' && req.user.role !== 'adm_l2') {
        return res.status(403).json({ error: 'Acesso negado.' });
    }
    try {
        await db.collection('app_keys').doc(req.params.id).update({ ativa: false });
        res.json({ message: 'Chave revogada com sucesso.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ================================================================
//  POST /api/app-keys/validate — Valida uma chave (sem auth Firebase)
//  Usado pelo app Expo para verificar se a key é válida antes de chamar
//  outros endpoints
// ================================================================
router.post('/validate', async (req, res) => {
    const { key } = req.body;
    if (!key) return res.status(400).json({ valid: false, error: 'Chave não informada.' });
    try {
        const snap = await db.collection('app_keys').where('key', '==', key).where('ativa', '==', true).get();
        if (snap.empty) return res.status(401).json({ valid: false, error: 'Chave inválida ou revogada.' });
        res.json({ valid: true });
    } catch (err) {
        res.status(500).json({ valid: false, error: err.message });
    }
});

module.exports = router;
