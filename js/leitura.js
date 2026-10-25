const Leitura = (() => {
  const form = document.getElementById('session-form');
  const livroInput = document.getElementById('livro-select-input');
  const livroDatalist = document.getElementById('livros-datalist');
  const livroInfo = document.getElementById('livro-info');
  const refreshBtn = document.getElementById('refresh-books-btn');
  const dataInput = document.getElementById('data-sessao');
  const horaInicio = document.getElementById('hora-inicio');
  const horaFim = document.getElementById('hora-fim');
  const pagInicial = document.getElementById('pagina-inicial');
  const pagFinal = document.getElementById('pagina-final');
  const tempoCalculadoDiv = document.getElementById('tempo-calculado');
  const tempoMinSpan = document.getElementById('tempo-minutos');
  const pagLidasDiv = document.getElementById('paginas-calculadas');
  const pagLidasSpan = document.getElementById('paginas-lidas');
  const historicoContainer = document.getElementById('historico-sessoes');

  const display = document.getElementById('cronometro-display');
  const btnIniciar = document.getElementById('btn-iniciar');
  const btnPausar = document.getElementById('btn-pausar');
  const btnRetomar = document.getElementById('btn-retomar');
  const btnFinalizar = document.getElementById('btn-finalizar');
  const tempoAtivoInput = document.getElementById('tempo-ativo-minutos');

  // Busca de palavra durante a leitura
  const modalBuscarPalavraEl = document.getElementById('modal-buscar-palavra');
  const inputPalavraBusca = document.getElementById('palavra-buscar-input');
  const btnVozPalavra = document.getElementById('btn-voz-palavra');
  const btnConfirmarBuscaPalavra = document.getElementById('btn-confirmar-busca-palavra');
  const resultadoBuscaPalavra = document.getElementById('resultado-busca-palavra');

  let livrosCache = [];
  let sessoesCache = [];
  let editandoSessaoID = null;
  let livroMap = {};
  // Novas variáveis do cronômetro
  let cronometroAtivo = false;
  let inicioCronometro = null; // timestamp (ms) de quando iniciou/retomou
  let tempoAcumulado = 0;      // ms acumulados antes da última pausa
  let animFrameId = null;
  let recognition = null;
  let targetInput = null;
  let estavaRodandoAntesBusca = false; // pra saber se retoma o cronômetro ao fechar a busca de palavra

  // Container e template para múltiplas anotações
  let containerAnotacoes = null;
  let templateAnotacao = null;

  function initSpeech() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Speech Recognition não suportado neste navegador.');
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = false;

    recognition.addEventListener('result', (e) => {
      const transcript = e.results[0][0].transcript;
      if (targetInput) {
        targetInput.value += (targetInput.value ? ' ' : '') + transcript;
      }
    });

    recognition.addEventListener('end', () => {
      const btn = document.querySelector('.btn-recording');
      if (btn) {
        btn.classList.remove('btn-recording', 'btn-danger');
        btn.innerHTML = '<i class="fas fa-microphone"></i>';
      }
      targetInput = null;
    });

    recognition.addEventListener('error', () => {
      const btn = document.querySelector('.btn-recording');
      if (btn) {
        btn.classList.remove('btn-recording', 'btn-danger');
        btn.innerHTML = '<i class="fas fa-microphone"></i>';
      }
      targetInput = null;
    });
  }

  function formatarHora(input) {
    let valor = input.value.replace(/\D/g, '');
    if (valor.length > 4) valor = valor.slice(0, 4);
    if (valor.length > 2) valor = valor.slice(0, 2) + ':' + valor.slice(2);
    input.value = valor;
  }

  function sanitizarHora(valor) {
    if (!valor) return '';
    const match = valor.match(/(\d{2}):(\d{2})/);
    return match ? match[1] + ':' + match[2] : '';
  }

  // --- Ritmo médio de leitura do livro (atalho p/ quando não deu pra usar o cronômetro) ---
  // Cria o botão discreto logo abaixo dos campos Hora início/Hora fim.
  function criarBotaoTempoMedio() {
    const linhaHoras = horaFim.closest('.row');
    if (!linhaHoras || document.getElementById('btn-media-tempo')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'text-end mt-1';
    wrapper.innerHTML = '<button type="button" id="btn-media-tempo" class="btn btn-link btn-sm btn-media-tempo" ' +
      'title="Preenche a hora fim com o horário atual e a hora início estimada pelo ritmo médio (páginas/hora) deste livro. Informe as páginas antes.">' +
      '<i class="fas fa-hourglass-half"></i> usar tempo médio</button>';
    linhaHoras.insertAdjacentElement('afterend', wrapper);
    document.getElementById('btn-media-tempo').addEventListener('click', preencherComTempoMedio);
  }

  // Busca TODAS as sessões do livro (o cache da tela só tem as 20 mais recentes,
  // o que distorceria a média). Se estiver offline, usa o que houver em cache local.
  async function obterSessoesDoLivro(livroID) {
    let todas = [];
    try {
      const resp = await API.enviar({ acao: 'listAllSessions' });
      if (Array.isArray(resp)) todas = resp;
    } catch (e) {
      console.warn('Falha ao buscar sessões, usando cache local:', e);
      try { todas = await DB.obterSessoes(); } catch (_) { todas = []; }
      if (!todas || !todas.length) todas = sessoesCache;
    }
    return (todas || []).filter(s => s.LivroID === livroID);
  }

  // Páginas lidas num intervalo — mesma regra de calcularPaginas(): quando não
  // começa na página 0, a página inicial também conta como lida.
  function contarPaginas(pi, pf) {
    if (!(pf > pi)) return 0;
    let lidas = pf - pi;
    if (pi > 0) lidas += 1;
    return lidas;
  }

  // Preenche hora fim/início estimando quanto tempo as páginas desta sessão
  // levariam, com base no ritmo médio (páginas por hora) do livro até agora.
  async function preencherComTempoMedio() {
    const livroID = livroMap[livroInput.value.trim()];
    if (!livroID) {
      Util.toast('Selecione um livro primeiro.', 'warning');
      return;
    }
    if (pagInicial.value === '' || pagFinal.value === '') {
      Util.toast('Informe a página inicial e a página final antes de usar o tempo médio.', 'warning');
      return;
    }
    const paginasSessao = contarPaginas(parseInt(pagInicial.value, 10), parseInt(pagFinal.value, 10));
    if (paginasSessao <= 0) {
      Util.toast('A página final precisa ser maior que a inicial.', 'warning');
      return;
    }
    if (horaInicio.disabled) {
      Util.toast('Finalize o cronômetro antes de usar o tempo médio.', 'warning');
      return;
    }

    const btn = document.getElementById('btn-media-tempo');
    if (btn) btn.disabled = true;
    try {
      const sessoes = await obterSessoesDoLivro(livroID);

      // Ritmo médio ponderado: total de páginas ÷ total de tempo das sessões
      // do livro (sessões longas pesam mais que as curtas). A sessão que está
      // sendo editada não entra ("até então").
      let totalPaginas = 0;
      let totalMinutos = 0;
      let qtdSessoes = 0;
      sessoes
        .filter(sess => !editandoSessaoID || sess.ID !== editandoSessaoID)
        .forEach(sess => {
          const tempo = Number(sess.Tempo);
          let paginas = Number(sess.PáginasLidas);
          if (!(paginas > 0)) {
            paginas = contarPaginas(Number(sess.PáginaInicial) || 0, Number(sess.PáginaFinal) || 0);
          }
          if (tempo > 0 && paginas > 0) {
            totalMinutos += tempo;
            totalPaginas += paginas;
            qtdSessoes++;
          }
        });

      if (!qtdSessoes) {
        Util.toast('Este livro ainda não tem sessões com páginas e tempo registrados para calcular o ritmo.', 'info');
        return;
      }

      const paginasPorHora = totalPaginas / (totalMinutos / 60);
      const minutos = Math.max(1, Math.round(paginasSessao * totalMinutos / totalPaginas));
      const fim = new Date();
      const inicio = new Date(fim.getTime() - minutos * 60000); // já trata virada de meia-noite

      horaFim.value = fim.toTimeString().slice(0, 5);
      horaInicio.value = inicio.toTimeString().slice(0, 5);
      // Sem tempo de cronômetro: a duração passa a vir da diferença entre as horas
      if (tempoAtivoInput) tempoAtivoInput.value = '';
      calcularTempo();

      Util.toast(`Ritmo médio de ${Math.round(paginasPorHora)} pág/h: ${paginasSessao} págs ≈ ${minutos} min.`, 'success');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function init() {
    if (!form) return;

    initSpeech();
    const hoje = new Date();
    const dia = String(hoje.getDate()).padStart(2, '0');
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const ano = hoje.getFullYear();
    dataInput.value = `${ano}-${mes}-${dia}`;

    horaInicio.addEventListener('input', () => formatarHora(horaInicio));
    horaFim.addEventListener('input', () => formatarHora(horaFim));

    horaInicio.addEventListener('blur', () => {
      if (horaInicio.value && !horaInicio.value.includes(':')) {
        horaInicio.value = horaInicio.value.padEnd(2, '0') + ':00';
        if (horaInicio.value.length > 5) horaInicio.value = horaInicio.value.slice(0, 5);
      }
      calcularTempo();
    });

    horaFim.addEventListener('blur', () => {
      if (horaFim.value && !horaFim.value.includes(':')) {
        horaFim.value = horaFim.value.padEnd(2, '0') + ':00';
        if (horaFim.value.length > 5) horaFim.value = horaFim.value.slice(0, 5);
      }
      calcularTempo();
    });

    criarBotaoTempoMedio();

    livroInput.addEventListener('change', () => {
      atualizarUltimaPagina();
      const texto = livroInput.value.trim();
      const id = livroMap[texto];
      if (id) {
        const livro = livrosCache.find(l => l.ID === id);
        if (livro) {
          livroInfo.innerHTML = `
            <strong>${livro.Título}</strong> | ${livro.Autor}<br>
            Páginas totais: ${livro.NúmeroPáginas || '?'} | Status: ${livro.Status} | Lidas: ${livro.PáginasLidasAcumuladas || 0}
          `;
          atualizarMediaSession(livro); // Atualiza os metadados para a tela de bloqueio
        }
      } else {
        livroInfo.innerHTML = '';
      }
    });

    [pagInicial, pagFinal].forEach(el => el.addEventListener('input', calcularPaginas));
    refreshBtn.addEventListener('click', async () => {
      await carregarLivros();
      selecionarLivroPadrao();
    });
    form.addEventListener('submit', salvarSessao);
    document.getElementById('clear-session-btn')?.addEventListener('click', limparFormulario);

    btnIniciar.addEventListener('click', iniciarCronometro);
    btnPausar.addEventListener('click', pausarCronometro);
    btnRetomar.addEventListener('click', retomarCronometro);
    btnFinalizar.addEventListener('click', finalizarCronometro);

    // --- Busca de palavra durante a leitura ---
    async function buscarPalavraDicionario() {
      const palavra = inputPalavraBusca.value.trim();
      if (!palavra) return;
      resultadoBuscaPalavra.innerHTML = '<span class="text-muted">Buscando...</span>';
      try {
        const resp = await API.enviar({ acao: 'buscarPalavra', palavra: palavra });
        if (!resp || !resp.encontrada || !resp.definicoes || !resp.definicoes.length) {
          resultadoBuscaPalavra.innerHTML = '<span class="text-muted">Não encontrei essa palavra.</span>';
          return;
        }
        resultadoBuscaPalavra.innerHTML = resp.definicoes.map(function(d) {
          return '<div class="mb-1">' + (d.classe ? '<em>' + d.classe + '</em> ' : '') + d.definicao + '</div>';
        }).join('');
      } catch (e) {
        resultadoBuscaPalavra.innerHTML = '<span class="text-danger">Erro ao buscar a palavra.</span>';
      }
    }

    if (btnConfirmarBuscaPalavra) btnConfirmarBuscaPalavra.addEventListener('click', buscarPalavraDicionario);
    if (inputPalavraBusca) {
      inputPalavraBusca.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); buscarPalavraDicionario(); }
      });
    }

    if (btnVozPalavra) {
      btnVozPalavra.addEventListener('click', () => {
        if (!recognition) {
          Util.toast('Reconhecimento de voz não suportado neste navegador.', 'warning');
          return;
        }
        if (targetInput === inputPalavraBusca) {
          recognition.stop();
          return;
        }
        if (targetInput) recognition.stop();
        targetInput = inputPalavraBusca;
        btnVozPalavra.classList.add('btn-recording', 'btn-danger');
        btnVozPalavra.innerHTML = '<i class="fas fa-stop"></i>';
        recognition.start();
      });
    }

    // Pausa automaticamente o cronômetro (se estiver ativo) enquanto o
    // modal de busca está aberto, e retoma sozinho ao fechar — a busca da
    // palavra não deveria contar como tempo de leitura.
    if (modalBuscarPalavraEl) {
      modalBuscarPalavraEl.addEventListener('show.bs.modal', () => {
        estavaRodandoAntesBusca = cronometroAtivo;
        if (cronometroAtivo) pausarCronometro();
        inputPalavraBusca.value = '';
        resultadoBuscaPalavra.innerHTML = '';
      });
      modalBuscarPalavraEl.addEventListener('hidden.bs.modal', () => {
        if (targetInput === inputPalavraBusca) recognition.stop();
        if (estavaRodandoAntesBusca) {
          retomarCronometro();
          estavaRodandoAntesBusca = false;
        }
      });
    }

    // Configura múltiplas anotações
    containerAnotacoes = document.getElementById('anotacoes-sessao-container');
    templateAnotacao = document.getElementById('template-anotacao-item');
    // Sempre começa com um único módulo de anotação: limpa qualquer item
    // residual de uma inicialização anterior antes de adicionar o inicial.
    if (containerAnotacoes) containerAnotacoes.innerHTML = '';
    adicionarItemAnotacao();
    const btnAdicionarAnotacao = document.getElementById('btn-adicionar-anotacao');
    // Evita religar o listener em cada init() (a página é reinicializada a
    // cada navegação), o que faria um único clique adicionar vários itens.
    if (btnAdicionarAnotacao && !btnAdicionarAnotacao.dataset.listenerLigado) {
      btnAdicionarAnotacao.addEventListener('click', () => {
        adicionarItemAnotacao();
      });
      btnAdicionarAnotacao.dataset.listenerLigado = 'true';
    }

    // Sobrescreve limparFormulario para limpar itens extras
    const limparOriginal = limparFormulario;
    limparFormulario = function() {
      limparOriginal();
      if (containerAnotacoes) {
        containerAnotacoes.innerHTML = '';
        adicionarItemAnotacao();
      }
    };

    // Localização: preenche sugestões de locais já conhecidos e liga o botão de GPS
    carregarLocaisConhecidos();
    document.getElementById('btn-local-gps')?.addEventListener('click', usarLocalizacaoAtual);
    sugerirLocalPorGPS();

    // Configurar Media Session para controles na tela de bloqueio
    configurarMediaSession();

    // Fallback defensivo: garante que o áudio fantasma continue tocando
    // mesmo se o loop nativo falhar em algum navegador/situação de fundo.
    const audioFantasma = document.getElementById('audio-fantasma');
    if (audioFantasma) {
      audioFantasma.addEventListener('ended', () => {
        if (cronometroAtivo) {
          audioFantasma.currentTime = 0;
          audioFantasma.play().catch(() => {});
        }
      });
    }

    // Listener de visibilidade para atualizar o display ao retornar
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && cronometroAtivo) {
        // Força atualização imediata
        const agora = Date.now();
        const totalMs = tempoAcumulado + (agora - inicioCronometro);
        const totalSeg = Math.floor(totalMs / 1000);
        const mins = Math.floor(totalSeg / 60);
        const secs = totalSeg % 60;
        display.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        if (!animFrameId) atualizarDisplayLoop();

        // O Android costuma pausar sozinho o áudio fantasma quando a tela
        // fica bloqueada por um tempo longo. Se isso acontecer, o primeiro
        // toque em Pausar/Retomar pode ser "engolido" pelo navegador só pra
        // retomar o áudio (exigência de gesto do usuário), em vez de
        // realmente acionar o botão. Resincroniza aqui, assim que a tela
        // volta, pra não depender do toque do usuário pra isso.
        if (audioFantasma && audioFantasma.paused) {
          audioFantasma.loop = true;
          audioFantasma.play().catch(() => {});
        }
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing';
        }
      } else if (document.visibilityState === 'hidden') {
        // Tela sendo escondida/app indo pra segundo plano é o momento mais
        // provável de o app ser fechado/encerrado pelo sistema sem aviso,
        // então é aqui que salvamos o rascunho da sessão em andamento.
        salvarRascunho();
      }
    });

    // Fallback: 'pagehide' cobre o fechamento real da aba/app, que às vezes
    // não passa pelo 'visibilitychange' (ex.: alguns navegadores desktop).
    window.addEventListener('pagehide', salvarRascunho);

    // Carrega livros e histórico juntos e só então escolhe o livro padrão do
    // select, já que essa escolha depende dos dois (status "Lendo" vem dos
    // livros, e o desempate por sessão mais recente vem do histórico).
    Promise.all([carregarLivros(), carregarHistorico()]).then(() => {
      // Se havia uma sessão em andamento que não foi finalizada/registrada
      // (aba fechada, app derrubado, etc.), recupera ela em vez de aplicar
      // a seleção padrão de livro.
      if (!restaurarRascunhoSeExistir()) {
        selecionarLivroPadrao();
      }
      // Avisa quem estiver esperando a tela ficar pronta (ex.: a Jornada de
      // leitura, que navega pra cá e só então preenche o formulário de
      // edição de uma sessão específica — evita a corrida em que essa
      // segunda ação preenche o formulário e o carregamento normal da
      // página limpa tudo de novo logo em seguida).
      window.dispatchEvent(new CustomEvent('leitura:pronto'));
    });
    console.log('✅ Módulo Leitura pronto.');
  }

  // --- Persistência da sessão em andamento (recuperação após fechar o app) ---
  const CHAVE_RASCUNHO = 'calixteca_sessao_rascunho';

  function salvarRascunho() {
    // Só vale a pena persistir se já existe algo em andamento (cronômetro
    // rodando ou pausado com tempo acumulado). Sem isso, não grava rascunho.
    if (!cronometroAtivo && tempoAcumulado === 0) {
      limparRascunho();
      return;
    }
    const rascunho = {
      livroTexto: livroInput.value,
      data: dataInput.value,
      horaInicio: horaInicio.value,
      paginaInicial: pagInicial.value,
      local: document.getElementById('local-sessao')?.value || '',
      tempoAcumulado,
      cronometroAtivo,
      inicioCronometro,
      salvoEm: Date.now()
    };
    try {
      Util.lsSet(CHAVE_RASCUNHO, JSON.stringify(rascunho));
    } catch (erro) {
      console.warn('Não foi possível salvar o rascunho da sessão:', erro);
    }
  }

  function limparRascunho() {
    try {
      Util.lsRemove(CHAVE_RASCUNHO);
    } catch (erro) {
      // Ignora — nada crítico se não der pra limpar.
    }
  }

  function restaurarRascunhoSeExistir() {
    // Se o cronômetro já está ativo ou já tem tempo acumulado em memória, é
    // porque a sessão já está rolando nesta mesma execução do app (só
    // navegamos entre telas) — não há nada a recuperar do localStorage.
    if (cronometroAtivo || tempoAcumulado > 0) return false;

    let bruto;
    try {
      bruto = Util.lsGet(CHAVE_RASCUNHO);
    } catch (erro) {
      return false;
    }
    if (!bruto) return false;

    let rascunho;
    try {
      rascunho = JSON.parse(bruto);
    } catch (erro) {
      limparRascunho();
      return false;
    }

    // Congela o tempo decorrido até o instante do último salvamento do
    // rascunho (se estava rodando, soma o intervalo entre o último início e
    // esse salvamento). Não tenta estimar quanto tempo passou desde então —
    // quem decide se retoma ou finaliza é o usuário.
    let tempoCongelado = rascunho.tempoAcumulado || 0;
    if (rascunho.cronometroAtivo && rascunho.inicioCronometro) {
      tempoCongelado += Math.max(0, rascunho.salvoEm - rascunho.inicioCronometro);
    }

    if (tempoCongelado <= 0 && !rascunho.livroTexto) {
      limparRascunho();
      return false;
    }

    if (rascunho.livroTexto) {
      livroInput.value = rascunho.livroTexto;
      livroInput.dispatchEvent(new Event('change'));
    }
    if (rascunho.data) dataInput.value = rascunho.data;
    if (rascunho.horaInicio) horaInicio.value = rascunho.horaInicio;
    if (rascunho.paginaInicial) pagInicial.value = rascunho.paginaInicial;
    const localInput = document.getElementById('local-sessao');
    if (localInput && rascunho.local) localInput.value = rascunho.local;

    tempoAcumulado = tempoCongelado;
    cronometroAtivo = false;
    inicioCronometro = null;

    const totalSeg = Math.floor(tempoAcumulado / 1000);
    const mins = Math.floor(totalSeg / 60);
    const secs = totalSeg % 60;
    display.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    if (tempoAtivoInput) {
      tempoAtivoInput.value = Math.max(1, Math.round(tempoAcumulado / 60000));
    }
    btnIniciar.classList.add('d-none');
    btnPausar.classList.add('d-none');
    btnRetomar.classList.remove('d-none');
    btnFinalizar.classList.remove('d-none');
    horaInicio.disabled = true;
    horaFim.disabled = true;

    Util.toast(`Sessão anterior recuperada (${mins} min já contabilizados). Toque em Retomar para continuar ou em Finalizar para registrar.`, 'info');

    return true;
  }

  function configurarMediaSession() {
  if (!('mediaSession' in navigator)) return;
  // Apenas configura os action handlers – não inicia áudio ainda.
  const actionHandlers = [
    ['play', () => { if (!cronometroAtivo) iniciarCronometro(); }],
    ['stop', () => { finalizarCronometro(); }]
  ];
  for (const [action, handler] of actionHandlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (error) {
      console.log(`Media Session action ${action} not supported`);
    }
  }
}

  function atualizarMediaSession(livro) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: livro?.Título || 'Leitura',
      artist: livro?.Autor || document.title,
      artwork: [
        { src: livro?.URLCapa || 'img/icons/logo.png', sizes: '96x96', type: 'image/png' }
      ]
    });
  }

  // Garante que a metadata reflita o livro selecionado no momento em que o
  // cronômetro realmente inicia/retoma — antes ela só era setada no evento
  // "change" do datalist, então iniciar sem reselecionar deixava a metadata
  // vazia/desatualizada e o Android/iOS podem se recusar a mostrar os
  // controles na tela de bloqueio sem uma metadata válida.
  function atualizarMediaSessionAtual() {
    const texto = livroInput.value.trim();
    const id = livroMap[texto];
    const livro = livrosCache.find(l => l.ID === id);
    atualizarMediaSession(livro);
  }

  function adicionarItemAnotacao() {
    if (!templateAnotacao || !containerAnotacoes) return;

    const clone = templateAnotacao.content.cloneNode(true);
    const item = clone.querySelector('.anotacao-item');

    // Botão remover
    const btnRemover = item.querySelector('.btn-remover-anotacao');
    btnRemover.addEventListener('click', () => {
      if (containerAnotacoes.children.length > 1) {
        item.remove();
      } else {
        Util.toast('É necessário pelo menos um campo de anotação.', 'warning');
      }
    });

    // Configurar botão de voz para este item
    const btnVoz = item.querySelector('.btn-voz-obs');
    const textarea = item.querySelector('.texto-obs');
    btnVoz.addEventListener('click', () => {
      if (!recognition) {
        Util.toast('Reconhecimento de voz não suportado.', 'warning');
        return;
      }
      if (targetInput === textarea) {
        recognition.stop();
        return;
      }
      if (targetInput) recognition.stop();
      targetInput = textarea;
      btnVoz.innerHTML = '<i class="fas fa-stop"></i>';
      recognition.start();
    });

    // Configurar botão de OCR para este item
    const btnOcr = item.querySelector('.btn-ocr-obs');
    btnOcr.addEventListener('click', () => {
      if (typeof OCR !== 'undefined' && OCR.capturarECapturarTexto) {
        OCR.capturarECapturarTexto(textarea);
      } else {
        Util.toast('Funcionalidade de OCR não carregada.', 'warning');
      }
    });

    containerAnotacoes.appendChild(item);
  }

  function atualizarDisplayLoop() {
    if (!cronometroAtivo) return;
    const agora = Date.now();
    const totalMs = tempoAcumulado + (inicioCronometro ? agora - inicioCronometro : 0);
    const totalSeg = Math.floor(totalMs / 1000);
    const mins = Math.floor(totalSeg / 60);
    const secs = totalSeg % 60;
    display.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    animFrameId = requestAnimationFrame(atualizarDisplayLoop);
  }

      function iniciarCronometro() {
    if (cronometroAtivo) return;
    if (tempoAcumulado === 0) {
      horaInicio.value = new Date().toTimeString().slice(0, 5);
    }
    inicioCronometro = Date.now();
    cronometroAtivo = true;
    display.classList.add('pulsando');
    btnIniciar.classList.add('d-none');
    btnPausar.classList.remove('d-none');
    btnRetomar.classList.add('d-none');
    btnFinalizar.classList.remove('d-none');
    horaInicio.disabled = true;
    horaFim.disabled = true;
    atualizarDisplayLoop();

    // Metadata precisa estar setada ANTES/junto do play() para o SO aceitar
    // o áudio como uma sessão de mídia válida e mostrar os controles.
    atualizarMediaSessionAtual();

    // Áudio fantasma: inicia e força loop (arquivo com duração real — ver silencio.wav)
    const audio = document.getElementById('audio-fantasma');
    if (audio) {
      audio.loop = true;
      audio.play().catch(() => {});
    }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
    salvarRascunho();
  }

    function pausarCronometro() {
    if (!cronometroAtivo) return;
    cronometroAtivo = false;
    if (animFrameId) cancelAnimationFrame(animFrameId);
    tempoAcumulado += Date.now() - inicioCronometro;
    inicioCronometro = null;
    display.classList.remove('pulsando');
    btnPausar.classList.add('d-none');
    btnRetomar.classList.remove('d-none');
    horaInicio.disabled = false;
    horaFim.disabled = false;
    if (tempoAtivoInput) {
      tempoAtivoInput.value = tempoAcumulado > 0 ? Math.max(1, Math.round(tempoAcumulado / 60000)) : '';
    }

    const audio = document.getElementById('audio-fantasma');
    if (audio) audio.pause();

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
    salvarRascunho();
  }

    function retomarCronometro() {
    if (cronometroAtivo) return;
    inicioCronometro = Date.now();
    cronometroAtivo = true;
    display.classList.add('pulsando');
    btnRetomar.classList.add('d-none');
    btnPausar.classList.remove('d-none');
    horaInicio.disabled = true;
    horaFim.disabled = true;
    atualizarDisplayLoop();

    atualizarMediaSessionAtual();

    const audio = document.getElementById('audio-fantasma');
    if (audio) {
      audio.loop = true;
      audio.play().catch(() => {});
    }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
    salvarRascunho();
  }
  
    function finalizarCronometro() {
    if (cronometroAtivo) {
      cronometroAtivo = false;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      tempoAcumulado += Date.now() - inicioCronometro;
      inicioCronometro = null;
    }
    display.classList.remove('pulsando');
    const totalMs = tempoAcumulado;
    const totalSeg = Math.floor(totalMs / 1000);
    const mins = Math.floor(totalSeg / 60);
    const secs = totalSeg % 60;
    display.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    horaFim.value = new Date().toTimeString().slice(0, 5);
    if (tempoAtivoInput) {
      tempoAtivoInput.value = totalMs > 0 ? Math.max(1, Math.round(totalMs / 60000)) : '';
    }
    calcularTempo();
    btnIniciar.classList.remove('d-none');
    btnPausar.classList.add('d-none');
    btnRetomar.classList.add('d-none');
    btnFinalizar.classList.add('d-none');
    horaInicio.disabled = false;
    horaFim.disabled = false;

    const audio = document.getElementById('audio-fantasma');
    if (audio) audio.pause();

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
    }
    // Mantém o rascunho salvo (com o tempo final já congelado): o usuário
    // ainda precisa clicar em "Registrar Sessão" pra concluir, e se fechar
    // o app antes disso não pode perder o tempo que acabou de finalizar.
    salvarRascunho();
  }
  
    function resetarCronometro() {
    if (cronometroAtivo) {
      cronometroAtivo = false;
      if (animFrameId) cancelAnimationFrame(animFrameId);
    }
    tempoAcumulado = 0;
    inicioCronometro = null;
    display.textContent = '00:00';
    display.classList.remove('pulsando');
    if (tempoAtivoInput) tempoAtivoInput.value = '';
    btnIniciar.classList.remove('d-none');
    btnPausar.classList.add('d-none');
    btnRetomar.classList.add('d-none');
    btnFinalizar.classList.add('d-none');
    horaInicio.disabled = false;
    horaFim.disabled = false;
    horaInicio.value = '';
    horaFim.value = '';

    const audio = document.getElementById('audio-fantasma');
    if (audio) audio.pause();

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none';
    }
    // Sessão registrada com sucesso ou descartada de propósito (botão
    // "Limpar") — não há mais nada em andamento pra recuperar depois.
    limparRascunho();
  }
  
  async function carregarLivros() {
    try {
      livroInput.value = '';
      livroDatalist.innerHTML = '';
      const resp = await API.enviar({ acao: 'listBooks' });
      if (resp && Array.isArray(resp)) {
        livrosCache = resp;
        renderizarDatalist();
      }
    } catch (e) {
      Util.toast('Erro ao carregar livros', 'danger');
    }
  }

  function renderizarDatalist() {
    livroDatalist.innerHTML = '';
    livroMap = {};
    livrosCache.forEach(livro => {
      const option = document.createElement('option');
      const texto = `${livro.Título} - ${livro.Autor} (${livro.Status})`;
      option.value = texto;
      livroMap[texto] = livro.ID;
      livroDatalist.appendChild(option);
    });
  }

  // Define automaticamente o livro selecionado no formulário: o livro que
  // está "Lendo" no momento. Se houver mais de um "Lendo", usa o que teve a
  // sessão registrada mais recentemente (com base no histórico). Não faz
  // nada se a pessoa já escolheu um livro manualmente ou se está editando
  // uma sessão existente.
  function selecionarLivroPadrao() {
    if (editandoSessaoID) return;
    if (livroInput.value.trim()) return;

    const lendo = livrosCache.filter(l => l.Status === 'Lendo');
    if (lendo.length === 0) return;

    let livroPadrao = lendo[0];
    if (lendo.length > 1) {
      const sessaoRecente = sessoesCache.find(sess => lendo.some(l => l.ID === sess.LivroID));
      if (sessaoRecente) {
        livroPadrao = lendo.find(l => l.ID === sessaoRecente.LivroID);
      }
    }

    const texto = `${livroPadrao.Título} - ${livroPadrao.Autor} (${livroPadrao.Status})`;
    livroInput.value = texto;
    livroInfo.innerHTML = `
      <strong>${livroPadrao.Título}</strong> | ${livroPadrao.Autor}<br>
      Páginas totais: ${livroPadrao.NúmeroPáginas || '?'} | Status: ${livroPadrao.Status} | Lidas: ${livroPadrao.PáginasLidasAcumuladas || 0}
    `;
    atualizarMediaSession(livroPadrao);
    atualizarUltimaPagina();
  }

  // Mostra, bem discreto, a última página lida do livro escolhido (abaixo da "Página inicial").
  let tokenUltimaPagina = 0;
  async function atualizarUltimaPagina() {
    const caixa = document.getElementById('ultima-pagina-lida');
    const valor = document.getElementById('ultima-pagina-valor');
    if (!caixa || !valor) return;
    const id = livroMap[livroInput.value.trim()];
    const meuToken = ++tokenUltimaPagina;
    if (!id) { caixa.hidden = true; return; }
    try {
      const r = await API.enviar({ acao: 'ultimaPaginaLivro', livroID: id });
      if (meuToken !== tokenUltimaPagina) return; // escolheu outro livro enquanto buscava
      if (r && r.pagina != null) { valor.textContent = r.pagina; caixa.hidden = false; }
      else caixa.hidden = true;
    } catch (e) { if (meuToken === tokenUltimaPagina) caixa.hidden = true; }
  }

  function calcularTempo() {
    // Se o cronômetro foi usado (com ou sem pausas), esse é o tempo real de
    // leitura e tem prioridade sobre a diferença de horários — horaInício/
    // horaFim marcam o intervalo do relógio (útil pra saber quando a sessão
    // aconteceu), mas incluem qualquer tempo pausado no meio.
    const tempoAtivo = tempoAtivoInput && tempoAtivoInput.value ? parseInt(tempoAtivoInput.value, 10) : 0;
    if (tempoAtivo > 0) {
      tempoMinSpan.textContent = tempoAtivo;
      tempoCalculadoDiv.classList.remove('d-none');
      return;
    }
    if (horaInicio.value && horaFim.value) {
      const [hi, mi] = horaInicio.value.split(':').map(Number);
      const [hf, mf] = horaFim.value.split(':').map(Number);
      if (!isNaN(hi) && !isNaN(mi) && !isNaN(hf) && !isNaN(mf)) {
        let minutos = (hf * 60 + mf) - (hi * 60 + mi);
        if (minutos < 0) minutos += 1440;
        tempoMinSpan.textContent = minutos;
        tempoCalculadoDiv.classList.remove('d-none');
      }
    }
  }

  function calcularPaginas() {
    const pi = parseInt(pagInicial.value) || 0;
    const pf = parseInt(pagFinal.value) || 0;
    if (pf > pi) {
      let lidas = pf - pi;
      if (pi > 0) lidas += 1;
      pagLidasSpan.textContent = Math.max(0, lidas);
      pagLidasDiv.classList.remove('d-none');
    }
  }

  // Preenche o datalist do campo Local com os nomes de locais que já têm
  // coordenadas salvas, para facilitar reaproveitar um local já cadastrado.
  async function carregarLocaisConhecidos() {
    try {
      const configs = await API.enviar({ acao: 'getConfigs' });
      const datalist = document.getElementById('locais-conhecidos-datalist');
      if (!datalist || !configs) return;
      datalist.innerHTML = '';
      Object.keys(configs)
        .filter(chave => chave.startsWith('local_coord_'))
        .forEach(chave => {
          const nome = chave.replace('local_coord_', '').replace(/_/g, ' ');
          const option = document.createElement('option');
          option.value = nome;
          datalist.appendChild(option);
        });
    } catch (e) {
      console.error('Erro ao carregar locais conhecidos:', e);
    }
  }

  // Distância aproximada entre duas coordenadas, em metros (fórmula de
  // Haversine). Usada só pra achar o local salvo mais próximo — não precisa
  // de precisão geodésica de verdade, só de "qual está mais perto".
  function distanciaEmMetros(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (graus) => (graus * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Ao abrir a tela, sugere sozinho o campo "Local" comparando a posição
  // atual do GPS com as coordenadas já salvas (as mesmas usadas no Mapa).
  // Só preenche se: o campo ainda está vazio (não atropela o que o usuário
  // já digitou), não é uma edição de sessão existente, e algum local salvo
  // está a menos de 150m — fora isso, fica quieto e o usuário digita normal.
  const RAIO_SUGESTAO_METROS = 150;

  async function sugerirLocalPorGPS() {
    const inputLocal = document.getElementById('local-sessao');
    const status = document.getElementById('local-gps-status');
    if (!inputLocal || inputLocal.value.trim() || editandoSessaoID) return;
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      async (posicao) => {
        try {
          // Reaproveita o cache de 45s do api.js quando possível (getConfigs
          // é uma ação cacheável) — não gera round-trip extra na maioria dos casos.
          const configs = await API.enviar({ acao: 'getConfigs' });
          if (!configs) return;

          const lat = posicao.coords.latitude;
          const lng = posicao.coords.longitude;

          let melhorNome = null;
          let melhorDistancia = Infinity;

          Object.keys(configs)
            .filter(chave => chave.startsWith('local_coord_'))
            .forEach(chave => {
              const [latSalva, lngSalva] = String(configs[chave]).split(',').map(Number);
              if (isNaN(latSalva) || isNaN(lngSalva)) return;
              const dist = distanciaEmMetros(lat, lng, latSalva, lngSalva);
              if (dist < melhorDistancia) {
                melhorDistancia = dist;
                melhorNome = chave.replace('local_coord_', '').replace(/_/g, ' ');
              }
            });

          if (melhorNome && melhorDistancia <= RAIO_SUGESTAO_METROS && !inputLocal.value.trim()) {
            inputLocal.value = melhorNome;
            if (status) status.textContent = `📍 Local sugerido automaticamente (você pode alterar)`;
          }
        } catch (e) {
          console.warn('Não foi possível sugerir local por GPS:', e);
        }
      },
      () => { /* permissão negada ou indisponível — fica quieto, sem toast */ },
      { timeout: 8000, maximumAge: 300000 }
    );
  }

  // Captura a localização atual pelo GPS/rede do dispositivo e salva a
  // coordenada para o nome de local informado, sem precisar ir em
  // Configurações nem procurar as coordenadas manualmente.
  async function usarLocalizacaoAtual() {
    const inputLocal = document.getElementById('local-sessao');
    const status = document.getElementById('local-gps-status');
    const btn = document.getElementById('btn-local-gps');
    const nomeLocal = inputLocal.value.trim();

    if (!nomeLocal) {
      Util.toast('Digite o nome do local antes de usar a localização atual.', 'warning');
      inputLocal.focus();
      return;
    }

    if (!navigator.geolocation) {
      Util.toast('Seu navegador não suporta geolocalização.', 'danger');
      return;
    }

    const iconeOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    if (status) status.textContent = 'Obtendo localização...';

    navigator.geolocation.getCurrentPosition(
      async (posicao) => {
        try {
          const lat = posicao.coords.latitude.toFixed(6);
          const lng = posicao.coords.longitude.toFixed(6);
          const coordenada = `${lat},${lng}`;

          // Se o local já tem coordenada salva e é diferente, confirma antes de sobrescrever
          const configs = await API.enviar({ acao: 'getConfigs' });
          const chave = `local_coord_${nomeLocal.replace(/\s+/g, '_')}`;
          const existente = configs && configs[chave];
          if (existente && existente !== coordenada) {
            const confirmar = await Util.confirmar(
              `"${nomeLocal}" já tem uma coordenada salva (${existente}). Substituir pela localização atual (${coordenada})?`,
              { titulo: 'Coordenada já existe', variante: 'warning', confirmarTexto: 'Substituir', cancelarTexto: 'Manter atual', icone: 'fa-location-dot' }
            );
            if (!confirmar) {
              if (status) status.textContent = '';
              return;
            }
          }

          const resp = await API.enviar({ acao: 'salvarCoordenadaLocal', local: nomeLocal, coordenada });
          if (resp && resp.status === 'ok') {
            Util.toast(`Localização "${nomeLocal}" registrada! Já vai aparecer no mapa.`, 'success');
            if (status) status.textContent = `📍 ${coordenada}`;
            carregarLocaisConhecidos();
          } else {
            Util.toast('Não foi possível salvar a localização.', 'danger');
          }
        } catch (e) {
          console.error('Erro ao salvar coordenada:', e);
          Util.toast('Erro ao salvar a localização.', 'danger');
        } finally {
          btn.disabled = false;
          btn.innerHTML = iconeOriginal;
        }
      },
      (erro) => {
        btn.disabled = false;
        btn.innerHTML = iconeOriginal;
        if (status) status.textContent = '';
        let msg = 'Não foi possível obter sua localização.';
        if (erro.code === erro.PERMISSION_DENIED) {
          msg = 'Permissão de localização negada. Habilite o acesso à localização para este site.';
        } else if (erro.code === erro.TIMEOUT) {
          msg = 'Tempo esgotado ao tentar obter sua localização.';
        }
        Util.toast(msg, 'danger');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function coletarAnotacoesDoForm(livroID) {
    const anotacoes = [];
    const itens = containerAnotacoes.querySelectorAll('.anotacao-item');
    itens.forEach(item => {
      const tipo = item.querySelector('.tipo-obs').value;
      const texto = item.querySelector('.texto-obs').value.trim();
      if (tipo && texto) {
        anotacoes.push({
          livroID,
          capitulo: item.querySelector('.capitulo-obs').value || '',
          pagina: item.querySelector('.pagina-obs').value || '',
          categoria: tipo,
          resumo: '',
          trecho: '',
          comentario: texto,
          imagem: ''
        });
      }
    });
    return anotacoes;
  }

  async function salvarSessao(e) {
    e.preventDefault();

    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      Util.toast('Preencha os campos obrigatórios.', 'warning');
      return;
    }

    // Edição de sessão existente offline continua bloqueada — sincronizar uma
    // atualização exige mais cuidado (a sessão original já pode ter mudado
    // no servidor nesse meio tempo), então por segurança só sessões NOVAS
    // entram na fila offline.
    if (!navigator.onLine && editandoSessaoID) {
      Util.toast('Você está offline. Conecte-se para editar uma sessão existente.', 'warning');
      return;
    }

    const textoSelecionado = livroInput.value.trim();
    const livroID = livroMap[textoSelecionado] || '';
    if (!livroID) {
      Util.toast('Selecione um livro.', 'warning');
      return;
    }

    const livroSelecionado = livrosCache.find(l => l.ID === livroID);
    const tituloConfirmacao = livroSelecionado ? livroSelecionado.Título : textoSelecionado;
    const acaoConfirmacao = editandoSessaoID ? 'atualizar a sessão' : 'registrar a sessão';
    const confirmouSessao = await Util.confirmar(
      `Confirma ${acaoConfirmacao} para o livro "${tituloConfirmacao}"?`,
      { titulo: editandoSessaoID ? 'Atualizar sessão' : 'Registrar sessão', confirmarTexto: editandoSessaoID ? 'Atualizar' : 'Registrar', icone: 'fa-book-open' }
    );
    if (!confirmouSessao) {
      return;
    }

    const sessao = {
      livroID,
      data: dataInput.value,
      horaInicio: sanitizarHora(horaInicio.value),
      horaFim: sanitizarHora(horaFim.value),
      paginaInicial: pagInicial.value,
      paginaFinal: pagFinal.value,
      local: document.getElementById('local-sessao').value,
      humor: document.getElementById('humor').value,
      clima: document.getElementById('clima').value,
      distracoes: '',
      observacoes: '' // será ignorado, pois agora usamos múltiplas anotações
    };

    // Tempo real de leitura, medido pelo cronômetro (já descontando pausas).
    // Só existe se o cronômetro foi usado nesta sessão; sessões digitadas
    // manualmente continuam sem esse campo, e o backend deve calcular a
    // duração a partir de horaInicio/horaFim como já faz hoje.
    const tempoAtivoMinutos = tempoAtivoInput && tempoAtivoInput.value ? parseInt(tempoAtivoInput.value, 10) : 0;
    if (tempoAtivoMinutos > 0) {
      sessao.tempoMinutos = tempoAtivoMinutos;
    }

    const btnSubmit = form.querySelector('button[type="submit"]');

    // Sem conexão e é uma sessão nova: em vez de recusar, guarda tudo
    // localmente numa fila e envia sozinho assim que a internet voltar.
    if (!navigator.onLine && !editandoSessaoID) {
      const anotacoesPendentes = coletarAnotacoesDoForm(livroID);
      await FilaOffline.adicionarSessaoPendente(sessao, anotacoesPendentes);
      Util.toast('Sem conexão — sessão salva no aparelho e será enviada automaticamente quando a internet voltar.', 'info');
      limparFormulario();
      return;
    }

    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Salvando...';

    try {
      let resposta;
      if (editandoSessaoID) {
        resposta = await API.enviar({ acao: 'updateSession', id: editandoSessaoID, sessao });
      } else {
        resposta = await API.enviar({ acao: 'addSession', sessao });
      }

      if (resposta && resposta.status === 'ok') {
        // Salva múltiplas anotações
        const anotacoesForm = coletarAnotacoesDoForm(livroID);
        for (const anot of anotacoesForm) {
          await API.enviar({ acao: 'addNote', anotacao: anot });
        }

        Util.toast(editandoSessaoID ? 'Sessão atualizada!' : 'Sessão registrada!', 'success');
        limparFormulario();
        editandoSessaoID = null;
        Promise.all([carregarLivros(), carregarHistorico()]).then(selecionarLivroPadrao);
      } else {
        throw new Error(resposta?.erro || 'Falha no servidor');
      }
    } catch (erro) {
      // Se a chamada falhou por causa da rede (não um erro do servidor) e é
      // uma sessão nova, não perde o que a pessoa preencheu — guarda na fila
      // do mesmo jeito que faria se já tivesse detectado offline de início.
      const pareceFalhaDeRede = !navigator.onLine || erro instanceof TypeError;
      if (pareceFalhaDeRede && !editandoSessaoID) {
        const anotacoesPendentes = coletarAnotacoesDoForm(livroID);
        await FilaOffline.adicionarSessaoPendente(sessao, anotacoesPendentes);
        Util.toast('Falha de conexão — sessão salva no aparelho e será enviada automaticamente mais tarde.', 'info');
        limparFormulario();
      } else {
        Util.toast('Erro ao salvar: ' + erro.message, 'danger');
      }
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="fas fa-save me-1"></i> ' + (editandoSessaoID ? 'Atualizar Sessão' : 'Registrar Sessão');
    }
  }

  function limparFormulario() {
    form.reset();
    document.querySelectorAll('.btn-icone-opcao.active').forEach(b => b.classList.remove('active'));
    form.classList.remove('was-validated');
    const hojeLimpa = new Date();
    const diaLimpa = String(hojeLimpa.getDate()).padStart(2, '0');
    const mesLimpa = String(hojeLimpa.getMonth() + 1).padStart(2, '0');
    const anoLimpa = hojeLimpa.getFullYear();
    dataInput.value = `${anoLimpa}-${mesLimpa}-${diaLimpa}`;
    tempoCalculadoDiv.classList.add('d-none');
    pagLidasDiv.classList.add('d-none');
    livroInfo.innerHTML = '';
    editandoSessaoID = null;
    resetarCronometro();
    // Limpa anotações extras e adiciona um item vazio
    if (containerAnotacoes) {
      containerAnotacoes.innerHTML = '';
      adicionarItemAnotacao();
    }
  }

  async function carregarHistorico() {
    if (!historicoContainer) return;
    let sessoes = [];
    try {
      const resp = await API.enviar({ acao: 'listRecentSessions' });
      if (Array.isArray(resp)) {
        sessoes = resp;
        DB.salvarSessoes(resp).catch(e => console.warn('Cache sessões falhou:', e));
      }
    } catch (e) {
      console.warn('Falha na API, tentando cache offline...');
      sessoes = await DB.obterSessoes();
      if (sessoes.length > 0) {
        Util.toast('Modo offline - dados do último acesso.', 'info');
      }
    }

    // listRecentSessions já retorna as sessões da mais recente para a mais
    // antiga (é como a lista de histórico abaixo é montada), então guardamos
    // nessa ordem para usar depois na escolha do livro padrão do formulário.
    sessoesCache = sessoes;

    if (sessoes.length > 0) {
      historicoContainer.innerHTML = '';
      const mapaTitulos = {};
      livrosCache.forEach(l => mapaTitulos[l.ID] = l.Título || 'Sem título');

      sessoes.slice(0, 20).forEach(sess => {
        const dataFormatada = sess.Data ? new Date(sess.Data).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '?';
        const pi = sess.PáginaInicial || '?';
        const pf = sess.PáginaFinal || '?';
        const pagLidas = sess.PáginasLidas || 0;
        const tempo = sess.Tempo ? `${sess.Tempo} min` : '';
        const nomeLivro = mapaTitulos[sess.LivroID] || 'Desconhecido';

        const div = document.createElement('div');
        div.className = 'd-flex justify-content-between align-items-center p-2 border-bottom';
        div.innerHTML = `
          <div>
            <strong>${nomeLivro}</strong><br>
            <small>${dataFormatada} - Pág. ${pi}-${pf} (${pagLidas} pág) ${tempo}</small>
            ${sess.Local ? `<br><small class="text-muted">Local: ${sess.Local}</small>` : ''}
          </div>
          <div>
            <button class="btn btn-sm btn-outline-secondary btn-editar-sessao" data-id="${sess.ID}"><i class="fas fa-edit"></i></button>
            <button class="btn btn-sm btn-outline-danger btn-excluir-sessao" data-id="${sess.ID}"><i class="fas fa-trash"></i></button>
          </div>`;
        historicoContainer.appendChild(div);
      });

      document.querySelectorAll('.btn-editar-sessao').forEach(btn => btn.addEventListener('click', () => editarSessao(btn.dataset.id, sessoes)));
      document.querySelectorAll('.btn-excluir-sessao').forEach(btn => btn.addEventListener('click', () => excluirSessao(btn.dataset.id)));
    }
  }

  function editarSessao(id, lista) {
    const sess = lista.find(s => s.ID === id);
    if (!sess) return;
    editandoSessaoID = id;
    if (tempoAtivoInput) tempoAtivoInput.value = '';
    const livroEdit = livrosCache.find(l => l.ID === sess.LivroID);
    if (livroEdit) {
      livroInput.value = `${livroEdit.Título} - ${livroEdit.Autor} (${livroEdit.Status})`;
      atualizarMediaSession(livroEdit);
    }
    dataInput.value = sess.Data;
    horaInicio.value = sess.HoraInício || '';
    horaFim.value = sess.HoraFim || '';
    pagInicial.value = sess.PáginaInicial;
    pagFinal.value = sess.PáginaFinal;
    document.getElementById('local-sessao').value = sess.Local || '';
    document.getElementById('humor').value = sess.Humor || '';
    document.getElementById('clima').value = sess.Clima || '';
    if (window.sincronizarGrupoIcones) {
      window.sincronizarGrupoIcones('humor');
      window.sincronizarGrupoIcones('clima');
    }

    // Limpa e adiciona um campo de anotação vazio (edição de anotações não é suportada nessa versão)
    if (containerAnotacoes) {
      containerAnotacoes.innerHTML = '';
      adicionarItemAnotacao();
    }

    calcularTempo();
    calcularPaginas();
    form.querySelector('button[type="submit"]').innerHTML = '<i class="fas fa-save me-1"></i> Atualizar Sessão';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Chamada pela Jornada de leitura (js/jornada.js), quando o usuário clica
  // num evento de sessão para ver/editar os detalhes. Diferente de
  // editarSessao(id, lista), que só procura numa lista já carregada na
  // tela, essa busca a sessão direto no banco — necessária porque a
  // Jornada pode apontar pra uma sessão antiga, fora das 20 mais recentes
  // que essa página normalmente carrega.
  async function editarSessaoPorId(id) {
    try {
      const sessao = await API.enviar({ acao: 'getSession', id });
      if (!sessao || sessao.erro) {
        Util.toast('Não foi possível abrir essa sessão.', 'warning');
        return;
      }
      if (!livrosCache.some(l => l.ID === sessao.LivroID)) await carregarLivros();
      editarSessao(id, [sessao]);
    } catch (e) {
      Util.toast('Erro ao abrir sessão: ' + e.message, 'danger');
    }
  }

  async function excluirSessao(id) {
    if (!navigator.onLine) {
      Util.toast('Você está offline. Conecte-se para excluir sessões.', 'warning');
      return;
    }
    const confirmouExcluir = await Util.confirmar('Esta ação não pode ser desfeita.', { titulo: 'Excluir sessão', variante: 'danger', confirmarTexto: 'Excluir' });
    if (confirmouExcluir) {
      try {
        await API.enviar({ acao: 'deleteSession', id });
        carregarHistorico();
        carregarLivros();
        Util.toast('Sessão excluída', 'info');
      } catch (e) {
        Util.toast('Erro ao excluir: ' + e.message, 'danger');
      }
    }
  }

  return { init, editarSessaoPorId };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', Leitura.init);
} else {
  Leitura.init();
}
