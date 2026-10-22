const Dashboard = (() => {
  let currentLivroIndex = 0;
  let livrosLendoList = [];
  let livroAtualID = null;
  let containerCard = null;
  const skeletonIds = [
    'card-livros-mes', 'card-livros-ano', 'card-paginas-hoje',
    'card-paginas-semana', 'card-horas', 'card-sequencia',
    'livro-atual-titulo', 'livro-atual-progresso'
  ];

  async function init() {
    const dashPage = document.getElementById('page-dashboard');
    if (!dashPage || !dashPage.classList.contains('active')) return;

    console.log('📊 Carregando dashboard...');

    // Mostra o que já temos em cache local na hora (stale-while-revalidate),
    // sem esperar a rede pra pintar a tela — só cai no skeleton se não
    // houver nada salvo ainda.
    let temCacheLocal = false;
    try {
      const cached = await DB.obterDashboard();
      if (cached) {
        temCacheLocal = true;
        ocultarSkeletons();
        preencherCards(cached);
        } else {
        mostrarSkeletons();
      }
    } catch (e) {
      mostrarSkeletons();
    }

    try {
      const dados = await API.enviar({ acao: 'dashboard' });
      if (dados && !dados.erro) {
        ocultarSkeletons();
        preencherCards(dados);
        DB.salvarDashboard(dados).catch(e => console.warn('Cache dashboard falhou:', e));
      } else {
        throw new Error(dados?.erro || 'Dados inválidos');
      }
    } catch (e) {
      console.warn('Falha na API ao atualizar dashboard.');
      if (temCacheLocal) {
        Util.toast('Modo offline - dados do último acesso.', 'info');
      } else {
        ocultarSkeletons();
        Util.toast('Sem conexão e nenhum dado em cache.', 'danger');
      }
    }

    // Mapa de calor de leitura (mês por vez, com pílulas Jan-Dez) — busca à
    // parte, sem atrasar/quebrar o resto do Dashboard se falhar (mesmo
    // padrão do Insights Avançados em Estatísticas). Movido de Estatísticas
    // pra cá; usa a ação 'heatmapAno'.
    carregarHeatmapDashboard();

    // Últimos livros lidos (capas) — busca à parte, mesmo padrão do
    // mapa de calor: não atrasa nem quebra o resto do Dashboard se falhar.
    carregarUltimosLidos();
    // Timeline de atividades (scroll infinito) — módulo à parte (js/timeline.js),
    // não atrasa nem quebra o resto do Dashboard se falhar.
    if (typeof Timeline !== 'undefined') Timeline.init();
  }

  async function carregarUltimosLidos() {
    const container = document.getElementById('ultimos-lidos-container');
    if (!container) return;
    try {
      // 'listAllBooks' já é uma ação cacheável em API (TTL de 45s) — se a
      // Biblioteca já pediu a mesma lista há pouco, reaproveita sem nova
      // chamada de rede.
      const resp = await API.enviar({ acao: 'listAllBooks' });
      if (!Array.isArray(resp)) return;

      ultimosLidosTodos = resp
        .filter(l => l.Status === 'Finalizado' && l.DataTérmino)
        .sort((a, b) => new Date(b.DataTérmino) - new Date(a.DataTérmino));

      renderizarUltimosLidos();
    } catch (e) {
      console.warn('Falha ao carregar últimos livros lidos:', e);
    }
  }

  function renderizarUltimosLidos() {
    const container = document.getElementById('ultimos-lidos-container');
    if (!container) return;

    const total = ehMobile() ? ULTIMOS_LIDOS_MOBILE : ULTIMOS_LIDOS_DESKTOP;
    const livros = ultimosLidosTodos.slice(0, total);

    if (livros.length === 0) {
      container.innerHTML = '<div class="text-muted small" id="ultimos-lidos-vazio">Nenhum livro finalizado ainda.</div>';
      return;
    }

    // Grade (não tira com scroll): o número de colunas acompanha a
    // quantidade de livros a mostrar, pra ocupar exatamente a largura do
    // card, sem barra de rolagem e sem sobra de espaço em branco.
    const grade = document.createElement('div');
    grade.className = 'ultimos-lidos-grade';
    grade.style.gridTemplateColumns = `repeat(${livros.length}, 1fr)`;

    livros.forEach(livro => {
      const item = document.createElement('div');
      item.className = 'ultimos-lidos-item';
      item.dataset.id = livro.ID;

      const capa = document.createElement('div');
      capa.className = 'ultimos-lidos-capa';
      capa.innerHTML = livro.URLCapa
        ? `<img src="${livro.URLCapa}" alt="Capa de ${Util.escapeHTML(livro.Título || '')}" loading="lazy">`
        : '<i class="fas fa-book text-muted"></i>';
      item.appendChild(capa);

      const titulo = document.createElement('span');
      titulo.className = 'ultimos-lidos-titulo';
      titulo.textContent = livro.Título || 'Sem título';
      item.appendChild(titulo);

      item.title = livro.Título || 'Sem título';
      item.addEventListener('click', () => {
        // Leva pra Biblioteca, onde dá pra abrir os detalhes do livro
        // (o modal de detalhes depende do estado interno daquele módulo,
        // por isso não é aberto direto daqui).
        if (typeof activatePageGlobal === 'function') activatePageGlobal('biblioteca');
      });

      grade.appendChild(item);
    });

    container.innerHTML = '';
    container.appendChild(grade);
  }

  // Recalcula quantas capas mostrar (5/10) ao cruzar o breakpoint mobile,
  // sem nova chamada de rede — só reaproveita a lista já buscada.
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (ultimosLidosTodos.length > 0) renderizarUltimosLidos();
    }, 200);
  });

  const MOBILE_BREAKPOINT = 767;

  function ehMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  // Últimos livros lidos: 5 capas no mobile, 15 no desktop.
  const ULTIMOS_LIDOS_MOBILE = 5;
  const ULTIMOS_LIDOS_DESKTOP = 15;
  let ultimosLidosTodos = []; // lista completa (já filtrada/ordenada) em cache local
  let resizeTimer = null;

  /* ==================== MAPA DE CALOR DE LEITURA ====================
     Movido de Estatísticas pro Dashboard: mini calendário de um mês por
     vez, com uma faixa de 12 pílulas (Jan a Dez) como seletor. Sempre
     mostra o ano corrente (o Dashboard não tem seletor de ano). Cada
     bloquinho mostra a quantidade de páginas lidas naquele dia (no centro)
     e o dia do mês bem pequeno no canto superior esquerdo. */
  const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const DIAS_SEMANA_ABREV = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const anoHeatmap = new Date().getFullYear();
  let mesHeatmapSelecionado = new Date().getMonth() + 1;
  let heatmapMapaPaginasAtual = {};
  let heatmapMaxPagAtual = 1;

  function temaEscuro() {
    return document.body.classList.contains('dark-mode');
  }

  function diasNoMesHeatmap(ano, mes) {
    return new Date(ano, mes, 0).getDate(); // mes 1-12
  }

  function formatarDataBrasileira(iso) {
    const partes = iso.split('-');
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }

  async function carregarHeatmapDashboard() {
    const container = document.getElementById('heatmap-container');
    if (!container) return;
    try {
      const resp = await API.enviar({ acao: 'heatmapAno', ano: anoHeatmap });
      if (resp && Array.isArray(resp.heatmap)) criarHeatmapDashboard(resp.heatmap);
    } catch (e) {
      console.warn('Falha ao carregar mapa de calor:', e);
    }
  }

  function criarHeatmapDashboard(heatmapData) {
    const container = document.getElementById('heatmap-container');
    if (!container) return;
    container.innerHTML = '';

    heatmapMapaPaginasAtual = {};
    heatmapMaxPagAtual = 1;
    if (heatmapData && heatmapData.length) {
      heatmapData.forEach(d => { heatmapMapaPaginasAtual[d.data] = d.paginas; });
      heatmapMaxPagAtual = Math.max(...heatmapData.map(d => d.paginas), 1);
    }

    const seletor = document.createElement('div');
    seletor.className = 'heatmap-seletor-mes';
    MESES_ABREV.forEach((nomeMes, idx) => {
      const mes = idx + 1;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'heatmap-mes-pill' + (mes === mesHeatmapSelecionado ? ' ativo' : '');
      pill.textContent = nomeMes;
      pill.addEventListener('click', () => {
        mesHeatmapSelecionado = mes;
        renderizarMesHeatmapDashboard();
      });
      seletor.appendChild(pill);
    });
    container.appendChild(seletor);

    const grid = document.createElement('div');
    grid.id = 'heatmap-mes-grid';
    container.appendChild(grid);

    renderizarMesHeatmapDashboard();
  }

  function renderizarMesHeatmapDashboard() {
    const grid = document.getElementById('heatmap-mes-grid');
    if (!grid) return;
    grid.innerHTML = '';

    document.querySelectorAll('#heatmap-container .heatmap-mes-pill').forEach((pill, idx) => {
      pill.classList.toggle('ativo', idx + 1 === mesHeatmapSelecionado);
    });

    const cabecalho = document.createElement('div');
    cabecalho.className = 'heatmap-mes-cabecalho';
    DIAS_SEMANA_ABREV.forEach(letra => {
      const span = document.createElement('span');
      span.textContent = letra;
      cabecalho.appendChild(span);
    });
    grid.appendChild(cabecalho);

    const corpo = document.createElement('div');
    corpo.className = 'heatmap-mes-corpo';

    const totalDias = diasNoMesHeatmap(anoHeatmap, mesHeatmapSelecionado);
    const primeiroDiaSemana = new Date(anoHeatmap, mesHeatmapSelecionado - 1, 1).getDay(); // 0=Dom

    for (let i = 0; i < primeiroDiaSemana; i++) {
      const vazio = document.createElement('div');
      vazio.className = 'heatmap-mes-dia heatmap-mes-dia-vazia';
      corpo.appendChild(vazio);
    }

    // Data local (toISOString usa UTC e vira o dia à noite no fuso do Brasil)
    const agoraLocal = new Date();
    const hojeIso = `${agoraLocal.getFullYear()}-${String(agoraLocal.getMonth() + 1).padStart(2, '0')}-${String(agoraLocal.getDate()).padStart(2, '0')}`;

    for (let dia = 1; dia <= totalDias; dia++) {
      const iso = `${anoHeatmap}-${String(mesHeatmapSelecionado).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      const paginas = heatmapMapaPaginasAtual[iso] || 0;
      const intensidade = paginas / heatmapMaxPagAtual;

      const celula = document.createElement('div');
      celula.className = 'heatmap-mes-dia';
      if (iso === hojeIso) celula.classList.add('heatmap-mes-dia-hoje');
      celula.style.background = getHeatColorDashboard(intensidade);
      celula.title = `${formatarDataBrasileira(iso)}: ${paginas} página${paginas === 1 ? '' : 's'}`;

      const numeroDia = document.createElement('span');
      numeroDia.className = 'heatmap-mes-dia-numero';
      numeroDia.textContent = dia;
      celula.appendChild(numeroDia);

      if (paginas > 0) {
        const qtdPaginas = document.createElement('span');
        qtdPaginas.className = 'heatmap-mes-dia-paginas';
        qtdPaginas.textContent = paginas;
        celula.appendChild(qtdPaginas);
      }

      corpo.appendChild(celula);
    }

    grid.appendChild(corpo);
  }

  function getHeatColorDashboard(intensidade) {
    if (temaEscuro()) {
      if (intensidade === 0) return '#2A2820';   // fundo escuro, sem leitura
      if (intensidade < 0.25) return '#3D4739';
      if (intensidade < 0.5) return '#526350';
      if (intensidade < 0.75) return '#6E8266';
      return '#9DAE96';                          // dia mais intenso, bem visível no escuro
    }
    if (intensidade === 0) return '#EDEAE2';   // papel, sem leitura
    if (intensidade < 0.25) return '#C9D2C4';  // musgo bem claro
    if (intensidade < 0.5) return '#9DAE96';   // musgo claro
    if (intensidade < 0.75) return '#6E8266';  // musgo médio
    return '#46543F';                          // musgo profundo (dia mais intenso)
  }

  function mostrarSkeletons() {
    skeletonIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.add('skeleton-placeholder');
        if (id === 'livro-atual-titulo') el.textContent = 'Carregando...';
        if (id === 'livro-atual-progresso') el.textContent = '';
        if (id.startsWith('card-')) el.textContent = '...';
      }
    });
    const capa = document.getElementById('livro-atual-capa');
    if (capa) capa.innerHTML = '<div class="skeleton-placeholder" style="width:50px;height:70px;border-radius:4px;"></div>';
  }

  function ocultarSkeletons() {
    skeletonIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('skeleton-placeholder');
    });
    const capa = document.getElementById('livro-atual-capa');
    if (capa) capa.innerHTML = '';
  }

  function preencherCards(d) {
    containerCard = document.getElementById('livro-atual-card');
    if (!containerCard) return;

    livrosLendoList = d.livrosLendo || [];
    if (d.livroAtual && livrosLendoList.length > 0) {
      currentLivroIndex = livrosLendoList.findIndex(l => l.ID === d.livroAtual.ID);
      if (currentLivroIndex < 0) currentLivroIndex = 0;
    } else {
      currentLivroIndex = 0;
    }
    livroAtualID = d.livroAtual ? d.livroAtual.ID : null;

    renderizarLivroAtual();
    criarControlesNavegacao();
    adicionarSwipe();

    animarContador('card-livros-mes', d.livrosFinalizadosMes);
    animarContador('card-livros-ano', d.livrosFinalizadosAno);
    animarContador('card-paginas-hoje', d.paginasHoje);
    animarContador('card-paginas-semana', d.paginasSemana);
    animarContador('card-horas', d.horasTotal);
    animarContador('card-sequencia', d.sequenciaAtual);

    document.getElementById('meta-texto').textContent =
      `${d.livrosFinalizadosAno} de ${d.metaLivros} livros (${d.percentualMeta}%)`;
    const barra = document.getElementById('barra-meta');
    barra.style.width = d.percentualMeta + '%';
    barra.textContent = d.percentualMeta + '%';
    barra.setAttribute('aria-valuenow', d.percentualMeta);
  }

  function animarContador(id, valorFinal) {
    const el = document.getElementById(id);
    if (!el) return;
    const valorInicial = 0;
    const duracao = 800;
    const inicio = performance.now();
    const passo = (agora) => {
      const decorrido = agora - inicio;
      const progresso = Math.min(decorrido / duracao, 1);
      const valorAtual = Math.round(valorInicial + (valorFinal - valorInicial) * progresso);
      el.textContent = id === 'card-horas' ? valorAtual : valorAtual + (id === 'card-sequencia' ? ' dias' : '');
      if (progresso < 1) {
        requestAnimationFrame(passo);
      } else {
        el.textContent = id === 'card-horas' ? valorFinal : valorFinal + (id === 'card-sequencia' ? ' dias' : '');
      }
    };
    requestAnimationFrame(passo);
  }

  function renderizarLivroAtual() {
    if (!containerCard) return;
    const livro = livrosLendoList.length > 0 ? livrosLendoList[currentLivroIndex] : null;
    const tituloEl = document.getElementById('livro-atual-titulo');
    const progressoEl = document.getElementById('livro-atual-progresso');
    const capaEl = document.getElementById('livro-atual-capa');
    const previsaoEl = document.getElementById('livro-atual-previsao');
    const tempoRestEl = document.getElementById('livro-atual-tempo-restante');

    if (livro) {
      const progresso = livro.totalPag > 0 ? Math.round((livro.pagLidas / livro.totalPag) * 100) : 0;
      if (tituloEl) tituloEl.textContent = livro.titulo;
      if (progressoEl) progressoEl.textContent = `${livro.pagLidas || 0} de ${livro.totalPag} páginas (${progresso}%)`;
      if (capaEl) {
        capaEl.innerHTML = livro.urlCapa
          ? `<img src="${livro.urlCapa}" alt="Capa" class="img-fluid rounded" style="max-height:70px;">`
          : '';
      }

      // Cor dinâmica extraída da capa (ver Util.extrairCorMedia) — aplica no
      // card via CSS custom property; se a imagem não puder ser lida (ex.:
      // CORS), simplesmente não colore nada, sem quebrar a tela.
      if (livro.urlCapa) {
        Util.extrairCorMedia(livro.urlCapa).then(cor => {
          if (containerCard) {
            containerCard.style.setProperty('--capa-cor', cor ? `rgba(${cor}, 0.18)` : 'transparent');
          }
        });
      } else if (containerCard) {
        containerCard.style.setProperty('--capa-cor', 'transparent');
      }

      // Previsão de data (individual)
      if (previsaoEl) {
        if (livro.previsaoTermino) {
          const dataPrev = new Date(livro.previsaoTermino);
          const hoje = new Date();
          const diffDias = Math.ceil((dataPrev - hoje) / (1000 * 60 * 60 * 24));
          const dataFormatada = dataPrev.toLocaleDateString('pt-BR');
          let textoPrevisao = '';
          if (diffDias <= 0) {
            textoPrevisao = '<i class="fa-solid fa-hands-clapping"></i> Você deve terminar hoje!';
          } else if (diffDias === 1) {
            textoPrevisao = '<i class="fa-solid fa-calendar-days"></i> Previsão: amanhã';
          } else {
            textoPrevisao = `<i class="fa-solid fa-calendar-days"></i> Previsão: ${dataFormatada} (${diffDias} dias)`;
          }
          previsaoEl.innerHTML = textoPrevisao;
          previsaoEl.classList.remove('d-none');
        } else {
          previsaoEl.classList.add('d-none');
        }
      }

            // Tempo restante e velocidade (individual)
      if (tempoRestEl) {
        if (livro.tempoRestanteMinutos && livro.tempoRestanteMinutos > 0) {
          const horas = Math.floor(livro.tempoRestanteMinutos / 60);
          const minutos = livro.tempoRestanteMinutos % 60;
          let texto = '⏱️ ';
          if (horas > 0) texto += `${horas}h `;
          if (minutos > 0) texto += `${minutos}min`;
          texto += ' restantes';
          if (livro.velocidadeMedia) {
            texto += ` (${livro.velocidadeMedia} pág/h)`;
          }
          tempoRestEl.textContent = texto;
          tempoRestEl.classList.remove('d-none');
        } else {
          tempoRestEl.classList.add('d-none');
        }
      }
    } else {
      if (tituloEl) tituloEl.textContent = 'Nenhum livro em andamento';
      if (progressoEl) progressoEl.textContent = '';
      if (capaEl) capaEl.innerHTML = '';
      if (previsaoEl) previsaoEl.classList.add('d-none');
      if (tempoRestEl) tempoRestEl.classList.add('d-none');
      if (containerCard) containerCard.style.setProperty('--capa-cor', 'transparent');
    }
  }

  function criarControlesNavegacao() {
    const oldLeft = document.getElementById('livro-atual-seta-left');
    if (oldLeft) oldLeft.remove();
    const oldRight = document.getElementById('livro-atual-seta-right');
    if (oldRight) oldRight.remove();
    const oldInd = document.getElementById('livro-atual-indicador');
    if (oldInd) oldInd.remove();

    if (livrosLendoList.length <= 1) return;

    const btnLeft = document.createElement('button');
    btnLeft.id = 'livro-atual-seta-left';
    btnLeft.className = 'btn btn-link text-secondary position-absolute start-0 top-50 translate-middle-y px-2';
    btnLeft.innerHTML = '<i class="fas fa-chevron-left"></i>';
    btnLeft.style.opacity = '0.6';
    btnLeft.style.fontSize = '1.2rem';
    btnLeft.addEventListener('click', (e) => { e.stopPropagation(); mudarLivro(-1); });

    const btnRight = document.createElement('button');
    btnRight.id = 'livro-atual-seta-right';
    btnRight.className = 'btn btn-link text-secondary position-absolute end-0 top-50 translate-middle-y px-2';
    btnRight.innerHTML = '<i class="fas fa-chevron-right"></i>';
    btnRight.style.opacity = '0.6';
    btnRight.style.fontSize = '1.2rem';
    btnRight.addEventListener('click', (e) => { e.stopPropagation(); mudarLivro(1); });

    const indicador = document.createElement('small');
    indicador.id = 'livro-atual-indicador';
    indicador.className = 'text-muted ms-2';
    indicador.textContent = `${currentLivroIndex + 1}/${livrosLendoList.length}`;

    containerCard.style.position = 'relative';
    containerCard.appendChild(btnLeft);
    containerCard.appendChild(btnRight);

    const tituloEl = document.getElementById('livro-atual-titulo');
    if (tituloEl) tituloEl.parentNode.appendChild(indicador);
  }

  async function mudarLivro(delta) {
    if (livrosLendoList.length === 0) return;
    currentLivroIndex = (currentLivroIndex + delta + livrosLendoList.length) % livrosLendoList.length;
    const novoLivro = livrosLendoList[currentLivroIndex];
    if (novoLivro && novoLivro.ID !== livroAtualID) {
      renderizarLivroAtual();
      livroAtualID = novoLivro.ID;
      if (navigator.onLine) {
        await API.enviar({ acao: 'setLivroAtual', livroID: novoLivro.ID });
      } else {
        Util.toast('Modo offline - preferência será salva ao conectar.', 'info');
      }
    }
  }

  function adicionarSwipe() {
    if (!containerCard) return;
    let touchStartX = 0;
    containerCard.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    containerCard.addEventListener('touchend', (e) => {
      if (touchStartX === 0) return;
      const diff = e.changedTouches[0].screenX - touchStartX;
      if (Math.abs(diff) > 50) mudarLivro(diff > 0 ? -1 : 1);
      touchStartX = 0;
    });
  }

  return { init };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('page-dashboard')?.classList.contains('active')) {
      Dashboard.init();
    }
  });
} else {
  if (document.getElementById('page-dashboard')?.classList.contains('active')) {
    Dashboard.init();
  }
}
