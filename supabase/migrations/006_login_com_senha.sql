-- =====================================================================
-- Colmeia CRM · 006 · Login com e-mail e senha (sem envio de e-mail)
--
-- * As contas são criadas pelo gestor (ou pelo SQL local), nunca por cadastro aberto.
--   No Supabase, desligue "Allow new users to sign up" (Authentication → Sign In / Providers).
-- * Toda conta nova, ou redefinida, recebe a SENHA INICIAL e a marca senha_trocada = false.
--   No primeiro acesso, o app obriga a pessoa a criar a própria senha.
-- * A senha inicial NÃO fica neste arquivo (o repositório é público): ela é gravada em
--   config_privada pelo arquivo local supabase/local/acessos-equipe.sql.
-- Idempotente.
-- =====================================================================

-- Configuração que nenhum usuário do app lê (RLS ligada e nenhuma política)
create table if not exists public.config_privada (
  chave text primary key,
  valor text not null
);
alter table public.config_privada enable row level security;
revoke all on public.config_privada from anon, authenticated;

-- Cria a conta de login da pessoa (ou redefine a senha dela) com a senha inicial.
-- Pode ser chamada pelo gestor (aba Gestão) ou no SQL Editor do Supabase.
create or replace function public.liberar_acesso(p_pessoa text) returns text
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  v_email text; v_senha text; v_uid uuid;
begin
  -- No app (PostgREST) só o gestor pode; no SQL Editor (sessão direta) é liberado
  if session_user = 'authenticator' and coalesce(auth.role(), '') <> 'service_role' and not public.eh_gestor() then
    raise exception 'Somente o gestor pode liberar ou redefinir acessos';
  end if;
  select lower(email) into v_email from public.pessoas where id = p_pessoa and ativo;
  if v_email is null then raise exception 'Pessoa sem e-mail ou inativa: %', p_pessoa; end if;
  select valor into v_senha from public.config_privada where chave = 'senha_inicial';
  if v_senha is null then raise exception 'Senha inicial não configurada (rode supabase/local/acessos-equipe.sql)'; end if;

  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
            crypt(v_senha, gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{"senha_trocada":false}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text,
            jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
    return 'criado';
  end if;

  update auth.users set
    encrypted_password = crypt(v_senha, gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"senha_trocada":false}',
    updated_at = now()
  where id = v_uid;
  return 'redefinido';
end $$;

revoke all on function public.liberar_acesso(text) from public, anon;
grant execute on function public.liberar_acesso(text) to authenticated;
