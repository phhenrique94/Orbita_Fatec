const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

const checkPermission = verifyToken.requireModulePermission('agenda');

// GET /api/agenda - Publico: retorna todos os eventos aprovados e pendentes (para visualização no calendário)
router.get('/', async (req, res) => {
    try {
        const snap = await db.collection('agenda').get();
        const eventos = [];
        snap.forEach(doc => eventos.push({ id: doc.id, ...doc.data() }));
        res.json(eventos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/agenda - Publico: criar solicitação de agendamento
router.post('/', async (req, res) => {
    try {
        const { localId, data, horaInicio, horaFim, nomeSolicitante, curso, contato, nomeEvento, descricaoEvento, status } = req.body;
        
        if (!localId || !data || !horaInicio || !horaFim || !nomeSolicitante || !nomeEvento) {
            return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
        }

        // Validação de conflito: não permitir agendar se já existir um "Aprovado" no mesmo local/data/hora
        // Para simplificar, buscamos todos do local na mesma data e cruzamos os horários
        const snap = await db.collection('agenda')
                             .where('localId', '==', localId)
                             .where('data', '==', data)
                             .where('status', '==', 'Aprovado')
                             .get();
        
        let conflito = false;
        snap.forEach(doc => {
            const ev = doc.data();
            // Verifica interseção de horários simples
            if ((horaInicio >= ev.horaInicio && horaInicio < ev.horaFim) ||
                (horaFim > ev.horaInicio && horaFim <= ev.horaFim) ||
                (horaInicio <= ev.horaInicio && horaFim >= ev.horaFim)) {
                conflito = true;
            }
        });

        if (conflito) {
            return res.status(409).json({ error: 'Já existe um evento aprovado neste horário para este local.' });
        }

        const newDoc = db.collection('agenda').doc();
        await newDoc.set({
            localId,
            data,
            horaInicio,
            horaFim,
            nomeSolicitante,
            curso: curso || '',
            contato: contato || '',
            nomeEvento,
            descricaoEvento: descricaoEvento || '',
            status: status || 'Pendente',
            createdAt: new Date().toISOString()
        });

        res.status(201).json({ message: 'Solicitação de agendamento enviada com sucesso!', id: newDoc.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/agenda/:id/status - T.I. aprova ou rejeita (Privado)
router.put('/:id/status', verifyToken, checkPermission, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['Aprovado', 'Rejeitado', 'Pendente'].includes(status)) {
            return res.status(400).json({ error: 'Status inválido' });
        }
        
        const docRef = db.collection('agenda').doc(req.params.id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) return res.status(404).json({ error: 'Agendamento não encontrado' });

        await docRef.update({ 
            status, 
            updatedAt: new Date().toISOString(),
            updatedBy: req.user.uid
        });

        res.json({ message: `Agendamento ${status.toLowerCase()} com sucesso!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/agenda/:id - T.I. remove evento (Privado)
router.delete('/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        await db.collection('agenda').doc(req.params.id).delete();
        res.json({ message: 'Agendamento removido!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/agenda/:id - T.I. edita evento (Privado)
router.put('/:id', verifyToken, checkPermission, async (req, res) => {
    try {
        const { localId, data, horaInicio, horaFim, nomeSolicitante, curso, contato, nomeEvento, descricaoEvento } = req.body;
        const docRef = db.collection('agenda').doc(req.params.id);
        const docSnap = await docRef.get();
        if (!docSnap.exists) return res.status(404).json({ error: 'Agendamento não encontrado' });

        await docRef.update({
            localId, data, horaInicio, horaFim, nomeSolicitante, curso, contato, nomeEvento, descricaoEvento,
            updatedAt: new Date().toISOString(),
            updatedBy: req.user.uid
        });

        res.json({ message: 'Agendamento atualizado com sucesso!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
