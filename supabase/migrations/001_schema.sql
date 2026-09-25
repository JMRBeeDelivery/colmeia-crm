-- =====================================================================
-- Colmeia CRM · schema do banco (Supabase / Postgres)
-- Rode este arquivo no SQL Editor do Supabase (ou `supabase db push`).
-- Depois rode supabase/seed.sql para carregar regionais, praças e pessoas.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.regionais (
  id             text primary key,
  nome           text not null,
  supervisor_id  text,
  criado_em      timestamptz not null default now()
);

create table if not exists public.pessoas (
  id           text primary key,                 -- slug do nome, ex.: juan-marinho
  nome         text not null,
  email        text unique,                      -- e-mail @bee.com.br usado no login
  papel        text not null check (papel in ('gestor','supervisor','comercial')),
  regional_id  text references public.regionais(id) on delete set null,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);
create unique index if not exists pessoas_email_lower on public.pessoas (lower(email));

alter table public.regionais
  drop constraint if exists regionais_supervisor_fk,
  add constraint regionais_supervisor_fk foreign key (supervisor_id) references public.pessoas(id) on delete set null;

create table if not exists public.pracas (
  id             text primary key,               -- slug, ex.: natal-rn
  nome           text not null,                  -- ex.: Natal, Belém–Ananindeua
  uf             char(2) not null,
  rotulo         text not null,                  -- ex.: Natal/RN
  aliases        text[] not null default '{}',   -- outros nomes de cidade que caem nesta praça
  regional_id    text references public.regionais(id) on delete set null,
  comercial_id   text references public.pessoas(id) on delete set null,
  meta           integer check (meta is null or meta >= 0),          -- corridas no mês; null = sem meta
  produzido      integer not null default 0,
  produzido_ate  date,
  atualizado_em  timestamptz not null default now()
);

create table if not exists public.lojas (
  id                     uuid primary key default gen_random_uuid(),
  codigo                 text unique,            -- código na base externa; null = prospecção
  praca_id               text not null references public.pracas(id),
  nome                   text not null,
  cnpj                   text,
  cidade                 text,
  bairro                 text,
  endereco               text,
  responsavel            text,
  telefone               text,
  origem                 text not null default 'base' check (origem in ('base','prospeccao')),
  etapa                  text check (etapa in ('novo','contato','negociando','aguardando','perdido')),
  data_cadastro          date default current_date,
  primeira_entrega       date,
  ultima_entrega         date,
  entregas_mes           integer not null default 0,
  entregas_mes_anterior  integer not null default 0,
  mes_referencia         char(7),                -- AAAA-MM a que entregas_mes se refere
  criado_por             text references public.pessoas(id) on delete set null,
  atualizado_em          timestamptz not null default now()
);
create index if not exists lojas_praca on public.lojas (praca_id);
create index if not exists lojas_cnpj_digitos on public.lojas (regexp_replace(coalesce(cnpj,''), '\D', '', 'g'));

create table if not exists public.crm_notas (
  id          uuid primary key default gen_random_uuid(),
  loja_id     uuid not null references public.lojas(id) on delete cascade,
  tipo        text not null check (tipo in ('ligacao','visita','whatsapp','nota','sistema')),
  texto       text not null,
  autor_id    text references public.pessoas(id) on delete set null,
  autor_nome  text,
  criado_em   timestamptz not null default now()
);
create index if not exists crm_notas_loja on public.crm_notas (loja_id, criado_em desc);

create table if not exists public.crm_tarefas (
  id          uuid primary key default gen_random_uuid(),
  loja_id     uuid not null references public.lojas(id) on delete cascade,
  texto       text not null,
  vence       date,
  feita       boolean not null default false,
  feita_em    timestamptz,
  autor_id    text references public.pessoas(id) on delete set null,
  criado_em   timestamptz not null default now()
);
create index if not exists crm_tarefas_loja on public.crm_tarefas (loja_id);

create table if not exists public.sync_log (
  id           bigint generated always as identity primary key,
  executado_em timestamptz not null default now(),
  fonte        text,
  total        integer,
  novos        integer,
  atualizados  integer,
  convertidos  integer,
  sem_praca    integer,
  erros        integer,
  detalhes     jsonb
);

-- atualizado_em automático
create or replace function public.tocar_atualizado_em() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists lojas_tocar on public.lojas;
create trigger lojas_tocar before update on public.lojas for each row execute function public.tocar_atualizado_em();
drop trigger if exists pracas_tocar on public.pracas;
create trigger pracas_tocar before update on public.pracas for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------
-- Quem é o usuário logado (funções usadas nas regras de acesso)
-- security definer: leem pessoas/pracas sem esbarrar nas próprias regras.
-- ---------------------------------------------------------------------
create or replace function public.email_logado() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.minha_pessoa_id() returns text
language sql stable security definer set search_path = public as $$
  select id from pessoas where lower(email) = public.email_logado() and ativo limit 1
$$;

create or replace function public.meu_papel() returns text
language sql stable security definer set search_path = public as $$
  select papel from pessoas where lower(email) = public.email_logado() and ativo limit 1
$$;

create or replace function public.minha_regional_id() returns text
language sql stable security definer set search_path = public as $$
  select regional_id from pessoas where lower(email) = public.email_logado() and ativo limit 1
$$;

create or replace function public.eh_gestor() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.meu_papel() = 'gestor', false)
$$;

create or replace function public.praca_visivel(p_praca text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from pessoas me
    join pracas pr on pr.id = p_praca
    where lower(me.email) = public.email_logado() and me.ativo
      and (
        me.papel = 'gestor'
        or (me.papel = 'supervisor' and pr.regional_id is not null and pr.regional_id = me.regional_id)
        or (me.papel = 'comercial'  and pr.comercial_id = me.id)
      )
  )
$$;

create or replace function public.loja_visivel(p_loja uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.praca_visivel(praca_id) from lojas where id = p_loja), false)
$$;

-- ---------------------------------------------------------------------
-- Só pessoas cadastradas (e com e-mail @bee.com.br) podem criar conta
-- ---------------------------------------------------------------------
create or replace function public.bloquear_cadastro_externo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) not like '%@bee.com.br' then
    raise exception 'Acesso restrito a e-mails @bee.com.br';
  end if;
  if not exists (select 1 from public.pessoas where lower(email) = lower(new.email) and ativo) then
    raise exception 'E-mail não cadastrado na equipe comercial. Fale com o gestor.';
  end if;
  return new;
end $$;
drop trigger if exists bloquear_cadastro_externo on auth.users;
create trigger bloquear_cadastro_externo before insert on auth.users
  for each row execute function public.bloquear_cadastro_externo();

-- ---------------------------------------------------------------------
-- Regras de acesso (Row Level Security)
--   gestor     → tudo
--   supervisor → praças da sua regional
--   comercial  → praças em que é o comercial responsável
-- A chave service_role (usada só no sync do GitHub Actions) ignora RLS.
-- ---------------------------------------------------------------------
alter table public.regionais   enable row level security;
alter table public.pessoas     enable row level security;
alter table public.pracas      enable row level security;
alter table public.lojas       enable row level security;
alter table public.crm_notas   enable row level security;
alter table public.crm_tarefas enable row level security;
alter table public.sync_log    enable row level security;

-- regionais: qualquer pessoa da equipe lê; só gestor altera
drop policy if exists regionais_ler on public.regionais;
create policy regionais_ler on public.regionais for select to authenticated using (public.meu_papel() is not null);
drop policy if exists regionais_gestor on public.regionais;
create policy regionais_gestor on public.regionais for all to authenticated using (public.eh_gestor()) with check (public.eh_gestor());

-- pessoas: gestor vê todos; supervisor vê a própria regional; comercial vê a si mesmo
drop policy if exists pessoas_ler on public.pessoas;
create policy pessoas_ler on public.pessoas for select to authenticated using (
  public.eh_gestor()
  or id = public.minha_pessoa_id()
  or (public.meu_papel() = 'supervisor' and regional_id = public.minha_regional_id())
  or id in (select supervisor_id from public.regionais where id = public.minha_regional_id())
);
drop policy if exists pessoas_gestor on public.pessoas;
create policy pessoas_gestor on public.pessoas for all to authenticated using (public.eh_gestor()) with check (public.eh_gestor());

-- praças: lê as visíveis; só gestor altera (metas, responsáveis)
drop policy if exists pracas_ler on public.pracas;
create policy pracas_ler on public.pracas for select to authenticated using (public.praca_visivel(id));
drop policy if exists pracas_gestor on public.pracas;
create policy pracas_gestor on public.pracas for all to authenticated using (public.eh_gestor()) with check (public.eh_gestor());

-- lojas: lê e edita as da sua praça; comercial só cria prospecções; só gestor apaga
drop policy if exists lojas_ler on public.lojas;
create policy lojas_ler on public.lojas for select to authenticated using (public.praca_visivel(praca_id));
drop policy if exists lojas_criar on public.lojas;
create policy lojas_criar on public.lojas for insert to authenticated with check (
  public.praca_visivel(praca_id) and (public.eh_gestor() or (origem = 'prospeccao' and codigo is null))
);
drop policy if exists lojas_editar on public.lojas;
create policy lojas_editar on public.lojas for update to authenticated
  using (public.praca_visivel(praca_id)) with check (public.praca_visivel(praca_id));
drop policy if exists lojas_apagar on public.lojas;
create policy lojas_apagar on public.lojas for delete to authenticated using (public.eh_gestor());

-- Comercial/supervisor não alteram os números que vêm da base
create or replace function public.proteger_campos_da_base() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'authenticated' and not public.eh_gestor() then
    new.codigo := old.codigo;
    new.praca_id := old.praca_id;
    new.origem := old.origem;
    new.primeira_entrega := old.primeira_entrega;
    new.ultima_entrega := old.ultima_entrega;
    new.entregas_mes := old.entregas_mes;
    new.entregas_mes_anterior := old.entregas_mes_anterior;
    new.mes_referencia := old.mes_referencia;
  end if;
  return new;
end $$;
drop trigger if exists lojas_proteger on public.lojas;
create trigger lojas_proteger before update on public.lojas for each row execute function public.proteger_campos_da_base();

-- notas: lê/cria nas lojas visíveis, sempre em nome próprio; só gestor apaga
drop policy if exists notas_ler on public.crm_notas;
create policy notas_ler on public.crm_notas for select to authenticated using (public.loja_visivel(loja_id));
drop policy if exists notas_criar on public.crm_notas;
create policy notas_criar on public.crm_notas for insert to authenticated
  with check (public.loja_visivel(loja_id) and autor_id = public.minha_pessoa_id());
drop policy if exists notas_apagar on public.crm_notas;
create policy notas_apagar on public.crm_notas for delete to authenticated using (public.eh_gestor());

-- tarefas: lê/cria/conclui nas lojas visíveis
drop policy if exists tarefas_ler on public.crm_tarefas;
create policy tarefas_ler on public.crm_tarefas for select to authenticated using (public.loja_visivel(loja_id));
drop policy if exists tarefas_criar on public.crm_tarefas;
create policy tarefas_criar on public.crm_tarefas for insert to authenticated
  with check (public.loja_visivel(loja_id) and autor_id = public.minha_pessoa_id());
drop policy if exists tarefas_editar on public.crm_tarefas;
create policy tarefas_editar on public.crm_tarefas for update to authenticated
  using (public.loja_visivel(loja_id)) with check (public.loja_visivel(loja_id));
drop policy if exists tarefas_apagar on public.crm_tarefas;
create policy tarefas_apagar on public.crm_tarefas for delete to authenticated
  using (public.eh_gestor() or autor_id = public.minha_pessoa_id());

-- sync_log: qualquer pessoa da equipe lê; só o sync (service_role) ou gestor grava
drop policy if exists sync_ler on public.sync_log;
create policy sync_ler on public.sync_log for select to authenticated using (public.meu_papel() is not null);
drop policy if exists sync_gestor on public.sync_log;
create policy sync_gestor on public.sync_log for insert to authenticated with check (public.eh_gestor());

-- permissões básicas para o papel authenticated (RLS decide as linhas)
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.minha_pessoa_id(), public.meu_papel(), public.eh_gestor(), public.minha_regional_id(),
  public.praca_visivel(text), public.loja_visivel(uuid), public.email_logado() to authenticated;

-- ---------------------------------------------------------------------
-- Importação da base diária (usada pelo sync do GitHub Actions e pela
-- importação manual do gestor). Recebe as linhas já com praca_id resolvido.
-- Campos vazios não apagam o que já existe (ex.: telefone editado pelo comercial).
-- ---------------------------------------------------------------------
create or replace function public.importar_base(p_linhas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_id uuid; v_cnpj text;
  n_novos int := 0; n_atu int := 0; n_conv int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.eh_gestor() then
    raise exception 'Somente o gestor pode importar a base';
  end if;
  for r in select * from jsonb_array_elements(p_linhas) loop
    v_id := null;
    select id into v_id from lojas where codigo = r->>'codigo';
    if v_id is not null then
      n_atu := n_atu + 1;
    else
      v_cnpj := regexp_replace(coalesce(r->>'cnpj', ''), '\D', '', 'g');
      if v_cnpj <> '' then
        select id into v_id from lojas
         where codigo is null and regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = v_cnpj
         limit 1;
      end if;
      if v_id is not null then
        n_conv := n_conv + 1;
        insert into crm_notas (loja_id, tipo, texto, autor_nome)
        values (v_id, 'sistema', 'Loja encontrada na base diária (código ' || (r->>'codigo') || '). Saiu da prospecção.', 'Colmeia');
      end if;
    end if;

    if v_id is null then
      insert into lojas (codigo, praca_id, nome, cnpj, cidade, bairro, endereco, responsavel, telefone, origem,
                         data_cadastro, primeira_entrega, ultima_entrega, entregas_mes, entregas_mes_anterior, mes_referencia)
      values (r->>'codigo', r->>'praca_id', r->>'nome', nullif(r->>'cnpj', ''), nullif(r->>'cidade', ''), nullif(r->>'bairro', ''),
              nullif(r->>'endereco', ''), nullif(r->>'responsavel', ''), nullif(r->>'telefone', ''), 'base',
              coalesce((r->>'data_cadastro')::date, current_date), (r->>'primeira_entrega')::date, (r->>'ultima_entrega')::date,
              coalesce((r->>'entregas_mes')::int, 0), coalesce((r->>'entregas_mes_anterior')::int, 0),
              coalesce(r->>'mes_referencia', to_char(current_date, 'YYYY-MM')));
      n_novos := n_novos + 1;
    else
      update lojas set
        codigo                = r->>'codigo',
        praca_id              = coalesce(nullif(r->>'praca_id', ''), praca_id),
        nome                  = coalesce(nullif(r->>'nome', ''), nome),
        cnpj                  = coalesce(nullif(r->>'cnpj', ''), cnpj),
        cidade                = coalesce(nullif(r->>'cidade', ''), cidade),
        bairro                = coalesce(nullif(r->>'bairro', ''), bairro),
        endereco              = coalesce(nullif(r->>'endereco', ''), endereco),
        responsavel           = coalesce(nullif(r->>'responsavel', ''), responsavel),
        telefone              = coalesce(nullif(r->>'telefone', ''), telefone),
        origem                = 'base',
        data_cadastro         = coalesce((r->>'data_cadastro')::date, data_cadastro),
        primeira_entrega      = coalesce((r->>'primeira_entrega')::date, primeira_entrega),
        ultima_entrega        = coalesce((r->>'ultima_entrega')::date, ultima_entrega),
        entregas_mes          = coalesce((r->>'entregas_mes')::int, entregas_mes),
        entregas_mes_anterior = coalesce((r->>'entregas_mes_anterior')::int, entregas_mes_anterior),
        mes_referencia        = coalesce(r->>'mes_referencia', mes_referencia)
      where id = v_id;
    end if;
  end loop;
  return jsonb_build_object('total', jsonb_array_length(p_linhas), 'novos', n_novos, 'atualizados', n_atu, 'convertidos', n_conv);
end $$;

-- Produzido de cada praça = soma das entregas do mês das lojas da base.
-- Só altera praças que têm lojas vindas da base no mês informado.
create or replace function public.recalcular_produzido(p_ate date default current_date - 1) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.eh_gestor() then
    raise exception 'Somente o gestor pode recalcular o produzido';
  end if;
  update pracas p set produzido = s.total, produzido_ate = p_ate
  from (select praca_id, sum(entregas_mes)::int total from lojas
         where origem = 'base' and mes_referencia = to_char(p_ate, 'YYYY-MM') group by praca_id) s
  where p.id = s.praca_id;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.importar_base(jsonb), public.recalcular_produzido(date) to authenticated;

-- Atualização ao vivo (opcional): publica as tabelas no Realtime do Supabase
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.lojas, public.crm_notas, public.crm_tarefas, public.pracas;
    exception when duplicate_object then null; end;
  end if;
end $$;
