const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

// Middleware para verificar permissão do módulo (Gestão Saúde)
const checkPermission = verifyToken.requireModulePermission('almoxarifado-feridas');

const COL_ITENS = 'almoxarifado_feridas_itens';

// ==========================================
// ITENS (materiais de curativo)
// ==========================================

// GET /api/almoxarifado-feridas/itens - Listar materiais
router.get('/itens', verifyToken, checkPermission, async (req, res) => {
    try {
        const snap = await db.collection(COL_ITENS).orderBy('nome').get();
        const itens = [];
        snap.forEach(doc => itens.push({ id: doc.id, ...doc.data() }));
        res.json(itens);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/almoxarifado-feridas/itens - Cadastrar material
router.post('/itens', verifyToken, checkPermission, async (req, res) => {
    try {
        const { nome, unidade, estoqueMinimo, quantidadeInicial } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({ error: 'O nome do material é obrigatório.' });
        }
        if (!unidade || !unidade.trim()) {
            return res.status(400).json({ error: 'A unidade de medida é obrigatória (ex.: unidade, pacote, frasco).' });
        }

        const qtdInicial = Math.max(0, parseInt(quantidadeInicial) || 0);
        const newDoc = db.collection(COL_ITENS).doc();
        await newDoc.set({
            nome: nome.trim(),
            unidade: unidade.trim(),
            estoqueMinimo: Math.max(0, parseInt(estoqueMinimo) || 0),
            quantidadeAtual: qtdInicial,
            createdAt: new Date().toISOString(),
            createdBy: req.user.uid,
            createdByName: req.user.name || req.user.email || ''
        });

        // Registra a quantidade inicial como primeira movimentação (rastreabilidade)
        if (qtdInicial > 0) {
            await newDoc.collection('movimentacoes').add({
                tipo: 'entrada',
                quantidade: qtdInicial,
                motivo: 'Estoque inicial',
                createdAt: new Date().toISOString(),
                createdBy: req.user.uid,
                createdByName: req.user.name || req.user.email || ''
            });
        }

        res.status(201).json({ message: 'Material cadastrado com sucesso!', id: newDoc.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/almoxarifado-feridas/itens/:id - Editar dados do material (não altera quantidade)
router.put('/itens/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const { nome, unidade, estoqueMinimo } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({ error: 'O nome do material é obrigatório.' });
        }
        if (!unidade || !unidade.trim()) {
            return res.status(400).json({ error: 'A unidade de medida é obrigatória.' });
        }

        await db.collection(COL_ITENS).doc(req.params.id).update({
            nome: nome.trim(),
            unidade: unidade.trim(),
            estoqueMinimo: Math.max(0, parseInt(estoqueMinimo) || 0),
            updatedAt: new Date().toISOString(),
            updatedBy: req.user.uid
        });
        res.json({ message: 'Material atualizado com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/almoxarifado-feridas/itens/:id - Excluir material (definitivo, com movimentações)
router.delete('/itens/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const ref = db.collection(COL_ITENS).doc(req.params.id);
        const doc = await ref.get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Material não encontrado.' });
        }

        const snap = await ref.collection('movimentacoes').get();
        const docs = [...snap.docs];
        while (docs.length) {
            const batch = db.batch();
            docs.splice(0, 400).forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
        await ref.delete();

        res.json({ message: 'Material excluído com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// MOVIMENTAÇÕES (entrada / saída de estoque)
// ==========================================

// GET /api/almoxarifado-feridas/movimentacoes?inicio=YYYY-MM-DD&fim=YYYY-MM-DD
// Relatório de movimentações de TODOS os materiais num período — 1 única
// consulta collectionGroup (não 1 por material), com o nome do material já
// embutido em cada movimentação (ver denormalização acima).
router.get('/movimentacoes', verifyToken, checkPermission, async (req, res) => {
    try {
        const { inicio, fim } = req.query;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio || '') || !/^\d{4}-\d{2}-\d{2}$/.test(fim || '')) {
            return res.status(400).json({ error: 'Informe o período (inicio e fim, formato YYYY-MM-DD).' });
        }

        const snap = await db.collectionGroup('movimentacoes')
            .where('createdAt', '>=', `${inicio}T00:00:00.000Z`)
            .where('createdAt', '<=', `${fim}T23:59:59.999Z`)
            .orderBy('createdAt', 'desc')
            .get();

        const movimentacoes = [];
        snap.forEach(doc => movimentacoes.push({ id: doc.id, ...doc.data() }));
        res.json(movimentacoes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/almoxarifado-feridas/itens/:id/movimentacoes - Histórico (mais recente primeiro)
router.get('/itens/:id/movimentacoes', verifyToken, checkPermission, async (req, res) => {
    try {
        const snap = await db.collection(COL_ITENS).doc(req.params.id)
            .collection('movimentacoes')
            .orderBy('createdAt', 'desc')
            .get();
        const movimentacoes = [];
        snap.forEach(doc => movimentacoes.push({ id: doc.id, ...doc.data() }));
        res.json(movimentacoes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/almoxarifado-feridas/itens/:id/movimentacoes - Registrar entrada/saída
// Atualiza a quantidade atual em transação para evitar corrida entre usuárias simultâneas.
router.post('/itens/:id/movimentacoes', verifyToken, checkPermission, async (req, res) => {
    try {
        const { tipo, quantidade, motivo } = req.body;

        if (tipo !== 'entrada' && tipo !== 'saida') {
            return res.status(400).json({ error: 'Tipo de movimentação inválido. Use "entrada" ou "saida".' });
        }
        const qtd = parseInt(quantidade);
        if (!Number.isInteger(qtd) || qtd <= 0) {
            return res.status(400).json({ error: 'Informe uma quantidade válida (maior que zero).' });
        }
        if (!motivo || !motivo.trim()) {
            return res.status(400).json({ error: 'Informe o motivo da movimentação.' });
        }

        const ref = db.collection(COL_ITENS).doc(req.params.id);

        const novaQuantidade = await db.runTransaction(async (t) => {
            const doc = await t.get(ref);
            if (!doc.exists) {
                throw Object.assign(new Error('Material não encontrado.'), { status: 404 });
            }
            const atual = doc.data().quantidadeAtual || 0;
            const nova = tipo === 'entrada' ? atual + qtd : atual - qtd;
            if (nova < 0) {
                throw Object.assign(new Error(
                    `Estoque insuficiente: há ${atual} ${doc.data().unidade || 'unidade(s)'} disponível(is).`
                ), { status: 400 });
            }

            const movRef = ref.collection('movimentacoes').doc();
            t.set(movRef, {
                tipo,
                quantidade: qtd,
                motivo: motivo.trim(),
                // Nome/unidade do material denormalizados aqui (já estão em memória
                // pela leitura da transação acima) — evita 1 leitura por item depois,
                // no relatório de movimentações que junta várias movimentações.
                itemId: req.params.id,
                itemNome: doc.data().nome,
                itemUnidade: doc.data().unidade,
                // Autoria obrigatória (LGPD): quem registrou, quando
                createdAt: new Date().toISOString(),
                createdBy: req.user.uid,
                createdByName: req.user.name || req.user.email || ''
            });
            t.update(ref, { quantidadeAtual: nova });
            return nova;
        });

        res.status(201).json({ message: 'Movimentação registrada com sucesso!', quantidadeAtual: novaQuantidade });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

module.exports = router;
