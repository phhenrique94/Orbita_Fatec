const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

// Middleware para verificar permissão do módulo 'avaliacoes'
const checkPermission = verifyToken.requireModulePermission('avaliacoes');

// GET /api/avaliacoes - Listar avaliações (com filtro opcional por turmaId)
router.get('/', verifyToken, checkPermission, async (req, res) => {
    try {
        const { turmaId } = req.query;
        let query = db.collection('avaliacoes');
        
        if (turmaId) {
            query = query.where('turmaId', '==', turmaId);
        }
        
        const snap = await query.get();
        const list = [];
        snap.forEach(doc => {
            list.push({ id: doc.id, ...doc.data() });
        });
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/avaliacoes - Criar avaliação
router.post('/', verifyToken, checkPermission, async (req, res) => {
    try {
        const { turmaId, turmaNome, titulo, peso, curso, questoes } = req.body;
        
        if (!turmaId || !turmaNome || !titulo || !peso || !curso) {
            return res.status(400).json({ error: 'Todos os campos obrigatórios devem ser preenchidos.' });
        }

        const newDoc = db.collection('avaliacoes').doc();
        await newDoc.set({
            turmaId,
            turmaNome,
            titulo,
            curso,
            peso: parseFloat(peso) || 0,
            questoes: questoes || [],
            createdAt: new Date().toISOString(),
            createdBy: req.user.uid
        });

        res.status(201).json({ message: 'Avaliação cadastrada com sucesso!', id: newDoc.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/avaliacoes/:id - Atualizar avaliação
router.put('/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const { turmaId, turmaNome, titulo, peso, curso, questoes } = req.body;
        
        if (!turmaId || !turmaNome || !titulo || !peso || !curso) {
            return res.status(400).json({ error: 'Todos os campos obrigatórios devem ser preenchidos.' });
        }

        await db.collection('avaliacoes').doc(req.params.id).update({
            turmaId,
            turmaNome,
            titulo,
            curso,
            peso: parseFloat(peso) || 0,
            questoes: questoes || []
        });

        res.json({ message: 'Avaliação atualizada com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/avaliacoes/:id - Excluir avaliação
router.delete('/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        await db.collection('avaliacoes').doc(req.params.id).delete();
        res.json({ message: 'Avaliação excluída com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/avaliacoes/:id/respostas - Listar resultados de uma avaliação
router.get('/:id/respostas', verifyToken, checkPermission, async (req, res) => {
    try {
        const snap = await db.collection('resultados_avaliacoes')
            .where('avaliacaoId', '==', req.params.id)
            .get();
        const list = [];
        snap.forEach(doc => {
            list.push({ id: doc.id, ...doc.data() });
        });
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/avaliacoes/:id/respostas - Salvar/atualizar nota de um aluno
router.post('/:id/respostas', verifyToken, checkPermission, async (req, res) => {
    try {
        const { alunoNome, turmaId, respostas, nota, pesoTotal } = req.body;
        const avaliacaoId = req.params.id;

        if (!alunoNome || !turmaId) {
            return res.status(400).json({ error: 'Campos alunoNome e turmaId são obrigatórios.' });
        }

        // Buscar se já existe nota para este aluno nesta avaliação e turma
        const query = db.collection('resultados_avaliacoes')
            .where('avaliacaoId', '==', avaliacaoId)
            .where('turmaId', '==', turmaId)
            .where('alunoNome', '==', alunoNome);
        
        const snap = await query.get();

        const data = {
            avaliacaoId,
            turmaId,
            alunoNome,
            respostas: respostas || {},
            nota: parseFloat(nota) || 0,
            pesoTotal: parseFloat(pesoTotal) || 0,
            updatedAt: new Date().toISOString(),
            updatedBy: req.user.uid
        };

        if (!snap.empty) {
            // Atualizar existente
            const docId = snap.docs[0].id;
            await db.collection('resultados_avaliacoes').doc(docId).update(data);
            res.json({ message: 'Resultado do aluno atualizado com sucesso!', id: docId });
        } else {
            // Criar novo
            data.createdAt = new Date().toISOString();
            const newDoc = db.collection('resultados_avaliacoes').doc();
            await newDoc.set(data);
            res.status(201).json({ message: 'Resultado do aluno salvo com sucesso!', id: newDoc.id });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

