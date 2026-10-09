// Testes do leitor de .xlsx e da leitura pelo SharePoint: simula o Microsoft Entra ID e o Graph num servidor local.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lerXlsx } from './xlsx.mjs';
import { prepararImportacao, linhasDeMatriz } from '../assets/base.js';

/* ---------- gera um .xlsx de verdade (ZIP + XML) ---------- */
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const letra = i => { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

function zip(arquivos, comprimir) {
  const locais = [], central = []; let pos = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const bruto = Buffer.from(conteudo, 'utf8');
    const dados = comprimir ? zlib.deflateRawSync(bruto) : bruto;
    const n = Buffer.from(nome, 'utf8'); const crc = zlib.crc32(bruto);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(comprimir ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(dados.length, 18); lh.writeUInt32LE(bruto.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(comprimir ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(dados.length, 20); ch.writeUInt32LE(bruto.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(pos, 42);
    locais.push(lh, n, dados); central.push(ch, n); pos += 30 + n.length + dados.length;
  }
  const cd = Buffer.concat(central); const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(central.length / 2, 8); fim.writeUInt16LE(central.length / 2, 10);
  fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(pos, 16);
  return Buffer.concat([...locais, cd, fim]);
}

/** abas: [{ nome, linhas: [[...]] }]. Textos viram sharedStrings; números ficam numéricos; null = célula ausente. */
function criarXlsx(abas, { comprimir = true } = {}) {
  const textos = []; const idx = s => { let i = textos.indexOf(s); if (i < 0) { i = textos.length; textos.push(s); } return i; };
  const arquivos = {};
  abas.forEach((a, n) => {
    const rows = a.linhas.map((l, r) => `<row r="${r + 1}">${l.map((v, c) => v == null ? '' :
      typeof v === 'number' ? `<c r="${letra(c)}${r + 1}" s="1"><v>${v}</v></c>` :
      typeof v === 'boolean' ? `<c r="${letra(c)}${r + 1}" t="b"><v>${v ? 1 : 0}</v></c>` :
      v.startsWith('inline:') ? `<c r="${letra(c)}${r + 1}" t="inlineStr"><is><t>${xmlEsc(v.slice(7))}</t></is></c>` :
      `<c r="${letra(c)}${r + 1}" t="s"><v>${idx(v)}</v></c>`).join('')}</row>`).join('');
    arquivos[`xl/worksheets/sheet${n + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="20"/></cols><sheetData>${rows}</sheetData></worksheet>`;
  });
  arquivos['xl/workbook.xml'] = `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${abas.map((a, n) => `<sheet name="${xmlEsc(a.nome)}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`).join('')}</sheets></workbook>`;
  arquivos['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0"?><Relationships>${abas.map((a, n) => `<Relationship Id="rId${n + 1}" Type="worksheet" Target="worksheets/sheet${n + 1}.xml"/>`).join('')}</Relationships>`;
  arquivos['xl/sharedStrings.xml'] = `<?xml version="1.0"?><sst count="${textos.length}">${textos.map(t => `<si><t xml:space="preserve">${xmlEsc(t)}</t></si>`).join('')}</sst>`;
  return zip(arquivos, comprimir);
}

const PRACAS = [{ id: 'natal-rn', nome: 'Natal', uf: 'RN', rotulo: 'Natal/RN', aliases: [] }];
const BASE = [
  ['Código', 'Nome', 'Cidade', 'UF', 'CNPJ', 'Data Primeira Entrega', 'Entregas Mês', 'Entregas Mês Anterior', 'Mês Referência'],
  [10001, 'Farmácia & Cia', 'Natal', 'RN', 1234567000190, 45731, 1342, 980, '2026-09'],
  [],
  [10002, 'inline:Pizzaria Nova', 'Natal', 'RN', null, 46275, 12, 0, '2026-09'],
];

/* ---------- leitor de .xlsx ---------- */
test('xlsx: lê a primeira aba, com textos compartilhados, texto inline, células ausentes e datas seriais', () => {
  for (const comprimir of [true, false]) {
    const m = lerXlsx(criarXlsx([{ nome: 'Base CRM', linhas: BASE }, { nome: 'Resumo', linhas: [['x']] }], { comprimir }));
    assert.equal(m[0][6], 'Entregas Mês');
    assert.equal(m[1][1], 'Farmácia & Cia');
    assert.equal(m[1][4], 1234567000190);
    assert.deepEqual(m[2], [], 'linha vazia');
    assert.equal(m[3][1], 'Pizzaria Nova');
    assert.equal(m[3][4], '', 'célula ausente vira vazio');
    const r = prepararImportacao(linhasDeMatriz(m), PRACAS, new Date(2026, 8, 25));
    assert.equal(r.linhas.length, 2);
    assert.equal(r.linhas[0].cnpj, '01234567000190');
    assert.equal(r.linhas[0].primeira_entrega, '2025-03-15');
    assert.equal(r.linhas[0].entregas_mes, 1342);
  }
});

test('xlsx: escolhe a aba pelo nome e avisa quando não existe', () => {
  const buf = criarXlsx([{ nome: 'Resumo', linhas: [['x']] }, { nome: 'Base CRM', linhas: BASE }]);
  assert.equal(lerXlsx(buf, 'base crm')[1][0], 10001);
  assert.throws(() => lerXlsx(buf, 'Outra'), /Aba "Outra" não encontrada.*Resumo, Base CRM/);
  assert.throws(() => lerXlsx(Buffer.from('não é zip')), /xlsx válido/);
});

/* ---------- SharePoint (Graph simulado) ---------- */
let server, base, sp;
const vistos = [];
const XLSX = criarXlsx([{ nome: 'Base CRM', linhas: BASE }]);
const CSV_1252 = Buffer.from('codigo;nome;cidade;uf;entregas_mes\nX1;Açaí Paraíso;Natal;RN;77\n', 'latin1');

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    vistos.push(`${req.method} ${url.pathname}`);
    const json = (st, b) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (req.method === 'POST' && url.pathname === '/login/tenant-bee/oauth2/v2.0/token') {
      let body = ''; req.on('data', c => { body += c; });
      req.on('end', () => {
        const p = new URLSearchParams(body);
        const ok = p.get('client_id') === 'app-1' && p.get('client_secret') === 'segredo' && p.get('grant_type') === 'client_credentials' && p.get('scope') === 'https://graph.microsoft.com/.default';
        ok ? json(200, { access_token: 'ms-tok', expires_in: 3600 }) : json(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' });
      });
      return;
    }
    if (url.pathname.startsWith('/download/')) { res.writeHead(200); res.end(url.pathname.endsWith('.csv') ? CSV_1252 : XLSX); return; }
    if (req.headers.authorization !== 'Bearer ms-tok') return json(401, { error: { message: 'unauthorized' } });
    if (url.pathname === '/v1.0/sites/bee.sharepoint.com:/sites/Comercial') return json(200, { id: 'site-1', webUrl: 'https://bee.sharepoint.com/sites/Comercial' });
    if (url.pathname === '/v1.0/sites/bee.sharepoint.com:/sites/Bloqueado') return json(403, { error: { message: 'Access denied' } });
    if (url.pathname === '/v1.0/sites/site-1/drives') return json(200, { value: [
      { id: 'd-docs', name: 'Documentos', webUrl: 'https://bee.sharepoint.com/sites/Comercial/Shared%20Documents' },
      { id: 'd-rel', name: 'Relatórios', webUrl: 'https://bee.sharepoint.com/sites/Comercial/Relatorios' },
    ] });
    if (url.pathname === '/v1.0/drives/d-docs/root:/CRM/base%20crm.xlsx:/content') { res.writeHead(302, { Location: '/download/base.xlsx' }); res.end(); return; }
    if (url.pathname === '/v1.0/drives/d-rel/root:/base.csv:/content') { res.writeHead(302, { Location: '/download/base.csv' }); res.end(); return; }
    json(404, { error: { message: 'itemNotFound' } });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.MS_GRAPH_API = `${base}/v1.0`;
  process.env.MS_LOGIN_URL = `${base}/login`;
  sp = await import('./sharepoint.mjs');
});
after(() => server.close());

const cred = { tenant: 'tenant-bee', clientId: 'app-1', clientSecret: 'segredo' };

test('SharePoint: reconhece os formatos de endereço', () => {
  assert.deepEqual(sp.lerLinkSharePoint('https://bee.sharepoint.com/sites/Comercial/Shared%20Documents/CRM/base%20crm.xlsx?web=1'),
    { host: 'bee.sharepoint.com', sitio: '/sites/Comercial', caminho: '/sites/Comercial/Shared Documents/CRM/base crm.xlsx', nome: 'base crm.xlsx' });
  assert.equal(sp.lerLinkSharePoint('https://bee.sharepoint.com/:x:/r/sites/Comercial/Shared%20Documents/base.xlsx?d=w123').caminho, '/sites/Comercial/Shared Documents/base.xlsx');
  assert.equal(sp.lerLinkSharePoint('https://bee.sharepoint.com/Shared%20Documents/base.xlsx').sitio, '', 'site raiz');
  assert.throws(() => sp.lerLinkSharePoint('https://bee.sharepoint.com/:x:/s/Comercial/EaBcDeF123?e=xyz'), /link de compartilhamento/);
  assert.throws(() => sp.lerLinkSharePoint('https://exemplo.com/base.xlsx'), /sharepoint\.com/);
});

test('SharePoint: autentica, acha a biblioteca pelo caminho, baixa o .xlsx e prepara a importação', async () => {
  const rows = await sp.lerSharePoint({ link: 'https://bee.sharepoint.com/sites/Comercial/Shared%20Documents/CRM/base%20crm.xlsx', ...cred });
  const r = prepararImportacao(rows, PRACAS, new Date(2026, 8, 25));
  assert.equal(r.linhas.length, 2);
  assert.equal(r.linhas[0].codigo, '10001');
  assert.equal(r.linhas[0].nome, 'Farmácia & Cia');
  assert.equal(r.linhas[0].cnpj, '01234567000190');
  assert.ok(vistos.includes('GET /download/base.xlsx'), 'seguiu o redirecionamento do download');
});

test('SharePoint: CSV salvo pelo Excel (Windows-1252) em outra biblioteca', async () => {
  const rows = await sp.lerSharePoint({ link: 'https://bee.sharepoint.com/sites/Comercial/Relatorios/base.csv', ...cred });
  assert.equal(rows[0].nome, 'Açaí Paraíso');
  assert.equal(prepararImportacao(rows, PRACAS).linhas[0].entregas_mes, 77);
});

test('SharePoint: mensagens claras para os erros de configuração', async () => {
  await assert.rejects(sp.lerSharePoint({ link: 'https://bee.sharepoint.com/sites/Comercial/Shared%20Documents/base.xlsx', ...cred, clientSecret: 'errado' }), /Invalid client secret/);
  await assert.rejects(sp.lerSharePoint({ link: 'https://bee.sharepoint.com/sites/Bloqueado/Shared%20Documents/base.xlsx', ...cred }), /Sites\.Selected/);
  await assert.rejects(sp.lerSharePoint({ link: 'https://bee.sharepoint.com/sites/Comercial/Shared%20Documents/nao-existe.xlsx', ...cred }), /Arquivo não encontrado/);
  await assert.rejects(sp.lerSharePoint({ link: 'https://bee.sharepoint.com/sites/Comercial/Outra/base.xlsx', ...cred }), /biblioteca.*Documentos, Relatórios/);
  await assert.rejects(sp.lerSharePoint({ link: 'https://bee.sharepoint.com/sites/Comercial/Shared%20Documents/base.xls', ...cred }), /\.xls não suportado/);
});

test('sync recusa duas origens configuradas ao mesmo tempo', () => {
  const raiz = fileURLToPath(new URL('..', import.meta.url));
  const r = spawnSync(process.execPath, ['scripts/sync.mjs', '--simular'], {
    cwd: raiz, encoding: 'utf8',
    env: { ...process.env, SHAREPOINT_URL: 'https://bee.sharepoint.com/sites/x/y/base.xlsx', GOOGLE_SHEETS_URL: 'https://docs.google.com/spreadsheets/d/abc/edit' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Mais de uma origem configurada \(sharepoint, google\)/);
});
