#!/usr/bin/env node
// Colmeia CRM · sync diário da base de lojas.
// Roda no GitHub Actions (.github/workflows/sync.yml) ou na sua máquina:
//   npm run sync                         → busca na API e grava no Supabase
//   node scripts/sync.mjs --arquivo x.json → usa um arquivo local em vez da API
//   node scripts/sync.mjs --simular        → mostra o que faria, sem gravar
//
// Variáveis de ambiente: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BASE_API_URL,
// BASE_API_TOKEN, BASE_API_HEADER (opcional), ATUALIZAR_PRODUZIDO (padrão true).
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { parseEntrada, prepararImportacao } from '../assets/base.js';

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

async function obterLinhas() {
  if (ARQUIVO) { log('Lendo arquivo', ARQUIVO); return parseEntrada(await readFile(ARQUIVO, 'utf8')); }
  const url = env('BASE_API_URL'); if (!url) throw new Error('Defina BASE_API_URL (ou use --arquivo).');
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
  const rows = await obterLinhas();
  log(`${rows.length} linhas recebidas`);

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
    sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const { data, error } = await sb.from('pracas').select('id,nome,uf,rotulo,aliases');
    if (error) throw error; pracas = data;
  }

  const { linhas, erros, semPraca } = prepararImportacao(rows, pracas);
  const nSem = Object.values(semPraca).reduce((s, n) => s + n, 0);
  log(`${linhas.length} lojas válidas · ${nSem} sem praça · ${erros.length} com erro`);
  if (nSem) log('Cidades sem praça cadastrada:', Object.entries(semPraca).map(([k, n]) => `${k} (${n})`).join(', '));
  if (erros.length) log('Erros:', erros.slice(0, 10).join(' | '));

  if (SIMULAR) {
    const porPraca = {}; linhas.forEach(l => porPraca[l.praca_id] = (porPraca[l.praca_id] || 0) + 1);
    log('Lojas por praça:', JSON.stringify(porPraca));
    log('Simulação concluída. Nada foi gravado.');
    return;
  }

  const tot = { total: 0, novos: 0, atualizados: 0, convertidos: 0 };
  const LOTE = 500;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { data, error } = await sb.rpc('importar_base', { p_linhas: linhas.slice(i, i + LOTE) });
    if (error) throw error;
    Object.keys(tot).forEach(k => tot[k] += data[k] || 0);
    log(`Lote ${i / LOTE + 1}: ${JSON.stringify(data)}`);
  }

  if ((env('ATUALIZAR_PRODUZIDO') || 'true') !== 'false') {
    const ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const { data, error } = await sb.rpc('recalcular_produzido', { p_ate: ontem });
    if (error) throw error;
    log(`Produzido recalculado em ${data} praças (até ${ontem})`);
  }

  const { error } = await sb.from('sync_log').insert({
    fonte: ARQUIVO ? 'Arquivo ' + ARQUIVO : 'API (GitHub Actions)', ...tot, sem_praca: nSem, erros: erros.length,
    detalhes: { sem_praca: semPraca, erros: erros.slice(0, 50) },
  });
  if (error) throw error;
  log('Concluído:', JSON.stringify(tot));
}

main().catch(e => { console.error('Falha no sync:', e.message || e); process.exit(1); });
