const API = (() => {
  const SUPABASE_URL = SupabaseApp.URL;
  const SUPABASE_KEY = SupabaseApp.KEY;
  const sb = SupabaseApp.client;

  // Edge Function usada só pelas 2 ações que precisam rodar no servidor
  // (evitar CORS): proxyImage e buscarPalavra. Ver supabase/functions/leituras-utils.
  const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/leituras-utils`;

  // Id do usuário logado (a sessão fica no próprio aparelho, sem ir à rede).
  async function uidAtual() {
    const { data } = await sb.auth.getSession();
    return data && data.session && data.session.user ? data.session.user.id : null;
  }

  const ACOES_CACHEAVEIS = new Set([
    'getConfigs', 'listAllBooks', 'listBooks', 'listarLocais', 'listNotes',
    'listQuotes', 'listWishes', 'listLoans', 'dashboard', 'timelineAtividades', 'buscarPalavra',
    'bingoEstado'
  ]);
  const CACHE_TTL_MS = 45000;
  const cache = new Map();
  let pendentes = 0;

  function despacharStatus(status) {
    window.dispatchEvent(new CustomEvent('api:status', { detail: { status } }));
  }
  function chaveCache(dados) { return JSON.stringify(dados); }

  async function todos(tabela, colunas) {
    const { data, error } = await sb.from(tabela).select(colunas || '*');
    if (error) throw new Error(error.message);
    return data || [];
  }

  // ========== MAPEAMENTOS (linha do Supabase <-> objeto no formato antigo) ==========
  function mapLivroFull(r) {
    return {
      ID: r.id, Título: r.titulo || '', Subtítulo: r.subtitulo || '', Autor: r.autor || '',
      Editora: r.editora || '', Ano: r.ano || '', Edição: r.edicao || '', ISBN: r.isbn || '',
      Idioma: r.idioma || '', NacionalidadeAutor: r.nacionalidade_autor || '',
      NúmeroPáginas: r.numero_paginas || '', Formato: r.formato || '', Gênero: r.genero || '',
      Subgênero: r.subgenero || '', Status: r.status || '', DataInício: r.data_inicio || '',
      DataTérmino: r.data_termino || '', Nota: r.nota ?? '', Avaliação: r.avaliacao || '',
      Favorito: !!r.favorito, Clássico: !!r.classico, Preço: r.preco ?? '',
      LocalCompra: r.local_compra || '', Tags: r.tags || '', Observações: r.observacoes || '',
      ImagemCapa: r.imagem_capa || '', URLCapa: r.url_capa || '', DataCadastro: r.data_cadastro || '',
      ÚltimaAtualização: r.ultima_atualizacao || '', PáginasLidas: r.paginas_lidas || 0,
      PaginasAnosAnteriores: r.paginas_anos_anteriores || 0, PaginasExtra: r.paginas_extra || 0,
      PaginasExtraAno: r.paginas_extra_ano || ''
    };
  }
  function mapLivroResumo(r) {
    return {
      ID: r.id, Título: r.titulo || '', Autor: r.autor || '', NúmeroPáginas: r.numero_paginas || '',
      Status: r.status || '', PáginasLidasAcumuladas: r.paginas_lidas || 0,
      URLCapa: r.url_capa || r.imagem_capa || '', ImagemCapa: r.imagem_capa || r.url_capa || ''
    };
  }
  function mapLivroInput(book) {
    return {
      titulo: book.titulo || '', subtitulo: book.subtitulo || '', autor: book.autor || '',
      editora: book.editora || '', ano: book.ano || '', edicao: book.edicao || '', isbn: book.isbn || '',
      idioma: book.idioma || '', nacionalidade_autor: book.nacionalidadeAutor || '',
      numero_paginas: Number(book.numeroPaginas) || 0, formato: book.formato || 'Físico',
      genero: book.genero || '', subgenero: book.subgenero || '', status: book.status || 'Quero ler',
      data_inicio: book.dataInicio || null, data_termino: book.dataTermino || null,
      nota: (book.nota !== undefined && book.nota !== '') ? Number(book.nota) : null,
      avaliacao: book.avaliacao || '', favorito: !!book.favorito, classico: !!book.classico,
      preco: (book.preco !== undefined && book.preco !== '') ? Number(book.preco) : null,
      local_compra: book.localCompra || '', tags: book.tags || '', observacoes: book.observacoes || '',
      imagem_capa: book.imagemCapa || '', url_capa: book.urlCapa || '',
      paginas_anos_anteriores: Number(book.paginasAnosAnteriores) || 0,
      paginas_extra: Number(book.paginasExtra) || 0,
      paginas_extra_ano: book.paginasExtraAno || null
    };
  }
  function mapSessaoFull(r) {
    return {
      ID: r.id, LivroID: r.livro_id, Data: r.data, 'HoraInício': r.hora_inicio || '',
      HoraFim: r.hora_fim || '', Tempo: r.tempo || 0, 'PáginaInicial': r.pagina_inicial || 0,
      'PáginaFinal': r.pagina_final || 0, 'PáginasLidas': r.paginas_lidas || 0, Local: r.local || '',
      Humor: r.humor || '', Clima: r.clima || '', 'Distrações': r.distracoes || '',
      Observações: r.observacoes || ''
    };
  }
  function _paraMinutosDoDia(valor) {
    if (!valor) return 0;
    const partes = String(valor).split(':').map(Number);
    if (partes.length >= 2 && !isNaN(partes[0]) && !isNaN(partes[1])) return partes[0] * 60 + partes[1];
    return 0;
  }

  // Datas "YYYY-MM-DD" vindas do Supabase (colunas DATE, sem hora/fuso) são
  // interpretadas pelo JS como meia-noite EM UTC se usarmos `new Date(str)`
  // direto — o que desloca o dia em fusos negativos como o do Brasil
  // (vira o dia anterior à noite). parseDataLocal cria a data à meia-noite
  // no fuso LOCAL do navegador, e formatDataLocal faz o caminho inverso.
  function parseDataLocal(valor) {
    if (!valor) return null;
    const s = String(valor);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function formatDataLocal(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }

  // ========== LIVROS ==========
  async function adicionarLivro(book) {
    const row = mapLivroInput(book);
    row.paginas_lidas = (row.paginas_anos_anteriores || 0) + (row.paginas_extra || 0);
    const { data, error } = await sb.from('livros').insert(row).select('id').single();
    if (error) throw new Error(error.message);
    return { status: 'ok', id: data.id };
  }
  async function listarLivros() { return (await todos('livros')).map(mapLivroResumo); }
  async function listarLivrosCompleto() { return (await todos('livros')).map(mapLivroFull); }
  // PATCH de verdade: só entram no UPDATE os campos que vieram em
  // `novosDados`. Antes disso usava mapLivroInput (pensada pra INSERT, com
  // valor padrão pra tudo que não vier preenchido) — então uma chamada
  // parcial, como { nota: 5 } ao clicar nas estrelas, sobrescrevia a linha
  // inteira no Supabase e apagava Título, Status, Datas etc. de volta para
  // os valores padrão (ex.: Status virava "Quero ler" de novo).
  function mapLivroPartial(book) {
    const row = {};
    const tem = (chave) => Object.prototype.hasOwnProperty.call(book || {}, chave);

    if (tem('titulo')) row.titulo = book.titulo || '';
    if (tem('subtitulo')) row.subtitulo = book.subtitulo || '';
    if (tem('autor')) row.autor = book.autor || '';
    if (tem('editora')) row.editora = book.editora || '';
    if (tem('ano')) row.ano = book.ano || '';
    if (tem('edicao')) row.edicao = book.edicao || '';
    if (tem('isbn')) row.isbn = book.isbn || '';
    if (tem('idioma')) row.idioma = book.idioma || '';
    if (tem('nacionalidadeAutor')) row.nacionalidade_autor = book.nacionalidadeAutor || '';
    if (tem('numeroPaginas')) row.numero_paginas = Number(book.numeroPaginas) || 0;
    if (tem('formato')) row.formato = book.formato || 'Físico';
    if (tem('genero')) row.genero = book.genero || '';
    if (tem('subgenero')) row.subgenero = book.subgenero || '';
    if (tem('status')) row.status = book.status || 'Quero ler';
    if (tem('dataInicio')) row.data_inicio = book.dataInicio || null;
    if (tem('dataTermino')) row.data_termino = book.dataTermino || null;
    if (tem('nota')) row.nota = (book.nota !== undefined && book.nota !== '') ? Number(book.nota) : null;
    if (tem('avaliacao')) row.avaliacao = book.avaliacao || '';
    if (tem('favorito')) row.favorito = !!book.favorito;
    if (tem('classico')) row.classico = !!book.classico;
    if (tem('preco')) row.preco = (book.preco !== undefined && book.preco !== '') ? Number(book.preco) : null;
    if (tem('localCompra')) row.local_compra = book.localCompra || '';
    if (tem('tags')) row.tags = book.tags || '';
    if (tem('observacoes')) row.observacoes = book.observacoes || '';
    if (tem('imagemCapa')) row.imagem_capa = book.imagemCapa || '';
    if (tem('urlCapa')) row.url_capa = book.urlCapa || '';
    if (tem('paginasAnosAnteriores')) row.paginas_anos_anteriores = Number(book.paginasAnosAnteriores) || 0;
    if (tem('paginasExtra')) row.paginas_extra = Number(book.paginasExtra) || 0;
    if (tem('paginasExtraAno')) row.paginas_extra_ano = book.paginasExtraAno || null;

    return row;
  }
  async function atualizarLivro(id, novosDados) {
    const row = mapLivroPartial(novosDados);
    row.ultima_atualizacao = new Date().toISOString();

    // Livros antigos (cadastrados antes das sessões) guardam as páginas lidas só em
    // `paginas_lidas`, com "anos anteriores" e "extra" zerados. Se esta edição NÃO está
    // mexendo nesses dois campos, o recálculo não pode zerar essas páginas.
    let preservarPaginasLegadas = true;
    if ('paginas_anos_anteriores' in row || 'paginas_extra' in row) {
      const { data: atual } = await sb.from('livros')
        .select('paginas_anos_anteriores,paginas_extra').eq('id', id).single();
      if (atual) {
        const mudouAnos = 'paginas_anos_anteriores' in row
          && (Number(row.paginas_anos_anteriores) || 0) !== (Number(atual.paginas_anos_anteriores) || 0);
        const mudouExtra = 'paginas_extra' in row
          && (Number(row.paginas_extra) || 0) !== (Number(atual.paginas_extra) || 0);
        preservarPaginasLegadas = !(mudouAnos || mudouExtra);
      }
    }

    const { error } = await sb.from('livros').update(row).eq('id', id);
    if (error) throw new Error(error.message);
    await _recalcularProgressoLivro(id, { preservarPaginasLegadas });
    return { status: 'ok' };
  }
  async function excluirLivro(id) {
    const { error } = await sb.from('livros').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { status: 'ok' };
  }

  // ========== SESSÕES ==========
  async function _paginaJaContabilizada(livroID, pagina, idSessaoAtual) {
    if (!pagina || pagina <= 0) return false;
    const { data, error } = await sb.from('sessoes').select('id').eq('livro_id', livroID).eq('pagina_final', pagina);
    if (error) throw new Error(error.message);
    return (data || []).some((r) => r.id !== idSessaoAtual);
  }
  function _calcularTempoMinutos(sessao, horaInicio, horaFim) {
    let tempoMinutos = Number(sessao.tempoMinutos) || 0;
    if (tempoMinutos <= 0 && horaInicio && horaFim) {
      const hi = horaInicio.split(':').map(Number);
      const hf = horaFim.split(':').map(Number);
      if (hi.length >= 2 && hf.length >= 2 && !isNaN(hi[0]) && !isNaN(hi[1]) && !isNaN(hf[0]) && !isNaN(hf[1])) {
        tempoMinutos = (hf[0] * 60 + hf[1]) - (hi[0] * 60 + hi[1]);
        if (tempoMinutos < 0) tempoMinutos += 24 * 60;
      }
    }
    return tempoMinutos;
  }
  async function adicionarSessao(sessao) {
    if (!sessao.livroID) throw new Error('Livro não selecionado');
    if (!sessao.data) throw new Error('Data obrigatória');
    if (sessao.paginaInicial === undefined || sessao.paginaInicial === '') throw new Error('Página inicial obrigatória');
    if (sessao.paginaFinal === undefined || sessao.paginaFinal === '') throw new Error('Página final obrigatória');

    const pagInicial = Number(sessao.paginaInicial);
    const pagFinal = Number(sessao.paginaFinal);
    const retomaPaginaJaLida = await _paginaJaContabilizada(sessao.livroID, pagInicial);
    let paginasLidas = pagFinal - pagInicial;
    if (pagInicial > 0 && !retomaPaginaJaLida) paginasLidas += 1;
    paginasLidas = Math.max(0, paginasLidas);

    const horaInicio = sessao.horaInicio || '';
    const horaFim = sessao.horaFim || '';
    const tempoMinutos = _calcularTempoMinutos(sessao, horaInicio, horaFim);

    const row = {
      livro_id: sessao.livroID, data: sessao.data, hora_inicio: horaInicio, hora_fim: horaFim,
      tempo: tempoMinutos, pagina_inicial: pagInicial, pagina_final: pagFinal, paginas_lidas: paginasLidas,
      local: sessao.local || '', humor: sessao.humor || '', clima: sessao.clima || '',
      distracoes: sessao.distracoes || '', observacoes: sessao.observacoes || ''
    };
    const { data, error } = await sb.from('sessoes').insert(row).select('id').single();
    if (error) throw new Error(error.message);
    await _recalcularProgressoLivro(sessao.livroID);
    return { status: 'ok', id: data.id, paginasLidas, tempoMinutos };
  }
  async function atualizarSessao(id, novosDados) {
    const { data: existente, error: e1 } = await sb.from('sessoes').select('*').eq('id', id).single();
    if (e1 || !existente) throw new Error('Sessão não encontrada');

    const pagInicial = (novosDados.paginaInicial !== undefined && novosDados.paginaInicial !== '') ? Number(novosDados.paginaInicial) : (existente.pagina_inicial || 0);
    const pagFinal = (novosDados.paginaFinal !== undefined && novosDados.paginaFinal !== '') ? Number(novosDados.paginaFinal) : (existente.pagina_final || 0);
    let paginasLidas = pagFinal - pagInicial;
    const retomaPaginaJaLida = await _paginaJaContabilizada(existente.livro_id, pagInicial, id);
    if (pagInicial > 0 && !retomaPaginaJaLida) paginasLidas += 1;
    paginasLidas = Math.max(0, paginasLidas);

    const horaInicio = novosDados.horaInicio || existente.hora_inicio || '';
    const horaFim = novosDados.horaFim || existente.hora_fim || '';
    const tempoMinutos = _calcularTempoMinutos(novosDados, horaInicio, horaFim);

    const row = {
      livro_id: novosDados.livroID || existente.livro_id, data: novosDados.data || existente.data,
      hora_inicio: horaInicio, hora_fim: horaFim, tempo: tempoMinutos, pagina_inicial: pagInicial,
      pagina_final: pagFinal, paginas_lidas: paginasLidas, local: novosDados.local || existente.local || '',
      humor: novosDados.humor || existente.humor || '', clima: novosDados.clima || existente.clima || '',
      distracoes: novosDados.distracoes || existente.distracoes || '',
      observacoes: novosDados.observacoes || existente.observacoes || ''
    };
    const { error } = await sb.from('sessoes').update(row).eq('id', id);
    if (error) throw new Error(error.message);
    await _recalcularProgressoLivro(row.livro_id);
    return { status: 'ok' };
  }
  async function excluirSessao(id) {
    const { data: existente } = await sb.from('sessoes').select('livro_id').eq('id', id).single();
    const { error } = await sb.from('sessoes').delete().eq('id', id);
    if (error) throw new Error(error.message);
    if (existente && existente.livro_id) await _recalcularProgressoLivro(existente.livro_id);
    return { status: 'ok' };
  }
  // Busca uma única sessão pelo id — usada pela Jornada de leitura pra abrir
  // os detalhes de uma sessão específica sem precisar trazer todas as
  // sessões do app (evita um full scan só pra achar uma).
  async function obterSessaoPorId(id) {
    const { data, error } = await sb.from('sessoes').select('*').eq('id', id).single();
    if (error) throw new Error(error.message);
    return mapSessaoFull(data);
  }
  async function listarTodasSessoes() {
    const { data, error } = await sb.from('sessoes').select('*').order('data', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(mapSessaoFull);
  }
  async function listarSessoesRecentes() {
    const { data, error } = await sb.from('sessoes').select('*').order('data', { ascending: false }).limit(20);
    if (error) throw new Error(error.message);
    return (data || []).map(mapSessaoFull);
  }
  // Última página lida de um livro (página final da sessão mais recente dele).
  async function ultimaPaginaLivro(livroID) {
    const { data, error } = await sb.from('sessoes').select('pagina_final')
      .eq('livro_id', livroID)
      .order('data', { ascending: false }).order('hora_inicio', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const n = data && data[0] ? Number(data[0].pagina_final) : NaN;
    return { pagina: Number.isFinite(n) ? n : null };
  }
  async function _recalcularProgressoLivro(livroID, opcoes = {}) {
    const { data: sessoes, error } = await sb.from('sessoes').select('paginas_lidas,data').eq('livro_id', livroID);
    if (error) throw new Error(error.message);
    let totalSessoes = 0; let dataUltimaSessao = null;
    (sessoes || []).forEach((s) => {
      totalSessoes += Number(s.paginas_lidas) || 0;
      const d = s.data ? parseDataLocal(s.data) : null;
      if (d && !isNaN(d.getTime()) && (!dataUltimaSessao || d > dataUltimaSessao)) dataUltimaSessao = d;
    });

    const { data: livro, error: e2 } = await sb.from('livros').select('*').eq('id', livroID).single();
    if (e2 || !livro) return;

    const pagAnosAnteriores = Number(livro.paginas_anos_anteriores) || 0;
    const pagExtra = Number(livro.paginas_extra) || 0;
    let novoTotal = pagAnosAnteriores + pagExtra + totalSessoes;
    // Livro antigo, sem sessões e sem "anos anteriores"/"extra": mantém as páginas já gravadas.
    const paginasGravadas = Number(livro.paginas_lidas) || 0;
    const livroLegado = novoTotal === 0 && paginasGravadas > 0;
    if (opcoes.preservarPaginasLegadas && livroLegado) novoTotal = paginasGravadas;
    const updates = { ultima_atualizacao: new Date().toISOString() };
    if (!(opcoes.preservarPaginasLegadas && livroLegado)) updates.paginas_lidas = novoTotal;

    const totalPag = Number(livro.numero_paginas) || 0;
    const statusAtual = livro.status;
    if (totalPag > 0 && novoTotal >= totalPag && statusAtual !== 'Finalizado') {
      updates.status = 'Finalizado';
      if (!livro.data_termino) {
        const dataTerminoAuto = dataUltimaSessao || new Date();
        updates.data_termino = formatDataLocal(dataTerminoAuto);
      }
    } else if (novoTotal > 0 && statusAtual === 'Quero ler') {
      updates.status = 'Lendo';
    } else if (novoTotal === 0 && statusAtual === 'Lendo') {
      updates.status = 'Quero ler';
    }

    const { error: e3 } = await sb.from('livros').update(updates).eq('id', livroID);
    if (e3) throw new Error(e3.message);
  }

  // ========== SEQUÊNCIA / PÁGINAS NO ANO (fonte única, usada por vários painéis) ==========
  async function _calcularSequenciaDias() {
    const { data, error } = await sb.from('sessoes').select('data');
    if (error) throw new Error(error.message);
    const diasUnicosSet = new Set();
    (data || []).forEach((r) => {
      const d = r.data ? parseDataLocal(r.data) : null;
      if (d && !isNaN(d.getTime())) diasUnicosSet.add(d.toDateString());
    });
    const diasUnicos = Array.from(diasUnicosSet);
    const hoje = new Date();

    const diasDesc = diasUnicos.slice().sort((a, b) => new Date(b) - new Date(a));
    let sequenciaAtual = 0;
    if (diasDesc.length > 0) {
      const dataReferencia = new Date(diasDesc[0]);
      const diffDias = Math.floor((hoje - dataReferencia) / 86400000);
      if (diffDias <= 1) {
        sequenciaAtual = 1;
        const diaIter = new Date(dataReferencia);
        for (let k = 1; k < diasDesc.length; k++) {
          diaIter.setDate(diaIter.getDate() - 1);
          if (diasDesc[k] === diaIter.toDateString()) sequenciaAtual++;
          else break;
        }
      }
    }

    const diasAsc = diasUnicos.slice().sort((a, b) => new Date(a) - new Date(b));
    let maiorSequencia = 0, seqTemp = 0;
    for (let j = 0; j < diasAsc.length; j++) {
      if (j === 0) seqTemp = 1;
      else {
        const diff = (new Date(diasAsc[j]) - new Date(diasAsc[j - 1])) / 86400000;
        seqTemp = (diff === 1) ? seqTemp + 1 : 1;
      }
      if (seqTemp > maiorSequencia) maiorSequencia = seqTemp;
    }
    return { atual: sequenciaAtual, maior: maiorSequencia };
  }
  async function _paginasLidasNoAno(ano) {
    const anoCorrente = new Date().getFullYear();
    const sessoesData = await todos('sessoes', 'data,paginas_lidas,livro_id');
    let totalSessoesNoAno = 0;
    const livrosComSessao = {};
    sessoesData.forEach((s) => {
      if (s.livro_id) livrosComSessao[s.livro_id] = true;
      const d = s.data ? parseDataLocal(s.data) : null;
      if (d && !isNaN(d.getTime()) && d.getFullYear() === ano) totalSessoesNoAno += Number(s.paginas_lidas) || 0;
    });

    const livros = await todos('livros', 'id,status,paginas_lidas,numero_paginas,data_termino,paginas_anos_anteriores,paginas_extra,paginas_extra_ano');
    let totalLivrosSemSessao = 0, totalExtras = 0;
    livros.forEach((l) => {
      const anoExtra = Number(l.paginas_extra_ano) || 0;
      if (anoExtra === ano) totalExtras += Number(l.paginas_extra) || 0;
      if (livrosComSessao[l.id]) return;
      if (l.status !== 'Finalizado') return;
      const dataTermino = l.data_termino ? parseDataLocal(l.data_termino) : null;
      const pagBase = Number(l.paginas_anos_anteriores) || 0;
      const pagLidas = Number(l.paginas_lidas) || 0;
      const numPag = Number(l.numero_paginas) || 0;
      const pagLivro = Math.max(0, Math.max(pagLidas, numPag) - pagBase);
      if (dataTermino && !isNaN(dataTermino.getTime())) {
        if (dataTermino.getFullYear() === ano) totalLivrosSemSessao += pagLivro;
      } else if (ano === anoCorrente) {
        totalLivrosSemSessao += pagLivro;
      }
    });
    return totalSessoesNoAno + totalLivrosSemSessao + totalExtras;
  }

  // ========== DASHBOARD ==========
  function calcularPrevisaoTermino(livro, sessoes) {
    if (!livro || !livro.totalPag || livro.totalPag <= 0) return null;
    const pagRestantes = livro.totalPag - livro.pagLidas;
    if (pagRestantes <= 0) return null;
    const hoje = new Date();
    const seteDiasAtras = new Date(hoje); seteDiasAtras.setDate(hoje.getDate() - 7); seteDiasAtras.setHours(0, 0, 0, 0);
    let pagPeriodo = 0, diasComLeitura = 0; const diasMap = {};
    sessoes.forEach((s) => {
      if (s.livroID === livro.ID && s.data >= seteDiasAtras) {
        const key = s.data.toDateString();
        if (!diasMap[key]) { diasMap[key] = 0; diasComLeitura++; }
        diasMap[key] += s.paginas; pagPeriodo += s.paginas;
      }
    });
    let mediaDiaria = 0;
    if (diasComLeitura > 0) mediaDiaria = pagPeriodo / diasComLeitura;
    else {
      let totalPagLivro = 0, primeiraData = null, ultimaData = null;
      sessoes.forEach((s) => {
        if (s.livroID === livro.ID) {
          totalPagLivro += s.paginas;
          if (!primeiraData || s.data < primeiraData) primeiraData = s.data;
          if (!ultimaData || s.data > ultimaData) ultimaData = s.data;
        }
      });
      if (totalPagLivro === 0 || !primeiraData || !ultimaData) return null;
      const diasTotais = Math.max(1, (ultimaData - primeiraData) / 86400000);
      mediaDiaria = totalPagLivro / diasTotais;
    }
    if (mediaDiaria <= 0) return null;
    const diasRestantes = Math.ceil(pagRestantes / mediaDiaria);
    const dataPrevista = new Date(hoje); dataPrevista.setDate(dataPrevista.getDate() + diasRestantes);
    return dataPrevista.toISOString();
  }
  async function obterDashboard() {
    const hoje = new Date();
    const anoAtual = hoje.getFullYear();
    const mesAtual = hoje.getMonth();
    const diaAtual = hoje.getDate();

    const sessoesRaw = await todos('sessoes', 'data,tempo,paginas_lidas,livro_id');
    const sessoes = sessoesRaw.map((s) => ({
      data: s.data ? parseDataLocal(s.data) : null, tempo: Number(s.tempo) || 0,
      paginas: Number(s.paginas_lidas) || 0, livroID: s.livro_id || ''
    })).filter((s) => s.data && !isNaN(s.data.getTime()));

    let paginasHoje = 0, paginasSemana = 0, paginasMes = 0, minutosTotal = 0;
    const inicioSemana = new Date(hoje); inicioSemana.setDate(diaAtual - hoje.getDay()); inicioSemana.setHours(0, 0, 0, 0);
    const inicioMes = new Date(anoAtual, mesAtual, 1);
    sessoes.forEach((s) => {
      const d = s.data;
      if (d.toDateString() === hoje.toDateString()) paginasHoje += s.paginas;
      if (d >= inicioSemana) paginasSemana += s.paginas;
      if (d >= inicioMes) paginasMes += s.paginas;
      minutosTotal += s.tempo;
    });

    const paginasAno = await _paginasLidasNoAno(anoAtual);
    const seq = await _calcularSequenciaDias();
    const livrosData = await todos('livros');

    let livrosFinalizadosAno = 0, livrosFinalizadosMes = 0;
    let livroAtual = null;
    const livrosLendo = [];

    const { data: configLivroAtual } = await sb.from('configuracoes').select('valor').eq('chave', 'livroAtualID').maybeSingle();
    const livroAtualIDPref = configLivroAtual ? configLivroAtual.valor : null;
    const { data: metaRow } = await sb.from('metas').select('meta_livros').eq('ano', anoAtual).maybeSingle();
    const metaLivros = metaRow ? Number(metaRow.meta_livros) || 0 : 0;

    livrosData.forEach((row) => {
      const status = row.status;
      const dataTermino = row.data_termino ? parseDataLocal(row.data_termino) : null;
      if (status === 'Finalizado') {
        if (dataTermino && !isNaN(dataTermino.getTime())) {
          if (dataTermino.getFullYear() === anoAtual) {
            livrosFinalizadosAno++;
            if (dataTermino.getMonth() === mesAtual) livrosFinalizadosMes++;
          }
        } else { livrosFinalizadosAno++; }
      }
      if (status === 'Lendo') {
        const livro = {
          ID: row.id, titulo: row.titulo || '', autor: row.autor || '',
          totalPag: Number(row.numero_paginas) || 0, pagLidas: Number(row.paginas_lidas) || 0,
          genero: row.genero || '', urlCapa: row.url_capa || row.imagem_capa || ''
        };
        let velMedia = 0, tempoRest = 0, totPagLivro = 0, totMinLivro = 0;
        sessoes.forEach((s) => { if (s.livroID === livro.ID && s.tempo > 0) { totPagLivro += s.paginas; totMinLivro += s.tempo; } });
        if (totMinLivro > 0) {
          const pagRest = livro.totalPag - livro.pagLidas;
          if (pagRest > 0) {
            const velPagMin = totPagLivro / totMinLivro;
            tempoRest = Math.ceil(pagRest / velPagMin);
            velMedia = Math.round(velPagMin * 60);
          }
        }
        livro.velocidadeMedia = velMedia; livro.tempoRestanteMinutos = tempoRest;
        livro.previsaoTermino = calcularPrevisaoTermino(livro, sessoes);
        livrosLendo.push(livro);
      }
    });

    if (livroAtualIDPref) {
      livroAtual = livrosLendo.find((l) => l.ID === livroAtualIDPref) || (livrosLendo.length > 0 ? livrosLendo[0] : null);
    } else {
      livroAtual = livrosLendo.length > 0 ? livrosLendo[0] : null;
    }
    const percentualMeta = metaLivros > 0 ? Math.min(100, Math.round((livrosFinalizadosAno / metaLivros) * 100)) : 0;

    const paginasPorDia = [];
    for (let k = 29; k >= 0; k--) {
      const dia = new Date(hoje); dia.setDate(dia.getDate() - k);
      const dateStr = dia.toDateString();
      let total = 0;
      sessoes.forEach((s) => { if (s.data.toDateString() === dateStr) total += s.paginas; });
      paginasPorDia.push({ dia: dia.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'numeric' }), paginas: total });
    }

    return {
      paginasHoje, paginasSemana, paginasMes, paginasAno, minutosTotal,
      horasTotal: (minutosTotal / 60).toFixed(1), sequenciaAtual: seq.atual, maiorSequencia: seq.maior,
      totalLivros: livrosData.length, livrosFinalizadosAno, livrosFinalizadosMes, metaLivros, percentualMeta,
      livroAtual, livrosLendo, paginasUltimos7Dias: paginasPorDia
    };
  }

  // ========== ESTATÍSTICAS ==========
  async function obterEstatisticas(ano) {
    ano = Number(ano) || new Date().getFullYear();
    const inicioAno = new Date(ano, 0, 1);
    const fimAno = new Date(ano, 11, 31, 23, 59, 59);

    const sessRaw = await todos('sessoes', 'data,tempo,paginas_lidas,livro_id');
    const todasSessoes = sessRaw.map((r) => ({
      data: r.data ? parseDataLocal(r.data) : null, tempo: Number(r.tempo) || 0,
      paginas: Number(r.paginas_lidas) || 0, livroID: r.livro_id || ''
    })).filter((s) => s.data && !isNaN(s.data.getTime()));
    const sessoes = todasSessoes.filter((s) => s.data >= inicioAno && s.data <= fimAno);

    const livrosRaw = await todos('livros', 'id,titulo,autor,editora,genero,subgenero,numero_paginas,status,data_termino');
    const todosLivros = livrosRaw.map((l) => ({
      ID: l.id, titulo: l.titulo || '', autor: l.autor || '', editora: l.editora || '', genero: l.genero || '', subgenero: (l.subgenero || '').toString().trim(),
      numPag: Number(l.numero_paginas) || 0, status: l.status || '',
      dataTermino: l.data_termino ? parseDataLocal(l.data_termino) : null
    }));
    const livrosAno = todosLivros.filter((l) => l.status === 'Finalizado' && l.dataTermino && l.dataTermino.getFullYear() === ano);

    const nomesMeses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const labelsMeses = []; const finalizadosPorMes = [];
    for (let m = 0; m < 12; m++) {
      labelsMeses.push(nomesMeses[m] + '/' + String(ano).slice(-2));
      finalizadosPorMes.push(livrosAno.filter((l) => l.dataTermino.getMonth() === m).length);
    }

    const hoje = new Date();
    const paginasPorDataStrTodas = {};
    todasSessoes.forEach((s) => { const key = s.data.toDateString(); paginasPorDataStrTodas[key] = (paginasPorDataStrTodas[key] || 0) + s.paginas; });
    const labelsDias = []; const paginasPorDia = [];
    for (let d = 29; d >= 0; d--) {
      const diaRef = new Date(hoje); diaRef.setDate(diaRef.getDate() - d);
      labelsDias.push(diaRef.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }));
      paginasPorDia.push(paginasPorDataStrTodas[diaRef.toDateString()] || 0);
    }

    const generosCont = {};
    livrosAno.forEach((l) => { if (l.genero) generosCont[l.genero] = (generosCont[l.genero] || 0) + 1; });

    // Subgênero é texto livre: agrupa ignorando maiúsculas/minúsculas e espaços
    // extras ("fantasia" e "Fantasia " contam como o mesmo subgênero).
    const subgenerosCont = {};
    livrosAno.forEach((l) => {
      if (!l.subgenero) return;
      const chave = l.subgenero.toLowerCase().replace(/\s+/g, ' ');
      if (!subgenerosCont[chave]) subgenerosCont[chave] = { nome: l.subgenero.replace(/\s+/g, ' '), count: 0 };
      subgenerosCont[chave].count++;
    });

    const diasDaSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const tempoPorDiaSemana = [0, 0, 0, 0, 0, 0, 0];
    sessoes.forEach((s) => { tempoPorDiaSemana[s.data.getDay()] += s.tempo; });

    let totalPaginasAno = 0, totalMinutosAno = 0;
    sessoes.forEach((s) => { totalPaginasAno += s.paginas; totalMinutosAno += s.tempo; });
    const velocidadeMedia = totalMinutosAno > 0 ? Math.round((totalPaginasAno / (totalMinutosAno / 60)) * 10) / 10 : 0;

    const labelsMesesVelocidade = []; const velocidadeMensalValores = [];
    for (let v = 0; v < 12; v++) {
      labelsMesesVelocidade.push(nomesMeses[v] + '/' + String(ano).slice(-2));
      let pagMes = 0, minMes = 0;
      sessoes.forEach((s) => { if (s.data.getMonth() === v) { pagMes += s.paginas; minMes += s.tempo; } });
      velocidadeMensalValores.push(minMes > 0 ? Math.round(pagMes / (minMes / 60)) : 0);
    }

    const autoresCont = {};
    livrosAno.forEach((l) => { if (l.autor) autoresCont[l.autor] = (autoresCont[l.autor] || 0) + 1; });
    const topAutores = Object.entries(autoresCont).sort((a, b) => b[1] - a[1]).slice(0, 5).map((i) => ({ nome: i[0], livros: i[1] }));

    const editorasCont = {};
    livrosAno.forEach((l) => { if (l.editora) editorasCont[l.editora] = (editorasCont[l.editora] || 0) + 1; });
    const topEditoras = Object.entries(editorasCont).sort((a, b) => b[1] - a[1]).slice(0, 5).map((i) => ({ nome: i[0], livros: i[1] }));

    const paginasPorDataStrAno = {};
    sessoes.forEach((s) => { const key = s.data.toDateString(); paginasPorDataStrAno[key] = (paginasPorDataStrAno[key] || 0) + s.paginas; });

    const topDiasLeitura = Object.entries(paginasPorDataStrAno)
      .filter(([, paginas]) => paginas > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dataStr, paginas]) => {
        const d = new Date(dataStr);
        return {
          data: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
          diaSemana: diasDaSemana[d.getDay()],
          paginas
        };
      });

    const heatmap = [];
    const diasNoAno = (ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0)) ? 366 : 365;
    for (let h = diasNoAno - 1; h >= 0; h--) {
      const diaHeat = new Date(fimAno); diaHeat.setHours(0, 0, 0, 0); diaHeat.setDate(diaHeat.getDate() - h);
      heatmap.push({ data: formatDataLocal(diaHeat), paginas: paginasPorDataStrAno[diaHeat.toDateString()] || 0 });
    }

    const insights = [];
    const maxTempoIdx = tempoPorDiaSemana.indexOf(Math.max(...tempoPorDiaSemana));
    if (tempoPorDiaSemana[maxTempoIdx] > 0) insights.push('Você lê mais aos ' + diasDaSemana[maxTempoIdx].toLowerCase() + '.');
    const generosOrdenados = Object.entries(generosCont).sort((a, b) => b[1] - a[1]);
    if (generosOrdenados.length > 0) insights.push('Seu gênero favorito em ' + ano + ' é ' + generosOrdenados[0][0] + '.');
    if (livrosAno.length > 0) {
      const maiorLivro = livrosAno.reduce((a, b) => (a.numPag > b.numPag) ? a : b);
      insights.push('Seu maior livro finalizado em ' + ano + ' possui ' + maiorLivro.numPag + ' páginas (' + maiorLivro.titulo + ').');
    }

    const paginasAno2 = await _paginasLidasNoAno(ano);
    return {
      ano, finalizadosPorMes: { labels: labelsMeses, valores: finalizadosPorMes },
      paginasPorDia: { labels: labelsDias, valores: paginasPorDia },
      generos: Object.entries(generosCont).map((i) => ({ genero: i[0], count: i[1] })),
      subgeneros: Object.values(subgenerosCont).sort((a, b) => b.count - a.count).map((s) => ({ subgenero: s.nome, count: s.count })),
      tempoPorDiaSemana: { labels: diasDaSemana, valores: tempoPorDiaSemana }, velocidadeMedia,
      velocidadeMensal: { labels: labelsMesesVelocidade, valores: velocidadeMensalValores },
      topAutores, topEditoras, topDiasLeitura, heatmap, insights, totalLivros: livrosAno.length,
      totalPaginas: paginasAno2, paginasAno: paginasAno2, totalHoras: (totalMinutosAno / 60).toFixed(1)
    };
  }

  async function obterResumoAno(ano) {
    ano = Number(ano) || new Date().getFullYear();
    const sessRaw = await todos('sessoes', 'data,tempo,paginas_lidas');
    let minutosAno = 0, paginasViaSessoes = 0; const diasUnicos = {};
    sessRaw.forEach((r) => {
      const d = r.data ? parseDataLocal(r.data) : null;
      if (d && !isNaN(d.getTime()) && d.getFullYear() === ano) {
        minutosAno += Number(r.tempo) || 0; paginasViaSessoes += Number(r.paginas_lidas) || 0;
        diasUnicos[d.toDateString()] = true;
      }
    });
    const diasComLeitura = Object.keys(diasUnicos).length;
    const velocidadeMedia = minutosAno > 0 ? Math.round((paginasViaSessoes / (minutosAno / 60)) * 10) / 10 : 0;

    const livrosRaw = await todos('livros', 'status,data_termino,genero,autor');
    let livrosFinalizadosAno = 0; const generosCont = {}, autoresCont = {};
    livrosRaw.forEach((l) => {
      if (l.status !== 'Finalizado') return;
      const dataTermino = l.data_termino ? parseDataLocal(l.data_termino) : null;
      if (!(dataTermino && !isNaN(dataTermino.getTime()) && dataTermino.getFullYear() === ano)) return;
      livrosFinalizadosAno++;
      const genero = (l.genero || '').toString().trim();
      const autor = (l.autor || '').toString().trim();
      if (genero) generosCont[genero] = (generosCont[genero] || 0) + 1;
      if (autor) autoresCont[autor] = (autoresCont[autor] || 0) + 1;
    });
    const generoOrdenado = Object.entries(generosCont).sort((a, b) => b[1] - a[1])[0];
    const autorOrdenado = Object.entries(autoresCont).sort((a, b) => b[1] - a[1])[0];

    return {
      ano, livrosFinalizados: livrosFinalizadosAno, paginasLidas: await _paginasLidasNoAno(ano),
      horasLidas: (minutosAno / 60).toFixed(1), diasComLeitura, velocidadeMedia,
      generoTop: generoOrdenado ? { nome: generoOrdenado[0], count: generoOrdenado[1] } : null,
      autorTop: autorOrdenado ? { nome: autorOrdenado[0], count: autorOrdenado[1] } : null
    };
  }

  async function obterHeatmapRecente(dias) {
    dias = Number(dias) || 70;
    const data = await todos('sessoes', 'data,paginas_lidas');
    const paginasPorDia = {};
    data.forEach((r) => {
      const d = r.data ? parseDataLocal(r.data) : null;
      if (d && !isNaN(d.getTime())) { const key = d.toDateString(); paginasPorDia[key] = (paginasPorDia[key] || 0) + (Number(r.paginas_lidas) || 0); }
    });
    const resultado = []; const hoje = new Date();
    for (let k = dias - 1; k >= 0; k--) {
      const dia = new Date(hoje); dia.setDate(dia.getDate() - k);
      resultado.push({ data: formatDataLocal(dia), paginas: paginasPorDia[dia.toDateString()] || 0 });
    }
    return resultado;
  }

  // Heatmap mensal (Dashboard): igual ao "heatmap" retornado por
  // obterEstatisticas, mas isolado numa função leve — evita recalcular
  // todas as outras estatísticas (gêneros, autores, velocidade etc.) só
  // pra desenhar o mapa de calor no Dashboard.
  async function obterHeatmapAno(ano) {
    ano = Number(ano) || new Date().getFullYear();
    const inicioAno = new Date(ano, 0, 1);
    const fimAno = new Date(ano, 11, 31, 23, 59, 59);
    const data = await todos('sessoes', 'data,paginas_lidas');
    const paginasPorDia = {};
    data.forEach((r) => {
      const d = r.data ? parseDataLocal(r.data) : null;
      if (d && !isNaN(d.getTime()) && d >= inicioAno && d <= fimAno) {
        const key = d.toDateString();
        paginasPorDia[key] = (paginasPorDia[key] || 0) + (Number(r.paginas_lidas) || 0);
      }
    });
    const heatmap = [];
    const diasNoAno = (ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0)) ? 366 : 365;
    for (let h = diasNoAno - 1; h >= 0; h--) {
      const diaHeat = new Date(fimAno); diaHeat.setHours(0, 0, 0, 0); diaHeat.setDate(diaHeat.getDate() - h);
      heatmap.push({ data: formatDataLocal(diaHeat), paginas: paginasPorDia[diaHeat.toDateString()] || 0 });
    }
    return { ano, heatmap };
  }

  // ========== INSIGHTS AVANÇADOS ==========
  async function obterInsightsAvancados() {
    const livrosRaw = await todos('livros', 'id,genero,nota,status,data_inicio,data_termino');
    const livrosMap = {};
    livrosRaw.forEach((l) => {
      livrosMap[l.id] = {
        genero: (l.genero || '').toString().trim() || 'Sem gênero', nota: Number(l.nota) || 0, status: l.status || '',
        dataInicio: l.data_inicio ? parseDataLocal(l.data_inicio) : null, dataTermino: l.data_termino ? parseDataLocal(l.data_termino) : null
      };
    });

    const sessRaw = await todos('sessoes', 'data,hora_inicio,tempo,paginas_lidas,livro_id,local,humor,clima');
    const sessoes = [];
    sessRaw.forEach((r) => {
      const data = r.data ? parseDataLocal(r.data) : null;
      const tempo = Number(r.tempo) || 0;
      const paginas = Number(r.paginas_lidas) || 0;
      if (!data || isNaN(data.getTime()) || tempo <= 0) return;
      const livroID = r.livro_id || '';
      const livroInfo = livrosMap[livroID] || { genero: 'Sem gênero', nota: 0, status: '' };
      sessoes.push({
        data, tempo, paginas, livroID, genero: livroInfo.genero, nota: livroInfo.nota,
        local: (r.local || '').toString().trim() || 'Não informado',
        humor: (r.humor || '').toString().trim(), clima: (r.clima || '').toString().trim(),
        minutosInicio: _paraMinutosDoDia(r.hora_inicio)
      });
    });

    function agruparVelocidade(lista, chaveFn) {
      const grupos = {};
      lista.forEach((s) => {
        const chave = chaveFn(s);
        if (!chave) return;
        if (!grupos[chave]) grupos[chave] = { paginas: 0, minutos: 0, sessoes: 0 };
        grupos[chave].paginas += s.paginas; grupos[chave].minutos += s.tempo; grupos[chave].sessoes++;
      });
      return Object.keys(grupos).map((chave) => {
        const g = grupos[chave];
        return { chave, velocidade: g.minutos > 0 ? Math.round((g.paginas / (g.minutos / 60)) * 10) / 10 : 0, sessoes: g.sessoes };
      }).sort((a, b) => b.velocidade - a.velocidade);
    }
    const velocidadePorGenero = agruparVelocidade(sessoes, (s) => s.genero).filter((g) => g.sessoes >= 2);

    function periodoDoDia(minutos) {
      if (minutos === undefined || minutos === null) return null;
      if (minutos >= 5 * 60 && minutos < 12 * 60) return 'Manhã';
      if (minutos >= 12 * 60 && minutos < 18 * 60) return 'Tarde';
      if (minutos >= 18 * 60 && minutos < 24 * 60) return 'Noite';
      return 'Madrugada';
    }
    const velocidadePorPeriodo = agruparVelocidade(sessoes, (s) => periodoDoDia(s.minutosInicio));

    function faixaDuracao(minutos) {
      if (minutos < 30) return '< 30 min';
      if (minutos < 60) return '30–60 min';
      if (minutos < 120) return '1–2 horas';
      return '> 2 horas';
    }
    const velocidadePorDuracao = agruparVelocidade(sessoes, (s) => faixaDuracao(s.tempo));
    const ordemFaixas = ['< 30 min', '30–60 min', '1–2 horas', '> 2 horas'];
    velocidadePorDuracao.sort((a, b) => ordemFaixas.indexOf(a.chave) - ordemFaixas.indexOf(b.chave));

    const velocidadePorHumor = agruparVelocidade(sessoes, (s) => s.humor || null).filter((g) => g.sessoes >= 2);

    const climaMap = {};
    sessoes.forEach((s) => {
      if (!s.clima) return;
      if (!climaMap[s.clima]) climaMap[s.clima] = { sessoes: 0, minutos: 0, paginas: 0 };
      climaMap[s.clima].sessoes++; climaMap[s.clima].minutos += s.tempo; climaMap[s.clima].paginas += s.paginas;
    });
    const distribuicaoClima = Object.keys(climaMap).map((c) => ({
      clima: c, sessoes: climaMap[c].sessoes, duracaoMedia: Math.round(climaMap[c].minutos / climaMap[c].sessoes), paginas: climaMap[c].paginas
    })).sort((a, b) => b.sessoes - a.sessoes);

    const notaPorHumor = {};
    sessoes.forEach((s) => {
      if (!s.humor || !s.nota) return;
      if (!notaPorHumor[s.humor]) notaPorHumor[s.humor] = { soma: 0, contagem: 0 };
      notaPorHumor[s.humor].soma += s.nota; notaPorHumor[s.humor].contagem++;
    });
    const notaMediaPorHumor = Object.keys(notaPorHumor).map((h) => ({
      humor: h, notaMedia: Math.round((notaPorHumor[h].soma / notaPorHumor[h].contagem) * 10) / 10, sessoes: notaPorHumor[h].contagem
    })).filter((h) => h.sessoes >= 2).sort((a, b) => b.notaMedia - a.notaMedia);

    const localMap = {};
    sessoes.forEach((s) => {
      if (!localMap[s.local]) localMap[s.local] = { paginas: 0, minutos: 0, sessoes: 0 };
      localMap[s.local].paginas += s.paginas; localMap[s.local].minutos += s.tempo; localMap[s.local].sessoes++;
    });
    const velocidadePorLocal = Object.keys(localMap).map((l) => {
      const m = localMap[l];
      return { local: l, velocidade: m.minutos > 0 ? Math.round((m.paginas / (m.minutos / 60)) * 10) / 10 : 0, duracaoMedia: Math.round(m.minutos / m.sessoes), sessoes: m.sessoes };
    }).filter((l) => l.sessoes >= 2).sort((a, b) => b.velocidade - a.velocidade);

    const generoStatus = {};
    Object.keys(livrosMap).forEach((id) => {
      const l = livrosMap[id];
      if (l.status !== 'Finalizado' && l.status !== 'Abandonado') return;
      if (!generoStatus[l.genero]) generoStatus[l.genero] = { finalizados: 0, abandonados: 0 };
      if (l.status === 'Finalizado') generoStatus[l.genero].finalizados++; else generoStatus[l.genero].abandonados++;
    });
    const taxaAbandonoPorGenero = Object.keys(generoStatus).map((g) => {
      const d = generoStatus[g]; const total = d.finalizados + d.abandonados;
      return { genero: g, finalizados: d.finalizados, abandonados: d.abandonados, taxaAbandono: total > 0 ? Math.round((d.abandonados / total) * 100) : 0 };
    }).filter((g) => (g.finalizados + g.abandonados) >= 2).sort((a, b) => b.taxaAbandono - a.taxaAbandono);

    const notaGenero = {};
    Object.keys(livrosMap).forEach((id) => {
      const l = livrosMap[id];
      if (!l.nota) return;
      if (!notaGenero[l.genero]) notaGenero[l.genero] = { soma: 0, contagem: 0 };
      notaGenero[l.genero].soma += l.nota; notaGenero[l.genero].contagem++;
    });
    const notaMediaPorGenero = Object.keys(notaGenero).map((g) => ({
      genero: g, notaMedia: Math.round((notaGenero[g].soma / notaGenero[g].contagem) * 10) / 10, livros: notaGenero[g].contagem
    })).filter((g) => g.livros >= 2).sort((a, b) => b.notaMedia - a.notaMedia);

    const diasGenero = {};
    Object.keys(livrosMap).forEach((id) => {
      const l = livrosMap[id];
      if (!l.dataInicio || !l.dataTermino) return;
      if (isNaN(l.dataInicio.getTime()) || isNaN(l.dataTermino.getTime())) return;
      const dias = Math.round((l.dataTermino - l.dataInicio) / 86400000);
      if (dias < 0) return;
      if (!diasGenero[l.genero]) diasGenero[l.genero] = { soma: 0, contagem: 0 };
      diasGenero[l.genero].soma += dias; diasGenero[l.genero].contagem++;
    });
    const diasMediosPorGenero = Object.keys(diasGenero).map((g) => ({
      genero: g, diasMedios: Math.round(diasGenero[g].soma / diasGenero[g].contagem), livros: diasGenero[g].contagem
    })).filter((g) => g.livros >= 2).sort((a, b) => a.diasMedios - b.diasMedios);

    const anotRaw = await todos('anotacoes', 'livro_id,categoria');
    let densidadeAnotacoesPorGenero = []; let categoriaMaisComum = null;
    const anotPorGenero = {}; const categoriaCont = {};
    anotRaw.forEach((a) => {
      const livroInfoAnot = livrosMap[a.livro_id];
      if (livroInfoAnot) anotPorGenero[livroInfoAnot.genero] = (anotPorGenero[livroInfoAnot.genero] || 0) + 1;
      const cat = (a.categoria || '').toString().trim();
      if (cat) categoriaCont[cat] = (categoriaCont[cat] || 0) + 1;
    });
    const paginasPorGenero = {};
    sessoes.forEach((s) => { paginasPorGenero[s.genero] = (paginasPorGenero[s.genero] || 0) + s.paginas; });
    densidadeAnotacoesPorGenero = Object.keys(anotPorGenero).filter((g) => paginasPorGenero[g] >= 100).map((g) => ({
      genero: g, densidade: Math.round((anotPorGenero[g] / paginasPorGenero[g]) * 100 * 10) / 10
    })).sort((a, b) => b.densidade - a.densidade);
    const categoriasOrdenadas = Object.entries(categoriaCont).sort((a, b) => b[1] - a[1]);
    categoriaMaisComum = categoriasOrdenadas.length ? { categoria: categoriasOrdenadas[0][0], total: categoriasOrdenadas[0][1] } : null;

    const mensagens = [];
    if (velocidadePorGenero.length >= 2) {
      const maisRapido = velocidadePorGenero[0], maisLento = velocidadePorGenero[velocidadePorGenero.length - 1];
      if (maisRapido.velocidade > maisLento.velocidade) mensagens.push('Você lê ' + maisRapido.chave + ' a ' + maisRapido.velocidade + ' pág/h — bem mais rápido que ' + maisLento.chave + ' (' + maisLento.velocidade + ' pág/h).');
    }
    if (velocidadePorPeriodo.length > 0) mensagens.push('Seu período mais produtivo é ' + velocidadePorPeriodo[0].chave.toLowerCase() + ', com média de ' + velocidadePorPeriodo[0].velocidade + ' páginas/hora.');
    if (velocidadePorHumor.length >= 2) mensagens.push('Quando está "' + velocidadePorHumor[0].chave + '", sua velocidade de leitura é a maior registrada: ' + velocidadePorHumor[0].velocidade + ' pág/h.');
    if (notaMediaPorHumor.length >= 2) mensagens.push('Os livros que você lê estando "' + notaMediaPorHumor[0].humor + '" recebem, em média, as notas mais altas (' + notaMediaPorHumor[0].notaMedia + ').');
    if (velocidadePorLocal.length >= 2) mensagens.push('Você lê mais rápido em "' + velocidadePorLocal[0].local + '": ' + velocidadePorLocal[0].velocidade + ' páginas/hora.');
    if (taxaAbandonoPorGenero.length > 0 && taxaAbandonoPorGenero[0].taxaAbandono > 0) mensagens.push('"' + taxaAbandonoPorGenero[0].genero + '" é o gênero que você mais abandona (' + taxaAbandonoPorGenero[0].taxaAbandono + '% dos livros começados).');
    if (densidadeAnotacoesPorGenero.length > 0) mensagens.push('Você faz mais anotações lendo "' + densidadeAnotacoesPorGenero[0].genero + '": ' + densidadeAnotacoesPorGenero[0].densidade + ' anotações a cada 100 páginas.');
    if (categoriaMaisComum) mensagens.push('Seu tipo de anotação mais comum é "' + categoriaMaisComum.categoria + '" (' + categoriaMaisComum.total + ' registradas).');

    return {
      velocidadePorGenero, velocidadePorPeriodo, velocidadePorDuracao, velocidadePorHumor, distribuicaoClima,
      notaMediaPorHumor, velocidadePorLocal, taxaAbandonoPorGenero, notaMediaPorGenero, diasMediosPorGenero,
      densidadeAnotacoesPorGenero, categoriaAnotacaoMaisComum: categoriaMaisComum, mensagens
    };
  }

  // ========== METAS ==========
  async function salvarMeta(meta) {
    const ano = Number(meta.ano) || new Date().getFullYear();
    const row = {
      ano, meta_livros: Number(meta.metaLivros) || 0, meta_paginas: Number(meta.metaPaginas) || 0,
      meta_mensal: Number(meta.metaMensal) || 0, meta_semanal: Number(meta.metaSemanal) || 0,
      meta_diaria: Number(meta.metaDiaria) || 0, meta_sequencia_dias: Number(meta.metaSequenciaDias) || 0
    };
    row.user_id = await uidAtual();
    const { error } = await sb.from('metas').upsert(row, { onConflict: 'user_id,ano' });
    if (error) throw new Error(error.message);
    return { status: 'ok', ano };
  }
  async function obterMetas() {
    const anoAtual = new Date().getFullYear();
    const mesAtual = new Date().getMonth();
    const { data: metaRow } = await sb.from('metas').select('*').eq('ano', anoAtual).maybeSingle();
    const meta = {
      ano: anoAtual, metaLivros: metaRow ? Number(metaRow.meta_livros) || 0 : 0,
      metaPaginas: metaRow ? Number(metaRow.meta_paginas) || 0 : 0, metaMensal: metaRow ? Number(metaRow.meta_mensal) || 0 : 0,
      metaSemanal: metaRow ? Number(metaRow.meta_semanal) || 0 : 0, metaDiaria: metaRow ? Number(metaRow.meta_diaria) || 0 : 0,
      metaSequenciaDias: metaRow ? Number(metaRow.meta_sequencia_dias) || 0 : 0
    };

    const livrosData = await todos('livros', 'status,data_termino');
    let livrosFinalizadosAno = 0;
    livrosData.forEach((l) => {
      const dataTermino = l.data_termino ? parseDataLocal(l.data_termino) : null;
      const terminouEsteAno = (dataTermino && !isNaN(dataTermino.getTime()) && dataTermino.getFullYear() === anoAtual);
      if (l.status === 'Finalizado' && (terminouEsteAno || !dataTermino)) livrosFinalizadosAno++;
    });
    const paginasLidasAno = await _paginasLidasNoAno(anoAtual);

    const inicioMes = new Date(anoAtual, mesAtual, 1);
    const { data: sessMes, error: e2 } = await sb.from('sessoes').select('paginas_lidas').gte('data', formatDataLocal(inicioMes));
    if (e2) throw new Error(e2.message);
    let paginasLidasMes = 0;
    (sessMes || []).forEach((s) => { paginasLidasMes += Number(s.paginas_lidas) || 0; });

    const diasRestantesMes = new Date(anoAtual, mesAtual + 1, 0).getDate() - new Date().getDate();
    const paginasParaMetaMensal = Math.max(0, meta.metaMensal - paginasLidasMes);
    const paginasPorDiaNecessarias = diasRestantesMes > 0 ? Math.ceil(paginasParaMetaMensal / diasRestantesMes) : 0;

    const seq = await _calcularSequenciaDias();
    const percentualSequencia = meta.metaSequenciaDias > 0 ? Math.min(100, Math.round((seq.maior / meta.metaSequenciaDias) * 100)) : 0;

    return {
      meta,
      progresso: {
        livrosFinalizados: livrosFinalizadosAno, paginasLidasAno, paginasLidasMes,
        percentualLivros: meta.metaLivros > 0 ? Math.min(100, Math.round((livrosFinalizadosAno / meta.metaLivros) * 100)) : 0,
        percentualPaginas: meta.metaPaginas > 0 ? Math.min(100, Math.round((paginasLidasAno / meta.metaPaginas) * 100)) : 0,
        paginasParaMetaMensal, paginasPorDiaNecessarias, sequenciaAtual: seq.atual, maiorSequencia: seq.maior, percentualSequencia
      }
    };
  }

  // ========== CONQUISTAS ==========
  async function verificarConquistas() {
    const conqData = await todos('conquistas', 'nome');
    const conquistasExistentes = {};
    conqData.forEach((c) => { conquistasExistentes[c.nome] = true; });

    const livros = await todos('livros');
    let livrosFinalizados = 0, totalPaginasLidas = 0, temFavorito = false, maiorPaginas = 0, classicos = 0;
    const generosSet = {}, idiomasSet = {}, nacionalidadesSet = {};
    let livrosComMais1000 = 0, livrosComMais500 = 0, livrosComMais400 = 0, livrosComMais300 = 0;

    livros.forEach((l) => {
      const status = l.status;
      const pagLidas = Number(l.paginas_lidas) || 0;
      const numPag = Number(l.numero_paginas) || 0;
      const genero = (l.genero || '').toString().trim();
      const idioma = (l.idioma || '').toString().trim().toLowerCase();
      const nacionalidade = (l.nacionalidade_autor || '').toString().trim().toLowerCase();
      const classico = !!l.classico;

      if (classico) classicos++;
      if (genero) generosSet[genero.toLowerCase()] = true;
      if (idioma) idiomasSet[idioma] = true;
      if (nacionalidade) nacionalidadesSet[nacionalidade] = true;
      if (l.favorito) temFavorito = true;

      if (status === 'Finalizado') {
        livrosFinalizados++;
        totalPaginasLidas += Math.max(pagLidas, numPag);
        if (numPag > 1000) livrosComMais1000++;
        if (numPag > 500) livrosComMais500++;
        if (numPag > 400) livrosComMais400++;
        if (numPag > 300) livrosComMais300++;
      } else {
        totalPaginasLidas += pagLidas;
      }
      maiorPaginas = Math.max(maiorPaginas, numPag);
    });

    const sessoesData = await todos('sessoes', 'tempo,local,hora_inicio');
    let minutosTotal = 0, maxTempoSessao = 0; const locaisSet = {}; let sessoesNoturnas = 0;
    sessoesData.forEach((s) => {
      const tempo = Number(s.tempo) || 0; minutosTotal += tempo;
      if (tempo > maxTempoSessao) maxTempoSessao = tempo;
      const local = (s.local || '').toString().trim(); if (local) locaisSet[local] = true;
      if (s.hora_inicio) {
        const minutos = _paraMinutosDoDia(s.hora_inicio);
        if (minutos >= 22 * 60 || minutos < 5 * 60) sessoesNoturnas++;
      }
    });

    const seqConquistas = await _calcularSequenciaDias();
    const maiorSequenciaGlobal = seqConquistas.maior;

    const { count: totalAnotacoes } = await sb.from('anotacoes').select('*', { count: 'exact', head: true });

    const anoAtual = new Date().getFullYear();
    const { data: metaRow } = await sb.from('metas').select('meta_livros,meta_paginas').eq('ano', anoAtual).maybeSingle();
    const metaLivros = metaRow ? Number(metaRow.meta_livros) || 0 : 0;
    const metaPaginas = metaRow ? Number(metaRow.meta_paginas) || 0 : 0;

    let livrosFinalizadosAno = 0;
    livros.forEach((l) => {
      const dataTerminoL = l.data_termino ? parseDataLocal(l.data_termino) : null;
      const terminouEsteAno = (dataTerminoL && !isNaN(dataTerminoL.getTime()) && dataTerminoL.getFullYear() === anoAtual);
      if (l.status === 'Finalizado' && (terminouEsteAno || !dataTerminoL)) livrosFinalizadosAno++;
    });
    const paginasLidasAno = await _paginasLidasNoAno(anoAtual);

    const conquistasPossiveis = [
      { nome: 'Primeiro livro', descricao: 'Finalizar o primeiro livro', condicao: livrosFinalizados >= 1 },
      { nome: 'Leitor iniciante', descricao: 'Finalizar 5 livros', condicao: livrosFinalizados >= 5 },
      { nome: 'Leitor dedicado', descricao: 'Finalizar 10 livros', condicao: livrosFinalizados >= 10 },
      { nome: 'Devorador de livros', descricao: 'Finalizar 20 livros', condicao: livrosFinalizados >= 20 },
      { nome: 'Página 1000', descricao: 'Ler 1.000 páginas', condicao: totalPaginasLidas >= 1000 },
      { nome: 'Página 5000', descricao: 'Ler 5.000 páginas', condicao: totalPaginasLidas >= 5000 },
      { nome: 'Maratona de 7 dias', descricao: 'Ler por 7 dias consecutivos', condicao: maiorSequenciaGlobal >= 7 },
      { nome: 'Maratona de 30 dias', descricao: 'Ler por 30 dias consecutivos', condicao: maiorSequenciaGlobal >= 30 },
      { nome: 'Livro gigante', descricao: 'Finalizar um livro com mais de 500 páginas', condicao: maiorPaginas >= 500 },
      { nome: 'Favorito', descricao: 'Marcar um livro como favorito', condicao: temFavorito },
      { nome: 'Leitor global', descricao: 'Ler livros em 3 idiomas diferentes', condicao: Object.keys(idiomasSet).length >= 3 },
      { nome: 'Leitor noturno', descricao: 'Ler durante a noite (após as 22h ou antes das 5h)', condicao: sessoesNoturnas >= 1 },
      { nome: 'Colecionador de clássicos', descricao: 'Ler 3 livros clássicos', condicao: classicos >= 3 },
      { nome: 'Diversidade literária', descricao: 'Ler 5 gêneros diferentes', condicao: Object.keys(generosSet).length >= 5 },
      { nome: 'Anotador', descricao: 'Fazer 10 anotações', condicao: (totalAnotacoes || 0) >= 10 },
      { nome: 'Viajante literário', descricao: 'Ler autores de 3 nacionalidades diferentes', condicao: Object.keys(nacionalidadesSet).length >= 3 },
      { nome: 'Leitor constante', descricao: 'Acumular 100 horas de leitura', condicao: minutosTotal >= 6000 },
      { nome: 'Maratonista', descricao: 'Fazer uma sessão de leitura de mais de 2 horas', condicao: maxTempoSessao >= 120 },
      { nome: 'Meta de livros cumprida', descricao: 'Atingir a meta anual de livros', condicao: metaLivros > 0 && livrosFinalizadosAno >= metaLivros },
      { nome: 'Meta de páginas cumprida', descricao: 'Atingir a meta anual de páginas', condicao: metaPaginas > 0 && paginasLidasAno >= metaPaginas },
      { nome: 'Explorador de locais', descricao: 'Registrar sessões em 5 locais diferentes', condicao: Object.keys(locaisSet).length >= 5 },
      { nome: 'Cidadão do mundo', descricao: 'Ler autores de 15 nacionalidades diferentes', condicao: Object.keys(nacionalidadesSet).length >= 15 },
      { nome: 'Página 10000', descricao: 'Ler 10.000 páginas', condicao: totalPaginasLidas >= 10000 },
      { nome: 'Página 15000', descricao: 'Ler 15.000 páginas', condicao: totalPaginasLidas >= 15000 },
      { nome: 'Página 20000', descricao: 'Ler 20.000 páginas', condicao: totalPaginasLidas >= 20000 },
      { nome: 'Livro gigante plus', descricao: 'Ter um livro com mais de 1.000 páginas', condicao: livrosComMais1000 >= 1 },
      { nome: 'Cinco livros grandes', descricao: 'Ter 5 livros com mais de 500 páginas', condicao: livrosComMais500 >= 5 },
      { nome: 'Sete livros médios', descricao: 'Ter 7 livros com mais de 400 páginas', condicao: livrosComMais400 >= 7 },
      { nome: 'Dez livros compactos', descricao: 'Ter 10 livros com mais de 300 páginas', condicao: livrosComMais300 >= 10 },
      { nome: 'Sequência de 100 dias', descricao: 'Ler por 100 dias consecutivos', condicao: maiorSequenciaGlobal >= 100 },
      { nome: 'Colecionador de clássicos avançado', descricao: 'Ler 25 livros clássicos', condicao: classicos >= 25 }
    ];

    const novas = [];
    for (const c of conquistasPossiveis) {
      if (!conquistasExistentes[c.nome] && c.condicao) {
        const { error: eIns } = await sb.from('conquistas').insert({ nome: c.nome, descricao: c.descricao, data_conquistada: new Date().toISOString() });
        if (!eIns) novas.push(c);
      }
    }
    return novas;
  }
  async function listarConquistas() {
    const { data, error } = await sb.from('conquistas').select('*').order('data_conquistada', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map((c) => ({ ID: c.id, Nome: c.nome, 'Descrição': c.descricao || '', DataConquistada: c.data_conquistada || '' }));
  }

  // ========== TIMELINE / CALENDÁRIO / LOCAIS ==========
  // Cache curto (60s) do array de eventos já montado — pra rolagem de
  // páginas na Jornada não remontar tudo do zero a cada scroll. É limpo
  // automaticamente sempre que qualquer ação de escrita roda (mesmo
  // mecanismo que já limpa o `cache` geral logo abaixo, em enviar()).
  const _timelineEventosCache = new Map();
  const TIMELINE_CACHE_TTL_MS = 60000;

  function _formatarMinutos(min) {
    min = Math.round(Number(min) || 0);
    if (min <= 0) return '';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
  }

  async function _construirTimelineCompleta(livroID) {
    livroID = livroID || null;
    const chaveTL = livroID || '__geral__';
    const cacheado = _timelineEventosCache.get(chaveTL);
    if (cacheado && (Date.now() - cacheado.timestamp) < TIMELINE_CACHE_TTL_MS) return cacheado.eventos;

    const eventos = [];

    // Sessões: filtra direto no banco por livro quando for a Jornada de um
    // livro só, em vez de trazer as sessões de todos os livros à toa.
    let querySess = sb.from('sessoes').select('id,data,hora_inicio,hora_fim,livro_id,paginas_lidas,tempo,local');
    if (livroID) querySess = querySess.eq('livro_id', livroID);
    const { data: sessData, error: eSess } = await querySess;
    if (eSess) throw new Error(eSess.message);

    const ultimaSessaoPorLivro = {};
    const primeiraSessaoPorLivro = {};
    (sessData || []).forEach((s) => {
      if (!s.data) return;
      const dSess = parseDataLocal(s.data);
      if (isNaN(dSess.getTime())) return;
      const minutosInicioSess = _paraMinutosDoDia(s.hora_inicio);
      if (minutosInicioSess > 0) dSess.setHours(Math.floor(minutosInicioSess / 60), minutosInicioSess % 60, 0, 0);
      const livroIDSess = s.livro_id || '';
      if (!livroIDSess) return;

      const atual = ultimaSessaoPorLivro[livroIDSess];
      if (!atual || dSess.getTime() > atual.timestamp) ultimaSessaoPorLivro[livroIDSess] = { timestamp: dSess.getTime(), minutosFim: _paraMinutosDoDia(s.hora_fim) };
      const primeira = primeiraSessaoPorLivro[livroIDSess];
      if (!primeira || dSess.getTime() < primeira.timestamp) primeiraSessaoPorLivro[livroIDSess] = { timestamp: dSess.getTime() };

      // Evento individual da sessão (páginas lidas, tempo, local) — cada
      // sessão de leitura vira um ponto na jornada, não só a 1ª/última.
      const paginasLidasSess = Number(s.paginas_lidas) || 0;
      const tempoMinSess = Number(s.tempo) || 0;
      let detalheSess = paginasLidasSess > 0
        ? `${paginasLidasSess} página${paginasLidasSess === 1 ? '' : 's'} lida${paginasLidasSess === 1 ? '' : 's'}`
        : 'Sessão de leitura';
      const tempoFormatado = _formatarMinutos(tempoMinSess);
      if (tempoFormatado) detalheSess += ` · ${tempoFormatado}`;
      if (s.local) detalheSess += ` · ${s.local}`;
      eventos.push({ tipo: 'sessao-leitura', data: dSess.toISOString(), livroID: livroIDSess, id: s.id, detalhe: detalheSess, icone: 'fas fa-book-reader', titulo: null, urlCapa: null, temHora: minutosInicioSess > 0 });
    });

    const livrosMap = {};
    let queryLivros = sb.from('livros').select('id,titulo,autor,url_capa,imagem_capa,data_cadastro,data_inicio,status,data_termino');
    if (livroID) queryLivros = queryLivros.eq('id', livroID);
    const { data: livrosData, error: eLivros } = await queryLivros;
    if (eLivros) throw new Error(eLivros.message);
    (livrosData || []).forEach((l) => {
      const titulo = l.titulo || 'Sem título';
      const autor = l.autor || '';
      const urlCapa = l.url_capa || l.imagem_capa || '';
      livrosMap[l.id] = { titulo, urlCapa };

      if (l.data_cadastro) {
        const dCad = new Date(l.data_cadastro);
        if (!isNaN(dCad.getTime())) eventos.push({ tipo: 'livro', data: dCad.toISOString(), titulo, detalhe: 'Adicionado à biblioteca' + (autor ? ' — ' + autor : ''), icone: 'fas fa-book', livroID: l.id, urlCapa });
      }
      const primeiraSessao = primeiraSessaoPorLivro[l.id];
      let dInicio = primeiraSessao ? new Date(primeiraSessao.timestamp) : (l.data_inicio ? parseDataLocal(l.data_inicio) : null);
      if (dInicio && !isNaN(dInicio.getTime())) eventos.push({ tipo: 'livro-comecou', data: dInicio.toISOString(), titulo, detalhe: 'Começou a ler' + (autor ? ' — ' + autor : ''), icone: 'fas fa-book-open', livroID: l.id, urlCapa });

      if (l.status === 'Finalizado' || l.status === 'Abandonado') {
        let dFinal = l.data_termino ? parseDataLocal(l.data_termino) : null;
        const ultimaSessao = ultimaSessaoPorLivro[l.id];
        if (ultimaSessao) {
          dFinal = new Date(ultimaSessao.timestamp);
          if (ultimaSessao.minutosFim > 0) dFinal.setHours(Math.floor(ultimaSessao.minutosFim / 60), ultimaSessao.minutosFim % 60, 0, 0);
        }
        if (dFinal && !isNaN(dFinal.getTime())) {
          if (l.status === 'Finalizado') {
            eventos.push({ tipo: 'livro-finalizado', data: dFinal.toISOString(), titulo, detalhe: 'Livro finalizado' + (autor ? ' — ' + autor : ''), icone: 'fas fa-flag-checkered', livroID: l.id, urlCapa });
          } else {
            eventos.push({ tipo: 'livro-abandonado', data: dFinal.toISOString(), titulo, detalhe: 'Livro abandonado' + (autor ? ' — ' + autor : ''), icone: 'fas fa-pause-circle', livroID: l.id, urlCapa });
          }
        }
      }
    });

    // As sessões foram montadas antes do livrosMap ficar pronto — completa
    // título/capa delas agora.
    eventos.forEach((ev) => {
      if (ev.tipo === 'sessao-leitura') {
        const info = livrosMap[ev.livroID] || { titulo: 'Livro removido', urlCapa: '' };
        ev.titulo = info.titulo;
        ev.urlCapa = info.urlCapa;
      }
    });

    let queryAnot = sb.from('anotacoes').select('id,data,livro_id,resumo,trecho,categoria');
    if (livroID) queryAnot = queryAnot.eq('livro_id', livroID);
    const { data: anotData, error: eAnot } = await queryAnot;
    if (eAnot) throw new Error(eAnot.message);
    (anotData || []).forEach((a) => {
      if (!a.data) return;
      const dAnot = new Date(a.data);
      if (isNaN(dAnot.getTime())) return;
      const infoLivroAnot = livrosMap[a.livro_id] || { titulo: 'Livro removido', urlCapa: '' };
      let textoAnot = (a.resumo || a.trecho || '').toString();
      if (textoAnot.length > 120) textoAnot = textoAnot.slice(0, 117) + '...';
      eventos.push({ tipo: 'anotacao', data: dAnot.toISOString(), titulo: infoLivroAnot.titulo, detalhe: (a.categoria || 'Anotação') + (textoAnot ? ': ' + textoAnot : ''), icone: 'fas fa-sticky-note', livroID: a.livro_id, id: a.id, urlCapa: infoLivroAnot.urlCapa });
    });

    // Conquistas não têm vínculo com livro no banco (tabela `conquistas` não
    // tem livro_id) — por isso só entram na Jornada geral, nunca na de um
    // livro específico.
    if (!livroID) {
      const conqData = await todos('conquistas', 'nome,descricao,data_conquistada');
      conqData.forEach((c) => {
        if (!c.data_conquistada) return;
        const dConq = new Date(c.data_conquistada);
        if (isNaN(dConq.getTime())) return;
        eventos.push({ tipo: 'conquista', data: dConq.toISOString(), titulo: c.nome || 'Conquista', detalhe: c.descricao || '', icone: 'fas fa-trophy', livroID: null, urlCapa: '' });
      });
    }

    eventos.sort((a, b) => new Date(b.data) - new Date(a.data));
    _timelineEventosCache.set(chaveTL, { timestamp: Date.now(), eventos });
    return eventos;
  }
  async function obterTimelineAtividades(antesDe, limite, livroID) {
    limite = Number(limite) || 20;
    const todosEventos = await _construirTimelineCompleta(livroID || null);
    const cursor = antesDe ? new Date(antesDe) : null;
    const filtrados = (cursor && !isNaN(cursor.getTime())) ? todosEventos.filter((ev) => new Date(ev.data) < cursor) : todosEventos;
    return { itens: filtrados.slice(0, limite), temMais: filtrados.length > limite };
  }
  async function obterCalendarioLeitura(ano, mes) {
    const livrosMap = {};
    const livrosData = await todos('livros', 'id,titulo,url_capa');
    livrosData.forEach((l) => { livrosMap[l.id] = { titulo: l.titulo || 'Sem título', urlCapa: l.url_capa || '' }; });

    const sessoesData = await todos('sessoes', 'data,livro_id');
    const calendario = {};
    sessoesData.forEach((s) => {
      const dataSess = parseDataLocal(s.data);
      if (isNaN(dataSess.getTime())) return;
      if (dataSess.getFullYear() !== ano || dataSess.getMonth() + 1 !== mes) return;
      const dateStr = formatDataLocal(dataSess);
      if (!calendario[dateStr]) calendario[dateStr] = [];
      const jaExiste = calendario[dateStr].some((l) => l.id === s.livro_id);
      if (!jaExiste && livrosMap[s.livro_id]) calendario[dateStr].push({ id: s.livro_id, titulo: livrosMap[s.livro_id].titulo, urlCapa: livrosMap[s.livro_id].urlCapa });
    });

    const anotacoesData = await todos('anotacoes', 'categoria,trecho,comentario,data');
    const citacoes = [];
    anotacoesData.forEach((a) => {
      const cat = a.categoria || ''; const trecho = a.trecho || ''; const comentario = a.comentario || '';
      if (cat !== 'Citação' && !trecho && !comentario) return;
      const dataAnot = new Date(a.data);
      if (isNaN(dataAnot.getTime())) return;
      if (dataAnot.getFullYear() !== ano || dataAnot.getMonth() + 1 !== mes) return;
      const anotDateStr = formatDataLocal(dataAnot);
      if (!citacoes.includes(anotDateStr)) citacoes.push(anotDateStr);
    });
    return { dias: calendario, citacoes };
  }
  async function listarLocais() {
    const livrosMap = {};
    const livrosData = await todos('livros', 'id,titulo,url_capa');
    livrosData.forEach((l) => { livrosMap[l.id] = { titulo: l.titulo || '', capa: l.url_capa || '' }; });

    const data = await todos('sessoes', 'local,paginas_lidas,tempo,livro_id');
    const locaisMap = {};
    data.forEach((s) => {
      const local = (s.local || '').trim();
      if (!local) return;
      if (!locaisMap[local]) locaisMap[local] = { local, sessoes: 0, paginas: 0, minutos: 0, livros: {}, ultimoLivroID: null };
      locaisMap[local].sessoes++;
      locaisMap[local].paginas += Number(s.paginas_lidas) || 0;
      locaisMap[local].minutos += Number(s.tempo) || 0;
      if (s.livro_id) { locaisMap[local].livros[s.livro_id] = true; locaisMap[local].ultimoLivroID = s.livro_id; }
    });

    const resultado = Object.values(locaisMap).map((l) => {
      const infoLivro = livrosMap[l.ultimoLivroID] || { titulo: '', capa: '' };
      return {
        local: l.local, sessoes: l.sessoes, paginas: l.paginas, horas: (l.minutos / 60).toFixed(1), minutos: l.minutos,
        livrosUnicos: Object.keys(l.livros).length, ultimoLivro: infoLivro.titulo, ultimaCapa: infoLivro.capa
      };
    });
    resultado.sort((a, b) => b.paginas - a.paginas);
    return resultado;
  }

  // ========== ANOTAÇÕES / CITAÇÕES ==========
  async function adicionarAnotacao(a) {
    const row = { livro_id: a.livroID || null, capitulo: a.capitulo || '', pagina: a.pagina || '', categoria: a.categoria || 'Geral', resumo: a.resumo || '', trecho: a.trecho || '', comentario: a.comentario || '', imagem: a.imagem || '' };
    const { data, error } = await sb.from('anotacoes').insert(row).select('id').single();
    if (error) throw new Error(error.message);
    return { status: 'ok', id: data.id };
  }
  async function listarAnotacoes(livroID) {
    let query = sb.from('anotacoes').select('*').order('data', { ascending: false });
    if (livroID) query = query.eq('livro_id', livroID);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data || []).map((a) => ({
      ID: a.id, LivroID: a.livro_id, 'Capítulo': a.capitulo || '', 'Página': a.pagina || '', Categoria: a.categoria || '',
      Resumo: a.resumo || '', Trecho: a.trecho || '', 'Comentário': a.comentario || '', Imagem: a.imagem || '', Data: a.data || ''
    }));
  }
  async function adicionarCitacao(c) {
    const row = { livro_id: c.livroID || null, trecho: c.trecho || '', pagina: c.pagina || '', comentario: c.comentario || '' };
    const { data, error } = await sb.from('citacoes').insert(row).select('id').single();
    if (error) throw new Error(error.message);
    return { status: 'ok', id: data.id };
  }
  async function listarCitacoes() {
    const { data, error } = await sb.from('citacoes').select('*').order('data', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map((c) => ({ ID: c.id, LivroID: c.livro_id, Trecho: c.trecho || '', 'Página': c.pagina || '', 'Comentário': c.comentario || '', Data: c.data || '' }));
  }

  // ========== DESEJOS ==========
  async function adicionarDesejo(d) {
    const row = { titulo: d.titulo || '', autor: d.autor || '', prioridade: d.prioridade || 'Média', preco: d.preco || null, link: d.link || '', onde_comprar: d.ondeComprar || '', observacoes: d.observacoes || '' };
    const { data, error } = await sb.from('desejos').insert(row).select('id').single();
    if (error) throw new Error(error.message);
    return { status: 'ok', id: data.id };
  }
  async function listarDesejos() {
    const data = await todos('desejos');
    const ordemPrioridade = { Alta: 1, 'Média': 2, Baixa: 3 };
    const desejos = data.map((d) => ({
      ID: d.id, Título: d.titulo || '', Autor: d.autor || '', Prioridade: d.prioridade || '', 'Preço': d.preco ?? '',
      Link: d.link || '', OndeComprar: d.onde_comprar || '', Observações: d.observacoes || ''
    }));
    desejos.sort((a, b) => (ordemPrioridade[a.Prioridade] || 99) - (ordemPrioridade[b.Prioridade] || 99));
    return desejos;
  }
  async function removerDesejo(id) {
    const { error } = await sb.from('desejos').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { status: 'ok' };
  }
  async function moverParaBiblioteca(desejo) {
    await removerDesejo(desejo.id);
    const book = { titulo: desejo.titulo, autor: desejo.autor, status: 'Quero ler', preco: desejo.preco || '', observacoes: desejo.observacoes || '', localCompra: desejo.ondeComprar || '' };
    return adicionarLivro(book);
  }

  // ========== EMPRÉSTIMOS ==========
  async function adicionarEmprestimo(e) {
    const row = { livro_id: e.livroID || null, para_quem: e.paraQuem || '', data_emprestimo: e.dataEmprestimo || formatDataLocal(new Date()), previsao_devolucao: e.previsaoDevolucao || null, status: 'Emprestado' };
    const { data, error } = await sb.from('emprestimos').insert(row).select('id').single();
    if (error) throw new Error(error.message);
    return { status: 'ok', id: data.id };
  }
  async function listarEmprestimos() {
    const data = await todos('emprestimos');
    const hoje = new Date();
    const emprestimos = data.map((e) => {
      let status = e.status;
      if (status === 'Emprestado' && e.previsao_devolucao) {
        const previsao = parseDataLocal(e.previsao_devolucao);
        if (hoje > previsao) status = 'Atrasado';
      }
      return { ID: e.id, LivroID: e.livro_id, ParaQuem: e.para_quem || '', 'DataEmpréstimo': e.data_emprestimo || '', 'PrevisãoDevolução': e.previsao_devolucao || '', Status: status };
    });
    const ordemStatus = { Atrasado: 0, Emprestado: 1, Devolvido: 2 };
    emprestimos.sort((a, b) => (ordemStatus[a.Status] || 99) - (ordemStatus[b.Status] || 99) || parseDataLocal(b['DataEmpréstimo']) - parseDataLocal(a['DataEmpréstimo']));
    return emprestimos;
  }
  async function devolverEmprestimo(id) {
    const { error } = await sb.from('emprestimos').update({ status: 'Devolvido' }).eq('id', id);
    if (error) throw new Error(error.message);
    return { status: 'ok' };
  }

  // ========== CONFIGURAÇÕES ==========
  async function salvarConfiguracao(chave, valor) {
    const user_id = await uidAtual();
    const { error } = await sb.from('configuracoes').upsert({ user_id, chave, valor }, { onConflict: 'user_id,chave' });
    if (error) throw new Error(error.message);
    return { status: 'ok' };
  }
  async function obterConfiguracoes() {
    const data = await todos('configuracoes');
    const config = {};
    data.forEach((c) => { config[c.chave] = c.valor; });
    return config;
  }
  async function setLivroAtual(livroID) { return salvarConfiguracao('livroAtualID', livroID); }
  async function salvarCoordenadaLocal(local, coordenada) {
    return salvarConfiguracao('local_coord_' + local.replace(/\s+/g, '_'), coordenada);
  }

  // ========== BACKUP ==========
  async function exportarBackup() {
    const tabelas = ['livros', 'sessoes', 'anotacoes', 'metas', 'conquistas', 'configuracoes', 'desejos', 'emprestimos', 'citacoes'];
    const backup = {};
    for (const t of tabelas) backup[t] = await todos(t);
    return backup;
  }
  async function importarBackup(backupData) {
    const tabelas = ['livros', 'sessoes', 'anotacoes', 'metas', 'conquistas', 'configuracoes', 'desejos', 'emprestimos', 'citacoes'];
    for (const t of tabelas) {
      if (!backupData[t] || !backupData[t].length) continue;
      const linhas = backupData[t].map(({ user_id, ...resto }) => resto);
      const { error } = await sb.from(t).insert(linhas);
      if (error) throw new Error('Falha ao importar ' + t + ': ' + error.message);
    }
    return { status: 'ok' };
  }

  // ========== PROXY DE IMAGEM / DICIONÁRIO (via Edge Function) ==========
  async function tokenAtual() {
    const { data } = await sb.auth.getSession();
    return (data && data.session && data.session.access_token) || SUPABASE_KEY;
  }
  async function _chamarEdgeFunction(corpo) {
    const resp = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + (await tokenAtual()) },
      body: JSON.stringify(corpo)
    });
    return resp.json();
  }
  async function proxyImagem(url) { return _chamarEdgeFunction({ acao: 'proxyImage', url }); }
  async function buscarPalavra(palavra) { return _chamarEdgeFunction({ acao: 'buscarPalavra', palavra }); }

  // ========== BINGO LITERÁRIO ==========
  // Os textos dos 200 desafios ficam em js/bingo-dados.js (só no cliente);
  // aqui só guardamos tema/índice/ciclo + um snapshot do texto sorteado.
  function _mapBingoRow(r) {
    return {
      id: r.id, tema: r.tema, indice: r.indice, ciclo: r.ciclo, texto: r.texto,
      status: r.status, livro_id: r.livro_id, livro_titulo: (r.livros && r.livros.titulo) || null,
      sorteado_em: r.sorteado_em, concluido_em: r.concluido_em
    };
  }
  async function bingoObterEstado() {
    const [estadoResp, desafiosResp] = await Promise.all([
      sb.from('bingo_estado').select('*').maybeSingle(),
      sb.from('bingo_desafios').select('id,tema,indice,ciclo,status,livro_id,sorteado_em,concluido_em,texto,livros(titulo)')
    ]);
    if (estadoResp.error) throw new Error(estadoResp.error.message);
    if (desafiosResp.error) throw new Error(desafiosResp.error.message);
    return {
      ultimosTemas: (estadoResp.data && estadoResp.data.ultimos_temas) || [],
      desafios: (desafiosResp.data || []).map(_mapBingoRow)
    };
  }
  async function bingoSortear(tema, textos) {
    if (!tema || !Array.isArray(textos) || !textos.length) return { erro: 'Dados do tema inválidos.' };
    const { data: estadoRow, error: eEstado } = await sb.from('bingo_estado').select('*').maybeSingle();
    if (eEstado) throw new Error(eEstado.message);
    const ultimosTemas = (estadoRow && estadoRow.ultimos_temas) || [];
    if (ultimosTemas.includes(tema)) {
      return { erro: 'Este tema ainda está bloqueado. Sorteie os outros temas primeiro.' };
    }

    const { data: doTema, error: eDoTema } = await sb.from('bingo_desafios')
      .select('indice, ciclo').eq('tema', tema).order('ciclo', { ascending: false });
    if (eDoTema) throw new Error(eDoTema.message);

    let ciclo = 1;
    let indicesSorteados = [];
    if (doTema && doTema.length) {
      ciclo = doTema[0].ciclo;
      indicesSorteados = doTema.filter(d => d.ciclo === ciclo).map(d => d.indice);
    }

    let cicloNovo = false;
    if (indicesSorteados.length >= textos.length) {
      ciclo += 1;
      indicesSorteados = [];
      cicloNovo = true;
    }

    const disponiveis = [];
    for (let i = 0; i < textos.length; i++) if (!indicesSorteados.includes(i)) disponiveis.push(i);
    const indiceEscolhido = disponiveis[Math.floor(Math.random() * disponiveis.length)];
    const texto = textos[indiceEscolhido];

    const { data: inserido, error: eInsert } = await sb.from('bingo_desafios')
      .insert({ tema, indice: indiceEscolhido, ciclo, texto, status: 'sorteado' })
      .select('id,tema,indice,ciclo,status,livro_id,sorteado_em,concluido_em,texto')
      .single();
    if (eInsert) throw new Error(eInsert.message);

    const ultimosTemasAtualizados = [tema, ...ultimosTemas].slice(0, 3);
    const { error: eUpsert } = await sb.from('bingo_estado').upsert({ user_id: await uidAtual(), ultimos_temas: ultimosTemasAtualizados }, { onConflict: 'user_id' });
    if (eUpsert) throw new Error(eUpsert.message);

    return { status: 'ok', desafio: _mapBingoRow(inserido), cicloNovo, ultimosTemas: ultimosTemasAtualizados };
  }
  async function bingoConcluir(id, livroId) {
    const patch = { status: 'concluido', concluido_em: new Date().toISOString(), livro_id: livroId || null };
    const { data, error } = await sb.from('bingo_desafios').update(patch).eq('id', id)
      .select('id,tema,indice,ciclo,status,livro_id,sorteado_em,concluido_em,texto,livros(titulo)').single();
    if (error) throw new Error(error.message);
    return { status: 'ok', desafio: _mapBingoRow(data) };
  }
  async function bingoDesfazerConclusao(id) {
    const { data, error } = await sb.from('bingo_desafios')
      .update({ status: 'sorteado', concluido_em: null, livro_id: null }).eq('id', id)
      .select('id,tema,indice,ciclo,status,livro_id,sorteado_em,concluido_em,texto').single();
    if (error) throw new Error(error.message);
    return { status: 'ok', desafio: _mapBingoRow(data) };
  }

  // ========== DISPATCHER ==========
  async function processar(dados) {
    switch (dados.acao) {
      case 'addBook': return adicionarLivro(dados.book);
      case 'listBooks': return listarLivros();
      case 'addSession': return adicionarSessao(dados.sessao);
      case 'dashboard': return obterDashboard();
      case 'listAllBooks': return listarLivrosCompleto();
      case 'stats': return obterEstatisticas(dados.ano);
      case 'saveGoal': return salvarMeta(dados.meta);
      case 'getGoals': return obterMetas();
      case 'checkAchievements': return verificarConquistas();
      case 'listAchievements': return listarConquistas();
      case 'addNote': return adicionarAnotacao(dados.anotacao);
      case 'listNotes': return listarAnotacoes(dados.livroID || null);
      case 'addQuote': return adicionarCitacao(dados.citacao);
      case 'listQuotes': return listarCitacoes();
      case 'addWish': return adicionarDesejo(dados.desejo);
      case 'listWishes': return listarDesejos();
      case 'removeWish': return removerDesejo(dados.id);
      case 'moveToLibrary': return moverParaBiblioteca(dados.desejo);
      case 'addLoan': return adicionarEmprestimo(dados.emprestimo);
      case 'listLoans': return listarEmprestimos();
      case 'returnLoan': return devolverEmprestimo(dados.id);
      case 'saveConfig': return salvarConfiguracao(dados.chave, dados.valor);
      case 'getConfigs': return obterConfiguracoes();
      case 'exportBackup': return exportarBackup();
      case 'importBackup': return importarBackup(dados.backup);
      case 'listAllSessions': return listarTodasSessoes();
      case 'listRecentSessions': return listarSessoesRecentes();
      case 'ultimaPaginaLivro': return ultimaPaginaLivro(dados.livroID);
      case 'getSession': return obterSessaoPorId(dados.id);
      case 'updateBook': return atualizarLivro(dados.id, dados.book);
      case 'deleteBook': return excluirLivro(dados.id);
      case 'updateSession': return atualizarSessao(dados.id, dados.sessao);
      case 'setLivroAtual': return setLivroAtual(dados.livroID);
      case 'calendario': return obterCalendarioLeitura(dados.ano, dados.mes);
      case 'resumoAno': return obterResumoAno(dados.ano);
      case 'proxyImage': return proxyImagem(dados.url);
      case 'listarLocais': return listarLocais();
      case 'salvarCoordenadaLocal': return salvarCoordenadaLocal(dados.local, dados.coordenada);
      case 'deleteSession': return excluirSessao(dados.id);
      case 'heatmapRecente': return obterHeatmapRecente(dados.dias);
      case 'heatmapAno': return obterHeatmapAno(dados.ano);
      case 'insightsAvancados': return obterInsightsAvancados();
      case 'timelineAtividades': return obterTimelineAtividades(dados.antesDe, dados.limite, dados.livroID);
      case 'buscarPalavra': return buscarPalavra(dados.palavra);
      case 'bingoEstado': return bingoObterEstado();
      case 'bingoSortear': return bingoSortear(dados.tema, dados.textos);
      case 'bingoConcluir': return bingoConcluir(dados.id, dados.livroId);
      case 'bingoDesfazerConclusao': return bingoDesfazerConclusao(dados.id);
      default: return { erro: 'Ação desconhecida' };
    }
  }

  async function executar(dados) {
    pendentes++;
    despacharStatus('salvando');
    try {
      const resultado = await processar(dados);
      pendentes = Math.max(0, pendentes - 1);
      if (pendentes === 0) despacharStatus('sincronizado');
      return resultado;
    } catch (e) {
      pendentes = Math.max(0, pendentes - 1);
      despacharStatus('erro');
      return { erro: e.message };
    }
  }

  async function enviar(dados) {
    const acao = dados && dados.acao;
    const cacheavel = ACOES_CACHEAVEIS.has(acao);
    const chave = cacheavel ? chaveCache(dados) : null;

    if (cacheavel) {
      const entrada = cache.get(chave);
      if (entrada && (Date.now() - entrada.timestamp) < CACHE_TTL_MS) return entrada.promise;
    }

    const promise = executar(dados);

    if (cacheavel) {
      cache.set(chave, { timestamp: Date.now(), promise });
      promise.catch(() => cache.delete(chave));
    } else {
      promise.then(() => { cache.clear(); _timelineEventosCache.clear(); }).catch(() => {});
    }
    return promise;
  }

  async function testarConexao() {
    try {
      const { error } = await sb.from('livros').select('id').limit(1);
      return error ? { status: 'erro', message: error.message } : { status: 'ok' };
    } catch (e) {
      return { status: 'erro', message: 'Sem comunicação.' };
    }
  }

  return { enviar, testarConexao };
})();
