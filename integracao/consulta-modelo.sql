-- ============================================================================
-- Colmeia CRM · consulta modelo para o script de extração
--   banco da Bee → planilha do Google Sheets → sync diário (06:00) → Supabase
--
-- Ajuste os nomes de tabelas e colunas (lojas, cidades, entregas…) ao banco real.
-- O resultado vai para UMA aba da planilha: a 1ª linha é o cabeçalho com estes
-- nomes de coluna e depois vem 1 linha por loja. A cada execução o script deve
-- SUBSTITUIR a aba inteira (limpar e gravar), nunca acrescentar linhas no fim.
-- Termine antes das 06:00 (horário do sync).
--
-- Exemplo em PostgreSQL. Adaptação para MySQL e SQL Server no fim do arquivo.
-- ============================================================================

WITH periodo AS (
  SELECT
    (CURRENT_DATE - 1)                                                   AS dia,              -- dados até ontem
    date_trunc('month', CURRENT_DATE - 1)::date                          AS ini_mes,
    (date_trunc('month', CURRENT_DATE - 1) - interval '1 month')::date   AS ini_mes_anterior
)
SELECT
  l.id                                              AS codigo,                 -- obrigatório: código único e fixo da loja
  l.nome_fantasia                                   AS nome,                   -- obrigatório
  c.nome                                            AS cidade,                 -- obrigatório (ou "praca"); casa com as praças do CRM
  c.uf                                              AS uf,
  l.cnpj                                            AS cnpj,                   -- liga a loja à prospecção do comercial
  to_char(l.criado_em, 'YYYY-MM-DD')                AS data_cadastro,
  to_char(l.primeira_entrega, 'YYYY-MM-DD')         AS data_primeira_entrega,  -- define a Ativação (30 dias)
  to_char(MAX(e.data_entrega) FILTER (WHERE e.status = 'concluida'), 'YYYY-MM-DD') AS ultima_entrega, -- só os 2 meses da janela
  COUNT(e.id) FILTER (WHERE e.status = 'concluida' AND e.data_entrega >= p.ini_mes)                   AS entregas_mes,
  COUNT(e.id) FILTER (WHERE e.status = 'concluida' AND e.data_entrega >= p.ini_mes_anterior
                        AND e.data_entrega <  p.ini_mes)                                           AS entregas_mes_anterior,
  -- taxa de sucesso do CRM = entregas finalizadas ÷ (finalizadas + canceladas)
  COUNT(e.id) FILTER (WHERE e.status = 'cancelada' AND e.data_entrega >= p.ini_mes)                   AS cancelamentos_mes,
  to_char(p.dia, 'YYYY-MM')                         AS mes_referencia,         -- mês a que entregas_mes se refere
  l.bairro                                          AS bairro,
  l.endereco                                        AS endereco,
  l.responsavel                                     AS responsavel,
  l.telefone                                        AS telefone
FROM lojas l
JOIN cidades c        ON c.id = l.cidade_id
CROSS JOIN periodo p
LEFT JOIN entregas e  ON e.loja_id = l.id
                     AND e.data_entrega >= p.ini_mes_anterior
                     AND e.data_entrega <  p.dia + 1
                     AND e.status IN ('concluida', 'cancelada')              -- ajuste aos status do banco
WHERE l.primeira_entrega IS NOT NULL                                         -- só lojas que já entregaram
GROUP BY l.id, l.nome_fantasia, c.nome, c.uf, l.cnpj, l.criado_em, l.primeira_entrega, p.dia,
         l.bairro, l.endereco, l.responsavel, l.telefone
ORDER BY c.uf, c.nome, l.nome_fantasia;

-- ----------------------------------------------------------------------------
-- Observações
-- * Envie todas as lojas clientes, inclusive as com 0 entregas no mês: é assim que
--   o CRM identifica os Inativos.
-- * "dados até ontem" faz a virada de mês funcionar: no dia 1º, a planilha ainda traz
--   o mês que acabou (mes_referencia = mês anterior) e o CRM conta o mês novo como 0.
-- * Grave o CNPJ como texto (ou com pontuação) para não perder zeros à esquerda.
--
-- MySQL / MariaDB — troque:
--   CURRENT_DATE - 1                     →  CURDATE() - INTERVAL 1 DAY
--   date_trunc('month', X)::date         →  DATE_FORMAT(X, '%Y-%m-01')
--   ... - interval '1 month'             →  DATE_FORMAT(X, '%Y-%m-01') - INTERVAL 1 MONTH
--   to_char(X, 'YYYY-MM-DD')             →  DATE_FORMAT(X, '%Y-%m-%d')   ('YYYY-MM' → '%Y-%m')
--   COUNT(e.id) FILTER (WHERE cond)      →  SUM(CASE WHEN cond THEN 1 ELSE 0 END)
--   p.dia + 1                            →  p.dia + INTERVAL 1 DAY
-- SQL Server: DATEFROMPARTS/EOMONTH, FORMAT(X, 'yyyy-MM-dd') e SUM(CASE ...).
-- ----------------------------------------------------------------------------
