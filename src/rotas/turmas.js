const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

// Middleware para verificar permissão do módulo 'turmas'
const checkPermission = verifyToken.requireModulePermission('turmas');

// GET /api/turmas - Listar turmas
router.get('/', verifyToken, checkPermission, async (req, res) => {
    try {
        const snap = await db.collection('turmas').get();
        const turmas = [];
        snap.forEach(doc => turmas.push({ id: doc.id, ...doc.data() }));
        res.json(turmas);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/turmas - Criar turma
router.post('/', verifyToken, checkPermission, async (req, res) => {
    try {
        const { disciplina, curso, codigo, periodo, sala, alunos, professor } = req.body;
        
        // Validação básica
        if (!disciplina || !curso || !codigo || !periodo || !sala || !alunos || !professor) {
            return res.status(400).json({ error: 'Todos os campos obrigatórios devem ser preenchidos.' });
        }

        const newDoc = db.collection('turmas').doc();
        await newDoc.set({
            disciplina,
            curso,
            codigo,
            periodo,
            sala,
            alunos: parseInt(alunos) || 0,
            professor,
            createdAt: new Date().toISOString(),
            createdBy: req.user.uid
        });
        res.status(201).json({ message: 'Turma cadastrada com sucesso!', id: newDoc.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/turmas/import - Importar turma via CSV (inclui lista de alunos e semestre)
router.post('/import', verifyToken, checkPermission, async (req, res) => {
    try {
        const { disciplina, curso, codigo, periodo, sala, alunos, professor, listaAlunos, semestre } = req.body;

        if (!disciplina || !curso || !periodo || !professor) {
            return res.status(400).json({ error: 'Todos os campos obrigatórios devem ser preenchidos.' });
        }

        const newDoc = db.collection('turmas').doc();
        await newDoc.set({
            disciplina,
            curso,
            codigo: codigo || '',
            periodo,
            sala: sala || '',
            alunos:      parseInt(alunos) || 0,
            professor,
            listaAlunos: Array.isArray(listaAlunos) ? listaAlunos : [],
            semestre:    semestre || '',
            importadoCSV: true,
            createdAt:   new Date().toISOString(),
            createdBy:   req.user.uid
        });

        res.status(201).json({
            message: `Turma "${disciplina}" importada com sucesso com ${listaAlunos?.length || 0} alunos!`,
            id: newDoc.id
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// PUT /api/turmas/:id - Atualizar turma
router.put('/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const { disciplina, curso, codigo, periodo, sala, alunos, professor } = req.body;
        
        if (!disciplina || !curso || !codigo || !periodo || !sala || !alunos || !professor) {
            return res.status(400).json({ error: 'Todos os campos obrigatórios devem ser preenchidos.' });
        }

        await db.collection('turmas').doc(req.params.id).update({
            disciplina,
            curso,
            codigo,
            periodo,
            sala,
            alunos: parseInt(alunos) || 0,
            professor
        });
        res.json({ message: 'Turma atualizada com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/turmas/:id - Excluir turma
router.delete('/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        await db.collection('turmas').doc(req.params.id).delete();
        res.json({ message: 'Turma removida com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
