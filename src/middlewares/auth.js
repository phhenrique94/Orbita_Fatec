const { auth } = require('../firebase');

// Cache em memória para as permissões do banco para evitar custos de leitura repetitiva
let permissionsCache = {
    data: null,
    lastFetched: 0
};
const CACHE_TTL = 60 * 1000; // 1 minuto de TTL

// Nível de acesso normalizado com retrocompatibilidade:
// inteiro (1/2/3) ou formato legado { view, execute }
const getAccessLevel = (perm) => {
    if (perm === undefined || perm === null) return 1;
    if (typeof perm === 'object') {
        if (perm.execute) return 3;
        if (perm.view) return 2;
        return 1;
    }
    return parseInt(perm) || 1;
};

const verifyToken = async (req, res, next) => {
    const bearerHeader = req.headers['authorization'];

    if (!bearerHeader || !bearerHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
    }

    const idToken = bearerHeader.split('Bearer ')[1];

    try {
        const decodedToken = await auth.verifyIdToken(idToken);
        req.user = decodedToken; // Adiciona os dados básicos
        
        // 🚨 CAMADA DE SEGURANÇA EXTRA: Buscar o cargo real no Banco de Dados
        const { db } = require('../firebase');
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        req.user.role = userData.role || 'visitante';
        // Permissões específicas do usuário (override por módulo) — sempre
        // vencem as do cargo quando definidas
        req.user.permissoes = userData.permissoes || null;

        next();
    } catch (error) {
        console.error('Erro ao verificar o token:', error);
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
};

// Middleware para verificar permissões de módulos específicos
const requireModulePermission = (moduleName) => {
    return async (req, res, next) => {
        if (!req.user || !req.user.role) {
            return res.status(401).json({ error: 'Acesso negado. Informações do usuário não encontradas.' });
        }

        const role = req.user.role;

        // ADM N1 sempre possui acesso irrestrito
        if (role === 'adm_l1') {
            return next();
        }

        // GET requer nível >= 2 (visualização), outros métodos requerem nível >= 3 (execução)
        const requiredLevel = req.method === 'GET' ? 2 : 3;

        // Override específico do usuário vence o cargo (para ampliar ou restringir)
        if (req.user.permissoes && req.user.permissoes[moduleName] !== undefined) {
            const userLevel = getAccessLevel(req.user.permissoes[moduleName]);
            if (userLevel >= requiredLevel) {
                return next();
            }
            return res.status(403).json({
                error: `Acesso Negado. Você possui nível de acesso ${userLevel} (permissão individual) para o módulo ${moduleName}, mas o nível mínimo requerido é ${requiredLevel}.`
            });
        }

        // Tentar buscar as permissões do cache ou Firestore
        let perms = null;
        const now = Date.now();
        if (permissionsCache.data && (now - permissionsCache.lastFetched) < CACHE_TTL) {
            perms = permissionsCache.data;
        } else {
            try {
                const { db } = require('../firebase');
                const snap = await db.collection('config').doc('permissions').get();
                if (snap.exists) {
                    perms = snap.data();
                    permissionsCache.data = perms;
                    permissionsCache.lastFetched = now;
                }
            } catch (err) {
                console.error('Erro ao ler permissões dinâmicas do Firestore:', err);
            }
        }

        // Se encontrou as permissões no banco e estão configuradas para o cargo
        if (perms && perms[role] && perms[role][moduleName] !== undefined) {
            const userLevel = getAccessLevel(perms[role][moduleName]);
            if (userLevel >= requiredLevel) {
                return next();
            }
            return res.status(403).json({ 
                error: `Acesso Negado. Seu cargo (${role}) possui nível de acesso ${userLevel} para o módulo ${moduleName}, mas o nível mínimo requerido é ${requiredLevel}.` 
            });
        }

        // Fallback de segurança para permissões padrão
        const defaultPermissions = {
            adm_l2: {
                emprestimo: 3,
                usuarios: 3,
                ensalamento: 3,
                'carga-horaria': 3,
                turmas: 3,
                avaliacoes: 3
            },
            ti: {
                emprestimo: 3,
                usuarios: 1,
                ensalamento: 3,
                'carga-horaria': 1,
                turmas: 1,
                avaliacoes: 1
            },
            rh: {
                emprestimo: 1,
                usuarios: 1,
                ensalamento: 1,
                'carga-horaria': 3,
                turmas: 1,
                avaliacoes: 1
            },
            visitante: {
                emprestimo: 2,
                usuarios: 1,
                ensalamento: 2,
                'carga-horaria': 1,
                turmas: 1,
                avaliacoes: 1
            }
        };

        const roleDefault = defaultPermissions[role] || defaultPermissions['visitante'];
        const userLevel = getAccessLevel(roleDefault[moduleName]);

        if (userLevel >= requiredLevel) {
            return next();
        }

        return res.status(403).json({ error: `Acesso Negado. Seu cargo (${role}) não possui nível de acesso suficiente para acessar o módulo ${moduleName}.` });
    };
};

verifyToken.requireModulePermission = requireModulePermission;

module.exports = verifyToken;

