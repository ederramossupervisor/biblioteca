const Exportar = (() => {
  // Funções utilitárias de conversão
  function converterParaCSV(dados) {
    if (!dados.length) return '';
    const headers = Object.keys(dados[0]);
    const linhas = dados.map(obj => headers.map(h => `"${(obj[h] || '').toString().replace(/"/g, '""')}"`).join(','));
    return [headers.join(','), ...linhas].join('\n');
  }

  function converterParaMarkdown(dados) {
    if (!dados.length) return 'Nenhum dado.';
    const headers = Object.keys(dados[0]);
    let md = '| ' + headers.join(' | ') + ' |\n';
    md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
    dados.forEach(obj => {
      md += '| ' + headers.map(h => (obj[h] || '').toString().replace(/\|/g, '\\|')).join(' | ') + ' |\n';
    });
    return md;
  }

  function converterParaTXT(dados) {
    if (!dados.length) return 'Nenhum dado.';
    const headers = Object.keys(dados[0]);
    return dados.map(obj => headers.map(h => `${h}: ${obj[h] || ''}`).join('\n')).join('\n\n---\n\n');
  }

  async function init() {
    const page = document.getElementById('page-exportar');
    if (!page || !page.classList.contains('active')) return;
    console.log('📤 Módulo Exportar pronto.');
    configurarFormulario();
    configurarRelatorio();
  }

  function configurarFormulario() {
    const form = document.getElementById('form-exportar');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tipo = document.getElementById('export-tipo').value;
      const formato = document.getElementById('export-formato').value;

      try {
        let dados = [];
        let nomeArquivo = '';

        switch (tipo) {
          case 'livros':
            dados = await API.enviar({ acao: 'listAllBooks' });
            nomeArquivo = 'livros';
            break;
          case 'sessoes':
            dados = await API.enviar({ acao: 'listAllSessions' });
            nomeArquivo = 'sessoes';
            break;
          case 'anotacoes':
            dados = await API.enviar({ acao: 'listNotes', livroID: '' }); // vazio = todas
            nomeArquivo = 'anotacoes';
            break;
          case 'citacoes':
            dados = await API.enviar({ acao: 'listQuotes' });
            nomeArquivo = 'citacoes';
            break;
          case 'tudo':
            const [livros, anotacoes, citacoes] = await Promise.all([
              API.enviar({ acao: 'listAllBooks' }),
              API.enviar({ acao: 'listNotes', livroID: '' }),
              API.enviar({ acao: 'listQuotes' })
            ]);
            dados = { livros, anotacoes, citacoes };
            formato = 'json'; // forçar JSON para tudo
            nomeArquivo = 'leitura_plus_backup';
            break;
          
        }

        let conteudo = '';
        let mimeType = 'text/plain';
        let extensao = 'txt';

        if (formato === 'csv') {
          conteudo = converterParaCSV(dados);
          mimeType = 'text/csv';
          extensao = 'csv';
        } else if (formato === 'json') {
          conteudo = JSON.stringify(dados, null, 2);
          mimeType = 'application/json';
          extensao = 'json';
        } else if (formato === 'markdown') {
          conteudo = converterParaMarkdown(dados);
          extensao = 'md';
        } else if (formato === 'txt') {
          conteudo = converterParaTXT(dados);
        }

        baixarArquivo(conteudo, `${nomeArquivo}.${extensao}`, mimeType);
        Util.toast('Download iniciado!', 'success');
      } catch (erro) {
        Util.toast('Erro ao exportar: ' + erro.message, 'danger');
      }
    });
  }

  async function configurarRelatorio() {
    document.getElementById('btn-gerar-relatorio').addEventListener('click', async () => {
      const periodo = document.getElementById('relatorio-periodo').value;
      try {
        const dash = await API.enviar({ acao: 'dashboard' });
        const metas = await API.enviar({ acao: 'getGoals' });
        const stats = await API.enviar({ acao: 'stats' });

        let relatorio = `RELATÓRIO DE LEITURA - ${periodo === 'mensal' ? 'MENSAL' : 'ANUAL'}\n`;
        relatorio += `Gerado em: ${new Date().toLocaleDateString('pt-BR')}\n\n`;

        relatorio += `📖 Leitura Atual: ${dash.livroAtual ? dash.livroAtual.titulo + ' (' + (dash.livroAtual.pagLidas || 0) + ' de ' + dash.livroAtual.totalPag + ' páginas)' : 'Nenhum'}\n\n`;

        relatorio += `📊 Resumo:\n`;
        relatorio += `- Livros finalizados (ano): ${dash.livrosFinalizadosAno}\n`;
        relatorio += `- Páginas lidas hoje: ${dash.paginasHoje}\n`;
        relatorio += `- Páginas na semana: ${dash.paginasSemana}\n`;
        relatorio += `- Páginas no mês: ${dash.paginasMes}\n`;
        relatorio += `- Páginas no ano: ${dash.paginasAno}\n`;
        relatorio += `- Total de horas lidas: ${dash.horasTotal}\n`;
        relatorio += `- Sequência atual: ${dash.sequenciaAtual} dias\n`;
        relatorio += `- Maior sequência: ${dash.maiorSequencia} dias\n\n`;

        relatorio += `🎯 Metas:\n`;
        relatorio += `- Meta anual de livros: ${metas.meta.metaLivros} (${metas.progresso.percentualLivros}% concluído)\n`;
        relatorio += `- Meta anual de páginas: ${metas.meta.metaPaginas} (${metas.progresso.percentualPaginas}% concluído)\n`;
        relatorio += `- Meta mensal: ${metas.meta.metaMensal} páginas - faltam ${metas.progresso.paginasParaMetaMensal} (${metas.progresso.paginasPorDiaNecessarias} pág/dia)\n\n`;

        relatorio += `📈 Insights:\n`;
        if (stats.insights) {
          stats.insights.forEach(insight => relatorio += `- ${insight}\n`);
        }

        document.getElementById('relatorio-conteudo').textContent = relatorio;
        document.getElementById('relatorio-preview').classList.remove('d-none');
        document.getElementById('btn-baixar-relatorio').onclick = () => {
          baixarArquivo(relatorio, `relatorio_leitura_${periodo}.txt`, 'text/plain');
        };

        Util.toast('Relatório gerado!', 'success');
      } catch (e) {
        Util.toast('Erro ao gerar relatório', 'danger');
      }
    });
  }

  function baixarArquivo(conteudo, nomeArquivo, mimeType) {
    const blob = new Blob([conteudo], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { init };
})();

// Inicialização segura
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Exportar.init());
} else {
  Exportar.init();
}