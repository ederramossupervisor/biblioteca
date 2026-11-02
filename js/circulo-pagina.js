/**
 * Página "Círculo de leitura": atividade (quadro, placar, feed), metas (meta coletiva e
 * desafio do mês), ler junto (leitura conjunta e clube do livro) e trocas (recados, desejos,
 * biblioteca, citações e notas). Todas as regras de quem pode ver o quê ficam no banco (funções
 * rpc); aqui é só a tela.
 */
const CirculoPagina = (() => {
  const sb = SupabaseApp.client;
  const REACOES = ['👏', '❤️', '📚', '🔥', '😮'];
  let aba = 'atividade';
  let pronto = false;
  let admin = false;
  let meusLivros = [];
  let membros = [];
  const icones = {}; // user_id -> data URL do ícone

  // ---------- utilitários ----------
  const el = (id) => document.getElementById(id);
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  async function rpc(nome, args) {
    const { data, error } = await sb.rpc(nome, args);
    if (error) throw new Error(error.message);
    return data;
  }
  function falha(e) {
    console.warn(e);
    Util.toast(esc((e && e.message) || 'Não foi possível concluir.'), 'danger');
  }
  async function acao(fn, depois) {
    try { await fn(); if (depois) await depois(); } catch (e) { falha(e); }
  }
  function quando(iso) {
    const d = new Date(iso);
    const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (dias < 1) return 'hoje';
    if (dias === 1) return 'ontem';
    if (dias < 30) return `há ${dias} dias`;
    return d.toLocaleDateString('pt-BR');
  }
  function barra(pct) {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    return `<div class="progress cp-barra"><div class="progress-bar" style="width:${v}%"></div></div>`;
  }
  function vazio(txt) { return `<div class="text-muted small py-2">${txt}</div>`; }
  function secao(titulo, corpo, extra) {
    return `<div class="card shadow-sm mb-3"><div class="card-body">
      <div class="d-flex justify-content-between align-items-center mb-2"><h6 class="mb-0 fw-bold">${titulo}</h6>${extra || ''}</div>${corpo}</div></div>`;
  }

  async function iconeDe(p) {
    if (!p || !p.user_id) return '';
    if (!icones[p.user_id] && p.icone) icones[p.user_id] = await Perfil.iconeDataURL(p, 48);
    return icones[p.user_id] || '';
  }
  function avatar(uid, tam) {
    const src = icones[uid];
    return src ? `<img src="${src}" width="${tam}" height="${tam}" class="rounded" alt="">` : '';
  }

  async function carregarBasico() {
    try { admin = (await rpc('eh_admin')) === true; } catch (e) { admin = false; }
    try {
      const { data } = await sb.from('livros').select('id,titulo,autor,status').order('titulo');
      meusLivros = data || [];
    } catch (e) { meusLivros = []; }
    try { membros = (await rpc('membros_circulo')) || []; } catch (e) { membros = []; }
  }

  // ---------- aba: ATIVIDADE ----------
  async function renderAtividade() {
    const box = el('cp-atividade');
    box.innerHTML = vazio('Carregando…');
    const [quadro, placar, feed] = await Promise.all([rpc('quadro_circulo'), rpc('placar_mensal'), rpc('feed_circulo', { p_limite: 40 })]);
    await Promise.all((quadro || []).map(iconeDe));

    const pessoas = (quadro || []).map((p) => {
      const chips = [];
      if (p.sequencia != null) chips.push(`🔥 ${p.sequencia} dia(s) seguidos`);
      if (p.paginas_mes != null) chips.push(`📖 ${p.paginas_mes} págs. no mês`);
      if (p.livros_ano != null) chips.push(`🏁 ${p.livros_ano} livro(s) no ano`);
      if (p.bingo != null) chips.push(`🎲 bingo ${p.bingo}/25`);
      let lendo = '';
      if (p.lendo) {
        const pct = p.lendo.numero_paginas ? Math.round((p.lendo.paginas_lidas || 0) / p.lendo.numero_paginas * 100) : null;
        lendo = `<div class="small"><i class="fas fa-book-open me-1"></i>${esc(p.lendo.titulo)}${pct != null ? ` <span class="text-muted">· ${pct}%</span>` : ''}</div>${pct != null ? barra(pct) : ''}`;
      }
      const nada = !lendo && !chips.length ? '<div class="small text-muted">Nada compartilhado ainda.</div>' : '';
      return `<div class="cp-pessoa">${avatar(p.user_id, 44)}<div class="cp-pessoa-info">
        <div class="fw-bold">${esc(p.nome_app)}${p.voce ? ' <span class="badge bg-secondary">você</span>' : ''}</div>
        ${lendo}${chips.length ? `<div class="small text-muted mt-1">${chips.join(' · ')}</div>` : ''}${nada}</div></div>`;
    }).join('');

    const medalhas = ['🥇', '🥈', '🥉'];
    const placarHtml = (placar && placar.length)
      ? placar.map((p, i) => `<div class="d-flex justify-content-between py-1 ${p.voce ? 'fw-bold' : ''}"><span>${medalhas[i] || (i + 1) + 'º'} ${esc(p.nome_app)}</span><span>${p.paginas} págs. · ${p.dias} dia(s)</span></div>`).join('')
      : vazio('Ninguém entrou no placar ainda. Quem quiser participa em Configurações → Meu perfil.');

    const feedHtml = (feed && feed.length) ? (feed || []).map(itemFeed).join('') : vazio('Ainda não há atividades compartilhadas.');

    box.innerHTML = secao('Quem está por aqui', pessoas || vazio('Ninguém compartilhou nada ainda.'))
      + secao('Placar do mês', placarHtml)
      + secao('Atividades do círculo', feedHtml);
  }

  function itemFeed(e) {
    const verbo = { iniciou: 'começou a ler', terminou: 'terminou', conquista: 'conquistou' }[e.tipo] || '';
    const icone = { iniciou: '📖', terminou: '🏁', conquista: '🏆' }[e.tipo] || '';
    const reacoes = REACOES.map((em) => {
      const r = (e.reacoes || {})[em];
      return `<button type="button" class="cp-reacao ${r && r.eu ? 'ativa' : ''}" data-reagir="${e.id}" data-emoji="${em}">${em}${r ? ` <small>${r.n}</small>` : ''}</button>`;
    }).join('');
    const comentarios = (e.comentarios || []).map((c) =>
      `<div class="cp-comentario"><b>${esc(c.nome_app)}:</b> ${esc(c.texto)}${c.meu ? ` <button type="button" class="cp-x" data-apagar-comentario="${c.id}" aria-label="Apagar">×</button>` : ''}</div>`).join('');
    return `<div class="cp-evento">
      <div>${icone} <b>${e.voce ? 'Você' : esc(e.nome_app)}</b> ${verbo} <b>${esc(e.titulo)}</b>${e.autor && e.tipo !== 'conquista' ? ` <span class="text-muted">de ${esc(e.autor)}</span>` : ''}
        <span class="text-muted small"> · ${quando(e.criado_em)}</span></div>
      <div class="cp-reacoes">${reacoes}</div>
      ${comentarios}
      <form class="cp-form-linha" data-comentar="${e.id}"><input type="text" class="form-control form-control-sm" maxlength="200" placeholder="Comentar…" required>
        <button class="btn btn-outline-secondary btn-sm" type="submit">Enviar</button></form>
    </div>`;
  }

  // ---------- aba: METAS ----------
  async function renderMetas() {
    const box = el('cp-metas');
    box.innerHTML = vazio('Carregando…');
    const [meta, desafio] = await Promise.all([rpc('meta_grupo'), rpc('desafio_atual')]);
    const ano = new Date().getFullYear();

    let metaHtml;
    if (meta) {
      const pct = Math.min(100, Math.round(meta.total / meta.alvo * 100));
      const unidade = meta.tipo === 'livros' ? 'livros' : 'páginas';
      metaHtml = `<div class="fw-bold">${esc(meta.titulo)} <span class="text-muted small">(${meta.ano})</span></div>
        <div class="my-1">${meta.total} de ${meta.alvo} ${unidade} (${pct}%)</div>${barra(pct)}
        <div class="small text-muted mt-2">${(meta.pessoas || []).map((p) => `${esc(p.nome_app)}: ${p.valor}`).join(' · ') || 'Ninguém contribuindo ainda'}</div>
        <div class="small text-muted">Conta quem liberou o resumo em Configurações → Meu perfil.</div>
        ${admin ? '<button type="button" class="btn btn-outline-danger btn-sm mt-2" data-acao="encerrar-meta">Encerrar meta</button>' : ''}`;
    } else {
      metaHtml = vazio('Nenhuma meta coletiva no momento.');
    }
    if (admin) {
      metaHtml += `<form id="cp-form-meta" class="cp-form mt-3"><div class="small fw-bold mb-1">Definir nova meta (administrador)</div>
        <input class="form-control form-control-sm mb-1" name="titulo" maxlength="80" placeholder="Ex.: 50 livros em ${ano}" required>
        <div class="d-flex gap-1 mb-1"><select class="form-select form-select-sm" name="tipo"><option value="livros">Livros</option><option value="paginas">Páginas</option></select>
        <input class="form-control form-control-sm" name="alvo" type="number" min="1" placeholder="Alvo" required>
        <input class="form-control form-control-sm" name="ano" type="number" value="${ano}" required></div>
        <button class="btn btn-primary btn-sm" type="submit">Salvar meta</button></form>`;
    }

    let desHtml;
    if (desafio) {
      desHtml = `<div class="fw-bold">${esc(desafio.titulo)}</div>${desafio.descricao ? `<div class="small">${esc(desafio.descricao)}</div>` : ''}
        <div class="small text-muted my-2">${(desafio.cumpriram || []).length ? 'Já cumpriram: ' + desafio.cumpriram.map(esc).join(', ') : 'Ninguém cumpriu ainda.'}</div>
        <button type="button" class="btn btn-sm ${desafio.eu ? 'btn-success' : 'btn-outline-success'}" data-acao="alternar-desafio">${desafio.eu ? '✔ Cumpri (toque para desmarcar)' : 'Marcar como cumprido'}</button>`;
    } else {
      desHtml = vazio('Nenhum desafio neste mês.');
    }
    if (admin) {
      desHtml += `<form id="cp-form-desafio" class="cp-form mt-3"><div class="small fw-bold mb-1">Definir o desafio deste mês (administrador)</div>
        <input class="form-control form-control-sm mb-1" name="titulo" maxlength="80" placeholder="Ex.: Ler um clássico" required>
        <input class="form-control form-control-sm mb-1" name="descricao" maxlength="300" placeholder="Descrição (opcional)">
        <button class="btn btn-primary btn-sm" type="submit">Salvar desafio</button></form>`;
    }
    box.innerHTML = secao('🎯 Meta coletiva', metaHtml) + secao('🗓️ Desafio do mês', desHtml);
  }

  // ---------- aba: LER JUNTO ----------
  function opcoesLivros(selecionado) {
    return '<option value="">— nenhum livro meu —</option>' + meusLivros.map((l) =>
      `<option value="${esc(l.id)}" ${l.id === selecionado ? 'selected' : ''}>${esc(l.titulo)}${l.autor ? ' — ' + esc(l.autor) : ''}</option>`).join('');
  }

  async function renderJuntos() {
    const box = el('cp-juntos');
    box.innerHTML = vazio('Carregando…');
    const [leituras, clube] = await Promise.all([rpc('listar_leituras_conjuntas'), rpc('clube_atual')]);

    const cards = await Promise.all((leituras || []).map(async (l) => {
      const part = (l.participantes || []).map((p) =>
        `<div class="small mb-1">${esc(p.nome_app)}${p.voce ? ' (você)' : ''}: ${p.pct != null ? p.pct + '%' : 'pág. ' + p.pagina}${p.pct != null ? barra(p.pct) : ''}</div>`).join('');
      let corpo = '';
      if (l.participo) {
        const c = await rpc('comentarios_leitura', { p_id: l.id });
        const lista = (c.comentarios || []).map((x) =>
          `<div class="cp-comentario"><b>${esc(x.nome_app)}</b> <span class="text-muted">(pág. ${x.pagina})</span>: ${esc(x.texto)}${x.meu ? ` <button type="button" class="cp-x" data-apagar-com-leitura="${x.id}" aria-label="Apagar">×</button>` : ''}</div>`).join('');
        corpo = `${lista || vazio('Sem comentários ainda.')}
          ${c.ocultos ? `<div class="small text-muted">🔒 ${c.ocultos} comentário(s) de trechos que você ainda não leu — aparecem quando você chegar lá.</div>` : ''}
          <form class="cp-form-linha mt-2" data-comentar-leitura="${l.id}">
            <input type="number" min="0" class="form-control form-control-sm cp-pag" placeholder="pág." value="${c.minha_pagina || ''}" required>
            <input type="text" class="form-control form-control-sm" maxlength="400" placeholder="Comente até onde você leu…" required>
            <button class="btn btn-outline-secondary btn-sm" type="submit">Enviar</button></form>
          <div class="mt-2 d-flex gap-2">
            <button type="button" class="btn btn-outline-danger btn-sm" data-sair-leitura="${l.id}">Sair</button>
            ${l.criada_por_mim || admin ? `<button type="button" class="btn btn-outline-secondary btn-sm" data-encerrar-leitura="${l.id}">Encerrar leitura</button>` : ''}</div>`;
      } else {
        corpo = `<form class="cp-form-linha" data-entrar-leitura="${l.id}"><select class="form-select form-select-sm">${opcoesLivros('')}</select>
          <button class="btn btn-primary btn-sm" type="submit">Participar</button></form>`;
      }
      return `<div class="cp-evento"><div class="fw-bold">${esc(l.titulo)}${l.autor ? ` <span class="text-muted fw-normal">de ${esc(l.autor)}</span>` : ''}</div>${part}${corpo}</div>`;
    }));

    const nova = `<form id="cp-form-leitura" class="cp-form mt-2"><div class="small fw-bold mb-1">Propor uma leitura em conjunto</div>
      <input class="form-control form-control-sm mb-1" name="titulo" maxlength="120" placeholder="Título do livro" required>
      <input class="form-control form-control-sm mb-1" name="autor" maxlength="120" placeholder="Autor">
      <select class="form-select form-select-sm mb-1" name="livro">${opcoesLivros('')}</select>
      <div class="form-text mb-1">Escolha o seu exemplar na lista para o seu progresso aparecer aos outros.</div>
      <button class="btn btn-primary btn-sm" type="submit">Criar</button></form>`;

    let clubeHtml;
    if (clube) {
      const encerrada = clube.status === 'encerrada';
      const opcoes = (clube.opcoes || []).map((o) =>
        `<div class="cp-opcao ${encerrada && clube.vencedora === o.id ? 'vencedora' : ''}">
          <div><b>${esc(o.titulo)}</b>${o.autor ? ` <span class="text-muted">de ${esc(o.autor)}</span>` : ''}<div class="small text-muted">sugerido por ${esc(o.sugerida_por || '—')} · ${o.votos} voto(s)</div></div>
          ${encerrada ? (clube.vencedora === o.id ? '<span class="badge bg-success">escolhido</span>' : '')
            : `<button type="button" class="btn btn-sm ${clube.meu_voto === o.id ? 'btn-primary' : 'btn-outline-primary'}" data-votar="${clube.id}:${o.id}">${clube.meu_voto === o.id ? 'Seu voto' : 'Votar'}</button>`}</div>`).join('');
      clubeHtml = `<div class="fw-bold">${esc(clube.titulo)}${clube.data_conversa ? ` <span class="text-muted small">· conversa em ${new Date(clube.data_conversa + 'T12:00:00').toLocaleDateString('pt-BR')}</span>` : ''}</div>
        <div class="small text-muted mb-2">${encerrada ? 'Votação encerrada.' : 'Votação aberta — cada pessoa pode sugerir até 2 livros.'}</div>
        ${opcoes || vazio('Nenhuma sugestão ainda.')}
        ${encerrada ? '' : `<form class="cp-form-linha mt-2" data-sugerir="${clube.id}"><input class="form-control form-control-sm" name="t" maxlength="120" placeholder="Título" required>
          <input class="form-control form-control-sm" name="a" maxlength="120" placeholder="Autor"><button class="btn btn-outline-secondary btn-sm" type="submit">Sugerir</button></form>`}
        ${admin && !encerrada ? `<button type="button" class="btn btn-outline-danger btn-sm mt-2" data-encerrar-rodada="${clube.id}">Encerrar votação</button>` : ''}`;
    } else {
      clubeHtml = vazio('Nenhuma rodada do clube ainda.');
    }
    if (admin) {
      clubeHtml += `<form id="cp-form-rodada" class="cp-form mt-3"><div class="small fw-bold mb-1">Nova rodada (administrador)</div>
        <input class="form-control form-control-sm mb-1" name="titulo" maxlength="80" placeholder="Ex.: Livro de novembro" required>
        <input class="form-control form-control-sm mb-1" name="data" type="date"><button class="btn btn-primary btn-sm" type="submit">Abrir votação</button></form>`;
    }

    box.innerHTML = secao('📚 Leituras em conjunto', cards.join('') + nova) + secao('🗳️ Clube do livro', clubeHtml);
  }

  // ---------- aba: TROCAS ----------
  async function renderTrocas() {
    const box = el('cp-trocas');
    box.innerHTML = vazio('Carregando…');
    const [recados, desejos, citacoes, notas] = await Promise.all([rpc('meus_recados'), rpc('desejos_circulo'), rpc('citacoes_circulo'), rpc('avaliacoes_circulo')]);

    const rotulo = { novo: 'novo', lido: 'lido', aceito: 'aceito', recusado: 'recusado' };
    const recebidos = (recados.recebidos || []).map((r) => `<div class="cp-evento">
      <div>${r.tipo === 'recomendacao' ? '💌 <b>' + esc(r.de) + '</b> recomenda' : '📦 <b>' + esc(r.de) + '</b> pede emprestado'}: <b>${esc(r.titulo)}</b>${r.autor ? ` de ${esc(r.autor)}` : ''}
        <span class="badge bg-light text-dark border">${rotulo[r.status]}</span></div>
      ${r.texto ? `<div class="small">“${esc(r.texto)}”</div>` : ''}
      <div class="d-flex gap-1 mt-1 flex-wrap">
        ${r.tipo === 'pedido_emprestimo'
          ? `<button class="btn btn-outline-success btn-sm" data-recado="${r.id}:aceito">Aceitar</button><button class="btn btn-outline-secondary btn-sm" data-recado="${r.id}:recusado">Recusar</button>`
          : `<button class="btn btn-outline-secondary btn-sm" data-recado="${r.id}:lido">Marcar como lido</button>`}
        <button class="btn btn-outline-danger btn-sm" data-apagar-recado="${r.id}">Apagar</button></div></div>`).join('');
    const enviados = (recados.enviados || []).map((r) => `<div class="small py-1">${r.tipo === 'recomendacao' ? '💌' : '📦'} para <b>${esc(r.para)}</b>: ${esc(r.titulo)} <span class="text-muted">· ${rotulo[r.status]}</span>
      <button type="button" class="cp-x" data-apagar-recado="${r.id}" aria-label="Apagar">×</button></div>`).join('');

    const para = membros.map((m) => `<option value="${esc(m.user_id)}">${esc(m.nome_app)}</option>`).join('');
    const form = membros.length ? `<form id="cp-form-recado" class="cp-form mt-3"><div class="small fw-bold mb-1">Enviar um recado</div>
      <div class="d-flex gap-1 mb-1"><select class="form-select form-select-sm" name="para">${para}</select>
      <select class="form-select form-select-sm" name="tipo"><option value="recomendacao">Recomendar livro</option><option value="pedido_emprestimo">Pedir emprestado</option></select></div>
      <input class="form-control form-control-sm mb-1" name="titulo" maxlength="120" placeholder="Título" required>
      <input class="form-control form-control-sm mb-1" name="autor" maxlength="120" placeholder="Autor">
      <input class="form-control form-control-sm mb-1" name="texto" maxlength="200" placeholder="Recado (opcional)">
      <button class="btn btn-primary btn-sm" type="submit">Enviar</button></form>` : vazio('Quando mais pessoas entrarem no círculo, você poderá enviar recados.');

    const desejosHtml = (desejos || []).length
      ? desejos.map((d) => `<div class="small py-1"><b>${esc(d.nome_app)}${d.voce ? ' (você)' : ''}</b>: ${esc(d.titulo)}${d.autor ? ` — ${esc(d.autor)}` : ''}</div>`).join('')
      : vazio('Ninguém mostrou a lista de desejos ainda.');
    const citHtml = (citacoes || []).length
      ? citacoes.map((c) => `<div class="cp-evento"><div class="fst-italic">“${esc(c.trecho)}”</div><div class="small text-muted">${esc(c.livro || '')}${c.pagina ? ', pág. ' + esc(c.pagina) : ''} · ${esc(c.nome_app)}${c.voce ? ' (você)' : ''}</div></div>`).join('')
      : vazio('Nenhuma citação compartilhada ainda.');
    const notasHtml = (notas || []).length
      ? notas.map((n) => `<div class="small py-1">${'⭐'.repeat(n.nota)} <b>${esc(n.titulo)}</b>${n.autor ? ` — ${esc(n.autor)}` : ''} <span class="text-muted">· ${esc(n.nome_app)}${n.voce ? ' (você)' : ''}</span></div>`).join('')
      : vazio('Nenhuma nota compartilhada ainda.');

    box.innerHTML = secao('💌 Recados e recomendações', (recebidos || vazio('Nenhum recado recebido.')) + (enviados ? `<div class="mt-2 small fw-bold">Enviados</div>${enviados}` : '') + form)
      + secao('🔎 Biblioteca do círculo', `<form id="cp-form-busca" class="cp-form-linha"><input class="form-control form-control-sm" name="q" minlength="2" maxlength="60" placeholder="Buscar um livro que alguém tem…" required>
          <button class="btn btn-outline-secondary btn-sm" type="submit">Buscar</button></form><div id="cp-resultado-busca" class="mt-2"></div>`)
      + secao('🎁 Desejos do círculo', desejosHtml)
      + secao('💬 Citações', citHtml)
      + secao('⭐ Notas dos livros terminados', notasHtml);
  }

  // ---------- navegação entre abas ----------
  async function mostrarAba(nome) {
    aba = nome;
    document.querySelectorAll('.circulo-aba-btn').forEach((b) => b.classList.toggle('active', b.dataset.aba === nome));
    document.querySelectorAll('.cp-aba').forEach((d) => { d.hidden = d.id !== 'cp-' + nome; });
    try {
      if (nome === 'atividade') await renderAtividade();
      else if (nome === 'metas') await renderMetas();
      else if (nome === 'juntos') await renderJuntos();
      else await renderTrocas();
    } catch (e) {
      el('cp-' + nome).innerHTML = `<div class="text-danger small">Não foi possível carregar. ${esc(e.message)}</div>`;
    }
  }
  const recarregar = () => mostrarAba(aba);

  // ---------- eventos (delegação) ----------
  function ligar() {
    const pagina = el('page-circulo');

    el('circulo-abas').addEventListener('click', (ev) => {
      const b = ev.target.closest('.circulo-aba-btn');
      if (b) mostrarAba(b.dataset.aba);
    });

    pagina.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      const d = b.dataset;
      if (d.reagir) acao(() => rpc('alternar_reacao', { p_evento: Number(d.reagir), p_emoji: d.emoji }), recarregar);
      else if (d.apagarComentario) acao(() => rpc('apagar_comentario', { p_id: Number(d.apagarComentario) }), recarregar);
      else if (d.acao === 'alternar-desafio') acao(() => rpc('alternar_desafio'), recarregar);
      else if (d.acao === 'encerrar-meta') acao(async () => { if (await Util.confirmar('Encerrar a meta coletiva?')) await rpc('encerrar_meta_grupo'); }, recarregar);
      else if (d.sairLeitura) acao(async () => { if (await Util.confirmar('Sair desta leitura?')) await rpc('sair_leitura_conjunta', { p_id: Number(d.sairLeitura) }); }, recarregar);
      else if (d.encerrarLeitura) acao(async () => { if (await Util.confirmar('Encerrar esta leitura para todos?')) await rpc('encerrar_leitura_conjunta', { p_id: Number(d.encerrarLeitura) }); }, recarregar);
      else if (d.apagarComLeitura) acao(() => rpc('apagar_comentario_leitura', { p_id: Number(d.apagarComLeitura) }), recarregar);
      else if (d.votar) { const [r, o] = d.votar.split(':').map(Number); acao(() => rpc('votar_clube', { p_rodada: r, p_opcao: o }), recarregar); }
      else if (d.encerrarRodada) acao(async () => { if (await Util.confirmar('Encerrar a votação e escolher o livro mais votado?')) await rpc('encerrar_rodada_clube', { p_rodada: Number(d.encerrarRodada) }); }, recarregar);
      else if (d.recado) { const [i, s] = d.recado.split(':'); acao(() => rpc('responder_recado', { p_id: Number(i), p_status: s }), recarregar); }
      else if (d.apagarRecado) acao(() => rpc('apagar_recado', { p_id: Number(d.apagarRecado) }), recarregar);
      else if (d.pedir) {
        const [uid, titulo] = [d.pedir, d.titulo];
        const f = el('cp-form-recado');
        if (f) { f.para.value = uid; f.tipo.value = 'pedido_emprestimo'; f.titulo.value = titulo; f.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }
    });

    pagina.addEventListener('submit', (ev) => {
      const f = ev.target;
      ev.preventDefault();
      const v = (n) => (f.elements[n] ? f.elements[n].value.trim() : '');
      if (f.dataset.comentar) {
        acao(() => rpc('comentar_evento', { p_evento: Number(f.dataset.comentar), p_texto: f.querySelector('input').value }), recarregar);
      } else if (f.id === 'cp-form-meta') {
        acao(() => rpc('definir_meta_grupo', { p_titulo: v('titulo'), p_tipo: v('tipo'), p_alvo: Number(v('alvo')), p_ano: Number(v('ano')) }), recarregar);
      } else if (f.id === 'cp-form-desafio') {
        acao(() => rpc('definir_desafio', { p_titulo: v('titulo'), p_descricao: v('descricao') }), recarregar);
      } else if (f.id === 'cp-form-leitura') {
        acao(() => rpc('criar_leitura_conjunta', { p_titulo: v('titulo'), p_autor: v('autor'), p_capa: null, p_livro: v('livro') || null }), recarregar);
      } else if (f.dataset.entrarLeitura) {
        acao(() => rpc('entrar_leitura_conjunta', { p_id: Number(f.dataset.entrarLeitura), p_livro: f.querySelector('select').value || null }), recarregar);
      } else if (f.dataset.comentarLeitura) {
        const [pag, txt] = f.querySelectorAll('input');
        acao(() => rpc('comentar_leitura', { p_id: Number(f.dataset.comentarLeitura), p_pagina: Number(pag.value), p_texto: txt.value }), recarregar);
      } else if (f.dataset.sugerir) {
        acao(() => rpc('sugerir_opcao_clube', { p_rodada: Number(f.dataset.sugerir), p_titulo: v('t'), p_autor: v('a') }), recarregar);
      } else if (f.id === 'cp-form-rodada') {
        acao(() => rpc('criar_rodada_clube', { p_titulo: v('titulo'), p_data: v('data') || null }), recarregar);
      } else if (f.id === 'cp-form-recado') {
        acao(async () => { await rpc('enviar_recado', { p_para: v('para'), p_tipo: v('tipo'), p_titulo: v('titulo'), p_autor: v('autor'), p_texto: v('texto') }); Util.toast('Recado enviado!', 'success'); }, recarregar);
      } else if (f.id === 'cp-form-busca') {
        acao(async () => {
          const r = await rpc('buscar_biblioteca', { p_q: v('q') });
          el('cp-resultado-busca').innerHTML = r.length
            ? r.map((x) => `<div class="d-flex justify-content-between align-items-center py-1 small"><span><b>${esc(x.titulo)}</b>${x.autor ? ` — ${esc(x.autor)}` : ''} <span class="text-muted">· ${esc(x.nome_app)}${x.voce ? ' (você)' : ''}</span></span>
                ${x.voce ? '' : `<button type="button" class="btn btn-outline-secondary btn-sm" data-pedir="${esc(x.user_id)}" data-titulo="${esc(x.titulo)}">Pedir emprestado</button>`}</div>`).join('')
            : vazio('Nenhum livro encontrado (só aparecem pessoas que liberaram a biblioteca).');
        });
      }
    });
  }

  // ---------- entrada ----------
  async function init() {
    if (!pronto) {
      pronto = true;
      ligar();
    }
    await carregarBasico();
    await mostrarAba(aba);
  }

  return { init };
})();
