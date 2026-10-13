// Colmeia CRM · aplicativo (navegador). Sem build: módulo ES servido pelo GitHub Pages.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { CONFIG } from './config.js';
import { FASES, classificar as classificarBase, parseEntrada, prepararImportacao, prepararMetas, somarIndicadores, soDigitos as soDig,
  LIMITES, dataDeCorte, numerosPraca, somarNumeros, avaliar, lojasEmQueda, FAIXAS_VOLUME, composicaoCarteira } from './base.js';

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
  viewAs: null, tab: null, fase: null, fCom: '', fPraca: '', busca: '', sort: { k: 'entregasMes', d: -1 }, open: null, importPlan: null, compBase: 'atual',
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
// Login por e-mail e senha. As contas são criadas pelo gestor (liberar_acesso, migração 006) com a
// senha inicial; enquanto user_metadata.senha_trocada não for true, a pessoa precisa criar a própria senha.
let senhaDoLogin = null; // senha digitada no login, para não aceitar a mesma como nova senha
const precisaTrocarSenha = session => !(session && session.user && session.user.user_metadata && session.user.user_metadata.senha_trocada === true);
function mostrarLogin(msg) {
  $('app').hidden = true; $('novaSenha').hidden = true; $('login').hidden = false;
  $('lMsg').textContent = msg || '';
}
$('lForm').onsubmit = async e => {
  e.preventDefault();
  const email = $('lEmail').value.trim().toLowerCase(), senha = $('lSenha').value;
  if (!emailDaBee(email)) { $('lMsg').textContent = `Use seu e-mail ${DOMINIOS_TXT}.`; return; }
  $('lBtn').disabled = true; $('lMsg').textContent = 'Entrando…';
  const { error } = await sb.auth.signInWithPassword({ email, password: senha });
  $('lBtn').disabled = false;
  if (error) {
    $('lMsg').textContent = /invalid login credentials/i.test(error.message)
      ? 'E-mail ou senha incorretos. No primeiro acesso, use a senha inicial informada pelo gestor.'
      : 'Não foi possível entrar: ' + error.message;
    return;
  }
  senhaDoLogin = senha; $('lSenha').value = ''; $('lMsg').textContent = '';
  // o onAuthStateChange (SIGNED_IN) segue para iniciar()
};
$('btnSair').onclick = async () => { await sb.auth.signOut(); location.reload(); };

/** Tela de criar senha: obrigatória no primeiro acesso; voluntária pelo botão "Trocar senha". */
let trocaVoluntaria = false;
function mostrarTrocaSenha(session, voluntaria = false) {
  trocaVoluntaria = voluntaria;
  $('login').hidden = true; $('app').hidden = true; $('novaSenha').hidden = false;
  $('pwUser').value = session.user.email || '';
  $('pwTitulo').textContent = voluntaria ? 'Trocar senha' : 'Crie sua senha';
  $('pwTexto').textContent = voluntaria ? 'Escolha uma nova senha para entrar no Colmeia.' : 'Este é o seu primeiro acesso. Troque a senha inicial por uma senha só sua.';
  $('pwBtn').textContent = voluntaria ? 'Salvar nova senha' : 'Salvar senha e entrar';
  $('pwSair').textContent = voluntaria ? 'Cancelar' : 'Sair';
  $('pwSenha1').value = ''; $('pwSenha2').value = ''; $('pwMsg').textContent = '';
  $('pwSenha1').focus();
}
$('pwForm').onsubmit = async e => {
  e.preventDefault();
  const s1 = $('pwSenha1').value, s2 = $('pwSenha2').value;
  if (s1.length < 8) { $('pwMsg').textContent = 'A senha precisa ter pelo menos 8 caracteres.'; return; }
  if (s1 !== s2) { $('pwMsg').textContent = 'As duas senhas não são iguais.'; return; }
  if (senhaDoLogin && s1 === senhaDoLogin) { $('pwMsg').textContent = 'Escolha uma senha diferente da atual.'; return; }
  $('pwBtn').disabled = true; $('pwMsg').textContent = 'Salvando…';
  const { error } = await sb.auth.updateUser({ password: s1, data: { senha_trocada: true } });
  $('pwBtn').disabled = false;
  if (error) {
    $('pwMsg').textContent = /different from the old/i.test(error.message) ? 'Escolha uma senha diferente da atual.'
      : /weak|short|characters/i.test(error.message) ? 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.'
      : 'Não foi possível salvar a senha: ' + error.message;
    return;
  }
  senhaDoLogin = null; $('pwSenha1').value = ''; $('pwSenha2').value = '';
  const { data } = await sb.auth.getSession();
  $('novaSenha').hidden = true;
  if (trocaVoluntaria) { $('app').hidden = false; S.session = data.session; toast('Senha alterada'); }
  else iniciar(data.session);
};
$('pwSair').onclick = async () => {
  if (trocaVoluntaria) { $('novaSenha').hidden = true; $('app').hidden = false; return; }
  await sb.auth.signOut(); location.reload();
};
$('meBox').onclick = () => { if (S.session) mostrarTrocaSenha(S.session, true); };

/* ---------- shell ---------- */
const TABS = [['metas', 'Metas'], ['relatorio', 'Relatórios'], ['funil', 'Funil'], ['lista', 'Lojas'], ['tarefas', 'Tarefas'], ['gestao', 'Gestão']];
function renderTabs() {
  const vis = TABS.filter(t => t[0] !== 'gestao' || papelAtual() === 'gestor');
  $('tabs').innerHTML = vis.map(([k, n]) => `<button class="tab" data-tab="${k}" aria-current="${S.tab === k}">${n}</button>`).join('');
  $('bnav').innerHTML = vis.map(([k, n]) => `<button data-tab="${k}" aria-current="${S.tab === k}"><span class="hex"></span>${n}</button>`).join('');
}
document.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); } });

function renderMe() {
  const p = S.eu; const nome = p ? p.nome : (S.session && S.session.user.email) || '';
  $('meBox').innerHTML = `<span class="avatar">${esc((nome || '?').trim().charAt(0).toUpperCase())}</span><span class="nmtxt"></span>${p ? `<span class="role">${PAPEIS[p.papel]}</span>` : ''}`;
  $('meBox').title = 'Trocar senha'; $('meBox').style.cursor = 'pointer';
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

/* ---------- Relatórios ---------- */
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ST = { bom: ['good', 'Positivo'], estavel: ['', 'Estável'], atencao: ['hl', 'Atenção'], critico: ['warn', 'Crítico'] };
const stCls = st => st === 'bom' ? 'up' : st === 'critico' ? 'down' : st === 'atencao' ? 'att' : '';
const stChip = st => st ? `<span class="chip ${ST[st][0]}">${ST[st][1]}</span>` : `<span class="chip">Sem meta</span>`;
const sinal = (x, f = pctf) => x == null ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + f(Math.abs(x));
const pp = x => (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' p.p.';
const nf0 = x => nf(Math.round(x));

/** Lojas de cada praça do escopo. */
function lojasPorPraca(ps) {
  const porPraca = new Map(ps.map(p => [p.id, []]));
  for (const l of S.lojas.values()) { const a = porPraca.get(l.praca); if (a) a.push(l); }
  return porPraca;
}
/** Números por praça do escopo. */
function numerosDoEscopo(ps, porPraca) {
  const h = new Date();
  return new Map(ps.map(p => [p.id, numerosPraca(p, porPraca.get(p.id), h)]));
}
const avaliarPracas = (ps, nums, corte) => avaliar(somarNumeros(ps.map(p => nums.get(p.id))), corte);

/** Destaques e pontos críticos de uma unidade. peso = corridas em jogo, para ordenar o que mais importa. */
function pontosDe(u, a, mA, mC) {
  const bons = [], crit = [], ir = u.ir;
  const add = (lista, peso, txt) => lista.push({ ...u, peso, txt, ir });
  if (a.st.corridas === 'bom') add(bons, Math.max(a.proj, a.corridasMeta) - a.meta + 1, a.pct >= 1 ? `Meta de corridas já batida: ${pctf(a.pct)} (${nf(a.corridasMeta)} de ${nf(a.meta)}).` : `Projeção de ${pctf(a.projPct)} da meta de corridas: ${nf(a.proj - a.meta)} acima.`);
  if (a.st.corridas === 'critico') add(crit, a.meta - a.proj, `Projeção de ${pctf(a.projPct)} da meta de corridas. Precisa de ${nf(a.precisaDia)}/dia; está em ${nf0(a.ritmoMeta)}/dia.`);
  if (a.st.ritmo === 'bom') add(bons, (a.ritmo - a.ritmoAnt) * a.dm, `Ritmo ${pctf(a.varRitmo)} acima de ${mA}: ${nf0(a.ritmo)}/dia contra ${nf0(a.ritmoAnt)}/dia.`);
  if (a.st.ritmo === 'critico') add(crit, (a.ritmoAnt - a.ritmo) * a.dm, `Ritmo ${pctf(-a.varRitmo)} abaixo de ${mA}: ${nf0(a.ritmo)}/dia contra ${nf0(a.ritmoAnt)}/dia.`);
  const porEmp = a.empresas ? a.corridas / a.empresas : 0;
  if (a.st.empresas === 'bom') add(bons, (a.empresasMeta - a.metaEmpresas + 1) * porEmp, `Meta de empresas batida: ${nf(a.empresasMeta)} com entregas, de ${nf0(a.metaEmpresas)}.`);
  if (a.st.empresas === 'critico') add(crit, (a.metaEmpresas - a.empresasMeta) * porEmp, `${nf(a.empresasMeta)} empresas com entregas: ${pctf(a.empPct)} da meta de ${nf0(a.metaEmpresas)}.`);
  if (a.st.taxa === 'bom') add(bons, a.ped * (a.taxa - a.metaTaxa) + 1, `Taxa de sucesso de ${pct1(a.taxa)}, acima da meta de ${pct1(a.metaTaxa)}.`);
  if (a.st.taxa === 'critico') add(crit, a.ped * (a.metaTaxa - a.taxa), `Taxa de sucesso de ${pct1(a.taxa)} (meta ${pct1(a.metaTaxa)}): ${nf(a.cancelados)} pedidos cancelados no mês.`);
  else if (a.difTaxaAnt != null && a.difTaxaAnt <= -LIMITES.taxaVar) add(crit, a.ped * -a.difTaxaAnt, `Taxa de sucesso caiu ${pp(-a.difTaxaAnt)} em relação a ${mA} (${pct1(a.taxaAnt)} → ${pct1(a.taxa)}).`);
  if (a.st.taxa !== 'bom' && a.difTaxaAnt != null && a.difTaxaAnt >= LIMITES.taxaVar) add(bons, a.ped * a.difTaxaAnt, `Taxa de sucesso subiu ${pp(a.difTaxaAnt)} em relação a ${mA} (${pct1(a.taxaAnt)} → ${pct1(a.taxa)}).`);
  if (a.perdidas >= 3 && a.perdidasProp >= 30) add(crit, a.perdidasProp, `${nf(a.perdidas)} lojas entregaram em ${mA} e ainda não em ${mC} (${nf(a.corridasPerdidas)} corridas em ${mA}).`);
  return { bons, crit };
}

function tilesRel(a, mA, corte) {
  const dRitmo = a.varRitmo != null ? `<small class="${stCls(a.st.ritmo)}">${sinal(a.varRitmo)} no ritmo diário vs ${mA}</small>` : `<small>${mA} sem base para comparar</small>`;
  const tile = (st, tit, val, ...sub) => `<div class="tile ${st ? 'st-' + st : ''}"><span>${tit}</span><b>${val}</b>${sub.filter(Boolean).join('')}</div>`;
  return `<div class="tiles">
    ${tile(a.st.corridas, 'Corridas · projeção', a.projPct != null ? pctf(a.projPct) : '—', `<small>${a.meta ? `${nf(a.proj)} projetadas · meta ${nf(a.meta)}` : 'sem meta'}</small>`, a.precisaDia != null && a.st.corridas !== 'bom' ? `<small>precisa de ${nf(a.precisaDia)}/dia (hoje ${nf0(a.ritmoMeta)}/dia)</small>` : '')}
    ${tile(a.st.ritmo === 'estavel' ? null : a.st.ritmo, `Corridas até ${pad(corte.getDate())}/${pad(corte.getMonth() + 1)}`, nf(a.corridas), `<small>${mA} no mesmo período: ${nf(a.antProp)}</small>`, dRitmo)}
    ${tile(a.st.empresas, 'Empresas com entregas', nf(a.empresas), `<small>${a.metaEmpresas ? `${pctf(a.empPct)} da meta de ${nf0(a.metaEmpresas)}` : 'sem meta'}</small>`, `<small>${mA}: ${nf(a.empresasAnt)} no mês todo</small>`)}
    ${tile(a.st.taxa, 'Taxa de sucesso', pct1(a.taxa), `<small>${a.metaTaxa != null ? `meta ${pct1(a.metaTaxa)}` : 'sem meta'}${a.taxa == null ? ' · a base ainda não traz pedidos' : ''}</small>`, a.taxaAnt != null ? `<small class="${a.difTaxaAnt >= LIMITES.taxaVar ? 'up' : a.difTaxaAnt <= -LIMITES.taxaVar ? 'down' : ''}">${mA}: ${pct1(a.taxaAnt)}${a.difTaxaAnt != null ? ` (${sinal(a.difTaxaAnt, pp)})` : ''}</small>` : '')}
    ${tile(a.perdidas && a.perdidasProp >= 30 ? 'critico' : null, 'Lojas a recuperar', nf(a.perdidas), `<small>entregaram em ${mA}, ainda não neste mês</small>`, a.perdidas ? `<small>${nf(a.corridasPerdidas)} corridas em ${mA}</small>` : '')}
    ${tile(a.geral, 'Situação geral', a.geral ? ST[a.geral][1] : '—', `<small>${a.pracas} praça${a.pracas > 1 ? 's' : ''} · pior status entre os indicadores</small>`)}</div>`;
}

/** Um cartão por comercial/praça, com os pontos dele; os de maior peso (corridas em jogo) primeiro. */
function listaPontos(itens, vazio) {
  if (!itens.length) return `<p class="hint">${vazio}</p>`;
  const grupos = new Map();
  itens.forEach(x => { const k = x.ir || x.nome; if (!grupos.has(k)) grupos.set(k, { ...x, peso: 0, txts: [] }); const g = grupos.get(k); g.peso += x.peso; g.txts.push(x); });
  const lista = [...grupos.values()].sort((x, y) => y.peso - x.peso);
  lista.forEach(g => g.txts.sort((x, y) => y.peso - x.peso));
  const li = g => `<li><button ${g.ir}><div><b>${esc(g.nome)}</b>${g.sub ? ` <span class="hint">· ${esc(g.sub)}</span>` : ''}</div>${g.txts.map(x => `<span>${esc(x.txt)}</span>`).join('')}</button></li>`;
  const top = lista.slice(0, 6), resto = lista.slice(6);
  return `<ul class="ins">${top.map(li).join('')}</ul>${resto.length ? `<details><summary class="hint">Ver mais ${resto.length}</summary><ul class="ins">${resto.map(li).join('')}</ul></details>` : ''}`;
}

/** Tabela (computador) + cartões (celular) de unidades avaliadas. */
function tabelaRel(tit, sub, linhas, mA) {
  if (!linhas.length) return '';
  linhas.sort((x, y) => (y.a.projPct ?? -1) - (x.a.projPct ?? -1) || y.a.corridas - x.a.corridas);
  const emp = a => a.metaEmpresas ? `<span class="num ${stCls(a.st.empresas)}">${nf(a.empresasMeta)}</span><span class="hint"> / ${nf0(a.metaEmpresas)}</span>` : `<span class="num">${nf(a.empresas)}</span>`;
  const tx = a => a.taxa == null ? '<span class="hint">—</span>' : `<span class="num ${stCls(a.st.taxa)}">${pct1(a.taxa)}</span>${a.metaTaxa != null ? `<span class="hint"> / ${pct1(a.metaTaxa)}</span>` : ''}`;
  const rit = a => `<span class="num ${stCls(a.st.ritmo)}">${sinal(a.varRitmo)}</span>`;
  const meter = a => meterHTML({ meta: a.meta, pct: a.pct, projPct: a.projPct });
  const rows = linhas.map(({ nome, sub: s, a, ir }) => `<tr ${ir || 'class="nolink"'}><td><b>${esc(nome)}</b>${s ? `<div class="hint">${esc(s)}</div>` : ''}</td><td class="r num">${nf(a.corridas)}</td><td class="r num">${a.meta ? nf(a.meta) : '—'}</td><td>${meter(a)}</td><td class="r num ${stCls(a.st.corridas)}">${a.projPct != null ? pctf(a.projPct) : '—'}</td><td class="r num">${nf(a.antProp)}</td><td class="r">${rit(a)}</td><td>${emp(a)}</td><td>${tx(a)}</td><td class="r num">${a.difTaxaAnt != null ? sinal(a.difTaxaAnt, pp) : '—'}</td><td class="r num">${a.perdidas ? nf(a.perdidas) : '—'}</td><td>${stChip(a.geral)}</td></tr>`).join('');
  const cards = linhas.map(({ nome, sub: s, a, ir }) => `<${ir ? 'button' : 'div'} class="mcard" ${ir || ''}><div class="hd"><b>${esc(nome)}</b>${stChip(a.geral)}</div>${s ? `<span class="hint">${esc(s)}</span>` : ''}${a.meta ? meter(a) : ''}<div class="nums"><span>Projeção<b class="${stCls(a.st.corridas)}">${a.projPct != null ? pctf(a.projPct) : '—'}</b></span><span>Ritmo vs ${esc(mA.slice(0, 3))}.<b class="${stCls(a.st.ritmo)}">${sinal(a.varRitmo)}</b></span><span>Corridas<b>${nf(a.corridas)}</b></span><span>Empresas<b class="${stCls(a.st.empresas)}">${nf(a.empresasMeta || a.empresas)}${a.metaEmpresas ? `<small class="hint"> / ${nf0(a.metaEmpresas)}</small>` : ''}</b></span><span>Taxa<b class="${stCls(a.st.taxa)}">${pct1(a.taxa)}</b></span><span>A recuperar<b>${nf(a.perdidas)}</b></span></div></${ir ? 'button' : 'div'}>`).join('');
  return `<section class="mgroup">${tit ? `<h2>${esc(tit)} ${sub ? `<small>${esc(sub)}</small>` : ''}</h2>` : ''}
    <div class="tbl-wrap"><table class="rel-tbl"><thead><tr><th></th><th class="r">Corridas</th><th class="r">Meta</th><th>Atingido</th><th class="r">Projeção</th><th class="r" title="Corridas do mês anterior no mesmo número de dias (proporcional)">${esc(mA)} prop.</th><th class="r" title="Ritmo diário deste mês contra o do mês anterior">Ritmo</th><th title="Empresas com entregas: realizado / meta">Empresas</th><th title="Entregas finalizadas ÷ pedidos: realizado / meta">Taxa</th><th class="r" title="Taxa deste mês menos a do mês anterior">Taxa vs ${esc(mA.slice(0, 3))}.</th><th class="r" title="Lojas que entregaram no mês anterior e ainda não neste">A recuperar</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="mcards">${cards}</div></section>`;
}

/* Composição da carteira por faixa de volume (Inativos, 1 a 50 … +1000) */
const pctComp = (v, tot) => tot ? (v / tot * 100).toLocaleString('pt-BR', { maximumFractionDigits: v / tot < 0.1 ? 1 : 0 }) + '%' : '—';
function barraComp(c, chave, rotulo) {
  const tot = c[chave]; const desc = FAIXAS_VOLUME.map(f => `${f.nome} ${pctComp(c.faixas[f.id][chave], tot)}`).join(', ');
  return `<div class="cbar" role="img" aria-label="${esc(rotulo + ': ' + desc)}">${FAIXAS_VOLUME.map(f => { const v = c.faixas[f.id][chave]; return v && tot ? `<i style="width:${v / tot * 100}%;background:${f.c}" title="${esc(f.nome)}: ${pctComp(v, tot)} (${nf(v)})"></i>` : ''; }).join('')}</div>`;
}
function composicaoHTML({ ps, porPraca, corte, mA, mC, regU, unidades }) {
  const base = S.compBase; const h = new Date();
  const comp = list => composicaoCarteira(list.flatMap(p => porPraca.get(p.id) || []), { base, corte, hoje: h });
  const total = comp(ps); const ant = base === 'projecao' ? composicaoCarteira(ps.flatMap(p => porPraca.get(p.id) || []), { base: 'anterior', hoje: h }) : null;
  const dt = `${pad(corte.getDate())}/${pad(corte.getMonth() + 1)}`;
  const bases = [['atual', `Mês atual (até ${dt})`], ['projecao', `Projeção de ${mC}`], ['anterior', `${mA[0].toUpperCase() + mA.slice(1)} (fechado)`]];
  const seg = `<div class="seg" role="group" aria-label="Base da composição">${bases.map(([k, n]) => `<button data-comp="${k}" aria-pressed="${base === k}">${n}</button>`).join('')}</div>`;
  const expl = { atual: `Faixa pelas entregas de ${mC} até ${dt}, como no funil. No meio do mês, as lojas aparecem em faixas menores do que vão fechar.`,
    projecao: `Faixa pelas entregas projetadas para o mês inteiro (entregas até ${dt} ÷ ${corte.getDate()} dias × ${new Date(corte.getFullYear(), corte.getMonth() + 1, 0).getDate()}). A variação compara com ${mA} fechado.`,
    anterior: `Faixa pelas entregas de ${mA}, mês fechado. Lojas que começaram em ${mC} ficam de fora.` }[base];
  const leg = `<div class="comp-leg">${FAIXAS_VOLUME.map(f => { const x = total.faixas[f.id]; const d = ant && ant.lojas ? x.lojas / (total.lojas || 1) - ant.faixas[f.id].lojas / ant.lojas : null;
    const bom = f.id === 'inativo' && d < 0, ruim = f.id === 'inativo' && d > 0; // só Inativos tem direção clara
    return `<div style="--c:${f.c}"><span>${esc(f.nome)}</span><b>${pctComp(x.lojas, total.lojas)}</b><small>${nf(x.lojas)} loja${x.lojas === 1 ? '' : 's'} · ${pctComp(x.corridas, total.corridas)} das corridas</small>${d != null && Math.abs(d) >= 0.0005 ? `<small class="${bom ? 'up' : ruim ? 'down' : ''}">${sinal(d, pp)} vs ${esc(mA)}</small>` : ''}</div>`; }).join('')}</div>`;
  const barras = `<div class="comp-bars"><div><span class="hint">Lojas (${nf(total.lojas)})</span>${barraComp(total, 'lojas', 'Lojas')}</div><div><span class="hint">Corridas (${nf(total.corridas)})</span>${barraComp(total, 'corridas', 'Corridas')}</div></div>`;
  const tabela = (tit, sub, us) => {
    if (!us.length) return '';
    const linhas = us.map(u => ({ ...u, c: comp(u.list) })).filter(u => u.c.lojas).sort((x, y) => y.c.lojas - x.c.lojas);
    const cel = (c, id) => { const v = c.faixas[id].lojas; return `<b class="num">${pctComp(v, c.lojas)}</b><span class="hint"> ${nf(v)}</span>`; };
    const rows = linhas.map(u => `<tr ${u.ir || 'class="nolink"'}><td><b>${esc(u.nome)}</b>${u.sub ? `<div class="hint">${esc(u.sub)}</div>` : ''}</td><td class="r num">${nf(u.c.lojas)}</td><td>${barraComp(u.c, 'lojas', u.nome)}</td>${FAIXAS_VOLUME.map(f => `<td class="r">${cel(u.c, f.id)}</td>`).join('')}</tr>`).join('');
    const cards = linhas.map(u => `<${u.ir ? 'button' : 'div'} class="mcard" ${u.ir || ''}><div class="hd"><b>${esc(u.nome)}</b><span class="hint">${nf(u.c.lojas)} lojas</span></div>${u.sub ? `<span class="hint">${esc(u.sub)}</span>` : ''}${barraComp(u.c, 'lojas', u.nome)}<div class="nums">${FAIXAS_VOLUME.map(f => `<span><i class="dotc" style="background:${f.c}"></i>${esc(f.nome)}<b>${pctComp(u.c.faixas[f.id].lojas, u.c.lojas)}<small class="hint"> ${nf(u.c.faixas[f.id].lojas)}</small></b></span>`).join('')}</div></${u.ir ? 'button' : 'div'}>`).join('');
    return `<h3 class="comp-h3">${esc(tit)} ${sub ? `<small>${esc(sub)}</small>` : ''}</h3>
      <div class="tbl-wrap"><table class="rel-tbl comp-tbl"><thead><tr><th></th><th class="r">Lojas</th><th>Composição</th>${FAIXAS_VOLUME.map(f => `<th class="r"><i class="dotc" style="background:${f.c}"></i>${esc(f.nome)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="mcards">${cards}</div>`;
  };
  const porPraca_ = unidades.length && unidades[0].ir && unidades[0].ir.startsWith('data-praca');
  return `<section class="mgroup comp"><h2>Composição da carteira <small>% das lojas em cada faixa de entregas</small></h2>
    ${seg}<p class="gsum">${esc(expl)} Carteira = lojas da base e prospecções que já entregaram; lojas em Ativação entram pela faixa do volume.</p>
    ${leg}${barras}
    ${regU.length > 1 ? tabela('Por regional', '', regU) : ''}
    ${tabela(porPraca_ ? 'Por praça' : 'Por comercial', porPraca_ ? '' : 'toque para ver o relatório do comercial', unidades)}</section>`;
}

function quedasHTML(ps, corte, mA, mostraCom) {
  const ids = new Set(ps.map(p => p.id));
  const q = lojasEmQueda([...S.lojas.values()].filter(l => ids.has(l.praca)), corte, new Date());
  if (!q.length) return '';
  const top = q.slice(0, 15); const D = `${pad(corte.getDate())}/${pad(corte.getMonth() + 1)}`;
  const com = l => { const p = S.pracas[l.praca]; return p && p.comercialId ? nomePessoa(p.comercialId) : '—'; };
  const rows = top.map(x => `<tr data-loja="${esc(x.loja.id)}"><td><b>${esc(x.loja.nome)}</b></td><td>${esc(nomePraca(x.loja.praca))}</td>${mostraCom ? `<td>${esc(com(x.loja))}</td>` : ''}<td class="r num">${nf(x.ant)}</td><td class="r num">${nf(x.esperado)}</td><td class="r num">${nf(x.atual)}</td><td class="r num down">−${pctf(x.queda)}</td></tr>`).join('');
  const cards = top.map(x => `<button class="mcard" data-loja="${esc(x.loja.id)}"><div class="hd"><b>${esc(x.loja.nome)}</b><span class="chip warn">−${pctf(x.queda)}</span></div><span class="hint">${esc(nomePraca(x.loja.praca))}${mostraCom ? ' · ' + esc(com(x.loja)) : ''}</span><div class="nums"><span>${esc(mA)}<b>${nf(x.ant)}</b></span><span>Esperado até ${D}<b>${nf(x.esperado)}</b></span><span>Realizado<b class="down">${nf(x.atual)}</b></span></div></button>`).join('');
  return `<section class="mgroup"><h2>Lojas em queda <small>${q.length} loja${q.length > 1 ? 's' : ''} abaixo da metade do esperado${q.length > top.length ? ` · as ${top.length} com maior perda` : ''}</small></h2>
    <div class="gsum">Esperado = entregas de ${mA} proporcionais aos dias com dados. Toque na loja para registrar o contato.</div>
    <div class="tbl-wrap"><table class="rel-tbl rel-q"><thead><tr><th>Loja</th><th>Praça</th>${mostraCom ? '<th>Comercial</th>' : ''}<th class="r">${esc(mA)}</th><th class="r">Esperado até ${D}</th><th class="r">Realizado</th><th class="r">Queda</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="mcards">${cards}</div></section>`;
}

function viewRelatorio() {
  const ps = pracasFiltradas(); const papel = papelAtual();
  if (!ps.length) return `<div class="empty"><h2>Nenhuma praça neste filtro</h2></div>`;
  const corte = dataDeCorte(ps, new Date());
  if (!corte) return `<div class="empty"><span class="hex"></span><h2>O mês acabou de virar</h2><p>O relatório volta com a primeira base do mês, amanhã cedo.</p></div>`;
  const mC = MESES[corte.getMonth()], mA = MESES[(corte.getMonth() + 11) % 12];
  const porPraca = lojasPorPraca(ps); const nums = numerosDoEscopo(ps, porPraca); const av = list => avaliarPracas(list, nums, corte);
  const total = av(ps);
  const umComercial = papel === 'comercial' || Boolean(S.fCom || S.fPraca) || new Set(ps.map(p => p.comercialId)).size === 1;
  // unidades: praças quando o escopo é de um comercial só; senão, comerciais (e regionais para o gestor)
  const pracasU = ps.map(p => ({ nome: p.rotulo, sub: papel !== 'comercial' && p.comercialId ? nomePessoa(p.comercialId) : '', list: [p], a: av([p]), ir: `data-praca="${esc(p.id)}"` }));
  const porCom = new Map(); ps.forEach(p => { const k = p.comercialId || '_'; if (!porCom.has(k)) porCom.set(k, []); porCom.get(k).push(p); });
  const comU = [...porCom].map(([k, list]) => ({ nome: k === '_' ? 'Sem comercial' : nomePessoa(k), sub: list.length > 2 ? `${list.length} praças` : list.map(p => p.rotulo).join(', '), list, a: av(list), ir: k === '_' ? '' : `data-rcom="${esc(k)}"` }));
  const regU = papel === 'gestor' && !umComercial ? [...Object.values(S.regionais).sort((a, b) => byPt(a.nome, b.nome)).map(r => ({ r, list: ps.filter(p => p.regional === r.id) })), { r: null, list: ps.filter(p => !p.regional || !S.regionais[p.regional]) }]
    .filter(x => x.list.length).map(({ r, list }) => ({ nome: r ? r.nome : 'Sem regional', sub: r ? (r.supervisorId ? nomePessoa(r.supervisorId) : 'Sem supervisor') : 'sem supervisor nem comercial', list, a: av(list), ir: '' })) : [];
  const unidades = umComercial ? pracasU : comU.filter(u => u.ir);
  const bons = [], crit = [];
  unidades.forEach(u => { const r = pontosDe(u, u.a, mA, mC); bons.push(...r.bons); crit.push(...r.crit); });
  // títulos do escopo
  const quem = S.fPraca ? nomePraca(S.fPraca) : S.fCom === '_sem' ? 'Praças sem comercial' : S.fCom ? nomePessoa(S.fCom)
    : papel === 'gestor' ? 'Time todo' : papel === 'supervisor' ? (S.regionais[pessoaAtual().regional] || {}).nome || 'Minha regional' : 'Meu resultado';
  const voltar = (S.fCom || S.fPraca) && papel !== 'comercial' ? ` <button class="linkish" id="relVoltar">ver ${papel === 'gestor' ? 'o time todo' : 'a regional toda'}</button>` : '';
  const periodo = `<p class="rel-per">${mC[0].toUpperCase() + mC.slice(1)} até ${pad(corte.getDate())}/${pad(corte.getMonth() + 1)} · ${total.D} de ${total.dm} dias. A comparação com ${mA} é proporcional: o mesmo número de dias, no ritmo diário de ${mA}.</p>`;
  const paineis = `<div class="panels rel-pan">
    <div class="panel pos"><h2>Destaques</h2><p>Indicadores positivos${umComercial ? ' por praça' : ' por comercial'}.</p>${listaPontos(bons, 'Nenhum indicador acima da meta ou do mês anterior por enquanto.')}</div>
    <div class="panel neg"><h2>Pontos críticos</h2><p>Precisam de atenção do supervisor e do comercial. Os de maior impacto em corridas aparecem primeiro.</p>${listaPontos(crit, 'Nenhum indicador crítico no momento.')}</div></div>`;
  let tabelas = '';
  if (regU.length > 1) tabelas += tabelaRel('Por regional', '', regU, mA);
  if (!umComercial) tabelas += tabelaRel('Por comercial', 'toque para ver o relatório do comercial', comU, mA);
  tabelas += umComercial ? tabelaRel('Por praça', 'toque para abrir o funil da praça', pracasU, mA)
    : `<details class="rel-det"><summary>Por praça <small>${pracasU.length} praças · toque para abrir o funil da praça</small></summary>${tabelaRel('', '', pracasU, mA)}</details>`;
  return `<section class="mgroup rel-head"><h2>${esc(quem)}${voltar}</h2>${periodo}</section>${tilesRel(total, mA, corte)}${paineis}${tabelas}${composicaoHTML({ ps, porPraca, corte, mA, mC, regU, unidades: umComercial ? pracasU : comU })}${quedasHTML(ps, corte, mA, papel !== 'comercial' && !umComercial)}
    <p class="hint" style="padding-bottom:24px">Projeção = corridas ÷ dias com dados × dias do mês. Ritmo = corridas por dia neste mês contra ${mA} (corridas de ${mA} ÷ ${total.dmAnt}); só é comparado com pelo menos ${LIMITES.baseRitmo} corridas em ${mA}. Corridas: positivo com projeção a partir de 100% da meta, crítico abaixo de ${pctf(LIMITES.proj[1])}. Empresas: crítico abaixo de ${pctf(LIMITES.empresas[1])} da meta; o número cresce ao longo do mês, por isso a comparação com ${mA} é com o mês todo. Taxa de sucesso: crítico mais de ${pp(LIMITES.taxaPp)} abaixo da meta. Situação = o pior status entre os indicadores.</p>`;
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
// papel 'comercial' também lista os supervisores: um supervisor pode tocar uma praça (ex.: Campina Grande).
// A pessoa já escolhida aparece mesmo se estiver inativa, para o select não fingir "sem comercial".
function optPessoas(papel, sel, vazio) {
  const papeis = papel === 'comercial' ? ['comercial', 'supervisor'] : [papel];
  const ps = Object.values(S.pessoas).filter(p => papeis.includes(p.papel) && (p.ativo || p.id === sel))
    .sort((a, b) => papeis.indexOf(a.papel) - papeis.indexOf(b.papel) || byPt(a.nome, b.nome));
  const rot = p => p.nome + (!p.ativo ? ' (inativo)' : p.papel !== papel ? ` (${p.papel})` : '');
  return `<option value="">${vazio}</option>` + ps.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(rot(p))}</option>`).join('');
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
      <div class="acts">${p.id !== (S.eu && S.eu.id) ? `<button class="btn sm" data-ver="${esc(p.id)}">Ver como</button>${p.email && p.ativo ? `<button class="btn sm" data-reset="${esc(p.id)}" title="Volta a senha para a senha inicial; no próximo acesso a pessoa cria uma nova">Redefinir senha</button>` : ''}<button class="btn sm ${p.ativo ? 'danger' : ''}" data-ativo="${esc(p.id)}">${p.ativo ? 'Desativar' : 'Reativar'}</button>` : ''}</div></div>`;
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
    try {
      ok(await sb.from('pessoas').insert({ id, nome, email, papel: $('nsPapel').value, regional_id: $('nsReg').value || null }));
      if (email) ok(await sb.rpc('liberar_acesso', { p_pessoa: id }));
      toast(email ? `Pessoa adicionada. Login liberado com a senha inicial.` : 'Pessoa adicionada'); recarregarLogo();
    } catch (err) { toast(erroMsg(err)); }
  };
  panels.addEventListener('change', async ev => {
    const t = ev.target; if (!t.dataset.email) return;
    const email = t.value.trim().toLowerCase() || null;
    if (email && !emailDaBee(email)) { toast(`Use um e-mail ${DOMINIOS_TXT}.`); return; }
    try {
      ok(await sb.from('pessoas').update({ email }).eq('id', t.dataset.email)); S.pessoas[t.dataset.email].email = email;
      if (email) ok(await sb.rpc('liberar_acesso', { p_pessoa: t.dataset.email }));
      toast(email ? `Acesso liberado para ${email} com a senha inicial` : 'Acesso removido'); renderPessoas();
    } catch (err) { toast(/duplicate|unique/i.test(err.message) ? 'Esse e-mail já está em outra pessoa.' : erroMsg(err)); }
  });
  panels.addEventListener('click', async ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.ver) { S.viewAs = b.dataset.ver; S.fCom = ''; S.fPraca = ''; S.fase = null; S.tab = S.pessoas[S.viewAs].papel === 'comercial' ? 'funil' : 'metas'; render(); window.scrollTo(0, 0); }
    else if (b.dataset.reset) {
      const p = S.pessoas[b.dataset.reset];
      if (!confirm(`Voltar a senha de ${p.nome} para a senha inicial? No próximo acesso, ${p.nome.split(' ')[0]} vai criar uma senha nova.`)) return;
      try { ok(await sb.rpc('liberar_acesso', { p_pessoa: p.id })); toast(`Senha de ${p.nome} redefinida para a senha inicial`); } catch (err) { toast(erroMsg(err)); }
    }
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
  $('toolbar').hidden = false; const painel = S.tab === 'metas' || S.tab === 'relatorio';
  $('counters').hidden = gest || painel; $('bnav').hidden = false; $('fab').hidden = gest || painel;
  const titles = { metas: 'Metas do mês', relatorio: 'Relatórios', funil: 'Funil', lista: 'Lojas', tarefas: 'Tarefas', gestao: 'Gestão' };
  $('viewTitle').textContent = titles[S.tab];
  $('fCidade').hidden = gest; $('fBusca').hidden = gest || painel; $('btnNova').hidden = gest || painel;
  if (!pracasEscopo().length && !gest) { $('view').innerHTML = `<div class="empty"><span class="hex"></span><h2>Nenhuma praça atribuída</h2><p>Peça ao gestor comercial para definir suas praças.</p></div>`; return; }
  $('view').innerHTML = { metas: viewMetas, relatorio: viewRelatorio, funil: viewFunil, lista: viewLista, tarefas: viewTarefas, gestao: viewGestao }[S.tab]();
  if (gest) { renderEstrutura(); renderPessoas(); wireGestao(); }
  const lf = $('limpaFase'); if (lf) lf.onclick = () => { S.fase = null; render(); };
  const rv = $('relVoltar'); if (rv) rv.onclick = () => { S.fCom = ''; S.fPraca = ''; render(); window.scrollTo(0, 0); };
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
  const cb = e.target.closest('[data-comp]'); if (cb) { S.compBase = cb.dataset.comp; renderView(); return; }
  const rc = e.target.closest('[data-rcom]'); if (rc) { S.fCom = rc.dataset.rcom; S.fPraca = ''; render(); window.scrollTo(0, 0); return; }
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
  if (session && S.iniciado) return;
  S.session = session;
  if (!session) { S.iniciado = false; mostrarLogin(); return; }
  if (precisaTrocarSenha(session)) { mostrarTrocaSenha(session); return; }
  S.iniciado = true;
  $('login').hidden = true; $('novaSenha').hidden = true; $('app').hidden = false;
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
