// Controlador principal da aplicação

// --- Navegação por histórico (botão/gesto "voltar" do celular) ---
// A ideia é simples: enquanto o usuário estiver em qualquer página que não
// seja o Início, existe UMA entrada extra no histórico do navegador. Ao
// pressionar/arrastar "voltar", essa entrada é consumida e a gente cai no
// Início, sem fechar o app. Se o usuário já está no Início, não existe
// entrada extra pra consumir, então o próximo "voltar" sai do app
// normalmente (comportamento padrão esperado pelo usuário).
let navegacaoViaHistorico = false;
let historicoTemEntradaExtra = false;

document.addEventListener('DOMContentLoaded', async () => {
  // Marca a entrada inicial do histórico como sendo a página Início.
  history.replaceState({ page: 'dashboard' }, '', window.location.href);

  window.addEventListener('popstate', (event) => {
    // Evita reentrância: essa navegação já veio do histórico, não precisa
    // empilhar/registrar nada de novo.
    navegacaoViaHistorico = true;
    historicoTemEntradaExtra = false;
    const pagina = (event.state && event.state.page) || 'dashboard';
    activatePageGlobal(pagina);
    navegacaoViaHistorico = false;
  });

  const splash = document.getElementById('splash-screen');
  const inicioSplash = Date.now();

  // Tempo mínimo pra splash não "piscar" em conexões rápidas, e máximo de
  // segurança pra não deixar o usuário preso na splash se a rede estiver
  // muito lenta (o carregamento do dashboard costuma terminar bem antes disso).
  const TEMPO_MINIMO_SPLASH = 800;
  const TEMPO_MAXIMO_SPLASH = 5000;
  let splashEscondida = false;

  function esconderSplash() {
    if (splashEscondida) return;
    splashEscondida = true;
    const decorrido = Date.now() - inicioSplash;
    const espera = Math.max(0, TEMPO_MINIMO_SPLASH - decorrido);
    setTimeout(() => {
      document.body.classList.add('app-loaded');
      setTimeout(() => { if (splash) splash.remove(); }, 500);
    }, espera);
  }

  // Rede muito lenta ou travada: esconde mesmo assim depois do tempo máximo.
  setTimeout(esconderSplash, TEMPO_MAXIMO_SPLASH);

  // Portão de entrada: sem login, só aparece a tela de entrar/criar conta.
  const emRecuperacao = /type=recovery/.test(location.hash);
  const usuario = await Auth.init();
  if (!usuario) {
    // Perfil guardado deste aparelho (se houver) deixa a tela de login com a cara do app.
    try { await Perfil.carregar(); } catch (e) { /* ignora */ }
    document.body.classList.add('app-loaded');
    if (splash) splash.remove();
    Auth.mostrarTela(emRecuperacao ? 'nova-senha' : 'entrar');
    return;
  }

  // Nome, ícone, manifest do usuário (não bloqueia o carregamento dos dados)
  Perfil.initTela(); // liga os botões do card de perfil já no início
  Perfil.carregar().then(() => Perfil.initTela()).catch(() => {});

  // Inicializa módulos básicos (independente da splash)
  initNavegacao();
  initTema();

  // Lembrete de leitura (só se o usuário tiver ativado em Configurações e
  // concedido permissão de notificação)
  if (typeof Lembretes !== 'undefined') {
    Lembretes.verificarLembreteLeitura().catch(() => {});
  }

  // Carrega a página inicial ativa (dashboard) e só então esconde a splash —
  // assim ela some assim que os dados essenciais já estiverem na tela, em vez
  // de sempre esperar um tempo fixo (mais rápido em conexões boas).
  const activePage = document.querySelector('.page.active');
  let carregamentoInicial = Promise.resolve();
  if (activePage && activePage.id === 'page-dashboard') {
    if (typeof Dashboard !== 'undefined' && Dashboard.init) {
      carregamentoInicial = Promise.resolve(Dashboard.init());
    }
  }
  carregamentoInicial.catch(() => {}).finally(esconderSplash);

  // Atalhos de página (ex.: ?page=leitura)
  const urlParams = new URLSearchParams(window.location.search);
  const shortcutPage = urlParams.get('page');
  if (shortcutPage) {
    setTimeout(() => activatePageGlobal(shortcutPage), 400);
  }
});

// Função pública para ativar uma página (usada por atalhos e navegação)
function activatePageGlobal(pageName) {
  // Gerencia a entrada extra do histórico (ver comentário acima), exceto
  // quando esta chamada já veio de um evento popstate (botão/gesto voltar).
  if (!navegacaoViaHistorico) {
    if (pageName === 'dashboard') {
      // Voltando ao Início "andando pelo app" (ex.: clicou no ícone Início):
      // remove a entrada extra, se houver, pra não deixar lixo no histórico.
      if (historicoTemEntradaExtra) {
        history.replaceState({ page: 'dashboard' }, '', window.location.href);
        historicoTemEntradaExtra = false;
      }
    } else if (!historicoTemEntradaExtra) {
      // Primeira navegação pra fora do Início: empilha UMA entrada.
      history.pushState({ page: pageName }, '', window.location.href);
      historicoTemEntradaExtra = true;
    } else {
      // Já estava em outra página que não o Início: só atualiza qual é,
      // sem empilhar mais uma (assim "voltar" sempre leva direto ao
      // Início, não pra página anterior).
      history.replaceState({ page: pageName }, '', window.location.href);
    }
  }

  // Atualiza links ativos
  const navItems = document.querySelectorAll('.nav-link, .bottom-nav .nav-item');
  navItems.forEach(link => {
    link.classList.remove('active');
    if (link.dataset.page === pageName) {
      link.classList.add('active');
    }
  });

  // Mostra/oculta páginas
  const pages = document.querySelectorAll('.page');
  pages.forEach(page => {
    page.classList.remove('active');
    if (page.id === `page-${pageName}`) {
      page.classList.add('active');
    }
  });

  // Botão flutuante de adicionar livro: só faz sentido na página Biblioteca
  const fabAdicionarLivro = document.getElementById('btn-fab-adicionar-livro');
  if (fabAdicionarLivro) {
    fabAdicionarLivro.classList.toggle('visivel', pageName === 'biblioteca');
  }

  // Sempre abre a página nova no topo, em vez de manter a posição de
  // rolagem que a página anterior deixou (senão a nova página pode abrir
  // no meio/final dependendo de onde o usuário parou na página anterior).
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  // Inicializa módulos específicos
  switch (pageName) {
    case 'dashboard':
      if (typeof Dashboard !== 'undefined' && Dashboard.init) Dashboard.init();
      break;
    case 'leitura':
      if (typeof Leitura !== 'undefined' && Leitura.init) Leitura.init();
      break;
    case 'leitor':
      if (typeof Leitor !== 'undefined' && Leitor.init) Leitor.init();
      break;
    case 'adicionar':
      if (typeof Livros !== 'undefined' && Livros.init) Livros.init();
      break;
    case 'biblioteca':
      if (typeof Biblioteca !== 'undefined' && Biblioteca.init) Biblioteca.init();
      break;
    case 'estatisticas':
      if (typeof Estatisticas !== 'undefined' && Estatisticas.init) Estatisticas.init();
      break;
    case 'metas':
      if (typeof Metas !== 'undefined' && Metas.init) Metas.init();
      break;
    case 'bingo':
      if (typeof Bingo !== 'undefined' && Bingo.init) Bingo.init();
      break;
    case 'jornada':
      if (typeof Jornada !== 'undefined' && Jornada.init) Jornada.init();
      break;
    case 'anotacoes':
      if (typeof Anotacoes !== 'undefined' && Anotacoes.init) Anotacoes.init();
      break;
    case 'desejos':
      if (typeof DesejosEmprestimos !== 'undefined' && DesejosEmprestimos.init) DesejosEmprestimos.init();
      break;
    case 'exportar':
      if (typeof Exportar !== 'undefined' && Exportar.init) Exportar.init();
      break;
    case 'configuracoes':
      if (typeof Perfil !== 'undefined') { try { Perfil.initTela(); } catch (e) { console.error(e); } }
      if (typeof Configuracoes !== 'undefined' && Configuracoes.init) Configuracoes.init();
      break;
  }
  // Fecha o offcanvas mobile se estiver aberto
  try {
    const offcanvasEl = document.getElementById('mobileMenu');
    if (offcanvasEl) {
      const offcanvas = bootstrap.Offcanvas.getInstance(offcanvasEl);
      if (offcanvas) offcanvas.hide();
    }
  } catch (e) { /* ignora */ }

  // ÍCONES NOS TÍTULOS DAS PÁGINAS (USANDO FONT AWESOME)
  // "dashboard" fica de fora: o h1 do Início agora é o título "Calixteca"
  // (estilo marca, com subtítulo), não um rótulo de página como as demais.
  const iconesPaginas = {
    biblioteca: 'fa-books',
    adicionar: 'fa-plus-circle',
    leitura: 'fa-clock',
    estatisticas: 'fa-chart-bar',
    metas: 'fa-bullseye',
    bingo: 'fa-dice',
    jornada: 'fa-compass',
    anotacoes: 'fa-sticky-note',
    desejos: 'fa-heart',
    exportar: 'fa-download',
    configuracoes: 'fa-cog'
  };

  const h1 = document.querySelector(`#page-${pageName} h1`);
  if (h1 && iconesPaginas[pageName]) {
    if (!h1.querySelector('.fa')) {
      h1.innerHTML = `<i class="fas ${iconesPaginas[pageName]} me-2"></i>${h1.textContent}`;
    }
  }
}  

// Gerencia a navegação entre páginas
function initNavegacao() {
  const navItems = document.querySelectorAll('.nav-link, .bottom-nav .nav-item');

  navItems.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const pageName = link.dataset.page;
      if (pageName) activatePageGlobal(pageName);
    });
  });
}

// Modo escuro / claro
function initTema() {
  const body = document.body;
  const toggleDesktop = document.getElementById('theme-toggle');
  const toggleMobileOffcanvas = document.getElementById('theme-toggle-mobile');
  const toggleMobileTop = document.getElementById('theme-toggle-mobile-top');

  const saved = Util.getPreference('darkMode', false);
  if (saved) body.classList.add('dark-mode');

  // Se o usuário desligou a cor automática por horário, aplica a cor
  // manual salva já no carregamento (senão TemaSazonal.js sobrescreveria).
  const corAutomatica = Util.getPreference('corAutomatica', true);
  if (!corAutomatica) {
    const corSalva = Util.getPreference('corPrimaria', null);
    if (corSalva) document.documentElement.style.setProperty('--primary', corSalva);
  }

  function atualizarBotao(btn) {
    if (!btn) return;
    const isDark = body.classList.contains('dark-mode');
    const somenteIcone = btn.id === 'theme-toggle-mobile-top';
    btn.innerHTML = somenteIcone
      ? `<i class="fas ${isDark ? 'fa-sun' : 'fa-moon'}"></i>`
      : (isDark
        ? '<i class="fas fa-sun"></i> <span class="ms-1">Modo claro</span>'
        : '<i class="fas fa-moon"></i> <span class="ms-1">Modo escuro</span>');
    btn.title = isDark ? 'Modo claro' : 'Modo escuro';
  }
  function atualizarTodos() {
    [toggleDesktop, toggleMobileOffcanvas, toggleMobileTop].forEach(atualizarBotao);
  }

  atualizarTodos();

  [toggleDesktop, toggleMobileOffcanvas, toggleMobileTop].forEach(btn => {
    if (btn) {
      btn.addEventListener('click', () => {
        body.classList.toggle('dark-mode');
        Util.setPreference('darkMode', body.classList.contains('dark-mode'));
        atualizarTodos();
        window.dispatchEvent(new CustomEvent('calixteca:tema-alterado', {
          detail: { escuro: body.classList.contains('dark-mode') }
        }));
      });
    }
  });
}
