/**
 * Círculo de leitura + convites.
 *  - Quadro: mostra, no Início, cada pessoa do grupo e só o que ela liberou compartilhar.
 *  - Convites (apenas administrador): gerar, copiar e cancelar códigos de cadastro.
 * Quem protege os dados é o banco (funções quadro_circulo, criar_convite etc.); aqui é só a tela.
 */
const Circulo = (() => {
  const sb = SupabaseApp.client;
  let admin = false;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- quadro ----------
  async function carregarQuadro() {
    const card = document.getElementById('circulo-card');
    const lista = document.getElementById('circulo-lista');
    if (!card || !lista) return;
    try {
      const { data, error } = await sb.rpc('quadro_circulo');
      if (error) throw error;
      const pessoas = Array.isArray(data) ? data : [];
      // Só mostra o quadro se existir pelo menos uma OUTRA pessoa compartilhando algo.
      if (!pessoas.some((p) => !p.voce)) { card.hidden = true; return; }

      const itens = await Promise.all(pessoas.map(async (p) => {
        const img = await Perfil.iconeDataURL(p, 64);
        let linhas = '';
        if (p.lendo) {
          const pct = p.lendo.numero_paginas ? Math.min(100, Math.round((p.lendo.paginas_lidas || 0) / p.lendo.numero_paginas * 100)) : null;
          linhas += `<div class="circulo-livro"><i class="fas fa-book-open me-1"></i>${esc(p.lendo.titulo)}${pct != null ? ` <span class="text-muted">· ${pct}%</span>` : ''}</div>`;
        }
        if (p.paginas_mes != null || p.livros_ano != null) {
          const partes = [];
          if (p.paginas_mes != null) partes.push(`${p.paginas_mes} págs. no mês`);
          if (p.livros_ano != null) partes.push(`${p.livros_ano} livro(s) no ano`);
          linhas += `<div class="small text-muted">${partes.join(' · ')}</div>`;
        }
        if (!linhas) linhas = '<div class="small text-muted">Nada compartilhado ainda.</div>';
        return `<div class="circulo-item">
          <img src="${img}" alt="" width="40" height="40" class="rounded">
          <div class="circulo-info"><div class="fw-bold">${esc(p.nome_app)}${p.voce ? ' <span class="badge bg-secondary">você</span>' : ''}</div>${linhas}</div>
        </div>`;
      }));
      lista.innerHTML = itens.join('');
      card.hidden = false;
    } catch (e) {
      console.warn('Círculo indisponível:', e);
      card.hidden = true;
    }
  }

  // ---------- convites (administrador) ----------
  function linkDoConvite(codigo) {
    return location.origin + location.pathname.replace(/[^/]*$/, '') + '?convite=' + encodeURIComponent(codigo);
  }

  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); Util.toast('Copiado!', 'success'); }
    catch (e) { window.prompt('Copie o texto abaixo:', texto); }
  }

  function situacao(c) {
    if (c.cancelado) return '<span class="badge bg-secondary">cancelado</span>';
    if (c.usado_em) return `<span class="badge bg-success">usado${c.usado_por_nome ? ' por ' + esc(c.usado_por_nome) : ''}</span>`;
    if (new Date(c.expira_em) < new Date()) return '<span class="badge bg-warning text-dark">expirado</span>';
    return '<span class="badge bg-primary">disponível</span>';
  }

  async function carregarConvites() {
    const lista = document.getElementById('lista-convites');
    if (!lista) return;
    const { data, error } = await sb.rpc('listar_convites');
    if (error) { lista.textContent = 'Não foi possível carregar os convites.'; return; }
    if (!data || !data.length) { lista.innerHTML = '<span class="text-muted">Nenhum convite ainda.</span>'; return; }
    lista.innerHTML = data.map((c) => {
      const ativo = !c.cancelado && !c.usado_em && new Date(c.expira_em) >= new Date();
      return `<div class="d-flex align-items-center gap-2 flex-wrap py-1 border-bottom">
        <code class="fs-6">${esc(c.codigo)}</code> ${situacao(c)}
        <span class="ms-auto d-flex gap-1">
          ${ativo ? `<button type="button" class="btn btn-outline-secondary btn-sm" data-copiar-codigo="${esc(c.codigo)}">Copiar código</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" data-copiar-link="${esc(c.codigo)}">Copiar link</button>
          <button type="button" class="btn btn-outline-danger btn-sm" data-cancelar-convite="${esc(c.id)}">Cancelar</button>` : ''}
        </span></div>`;
    }).join('');
  }

  async function initConvites() {
    const card = document.getElementById('card-convites');
    if (!card) return;
    try {
      const { data } = await sb.rpc('eh_admin');
      admin = data === true;
    } catch (e) { admin = false; }
    card.hidden = !admin;
    if (!admin) return;

    if (!card.dataset.pronto) {
      card.dataset.pronto = '1';
      document.getElementById('btn-novo-convite').addEventListener('click', async () => {
        const { data, error } = await sb.rpc('criar_convite', { p_dias: 7 });
        if (error) { Util.toast('Não foi possível criar o convite.', 'danger'); return; }
        await carregarConvites();
        copiar(data);
      });
      document.getElementById('lista-convites').addEventListener('click', async (ev) => {
        const b = ev.target.closest('button');
        if (!b) return;
        if (b.dataset.copiarCodigo) copiar(b.dataset.copiarCodigo);
        else if (b.dataset.copiarLink) copiar(linkDoConvite(b.dataset.copiarLink));
        else if (b.dataset.cancelarConvite) {
          if (!(await Util.confirmar('Cancelar este convite?'))) return;
          const { error } = await sb.rpc('cancelar_convite', { p_id: b.dataset.cancelarConvite });
          if (error) Util.toast('Não foi possível cancelar.', 'danger');
          carregarConvites();
        }
      });
    }
    carregarConvites();
  }

  function init() {
    carregarQuadro();
    initConvites();
  }

  return { init, carregarQuadro, initConvites };
})();
