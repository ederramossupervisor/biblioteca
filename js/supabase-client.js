/**
 * Cliente Supabase único do app (compartilhado por api.js, auth.js e perfil.js).
 * A chave "publishable" pode ficar no front-end: quem protege os dados são as
 * regras de acesso (RLS) do banco, que só deixam cada usuário ver as próprias linhas.
 */
const SupabaseApp = (() => {
  const URL = 'https://smcedfqgfbvuhmpypngf.supabase.co';
  const KEY = 'sb_publishable_qs4dUhSUvCvi3fnMmnCQSQ_dmkG4UxV';
  const client = window.supabase.createClient(URL, KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  return { URL, KEY, client };
})();
