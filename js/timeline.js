/**
 * Timeline de atividades do Dashboard: feed unificado (sessões de leitura,
 * livros incluídos, anotações e conquistas/metas batidas), mais recente no
 * topo, com scroll infinito buscando páginas mais antigas sob demanda no
 * Apps Script (ação 'timelineAtividades' em Code.gs).
 */
const Timeline = (() => {
  const LIMITE_POR_PAGINA = 20;

  let observer = null;
  let carregando = false;
  let temMais = true;
  let cursorAntesDe = null; // data (ISO) do último item carregado
  let primeiraCarga = true;
  let geracaoAtual = 0; // incrementa a cada init() — descarta respostas de uma inicialização anterior ainda em voo

  function container() {
    return document.getElementById('timeline-container');
  }
  function sentinela() {
    return document.getElementById('timeline-sentinela');
  }
  function elFim() {
    return document.getElementById('timeline-fim');
  }

  async function init() {
    const cont = container();
    if (!cont) return;

    // Reinicia o estado a cada abertura do Dashboard (evita duplicar itens
    // se o usuário sair e voltar pra tela, ou se init() for chamado mais
    // de uma vez em sequência — ex.: navegação inicial + atalho da PWA).
    geracaoAtual += 1;
    const minhaGeracao = geracaoAtual;
    carregando = false;
    temMais = true;
    cursorAntesDe = null;
    primeiraCarga = true;
    cont.innerHTML = '';

    configurarObserver();
    await carregarProximaPagina(minhaGeracao);
  }

  function configurarObserver() {
    const alvo = sentinela();
    if (!alvo) return;
    if (observer) observer.disconnect();

    observer = new IntersectionObserver((entradas) => {
      entradas.forEach(entrada => {
        if (entrada.isIntersecting && !carregando && temMais) {
          carregarProximaPagina(geracaoAtual);
        }
      });
    }, { rootMargin: '200px' });

    observer.observe(alvo);
  }

  async function carregarProximaPagina(geracao) {
    if (carregando || !temMais) return;
    if (geracao !== geracaoAtual) return; // uma inicialização mais nova já assumiu
    carregando = true;

    const alvoSentinela = sentinela();
    if (alvoSentinela) alvoSentinela.classList.remove('d-none');

    try {
      const resp = await API.enviar({
        acao: 'timelineAtividades',
        antesDe: cursorAntesDe,
        limite: LIMITE_POR_PAGINA
      });

      if (geracao !== geracaoAtual) return; // resposta de uma geração antiga — descarta

      if (!resp || !Array.isArray(resp.itens)) {
        throw new Error('Resposta inválida');
      }

      renderizarItens(resp.itens);

      if (resp.itens.length > 0) {
        cursorAntesDe = resp.itens[resp.itens.length - 1].data;
      }
      temMais = !!resp.temMais;

      if (primeiraCarga && resp.itens.length === 0) {
        const vazio = document.getElementById('timeline-vazio');
        if (vazio) vazio.classList.remove('d-none');
      }
      primeiraCarga = false;
    } catch (e) {
      if (geracao !== geracaoAtual) return; // erro de uma geração antiga — ignora
      console.warn('Falha ao carregar timeline de atividades:', e);
      // Não trava o resto do Dashboard — só para de tentar carregar mais
      // páginas até a próxima abertura da tela.
      temMais = false;
    } finally {
      if (geracao === geracaoAtual) {
        carregando = false;
        // A sentinela só pode ficar escondida (d-none) quando realmente não
        // há mais itens: como IntersectionObserver não detecta elementos com
        // display:none, escondê-la incondicionalmente aqui travava o scroll
        // infinito depois da primeira página (ela nunca mais "reaparecia"
        // pro observer notar a rolagem seguinte).
        if (!temMais) {
          if (alvoSentinela) alvoSentinela.classList.add('d-none');
          const fim = elFim();
          if (fim && cursorAntesDe) fim.classList.remove('d-none');
        }
      }
    }
  }

  function renderizarItens(itens) {
    const cont = container();
    if (!cont) return;

    const vazio = document.getElementById('timeline-vazio');
    if (vazio && itens.length > 0) vazio.classList.add('d-none');

    itens.forEach(item => {
      cont.appendChild(criarElementoItem(item));
    });
  }

  function criarElementoItem(item) {
    const linha = document.createElement('div');
    linha.className = 'timeline-item';

    const marcador = document.createElement('div');
    marcador.className = `timeline-marcador timeline-marcador-${item.tipo}`;
    marcador.innerHTML = `<i class="${Util.escapeHTML(item.icone || 'fas fa-circle')}"></i>`;
    linha.appendChild(marcador);

    const corpo = document.createElement('div');
    corpo.className = 'timeline-corpo';

    if (item.urlCapa) {
      const capa = document.createElement('img');
      capa.className = 'timeline-capa';
      capa.src = item.urlCapa;
      capa.alt = '';
      capa.loading = 'lazy';
      corpo.appendChild(capa);
    }

    const texto = document.createElement('div');
    texto.className = 'timeline-texto';

    const titulo = document.createElement('div');
    titulo.className = 'timeline-titulo';
    titulo.textContent = item.titulo || '';
    texto.appendChild(titulo);

    const detalhe = document.createElement('div');
    detalhe.className = 'timeline-detalhe text-muted small';
    detalhe.textContent = item.detalhe || '';
    texto.appendChild(detalhe);

    const data = document.createElement('div');
    data.className = 'timeline-data text-muted';
    data.textContent = formatarData(item.data);
    texto.appendChild(data);

    corpo.appendChild(texto);
    linha.appendChild(corpo);

    if (item.livroID) {
      linha.style.cursor = 'pointer';
      linha.addEventListener('click', () => {
        if (typeof activatePageGlobal === 'function') activatePageGlobal('biblioteca');
      });
    }

    return linha;
  }

  function formatarData(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const hoje = new Date();
    const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
    const mesmoDia = d.toDateString() === hoje.toDateString();
    const ehOntem = d.toDateString() === ontem.toDateString();
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (mesmoDia) return `Hoje, ${hora}`;
    if (ehOntem) return `Ontem, ${hora}`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + `, ${hora}`;
  }

  return { init };
})();
