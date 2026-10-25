/**
 * Cliente Supabase único do app (compartilhado por api.js, auth.js e perfil.js).
 * A chave "publishable" pode ficar no front-end: quem protege os dados são as
 * regras de acesso (RLS) do banco, que só deixam cada usuário ver as próprias linhas.
 */
// Guarda, ANTES do Supabase mexer no endereço, se esta visita veio do link de "redefinir senha"
// (o Supabase apaga essas informações do endereço logo ao ler a sessão).
window.__RECUPERACAO__ = /type=recovery/.test(location.hash);
window.__ERRO_LINK__ = /error_code=|error=access_denied/.test(location.hash);

const SupabaseApp = (() => {
  const URL = 'https://smcedfqgfbvuhmpypngf.supabase.co';
  const KEY = 'sb_publishable_qs4dUhSUvCvi3fnMmnCQSQ_dmkG4UxV';
  const client = window.supabase.createClient(URL, KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  return { URL, KEY, client };
})();
