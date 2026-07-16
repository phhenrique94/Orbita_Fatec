const express = require('express');
const router = express.Router();
const { admin, db } = require('../firebase');
const verifyToken = require('../middlewares/auth');

const ALLOWED_COLS = ['funcionarios_rh', 'eventos_rh', 'registros_carga_horaria', 'setores_rh'];

const FieldValue = admin.firestore.FieldValue;
// Limite de operações por batch do Firestore é 500; margem de segurança.
const BATCH_LIMIT = 450;

// ==========================================================
// ROTAS DE NEGÓCIO (/custom/...) — registradas ANTES das
// rotas genéricas /:colName para não colidir com o wildcard.
// ==========================================================

// Lançamento manual de horas (crédito ou débito). Saldo pode ficar negativo.
router.post('/custom/lancamentos', verifyToken, verifyToken.requireModulePermission('carga-horaria'), async (req, res) => {
    try {
        const { funcionarioId, horas, descricao } = req.body;

        if (!funcionarioId || typeof funcionarioId !== 'string') {
            return res.status(400).json({ error: 'funcionarioId é obrigatório.' });
        }
        const horasNum = Number(horas);
        if (!Number.isFinite(horasNum) || horasNum === 0 || Math.abs(horasNum) > 24) {
            return res.status(400).json({ error: 'horas deve ser um número diferente de zero entre -24 e 24.' });
        }
        if (!descricao || typeof descricao !== 'string' || !descricao.trim()) {
            return res.status(400).json({ error: 'descricao é obrigatória.' });
        }

        const funcRef = db.collection('funcionarios_rh').doc(funcionarioId);
        const funcSnap = await funcRef.get();
        if (!funcSnap.exists) return res.status(404).json({ error: 'Funcionário não encontrado.' });
        const func = funcSnap.data();

        const horasArred = Math.round(horasNum * 100) / 100;
        const registro = {
            funcionarioId,
            funcionarioNome: func.nome || '',
            tipo: horasArred >= 0 ? 'manual' : 'debito',
            descricao: descricao.trim(),
            entrada: null,
            saida: null,
            turnoId: 'default',
            turnoHoras: 0,
            horasExtras: horasArred,
            lancadoPor: req.user.uid,
            lancadoEm: new Date().toISOString()
        };

        const batch = db.batch();
        const regRef = db.collection('registros_carga_horaria').doc();
        batch.set(regRef, registro);
        batch.update(funcRef, { totalHorasExtras: FieldValue.increment(horasArred) });
        await batch.commit();

        const novoSaldo = Math.round(((func.totalHorasExtras || 0) + horasArred) * 100) / 100;
        res.status(201).json({ id: regRef.id, ...registro, novoSaldo });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Lançamento unificado: RH escolhe adicionar/retirar e informa
// OU horário (entrada/saída) OU turnos marcados — nunca os dois.
// - Turnos marcados: atalho de turno inteiro — vale a carga completa de
//   cada turno cadastrado do funcionário (trabalhou/folgou o turno todo).
// - Entrada E saída: o período inteiro informado conta como hora.
// - Só saída: diferença contra a saída padrão do fim do expediente
//   (ex: saída 17:30 com expediente até 17:00 = 30min).
// - Só entrada: diferença contra a entrada padrão do início do expediente.
router.post('/custom/pontos', verifyToken, verifyToken.requireModulePermission('carga-horaria'), async (req, res) => {
    try {
        const { funcionarioId, data, operacao, turnos, entrada, saida, descricao } = req.body;

        if (!funcionarioId || typeof funcionarioId !== 'string') {
            return res.status(400).json({ error: 'funcionarioId é obrigatório.' });
        }
        if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
            return res.status(400).json({ error: 'data deve estar no formato YYYY-MM-DD.' });
        }
        if (!['adicionar', 'retirar'].includes(operacao)) {
            return res.status(400).json({ error: "operacao deve ser 'adicionar' ou 'retirar'." });
        }
        if (!descricao || typeof descricao !== 'string' || !descricao.trim()) {
            return res.status(400).json({ error: 'O motivo é obrigatório.' });
        }
        const HORA_RE = /^\d{2}:\d{2}$/;
        if ((entrada && !HORA_RE.test(entrada)) || (saida && !HORA_RE.test(saida))) {
            return res.status(400).json({ error: 'entrada e saida devem estar no formato HH:MM.' });
        }
        const temHorario = !!(entrada || saida);
        const temTurnos = Array.isArray(turnos) && turnos.length > 0;
        if (!temHorario && !temTurnos) {
            return res.status(400).json({ error: 'Informe um horário OU marque pelo menos um turno.' });
        }
        if (temHorario && temTurnos) {
            return res.status(400).json({ error: 'Informe horário OU turnos, não os dois ao mesmo tempo.' });
        }

        const funcRef = db.collection('funcionarios_rh').doc(funcionarioId);
        const funcSnap = await funcRef.get();
        if (!funcSnap.exists) return res.status(404).json({ error: 'Funcionário não encontrado.' });
        const func = funcSnap.data();

        const diffHoras = (ini, fim) => {
            const [ih, im] = ini.split(':').map(Number);
            const [fh, fm] = fim.split(':').map(Number);
            let diff = (fh * 60 + fm) - (ih * 60 + im);
            if (diff <= 0) diff += 24 * 60;
            return Math.round(diff / 60 * 100) / 100;
        };
        // Diferença simples entre dois horários (sem virada de dia) — usada
        // para comparar horário informado vs padrão (atraso/saída tardia).
        const diffSimplesHoras = (a, b) => {
            const [ah, am] = a.split(':').map(Number);
            const [bh, bm] = b.split(':').map(Number);
            return Math.round(Math.abs((bh * 60 + bm) - (ah * 60 + am)) / 60 * 100) / 100;
        };

        const ORDEM_TURNOS = ['manha', 'tarde', 'noite'];
        const turnosCadastrados = (Array.isArray(func.turnos) ? func.turnos : [])
            .filter(t => ORDEM_TURNOS.includes(t.id))
            .sort((a, b) => ORDEM_TURNOS.indexOf(a.id) - ORDEM_TURNOS.indexOf(b.id));

        const sinal = operacao === 'retirar' ? -1 : 1;
        let totalHoras = 0;
        const partes = [];

        if (temTurnos) {
            // Atalho de turno inteiro. Turno cadastrado vale a carga do
            // funcionário; turno não cadastrado (ex: veio numa capacitação
            // fora do expediente) vale o bloco padrão de 4h.
            const HORAS_PADRAO_TURNO = 4;
            const TURNOS_VALIDOS = [...ORDEM_TURNOS, 'default'];
            for (const turnoId of turnos) {
                if (!TURNOS_VALIDOS.includes(turnoId)) {
                    return res.status(400).json({ error: `Turno inválido: "${turnoId}".` });
                }
                let horasParte;
                let detalhe;
                if (turnoId === 'default') {
                    horasParte = Number(func.horasTurno) || 0;
                    detalhe = `${turnoId} completo (${horasParte}h)`;
                } else {
                    const turno = turnosCadastrados.find(t => t.id === turnoId);
                    if (turno) {
                        horasParte = Number(turno.horas) || 0;
                        detalhe = `${turnoId} completo (${horasParte}h)`;
                    } else {
                        horasParte = HORAS_PADRAO_TURNO;
                        detalhe = `${turnoId} avulso (${horasParte}h padrão)`;
                    }
                }
                totalHoras += horasParte;
                partes.push(detalhe);
            }
        } else if (entrada && saida) {
            // Entrada e saída informadas: se o período bate com um turno
            // cadastrado (há sobreposição de horário), compara com a jornada
            // dele (ex: 07:50–12:40 num turno 08:00–12:30 = 20min de extra).
            // Se não bate com turno nenhum (ex: capacitação à tarde de quem
            // trabalha manhã/noite), o período inteiro conta como hora.
            const toMin = (h) => { const [x, y] = h.split(':').map(Number); return x * 60 + y; };
            const iniMin = toMin(entrada);
            const fimMin = toMin(saida);

            let melhorTurno = null;
            let melhorOverlap = 0;
            for (const t of turnosCadastrados) {
                if (!t.entrada || !t.saida) continue;
                const tIni = toMin(t.entrada);
                const tFim = toMin(t.saida);
                const overlap = Math.min(fimMin, tFim) - Math.max(iniMin, tIni);
                if (overlap > melhorOverlap) { melhorOverlap = overlap; melhorTurno = t; }
            }

            const trabalhado = diffHoras(entrada, saida);
            if (melhorTurno) {
                const jornada = Number(melhorTurno.horas) || 0;
                totalHoras = Math.round(Math.abs(trabalhado - jornada) * 100) / 100;
                partes.push(`${entrada}–${saida} vs turno ${melhorTurno.id} ${melhorTurno.entrada}–${melhorTurno.saida} (trabalhado ${trabalhado}h, jornada ${jornada}h, diferença ${totalHoras}h)`);
            } else {
                totalHoras = trabalhado;
                partes.push(`período avulso ${entrada}–${saida} (${totalHoras}h)`);
            }
        } else if (saida) {
            // Só saída: compara com a saída padrão do turno MAIS PRÓXIMO do
            // horário informado (ex: saiu 12:40, turno manhã até 12:30 = 10min;
            // não faz sentido comparar com a saída do turno da noite).
            const candidatos = turnosCadastrados.filter(t => t.saida);
            if (!candidatos.length) {
                return res.status(400).json({ error: 'Funcionário sem horário padrão cadastrado — informe entrada E saída.' });
            }
            const turnoRef = candidatos.reduce((melhor, t) =>
                diffSimplesHoras(t.saida, saida) < diffSimplesHoras(melhor.saida, saida) ? t : melhor);
            totalHoras = diffSimplesHoras(turnoRef.saida, saida);
            partes.push(`saída ${saida} vs padrão ${turnoRef.saida} (${turnoRef.id}) (${totalHoras}h)`);
        } else {
            // Só entrada: compara com a entrada padrão do turno MAIS PRÓXIMO
            const candidatos = turnosCadastrados.filter(t => t.entrada);
            if (!candidatos.length) {
                return res.status(400).json({ error: 'Funcionário sem horário padrão cadastrado — informe entrada E saída.' });
            }
            const turnoRef = candidatos.reduce((melhor, t) =>
                diffSimplesHoras(t.entrada, entrada) < diffSimplesHoras(melhor.entrada, entrada) ? t : melhor);
            totalHoras = diffSimplesHoras(turnoRef.entrada, entrada);
            partes.push(`entrada ${entrada} vs padrão ${turnoRef.entrada} (${turnoRef.id}) (${totalHoras}h)`);
        }

        totalHoras = Math.round(totalHoras * 100) / 100;
        if (totalHoras === 0) {
            return res.status(400).json({ error: 'O cálculo resultou em 0h — nada a lançar.' });
        }

        const delta = sinal * totalHoras;
        const registro = {
            funcionarioId,
            funcionarioNome: func.nome || '',
            tipo: 'ponto',
            dataEvento: data,
            descricao: descricao.trim(),
            detalheCalculo: partes.join(' + '),
            entrada: entrada ? `${data}T${entrada}:00` : null,
            saida: saida ? `${data}T${saida}:00` : null,
            turnoId: temTurnos ? turnos.join(',') : 'horario',
            turnoHoras: totalHoras,
            horasExtras: delta,
            lancadoPor: req.user.uid,
            lancadoEm: new Date().toISOString()
        };

        const batch = db.batch();
        const regRef = db.collection('registros_carga_horaria').doc();
        batch.set(regRef, registro);
        batch.update(funcRef, { totalHorasExtras: FieldValue.increment(delta) });
        await batch.commit();

        const novoSaldo = Math.round(((Number(func.totalHorasExtras) || 0) + delta) * 100) / 100;
        res.status(201).json({ id: regRef.id, ...registro, novoSaldo });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Excluir um lançamento individual, estornando o efeito no saldo.
// Registros de recesso não podem ser excluídos aqui (exclua o recesso).
router.delete('/custom/registros/:id', verifyToken, verifyToken.requireModulePermission('carga-horaria'), async (req, res) => {
    try {
        const regRef = db.collection('registros_carga_horaria').doc(req.params.id);
        const regSnap = await regRef.get();
        if (!regSnap.exists) return res.status(404).json({ error: 'Lançamento não encontrado.' });
        const reg = regSnap.data();

        if (reg.tipo === 'recesso') {
            return res.status(400).json({ error: 'Lançamentos de recesso são revertidos excluindo o recesso na tela de Recessos & Feriados.' });
        }

        const horas = Number(reg.horasExtras) || 0;
        const batch = db.batch();
        batch.delete(regRef);
        if (horas !== 0 && reg.funcionarioId) {
            const funcRef = db.collection('funcionarios_rh').doc(reg.funcionarioId);
            const funcSnap = await funcRef.get();
            if (funcSnap.exists) {
                batch.update(funcRef, { totalHorasExtras: FieldValue.increment(-horas) });
            }
        }
        await batch.commit();

        res.json({ message: 'Lançamento excluído e saldo estornado.', horasEstornadas: -horas });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Criar recesso/feriado: debita de todos os funcionários ativos as horas
// que cada um trabalharia naquele dia (campo horasTurno).
router.post('/custom/recessos', verifyToken, verifyToken.requireModulePermission('carga-horaria'), async (req, res) => {
    try {
        const { nome, data, descricao, funcionarioIds } = req.body;

        if (!nome || typeof nome !== 'string' || !nome.trim()) {
            return res.status(400).json({ error: 'nome é obrigatório.' });
        }
        if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
            return res.status(400).json({ error: 'data deve estar no formato YYYY-MM-DD.' });
        }
        if (funcionarioIds !== undefined && (!Array.isArray(funcionarioIds) || !funcionarioIds.length)) {
            return res.status(400).json({ error: 'Selecione pelo menos um funcionário.' });
        }

        const funcSnap = await db.collection('funcionarios_rh').get();
        const ativos = [];
        funcSnap.forEach(doc => {
            const f = doc.data();
            if (f.ativo === false) return;
            // Se veio lista de participantes, só entra quem foi selecionado
            if (Array.isArray(funcionarioIds) && !funcionarioIds.includes(doc.id)) return;
            const horasDia = Math.round((Number(f.horasTurno) || 0) * 100) / 100;
            if (horasDia <= 0) return;
            ativos.push({ id: doc.id, nome: f.nome || '', horasDia });
        });

        if (!ativos.length) {
            return res.status(400).json({ error: 'Nenhum funcionário válido para o recesso (verifique se os selecionados estão ativos e têm turno cadastrado).' });
        }

        const recessoRef = db.collection('recessos_rh').doc();
        const recesso = {
            nome: nome.trim(),
            data,
            descricao: (descricao || '').trim(),
            totalFuncionarios: ativos.length,
            criadoPor: req.user.uid,
            criadoEm: new Date().toISOString()
        };

        // Cada funcionário gera 2 operações (registro + update de saldo).
        let batch = db.batch();
        batch.set(recessoRef, recesso);
        let ops = 1;
        const commits = [];

        for (const f of ativos) {
            if (ops + 2 > BATCH_LIMIT) {
                commits.push(batch.commit());
                batch = db.batch();
                ops = 0;
            }
            const regRef = db.collection('registros_carga_horaria').doc();
            batch.set(regRef, {
                funcionarioId: f.id,
                funcionarioNome: f.nome,
                tipo: 'recesso',
                recessoId: recessoRef.id,
                dataEvento: data,
                descricao: `Recesso: ${recesso.nome}`,
                entrada: null,
                saida: null,
                turnoId: 'default',
                turnoHoras: f.horasDia,
                horasExtras: -f.horasDia,
                lancadoPor: req.user.uid,
                lancadoEm: new Date().toISOString()
            });
            batch.update(db.collection('funcionarios_rh').doc(f.id), {
                totalHorasExtras: FieldValue.increment(-f.horasDia)
            });
            ops += 2;
        }
        commits.push(batch.commit());
        await Promise.all(commits);

        res.status(201).json({ id: recessoRef.id, ...recesso });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Listar recessos
router.get('/custom/recessos', verifyToken, verifyToken.requireModulePermission('carga-horaria'), async (req, res) => {
    try {
        const snap = await db.collection('recessos_rh').orderBy('data', 'desc').get();
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Excluir recesso: reverte os débitos aplicados a todos os funcionários.
router.delete('/custom/recessos/:id', verifyToken, verifyToken.requireModulePermission('carga-horaria'), async (req, res) => {
    try {
        const { id } = req.params;
        const recessoRef = db.collection('recessos_rh').doc(id);
        const recessoSnap = await recessoRef.get();
        if (!recessoSnap.exists) return res.status(404).json({ error: 'Recesso não encontrado.' });

        const regsSnap = await db.collection('registros_carga_horaria').where('recessoId', '==', id).get();

        let batch = db.batch();
        let ops = 0;
        const commits = [];

        regsSnap.forEach(doc => {
            if (ops + 2 > BATCH_LIMIT) {
                commits.push(batch.commit());
                batch = db.batch();
                ops = 0;
            }
            const reg = doc.data();
            const horasDebitadas = Number(reg.horasExtras) || 0; // negativo
            batch.update(db.collection('funcionarios_rh').doc(reg.funcionarioId), {
                totalHorasExtras: FieldValue.increment(-horasDebitadas)
            });
            batch.delete(doc.ref);
            ops += 2;
        });

        if (ops + 1 > BATCH_LIMIT) {
            commits.push(batch.commit());
            batch = db.batch();
        }
        batch.delete(recessoRef);
        commits.push(batch.commit());
        await Promise.all(commits);

        res.json({ message: 'Recesso removido e débitos revertidos.', registrosRevertidos: regsSnap.size });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Extrato de um funcionário: registros ordenados + saldo atual.
router.get('/custom/extrato/:funcionarioId', verifyToken, verifyToken.requireModulePermission('carga-horaria'), async (req, res) => {
    try {
        const { funcionarioId } = req.params;
        const funcSnap = await db.collection('funcionarios_rh').doc(funcionarioId).get();
        if (!funcSnap.exists) return res.status(404).json({ error: 'Funcionário não encontrado.' });
        const func = funcSnap.data();

        const regsSnap = await db.collection('registros_carga_horaria')
            .where('funcionarioId', '==', funcionarioId)
            .orderBy('lancadoEm', 'desc')
            .get();
        const registros = [];
        regsSnap.forEach(doc => registros.push({ id: doc.id, ...doc.data() }));

        res.json({
            funcionario: { id: funcSnap.id, nome: func.nome || '', cargo: func.cargo || '', setor: func.setor || '', horasTurno: func.horasTurno || 0 },
            saldo: Math.round((Number(func.totalHorasExtras) || 0) * 100) / 100,
            registros
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================================
// ROTAS GENÉRICAS (CRUD por coleção) — usadas também pelo
// módulo Funcionários; manter intactas.
// ==========================================================

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
        } else if (colName === 'setores_rh') {
            q = q.orderBy('nome');
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
