const Metas = (() => {
  async function init() {
    const page = document.getElementById('page-metas');
    if (!page || !page.classList.contains('active')) return;

    console.log('🎯 Carregando metas...');
    configurarForm();
    await carregarMetas();
    await carregarConquistas();
    console.log('✅ Módulo Metas pronto.');
  }

  function configurarForm() {
    const form = document.getElementById('metas-form');
    document.getElementById('meta-ano').value = new Date().getFullYear();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!navigator.onLine) {
        Util.toast('Você está offline. Conecte-se para salvar metas.', 'warning');
        return;
      }
      const meta = {
        ano: Number(document.getElementById('meta-ano').value) || new Date().getFullYear(),
        metaLivros: Number(document.getElementById('meta-livros').value) || 0,
        metaPaginas: Number(document.getElementById('meta-paginas').value) || 0,
        metaMensal: Number(document.getElementById('meta-mensal').value) || 0,
        metaSemanal: Number(document.getElementById('meta-semanal').value) || 0,
        metaDiaria: Number(document.getElementById('meta-diaria').value) || 0,
        metaSequenciaDias: Number(document.getElementById('meta-sequencia').value) || 0
      };
      try {
        const resp = await API.enviar({ acao: 'saveGoal', meta });
        if (resp && resp.status === 'ok') {
          Util.toast('Metas salvas!', 'success');
          carregarMetas();
        }
      } catch (err) {
        Util.toast('Erro ao salvar metas: ' + err.message, 'danger');
      }
    });
  }

  async function carregarMetas() {
    try {
      const resp = await API.enviar({ acao: 'getGoals' });
      if (resp && resp.progresso) {
        DB.salvarMetas(resp.meta).catch(e => console.warn('Cache metas falhou:', e));
        exibirProgresso(resp.meta, resp.progresso);
      }
    } catch (e) {
      console.warn('Falha na API, tentando cache offline...');
      const ano = new Date().getFullYear();
      const cached = await DB.obterMetas(ano);
      if (cached) {
        // Simula um progresso mínimo para exibição
        const progresso = {
          livrosFinalizados: 0,
          paginasLidasAno: 0,
          paginasLidasMes: 0,
          percentualLivros: 0,
          percentualPaginas: 0,
          paginasParaMetaMensal: cached.metaMensal || 0,
          paginasPorDiaNecessarias: 0,
          sequenciaAtual: 0,
          maiorSequencia: 0,
          percentualSequencia: 0
        };
        exibirProgresso(cached, progresso);
        Util.toast('Modo offline - metas do último acesso.', 'info');
      }
    }
  }

  function exibirProgresso(meta, prog) {
    document.getElementById('meta-ano').value = meta.ano;
    document.getElementById('meta-livros').value = meta.metaLivros || 0;
    document.getElementById('meta-paginas').value = meta.metaPaginas || 0;
    document.getElementById('meta-mensal').value = meta.metaMensal || 0;
    document.getElementById('meta-semanal').value = meta.metaSemanal || 0;
    document.getElementById('meta-diaria').value = meta.metaDiaria || 0;
    document.getElementById('meta-sequencia').value = meta.metaSequenciaDias || 0;

    atualizarAnel('prog-livros', 'prog-livros-label', prog.percentualLivros);
    document.getElementById('texto-prog-livros').textContent =
      `${prog.livrosFinalizados} de ${meta.metaLivros} livros`;

    atualizarAnel('prog-paginas', 'prog-paginas-label', prog.percentualPaginas);
    document.getElementById('texto-prog-paginas').textContent =
      `${prog.paginasLidasAno.toLocaleString('pt-BR')} de ${meta.metaPaginas.toLocaleString('pt-BR')} páginas`;

    document.getElementById('info-meta-mensal').textContent =
      `Faltam ${prog.paginasParaMetaMensal.toLocaleString('pt-BR')} páginas para bater a meta mensal. ` +
      (prog.paginasPorDiaNecessarias > 0
        ? `Leia ${prog.paginasPorDiaNecessarias} páginas por dia.`
        : 'Meta mensal já batida!');

    const cardSequencia = document.getElementById('card-prog-sequencia');
    if (meta.metaSequenciaDias > 0 && prog.maiorSequencia !== undefined) {
      cardSequencia.style.display = '';
      const pct = prog.percentualSequencia || 0;
      atualizarAnel('prog-sequencia', 'prog-sequencia-label', pct);
      document.getElementById('texto-prog-sequencia').textContent =
        `${prog.maiorSequencia} de ${meta.metaSequenciaDias} dias (recorde)`;
      document.getElementById('texto-sequencia-atual').textContent =
        `Sequência atual: ${prog.sequenciaAtual} dia${prog.sequenciaAtual === 1 ? '' : 's'}`;
    } else {
      cardSequencia.style.display = 'none';
    }
  }

  // Atualiza um anel de progresso circular (SVG <circle>) via
  // stroke-dasharray/stroke-dashoffset, e escreve a porcentagem no label
  // central sobreposto. idCirculo é o <circle class="progress-ring-fill">;
  // idLabel é o <div class="progress-ring-label"> por cima dele.
  function atualizarAnel(idCirculo, idLabel, percentual) {
    const circulo = document.getElementById(idCirculo);
    const label = document.getElementById(idLabel);
    if (!circulo) return;
    const raio = circulo.r.baseVal.value;
    const circunferencia = 2 * Math.PI * raio;
    const pct = Math.max(0, Math.min(100, percentual || 0));
    circulo.style.strokeDasharray = `${circunferencia} ${circunferencia}`;
    circulo.style.strokeDashoffset = circunferencia * (1 - pct / 100);
    if (label) label.textContent = pct + '%';
  }

  async function carregarConquistas() {
    let conquistas = [];
    try {
      const resp = await API.enviar({ acao: 'listAchievements' });
      if (Array.isArray(resp)) {
        conquistas = resp;
        DB.salvarConquistas(resp).catch(e => console.warn('Cache conquistas falhou:', e));
      }
    } catch (e) {
      console.warn('Falha na API, tentando cache offline...');
      conquistas = await DB.obterConquistas();
      if (conquistas.length > 0) {
        Util.toast('Modo offline - conquistas do último acesso.', 'info');
      }
    }

    const grid = document.getElementById('conquistas-grid');
    if (!grid) return;

    const icones = {
  // Antigas
  'Primeiro livro': 'fa-book',
  'Leitor iniciante': 'fa-book-open',
  'Leitor dedicado': 'fa-award',
  'Devorador de livros': 'fa-fire',
  'Página 1000': 'fa-file-alt',
  'Página 5000': 'fa-copy',
  'Maratona de 7 dias': 'fa-calendar-check',
  'Maratona de 30 dias': 'fa-calendar-alt',
  'Livro gigante': 'fa-weight-hanging',
  'Favorito': 'fa-star',
  'Leitor global': 'fa-globe-americas',
  'Leitor noturno': 'fa-moon',
  'Colecionador de clássicos': 'fa-landmark',
  'Diversidade literária': 'fa-rainbow',
  'Anotador': 'fa-pen',
  'Viajante literário': 'fa-map-marked-alt',

  // Novas
  'Leitor constante': 'fa-hourglass-half',
  'Maratonista': 'fa-stopwatch',
  'Meta de livros cumprida': 'fa-bullseye',
  'Meta de páginas cumprida': 'fa-file-alt',
  'Explorador de locais': 'fa-map-pin',
  'Cidadão do mundo': 'fa-earth-americas',
  'Página 10000': 'fa-layer-group',
  'Página 15000': 'fa-layer-group',
  'Página 20000': 'fa-layer-group',
  'Livro gigante plus': 'fa-book',
  'Cinco livros grandes': 'fa-book-bookmark',
  'Sete livros médios': 'fa-book-reader',
  'Dez livros compactos': 'fa-th-list',
  'Sequência de 100 dias': 'fa-calendar-check',
  'Colecionador de clássicos avançado': 'fa-landmark'
};

    const descricoes = {
  'Primeiro livro': 'Finalizar o primeiro livro',
  'Leitor iniciante': 'Finalizar 5 livros',
  'Leitor dedicado': 'Finalizar 10 livros',
  'Devorador de livros': 'Finalizar 20 livros',
  'Página 1000': 'Ler 1.000 páginas',
  'Página 5000': 'Ler 5.000 páginas',
  'Maratona de 7 dias': 'Ler por 7 dias consecutivos',
  'Maratona de 30 dias': 'Ler por 30 dias consecutivos',
  'Livro gigante': 'Finalizar um livro com mais de 500 páginas',
  'Favorito': 'Marcar um livro como favorito',
  'Leitor global': 'Ler livros em 3 idiomas diferentes',
  'Leitor noturno': 'Ler durante a noite (após as 22h ou antes das 5h)',
  'Colecionador de clássicos': 'Ler 3 livros clássicos',
  'Diversidade literária': 'Ler 5 gêneros diferentes',
  'Anotador': 'Fazer 10 anotações',
  'Viajante literário': 'Ler autores de 3 nacionalidades diferentes',
  
  // Novas conquistas
  'Leitor constante': 'Acumular 100 horas de leitura',
  'Maratonista': 'Fazer uma sessão de leitura de mais de 2 horas',
  'Meta de livros cumprida': 'Atingir a meta anual de livros',
  'Meta de páginas cumprida': 'Atingir a meta anual de páginas',
  'Explorador de locais': 'Registrar sessões em 5 locais diferentes',
  'Cidadão do mundo': 'Ler autores de 15 nacionalidades diferentes',
  'Página 10000': 'Ler 10.000 páginas',
  'Página 15000': 'Ler 15.000 páginas',
  'Página 20000': 'Ler 20.000 páginas',
  'Livro gigante plus': 'Ler um livro com mais de 1.000 páginas',
  'Cinco livros grandes': 'Ler 5 livros com mais de 500 páginas',
  'Sete livros médios': 'Ler 7 livros com mais de 400 páginas',
  'Dez livros compactos': 'Ler 10 livros com mais de 300 páginas',
  'Sequência de 100 dias': 'Ler por 100 dias consecutivos',
  'Colecionador de clássicos avançado': 'Ler 25 livros clássicos'
};
    const nomesObtidos = conquistas.map(c => c.Nome);

    // Descarta tooltips antigos antes de recriar o grid (evita instâncias órfãs)
    grid.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
      const inst = bootstrap.Tooltip.getInstance(el);
      if (inst) inst.dispose();
    });
    grid.innerHTML = '';

    Object.keys(icones).forEach(nome => {
      const obtida = nomesObtidos.includes(nome);
      const descricao = descricoes[nome] || 'Continue usando o app para descobrir como desbloquear.';
      const col = document.createElement('div');
      col.className = 'col-6 col-md-4 col-lg-3 col-xl-2';
      col.innerHTML = `
        <div class="conquista-card ${obtida ? 'conquistada' : ''}"
             tabindex="0"
             data-bs-toggle="tooltip"
             data-bs-placement="top"
             data-bs-trigger="hover focus"
             data-bs-title="${Util.escapeHTML(descricao)}">
          <div class="conquista-badge mx-auto mb-2"><i class="fas ${icones[nome]} fa-2x"></i></div>
          <strong>${nome}</strong>
          ${obtida ? '<span class="badge bg-success d-block mt-1">Conquistada</span>' : '<span class="badge bg-light text-muted d-block mt-1">Bloqueada</span>'}
        </div>`;
      grid.appendChild(col);
    });

    // Inicializa os tooltips do Bootstrap (funciona com mouse e toque,
    // pois o cartão é focável via tabindex="0")
    grid.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
      new bootstrap.Tooltip(el);
    });

    document.getElementById('verificar-conquistas-btn').onclick = async () => {
      if (!navigator.onLine) {
        Util.toast('Você está offline. Conecte-se para verificar conquistas.', 'warning');
        return;
      }
      const novas = await API.enviar({ acao: 'checkAchievements' });
      if (Array.isArray(novas) && novas.length > 0) {
        Util.toast(`${novas.length} nova(s) conquista(s)!`, 'success');
        carregarConquistas();
      } else {
        Util.toast('Nenhuma conquista nova.', 'info');
      }
    };
  }

  return { init };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Metas.init());
} else {
  Metas.init();
}
