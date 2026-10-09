// Testes das regras de negócio: node --test scripts/
import test from 'node:test';
import assert from 'node:assert/strict';
import { classificar, indicePracas, acharPraca, prepararImportacao, parseEntrada, prepararMetas, somarIndicadores } from '../assets/base.js';

const H = new Date(2026, 8, 25); // 25/09/2026
const f = l => classificar({ mesReferencia: '2026-09', ...l }, H).fase;

test('prospecção: nunca entregou', () => assert.equal(f({}), 'prospeccao'));
test('ativação: primeira entrega há menos de 30 dias', () => assert.equal(f({ primeiraEntrega: '2026-09-01', entregasMes: 80 }), 'ativacao'));
test('ativação termina no 30º dia', () => assert.equal(f({ primeiraEntrega: '2026-08-26', entregasMes: 10 }), 'v1'));
test('inativo: entregou no mês anterior, zero no atual', () => assert.equal(f({ primeiraEntrega: '2026-01-10', entregasMes: 0, entregasMesAnterior: 30 }), 'inativo'));
test('faixas de volume', () => {
  const v = n => f({ primeiraEntrega: '2026-01-10', entregasMes: n });
  assert.equal(v(1), 'v1'); assert.equal(v(50), 'v1');
  assert.equal(v(51), 'v2'); assert.equal(v(100), 'v2');
  assert.equal(v(101), 'v3'); assert.equal(v(500), 'v3');
  assert.equal(v(501), 'v4'); assert.equal(v(1000), 'v4');
  assert.equal(v(1001), 'v5'); assert.equal(v(25000), 'v5');
});
test('inativo há 2+ meses fica em Inativos com a etiqueta "longo"', () => {
  const r = classificar({ primeiraEntrega: '2025-01-10', entregasMes: 0, entregasMesAnterior: 0, ultimaEntrega: '2026-06-30', mesReferencia: '2026-09' }, H);
  assert.equal(r.fase, 'inativo'); assert.equal(r.longo, true);
});
test('virada de mês: base ainda no mês anterior vira "inativo"', () => {
  const r = classificar({ primeiraEntrega: '2026-01-10', entregasMes: 70, mesReferencia: '2026-08' }, H);
  assert.equal(r.fase, 'inativo'); assert.equal(r.ant, 70); assert.equal(r.atual, 0);
});

const pracas = [
  { id: 'natal-rn', nome: 'Natal', uf: 'RN', rotulo: 'Natal/RN', aliases: [] },
  { id: 'cuiaba-varzea-grande-mt', nome: 'Cuiabá–Várzea Grande', uf: 'MT', rotulo: 'Cuiabá–Várzea Grande/MT', aliases: ['Cuiabá', 'Várzea Grande'] },
  { id: 'campo-grande-ms', nome: 'Campo Grande', uf: 'MS', rotulo: 'Campo Grande/MS', aliases: [] },
];
test('cidade → praça, com e sem acento e UF', () => {
  const idx = indicePracas(pracas);
  assert.equal(acharPraca({ cidade: 'NATAL' }, idx).id, 'natal-rn');
  assert.equal(acharPraca({ cidade: 'Varzea Grande', uf: 'MT' }, idx).id, 'cuiaba-varzea-grande-mt');
  assert.equal(acharPraca({ cidade: 'Cuiabá' }, idx).id, 'cuiaba-varzea-grande-mt');
  assert.equal(acharPraca({ cidade: 'Campo Grande', uf: 'MS' }, idx).id, 'campo-grande-ms');
  assert.equal(acharPraca({ cidade: 'Petrolina', uf: 'PE' }, idx), null);
});
test('prepararImportacao aceita CSV-like com colunas alternativas e datas BR', () => {
  const r = prepararImportacao([{ 'Código': 'X1', Loja: 'Teste', Cidade: 'Natal', UF: 'RN', entregas: '1.234', data_primeira_entrega: '20/05/2026' }, { codigo: 'X2', nome: 'Sem cidade' }], pracas, H);
  assert.equal(r.linhas.length, 1); assert.equal(r.linhas[0].praca_id, 'natal-rn');
  assert.equal(r.linhas[0].entregas_mes, 1234); assert.equal(r.linhas[0].primeira_entrega, '2026-05-20');
  assert.equal(r.erros.length, 1);
});
test('formato da base da Bee: "ID Empresa", "Operação" e entregas com o nome do mês', () => {
  const base = { 'ID Empresa': 70001, 'Loja': 'Farmácia Teste', 'CNPJ': '01234567000190', 'Operação': 'NATAL/RN', 'Tipo Operação': 'Própria',
    'Comercial (Set/26)': 'EUCLIDES JUNIOR', 'Entregas Ago/26': 120, 'Entregas Set/26 (01–27)': 0, 'Total Ago+Set': 120 };
  const r = prepararImportacao([base, { ...base, 'ID Empresa': 70002, 'Operação': 'BELÉM/PA-ANANINDEUA/PA', 'Entregas Set/26 (01–27)': 640 }], [...pracas,
    { id: 'belem-ananindeua-pa', nome: 'Belém–Ananindeua', uf: 'PA', rotulo: 'Belém–Ananindeua/PA', aliases: ['Belém', 'Ananindeua'] }], H);
  assert.equal(r.erros.length, 0);
  const [a, b] = r.linhas;
  assert.equal(a.codigo, '70001'); assert.equal(a.praca_id, 'natal-rn');
  assert.equal(a.mes_referencia, '2026-09'); assert.equal(a.entregas_mes, 0); assert.equal(a.entregas_mes_anterior, 120);
  assert.equal(classificar({ entregasMes: a.entregas_mes, entregasMesAnterior: a.entregas_mes_anterior, mesReferencia: a.mes_referencia, primeiraEntrega: '2025-01-01' }, H).fase, 'inativo');
  assert.equal(b.praca_id, 'belem-ananindeua-pa', 'operação composta');
  assert.equal(classificar({ entregasMes: b.entregas_mes, mesReferencia: b.mes_referencia, primeiraEntrega: '2025-01-01' }, H).fase, 'v4');
});
test('franquias ficam de fora e são contadas à parte (o CRM é só de operações próprias)', () => {
  const l = { 'ID Empresa': 1, 'Loja': 'X', 'Operação': 'NATAL/RN', 'Entregas Set/26 (01–27)': 5 };
  const r = prepararImportacao([{ ...l, 'Tipo Operação': 'Própria' }, { ...l, 'ID Empresa': 2, 'Tipo Operação': 'Franquia' }, { ...l, 'ID Empresa': 3, 'Operação': 'FORTALEZA/CE', 'Tipo Operação': 'FRANQUIA' }], pracas, H);
  assert.equal(r.linhas.length, 1); assert.equal(r.franquias, 2);
  assert.deepEqual(r.semPraca, {}, 'franquia não aparece como cidade sem praça');
  assert.equal('tipo_operacao' in r.linhas[0], false, 'campo não vai para o banco');
  assert.equal(prepararImportacao([{ codigo: 'Z', nome: 'Sem tipo', cidade: 'Natal', uf: 'RN', entregas_mes: 3 }], pracas, H).linhas.length, 1, 'sem a coluna, conta como própria');
});
test('metas do mês coladas da planilha (tabulação, "–" = sem meta, taxa em 0,916 ou 91,6%)', () => {
  const txt = 'CIDADE\tSUPERVISOR\tCOMERCIAL\tEntregas Finalizadas\tEmpresas com Entregas\tTaxa de Sucesso\t\tTotal Pedidos\n'
    + 'NATAL/RN\tLUCAS PACHECO\tEUCLIDES JUNIOR\t28.618\t389\t0,923\t\t31005,42\n'
    + 'CUIABÁ/VÁRZEA GRANDE-MT\tLUCAS PACHECO\tFRANCIELE\t–\t–\t–\t\t\n'
    + 'CAMPO GRANDE/MS\tSEM_SUPERVISOR\tSEM_COMERCIAL\t1.000\t12,5\t91,6%\t\t\n'
    + 'PETROLINA/PE\t-\t-\t10\t1\t0,9\t\t\n';
  const r = prepararMetas(parseEntrada(txt), pracas);
  assert.deepEqual(r.semPraca, ['PETROLINA/PE']); assert.deepEqual(r.erros, []);
  const m = Object.fromEntries(r.metas.map(x => [x.praca_id, x]));
  assert.deepEqual(m['natal-rn'], { praca_id: 'natal-rn', meta: 28618, meta_empresas: 389, meta_taxa_sucesso: 0.923 });
  assert.deepEqual(m['cuiaba-varzea-grande-mt'], { praca_id: 'cuiaba-varzea-grande-mt', meta: null, meta_empresas: null, meta_taxa_sucesso: null });
  assert.equal(m['campo-grande-ms'].meta_empresas, 12.5); assert.equal(m['campo-grande-ms'].meta_taxa_sucesso, 0.916);
  assert.match(prepararMetas([{ CIDADE: 'NATAL/RN', 'Taxa de Sucesso': 0.9 }], pracas).erros[0], /Entregas Finalizadas/);
  assert.match(prepararMetas([{ CIDADE: 'NATAL/RN', 'Entregas Finalizadas': 10, 'Taxa de Sucesso': '150%' }], pracas).erros[0], /inválido/);
});
test('totais de metas: soma de entregas e empresas, taxa ponderada pelos pedidos (como na planilha)', () => {
  // Regional do Lucas Pacheco na planilha de set/26 → 66.612 entregas · 975,6939609 empresas · taxa 0,9171472146
  const lucas = [[28618, 389, 0.923], [15558, 180.9069767, 0.891], [7508, 88, 0.927], [5414, 76, 0.916], [4998, 98, 0.972], [1937, 53.80555556, 0.947],
    [1003, 35.82142857, 0.909], [716, 14.32, 0.835], [475, 21, 0.857], [264, 14, 0.887], [121, 4.84, 0.791], [null, null, null], [null, null, null]]
    .map(([meta, metaEmpresas, metaTaxa]) => ({ meta, metaEmpresas, metaTaxa, empresas: 0 }));
  const s = somarIndicadores(lucas);
  assert.equal(lucas.reduce((a, x) => a + (x.meta || 0), 0), 66612);
  assert.ok(Math.abs(s.metaEmpresas - 975.6939609) < 1e-6);
  assert.ok(Math.abs(s.metaTaxa - 0.9171472146) < 1e-9);
  assert.equal(s.taxa, null, 'sem pedidos na base, sem taxa realizada');
  const r = somarIndicadores([{ meta: 100, metaTaxa: 0.9, entregasTaxa: 90, pedidos: 100 }, { meta: 100, metaTaxa: 0.8, entregasTaxa: 30, pedidos: 50 }]);
  assert.equal(r.taxa, 120 / 150);
});
test('pedidos do mês na base: coluna direta, com o nome do mês ou entregas + cancelamentos', () => {
  const b = { 'ID Empresa': 9, 'Loja': 'L', 'Operação': 'NATAL/RN', 'Entregas Ago/26': 50, 'Entregas Set/26 (01–27)': 90 };
  const l = rows => prepararImportacao(rows, pracas, H).linhas[0];
  assert.equal(l([{ ...b, 'Pedidos Ago/26': 60, 'Pedidos Set/26 (01–27)': 100 }]).pedidos_mes, 100);
  assert.equal(l([{ ...b, 'Cancelamentos Set/26': 7 }]).pedidos_mes, 97);
  assert.equal(l([{ ...b, 'Total Pedidos': 95 }]).pedidos_mes, 95);
  assert.equal('pedidos_mes' in l([b]), false, 'sem o dado, não envia');
});
test('base com "Finalizadas" e "Canceladas" por mês: taxa de sucesso e loja só com cancelamentos', () => {
  const b = { 'ID Empresa': 77, 'Loja': 'L', 'Operação': 'NATAL/RN', 'Tipo Operação': 'Própria', 'Finalizadas Ago/26': 40, 'Finalizadas Set/26 (01–27)': 90,
    'Canceladas Ago/26': 5, 'Canceladas Set/26 (01–27)': 10, 'Total Finalizadas Ago+Set': 130, 'Total Canceladas Ago+Set': 15, '% Cancelamento Ago+Set': 0.103 };
  const [l] = prepararImportacao([b], pracas, H).linhas;
  assert.deepEqual([l.entregas_mes, l.entregas_mes_anterior, l.pedidos_mes, l.mes_referencia], [90, 40, 100, '2026-09']);
  // loja que só teve pedidos cancelados: é da base, então não é Prospecção
  const [c] = prepararImportacao([{ ...b, 'ID Empresa': 78, 'Finalizadas Ago/26': 0, 'Finalizadas Set/26 (01–27)': 0, 'Canceladas Set/26 (01–27)': 3 }], pracas, H).linhas;
  assert.equal(c.pedidos_mes_anterior, 5, 'agosto: 0 finalizadas + 5 canceladas');
  const r = classificar({ origem: 'base', codigo: c.codigo, entregasMes: c.entregas_mes, entregasMesAnterior: c.entregas_mes_anterior, mesReferencia: c.mes_referencia, pedidosMes: c.pedidos_mes, pedidosMesAnterior: c.pedidos_mes_anterior }, H);
  assert.equal(r.fase, 'inativo'); assert.equal(r.longo, true); assert.equal(r.soCancelamentos, true);
  assert.deepEqual([r.cancelados, r.canceladosAnt, r.cancelados2m], [3, 5, 8]);
  // só cancelou em agosto: continua sinalizada
  const soAgo = classificar({ origem: 'base', entregasMes: 0, entregasMesAnterior: 0, mesReferencia: '2026-09', pedidosMes: 0, pedidosMesAnterior: 4 }, H);
  assert.deepEqual([soAgo.soCancelamentos, soAgo.cancelados2m], [true, 4]);
  // parou este mês (entregou em agosto) não é "só cancelamentos", mas conta as canceladas
  const parou = classificar({ origem: 'base', entregasMes: 0, entregasMesAnterior: 30, mesReferencia: '2026-09', pedidosMes: 2, pedidosMesAnterior: 33 }, H);
  assert.deepEqual([parou.fase, parou.soCancelamentos, parou.cancelados, parou.canceladosAnt], ['inativo', false, 2, 3]);
  // virada de mês: os pedidos do mês que acabou passam a ser do anterior
  const vira = classificar({ origem: 'base', entregasMes: 0, mesReferencia: '2026-08', pedidosMes: 6 }, H);
  assert.deepEqual([vira.cancelados, vira.canceladosAnt, vira.soCancelamentos], [null, 6, true]);
  // sem dado de pedidos: sem sinal de cancelamento
  assert.equal(classificar({ origem: 'base', entregasMes: 0, mesReferencia: '2026-09' }, H).cancelados2m, null);
  assert.equal(classificar({ origem: 'prospeccao' }, H).fase, 'prospeccao', 'prospecção do comercial continua Prospecção');
  assert.equal(classificar({ codigo: 'X' }, H).fase, 'inativo', 'sem origem, ter código = veio da base');
});
test('coluna de entregas renomeada/ausente: linha recusada em vez de gravar zero', () => {
  const r = prepararImportacao([{ 'ID Empresa': 1, 'Loja': 'L', 'Operação': 'NATAL/RN', 'Qtd Concluídas Set/26': 50 }], pracas, H);
  assert.equal(r.linhas.length, 0); assert.match(r.erros[0], /entregas do mês/);
});
test('colunas por mês na virada do ano (Dez/25 → Jan/26)', () => {
  const l = prepararImportacao([{ codigo: 'Y', nome: 'Loja', cidade: 'Natal', uf: 'RN', 'Entregas Dez/25': 30, 'Entregas Jan/26 (01–10)': 8 }], pracas, H).linhas[0];
  assert.equal(l.mes_referencia, '2026-01'); assert.equal(l.entregas_mes, 8); assert.equal(l.entregas_mes_anterior, 30);
});
test('linhas coladas do Google Sheets (separadas por tabulação)', () => {
  const rows = parseEntrada('Código\tNome\tCidade\tUF\tEntregas Mês\nX9\tLoja Colada\tNatal\tRN\t620\n');
  const r = prepararImportacao(rows, pracas, H);
  assert.equal(r.linhas.length, 1); assert.equal(r.linhas[0].entregas_mes, 620); assert.equal(r.linhas[0].praca_id, 'natal-rn');
});
test('linha vinda do Google Sheets: cabeçalho com acento, datas seriais e CNPJ numérico', () => {
  const r = prepararImportacao([{
    'ID Externo': 10001, 'Nome Fantasia': 'Farmácia Central', 'Cidade': 'Natal', 'UF': 'RN', 'CNPJ': 1234567000190,
    'Data Primeira Entrega': 45731, 'Entregas Mês': 1342, 'Entregas Mês Anterior': 980, 'Data Referência': 46290,
  }], pracas, H);
  assert.equal(r.erros.length, 0);
  const l = r.linhas[0];
  assert.equal(l.codigo, '10001');
  assert.equal(l.nome, 'Farmácia Central');
  assert.equal(l.cnpj, '01234567000190');
  assert.equal(l.primeira_entrega, '2025-03-15');
  assert.equal(l.entregas_mes, 1342); assert.equal(l.entregas_mes_anterior, 980);
  assert.equal(l.mes_referencia, '2026-09');
  assert.equal(classificar({ primeiraEntrega: l.primeira_entrega, entregasMes: l.entregas_mes, mesReferencia: l.mes_referencia }, H).fase, 'v5');
});
