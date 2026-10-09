// Colmeia CRM · leitura da base diária a partir de uma planilha do Google Sheets (usado pelo sync.mjs).
// Dois modos:
//   - conta de serviço (recomendado): planilha privada, compartilhada como Leitor com o e-mail da conta.
//     Usa a API do Sheets. Datas e números vêm sem formatação, então o idioma da planilha não interfere.
//   - link: planilha como "Qualquer pessoa com o link: Leitor" ou "Publicar na Web". Baixa o CSV.
import crypto from 'node:crypto';
import { parseEntrada, linhasDeMatriz } from '../assets/base.js';

const SHEETS_API = process.env.GOOGLE_SHEETS_API || 'https://sheets.googleapis.com/v4';
const ESCOPO = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TEMPO_MAX = 120_000;

/** Extrai o ID e a aba (gid) do link da planilha. Aceita também só o ID ou um link "Publicar na Web". */
export function lerLinkPlanilha(entrada) {
  const s = String(entrada || '').trim();
  if (/\/spreadsheets\/d\/e\/[\w-]+/.test(s)) return { publicado: s };
  const m = s.match(/\/spreadsheets\/d\/([\w-]{20,})/) || s.match(/^([\w-]{25,})$/);
  if (!m) return null;
  return { id: m[1], gid: s.match(/[#?&]gid=(\d+)/)?.[1] ?? null };
}

/** Valida o JSON da chave da conta de serviço (baixado no Google Cloud). */
export function lerCredenciais(json) {
  let c;
  try { c = typeof json === 'string' ? JSON.parse(json) : json; } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não é um JSON válido'); }
  if (!c?.client_email || !c?.private_key) throw new Error('A chave da conta de serviço precisa ter client_email e private_key');
  try { crypto.createPrivateKey(c.private_key); } catch { throw new Error('A private_key da conta de serviço é inválida'); }
  return { client_email: c.client_email, private_key: c.private_key, token_uri: c.token_uri || 'https://oauth2.googleapis.com/token' };
}

const b64url = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

async function tokenDeAcesso(cred) {
  const iat = Math.floor(Date.now() / 1000);
  const semAssinatura = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: cred.client_email, scope: ESCOPO, aud: cred.token_uri, iat, exp: iat + 3600 })}`;
  const assinatura = crypto.sign('RSA-SHA256', Buffer.from(semAssinatura), cred.private_key).toString('base64url');
  const res = await fetch(cred.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${semAssinatura}.${assinatura}` }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`O Google recusou a conta de serviço (${data.error_description || data.error || 'HTTP ' + res.status})`);
  return data.access_token;
}

async function sheetsGet(caminho, token, email) {
  const res = await fetch(SHEETS_API + caminho, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TEMPO_MAX) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 || res.status === 404) {
    const api = /disabled|not been used/i.test(data.error?.message || '') ? ' e ative a Google Sheets API no projeto do Google Cloud' : '';
    throw new Error(`Sem acesso à planilha. Compartilhe-a como Leitor com ${email}${api}.`);
  }
  if (!res.ok) throw new Error(data.error?.message || `API do Google respondeu ${res.status}`);
  return data;
}

/**
 * Lê a aba da planilha e devolve as linhas como objetos (mesmo formato de parseEntrada).
 * @param {{ link: string, aba?: string, credenciais?: string }} opts  sem credenciais = modo link
 */
export async function lerPlanilha({ link, aba, credenciais }) {
  const ref = lerLinkPlanilha(link);
  if (!ref) throw new Error('GOOGLE_SHEETS_URL inválido. Copie o endereço da planilha na barra do navegador.');

  if (credenciais) {
    if (ref.publicado) throw new Error('Com conta de serviço, use o link normal da planilha (não o de "Publicar na Web").');
    const cred = lerCredenciais(credenciais);
    const token = await tokenDeAcesso(cred);
    let titulo = aba;
    if (!titulo) {
      const meta = await sheetsGet(`/spreadsheets/${ref.id}?fields=sheets.properties(sheetId,title)`, token, cred.client_email);
      const abas = meta.sheets || [];
      const escolhida = (ref.gid != null && abas.find(s => String(s.properties.sheetId) === ref.gid)) || abas[0];
      if (!escolhida) throw new Error('A planilha não tem abas.');
      titulo = escolhida.properties.title;
    }
    const intervalo = encodeURIComponent(`'${titulo.replace(/'/g, "''")}'`);
    const data = await sheetsGet(`/spreadsheets/${ref.id}/values/${intervalo}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`, token, cred.client_email);
    return linhasDeMatriz(data.values);
  }

  let url;
  if (ref.publicado) {
    const u = new URL(ref.publicado.replace('/pubhtml', '/pub'));
    u.searchParams.set('output', 'csv');
    url = u.toString();
  } else if (aba) {
    url = `https://docs.google.com/spreadsheets/d/${ref.id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(aba)}`;
  } else {
    url = `https://docs.google.com/spreadsheets/d/${ref.id}/export?format=csv${ref.gid ? `&gid=${ref.gid}` : ''}`;
  }
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TEMPO_MAX) });
  if (!res.ok || String(res.headers.get('content-type')).includes('text/html')) {
    throw new Error('Não foi possível ler a planilha pelo link. Compartilhe como "Qualquer pessoa com o link: Leitor" ou configure GOOGLE_SERVICE_ACCOUNT_JSON.');
  }
  return parseEntrada(await res.text());
}
