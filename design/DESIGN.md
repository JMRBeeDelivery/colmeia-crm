# Colmeia CRM: especificação de design e telas

Documento de referência para replicar o visual e as telas do Colmeia CRM. As capturas estão em `design/telas/`. Em caso de dúvida sobre medida ou comportamento, **o código do app (`index.html`, `assets/app.js`, `assets/base.js`) é a fonte da verdade**; este documento explica a intenção.

---

## 1. Conceito

- **Produto:** CRM dos comerciais da Bee Delivery. Cada comercial acompanha as lojas das suas praças (cidades), classificadas por fase de volume de entregas, e as metas de corridas do mês.
- **Usuários:** gestor comercial, supervisores de regional e comerciais. Uso intenso no **celular**, em campo, e no computador.
- **Identidade:** "colmeia". O **hexágono** é o elemento gráfico recorrente: logo, marcador de fase, ícones da navegação inferior e estados vazios. O **amarelo-mel** é o acento. Neutros quentes, levemente puxados para o amarelo, nunca cinza puro.
- **Tom visual:** ferramenta de trabalho, densa e legível. Números em fonte mono tabular. Sem gradientes, sem sombras em tudo, sem emojis.
- **Idioma:** português do Brasil, com números em `pt-BR` (`28.618`), datas `dd/mm/aa` e horários `28/09 às 06:02`.

---

## 2. Tokens

### 2.1 Cores (tema claro = padrão)

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--bg` | `#F3F3EF` | `#14130F` | fundo da página |
| `--surface` | `#FFFFFF` | `#1E1C17` | cartões, tabelas, gaveta |
| `--surface-2` | `#F8F7F3` | `#252319` | fundo de colunas, cabeçalho de tabela, caixas de dados |
| `--ink` | `#1C1A14` | `#F0EDE3` | texto principal |
| `--muted` | `#69655A` | `#A5A092` | texto secundário, rótulos |
| `--line` | `#E2DFD5` | `#353229` | bordas e divisórias |
| `--accent` | `#F5B800` | `#F5B800` | amarelo-mel: botão primário, barra de meta, aba ativa do celular |
| `--accent-ink` | `#1C1A14` | `#1C1A14` | texto sobre o amarelo |
| `--accent-text` | `#8A6300` | `#F5C842` | links e texto de destaque sobre fundo neutro |
| `--accent-soft` | `#FFF3C7` | `#3A3014` | fundo do selo de papel e do chip de destaque |
| `--danger` / `--danger-soft` | `#B93A22` / `#FBE6E0` | `#F07A60` / `#3D1F18` | alertas, queda, "sem contato" |
| `--ok` / `--ok-soft` | `#1C7A5F` / `#DDF2EA` | `#5CCBA6` / `#173329` | alta, "no ritmo", ativação |

**Cores das fases** (usadas só no hexágono marcador, nunca como fundo de cartão):

| Fase | Claro | Escuro |
|---|---|---|
| Prospecção `--f-prosp` | `#56688F` | `#8FA2CC` |
| Ativação `--f-ativ` | `#1C8A6C` | `#4CC3A0` |
| Inativos `--f-inat` | `#C4432A` | `#F07A60` |
| 1 a 50 `--f-v1` | `#E8C35A` | `#F1D27A` |
| 51 a 100 `--f-v2` | `#DB9A00` | `#F0B22E` |
| +100 `--f-v3` | `#A8640A` | `#D98B2B` |

As três faixas de volume formam uma escala de mel: mel claro, depois âmbar, depois âmbar escuro.

**Tema escuro:** respeita `prefers-color-scheme`. Os tokens são redefinidos em `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` e também em `:root[data-theme="dark"]`, com `color-scheme: dark`. Os componentes usam só tokens, nunca cores literais.

### 2.2 Tipografia (Google Fonts)

| Papel | Fonte | Pesos | Onde |
|---|---|---|---|
| Display | **Bricolage Grotesque** (com eixo `opsz`) | 600, 700 | logo, títulos de tela, títulos de coluna, nome na gaveta |
| Texto | **Public Sans** | 400, 500, 600, 700 | todo o resto |
| Números | **JetBrains Mono** | 500, 700 | contadores, valores de tabela, datas nos fatos, telefone, CNPJ |

Sempre use `font-variant-numeric: tabular-nums` em números.

Escala usada (px): **11** (chips, rótulos de navegação) · **12** (rótulos em caixa-alta, descrições, metadados) · **13** (tabelas secundárias, botões pequenos) · **14** (corpo) · **15–16** (títulos de cartão, valores nos fatos) · **18** (títulos de grupo, número grande do cartão) · **20** (logo, nome na gaveta) · **24** (título da tela) · **26** (valores dos contadores e tiles; 22 no celular).

Rótulos em caixa-alta levam `letter-spacing: .05em–.08em` e peso 700.

### 2.3 Forma e espaço

- **Raios:** 8 px (botões pequenos, inputs de tabela) · 10 px (inputs, botões, cartões de loja) · 12 px (contadores, colunas, tiles, tabelas) · 14 px (painéis da Gestão, modal) · 16 px (caixa de login, FAB) · 99 px (chips e selos).
- **Bordas:** 1 px `--line` em quase tudo. A sombra (`--shadow`) aparece **só** em elementos flutuantes: gaveta, modal, FAB e caixa de login.
- **Gutter lateral:** 16 px em qualquer largura. Largura máxima do conteúdo: 1440 px.
- **Espaçamento:** `gap` de 8 px entre cartões, 10 px na barra de ferramentas, 16 px entre painéis e 18 px entre seções da gaveta.
- **Alturas:** inputs e botões com 38 px (44 px no login); botões pequenos com 30 px.

### 2.4 O hexágono

```css
.hex { width:12px; height:13px; clip-path: polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%); background: var(--c, var(--accent)); }
```

O componente recebe a cor pela variável `--c`. Tamanhos usados:

- 12×13: marcador de fase;
- 22×25: logo no topo;
- 30×34: logo no login;
- 40×46: estados vazios;
- 8×9: miniaturas.

Na navegação inferior do celular, o hexágono fica cinza (`--line`) quando a aba está inativa e amarelo quando ativa.

---

## 3. Componentes

| Componente | Descrição |
|---|---|
| **Barra superior** | Fixa no topo, com fundo `--bg` e borda inferior. Contém, nesta ordem: logo "Colmeia" + "CRM COMERCIAL", abas (desktop), espaço flexível, status da base, usuário e botão **Sair**. |
| **Abas (desktop)** | Botões sem borda na cor `--muted`. A aba ativa ganha fundo `--surface`, anel interno de 1 px `--line` e texto `--ink`. |
| **Status da base** | Ponto de 8 px verde (`--ok`), ou vermelho se a base tiver mais de 36 h, seguido de "Base atualizada em 28/09 às 06:02". No desktop, o texto é cortado com reticências em vez de quebrar a linha. |
| **Usuário** | Avatar circular amarelo de 28 px com a inicial, o nome e um selo de papel (GESTOR, SUPERVISÃO ou COMERCIAL) em caixa-alta 11 px sobre `--accent-soft`. No celular, o nome some e fica só o avatar com o selo. |
| **Barra de ferramentas** | Título da tela (Bricolage 24 px), espaço, selects de filtro (Comercial e Praça), busca e botão primário **+ Nova prospecção**. No celular, título, selects e busca ocupam 100% da largura. |
| **Botões** | Padrão: fundo `--surface` com borda. Primário: fundo `--accent` com texto `--accent-ink`. Perigo: texto `--danger`. Todos com `:focus-visible` usando contorno de 2 px `--accent`. |
| **Chips** | Pílula de 11 px, peso 600. Variações: neutro (`--surface-2` com borda), `warn` (`--danger-soft`/`--danger`), `good` (`--ok-soft`/`--ok`) e `hl` (`--accent-soft`/`--accent-text`). |
| **Contador de fase** | Cartão com rótulo (hexágono + nome em caixa-alta 12 px), valor mono de 26 px e subtexto de 12 px. São seis em linha no desktop e numa grade de 3×2 no celular (rótulo em caixa normal). Clicável; quando selecionado, ganha anel de 2 px na cor da fase. |
| **Cartão de loja** | Nome (700), "Bairro · Praça/UF" (12 px, `--muted`), número de entregas do mês (mono 18 px) + "entregas no mês · N no anterior" (verde se subiu, vermelho se caiu) e chips. Prospecções não mostram números. |
| **Coluna do funil** | Fundo `--surface-2`, borda e raio 12 px. Cabeçalho com hexágono, nome (Bricolage 15 px) e contagem à direita; abaixo, a descrição da fase em 12 px. A lista rola dentro da coluna e mostra no máximo 80 cartões, com o aviso "+N lojas. Veja todas na aba Lojas." |
| **Tile de métrica** | Rótulo em caixa-alta, valor mono de 26 px e legenda. Usado só no topo da tela Metas. |
| **Barra de meta** | Trilho de 8 px (`--surface-2` com borda). O preenchimento amarelo mostra o **% atingido**; um traço vertical de 2 px (`--ink` a 55%) marca a **projeção**. À esquerda, o % em mono. |
| **Tabelas** | Cabeçalho `--surface-2` em caixa-alta 12 px e fixo no topo, linhas de 10×12 px, números alinhados à direita e hover `--surface-2`. Ficam dentro de um contêiner `overflow-x:auto` com borda e raio 12 px. No celular viram cartões. |
| **Gaveta (detalhe da loja)** | Painel à direita de `min(480px, 100%)`, com camada escura de 40% sobre o resto da tela. Fecha com ×, clique fora ou Esc. No celular ocupa a tela toda. |
| **Modal** | Caixa central de `min(560px, 100%)` com raio 14 px, sobre camada de 45%. |
| **Navegação inferior (celular)** | Fixa na base, com fundo `--surface`, borda superior e área segura do iPhone. Mostra 4 ou 5 itens (hexágono + rótulo de 12 px). |
| **Botão flutuante (celular)** | 56×56 px, raio 16 px, amarelo, "+" de 28 px. Fica 76 px acima da base, à direita, e abre Nova prospecção. |
| **Toast** | Faixa escura (`--ink`/`--bg`) centralizada acima da navegação inferior. Some em cerca de 3,5 s. |
| **Estado vazio** | Hexágono de 40 px, título em Bricolage 22 px e uma frase em `--muted`, tudo centralizado. |

---

## 4. Telas

Cada tela lista o arquivo de captura, o que mostra e como se comporta.

### 4.1 Login: `01-login.png`, `02-login-link-enviado.png`, `m1-login.png`
- Caixa centralizada de 420 px com: logo, título "Entre com seu e-mail da Bee", texto "Enviamos um link de acesso para o seu e-mail. Não precisa de senha.", campo de e-mail de 44 px e botão primário **Receber link de acesso**.
- Abaixo do botão, uma mensagem de status em `--accent-text`. Casos:
  - e-mail fora do domínio: "Use seu e-mail @bee.com.br.";
  - link enviado: "Enviamos um link de acesso para {email}. Abra o e-mail neste aparelho e toque no link.";
  - e-mail não cadastrado: "Este e-mail não está cadastrado na equipe comercial. Fale com o gestor."

### 4.2 Metas do mês: `03-metas-gestor.png`, `m2-metas-supervisor.png`, `m3-…-rolado.png`, `d1-metas-escuro.png`
- Tela inicial do gestor e da supervisão. O comercial começa no Funil.
- **4 tiles:**
  - Meta do mês: "corridas · X de Y praças com meta";
  - Produzido: "até dd/mm";
  - Atingido: "das praças com meta";
  - Projeção do mês: "N corridas no ritmo atual".
- **Agrupamento por perfil:**
  - gestor: por **regional** ("Regional 1 · Lucas Pacheco (supervisão)"), mais o grupo "Sem regional";
  - supervisor: por **comercial**, do maior para o menor em meta;
  - comercial: um grupo "Minhas praças".
- **Resumo do grupo:** "13 praças · meta 66.612 · produzido 31.754 (48%) · projeção 89%".
- **Tabela:** Praça · Comercial · Meta · Produzido · Atingido (barra) · Projeção · Precisa/dia · Status. Ordenada por meta, da maior para a menor; praças sem meta vão para o fim.
- **Status:**

  | Chip | Condição |
  |---|---|
  | Meta batida (verde) | atingido ≥ 100% |
  | No ritmo (verde) | projeção ≥ 100% |
  | Atenção (amarelo) | projeção ≥ 85% |
  | Abaixo do ritmo (vermelho) | projeção < 85% |
  | Sem meta (neutro) | praça sem meta |

- Clicar numa praça abre o Funil filtrado por ela.
- **Celular:** cada praça vira um cartão com nome, status, barra e três números (Meta · Produzido · Precisa/dia).
- **Rodapé explicativo:** "Projeção = produzido ÷ dias corridos até a data da produção × dias do mês…"

### 4.3 Funil: `04-funil-gestor.png`, `m4-funil-comercial.png`, `d2`/`d3`
- Seis contadores de fase e o quadro com seis colunas, cada uma com no mínimo 240 px e rolagem horizontal no desktop.
- **Ordem dos cartões por coluna:**
  - Inativos: maior volume no mês anterior primeiro;
  - Ativação: menos dias restantes primeiro;
  - Prospecção: mais recente primeiro;
  - faixas de volume: mais entregas primeiro.
- **Chips do cartão:**
  - Prospecção mostra a etapa: Novo cadastro, Em contato, Negociando, Aguardando 1ª entrega ou Perdido;
  - Ativação mostra "N dias de ativação";
  - Inativos mostra "Parou este mês" ou "Sem entregas há 2+ meses";
  - último contato: "Contato há N dias", vermelho acima de 14 dias; sem nenhum registro, "Sem contato registrado";
  - tarefas abertas: "N tarefas".
- **Celular:** os contadores funcionam como abas. Aparece só a coluna da fase tocada (padrão: Prospecção).
- **Desktop:** clicar num contador rola o quadro até a coluna daquela fase.

### 4.4 Lojas: `05-lojas-lista.png`, `m6-lojas.png`
- Tabela ordenável ao clicar no cabeçalho (seta ↑ ↓): Loja · Praça · bairro · Fase (hexágono + nome) · Entregas mês · Mês anterior · Última entrega · Último contato ("nunca" em vermelho) · Tarefas.
- Filtro por fase vindo do contador: "Filtrando pela fase **X** · mostrar todas".
- **Celular:** lista de cartões de loja.

### 4.5 Tarefas: `06-tarefas.png`, `m7-tarefas.png`
- Grupos com hexágono colorido e contagem: **Atrasadas** (vermelho) · **Para hoje** (amarelo) · **Próximas** (azul-ardósia) · **Sem data** · **Concluídas recentemente** (verde; mostra as 10 últimas, riscadas).
- Cada item tem checkbox de 18 px na cor do acento, texto da tarefa e a linha "Loja (link) · Praça · vence dd/mm/aa".

### 4.6 Detalhe da loja (gaveta): `08-detalhe-loja.png`, `09-detalhe-prospeccao.png`, `m5-detalhe-loja.png`, `d4`
- **Cabeçalho:** fase com hexágono, nome (Bricolage 20 px) e "Bairro · Praça/UF · Comercial · código LJ-…" (ou "cadastro do comercial").
- **Fatos (grade de 3; 2 no celular):**
  - cliente: Entregas no mês · Mês anterior · Variação (+/− colorida) · 1ª entrega · Última entrega · "Ativação termina em N dias" ou "Cliente desde";
  - prospecção: Cadastrada em · Dias em prospecção · Etapa, mais o select **Etapa da prospecção**.
- **Contato:** responsável, telefone em mono com botões **Copiar** e **Abrir WhatsApp** (link wa.me), endereço com link **Mapa** e CNPJ. Um link **Editar** abre um formulário inline para Responsável, Telefone, Endereço, Bairro e CNPJ.
- **Tarefas:** lista e linha de inclusão com texto, data e botão **Adicionar**. No celular, o texto ocupa a linha inteira.
- **Registrar contato:** pílulas de rádio (Ligação, Visita, WhatsApp, Anotação), área de texto e botão **Salvar registro**.
- **Histórico:** ícone quadrado de 28 px com sigla (LIG, VIS, WPP, NOT, SIS), linha "Tipo · 19/09 às 10:45 · Autor" e o texto. Mudanças de etapa geram registros "Sistema".

### 4.7 Nova prospecção (modal): `10-nova-prospeccao.png`, `m8-nova-prospeccao.png`
- **Campos:** Nome da loja*, Praça* (select com as praças do usuário), Bairro, Endereço, Responsável, Telefone/WhatsApp, CNPJ ("Usado para ligar a loja à base diária") e Primeira anotação.
- **Texto explicativo:** "A loja entra na fase Prospecção. Quando a base diária trouxer a primeira entrega (mesmo CNPJ), ela passa para Ativação automaticamente."
- **Botões:** Cancelar e **Cadastrar loja**. Depois de salvar, a gaveta da nova loja abre.

### 4.8 Gestão (só gestor): `07-gestao.png`
- **Painel "Estrutura e metas"** (largura total), separado por regional:
  - cabeçalho da regional com select de Supervisão;
  - tabela editável com Praça · Comercial (select) · Regional (select) · Meta · Produzido · Até (data);
  - cada alteração salva sozinha e mostra o toast "Salvo: Natal/RN";
  - no fim, "Adicionar praça" em `<details>`.
- **Painel "Equipe e acessos":**
  - uma linha por pessoa com avatar, nome, "Papel · Regional · N praças", campo de e-mail (que libera o acesso) e os botões **Ver como** e **Desativar**;
  - no fim, "Adicionar pessoa".
- **Painel "Base diária":**
  - 3 caixas: Última carga · Lojas na carga · Novas;
  - envio de arquivo, área de texto e a opção "Recalcular o produzido das praças com a soma das lojas";
  - botões **Conferir dados** e **Aplicar atualização**, com barra de progresso amarela.

### 4.9 Ver como: `11-ver-como-comercial.png`
Faixa amarela de largura total abaixo da barra superior com "Você está vendo o sistema como **Juan Marinho (Comercial)**" e o botão contornado **Voltar à visão de gestor**.

### 4.10 Acesso não liberado: `12-acesso-nao-liberado.png`
Estado vazio com o título "Seu acesso ainda não foi liberado" e a frase "O e-mail {email} não está ligado a ninguém da equipe comercial. Fale com o gestor."

---

## 5. Responsividade

- **Ponto de quebra principal: 760 px.** Abaixo dele:
  - as abas do topo somem e entra a navegação inferior;
  - o nome do usuário some;
  - o status da base vai para uma linha própria;
  - os contadores viram grade de 3×2;
  - o funil mostra uma coluna por vez;
  - as tabelas viram cartões;
  - o FAB substitui o botão "+ Nova prospecção";
  - tiles e fatos ficam em 2 colunas.
- **900 px:** os painéis da Gestão passam a ficar em uma coluna.
- **Nunca pode haver rolagem horizontal da página.** Só tabelas e o quadro do funil rolam, cada um dentro do próprio contêiner.
- Respeitar a área segura do iPhone (`env(safe-area-inset-*)`) no topo, na navegação inferior e na gaveta.
- Nos campos de celular, usar `inputmode` adequado (`tel`, `email`) e fonte de 16 px no login para o iOS não dar zoom.

---

## 6. Textos e tom

- Frases curtas, voz ativa e as palavras do comercial: "loja", "praça", "corridas", "entregas", "prospecção".
- Botões dizem o que fazem ("Salvar registro", "Cadastrar loja", "Aplicar atualização"). O toast confirma no passado ("Registro salvo", "Tarefa criada").
- Erros explicam o que houve e o que fazer ("Você não tem permissão para alterar isso.", "Sua sessão expirou. Entre de novo.").
- Não usar "Oops", emojis, nem pedidos de desculpa.

---

## 7. Regras que mudam a interface

| Regra | Definição |
|---|---|
| **Prospecção** | Nunca entregou. |
| **Ativação** | Menos de 30 dias desde a 1ª entrega. |
| **Inativos** | 0 entregas no mês atual. |
| **Faixas de volume** | 1–50, 51–100 e +100 entregas no mês. |
| **Virada de mês** | Se a base ainda está no mês anterior, o número conta como "mês anterior" e o atual começa em 0. |
| **Projeção** | `produzido ÷ dia(produzido_até) × dias_do_mês`. |
| **Precisa/dia** | `(meta − produzido) ÷ dias restantes`. |
| **Visibilidade** | Comercial vê só as suas praças. Supervisor vê a própria regional. Gestor vê tudo e tem a aba Gestão. |

A implementação de referência dessas regras está em `assets/base.js` (`classificar`) e em `assets/app.js` (`projecao`, `statusMeta`).
