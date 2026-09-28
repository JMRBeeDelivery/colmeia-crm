# Prompt para colar no Claude Code

Coloque a pasta `colmeia-design-kit/` dentro do seu projeto (por exemplo, em `design/`) e cole o texto abaixo no chat do Claude Code. Ajuste a linha **Stack** se for usar outra tecnologia.

---

```
Quero replicar fielmente o design e as telas do Colmeia CRM (CRM dos comerciais da Bee Delivery).

Material de referência na pasta design/:
- design/DESIGN.md: especificação completa (tokens de cor, tipografia, componentes, cada tela, responsividade, textos e regras de negócio que afetam a interface). Leia inteiro antes de começar.
- design/telas/*.png: capturas de todas as telas no desktop (1280–1440 px), no celular (390 px, prefixo m) e no tema escuro (prefixo d). Abra e olhe cada imagem da tela que estiver construindo.
- design/referencia/: implementação original (index.html com todo o CSS, app.js com as telas, base.js com as regras). É a fonte da verdade para medidas, cores e comportamento.

Stack: [mantenha HTML + JS puro, sem build, como na referência | ou: React + Vite + CSS Modules | ou: Next.js + Tailwind].

Regras:
1. Use exatamente os tokens de cor da seção 2.1, incluindo o tema escuro via prefers-color-scheme. Não invente cores.
2. Use as fontes Bricolage Grotesque (títulos), Public Sans (texto) e JetBrains Mono (números, sempre com tabular-nums).
3. O hexágono (clip-path) é o marcador de fase, o logo e o ícone da navegação inferior. Não troque por círculos nem ícones de biblioteca.
4. Mantenha todos os textos em português do Brasil, iguais aos da referência.
5. Mobile first: abaixo de 760 px vale o comportamento da seção 5 (navegação inferior, FAB, funil com uma coluna por vez, tabelas virando cartões). A página nunca pode rolar na horizontal.
6. Construa uma tela por vez, nesta ordem: tokens e componentes base, Login, Metas, Funil, Detalhe da loja (gaveta), Lojas, Tarefas, Nova prospecção, Gestão, estados (Ver como, Acesso não liberado, vazio).
7. Ao terminar cada tela, rode o app e compare lado a lado com a captura correspondente em 1280 px e 390 px, nos temas claro e escuro. Corrija as diferenças antes de seguir.

Comece lendo design/DESIGN.md e me mostre um plano curto: a estrutura de arquivos e onde ficam os tokens.
```

---

## Dicas de uso

- **Uma tela por conversa** funciona melhor em projetos grandes. Exemplo: "Agora construa a tela Metas conforme a seção 4.2 e as capturas 03, m2 e d1."
- Se o Claude Code puder rodar um navegador (Playwright), peça: "tire uma captura em 390 px e compare com `design/telas/m4-funil-comercial.png`".
- Para trocar só o visual de um projeto existente, diga: "aplique os tokens e componentes do DESIGN.md sem mudar a lógica".
