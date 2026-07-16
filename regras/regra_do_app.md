# Regra do App — Órbita FATEC

## 1. Visão geral
O Órbita FATEC é um ecossistema de gestão institucional desenvolvido para a FATEC. O objetivo do sistema é centralizar o controle de ativos (empréstimos de equipamentos), gestão de usuários e permissões, ensalamento de salas de aula e controle de carga horária para eventos do RH. O sistema utiliza uma arquitetura baseada em módulos independentes que compartilham uma identidade visual e um núcleo de autenticação/autorização centralizado.

## 2. Estrutura de pastas
- `/` (Raiz): Contém o front-end, configuração do Vercel e núcleo do layout compartilhado.
  - `vercel.json`: Arquivo que gerencia o roteamento "Zero Config" para o Vercel.
  - `firestore.rules`: Regras de segurança rigorosas trancando todo o acesso client-side.
- `/api`: Servidor Backend em Node.js (Express) hospedado no Vercel. Contém a lógica de autenticação via Firebase Admin SDK (`firebase.js`) e as rotas para os módulos (`/rotas`).
- `/auth`: Tela de login e fluxo de redefinição de senha institucional.
- `/core`: Arquivos compartilhados da arquitetura do Front-end (Firebase Auth, layout, segurança, permissões).
- `/emprestimo`, `/usuarios`, `/planejamento-academico`, `/rh` (Carga Horária / Funcionários), `/empresas`, `/valida`, `/meu-espaco`, `/fidelidade`, `/turmas`: Módulos independentes do sistema consumindo a API REST através da função `apiFetch` (ou endpoint público).
- `/regras`: Documentação técnica e logs de alteração.

## 3. Fluxo de autenticação e Arquitetura REST
O sistema utiliza uma arquitetura híbrida segura:
1. **Login Client-side**: A autenticação inicial é feita via Firebase Auth (Identity Platform).
2. **REST API**: Qualquer leitura/gravação de dados no Firestore deve ser solicitada à `/api`. O Frontend anexa o Token JWT (gerado no passo 1) via cabeçalho `Authorization: Bearer`.
3. **Validação Server-side (RBAC)**: O `auth.js` do backend valida o token JWT usando o Firebase Admin SDK, consulta o banco para conferir o cargo do usuário e bloqueia/permite a requisição (Erro 403 Forbidden).
4. **Segurança do Firestore**: O `firestore.rules` possui a regra suprema `allow read, write: if false;`. Como o Vercel usa o Admin SDK (root), apenas ele consegue interagir com os dados, anulando 100% dos ataques do lado do cliente.

## 4. Cargos e permissões
O sistema utiliza Role-Based Access Control (RBAC). Os cargos base definidos em `permissions.js` são:

- **ADM N1 (Super Admin)**: Acesso total a todos os módulos (Meu Espaço, Cartão FATEC, Empréstimos, Usuários, Planejamento Acadêmico, Carga Horária, Funcionários, Parceiros).
- **ADM N2 (Setor/Chefia)**: Acesso gerencial a todos os módulos do sistema (com restrições de escrita dependendo de cada caso).
- **TI (Suporte)**: Acesso a Meu Espaço, Cartão FATEC, Empréstimos e Usuários.
- **RH (Recursos Humanos)**: Acesso a Meu Espaço, Cartão FATEC, Carga Horária e Funcionários.
- **Visitante**: Acesso restrito a Meu Espaço e Cartão FATEC (módulos básicos institucionais).

*Nota: No módulo de Usuários, o ADM N1 pode ajustar granularmente as permissões de "Ver" e "Executar" para cada cargo nos diferentes módulos.*

### Nomenclatura: "Setor" na interface = cargo/role no código
Na interface do módulo Usuários, os cargos são apresentados como **"Setor"** (cadastro de usuário, aba Setores, modo "Por Setor" da gerência de acessos). Internamente nada mudou: o campo continua sendo `role` no doc `users/{uid}`, as permissões continuam em `config/permissions` por role, e os ids (`adm_l1`, `adm_l2`, `ti`, `rh`, `visitante`, ...) permanecem. Não confundir com os **setores de funcionários** (`setores_rh`, módulo Funcionários), que são apenas organizacionais e não concedem acesso.

### Permissões por usuário (override individual)
Além das permissões por cargo, o ADM N1 pode conceder **acessos personalizados por usuário** (tela Usuários → Gerenciar Acessos → "Por Usuário"). O override é salvo no campo `permissoes` do doc `users/{uid}` (`{ modulo: nivel }`) e **sempre vence o cargo** — tanto para ampliar quanto para restringir. Módulos sem override herdam o nível do cargo. Níveis: 1 = Sem Acesso, 2 = Apenas Leitura, 3 = Acesso Total. Convenção visual: acesso herdado do cargo aparece em **azul**; acesso personalizado, em **laranja**. A gerência de acessos (globais e individuais) é exclusiva do `adm_l1` (imposto no backend).

### ⚠️ REGRA OBRIGATÓRIA — Registro de módulos e tópicos novos
`core/permissions.js` é a **fonte única** de módulos (`MODULES`) e tópicos/categorias (`CATEGORIES`). **Todo módulo novo criado DEVE ser registrado em `MODULES`** (com `id`, `category`, `title`, `icon`, `url`) e, se o tópico não existir, **registrado em `CATEGORIES`**. É esse registro que faz o módulo aparecer automaticamente no menu lateral E na tela de Gerência de Acessos (grade por cargo, por usuário e filtro por tópico) — não há mais listas paralelas hardcoded. Um módulo não registrado ali fica invisível para o sistema de permissões.

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

### Planejamento Acadêmico (antigo Ensalamento)
- **Finalidade**: Gestão inteligente de cursos, turmas com controle de lotes/períodos letivos (ex: 2026.2), salas de aula com tipo de equipamentos, calendário semanal de ensalamento e simulador de encaixe de aulas com I.A. A pasta foi renomeada de `/ensalamento` para `/planejamento-academico`.
- **Backend API**: `/api/rotas/ensalamento.js` (o ID interno da rota permanece `ensalamento` para compatibilidade com o sistema de permissões RBAC).
- **Coleções Firestore**: `courses`, `classes`, `rooms`, `calendarEntries`, `simulations`.
- **Regras de Salas**: Cada sala agora possui um campo `equipmentType` com os valores `UNI` (Universitária), `CCM` (Carteira e Cadeira Medicina) ou `CC` (Carteira e Cadeira), para controle interno.
- **Regras de Turmas**: Turmas são importadas e organizadas por **lote/período letivo** (ex: `2026.2`). A cada novo semestre, um novo lote é criado, mantendo o histórico separado.
- **Simulador**: Simplificado — cada aula configurável tem apenas o campo **Tipo** (Presencial / EAD / Carga Reservada). O período é fixo (Noite Inteira P1+P2) e o modo é sempre Automático (I.A.).

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

### FATEC Fidelidade (PWA)
- **Finalidade**: Módulo mobile-first (PWA) que disponibiliza a carteirinha digital do funcionário (FATEC Card) com QR Code auto-regenerativo a cada 30 segundos e acesso rápido às empresas parceiras conveniadas no Clube de Vantagens.
- **Estrutura**: Localizado em `/fidelidade`, inclui a página do usuário (`index.html`) e a interface de validação (`validar.html`) para lojistas verificarem o status e vigência em tempo real.

### Turmas
- **Finalidade**: Listagem e gestão de turmas e disciplinas acadêmicas para os docentes.
- **Backend API**: `/api/rotas/turmas.js` (Lida com coleção `turmas`).

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

### [2026-07-16] Reforma da Gestão de Acessos (fonte única de módulos + permissões por usuário)
- Autor: Equipe TI (com Claude Code)
- Branch: main (fork Mtreck)
- Arquivos alterados: `core/permissions.js`, `core/layout.js`, `src/middlewares/auth.js`, `src/rotas/usuarios.js`, `usuarios/app.js`, `usuarios/index.html`, `usuarios/usuarios.css`, guards de `emprestimo/`, `turmas/`, `avaliacoes/`, `empresas/`, `planejamento-academico/`, `rh/carga-horaria/`, `rh/funcionarios/`.
- Tipo: Feature + Refactor + Segurança.
- Motivo: A tela "Gerenciar Acessos" usava listas de módulos hardcoded e divergentes (Agenda e Funcionários nem apareciam) e não havia permissão individual por usuário.
- Impacto:
  - `core/permissions.js` virou a fonte única de módulos/tópicos (ver Regra Obrigatória na seção 4); a grade de acessos deriva dela, agrupada por tópico, com filtro por categoria e 4 módulos por linha.
  - Novo override por usuário (`users/{uid}.permissoes`), aplicado no middleware do backend (vence o cargo) e refletido no menu lateral e nos guards das páginas (nível efetivo). Azul = herdado do cargo; laranja = personalizado.
  - Novo endpoint `PUT /api/usuarios/:uid/permissoes` (só `adm_l1`); `PUT /config/permissions` agora também exige `adm_l1` (antes qualquer nível 3 em usuarios editava — brecha de escalada de privilégio).
  - Cargo novo nasce sem acesso a nenhum módulo.
- Como testar: como adm_l1, Usuários → Gerenciar Acessos → "Por Usuário": dar Acesso Total num módulo fora do cargo de um usuário de teste e conferir menu/página/API; dar "Sem Acesso" num módulo do cargo e conferir o bloqueio.
- Como reverter: `git revert` do commit correspondente; remover campo `permissoes` dos docs `users` afetados.

### [2026-05-27] Criação do módulo de Turmas e Categoria Docência
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/core/permissions.js` (Adicionado categoria 'docencia' e módulo 'turmas' à configuração estática)
  - `/usuarios/app.js` (Módulo 'turmas' adicionado ao painel de gerenciamento de permissões)
  - `/api/middlewares/auth.js` (Configuradas permissões padrão para o módulo 'turmas')
  - `/api/index.js` (Registradas as rotas do backend `/api/turmas`)
  - `/regras/regra_do_app.md` (Documentação do novo módulo e logs de alteração)
- Arquivos criados:
  - `/api/rotas/turmas.js` (Controlador backend para operações CRUD de turmas)
  - `/turmas/index.html` (Interface HTML principal do módulo)
  - `/turmas/app.js` (Lógica frontend do módulo com autenticação e carregamento de turmas)
  - `/turmas/turmas.css` (Estilos específicos do módulo de turmas)
- Tipo: Nova Funcionalidade / Expansão do Sistema
- Motivo: Disponibilizar um módulo de gerenciamento de turmas e disciplinas sob o novo menu "Docência" no menu lateral.
- Impacto: Novos fluxos de dados acadêmicos disponíveis para administradores e cargos autorizados no ecossistema Órbita FATEC.
- Como testar: Logar como ADM N1. Expandir o menu lateral na seção "Docência", clicar em "Turmas" e verificar o carregamento de dados de teste (seeding inicial). Criar uma turma, editar e excluir. Validar que as ações de escrita não são permitidas para cargos com nível < 3.
- Como reverter: Remover a pasta `/turmas`, as rotas em `/api/rotas/turmas.js` e as referências nos arquivos de configuração listados.

### [2026-05-25] Controle de Acesso por Níveis (1, 2 e 3) e Troca de Senha Obrigatória no Primeiro Acesso
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/api/middlewares/auth.js` (Implementada validação de níveis numéricos e normalização de legados)
  - `/api/rotas/usuarios.js` (Adicionada proteção de rota com requireModulePermission e flag de primeiro acesso)
  - `/core/layout.js` (Menu lateral filtrado e guarda de rotas dinâmicos atualizados para níveis; implementado modal de primeiro acesso)
  - `/meu-espaco/meu-espaco.js` (Widget cards filtrados por níveis)
  - `/emprestimo/app.js` (Controles de exibição e bloqueio baseados em níveis)
  - `/ensalamento/ensalamento.js` (Controles de exibição, bloqueio e formulário de visualização baseados em níveis)
  - `/usuarios/index.html` (Classes action-execute aplicadas a botões de ação e criação de cargos)
  - `/usuarios/app.js` (Substituição de checkboxes por selects de nível, controle de botões dinâmicos e nível inicial padrão de cargos)
  - `/usuarios/usuarios.css` (Regra CSS para desabilitar interruptor de status ativo/inativo e selects de permissões em modo leitura)
- Tipo: Evolução de Segurança, RBAC e Usabilidade
- Motivo: Simplificar o gerenciamento de acesso a cada módulo com Níveis de Acesso (1 - Sem Acesso, 2 - Apenas Leitura, 3 - Acesso Total), corrigir o erro de Forbidden 403 que impedia cargos permitidos de consultar a tela de Usuários, e forçar usuários recém-criados a redefinir sua senha inicial por motivos de segurança.
- Impacto: Gerenciamento mais intuitivo e à prova de falhas para os administradores. Segurança aprimorada forçando senhas personalizadas no primeiro login de novos funcionários.
- Como testar: 
  - Criar um novo usuário de teste. Logar com ele e verificar se o modal de Primeiro Acesso bloqueia a tela até que seja definida uma nova senha de 6 caracteres.
  - Logar com administrador e definir acesso do módulo de Usuários para T.I. como Nível 2 (Apenas Leitura). Logar como T.I., conferir que a página abre normalmente, mas todos os botões de ação e seletores de níveis estão bloqueados e esmaecidos.
- Como reverter: Desfazer as alterações nos arquivos listados acima.

### [2026-05-25] Validação e Filtragem Dinâmica de Permissões (RBAC / Sidebar e Ações)
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/core/layout.js` (Implementada checagem das permissões dinâmicas no layout, ocultação de itens da sidebar e background refresh periódico)
  - `/core/layout.css` (Adicionada a regra global `.hide-execute .action-execute` para ocultar botões de escrita)
  - `/meu-espaco/meu-espaco.js` (Widget cards filtrados dinamicamente com base nas permissões reais do banco)
- Tipo: Refatoração de Segurança e Controle de Acesso
- Motivo: Fazer com que o menu lateral (sidebar) e os widgets do painel ocultem imediatamente os módulos para os quais o cargo do usuário não tem permissão de visualização ("ver"). Além disso, corrigir a ocultação de botões de escrita/ação (`action-execute`) caso a permissão "executar" seja falsa.
- Impacto: Interface limpa e totalmente integrada às decisões de permissão dos ADMs N1/N2 em tempo real, sem expor links e telas temporárias não autorizadas.
- Como testar: Logar como ADM N1. Em "Gerenciar Acesso", remover o "ver" de um módulo (ex: Empréstimos) para o cargo T.I. Logar como T.I. e verificar se o menu de Empréstimos e o widget correspondente no Meu Espaço desapareceram. Tentar acessar o link direto da página e verificar o redirecionamento imediato. Alterar "executar" para false e verificar se os botões de ação somem.
- Como reverter: Desfazer as alterações nos arquivos `/core/layout.js`, `/core/layout.css` e `/meu-espaco/meu-espaco.js`.

### [2026-05-25] Ajuste de Nome de Marca e Tempo de Expiração do QR Code (Fidelidade PWA)
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/fidelidade/index.html` (Alterado marca do cabeçalho de ÓRBITA Fidelidade para FATEC Fidelidade para manter consistência)
  - `/fidelidade/validar.html` (Reduzido o tempo de expiração do QR Code de 120 segundos para 45 segundos, com tolerância a clock skew)
- Tipo: Ajuste de UI/Branding e Correção de Segurança (QR Code)
- Motivo: Evitar discrepância na marca e garantir que capturas de tela antigas expirem rapidamente, impedindo a validação de códigos defasados ou compartilhados.
- Impacto: Melhora a consistência visual do módulo PWA e aumenta consideravelmente a segurança e eficácia do QR Code auto-regenerativo.
- Como testar: Abrir a carteirinha PWA `/fidelidade/index.html`, verificar se o topo exibe FATEC Fidelidade. Tirar um print do QR Code, esperar passar o tempo de regeneração de 30 segundos mais a tolerância de 15 segundos e tentar validar o print. Deve constar como expirado.
- Como reverter: Reverter a marca do cabeçalho no `/fidelidade/index.html` e restaurar o limite de 120 segundos no `/fidelidade/validar.html`.

### [2026-05-25] Ajustes de Mobile, Filtro de Resumos e Correção de Notas no Meu Espaço
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/meu-espaco/index.html` (Inclusão do seletor dropdown para filtrar resumos de módulos no mobile)
  - `/meu-espaco/meu-espaco.js` (Lógica de filtragem dos widgets-card com base no módulo associado)
  - `/meu-espaco/meu-espaco.css` (Regras de responsividade para ocultar/exibir o filtro, compactar os widgets, reordenar as seções colocando avisos acima do quadro do funcionário, evitar colisões de botões nos cabeçalhos, correção da classe das notas para `.note-text-display` resolvendo o wrap de palavras e posicionamento dos botões, e desativação das posições absolutas de notas no mobile com exibição em flex grid e botões de ação sempre visíveis)
- Tipo: Ajuste de UI/UX Responsivo
- Motivo: Proporcionar uma forma para o ADM N1 filtrar a visualização de resumos no celular, reordenar as seções para dar preferência a avisos, corrigir o botão "Nova Nota" que colidia com o título da seção, corrigir o bug de transbordamento de texto horizontal nas notas (unboxing de classes) e o posicionamento flutuante do rodapé de ações, e contornar a quebra de layout causada por posições absolutas (arrastar) em telas estreitas de celular.
- Impacto: Interface móvel e desktop do Meu Espaço perfeitamente consistentes, com notas adaptáveis ao tamanho de tela e botões de ação (editar/excluir/fixar) utilizáveis em dispositivos móveis.
- Como testar: Acessar a página Meu Espaço em modo móvel e desktop. Escrever uma nota com texto longo contínuo (ex: "testetesteteste") e verificar se ocorre a quebra de linha. No celular, certificar-se de que as notas estão dispostas uma abaixo da outra de forma centralizada e que os botões de ação estão visíveis sem precisar passar o mouse.
- Como reverter: Reverter as alterações nos arquivos `/meu-espaco/index.html`, `/meu-espaco/meu-espaco.js` e `/meu-espaco/meu-espaco.css`.

### [2026-05-25] Ajustes de Layout Mobile e Filtros Interativos no Módulo de Empréstimos
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/emprestimo/index.html` (Inclusão do status "Cedido" no seletor de filtros e atributos `data-filter` nos cards de sumário)
  - `/emprestimo/emprestimo.css` (Ajustes de responsividade mobile e inclusão de `cursor: pointer` nos cards de sumário)
  - `/emprestimo/app.js` (Event listeners nos cards de sumário para atualizar o filtro de status ao serem clicados)
- Tipo: Ajuste de UI/UX Responsivo e Melhoria de Usabilidade
- Motivo: Melhorar a legibilidade dos cards de sumário no celular, evitar o espremimento da barra de busca, colocar o scanner de QR Code em um botão de ação flutuante (FAB), desativar o `backdrop-filter` do container para liberar o contexto do `position: fixed`, adicionar o status "Cedidos" no seletor de filtros de busca e permitir que o clique nos cards de sumário filtre a listagem automaticamente.
- Impacto: Melhora significativa na usabilidade e visual do painel de empréstimos, facilitando a navegação com atalhos de filtros rápidos por cliques diretos nos números do sumário.
- Como testar: Acessar a página de empréstimos. Verificar se há a opção "Cedidos" no select de status. Clicar em qualquer card de sumário superior (ex: clicando em "Disponíveis" ou "Total") e verificar se a listagem e o select de filtros atualizam condizentemente. No celular, verificar o layout compacto e a posição fixa do FAB do scanner no canto inferior direito.
- Como reverter: Desfazer as alterações nos arquivos `/emprestimo/index.html`, `/emprestimo/emprestimo.css` e `/emprestimo/app.js`.

### [2026-05-22] Ajuste de CORS para Desenvolvimento Local (PWA Fidelidade / Multi-porta)
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/api/index.js` (Ajustado regex do CORS para aceitar qualquer porta em localhost/127.0.0.1)
- Tipo: Ajuste de Infraestrutura / Desenvolvimento
- Motivo: Evitar bloqueio por CORS ao testar o PWA Fidelidade ou outros módulos locais quando a porta do servidor local varia.
- Impacto: Permite que desenvolvedores façam requisições locais para a API do Vercel a partir de qualquer porta local.
- Como testar: Rodar o PWA localmente e verificar se as chamadas de rede à API ocorrem sem erros de CORS.
- Como reverter: Reverter o regex do CORS no arquivo `/api/index.js`.

### [2026-05-21] Correção de Bloqueio e Fallback de Usuários (PWA Fidelidade)
- Autor: Antigravity
- Branch: main
- Arquivos alterados/criados:
  - `/api/rotas/usuarios.js` (Adicionado fallback no endpoint `GET /me` se o documento no Firestore for inexistente)
  - Banco de Dados Firestore (Atualização em lote para definir `ativo: true` para usuários legados e criação de documento para o e-mail secundário do desenvolvedor)
- Tipo: Correção de Bug e API backend
- Motivo: Resolver o problema em que usuários existentes sem o campo `ativo` (ou novos usuários não sincronizados no Firestore) ficavam bloqueados na tela de login exibindo avisos de inatividade.
- Impacto: Garante que todos os usuários ativos do Firebase Auth consigam fazer login com sucesso, assumindo `ativo: true` por padrão e preenchendo as informações básicas na tela do PWA.
- Como testar: Realizar login no PWA com contas cujos campos `ativo` estavam ausentes ou inexistentes no Firestore.
- Como reverter: Remover o fallback da rota `/me` no backend e desfazer as atualizações de banco de dados.

### [2026-05-21] Rota de Alteração de Senha do Próprio Usuário (PWA Fidelidade)
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/api/rotas/usuarios.js` (Criação da rota `PUT /me/senha`)
  - `/api/middlewares/auth.js` (Ajustado middleware para permitir que usuários não adm acessem rotas `/me/*`)
- Tipo: Segurança e API backend
- Motivo: Permitir que os funcionários cadastrados possam redefinir suas próprias senhas de forma segura diretamente através do PWA Fidelidade.
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
  - `/api/rotas/empresas.js`, `/api/rotas/validacao.js`, `/api/index.js` (Novas rotas da API)
- **Tipo**: Criação e Refatoração
- **Motivo**: Lançamento do projeto de Cartão Fidelidade para funcionários via PWA Fidelidade, exigindo cadastro de empresas parceiras, separação da gestão de funcionários/turnos e validação pública de QR Codes.
- **Impacto**: O módulo antigo de Carga Horária do RH foi dividido em 2 submódulos dedicados e a validação pública de status de funcionários por UID foi implementada.
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

### [2026-05-22] Fase 3: Criação do Módulo FATEC Fidelidade Web (PWA)
- Autor: Antigravity
- Branch: main (fidelidade-pwa)
- Arquivos criados:
  - `fidelidade/index.html` (Interface PWA, carteirinha e clube de vantagens mobile-first)
  - `fidelidade/fidelidade.css` (Visual premium dark gradient e glassmorphism para a carteirinha)
  - `fidelidade/fidelidade.js` (Autenticação, busca de perfil, QR Code dinâmico, lista de parceiros, busca e banner de atalho PWA)
- Arquivos alterados:
  - `core/permissions.js` (Módulo cadastrado e atribuído a todos os cargos)
  - `auth/login.js` (Redirecionamento automático pós-login via parâmetro `?redirect=`)
  - `regras/regra_do_app.md` (Documentação e histórico de alterações)
- Tipo: Nova Funcionalidade (PWA Mobile-first).
- Motivo: Substituir o aplicativo nativo em Expo por um PWA totalmente responsivo integrado ao Órbita, permitindo que usuários do iOS (iPhone) e Android acessem a carteirinha e parceiros adicionando um atalho na tela inicial do celular, sem precisar de compilação ou download de APKs.
- Impacto: Acesso rápido, seguro e dinâmico ao cartão de fidelidade com QR Code auto-regenerativo a cada 30 segundos, integrado diretamente ao controle de status de usuários do Órbita.
- Como testar:
  - Abra o navegador e acesse `/fidelidade/index.html`.
  - Se deslogado, deve redirecionar para `/auth/login.html?redirect=/fidelidade/index.html`.
  - Após o login, deve exibir a carteirinha digital com QR Code atualizando a cada 30 segundos e a lista de parceiros credenciados na seção "Clube de Vantagens".
  - Simule o acesso em modo PWA standalone ou utilize o banner de instalação no celular para fixar o atalho.

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

---

## 10. Histórico de alterações — Sessão 2026-05-26 (Branch: ensalamento)

### [2026-05-26] Renomeação e Reestruturação do Módulo de Ensalamento para Planejamento Acadêmico
- Autor: Antigravity
- Branch: ensalamento
- Arquivos alterados/criados:
  - `/planejamento-academico/` (pasta criada, substitui `/ensalamento/`)
  - `/planejamento-academico/index.html` (atualizado título, meta, URL do módulo)
  - `/planejamento-academico/ensalamento.js` (renomeado internamente)
  - `/planejamento-academico/ensalamento.css`
  - `/planejamento-academico/firebase-service.js`
  - `/planejamento-academico/simulation-engine.js`
  - `/core/permissions.js` (URL do módulo atualizada para `/planejamento-academico/index.html`)
  - `/regras/regra_do_app.md` (documentação)
- Tipo: Refatoração de Estrutura e Identidade
- Motivo: O módulo de Ensalamento evoluiu para um sistema completo de Planejamento Acadêmico que vai além do simples ensalamento de salas, passando a incluir controle de matrizes curriculares, turmas por período letivo e simulação de grade semanal. O ID interno (`ensalamento`) foi mantido na API e no sistema de permissões para não quebrar a autenticação RBAC.
- Impacto: A pasta `/ensalamento` foi excluída. O módulo agora reside em `/planejamento-academico`. Nenhuma rota de API foi alterada.
- Como testar: Acessar `/planejamento-academico/index.html` e verificar se o módulo carrega corretamente.
- Como reverter: Restaurar a pasta `/ensalamento` e reverter o `permissions.js`.

### [2026-05-26] Sistema de Importação de Turmas por Lotes/Períodos Letivos
- Autor: Antigravity
- Branch: ensalamento
- Arquivos alterados:
  - `/planejamento-academico/index.html` (botão e modal de importação com campo de título do lote)
  - `/planejamento-academico/ensalamento.js` (lógica de importação XLSX com campo `academicPeriod`, filtros dinâmicos de período, renderização de turmas filtradas)
  - `/api/rotas/ensalamento.js` (rota `POST /custom/classes/batch` para importação em lote)
- Tipo: Nova Funcionalidade
- Motivo: O administrativo precisava de uma forma de separar as turmas por semestre. Agora ao importar um XLSX de turmas, o usuário define o título do período (ex: `2026.2`). No próximo ano, pode criar um novo lote `2027.1` sem apagar o histórico anterior.
- Impacto: Turmas são exibidas filtradas pelo período letivo selecionado. Os dropdowns de período são populados dinamicamente com base nos valores existentes no banco.
- Como testar: Importar um arquivo XLSX de turmas informando o período `2026.2`. Verificar se o dropdown de período exibe `2026.2` e se as turmas aparecem filtradas corretamente.

### [2026-05-26] Salas: Campo Bloco Substituído por Tipo de Equipamentos (UNI / CCM / CC)
- Autor: Antigravity
- Branch: ensalamento
- Arquivos alterados:
  - `/planejamento-academico/index.html` (modal de sala e filtro da aba Salas)
  - `/planejamento-academico/ensalamento.js` (funções `openRoomModal`, `handleRoomSubmit`, `renderRooms`)
- Tipo: Evolução de Funcionalidade
- Motivo: O campo "Bloco" não tinha valor prático para o ensalamento. O controle interno do tipo de equipamento disponível em cada sala (universitária, medicina, genérica) é mais relevante para alocação correta.
- Impacto: O campo `block` foi substituído pelo campo `equipmentType` no Firestore. Salas sem o campo exibem `UNI` por padrão (fallback seguro). O filtro da aba Salas agora é por tipo de equipamento.
- Tipos disponíveis:
  - `UNI` — Universitária (padrão)
  - `CCM` — Carteira e Cadeira Medicina
  - `CC` — Carteira e Cadeira
- Como testar: Criar/editar uma sala e verificar se o dropdown de tipo de equipamentos aparece no lugar do campo Bloco.
- Como reverter: Restaurar o campo `room-block` no HTML e `block` no JS.

### [2026-05-26] Simulador Simplificado — Apenas Tipo (Presencial / EAD / Carga Reservada)
- Autor: Antigravity
- Branch: ensalamento
- Arquivos alterados:
  - `/planejamento-academico/ensalamento.js` (função `renderSimulationLessons`, `updateLesson`, `addLessonToSimulation`, `applyInstitutionalPattern`)
- Tipo: Simplificação de UI/UX
- Motivo: O simulador anterior exibia muitos campos por aula (nome de disciplina, período, modo de sala, sala específica, tipo de sala), causando confusão. Como a instituição opera exclusivamente no turno noturno com período fixo (P1+P2 — Noite Inteira) e usa sempre o modo automático (I.A.), esses campos foram removidos.
- Impacto: Cada aula no simulador exibe apenas um campo: **Tipo** (Presencial / EAD / Carga Reservada). Período é fixado em `[1, 2]` e `roomSelectionMode` é sempre `'auto'`. O padrão Institucional (3+2) funciona como antes.
- Como testar: Abrir o Simulador, clicar em "Padrão (3+2)" e verificar se cada aula exibe apenas o seletor de Tipo. Adicionar uma aula avulsa e confirmar que não há campos extras.
- Como reverter: Restaurar a versão anterior de `renderSimulationLessons` com todos os campos.

### [2026-05-26] Correção: Coleção `simulations` liberada na API
- Autor: Antigravity
- Branch: ensalamento
- Arquivos alterados:
  - `/api/rotas/ensalamento.js` (adicionado `'simulations'` ao array `ALLOWED_COLS`)
- Tipo: Correção de Bug (403 Forbidden)
- Motivo: Ao tentar salvar o resultado de uma simulação, a API retornava `403 Coleção não permitida` porque a coleção `simulations` não estava na whitelist de coleções autorizadas do CRUD genérico.
- Impacto: O simulador agora consegue salvar e recuperar resultados de simulações no Firestore.
- Como testar: Rodar uma simulação no Simulador e verificar se nenhum erro 403 aparece no console.

### [2026-05-26] Correções de Contraste e Visual no Módulo de Planejamento Acadêmico
- Autor: Antigravity
- Branch: ensalamento
- Arquivos alterados:
  - `/planejamento-academico/ensalamento.css` (classes `.pill-ead` e `.pill-reservada`)
  - `/planejamento-academico/ensalamento.js` (texto de turmas na tabela de ocupação, botão deletar)
  - `/planejamento-academico/index.html` (botão "Ajustar Necessidades" no simulador)
- Tipo: Correção de UI / Acessibilidade
- Problemas corrigidos:
  - **Botão "Ajustar Necessidades"**: Tinha `background: rgba(255,255,255,0.05)` — texto branco em fundo branco/transparente = invisível. Corrigido para `background: #1E293B` (azul marinho escuro).
  - **Pill EAD**: Sem background, texto amarelo em fundo branco = invisível. Corrigido para `background: #FEF9C3; color: #854D0E`.
  - **Pill Reservada**: Background roxo muito transparente. Corrigido para `background: #F3E8FF; color: #7E22CE`.
  - **Nome das turmas na tabela**: Estava `color: rgba(255,255,255,0.4)` (branco em fundo branco). Corrigido para `color: #64748B`.
  - **Botão deletar na tabela**: Opacidade `0.3` aumentada para `0.6` com hover chegando a `1.0`.
- Como testar: Acessar a aba Calendário → Mapa de Ocupação e verificar se os pills de EAD e Reservada são legíveis. Verificar se o botão "Ajustar Necessidades" no Simulador está visível.

### [2026-05-26] Gerenciar Acessos: Renomeação e Adição do Módulo Parceiros
- Autor: Antigravity
- Branch: ensalamento
- Arquivos alterados:
  - `/usuarios/app.js` (array `MODULES` e permissões padrão de novos cargos)
- Tipo: Atualização de Identidade e Cobertura de Permissões
- Motivo: O card de módulo na tela de Gerenciar Acessos ainda exibia "Ensalamento" em vez de "Planejamento Acadêmico". Além disso, o módulo "Parceiros" (empresas) não aparecia nos cards de permissão, impossibilitando o controle granular de acesso a ele.
- Impacto:
  - O card agora exibe `🏫 Planejamento Acadêmico` (ID interno `ensalamento` mantido).
  - Novo card `🤝 Parceiros` (ID `empresas`) adicionado à lista.
  - Novos cargos criados pelo sistema já recebem o campo `empresas: 1` (Sem Acesso) por padrão.
- Como testar: Acessar Usuários → Gerenciar Acessos e verificar se aparecem os cards de "Planejamento Acadêmico" e "Parceiros".

### [2026-05-27] Ajuste na Simulação de Aulas Não Presenciais (EAD/Carga Reservada) e Otimização do Consumo do Firebase
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/api/rotas/ensalamento.js` (Rota `/custom/checkConflict` adaptada para validar conflitos apenas entre aulas presenciais/EAD concorrentes)
  - `/planejamento-academico/firebase-service.js` (Atualização de `checkConflict` para aceitar e passar o `classType`)
  - `/planejamento-academico/ensalamento.js` (Passagem do `classType` nas validações de conflito ao salvar no calendário; implementado fallback na função `loadLessonsFromMatrix` para buscar disciplinas de outros períodos letivos do mesmo ano caso não existam no período letivo atual, resolvendo o problema de matrizes não carregando quando turmas e disciplinas estão cadastradas em períodos alternados, como 2026.1 e 2026.2; implementado lazy loading no `openSimulationModal` para carregar disciplinas apenas quando a ferramenta de simulação for aberta, economizando 501 leituras no Firestore a cada carregamento de página e a cada salvamento)
  - `/planejamento-academico/simulation-engine.js` (Prioridade de ordenação ajustada, motor `areClassesAvailable` adaptado para não bloquear slots por carga reservada, `scoreWeeklyDistribution` e `attemptAllocation` ajustados para não aplicar penalidades ou marcar a simulação como inviável caso a carga reservada fique como "Não Alocada"; corrigido ReferenceError da variável `unallocated` ao substituí-la por `unallocatedBlocking` na verificação de distribuição ideal)
  - `/usuarios/app.js` (Aumento do timer de polling para 2min, verificação de visibilidade da aba via `document.hidden`)
  - `/meu-espaco/meu-espaco.js` (Aumento dos timers de notas e avisos para 2min, verificação de `document.hidden`)
  - `/emprestimo/app.js` (Aumento de timers de polling para 2min, verificação de `document.hidden`)
  - `/rh/funcionarios/app.js` (Aumento do timer de atualização para 2min, verificação de `document.hidden`)
  - `/rh/carga-horaria/carga-horaria.js` (Aumento do timer de atualização para 2min, verificação de `document.hidden`)
- Tipo: Correção de Regras de Negócio e Otimização de Performance/Custos (Firebase)
- Motivo:
  - O simulador de grade gerava pontuações baixas e sugestões "INVIÁVEIS" devido ao limite de 5 dias na semana concorrendo com 6 aulas totais. Como a **Carga Reservada** não ocupa espaço e os alunos não têm aula física, ela deve poder ficar "Não Alocada" (`weekday: null`) sem penalidade, e a aula de **EAD** deve ocupar seu próprio dia de semana sem coexistir com aulas presenciais.
  - O consumo do Firebase atingiu 97% da cota gratuita diária. Identificamos que requisições de segundo plano (`setInterval`) estavam rodando excessivamente de forma desnecessária, mesmo quando as abas do navegador estavam ocultas ou inativas.
- Impacto:
  - Simulações geradas com sucesso com a Carga Reservada alocada de forma adequada (ou não alocada de forma segura) e EAD respeitando o dia útil dedicado, resultando em status "BOA/IDEAL" e scores altos (>150).
  - Redução drástica nas leituras do Firestore (estimada em mais de 90% em abas ociosas e 4x em abas ativas), garantindo a longevidade da cota gratuita do banco de dados.
- Como testar:
  - No simulador, rodar a simulação para uma turma com 6 matérias (ex: 3 presenciais, 2 EAD, 1 Carga Reservada) e verificar se o resultado dá "BOA/IDEAL" e a Carga Reservada vai para "Não Alocada" de forma pacífica.
  - Abrir a aba de Rede (Network) no navegador, alternar de aba (minimizando o Órbita) e verificar que as requisições recorrentes cessam em segundo plano.
- Como reverter: Desfazer as alterações de código e restaurar as versões anteriores dos arquivos listados.

### [2026-05-28] Cadastro de Itens Genéricos e Suporte a Itens sem QR Code (Módulo de Empréstimos)
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/emprestimo/index.html` (Adicionado botão "Cadastrar Item", modal de cadastro com datalist de tipos e checkbox de QR Code; placeholders genéricos)
  - `/emprestimo/app.js` (Adicionado lógica de controle do modal, submissão do formulário com validação de ID duplicado e persistência no banco, exibição do tipo do item nos cards, desativação de QR em itens configurados sem ele, e refatoração do scanner para extrair IDs arbitrários)
- Tipo: Nova Funcionalidade e Melhoria de UX
- Motivo: O módulo de empréstimos suportava apenas notebooks de forma estrita. Havia a necessidade de cadastrar e rastrear outros tipos de itens (projetores, adaptadores, etc.) e controlar se o item possui etiqueta física de QR Code ou não. O scanner de QR Code precisava reconhecer os novos códigos genéricos sem ficar restrito à regex antiga.
- Impacto: Maior flexibilidade no controle de inventário. Agora o usuário pode gerenciar qualquer ativo da instituição com ou sem rastreamento de QR.
- Como testar:
  - Acessar o módulo de Empréstimos.
  - Clicar em "Cadastrar Item" e preencher um ID (ex: Proj_01) e tipo (ex: Projetor) com a caixa de QR ativa. Validar se o card renderiza e permite "GERAR QR".
  - Cadastrar outro item desmarcando o QR Code. Confirmar que ele exibe a pill desabilitada "SEM QR".
  - Escanear um QR code de item genérico e verificar se redireciona para a página de movimentação com sucesso.
- Como reverter: Desfazer as alterações nos arquivos listados e restaurar as versões anteriores.

### [2026-05-28] Reformulação do Cartão FATEC, QR Code Fixo e Impressão de PDF Dobrável
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/fidelidade/index.html` (Reposicionado o botão "Voltar ao Painel" para o canto esquerdo da marca; removida a barra de progresso e timer de 30s; adicionado botão "Imprimir / Gerar PDF" abaixo do QR code; incluída a div `#print-area` no final do corpo; removido seletor de cargo do cartão; adicionada a imagem `logoFatec.png` no lugar do logo de texto FATEC)
  - `/fidelidade/fidelidade.css` (Atualizado as variáveis globais `:root` para o "Light Theme" do Órbita; mantido o estilo degradê escuro do cartão físico digital; adicionadas regras `@media print` para renderizar o cartão duplo dobrável com a linha tracejada e QR code compacto no verso; estilizada a imagem do logotipo do FATEC no cartão com filtro de brilho invertido para contraste premium; ajustados botões e categorias para o tema claro)
  - `/fidelidade/fidelidade.js` (Removido o temporizador de QR Code de 30 segundos e sua interface; modificado a URL geradora do QR Code para conter apenas o `uid` estático do usuário; implementado o status checker leve de 2 minutos que respeita a inatividade da aba via `document.hidden`; implementado a função global `window.gerarPDF()` para montagem do layout dobrável com frente e verso e disparo nativo de impressão)
  - `/fidelidade/validar.html` (Removida a validação obrigatória do parâmetro `t` e expiração de 45 segundos; adaptada a interface do validador para aceitar leituras do QR Code estático com validação direta de status de inatividade no banco de dados)
- Tipo: Evolução de UI/UX, Otimização de Performance e Redução de Leitura (Firestore)
- Motivo: Alinhar visualmente o módulo FATEC Fidelidade com a identidade institucional clara do Órbita, melhorar a usabilidade do cartão móvel utilizando a logo oficial `logoFatec.png` sem exibir cargos redundantes, permitir a impressão física de um cartão duplo dobrável com frente e verso (QR Code atrás), e reduzir consideravelmente o consumo de leitura do banco de dados do Firebase.
- Impacto: Identidade visual perfeitamente alinhada e premium. Menor sobrecarga na cota de leitura do banco Firebase. Lojistas e funcionários conseguem imprimir uma carteirinha frente e verso para recortar e dobrar, e a validação do QR Code estático impresso no papel continua 100% segura contra inativações de conta em tempo real.
- Como testar:
  - Acessar `/fidelidade/index.html`. Verificar se a página está sob o Light Theme, se o logo `logoFatec.png` branco e o subtexto "Fidelidade" aparecem na carteirinha e se o cargo não é mais exibido.
  - Verificar que o botão de voltar está na esquerda do cabeçalho.
  - Validar que o QR Code estático é renderizado logo abaixo e não pisca a cada 30s.
  - Clicar em "Imprimir / Gerar PDF" e confirmar se no preview de impressão o cartão duplo (Frente, linha de dobra e Verso com o QR Code) aparece centralizado em folha A4 e sem outros elementos.
- Como reverter: Desfazer as alterações nos arquivos `/fidelidade/index.html`, `/fidelidade/fidelidade.css`, `/fidelidade/fidelidade.js` e `/fidelidade/validar.html`.

### [2026-05-28] Ajustes de Layout e Branding na Tela de Validação (FATEC Fidelidade)
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/fidelidade/validar.html` (Substituído a marca interna "FATEC Fidelidade" pela logo oficial azul da FATEC `fateclogoazul.png` ampliada para 84px dentro do card de status de validação, removendo a logo externa; reajustado a sombra e bordas internas da página para o padrão do Light Theme; alterado o estado inicial e cores de "Carregando..." do laranja para o azul institucional)
- Tipo: Evolução de UI/UX e Consistência de Branding
- Motivo: Alinhar a tela pública de validação de cartões com a identidade visual institucional, fornecendo grande visibilidade à logo azul no cabeçalho interno e definindo o carregamento na cor azul padrão da instituição.
- Impacto: Interface de validação limpa, com branding evidente e profissional.
- Como testar: Acessar a rota `/fidelidade/validar.html?u=[uid]` e verificar se a logo azul da FATEC está ampliada no cabeçalho do card de status, se o indicador inicial de "Carregando..." está azul, e se não há textos de marca redundantes fora do card.
- Como reverter: Reverter as edições efetuadas no arquivo `/fidelidade/validar.html`.

### [2026-05-29] Melhorias de Categorização e Estatísticas por Categoria no Módulo de Empréstimos
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/emprestimo/index.html` (Adicionado select de Categoria na barra de filtros superior; alterado o input de texto de tipo do item por um select com botão inline para adicionar novas categorias na hora)
  - `/emprestimo/app.js` (Adicionado controle de persistência de categorias padrão e customizadas em localStorage; implementado carregamento dinâmico que lê o banco Firestore e importa categorias ativas existentes; adicionado suporte a filtragem do grid e dos cards de estatísticas superiores baseada na categoria selecionada; implementado atualizador de label que anexa o nome da categoria selecionada nos títulos dos cards; adicionado renderização dinâmica de listas de categorias internas [breakdowns] em cada card de status, com eventos de clique associados para filtrar por status e tipo simultaneamente)
  - `/emprestimo/emprestimo.css` (Adicionado classes `.stat-breakdown`, `.breakdown-row`, `.breakdown-name` e `.breakdown-count` com transições hover e estilização de badges para visualização das categorias no interior dos cartões de estatísticas)
- Tipo: Evolução de Usabilidade e Análise de Dados
- Motivo: Com o suporte a múltiplos tipos de equipamentos (notebooks, projetores, etc.), o dashboard de empréstimos exibia números totais consolidados, dificultando saber exatamente a quantidade de cada equipamento por status. Havia a necessidade de cadastrar novas categorias sob demanda de forma rápida no modal e poder visualizar estatísticas distintas para cada equipamento na tela inicial, além de atalhos rápidos para listar subgrupos específicos.
- Impacto: Análise distinta e rápida das quantidades de cada tipo de equipamento na tela inicial e facilitação no cadastro padronizado de novos equipamentos com categorias.
- Como testar:
  - Acessar `/emprestimo/index.html`.
  - Clicar em "Cadastrar Item". Verificar se o campo "Tipo" agora é um select com opções: Notebook, Passador, Caixa de Som, Projetor.
  - Clicar no botão "+" ao lado de tipo, digitar uma nova categoria (ex: Câmera), salvar e verificar se ela se torna a selecionada.
  - No filtro de pesquisa, alterar "Categoria" de "Todos" para "Notebook" e verificar se as estatísticas superiores (Total, Disponíveis, etc.) são atualizadas apenas com dados de notebooks, e se as labels mudam para `Total (Notebook)`, `Disponíveis (Notebook)`, etc.
  - Com o filtro geral em "Todos", verifique que cada card superior exibe sua respectiva lista de categorias com quantidades (ex: `Notebook: 10`, `Passador: 3` sob Disponíveis).
  - Clique na linha "Passador" no card de "Disponíveis" e veja se o grid e os seletores de filtros mudam automaticamente para exibir apenas os passadores disponíveis.
- Como reverter: Desfazer as edições nos arquivos `/emprestimo/index.html`, `/emprestimo/app.js` e `/emprestimo/emprestimo.css`.

### [2026-05-29] Correção de Categorias Legadas, Visual Mobile do Toolbar e Cache-Busters (Empréstimos)
- Autor: Antigravity
- Branch: main
- Arquivos alterados:
  - `/emprestimo/index.html` (Adicionados e atualizados parâmetros cache-buster para `?v=3` nos links do CSS e do JS para forçar atualização no navegador)
  - `/emprestimo/app.js` (Lógica de normalização em `loadNotebooks()` convertendo `"Outros"`, `"outro"`, `"notbooks"`, `"notbook"` e nulos para `"Notebook"`; higienizada a lista de categorias em `loadCategories()` excluindo `"Outros"`; simplificada a ativação de abas usando `data-category`)
  - `/emprestimo/emprestimo.css` (Implementado layout empilhado verticalmente para a barra de buscas e o botão de cadastro no celular através de `flex-direction: column` no `.toolbar-top`, com botão "+ Cadastrar Item" ocupando a largura total (100% width) e ícone/texto perfeitamente centralizados)
- Tipo: Ajuste de UI/UX Responsivo, Correção de Dados e Cache-Busting
- Motivo: O usuário informou que o layout estava poluído e questionou a origem da categoria "Outros" (itens legados). Posteriormente, apontou que a barra de busca e o botão "+ Cadastrar Item" estavam sobrepostos e muito espremidos no layout móvel.
- Impacto: Interface móvel e desktop perfeitamente consistentes. O botão de cadastro agora ocupa toda a largura em celulares de forma elegante e centralizada abaixo da barra de busca, sem sobreposições. Os dados legados são auto-corrigidos para "Notebook".
- Como testar:
  - Acessar o módulo de empréstimos em um dispositivo móvel. Confirmar que a barra de busca e o botão "Cadastrar Item" não se sobrepõem e que o botão ocupa toda a largura abaixo da busca.
  - Verificar que a categoria "Outros" não consta mais nos filtros e abas.
- Como reverter: Desfazer as edições nos arquivos `/emprestimo/index.html`, `/emprestimo/app.js` e `/emprestimo/emprestimo.css`.





