# Regra do App — Órbita FATEC

## 1. Visão geral
O Órbita FATEC é um ecossistema de gestão institucional desenvolvido para a FATEC. O objetivo do sistema é centralizar o controle de ativos (empréstimos de equipamentos), gestão de usuários e permissões, ensalamento de salas de aula e controle de carga horária para eventos do RH. O sistema utiliza uma arquitetura baseada em módulos independentes que compartilham uma identidade visual e um núcleo de autenticação/autorização centralizado.

## 2. Estrutura de pastas
- `/` (Raiz): Contém o front-end, configuração do Vercel e núcleo do layout compartilhado.
  - `vercel.json`: Arquivo que gerencia o roteamento "Zero Config" para o Vercel.
  - `firestore.rules`: Regras de segurança rigorosas trancando todo o acesso client-side.
- `/api`: Servidor Backend em Node.js (Express) hospedado no Vercel. Contém a lógica de autenticação via Firebase Admin SDK (`firebase.js`) e as rotas para os módulos (`/rotas`).
- `/core`: Arquivos compartilhados da arquitetura do Front-end (Firebase Auth, layout, segurança).
- `/emprestimo`, `/usuarios`, `/ensalamento`, `/rh/carga-horaria`, `/rh/funcionarios`, `/empresas`, `/valida`, `/meu-espaco`: Módulos independentes do sistema consumindo a API REST através da função `apiFetch` (ou endpoint público).
- `/regras`: Documentação técnica e logs de alteração.

## 3. Fluxo de autenticação e Arquitetura REST
O sistema utiliza uma arquitetura híbrida segura:
1. **Login Client-side**: A autenticação inicial é feita via Firebase Auth (Identity Platform).
2. **REST API**: Qualquer leitura/gravação de dados no Firestore deve ser solicitada à `/api`. O Frontend anexa o Token JWT (gerado no passo 1) via cabeçalho `Authorization: Bearer`.
3. **Validação Server-side (RBAC)**: O `auth.js` do backend valida o token JWT usando o Firebase Admin SDK, consulta o banco para conferir o cargo do usuário e bloqueia/permite a requisição (Erro 403 Forbidden).
4. **Segurança do Firestore**: O `firestore.rules` possui a regra suprema `allow read, write: if false;`. Como o Vercel usa o Admin SDK (root), apenas ele consegue interagir com os dados, anulando 100% dos ataques do lado do cliente.

## 4. Cargos e permissões
O sistema utiliza Role-Based Access Control (RBAC). Os cargos base definidos em `permissions.js` são:

- **ADM N1 (Super Admin)**: Acesso total a todos os módulos e configurações do sistema.
- **ADM N2 (Setor/Chefia)**: Acesso gerencial a Empréstimos, Usuários, Ensalamento e Carga Horária (com restrições dependendo da configuração global).
- **TI (Suporte)**: Foco em Empréstimos, Usuários (gestão técnica) e Ensalamento.
- **RH (Recursos Humanos)**: Acesso exclusivo ao Dashboard e Carga Horária.
- **Visitante**: Acesso apenas para consulta ao Dashboard (módulos básicos liberados).

*Nota: No módulo de Usuários, o ADM N1 pode ajustar granularmente as permissões de "Ver" e "Executar" para cada cargo nos diferentes módulos.*

## 5. Módulos do sistema

### Meu Espaço (Antigo Dashboard)
- **Finalidade**: Área de produtividade do usuário com post-its e mural de avisos.
- **Backend API**: `/api/rotas/meu-espaco.js` (Lida com coleções `users/{uid}/notes` e `notices`).

### Empréstimos
- **Finalidade**: Controle de retirada e devolução de equipamentos.
- **Backend API**: `/api/rotas/emprestimos.js` (Lida com coleção `items` e lógica de timeout).

### Usuários
- **Finalidade**: Gestão de contas e permissões (RBAC).
- **Backend API**: `/api/rotas/usuarios.js` (Usa Auth do Firebase Admin para criar usuários e gerencia coleção `users` e `config`).

### Ensalamento
- **Finalidade**: Gestão inteligente de salas com motor de simulação de conflitos de horários rodando 100% no servidor.
- **Backend API**: `/api/rotas/ensalamento.js`.

### Carga Horária
- **Finalidade**: Registro de entrada/saída em eventos (RH).
- **Frontend Adapter**: O Front-end não reescreveu a lógica pesada de datas. Usou-se um "Mock Adapter" que intercepta comandos do Firestore local e os transforma em chamadas REST para `/api/carga-horaria`.
- **Backend API**: `/api/rotas/carga-horaria.js`.

### Funcionários
- **Finalidade**: Gestão de cadastro, status ativo/inativo e turnos/horários de colaboradores (RH).
- **Backend API**: `/api/rotas/carga-horaria.js` (Lida com coleção `funcionarios_rh`).

### Parceiros (Empresas)
- **Finalidade**: Cadastro e manutenção das empresas parceiras do Clube de Vantagens e descontos concedidos aos funcionários.
- **Backend API**: `/api/rotas/empresas.js` (Lida com coleção `empresas`).

### Validação do Cartão (Valida)
- **Finalidade**: Interface pública para validação de cartões de identificação / QR Code de funcionários.
- **Backend API**: `/api/rotas/validacao.js` (Lida com rota pública `/api/validacao/:uid`).

## 6. Padrão visual
O sistema segue uma identidade visual institucional "Light Theme" moderna:
- **Cores Principais**:
  - Azul Marinho (`#031426`): Sidebar.
  - Azul Primário (`#0F4EB8`): Botões e destaques.
  - Laranja (`#F97316` / `#EB7025`): Acentos e alertas.
  - Fundo (`#F4F7FB`): Cor de fundo das páginas.
- **Componentes Globais**:
  - **Sidebar**: Itens principais (como Meu Espaço) ficam no topo. Outros módulos são organizados por categorias retráteis (Accordion) que iniciam recolhidas.
  - **Header**: Título do módulo, nível de acesso, avatar e botão de logout.
  - **Cards**: Fundo branco, bordas suaves (`12px` a `22px`), sombras sutis.
  - **Classes Globais**: `.btn-primary`, `.layout-wrapper`, `.layout-main`, `.layout-content`, `.layout-nav-category`.

## 7. Regras de alteração
Sempre que um arquivo for criado, alterado ou removido, registrar aqui seguindo o modelo abaixo:

### [AAAA-MM-DD] Título da alteração
- Autor:
- Branch:
- Arquivos alterados:
- Tipo:
- Motivo:
- Impacto:
- Como testar:
- Como reverter:

## 8. Histórico de alterações

### [2026-05-21] Redesenho do Modal de Editar Usuário e Uniformização de Cards de Cargos
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/usuarios/index.html` (Reestruturação do modal em 2 colunas e ajuste de cabeçalho)
  - `/usuarios/app.js` (Ajustes na extração de título/descrição de cargos e exibição de dados)
  - `/usuarios/usuarios.css` (Criação de grid responsivo do modal, uniformização de altura dos cards de cargo e estado checked genérico)
- Tipo: Refatoração UI/UX e Estilização
- Motivo: O modal de edição antigo era muito longo, necessitava de scroll vertical e os cards de cargos tinham tamanhos desiguais dependendo do comprimento do texto.
- Impacto: Modal com visual premium, mais compacto e sem scroll em desktops. Grade de seleção de cargos limpa, legível e simétrica.
- Como testar: No módulo de usuários, abrir o modal de edição de qualquer usuário. O modal deve abrir largo, em 2 colunas horizontais, com cards de cargos com a mesma altura.
- Como reverter: Descartar as alterações feitas em `/usuarios/index.html`, `/usuarios/app.js` e `/usuarios/usuarios.css` para a versão anterior.

### [2026-05-21] Rota de Alteração de Senha do Próprio Usuário (App Móvel)
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/api/rotas/usuarios.js` (Criação da rota `PUT /me/senha`)
  - `/api/middlewares/auth.js` (Ajustado middleware para permitir que usuários não adm acessem rotas `/me/*`)
- Tipo: Segurança e API backend
- Motivo: Permitir que os funcionários cadastrados possam redefinir suas próprias senhas de forma segura diretamente através do app móvel.
- Impacto: Funcionários não-administradores agora podem atualizar suas senhas via API utilizando seu Token ID do Firebase sem comprometer o isolamento de dados do painel web.
- Como testar: Enviar uma requisição HTTP `PUT /api/usuarios/me/senha` com um token JWT válido de usuário não administrador.
- Como reverter: Excluir a rota `PUT /me/senha` de `/api/rotas/usuarios.js` e desfazer a alteração no middleware `/api/middlewares/auth.js`.

### [2026-05-21] Otimização de Latência e Performance (Auth Caching)
- Autor: Antigravity
- Branch: main
- Arquivos criados/alterados:
  - `/core/layout.js` (Funções de cache e ajuste de setupLayout)
  - `/meu-espaco/meu-espaco.js` (Implementação de cache na inicialização)
  - `/empresas/app.js` (Implementação de cache na inicialização)
  - `/rh/funcionarios/app.js` (Implementação de cache na inicialização e ajuste de apiFetch)
  - `/rh/carga-horaria/carga-horaria.js` (Implementação de cache na inicialização e ajuste de apiFetch)
  - `/emprestimo/app.js` (Implementação de cache na inicialização)
  - `/usuarios/app.js` (Implementação de cache na inicialização)
  - `/ensalamento/ensalamento.js` (Implementação de cache na inicialização)
  - `/ensalamento/firebase-service.js` (Ajuste de apiFetch para suporte a cache)
- Tipo: Otimização de Performance e Latência
- Motivo: Eliminar o atraso e a tela de bloqueio "Autenticando..." nas transições de módulos causadas pelo recarregamento da página (MPA) e inicialização assíncrona do Firebase SDK.
- Impacto: Navegação instantânea e suave entre os módulos administrativos do Órbita.
- Como testar: Clicar nos links da sidebar e verificar se as páginas carregam sem exibir o loader "Autenticando...".
- Como reverter: Remover as chamadas a `getCachedAuth()` e limpar as funções correspondentes no `/core/layout.js`.

### [2026-05-20] Criação do Clube de Vantagens (Parceiros) e Refatoração de RH
- **Autor**: Equipe de Desenvolvimento
- **Branch**: main
- **Arquivos criados/alterados**:
  - `/empresas/index.html`, `/empresas/app.js`, `/empresas/empresas.css` (Módulo de Parceiros)
  - `/rh/funcionarios/index.html`, `/rh/funcionarios/app.js`, `/rh/funcionarios/funcionarios.css` (Módulo de Funcionários)
  - `/rh/carga-horaria/index.html`, `/rh/carga-horaria/carga-horaria.js`, `/rh/carga-horaria/carga-horaria.css` (Módulo de Carga Horária refatorado)
  - `/valida/index.html` (Módulo de validação pública)
  - `/api/rotas/empresas.js`, `/api/rotas/app-keys.js`, `/api/rotas/validacao.js`, `/api/index.js` (Novas rotas da API)
  - `/core/permissions.js` (Novos módulos cadastrados)
- **Tipo**: Criação e Refatoração
- **Motivo**: Lançamento do projeto de Cartão Fidelidade para funcionários em app React Native (Expo), exigindo cadastro de empresas parceiras, separação da gestão de funcionários/turnos e validação pública de QR Codes.
- **Impacto**: O módulo antigo de Carga Horária do RH foi dividido em 2 submódulos dedicados. Foi criada a infraestrutura de chaves de aplicativo (`app_keys`) e a validação pública de status de funcionários por UID.
- **Como testar**:
  - Acessar o novo módulo "Parceiros" e criar/editar/excluir lojistas.
  - Acessar o módulo "Funcionários" sob Recursos Humanos e cadastrar turnos para um colaborador.
  - Testar a validação acessando `/valida/index.html?uid=<UID_DO_FUNCIONARIO>` e certificar-se de que exibe o status de ativo/inativo corretamente.
- **Como reverter**: Reverter os novos módulos nos arquivos de rota da API, limpar a lista de módulos no `permissions.js` e excluir as pastas `/empresas`, `/rh/funcionarios` e `/valida`.

### [2026-05-11] Conclusão da Migração Client-Server (REST API)
- **Autor**: Antigravity
- **Arquivos alterados**: Todos os módulos de frontend, pasta `/api`, `firestore.rules`.
- **Motivo**: O projeto amadureceu e o modelo de banco de dados aberto no front-end tornou-se inseguro.
- **Impacto**: Todo o tráfego do Firestore no frontend foi interceptado pela função utilitária `apiFetch` (usando Auth Tokens do Firebase). O Firestore foi trancado com `allow read, write: if false`, garantindo segurança e validação de regras exclusivamente pelo Backend hospedado no Vercel.

### [2026-05-04] Criação da documentação de regras do app
- **Autor**: Antigravity
- Branch: main (standard update)
- Arquivos alterados:
  - `/regras/regra_do_app.md`
- Tipo: criação
- Motivo: criar documentação técnica e registro de alterações do sistema para melhorar a manutenção e padronização.
- Impacto: Facilita a entrada de novos desenvolvedores e o controle de mudanças futuras.
- Como testar: Verificar a existência do arquivo na pasta `/regras` e validar a integridade dos links técnicos citados.
- Como reverter: Remover o diretório `/regras`.

### [2026-05-04] Criação do Meu Espaço
- Autor: Antigravity
- Branch: main (refactor)
- Arquivos criados:
  - `/meu-espaco/index.html`
  - `/meu-espaco/meu-espaco.css`
  - `/meu-espaco/meu-espaco.js`
- Arquivos alterados:
  - `index.html` (adicionado redirecionamento)
  - `login.js` (redirecionamento após login)
  - `permissions.js` (renomeado Dashboard para Meu Espaço)
  - `regras/regra_do_app.md` (documentação)
- Tipo: criação/alteração
- Motivo: substituir dashboard genérico por área personalizada do usuário focada em produtividade e avisos.
- Impacto: Melhora a utilidade da tela inicial e centraliza avisos institucionais de forma controlada.
- Como testar:
  - Logar no sistema e verificar se é levado para `/meu-espaco/index.html`.
  - Criar, editar e fixar uma nota pessoal no Quadro do Funcionário.
  - Logar como ADM N1 e criar um aviso no Quadro de Avisos.
  - Verificar se widgets de módulos aparecem corretamente conforme o cargo.
- Como reverter:
  - Restaurar redirecionamento no `login.js` e `index.html` para o hub original.
  - Reverter alterações de nome no `permissions.js`.

### [2026-05-05] Redesign Premium e Motor de Simulação (Ensalamento)
- Autor: Antigravity
- Branch: main (refactor/feature)
- Arquivos criados:
  - `/ensalamento/simulation-engine.js` (Lógica Heurística)
- Arquivos alterados:
  - `/ensalamento/index.html` (Layout 2 colunas)
  - `/ensalamento/ensalamento.js` (Integração com Motor)
  - `/ensalamento/ensalamento.css` (Premium Light Theme)
  - `regras/regra_do_app.md` (Documentação)
- Tipo: Refatoração de UI/UX e implementação de Inteligência de Dados.
- Motivo: Transformar o mapa de ocupação em uma ferramenta de decisão ativa que respeita as regras da faculdade (3+2, proibição de sábados).
- Impacto: Redução drástica no tempo de planejamento de aulas e eliminação de conflitos manuais de salas.
- Como testar:
  - Acessar o módulo de Ensalamento.
  - Abrir o "Simulador de Encaixe de Aulas".
  - Usar o botão "Padrão Institucional (3+2)" e verificar se a I.A. sugere grades válidas (Score Ideal).
  - Validar se o botão de fechar (X) está visível e vermelho.
- Como reverter:
  - Restaurar backups de `ensalamento.js` e `ensalamento.css` anteriores ao redesign dark-to-light.

### [2026-05-05] Categorização da Sidebar e Organização Administrativa
- Autor: Antigravity
- Branch: main (UI/UX enhancement)
- Arquivos alterados:
  - `permissions.js` (Definição de `CATEGORIES` e agrupamento de Usuários/Ensalamento)
  - `layout.js` (Lógica de agrupamento)
  - `layout.css` (Estilo `.layout-nav-category`)
  - `regras/regra_do_app.md` (Documentação)
- Tipo: Refatoração de Interface para Escala.
- Motivo: Agrupar funções correlatas sob o setor "Administrativo" e simplificar o menu lateral.
- Impacto: Menu mais enxuto e intuitivo para os administradores do sistema.
- Como testar:
  - Logar com diferentes cargos (ex: RH vs T.I.).
  - Verificar se os itens estão agrupados sob títulos como "RECURSOS HUMANOS" ou "GESTÃO DE T.I.".
  - Verificar se categorias vazias não são exibidas.
- Como reverter: Reverter a lógica de loop simples no `layout.js` e remover o objeto `CATEGORIES` de `permissions.js`.

### [2026-05-05] Categorias Retráteis na Sidebar
- Autor: Antigravity
- Branch: main (UX enhancement)
- Arquivos alterados:
  - `layout.js` (Lógica de toggle e ícones)
  - `layout.css` (Animações de chevron e visibilidade de grupos)
  - `regras/regra_do_app.md` (Documentação)
- Tipo: Melhoria de Usabilidade.
- Motivo: Permitir que o usuário organize seu espaço de trabalho recolhendo setores que não está utilizando no momento.
- Impacto: Interface mais limpa e personalizável.
- Como testar:
  - Clicar sobre o nome de uma categoria (ex: "ADMINISTRATIVO").
  - Verificar se os itens abaixo dela desaparecem e o ícone de seta gira.
  - Recarregar a página e verificar se as categorias voltam a aparecer abertas por padrão.

### [2026-05-05] Refinamento da Sidebar (Closed by Default)
- Autor: Antigravity
- Branch: main (UX refinement)
- Arquivos alterados:
  - `layout.js` (Lógica de recolhimento inicial com inteligência de contexto)
  - `layout.css` (Ajuste de contraste das labels e espaçamento)
  - `regras/regra_do_app.md` (Documentação)
- Tipo: Ajuste de Interface e Visibilidade.
- Motivo: Melhorar o foco do usuário ao abrir o sistema e garantir que os títulos das categorias sejam legíveis em qualquer monitor.
- Impacto: Menu inicial mais limpo e títulos com leitura facilitada.
- Como testar:
  - Logar no sistema ou atualizar a página.
  - Verificar se as categorias extras estão fechadas.
  - Verificar se a categoria do módulo atual (ex: Meu Espaço) permanece aberta automaticamente.
  - Observar o novo brilho e destaque dos títulos das categorias.

### [2026-05-05] Localização de E-mails e Correção de Reset de Senha
- Autor: Antigravity
- Branch: main (Bugfix/Localization)
- Arquivos alterados:
  - `usuarios/app.js` (Adicionado `auth.languageCode = 'pt-br'`)
  - `regras/regra_do_app.md` (Documentação)
- Tipo: Ajuste de Comunicação Institucional.
- Motivo: E-mails de redefinição estavam sendo enviados em inglês e caindo em filtros de spam por falta de formatação correta.
- Impacto: Melhora a experiência de recuperação de conta para os funcionários.
- Como testar: No módulo Usuários, selecionar um usuário, clicar em "Redefinir Senha" e verificar se o e-mail chega em Português.

### [2026-05-05] Tela de Redefinição de Senha Personalizada
- Autor: Antigravity
- Branch: main (Feature/Security)
- Arquivos criados:
  - `redefinir-senha.html` (Layout institucional)
  - `redefinir-senha.js` (Lógica de confirmação de senha)
- Tipo: Melhoria de Identidade Visual e Segurança.
- Motivo: Substituir a página padrão e "feia" do Firebase por uma experiência premium que mantém o usuário dentro do ecossistema Órbita.
- Impacto: Aumento da confiança do usuário no processo de recuperação de conta.
- Configuração Necessária: No Console do Firebase, em **Authentication > Settings > User Actions**, alterar a **URL de Ação** para o endereço final desta página.

### [2026-05-05] Refinamento de Hierarquia na Sidebar
- Autor: Antigravity
- Branch: main (UX adjustment)
- Arquivos alterados:
  - `permissions.js` (Removida categoria de Meu Espaço)
  - `layout.js` (Lógica para itens de nível superior)
  - `regras/regra_do_app.md` (Documentação)
- Tipo: Ajuste de Interface.
- Motivo: Destacar o "Meu Espaço" como o ponto de partida central do usuário, deixando-o fora das categorias para acesso imediato.
- Impacto: Navegação mais rápida para a Home do sistema.

### [2026-05-11] Fase 1: Criação da Arquitetura Cliente-Servidor (Backend Vercel)
- Autor: Antigravity
- Branch: main (architecture-refactor)
- Arquivos criados:
  - `api/index.js` (Entry point do Express)
  - `api/firebase.js` (Inicialização do Firebase Admin SDK)
  - `api/middlewares/auth.js` (Middleware de validação de ID Token)
  - `vercel.json` (Configuração de Serverless Functions do Vercel)
- Arquivos alterados:
  - `package.json` (Inclusão de scripts e dependências)
- Tipo: Refatoração de Arquitetura (BaaS para REST API).
- Motivo: Aumentar a segurança e criar um backend verdadeiro rodando em ambiente Serverless Node.js no Vercel, encapsulando as regras de acesso ao Firestore com Firebase Admin.
- Impacto: Desacoplamento do Firebase Firestore do Frontend (em andamento) garantindo que o banco de dados só seja acessado de forma validada pela API.
- Como testar:
  - Rodar `npm start` localmente e acessar `http://localhost:3000/api` para ver a mensagem online.
- Como reverter:
  - Remover o diretório `api/` e `vercel.json`.

### [2026-05-11] Fase 2: Migração do Módulo de Empréstimos para a API REST
- Autor: Antigravity
- Branch: main (api-migration-emprestimos)
- Arquivos criados:
  - `api/rotas/emprestimos.js` (Rotas GET e PUT)
- Arquivos alterados:
  - `api/index.js` (Registro das rotas)
  - `emprestimo/app.js` (Refatorado para usar `apiFetch` via HTTP no lugar de Firebase Client SDK, substituído o `onSnapshot` por polling).
- Tipo: Migração de Backend.
- Motivo: Transferir a lógica de consulta e gravação do banco de dados para a API protegida por Token JWT do Firebase.
- Impacto: Maior segurança. Os dados de `notebooks` não são mais acessíveis diretamente pelo front-end sem passar pelo servidor.
- Como testar:
  - Abra 2 terminais: um rodando o front-end (ex: Live Server) e outro rodando o back-end (`npm run dev`).
  - Acesse a página de empréstimos e faça uma reserva ou altere o status de um equipamento. Verifique na aba *Network* se as requisições estão indo para `http://localhost:3000/api/emprestimos`.

### [2026-05-11] Fase 2.1: Migração do Módulo de Usuários para a API REST
- Autor: Antigravity
- Branch: main (api-migration-usuarios)
- Arquivos criados:
  - `api/rotas/usuarios.js` (Rotas GET, POST, PUT, DELETE para usuários, cargos e permissões globais)
- Arquivos alterados:
  - `api/index.js` (Registro das rotas de usuários)
  - `usuarios/app.js` (Substituição massiva do Firebase Client SDK para `apiFetch`. Remoção completa do *Secondary App* para criação de usuários. Implementação de polling no lugar de `onSnapshot`).
- Tipo: Migração de Backend e Refatoração de Segurança.
- Motivo: A criação de usuários pelo front-end exigia uma "gambiarra" de deslogar/logar ou criar uma instância secundária do Firebase, o que é instável e inseguro. Gerenciar regras de RBAC (cargos e permissões) direto no client side também abria margem para manipulação.
- Impacto: Aumento drástico de estabilidade ao criar contas (agora feito pelo `firebase-admin` via REST API) e fechamento de brechas de segurança no acesso à coleção `users` e `config/permissions`.
- Como testar:
  - Logue como ADM N1.
  - Acesse o módulo Usuários. Crie um novo cargo. Altere as permissões globais. Crie um novo usuário.
  - Verifique se as chamadas de rede vão para `/api/usuarios`.

## 9. Diretrizes de Deploy no Vercel (Zero Config)

Para garantir que o front-end estático e a API servida em Node.js (funções serverless) rodem corretamente em harmonia no Vercel, siga estas diretrizes essenciais de deploy:

1. **Evitar Configuração de Builds Legada**:
   - **NÃO** insira a propriedade `"builds": [...]` no arquivo `vercel.json`. 
   - A configuração com `"builds"` anula as definições do projeto no painel da Vercel e impede o Vercel de gerenciar o build automaticamente, resultando frequentemente em erro de compilação ou telas `404 Not Found`.

2. **Roteamento Zero Config**:
   - A API do back-end reside na pasta `/api`. O Vercel detecta automaticamente e compila quaisquer arquivos dentro de `/api` (como `/api/index.js`) em funções serverless de forma transparente.
   - O arquivo `vercel.json` deve conter apenas as regras de redirecionamento (`rewrites`) para direcionar chamadas HTTP sob `/api/*` ao entry point `/api/index.js`, e os cabeçalhos de CORS globais para tráfego seguro.

3. **Deploy por Integração do Git**:
   - O repositório está integrado à Vercel. Qualquer push ou mesclagem à branch `main` disparará um deploy de produção automaticamente.
   - Mudanças nas rotas da API em desenvolvimento local devem ser testadas localmente (`npm run dev`) antes do push para produção.

---
*Fim da documentação.*
