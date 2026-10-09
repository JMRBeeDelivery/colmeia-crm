#!/usr/bin/env node
// Colmeia CRM · sync diário da base de lojas.
// Roda no GitHub Actions (.github/workflows/sync.yml) ou na sua máquina:
//   npm run sync                         → lê a base (SharePoint, Google Sheets ou API) e grava no Supabase
//   node scripts/sync.mjs --arquivo x.xlsx → usa um arquivo local (.xlsx, .csv ou .json)
//   node scripts/sync.mjs --simular        → mostra o que faria, sem gravar
//
// Origem da base — configure UMA delas (--arquivo tem prioridade):
//   SharePoint:    SHAREPOINT_URL (+ SHAREPOINT_ABA opcional) + AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
//   Google Sheets: GOOGLE_SHEETS_URL (+ GOOGLE_SHEETS_ABA opcional, + GOOGLE_SERVICE_ACCOUNT_JSON para planilha privada)
//   API:           BASE_API_URL (+ BASE_API_TOKEN, BASE_API_HEADER)
// Outras variáveis: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ATUALIZAR_PRODUZIDO (padrão true).
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { parseEntrada, prepararImportacao, linhasDeMatriz, classificar, FASES } from '../assets/base.js';
import { lerPlanilha } from './gsheets.mjs';
import { lerSharePoint } from './sharepoint.mjs';
import { lerXlsx } from './xlsx.mjs';

// carrega .env local, se existir (sem dependência extra)
if (existsSync('.env')) {
  for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const args = process.argv.slice(2);
const arg = n => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null; };
const SIMULAR = !!arg('--simular');
const ARQUIVO = arg('--arquivo');
const env = k => process.env[k] || '';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Qual origem usar: 'arquivo' | 'sharepoint' | 'google' | 'api'. Recusa duas origens ao mesmo tempo. */
function escolherOrigem() {
  if (ARQUIVO) return 'arquivo';
  const ativas = [env('SHAREPOINT_URL') && 'sharepoint', env('GOOGLE_SHEETS_URL') && 'google', env('BASE_API_URL') && 'api'].filter(Boolean);
  if (ativas.length > 1) {
    throw new Error(`Mais de uma origem configurada (${ativas.join(', ')}). Deixe preenchida só uma: SHAREPOINT_URL, GOOGLE_SHEETS_URL ou BASE_API_URL.`);
  }
  if (!ativas.length) throw new Error('Nenhuma origem configurada. Defina SHAREPOINT_URL, GOOGLE_SHEETS_URL ou BASE_API_URL (ou use --arquivo).');
  return ativas[0];
}

function fonte(origem) {
  if (origem === 'arquivo') return 'Arquivo ' + ARQUIVO;
  if (origem === 'sharepoint') return 'SharePoint' + (env('SHAREPOINT_ABA') ? ' · ' + env('SHAREPOINT_ABA') : '');
  if (origem === 'google') return 'Google Sheets' + (env('GOOGLE_SHEETS_ABA') ? ' · ' + env('GOOGLE_SHEETS_ABA') : '');
  return 'API (GitHub Actions)';
}

async function obterLinhas(origem) {
  if (origem === 'arquivo') {
    log('Lendo arquivo', ARQUIVO);
    if (/\.xls[xm]$/i.test(ARQUIVO)) return linhasDeMatriz(lerXlsx(await readFile(ARQUIVO), env('SHAREPOINT_ABA') || env('GOOGLE_SHEETS_ABA')));
    return parseEntrada(await readFile(ARQUIVO, 'utf8'));
  }
  if (origem === 'sharepoint') {
    log('Lendo arquivo do SharePoint');
    return lerSharePoint({
      link: env('SHAREPOINT_URL'), aba: env('SHAREPOINT_ABA'),
      tenant: env('AZURE_TENANT_ID'), clientId: env('AZURE_CLIENT_ID'), clientSecret: env('AZURE_CLIENT_SECRET'),
    });
  }
  if (origem === 'google') {
    const credenciais = env('GOOGLE_SERVICE_ACCOUNT_JSON');
    log(`Lendo planilha do Google Sheets (${credenciais ? 'conta de serviço' : 'link compartilhado'})`);
    return lerPlanilha({ link: env('GOOGLE_SHEETS_URL'), aba: env('GOOGLE_SHEETS_ABA'), credenciais });
  }
  const url = env('BASE_API_URL');
  const headers = { Accept: 'application/json' };
  if (env('BASE_API_TOKEN')) {
    const h = env('BASE_API_HEADER') || 'Authorization';
    headers[h] = h.toLowerCase() === 'authorization' ? `Bearer ${env('BASE_API_TOKEN')}` : env('BASE_API_TOKEN');
  }
  log('Buscando', url);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`API respondeu ${res.status} ${res.statusText}`);
  const tipo = res.headers.get('content-type') || '';
  return parseEntrada(tipo.includes('json') ? await res.json() : await res.text());
  // Se a API for paginada, adapte aqui: acumule as páginas antes de retornar.
}

async function main() {
  const origem = escolherOrigem();
  const rows = await obterLinhas(origem);
  log(`${rows.length} linhas recebidas de ${fonte(origem)}`);

  let sb = null, pracas;
  if (SIMULAR && !env('SUPABASE_URL')) {
    // simulação offline: usa as praças do seed
    const sql = await readFile(new URL('../supabase/seed.sql', import.meta.url), 'utf8');
    pracas = [...sql.matchAll(/\('([a-z0-9-]+)', '([^']+)', '([A-Z]{2})', '([^']+)', '\{([^}]*)\}'/g)]
      .map(m => ({ id: m[1], nome: m[2], uf: m[3], rotulo: m[4], aliases: m[5] ? m[5].split(',') : [] }));
    log(`Simulação offline com ${pracas.length} praças do seed.sql`);
  } else {
    const { createClient } = await import('@supabase/supabase-js');
    if (!env('SUPABASE_URL') || !env('SUPABASE_SERVICE_ROLE_KEY')) throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
    // Tolera os erros comuns de copiar e colar: espaços/quebras de linha e a URL com /rest/v1/ no fim
    const url = env('SUPABASE_URL').replace(/\s+/g, '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
    sb = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY').replace(/\s+/g, ''), { auth: { persistSession: false } });
    const { data, error } = await sb.from('pracas').select('id,nome,uf,rotulo,aliases');
    if (error) throw error; pracas = data;
  }

  const { linhas, erros, semPraca, franquias } = prepararImportacao(rows, pracas);
  const nSem = Object.values(semPraca).reduce((s, n) => s + n, 0);
  log(`${linhas.length} lojas válidas · ${franquias} franquias ignoradas · ${nSem} sem praça · ${erros.length} com erro`);
  if (nSem) log('Cidades sem praça cadastrada:', Object.entries(semPraca).map(([k, n]) => `${k} (${n})`).join(', '));
  if (erros.length) log('Erros:', erros.slice(0, 10).join(' | '));
  if (!linhas.length && erros.length) throw new Error(`Nenhuma loja válida na base (${erros.length} linhas com erro). Confira se as colunas mudaram de nome: ${erros[0]}`);

  if (SIMULAR) {
    const porPraca = {}; linhas.forEach(l => porPraca[l.praca_id] = (porPraca[l.praca_id] || 0) + 1);
    log('Lojas por praça:', JSON.stringify(porPraca));
    // Fase que cada loja teria hoje (lojas novas; prospecções já cadastradas não entram na conta)
    const porFase = Object.fromEntries(FASES.map(f => [f.id, 0]));
    let soCanc = 0, soCancPed = 0, parouCanc = 0;
    linhas.forEach(l => {
      const c = classificar({ origem: 'base', primeiraEntrega: l.primeira_entrega, ultimaEntrega: l.ultima_entrega, entregasMes: l.entregas_mes, entregasMesAnterior: l.entregas_mes_anterior, mesReferencia: l.mes_referencia, pedidosMes: l.pedidos_mes, pedidosMesAnterior: l.pedidos_mes_anterior });
      porFase[c.fase]++;
      if (c.soCancelamentos) { soCanc++; soCancPed += c.cancelados2m; } else if (c.fase === 'inativo' && c.cancelados > 0) parouCanc++;
    });
    log('Lojas por fase:', FASES.map(f => `${f.nome} ${porFase[f.id]}`).join(' · '));
    if (soCanc || parouCanc) log(`Inativos: ${soCanc} só com cancelamentos (${soCancPed} pedidos cancelados em 2 meses) · ${parouCanc} pararam e cancelaram pedidos no mês`);
    const comPed = linhas.filter(l => l.pedidos_mes != null);
    const ent = comPed.reduce((s, l) => s + (l.entregas_mes || 0), 0), ped = comPed.reduce((s, l) => s + l.pedidos_mes, 0);
    log(comPed.length ? `Taxa de sucesso: ${(ent / ped * 100).toFixed(1)}% (${ent} finalizadas de ${ped} pedidos, ${comPed.length} lojas com pedidos)` : 'Taxa de sucesso: a base não traz pedidos nem cancelamentos');
    log('Simulação concluída. Nada foi gravado.');
    return;
  }

  const tot = { total: 0, novos: 0, atualizados: 0, convertidos: 0 };
  let emAtivacao = 0; // lojas novas (fora da carga inicial) que entraram em Ativação
  const LOTE = 500;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { data, error } = await sb.rpc('importar_base', { p_linhas: linhas.slice(i, i + LOTE) });
    if (error) throw error;
    Object.keys(tot).forEach(k => tot[k] += data[k] || 0);
    emAtivacao += data.em_ativacao || 0;
    log(`Lote ${i / LOTE + 1}: ${JSON.stringify(data)}`);
  }

  if ((env('ATUALIZAR_PRODUZIDO') || 'true') !== 'false') {
    const ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const { data, error } = await sb.rpc('recalcular_produzido', { p_ate: ontem });
    if (error) throw error;
    log(`Produzido recalculado em ${data} praças (até ${ontem})`);
  }

  const { error } = await sb.from('sync_log').insert({
    fonte: fonte(origem), ...tot, sem_praca: nSem, erros: erros.length,
    detalhes: { sem_praca: semPraca, franquias_ignoradas: franquias, em_ativacao: emAtivacao, erros: erros.slice(0, 50) },
  });
  if (error) throw error;
  log('Concluído:', JSON.stringify({ ...tot, em_ativacao: emAtivacao }));
}

main().catch(e => { console.error('Falha no sync:', e.message || e); process.exit(1); });
