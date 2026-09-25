// Testes das regras de negócio: node --test scripts/
import test from 'node:test';
import assert from 'node:assert/strict';
import { classificar, indicePracas, acharPraca, prepararImportacao } from '../assets/base.js';

const H = new Date(2026, 8, 25); // 25/09/2026
const f = l => classificar({ mesReferencia: '2026-09', ...l }, H).fase;

test('prospecção: nunca entregou', () => assert.equal(f({}), 'prospeccao'));
test('ativação: primeira entrega há menos de 30 dias', () => assert.equal(f({ primeiraEntrega: '2026-09-01', entregasMes: 80 }), 'ativacao'));
test('ativação termina no 30º dia', () => assert.equal(f({ primeiraEntrega: '2026-08-26', entregasMes: 10 }), 'v1'));
test('inativo: entregou no mês anterior, zero no atual', () => assert.equal(f({ primeiraEntrega: '2026-01-10', entregasMes: 0, entregasMesAnterior: 30 }), 'inativo'));
test('faixas de volume', () => {
  assert.equal(f({ primeiraEntrega: '2026-01-10', entregasMes: 50 }), 'v1');
  assert.equal(f({ primeiraEntrega: '2026-01-10', entregasMes: 51 }), 'v2');
  assert.equal(f({ primeiraEntrega: '2026-01-10', entregasMes: 100 }), 'v2');
  assert.equal(f({ primeiraEntrega: '2026-01-10', entregasMes: 101 }), 'v3');
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
