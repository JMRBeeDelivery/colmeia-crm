# Colmeia CRM

CRM dos comerciais da Bee Delivery. Cada comercial entra com o e-mail @beedelivery.com.br e vê só as lojas das suas praças; a supervisão vê a regional inteira; o gestor vê tudo.

- **Metas do mês** por praça, com três indicadores:
  - **corridas** (entregas finalizadas): produzido, % atingido, projeção e corridas/dia que faltam;
  - **empresas com entregas**: lojas com ao menos uma entrega no mês;
  - **taxa de sucesso**: entregas finalizadas ÷ pedidos.
- **Funil de lojas** em 8 fases: Prospecção, Ativação, Inativos, 1 a 50, 51 a 100, 101 a 500, 501 a 1000 e +1000 entregas.
- **Detalhe da loja**: contato, WhatsApp, histórico de ligações/visitas e tarefas.
- **Base diária**: um script do TI extrai os dados do banco para um arquivo no **SharePoint** ou uma planilha do **Google Sheets**; o GitHub Actions lê essa base todo dia às 06:00 e atualiza as lojas.
- Funciona no computador e no celular (pode ser instalado na tela inicial).

## Como funciona

```
GitHub Pages (index.html + assets/)  ──►  Supabase (login por link + Postgres com RLS)
                                               ▲
GitHub Actions (sync diário, 06:00)  ──────────┘  lê a base e grava via service_role
          ▲
SharePoint (.xlsx/.csv) ou Google Sheets  ◄──  script de extração do banco da Bee (antes das 06:00)
```

- **Sem servidor próprio e sem build.** O site é HTML + JavaScript puro.
- **A segurança fica no banco.** As regras de acesso (Row Level Security) do Postgres decidem quais linhas cada pessoa pode ler e alterar. A chave pública que vai no site não dá acesso a nada sozinha.
- **Só entra quem está cadastrado.** Um gatilho no banco recusa qualquer e-mail que não seja @beedelivery.com.br ou que não esteja na tabela `pessoas`. O domínio aceito fica em `assets/config.js` (`dominiosEmail`) e na migração 005; mantenha os dois iguais.
- **Login com e-mail e senha, sem envio de e-mail.**
  - As contas são criadas pelo gestor (`liberar_acesso`, migração 006) com a **senha inicial**.
  - No primeiro acesso, o app obriga a pessoa a criar a própria senha.
  - Quem esquecer a senha pede ao gestor: **Gestão → Equipe e acessos → Redefinir senha**.
  - Para trocar a senha a qualquer momento, clique no próprio nome no topo.
  - A senha inicial **não fica no repositório**: ela é gravada só no banco, pelo arquivo local `supabase/local/acessos-equipe.sql`.

## Colocar no ar (cerca de 30 minutos)

### 1. Supabase
1. Crie um projeto em [supabase.com](https://supabase.com) (região São Paulo).
2. Em **SQL Editor**, rode nesta ordem: `supabase/migrations/001_schema.sql`, `002_ativacao_carga_inicial.sql`, `003_metas_indicadores.sql`, `004_pedidos_mes_anterior.sql`, `005_dominios_email.sql`, `006_login_com_senha.sql` e depois `supabase/seed.sql` (o seed usa as colunas de metas da 003).
3. Rode também `supabase/local/acessos-equipe.sql`. Ele grava os e-mails do gestor, dos 2 supervisores e dos 18 comerciais, define a **senha inicial** e cria o login de cada um. Esse arquivo **não vai para o git**, porque o repositório do GitHub Pages costuma ser público. Guarde uma cópia fora dele.
4. Em **Authentication → Sign In / Providers**:
   - deixe o provedor *Email* ligado;
   - **desligue "Allow new users to sign up"**, para que só as contas criadas pelo gestor existam.
5. Em **Authentication → URL Configuration**, coloque a URL do GitHub Pages (passo 2) em *Site URL*.

O login é por senha, então não é preciso configurar envio de e-mail (SMTP).

### 2. GitHub
1. Crie o repositório e envie este código:
   ```bash
   git init && git add . && git commit -m "Colmeia CRM"
   git branch -M main
   git remote add origin git@github.com:SUA-ORG/colmeia-crm.git
   git push -u origin main
   ```
2. Em **Settings → Pages**, escolha *Source: GitHub Actions*.
3. Em **Settings → Secrets and variables → Actions**:
   - **Variables**: `SUPABASE_URL` e `SUPABASE_ANON_KEY` (Supabase → Project Settings → API).
   - **Secrets**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e os da origem da base escolhida no passo 3.
4. Rode **Actions → Publicar no GitHub Pages** para publicar. A URL aparece no resumo da execução.
5. Rode **Actions → Sync diário da base → Run workflow**, marcando *Só simular*, para testar a leitura da base sem gravar nada.

### 3. Base diária: SharePoint ou Google Sheets
O arquivo fica entre o banco da Bee e o CRM. Assim o GitHub não precisa acessar a rede interna.
Configure **uma** origem: o sync recusa rodar com duas preenchidas, para não ler uma base desatualizada por engano. Para trocar de origem, apague os secrets da antiga.

**Script de extração (TI), vale para as duas:** roda a consulta no banco e grava o resultado antes das 06:00.
Use `integracao/consulta-modelo.sql` como ponto de partida. O script deve:
- gravar a 1ª linha com os nomes de coluna da tabela [Formato da base](#formato-da-base) e depois 1 linha por loja;
- **substituir o arquivo (ou a aba) inteiro** a cada execução, sem acrescentar linhas no fim;
- incluir todas as lojas clientes, inclusive as com 0 entregas no mês.

#### Opção A · SharePoint (Microsoft 365)
O arquivo pode ser **.xlsx** (a primeira aba, ou a indicada em `SHAREPOINT_ABA`) ou **.csv**.

Sem código, o TI pode montar a extração no **Power Automate**: fluxo agendado → *SQL Server: Executar uma consulta* (com o gateway de dados local, se o banco for interno) → *Criar tabela CSV* → *SharePoint: Criar arquivo* (substituindo `base-crm.csv`).

Acesso do CRM ao arquivo (precisa de um **administrador do Microsoft 365**):
1. **Registrar o app:** em [entra.microsoft.com](https://entra.microsoft.com) → *Registros de aplicativo* → *Novo registro*, com o nome "Colmeia CRM sync". Anote o **ID do diretório (locatário)** e o **ID do aplicativo (cliente)**.
2. **Segredo:** em *Certificados e segredos* → *Novo segredo do cliente*. Copie o **valor** na hora, porque ele não aparece de novo. Anote a data de expiração: quando o segredo vencer, o sync para de funcionar até ser trocado.
3. **Permissão mínima:** em *Permissões de API* → *Microsoft Graph* → *Permissões de aplicativo*, adicione **Sites.Selected** e clique em *Conceder consentimento do administrador*. Sozinha, essa permissão não dá acesso a nada.
4. **Liberar só o site da base, só para leitura.** Com o PnP PowerShell:
   ```powershell
   Grant-PnPEntraIDAppSitePermission -AppId <ID-DO-APLICATIVO> -DisplayName "Colmeia CRM sync" -Site https://bee.sharepoint.com/sites/<SITE> -Permissions Read
   ```
   Em versões antigas do PnP PowerShell, o comando se chama `Grant-PnPAzureADAppSitePermission`. Pelo Graph Explorer, a chamada equivalente é `POST https://graph.microsoft.com/v1.0/sites/{id-do-site}/permissions` com o corpo `{"roles":["read"],"grantedToIdentities":[{"application":{"id":"<ID-DO-APLICATIVO>","displayName":"Colmeia CRM sync"}}]}`.
5. **Secrets no GitHub:** `SHAREPOINT_URL`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` e `AZURE_CLIENT_SECRET`. Opcional: a variable `SHAREPOINT_ABA`.

Em `SHAREPOINT_URL`, use o **caminho direto** do arquivo: no SharePoint, selecione o arquivo → *Detalhes* → *Caminho* → copiar.
Exemplo: `https://bee.sharepoint.com/sites/Comercial/Shared%20Documents/CRM/base-crm.xlsx`.
Links de compartilhamento (`/:x:/s/…`) não servem, porque exigiriam uma permissão bem mais ampla (acesso a todos os arquivos da empresa).

#### Opção B · Google Sheets
1. **Conta de serviço (planilha privada):**
   1. Em [console.cloud.google.com](https://console.cloud.google.com), crie um projeto e ative a **Google Sheets API**.
   2. Em *IAM e administrador → Contas de serviço*, crie uma conta (sem papéis) e gere uma chave **JSON**.
   3. Cole o conteúdo do arquivo no secret `GOOGLE_SERVICE_ACCOUNT_JSON`.
   4. Na planilha, clique em **Compartilhar** e adicione o `client_email` da conta como **Leitor**.
2. **Link da planilha:** copie o endereço da barra do navegador, já na aba da base, e salve no secret `GOOGLE_SHEETS_URL`. Opcional: a variable `GOOGLE_SHEETS_ABA`.

Sem `GOOGLE_SERVICE_ACCOUNT_JSON`, o sync tenta ler a planilha pelo link. Nesse caso, ela precisa estar como "Qualquer pessoa com o link: Leitor", o que deixa os dados visíveis para quem tiver o link.

> A leitura por uma API da base (`BASE_API_URL` e `BASE_API_TOKEN`) continua disponível como terceira opção.

### 4. Equipe
1. Entre no app com o e-mail do gestor e a senha inicial, e crie a sua senha.
2. Pessoa nova: em **Gestão → Equipe e acessos → Adicionar pessoa**, informe o e-mail. O login é criado na hora, com a senha inicial.
3. Mande a URL para a equipe com a senha inicial, de preferência por um canal interno e não junto com o link público. Cada pessoa entra com o próprio e-mail e cria a sua senha.

## Metas do mês

Cada praça tem três metas, que podem ser editadas uma a uma em **Gestão → Estrutura e metas**:
- `meta`: corridas (entregas finalizadas);
- `meta_empresas`: empresas com entregas;
- `meta_taxa_sucesso`: de 0 a 1, digitada em % na tela.

**Todo mês:** na planilha de metas, copie a aba do mês com o cabeçalho (como "Comerciais - Setembro": `CIDADE`, `Entregas Finalizadas`, `Empresas com Entregas`, `Taxa de Sucesso`). Cole em **Gestão → Importar metas do mês**.
- **Conferir metas** mostra o que vai mudar em cada praça.
- **Aplicar metas** grava.
- Praças com "–" ficam sem meta; as que não estiverem na planilha não mudam.
- As colunas extras da planilha (Supervisor, Comercial, Total Pedidos, Cancelamentos) são ignoradas.

**Como cada indicador é medido:**
- **Corridas:** soma de `entregas_mes` das lojas da praça, recalculada pelo sync.
- **Empresas com entregas:** lojas da praça com entrega no mês atual.
- **Taxa de sucesso:** Σ entregas ÷ Σ pedidos das lojas. Só aparece quando a base traz **pedidos** ou **cancelamentos** por loja (veja [Formato da base](#formato-da-base)); até lá, a tela mostra "sem dado" ao lado da meta.

Nos totais (regional, supervisor, geral), corridas e empresas são somadas. A taxa é ponderada pelos pedidos, como na planilha: Σ metas ÷ Σ (meta ÷ taxa-meta).

## Rodar na sua máquina

```bash
npm install
npm test                 # regras de fase, cidade → praça e leitura do Sheets/SharePoint/.xlsx
npm run sync:teste       # simula o sync com data/exemplo-base.json, sem gravar
node scripts/sync.mjs --arquivo base.xlsx --simular   # confere um arquivo da base, sem gravar
npm run dev              # abre o site em http://localhost:5173
```

Para testar o login localmente, adicione `http://localhost:5173` em *Redirect URLs* no Supabase.

Para rodar o sync de verdade na sua máquina, copie `.env.exemplo` para `.env`, preencha e rode `npm run sync`.

## Formato da base

Uma aba de .xlsx no SharePoint, uma aba do Google Sheets ou um CSV/JSON com cabeçalho, uma linha por loja. Os nomes de coluna alternativos aceitos estão em `assets/base.js` (`ALIAS`). Acentos, maiúsculas e espaços no cabeçalho não importam ("Entregas Mês" = `entregas_mes`).
Datas podem vir como data do Excel/Sheets, `AAAA-MM-DD` ou `DD/MM/AAAA`. CSV pode ser UTF-8 ou o padrão do Excel no Brasil. CNPJ gravado como número tem os zeros à esquerda recuperados.

| Campo | Obrigatório | Exemplo |
|---|---|---|
| `codigo` | sim | `LJ-10482` |
| `nome` | sim | `Padaria Pão Dourado` |
| `cidade` + `uf` (ou `praca`) | sim | `Natal`, `RN` |
| `cnpj` | recomendado | liga a loja a uma prospecção cadastrada pelo comercial |
| `bairro`, `endereco`, `responsavel`, `telefone` | não | campos vazios não apagam o que o comercial preencheu |
| `data_cadastro`, `data_primeira_entrega`, `ultima_entrega` | não | `2026-05-20` ou `20/05/2026` |
| `entregas_mes`, `entregas_mes_anterior` | sim | `64`, `81` |
| `mes_referencia` | recomendado | `2026-09` |
| `pedidos_mes` ou `cancelamentos_mes` | para a taxa de sucesso | `152` / `12` (também aceita `Canceladas Set/26`, `Cancelamentos Set/26`, `Pedidos Set/26`, `Total Pedidos`) |

**Formato atual da base da Bee** (`Empresas_Sem_Rede_Entregas_…xlsx`), aceito como está:
- `ID Empresa` vira o código, `Loja` o nome e `Operação` ("NATAL/RN", "BELÉM/PA-ANANINDEUA/PA") a praça;
- nas colunas com o nome do mês (`Finalizadas Ago/26`, `Finalizadas Set/26 (01–27)`, ou `Entregas …` na versão antiga), a do mês mais recente vira `entregas_mes` e define o `mes_referencia`; a do mês anterior vira `entregas_mes_anterior`;
- `Canceladas <Mês>/<AA>` do mês de referência, somada às finalizadas, dá os pedidos do mês e, com eles, a **taxa de sucesso**. Totais e `% Cancelamento Ago+Set` são ignorados;
- linha sem nenhuma coluna de entregas reconhecível é **recusada**, em vez de gravada com zero. Se a extração renomear a coluna, o sync falha e avisa no GitHub Actions;
- as canceladas do mês anterior também são guardadas (`pedidos_mes_anterior`), para mostrar o volume de cancelamentos dos dois meses;
- lojas que só tiveram pedidos cancelados (0 finalizadas nos dois meses) ficam em **Inativos**, com a etiqueta **"Só cancelamentos"**. Não entram em Prospecção, que é só das lojas cadastradas pelo comercial. O volume de cancelamentos é sinalizado assim:
  - no cartão, o número em destaque (em vermelho) passa a ser o total de pedidos cancelados nos dois meses, com a divisão por mês;
  - a coluna Inativos do Funil é ordenada pela demanda (entregas do mês anterior + cancelados), então as lojas com muitos cancelamentos sobem;
  - o contador de Inativos mostra quantas lojas são só de cancelamentos;
  - na aba Lojas, a coluna **Canceladas** (dois meses) pode ser ordenada para ver as maiores;
  - loja que parou de entregar e cancelou pedidos no mês recebe a etiqueta "N canceladas no mês";
- linhas com `Tipo Operação` = **Franquia** são descartadas, porque o CRM é só para operações próprias. O sync informa quantas ficaram de fora, e elas não aparecem como "cidade sem praça";
- as demais colunas (Comercial, Supervisor, Grupo Regional, Total) são ignoradas. Quem cuida de cada praça é definido na aba Gestão.

**Ativação sem a data da 1ª entrega:**
- **Carga inicial:** na primeira importação de cada praça, nenhuma loja entra em Ativação. A base existente é tratada como cliente já estabelecido.
- **Depois disso:** loja que aparece pela primeira vez na base com entregas, ou prospecção que vira cliente pelo CNPJ, recebe como 1ª entrega o dia dos dados (ontem). Ela fica 30 dias em Ativação.
- **Com a data informada:** se um dia a base trouxer `data_primeira_entrega`, ela prevalece.

A regra está em `importar_base` (`supabase/migrations/002_ativacao_carga_inicial.sql`), e o resumo de cada sync mostra quantas lojas entraram em Ativação.

Para conferir um arquivo antes de usar: `node scripts/sync.mjs --arquivo base.xlsx --simular`. O comando mostra lojas por praça e por fase, sem gravar nada.

Cidades sem praça cadastrada são ignoradas e aparecem no log do sync. Para incluir uma cidade, cadastre a praça (aba Gestão) ou adicione a cidade em `pracas.aliases`.

## Estrutura

```
index.html                 app (HTML + CSS)
assets/app.js              telas, login e acesso ao Supabase
assets/base.js             regras compartilhadas: fases, leitura da base, cidade → praça
assets/config.js           URL e anon key do Supabase (públicas)
scripts/sync.mjs           sync diário (Node 22)
scripts/sharepoint.mjs     leitura do arquivo no SharePoint (Microsoft Graph, app com Sites.Selected)
scripts/gsheets.mjs        leitura da planilha do Google Sheets (conta de serviço ou link)
scripts/xlsx.mjs           leitor de .xlsx sem dependências
scripts/*.test.mjs         testes das regras e das leituras (Google e Microsoft simulados localmente)
integracao/                consulta SQL modelo para o script de extração do banco
supabase/migrations/       tabelas, regras de acesso (RLS) e funções
supabase/seed.sql          regionais, 39 praças, 21 pessoas e metas de set/2026
.github/workflows/         publicação no Pages e sync diário
data/exemplo-base.json     base de exemplo para testes
```
