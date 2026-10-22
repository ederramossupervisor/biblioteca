/**
 * Jornada de leitura — Calixteca
 * Duas formas de ver a mesma coisa:
 *  - Jornada GERAL (página própria, com filtros): Jornada.init()
 *  - Jornada de um LIVRO (modal, aberto a partir da Biblioteca): Jornada.abrirJornadaLivro(id, titulo)
 * As duas reaproveitam a mesma ação 'timelineAtividades' de js/api.js
 * (que já monta os eventos a partir de sessões, anotações, livros e
 * conquistas reais — nada aqui inventa ou duplica dado).
 */
const Jornada = (() => {
  const MESES_ABREV = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const PRIMEIRO_ANO_APP = 2024; // mesmo ajuste usado em estatisticas.js/retrospectiva.js
  const LIMITE_POR_PAGINA = 40;

  const TITULOS_TIPO = {
    'livro': 'Adicionado à biblioteca',
    'livro-comecou': 'Início da leitura',
    'sessao-leitura': 'Sessão de leitura',
    'anotacao': 'Nova anotação',
    'livro-finalizado': 'Livro concluído',
    'livro-abandonado': 'Livro abandonado',
    'conquista': 'Conquista desbloqueada'
  };

  // ================= JORNADA GERAL (página) =================
  let observerGeral = null;
  let carregandoGeral = false;
  let temMaisGeral = true;
  let cursorGeral = null;
  let geracaoGeral = 0;
  let filtroTipoGeral = 'todos';
  let filtroPeriodoGeral = 'ano';
  let anoGeral = new Date().getFullYear();
  let personalizadoInicio = null;
  let personalizadoFim = null;
  let graficoMensal = null;

  async function init() {
    const page = document.getElementById('page-jornada');
    if (!page || !page.classList.contains('active')) return;

    popularSeletorAno();
    configurarFiltrosGeral();

    geracaoGeral += 1;
    const minhaGeracao = geracaoGeral;
    carregandoGeral = false;
    temMaisGeral = true;
    cursorGeral = null;
    const cont = document.getElementById('jornada-geral-container');
    if (cont) cont.innerHTML = '';
    const vazio = document.getElementById('jornada-geral-vazio');
    if (vazio) vazio.classList.add('d-none');
    const fim = document.getElementById('jornada-geral-fim');
    if (fim) fim.classList.add('d-none');

    configurarObserverGeral();
    carregarGraficoMensal();
    await carregarProximaPaginaGeral(minhaGeracao);
  }

  function popularSeletorAno() {
    const select = document.getElementById('jornada-ano-select');
    if (!select || select.dataset.populado) return;
    const anoCorrente = new Date().getFullYear();
    select.innerHTML = '';
    for (let ano = anoCorrente; ano >= Math.min(PRIMEIRO_ANO_APP, anoCorrente); ano--) {
      const opt = document.createElement('option');
      opt.value = String(ano);
      opt.textContent = String(ano);
      select.appendChild(opt);
    }
    select.value = String(anoGeral);
    select.dataset.populado = '1';
  }

  function configurarFiltrosGeral() {
    const tipoSel = document.getElementById('jornada-filtro-tipo');
    const periodoSel = document.getElementById('jornada-filtro-periodo');
    const anoSel = document.getElementById('jornada-ano-select');
    const personalizadoWrap = document.getElementById('jornada-periodo-personalizado');
    const inicioInput = document.getElementById('jornada-periodo-inicio');
    const fimInput = document.getElementById('jornada-periodo-fim');

    function atualizarVisibilidadePersonalizado() {
      if (personalizadoWrap) personalizadoWrap.classList.toggle('d-none', filtroPeriodoGeral !== 'personalizado');
    }
    atualizarVisibilidadePersonalizado();

    if (tipoSel && !tipoSel.dataset.ligado) {
      tipoSel.value = filtroTipoGeral;
      tipoSel.addEventListener('change', () => { filtroTipoGeral = tipoSel.value; init(); });
      tipoSel.dataset.ligado = '1';
    }
    if (periodoSel && !periodoSel.dataset.ligado) {
      periodoSel.value = filtroPeriodoGeral;
      periodoSel.addEventListener('change', () => {
        filtroPeriodoGeral = periodoSel.value;
        atualizarVisibilidadePersonalizado();
        init();
      });
      periodoSel.dataset.ligado = '1';
    }
    if (anoSel && !anoSel.dataset.ligado) {
      anoSel.addEventListener('change', () => {
        anoGeral = Number(anoSel.value) || new Date().getFullYear();
        init();
      });
      anoSel.dataset.ligado = '1';
    }
    [inicioInput, fimInput].forEach((inp) => {
      if (inp && !inp.dataset.ligado) {
        inp.addEventListener('change', () => {
          personalizadoInicio = inicioInput.value || null;
          personalizadoFim = fimInput.value || null;
          if (personalizadoInicio && personalizadoFim) init();
        });
        inp.dataset.ligado = '1';
      }
    });
  }

  function configurarObserverGeral() {
    const alvo = document.getElementById('jornada-geral-sentinela');
    if (!alvo) return;
    if (observerGeral) observerGeral.disconnect();
    observerGeral = new IntersectionObserver((entradas) => {
      entradas.forEach((entrada) => {
        if (entrada.isIntersecting && !carregandoGeral && temMaisGeral) carregarProximaPaginaGeral(geracaoGeral);
      });
    }, { rootMargin: '200px' });
    observerGeral.observe(alvo);
  }

  // O "ano anterior" e "este ano" do filtro de período são relativos ao ano
  // escolhido no seletor (jornada-ano-select), não necessariamente ao ano
  // corrente — assim dá pra ver, por ex., o "ano anterior" de 2025 (2024).
  function dentroDoPeriodo(dataISO) {
    const d = new Date(dataISO);
    if (isNaN(d.getTime())) return true;
    if (filtroPeriodoGeral === 'ultimos30') {
      const limite = new Date(); limite.setDate(limite.getDate() - 30);
      return d >= limite;
    }
    if (filtroPeriodoGeral === 'ano') return d.getFullYear() === anoGeral;
    if (filtroPeriodoGeral === 'anoAnterior') return d.getFullYear() === (anoGeral - 1);
    if (filtroPeriodoGeral === 'personalizado') {
      if (!personalizadoInicio || !personalizadoFim) return true;
      const ini = new Date(personalizadoInicio + 'T00:00:00');
      const fim = new Date(personalizadoFim + 'T23:59:59');
      return d >= ini && d <= fim;
    }
    return true; // 'todos'
  }

  function dentroDoFiltroTipo(tipo) {
    if (filtroTipoGeral === 'todos') return true;
    if (filtroTipoGeral === 'leituras') return ['livro', 'livro-comecou', 'sessao-leitura', 'livro-finalizado', 'livro-abandonado'].includes(tipo);
    if (filtroTipoGeral === 'anotacoes') return tipo === 'anotacao';
    // Toda meta batida já vira uma conquista (não existe um evento
    // separado de "meta" no banco — ver Etapa 1 da análise), por isso os
    // dois filtros abaixo mostram o mesmo tipo de evento.
    if (filtroTipoGeral === 'conquistas' || filtroTipoGeral === 'metas') return tipo === 'conquista';
    return true;
  }

  // Se a página mais antiga já veio de antes da janela de tempo escolhida,
  // não adianta pedir mais páginas — evita varrer o histórico inteiro à
  // toa quando o filtro é, por ex., "últimos 30 dias".
  function ultrapassouJanela(dataMaisAntiga) {
    if (filtroPeriodoGeral === 'ultimos30') {
      const limite = new Date(); limite.setDate(limite.getDate() - 30);
      return dataMaisAntiga < limite;
    }
    if (filtroPeriodoGeral === 'ano') return dataMaisAntiga.getFullYear() < anoGeral;
    if (filtroPeriodoGeral === 'anoAnterior') return dataMaisAntiga.getFullYear() < (anoGeral - 1);
    if (filtroPeriodoGeral === 'personalizado' && personalizadoInicio) return dataMaisAntiga < new Date(personalizadoInicio + 'T00:00:00');
    return false;
  }

  async function carregarProximaPaginaGeral(geracao) {
    if (carregandoGeral || !temMaisGeral) return;
    if (geracao !== geracaoGeral) return;
    carregandoGeral = true;

    const sentinela = document.getElementById('jornada-geral-sentinela');
    if (sentinela) sentinela.classList.remove('d-none');

    try {
      const resp = await API.enviar({ acao: 'timelineAtividades', antesDe: cursorGeral, limite: LIMITE_POR_PAGINA });
      if (geracao !== geracaoGeral) return;
      if (!resp || !Array.isArray(resp.itens)) throw new Error('Resposta inválida');

      if (resp.itens.length > 0) cursorGeral = resp.itens[resp.itens.length - 1].data;
      temMaisGeral = !!resp.temMais;

      if (resp.itens.length > 0 && filtroPeriodoGeral !== 'todos') {
        const maisAntigo = new Date(resp.itens[resp.itens.length - 1].data);
        if (ultrapassouJanela(maisAntigo)) temMaisGeral = false;
      }

      const filtrados = resp.itens.filter((ev) => dentroDoFiltroTipo(ev.tipo) && dentroDoPeriodo(ev.data));
      renderizarItensGeral(filtrados);

      // Essa leva não trouxe nada que passasse pelos filtros, mas ainda há
      // mais no histórico — busca a próxima página automaticamente, sem
      // esperar o usuário rolar de novo (senão a tela pareceria travada).
      if (filtrados.length === 0 && temMaisGeral) {
        carregandoGeral = false;
        await carregarProximaPaginaGeral(geracao);
        return;
      }

      const contVazio = (document.getElementById('jornada-geral-container') || {}).children;
      if ((!contVazio || contVazio.length === 0) && !temMaisGeral) {
        const vazio = document.getElementById('jornada-geral-vazio');
        if (vazio) vazio.classList.remove('d-none');
      }
    } catch (e) {
      if (geracao !== geracaoGeral) return;
      console.warn('Falha ao carregar Jornada de leitura:', e);
      temMaisGeral = false;
    } finally {
      if (geracao === geracaoGeral) {
        carregandoGeral = false;
        if (!temMaisGeral) {
          if (sentinela) sentinela.classList.add('d-none');
          const fim = document.getElementById('jornada-geral-fim');
          if (fim && cursorGeral) fim.classList.remove('d-none');
        }
      }
    }
  }

  function renderizarItensGeral(itens) {
    const cont = document.getElementById('jornada-geral-container');
    if (!cont || itens.length === 0) return;
    const vazio = document.getElementById('jornada-geral-vazio');
    if (vazio) vazio.classList.add('d-none');
    itens.forEach((ev) => cont.appendChild(criarElementoEvento(ev, false)));
  }

  async function carregarGraficoMensal() {
    const canvas = document.getElementById('jornada-grafico-mensal');
    const titulo = document.getElementById('jornada-grafico-titulo');
    if (titulo) titulo.textContent = `Sua jornada — ${anoGeral}`;
    if (!canvas || typeof Chart === 'undefined') return;
    try {
      const dados = await API.enviar({ acao: 'stats', ano: anoGeral });
      const fpm = dados && dados.finalizadosPorMes;
      if (!fpm) return;
      const ctx = canvas.getContext('2d');
      if (graficoMensal) graficoMensal.destroy();
      const escuro = document.body.classList.contains('dark-mode');
      const corTexto = escuro ? '#EDE7DA' : '#2B2721';
      const corGrade = escuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
      const primaria = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#5C6B5A';
      graficoMensal = new Chart(ctx, {
        type: 'bar',
        data: { labels: fpm.labels, datasets: [{ label: 'Livros finalizados', data: fpm.valores, backgroundColor: primaria, borderRadius: 4 }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1, color: corTexto }, grid: { color: corGrade } },
            x: { ticks: { color: corTexto }, grid: { color: corGrade } }
          }
        }
      });
    } catch (e) {
      console.warn('Falha ao carregar o gráfico mensal da Jornada:', e);
    }
  }

  // ================= JORNADA DE UM LIVRO (modal) =================
  function garantirModalLivro() {
    if (document.getElementById('modal-jornada-livro')) return;
    const html = `
      <div class="modal fade" id="modal-jornada-livro" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title"><i class="fas fa-timeline me-2"></i>Jornada — <span id="jornada-livro-titulo"></span></h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button>
            </div>
            <div class="modal-body">
              <div id="jornada-livro-carregando" class="text-center text-muted py-4">
                <div class="spinner-border spinner-border-sm me-2"></div>Carregando jornada...
              </div>
              <div id="jornada-livro-vazio" class="jornada-vazio d-none">Nenhum evento registrado ainda para este livro.</div>
              <div class="jornada-timeline" id="jornada-livro-container" style="max-height: 60vh; overflow-y: auto;"></div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Fechar</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  async function abrirJornadaLivro(livroID, titulo) {
    if (!livroID) return;
    garantirModalLivro();
    const tituloEl = document.getElementById('jornada-livro-titulo');
    if (tituloEl) tituloEl.textContent = titulo || '';
    const cont = document.getElementById('jornada-livro-container');
    const carregando = document.getElementById('jornada-livro-carregando');
    const vazio = document.getElementById('jornada-livro-vazio');
    if (cont) cont.innerHTML = '';
    if (vazio) vazio.classList.add('d-none');
    if (carregando) carregando.classList.remove('d-none');

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-jornada-livro'));
    modal.show();

    try {
      // Um livro só, mesmo com muitas sessões/anotações, dificilmente passa
      // de algumas centenas de eventos — não precisa da paginação da
      // Jornada geral aqui, um único pedido já cobre tudo.
      const resp = await API.enviar({ acao: 'timelineAtividades', livroID, limite: 500 });
      if (carregando) carregando.classList.add('d-none');
      const itens = (resp && resp.itens) || [];
      if (itens.length === 0) {
        if (vazio) vazio.classList.remove('d-none');
        return;
      }
      itens.forEach((ev) => { if (cont) cont.appendChild(criarElementoEvento(ev, true)); });
    } catch (e) {
      if (carregando) carregando.classList.add('d-none');
      Util.toast('Erro ao carregar a jornada do livro: ' + e.message, 'danger');
    }
  }

  // ================= RENDERIZAÇÃO COMPARTILHADA =================
  function formatarDataCurta(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { dia: '--', mes: '', hora: '' };
    return {
      dia: String(d.getDate()).padStart(2, '0'),
      mes: MESES_ABREV[d.getMonth()],
      hora: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };
  }

  function criarElementoEvento(ev, modoLivro) {
    const div = document.createElement('div');
    div.className = 'jornada-evento';
    const { dia, mes, hora } = formatarDataCurta(ev.data);

    const clicavel = ev.tipo === 'anotacao' || ev.tipo === 'sessao-leitura' ||
      (!modoLivro && ['livro', 'livro-comecou', 'livro-finalizado', 'livro-abandonado'].includes(ev.tipo));

    const linhaLivro = (!modoLivro && ev.titulo && ev.tipo !== 'conquista')
      ? `<div class="jornada-livro-relacionado"><i class="fas fa-book me-1" aria-hidden="true"></i>${Util.escapeHTML(ev.titulo)}</div>`
      : '';

    // Só mostra o horário quando ele existe de verdade no banco. Anotações
    // e datas de livro (cadastro/início/fim) são salvas só como "dia", sem
    // hora — e sessões sem horário de início preenchido também não têm
    // como saber a que horas aconteceram. Mostrar "00:00" nesses casos
    // seria uma hora inventada, não um dado real.
    const linhaHora = ev.temHora ? `<div class="jornada-hora text-muted">${hora}</div>` : '';

    div.innerHTML = `
      <div class="jornada-data-col">
        <span class="jornada-dia">${dia}</span>
        <span class="jornada-mes">${mes}</span>
      </div>
      <div class="jornada-marcador-col">
        <div class="jornada-ponto timeline-marcador-${ev.tipo}"><i class="${Util.escapeHTML(ev.icone || 'fas fa-circle')}" aria-hidden="true"></i></div>
      </div>
      <div class="jornada-conteudo ${clicavel ? 'jornada-clicavel' : ''}">
        <div class="jornada-tipo-evento">${TITULOS_TIPO[ev.tipo] || 'Atividade'}</div>
        <div class="jornada-detalhe">${Util.escapeHTML(ev.detalhe || '')}</div>
        ${linhaLivro}
        ${linhaHora}
      </div>`;

    if (clicavel) {
      const alvo = div.querySelector('.jornada-conteudo');
      alvo.setAttribute('role', 'button');
      alvo.setAttribute('tabindex', '0');
      alvo.setAttribute('aria-label', `${TITULOS_TIPO[ev.tipo] || 'Evento'}: ${ev.detalhe || ''}`);
      const acionar = () => tratarCliqueEvento(ev);
      alvo.addEventListener('click', acionar);
      alvo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); acionar(); }
      });
    }

    return div;
  }

  function tratarCliqueEvento(ev) {
    const modalLivroEl = document.getElementById('modal-jornada-livro');
    if (modalLivroEl) {
      const inst = bootstrap.Modal.getInstance(modalLivroEl);
      if (inst) inst.hide();
    }

    if (ev.tipo === 'anotacao') {
      if (typeof activatePageGlobal === 'function') activatePageGlobal('anotacoes');
      setTimeout(() => {
        if (typeof Anotacoes !== 'undefined' && Anotacoes.destacarAnotacao) Anotacoes.destacarAnotacao(ev.id);
      }, 300);
      return;
    }

    if (ev.tipo === 'sessao-leitura') {
      if (typeof activatePageGlobal === 'function') activatePageGlobal('leitura');
      let jaChamou = false;
      const aoFicarPronto = () => {
        if (jaChamou) return;
        jaChamou = true;
        window.removeEventListener('leitura:pronto', aoFicarPronto);
        if (typeof Leitura !== 'undefined' && Leitura.editarSessaoPorId) Leitura.editarSessaoPorId(ev.id);
      };
      window.addEventListener('leitura:pronto', aoFicarPronto);
      // Se a página de Leitura já estava aberta, o init() dela não roda de
      // novo (então o evento 'leitura:pronto' não dispararia) — chama
      // direto depois de um instante como reforço.
      setTimeout(aoFicarPronto, 700);
      return;
    }

    if (ev.livroID) {
      if (typeof activatePageGlobal === 'function') activatePageGlobal('biblioteca');
      setTimeout(() => {
        if (typeof Biblioteca !== 'undefined' && Biblioteca.abrirDetalhes) Biblioteca.abrirDetalhes(ev.livroID);
      }, 350);
    }
  }

  return { init, abrirJornadaLivro };
})();
