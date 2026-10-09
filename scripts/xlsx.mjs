// Colmeia CRM · leitor mínimo de Excel (.xlsx), sem dependências (usado pelo sync.mjs).
// Um .xlsx é um ZIP com XML dentro: lê o ZIP, os textos compartilhados e a aba pedida.
// Números saem como número; datas saem como número serial (normalizarLinha em base.js converte).
import zlib from 'node:zlib';

/* ---------- ZIP ---------- */
function lerZip(buf) {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('O arquivo não é um .xlsx válido (ZIP não reconhecido).');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  if (p === 0xffffffff) throw new Error('Arquivo .xlsx grande demais (ZIP64 não suportado).');
  const arquivos = new Map();
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('O arquivo .xlsx está corrompido.');
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20);
    const lNome = buf.readUInt16LE(p + 28), lExtra = buf.readUInt16LE(p + 30), lComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + lNome);
    arquivos.set(nome, { metodo, tam, local });
    p += 46 + lNome + lExtra + lComent;
  }
  return nome => {
    const a = arquivos.get(nome); if (!a) return null;
    const ini = a.local + 30 + buf.readUInt16LE(a.local + 26) + buf.readUInt16LE(a.local + 28);
    const dados = buf.subarray(ini, ini + a.tam);
    if (a.metodo === 0) return dados.toString('utf8');
    if (a.metodo === 8) return zlib.inflateRawSync(dados).toString('utf8');
    throw new Error(`Compressão ${a.metodo} não suportada no .xlsx.`);
  };
}

/* ---------- XML ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const texto = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);
const atributos = s => Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(m => [m[1], texto(m[2])]));
const textosT = xml => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => texto(m[1])).join('');
const colunaDe = ref => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** Nomes das abas, na ordem da pasta de trabalho. */
function abasDe(ler) {
  const wb = ler('xl/workbook.xml'); if (!wb) throw new Error('O arquivo .xlsx não tem xl/workbook.xml.');
  const rels = ler('xl/_rels/workbook.xml.rels') || '';
  const alvo = Object.fromEntries([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map(m => atributos(m[1])).map(a => [a.Id, a.Target]));
  return [...wb.matchAll(/<sheet\b([^>]*)\/?>/g)].map(m => atributos(m[1])).map(a => {
    const t = alvo[a['r:id']] || '';
    return { nome: a.name, arquivo: t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '') };
  });
}

/**
 * Lê uma aba do .xlsx e devolve a matriz de valores (1ª linha = cabeçalho).
 * @param {Buffer} buf  conteúdo do arquivo
 * @param {string} [aba] nome da aba; em branco usa a primeira
 */
export function lerXlsx(buf, aba) {
  const ler = lerZip(buf);
  const abas = abasDe(ler);
  const escolhida = aba ? abas.find(a => a.nome.trim().toLowerCase() === String(aba).trim().toLowerCase()) : abas[0];
  if (!escolhida) throw new Error(`Aba "${aba}" não encontrada. Abas do arquivo: ${abas.map(a => a.nome).join(', ')}.`);
  const xml = ler(escolhida.arquivo); if (!xml) throw new Error(`Não achei a aba "${escolhida.nome}" dentro do .xlsx.`);
  const compart = [...(ler('xl/sharedStrings.xml') || '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => textosT(m[1]));

  const matriz = [];
  let proxLinha = 0;
  for (const mr of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = atributos(mr[1]);
    const li = ra.r ? +ra.r - 1 : proxLinha; proxLinha = li + 1;
    const linha = [];
    let proxCol = 0;
    for (const mc of (mr[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = atributos(mc[1]); const corpo = mc[2] || '';
      const ci = ca.r ? colunaDe(ca.r) : proxCol; proxCol = ci + 1;
      const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
      let val = '';
      if (ca.t === 's') val = v != null ? compart[+v] ?? '' : '';
      else if (ca.t === 'inlineStr') val = textosT(corpo);
      else if (ca.t === 'str' || ca.t === 'e') val = v != null ? texto(v) : '';
      else if (ca.t === 'b') val = v === '1';
      else if (v != null && v !== '') { const n = Number(v); val = Number.isFinite(n) ? n : texto(v); }
      linha[ci] = val;
    }
    matriz[li] = Array.from(linha, x => x ?? '');
  }
  return Array.from(matriz, r => r ?? []);
}
