const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

// GET /api/emprestimos - Retorna todos os notebooks
router.get('/', verifyToken, verifyToken.requireModulePermission('emprestimo'), async (req, res) => {
    try {
        const snapshot = await db.collection('notebooks').get();
        const notebooks = [];
        snapshot.forEach(doc => {
            notebooks.push({ id: doc.id, ...doc.data() });
        });
        
        // Retorna ordenado pelo ID
        notebooks.sort((a, b) => a.id.localeCompare(b.id));
        res.json(notebooks);
    } catch (error) {
        console.error('Erro ao buscar empréstimos:', error);
        res.status(500).json({ error: 'Erro ao buscar dados.' });
    }
});

// GET /api/emprestimos/:id - Retorna um notebook específico
router.get('/:id', verifyToken, verifyToken.requireModulePermission('emprestimo'), async (req, res) => {
    try {
        const docRef = await db.collection('notebooks').doc(req.params.id).get();
        if (!docRef.exists) {
            return res.status(404).json({ error: 'Equipamento não encontrado.' });
        }
        res.json({ id: docRef.id, ...docRef.data() });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar equipamento.' });
    }
});

// PUT /api/emprestimos/:id - Atualiza ou cria o registro
router.put('/:id', verifyToken, verifyToken.requireModulePermission('emprestimo'), async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;
        
        // Remove o ID do payload para não duplicar dados dentro do documento
        if (data.id) delete data.id;
        
        const docRef = db.collection('notebooks').doc(id);
        const docSnap = await docRef.get();
        let historico = [];
        
        if (docSnap.exists) {
            const oldData = docSnap.data();
            if (oldData.historico && Array.isArray(oldData.historico)) {
                historico = oldData.historico;
            }
            
            // Registra um evento no historico
            const evento = {
                status: data.status || oldData.status,
                updatedAt: data.updatedAt || new Date().toISOString(),
                responsavel: data.responsavel || oldData.responsavel || 'Desconhecido',
                observacao: data.observacao || '',
                local: data.local || oldData.local || '',
                sala: data.sala || oldData.sala || '',
                funcionario: data.funcionario || oldData.funcionario || '',
                setor: data.setor || oldData.setor || '',
                requerente: data.requerente || oldData.requerente || ''
            };
            
            historico.unshift(evento);
            historico = historico.slice(0, 4); // Manter as 4 ultimas
            data.historico = historico;
        } else {
            // Documento novo (cadastro)
            const evento = {
                status: data.status,
                updatedAt: data.updatedAt || new Date().toISOString(),
                responsavel: data.responsavel || 'Desconhecido',
                observacao: data.observacao || '',
                local: data.local || '',
                sala: data.sala || '',
                funcionario: data.funcionario || '',
                setor: data.setor || '',
                requerente: data.requerente || ''
            };
            historico.unshift(evento);
            data.historico = historico;
        }

        await docRef.set(data, { merge: true });
        res.json({ status: 'success', message: `Equipamento ${id} atualizado.` });
    } catch (error) {
        console.error('Erro ao atualizar empréstimo:', error);
        res.status(500).json({ error: 'Erro ao atualizar dados.' });
    }
});

// DELETE /api/emprestimos/:id - Exclui o item do banco de dados (para itens temporários)
router.delete('/:id', verifyToken, verifyToken.requireModulePermission('emprestimo'), async (req, res) => {
    try {
        const id = req.params.id;
        await db.collection('notebooks').doc(id).delete();
        res.json({ status: 'success', message: `Equipamento ${id} excluído com sucesso.` });
    } catch (error) {
        console.error('Erro ao excluir empréstimo:', error);
        res.status(500).json({ error: 'Erro ao excluir dados.' });
    }
});

module.exports = router;
