const Leitor = (() => {
  // Estado do Leitor
  let tipoArquivo = null; // 'epub' | 'pdf' | 'docx'
  let book = null;        // Instância EPUB
  let rendition = null;   // Instância Rendition EPUB
  let pdfDoc = null;      // Instância PDF.js
  let pdfNumPage = 1;     // Página atual do PDF

  // Informações do arquivo/livro aberto
  let currentBookInfo = { id: null, title: '', author: '', bookData: null };

  // Estado do Cronômetro
  let cronometroAtivo = false;
  let inicioCronometro = null;
  let tempoAcumulado = 0;
  let animFrameId = null;
  let horaInicioSessao = null;
  let paginaInicialCronometro = 1;

  // Variáveis de Controle
  let timeoutSincronizacao = null;
  let modalAssociacaoInstancia = null;
  let timeoutBarrasLeitor = null;

  // ===== Grifos (highlights) em memória para o livro atualmente aberto =====
  let highlightsAtuais = []; // [{cfi, text, color, data}] (epub) ou [{tipo:'pdf', id, pagina, texto, rects, cor, data}] (pdf)
  let pdfPaginaWrapperAtual = null;
  let pdfViewportScaleAtual = 1;

  // ===== Controle de swipe (gestos) =====
  let swipeInicioX = null;
  let swipeInicioY = null;
  let swipeInicioTempo = null;

  // ===== Busca dentro do documento (PDF) =====
  let buscaResultados = [];   // [{pagina, ordemNaPagina}] — um item por ocorrência, na ordem do documento
  let buscaIndiceAtual = -1;  // índice atual dentro de buscaResultados
  let buscaTermoAtual = '';
  let buscaToken = 0;         // usado para descartar buscas antigas se o usuário digitar de novo antes de terminar

  // ===== Zoom manual do PDF (multiplica o "encaixe" automático) =====
  let pdfZoomManual = 1;

  // Configurações (com padrões — sobrescritos por config persistida)
  const CONFIG_PADRAO = {
    fonte: 'Georgia, serif',
    tamanho: 18,
    espacamento: 1.5,
    margem: 5,
    tema: 'claro',
    modoRolagem: 'paginado'
  };
  let config = { ...CONFIG_PADRAO };

  // Cache do DOM
  let els = {};

  function atualizarCacheEls() {
    els = {
      container: document.getElementById('leitor-container'),
      titulo: document.getElementById('leitor-titulo-livro'),
      cronometro: document.getElementById('leitor-cronometro'),
      btnIniciar: document.getElementById('btn-leitor-iniciar'),
      btnPausar: document.getElementById('btn-leitor-pausar'),
      btnRetomar: document.getElementById('btn-leitor-retomar'),
      btnFinalizar: document.getElementById('btn-leitor-finalizar'),
      progressoTexto: document.getElementById('leitor-progresso-texto'),
      barraProgresso: document.getElementById('leitor-barra-progresso'),
      paginaAtual: document.getElementById('leitor-pagina-atual'),
      totalPaginas: document.getElementById('leitor-total-paginas'),
      btnVoltar: document.getElementById('btn-voltar-biblioteca')
    };
  }

  // ========== PERSISTÊNCIA DE CONFIGURAÇÃO (CORREÇÃO 2) ==========
  function carregarConfigPersistida() {
    try {
      const salvo = (typeof Util !== 'undefined' && Util.getPreference)
        ? Util.getPreference('leitorConfig', null)
        : JSON.parse(Util.lsGet('calixteca_leitor_config') || 'null');
      if (salvo) config = { ...CONFIG_PADRAO, ...salvo };
    } catch (e) {
      console.warn('Não foi possível carregar config do leitor:', e);
    }
  }

  function salvarConfigPersistida() {
    try {
      if (typeof Util !== 'undefined' && Util.setPreference) {
        Util.setPreference('leitorConfig', config);
      } else {
        Util.lsSet('calixteca_leitor_config', JSON.stringify(config));
      }
    } catch (e) {
      console.warn('Não foi possível salvar config do leitor:', e);
    }
  }

  // Preenche os controles do modal com os valores atuais de `config`
  // (antes eles só liam DOS controles — nunca inicializavam a partir da config salva)
  function sincronizarControlesComConfig() {
    const f = document.getElementById('leitor-fonte');
    const t = document.getElementById('leitor-tamanho-fonte');
    const valT = document.getElementById('leitor-valor-tamanho');
    const esp = document.getElementById('leitor-espacamento');
    const valEsp = document.getElementById('leitor-valor-espacamento');
    const marg = document.getElementById('leitor-margem');
    const valMarg = document.getElementById('leitor-valor-margem');
    const tm = document.getElementById('leitor-tema');
    const mr = document.getElementById('leitor-modo-rolagem');

    if (f) f.value = config.fonte;
    if (t) t.value = config.tamanho;
    if (valT) valT.textContent = config.tamanho;
    if (esp) esp.value = config.espacamento;
    if (valEsp) valEsp.textContent = config.espacamento;
    if (marg) marg.value = config.margem;
    if (valMarg) valMarg.textContent = config.margem;
    if (tm) tm.value = config.tema;
    if (mr) mr.value = config.modoRolagem;
  }

  // ========== ZOOM MANUAL DO PDF ==========
  function criarUIZoom() {
    if (document.getElementById('btn-zoom-menos')) return; // já criado

    const btnIndice = document.getElementById('btn-indice');
    if (!btnIndice || !btnIndice.parentNode) return;

    const btnMenos = document.createElement('button');
    btnMenos.type = 'button';
    btnMenos.className = 'btn btn-sm btn-outline-secondary';
    btnMenos.id = 'btn-zoom-menos';
    btnMenos.title = 'Diminuir zoom';
    btnMenos.innerHTML = '<i class="fas fa-search-minus"></i>';

    const btnMais = document.createElement('button');
    btnMais.type = 'button';
    btnMais.className = 'btn btn-sm btn-outline-secondary';
    btnMais.id = 'btn-zoom-mais';
    btnMais.title = 'Aumentar zoom';
    btnMais.innerHTML = '<i class="fas fa-search-plus"></i>';

    btnIndice.parentNode.insertBefore(btnMenos, btnIndice);
    btnIndice.parentNode.insertBefore(btnMais, btnIndice);

    const ajustarZoom = (delta) => {
      if (tipoArquivo !== 'pdf') {
        if (typeof Util !== 'undefined' && Util.toast) {
          Util.toast('Zoom manual disponível apenas para PDF por enquanto.', 'info');
        }
        return;
      }
      pdfZoomManual = Math.max(0.5, Math.min(3, +(pdfZoomManual + delta).toFixed(2)));
      renderizarPaginaPDF(pdfNumPage);
    };

    btnMenos.addEventListener('click', (e) => { e.preventDefault(); ajustarZoom(-0.2); });
    btnMais.addEventListener('click', (e) => { e.preventDefault(); ajustarZoom(0.2); });
  }

  // ========== BUSCA DENTRO DO DOCUMENTO (PDF) ==========
  // Cria o botão na topbar e a barra de busca (idempotente — chamado no init）
  function criarUIBusca() {
    if (!document.getElementById('btn-busca-leitor')) {
      const btnIndice = document.getElementById('btn-indice');
      if (btnIndice && btnIndice.parentNode) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm btn-outline-secondary';
        btn.id = 'btn-busca-leitor';
        btn.title = 'Buscar no documento';
        btn.innerHTML = '<i class="fas fa-search"></i>';
        btnIndice.parentNode.insertBefore(btn, btnIndice);
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          if (tipoArquivo !== 'pdf') {
            if (typeof Util !== 'undefined' && Util.toast) {
              Util.toast('Busca por texto disponível apenas para PDF por enquanto.', 'info');
            }
            return;
          }
          abrirBarraBusca();
        });
      }
    }

    if (!document.getElementById('leitor-busca-bar')) {
      const barra = document.createElement('div');
      barra.id = 'leitor-busca-bar';
      barra.className = 'leitor-busca-bar d-none';
      barra.innerHTML = `
        <input type="text" id="input-busca-leitor" class="form-control form-control-sm" placeholder="Buscar no documento...">
        <span id="busca-contador" class="busca-contador">0/0</span>
        <button type="button" class="btn btn-sm btn-outline-secondary" id="btn-busca-anterior" title="Resultado anterior"><i class="fas fa-chevron-up"></i></button>
        <button type="button" class="btn btn-sm btn-outline-secondary" id="btn-busca-proximo" title="Próximo resultado"><i class="fas fa-chevron-down"></i></button>
        <button type="button" class="btn btn-sm btn-outline-secondary" id="btn-busca-fechar" title="Fechar busca"><i class="fas fa-times"></i></button>
      `;
      const paginaLeitor = document.getElementById('page-leitor');
      (paginaLeitor || document.body).appendChild(barra);

      let timeoutDebounce = null;
      const input = document.getElementById('input-busca-leitor');
      input.addEventListener('input', () => {
        clearTimeout(timeoutDebounce);
        const termo = input.value.trim();
        if (termo.length < 2) {
          limparDestaqueBusca();
          atualizarContadorBusca();
          return;
        }
        timeoutDebounce = setTimeout(() => executarBuscaPDF(termo), 400);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) irParaResultado(buscaIndiceAtual - 1);
          else if (buscaResultados.length) irParaResultado(buscaIndiceAtual + 1);
          else executarBuscaPDF(input.value.trim());
        }
        if (e.key === 'Escape') fecharBarraBusca();
      });

      document.getElementById('btn-busca-proximo')?.addEventListener('click', () => irParaResultado(buscaIndiceAtual + 1));
      document.getElementById('btn-busca-anterior')?.addEventListener('click', () => irParaResultado(buscaIndiceAtual - 1));
      document.getElementById('btn-busca-fechar')?.addEventListener('click', () => fecharBarraBusca());
    }
  }

  function abrirBarraBusca() {
    const barra = document.getElementById('leitor-busca-bar');
    if (!barra) return;
    barra.classList.remove('d-none');
    const input = document.getElementById('input-busca-leitor');
    input?.focus();
    input?.select();
  }

  function fecharBarraBusca() {
    const barra = document.getElementById('leitor-busca-bar');
    barra?.classList.add('d-none');
    limparDestaqueBusca();
    buscaResultados = [];
    buscaIndiceAtual = -1;
    buscaTermoAtual = '';
    atualizarContadorBusca();
  }

  function atualizarContadorBusca(status = null) {
    const contador = document.getElementById('busca-contador');
    if (!contador) return;
    if (status) { contador.textContent = status; return; }
    if (!buscaResultados.length) { contador.textContent = '0/0'; return; }
    contador.textContent = `${buscaIndiceAtual + 1}/${buscaResultados.length}`;
  }

  // Varre todas as páginas do PDF em busca do termo. Não renderiza cada
  // página (custaria caro) — só extrai o texto via getTextContent, que é leve.
  async function executarBuscaPDF(termo) {
    if (!pdfDoc || !termo) return;
    buscaTermoAtual = termo;
    const meuToken = ++buscaToken;
    buscaResultados = [];
    buscaIndiceAtual = -1;
    limparDestaqueBusca();
    atualizarContadorBusca('Buscando...');

    const termoBusca = termo.toLowerCase();

    for (let p = 1; p <= pdfDoc.numPages; p++) {
      if (meuToken !== buscaToken) return; // usuário digitou algo novo — descarta esta busca
      try {
        const pagina = await pdfDoc.getPage(p);
        const textContent = await pagina.getTextContent();
        let ordem = 0;
        textContent.items.forEach(item => {
          const str = (item.str || '').toLowerCase();
          if (str.includes(termoBusca)) {
            buscaResultados.push({ pagina: p, ordemNaPagina: ordem });
            ordem++;
          }
        });
      } catch (e) {
        console.warn(`Falha ao ler texto da página ${p} para busca:`, e);
      }
    }

    if (meuToken !== buscaToken) return;

    if (!buscaResultados.length) {
      atualizarContadorBusca('Nada encontrado');
      return;
    }

    // Vai para o primeiro resultado a partir da página atual (ou o primeiro do documento)
    let indiceInicial = buscaResultados.findIndex(r => r.pagina >= pdfNumPage);
    if (indiceInicial === -1) indiceInicial = 0;
    irParaResultado(indiceInicial);
  }

  async function irParaResultado(indice) {
    if (!buscaResultados.length) return;
    const total = buscaResultados.length;
    buscaIndiceAtual = ((indice % total) + total) % total; // cicla nas duas direções
    const alvo = buscaResultados[buscaIndiceAtual];

    if (pdfNumPage !== alvo.pagina) {
      await renderizarPaginaPDF(alvo.pagina);
    }
    destacarOcorrenciasNaPagina(buscaTermoAtual, alvo.ordemNaPagina);
    atualizarContadorBusca();
  }

  function limparDestaqueBusca() {
    document.querySelectorAll('.textLayer .busca-destaque, .textLayer .busca-destaque-atual').forEach(el => {
      el.classList.remove('busca-destaque', 'busca-destaque-atual');
    });
  }

  // Destaca, na página já renderizada, todos os spans que contêm o termo,
  // e marca com uma cor diferente qual deles é o resultado "atual".
  function destacarOcorrenciasNaPagina(termo, ordemAtual) {
    limparDestaqueBusca();
    const textLayer = document.querySelector('#leitor-conteudo .textLayer');
    if (!textLayer || !termo) return;

    const termoBusca = termo.toLowerCase();
    const spans = Array.from(textLayer.querySelectorAll('span'))
      .filter(s => (s.textContent || '').toLowerCase().includes(termoBusca));

    spans.forEach((s, i) => {
      s.classList.add('busca-destaque');
      if (i === ordemAtual) {
        s.classList.add('busca-destaque-atual');
        s.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      }
    });
  }

  // ========== ESTRUTURAÇÃO DO CONTAINER DE LEITURA ==========
  function prepararEstruturaContainer() {
    atualizarCacheEls();
    if (!els.container) return null;

    els.container.style.position = 'relative';
    els.container.innerHTML = `
      <div id="leitor-conteudo" style="width:100%; height:100%; overflow:hidden;"></div>
      <div id="zona-clique-esquerda" style="position:absolute; top:0; left:0; width:35%; height:100%; z-index:100; cursor:pointer; pointer-events:none;"></div>
      <div id="zona-clique-centro" style="position:absolute; top:0; left:35%; width:30%; height:100%; z-index:100; cursor:pointer; pointer-events:none;"></div>
      <div id="zona-clique-direita" style="position:absolute; top:0; right:0; width:35%; height:100%; z-index:100; cursor:pointer; pointer-events:none;"></div>
      <div id="popup-selecao-leitor" class="popup-selecao-leitor d-none">
        <button type="button" class="btn btn-sm btn-warning" id="btn-grifar-selecao"><i class="fas fa-highlighter"></i> Grifar</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" id="btn-citar-selecao"><i class="fas fa-quote-right"></i> Citar</button>
      </div>
    `;

    aplicarVisibilidadeZonasDeToque();

    return document.getElementById('leitor-conteudo');
  }

  // Mostra/esconde as zonas de toque e liga/desliga o swipe conforme o
  // modo de leitura atual. Chamada tanto ao montar o container quanto ao
  // trocar o modo de rolagem em tempo real (sem reabrir o arquivo).
  function aplicarVisibilidadeZonasDeToque() {
    const zE = document.getElementById('zona-clique-esquerda');
    const zC = document.getElementById('zona-clique-centro');
    const zD = document.getElementById('zona-clique-direita');
    if (!zE && !zC && !zD) return;

    const usarZonasDeToque = tipoArquivo !== 'epub' || config.modoRolagem !== 'continuo';

    // As zonas ficam com pointer-events:none (ver prepararEstruturaContainer):
    // elas só marcam visualmente as áreas de navegação, quem realmente trata
    // o toque/clique é o listener único em configurarNavegacaoPorToque, que
    // sabe ignorar o gesto quando o usuário está selecionando texto (grifo).
    [zE, zC, zD].forEach(z => { if (z) z.style.display = usarZonasDeToque ? '' : 'none'; });

    if (usarZonasDeToque) {
      configurarGestosSwipe(els.container);
      configurarNavegacaoPorToque(els.container);
    }
  }

  // ========== NAVEGAÇÃO POR TOQUE/CLIQUE (CORREÇÃO 6) ==========
  // Antes, as zonas de clique tinham pointer-events:auto e ficavam por cima
  // de todo o conteúdo (z-index:100), o que impedia o navegador de detectar
  // a seleção de texto necessária para grifar — o toque/clique nunca chegava
  // ao texto, era sempre capturado pela zona. Agora as zonas só definem a
  // área visual; a decisão de virar página ou alternar as barras é tomada
  // aqui, num único listener de clique no container, que abre mão da ação
  // sempre que houver uma seleção de texto ativa (ou o clique for no popup
  // de Grifar/Citar), deixando a seleção funcionar normalmente.
  function configurarNavegacaoPorToque(container) {
    if (!container || container.dataset.tapNavConfigurado) return;
    container.dataset.tapNavConfigurado = '1';

    container.addEventListener('click', (e) => {
      // Não interfere com cliques no próprio popup de Grifar/Citar
      if (e.target.closest && e.target.closest('#popup-selecao-leitor')) return;

      // Não vira página se o usuário estiver selecionando (ou acabou de
      // selecionar) um trecho de texto para grifar
      const selecao = window.getSelection ? window.getSelection().toString() : '';
      if (selecao && selecao.trim().length > 0) return;

      const usarZonasAgora = tipoArquivo !== 'epub' || config.modoRolagem !== 'continuo';
      if (!usarZonasAgora) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const proporcao = rect.width > 0 ? x / rect.width : 0.5;

      if (proporcao < 0.35) paginaAnterior();
      else if (proporcao > 0.65) proximaPagina();
      else alternarBarrasLeitor();
    });
  }

  // ========== NAVEGAÇÃO POR TOQUE DENTRO DO IFRAME DO EPUB (CORREÇÃO 6b) ==========
  // O conteúdo do EPUB é renderizado pelo epub.js dentro de um <iframe>. Cliques
  // e toques feitos dentro desse iframe não se propagam para os listeners do
  // documento pai (é um "browsing context" separado), então o listener do
  // container (configurarNavegacaoPorToque) nunca é acionado para eles. Por
  // isso registramos, via rendition.hooks.content, um listener equivalente
  // dentro de cada seção renderizada, usando o próprio "contents" do epub.js
  // (contents.document / contents.window) para checar posição do clique e
  // se há uma seleção de texto ativa (nesse caso, não vira página — deixa o
  // usuário grifar).
  function configurarNavegacaoPorToqueNoEpub() {
    if (!rendition || !rendition.hooks || !rendition.hooks.content) return;
    if (rendition.__tapNavHookRegistrado) return;
    rendition.__tapNavHookRegistrado = true;

    let ultimoToqueEpubTs = 0;

    rendition.hooks.content.register((contents) => {
      const doc = contents && contents.document;
      if (!doc || doc.__tapNavConfigurado) return;
      doc.__tapNavConfigurado = true;

      doc.addEventListener('click', (e) => {
        const selecao = contents.window && contents.window.getSelection ? contents.window.getSelection().toString() : '';
        if (selecao && selecao.trim().length > 0) return;

        if (config.modoRolagem === 'continuo') return;

        // Trava simples: ignora um segundo clique/toque disparado logo em
        // seguida do anterior (ex.: touchend + click sintético do navegador
        // para o mesmo gesto).
        const agora = Date.now();
        if (agora - ultimoToqueEpubTs < 500) return;
        ultimoToqueEpubTs = agora;

        // IMPORTANTE: a largura tem que ser medida pelo wrapper
        // "#leitor-conteudo" (a área realmente VISÍVEL, com overflow:hidden),
        // e não pelo próprio <iframe> do epub.js. O epub.js estica o
        // <iframe> para caber TODAS as colunas/páginas do capítulo lado a
        // lado (ex.: 328px de página × 499 páginas = ~163.672px de largura
        // real do iframe) e é o wrapper que recorta e mostra só uma "fatia"
        // por vez. Medir pelo iframe fazia o cálculo da proporção do
        // clique ficar errado em capítulos com mais de uma página,
        // invertendo o sentido da navegação.
        const wrapperEl = document.getElementById('leitor-conteudo');
        const largura = wrapperEl ? wrapperEl.getBoundingClientRect().width : 0;
        if (!largura) return;
        const proporcao = e.clientX / largura;

        if (proporcao < 0.35) paginaAnterior();
        else if (proporcao > 0.65) proximaPagina();
        else alternarBarrasLeitor();
      });

      // Mesma lógica do documento principal: fecha o popup de Grifar/Citar
      // quando a seleção dentro do iframe do EPUB é desfeita.
      if (doc.defaultView && doc.defaultView.getSelection) {
        doc.addEventListener('selectionchange', () => {
          const texto = doc.defaultView.getSelection().toString().trim();
          if (!texto) esconderPopupSelecao();
        });
      }
    });
  }

  // ========== GESTOS DE SWIPE (CORREÇÃO 5) ==========
  // Além das zonas de clique, permite arrastar o dedo horizontalmente
  // para virar página — o padrão que qualquer leitor mobile tem.
  function configurarGestosSwipe(container) {
    if (!container || container.dataset.swipeConfigurado) return;
    container.dataset.swipeConfigurado = '1';

    const LIMIAR_DISTANCIA = 55;   // px mínimos no eixo X
    const LIMIAR_VERTICAL = 60;    // tolerância no eixo Y (evita confundir com rolagem)
    const LIMIAR_TEMPO = 600;      // ms máximo para considerar swipe

    container.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      swipeInicioX = e.touches[0].clientX;
      swipeInicioY = e.touches[0].clientY;
      swipeInicioTempo = Date.now();
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
      if (swipeInicioX === null) return;
      // Não interfere se o usuário estava selecionando texto
      const selecao = window.getSelection ? window.getSelection().toString() : '';
      if (selecao && selecao.trim().length > 0) {
        swipeInicioX = null;
        return;
      }

      const toque = e.changedTouches[0];
      const deltaX = toque.clientX - swipeInicioX;
      const deltaY = toque.clientY - swipeInicioY;
      const deltaTempo = Date.now() - swipeInicioTempo;

      swipeInicioX = null;

      if (deltaTempo > LIMIAR_TEMPO) return;
      if (Math.abs(deltaY) > LIMIAR_VERTICAL) return;
      if (Math.abs(deltaX) < LIMIAR_DISTANCIA) return;

      if (deltaX < 0) proximaPagina();      // arrastou para a esquerda → avança
      else paginaAnterior();                // arrastou para a direita → volta
    }, { passive: true });
  }

  // ========== CONFIGURAÇÕES VISUAIS ==========
  function aplicarConfigVisual() {
    atualizarCacheEls();
    if (!els.container) return;

    els.container.classList.remove('tema-claro', 'tema-sepia', 'tema-escuro');
    els.container.classList.add(`tema-${config.tema}`);

    els.container.classList.toggle('modo-paginado', config.modoRolagem !== 'continuo');

    if (tipoArquivo === 'epub' && rendition) {
      rendition.themes.select(config.tema);
      rendition.themes.font(config.fonte);
      rendition.themes.fontSize(config.tamanho + 'px');
      rendition.themes.override('line-height', config.espacamento);
      rendition.themes.override('padding', `0 ${config.margem}%`);
    }
  }

  function lerConfiguracoes() {
    const f = document.getElementById('leitor-fonte');
    const t = document.getElementById('leitor-tamanho-fonte');
    const esp = document.getElementById('leitor-espacamento');
    const marg = document.getElementById('leitor-margem');
    const tm = document.getElementById('leitor-tema');
    const mr = document.getElementById('leitor-modo-rolagem');

    const modoAnterior = config.modoRolagem;

    if (f) config.fonte = f.value;
    if (t) config.tamanho = parseInt(t.value);
    if (esp) config.espacamento = parseFloat(esp.value);
    if (marg) config.margem = parseInt(marg.value);
    if (tm) config.tema = tm.value;
    if (mr) config.modoRolagem = mr.value;

    salvarConfigPersistida();

    // CORREÇÃO 1: se o modo de rolagem mudou, o rendition do EPUB
    // precisa ser recriado com o `flow` correto — antes o seletor
    // existia mas não tinha efeito nenhum.
    if (tipoArquivo === 'epub' && book && modoAnterior !== config.modoRolagem) {
      recriarRenditionComNovoFluxo();
    }
  }

  function recriarRenditionComNovoFluxo() {
    if (!book) return;
    const cfiAtual = rendition && rendition.location ? rendition.location.start.cfi : null;
    if (rendition) { try { rendition.destroy(); } catch (e) {} rendition = null; }

    const conteinerConteudo = document.getElementById('leitor-conteudo');
    if (!conteinerConteudo) return;

    const flow = config.modoRolagem === 'continuo' ? 'scrolled-doc' : 'paginated';
    // O gerenciador 'default' do epub.js só funciona bem com flow paginado;
    // para rolagem contínua é preciso o 'continuous', senão a lib quebra
    // internamente (erros de "packaging" undefined e iframes sandboxed).
    const manager = config.modoRolagem === 'continuo' ? 'continuous' : 'default';
    rendition = book.renderTo(conteinerConteudo, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow,
      manager
    });

    criarTemasRendition();
    configurarEventosSelecaoEpub();
    aplicarConfigVisual();
    aplicarVisibilidadeZonasDeToque();
    rendition.display(cfiAtual || undefined).then(() => {
      reaplicarGrifos();
    });

    rendition.on('relocated', (location) => {
      atualizarProgresso(location);
      salvarPosicaoAtual(location.start.cfi);
      sincronizarProgresso(location);
    });
  }

  // ========== INICIALIZAÇÃO ==========
  async function init() {
    const page = document.getElementById('page-leitor');
    if (!page || !page.classList.contains('active')) return;

    atualizarCacheEls();
    carregarConfigPersistida();
    console.log('📖 Leitor Multiformato Inicializado.');

    const modalEl = document.getElementById('modalAssociarEpub');
    if (modalEl && typeof bootstrap !== 'undefined') {
      modalAssociacaoInstancia = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    }

    configurarEventos();
    criarUIBusca();
    criarUIZoom();
    sincronizarControlesComConfig();
    aplicarConfigVisual();

    if (!tipoArquivo) {
      const recuperou = await carregarUltimoLivro();
      if (!recuperou) mostrarTelaInicial();
    }
  }

  // ========== TELA CHEIA / MODO IMERSIVO ==========
  function alternarTelaCheia() {
    const pagina = document.getElementById('page-leitor');
    if (!pagina) return;
    const entrando = !pagina.classList.contains('leitor-imersivo');

    if (entrando) {
      pagina.classList.add('leitor-imersivo');
      pagina.classList.remove('leitor-mostrar-barras');
      const pedirFullscreen = pagina.requestFullscreen || pagina.webkitRequestFullscreen || pagina.msRequestFullscreen;
      if (pedirFullscreen) {
        const resultado = pedirFullscreen.call(pagina);
        if (resultado && typeof resultado.catch === 'function') resultado.catch(() => {});
      }
    } else {
      pagina.classList.remove('leitor-imersivo', 'leitor-mostrar-barras');
      const elementoFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
      const sairFullscreen = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (elementoFullscreen && sairFullscreen) {
        const resultado = sairFullscreen.call(document);
        if (resultado && typeof resultado.catch === 'function') resultado.catch(() => {});
      }
    }
    atualizarIconeTelaCheia();
  }

  function atualizarIconeTelaCheia() {
    const btn = document.getElementById('btn-fullscreen-leitor');
    const pagina = document.getElementById('page-leitor');
    if (!btn || !pagina) return;
    const emImersivo = pagina.classList.contains('leitor-imersivo');
    btn.innerHTML = emImersivo ? '<i class="fas fa-compress"></i>' : '<i class="fas fa-expand"></i>';
    btn.title = emImersivo ? 'Sair da tela cheia' : 'Tela cheia';
  }

  function configurarSincroniaFullscreen() {
    if (window.leitorFullscreenListenerConfigurado) return;
    const sincronizar = () => {
      const pagina = document.getElementById('page-leitor');
      if (!pagina) return;
      const emFullscreenNativo = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (!emFullscreenNativo && pagina.classList.contains('leitor-imersivo')) {
        pagina.classList.remove('leitor-imersivo', 'leitor-mostrar-barras');
        atualizarIconeTelaCheia();
      }
    };
    document.addEventListener('fullscreenchange', sincronizar);
    document.addEventListener('webkitfullscreenchange', sincronizar);
    window.leitorFullscreenListenerConfigurado = true;
  }

  function alternarBarrasLeitor() {
    const pagina = document.getElementById('page-leitor');
    if (!pagina || !pagina.classList.contains('leitor-imersivo')) return;

    const vaiMostrar = !pagina.classList.contains('leitor-mostrar-barras');
    clearTimeout(timeoutBarrasLeitor);

    if (vaiMostrar) {
      pagina.classList.add('leitor-mostrar-barras');
      timeoutBarrasLeitor = setTimeout(() => {
        pagina.classList.remove('leitor-mostrar-barras');
      }, 3500);
    } else {
      pagina.classList.remove('leitor-mostrar-barras');
    }
  }

  function carregarScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function garantirDependencias(extensao) {
    try {
      if (extensao === 'epub') {
        if (typeof ePub === 'undefined') {
          await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/epub.js/0.3.93/epub.min.js');
        }
        return typeof ePub !== 'undefined';
      }

      if (extensao === 'pdf') {
        if (typeof pdfjsLib === 'undefined') {
          await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
          if (window['pdfjs-dist/build/pdf']) {
            window.pdfjsLib = window['pdfjs-dist/build/pdf'];
          }
          if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          }
        }
        return typeof pdfjsLib !== 'undefined';
      }

      if (extensao === 'docx') {
        if (typeof mammoth === 'undefined') {
          await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
        }
        return typeof mammoth !== 'undefined';
      }
    } catch (e) {
      console.error(`Falha ao carregar biblioteca para ${extensao}:`, e);
      return false;
    }
    return false;
  }

  function configurarEventos() {
    // Fecha o popup de Grifar/Citar assim que o usuário desfizer a seleção
    // de texto (ex.: clicou fora, apertou Esc, tocou em outro lugar) — antes
    // o popup ficava aberto mesmo sem nenhum trecho selecionado.
    if (!document.__esconderPopupSelecaoConfigurado) {
      document.__esconderPopupSelecaoConfigurado = true;
      document.addEventListener('selectionchange', () => {
        const texto = window.getSelection ? window.getSelection().toString().trim() : '';
        if (!texto) esconderPopupSelecao();
      });
    }

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#btn-abrir-epub, #btn-trocar-epub');
      if (btn) {
        e.preventDefault();
        const input = document.getElementById('input-leitor-arquivo');
        if (input) input.click();
      }
    });

    const inputArquivo = document.getElementById('input-leitor-arquivo');
    if (inputArquivo) {
      inputArquivo.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          carregarArquivo(file);
          inputArquivo.value = '';
        }
      };
    }

    document.getElementById('btn-leitor-iniciar')?.addEventListener('click', (e) => { e.preventDefault(); iniciarCronometro(); });
    document.getElementById('btn-leitor-pausar')?.addEventListener('click', (e) => { e.preventDefault(); pausarCronometro(); });
    document.getElementById('btn-leitor-retomar')?.addEventListener('click', (e) => { e.preventDefault(); retomarCronometro(); });
    document.getElementById('btn-leitor-finalizar')?.addEventListener('click', (e) => { e.preventDefault(); finalizarSessao(); });

    document.getElementById('btn-fullscreen-leitor')?.addEventListener('click', (e) => {
      e.preventDefault();
      alternarTelaCheia();
    });
    configurarSincroniaFullscreen();

    // Range sliders: refletir valor ao vivo (antes só era lido no fechar do modal)
    document.getElementById('leitor-tamanho-fonte')?.addEventListener('input', (e) => {
      const el = document.getElementById('leitor-valor-tamanho');
      if (el) el.textContent = e.target.value;
    });
    document.getElementById('leitor-espacamento')?.addEventListener('input', (e) => {
      const el = document.getElementById('leitor-valor-espacamento');
      if (el) el.textContent = e.target.value;
    });
    document.getElementById('leitor-margem')?.addEventListener('input', (e) => {
      const el = document.getElementById('leitor-valor-margem');
      if (el) el.textContent = e.target.value;
    });

    ['modal-config-leitor', 'modalAssociarEpub'].forEach(modalId => {
      const mEl = document.getElementById(modalId);
      if (mEl) {
        mEl.addEventListener('show.bs.modal', () => {
          if (modalId === 'modal-config-leitor') sincronizarControlesComConfig();
        });
        mEl.addEventListener('hide.bs.modal', () => {
          if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
          }
        });
        mEl.addEventListener('hidden.bs.modal', () => {
          lerConfiguracoes();
          aplicarConfigVisual();
        });
      }
    });

    document.getElementById('btn-indice')?.addEventListener('click', (e) => {
      if (tipoArquivo !== 'epub') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof Util !== 'undefined' && Util.toast) {
          Util.toast('Índice interativo disponível apenas para arquivos EPUB.', 'info');
        }
        return;
      }
      carregarIndice();
    });

    document.getElementById('btn-voltar-biblioteca')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelector('.nav-link[data-page="biblioteca"]')?.click();
    });

    if (!window.leitorAtalhosTeclado) {
      document.addEventListener('keydown', (e) => {
        if (!document.getElementById('page-leitor')?.classList.contains('active')) return;
        if (e.key === 'ArrowRight') proximaPagina();
        if (e.key === 'ArrowLeft') paginaAnterior();
      });
      window.leitorAtalhosTeclado = true;
    }
  }

  function mostrarTelaInicial() {
    atualizarCacheEls();
    if (!els.container) return;
    els.container.innerHTML = `
      <div class="d-flex flex-column align-items-center justify-content-center h-100 text-muted">
        <i class="fas fa-file-invoice fa-4x mb-3"></i>
        <h5>Nenhum documento aberto</h5>
        <p>Selecione um arquivo <strong>.EPUB</strong>, <strong>.PDF</strong> ou <strong>.DOCX</strong>.</p>
        <button class="btn btn-primary" id="btn-abrir-epub"><i class="fas fa-folder-open me-2"></i>Abrir Documento</button>
      </div>`;
    if (els.titulo) els.titulo.textContent = 'Nenhum livro';
    if (els.totalPaginas) els.totalPaginas.textContent = '0';
  }

  function destruirLeitorAtual() {
    if (rendition) { try { rendition.destroy(); } catch(e){} rendition = null; }
    if (book) { try { book.destroy(); } catch(e){} book = null; }
    pdfDoc = null;
    tipoArquivo = null;
    currentBookInfo = { id: null, title: '', author: '', bookData: null };
    highlightsAtuais = [];
    pdfZoomManual = 1;
    fecharBarraBusca();
  }

  // ===== Chave estável para identificar o "livro" nas chaves de armazenamento =====
  // Usa o id vinculado quando existe; senão cai para um slug do título — assim o
  // progresso e os grifos continuam por-livro mesmo antes de vincular à biblioteca.
  function chaveLivroAtual() {
    if (currentBookInfo.id) return `id_${currentBookInfo.id}`;
    const slug = (currentBookInfo.title || 'sem-titulo')
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').slice(0, 80);
    return `titulo_${slug}`;
  }

  async function carregarArquivo(file, cfiSalvo = null) {
    const ext = file.name.split('.').pop().toLowerCase();

    const disponivel = await garantirDependencias(ext);
    if (!disponivel) {
      if (typeof Util !== 'undefined' && Util.toast) {
        Util.toast(`Não foi possível carregar o leitor para o formato .${ext.toUpperCase()}`, 'danger');
      }
      return;
    }

    destruirLeitorAtual();
    tipoArquivo = ext;
    atualizarCacheEls();

    if (els.container) {
      els.container.innerHTML = '<div class="d-flex justify-content-center py-5"><div class="spinner-border text-primary"></div></div>';
    }

    currentBookInfo.title = file.name.replace(/\.(epub|pdf|docx)$/i, '');
    currentBookInfo.author = 'Autor desconhecido';
    if (els.titulo) els.titulo.textContent = currentBookInfo.title;

    // CORREÇÃO 3: se não veio um CFI explícito, tenta recuperar a posição
    // salva especificamente para ESTE livro (por título, antes de vincular à biblioteca)
    const chaveInicial = chaveLivroAtual();
    if (!cfiSalvo) {
      cfiSalvo = obterPosicaoSalva(chaveInicial);
    }
    highlightsAtuais = obterGrifosSalvos(chaveInicial);

    const conteinerConteudo = prepararEstruturaContainer();

    if (ext === 'epub') await processarEPUB(file, cfiSalvo, conteinerConteudo);
    else if (ext === 'pdf') await processarPDF(file, conteinerConteudo);
    else if (ext === 'docx') await processarDOCX(file, conteinerConteudo);

    await associarLivro(currentBookInfo.title, currentBookInfo.author);

    // Depois de vincular (currentBookInfo.id pode ter mudado), tenta migrar/
    // reler posição e grifos pela chave definitiva (id da biblioteca).
    // BUG CORRIGIDO: antes isso SUBSTITUÍA highlightsAtuais pelo que estivesse
    // salvo na chave por ID (geralmente vazio na primeira vinculação), fazendo
    // os grifos feitos antes de vincular (salvos sob a chave por título)
    // ficarem órfãos — continuavam no localStorage, mas nunca mais eram lidos.
    // Agora mescla as duas listas (por CFI, sem duplicar) e salva tudo já na
    // chave definitiva.
    const chaveDefinitiva = chaveLivroAtual();
    const posicaoPorId = obterPosicaoSalva(chaveDefinitiva);
    if (posicaoPorId && tipoArquivo === 'epub' && rendition && posicaoPorId !== cfiSalvo) {
      rendition.display(posicaoPorId).catch(() => {});
    }
    if (chaveDefinitiva !== chaveInicial) {
      const grifosPorId = obterGrifosSalvos(chaveDefinitiva);
      const mesclados = [...highlightsAtuais];
      grifosPorId.forEach(g => {
        const jaExiste = mesclados.some(m => (g.cfi && m.cfi === g.cfi) || (g.id && m.id === g.id));
        if (!jaExiste) mesclados.push(g);
      });
      highlightsAtuais = mesclados;
      salvarGrifosAtuais(); // já grava sob chaveDefinitiva, pois chaveLivroAtual() agora resolve pra ela
    }
    reaplicarGrifos();
  }

  // ========== PROCESSADORES POR FORMATO ==========

  async function processarEPUB(file, cfiSalvo, conteinerConteudo) {
    book = ePub(file);
    await book.ready;

    const flow = config.modoRolagem === 'continuo' ? 'scrolled-doc' : 'paginated';
    // O gerenciador 'default' do epub.js só funciona bem com flow paginado;
    // para rolagem contínua é preciso o 'continuous', senão a lib quebra
    // internamente (erros de "packaging" undefined e iframes sandboxed).
    const manager = config.modoRolagem === 'continuo' ? 'continuous' : 'default';
    rendition = book.renderTo(conteinerConteudo, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow,
      manager
    });

    criarTemasRendition();
    const metadata = book.packaging?.metadata || book.metadata;
    if (metadata?.title) currentBookInfo.title = metadata.title;
    if (metadata?.creator) currentBookInfo.author = metadata.creator;
    if (els.titulo) els.titulo.textContent = currentBookInfo.title;

    let pontoInicial = cfiSalvo;
    if (!pontoInicial && book.spine && book.spine.spineItems && book.spine.spineItems.length > 0) {
      pontoInicial = book.spine.spineItems[0].href;
    }

    aplicarConfigVisual();
    await rendition.display(pontoInicial || undefined);

    setTimeout(() => {
      if (rendition) rendition.resize();
    }, 100);

    book.locations.generate(1024).then(() => {
      if (els.totalPaginas && book.locations) {
        els.totalPaginas.textContent = book.locations.length();
      }
    }).catch(console.warn);

    rendition.on('relocated', (location) => {
      atualizarProgresso(location);
      salvarPosicaoAtual(location.start.cfi);
      sincronizarProgresso(location);
    });

    configurarEventosSelecaoEpub();
    reaplicarGrifos();
  }

  // ========== GRIFOS / MARCAÇÕES (CORREÇÃO 4) ==========
  // Escuta seleção de texto no EPUB e mostra um pequeno popup com
  // "Grifar" (marca o trecho, persistido por CFI) e "Citar" (abre o
  // modal de cartão de citação já existente no app, se disponível).
  function esconderPopupSelecao() {
    const popup = document.getElementById('popup-selecao-leitor');
    if (popup) popup.classList.add('d-none');
  }

  function configurarEventosSelecaoEpub() {
    if (!rendition) return;

    configurarNavegacaoPorToqueNoEpub();

    rendition.on('selected', (cfiRange, contents) => {
      const texto = contents.window.getSelection().toString().trim();
      if (!texto) return;

      const popup = document.getElementById('popup-selecao-leitor');
      if (!popup) return;
      popup.classList.remove('d-none');
      popup.dataset.cfi = cfiRange;
      popup.dataset.texto = texto;

      const btnGrifar = document.getElementById('btn-grifar-selecao');
      const btnCitar = document.getElementById('btn-citar-selecao');

      if (btnGrifar) {
        btnGrifar.onclick = () => {
          grifarTrecho(cfiRange, texto);
          popup.classList.add('d-none');
          contents.window.getSelection().removeAllRanges();
        };
      }
      if (btnCitar) {
        btnCitar.onclick = () => {
          abrirCartaoCitacao(texto);
          popup.classList.add('d-none');
          contents.window.getSelection().removeAllRanges();
        };
      }
    });

    // Esconde o popup se o usuário tocar fora dele
    rendition.on('markClicked', () => {});
  }

  function grifarTrecho(cfiRange, texto, cor = '#ffe58a') {
    if (!rendition) return;
    try {
      rendition.annotations.highlight(cfiRange, {}, (e) => {
        // Clique no próprio grifo remove a marcação
        removerGrifo(cfiRange);
      }, 'hl-calixteca', { fill: cor, 'fill-opacity': '0.4' });
    } catch (e) {
      console.warn('Falha ao aplicar grifo:', e);
      return;
    }
    highlightsAtuais.push({ cfi: cfiRange, texto, cor, data: new Date().toISOString() });
    salvarGrifosAtuais();
    if (typeof Util !== 'undefined' && Util.toast) Util.toast('Trecho grifado.', 'success');
  }

  function removerGrifo(cfiRange) {
    if (rendition) {
      try { rendition.annotations.remove(cfiRange, 'highlight'); } catch (e) {}
    }
    highlightsAtuais = highlightsAtuais.filter(h => h.cfi !== cfiRange);
    salvarGrifosAtuais();
  }

  function reaplicarGrifos() {
    if (tipoArquivo === 'epub') {
      if (!rendition) return;
      highlightsAtuais.filter(h => h.tipo !== 'pdf').forEach(h => {
        try {
          rendition.annotations.highlight(h.cfi, {}, () => removerGrifo(h.cfi), 'hl-calixteca', { fill: h.cor || '#ffe58a', 'fill-opacity': '0.4' });
        } catch (e) { /* CFI pode não existir mais nesta seção carregada — ok ignorar */ }
      });
    } else if (tipoArquivo === 'pdf') {
      // A página do PDF já renderizada é redesenhada com os grifos que
      // acabaram de ser mesclados/carregados (ex. depois de vincular o
      // livro à biblioteca).
      if (pdfPaginaWrapperAtual) {
        desenharGrifosPDFNaPagina(pdfNumPage, pdfPaginaWrapperAtual, pdfViewportScaleAtual);
      }
    }
  }

  // ===== Grifar/citar por seleção de texto no PDF =====
  // Diferente do EPUB (que usa CFI + rendition.annotations), o PDF grava a
  // posição do grifo como retângulos relativos ao viewport "lógico" (sem o
  // zoom aplicado), pra poder redesenhar corretamente em qualquer nível de
  // zoom ou tamanho de tela.
  function configurarSelecaoPDF(textLayerDiv, paginaWrapper, viewportScale, numPagina) {
    const aoSoltarSelecao = () => {
      const selecao = window.getSelection();
      const texto = selecao ? selecao.toString().trim() : '';
      if (!texto || !selecao.rangeCount) return;
      // Ignora seleções feitas fora desta camada de texto (ex. dentro da UI do leitor)
      if (!textLayerDiv.contains(selecao.anchorNode)) return;

      const range = selecao.getRangeAt(0);
      const rects = Array.from(range.getClientRects());
      if (!rects.length) return;

      const wrapperRect = paginaWrapper.getBoundingClientRect();
      const rectsRelativos = rects.map(r => ({
        left: (r.left - wrapperRect.left) / viewportScale,
        top: (r.top - wrapperRect.top) / viewportScale,
        width: r.width / viewportScale,
        height: r.height / viewportScale
      }));

      mostrarPopupSelecaoPDF(texto, rectsRelativos, numPagina);
    };

    textLayerDiv.addEventListener('mouseup', aoSoltarSelecao);
    textLayerDiv.addEventListener('touchend', aoSoltarSelecao);
  }

  function mostrarPopupSelecaoPDF(texto, rects, numPagina) {
    const popup = document.getElementById('popup-selecao-leitor');
    if (!popup) return;
    popup.classList.remove('d-none');

    const btnGrifar = document.getElementById('btn-grifar-selecao');
    const btnCitar = document.getElementById('btn-citar-selecao');

    if (btnGrifar) {
      btnGrifar.onclick = () => {
        grifarTrechoPDF(texto, rects, numPagina);
        popup.classList.add('d-none');
        window.getSelection().removeAllRanges();
      };
    }
    if (btnCitar) {
      btnCitar.onclick = () => {
        abrirCartaoCitacao(texto);
        popup.classList.add('d-none');
        window.getSelection().removeAllRanges();
      };
    }
  }

  function grifarTrechoPDF(texto, rects, pagina, cor = '#ffe58a') {
    const id = `pdf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    highlightsAtuais.push({ tipo: 'pdf', id, pagina, texto, rects, cor, data: new Date().toISOString() });
    salvarGrifosAtuais();
    if (pagina === pdfNumPage && pdfPaginaWrapperAtual) {
      desenharGrifosPDFNaPagina(pagina, pdfPaginaWrapperAtual, pdfViewportScaleAtual);
    }
    if (typeof Util !== 'undefined' && Util.toast) Util.toast('Trecho grifado.', 'success');
  }

  function removerGrifoPDF(id, numPagina, paginaWrapper, viewportScale) {
    highlightsAtuais = highlightsAtuais.filter(h => h.id !== id);
    salvarGrifosAtuais();
    desenharGrifosPDFNaPagina(numPagina, paginaWrapper, viewportScale);
    if (typeof Util !== 'undefined' && Util.toast) Util.toast('Grifo removido.', 'info');
  }

  function desenharGrifosPDFNaPagina(numPagina, paginaWrapper, viewportScale) {
    if (!paginaWrapper) return;
    let overlay = paginaWrapper.querySelector('.grifos-overlay-pdf');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'grifos-overlay-pdf';
      paginaWrapper.appendChild(overlay);
    }
    overlay.innerHTML = '';

    highlightsAtuais
      .filter(h => h.tipo === 'pdf' && h.pagina === numPagina)
      .forEach(h => {
        (h.rects || []).forEach(r => {
          const div = document.createElement('div');
          div.className = 'hl-calixteca-pdf';
          div.style.left = (r.left * viewportScale) + 'px';
          div.style.top = (r.top * viewportScale) + 'px';
          div.style.width = (r.width * viewportScale) + 'px';
          div.style.height = (r.height * viewportScale) + 'px';
          div.style.background = h.cor || '#ffe58a';
          div.title = 'Clique para remover o grifo';
          div.addEventListener('click', () => removerGrifoPDF(h.id, numPagina, paginaWrapper, viewportScale));
          overlay.appendChild(div);
        });
      });
  }

  function abrirCartaoCitacao(texto) {
    const campoTexto = document.getElementById('citacao-texto');
    const campoLivro = document.getElementById('citacao-livro');
    const campoAutor = document.getElementById('citacao-autor');
    if (campoTexto) campoTexto.textContent = texto;
    if (campoLivro) campoLivro.textContent = currentBookInfo.title || '';
    if (campoAutor) campoAutor.textContent = currentBookInfo.author || '';

    const modalEl = document.getElementById('modal-compartilhar-citacao');
    if (modalEl && typeof bootstrap !== 'undefined') {
      (bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl)).show();
    }
  }

  // ===== Armazenamento local de posição e grifos por livro =====
  // Guardado além do DB.salvarPosicaoLeitor (que hoje mantém só o "último
  // livro aberto" globalmente) para que cada livro tenha sua própria posição.
  function obterPosicaoSalva(chave) {
    try {
      const bruto = Util.lsGet(`calixteca_pos_${chave}`);
      return bruto ? JSON.parse(bruto).cfi : null;
    } catch (e) { return null; }
  }

  function salvarPosicaoAtual(cfi) {
    const chave = chaveLivroAtual();
    try {
      Util.lsSet(`calixteca_pos_${chave}`, JSON.stringify({ cfi, ts: Date.now() }));
    } catch (e) { console.warn('Falha ao salvar posição local:', e); }

    // Mantém compatibilidade com o fluxo antigo de "retomar último livro"
    if (typeof DB !== 'undefined' && DB.salvarPosicaoLeitor) {
      DB.salvarPosicaoLeitor(cfi).catch(console.warn);
    }
  }

  function obterGrifosSalvos(chave) {
    try {
      const bruto = Util.lsGet(`calixteca_highlights_${chave}`);
      return bruto ? JSON.parse(bruto) : [];
    } catch (e) { return []; }
  }

  function salvarGrifosAtuais() {
    const chave = chaveLivroAtual();
    try {
      Util.lsSet(`calixteca_highlights_${chave}`, JSON.stringify(highlightsAtuais));
    } catch (e) { console.warn('Falha ao salvar grifos:', e); }
  }

  async function processarPDF(file, conteinerConteudo) {
    const arrayBuffer = await file.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    if (els.totalPaginas) els.totalPaginas.textContent = pdfDoc.numPages;
    await renderizarPaginaPDF(1, conteinerConteudo);
  }

  // CORREÇÃO 6: camada de texto sobre o canvas — permite selecionar,
  // copiar e (base para) buscar texto no PDF, igual qualquer leitor sério.
  // CORREÇÃO 7: renderiza o canvas na densidade real da tela (devicePixelRatio),
  // não só no tamanho "lógico" — é isso que deixava o texto borrado em
  // telas retina/celulares modernos, mesmo com o "encaixe" correto na tela.
  async function renderizarPaginaPDF(num, conteinerConteudo) {
    if (!pdfDoc || num < 1 || num > pdfDoc.numPages) return;
    pdfNumPage = num;

    const conteinerTarget = conteinerConteudo || document.getElementById('leitor-conteudo');
    if (!conteinerTarget) return;

    conteinerTarget.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'd-flex justify-content-center align-items-center w-100 h-100 overflow-auto';
    wrapper.style.position = 'relative';

    const paginaWrapper = document.createElement('div');
    paginaWrapper.style.position = 'relative';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    paginaWrapper.appendChild(canvas);

    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    paginaWrapper.appendChild(textLayerDiv);

    wrapper.appendChild(paginaWrapper);
    conteinerTarget.appendChild(wrapper);

    const page = await pdfDoc.getPage(num);

    const widthDisponivel = conteinerTarget.clientWidth || window.innerWidth;
    const heightDisponivel = conteinerTarget.clientHeight || window.innerHeight;
    const vpOriginal = page.getViewport({ scale: 1.0 });

    const scaleX = (widthDisponivel - 30) / vpOriginal.width;
    const scaleY = (heightDisponivel - 30) / vpOriginal.height;
    // scaleFinal é o "encaixe" lógico na tela (tamanho em CSS px);
    // pdfZoomManual multiplica por cima quando o usuário usa os botões +/-.
    const scaleAjuste = Math.max(0.6, Math.min(scaleX, scaleY, 2.0));
    const scaleFinal = scaleAjuste * pdfZoomManual;

    // Viewport "lógico" — define o tamanho em CSS px (o que o usuário vê)
    const viewport = page.getViewport({ scale: scaleFinal });

    // Viewport de renderização — multiplicado pelo devicePixelRatio real da
    // tela, pra desenhar mais pixels no canvas do que o CSS mostra. É o
    // mesmo truque usado pelo próprio exemplo oficial do pdf.js.
    const outputScale = window.devicePixelRatio || 1;
    const viewportRender = page.getViewport({ scale: scaleFinal * outputScale });

    canvas.width = Math.floor(viewportRender.width);
    canvas.height = Math.floor(viewportRender.height);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    paginaWrapper.style.width = Math.floor(viewport.width) + 'px';
    paginaWrapper.style.height = Math.floor(viewport.height) + 'px';

    await page.render({ canvasContext: ctx, viewport: viewportRender }).promise;

    // Camada de texto invisível posicionada exatamente sobre o canvas
    // (usa sempre o viewport "lógico", em CSS px — a densidade de tela
    // não entra aqui, senão o texto ficaria desalinhado com o desenho)
    try {
      textLayerDiv.style.width = viewport.width + 'px';
      textLayerDiv.style.height = viewport.height + 'px';
      // O pdf.js exige essa variável CSS com a mesma escala do viewport
      // "lógico" usado na camada de texto — sem ela, o texto se desalinha
      // (e a lib avisa no console, mesmo sem quebrar nada visualmente).
      textLayerDiv.style.setProperty('--scale-factor', viewport.scale);
      const textContent = await page.getTextContent();

      if (typeof pdfjsLib.renderTextLayer === 'function') {
        await pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport
        }).promise;
      } else if (typeof pdfjsLib.TextLayer === 'function') {
        // API mais nova (pdf.js 4+) caso a lib seja atualizada no futuro
        const tl = new pdfjsLib.TextLayer({ textContentSource: textContent, container: textLayerDiv, viewport });
        await tl.render();
      }
    } catch (e) {
      console.warn('Camada de texto do PDF não pôde ser criada (seleção de texto ficará indisponível):', e);
    }

    configurarGestosSwipe(conteinerTarget);
    configurarSelecaoPDF(textLayerDiv, paginaWrapper, viewport.scale, num);

    pdfPaginaWrapperAtual = paginaWrapper;
    pdfViewportScaleAtual = viewport.scale;
    desenharGrifosPDFNaPagina(num, paginaWrapper, viewport.scale);

    if (els.paginaAtual) els.paginaAtual.textContent = pdfNumPage;
    const pct = Math.round((pdfNumPage / pdfDoc.numPages) * 100);
    if (els.progressoTexto) els.progressoTexto.textContent = `${pct}%`;
    if (els.barraProgresso) els.barraProgresso.style.width = `${pct}%`;

    salvarPosicaoAtual(String(pdfNumPage));
  }

  async function processarDOCX(file, conteinerConteudo) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });

    const conteinerTarget = conteinerConteudo || document.getElementById('leitor-conteudo');
    if (!conteinerTarget) return;

    conteinerTarget.innerHTML = `
      <div class="docx-wrapper p-4 overflow-auto h-100" style="max-width: 850px; margin: 0 auto; color: inherit;">
        ${result.value}
      </div>`;

    const texto = conteinerTarget.textContent || '';
    const totalEstimado = Math.max(1, Math.ceil(texto.length / 2000));

    if (els.paginaAtual) els.paginaAtual.textContent = 1;
    if (els.totalPaginas) els.totalPaginas.textContent = totalEstimado;

    const wrapper = conteinerTarget.querySelector('.docx-wrapper');
    wrapper?.addEventListener('scroll', () => {
      const pct = wrapper.scrollTop / (wrapper.scrollHeight - wrapper.clientHeight || 1);
      const pag = Math.min(totalEstimado, Math.max(1, Math.round(pct * (totalEstimado - 1)) + 1));
      if (els.paginaAtual) els.paginaAtual.textContent = pag;
      if (els.progressoTexto) els.progressoTexto.textContent = `${Math.round(pct * 100)}%`;
      if (els.barraProgresso) els.barraProgresso.style.width = `${Math.round(pct * 100)}%`;
      salvarPosicaoAtual(String(pag));
    });
  }

  // ========== NAVEGAÇÃO ==========
  function proximaPagina() {
    if (tipoArquivo === 'epub' && rendition) rendition.next();
    else if (tipoArquivo === 'pdf' && pdfNumPage < pdfDoc?.numPages) renderizarPaginaPDF(pdfNumPage + 1);
    else if (tipoArquivo === 'docx') {
      const w = document.querySelector('#leitor-conteudo .docx-wrapper');
      if (w) w.scrollTop += w.clientHeight * 0.8;
    }
  }

  function paginaAnterior() {
    if (tipoArquivo === 'epub' && rendition) rendition.prev();
    else if (tipoArquivo === 'pdf' && pdfNumPage > 1) renderizarPaginaPDF(pdfNumPage - 1);
    else if (tipoArquivo === 'docx') {
      const w = document.querySelector('#leitor-conteudo .docx-wrapper');
      if (w) w.scrollTop -= w.clientHeight * 0.8;
    }
  }

  // ========== ASSOCIAÇÃO À BIBLIOTECA ==========
  async function associarLivro(title, author) {
    if (typeof API === 'undefined') return;
    try {
      const resp = await API.enviar({ acao: 'listAllBooks' });
      if (Array.isArray(resp)) {
        const encontrado = resp.find(l =>
          (l.Título || l.titulo || '').toLowerCase().includes(title.toLowerCase())
        );
        if (encontrado) {
          efetivarVinculo(encontrado);
        } else {
          currentBookInfo.id = null;
          currentBookInfo.bookData = null;
          if (modalAssociacaoInstancia) {
            const titleEl = document.getElementById('epubMetaTitle');
            const authorEl = document.getElementById('epubMetaAuthor');
            if (titleEl) titleEl.innerText = title;
            if (authorEl) authorEl.innerText = author;

            preencherModalAssociacao(resp, title, author);
            modalAssociacaoInstancia.show();
          }
        }
      }
    } catch (e) {
      console.warn('Off-line ou erro ao associar:', e);
    }
  }

  function preencherModalAssociacao(livros, title, author) {
    const lista = document.getElementById('listaLivrosParaVincular');
    if (lista) {
      lista.innerHTML = '';
      livros.forEach(livro => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
        btn.innerHTML = `<div><strong>${livro.Título || livro.titulo}</strong><br><small class="text-muted">${livro.Autor || livro.autor}</small></div>`;
        btn.onclick = () => {
          if (document.activeElement) document.activeElement.blur();
          efetivarVinculo(livro);
          modalAssociacaoInstancia?.hide();
        };
        lista.appendChild(btn);
      });
    }

    const btnCriar = document.getElementById('btnCriarNovoLivroEpub');
    if (btnCriar) {
      const novoBtn = btnCriar.cloneNode(true);
      btnCriar.parentNode.replaceChild(novoBtn, btnCriar);

      novoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (document.activeElement) document.activeElement.blur();
        modalAssociacaoInstancia?.hide();

        preencherFormularioAdicionarLivro({
          titulo: title,
          autor: author,
          totalPaginas: parseInt(els.totalPaginas?.textContent || '0') || 0,
          formato: (tipoArquivo || 'EPUB').toUpperCase(),
          status: 'Lendo'
        });

        const navAdicionar = document.querySelector('[data-page="adicionar"]') || document.querySelector('[data-page="adicionar-livro"]');
        navAdicionar?.click();
        if (typeof Util !== 'undefined' && Util.toast) {
          Util.toast('Dados importados! Conclua o cadastro na biblioteca.', 'info');
        }
      });
    }
  }

  function preencherFormularioAdicionarLivro(dados) {
    const inT = document.getElementById('titulo') || document.getElementById('add-titulo');
    const inA = document.getElementById('autor') || document.getElementById('add-autor');
    const inP = document.getElementById('paginas') || document.getElementById('add-paginas');
    const inF = document.getElementById('formato') || document.getElementById('add-formato');
    const inS = document.getElementById('status') || document.getElementById('add-status');

    if (inT) inT.value = dados.titulo;
    if (inA) inA.value = dados.autor;
    if (inP) inP.value = dados.totalPaginas;
    if (inF) inF.value = dados.formato;
    if (inS) inS.value = dados.status;
  }

  function efetivarVinculo(livro) {
    currentBookInfo.id = livro.ID || livro.id;
    currentBookInfo.bookData = livro;
  }

  // ========== CRONÔMETRO E SESSÃO ==========
  function atualizarDisplayCronometro() {
    if (!cronometroAtivo) return;
    atualizarCacheEls();
    const agora = Date.now();
    const totalMs = tempoAcumulado + (inicioCronometro ? agora - inicioCronometro : 0);
    const totalSeg = Math.floor(totalMs / 1000);
    const mins = Math.floor(totalSeg / 60);
    const secs = totalSeg % 60;
    if (els.cronometro) els.cronometro.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    animFrameId = requestAnimationFrame(atualizarDisplayCronometro);
  }

  function iniciarCronometro() {
    if (cronometroAtivo) return;
    atualizarCacheEls();
    inicioCronometro = Date.now();
    cronometroAtivo = true;

    horaInicioSessao = new Date().toTimeString().slice(0, 5);
    paginaInicialCronometro = parseInt(els.paginaAtual?.textContent || '1') || 1;

    els.btnIniciar?.classList.add('d-none');
    els.btnPausar?.classList.remove('d-none');
    els.btnRetomar?.classList.add('d-none');
    els.btnFinalizar?.classList.remove('d-none');

    atualizarDisplayCronometro();
    iniciarAudioFantasma();
  }

  function pausarCronometro() {
    if (!cronometroAtivo) return;
    atualizarCacheEls();
    cronometroAtivo = false;
    if (animFrameId) cancelAnimationFrame(animFrameId);
    tempoAcumulado += Date.now() - inicioCronometro;
    inicioCronometro = null;

    els.btnPausar?.classList.add('d-none');
    els.btnRetomar?.classList.remove('d-none');
    pararAudioFantasma();
  }

  function retomarCronometro() {
    if (cronometroAtivo) return;
    atualizarCacheEls();
    inicioCronometro = Date.now();
    cronometroAtivo = true;

    els.btnRetomar?.classList.add('d-none');
    els.btnPausar?.classList.remove('d-none');
    atualizarDisplayCronometro();
    iniciarAudioFantasma();
  }

  function finalizarSessao() {
    atualizarCacheEls();
    if (cronometroAtivo) {
      cronometroAtivo = false;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      tempoAcumulado += Date.now() - inicioCronometro;
      inicioCronometro = null;
    }

    els.btnIniciar?.classList.remove('d-none');
    els.btnPausar?.classList.add('d-none');
    els.btnRetomar?.classList.add('d-none');
    els.btnFinalizar?.classList.add('d-none');
    pararAudioFantasma();

    const agora = new Date();
    const horaFimSessao = agora.toTimeString().slice(0, 5);
    const minutosLidos = tempoAcumulado > 0 ? Math.max(1, Math.round(tempoAcumulado / 60000)) : 0;
    const paginaAtual = parseInt(els.paginaAtual?.textContent || '1') || 1;

    tempoAcumulado = 0;
    if (els.cronometro) els.cronometro.textContent = '00:00';

    if (minutosLidos === 0) {
      if (typeof Util !== 'undefined' && Util.toast) {
        Util.toast('Sessão muito curta para ser registrada.', 'warning');
      }
      return;
    }

    preencherFormularioSessao({
      data: agora.toLocaleDateString('en-CA'),
      horaInicio: horaInicioSessao || horaFimSessao,
      horaFim: horaFimSessao,
      paginaInicial: paginaInicialCronometro,
      paginaFinal: paginaAtual,
      minutosLidos
    });
  }

  function preencherFormularioSessao(dados) {
    const form = document.getElementById('session-form');
    if (!form) return;

    const inD = document.getElementById('data-sessao');
    const inHI = document.getElementById('hora-inicio');
    const inHF = document.getElementById('hora-fim');
    const inPI = document.getElementById('pagina-inicial');
    const inPF = document.getElementById('pagina-final');
    const inL = document.getElementById('local-sessao');
    const inTempo = document.getElementById('tempo-ativo-minutos');

    if (inD) inD.value = dados.data;
    if (inHI) inHI.value = dados.horaInicio;
    if (inHF) inHF.value = dados.horaFim;
    if (inPI) inPI.value = dados.paginaInicial;
    if (inPF) inPF.value = dados.paginaFinal;
    if (inTempo) inTempo.value = dados.minutosLidos || '';
    if (inL && !inL.value) inL.value = `Leitor ${tipoArquivo ? tipoArquivo.toUpperCase() : ''}`;

    [inHI, inHF, inPI, inPF].forEach(el => {
      if (el) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    const navSessao = document.querySelector('[data-page="leitura"]');
    navSessao?.click();

    if (typeof Util !== 'undefined' && Util.toast) {
      Util.toast('Sessão encerrada! Revise e registre sua leitura.', 'success');
    }
  }

  // ========== AUXILIARES ==========
  function iniciarAudioFantasma() {
    const audio = document.getElementById('audio-fantasma');
    if (audio) { audio.loop = true; audio.play().catch(() => {}); }
  }

  function pararAudioFantasma() {
    const audio = document.getElementById('audio-fantasma');
    if (audio) audio.pause();
  }

  function atualizarProgresso(location) {
    if (!book) return;
    atualizarCacheEls();
    const porcento = Math.round((location.start.percentage || 0) * 100);
    if (els.progressoTexto) els.progressoTexto.textContent = `${porcento}%`;
    if (els.barraProgresso) els.barraProgresso.style.width = `${porcento}%`;
    if (els.paginaAtual) els.paginaAtual.textContent = location.start.index + 1;
  }

  function sincronizarProgresso(location) {
    if (!currentBookInfo.id || !currentBookInfo.bookData || typeof API === 'undefined') return;
    const porcentagem = location.start.percentage || 0;
    const totPaginas = currentBookInfo.bookData.TotalPaginas || 0;
    let paginasLidas = totPaginas ? Math.round(porcentagem * totPaginas) : Math.round(porcentagem * 100);

    if (currentBookInfo.bookData.PaginasLidas !== undefined) currentBookInfo.bookData.PaginasLidas = paginasLidas;

    clearTimeout(timeoutSincronizacao);
    timeoutSincronizacao = setTimeout(() => {
      API.enviar({ acao: 'updateBook', data: currentBookInfo.bookData }).catch(console.warn);
    }, 2500);
  }

  async function carregarUltimoLivro() {
    if (typeof DB === 'undefined' || !DB.obterEstadoLeitor) return false;
    try {
      const reg = await DB.obterEstadoLeitor();
      if (reg && reg.arquivo) {
        await carregarArquivo(reg.arquivo, reg.cfi);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function carregarIndice() {
    const ul = document.getElementById('lista-indice');
    if (!ul || !book) return;
    ul.innerHTML = '';
    book.loaded.navigation.then(nav => {
      nav.toc.forEach(item => {
        const li = document.createElement('li');
        li.className = 'py-1 ps-2';
        li.style.cursor = 'pointer';
        li.textContent = item.label;
        li.addEventListener('click', () => {
          rendition.display(item.href);
          const offcanvasEl = document.getElementById('offcanvasIndice');
          if (offcanvasEl && typeof bootstrap !== 'undefined') {
            bootstrap.Offcanvas.getInstance(offcanvasEl)?.hide();
          }
        });
        ul.appendChild(li);
      });
    });
  }

  function criarTemasRendition() {
    if (!rendition) return;
    rendition.themes.register('claro',  { body: { color: '#1e293b', background: '#ffffff' } });
    rendition.themes.register('sepia',  { body: { color: '#3e2723', background: '#f5e6d3' } });
    rendition.themes.register('escuro', { body: { color: '#e2e8f0', background: '#1e293b' } });
  }

  window.addEventListener('page-activated', (e) => {
    if (e.detail === 'leitor') init();
  });

  if (document.getElementById('page-leitor')?.classList.contains('active')) {
    init();
  }

  return { init };
})();
