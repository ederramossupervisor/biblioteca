const Anotacoes = (() => {
  let todasAnotacoes = [];
  let livrosCache = [];

  async function init() {
    const page = document.getElementById('page-anotacoes');
    if (!page || !page.classList.contains('active')) return;

    console.log('📝 Carregando Anotações...');
    await carregarLivrosCache();
    await carregarTodasAnotacoes();
    configurarPesquisa();
    carregarGrifos();
    document.getElementById('tab-grifos')?.addEventListener('shown.bs.tab', carregarGrifos);
    console.log('✅ Módulo Anotações pronto.');
  }

  // ===== Grifos feitos no leitor (EPUB e PDF) =====
  // Os grifos ficam salvos no localStorage por livro (chave calixteca_highlights_*
  // — ver js/leitor.js), não na planilha. Aqui só juntamos tudo pra exibir numa
  // lista só, agrupada por livro.
  function carregarGrifos() {
    const container = document.getElementById('lista-grifos');
    if (!container) return;

    const grupos = {}; // chave do livro -> { titulo, autor, vinculado, itens: [] }

    for (const chaveStorage of Util.lsNomes('calixteca_highlights_')) {
      let itens;
      try {
        itens = JSON.parse(Util.lsGet(chaveStorage) || '[]');
      } catch (e) { continue; }
      if (!Array.isArray(itens) || itens.length === 0) continue;

      const chaveLivro = chaveStorage.replace('calixteca_highlights_', '');
      let titulo = 'Livro não identificado';
      let autor = '';
      let vinculado = false;

      if (chaveLivro.startsWith('id_')) {
        const livroID = chaveLivro.replace('id_', '');
        const livro = livrosCache.find(l => l.ID === livroID);
        if (livro) {
          titulo = livro.Título || titulo;
          autor = livro.Autor || '';
          vinculado = true;
        } else {
          titulo = 'Livro removido da biblioteca';
        }
      } else if (chaveLivro.startsWith('titulo_')) {
        // Ainda não vinculado à biblioteca — o melhor que temos é o slug do título
        titulo = chaveLivro.replace('titulo_', '').replace(/-/g, ' ');
        titulo = titulo.charAt(0).toUpperCase() + titulo.slice(1);
      }

      grupos[chaveLivro] = { titulo, autor, vinculado, itens };
    }

    const chavesLivros = Object.keys(grupos);
    if (chavesLivros.length === 0) {
      container.innerHTML = '<p class="text-muted text-center py-4">Nenhum grifo ainda. Selecione um trecho no leitor e toque em "Grifar".</p>';
      return;
    }

    container.innerHTML = chavesLivros.map(chave => {
      const grupo = grupos[chave];
      const itensOrdenados = [...grupo.itens].sort((a, b) => new Date(b.data) - new Date(a.data));
      return `
        <div class="card mb-3 shadow-sm">
          <div class="card-header fw-bold d-flex justify-content-between align-items-center">
            <span>${Util.escapeHTML(grupo.titulo)}${grupo.autor ? ' — ' + Util.escapeHTML(grupo.autor) : ''}</span>
            ${!grupo.vinculado ? '<span class="badge bg-secondary">não vinculado</span>' : ''}
          </div>
          <ul class="list-group list-group-flush">
            ${itensOrdenados.map(h => `
              <li class="list-group-item" style="border-left: 4px solid ${h.cor || '#ffe58a'};">
                <blockquote class="blockquote mb-1" style="font-size: 0.95rem;">${Util.escapeHTML(h.texto)}</blockquote>
                <small class="text-muted">${h.tipo === 'pdf' ? `Página ${h.pagina}` : 'EPUB'} · ${Util.formatDate ? Util.formatDate(h.data) : new Date(h.data).toLocaleDateString('pt-BR')}</small>
              </li>
            `).join('')}
          </ul>
        </div>`;
    }).join('');
  }

  async function carregarLivrosCache() {
    try {
      const resp = await API.enviar({ acao: 'listBooks' });
      if (Array.isArray(resp)) {
        livrosCache = resp;
      }
    } catch (e) {
      console.warn('Erro ao carregar livros para cache de anotações', e);
    }
  }

  async function carregarTodasAnotacoes() {
    try {
      const resp = await API.enviar({ acao: 'listNotes', livroID: '' });
      if (Array.isArray(resp)) {
        todasAnotacoes = resp;
        DB.salvarAnotacoes(resp).catch(e => console.warn('Cache anotações falhou:', e));
      }
    } catch (e) {
      console.warn('Falha na API, tentando cache offline...');
      const cached = await DB.obterAnotacoes();
      if (cached.length > 0) {
        todasAnotacoes = cached;
        Util.toast('Modo offline - dados do último acesso.', 'info');
      }
    }
    renderizarAnotacoes(todasAnotacoes);
  }

  function configurarPesquisa() {
    const searchInput = document.getElementById('anotacoes-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const termo = e.target.value.toLowerCase().trim();
        if (!termo) {
          renderizarAnotacoes(todasAnotacoes);
          return;
        }
        const filtradas = todasAnotacoes.filter(anot => {
          const livro = livrosCache.find(l => l.ID === anot.LivroID);
          const nomeLivro = livro ? livro.Título + ' ' + livro.Autor : '';
          const campos = [
            nomeLivro,
            anot.Capítulo || '',
            anot.Trecho || '',
            anot['Comentário'] || '',
            anot.Resumo || '',
            anot.Categoria || ''
          ];
          return campos.some(campo => String(campo || '').toLowerCase().includes(termo));
        });
        renderizarAnotacoes(filtradas);
      });
    }
  }

  function abrirModalCompartilhamento(trecho, livro, autor, urlCapa) {
    const modalElement = document.getElementById('modal-compartilhar-citacao');
    const existingModal = bootstrap.Modal.getInstance(modalElement);
    if (existingModal) {
      existingModal.hide();
      modalElement.addEventListener('hidden.bs.modal', () => {
        configurarEAbrirModal(trecho, livro, autor, urlCapa);
      }, { once: true });
    } else {
      configurarEAbrirModal(trecho, livro, autor, urlCapa);
    }
  }

  function configurarEAbrirModal(trecho, livro, autor, urlCapa) {
    const modalElement = document.getElementById('modal-compartilhar-citacao');

    document.getElementById('citacao-texto').textContent = `"${trecho}"`;
    document.getElementById('citacao-livro').textContent = livro;
    document.getElementById('citacao-autor').textContent = autor;

    const cartao = document.getElementById('cartao-citacao');

    // --- CORES DE FUNDO ---
    const containerCores = document.getElementById('cores-predefinidas');
    if (containerCores) {
      const coresPredefinidas = [
        { nome: 'Escuro padrão', valor: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', corTexto: '#fff' },
        { nome: 'Roxo elegante', valor: 'linear-gradient(135deg, #4c1d95 0%, #1e1b4b 100%)', corTexto: '#fff' },
        { nome: 'Azul sereno', valor: 'linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)', corTexto: '#fff' },
        { nome: 'Verde natureza', valor: 'linear-gradient(135deg, #064e3b 0%, #022c22 100%)', corTexto: '#fff' },
        { nome: 'Vinho', valor: 'linear-gradient(135deg, #4c0519 0%, #1f0808 100%)', corTexto: '#fff' },
        { nome: 'Claro limpo', valor: '#f8f9fa', corTexto: '#1e293b' },
        { nome: 'Sépia', valor: '#f5e6d3', corTexto: '#3e2723' },
        { nome: 'Preto', valor: '#000000', corTexto: '#ffffff' }
      ];
      containerCores.innerHTML = '';
      coresPredefinidas.forEach(tema => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-outline-secondary';
        btn.style.background = tema.valor;
        btn.style.color = tema.corTexto;
        btn.style.border = '1px solid var(--border-color)';
        btn.textContent = tema.nome;
        btn.addEventListener('click', () => {
          cartao.style.background = tema.valor;
          cartao.style.color = tema.corTexto;
        });
        containerCores.appendChild(btn);
      });
    }

    // --- CAPA DO LIVRO ---
    const btnCapa = document.getElementById('btn-fundo-capa');
    if (btnCapa) {
      btnCapa.onclick = async () => {
        if (!urlCapa) {
          Util.toast('Este livro não possui capa cadastrada.', 'warning');
          return;
        }
        try {
          const resp = await API.enviar({ acao: 'proxyImage', url: urlCapa });
          if (resp && resp.dataUrl) {
            cartao.style.background = `url(${resp.dataUrl}) center/cover no-repeat`;
            cartao.style.color = '#fff';
          }
        } catch (e) {
          Util.toast('Falha ao carregar capa.', 'danger');
        }
      };
    }

    // --- GRADIENTE ALEATÓRIO ---
    const btnGradiente = document.getElementById('btn-fundo-gradiente');
    if (btnGradiente) {
      btnGradiente.onclick = () => {
        const cores = ['#1e293b', '#0f172a', '#4c1d95', '#1e3a5f', '#064e3b', '#4c0519', '#1e1b4b'];
        const c1 = cores[Math.floor(Math.random() * cores.length)];
        const c2 = cores[Math.floor(Math.random() * cores.length)];
        cartao.style.background = `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
        cartao.style.color = '#ffffff';
      };
    }

    // --- TAMANHO DA FONTE ---
    const rangeFonte = document.getElementById('range-tamanho-fonte');
    if (rangeFonte) {
      rangeFonte.oninput = (e) => {
        document.getElementById('citacao-texto').style.fontSize = (e.target.value / 16) + 'rem';
      };
    }

    // --- ALINHAMENTO ---
    const botoesAlign = document.querySelectorAll('#modal-compartilhar-citacao [data-align]');
    botoesAlign.forEach(btn => {
      btn.addEventListener('click', function() {
        botoesAlign.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        cartao.style.textAlign = this.dataset.align;
      });
    });
    const btnCentro = document.querySelector('#modal-compartilhar-citacao [data-align="center"]');
    if (btnCentro) {
      btnCentro.classList.add('active');
      cartao.style.textAlign = 'center';
    }

    // --- FORMATO (FEED / STORIES) ---
    function definirFormato(formato) {
      const btnFeed = document.querySelector('#modal-compartilhar-citacao [data-format="feed"]');
      const btnStories = document.querySelector('#modal-compartilhar-citacao [data-format="stories"]');
      cartao.classList.remove('format-feed', 'format-stories');
      if (formato === 'stories') {
        cartao.classList.add('format-stories');
        btnStories.classList.add('active');
        btnFeed.classList.remove('active');
      } else {
        cartao.classList.add('format-feed');
        btnFeed.classList.add('active');
        btnStories.classList.remove('active');
      }
    }

    const btnFeed = document.querySelector('#modal-compartilhar-citacao [data-format="feed"]');
    const btnStories = document.querySelector('#modal-compartilhar-citacao [data-format="stories"]');
    if (btnFeed) btnFeed.onclick = () => definirFormato('feed');
    if (btnStories) btnStories.onclick = () => definirFormato('stories');
    definirFormato('feed');

    // --- BOTÃO DE DOWNLOAD COM FEEDBACK ---
    const btnDownload = document.getElementById('btn-baixar-citacao');
    if (btnDownload) {
      btnDownload.onclick = async () => {
        const textoOriginal = btnDownload.innerHTML;
        btnDownload.disabled = true;
        btnDownload.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Gerando...';

        try {
          const canvas = await html2canvas(cartao, {
            backgroundColor: null,
            scale: 2,
            useCORS: true,
            allowTaint: true
          });
          canvas.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `citacao-${livro.replace(/\s+/g, '-').toLowerCase()}.png`;
            a.click();
            URL.revokeObjectURL(url);
            Util.toast('Imagem baixada!', 'success');
          }, 'image/png');
        } catch (erro) {
          console.error(erro);
          Util.toast('Erro ao gerar imagem.', 'danger');
        } finally {
          btnDownload.disabled = false;
          btnDownload.innerHTML = textoOriginal;
        }
      };
    }


    // --- ABRIR O MODAL ---
    const modal = new bootstrap.Modal(modalElement);
    modal.show();

    modalElement.addEventListener('shown.bs.modal', () => {
      document.getElementById('btn-baixar-citacao')?.focus();
    }, { once: true });
  }

  // --- RENDERIZAR ANOTAÇÕES (POST-IT) ---
  function renderizarAnotacoes(lista) {
    const container = document.getElementById('lista-anotacoes');
    if (!container) return;
    container.innerHTML = '';

    if (lista.length === 0) {
      container.innerHTML = `
        <div class="empty-state text-center text-muted py-5">
          <i class="fas fa-sticky-note fa-3x mb-3"></i>
          <p>Nenhuma anotação encontrada.</p>
        </div>`;
      return;
    }

    lista.forEach(a => {
      const livro = livrosCache.find(l => l.ID === a.LivroID);
      const nomeLivro = livro ? livro.Título : 'Livro desconhecido';
      const nomeAutor = livro ? livro.Autor : 'Autor desconhecido';
      const urlCapa = livro ? (livro.URLCapa || livro.ImagemCapa || '') : '';
      const trecho = a.Trecho || a['Comentário'] || '';

      const div = document.createElement('div');
      div.className = 'anotacao-card d-flex flex-column';
      div.dataset.id = a.ID;

      div.innerHTML = `
        <div class="cabecalho d-flex justify-content-between align-items-center mb-2">
          <span class="badge bg-secondary">${Util.escapeHTML(a.Categoria) || 'Geral'}</span>
          <div class="d-flex align-items-center gap-1">
            ${trecho ? `
            <button class="btn btn-sm btn-link p-0 text-secondary compartilhar-anotacao" 
                    title="Compartilhar como citação" 
                    data-trecho="${trecho.replace(/"/g, '&quot;')}" 
                    data-livro="${nomeLivro}" 
                    data-autor="${nomeAutor}" 
                    data-capa="${urlCapa}">
              <i class="fas fa-camera"></i>
            </button>` : ''}
            <span class="data text-muted" style="font-size:0.7rem; white-space:nowrap;">
              ${a.Data ? new Date(a.Data).toLocaleDateString('pt-BR') : ''}
            </span>
          </div>
        </div>

        <div class="titulo-livro mb-2" style="font-size:0.85rem; font-weight:500; color:#333;">
          ${Util.escapeHTML(nomeLivro)} – ${Util.escapeHTML(nomeAutor)}
        </div>

        ${a.Capítulo ? `<p class="mb-1"><strong>Capítulo:</strong> ${Util.escapeHTML(a.Capítulo)}</p>` : ''}
        ${a.Página ? `<p class="mb-1"><strong>Página:</strong> ${Util.escapeHTML(a.Página)}</p>` : ''}
        ${a.Resumo ? `<p class="mb-1"><strong>Resumo:</strong> ${Util.escapeHTML(a.Resumo)}</p>` : ''}
        ${a.Trecho ? `<blockquote class="blockquote mb-1">${Util.escapeHTML(a.Trecho)}</blockquote>` : ''}
        ${a['Comentário'] ? `<p class="mb-0 fst-italic text-secondary">${Util.escapeHTML(a['Comentário'])}</p>` : ''}
      `;

      container.appendChild(div);
    });

    container.querySelectorAll('.compartilhar-anotacao').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const trecho = btn.dataset.trecho;
        const livro = btn.dataset.livro;
        const autor = btn.dataset.autor;
        const capa = btn.dataset.capa;
        abrirModalCompartilhamento(trecho, livro, autor, capa);
      });
    });
  }

  async function destacarAnotacao(id) {
    if (!todasAnotacoes.length) {
      await carregarLivrosCache();
      await carregarTodasAnotacoes();
    }
    requestAnimationFrame(() => {
      const card = document.querySelector(`.anotacao-card[data-id="${CSS.escape(String(id))}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('anotacao-destacada');
      setTimeout(() => card.classList.remove('anotacao-destacada'), 2500);
    });
  }

  return { init, destacarAnotacao };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Anotacoes.init());
} else {
  Anotacoes.init();
}
