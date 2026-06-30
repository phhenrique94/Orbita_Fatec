const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

const ALLOWED_COLS = ['funcionarios_rh', 'eventos_rh', 'registros_carga_horaria'];

router.get('/:colName', verifyToken, verifyToken.requireModulePermission('carga-horaria'), async (req, res) => {
    try {
        const { colName } = req.params;
        if (!ALLOWED_COLS.includes(colName)) return res.status(403).json({error: 'Coleção não permitida'});

        let q = db.collection(colName);
        
        // Simulando as queries específicas que existiam no frontend
        if (req.query.eventoId && req.query.dataEvento) {
            q = q.where('eventoId', '==', req.query.eventoId).where('dataEvento', '==', req.query.dataEvento);
        } else if (req.query.funcionarioId) {
            q = q.where('funcionarioId', '==', req.query.funcionarioId).orderBy('lancadoEm', 'desc');
        } else if (colName === 'funcionarios_rh') {
            q = q.orderBy('nome');
        } else if (colName === 'eventos_rh') {
            q = q.orderBy('criadoEm', 'desc');
        }

        const snap = await q.get();
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/:colName/:id', verifyToken, verifyToken.requireModulePermission('carga-horaria'), async (req, res) => {
    try {
        const { colName, id } = req.params;
        if (!ALLOWED_COLS.includes(colName)) return res.status(403).json({error: 'Coleção não permitida'});
        const snap = await db.collection(colName).doc(id).get();
        res.json(snap.exists ? { id: snap.id, ...snap.data() } : null);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:colName', verifyToken, verifyToken.requireModulePermission('carga-horaria'), async (req, res) => {
    try {
        const { colName } = req.params;
        if (!ALLOWED_COLS.includes(colName)) return res.status(403).json({error: 'Coleção não permitida'});
        const data = { ...req.body };
        
        // Conversão de TIMESTAMP string para Data Real do backend
        if (data.criadoEm === 'TIMESTAMP') data.criadoEm = new Date().toISOString();
        if (data.lancadoEm === 'TIMESTAMP') data.lancadoEm = new Date().toISOString();
        if (data.entrada === 'TIMESTAMP') data.entrada = new Date().toISOString();
        if (data.saida === 'TIMESTAMP') data.saida = new Date().toISOString();

        const docRef = await db.collection(colName).add(data);
        res.status(201).json({ id: docRef.id, ...data });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:colName/:id', verifyToken, verifyToken.requireModulePermission('carga-horaria'), async (req, res) => {
    try {
        const { colName, id } = req.params;
        if (!ALLOWED_COLS.includes(colName)) return res.status(403).json({error: 'Coleção não permitida'});
        const data = { ...req.body };
        
        if (data.saida === 'TIMESTAMP') data.saida = new Date().toISOString();

        await db.collection(colName).doc(id).update(data);
        res.json({ message: 'Atualizado com sucesso' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:colName/:id', verifyToken, verifyToken.requireModulePermission('carga-horaria'), async (req, res) => {
    try {
        const { colName, id } = req.params;
        if (!ALLOWED_COLS.includes(colName)) return res.status(403).json({error: 'Coleção não permitida'});
        await db.collection(colName).doc(id).delete();
        res.json({ message: 'Removido com sucesso' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
