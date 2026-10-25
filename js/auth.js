/**
 * Autenticação por e-mail e senha (Supabase Auth).
 *
 * Como funciona:
 *  - Auth.init() descobre se já existe uma sessão salva e devolve o usuário (ou null).
 *  - Sem usuário, o app mostra a tela de login (#auth-overlay) e não carrega dados.
 *  - Depois de entrar/cadastrar, a página é recarregada de propósito: assim o cache
 *    local (IndexedDB/localStorage), que é separado por usuário, já abre no lugar certo.
 *  - O id do usuário fica em localStorage ('leituras_uid') para que db.js e util.js
 *    saibam, de forma síncrona, qual é o namespace local logo no carregamento.
 */
const Auth = (() => {
  const UID_KEY = 'leituras_uid';
  const EMAIL_KEY = 'leituras_email';
  const sb = SupabaseApp.client;
  let usuario = null;
  let telaConfigurada = false;
  let modo = 'entrar'; // 'entrar' | 'cadastrar' | 'recuperar' | 'nova-senha'

  // ---------- estado ----------
  function guardarUsuario(u) {
    usuario = u;
    try {
      localStorage.setItem(UID_KEY, u.id);
      if (u.email) localStorage.setItem(EMAIL_KEY, u.email);
    } catch (e) { /* armazenamento bloqueado: segue sem cache local */ }
  }

  function limparLocal() {
    try {
      localStorage.removeItem(UID_KEY);
      localStorage.removeItem(EMAIL_KEY);
    } catch (e) { /* ignora */ }
    usuario = null;
  }

  async function init() {
    configurarTela();
    registrarEventosDeSessao();

    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session && data.session.user) {
        const u = data.session.user;
        const uidAnterior = localStorage.getItem(UID_KEY);
        guardarUsuario(u);
        // Outra conta entrou (ex.: em outra aba) depois de o cache local já ter
        // sido aberto para o usuário anterior: recarrega pra reabrir no lugar certo.
        // Só recarrega se o armazenamento local funciona (senão ficaria em loop).
        // Veio do link de redefinir senha: não entra no app nem recarrega; mostra a tela de nova senha.
        if (window.__RECUPERACAO__) return null;
        const armazenamentoOk = localStorage.getItem(UID_KEY) === u.id;
        if (armazenamentoOk && (!uidAnterior || uidAnterior !== u.id)) { location.reload(); return null; }
        return usuario;
      }
    } catch (e) { /* cai para o modo offline abaixo */ }

    // Sem rede e já usou este aparelho antes: deixa abrir com os dados em cache.
    const uidSalvo = localStorage.getItem(UID_KEY);
    if (!navigator.onLine && uidSalvo) {
      usuario = { id: uidSalvo, email: localStorage.getItem(EMAIL_KEY) || '', offline: true };
      return usuario;
    }
    return null;
  }

  function registrarEventosDeSessao() {
    sb.auth.onAuthStateChange((evento, sessao) => {
      if (evento === 'PASSWORD_RECOVERY') {
        mostrarTela('nova-senha');
      } else if (evento === 'SIGNED_OUT') {
        // Saiu em outra aba (ou a sessão expirou de vez): volta para o login.
        if (usuario && !usuario.offline) { limparLocal(); location.reload(); }
      } else if (evento === 'SIGNED_IN' && sessao && sessao.user) {
        if (window.__RECUPERACAO__) return;
        const uidAnterior = localStorage.getItem(UID_KEY);
        if (uidAnterior && uidAnterior !== sessao.user.id) {
          guardarUsuario(sessao.user);
          location.reload();
        }
      }
    });
  }

  // ---------- ações ----------
  function traduzirErro(msg) {
    const m = String(msg || '').toLowerCase();
    if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
    if (m.includes('user already registered') || m.includes('already been registered')) return 'Este e-mail já tem cadastro. Entre ou recupere a senha.';
    if (m.includes('email not confirmed')) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
    if (m.includes('at least 6 characters') || m.includes('weak password')) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    if (m.includes('invalid email') || m.includes('unable to validate email')) return 'E-mail inválido.';
    if (m.includes('failed to fetch') || m.includes('network')) return 'Sem conexão com a internet.';
    if (m.includes('same password') || m.includes('different from the old')) return 'A nova senha precisa ser diferente da anterior.';
    return 'Não foi possível concluir. Tente novamente.';
  }

  async function entrar(email, senha) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
    if (error) throw new Error(traduzirErro(error.message));
    guardarUsuario(data.user);
    location.reload();
  }

  async function cadastrar(email, senha) {
    const { data, error } = await sb.auth.signUp({
      email, password: senha,
      options: { emailRedirectTo: location.origin + location.pathname }
    });
    if (error) throw new Error(traduzirErro(error.message));
    if (data.session && data.user) {
      guardarUsuario(data.user);
      location.reload();
      return { confirmar: false };
    }
    // Com confirmação de e-mail ligada no Supabase, ainda não há sessão.
    // (E-mail já cadastrado também volta sem sessão, de propósito, por segurança.)
    return { confirmar: true };
  }

  async function recuperarSenha(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname
    });
    if (error) throw new Error(traduzirErro(error.message));
  }

  async function definirNovaSenha(senha) {
    const { error } = await sb.auth.updateUser({ password: senha });
    if (error) throw new Error(traduzirErro(error.message));
  }

  async function sair() {
    try { await sb.auth.signOut(); } catch (e) { /* mesmo sem rede, limpa localmente */ }
    limparLocal();
    location.reload();
  }

  // ---------- tela de login ----------
  function el(id) { return document.getElementById(id); }

  function mostrarMensagem(texto, tipo) {
    const caixa = el('auth-msg');
    if (!caixa) return;
    caixa.className = 'auth-msg ' + (tipo || 'erro');
    caixa.textContent = texto || '';
    caixa.hidden = !texto;
  }

  function mostrarTela(novoModo) {
    modo = novoModo || 'entrar';
    const overlay = el('auth-overlay');
    if (!overlay) return;
    overlay.hidden = false;
    document.body.classList.add('auth-aberta');
    atualizarModo();
  }

  function esconderTela() {
    const overlay = el('auth-overlay');
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('auth-aberta');
  }

  function atualizarModo() {
    const titulos = {
      entrar: ['Entrar', 'Acesse sua biblioteca e seu diário de leitura.'],
      cadastrar: ['Criar conta', 'Cada pessoa tem seus próprios livros e estatísticas.'],
      recuperar: ['Recuperar senha', 'Enviaremos um link para você criar uma nova senha.'],
      'nova-senha': ['Nova senha', 'Escolha a nova senha da sua conta.']
    };
    const [titulo, sub] = titulos[modo];
    el('auth-titulo').textContent = titulo;
    el('auth-sub').textContent = sub;

    el('auth-campo-email').hidden = modo === 'nova-senha';
    el('auth-campo-senha').hidden = modo === 'recuperar';
    el('auth-campo-senha2').hidden = !(modo === 'cadastrar' || modo === 'nova-senha');
    el('auth-link-esqueci').hidden = modo !== 'entrar';
    el('auth-rodape-entrar').hidden = modo !== 'entrar';
    el('auth-rodape-cadastrar').hidden = modo === 'entrar';

    el('auth-senha').autocomplete = modo === 'entrar' ? 'current-password' : 'new-password';
    el('auth-email').required = modo !== 'nova-senha';
    el('auth-senha').required = modo !== 'recuperar';

    const botoes = { entrar: 'Entrar', cadastrar: 'Criar conta', recuperar: 'Enviar link', 'nova-senha': 'Salvar nova senha' };
    el('auth-enviar').textContent = botoes[modo];
    mostrarMensagem('');
  }

  function configurarTela() {
    if (telaConfigurada || !el('auth-overlay')) return;
    telaConfigurada = true;

    el('auth-ir-cadastrar').addEventListener('click', (e) => { e.preventDefault(); modo = 'cadastrar'; atualizarModo(); });
    el('auth-ir-entrar').addEventListener('click', (e) => { e.preventDefault(); modo = 'entrar'; atualizarModo(); });
    el('auth-link-esqueci').addEventListener('click', (e) => { e.preventDefault(); modo = 'recuperar'; atualizarModo(); });

    el('auth-ver-senha').addEventListener('click', () => {
      const campo = el('auth-senha');
      const mostrar = campo.type === 'password';
      campo.type = mostrar ? 'text' : 'password';
      el('auth-senha2').type = campo.type;
      el('auth-ver-senha').setAttribute('aria-pressed', String(mostrar));
      el('auth-ver-senha').innerHTML = `<i class="fas ${mostrar ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
    });

    el('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = el('auth-email').value.trim();
      const senha = el('auth-senha').value;
      const senha2 = el('auth-senha2').value;
      const botao = el('auth-enviar');

      if ((modo === 'cadastrar' || modo === 'nova-senha') && senha !== senha2) {
        mostrarMensagem('As senhas não conferem.');
        return;
      }
      if ((modo === 'cadastrar' || modo === 'nova-senha') && senha.length < 6) {
        mostrarMensagem('A senha precisa ter pelo menos 6 caracteres.');
        return;
      }

      botao.disabled = true;
      mostrarMensagem('');
      try {
        if (modo === 'entrar') {
          await entrar(email, senha);
        } else if (modo === 'cadastrar') {
          const r = await cadastrar(email, senha);
          if (r.confirmar) {
            modo = 'entrar';
            atualizarModo();
            mostrarMensagem('Se o e-mail for novo, enviamos um link de confirmação. Confirme e depois entre aqui.', 'ok');
          }
        } else if (modo === 'recuperar') {
          await recuperarSenha(email);
          modo = 'entrar';
          atualizarModo();
          mostrarMensagem('Se este e-mail tiver conta, o link de recuperação foi enviado.', 'ok');
        } else if (modo === 'nova-senha') {
          await definirNovaSenha(senha);
          // Limpa o fragmento do link de recuperação e entra no app.
          history.replaceState(null, '', location.pathname);
          location.reload();
        }
      } catch (erro) {
        mostrarMensagem(erro.message);
      } finally {
        botao.disabled = false;
      }
    });
  }

  return {
    init, entrar, cadastrar, sair, recuperarSenha,
    mostrarTela, esconderTela, mostrarMensagem,
    usuario: () => usuario,
    id: () => (usuario && usuario.id) || localStorage.getItem(UID_KEY),
    email: () => (usuario && usuario.email) || localStorage.getItem(EMAIL_KEY) || ''
  };
})();
