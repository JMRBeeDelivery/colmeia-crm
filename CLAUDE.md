# CLAUDE.md — Colmeia CRM

Contexto para o Claude Code trabalhar neste repositório.

## O que é
CRM dos comerciais da Bee Delivery (entregas por app). Cada comercial cuida de uma ou mais **praças** (cidades de operação) e acompanha as **lojas** (clientes) dessas praças. As praças são agrupadas em **regionais**, cada uma com um supervisor. Usuários: gestor comercial, supervisores e comerciais. Todos usam o app no celular e no computador.

Idioma: toda a interface, mensagens, commits e comentários em **português do Brasil**.

## Stack
- **Frontend:** `index.html` + `assets/*.js` como módulos ES, **sem build e sem framework**. Hospedado no GitHub Pages. supabase-js vem do jsdelivr com versão fixa.
- **Backend:** Supabase. Login por link no e-mail (magic link) e Postgres com Row Level Security.
- **Sync:** `scripts/sync.mjs` (Node 20), rodado pelo GitHub Actions todo dia às 09:00 UTC.
- **Testes:** `node --test scripts/base.test.mjs` (sem dependências).

Comandos: `npm test`, `npm run dev`, `npm run sync:teste` (simulação offline) e `npm run sync`.

## Regras de negócio (fonte da verdade: `assets/base.js`)
Fases da loja, calculadas no cliente a partir dos números da base (`classificar`):
1. **Prospecção**: nunca entregou (sem `primeira_entrega`, sem entregas, sem `ultima_entrega`). Criada pelo comercial.
2. **Ativação**: menos de 30 dias desde `primeira_entrega`.
3. **Inativos**: 0 entregas no mês atual. Se também teve 0 no mês anterior, recebe a etiqueta "sem entregas há 2+ meses".
4. **1 a 50**, **51 a 100** e **+100**: faixas de `entregas_mes`.

Virada de mês: se `mes_referencia` é o mês anterior, `entregas_mes` passa a valer como mês anterior e o mês atual conta 0.

Metas: `pracas.meta` em corridas/mês (null = sem meta). Projeção = `produzido / dia(produzido_ate) × dias_do_mês`. O sync recalcula `produzido` com a soma de `entregas_mes` das lojas da base (`recalcular_produzido`).

Cidade → praça: `indicePracas` / `acharPraca` normalizam acentos e caixa, e aceitam `Cidade`, `Cidade UF`, partes de praças compostas (Belém–Ananindeua) e `pracas.aliases`.

Prospecção vira cliente: quando a base traz uma loja sem código conhecido e com o mesmo CNPJ (só dígitos) de uma prospecção, a prospecção recebe o código (`importar_base`).

## Acesso (RLS em `supabase/migrations/001_schema.sql`)
- Identidade: `auth.jwt()->>'email'` casado com `pessoas.email` (sem diferenciar maiúsculas). Funções `security definer`: `minha_pessoa_id()`, `meu_papel()`, `minha_regional_id()`, `eh_gestor()`, `praca_visivel(praca)` e `loja_visivel(loja)`.
- **gestor**: tudo. **supervisor**: praças com `regional_id` igual ao seu. **comercial**: praças com `comercial_id` igual ao seu.
- Comercial/supervisor editam contato e etapa das lojas visíveis. O gatilho `proteger_campos_da_base` impede que alterem números da base, código ou praça. Criam apenas lojas com `origem = 'prospeccao'`.
- Notas e tarefas só em lojas visíveis. Notas sempre com `autor_id` = a própria pessoa.
- Estrutura (`pessoas`, `pracas`, `regionais`) e importação: só gestor ou `service_role`.
- O gatilho `bloquear_cadastro_externo` em `auth.users` recusa e-mails fora de @bee.com.br ou fora de `pessoas`.
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
- A API da base não é conhecida ainda. Ajuste `obterLinhas()` em `scripts/sync.mjs` (paginação, autenticação) quando o TI passar a especificação.
- Se a API for só da rede interna, use um runner self-hosted.
- Ideias de backlog: histórico diário de entregas por loja (tabela `lojas_historico`) para gráficos de tendência; alerta de loja que caiu de faixa; exportar lista para planilha; metas por comercial além de por praça; PWA offline.
