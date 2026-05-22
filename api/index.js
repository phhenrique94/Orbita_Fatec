const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middlewares globais
// Origens permitidas: apenas o painel web oficial e ambiente de desenvolvimento local.
const ALLOWED_ORIGINS = [
    'https://orbita-fatecivp.web.app',       // Firebase Hosting (produção)
    'https://orbita-fatecivp.firebaseapp.com', // Firebase Hosting (alternativo)
    'https://orbita-fatec-ti.vercel.app',     // Vercel (produção)
    'http://localhost:3000',                  // Desenvolvimento local (backend)
    'http://127.0.0.1:3000',                  // Desenvolvimento local (backend)
];

const corsOptions = {
    origin: (origin, callback) => {
        // Permite requisições sem origin (Postman, APK nativo, curl, etc.)
        // E permite qualquer porta no localhost/127.0.0.1 para desenvolvimento local
        const isLocalhost = origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        const isVercelSubdomain = origin && /^https:\/\/.*\.vercel\.app$/.test(origin);
        if (!origin || ALLOWED_ORIGINS.includes(origin) || isLocalhost || isVercelSubdomain) {
            callback(null, true);
        } else {
            callback(new Error(`CORS: Origem não autorizada — ${origin}`));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Responder a preflights OPTIONS explicitamente
app.options(/.*/, cors(corsOptions));

app.use(express.json());



// Rota de Teste para garantir que a API está no ar
app.get('/api', (req, res) => {
    res.json({ status: 'success', message: 'Órbita FATEC API está online!' });
});

// Importação das rotas
const rotasEmprestimo = require('./rotas/emprestimos');
const rotasUsuarios = require('./rotas/usuarios');
const rotasEnsalamento = require('./rotas/ensalamento');
const rotasMeuEspaco = require('./rotas/meu-espaco');
const rotasCargaHoraria = require('./rotas/carga-horaria');
const rotasEmpresas = require('./rotas/empresas');
const rotasValidacao = require('./rotas/validacao');

app.use('/api/emprestimos', rotasEmprestimo);
app.use('/api/usuarios', rotasUsuarios);
app.use('/api/ensalamento', rotasEnsalamento);
app.use('/api/meu-espaco', rotasMeuEspaco);
app.use('/api/carga-horaria', rotasCargaHoraria);
app.use('/api/empresas', rotasEmpresas);
app.use('/api/validacao', rotasValidacao);

// Exportação obrigatória para o Vercel Serverless

module.exports = app;

// Caso o servidor seja rodado localmente (node api/index.js)
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
    });
}
