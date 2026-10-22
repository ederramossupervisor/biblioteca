/**
 * Busca global — cruza Livros, Anotações, Citações e Desejos numa única
 * caixa de busca, num modal acessível pela barra de navegação (mobile e
 * desktop).
 */
const BuscaGlobal = (() => {
  let modal = null;
  let livros = [];
  let anotacoes = [];
  let citacoes = [];
  let desejos = [];
  let carregado = false;

  function init() {
    const botoes = document.querySelectorAll('.btn-busca-global');
    const modalEl = document.getElementById('modal-busca-global');
    if (!botoes.length || !modalEl) return;

    modal = new bootstrap.Modal(modalEl);
    botoes.forEach(btn => btn.addEventListener('click', abrir));

    const input = document.getElementById('busca-global-input');
    let debounceTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => executarBusca(input.value.trim()), 150);
    });

    modalEl.addEventListener('shown.bs.modal', () => input.focus());
  }

  async function abrir() {
    modal.show();
    if (!carregado) {
      await carregarDados();
    }
  }

  async function carregarDados() {
    const resultados = document.getElementById('busca-global-resultados');
    resultados.innerHTML = '<div class="text-center text-muted py-3"><span class="spinner-border spinner-border-sm"></span> Carregando...</div>';
    try {
      const [respLivros, respAnotacoes, respCitacoes, respDesejos] = await Promise.all([
        API.enviar({ acao: 'listAllBooks' }),
        API.enviar({ acao: 'listNotes', livroID: '' }),
        API.enviar({ acao: 'listQuotes' }),
        API.enviar({ acao: 'listWishes' })
      ]);
      livros = Array.isArray(respLivros) ? respLivros : [];
      anotacoes = Array.isArray(respAnotacoes) ? respAnotacoes : [];
      citacoes = Array.isArray(respCitacoes) ? respCitacoes : [];
      desejos = Array.isArray(respDesejos) ? respDesejos : [];
      carregado = true;
      resultados.innerHTML = '<div class="text-center text-muted py-3">Digite para buscar em livros, anotações, citações e desejos.</div>';
    } catch (e) {
      resultados.innerHTML = '<div class="text-center text-danger py-3">Não foi possível carregar os dados para busca.</div>';
    }
  }

  function nomeLivro(livroID) {
    const livro = livros.find(l => l.ID === livroID);
    return livro ? (livro.Título || '') : '';
  }

  // Alguns campos (ex.: Capítulo, Página) podem vir como número da planilha,
  // não como texto — normaliza tudo antes de comparar, senão .toLowerCase()
  // quebra em valores que não são string.
  function texto(valor) {
    return String(valor === null || valor === undefined ? '' : valor).toLowerCase();
  }

  function executarBusca(termo) {
    const resultados = document.getElementById('busca-global-resultados');
    if (!termo) {
      resultados.innerHTML = '<div class="text-center text-muted py-3">Digite para buscar em livros, anotações, citações e desejos.</div>';
      return;
    }
    const t = termo.toLowerCase();

    const livrosEncontrados = livros.filter(l =>
      texto(l.Título).includes(t) ||
      texto(l.Autor).includes(t) ||
      texto(l.Tags).includes(t)
    );

    const anotacoesEncontradas = anotacoes.filter(a =>
      texto(a.Trecho).includes(t) ||
      texto(a.Capítulo).includes(t) ||
      texto(nomeLivro(a.LivroID)).includes(t)
    );

    const citacoesEncontradas = citacoes.filter(c =>
      texto(c.Trecho || c.Citação || c.Texto).includes(t) ||
      texto(nomeLivro(c.LivroID)).includes(t)
    );

    const desejosEncontrados = desejos.filter(d =>
      texto(d.Título).includes(t) ||
      texto(d.Autor).includes(t)
    );

    let html = '';
    html += renderizarGrupo('Livros', livrosEncontrados, item =>
      `<strong>${item.Título || 'Sem título'}</strong> <span class="text-muted small">${item.Autor || ''}</span>`
    );
    html += renderizarGrupo('Anotações', anotacoesEncontradas, item =>
      `<div>${(item.Trecho || '').slice(0, 140)}</div><span class="text-muted small">${nomeLivro(item.LivroID)}</span>`
    );
    html += renderizarGrupo('Citações', citacoesEncontradas, item =>
      `<blockquote class="mb-1">${(item.Trecho || item.Citação || item.Texto || '').slice(0, 140)}</blockquote><span class="text-muted small">${nomeLivro(item.LivroID)}</span>`
    );
    html += renderizarGrupo('Desejos', desejosEncontrados, item =>
      `<strong>${item.Título || 'Sem título'}</strong> <span class="text-muted small">${item.Autor || ''}</span>`
    );

    if (!livrosEncontrados.length && !anotacoesEncontradas.length && !citacoesEncontradas.length && !desejosEncontrados.length) {
      html = '<div class="text-center text-muted py-3">Nenhum resultado encontrado.</div>';
    }

    resultados.innerHTML = html;
  }

  function renderizarGrupo(titulo, itens, renderItem) {
    if (!itens.length) return '';
    let html = `<div class="busca-global-grupo mb-3"><h6 class="text-uppercase small text-muted mb-2">${titulo} (${itens.length})</h6><ul class="list-unstyled mb-0">`;
    itens.slice(0, 20).forEach(item => {
      html += `<li class="py-2 border-bottom">${renderItem(item)}</li>`;
    });
    html += '</ul></div>';
    return html;
  }

  return { init };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', BuscaGlobal.init);
} else {
  BuscaGlobal.init();
}