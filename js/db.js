/**
 * Módulo de banco de dados local (IndexedDB via Dexie)
 */
const DB = (() => {
  // Um banco local por usuário (o id vem de auth.js via localStorage). Assim o cache
  // de uma conta nunca aparece em outra conta usada no mesmo aparelho.
  const db = new Dexie('LeiturasDB_' + Util.uidLocal());
  db.version(1).stores({
    livros: 'ID',
    sessoes: 'ID',
    anotacoes: 'ID',
    metas: 'Ano',
    conquistas: 'ID',
    dashboard: 'chave',
    estatisticas: 'chave'
  });

  // Nova versão — adiciona tabela para persistir o EPUB aberto e a posição de leitura
  db.version(2).stores({
    livros: 'ID',
    sessoes: 'ID',
    anotacoes: 'ID',
    metas: 'Ano',
    conquistas: 'ID',
    dashboard: 'chave',
    estatisticas: 'chave',
    leitorEstado: 'chave' // armazena um único objeto com chave='ultimo-livro'
  });

  // Nova versão — cache local das Configuracoes (coordenadas dos locais de
  // leitura, etc.). Evita perguntar 'getConfigs' pro Apps Script toda vez
  // que o Mapa de Locais abre, já que essas coordenadas mudam raramente.
  db.version(3).stores({
    livros: 'ID',
    sessoes: 'ID',
    anotacoes: 'ID',
    metas: 'Ano',
    conquistas: 'ID',
    dashboard: 'chave',
    estatisticas: 'chave',
    leitorEstado: 'chave',
    configsCache: 'chave' // chave='principal'
  });

  // Nova versão — fila de sessões registradas offline, aguardando envio pro
  // Apps Script assim que a conexão voltar. '++idLocal' = chave autoincrementada
  // só local, não confundir com o ID gerado pelo backend.
  db.version(4).stores({
    livros: 'ID',
    sessoes: 'ID',
    anotacoes: 'ID',
    metas: 'Ano',
    conquistas: 'ID',
    dashboard: 'chave',
    estatisticas: 'chave',
    leitorEstado: 'chave',
    configsCache: 'chave',
    filaOffline: '++idLocal'
  });

  async function salvarLivros(livros) {
    await db.livros.clear();
    await db.livros.bulkPut(livros);
  }

  async function obterLivros() {
    return await db.livros.toArray();
  }

  async function salvarDashboard(dados) {
    await db.dashboard.put({ chave: 'principal', ...dados });
  }

  async function obterDashboard() {
    return await db.dashboard.get('principal');
  }

  async function salvarEstatisticas(dados) {
    await db.estatisticas.put({ chave: 'principal', ...dados });
  }

  async function obterEstatisticas() {
    return await db.estatisticas.get('principal');
  }

  async function salvarSessoes(sessoes) {
    await db.sessoes.clear();
    await db.sessoes.bulkPut(sessoes);
  }

  async function obterSessoes() {
    return await db.sessoes.toArray();
  }

  async function salvarAnotacoes(anotacoes) {
    await db.anotacoes.clear();
    await db.anotacoes.bulkPut(anotacoes);
  }

  async function obterAnotacoes(livroID) {
    let todas = await db.anotacoes.toArray();
    if (livroID) {
      todas = todas.filter(a => a.LivroID === livroID);
    }
    return todas.sort((a, b) => new Date(b.Data) - new Date(a.Data));
  }

  async function salvarMetas(meta) {
    if (!meta) return;
    // A tabela usa 'Ano' (maiúsculo) como chave primária, mas o objeto que
    // vem da API usa 'ano' (minúsculo) — sem isso o Dexie não acha o valor
    // da chave e recusa o put(). Espelha o valor em 'Ano' sem mexer no
    // objeto original nem exigir migração de versão do banco.
    const paraSalvar = (meta.Ano === undefined && meta.ano !== undefined)
      ? { ...meta, Ano: meta.ano }
      : meta;
    await db.metas.put(paraSalvar);
  }

  async function obterMetas(ano) {
    return await db.metas.get(ano);
  }

  async function salvarConquistas(conquistas) {
    await db.conquistas.clear();
    await db.conquistas.bulkPut(conquistas);
  }

  async function obterConquistas() {
    return await db.conquistas.toArray();
  }

  // ===== Estado do leitor de EPUB (arquivo + posição) =====
  async function salvarEstadoLeitor(arquivo, nomeArquivo, livroID = null) {
      const estadoAtual = await db.leitorEstado.get('ultimo-livro') || {};

      await db.leitorEstado.put({
          chave: 'ultimo-livro', // Chave primária fixa para manter apenas um livro em memória de leitura
          arquivo: arquivo,
          nomeArquivo: nomeArquivo,
          cfi: estadoAtual.cfi || null,
          livroID: livroID !== null ? livroID : (estadoAtual.livroID || null) // Mantém o ID se já existir
      });
  }

  async function vincularLivroAoEstado(livroID) {
      const estadoAtual = await db.leitorEstado.get('ultimo-livro');
      if (estadoAtual) {
          await db.leitorEstado.update('ultimo-livro', { livroID: livroID });
      }
  }

  async function salvarPosicaoLeitor(cfi) {
    await db.leitorEstado.update('ultimo-livro', { cfi });
  }

  async function obterEstadoLeitor() {
    return await db.leitorEstado.get('ultimo-livro');
  }

  async function limparEstadoLeitor() {
    await db.leitorEstado.delete('ultimo-livro');
  }

  // ===== Cache de Configuracoes (coordenadas do mapa, etc.) =====
  async function salvarConfigsCache(configs) {
    await db.configsCache.put({ chave: 'principal', dados: configs, ts: Date.now() });
  }

  async function obterConfigsCache() {
    const registro = await db.configsCache.get('principal');
    return registro ? registro.dados : null;
  }

  // ===== Fila offline (sessões registradas sem conexão) =====
  async function adicionarNaFila(item) {
    return await db.filaOffline.add({ ...item, criadoEm: new Date().toISOString() });
  }

  async function obterFila() {
    return await db.filaOffline.toArray();
  }

  async function removerDaFila(idLocal) {
    await db.filaOffline.delete(idLocal);
  }

  async function contarFila() {
    return await db.filaOffline.count();
  }

  return {
    salvarLivros,
    obterLivros,
    salvarDashboard,
    obterDashboard,
    salvarEstatisticas,
    obterEstatisticas,
    salvarSessoes,
    obterSessoes,
    salvarAnotacoes,
    obterAnotacoes,
    salvarMetas,
    obterMetas,
    salvarConquistas,
    obterConquistas,
    salvarEstadoLeitor,
    salvarPosicaoLeitor,
    obterEstadoLeitor,
    limparEstadoLeitor,
    salvarConfigsCache,
    obterConfigsCache,
    adicionarNaFila,
    obterFila,
    removerDaFila,
    contarFila
  };
})();
