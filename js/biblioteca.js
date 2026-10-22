const Biblioteca = (() => {
  let livros = [];
  let statusFiltro = '';
  const grid = document.getElementById('biblioteca-grid');
  const searchInput = document.getElementById('biblioteca-search');
  const contador = document.getElementById('biblioteca-contador');

  async function init() {
    if (!grid) return;
    await carregarLivros();
    configurarEventos();
    console.log('✅ Módulo Biblioteca pronto.');
  }

  async function carregarLivros() {
    // Mostra o que já temos em IndexedDB na hora (stale-while-revalidate),
    // sem esperar a rede pra pintar a tela.
    let temCacheLocal = false;
    try {
      const cached = await DB.obterLivros();
      if (cached && cached.length > 0) {
        livros = cached;
        temCacheLocal = true;
        aplicarFiltros();
      }
    } catch (e) {
      console.warn('Falha ao ler cache local de livros:', e);
    }

    try {
      const resp = await API.enviar({ acao: 'listAllBooks' });
      if (Array.isArray(resp)) {
        livros = resp;
        DB.salvarLivros(resp).catch(e => console.warn('Cache livros falhou:', e));
        aplicarFiltros();
      } else if (resp && resp.erro) {
        throw new Error(resp.erro);
      }
    } catch (e) {
      console.warn('Falha na API ao atualizar livros.');
      if (temCacheLocal) {
        Util.toast('Modo offline - dados do último acesso.', 'info');
      } else {
        Util.toast('Sem conexão e nenhum dado em cache.', 'danger');
      }
    }
  }

  function configurarEventos() {
    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(aplicarFiltros, 150);
    });

    document.querySelectorAll('#biblioteca-filtros-status .chip-filtro').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#biblioteca-filtros-status .chip-filtro').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        statusFiltro = chip.dataset.status || '';
        aplicarFiltros();
      });
    });

    // Botão flutuante de adicionar livro (canto da página Biblioteca)
    const btnFabAdicionar = document.getElementById('btn-fab-adicionar-livro');
    if (btnFabAdicionar) {
      btnFabAdicionar.addEventListener('click', () => {
        if (typeof activatePageGlobal === 'function') {
          activatePageGlobal('adicionar');
        }
      });
    }
  }

  function textoSeguro(valor) {
    return String(valor === null || valor === undefined ? '' : valor).toLowerCase();
  }

  function aplicarFiltros() {
    let filtrados = [...livros];

    if (statusFiltro) {
      filtrados = filtrados.filter(l => l.Status === statusFiltro);
    }

    const termo = searchInput.value.toLowerCase();
    if (termo) {
      filtrados = filtrados.filter(l =>
        textoSeguro(l.Título).includes(termo) ||
        textoSeguro(l.Autor).includes(termo) ||
        textoSeguro(l.Tags).includes(termo)
      );
    }

    filtrados.sort((a, b) => {
    // Prioridade: Lendo = 0, outros = 1
    const statusA = (a.Status === 'Lendo') ? 0 : 1;
    const statusB = (b.Status === 'Lendo') ? 0 : 1;
    if (statusA !== statusB) return statusA - statusB;
    // Empate: ordena por título
    return (a.Título || '').localeCompare(b.Título || '');
  });

    contador.textContent = `${filtrados.length} livro(s) encontrado(s)`;
    renderizarGrade(filtrados);
  }

  // Renderiza estrelas (1 a 5) como ícones Font Awesome
  function renderizarEstrelas(nota, livroID, editavel = false) {
    const notaNum = Math.round(Number(nota)) || 0; // garante inteiro 0-5
    const maxEstrelas = 5;
    let html = '<span class="estrelas-container" style="display:inline-flex; gap:2px; align-items:center;">';
    for (let i = 1; i <= maxEstrelas; i++) {
      const classe = i <= notaNum ? 'fas fa-star' : 'far fa-star';
      if (editavel) {
        html += `<i class="${classe} estrela-editavel" data-estrela="${i}" data-livro="${livroID}" style="cursor:pointer; color:#f59e0b; font-size:1rem;" title="${i} estrela(s)"></i>`;
      } else {
        html += `<i class="${classe}" style="color:#f59e0b; font-size:0.9rem;"></i>`;
      }
    }
    html += '</span>';
    return html;
  }

  async function atualizarNota(livroID, novaNota) {
    try {
      await API.enviar({ acao: 'updateBook', id: livroID, book: { nota: novaNota } });
      // Atualiza o cache local
      const livro = livros.find(l => l.ID === livroID);
      if (livro) livro.Nota = novaNota;
      Util.toast('Nota atualizada!', 'success');
    } catch (e) {
      Util.toast('Erro ao salvar nota', 'danger');
    }
  }

  function renderizarGrade(livrosFiltrados) {
  grid.innerHTML = '';
  if (livrosFiltrados.length === 0) {
    grid.innerHTML = '<div class="col-12 text-center text-muted py-5">Nenhum livro encontrado</div>';
    return;
  }

  livrosFiltrados.forEach(livro => {
    const col = document.createElement('div');
    col.className = 'col-12'; // sempre um por linha

    const progresso = livro.NúmeroPáginas > 0 ? Math.round(((livro.PáginasLidas || 0) / livro.NúmeroPáginas) * 100) : 0;
    const statusClass = livro.Status === 'Finalizado' ? 'bg-success' : '';

    col.innerHTML = `
      <div class="livro-card livro-card-horizontal" data-id="${livro.ID}">
        <div class="d-flex align-items-start p-3">
          <!-- Informações à esquerda -->
          <div class="flex-grow-1 me-3">
            <div class="titulo fw-bold mb-1">${Util.escapeHTML(livro.Título) || 'Sem título'}</div>
            <div class="autor text-muted small mb-2">${Util.escapeHTML(livro.Autor) || 'Desconhecido'}</div>
            <span class="badge ${getStatusBadgeClass(livro.Status)} me-1">${livro.Status}</span>
            <div class="mt-2">${renderizarEstrelas(livro.Nota, livro.ID, true)}</div>
          </div>
          <!-- Capa à direita -->
          <div class="capa-wrapper-horizontal flex-shrink-0" style="width:70px; height:100px; background:var(--bg-secondary); border-radius:4px; overflow:hidden;">
            ${livro.URLCapa ? `<img src="${livro.URLCapa}" alt="Capa" loading="lazy" style="width:100%; height:100%; object-fit:cover;">` : '<i class="fas fa-book fa-2x text-muted d-flex align-items-center justify-content-center h-100"></i>'}
          </div>
        </div>
        <!-- Barra de progresso -->
        <div class="px-3 pb-2">
          <div class="progress" style="height:6px;" title="${progresso}% concluído">
            <div class="progress-bar ${statusClass}" role="progressbar" style="width:${progresso}%" aria-valuenow="${progresso}" aria-valuemin="0" aria-valuemax="100"></div>
          </div>
          <small class="text-muted">${progresso}% concluído</small>
        </div>
      </div>`;
    grid.appendChild(col);
  });

  // Eventos das estrelas
  grid.querySelectorAll('.estrela-editavel').forEach(estrela => {
    estrela.addEventListener('click', async (e) => {
      e.stopPropagation();
      const livroID = estrela.dataset.livro;
      const estrelaClicada = parseInt(estrela.dataset.estrela);
      const livro = livros.find(l => l.ID === livroID);
      const notaAtual = Math.round(Number(livro?.Nota)) || 0;
      const novaNota = (estrelaClicada === notaAtual) ? 0 : estrelaClicada;
      await atualizarNota(livroID, novaNota);
      aplicarFiltros();
    });
  });

  // Clique no card (exceto nas estrelas) abre o modal
  grid.querySelectorAll('.livro-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('estrela-editavel')) return;
      abrirModal(card.dataset.id);
    });
  });
}
  function abrirModal(id) {
    const livro = livros.find(l => l.ID === id);
    if (!livro) return;

    document.getElementById('modal-titulo').textContent = livro.Título || 'Detalhes';
    const progresso = livro.NúmeroPáginas > 0 ? Math.round(((livro.PáginasLidas || 0) / livro.NúmeroPáginas) * 100) : 0;

    document.getElementById('modal-conteudo').innerHTML = `
      <div class="row">
        <div class="col-md-4 text-center mb-3">
          ${livro.URLCapa ? `<img src="${livro.URLCapa}" alt="Capa" loading="lazy" class="capa-detalhe img-fluid shadow">` : '<i class="fas fa-book fa-5x text-muted"></i>'}
        </div>
        <div class="col-md-8">
          <h4>${Util.escapeHTML(livro.Título)}</h4>
          <p class="text-muted">${Util.escapeHTML(livro.Autor) || 'Autor desconhecido'}</p>
          <div class="mb-2">${renderizarEstrelas(livro.Nota, livro.ID, true)}</div>
          <table class="table table-sm">
            <tr><td><strong>Status</strong></td><td><span class="badge ${getStatusBadgeClass(livro.Status)}">${Util.escapeHTML(livro.Status)}</span></td></tr>
            <tr><td><strong>Editora</strong></td><td>${Util.escapeHTML(livro.Editora) || '-'}</td></tr>
            <tr><td><strong>Ano</strong></td><td>${livro.Ano || '-'}</td></tr>
            <tr><td><strong>Páginas</strong></td><td>${livro.NúmeroPáginas || '-'}</td></tr>
            <tr><td><strong>Páginas lidas</strong></td><td>${livro.PáginasLidas || 0} (${progresso}%)</td></tr>
            <tr><td><strong>Formato</strong></td><td>${Util.escapeHTML(livro.Formato) || '-'}</td></tr>
            <tr><td><strong>Início</strong></td><td>${formatarData(livro.DataInício)}</td></tr>
            <tr><td><strong>Término</strong></td><td>${formatarData(livro.DataTérmino)}</td></tr>
            <tr><td><strong>Gênero</strong></td><td>${Util.escapeHTML(livro.Gênero) || '-'}</td></tr>
            <tr><td><strong>Subgênero</strong></td><td>${Util.escapeHTML(livro.Subgênero) || '-'}</td></tr>
            <tr><td><strong>Tags</strong></td><td>${Util.escapeHTML(livro.Tags) || '-'}</td></tr>
            <tr><td><strong>ISBN</strong></td><td>${Util.escapeHTML(livro.ISBN) || '-'}</td></tr>
            <tr><td><strong>Cadastro</strong></td><td>${Util.formatDate(livro.DataCadastro)}</td></tr>
          </table>
          ${livro.Observacoes ? `<p><strong>Observações:</strong> ${Util.escapeHTML(livro.Observacoes)}</p>` : ''}
          <div class="mt-3 d-flex gap-2 flex-wrap">
            <button class="btn btn-outline-primary btn-editar-livro" data-id="${livro.ID}">Editar</button>
            <button class="btn btn-outline-secondary btn-jornada-livro" data-id="${livro.ID}"><i class="fas fa-timeline me-1"></i>Jornada</button>
            <button class="btn btn-outline-danger btn-excluir-livro" data-id="${livro.ID}">Excluir</button>
          </div>
        </div>
      </div>`;

    const modal = new bootstrap.Modal(document.getElementById('livro-modal'));
    modal.show();

    // Eventos das estrelas no modal
    document.querySelectorAll('#modal-conteudo .estrela-editavel').forEach(estrela => {
      estrela.addEventListener('click', async (e) => {
        const livroID = estrela.dataset.livro;
        const estrelaClicada = parseInt(estrela.dataset.estrela);
        const livro = livros.find(l => l.ID === livroID);
        const notaAtual = Math.round(Number(livro?.Nota)) || 0;
        const novaNota = (estrelaClicada === notaAtual) ? 0 : estrelaClicada;
        await atualizarNota(livroID, novaNota);
        // Atualiza a exibição no modal sem fechá-lo
        abrirModal(livroID);
      });
    });

    document.querySelector('.btn-editar-livro').addEventListener('click', () => {
      modal.hide();
      if (typeof Livros !== 'undefined' && Livros.editarLivro) {
        Livros.editarLivro(livro);
      }
    });

    document.querySelector('.btn-jornada-livro').addEventListener('click', () => {
      modal.hide();
      if (typeof Jornada !== 'undefined' && Jornada.abrirJornadaLivro) {
        Jornada.abrirJornadaLivro(livro.ID, livro.Título);
      }
    });

    document.querySelector('.btn-excluir-livro').addEventListener('click', async () => {
      const confirmouExcluirLivro = await Util.confirmar('Tem certeza que deseja excluir este livro e todos os seus registros?', { titulo: 'Excluir livro', variante: 'danger', confirmarTexto: 'Excluir tudo' });
      if (confirmouExcluirLivro) {
        if (!navigator.onLine) {
          Util.toast('Você está offline. Conecte-se para excluir.', 'warning');
          return;
        }
        try {
          await API.enviar({ acao: 'deleteBook', id: livro.ID });
          modal.hide();
          await carregarLivros();
          Util.toast('Livro excluído', 'info');
        } catch (e) {
          Util.toast('Erro ao excluir: ' + e.message, 'danger');
        }
      }
    });
  }
  function getStatusBadgeClass(status) {
    const normalized = (status || '').toLowerCase().trim();
    const map = {
      'lendo': 'badge-status-lendo',
      'quero ler': 'badge-status-quero-ler',
      'finalizado': 'badge-status-finalizado',
      'abandonado': 'badge-status-abandonado',
      'relendo': 'badge-status-relendo'
    };
    return map[normalized] || 'bg-primary';
  }
  function formatarData(dataISO) {
    if (!dataISO) return '-';
    try {
      const data = new Date(dataISO);
      const dia = data.getUTCDate().toString().padStart(2, '0');
      const mes = (data.getUTCMonth() + 1).toString().padStart(2, '0');
      const ano = data.getUTCFullYear();
      return `${dia}/${mes}/${ano}`;
    } catch (e) {
      return dataISO;
    }
  }

  return { init, abrirDetalhes: abrirModal };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', Biblioteca.init);
} else {
  Biblioteca.init();
}
