// Regras compartilhadas entre o navegador (app.js) e o sync diário (scripts/sync.mjs).
// Sem dependências: funciona como módulo ES no browser e no Node 18+.

export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const pad = n => String(n).padStart(2, '0');
export const mesKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
export const soDigitos = s => String(s || '').replace(/\D/g, '');

/* ---------- Fases do funil ---------- */
export const FASES = [
  { id: 'prospeccao', nome: 'Prospecção', desc: 'Lojas cadastradas pelo comercial, ainda sem entregas.', c: 'var(--f-prosp)' },
  { id: 'ativacao',   nome: 'Ativação',   desc: 'Primeiros 30 dias desde a 1ª entrega.', c: 'var(--f-ativ)' },
  { id: 'inativo',    nome: 'Inativos',   desc: 'Entregaram no mês anterior e ainda não entregaram neste mês.', c: 'var(--f-inat)' },
  { id: 'v1',         nome: '1 a 50',     desc: 'De 1 a 50 entregas no mês.', c: 'var(--f-v1)', max: 50 },
  { id: 'v2',         nome: '51 a 100',   desc: 'De 51 a 100 entregas no mês.', c: 'var(--f-v2)', max: 100 },
  { id: 'v3',         nome: '101 a 500',  desc: 'De 101 a 500 entregas no mês.', c: 'var(--f-v3)', max: 500 },
  { id: 'v4',         nome: '501 a 1000', desc: 'De 501 a 1000 entregas no mês.', c: 'var(--f-v4)', max: 1000 },
  { id: 'v5',         nome: '+1000',      desc: 'Mais de 1000 entregas no mês.', c: 'var(--f-v5)', max: Infinity },
];
const FAIXAS = FASES.filter(f => f.max);

const parseD = s => { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };

/**
 * Classifica uma loja numa fase.
 * l: { origem, codigo, primeiraEntrega, ultimaEntrega, entregasMes, entregasMesAnterior, mesReferencia, pedidosMes }
 * Se a base ainda está no mês anterior (virada de mês), o número do mês que acabou
 * passa a contar como "mês anterior" e o mês atual começa em zero.
 * Prospecção é só a loja cadastrada pelo comercial. Loja da base sem nenhuma entrega
 * finalizada (só pedidos cancelados) é Inativa, com longo = true e soCancelamentos = true.
 * Pedidos que não viraram entrega (quando a base traz pedidos/cancelamentos):
 *   r.cancelados (mês atual), r.canceladosAnt (mês anterior), r.cancelados2m (soma).
 */
export function classificar(l, hoje = new Date()) {
  const t = new Date(hoje); t.setHours(0, 0, 0, 0);
  const cur = mesKey(t), prev = mesKey(new Date(t.getFullYear(), t.getMonth() - 1, 1));
  let atual = +l.entregasMes || 0, ant = +l.entregasMesAnterior || 0;
  let ped = l.pedidosMes != null ? +l.pedidosMes : null, pedAnt = l.pedidosMesAnterior != null ? +l.pedidosMesAnterior : null;
  const ref = l.mesReferencia || cur;
  // virada de mês: o que era "mês atual" na base passa a ser o anterior (entregas e pedidos)
  if (ref < cur) { ant = ref === prev ? atual : 0; pedAnt = ref === prev ? ped : null; atual = 0; ped = null; }
  const cancelados = ped != null ? Math.max(0, ped - atual) : null, canceladosAnt = pedAnt != null ? Math.max(0, pedAnt - ant) : null;
  const r = { atual, ant, fase: null, diasRest: null, longo: false, soCancelamentos: false,
    cancelados, canceladosAnt, cancelados2m: cancelados == null && canceladosAnt == null ? null : (cancelados || 0) + (canceladosAnt || 0) };
  const daBase = l.origem ? l.origem === 'base' : Boolean(l.codigo);
  if (!daBase && !l.primeiraEntrega && !atual && !ant && !l.ultimaEntrega) { r.fase = 'prospeccao'; return r; }
  const pe = parseD(l.primeiraEntrega);
  if (pe) { const d = Math.round((t - pe) / 864e5); if (d < 30) { r.fase = 'ativacao'; r.diasRest = 30 - d; return r; } }
  if (atual === 0) { r.fase = 'inativo'; r.longo = ant === 0; r.soCancelamentos = r.longo && r.cancelados2m > 0; return r; }
  r.fase = FAIXAS.find(f => atual <= f.max).id;
  return r;
}

/* ---------- Leitura do arquivo/retorno da API ---------- */
function splitCsv(line, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
export function parseEntrada(txt) {
  if (Array.isArray(txt)) return txt;
  if (txt && typeof txt === 'object') return txt.lojas || txt.data || txt.items || txt.results || [txt];
  txt = String(txt || '').replace(/^﻿/, '').trim(); if (!txt) return [];
  if (txt[0] === '[' || txt[0] === '{') return parseEntrada(JSON.parse(txt));
  const lines = txt.split(/\r?\n/).filter(l => l.trim());
  // ";" (Excel BR), "," ou tabulação (linhas copiadas do Google Sheets)
  const sep = [';', ',', '\t'].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const head = splitCsv(lines[0], sep).map(h => h.trim().toLowerCase());
  return lines.slice(1).map(l => { const c = splitCsv(l, sep); const o = {}; head.forEach((h, i) => o[h] = (c[i] || '').trim()); return o; });
}

// Nome de coluna comparável: sem acento, minúsculo, separadores viram "_" ("Entregas Mês" → "entregas_mes")
const chave = k => norm(k).replace(/ /g, '_');
/** Matriz de valores (1ª linha = cabeçalho), como vem do Google Sheets ou de um .xlsx → lista de objetos, sem linhas vazias. */
export function linhasDeMatriz(values) {
  const [cab, ...resto] = values || [];
  if (!cab) return [];
  const chaves = cab.map(h => String(h ?? '').trim());
  return resto
    .filter(r => r && r.some(v => v !== '' && v != null))
    .map(r => Object.fromEntries(chaves.map((k, i) => [k, r[i] ?? ''])));
}

const ALIAS = Object.fromEntries(Object.entries({
  codigo: ['codigo', 'id', 'codigo_loja', 'id_loja', 'store_id', 'id_externo', 'cod_loja', 'id_empresa', 'codigo_empresa'],
  nome: ['nome', 'nome_loja', 'loja', 'nome_fantasia', 'razao_social'],
  cnpj: ['cnpj', 'cpf_cnpj', 'documento'],
  cidade: ['cidade', 'city', 'municipio'],
  uf: ['uf', 'estado'],
  praca: ['praca', 'operacao'],
  tipo_operacao: ['tipo_operacao', 'tipo_de_operacao'],
  bairro: ['bairro'], endereco: ['endereco', 'logradouro'],
  responsavel: ['responsavel', 'contato', 'nome_contato'], telefone: ['telefone', 'whatsapp', 'celular', 'fone'],
  data_cadastro: ['data_cadastro', 'datacadastro', 'cadastro'],
  primeira_entrega: ['data_primeira_entrega', 'primeira_entrega', 'primeiraentrega', 'data_ativacao', 'cliente_desde'],
  entregas_mes: ['entregas_mes', 'entregas_mes_atual', 'entregasmes', 'entregas', 'corridas_mes', 'finalizadas_mes', 'entregas_finalizadas', 'finalizadas'],
  entregas_mes_anterior: ['entregas_mes_anterior', 'entregasmesanterior', 'corridas_mes_anterior'],
  pedidos_mes: ['pedidos_mes', 'total_pedidos', 'pedidos', 'pedidos_mes_atual'],
  cancelamentos_mes: ['cancelamentos_mes', 'cancelamentos', 'cancelados', 'canceladas', 'canceladas_mes'],
  pedidos_mes_anterior: ['pedidos_mes_anterior'],
  cancelamentos_mes_anterior: ['cancelamentos_mes_anterior', 'canceladas_mes_anterior', 'cancelados_mes_anterior'],
  mes_referencia: ['mes_referencia', 'mesreferencia', 'competencia', 'data_referencia', 'data_base'],
  ultima_entrega: ['ultima_entrega', 'data_ultima_entrega', 'ultimaentrega'],
}).map(([f, al]) => [f, al.map(chave)]));

/**
 * Data em AAAA-MM-DD. Aceita AAAA-MM-DD, DD/MM/AAAA e o número serial de data que o
 * Google Sheets/Excel devolvem (dias desde 30/12/1899).
 */
const normData = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v); if (n < 20000 || n > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5).toISOString().slice(0, 10);
  }
  v = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v); if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v); if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
};
const inteiro = v => typeof v === 'number' ? Math.round(v) : parseInt(String(v).replace(/\D/g, ''), 10);
// Planilhas guardam o CNPJ como número e perdem os zeros à esquerda: 12–13 dígitos → 14 (CNPJ), 9–10 → 11 (CPF)
const completarDoc = s => !/^\d+$/.test(s) ? s : s.length === 12 || s.length === 13 ? s.padStart(14, '0') : s.length === 9 || s.length === 10 ? s.padStart(11, '0') : s;

const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const mesAnterior = ym => { const [a, m] = ym.split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${pad(m - 1)}`; };

/**
 * Colunas com o nome do mês → { 'AAAA-MM': n }. Ex.: "Entregas Ago/26", "Finalizadas Set/26 (01–27)",
 * "Canceladas Set/26 (01–27)", "Pedidos Set/26". Totais ("Total Finalizadas Ago+Set") não casam.
 */
function porMes(low, prefixo = '(?:entregas|entregas_finalizadas|finalizadas|corridas)') {
  const out = {};
  const re = new RegExp(`^${prefixo}_(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)_(\\d{4}|\\d{2})(?:_|$)`);
  for (const [k, v] of Object.entries(low)) {
    const m = re.exec(k);
    if (!m) continue;
    const n = inteiro(v); if (isNaN(n)) continue;
    out[`${m[2].length === 2 ? 2000 + +m[2] : m[2]}-${pad(MESES[m[1]])}`] = n;
  }
  return out;
}

/** Converte uma linha crua (qualquer nome de coluna aceito) para o formato do banco. */
export function normalizarLinha(r, hoje = new Date()) {
  const low = {}; Object.keys(r || {}).forEach(k => low[chave(k)] = r[k]);
  const o = {};
  for (const [f, al] of Object.entries(ALIAS)) for (const a of al) {
    if (low[a] !== undefined && low[a] !== null && String(low[a]).trim() !== '') { o[f] = low[a]; break; }
  }
  const out = {};
  ['codigo', 'nome', 'cnpj', 'cidade', 'uf', 'praca', 'tipo_operacao', 'bairro', 'endereco', 'responsavel', 'telefone'].forEach(k => { if (o[k] != null) out[k] = String(o[k]).trim(); });
  if (out.cnpj) out.cnpj = completarDoc(out.cnpj);
  ['data_cadastro', 'primeira_entrega', 'ultima_entrega'].forEach(k => { const d = normData(o[k]); if (d) out[k] = d; });
  ['entregas_mes', 'entregas_mes_anterior'].forEach(k => { if (o[k] != null) { const n = inteiro(o[k]); if (!isNaN(n)) out[k] = n; } });
  const s = o.mes_referencia != null ? String(o.mes_referencia) : '';
  const d = normData(o.mes_referencia), m1 = /^(\d{4})-(\d{2})/.exec(s), m2 = /^(\d{2})\/(\d{4})/.exec(s);
  const mesInformado = d ? d.slice(0, 7) : m1 ? `${m1[1]}-${m1[2]}` : m2 ? `${m2[2]}-${m2[1]}` : null;
  // Sem entregas_mes, usa as colunas com nome do mês: a mais recente é o mês de referência
  const entregas = porMes(low); const meses = Object.keys(entregas).sort();
  if (out.entregas_mes == null && meses.length) {
    const ult = mesInformado && entregas[mesInformado] != null ? mesInformado : meses[meses.length - 1];
    out.entregas_mes = entregas[ult];
    if (out.entregas_mes_anterior == null && entregas[mesAnterior(ult)] != null) out.entregas_mes_anterior = entregas[mesAnterior(ult)];
    out.mes_referencia = ult;
  } else {
    out.mes_referencia = mesInformado || mesKey(hoje);
  }
  // Pedidos do mês e do anterior (taxa de sucesso e cancelamentos): coluna direta, coluna com o nome do mês
  // ou entregas + cancelamentos
  const pedPorMes = porMes(low, 'pedidos'), cancPorMes = porMes(low, '(?:cancelamentos|cancelados|canceladas)');
  const pedidosDe = (mes, campoPed, campoCanc, entregas) => {
    let p = o[campoPed] != null ? inteiro(o[campoPed]) : pedPorMes[mes];
    const c = o[campoCanc] != null ? inteiro(o[campoCanc]) : cancPorMes[mes];
    if ((p == null || isNaN(p)) && c != null && !isNaN(c) && entregas != null) p = entregas + c;
    return p != null && !isNaN(p) ? p : null;
  };
  const pm = pedidosDe(out.mes_referencia, 'pedidos_mes', 'cancelamentos_mes', out.entregas_mes);
  const pa = pedidosDe(mesAnterior(out.mes_referencia), 'pedidos_mes_anterior', 'cancelamentos_mes_anterior', out.entregas_mes_anterior);
  if (pm != null) out.pedidos_mes = pm;
  if (pa != null) out.pedidos_mes_anterior = pa;
  return out;
}

/* ---------- Cidade → praça ---------- */
/** pracas: [{ id, nome, uf, rotulo, aliases[] }] */
export function indicePracas(pracas) {
  const idx = new Map();
  const add = (k, p) => { k = norm(k); if (!k) return; if (!idx.has(k)) idx.set(k, []); if (!idx.get(k).includes(p)) idx.get(k).push(p); };
  for (const p of pracas) {
    add(p.id.replace(/-/g, ' '), p); add(p.rotulo, p); add(p.nome, p); add(p.nome + ' ' + p.uf, p);
    String(p.nome).split(/[\/–—-]/).forEach(x => { add(x, p); add(x + ' ' + p.uf, p); });
    (p.aliases || []).forEach(a => { add(a, p); add(a + ' ' + p.uf, p); });
  }
  return idx;
}
export function acharPraca(n, idx) {
  const cands = [n.praca, n.cidade && n.uf ? n.cidade + ' ' + n.uf : null, n.cidade].filter(Boolean);
  // Operação composta ("BELÉM/PA-ANANINDEUA/PA"): tenta também cada parte "Cidade/UF"
  if (n.praca) String(n.praca).split(/\s*[-–—]\s*(?=[^/]+\/[A-Za-z]{2}\b)/).forEach(p => { if (p && p !== n.praca) cands.push(p); });
  for (const c of cands) {
    const l = idx.get(norm(c));
    if (l && l.length) {
      if (l.length === 1) return l[0];
      if (n.uf) { const m = l.find(p => p.uf === String(n.uf).toUpperCase()); if (m) return m; }
      return l[0];
    }
  }
  return null;
}

/**
 * Prepara as linhas para a função importar_base do banco.
 * O CRM é só para operações próprias: linhas com "Tipo Operação" = Franquia são descartadas e contadas à parte.
 * Retorna { linhas, erros[], semPraca{ 'Cidade/UF': qtd }, franquias }
 */
export function prepararImportacao(rows, pracas, hoje = new Date()) {
  const idx = indicePracas(pracas); const linhas = [], erros = [], semPraca = {}; let franquias = 0;
  rows.forEach((r, i) => {
    const n = normalizarLinha(r, hoje);
    if (/franquia/i.test(n.tipo_operacao || '')) { franquias++; return; }
    delete n.tipo_operacao;
    const falta = ['codigo', 'nome'].filter(k => !n[k]).concat(n.cidade || n.praca ? [] : ['cidade'])
      // sem entregas, a loja seria gravada com zero: melhor recusar (ex.: coluna renomeada na extração)
      .concat(n.entregas_mes == null ? ['entregas do mês (entregas_mes ou "Finalizadas <Mês>/<AA>")'] : []);
    if (falta.length) { erros.push(`Linha ${i + 1}: falta ${falta.join(', ')}`); return; }
    const p = acharPraca(n, idx);
    if (!p) { const k = (n.cidade || n.praca) + (n.uf ? '/' + n.uf : ''); semPraca[k] = (semPraca[k] || 0) + 1; return; }
    const d = { ...n, praca_id: p.id }; delete d.uf; delete d.praca; if (!d.cidade) d.cidade = p.nome;
    linhas.push(d);
  });
  return { linhas, erros, semPraca, franquias };
}

/* ---------- Metas do mês ---------- */
const ALIAS_METAS = Object.fromEntries(Object.entries({
  praca: ['cidade', 'praca', 'operacao'],
  meta: ['entregas_finalizadas', 'meta_entregas', 'meta_corridas', 'meta', 'entregas'],
  meta_empresas: ['empresas_com_entregas', 'meta_empresas', 'empresas'],
  meta_taxa_sucesso: ['taxa_de_sucesso', 'taxa_sucesso', 'meta_taxa_de_sucesso', 'meta_taxa'],
}).map(([f, al]) => [f, al.map(chave)]));

/** Número de uma célula de meta: aceita 5.414 · 5414 · 91,6% · 0,916. "–", "-" e vazio = sem meta (null). */
function numMeta(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim(); if (!s || /^[-–—]+$/.test(s)) return null;
  const pct = s.endsWith('%'); s = s.replace('%', '').trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s.replace(',', '.')); if (!Number.isFinite(n)) return NaN;
  return pct ? n / 100 : n;
}

/**
 * Lê a aba de metas (ex.: "Comerciais - Setembro": CIDADE · Entregas Finalizadas · Empresas com Entregas · Taxa de Sucesso).
 * Retorna { metas: [{ praca_id, meta, meta_empresas, meta_taxa_sucesso }], semPraca[], erros[] }.
 * Praça com "–" fica sem meta (null). Taxa pode vir como 0,916, 91,6 ou 91,6%.
 */
export function prepararMetas(rows, pracas) {
  const idx = indicePracas(pracas); const metas = [], semPraca = [], erros = [];
  const vistos = new Set();
  rows.forEach((r, i) => {
    const low = {}; Object.keys(r || {}).forEach(k => low[chave(k)] = r[k]);
    const val = f => { const k = ALIAS_METAS[f].find(a => a in low); return k === undefined ? undefined : low[k]; };
    const praca = String(val('praca') ?? '').trim(); if (!praca) return;
    if (val('meta') === undefined) { erros.push('Coluna "Entregas Finalizadas" (meta de entregas) não encontrada'); return; }
    const p = acharPraca({ praca }, idx); if (!p) { semPraca.push(praca); return; }
    if (vistos.has(p.id)) { erros.push(`Linha ${i + 2}: ${praca} aparece mais de uma vez`); return; }
    const meta = numMeta(val('meta')), emp = numMeta(val('meta_empresas'));
    // Taxa: "91,6%" já vem em fração; 91,6 (sem %) é lido como porcentagem; 0,916 fica como está
    const brutoTaxa = val('meta_taxa_sucesso');
    let taxa = numMeta(brutoTaxa); if (taxa != null && taxa > 1 && !String(brutoTaxa).trim().endsWith('%')) taxa /= 100;
    if (taxa != null && !Number.isNaN(taxa)) taxa = Math.round(taxa * 1e6) / 1e6; // 91,6% → 0,916 (sem resíduo de ponto flutuante)
    if ([meta, emp, taxa].some(n => Number.isNaN(n) || n < 0) || (taxa != null && taxa > 1)) { erros.push(`Linha ${i + 2}: valor inválido em ${praca}`); return; }
    vistos.add(p.id);
    metas.push({ praca_id: p.id, meta: meta == null ? null : Math.round(meta), meta_empresas: emp, meta_taxa_sucesso: taxa });
  });
  return { metas, semPraca, erros };
}

/**
 * Soma indicadores de várias praças (grupo, regional, total).
 * itens: [{ meta, produzido, metaEmpresas, empresas, metaTaxa, entregasTaxa, pedidos }]
 * A taxa de sucesso é ponderada pelos pedidos: meta = Σ metas de entregas ÷ Σ (meta ÷ meta de taxa);
 * realizado = Σ entregas ÷ Σ pedidos (só lojas com pedidos informados).
 */
export function somarIndicadores(itens) {
  let metaEmp = 0, nEmp = 0, empresas = 0, entMeta = 0, pedMeta = 0, ent = 0, ped = 0;
  for (const x of itens) {
    if (x.metaEmpresas != null) { metaEmp += +x.metaEmpresas; nEmp++; }
    empresas += x.empresas || 0;
    if (x.meta && x.metaTaxa) { entMeta += +x.meta; pedMeta += x.meta / x.metaTaxa; }
    if (x.pedidos) { ent += x.entregasTaxa || 0; ped += x.pedidos; }
  }
  return {
    metaEmpresas: nEmp ? metaEmp : null, empresas,
    metaTaxa: pedMeta ? entMeta / pedMeta : null, taxa: ped ? ent / ped : null,
  };
}
