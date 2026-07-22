const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

const checkPermission = verifyToken.requireModulePermission('relatorio-dp');

const COL_REGISTROS = 'secretaria_dp_registros';

const STATUS_VALIDOS = ['A_CURSAR', 'CURSANDO', 'CURSOU', 'CANCELOU'];

function dedupKey(curso, nome, turma, disciplina) {
    return [curso, nome, turma, disciplina]
        .map(v => (v || '').trim().toUpperCase())
        .join('|');
}

// ==========================================
// REGISTROS (disciplinas em DP por aluno)
// ==========================================

// GET /api/secretaria-dp/resumo - Contagem por curso (só curso+status, sem nome/disciplina)
// Usado pra montar a barra lateral sem precisar trazer todos os alunos de todos os cursos.
router.get('/resumo', verifyToken, checkPermission, async (req, res) => {
    try {
        const snap = await db.collection(COL_REGISTROS).select('curso', 'status').get();
        const porCurso = new Map();
        snap.forEach(doc => {
            const { curso, status } = doc.data();
            if (!curso) return;
            if (!porCurso.has(curso)) porCurso.set(curso, { curso, total: 0, done: 0 });
            const c = porCurso.get(curso);
            c.total++;
            if (status && status !== 'A_CURSAR') c.done++;
        });
        const resumo = Array.from(porCurso.values()).sort((a, b) => a.curso.localeCompare(b.curso, 'pt-BR'));
        res.json(resumo);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/secretaria-dp/registros - Listar registros (opcionalmente filtrado por curso)
router.get('/registros', verifyToken, checkPermission, async (req, res) => {
    try {
        const { curso } = req.query;
        const query = curso
            ? db.collection(COL_REGISTROS).where('curso', '==', curso)
            : db.collection(COL_REGISTROS).orderBy('curso');
        const snap = await query.get();
        const registros = [];
        snap.forEach(doc => registros.push({ id: doc.id, ...doc.data() }));
        res.json(registros);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/secretaria-dp/registros - Adicionar disciplina manualmente a um aluno
router.post('/registros', verifyToken, checkPermission, async (req, res) => {
    try {
        const { curso, nome, turma, disciplina, professor, periodo, financeiro, status } = req.body;

        if (!curso || !curso.trim()) {
            return res.status(400).json({ error: 'O curso é obrigatório.' });
        }
        if (!nome || !nome.trim()) {
            return res.status(400).json({ error: 'O nome do aluno é obrigatório.' });
        }
        if (!turma || !turma.trim()) {
            return res.status(400).json({ error: 'A turma é obrigatória.' });
        }
        if (!disciplina || !disciplina.trim()) {
            return res.status(400).json({ error: 'A disciplina é obrigatória.' });
        }

        const statusFinal = STATUS_VALIDOS.includes(status) ? status : 'A_CURSAR';
        const key = dedupKey(curso, nome, turma, disciplina);

        const existente = await db.collection(COL_REGISTROS).where('dedupKey', '==', key).limit(1).get();
        if (!existente.empty) {
            return res.status(409).json({ error: 'Este aluno já possui essa disciplina cadastrada nessa turma.' });
        }

        const newDoc = db.collection(COL_REGISTROS).doc();
        await newDoc.set({
            curso: curso.trim(),
            nome: nome.trim(),
            turma: turma.trim(),
            disciplina: disciplina.trim(),
            professor: (professor || '').trim(),
            periodo: (periodo || '').trim(),
            financeiro: (financeiro || '').trim(),
            status: statusFinal,
            origem: 'manual',
            dedupKey: key,
            createdAt: new Date().toISOString(),
            createdBy: req.user.uid,
            createdByName: req.user.name || req.user.email || ''
        });

        res.status(201).json({ message: 'Disciplina adicionada com sucesso!', id: newDoc.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/secretaria-dp/registros/:id - Editar nome/turma/status/professor/período/financeiro
router.put('/registros/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const { status, professor, periodo, financeiro, nome, turma } = req.body;
        const update = {
            updatedAt: new Date().toISOString(),
            updatedBy: req.user.uid
        };

        if (status !== undefined) {
            if (!STATUS_VALIDOS.includes(status)) {
                return res.status(400).json({ error: 'Status inválido.' });
            }
            update.status = status;
        }
        if (professor !== undefined) update.professor = String(professor).trim();
        if (periodo !== undefined) update.periodo = String(periodo).trim();
        if (financeiro !== undefined) update.financeiro = String(financeiro).trim();
        if (nome !== undefined) {
            if (!String(nome).trim()) {
                return res.status(400).json({ error: 'O nome do aluno é obrigatório.' });
            }
            update.nome = String(nome).trim();
        }
        if (turma !== undefined) {
            if (!String(turma).trim()) {
                return res.status(400).json({ error: 'A turma é obrigatória.' });
            }
            update.turma = String(turma).trim();
        }

        const ref = db.collection(COL_REGISTROS).doc(req.params.id);
        const doc = await ref.get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Registro não encontrado.' });
        }

        // nome/turma entram no dedupKey — recalcula pra manter a detecção de duplicados coerente
        if (update.nome !== undefined || update.turma !== undefined) {
            const dados = doc.data();
            const novoNome = update.nome !== undefined ? update.nome : dados.nome;
            const novaTurma = update.turma !== undefined ? update.turma : dados.turma;
            update.dedupKey = dedupKey(dados.curso, novoNome, novaTurma, dados.disciplina);
        }

        await ref.update(update);
        res.json({ message: 'Registro atualizado com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/secretaria-dp/registros/:id - Remover uma disciplina (registro) de um aluno
router.delete('/registros/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const ref = db.collection(COL_REGISTROS).doc(req.params.id);
        const doc = await ref.get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Registro não encontrado.' });
        }
        await ref.delete();
        res.json({ message: 'Registro removido com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/secretaria-dp/importar-csv - Importar registros do CSV do Edubox (com dedup)
router.post('/importar-csv', verifyToken, checkPermission, async (req, res) => {
    try {
        const { records } = req.body;
        if (!Array.isArray(records) || !records.length) {
            return res.status(400).json({ error: 'Nenhum registro para importar.' });
        }

        const existentesSnap = await db.collection(COL_REGISTROS).select('dedupKey').get();
        const seenKeys = new Set();
        existentesSnap.forEach(doc => seenKeys.add(doc.data().dedupKey));

        const paraGravar = [];
        records.forEach(rec => {
            const { curso, nome, turma, disciplina } = rec || {};
            if (!curso || !nome || !turma || !disciplina) return;
            const key = dedupKey(curso, nome, turma, disciplina);
            if (seenKeys.has(key)) return;
            seenKeys.add(key);
            paraGravar.push({
                curso: String(curso).trim(),
                nome: String(nome).trim(),
                turma: String(turma).trim(),
                disciplina: String(disciplina).trim(),
                professor: '',
                periodo: '',
                financeiro: '',
                status: 'A_CURSAR',
                origem: 'csv',
                dedupKey: key,
                createdAt: new Date().toISOString(),
                createdBy: req.user.uid,
                createdByName: req.user.name || req.user.email || ''
            });
        });

        const chunks = [];
        for (let i = 0; i < paraGravar.length; i += 400) chunks.push(paraGravar.slice(i, i + 400));
        for (const chunk of chunks) {
            const batch = db.batch();
            chunk.forEach(dados => batch.set(db.collection(COL_REGISTROS).doc(), dados));
            await batch.commit();
        }

        res.status(201).json({
            message: 'Importação concluída!',
            added: paraGravar.length,
            enviados: records.length,
            duplicados: records.length - paraGravar.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
