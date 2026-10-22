/**
 * Bingo Literário – Calixteca
 * 4 temas x 50 desafios (dados em js/bingo-dados.js). Sorteia um desafio
 * por tema; o tema sorteado fica bloqueado até os outros três serem
 * sorteados também (rodízio dos últimos 3 temas usados, ver api.js
 * função bingoSortear). Desafios só se repetem depois que os 50 do tema
 * se esgotam (novo "ciclo").
 */
const Bingo = (() => {
  let ultimosTemas = [];       // últimos até 3 temas sorteados (o mais recente primeiro)
  let desafiosPorTema = {};    // temaId -> array de linhas vindas do banco (histórico completo)
  let livrosCache = null;      // cache simples da lista de livros p/ o datalist de vínculo
  let temaExpandido = null;    // id do tema com a lista de 50 desafios aberta

  async function init() {
    const page = document.getElementById('page-bingo');
    if (!page || !page.classList.contains('active')) return;
    await carregar();
  }

  function temaPorId(id) { return BINGO_TEMAS.find(t => t.id === id); }

  async function carregar() {
    const grid = document.getElementById('bingo-temas-grid');
    if (grid && !grid.dataset.carregado) {
      grid.innerHTML = '<div class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm me-2"></div>Carregando bingo...</div>';
    }
    try {
      const resp = await API.enviar({ acao: 'bingoEstado' });
      if (resp && resp.erro) throw new Error(resp.erro);
      ultimosTemas = (resp && resp.ultimosTemas) || [];
      desafiosPorTema = {};
      BINGO_TEMAS.forEach(t => { desafiosPorTema[t.id] = []; });
      (resp && resp.desafios || []).forEach(d => {
        if (!desafiosPorTema[d.tema]) desafiosPorTema[d.tema] = [];
        desafiosPorTema[d.tema].push(d);
      });
      if (grid) grid.dataset.carregado = '1';
      renderResumo();
      renderTemas();
    } catch (e) {
      console.error('Bingo: falha ao carregar', e);
      if (grid) {
        grid.innerHTML = `<div class="empty-state"><i class="fas fa-dice"></i><p>Não foi possível carregar o bingo.<br><small class="text-muted">${Util.escapeHTML(e.message)}</small></p></div>`;
      }
    }
  }

  // Progresso do tema no ciclo mais recente (o ciclo mais alto já visto).
  function progressoTema(temaId) {
    const linhas = desafiosPorTema[temaId] || [];
    const total = temaPorId(temaId).desafios.length;
    const cicloAtual = linhas.reduce((max, d) => Math.max(max, d.ciclo), 1);
    const doCiclo = linhas.filter(d => d.ciclo === cicloAtual);
    const concluidosTotal = linhas.filter(d => d.status === 'concluido').length;
    return {
      ciclo: cicloAtual,
      sorteadosCiclo: doCiclo.length,
      concluidosCiclo: doCiclo.filter(d => d.status === 'concluido').length,
      concluidosTotal,
      total
    };
  }

  function renderResumo() {
    const el = document.getElementById('bingo-resumo-geral');
    if (!el) return;
    const totalGeral = BINGO_TEMAS.reduce((s, t) => s + t.desafios.length, 0);
    const concluidosGeral = BINGO_TEMAS.reduce((s, t) => s + progressoTema(t.id).concluidosTotal, 0);
    const pct = totalGeral ? Math.round((concluidosGeral / totalGeral) * 100) : 0;
    el.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-1">
        <span class="fw-bold"><i class="fas fa-trophy text-warning me-1"></i>${concluidosGeral} de ${totalGeral} desafios concluídos</span>
        <span class="text-muted small">${pct}%</span>
      </div>
      <div class="progress" style="height:8px;">
        <div class="progress-bar bg-success" style="width:${pct}%"></div>
      </div>`;
  }

  function renderTemas() {
    const grid = document.getElementById('bingo-temas-grid');
    if (!grid) return;
    grid.innerHTML = BINGO_TEMAS.map(tema => cardTemaHTML(tema)).join('');

    BINGO_TEMAS.forEach(tema => {
      const btnSortear = document.getElementById(`bingo-btn-sortear-${tema.id}`);
      if (btnSortear) btnSortear.addEventListener('click', () => sortear(tema.id));
      const btnVer = document.getElementById(`bingo-btn-ver-${tema.id}`);
      if (btnVer) btnVer.addEventListener('click', () => toggleHistorico(tema.id));
    });

    if (temaExpandido) renderHistoricoTema(temaExpandido);
  }

  function cardTemaHTML(tema) {
    const prog = progressoTema(tema.id);
    const bloqueado = ultimosTemas.includes(tema.id);
    const faltamParaLiberar = bloqueado
      ? BINGO_TEMAS.filter(t => t.id !== tema.id && !ultimosTemas.slice(0, ultimosTemas.indexOf(tema.id)).includes(t.id))
      : [];
    const pctConcluido = prog.total ? Math.round((prog.concluidosTotal / prog.total) * 100) : 0;

    return `
      <div class="col-12 col-md-6">
        <div class="card h-100 bingo-card-tema ${bloqueado ? 'bingo-bloqueado' : ''}" style="--bingo-cor: ${tema.cor}">
          <div class="card-body">
            <div class="d-flex align-items-center mb-2">
              <div class="bingo-icone-tema me-2"><i class="fas ${tema.icone}"></i></div>
              <div class="flex-grow-1">
                <h5 class="mb-0">${Util.escapeHTML(tema.nome)}</h5>
                <small class="text-muted">${prog.concluidosTotal} de ${prog.total} concluídos${prog.ciclo > 1 ? ` · ciclo ${prog.ciclo}` : ''}</small>
              </div>
              ${bloqueado ? '<span class="badge bg-secondary-subtle text-secondary-emphasis"><i class="fas fa-lock me-1"></i>Bloqueado</span>' : '<span class="badge bg-success-subtle text-success-emphasis"><i class="fas fa-dice me-1"></i>Disponível</span>'}
            </div>
            <div class="progress mb-3" style="height:6px;">
              <div class="progress-bar" style="width:${pctConcluido}%; background:${tema.cor};"></div>
            </div>
            ${bloqueado ? `<small class="text-muted d-block mb-2"><i class="fas fa-circle-info me-1"></i>Libera depois de sortear: ${faltamParaLiberar.map(t => Util.escapeHTML(t.nome)).join(', ')}</small>` : ''}
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-sm flex-grow-1" style="background:${tema.cor}; color:#fff;" id="bingo-btn-sortear-${tema.id}" ${bloqueado ? 'disabled' : ''}>
                <i class="fas fa-shuffle me-1"></i> Sortear desafio
              </button>
              <button type="button" class="btn btn-sm btn-outline-secondary" id="bingo-btn-ver-${tema.id}" title="Ver os 50 desafios">
                <i class="fas fa-list-ul"></i>
              </button>
            </div>
          </div>
          <div class="bingo-historico-tema" id="bingo-historico-${tema.id}" style="display:none;"></div>
        </div>
      </div>`;
  }

  function toggleHistorico(temaId) {
    temaExpandido = (temaExpandido === temaId) ? null : temaId;
    BINGO_TEMAS.forEach(t => {
      const el = document.getElementById(`bingo-historico-${t.id}`);
      if (el) el.style.display = (t.id === temaExpandido) ? 'block' : 'none';
    });
    if (temaExpandido) renderHistoricoTema(temaExpandido);
  }

  function renderHistoricoTema(temaId) {
    const el = document.getElementById(`bingo-historico-${temaId}`);
    if (!el) return;
    const tema = temaPorId(temaId);
    const prog = progressoTema(temaId);
    const linhasDoCiclo = {};
    (desafiosPorTema[temaId] || []).forEach(d => {
      if (d.ciclo === prog.ciclo) linhasDoCiclo[d.indice] = d;
    });

    const itens = tema.desafios.map((texto, indice) => {
      const linha = linhasDoCiclo[indice];
      let icone = 'fa-regular fa-square text-muted';
      let extra = '';
      const clicavel = !!linha;
      if (linha && linha.status === 'concluido') {
        icone = 'fas fa-square-check text-success';
        if (linha.livro_titulo) extra = ` <small class="text-muted">— ${Util.escapeHTML(linha.livro_titulo)}</small>`;
      } else if (linha) {
        icone = 'fas fa-dice text-warning';
      }
      return `<li class="list-group-item d-flex align-items-start gap-2 py-1 px-2 border-0 bg-transparent ${clicavel ? 'bingo-item-clicavel' : ''}" ${clicavel ? `data-bingo-indice="${indice}" role="button"` : ''}>
        <i class="${icone} mt-1"></i>
        <span class="${linha && linha.status === 'concluido' ? 'text-decoration-line-through text-muted' : ''}">${Util.escapeHTML(texto)}${extra}</span>
      </li>`;
    }).join('');

    el.innerHTML = `<div class="border-top px-3 py-2"><ul class="list-group list-group-flush" style="max-height:280px; overflow-y:auto;">${itens}</ul></div>`;
    el.querySelectorAll('[data-bingo-indice]').forEach(li => {
      li.addEventListener('click', () => {
        const indice = Number(li.dataset.bingoIndice);
        const linha = linhasDoCiclo[indice];
        if (linha) abrirModalResultado(tema, linha, false);
      });
    });
  }

  async function sortear(temaId) {
    if (ultimosTemas.includes(temaId)) return;
    if (!navigator.onLine) { Util.toast('Você está offline. Conecte-se para sortear.', 'warning'); return; }

    const btn = document.getElementById(`bingo-btn-sortear-${temaId}`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }

    try {
      const tema = temaPorId(temaId);
      const resp = await API.enviar({ acao: 'bingoSortear', tema: temaId, textos: tema.desafios });
      if (!resp || resp.erro) { Util.toast(resp && resp.erro ? resp.erro : 'Não foi possível sortear.', 'warning'); await carregar(); return; }

      ultimosTemas = resp.ultimosTemas || ultimosTemas;
      if (!desafiosPorTema[temaId]) desafiosPorTema[temaId] = [];
      desafiosPorTema[temaId].push(resp.desafio);
      renderResumo();
      renderTemas();
      abrirModalResultado(tema, resp.desafio, resp.cicloNovo);
    } catch (e) {
      Util.toast('Erro ao sortear: ' + e.message, 'danger');
      await carregar();
    }
  }

  function garantirModalResultado() {
    if (document.getElementById('modal-bingo-resultado')) return;
    const html = `
      <div class="modal fade" id="modal-bingo-resultado" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header" id="bingo-resultado-header">
              <h5 class="modal-title"><i class="fas fa-dice me-2"></i><span id="bingo-resultado-tema-nome"></span></h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body text-center">
              <div id="bingo-resultado-ciclo-aviso" class="alert alert-info small d-none"></div>
              <p class="fs-5 mb-0" id="bingo-resultado-texto"></p>
              <p class="text-success small mt-2 mb-0 d-none" id="bingo-resultado-concluido-info"></p>
              <div id="bingo-resultado-concluir-form" class="mt-4 text-start d-none">
                <label class="form-label small">Livro que cumpriu este desafio (opcional)</label>
                <input type="text" id="bingo-input-livro" class="form-control" list="bingo-livros-datalist" placeholder="Digite o nome do livro..." autocomplete="off">
                <datalist id="bingo-livros-datalist"></datalist>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Fechar</button>
              <button type="button" class="btn btn-outline-success d-none" id="bingo-btn-abrir-concluir"><i class="fas fa-check me-1"></i> Marcar como concluído</button>
              <button type="button" class="btn btn-success d-none" id="bingo-btn-confirmar-concluir"><i class="fas fa-check me-1"></i> Confirmar conclusão</button>
              <button type="button" class="btn btn-outline-danger d-none" id="bingo-btn-desfazer-concluir"><i class="fas fa-rotate-left me-1"></i> Desfazer conclusão</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  async function popularDatalistLivros() {
    const datalist = document.getElementById('bingo-livros-datalist');
    if (!datalist) return;
    if (!livrosCache) {
      try { livrosCache = await API.enviar({ acao: 'listBooks' }); } catch (e) { livrosCache = []; }
    }
    datalist.innerHTML = (livrosCache || []).map(l => `<option value="${Util.escapeHTML(l.Título)}">`).join('');
  }

  function abrirModalResultado(tema, desafio, cicloNovo) {
    garantirModalResultado();
    document.getElementById('bingo-resultado-tema-nome').textContent = tema.nome;
    document.getElementById('bingo-resultado-texto').textContent = desafio.texto;
    document.getElementById('bingo-resultado-header').style.background = tema.cor;
    document.getElementById('bingo-resultado-header').style.color = '#fff';

    const avisoCiclo = document.getElementById('bingo-resultado-ciclo-aviso');
    if (cicloNovo) {
      avisoCiclo.classList.remove('d-none');
      avisoCiclo.innerHTML = '<i class="fas fa-rotate me-1"></i>Você esgotou os 50 desafios deste tema! Um novo ciclo começou — os desafios já podem se repetir.';
    } else {
      avisoCiclo.classList.add('d-none');
    }

    const formConcluir = document.getElementById('bingo-resultado-concluir-form');
    formConcluir.classList.add('d-none');
    const btnAbrirConcluir = document.getElementById('bingo-btn-abrir-concluir');
    const btnConfirmarConcluir = document.getElementById('bingo-btn-confirmar-concluir');
    const btnDesfazer = document.getElementById('bingo-btn-desfazer-concluir');
    const infoConcluido = document.getElementById('bingo-resultado-concluido-info');
    const inputLivro = document.getElementById('bingo-input-livro');
    inputLivro.value = '';

    if (desafio.status === 'concluido') {
      btnAbrirConcluir.classList.add('d-none');
      btnConfirmarConcluir.classList.add('d-none');
      btnDesfazer.classList.remove('d-none');
      infoConcluido.classList.remove('d-none');
      infoConcluido.innerHTML = `<i class="fas fa-circle-check me-1"></i>Concluído${desafio.livro_titulo ? ' com: ' + Util.escapeHTML(desafio.livro_titulo) : ''}`;
    } else {
      btnAbrirConcluir.classList.remove('d-none');
      btnConfirmarConcluir.classList.add('d-none');
      btnDesfazer.classList.add('d-none');
      infoConcluido.classList.add('d-none');
    }

    const novoBtnAbrir = btnAbrirConcluir.cloneNode(true);
    btnAbrirConcluir.replaceWith(novoBtnAbrir);
    novoBtnAbrir.addEventListener('click', async () => {
      await popularDatalistLivros();
      formConcluir.classList.remove('d-none');
      novoBtnAbrir.classList.add('d-none');
      document.getElementById('bingo-btn-confirmar-concluir').classList.remove('d-none');
    });

    const novoBtnConfirmar = btnConfirmarConcluir.cloneNode(true);
    btnConfirmarConcluir.replaceWith(novoBtnConfirmar);
    novoBtnConfirmar.addEventListener('click', () => concluirDesafio(desafio, tema, inputLivro.value.trim()));

    const novoBtnDesfazer = btnDesfazer.cloneNode(true);
    btnDesfazer.replaceWith(novoBtnDesfazer);
    novoBtnDesfazer.addEventListener('click', () => desfazerConclusao(desafio, tema));

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-bingo-resultado'));
    modal.show();
  }

  async function concluirDesafio(desafio, tema, nomeLivroDigitado) {
    let livroId = null;
    if (nomeLivroDigitado && livrosCache) {
      const achado = livrosCache.find(l => l.Título.toLowerCase() === nomeLivroDigitado.toLowerCase());
      if (achado) livroId = achado.ID;
    }
    try {
      const resp = await API.enviar({ acao: 'bingoConcluir', id: desafio.id, livroId });
      if (!resp || resp.erro) { Util.toast('Não foi possível concluir: ' + (resp && resp.erro), 'danger'); return; }
      const lista = desafiosPorTema[tema.id] || [];
      const idx = lista.findIndex(d => d.id === desafio.id);
      if (idx >= 0) lista[idx] = resp.desafio;
      Util.toast('Desafio concluído! 🎉', 'success');
      const modalEl = document.getElementById('modal-bingo-resultado');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
      renderResumo();
      renderTemas();
    } catch (e) {
      Util.toast('Erro ao concluir: ' + e.message, 'danger');
    }
  }

  async function desfazerConclusao(desafio, tema) {
    try {
      const resp = await API.enviar({ acao: 'bingoDesfazerConclusao', id: desafio.id });
      if (!resp || resp.erro) { Util.toast('Não foi possível desfazer: ' + (resp && resp.erro), 'danger'); return; }
      const lista = desafiosPorTema[tema.id] || [];
      const idx = lista.findIndex(d => d.id === desafio.id);
      if (idx >= 0) lista[idx] = resp.desafio;
      Util.toast('Conclusão desfeita.', 'success');
      const modalEl = document.getElementById('modal-bingo-resultado');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
      renderResumo();
      renderTemas();
    } catch (e) {
      Util.toast('Erro ao desfazer: ' + e.message, 'danger');
    }
  }

  return { init };
})();
