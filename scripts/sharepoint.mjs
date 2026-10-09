// Colmeia CRM · leitura da base diária a partir de um arquivo no SharePoint (usado pelo sync.mjs).
// Usa um app registrado no Microsoft Entra ID (client credentials) com a permissão Sites.Selected,
// liberada pelo administrador só para o site onde está o arquivo, com papel "read".
//
// Por que baixar o arquivo em vez de usar a API de Excel do Graph: a API de Excel não aceita
// acesso de aplicativo (só usuário logado), e o sync roda sozinho no GitHub Actions.
// O arquivo é localizado pelo caminho (não pelo link de compartilhamento, que exigiria
// a permissão ampla Files.ReadWrite.All).
import { parseEntrada, linhasDeMatriz } from '../assets/base.js';
import { lerXlsx } from './xlsx.mjs';

const GRAPH = process.env.MS_GRAPH_API || 'https://graph.microsoft.com/v1.0';
const LOGIN = process.env.MS_LOGIN_URL || 'https://login.microsoftonline.com';
const TEMPO_MAX = 120_000;

const decodificar = buf => { try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); } };

/**
 * Interpreta o endereço do arquivo, ex.:
 * https://bee.sharepoint.com/sites/Comercial/Documentos%20Compartilhados/CRM/base-crm.xlsx
 * Retorna { host, sitio: '/sites/Comercial' | '', caminho: '/sites/Comercial/Documentos Compartilhados/CRM/base-crm.xlsx', nome }
 */
export function lerLinkSharePoint(entrada) {
  let u;
  try { u = new URL(String(entrada || '').trim()); } catch { throw new Error('SHAREPOINT_URL inválido. Use o endereço completo do arquivo (https://…sharepoint.com/…).'); }
  if (!/\.sharepoint\.(com|us|de|cn)$/i.test(u.hostname)) {
    throw new Error('SHAREPOINT_URL precisa ser um endereço *.sharepoint.com.');
  }
  // Links "/:x:/r/<caminho>" já trazem o caminho; os demais links de compartilhamento só têm um código
  let pathname = u.pathname.replace(/^\/:[a-z]:\/r(?=\/)/i, '');
  if (/^\/:[a-z]:\//i.test(pathname) || /\/_layouts\//i.test(pathname)) {
    throw new Error('Esse é um link de compartilhamento. Use o caminho direto do arquivo: no SharePoint, abra os Detalhes do arquivo e copie o "Caminho".');
  }
  const caminho = decodeURIComponent(pathname).replace(/\/+$/, '');
  const partes = caminho.split('/').filter(Boolean);
  const sitio = ['sites', 'teams'].includes((partes[0] || '').toLowerCase()) && partes[1] ? `/${partes[0]}/${partes[1]}` : '';
  return { host: u.hostname, sitio, caminho, nome: partes[partes.length - 1] || '' };
}

async function tokenDeAcesso({ tenant, clientId, clientSecret }) {
  const res = await fetch(`${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`O Microsoft Entra ID recusou o app (${data.error_description?.split('\r\n')[0] || data.error || 'HTTP ' + res.status}). Confira AZURE_TENANT_ID, AZURE_CLIENT_ID e AZURE_CLIENT_SECRET.`);
  }
  return data.access_token;
}

async function graph(caminho, token, { bruto = false } = {}) {
  const res = await fetch(GRAPH + caminho, { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow', signal: AbortSignal.timeout(TEMPO_MAX) });
  if (res.status === 401 || res.status === 403) {
    throw new Error('O app não tem acesso a este site do SharePoint. Peça ao administrador para conceder a permissão Sites.Selected com papel "read" neste site.');
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `Microsoft Graph respondeu ${res.status}`);
  }
  return bruto ? Buffer.from(await res.arrayBuffer()) : res.json();
}

/**
 * Baixa o arquivo do SharePoint e devolve as linhas como objetos (mesmo formato de parseEntrada).
 * Aceita .xlsx/.xlsm (aba opcional), .csv/.txt e .json.
 * @param {{ link: string, aba?: string, tenant: string, clientId: string, clientSecret: string }} opts
 */
export async function lerSharePoint({ link, aba, tenant, clientId, clientSecret }) {
  const ref = lerLinkSharePoint(link);
  const ext = (ref.nome.split('.').pop() || '').toLowerCase();
  if (!['xlsx', 'xlsm', 'csv', 'txt', 'json'].includes(ext)) {
    throw new Error(`Formato .${ext || '?'} não suportado. Salve a base como .xlsx ou .csv.`);
  }
  if (!tenant || !clientId || !clientSecret) throw new Error('Defina AZURE_TENANT_ID, AZURE_CLIENT_ID e AZURE_CLIENT_SECRET para ler o SharePoint.');
  const token = await tokenDeAcesso({ tenant, clientId, clientSecret });

  const site = await graph(`/sites/${ref.host}${ref.sitio ? ':' + ref.sitio : ''}?$select=id,webUrl`, token);
  if (!site) throw new Error(`Site do SharePoint não encontrado: ${ref.host}${ref.sitio || ''}.`);

  // A biblioteca (drive) é a que tem o endereço mais longo que seja prefixo do caminho do arquivo
  const drives = (await graph(`/sites/${site.id}/drives?$select=id,name,webUrl`, token))?.value || [];
  const caminhoMin = ref.caminho.toLowerCase();
  const drive = drives
    .map(d => ({ ...d, base: decodeURIComponent(new URL(d.webUrl).pathname).replace(/\/+$/, '') }))
    .filter(d => caminhoMin.startsWith(d.base.toLowerCase() + '/'))
    .sort((a, b) => b.base.length - a.base.length)[0];
  if (!drive) throw new Error(`Não encontrei a biblioteca de documentos do arquivo no site. Bibliotecas disponíveis: ${drives.map(d => d.name).join(', ') || 'nenhuma'}.`);

  const relativo = ref.caminho.slice(drive.base.length + 1).split('/').map(encodeURIComponent).join('/');
  const buf = await graph(`/drives/${drive.id}/root:/${relativo}:/content`, token, { bruto: true });
  if (!buf) throw new Error(`Arquivo não encontrado no SharePoint: ${ref.caminho}.`);

  if (ext === 'xlsx' || ext === 'xlsm') return linhasDeMatriz(lerXlsx(buf, aba));
  return parseEntrada(decodificar(buf));
}
