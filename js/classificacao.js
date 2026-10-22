/**
 * Classificação de livros: gênero (lista fechada) + subgênero (sugestões por gênero).
 *
 * Regra de ouro:
 *  - GÊNERO    responde "que tipo de livro é?"        (poucas categorias, lista fechada)
 *  - SUBGÊNERO responde "de que estilo ou tema é?"    (sugestões por gênero, texto livre)
 *
 * Para ajustar as opções, edite apenas o objeto TAXONOMIA abaixo.
 */
const Classificacao = (() => {
  const TAXONOMIA = {
    'Romance e novela': [
      'Fantasia', 'Ficção científica', 'Distopia', 'Terror', 'Suspense', 'Mistério',
      'Policial', 'Aventura', 'Histórico', 'Romântico', 'Realista', 'Realismo mágico', 'Psicológico',
      'Drama', 'Humor e sátira'
    ],
    'Conto e crônica': [
      'Fantástico', 'Realismo mágico', 'Terror', 'Policial', 'Ficção científica', 'Realista',
      'Humor', 'Cotidiano', 'Antologia'
    ],
    'Poesia': ['Lírica', 'Épica', 'Poema em prosa', 'Haicai', 'Cordel', 'Antologia'],
    'Teatro': ['Tragédia', 'Comédia', 'Drama'],
    'HQ e mangá': ['Super-herói', 'Mangá', 'Graphic novel', 'Quadrinhos autorais', 'Tirinhas'],
    'Biografia e memórias': ['Biografia', 'Autobiografia', 'Memórias', 'Diário', 'Cartas'],
    'Ensaio e não ficção': [
      'Filosofia', 'História', 'Ciências', 'Psicologia', 'Sociologia', 'Política',
      'Economia', 'Religião e espiritualidade', 'Autoajuda', 'Negócios', 'Tecnologia',
      'Arte e cultura', 'Linguagem e literatura', 'Reportagem', 'Didático'
    ],
    'Infantojuvenil': [
      'Infantil', 'Juvenil', 'Fábula', 'Conto de fadas', 'Livro ilustrado', 'Fantasia', 'Aventura'
    ],
    'Outro': []
  };

  let selGenero = null;
  let inpSubgenero = null;
  let listaSubgeneros = null;

  function opcao(valor, rotulo) {
    const o = document.createElement('option');
    o.value = valor;
    o.textContent = rotulo || valor;
    return o;
  }

  function popularGeneros() {
    selGenero.innerHTML = '';
    selGenero.appendChild(opcao('', 'Selecione...'));
    Object.keys(TAXONOMIA).forEach((g) => selGenero.appendChild(opcao(g)));
  }

  function atualizarSugestoes(genero) {
    listaSubgeneros.innerHTML = '';
    (TAXONOMIA[genero] || []).forEach((s) => listaSubgeneros.appendChild(opcao(s)));
  }

  // Define os valores sem perder classificações antigas (texto livre) que não estão na lista:
  // elas viram uma opção extra, assim editar o livro não apaga o gênero que já existia.
  function definir(genero, subgenero) {
    if (!selGenero) return;
    const g = (genero || '').toString().trim();
    popularGeneros();
    if (g && !Object.prototype.hasOwnProperty.call(TAXONOMIA, g)) {
      selGenero.appendChild(opcao(g, `${g} (fora da lista)`));
    }
    selGenero.value = g;
    atualizarSugestoes(g);
    inpSubgenero.value = subgenero || '';
  }

  function iniciar() {
    selGenero = document.getElementById('genero');
    inpSubgenero = document.getElementById('subgenero');
    listaSubgeneros = document.getElementById('subgeneros-sugestoes');
    if (!selGenero || !inpSubgenero || !listaSubgeneros) return;

    definir('', '');
    selGenero.addEventListener('change', () => atualizarSugestoes(selGenero.value));
    // form.reset() não dispara "change", então limpamos as sugestões manualmente.
    selGenero.form?.addEventListener('reset', () => setTimeout(() => definir('', ''), 0));
  }

  return { iniciar, definir, TAXONOMIA };
})();
