const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

// GET /api/empresas - Lista empresas parceiras
router.get('/', verifyToken, async (req, res) => {
    try {
        const snap = await db.collection('empresas').get();
        const empresas = [];
        snap.forEach(doc => empresas.push({ id: doc.id, ...doc.data() }));
        res.json(empresas);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/empresas
router.post('/', verifyToken, async (req, res) => {
    try {
        const { nome, descricao, localizacao, desconto, categoria } = req.body;
        const newDoc = db.collection('empresas').doc();
        await newDoc.set({
            nome,
            descricao,
            localizacao,
            desconto,
            categoria,
            createdAt: new Date().toISOString()
        });
        res.status(201).json({ message: 'Empresa cadastrada com sucesso!', id: newDoc.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/empresas/:id
router.put('/:id', verifyToken, async (req, res) => {
    try {
        const { nome, descricao, localizacao, desconto, categoria } = req.body;
        await db.collection('empresas').doc(req.params.id).update({
            nome,
            descricao,
            localizacao,
            desconto,
            categoria
        });
        res.json({ message: 'Empresa atualizada com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/empresas/:id
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        await db.collection('empresas').doc(req.params.id).delete();
        res.json({ message: 'Empresa removida com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
