const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middlewares globais
app.use(cors());
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
const rotasAppKeys = require('./rotas/app-keys');

app.use('/api/emprestimos', rotasEmprestimo);
app.use('/api/usuarios', rotasUsuarios);
app.use('/api/ensalamento', rotasEnsalamento);
app.use('/api/meu-espaco', rotasMeuEspaco);
app.use('/api/carga-horaria', rotasCargaHoraria);
app.use('/api/empresas', rotasEmpresas);
app.use('/api/validacao', rotasValidacao);
app.use('/api/app-keys', rotasAppKeys);

// Exportação obrigatória para o Vercel Serverless

module.exports = app;

// Caso o servidor seja rodado localmente (node api/index.js)
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
    });
}
