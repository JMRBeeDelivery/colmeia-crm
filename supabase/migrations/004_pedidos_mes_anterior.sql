-- =====================================================================
-- Colmeia CRM · 004 · Pedidos do mês anterior
--
-- Para sinalizar o volume de cancelamentos das lojas inativas (inclusive as que
-- só tiveram pedidos cancelados), a loja guarda também os pedidos do mês anterior.
-- Cancelados = pedidos − entregas, em cada mês. Idempotente.
-- =====================================================================

alter table public.lojas add column if not exists pedidos_mes_anterior integer
  check (pedidos_mes_anterior is null or pedidos_mes_anterior >= 0);

-- Comercial/supervisor também não alteram pedidos_mes_anterior
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
    new.entrou_na_base := old.entrou_na_base;
    new.pedidos_mes := old.pedidos_mes;
    new.pedidos_mes_anterior := old.pedidos_mes_anterior;
  end if;
  return new;
end $$;

-- Mesma regra da 003, gravando também pedidos_mes_anterior
create or replace function public.importar_base(p_linhas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_id uuid; v_cnpj text; v_nova boolean; v_entregou boolean; v_pe date;
  v_dia date := current_date - 1;   -- a base traz os dados até ontem
  n_novos int := 0; n_atu int := 0; n_conv int := 0; n_ativ int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.eh_gestor() then
    raise exception 'Somente o gestor pode importar a base';
  end if;
  for r in select * from jsonb_array_elements(p_linhas) loop
    v_id := null; v_nova := false;
    v_entregou := coalesce((r->>'entregas_mes')::int, 0) > 0 or coalesce((r->>'entregas_mes_anterior')::int, 0) > 0;

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
        n_conv := n_conv + 1; v_nova := true;
        insert into crm_notas (loja_id, tipo, texto, autor_nome)
        values (v_id, 'sistema', 'Loja encontrada na base diária (código ' || (r->>'codigo') || '). Saiu da prospecção.', 'Colmeia');
      else
        v_nova := exists (select 1 from lojas where praca_id = r->>'praca_id' and origem = 'base' and entrou_na_base < current_date);
      end if;
    end if;

    v_pe := coalesce((r->>'primeira_entrega')::date, case when v_nova and v_entregou then v_dia end);

    if v_id is null then
      insert into lojas (codigo, praca_id, nome, cnpj, cidade, bairro, endereco, responsavel, telefone, origem,
                         data_cadastro, primeira_entrega, ultima_entrega, entregas_mes, entregas_mes_anterior, mes_referencia,
                         entrou_na_base, pedidos_mes, pedidos_mes_anterior)
      values (r->>'codigo', r->>'praca_id', r->>'nome', nullif(r->>'cnpj', ''), nullif(r->>'cidade', ''), nullif(r->>'bairro', ''),
              nullif(r->>'endereco', ''), nullif(r->>'responsavel', ''), nullif(r->>'telefone', ''), 'base',
              coalesce((r->>'data_cadastro')::date, current_date), v_pe, (r->>'ultima_entrega')::date,
              coalesce((r->>'entregas_mes')::int, 0), coalesce((r->>'entregas_mes_anterior')::int, 0),
              coalesce(r->>'mes_referencia', to_char(current_date, 'YYYY-MM')), current_date,
              (r->>'pedidos_mes')::int, (r->>'pedidos_mes_anterior')::int);
      n_novos := n_novos + 1;
      if v_nova and v_pe > current_date - 30 then n_ativ := n_ativ + 1; end if;
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
        primeira_entrega      = coalesce((r->>'primeira_entrega')::date, primeira_entrega, v_pe),
        ultima_entrega        = coalesce((r->>'ultima_entrega')::date, ultima_entrega),
        entregas_mes          = coalesce((r->>'entregas_mes')::int, entregas_mes),
        entregas_mes_anterior = coalesce((r->>'entregas_mes_anterior')::int, entregas_mes_anterior),
        mes_referencia        = coalesce(r->>'mes_referencia', mes_referencia),
        entrou_na_base        = coalesce(entrou_na_base, current_date),
        -- pedidos são dos meses da linha: sem o dado, voltam a vazio para não misturar meses
        pedidos_mes           = (r->>'pedidos_mes')::int,
        pedidos_mes_anterior  = (r->>'pedidos_mes_anterior')::int
      where id = v_id;
      if v_nova and v_pe > current_date - 30 then n_ativ := n_ativ + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('total', jsonb_array_length(p_linhas), 'novos', n_novos, 'atualizados', n_atu,
                            'convertidos', n_conv, 'em_ativacao', n_ativ);
end $$;

grant execute on function public.importar_base(jsonb) to authenticated;
