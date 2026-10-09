// Colmeia CRM · aplicativo (navegador). Sem build: módulo ES servido pelo GitHub Pages.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { CONFIG } from './config.js';
import { FASES, classificar as classificarBase, parseEntrada, prepararImportacao, prepararMetas, somarIndicadores, soDigitos as soDig } from './base.js';

const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'implicit' } });

const FMAP = Object.fromEntries(FASES.map(f => [f.id, f]));
const ETAPAS = { novo: 'Novo cadastro', contato: 'Em contato', negociando: 'Negociando', aguardando: 'Aguardando 1ª entrega', perdido: 'Perdido' };
const TIPOS = { ligacao: ['LIG', 'Ligação'], visita: ['VIS', 'Visita'], whatsapp: ['WPP', 'WhatsApp'], nota: ['NOT', 'Anotação'], sistema: ['SIS', 'Sistema'] };
const PAPEIS = { gestor: 'Gestor', supervisor: 'Supervisão', comercial: 'Comercial' };
const DOMINIOS = CONFIG.dominiosEmail || [CONFIG.dominioEmail || 'beedelivery.com.br'];
const DOMINIO = DOMINIOS[0]; // o principal, usado nos exemplos de e-mail
const emailDaBee = email => DOMINIOS.some(d => email.endsWith('@' + d));
const DOMINIOS_TXT = DOMINIOS.map(d => '@' + d).join(' ou ');

const S = {
  session: null, eu: null, carregado: false,
  pessoas: {}, pracas: {}, regionais: {}, lojas: new Map(), crm: new Map(), sync: null,
  viewAs: null, tab: null, fase: null, fCom: '', fPraca: '', busca: '', sort: { k: 'entregasMes', d: -1 }, open: null, importPlan: null,
};
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byPt = (a, b) => String(a).localeCompare(String(b), 'pt-BR');
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ---------- datas e números ---------- */
const pad = n => String(n).padStart(2, '0');
const hoje = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const mesKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
const parseD = s => { if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const dias = (a, b) => Math.round((a - b) / 864e5);
const fmtD = s => { const d = parseD(s); return d ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) : '—'; };
const fmtDM = s => { const d = parseD(s); return d ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) : '—'; };
const fmtDT = s => { if (!s) return '—'; const d = new Date(s); if (isNaN(d)) return '—'; return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' às ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const relDias = n => n <= 0 ? 'hoje' : n === 1 ? 'ontem' : 'há ' + n + ' dias';
const nf = n => Number(n || 0).toLocaleString('pt-BR');
const pctf = x => x == null ? '—' : Math.round(x * 100) + '%';
const diaDe = s => { const d = new Date(s); d.setHours(0, 0, 0, 0); return d; };
const classificar = l => classificarBase(l, new Date());

/* ---------- conversão banco ⇄ app ---------- */
const deLoja = r => ({ id: r.id, codigo: r.codigo, praca: r.praca_id, nome: r.nome, cnpj: r.cnpj, cidade: r.cidade, bairro: r.bairro, endereco: r.endereco, responsavel: r.responsavel, telefone: r.telefone, origem: r.origem, etapa: r.etapa, dataCadastro: r.data_cadastro, primeiraEntrega: r.primeira_entrega, ultimaEntrega: r.ultima_entrega, entregasMes: r.entregas_mes, entregasMesAnterior: r.entregas_mes_anterior, mesReferencia: r.mes_referencia, pedidosMes: r.pedidos_mes, pedidosMesAnterior: r.pedidos_mes_anterior });
const numOuNulo = v => v == null ? null : +v;
const dePraca = r => ({ id: r.id, nome: r.nome, uf: r.uf, rotulo: r.rotulo, aliases: r.aliases || [], regional: r.regional_id, comercialId: r.comercial_id, meta: r.meta, metaEmpresas: numOuNulo(r.meta_empresas), metaTaxa: numOuNulo(r.meta_taxa_sucesso), produzido: r.produzido, produzidoAte: r.produzido_ate });
const dePessoa = r => ({ id: r.id, nome: r.nome, email: r.email, papel: r.papel, regional: r.regional_id, ativo: r.ativo });
const CAMPO_PRACA = { comercialId: 'comercial_id', regional: 'regional_id', meta: 'meta', metaEmpresas: 'meta_empresas', metaTaxa: 'meta_taxa_sucesso', produzido: 'produzido', produzidoAte: 'produzido_ate' };

async function buscarTudo(tabela, select = '*', ordem) {
  const out = []; const passo = 1000;
  for (let de = 0; ; de += passo) {
    let q = sb.from(tabela).select(select).range(de, de + passo - 1);
    if (ordem) q = q.order(ordem.col, { ascending: ordem.asc });
    const { data, error } = await q; if (error) throw error;
    out.push(...data); if (data.length < passo) break;
  }
  return out;
}
async function carregar() {
  const [pessoas, pracas, regionais, lojas, notas, tarefas, sync] = await Promise.all([
    buscarTudo('pessoas'), buscarTudo('pracas'), buscarTudo('regionais'), buscarTudo('lojas'),
    buscarTudo('crm_notas', '*', { col: 'criado_em', asc: false }), buscarTudo('crm_tarefas'),
    sb.from('sync_log').select('*').order('executado_em', { ascending: false }).limit(1),
  ]);
  S.pessoas = Object.fromEntries(pessoas.map(p => [p.id, dePessoa(p)]));
  S.pracas = Object.fromEntries(pracas.map(p => [p.id, dePraca(p)]));
  S.regionais = Object.fromEntries(regionais.map(r => [r.id, { id: r.id, nome: r.nome, supervisorId: r.supervisor_id }]));
  S.lojas = new Map(lojas.map(l => [l.id, deLoja(l)]));
  const crm = new Map(); const slot = id => { if (!crm.has(id)) crm.set(id, { notas: [], tarefas: [] }); return crm.get(id); };
  notas.forEach(n => slot(n.loja_id).notas.push({ id: n.id, tipo: n.tipo, texto: n.texto, autor: n.autor_id, autorNome: n.autor_nome, em: n.criado_em }));
  tarefas.forEach(t => slot(t.loja_id).tarefas.push({ id: t.id, texto: t.texto, vence: t.vence, feita: t.feita, feitaEm: t.feita_em, autor: t.autor_id, em: t.criado_em }));
  S.crm = crm;
  S.sync = sync.data && sync.data[0] || null;
  const email = (S.session.user.email || '').toLowerCase();
  S.eu = Object.values(S.pessoas).find(p => (p.email || '').toLowerCase() === email && p.ativo) || null;
  S.carregado = true;
}
let recT; function recarregarLogo() { clearTimeout(recT); recT = setTimeout(async () => { try { await carregar(); render(); } catch (e) { console.error(e); } }, 400); }

/* ---------- metas ---------- */
function projecao(p) {
  const ref = parseD(p.produzidoAte); const prod = +p.produzido || 0; const meta = p.meta ? +p.meta : null;
  const o = { prod, meta, pct: meta ? prod / meta : null, proj: null, projPct: null, ritmo: null };
  if (!ref) return o;
  const dm = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate(); const d = ref.getDate();
  o.proj = Math.round(prod / d * dm); o.projPct = meta ? o.proj / meta : null;
  o.ritmo = meta ? Math.max(0, Math.ceil((meta - prod) / Math.max(1, dm - d))) : null;
  return o;
}
function statusMeta(pj) {
  if (!pj.meta) return `<span class="chip">Sem meta</span>`;
  if (pj.projPct == null) return `<span class="chip">Sem produção</span>`;
  if (pj.pct >= 1) return `<span class="chip good">Meta batida</span>`;
  if (pj.projPct >= 1) return `<span class="chip good">No ritmo</span>`;
  if (pj.projPct >= .85) return `<span class="chip hl">Atenção</span>`;
  return `<span class="chip warn">Abaixo do ritmo</span>`;
}
/** Empresas com entregas e dados da taxa de sucesso realizados por praça, a partir das lojas carregadas. */
function realizadoPorPraca() {
  const out = {}; const cur = mesKey(hoje());
  for (const l of S.lojas.values()) {
    const o = out[l.praca] ||= { empresas: 0, entregasTaxa: 0, pedidos: 0 };
    if (classificar(l).atual > 0) o.empresas++;
    if (l.pedidosMes != null && l.mesReferencia === cur) { o.entregasTaxa += +l.entregasMes || 0; o.pedidos += +l.pedidosMes || 0; }
  }
  return out;
}
const indicadores = (p, real) => ({ meta: p.meta ? +p.meta : null, metaEmpresas: p.metaEmpresas, metaTaxa: p.metaTaxa, ...(real[p.id] || { empresas: 0, entregasTaxa: 0, pedidos: 0 }) });
const pct1 = x => x == null ? '—' : (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
function empresasHTML(e, metaEmp) {
  if (metaEmp == null) return `<span class="num">${nf(e)}</span>`;
  const r = metaEmp ? e / metaEmp : null;
  return `<span class="num">${nf(e)}</span><span class="hint"> / ${nf(Math.round(metaEmp))} · <span class="${r >= 1 ? 'up' : ''}">${pctf(r)}</span></span>`;
}
function taxaHTML(taxa, metaTaxa) {
  const meta = metaTaxa != null ? `<span class="hint"> / ${pct1(metaTaxa)}</span>` : '';
  if (taxa == null) return metaTaxa != null ? `<span class="hint" title="A base ainda não traz pedidos">sem dado</span>${meta}` : '<span class="hint">—</span>';
  return `<span class="num ${metaTaxa != null ? (taxa >= metaTaxa ? 'up' : 'down') : ''}">${pct1(taxa)}</span>${meta}`;
}
function meterHTML(pj) {
  if (!pj.meta) return '<span class="hint">—</span>';
  const w = Math.min(100, pj.pct * 100); const pw = pj.projPct != null ? Math.min(100, pj.projPct * 100) : null;
  return `<div class="pctcell"><span class="num">${pctf(pj.pct)}</span><div class="meter" title="Barra: atingido · traço: projeção"><i style="width:${w}%"></i>${pw != null ? `<u style="left:calc(${pw}% - 1px)"></u>` : ''}</div></div>`;
}

/* ---------- escopo (o banco já filtra; aqui só a simulação "ver como" do gestor) ---------- */
const pessoaAtual = () => S.viewAs ? S.pessoas[S.viewAs] || null : S.eu;
const papelAtual = () => { const p = pessoaAtual(); return p ? p.papel : null; };
function pracasEscopo() {
  const all = Object.values(S.pracas); const p = pessoaAtual(); if (!p) return [];
  if (p.papel === 'gestor') return all;
  if (p.papel === 'supervisor') return all.filter(x => x.regional && x.regional === p.regional);
  return all.filter(x => x.comercialId === p.id);
}
function pracasFiltradas() {
  let ps = pracasEscopo();
  if (S.fCom) ps = ps.filter(p => (S.fCom === '_sem' ? !p.comercialId : p.comercialId === S.fCom));
  if (S.fPraca) ps = ps.filter(p => p.id === S.fPraca);
  return ps;
}
function lojasFiltradas(opts = {}) {
  const ids = new Set(pracasFiltradas().map(p => p.id)); const q = S.busca.trim().toLowerCase(); const out = [];
  for (const l of S.lojas.values()) {
    if (!ids.has(l.praca)) continue;
    if (!opts.semBusca && q) { const h = [l.nome, l.bairro, l.cidade, l.cnpj, l.codigo, l.responsavel].join(' ').toLowerCase(); if (!h.includes(q)) continue; }
    out.push(l);
  }
  return out;
}
const nomePraca = id => { const p = S.pracas[id]; return p ? p.rotulo : '—'; };
const nomePessoa = id => { const p = S.pessoas[id]; return p ? p.nome : '—'; };
const crmDe = id => S.crm.get(id) || { notas: [], tarefas: [] };
const ultimoContato = id => { const n = (crmDe(id).notas || []).find(x => x.tipo !== 'sistema' && !isNaN(new Date(x.em))); return n ? n.em : null; };
const tarefasAbertas = id => (crmDe(id).tarefas || []).filter(t => !t.feita);

/* ---------- feedback ---------- */
function erroMsg(e) {
  const m = (e && (e.message || e.error_description)) || '';
  if (/row-level security|permission|42501/i.test(m) || (e && e.code === '42501')) return 'Você não tem permissão para alterar isso.';
  if (/JWT|session/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
  if (m) return 'Não foi possível salvar: ' + m;
  return 'Não foi possível salvar agora. Verifique a conexão e tente de novo.';
}
let toastT; function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3500); }
const ok = ({ error, data }) => { if (error) throw error; return data; };

/* ---------- login ---------- */
function mostrarLogin(msg) {
  $('app').hidden = true; $('login').hidden = false;
  $('lMsg').textContent = msg || '';
}
$('lForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('lEmail').value.trim().toLowerCase();
  if (!emailDaBee(email)) { $('lMsg').textContent = `Use seu e-mail ${DOMINIOS_TXT}.`; return; }
  $('lBtn').disabled = true; $('lMsg').textContent = 'Enviando…';
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  $('lBtn').disabled = false;
  if (error) {
    $('lMsg').textContent = /não cadastrado|restrito|Database error/i.test(error.message)
      ? 'Este e-mail não está cadastrado na equipe comercial. Fale com o gestor.'
      : 'Não foi possível enviar o link: ' + error.message;
    return;
  }
  $('lMsg').textContent = `Enviamos um link de acesso para ${email}. Abra o e-mail neste aparelho e toque no link.`;
};
$('btnSair').onclick = async () => { await sb.auth.signOut(); location.reload(); };

/* ---------- shell ---------- */
const TABS = [['metas', 'Metas'], ['funil', 'Funil'], ['lista', 'Lojas'], ['tarefas', 'Tarefas'], ['gestao', 'Gestão']];
function renderTabs() {
  const vis = TABS.filter(t => t[0] !== 'gestao' || papelAtual() === 'gestor');
  $('tabs').innerHTML = vis.map(([k, n]) => `<button class="tab" data-tab="${k}" aria-current="${S.tab === k}">${n}</button>`).join('');
  $('bnav').innerHTML = vis.map(([k, n]) => `<button data-tab="${k}" aria-current="${S.tab === k}"><span class="hex"></span>${n}</button>`).join('');
}
document.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); } });

function renderMe() {
  const p = S.eu; const nome = p ? p.nome : (S.session && S.session.user.email) || '';
  $('meBox').innerHTML = `<span class="avatar">${esc((nome || '?').trim().charAt(0).toUpperCase())}</span><span class="nmtxt"></span>${p ? `<span class="role">${PAPEIS[p.papel]}</span>` : ''}`;
  $('meBox').querySelector('.nmtxt').textContent = nome;
}
function renderSync() {
  const s = S.sync; const el = $('syncInfo');
  if (!s) { el.innerHTML = '<span class="dot old"></span><span class="txt">Base ainda não importada</span>'; return; }
  const old = (Date.now() - new Date(s.executado_em).getTime()) > 36 * 3600e3;
  el.innerHTML = `<span class="dot ${old ? 'old' : ''}"></span><span class="txt">Base atualizada em ${esc(fmtDT(s.executado_em))}</span>`;
  el.title = s.fonte ? 'Fonte: ' + s.fonte : '';
}
function renderBanner() {
  const b = $('banner');
  if (!S.viewAs) { b.hidden = true; return; }
  const p = S.pessoas[S.viewAs];
  b.innerHTML = `<div class="wrap"><span>Você está vendo o sistema como <b></b></span><button id="sairVer">Voltar à visão de gestor</button></div>`;
  b.querySelector('b').textContent = p ? p.nome + ' (' + PAPEIS[p.papel] + ')' : '—'; b.hidden = false;
  $('sairVer').onclick = () => { S.viewAs = null; S.fCom = ''; S.fPraca = ''; S.tab = 'gestao'; render(); };
}
function renderFiltros() {
  const papel = papelAtual(); const esc_ = pracasEscopo();
  const coms = [...new Set(esc_.map(p => p.comercialId).filter(Boolean))].map(id => S.pessoas[id]).filter(Boolean).sort((a, b) => byPt(a.nome, b.nome));
  const temSem = esc_.some(p => !p.comercialId);
  const showCom = (papel === 'gestor' || papel === 'supervisor') && coms.length > 1;
  if (S.fCom && S.fCom !== '_sem' && !coms.find(c => c.id === S.fCom)) S.fCom = '';
  $('fCom').hidden = !showCom || S.tab === 'gestao';
  $('fCom').innerHTML = `<option value="">Todos os comerciais</option>` + coms.map(c => `<option value="${esc(c.id)}" ${c.id === S.fCom ? 'selected' : ''}>${esc(c.nome)}</option>`).join('') + (temSem ? `<option value="_sem" ${S.fCom === '_sem' ? 'selected' : ''}>Sem comercial</option>` : '');
  let ps = esc_; if (S.fCom) ps = ps.filter(p => S.fCom === '_sem' ? !p.comercialId : p.comercialId === S.fCom);
  ps = ps.slice().sort((a, b) => byPt(a.rotulo, b.rotulo));
  if (S.fPraca && !ps.find(p => p.id === S.fPraca)) S.fPraca = '';
  if (ps.length === 1) S.fPraca = '';
  $('fCidade').innerHTML = (ps.length === 1 ? '' : `<option value="">Todas as praças (${ps.length})</option>`) + ps.map(p => `<option value="${esc(p.id)}" ${p.id === S.fPraca ? 'selected' : ''}>${esc(p.rotulo)}</option>`).join('');
}
$('fCom').onchange = e => { S.fCom = e.target.value; S.fPraca = ''; render(); };
$('fCidade').onchange = e => { S.fPraca = e.target.value; render(); };
$('fBusca').oninput = e => { S.busca = e.target.value; renderView(); };

function renderCounters() {
  const ls = lojasFiltradas({ semBusca: true }); const cnt = {}, soma = {};
  FASES.forEach(f => { cnt[f.id] = 0; soma[f.id] = 0; }); let soCanc = 0;
  ls.forEach(l => { const c = classificar(l); cnt[c.fase]++; soma[c.fase] += c.atual; if (c.soCancelamentos) soCanc++; });
  $('counters').innerHTML = FASES.map(f => {
    const sub = f.id === 'prospeccao' ? 'lojas em negociação' : f.id === 'inativo' ? (soCanc ? `${nf(soCanc)} só com cancelamentos` : 'a reativar') : nf(soma[f.id]) + ' entregas no mês';
    return `<button class="ctr" style="--c:${f.c}" data-fase="${f.id}" aria-pressed="${S.fase === f.id}"><span class="lbl"><span class="hex"></span>${f.nome}</span><span class="val">${nf(cnt[f.id])}</span><span class="sub">${sub}</span></button>`;
  }).join('');
}
$('counters').addEventListener('click', e => {
  const b = e.target.closest('[data-fase]'); if (!b) return; const f = b.dataset.fase;
  const mobile = matchMedia('(max-width:760px)').matches;
  if (S.tab === 'funil' && !mobile) { const col = document.querySelector(`.col[data-col="${f}"]`); if (col) col.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); S.fase = f; renderCounters(); return; }
  if (S.tab !== 'funil' && S.tab !== 'lista') S.tab = 'lista';
  S.fase = (S.fase === f && S.tab === 'lista') ? null : f; render();
});

/* ---------- Metas ---------- */
function viewMetas() {
  const ps = pracasFiltradas(); const papel = papelAtual();
  if (!ps.length) return `<div class="empty"><h2>Nenhuma praça neste filtro</h2></div>`;
  const comMeta = ps.filter(p => p.meta);
  const tMeta = comMeta.reduce((s, p) => s + +p.meta, 0), tProdMeta = comMeta.reduce((s, p) => s + (+p.produzido || 0), 0);
  const tProd = ps.reduce((s, p) => s + (+p.produzido || 0), 0);
  const tProj = comMeta.reduce((s, p) => s + (projecao(p).proj || 0), 0);
  const ref = ps.map(p => p.produzidoAte).filter(Boolean).sort().pop();
  const real = realizadoPorPraca();
  const ind = ps => somarIndicadores(ps.map(p => indicadores(p, real)));
  const tI = ind(ps); const tEmpMeta = ind(ps.filter(p => p.metaEmpresas != null));
  const tiles = `<div class="tiles">
    <div class="tile"><span>Meta do mês</span><b>${nf(tMeta)}</b><small>corridas · ${comMeta.length} de ${ps.length} praças com meta</small></div>
    <div class="tile"><span>Produzido</span><b>${nf(tProd)}</b><small>até ${fmtDM(ref)}</small></div>
    <div class="tile"><span>Atingido</span><b>${tMeta ? pctf(tProdMeta / tMeta) : '—'}</b><small>das praças com meta</small></div>
    <div class="tile"><span>Projeção do mês</span><b>${tMeta ? pctf(tProj / tMeta) : '—'}</b><small>${nf(tProj)} corridas no ritmo atual</small></div>
    <div class="tile"><span>Empresas com entregas</span><b>${nf(tI.empresas)}</b><small>${tEmpMeta.metaEmpresas ? `${pctf(tEmpMeta.empresas / tEmpMeta.metaEmpresas)} da meta de ${nf(Math.round(tEmpMeta.metaEmpresas))}` : 'sem meta'}</small></div>
    <div class="tile"><span>Taxa de sucesso</span><b>${pct1(tI.taxa)}</b><small>${tI.metaTaxa != null ? `meta ${pct1(tI.metaTaxa)}` : 'sem meta'}${tI.taxa == null ? ' · a base ainda não traz pedidos' : ''}</small></div></div>`;
  let groups = [];
  if (papel === 'gestor') {
    Object.values(S.regionais).sort((a, b) => byPt(a.nome, b.nome)).forEach(r => groups.push({ tit: r.nome, sub: r.supervisorId ? nomePessoa(r.supervisorId) + ' (supervisão)' : 'Sem supervisor', ps: ps.filter(p => p.regional === r.id) }));
    groups.push({ tit: 'Sem regional', sub: 'Praças sem supervisor nem comercial atribuído', ps: ps.filter(p => !p.regional || !S.regionais[p.regional]) });
  } else if (papel === 'supervisor') {
    [...new Set(ps.map(p => p.comercialId || '_'))].forEach(c => groups.push({ tit: c === '_' ? 'Sem comercial' : nomePessoa(c), sub: '', ps: ps.filter(p => (p.comercialId || '_') === c) }));
    groups.sort((a, b) => b.ps.reduce((s, p) => s + (+p.meta || 0), 0) - a.ps.reduce((s, p) => s + (+p.meta || 0), 0));
  } else groups.push({ tit: 'Minhas praças', sub: '', ps });
  groups = groups.filter(g => g.ps.length);
  const ord = a => a.slice().sort((x, y) => (+y.meta || -1) - (+x.meta || -1) || (+y.produzido || 0) - (+x.produzido || 0));
  const body = groups.map(g => {
    const gm = g.ps.filter(p => p.meta); const m = gm.reduce((s, p) => s + +p.meta, 0), pr = gm.reduce((s, p) => s + (+p.produzido || 0), 0), pj = gm.reduce((s, p) => s + (projecao(p).proj || 0), 0);
    const gi = ind(g.ps.filter(p => p.metaEmpresas != null)), gt = ind(g.ps);
    const rows = ord(g.ps).map(p => { const x = projecao(p), i = indicadores(p, real), t = i.pedidos ? i.entregasTaxa / i.pedidos : null; return `<tr data-praca="${esc(p.id)}"><td><b>${esc(p.rotulo)}</b></td>${papel !== 'comercial' ? `<td>${p.comercialId ? esc(nomePessoa(p.comercialId)) : '<span class="hint">—</span>'}</td>` : ''}<td class="r num">${p.meta ? nf(p.meta) : '—'}</td><td class="r num">${nf(x.prod)}</td><td>${meterHTML(x)}</td><td class="r num">${x.proj != null ? nf(x.proj) : '—'}</td><td class="r num">${x.ritmo != null ? nf(x.ritmo) : '—'}</td><td>${empresasHTML(i.empresas, i.metaEmpresas)}</td><td>${taxaHTML(t, i.metaTaxa)}</td><td>${statusMeta(x)}</td></tr>`; }).join('');
    const cards = ord(g.ps).map(p => { const x = projecao(p), i = indicadores(p, real), t = i.pedidos ? i.entregasTaxa / i.pedidos : null; return `<button class="mcard" data-praca="${esc(p.id)}"><div class="hd"><b>${esc(p.rotulo)}</b>${statusMeta(x)}</div>${papel !== 'comercial' && p.comercialId ? `<span class="hint">${esc(nomePessoa(p.comercialId))}</span>` : ''}${meterHTML(x)}<div class="nums"><span>Meta<b>${p.meta ? nf(p.meta) : '—'}</b></span><span>Produzido<b>${nf(x.prod)}</b></span><span>Precisa/dia<b>${x.ritmo != null ? nf(x.ritmo) : '—'}</b></span><span>Empresas<b>${nf(i.empresas)}${i.metaEmpresas != null ? `<small class="hint"> / ${nf(Math.round(i.metaEmpresas))}</small>` : ''}</b></span><span>Taxa de sucesso<b>${pct1(t)}${i.metaTaxa != null ? `<small class="hint"> / ${pct1(i.metaTaxa)}</small>` : ''}</b></span></div></button>`; }).join('');
    const sumEmp = gi.metaEmpresas ? ` · empresas ${nf(gi.empresas)} de ${nf(Math.round(gi.metaEmpresas))}` : '';
    const sumTaxa = gt.metaTaxa != null ? ` · taxa ${gt.taxa != null ? pct1(gt.taxa) : 'sem dado'} (meta ${pct1(gt.metaTaxa)})` : '';
    return `<section class="mgroup"><h2>${esc(g.tit)} ${g.sub ? `<small>${esc(g.sub)}</small>` : ''}</h2><div class="gsum">${g.ps.length} praça${g.ps.length > 1 ? 's' : ''}${m ? ` · meta ${nf(m)} · produzido ${nf(pr)} (${pctf(pr / m)}) · projeção ${pctf(pj / m)}` : ''}${sumEmp}${sumTaxa}</div>
      <div class="tbl-wrap"><table><thead><tr><th>Praça</th>${papel !== 'comercial' ? '<th>Comercial</th>' : ''}<th class="r">Meta</th><th class="r">Produzido</th><th>Atingido</th><th class="r">Projeção</th><th class="r">Precisa/dia</th><th title="Lojas com ao menos uma entrega no mês: realizado / meta · % da meta">Empresas</th><th title="Entregas finalizadas ÷ pedidos: realizado / meta">Taxa de sucesso</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div><div class="mcards">${cards}</div></section>`;
  }).join('');
  return tiles + body + `<p class="hint" style="padding-bottom:24px">Projeção = produzido ÷ dias corridos até a data da produção × dias do mês. "Precisa/dia" é quanto falta por dia para bater a meta. Empresas com entregas = lojas com ao menos uma entrega no mês. Taxa de sucesso = entregas finalizadas ÷ pedidos, ponderada pelos pedidos nos totais; aparece quando a base traz pedidos ou cancelamentos. Toque numa praça para ver o funil dela.</p>`;
}

/* ---------- Funil / Lojas / Tarefas ---------- */
function cardHTML(l) {
  const c = classificar(l); const uc = ultimoContato(l.id); const ta = tarefasAbertas(l.id).length; const chips = [];
  if (c.fase === 'prospeccao') chips.push(`<span class="chip hl">${esc(ETAPAS[l.etapa || 'novo'])}</span>`);
  if (c.fase === 'ativacao') chips.push(`<span class="chip good">${c.diasRest} dias de ativação</span>`);
  if (c.fase === 'inativo') {
    // Loja inativa com pedidos cancelados: tentou pedir e não conseguiu. O volume aparece no número em destaque
    // (só cancelamentos) ou num chip (parou este mês e cancelou pedidos neste mês).
    if (c.soCancelamentos) chips.push(`<span class="chip warn">Só cancelamentos</span>`);
    else chips.push(c.longo ? `<span class="chip warn">Sem entregas há 2+ meses</span>` : `<span class="chip warn">Parou este mês</span>`);
    if (!c.soCancelamentos && c.cancelados > 0) chips.push(`<span class="chip warn">${nf(c.cancelados)} cancelada${c.cancelados === 1 ? '' : 's'} no mês</span>`);
  }
  if (uc) { const d = dias(hoje(), diaDe(uc)); chips.push(`<span class="chip ${d > 14 ? 'warn' : ''}">Contato ${relDias(d)}</span>`); } else chips.push(`<span class="chip warn">Sem contato registrado</span>`);
  if (ta) chips.push(`<span class="chip">${ta} tarefa${ta > 1 ? 's' : ''}</span>`);
  let nums = '';
  if (c.soCancelamentos) {
    const det = [c.cancelados ? `${nf(c.cancelados)} no mês` : '', c.canceladosAnt ? `${nf(c.canceladosAnt)} no anterior` : ''].filter(Boolean).join(' · ');
    nums = `<div class="row"><span class="big down">${nf(c.cancelados2m)}</span><span class="cmp">cancelado${c.cancelados2m === 1 ? '' : 's'} · ${det}</span></div>`;
  } else if (c.fase !== 'prospeccao') { const dlt = c.atual - c.ant; const cls = dlt > 0 ? 'up' : dlt < 0 ? 'down' : ''; nums = `<div class="row"><span class="big">${nf(c.atual)}</span><span class="cmp">entregas no mês · <span class="${cls}">${nf(c.ant)} no anterior</span></span></div>`; }
  return `<button class="card" data-loja="${esc(l.id)}"><span class="t">${esc(l.nome)}</span><span class="loc">${esc([l.bairro, nomePraca(l.praca)].filter(Boolean).join(' · '))}</span>${nums}<span class="chips">${chips.join('')}</span></button>`;
}
function ordenarFase(arr) {
  return arr.sort((a, b) => {
    const ca = classificar(a), cb = classificar(b);
    // Inativos: maior demanda primeiro (entregas do mês anterior + pedidos cancelados nos 2 meses)
    if (ca.fase === 'inativo') return (cb.ant + (cb.cancelados2m || 0)) - (ca.ant + (ca.cancelados2m || 0));
    if (ca.fase === 'ativacao') return ca.diasRest - cb.diasRest;
    if (ca.fase === 'prospeccao') return (b.dataCadastro || '').localeCompare(a.dataCadastro || '');
    return cb.atual - ca.atual;
  });
}
function viewFunil() {
  const ls = lojasFiltradas(); const by = {}; FASES.forEach(f => by[f.id] = []);
  ls.forEach(l => by[classificar(l).fase].push(l));
  const sel = S.fase || 'prospeccao';
  return `<div class="board">${FASES.map(f => {
    const arr = ordenarFase(by[f.id]); const shown = arr.slice(0, 80);
    return `<section class="col ${f.id === sel ? 'sel' : ''}" data-col="${f.id}" style="--c:${f.c}"><header><span class="hex"></span><b>${f.nome}</b><span class="n">${arr.length}</span></header><div class="desc">${f.desc}</div><div class="list">${shown.map(cardHTML).join('') || '<div class="more">Nenhuma loja nesta fase.</div>'}${arr.length > 80 ? `<div class="more">+${arr.length - 80} lojas. Veja todas na aba Lojas.</div>` : ''}</div></section>`;
  }).join('')}</div>`;
}
function viewLista() {
  let ls = lojasFiltradas().map(l => ({ l, c: classificar(l), uc: ultimoContato(l.id), ta: tarefasAbertas(l.id).length }));
  if (S.fase) ls = ls.filter(x => x.c.fase === S.fase);
  const k = S.sort.k, d = S.sort.d; const idx = Object.fromEntries(FASES.map((f, i) => [f.id, i]));
  const val = x => k === 'nome' ? x.l.nome.toLowerCase() : k === 'cidade' ? (nomePraca(x.l.praca) + (x.l.bairro || '')).toLowerCase() : k === 'fase' ? idx[x.c.fase] : k === 'entregasMes' ? x.c.atual : k === 'ant' ? x.c.ant : k === 'canc' ? (x.c.cancelados2m ?? -1) : k === 'ultima' ? (x.l.ultimaEntrega || '') : k === 'contato' ? (x.uc || '') : x.ta;
  ls.sort((a, b) => { const va = val(a), vb = val(b); return (va > vb ? 1 : va < vb ? -1 : 0) * d; });
  const th = (key, lab, r) => `<th class="${r ? 'r' : ''}"><button data-sort="${key}">${lab}${S.sort.k === key ? (S.sort.d > 0 ? ' ↑' : ' ↓') : ''}</button></th>`;
  const filtro = S.fase ? `<p class="hint" style="margin:0 0 10px">Filtrando pela fase <b>${FMAP[S.fase].nome}</b> · <button class="linkish" id="limpaFase">mostrar todas</button></p>` : '';
  if (!ls.length) return filtro + `<div class="empty"><h2>Nenhuma loja encontrada</h2><p>Ajuste a busca ou os filtros.</p></div>`;
  const rows = ls.map(({ l, c, uc, ta }) => `<tr data-loja="${esc(l.id)}"><td><b>${esc(l.nome)}</b></td><td>${esc(nomePraca(l.praca))}<span class="hint"> · ${esc(l.bairro || '')}</span></td><td><span class="phase" style="--c:${FMAP[c.fase].c}"><span class="hex"></span>${FMAP[c.fase].nome}</span></td><td class="r num">${c.fase === 'prospeccao' ? '—' : nf(c.atual)}</td><td class="r num">${c.fase === 'prospeccao' ? '—' : nf(c.ant)}</td><td class="r num ${c.soCancelamentos ? 'down' : ''}" title="${c.cancelados2m != null ? `${nf(c.cancelados || 0)} no mês · ${nf(c.canceladosAnt || 0)} no anterior` : 'A base não traz cancelamentos'}">${c.cancelados2m != null ? nf(c.cancelados2m) : '—'}</td><td class="num">${fmtD(l.ultimaEntrega)}</td><td>${uc ? relDias(dias(hoje(), diaDe(uc))) : '<span class="down">nunca</span>'}</td><td class="r num">${ta || ''}</td></tr>`).join('');
  const cards = ls.slice(0, 300).map(({ l }) => cardHTML(l)).join('');
  return filtro + `<div class="tbl-wrap"><table><thead><tr>${th('nome', 'Loja')}${th('cidade', 'Praça · bairro')}${th('fase', 'Fase')}${th('entregasMes', 'Entregas mês', 1)}${th('ant', 'Mês anterior', 1)}${th('canc', 'Canceladas', 1)}${th('ultima', 'Última entrega')}${th('contato', 'Último contato')}${th('tarefas', 'Tarefas', 1)}</tr></thead><tbody>${rows}</tbody></table></div><div class="mlist">${cards}</div>`;
}
function viewTarefas() {
  const ids = new Set(lojasFiltradas().map(l => l.id)); const t0 = iso(hoje()); const all = [];
  for (const [lid, c] of S.crm) { if (!ids.has(lid)) continue; (c.tarefas || []).forEach(t => all.push({ ...t, lid })); }
  const ab = all.filter(t => !t.feita); const gr = { atras: [], hoje: [], prox: [], sem: [] };
  ab.forEach(t => { if (!t.vence) gr.sem.push(t); else if (t.vence < t0) gr.atras.push(t); else if (t.vence === t0) gr.hoje.push(t); else gr.prox.push(t); });
  Object.values(gr).forEach(a => a.sort((x, y) => (x.vence || '').localeCompare(y.vence || '')));
  const feitas = all.filter(t => t.feita).sort((a, b) => (b.feitaEm || '').localeCompare(a.feitaEm || '')).slice(0, 10);
  const item = t => { const l = S.lojas.get(t.lid); return `<div class="task ${t.feita ? 'done' : ''}"><input type="checkbox" data-tk="${esc(t.lid)}|${esc(t.id)}" ${t.feita ? 'checked' : ''} aria-label="Concluir tarefa"><div class="tx"><b>${esc(t.texto)}</b><div class="meta"><button class="linkish" data-loja="${esc(t.lid)}">${esc(l ? l.nome : 'Loja')}</button> · ${esc(l ? nomePraca(l.praca) : '')} · ${t.vence ? 'vence ' + fmtD(t.vence) : 'sem data'}</div></div></div>`; };
  const g = (tit, arr, c) => arr.length ? `<div class="tgroup"><h3><span class="hex" style="--c:${c}"></span>${tit} <span class="hint num">${arr.length}</span></h3>${arr.map(item).join('')}</div>` : '';
  const html = g('Atrasadas', gr.atras, 'var(--danger)') + g('Para hoje', gr.hoje, 'var(--accent)') + g('Próximas', gr.prox, 'var(--f-prosp)') + g('Sem data', gr.sem, 'var(--line)') + g('Concluídas recentemente', feitas, 'var(--ok)');
  return html || `<div class="empty"><span class="hex"></span><h2>Nenhuma tarefa por aqui</h2><p>Crie tarefas no detalhe de cada loja para organizar retornos e visitas.</p></div>`;
}

/* ---------- Gestão ---------- */
function optPessoas(papel, sel, vazio) {
  const ps = Object.values(S.pessoas).filter(p => p.papel === papel && p.ativo).sort((a, b) => byPt(a.nome, b.nome));
  return `<option value="">${vazio}</option>` + ps.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.nome)}</option>`).join('');
}
const optRegionais = sel => `<option value="">Sem regional</option>` + Object.values(S.regionais).sort((a, b) => byPt(a.nome, b.nome)).map(r => `<option value="${esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${esc(r.nome)}</option>`).join('');

function viewGestao() {
  const s = S.sync;
  return `<div class="panels">
  <section class="panel" style="grid-column:1/-1">
    <h2>Estrutura e metas</h2>
    <p>Defina a supervisão de cada regional, o comercial responsável e as metas de cada praça (corridas, empresas com entregas e taxa de sucesso). As alterações salvam na hora.</p>
    <details id="metasImp"><summary>Importar metas do mês</summary>
      <div class="form" style="margin-top:8px">
        <p class="hint">Na planilha de metas, selecione a aba do mês com o cabeçalho (CIDADE, Entregas Finalizadas, Empresas com Entregas, Taxa de Sucesso), copie e cole aqui. Praças marcadas com "–" ficam sem meta. As que não estiverem na planilha não mudam.</p>
        <textarea class="field" id="metTxt" placeholder="Cole aqui as linhas copiadas da planilha de metas"></textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="metPrev" type="button">Conferir metas</button><button class="btn primary" id="metGo" type="button" disabled>Aplicar metas</button></div>
        <div id="metOut"></div>
      </div>
    </details>
    <div id="estrutura"></div>
    <details><summary>Adicionar praça</summary>
      <form class="form" id="fPracaNova" style="margin-top:8px"><div class="linha-add">
        <input class="field" id="npNome" placeholder="Cidade (ex.: Petrolina)" required><input class="field" id="npUf" placeholder="UF" maxlength="2" required>
        <select class="field" id="npReg">${optRegionais('')}</select><button class="btn primary" type="submit">Adicionar</button></div></form>
    </details>
  </section>
  <section class="panel">
    <h2>Equipe e acessos</h2>
    <p>Quem tem e-mail cadastrado aqui consegue entrar pelo link de acesso. Sem e-mail, a pessoa não entra.</p>
    <div id="pessoasBox" style="display:grid;gap:8px"></div>
    <details><summary>Adicionar pessoa</summary>
      <form class="form" id="fPessoaNova" style="margin-top:8px"><input class="field" id="nsNome" placeholder="Nome completo" required>
        <input class="field" id="nsEmail" type="email" placeholder="e-mail @${esc(DOMINIO)}">
        <div class="two"><select class="field" id="nsPapel"><option value="comercial">Comercial</option><option value="supervisor">Supervisão</option><option value="gestor">Gestor</option></select><select class="field" id="nsReg">${optRegionais('')}</select></div>
        <div><button class="btn primary sm" type="submit">Adicionar pessoa</button></div></form>
    </details>
  </section>
  <section class="panel">
    <h2>Base diária</h2>
    <p>A base é atualizada automaticamente todo dia às 06:00${s && s.fonte ? ` (origem: ${esc(s.fonte)})` : ''}. Use a importação manual para testes ou para corrigir um dia que falhou.</p>
    <div class="kv"><div><span>Última carga</span><b>${s ? esc(fmtDT(s.executado_em)) : '—'}</b></div><div><span>Lojas na carga</span><b>${s ? nf(s.total) : '—'}</b></div><div><span>Novas</span><b>${s ? nf(s.novos) : '—'}</b></div></div>
    <label class="form"><span class="hint" style="font-weight:600">Arquivo da base (CSV baixado da planilha ou JSON)</span><input type="file" id="impFile" accept=".json,.csv,.txt,application/json,text/csv" class="field" style="padding-top:6px"></label>
    <textarea class="field" id="impTxt" placeholder="…ou cole aqui as linhas copiadas da planilha, com o cabeçalho"></textarea>
    <label class="hint" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="impProd" checked> Recalcular o produzido das praças com a soma das lojas</label>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="impPrev">Conferir dados</button><button class="btn primary" id="impGo" disabled>Aplicar atualização</button></div>
    <div id="impOut"></div>
  </section></div>`;
}
function renderEstrutura() {
  const box = $('estrutura'); if (!box) return;
  const rs = Object.values(S.regionais).sort((a, b) => byPt(a.nome, b.nome));
  const grupos = rs.map(r => ({ r, ps: Object.values(S.pracas).filter(p => p.regional === r.id) }));
  grupos.push({ r: null, ps: Object.values(S.pracas).filter(p => !p.regional || !S.regionais[p.regional]) });
  box.innerHTML = grupos.filter(g => g.r || g.ps.length).map(({ r, ps }) => {
    ps.sort((a, b) => (+b.meta || -1) - (+a.meta || -1) || byPt(a.rotulo, b.rotulo));
    const head = r ? `<div class="rg-head"><b>${esc(r.nome)}</b><span class="hint">Supervisão</span><select data-reg-sup="${esc(r.id)}" aria-label="Supervisão da ${esc(r.nome)}">${optPessoas('supervisor', r.supervisorId, 'Sem supervisor')}</select><span class="hint">${ps.length} praças</span></div>` : `<div class="rg-head"><b>Sem regional</b><span class="hint">${ps.length} praças</span></div>`;
    const rows = ps.map(p => `<tr><td><b>${esc(p.rotulo)}</b></td><td><select data-pf="comercialId" data-pid="${esc(p.id)}" aria-label="Comercial">${optPessoas('comercial', p.comercialId, '— sem comercial —')}</select></td><td><select data-pf="regional" data-pid="${esc(p.id)}" aria-label="Regional">${optRegionais(p.regional)}</select></td><td><input type="number" min="0" data-pf="meta" data-pid="${esc(p.id)}" value="${p.meta != null ? esc(p.meta) : ''}" placeholder="sem meta" aria-label="Meta de corridas"></td><td><input type="number" min="0" step="any" data-pf="metaEmpresas" data-pid="${esc(p.id)}" value="${p.metaEmpresas != null ? esc(+p.metaEmpresas.toFixed(1)) : ''}" placeholder="sem meta" aria-label="Meta de empresas com entregas"></td><td><input type="number" min="0" max="100" step="0.1" data-pf="metaTaxa" data-pid="${esc(p.id)}" value="${p.metaTaxa != null ? esc(+(p.metaTaxa * 100).toFixed(1)) : ''}" placeholder="sem meta" aria-label="Meta de taxa de sucesso (%)"></td><td><input type="number" min="0" data-pf="produzido" data-pid="${esc(p.id)}" value="${p.produzido != null ? esc(p.produzido) : ''}" aria-label="Produzido"></td><td><input type="date" data-pf="produzidoAte" data-pid="${esc(p.id)}" value="${esc(p.produzidoAte || '')}" aria-label="Produzido até"></td></tr>`).join('');
    return head + `<div class="tbl-wrap edit-tbl"><table><thead><tr><th>Praça</th><th>Comercial</th><th>Regional</th><th>Meta (corridas)</th><th>Meta empresas</th><th>Meta taxa (%)</th><th>Produzido</th><th>Até</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('');
  box.onchange = async e => {
    const t = e.target;
    try {
      if (t.dataset.regSup !== undefined) { ok(await sb.from('regionais').update({ supervisor_id: t.value || null }).eq('id', t.dataset.regSup)); S.regionais[t.dataset.regSup].supervisorId = t.value || null; toast('Supervisão atualizada'); return; }
      const f = t.dataset.pf, pid = t.dataset.pid; if (!f) return;
      let v = t.value;
      if (f === 'meta' || f === 'produzido') v = v === '' ? (f === 'meta' ? null : 0) : Math.max(0, parseInt(v, 10) || 0);
      else if (f === 'metaEmpresas') v = v === '' ? null : Math.max(0, parseFloat(v) || 0);
      else if (f === 'metaTaxa') {
        v = v === '' ? null : Math.round(parseFloat(v) * 1e4) / 1e6; // 92,3 (%) → 0,923
        if (v != null && !(v > 0 && v <= 1)) {
          const atual = S.pracas[pid].metaTaxa; t.value = atual != null ? +(atual * 100).toFixed(1) : '';
          toast('Use uma taxa entre 0,1 e 100%.'); return;
        }
      } else if (!v) v = null;
      ok(await sb.from('pracas').update({ [CAMPO_PRACA[f]]: v }).eq('id', pid)); S.pracas[pid][f] = v; toast('Salvo: ' + nomePraca(pid));
    } catch (err) { toast(erroMsg(err)); }
  };
}
function renderPessoas() {
  const box = $('pessoasBox'); if (!box) return;
  const ordem = { gestor: 0, supervisor: 1, comercial: 2 };
  const ps = Object.values(S.pessoas).sort((a, b) => (ordem[a.papel] - ordem[b.papel]) || byPt(a.nome, b.nome));
  box.innerHTML = ps.map(p => {
    const nPr = Object.values(S.pracas).filter(x => p.papel === 'supervisor' ? x.regional === p.regional : p.papel === 'gestor' ? true : x.comercialId === p.id).length;
    return `<div class="member ${p.ativo ? '' : 'off'}"><span class="avatar">${esc(p.nome.charAt(0))}</span><div style="min-width:0"><div class="nm">${esc(p.nome)}</div><div class="hint">${PAPEIS[p.papel]}${p.regional && S.regionais[p.regional] ? ' · ' + esc(S.regionais[p.regional].nome) : ''} · ${nPr} praça${nPr === 1 ? '' : 's'}${p.ativo ? '' : ' · <b>inativo</b>'}</div>
      <input class="field email-in" type="email" data-email="${esc(p.id)}" value="${esc(p.email || '')}" placeholder="e-mail @${esc(DOMINIO)} para liberar o acesso" aria-label="E-mail de ${esc(p.nome)}"></div>
      <div class="acts">${p.id !== (S.eu && S.eu.id) ? `<button class="btn sm" data-ver="${esc(p.id)}">Ver como</button><button class="btn sm ${p.ativo ? 'danger' : ''}" data-ativo="${esc(p.id)}">${p.ativo ? 'Desativar' : 'Reativar'}</button>` : ''}</div></div>`;
  }).join('');
}
function wireGestao() {
  const panels = $('view').querySelector('.panels');
  $('fPracaNova').onsubmit = async e => {
    e.preventDefault(); const nome = $('npNome').value.trim(), uf = $('npUf').value.trim().toUpperCase(); if (!nome || !uf) return;
    const id = norm(nome + ' ' + uf); if (S.pracas[id]) { toast('Essa praça já existe.'); return; }
    try { ok(await sb.from('pracas').insert({ id, nome, uf, rotulo: nome + '/' + uf, regional_id: $('npReg').value || null })); toast('Praça adicionada'); recarregarLogo(); } catch (err) { toast(erroMsg(err)); }
  };
  $('fPessoaNova').onsubmit = async e => {
    e.preventDefault(); const nome = $('nsNome').value.trim(); if (!nome) return;
    const email = $('nsEmail').value.trim().toLowerCase() || null;
    if (email && !emailDaBee(email)) { toast(`Use um e-mail ${DOMINIOS_TXT}.`); return; }
    let id = norm(nome); if (S.pessoas[id]) id += '-' + Date.now().toString(36).slice(-3);
    try { ok(await sb.from('pessoas').insert({ id, nome, email, papel: $('nsPapel').value, regional_id: $('nsReg').value || null })); toast('Pessoa adicionada'); recarregarLogo(); } catch (err) { toast(erroMsg(err)); }
  };
  panels.addEventListener('change', async ev => {
    const t = ev.target; if (!t.dataset.email) return;
    const email = t.value.trim().toLowerCase() || null;
    if (email && !emailDaBee(email)) { toast(`Use um e-mail ${DOMINIOS_TXT}.`); return; }
    try { ok(await sb.from('pessoas').update({ email }).eq('id', t.dataset.email)); S.pessoas[t.dataset.email].email = email; toast(email ? 'Acesso liberado para ' + email : 'Acesso removido'); } catch (err) { toast(/duplicate|unique/i.test(err.message) ? 'Esse e-mail já está em outra pessoa.' : erroMsg(err)); }
  });
  panels.addEventListener('click', async ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.ver) { S.viewAs = b.dataset.ver; S.fCom = ''; S.fPraca = ''; S.fase = null; S.tab = S.pessoas[S.viewAs].papel === 'comercial' ? 'funil' : 'metas'; render(); window.scrollTo(0, 0); }
    else if (b.dataset.ativo) { const p = S.pessoas[b.dataset.ativo]; try { ok(await sb.from('pessoas').update({ ativo: !p.ativo }).eq('id', p.id)); p.ativo = !p.ativo; renderPessoas(); } catch (err) { toast(erroMsg(err)); } }
  });
  wireImport();
  wireMetas();
}
function wireMetas() {
  const txt = $('metTxt'), go = $('metGo'), out = $('metOut'); let plano = null;
  const fmt = (v, f) => v == null ? 'sem meta' : f === 'taxa' ? pct1(v) : nf(Math.round(v));
  $('metPrev').onclick = () => {
    go.disabled = true; plano = null;
    try {
      const rows = parseEntrada(txt.value); if (!rows.length) { out.innerHTML = '<p class="hint">Nenhuma linha encontrada.</p>'; return; }
      const p = prepararMetas(rows, Object.values(S.pracas));
      // Diferenças só de arredondamento (180,907 × 180,9069767) não contam como mudança
      const igual = (a, b, casas) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.5 * 10 ** -casas);
      const muda = p.metas.filter(m => { const a = S.pracas[m.praca_id]; return !igual(a.meta, m.meta, 0) || !igual(a.metaEmpresas, m.meta_empresas, 2) || !igual(a.metaTaxa, m.meta_taxa_sucesso, 4); });
      const comMeta = p.metas.filter(m => m.meta != null).length;
      const exemplo = muda.slice(0, 5).map(m => { const a = S.pracas[m.praca_id]; return `${a.rotulo}: ${fmt(a.meta)} → ${fmt(m.meta)} corridas · ${fmt(a.metaEmpresas)} → ${fmt(m.meta_empresas)} empresas · ${fmt(a.metaTaxa, 'taxa')} → ${fmt(m.meta_taxa_sucesso, 'taxa')}`; });
      out.innerHTML = `<div class="kv"><div><span>Praças na planilha</span><b>${nf(p.metas.length)}</b></div><div><span>Com meta</span><b>${nf(comMeta)}</b></div><div><span>Vão mudar</span><b>${nf(muda.length)}</b></div></div>`
        + (exemplo.length ? `<p class="hint" style="margin-top:8px">${exemplo.map(esc).join('<br>')}${muda.length > 5 ? '<br>…' : ''}</p>` : '')
        + (p.semPraca.length ? `<p class="down" style="margin-top:8px">Sem praça cadastrada: ${esc(p.semPraca.slice(0, 6).join(', '))}${p.semPraca.length > 6 ? '…' : ''}. Adicione a praça e confira de novo.</p>` : '')
        + (p.erros.length ? `<p class="down" style="margin-top:8px">${esc(p.erros.slice(0, 3).join('; '))}</p>` : '');
      plano = muda; go.disabled = !muda.length || p.erros.length > 0;
    } catch (e) { out.innerHTML = '<p class="down">Não consegui ler as metas. Copie a aba inteira, com o cabeçalho.</p>'; }
  };
  go.onclick = async () => {
    if (!plano) return; go.disabled = true; $('metPrev').disabled = true;
    try {
      for (const [i, m] of plano.entries()) {
        ok(await sb.from('pracas').update({ meta: m.meta, meta_empresas: m.meta_empresas, meta_taxa_sucesso: m.meta_taxa_sucesso }).eq('id', m.praca_id));
        Object.assign(S.pracas[m.praca_id], { meta: m.meta, metaEmpresas: m.meta_empresas, metaTaxa: m.meta_taxa_sucesso });
        out.innerHTML = `<p class="hint">Salvando ${i + 1} de ${plano.length}…</p>`;
      }
      out.innerHTML = `<p class="up">Metas aplicadas em ${nf(plano.length)} praça${plano.length === 1 ? '' : 's'}.</p>`; txt.value = ''; renderEstrutura();
    } catch (err) { out.innerHTML = `<p class="down">${esc(erroMsg(err))}</p>`; }
    $('metPrev').disabled = false; plano = null;
  };
}
function wireImport() {
  const file = $('impFile'), txt = $('impTxt'), go = $('impGo'), out = $('impOut');
  file.onchange = () => { const f = file.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { txt.value = rd.result; $('impPrev').click(); }; rd.readAsText(f); };
  $('impPrev').onclick = () => {
    go.disabled = true; S.importPlan = null;
    try {
      const rows = parseEntrada(txt.value); if (!rows.length) { out.innerHTML = '<p class="hint">Nenhuma linha encontrada.</p>'; return; }
      const p = prepararImportacao(rows, Object.values(S.pracas)); S.importPlan = p;
      const codigos = new Set([...S.lojas.values()].map(l => l.codigo).filter(Boolean));
      const novos = p.linhas.filter(l => !codigos.has(l.codigo)).length; const sp = Object.entries(p.semPraca);
      out.innerHTML = `<div class="kv"><div><span>Lojas válidas</span><b>${nf(p.linhas.length)}</b></div><div><span>Novas (aprox.)</span><b>${nf(novos)}</b></div><div><span>Ignoradas</span><b>${nf(p.erros.length + sp.reduce((s, x) => s + x[1], 0))}</b></div></div>${p.franquias ? `<p class="hint" style="margin-top:8px">${nf(p.franquias)} lojas de franquia ficaram de fora: o CRM é só para operações próprias.</p>` : ''}${sp.length ? `<p class="down" style="margin-top:8px">Sem praça cadastrada: ${esc(sp.slice(0, 6).map(x => x[0] + ' (' + x[1] + ')').join(', '))}${sp.length > 6 ? '…' : ''}. Adicione a praça acima e confira de novo.</p>` : ''}${p.erros.length ? `<p class="down" style="margin-top:8px">${esc(p.erros.slice(0, 3).join('; '))}${p.erros.length > 3 ? '…' : ''}</p>` : ''}`;
      go.disabled = !p.linhas.length;
    } catch (e) { out.innerHTML = '<p class="down">Não consegui ler os dados. Confira se é um JSON válido ou um CSV com cabeçalho.</p>'; }
  };
  go.onclick = async () => {
    const p = S.importPlan; if (!p) return; go.disabled = true; $('impPrev').disabled = true;
    const tot = { total: 0, novos: 0, atualizados: 0, convertidos: 0 }; const lote = 500; let emAtivacao = 0;
    out.innerHTML = `<div class="progress"><i id="impBar"></i></div><p class="hint" id="impMsg">Enviando…</p>`;
    try {
      for (let i = 0; i < p.linhas.length; i += lote) {
        const r = ok(await sb.rpc('importar_base', { p_linhas: p.linhas.slice(i, i + lote) }));
        Object.keys(tot).forEach(k => tot[k] += r[k] || 0); emAtivacao += r.em_ativacao || 0;
        $('impBar').style.width = Math.min(100, (i + lote) / p.linhas.length * 100) + '%'; $('impMsg').textContent = `Enviadas ${Math.min(i + lote, p.linhas.length)} de ${p.linhas.length}…`;
      }
      if ($('impProd').checked) ok(await sb.rpc('recalcular_produzido', { p_ate: iso(new Date(Date.now() - 864e5)) }));
      ok(await sb.from('sync_log').insert({ fonte: 'Importação manual', ...tot, sem_praca: Object.values(p.semPraca).reduce((s, n) => s + n, 0), erros: p.erros.length, detalhes: { franquias_ignoradas: p.franquias, em_ativacao: emAtivacao } }));
      out.innerHTML = `<p class="up">Base aplicada: ${nf(tot.atualizados)} atualizadas, ${nf(tot.novos)} novas, ${nf(tot.convertidos)} prospecções convertidas, ${nf(emAtivacao)} em Ativação.</p>`;
      recarregarLogo();
    } catch (err) { out.innerHTML = `<p class="down">${esc(erroMsg(err))}</p>`; }
    $('impPrev').disabled = false; S.importPlan = null;
  };
}

/* ---------- render ---------- */
function renderView() {
  const gest = S.tab === 'gestao';
  if (!S.eu) {
    $('toolbar').hidden = true; $('counters').hidden = true; $('bnav').hidden = true; $('fab').hidden = true;
    $('view').innerHTML = `<div class="empty"><span class="hex"></span><h2>Seu acesso ainda não foi liberado</h2><p>O e-mail ${esc(S.session.user.email)} não está ligado a ninguém da equipe comercial. Fale com o gestor.</p></div>`; return;
  }
  $('toolbar').hidden = false; $('counters').hidden = gest || S.tab === 'metas'; $('bnav').hidden = false; $('fab').hidden = gest || S.tab === 'metas';
  const titles = { metas: 'Metas do mês', funil: 'Funil', lista: 'Lojas', tarefas: 'Tarefas', gestao: 'Gestão' };
  $('viewTitle').textContent = titles[S.tab];
  $('fCidade').hidden = gest; $('fBusca').hidden = gest || S.tab === 'metas'; $('btnNova').hidden = gest || S.tab === 'metas';
  if (!pracasEscopo().length && !gest) { $('view').innerHTML = `<div class="empty"><span class="hex"></span><h2>Nenhuma praça atribuída</h2><p>Peça ao gestor comercial para definir suas praças.</p></div>`; return; }
  $('view').innerHTML = { metas: viewMetas, funil: viewFunil, lista: viewLista, tarefas: viewTarefas, gestao: viewGestao }[S.tab]();
  if (gest) { renderEstrutura(); renderPessoas(); wireGestao(); }
  const lf = $('limpaFase'); if (lf) lf.onclick = () => { S.fase = null; render(); };
}
function render() {
  if (!S.carregado) return;
  $('login').hidden = true; $('app').hidden = false;
  const papel = papelAtual();
  if (!S.tab) S.tab = papel === 'comercial' ? 'funil' : 'metas';
  if (S.tab === 'gestao' && papel !== 'gestor') S.tab = 'metas';
  renderTabs(); renderMe(); renderSync(); renderBanner(); renderFiltros(); renderCounters();
  const ae = document.activeElement;
  if (S.tab === 'gestao' && $('view').querySelector('.panels') && ae && $('view').contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
  renderView();
  if (S.open) renderDrawer();
}

$('view').addEventListener('click', async e => {
  const s = e.target.closest('[data-sort]'); if (s) { const k = s.dataset.sort; S.sort = S.sort.k === k ? { k, d: -S.sort.d } : { k, d: k === 'nome' || k === 'cidade' ? 1 : -1 }; renderView(); return; }
  const tk = e.target.closest('[data-tk]'); if (tk) { const [lid, tid] = tk.dataset.tk.split('|'); await toggleTask(lid, tid, tk.checked); return; }
  const lj = e.target.closest('[data-loja]'); if (lj) { abrirLoja(lj.dataset.loja); return; }
  const pr = e.target.closest('[data-praca]'); if (pr) { S.fPraca = pr.dataset.praca; const p = S.pracas[S.fPraca]; if (S.fCom && p && p.comercialId !== S.fCom) S.fCom = ''; S.tab = 'funil'; S.fase = null; render(); window.scrollTo(0, 0); }
});

/* ---------- detalhe da loja ---------- */
function abrirLoja(id) { S.open = id; $('dEdit').hidden = true; $('nTexto').value = ''; $('tTexto').value = ''; $('tData').value = ''; $('drawer').hidden = false; $('scrim').hidden = false; renderDrawer(); $('dClose').focus(); }
function fecharLoja() { S.open = null; $('drawer').hidden = true; $('scrim').hidden = true; }
$('dClose').onclick = fecharLoja; $('scrim').onclick = fecharLoja;
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('mNova').hidden) $('mNova').hidden = true; else if (S.open) fecharLoja(); } });

function renderDrawer() {
  const l = S.lojas.get(S.open); if (!l) { fecharLoja(); return; }
  const c = classificar(l); const f = FMAP[c.fase]; const pc = S.pracas[l.praca];
  $('dPhase').innerHTML = `<span class="phase" style="--c:${f.c}"><span class="hex"></span>${f.nome}</span>`;
  $('dNome').textContent = l.nome;
  $('dLoc').textContent = [l.bairro, nomePraca(l.praca)].filter(Boolean).join(' · ') + (pc && pc.comercialId ? ' · ' + nomePessoa(pc.comercialId) : '') + (l.codigo ? ' · código ' + l.codigo : ' · cadastro do comercial');
  $('dFacts').innerHTML = c.fase === 'prospeccao'
    ? `<div class="facts"><div><span>Cadastrada em</span><b>${fmtD(l.dataCadastro)}</b></div><div><span>Dias em prospecção</span><b>${l.dataCadastro ? dias(hoje(), parseD(l.dataCadastro)) : '—'}</b></div><div><span>Etapa</span><b style="font-family:var(--body);font-size:13px">${esc(ETAPAS[l.etapa || 'novo'])}</b></div></div>`
    : `<div class="facts"><div><span>Entregas no mês</span><b>${nf(c.atual)}</b></div><div><span>Mês anterior</span><b>${nf(c.ant)}</b></div><div><span>Variação</span><b class="${c.atual - c.ant >= 0 ? 'up' : 'down'}">${c.atual - c.ant >= 0 ? '+' : ''}${nf(c.atual - c.ant)}</b></div><div><span>1ª entrega</span><b>${fmtD(l.primeiraEntrega)}</b></div><div><span>Última entrega</span><b>${fmtD(l.ultimaEntrega)}</b></div><div><span>${c.fase === 'ativacao' ? 'Ativação termina em' : l.primeiraEntrega ? 'Cliente desde' : 'No CRM desde'}</span><b>${c.fase === 'ativacao' ? c.diasRest + ' dias' : fmtD(l.primeiraEntrega || l.dataCadastro)}</b></div>${c.cancelados2m != null ? `<div><span>Canceladas no mês</span><b class="${c.cancelados ? 'down' : ''}">${c.cancelados != null ? nf(c.cancelados) : '—'}</b></div><div><span>Canceladas mês anterior</span><b class="${c.canceladosAnt ? 'down' : ''}">${c.canceladosAnt != null ? nf(c.canceladosAnt) : '—'}</b></div><div><span>Taxa de sucesso no mês</span><b>${c.cancelados != null && c.atual + c.cancelados ? pct1(c.atual / (c.atual + c.cancelados)) : '—'}</b></div>` : ''}</div>`;
  $('dProsp').hidden = c.fase !== 'prospeccao'; $('dEtapa').value = l.etapa || 'novo';
  const tel = soDig(l.telefone); const addr = [l.endereco, l.bairro, l.cidade].filter(Boolean).join(', ');
  $('dContact').innerHTML = `<div class="ln"><b></b></div>${l.telefone ? `<div class="ln"><span class="num tel"></span><button class="btn sm" id="cpTel" type="button">Copiar</button>${tel.length >= 10 ? `<a target="_blank" rel="noopener" href="https://wa.me/55${tel.replace(/^55/, '')}">Abrir WhatsApp</a>` : ''}</div>` : '<div class="hint">Sem telefone cadastrado</div>'}${addr ? `<div class="ln"><span class="ad"></span><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}">Mapa</a></div>` : ''}${l.cnpj ? `<div class="hint">CNPJ <span class="num cn"></span></div>` : ''}`;
  $('dContact').querySelector('b').textContent = l.responsavel || 'Responsável não informado';
  const te = $('dContact').querySelector('.tel'); if (te) te.textContent = l.telefone;
  const ad = $('dContact').querySelector('.ad'); if (ad) ad.textContent = addr;
  const cn = $('dContact').querySelector('.cn'); if (cn) cn.textContent = l.cnpj;
  const cp = $('cpTel'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(l.telefone); toast('Telefone copiado'); } catch (e) { toast('Não foi possível copiar'); } };
  const crm = crmDe(l.id); const t0 = iso(hoje());
  const tks = (crm.tarefas || []).slice().sort((a, b) => (a.feita - b.feita) || (a.vence || '9').localeCompare(b.vence || '9'));
  $('dTasks').innerHTML = tks.length ? tks.map(t => `<div class="task ${t.feita ? 'done' : ''}"><input type="checkbox" data-dtk="${esc(t.id)}" ${t.feita ? 'checked' : ''} aria-label="Concluir"><div class="tx"><b>${esc(t.texto)}</b><div class="meta ${!t.feita && t.vence && t.vence < t0 ? 'down' : ''}">${t.vence ? 'vence ' + fmtD(t.vence) : 'sem data'}</div></div></div>`).join('') : '<p class="hint" style="margin:0">Nenhuma tarefa.</p>';
  const tl = $('dTimeline'); tl.innerHTML = '';
  if (!crm.notas.length) tl.innerHTML = '<p class="hint" style="margin:0">Nenhum contato registrado ainda.</p>';
  crm.notas.forEach(n => {
    const [ab, nm] = TIPOS[n.tipo] || TIPOS.nota; const d = document.createElement('div'); d.className = 'it';
    d.innerHTML = `<span class="ico">${ab}</span><div><div class="meta"><b>${nm}</b> · ${esc(fmtDT(n.em))} · <span class="au"></span></div><div class="tx"></div></div>`;
    d.querySelector('.au').textContent = n.autorNome || (n.autor ? nomePessoa(n.autor) : 'Colmeia');
    d.querySelector('.tx').textContent = n.texto; tl.appendChild(d);
  });
}
$('dTasks').addEventListener('change', e => { const t = e.target.closest('[data-dtk]'); if (t) toggleTask(S.open, t.dataset.dtk, t.checked); });
const slotCrm = id => { if (!S.crm.has(id)) S.crm.set(id, { notas: [], tarefas: [] }); return S.crm.get(id); };
async function addNota(lid, tipo, texto) {
  const row = ok(await sb.from('crm_notas').insert({ loja_id: lid, tipo, texto, autor_id: S.eu.id, autor_nome: S.eu.nome }).select().single());
  slotCrm(lid).notas.unshift({ id: row.id, tipo, texto, autor: S.eu.id, autorNome: S.eu.nome, em: row.criado_em });
}
async function toggleTask(lid, tid, feita) {
  try {
    ok(await sb.from('crm_tarefas').update({ feita, feita_em: feita ? new Date().toISOString() : null }).eq('id', tid));
    const t = slotCrm(lid).tarefas.find(x => x.id === tid); if (t) { t.feita = feita; t.feitaEm = feita ? new Date().toISOString() : null; }
  } catch (e) { toast(erroMsg(e)); }
  render();
}
$('dTaskForm').onsubmit = async e => {
  e.preventDefault(); const tx = $('tTexto').value.trim(); if (!tx) return; const lid = S.open;
  try {
    const row = ok(await sb.from('crm_tarefas').insert({ loja_id: lid, texto: tx, vence: $('tData').value || null, autor_id: S.eu.id }).select().single());
    slotCrm(lid).tarefas.push({ id: row.id, texto: tx, vence: row.vence, feita: false, autor: S.eu.id, em: row.criado_em });
    $('tTexto').value = ''; $('tData').value = ''; toast('Tarefa criada'); render();
  } catch (err) { toast(erroMsg(err)); }
};
$('dNoteForm').onsubmit = async e => {
  e.preventDefault(); const tx = $('nTexto').value.trim(); if (!tx) return;
  const tipo = (document.querySelector('input[name=ntipo]:checked') || {}).value || 'nota';
  try { await addNota(S.open, tipo, tx); $('nTexto').value = ''; toast('Registro salvo'); render(); } catch (err) { toast(erroMsg(err)); }
};
$('dEtapa').onchange = async e => {
  const lid = S.open; const v = e.target.value;
  try { ok(await sb.from('lojas').update({ etapa: v }).eq('id', lid)); S.lojas.get(lid).etapa = v; await addNota(lid, 'sistema', 'Etapa alterada para "' + ETAPAS[v] + '".'); render(); } catch (err) { toast(erroMsg(err)); }
};
$('dEditBtn').onclick = () => { const l = S.lojas.get(S.open); if (!l) return; $('eResp').value = l.responsavel || ''; $('eTel').value = l.telefone || ''; $('eEnd').value = l.endereco || ''; $('eBairro').value = l.bairro || ''; $('eCnpj').value = l.cnpj || ''; $('dEdit').hidden = false; $('eResp').focus(); };
$('eCancel').onclick = () => $('dEdit').hidden = true;
$('dEdit').onsubmit = async e => {
  e.preventDefault(); const lid = S.open;
  const d = { responsavel: $('eResp').value.trim(), telefone: $('eTel').value.trim(), endereco: $('eEnd').value.trim(), bairro: $('eBairro').value.trim(), cnpj: $('eCnpj').value.trim() };
  try { ok(await sb.from('lojas').update(d).eq('id', lid)); Object.assign(S.lojas.get(lid), d); $('dEdit').hidden = true; toast('Contato atualizado'); render(); } catch (err) { toast(erroMsg(err)); }
};

/* ---------- nova prospecção ---------- */
function abrirNova() {
  const lista = pracasFiltradas().slice().sort((a, b) => byPt(a.rotulo, b.rotulo));
  if (!lista.length) { toast('Você ainda não tem praças atribuídas.'); return; }
  $('pCidade').innerHTML = lista.map(p => `<option value="${esc(p.id)}" ${p.id === S.fPraca ? 'selected' : ''}>${esc(p.rotulo)}</option>`).join('');
  ['pNome', 'pBairro', 'pEnd', 'pResp', 'pTel', 'pCnpj', 'pObs'].forEach(i => $(i).value = '');
  $('mNova').hidden = false; $('pNome').focus();
}
$('btnNova').onclick = abrirNova; $('fab').onclick = abrirNova; $('pCancel').onclick = () => $('mNova').hidden = true;
$('mNova').addEventListener('click', e => { if (e.target === $('mNova')) $('mNova').hidden = true; });
$('fNova').onsubmit = async e => {
  e.preventDefault(); const pc = S.pracas[$('pCidade').value];
  const d = { nome: $('pNome').value.trim(), praca_id: pc.id, cidade: pc.nome, bairro: $('pBairro').value.trim() || null, endereco: $('pEnd').value.trim() || null, responsavel: $('pResp').value.trim() || null, telefone: $('pTel').value.trim() || null, cnpj: $('pCnpj').value.trim() || null, origem: 'prospeccao', etapa: 'novo', criado_por: S.eu.id };
  if (!d.nome) return;
  try {
    const row = ok(await sb.from('lojas').insert(d).select().single());
    S.lojas.set(row.id, deLoja(row));
    await addNota(row.id, 'sistema', 'Loja cadastrada em prospecção.');
    const obs = $('pObs').value.trim(); if (obs) await addNota(row.id, 'nota', obs);
    $('mNova').hidden = true; toast('Loja cadastrada em Prospecção'); render(); abrirLoja(row.id);
  } catch (err) { toast(erroMsg(err)); }
};

/* ---------- início ---------- */
let realtimeOn = false;
function ligarRealtime() {
  if (realtimeOn) return; realtimeOn = true;
  sb.channel('colmeia').on('postgres_changes', { event: '*', schema: 'public' }, recarregarLogo).subscribe();
}
async function iniciar(session) {
  if (session && S.iniciado) return; S.iniciado = !!session;
  S.session = session;
  if (!session) { mostrarLogin(); return; }
  $('login').hidden = true; $('app').hidden = false;
  $('view').innerHTML = '<div class="empty"><span class="hex"></span><h2>Carregando a colmeia…</h2></div>';
  try { await carregar(); render(); ligarRealtime(); }
  catch (e) { console.error(e); $('view').innerHTML = `<div class="empty"><h2>Não foi possível carregar os dados</h2><p>${esc(e.message || e)}</p></div>`; }
}
if (!CONFIG.supabaseUrl || CONFIG.supabaseUrl.includes('SEU-PROJETO')) {
  mostrarLogin('Configure o Supabase em assets/config.js antes de usar (veja o README).');
} else {
  sb.auth.onAuthStateChange((ev, session) => { if (ev === 'SIGNED_IN' && !S.carregado) iniciar(session); if (ev === 'SIGNED_OUT') mostrarLogin(); });
  sb.auth.getSession().then(({ data }) => iniciar(data.session));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.session) recarregarLogo(); });
}
