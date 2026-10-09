// Testes da leitura do Google Sheets: simula o Google (token OAuth + API do Sheets) num servidor local.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { prepararImportacao } from '../assets/base.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const EMAIL = 'colmeia-sync@projeto.iam.gserviceaccount.com';
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
let server, base, gs;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const json = (st, b) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (url.pathname === '/token') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const [h, p, sig] = new URLSearchParams(body).get('assertion').split('.');
        const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, 'base64url'));
        const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
        if (!ok || claims.iss !== EMAIL || !claims.scope.includes('spreadsheets.readonly')) return json(400, { error: 'invalid_grant' });
        json(200, { access_token: 'tok-123', expires_in: 3600 });
      });
      return;
    }
    if (req.headers.authorization !== 'Bearer tok-123') return json(401, { error: { message: 'unauthorized' } });
    if (url.pathname === `/v4/spreadsheets/${ID}`) {
      return json(200, { sheets: [{ properties: { sheetId: 0, title: 'Resumo' } }, { properties: { sheetId: 77, title: 'Base CRM' } }] });
    }
    if (url.pathname.startsWith(`/v4/spreadsheets/${ID}/values/`)) {
      assert.equal(decodeURIComponent(url.pathname.split('/values/')[1]), "'Base CRM'");
      assert.equal(url.searchParams.get('dateTimeRenderOption'), 'SERIAL_NUMBER');
      return json(200, {
        values: [
          ['Código', 'Nome', 'Cidade', 'UF', 'CNPJ', 'Data Primeira Entrega', 'Entregas Mês', 'Entregas Mês Anterior', 'Mês Referência'],
          [10001, 'Farmácia Central', 'Natal', 'RN', 1234567000190, 45731, 342, 410, '2026-09'],
          [],
          [10002, 'Pizzaria Nova', 'Petrolina', 'PE', '', 46275, 12, 0, '2026-09'],
        ],
      });
    }
    json(404, { error: { message: 'not found' } });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.GOOGLE_SHEETS_API = `${base}/v4`;
  gs = await import('./gsheets.mjs');
});
after(() => server.close());

const credenciais = () => JSON.stringify({
  type: 'service_account', client_email: EMAIL,
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: `${base}/token`,
});

test('reconhece links de planilha', () => {
  assert.deepEqual(gs.lerLinkPlanilha(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=77`), { id: ID, gid: '77' });
  assert.deepEqual(gs.lerLinkPlanilha(ID), { id: ID, gid: null });
  assert.ok(gs.lerLinkPlanilha('https://docs.google.com/spreadsheets/d/e/2PACX-abc123/pubhtml').publicado);
  assert.equal(gs.lerLinkPlanilha('https://exemplo.com/planilha'), null);
});

test('conta de serviço: autentica, lê a aba do gid e prepara a importação', async () => {
  const rows = await gs.lerPlanilha({ link: `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=77`, credenciais: credenciais() });
  assert.equal(rows.length, 2, 'linha vazia é ignorada');
  const pracas = [{ id: 'natal-rn', nome: 'Natal', uf: 'RN', rotulo: 'Natal/RN', aliases: [] }];
  const r = prepararImportacao(rows, pracas, new Date(2026, 8, 25));
  assert.equal(r.linhas.length, 1);
  assert.deepEqual(r.semPraca, { 'Petrolina/PE': 1 });
  const l = r.linhas[0];
  assert.equal(l.codigo, '10001');
  assert.equal(l.praca_id, 'natal-rn');
  assert.equal(l.cnpj, '01234567000190');
  assert.equal(l.primeira_entrega, '2025-03-15');
  assert.equal(l.entregas_mes, 342);
});

test('chave inválida é recusada com mensagem clara', () => {
  assert.throws(() => gs.lerCredenciais('{"client_email":"x"}'), /private_key/);
  assert.throws(() => gs.lerCredenciais('não é json'), /JSON/);
});
