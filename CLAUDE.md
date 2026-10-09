# CLAUDE.md — Colmeia CRM

Contexto para o Claude Code trabalhar neste repositório.

## O que é
CRM dos comerciais da Bee Delivery (entregas por app). Cada comercial cuida de uma ou mais **praças** (cidades de operação) e acompanha as **lojas** (clientes) dessas praças. As praças são agrupadas em **regionais**, cada uma com um supervisor. Usuários: gestor comercial, supervisores e comerciais. Todos usam o app no celular e no computador.

Idioma: toda a interface, mensagens, commits e comentários em **português do Brasil**.

## Stack
- **Frontend:** `index.html` + `assets/*.js` como módulos ES, **sem build e sem framework**. Hospedado no GitHub Pages. supabase-js vem do jsdelivr com versão fixa.
- **Backend:** Supabase. Login por link no e-mail (magic link) e Postgres com Row Level Security.
- **Sync:** `scripts/sync.mjs` (Node 22), rodado pelo GitHub Actions todo dia às 09:00 UTC. Lê a base que o script de extração do banco alimenta, de **uma** origem: SharePoint (`scripts/sharepoint.mjs` + `scripts/xlsx.mjs`), Google Sheets (`scripts/gsheets.mjs`) ou API (`BASE_API_URL`). Com duas origens configuradas, o sync falha de propósito.
- **Testes:** `npm test` (`scripts/*.test.mjs`, sem dependências; simulam o Google e a Microsoft em servidores locais).

Comandos: `npm test`, `npm run dev`, `npm run sync:teste` (simulação offline) e `npm run sync`.

## Regras de negócio (fonte da verdade: `assets/base.js`)
Fases da loja, calculadas no cliente a partir dos números da base (`classificar`):
1. **Prospecção**: loja criada pelo comercial (`origem = 'prospeccao'`, ou sem `codigo` quando não há origem) que nunca entregou. Loja da base **nunca** é Prospecção. Se só teve pedidos cancelados, cai em Inativos com `longo = true` e `soCancelamentos = true`. `classificar` devolve `cancelados` (mês), `canceladosAnt` (mês anterior, de `pedidos_mes_anterior`, migração 004) e `cancelados2m`, respeitando a virada de mês. A coluna Inativos é ordenada por `ant + cancelados2m`.
2. **Ativação**: menos de 30 dias desde `primeira_entrega`. A base não traz essa data, então `importar_base` (migração 002) a preenche: na **carga inicial** de cada praça (nenhuma loja da praça com `entrou_na_base` anterior a hoje), fica vazia, porque a base existente não é Ativação. Depois disso, loja inédita com entregas e prospecção convertida recebem `current_date - 1`. Data vinda da base sempre prevalece.
3. **Inativos**: 0 entregas no mês atual. Se também teve 0 no mês anterior, recebe a etiqueta "sem entregas há 2+ meses".
4. **1 a 50**, **51 a 100**, **101 a 500**, **501 a 1000** e **+1000** (ids `v1`…`v5`): faixas de `entregas_mes`, definidas pelo campo `max` em `FASES`.

Virada de mês: se `mes_referencia` é o mês anterior, `entregas_mes` passa a valer como mês anterior e o mês atual conta 0.

Metas (migração 003): cada praça tem três metas; null = sem meta.
- `pracas.meta`: corridas no mês.
- `pracas.meta_empresas`: empresas com entregas.
- `pracas.meta_taxa_sucesso`: de 0 a 1.

Como cada uma é medida:
- **Corridas:** projeção = `produzido / dia(produzido_ate) × dias_do_mês`. O sync recalcula `produzido` com a soma de `entregas_mes` das lojas da base (`recalcular_produzido`).
- **Empresas:** lojas com `classificar(l).atual > 0`.
- **Taxa de sucesso:** Σ `entregas_mes` ÷ Σ `lojas.pedidos_mes`, só das lojas com pedidos no mês atual. Até a base trazer pedidos ou cancelamentos, fica "sem dado".
- **Totais** (`somarIndicadores` em `base.js`): somam corridas e empresas. A taxa é ponderada pelos pedidos: Σ meta ÷ Σ (meta ÷ taxa), igual à planilha de metas (confere com os totais por supervisor dela).

Importação mensal das metas: Gestão → "Importar metas do mês", colando a aba da planilha. A leitura fica em `prepararMetas`.

Cidade → praça: `indicePracas` / `acharPraca` normalizam acentos e caixa, e aceitam `Cidade`, `Cidade UF`, partes de praças compostas (Belém–Ananindeua) e `pracas.aliases`.

Prospecção vira cliente: quando a base traz uma loja sem código conhecido e com o mesmo CNPJ (só dígitos) de uma prospecção, a prospecção recebe o código (`importar_base`).

## Acesso (RLS em `supabase/migrations/001_schema.sql`)
- Identidade: `auth.jwt()->>'email'` casado com `pessoas.email` (sem diferenciar maiúsculas). Funções `security definer`: `minha_pessoa_id()`, `meu_papel()`, `minha_regional_id()`, `eh_gestor()`, `praca_visivel(praca)` e `loja_visivel(loja)`.
- **gestor**: tudo. **supervisor**: praças com `regional_id` igual ao seu. **comercial**: praças com `comercial_id` igual ao seu.
- Comercial/supervisor editam contato e etapa das lojas visíveis. O gatilho `proteger_campos_da_base` impede que alterem números da base, código ou praça. Criam apenas lojas com `origem = 'prospeccao'`.
- Notas e tarefas só em lojas visíveis. Notas sempre com `autor_id` = a própria pessoa.
- Estrutura (`pessoas`, `pracas`, `regionais`) e importação: só gestor ou `service_role`.
- O gatilho `bloquear_cadastro_externo` em `auth.users` (migração 005) recusa e-mails fora de @beedelivery.com.br ou fora de `pessoas`. O @bee.com.br da migração 001 não existe. O domínio também está em `CONFIG.dominiosEmail`, e os dois precisam bater.
- E-mails da equipe e do gestor **não** ficam no seed (repositório público no Pages): estão em `supabase/local/acessos-equipe.sql`, que é ignorado pelo git. No seed, `gestao-comercial` vem sem e-mail.
- "Ver como" do gestor é **só simulação no cliente** (filtra dados que o gestor já pode ver).

**Ao mudar o schema:** crie `supabase/migrations/00N_descricao.sql` (idempotente, com `if not exists` / `drop ... if exists`), nunca edite uma migração já aplicada em produção. Teste as políticas com `set role authenticated; set request.jwt.claims = '{"email":"...","role":"authenticated"}';` num Postgres local.

## Design
Especificação visual completa em `design/DESIGN.md`, com capturas em `design/telas/`. Qualquer tela nova segue esses tokens e componentes.

## Convenções de código
- Banco em `snake_case`. No app, `deLoja` / `dePraca` / `dePessoa` convertem para camelCase. Mantenha essa fronteira em `assets/app.js`.
- Todo texto vindo do banco entra no HTML via `esc()` ou `textContent`.
- Cores só por tokens CSS em `:root`, com tema claro e escuro. Layout testado em 400 px de largura.
- A lógica compartilhada entre browser e sync fica em `assets/base.js`, sem dependências e sem APIs de DOM ou Node.
- Nunca commitar `.env` nem a `service_role` key. `assets/config.js` só leva a anon key.

## Limites conhecidos / próximos passos
- A base chega por um arquivo no SharePoint ou por uma planilha do Google Sheets. O script de extração (banco → arquivo) é do TI; o modelo da consulta está em `integracao/consulta-modelo.sql`. Datas seriais do Excel/Sheets, CNPJ numérico e cabeçalhos com acento são tratados em `normalizarLinha`.
- SharePoint: app do Entra ID com `Sites.Selected` (read só no site da base). A API de Excel do Graph **não aceita acesso de aplicativo**, por isso o sync baixa o arquivo (`/drives/{id}/root:/{caminho}:/content`) e lê o .xlsx com `scripts/xlsx.mjs`. O arquivo é achado pelo caminho, porque `/shares` (link de compartilhamento) exigiria `Files.ReadWrite.All`. O segredo do app expira: quando vencer, o sync falha até ser trocado.
- Google: com conta de serviço, o Sheets devolve valores sem formatação (`UNFORMATTED_VALUE` + `SERIAL_NUMBER`). No modo link (CSV), as datas dependem do idioma da planilha.
- A importação manual da aba Gestão (navegador) aceita CSV/JSON/linhas coladas, mas não .xlsx (`xlsx.mjs` usa zlib do Node).
- Base com cancelamentos (versão de 28/09): as entregas vêm como `Finalizadas <Mês>/<AA>` (mesmos números do antigo `Entregas <Mês>/<AA>`) e os cancelamentos como `Canceladas <Mês>/<AA>`. `pedidos_mes` = finalizadas + canceladas do mês. São 4.580 lojas, das quais 2.428 próprias com praça; 202 delas só têm cancelamentos. Linha sem coluna de entregas é recusada, e sem nenhuma linha válida o sync falha.
- **O CRM é só para operações próprias.** `prepararImportacao` descarta linhas com `Tipo Operação` = Franquia (contadas em `franquias`, fora de `semPraca`). Não crie praças para franquias.
- Base real da Bee (set/2026): 4.254 lojas em 93 operações. Delas, 2.226 são de 29 operações próprias, que batem com as praças do seed e com o mesmo comercial, e 2.025 são franquias. Colunas de entregas vêm com o nome do mês (`Entregas Ago/26`), tratadas em `entregasPorMes`. O arquivo real não deve ser commitado (planilhas estão no `.gitignore`).
- Os testes de SQL rodaram fora do repositório, num PGlite com stubs de `auth.role()`/`auth.jwt()`. Não há teste de SQL versionado. Ao mudar `importar_base`, teste de novo os cenários: carga inicial, dia seguinte, prospecção convertida e praça nova.
- Ideias de backlog: histórico diário de entregas por loja (tabela `lojas_historico`) para gráficos de tendência; alerta de loja que caiu de faixa; exportar lista para planilha; metas por comercial além de por praça; PWA offline.
