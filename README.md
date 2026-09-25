# Colmeia CRM

CRM dos comerciais da Bee Delivery. Cada comercial entra com o e-mail @bee.com.br e vê só as lojas das suas praças; a supervisão vê a regional inteira; o gestor vê tudo.

- **Metas do mês** por praça: meta, produzido, % atingido, projeção e corridas/dia que faltam.
- **Funil de lojas** em 6 fases: Prospecção, Ativação, Inativos, 1 a 50, 51 a 100 e +100 entregas.
- **Detalhe da loja**: contato, WhatsApp, histórico de ligações/visitas e tarefas.
- **Base diária**: o GitHub Actions busca a API todo dia às 06:00 e atualiza as lojas.
- Funciona no computador e no celular (pode ser instalado na tela inicial).

## Como funciona

```
GitHub Pages (index.html + assets/)  ──►  Supabase (login por link + Postgres com RLS)
                                               ▲
GitHub Actions (sync diário, 06:00)  ──────────┘  lê a API da base e grava via service_role
```

- **Sem servidor próprio e sem build.** O site é HTML + JavaScript puro.
- **A segurança fica no banco.** As regras de acesso (Row Level Security) do Postgres decidem quais linhas cada pessoa pode ler e alterar. A chave pública que vai no site não dá acesso a nada sozinha.
- **Só entra quem está cadastrado.** Um gatilho no banco recusa qualquer e-mail que não seja @bee.com.br ou que não esteja na tabela `pessoas`.

## Colocar no ar (cerca de 30 minutos)

### 1. Supabase
1. Crie um projeto em [supabase.com](https://supabase.com) (região São Paulo).
2. Em **SQL Editor**, rode `supabase/migrations/001_schema.sql` e depois `supabase/seed.sql`.
3. Em **Table Editor → pessoas**, preencha o e-mail @bee.com.br de cada pessoa. Isso também pode ser feito depois pela aba **Gestão** do app.
4. Em **Authentication → Providers → Email**, deixe *Email* ligado. A confirmação de e-mail pode ficar ligada.
5. Em **Authentication → URL Configuration**, coloque a URL do GitHub Pages (passo 2) em *Site URL* e em *Redirect URLs*.
6. Para uso real, configure um SMTP próprio em **Authentication → SMTP Settings**. O envio padrão do Supabase tem limite baixo de e-mails por hora.

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
   - **Secrets**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BASE_API_URL` e `BASE_API_TOKEN`.
4. Rode **Actions → Publicar no GitHub Pages** para publicar. A URL aparece no resumo da execução.
5. Rode **Actions → Sync diário da base → Run workflow**, marcando *Só simular*, para testar a API sem gravar nada.

> **A API da base é interna?** Os servidores do GitHub não acessam a rede da Bee. Nesse caso há duas saídas:
> - instalar um [runner self-hosted](https://docs.github.com/actions/hosting-your-own-runners) numa máquina da Bee e trocar `runs-on` no `sync.yml`;
> - fazer o sistema da base enviar os dados, chamando a função `importar_base` do Supabase direto.

### 3. Equipe
1. Entre no app com `comercial.claude@bee.com.br` (o gestor já vem cadastrado no seed).
2. Em **Gestão → Equipe e acessos**, preencha o e-mail de cada pessoa.
3. Mande a URL para a equipe. Cada pessoa digita o próprio e-mail e recebe um link de acesso.

## Rodar na sua máquina

```bash
npm install
npm test                 # regras de fase e cidade → praça
npm run sync:teste       # simula o sync com data/exemplo-base.json, sem gravar
npm run dev              # abre o site em http://localhost:5173
```

Para testar o login localmente, adicione `http://localhost:5173` em *Redirect URLs* no Supabase.

Para rodar o sync de verdade na sua máquina, copie `.env.exemplo` para `.env`, preencha e rode `npm run sync`.

## Formato esperado da API

Uma lista JSON (ou CSV com cabeçalho), uma linha por loja. Os nomes de coluna alternativos aceitos estão em `assets/base.js` (`ALIAS`).

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

Cidades sem praça cadastrada são ignoradas e aparecem no log do sync. Para incluir uma cidade, cadastre a praça (aba Gestão) ou adicione a cidade em `pracas.aliases`.

## Estrutura

```
index.html                 app (HTML + CSS)
assets/app.js              telas, login e acesso ao Supabase
assets/base.js             regras compartilhadas: fases, leitura da base, cidade → praça
assets/config.js           URL e anon key do Supabase (públicas)
scripts/sync.mjs           sync diário (Node 20)
scripts/base.test.mjs      testes das regras
supabase/migrations/       tabelas, regras de acesso (RLS) e funções
supabase/seed.sql          regionais, 39 praças, 21 pessoas e metas de set/2026
.github/workflows/         publicação no Pages e sync diário
data/exemplo-base.json     base de exemplo para testes
```
