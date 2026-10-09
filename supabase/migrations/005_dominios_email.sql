-- =====================================================================
-- Colmeia CRM · 005 · Domínio de e-mail da equipe
--
-- A equipe usa e-mails @beedelivery.com.br (o @bee.com.br da migração 001 não existe).
-- O gatilho que barra cadastros de fora passa a aceitar só @beedelivery.com.br.
-- Mantenha a lista igual a CONFIG.dominiosEmail em assets/config.js. Idempotente.
-- =====================================================================

create or replace function public.bloquear_cadastro_externo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if split_part(lower(new.email), '@', 2) not in ('beedelivery.com.br') then
    raise exception 'Acesso restrito a e-mails @beedelivery.com.br';
  end if;
  if not exists (select 1 from public.pessoas where lower(email) = lower(new.email) and ativo) then
    raise exception 'E-mail não cadastrado na equipe comercial. Fale com o gestor.';
  end if;
  return new;
end $$;
