// Configuração pública do app. A "anon key" do Supabase é feita para ficar no navegador:
// quem protege os dados são as regras de acesso (RLS) do banco. NUNCA coloque aqui a service_role key.
// Supabase → Project Settings → API.
export const CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabaseAnonKey: 'COLE_AQUI_A_ANON_KEY',
  dominioEmail: 'bee.com.br',
};
