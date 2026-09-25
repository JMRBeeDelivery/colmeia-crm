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
  { id: 'v1',         nome: '1 a 50',     desc: 'De 1 a 50 entregas no mês.', c: 'var(--f-v1)' },
  { id: 'v2',         nome: '51 a 100',   desc: 'De 51 a 100 entregas no mês.', c: 'var(--f-v2)' },
  { id: 'v3',         nome: '+100',       desc: 'Mais de 100 entregas no mês.', c: 'var(--f-v3)' },
];

const parseD = s => { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };

/**
 * Classifica uma loja numa fase.
 * l: { primeiraEntrega, ultimaEntrega, entregasMes, entregasMesAnterior, mesReferencia }
 * Se a base ainda está no mês anterior (virada de mês), o número do mês que acabou
 * passa a contar como "mês anterior" e o mês atual começa em zero.
 */
export function classificar(l, hoje = new Date()) {
  const t = new Date(hoje); t.setHours(0, 0, 0, 0);
  const cur = mesKey(t), prev = mesKey(new Date(t.getFullYear(), t.getMonth() - 1, 1));
  let atual = +l.entregasMes || 0, ant = +l.entregasMesAnterior || 0;
  const ref = l.mesReferencia || cur;
  if (ref < cur) { ant = ref === prev ? atual : 0; atual = 0; }
  const r = { atual, ant, fase: null, diasRest: null, longo: false };
  if (!l.primeiraEntrega && !atual && !ant && !l.ultimaEntrega) { r.fase = 'prospeccao'; return r; }
  const pe = parseD(l.primeiraEntrega);
  if (pe) { const d = Math.round((t - pe) / 864e5); if (d < 30) { r.fase = 'ativacao'; r.diasRest = 30 - d; return r; } }
  if (atual === 0) { r.fase = 'inativo'; r.longo = ant === 0; return r; }
  r.fase = atual <= 50 ? 'v1' : atual <= 100 ? 'v2' : 'v3';
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
  const sep = lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  const head = splitCsv(lines[0], sep).map(h => h.trim().toLowerCase());
  return lines.slice(1).map(l => { const c = splitCsv(l, sep); const o = {}; head.forEach((h, i) => o[h] = (c[i] || '').trim()); return o; });
}

const ALIAS = {
  codigo: ['codigo', 'código', 'id', 'codigo_loja', 'id_loja', 'store_id'],
  nome: ['nome', 'nome_loja', 'loja', 'razao_social'],
  cnpj: ['cnpj'],
  cidade: ['cidade', 'city', 'municipio', 'município'],
  uf: ['uf', 'estado'],
  praca: ['praca', 'praça', 'operacao', 'operação'],
  bairro: ['bairro'], endereco: ['endereco', 'endereço', 'logradouro'],
  responsavel: ['responsavel', 'responsável', 'contato'], telefone: ['telefone', 'whatsapp', 'celular', 'fone'],
  data_cadastro: ['data_cadastro', 'datacadastro', 'cadastro'],
  primeira_entrega: ['data_primeira_entrega', 'primeira_entrega', 'primeiraentrega', 'data_ativacao'],
  entregas_mes: ['entregas_mes', 'entregas_mes_atual', 'entregasmes', 'entregas', 'corridas_mes'],
  entregas_mes_anterior: ['entregas_mes_anterior', 'entregasmesanterior', 'corridas_mes_anterior'],
  mes_referencia: ['mes_referencia', 'mesreferencia', 'competencia'],
  ultima_entrega: ['ultima_entrega', 'data_ultima_entrega', 'ultimaentrega'],
};
const normData = v => {
  if (!v) return null; v = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
};

/** Converte uma linha crua (qualquer nome de coluna aceito) para o formato do banco. */
export function normalizarLinha(r, hoje = new Date()) {
  const low = {}; Object.keys(r || {}).forEach(k => low[k.toLowerCase().trim()] = r[k]);
  const o = {};
  for (const [f, al] of Object.entries(ALIAS)) for (const a of al) {
    if (low[a] !== undefined && low[a] !== null && String(low[a]).trim() !== '') { o[f] = low[a]; break; }
  }
  const out = {};
  ['codigo', 'nome', 'cnpj', 'cidade', 'uf', 'praca', 'bairro', 'endereco', 'responsavel', 'telefone'].forEach(k => { if (o[k] != null) out[k] = String(o[k]).trim(); });
  ['data_cadastro', 'primeira_entrega', 'ultima_entrega'].forEach(k => { const d = normData(o[k]); if (d) out[k] = d; });
  ['entregas_mes', 'entregas_mes_anterior'].forEach(k => { if (o[k] != null) { const n = parseInt(String(o[k]).replace(/\D/g, ''), 10); if (!isNaN(n)) out[k] = n; } });
  const s = o.mes_referencia ? String(o.mes_referencia) : '';
  const m1 = /^(\d{4})-(\d{2})/.exec(s), m2 = /^(\d{2})\/(\d{4})/.exec(s);
  out.mes_referencia = m1 ? `${m1[1]}-${m1[2]}` : m2 ? `${m2[2]}-${m2[1]}` : mesKey(hoje);
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
 * Retorna { linhas, erros[], semPraca{ 'Cidade/UF': qtd } }
 */
export function prepararImportacao(rows, pracas, hoje = new Date()) {
  const idx = indicePracas(pracas); const linhas = [], erros = [], semPraca = {};
  rows.forEach((r, i) => {
    const n = normalizarLinha(r, hoje);
    const falta = ['codigo', 'nome'].filter(k => !n[k]).concat(n.cidade || n.praca ? [] : ['cidade']);
    if (falta.length) { erros.push(`Linha ${i + 1}: falta ${falta.join(', ')}`); return; }
    const p = acharPraca(n, idx);
    if (!p) { const k = (n.cidade || n.praca) + (n.uf ? '/' + n.uf : ''); semPraca[k] = (semPraca[k] || 0) + 1; return; }
    const d = { ...n, praca_id: p.id }; delete d.uf; delete d.praca; if (!d.cidade) d.cidade = p.nome;
    linhas.push(d);
  });
  return { linhas, erros, semPraca };
}
