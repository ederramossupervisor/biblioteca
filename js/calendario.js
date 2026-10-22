const CalendarioLeitura = (() => {
  let anoAtual, mesAtual;

  async function init(ano, mes) {
    const grid = document.getElementById('calendario-grid');
    if (!grid) return;

    anoAtual = ano || new Date().getFullYear();
    mesAtual = mes || new Date().getMonth() + 1;

    document.getElementById('calendario-mes-anterior').addEventListener('click', () => mudarMes(-1));
    document.getElementById('calendario-mes-proximo').addEventListener('click', () => mudarMes(1));

    // Evento do botão de compartilhar/baixar imagem
    document.getElementById('btn-compartilhar-calendario')?.addEventListener('click', compartilharCalendario);

    await carregarCalendario();
  }

  async function mudarMes(delta) {
    mesAtual += delta;
    if (mesAtual > 12) { mesAtual = 1; anoAtual++; }
    if (mesAtual < 1) { mesAtual = 12; anoAtual--; }
    await carregarCalendario();
  }

  async function carregarCalendario() {
    const grid = document.getElementById('calendario-grid');
    const titulo = document.getElementById('calendario-mes-ano');
    if (!grid || !titulo) return;

    titulo.textContent = `${new Date(anoAtual, mesAtual - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`;
    grid.innerHTML = '<div class="col text-center text-muted">Carregando...</div>';

    try {
      const response = await API.enviar({ acao: 'calendario', ano: anoAtual, mes: mesAtual });
      if (response && !response.erro) {
        renderizarCalendario(response.dias, response.citacoes);
      } else {
        grid.innerHTML = '<div class="col-12 text-center text-muted">Erro ao carregar.</div>';
      }
    } catch (e) {
      console.error('Erro calendário:', e);
      grid.innerHTML = '<div class="col-12 text-center text-muted">Falha na conexão.</div>';
    }
  }

  function renderizarCalendario(dias, citacoes) {
    const grid = document.getElementById('calendario-grid');
    grid.innerHTML = '';

    const primeiroDia = new Date(anoAtual, mesAtual - 1, 1).getDay(); // 0=Dom
    const ultimoDia = new Date(anoAtual, mesAtual, 0).getDate();

    // Dias vazios antes do primeiro dia
    for (let i = 0; i < primeiroDia; i++) {
      const div = document.createElement('div');
      div.className = 'col text-center p-1';
      grid.appendChild(div);
    }

    // Dias do mês
    for (let dia = 1; dia <= ultimoDia; dia++) {
      const dateStr = `${anoAtual}-${String(mesAtual).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      const livros = dias[dateStr] || [];
      const temCitacao = citacoes && citacoes.includes(dateStr);

      const div = document.createElement('div');
      div.className = 'col calendario-dia text-center p-1';
      div.style.position = 'relative';

      if (livros.length > 0) {
        div.classList.add('com-leitura');
      
        const ultimoLivro = livros[livros.length - 1];
        const totalLivros = livros.length;
    
        const imgHtml = ultimoLivro.urlCapa
          ? `<img src="${ultimoLivro.urlCapa}" alt="${ultimoLivro.titulo}" title="${ultimoLivro.titulo}" loading="lazy" style="width:100%; max-height:45px; object-fit:contain; border-radius:4px;">`
          : `<i class="fas fa-book text-primary" title="${ultimoLivro.titulo}"></i>`;
    
        let badgeHtml = '';
        if (totalLivros > 1) {
          const outrosLivros = livros.slice(0, -1);
          const outrosTitulos = outrosLivros.map(l => l.titulo).join(', ');
          badgeHtml = `<span class="position-absolute bottom-0 end-0 badge rounded-pill bg-primary" 
                            style="font-size:0.6rem; transform: translate(25%, 25%);" 
                            title="Também leu: ${outrosTitulos}">+${totalLivros - 1}</span>`;
        }
    
        div.innerHTML = `
          <small class="d-block">${dia}</small>
          <div style="position: relative; width: 100%;">
            ${imgHtml}
            ${badgeHtml}
          </div>
        `;
      } else {
        div.innerHTML = `<small>${dia}</small>`;
      }

      // Ícone de citação sobreposto
      if (temCitacao) {
        const badge = document.createElement('span');
        badge.className = 'position-absolute top-0 end-0 badge rounded-pill bg-warning text-dark p-1';
        badge.style.fontSize = '0.6rem';
        badge.innerHTML = '<i class="fas fa-quote-right"></i>';
        badge.title = 'Contém citação';
        div.appendChild(badge);
      }

      grid.appendChild(div);
    }
  }

  // NOVA FUNÇÃO: captura o calendário e baixa como PNG
  async function compartilharCalendario() {
  const btn = document.getElementById('btn-compartilhar-calendario');
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

  try {
    const elemento = document.querySelector('#calendario-grid').closest('.card-body');
    const imagens = elemento.querySelectorAll('img');
    
    // Guarda os src originais para restaurar depois
    const srcsOriginais = [];
    
    // Converte cada imagem em base64 usando o proxy
    for (const img of imagens) {
      srcsOriginais.push(img.src);
      if (img.src.startsWith('http')) {
        try {
          const resp = await API.enviar({ acao: 'proxyImage', url: img.src });
          if (resp && resp.dataUrl) {
            img.src = resp.dataUrl;
          }
        } catch (e) {
          console.warn('Falha ao converter imagem:', img.src, e);
        }
      }
    }

    // Aguarda as imagens carregarem (importante para o canvas)
    await Promise.all(Array.from(imagens).map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
    }));

    const estilo = getComputedStyle(document.documentElement);
    const corFundo = estilo.getPropertyValue('--bg-card') || '#ffffff';

    const canvas = await html2canvas(elemento, {
      backgroundColor: corFundo,
      scale: 2,
      useCORS: true,
      allowTaint: false
    });

    // Restaura as imagens originais
    imagens.forEach((img, i) => {
      if (srcsOriginais[i]) img.src = srcsOriginais[i];
    });

    canvas.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const mesAno = document.getElementById('calendario-mes-ano').textContent.replace(/\s+/g, '_');
      a.download = `calendario_leitura_${mesAno}.png`;
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
      Util.toast('Calendário baixado!', 'success');
    }, 'image/png');
  } catch (error) {
    console.error(error);
    Util.toast('Erro ao gerar imagem.', 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}
  return { init };
})();
