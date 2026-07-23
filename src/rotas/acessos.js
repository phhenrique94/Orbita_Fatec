const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

// Middleware para verificar permissão do módulo 'acessos' (Gestão de T.I.)
// ⚠️ Este módulo guarda senhas de sistemas, e-mails e acessos do Órbita.
// É o cofre de credenciais do setor — trate com o máximo cuidado:
// - Senhas NUNCA ficam em texto puro no banco (AES-256-GCM).
// - Listar não devolve a senha, só metadados. Ver a senha é uma ação
//   separada, e cada revelação fica registrada (quem, quando, qual).
const checkPermission = verifyToken.requireModulePermission('acessos');

const COL_ACESSOS = 'acessos_credenciais';

// ==========================================
// CRIPTOGRAFIA (AES-256-GCM)
// ==========================================

function getChaveCifra() {
    const segredo = process.env.ACESSOS_ENCRYPTION_KEY;
    if (!segredo || segredo.trim().length < 16) {
        throw Object.assign(
            new Error('Cofre de acessos não configurado: defina ACESSOS_ENCRYPTION_KEY (uma string longa e aleatória) no .env do servidor.'),
            { status: 503 }
        );
    }
    // Deriva uma chave de 32 bytes a partir do segredo configurado (aceita
    // qualquer tamanho de string no .env, sempre gera chave AES-256 válida).
    return crypto.createHash('sha256').update(segredo).digest();
}

function cifrarSenha(senhaPlana) {
    const chave = getChaveCifra();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', chave, iv);
    const cifrado = Buffer.concat([cipher.update(senhaPlana, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        cifrado: cifrado.toString('base64')
    };
}

function decifrarSenha(campo) {
    const chave = getChaveCifra();
    const decipher = crypto.createDecipheriv('aes-256-gcm', chave, Buffer.from(campo.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(campo.authTag, 'base64'));
    const decifrado = Buffer.concat([
        decipher.update(Buffer.from(campo.cifrado, 'base64')),
        decipher.final()
    ]);
    return decifrado.toString('utf8');
}

// ==========================================
// LISTAR / CADASTRAR / EDITAR / EXCLUIR
// (a senha em si NUNCA é incluída na listagem)
// ==========================================

const CATEGORIAS_VALIDAS = ['Sistema', 'E-mail', 'Órbita', 'Servidor', 'Outro'];

// GET /api/acessos - Listar (só metadados, sem a senha)
router.get('/', verifyToken, checkPermission, async (req, res) => {
    try {
        const snap = await db.collection(COL_ACESSOS).orderBy('sistema').get();
        const lista = [];
        snap.forEach(doc => {
            const d = doc.data();
            const { senhaCifra, ...metadados } = d; // nunca devolver o campo cifrado
            lista.push({ id: doc.id, ...metadados });
        });
        res.json(lista);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/acessos - Cadastrar novo acesso
router.post('/', verifyToken, checkPermission, async (req, res) => {
    try {
        const { sistema, categoria, titular, usuario, senha, url, observacoes } = req.body;

        if (!sistema || !sistema.trim()) {
            return res.status(400).json({ error: 'O nome do sistema/serviço é obrigatório.' });
        }
        if (!senha || !senha.trim()) {
            return res.status(400).json({ error: 'A senha é obrigatória.' });
        }

        const newDoc = db.collection(COL_ACESSOS).doc();
        await newDoc.set({
            sistema: sistema.trim(),
            categoria: CATEGORIAS_VALIDAS.includes(categoria) ? categoria : 'Outro',
            titular: (titular || '').trim(),
            usuario: (usuario || '').trim(),
            senhaCifra: cifrarSenha(senha),
            url: (url || '').trim(),
            observacoes: (observacoes || '').trim(),
            // Autoria obrigatória (LGPD / auditoria de segurança)
            createdAt: new Date().toISOString(),
            createdBy: req.user.uid,
            createdByName: req.user.name || req.user.email || ''
        });
        res.status(201).json({ message: 'Acesso cadastrado com sucesso!', id: newDoc.id });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// PUT /api/acessos/:id - Editar (senha é opcional: só recifra se enviada)
router.put('/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const { sistema, categoria, titular, usuario, senha, url, observacoes } = req.body;

        if (!sistema || !sistema.trim()) {
            return res.status(400).json({ error: 'O nome do sistema/serviço é obrigatório.' });
        }

        const dados = {
            sistema: sistema.trim(),
            categoria: CATEGORIAS_VALIDAS.includes(categoria) ? categoria : 'Outro',
            titular: (titular || '').trim(),
            usuario: (usuario || '').trim(),
            url: (url || '').trim(),
            observacoes: (observacoes || '').trim(),
            updatedAt: new Date().toISOString(),
            updatedBy: req.user.uid
        };
        if (senha && senha.trim()) {
            dados.senhaCifra = cifrarSenha(senha);
        }

        await db.collection(COL_ACESSOS).doc(req.params.id).update(dados);
        res.json({ message: 'Acesso atualizado com sucesso!' });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// DELETE /api/acessos/:id - Excluir definitivamente
router.delete('/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        await db.collection(COL_ACESSOS).doc(req.params.id).delete();
        res.json({ message: 'Acesso excluído com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// REVELAR SENHA (ação auditada separadamente)
// ==========================================

// POST /api/acessos/:id/revelar - Decifra e devolve a senha, registrando quem viu
router.post('/:id/revelar', verifyToken, checkPermission, async (req, res) => {
    try {
        const ref = db.collection(COL_ACESSOS).doc(req.params.id);
        const doc = await ref.get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Acesso não encontrado.' });
        }
        const dados = doc.data();
        if (!dados.senhaCifra) {
            return res.status(422).json({ error: 'Este registro não tem senha armazenada.' });
        }

        const senha = decifrarSenha(dados.senhaCifra);

        // Auditoria: toda revelação de senha fica registrada (quem, quando, qual)
        await ref.collection('visualizacoes').add({
            viewedAt: new Date().toISOString(),
            viewedBy: req.user.uid,
            viewedByName: req.user.name || req.user.email || ''
        });

        res.json({ senha });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
});

// GET /api/acessos/:id/visualizacoes - Auditoria de quem já viu essa senha
router.get('/:id/visualizacoes', verifyToken, checkPermission, async (req, res) => {
    try {
        const snap = await db.collection(COL_ACESSOS).doc(req.params.id)
            .collection('visualizacoes')
            .orderBy('viewedAt', 'desc')
            .limit(50)
            .get();
        const lista = [];
        snap.forEach(doc => lista.push({ id: doc.id, ...doc.data() }));
        res.json(lista);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
