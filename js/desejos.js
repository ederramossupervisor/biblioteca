const DesejosEmprestimos = (() => {
  let livrosCache = [];

  /* ========== INICIALIZAÇÃO ========== */
  async function init() {
    const page = document.getElementById('page-desejos');
    if (!page || !page.classList.contains('active')) return;

    console.log('📋 Carregando Desejos e Empréstimos...');
    await carregarDropdownLivrosEmprestimo();
    configurarForms();
    await listarDesejos();
    await listarEmprestimos();
    console.log('✅ Módulo Desejos/Empréstimos pronto.');
  }

  /* ========== CARREGAR LIVROS PARA EMPRÉSTIMO ========== */
  async function carregarDropdownLivrosEmprestimo() {
    try {
      const resp = await API.enviar({ acao: 'listBooks' });
      const select = document.getElementById('emprestimo-livro');
      if (select && Array.isArray(resp)) {
        select.innerHTML = '<option value="">Selecione um livro...</option>';
        resp.forEach(livro => {
          const opt = document.createElement('option');
          opt.value = livro.ID;
          opt.textContent = livro.Título + ' - ' + livro.Autor;
          select.appendChild(opt);
        });
        livrosCache = resp;
      }
    } catch (e) {
      console.error(e);
    }
  }

  /* ========== MÁSCARA DE MOEDA ========== */
  function formatarMoeda(input) {
    let valor = input.value.replace(/\D/g, ''); // remove tudo que não for dígito
    if (valor === '') {
      input.value = '';
      return;
    }
    const numero = parseInt(valor, 10) / 100;
    const formatado = numero.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
    input.value = formatado;
  }

  /* ========== CONFIGURAR FORMULÁRIOS ========== */
  function configurarForms() {
    // Máscara de preço no campo de desejo
    const precoInput = document.getElementById('desejo-preco');
    if (precoInput) {
      precoInput.addEventListener('input', () => formatarMoeda(precoInput));
    }

    // Formulário de Desejo
    document.getElementById('form-desejo')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const desejo = {
        titulo: document.getElementById('desejo-titulo').value,
        autor: document.getElementById('desejo-autor').value,
        prioridade: document.getElementById('desejo-prioridade').value,
        preco: document.getElementById('desejo-preco').value,
        link: document.getElementById('desejo-link').value,
        ondeComprar: document.getElementById('desejo-onde-comprar').value,
        observacoes: document.getElementById('desejo-obs').value
      };
      if (!desejo.titulo) return Util.toast('Título obrigatório', 'warning');
      try {
        const resp = await API.enviar({ acao: 'addWish', desejo });
        if (resp && resp.status === 'ok') {
          Util.toast('Desejo adicionado!', 'success');
          document.getElementById('form-desejo').reset();
          listarDesejos();
        }
      } catch (err) {
        Util.toast('Erro ao salvar desejo', 'danger');
      }
    });

    // Formulário de Empréstimo
    document.getElementById('form-emprestimo')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emprestimo = {
        livroID: document.getElementById('emprestimo-livro').value,
        paraQuem: document.getElementById('emprestimo-para').value,
        dataEmprestimo: document.getElementById('emprestimo-data').value || new Date().toLocaleDateString('en-CA'),
        previsaoDevolucao: document.getElementById('emprestimo-previsao').value
      };
      if (!emprestimo.livroID || !emprestimo.paraQuem) return Util.toast('Preencha os campos obrigatórios', 'warning');
      try {
        const resp = await API.enviar({ acao: 'addLoan', emprestimo });
        if (resp && resp.status === 'ok') {
          Util.toast('Empréstimo registrado!', 'success');
          document.getElementById('form-emprestimo').reset();
          listarEmprestimos();
        }
      } catch (err) {
        Util.toast('Erro ao registrar empréstimo', 'danger');
      }
    });
  }

  /* ========== LISTAR DESEJOS ========== */
  async function listarDesejos() {
    try {
      const resp = await API.enviar({ acao: 'listWishes' });
      const container = document.getElementById('lista-desejos');
      if (!container) return;
      container.innerHTML = '';

      if (Array.isArray(resp) && resp.length > 0) {
        resp.forEach(d => {
          const div = document.createElement('div');
          div.className = `desejo-card prioridade-${(d.Prioridade || '').toLowerCase()}`;
          div.innerHTML = `
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <strong>${Util.escapeHTML(d.Título)}</strong> ${d.Autor ? '- ' + Util.escapeHTML(d.Autor) : ''}
                <span class="badge bg-secondary ms-2">${Util.escapeHTML(d.Prioridade)}</span>
                ${d.Preço ? `<br><small>Preço: R$ ${Util.escapeHTML(String(d.Preço).replace(/^R\$\s?/, ''))}</small>` : ''}
                ${d.Link ? `<br><a href="${Util.escapeHTML(d.Link)}" target="_blank" rel="noopener" class="small">🔗 Ver</a>` : ''}
                ${d.Observacoes ? `<br><small class="text-muted">${Util.escapeHTML(d.Observacoes)}</small>` : ''}
              </div>
              <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-success btn-mover-biblioteca" data-id="${d.ID}" data-titulo="${Util.escapeHTML(d.Título)}" data-autor="${Util.escapeHTML(d.Autor || '')}" data-preco="${Util.escapeHTML(d.Preço || '')}" data-obs="${Util.escapeHTML(d.Observacoes || '')}" data-onde="${Util.escapeHTML(d.OndeComprar || '')}"><i class="fas fa-book"></i> Mover</button>
                <button class="btn btn-outline-danger btn-remover-desejo" data-id="${d.ID}"><i class="fas fa-trash"></i></button>
              </div>
            </div>`;
          container.appendChild(div);
        });

        container.querySelectorAll('.btn-remover-desejo').forEach(btn => {
          btn.addEventListener('click', async () => {
            const confirmouRemover = await Util.confirmar('Tem certeza que deseja remover este item da lista de desejos?', { titulo: 'Remover desejo', variante: 'danger', confirmarTexto: 'Remover' });
            if (confirmouRemover) {
              await API.enviar({ acao: 'removeWish', id: btn.dataset.id });
              listarDesejos();
              Util.toast('Desejo removido', 'info');
            }
          });
        });

        container.querySelectorAll('.btn-mover-biblioteca').forEach(btn => {
          btn.addEventListener('click', async () => {
            const desejo = {
              id: btn.dataset.id,
              titulo: btn.dataset.titulo,
              autor: btn.dataset.autor,
              preco: btn.dataset.preco,
              observacoes: btn.dataset.obs,
              ondeComprar: btn.dataset.onde
            };
            await API.enviar({ acao: 'moveToLibrary', desejo });
            listarDesejos();
            Util.toast('Livro movido para a biblioteca!', 'success');
          });
        });
      } else {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-heart fa-3x text-muted mb-3"></i><p class="text-muted">Nenhum desejo ainda.</p></div>';
      }
    } catch (e) {
      console.error(e);
    }
  }

  /* ========== LISTAR EMPRÉSTIMOS ========== */
  async function listarEmprestimos() {
    try {
      const resp = await API.enviar({ acao: 'listLoans' });
      const container = document.getElementById('lista-emprestimos');
      if (!container) return;
      container.innerHTML = '';

      if (Array.isArray(resp) && resp.length > 0) {
        resp.forEach(emp => {
          const statusClass = emp.Status === 'Atrasado' ? 'emprestimo-atrasado' : (emp.Status === 'Emprestado' ? 'emprestimo-ativo' : 'emprestimo-devolvido');
          const livro = livrosCache.find(l => l.ID === emp.LivroID);
          const tituloLivro = livro ? livro.Título : `Livro ID: ${emp.LivroID}`;
          const div = document.createElement('div');
          div.className = `emprestimo-card ${statusClass}`;
          div.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
              <div>
                <strong>${Util.escapeHTML(tituloLivro)}</strong> → ${Util.escapeHTML(emp.ParaQuem)}
                <br><small>Empréstimo: ${Util.escapeHTML(emp.DataEmpréstimo)}</small>
                ${emp.PrevisãoDevolução ? `<br><small>Previsão: ${Util.escapeHTML(emp.PrevisãoDevolução)}</small>` : ''}
                <span class="badge bg-${emp.Status === 'Atrasado' ? 'danger' : emp.Status === 'Emprestado' ? 'warning' : 'success'} ms-2">${Util.escapeHTML(emp.Status)}</span>
              </div>
              ${emp.Status !== 'Devolvido' ? `<button class="btn btn-sm btn-success btn-devolver" data-id="${emp.ID}">Devolver</button>` : ''}
            </div>`;
          container.appendChild(div);
        });

        container.querySelectorAll('.btn-devolver').forEach(btn => {
          btn.addEventListener('click', async () => {
            await API.enviar({ acao: 'returnLoan', id: btn.dataset.id });
            listarEmprestimos();
            Util.toast('Livro devolvido!', 'success');
          });
        });
      } else {
        container.innerHTML = '<div class="empty-state"><i class="fas fa-hand-holding-heart fa-3x text-muted mb-3"></i><p class="text-muted">Nenhum empréstimo registrado.</p></div>';
      }
    } catch (e) {
      console.error(e);
    }
  }

  return { init };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => DesejosEmprestimos.init());
} else {
  DesejosEmprestimos.init();
}
