const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

// Middleware para verificar permissão do módulo 'ferida' (Gestão Saúde)
// ⚠️ Dado de saúde de paciente = dado pessoal sensível (LGPD).
// Todo acesso passa por token + RBAC e todo registro guarda autoria/data.
const checkPermission = verifyToken.requireModulePermission('ferida');

const COL_PACIENTES = 'ferida_pacientes';

// ==========================================
// PACIENTES
// ==========================================

// Remove acentos e caixa para comparar nomes (ex.: "joão" casa com "Joao").
const DIACRITICOS = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
const normalizar = s => String(s || '').normalize('NFD').replace(DIACRITICOS, '').toLowerCase();

// Monta um texto de busca com nome + município + nascimento (ISO e dd/mm/aaaa),
// pra quem esqueceu o nome do paciente conseguir achar pela cidade ou pela data.
const textoBusca = p => {
    const iso = p.dataNascimento || '';
    const br = iso.includes('-') ? iso.split('-').reverse().join('/') : '';
    return normalizar([p.nome, p.municipio, iso, br].filter(Boolean).join(' '));
};

// GET /api/ferida/pacientes - Listar pacientes do ambulatório
// ?busca=<termo> filtra no servidor por nome, município ou data de nascimento
// (sem acento/caixa) — a base do ambulatório é pequena, então lê tudo e filtra em memória.
router.get('/pacientes', verifyToken, checkPermission, async (req, res) => {
    try {
        const snap = await db.collection(COL_PACIENTES).orderBy('nome').get();
        let pacientes = [];
        snap.forEach(doc => pacientes.push({ id: doc.id, ...doc.data() }));

        const busca = normalizar(req.query.busca);
        if (busca) {
            pacientes = pacientes.filter(p => textoBusca(p).includes(busca));
        }

        res.json(pacientes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ferida/pacientes/:id - Buscar um paciente específico (abrir a ficha direto por link)
router.get('/pacientes/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const doc = await db.collection(COL_PACIENTES).doc(req.params.id).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Paciente não encontrado.' });
        }
        res.json({ id: doc.id, ...doc.data() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ferida/pacientes - Cadastrar novo paciente
router.post('/pacientes', verifyToken, checkPermission, async (req, res) => {
    try {
        const { nome, dataNascimento, municipio } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({ error: 'O nome do paciente é obrigatório.' });
        }

        const newDoc = db.collection(COL_PACIENTES).doc();
        await newDoc.set({
            nome: nome.trim(),
            dataNascimento: dataNascimento || null,
            municipio: (municipio || '').trim(),
            createdAt: new Date().toISOString(),
            createdBy: req.user.uid,
            createdByName: req.user.name || req.user.email || ''
        });
        res.status(201).json({ message: 'Paciente cadastrado com sucesso!', id: newDoc.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/ferida/pacientes/:id - Atualizar dados cadastrais do paciente
router.put('/pacientes/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const { nome, dataNascimento, municipio } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({ error: 'O nome do paciente é obrigatório.' });
        }

        await db.collection(COL_PACIENTES).doc(req.params.id).update({
            nome: nome.trim(),
            dataNascimento: dataNascimento || null,
            municipio: (municipio || '').trim(),
            updatedAt: new Date().toISOString(),
            updatedBy: req.user.uid
        });
        res.json({ message: 'Paciente atualizado com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/ferida/pacientes/:id - Excluir paciente DEFINITIVAMENTE
// ⚠️ Apaga também os atendimentos e as fichas antigas (subcoleções não
// são removidas automaticamente pelo Firestore). Irreversível — LGPD:
// atende ao direito de eliminação do titular.
router.delete('/pacientes/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const ref = db.collection(COL_PACIENTES).doc(req.params.id);
        const doc = await ref.get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Paciente não encontrado.' });
        }

        for (const sub of ['atendimentos', 'fichas_antigas']) {
            const snap = await ref.collection(sub).get();
            const docs = [...snap.docs];
            while (docs.length) {
                const batch = db.batch();
                docs.splice(0, 400).forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
        }
        await ref.delete();

        console.log(`[ferida] Paciente ${req.params.id} excluído por ${req.user.uid} (${req.user.email || ''})`);
        res.json({ message: 'Paciente excluído definitivamente, com todo o histórico.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ATENDIMENTOS (avaliações da ferida)
// ==========================================

// GET /api/ferida/pacientes/:id/atendimentos - Histórico do paciente (mais antigo primeiro)
router.get('/pacientes/:id/atendimentos', verifyToken, checkPermission, async (req, res) => {
    try {
        const snap = await db.collection(COL_PACIENTES).doc(req.params.id)
            .collection('atendimentos')
            .orderBy('createdAt', 'asc')
            .get();
        const atendimentos = [];
        snap.forEach(doc => atendimentos.push({ id: doc.id, ...doc.data() }));
        res.json(atendimentos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ferida/pacientes/:id/atendimentos - Registrar avaliação da ferida
router.post('/pacientes/:id/atendimentos', verifyToken, checkPermission, async (req, res) => {
    try {
        const pacienteRef = db.collection(COL_PACIENTES).doc(req.params.id);
        const pacienteDoc = await pacienteRef.get();
        if (!pacienteDoc.exists) {
            return res.status(404).json({ error: 'Paciente não encontrado.' });
        }

        const {
            dimensoes,            // { comprimento, largura, profundidade, descolamento } em cm
            marcacoes,            // [{ numero, regiao, x, y, rotulo }]
            tecido,               // ["Granulação", ...]
            bordas,               // ["Maceração", ...]
            peleAdjacente,        // ["Íntegra", "Ressecada", ...]
            exsudato,             // { tipo, cor, consistencia, quantidade }
            infeccaoSuperficial,  // ["Odor", ...]
            infeccaoProfunda,     // ["Edema", ...]
            biofilme,             // true | false | null
            dor,                  // { presente: true|false|null, escala: 1..10|null }
            conduta,              // texto livre
            dataAtendimento       // YYYY-MM-DD opcional: data original (ficha de papel importada)
        } = req.body;

        const temConteudo =
            (Array.isArray(marcacoes) && marcacoes.length) ||
            (dimensoes && Object.values(dimensoes).some(v => v !== null && v !== undefined)) ||
            (Array.isArray(tecido) && tecido.length) ||
            (Array.isArray(bordas) && bordas.length) ||
            (Array.isArray(peleAdjacente) && peleAdjacente.length) ||
            (exsudato && Object.values(exsudato).some(Boolean)) ||
            (Array.isArray(infeccaoSuperficial) && infeccaoSuperficial.length) ||
            (Array.isArray(infeccaoProfunda) && infeccaoProfunda.length) ||
            biofilme !== null && biofilme !== undefined ||
            (dor && (typeof dor.presente === 'boolean' || dor.escala)) ||
            (conduta && conduta.trim());

        if (!temConteudo) {
            return res.status(400).json({ error: 'O atendimento está vazio. Preencha a avaliação antes de salvar.' });
        }

        const num = v => {
            if (v === null || v === undefined || v === '') return null;
            const n = parseFloat(String(v).replace(',', '.'));
            return isNaN(n) ? null : n;
        };

        const newDoc = pacienteRef.collection('atendimentos').doc();
        await newDoc.set({
            dimensoes: {
                comprimento:  num(dimensoes?.comprimento),
                largura:      num(dimensoes?.largura),
                profundidade: num(dimensoes?.profundidade),
                descolamento: num(dimensoes?.descolamento)
            },
            marcacoes: Array.isArray(marcacoes) ? marcacoes.map(m => ({
                numero: parseInt(m.numero) || 0,
                regiao: String(m.regiao || ''),
                x: num(m.x),
                y: num(m.y),
                rotulo: String(m.rotulo || '').trim()
            })) : [],
            tecido:              Array.isArray(tecido) ? tecido : [],
            bordas:              Array.isArray(bordas) ? bordas : [],
            peleAdjacente:       Array.isArray(peleAdjacente) ? peleAdjacente : [],
            exsudato: {
                tipo:         exsudato?.tipo         || null,
                cor:          exsudato?.cor          || null,
                consistencia: exsudato?.consistencia || null,
                quantidade:   exsudato?.quantidade   || null
            },
            infeccaoSuperficial: Array.isArray(infeccaoSuperficial) ? infeccaoSuperficial : [],
            infeccaoProfunda:    Array.isArray(infeccaoProfunda) ? infeccaoProfunda : [],
            biofilme:            typeof biofilme === 'boolean' ? biofilme : null,
            dor: {
                presente: typeof dor?.presente === 'boolean' ? dor.presente : null,
                escala: (Number.isInteger(dor?.escala) && dor.escala >= 1 && dor.escala <= 10) ? dor.escala : null
            },
            conduta:             (conduta || '').trim(),
            dataAtendimento:     (typeof dataAtendimento === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dataAtendimento)) ? dataAtendimento : null,
            // Autoria obrigatória (LGPD): quem registrou, quando
            createdAt:     new Date().toISOString(),
            createdBy:     req.user.uid,
            createdByName: req.user.name || req.user.email || ''
        });

        res.status(201).json({ message: 'Atendimento registrado com sucesso!', id: newDoc.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ==========================================
// LEITURA DA FICHA PREENCHIDA (OCR local em Python)
// ==========================================
// Proxy para o serviço leitor-ficha (Flask + EasyOCR) que roda
// localmente — as imagens do paciente não saem da infraestrutura.
// Princípio LGPD do projeto: "leitura prepara, humano confirma".
// Ver /leitor-ficha/README.md para instalar e rodar o serviço.

const LEITOR_URL = process.env.LEITOR_FICHA_URL || 'http://127.0.0.1:5001';

// POST /api/ferida/ler-ficha - Lê a ficha de papel (frente/verso) via OCR
router.post('/ler-ficha', verifyToken, checkPermission, async (req, res) => {
    try {
        const { imagens } = req.body;
        if (!Array.isArray(imagens) || imagens.length < 1 || imagens.length > 2) {
            return res.status(400).json({ error: 'Envie 1 ou 2 imagens (frente e verso da ficha).' });
        }
        for (const img of imagens) {
            if (typeof img !== 'string' || !img.startsWith('data:image/') || img.length > MAX_IMG_BASE64 * 2) {
                return res.status(400).json({ error: 'Imagem inválida ou muito grande.' });
            }
        }

        let resposta;
        try {
            resposta = await fetch(`${LEITOR_URL}/ler-ficha`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imagens }),
                signal: AbortSignal.timeout(120000)
            });
        } catch (err) {
            return res.status(503).json({
                error: 'Serviço de leitura indisponível. Inicie o leitor-ficha (Python) — veja /leitor-ficha/README.md.'
            });
        }

        const corpo = await resposta.json().catch(() => ({}));
        if (!resposta.ok) {
            return res.status(resposta.status === 400 ? 400 : 422)
                .json({ error: corpo.error || 'Falha na leitura da ficha.' });
        }
        res.json(corpo);
    } catch (err) {
        res.status(500).json({ error: 'Falha na leitura: ' + err.message });
    }
});

// ==========================================
// FICHAS ANTIGAS (digitalização da ficha de papel)
// ==========================================

// Limite seguro: documento do Firestore aceita no máx. 1 MiB.
// A imagem chega como data URL base64 comprimida no navegador.
const MAX_IMG_BASE64 = 980000;

// GET /api/ferida/pacientes/:id/fichas-antigas - Listar (só metadados; a imagem é pesada)
router.get('/pacientes/:id/fichas-antigas', verifyToken, checkPermission, async (req, res) => {
    try {
        const snap = await db.collection(COL_PACIENTES).doc(req.params.id)
            .collection('fichas_antigas')
            .orderBy('createdAt', 'asc')
            .select('nome', 'mimeType', 'tamanho', 'createdAt', 'createdBy', 'createdByName')
            .get();
        const fichas = [];
        snap.forEach(doc => fichas.push({ id: doc.id, ...doc.data() }));
        res.json(fichas);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ferida/pacientes/:id/fichas-antigas/:fichaId - Buscar a imagem completa
router.get('/pacientes/:id/fichas-antigas/:fichaId', verifyToken, checkPermission, async (req, res) => {
    try {
        const doc = await db.collection(COL_PACIENTES).doc(req.params.id)
            .collection('fichas_antigas').doc(req.params.fichaId).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Ficha antiga não encontrada.' });
        }
        res.json({ id: doc.id, ...doc.data() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ferida/pacientes/:id/fichas-antigas - Anexar imagem da ficha de papel
router.post('/pacientes/:id/fichas-antigas', verifyToken, checkPermission, async (req, res) => {
    try {
        const pacienteRef = db.collection(COL_PACIENTES).doc(req.params.id);
        const pacienteDoc = await pacienteRef.get();
        if (!pacienteDoc.exists) {
            return res.status(404).json({ error: 'Paciente não encontrado.' });
        }

        const { imagem, nome } = req.body;
        if (!imagem || typeof imagem !== 'string' || !imagem.startsWith('data:image/')) {
            return res.status(400).json({ error: 'Envie uma imagem válida.' });
        }
        if (imagem.length > MAX_IMG_BASE64) {
            return res.status(400).json({ error: 'Imagem muito grande mesmo após compressão. Tente uma foto com resolução menor.' });
        }

        const mimeType = imagem.substring(5, imagem.indexOf(';'));
        const newDoc = pacienteRef.collection('fichas_antigas').doc();
        await newDoc.set({
            nome: String(nome || 'ficha-antiga').trim(),
            imagem,
            mimeType,
            tamanho: imagem.length,
            // Autoria obrigatória (LGPD)
            createdAt: new Date().toISOString(),
            createdBy: req.user.uid,
            createdByName: req.user.name || req.user.email || ''
        });
        res.status(201).json({ message: 'Ficha antiga anexada com sucesso!', id: newDoc.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/ferida/pacientes/:id/fichas-antigas/:fichaId - Remover anexo equivocado
router.delete('/pacientes/:id/fichas-antigas/:fichaId', verifyToken, checkPermission, async (req, res) => {
    try {
        await db.collection(COL_PACIENTES).doc(req.params.id)
            .collection('fichas_antigas').doc(req.params.fichaId).delete();
        res.json({ message: 'Ficha antiga removida com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/ferida/pacientes/:id/atendimentos/:atendimentoId - Remover registro equivocado
router.delete('/pacientes/:id/atendimentos/:atendimentoId', verifyToken, checkPermission, async (req, res) => {
    try {
        await db.collection(COL_PACIENTES).doc(req.params.id)
            .collection('atendimentos').doc(req.params.atendimentoId).delete();
        res.json({ message: 'Atendimento removido com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
