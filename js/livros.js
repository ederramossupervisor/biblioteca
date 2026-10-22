const Livros = (() => {
  const form = document.getElementById('book-form');
  const coverPreview = document.getElementById('cover-preview');
  const urlCapa = document.getElementById('urlCapa');
  const loadCoverBtn = document.getElementById('load-cover-btn');

  let editandoLivroID = null;
  let notaSelecionada = 0; // valor da nota em estrelas (0 a 5)

  function init() {
    if (!form) {
      console.warn('⚠️ Formulário de livro não encontrado no DOM.');
      return;
    }

    prepararEstrelasFormulario();
    Classificacao.iniciar();

    loadCoverBtn.addEventListener('click', () => {
      const urlConvertida = Util.converterLinkDrive(urlCapa.value);
      mostrarCapa(urlConvertida);
    });

    urlCapa.addEventListener('change', () => {
      const urlConvertida = Util.converterLinkDrive(urlCapa.value);
      mostrarCapa(urlConvertida);
    });

    form.addEventListener('submit', salvarLivro);
    document.getElementById('clear-form-btn')?.addEventListener('click', limparFormulario);

    criarBotaoCancelarEdicao();
    console.log('✅ Módulo Livros pronto.');
  }

  /* ========== ESTRELAS NO FORMULÁRIO ========== */
  function prepararEstrelasFormulario() {
    const notaInput = document.getElementById('nota-hidden');
    if (!notaInput) return;
    // Esconde o input original (agora não será mais usado diretamente)
    const container = document.getElementById('nota-estrelas-container');
    if (!container) return;
    container.innerHTML = gerarEstrelasHTML(0, true);

    container.addEventListener('click', (e) => {
      const star = e.target.closest('.estrela-editavel');
      if (!star) return;
      const valor = parseInt(star.dataset.valor);
      notaSelecionada = valor;
      atualizarEstrelasVisual(container, valor);
    });
  }

  function gerarEstrelasHTML(valor, editavel = false) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      const preenchida = i <= valor;
      const classe = preenchida ? 'fas fa-star' : 'far fa-star';
      if (editavel) {
        html += `<i class="${classe} estrela-editavel" data-valor="${i}" style="cursor:pointer; color:#B8934B; font-size:1.2rem;"></i>`;
      } else {
        html += `<i class="${classe}" style="color:#B8934B; font-size:1.2rem;"></i>`;
      }
    }
    return html;
  }

  function atualizarEstrelasVisual(container, valor) {
    const estrelas = container.querySelectorAll('.estrela-editavel');
    estrelas.forEach((estrela, index) => {
      const i = index + 1;
      if (i <= valor) {
        estrela.className = 'fas fa-star estrela-editavel';
      } else {
        estrela.className = 'far fa-star estrela-editavel';
      }
      estrela.style.color = '#B8934B';
      estrela.style.cursor = 'pointer';
      estrela.style.fontSize = '1.2rem';
    });
    const hidden = document.getElementById('nota-hidden');
    if (hidden) hidden.value = valor;
  }

  /* ========== PREENCHIMENTO DO FORMULÁRIO ========== */
  function preencherFormularioCompleto(livro) {
    document.getElementById('titulo').value = livro.Título || '';
    document.getElementById('subtitulo').value = livro.Subtítulo || '';
    document.getElementById('autor').value = livro.Autor || '';
    document.getElementById('editora').value = livro.Editora || '';
    document.getElementById('ano').value = livro.Ano || '';
    document.getElementById('edicao').value = livro.Edição || '';
    // ISBN removido, campos de idioma e nacionalidade mantidos
    document.getElementById('idioma').value = livro.Idioma || '';
    document.getElementById('classico').checked = livro.Clássico === 'true' || livro.Clássico === true;
    document.getElementById('nacionalidadeAutor').value = livro.NacionalidadeAutor || '';
    document.getElementById('numeroPaginas').value = livro.NúmeroPáginas || '';
    document.getElementById('formato').value = livro.Formato || 'Físico';
    Classificacao.definir(livro.Gênero, livro.Subgênero);
    document.getElementById('status').value = livro.Status || 'Quero ler';
    // A nota já é guardada em estrelas (0 a 5). Só valores acima de 5 (formato antigo, 0-10)
    // são convertidos; antes toda nota era dividida por 2, o que reduzia a nota a cada edição.
    const notaOriginal = Number(livro.Nota) || 0;
    notaSelecionada = notaOriginal > 5
      ? Math.min(5, Math.round(notaOriginal / 2))
      : Math.max(0, Math.round(notaOriginal));
    const container = document.getElementById('nota-estrelas-container');
    if (container) atualizarEstrelasVisual(container, notaSelecionada);
    // Preço e Tags removidos
    document.getElementById('observacoes').value = livro.Observações || '';
    document.getElementById('urlCapa').value = livro.URLCapa || livro.ImagemCapa || '';
    document.getElementById('paginasLidas').value = livro.PáginasLidas || 0;
    document.getElementById('paginasAnosAnteriores').value = livro.PaginasAnosAnteriores || 0;
    document.getElementById('paginasExtra').value = livro.PaginasExtra || 0;
    document.getElementById('paginasExtraAno').value = livro.PaginasExtraAno || '';
    document.getElementById('favorito').checked = livro.Favorito === 'true' || livro.Favorito === true;
    if (livro.URLCapa || livro.ImagemCapa) {
      mostrarCapa(livro.URLCapa || livro.ImagemCapa);
    }
    document.getElementById('data-inicio').value = livro.DataInício || '';
    document.getElementById('data-termino').value = livro.DataTérmino || '';
  }

  function mostrarCapa(url) {
    coverPreview.innerHTML = url
      ? `<img src="${url}" alt="Capa do livro" class="img-fluid" onerror="this.parentElement.innerHTML='<span class=\'text-danger\'>Imagem inválida</span>'">`
      : '<span class="text-muted">Pré-visualização</span>';
  }

  /* ========== SALVAR / EDITAR / EXCLUIR ========== */
  async function salvarLivro(e) {
    e.preventDefault();

    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      Util.toast('Preencha os campos obrigatórios (Título e Autor).', 'warning');
      return;
    }

    const book = {
      titulo: document.getElementById('titulo').value,
      subtitulo: document.getElementById('subtitulo').value,
      autor: document.getElementById('autor').value,
      editora: document.getElementById('editora').value,
      classico: document.getElementById('classico').checked,
      ano: document.getElementById('ano').value,
      edicao: document.getElementById('edicao').value,
      idioma: document.getElementById('idioma').value,
      nacionalidadeAutor: document.getElementById('nacionalidadeAutor').value,
      numeroPaginas: document.getElementById('numeroPaginas').value,
      formato: document.getElementById('formato').value,
      genero: document.getElementById('genero').value,
      subgenero: document.getElementById('subgenero').value,
      status: document.getElementById('status').value,
      nota: notaSelecionada,   // valor de 0 a 5
      favorito: document.getElementById('favorito').checked,
      observacoes: document.getElementById('observacoes').value,
      urlCapa: Util.converterLinkDrive(urlCapa.value),
      // "paginasLidas" não é mais enviado: o backend calcula sozinho a
      // partir de paginasAnosAnteriores + paginasExtra + soma das sessões.
      dataInicio: document.getElementById('data-inicio').value,
      paginasAnosAnteriores: Number(document.getElementById('paginasAnosAnteriores').value) || 0,
      paginasExtra: Number(document.getElementById('paginasExtra').value) || 0,
      paginasExtraAno: document.getElementById('paginasExtraAno').value
        ? Number(document.getElementById('paginasExtraAno').value)
        : '',
      dataTermino: document.getElementById('data-termino').value
    };

    const btnSubmit = form.querySelector('button[type="submit"]');
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Salvando...';

    try {
      const isEdicao = !!editandoLivroID;
      let resposta;
      if (editandoLivroID) {
        resposta = await API.enviar({ acao: 'updateBook', id: editandoLivroID, book });
      } else {
        resposta = await API.enviar({ acao: 'addBook', book });
      }

      if (resposta && resposta.status === 'ok') {
        Util.toast(isEdicao ? 'Livro atualizado!' : 'Livro adicionado!', 'success');
        limparFormulario();
        cancelarEdicao();
        if (isEdicao) voltarParaBiblioteca();
      } else {
        throw new Error(resposta?.mensagem || resposta?.erro || 'Falha no servidor');
      }
    } catch (erro) {
      Util.toast('Erro ao salvar: ' + erro.message, 'danger');
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = editandoLivroID
        ? '<i class="fas fa-save me-1"></i> Atualizar Livro'
        : '<i class="fas fa-save me-1"></i> Salvar Livro';
    }
  }

  function limparFormulario() {
    form.reset();
    form.classList.remove('was-validated');
    coverPreview.innerHTML = '<span class="text-muted">Pré-visualização</span>';
    notaSelecionada = 0;
    const container = document.getElementById('nota-estrelas-container');
    if (container) atualizarEstrelasVisual(container, 0);
  }

  function cancelarEdicao() {
    editandoLivroID = null;
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.classList.add('d-none');
    const btnSubmit = form.querySelector('button[type="submit"]');
    if (btnSubmit) btnSubmit.innerHTML = '<i class="fas fa-save me-1"></i> Salvar Livro';
    limparFormulario();
  }

  function voltarParaBiblioteca() {
    const link = document.querySelector('.nav-link[data-page="biblioteca"]');
    if (link) link.click();
    else {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const pageBiblioteca = document.getElementById('page-biblioteca');
      if (pageBiblioteca) {
        pageBiblioteca.classList.add('active');
        if (typeof Biblioteca !== 'undefined' && Biblioteca.init) Biblioteca.init();
      }
    }
  }

  function editarLivro(livro) {
    const formEl = document.getElementById('book-form');
    if (!formEl) {
      Util.toast('Erro: formulário de livro não encontrado.', 'danger');
      return;
    }
    if (!document.getElementById('cancel-edit-btn')) {
      criarBotaoCancelarEdicao();
    }
    preencherFormularioCompleto(livro);
    editandoLivroID = livro.ID;
    const btnSubmit = formEl.querySelector('button[type="submit"]');
    if (btnSubmit) btnSubmit.innerHTML = '<i class="fas fa-save me-1"></i> Atualizar Livro';
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.classList.remove('d-none');
    document.querySelectorAll('.nav-link[data-page="adicionar"]').forEach(l => l.click());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function criarBotaoCancelarEdicao() {
    if (!document.getElementById('cancel-edit-btn')) {
      const btnCancel = document.createElement('button');
      btnCancel.type = 'button';
      btnCancel.id = 'cancel-edit-btn';
      btnCancel.className = 'btn btn-outline-warning ms-2 d-none';
      btnCancel.textContent = 'Cancelar Edição';
      btnCancel.addEventListener('click', cancelarEdicao);
      const botoesDiv = document.querySelector('#book-form .d-flex');
      if (botoesDiv) {
        botoesDiv.prepend(btnCancel);
      }
    }
  }

  // Inicialização
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init, editarLivro, cancelarEdicao };
})();
