const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

const checkPermission = verifyToken.requireModulePermission('agenda');

router.get('/', async (req, res) => {
    try {
        const snap = await db.collection('locais_agenda').get();
        const locais = [];
        snap.forEach(doc => locais.push({ id: doc.id, ...doc.data() }));
        
        if (locais.length === 0) {
            // Seed the default locations
            const defaults = [
                { nome: 'Lab 12 - Informática', tipo: 'laboratorio', capacidade: 60 },
                { nome: 'Lab 20 - Informática', tipo: 'laboratorio', capacidade: 30 },
                { nome: 'Auditório', tipo: 'auditorio', capacidade: 100 },
                { nome: 'JBL', tipo: 'jbl', capacidade: 50 }
            ];
            
            for (const d of defaults) {
                const newDoc = db.collection('locais_agenda').doc();
                await newDoc.set({ ...d, createdAt: new Date().toISOString() });
                locais.push({ id: newDoc.id, ...d });
            }
        }
        
        res.json(locais);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', verifyToken, checkPermission, async (req, res) => {
    try {
        const { nome, capacidade, tipo } = req.body;
        if (!nome) return res.status(400).json({ error: 'Nome do local é obrigatório.' });

        const newDoc = db.collection('locais_agenda').doc();
        await newDoc.set({
            nome,
            capacidade: parseInt(capacidade) || 0,
            tipo: tipo || 'laboratorio',
            createdAt: new Date().toISOString()
        });
        res.status(201).json({ message: 'Local criado', id: newDoc.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        await db.collection('locais_agenda').doc(req.params.id).delete();
        res.json({ message: 'Local removido com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
