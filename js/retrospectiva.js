// Retrospectiva de leitura — mostra o resumo de um ano (o corrente por
// padrão, ou qualquer ano anterior escolhido no seletor), usando a ação
// 'resumoAno' do backend, que já é escopada corretamente por ano.
const Retrospectiva = (() => {
  let anoAtualSelecionado = new Date().getFullYear();

  function init() {
    const btn = document.getElementById('btn-ver-retrospectiva');
    if (!btn) return;
    btn.addEventListener('click', abrir);

    const select = document.getElementById('retrospectiva-ano-select');
    if (select) {
      popularSeletorDeAnos(select);
      select.addEventListener('change', () => {
        anoAtualSelecionado = Number(select.value);
        carregar(anoAtualSelecionado);
      });
    }

    console.log('✅ Módulo Retrospectiva pronto.');
  }

  function popularSeletorDeAnos(select) {
    const anoCorrente = new Date().getFullYear();
    const PRIMEIRO_ANO_APP = 2024; // ajuste aqui se sua conta for mais antiga
    const anoMaisAntigo = Math.min(PRIMEIRO_ANO_APP, anoCorrente);
    select.innerHTML = '';
    for (let ano = anoCorrente; ano >= anoMaisAntigo; ano--) {
      const opt = document.createElement('option');
      opt.value = ano;
      opt.textContent = ano;
      select.appendChild(opt);
    }
    select.value = anoCorrente;
  }

  async function abrir() {
    const modalEl = document.getElementById('modal-retrospectiva');
    if (!modalEl || typeof bootstrap === 'undefined') return;
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    anoAtualSelecionado = new Date().getFullYear();
    const select = document.getElementById('retrospectiva-ano-select');
    if (select) select.value = anoAtualSelecionado;

    await carregar(anoAtualSelecionado);
  }

  async function carregar(ano) {
    const corpo = document.getElementById('retrospectiva-corpo');
    corpo.innerHTML = '<div class="text-center py-5"><span class="spinner-border" role="status"></span></div>';

    try {
      const resumo = await API.enviar({ acao: 'resumoAno', ano });
      if (!resumo || resumo.erro) throw new Error('Resposta inválida da API');
      renderizar(resumo);
    } catch (e) {
      console.warn('Falha ao montar retrospectiva:', e);
      corpo.innerHTML = '<p class="text-danger text-center py-4">Não foi possível montar a retrospectiva agora. Verifique sua conexão e tente de novo.</p>';
    }
  }

  function renderizar(resumo) {
    const corpo = document.getElementById('retrospectiva-corpo');

    corpo.innerHTML = `
      <div id="retrospectiva-cartao" class="retrospectiva-cartao">
        <div class="retrospectiva-ano">${resumo.ano}</div>
        <h3 class="retrospectiva-titulo">Sua retrospectiva de leitura</h3>
        <div class="retrospectiva-grid">
          <div class="retrospectiva-item">
            <div class="retrospectiva-numero">${resumo.livrosFinalizados || 0}</div>
            <div class="retrospectiva-label">livros finalizados</div>
          </div>
          <div class="retrospectiva-item">
            <div class="retrospectiva-numero">${(resumo.paginasLidas || 0).toLocaleString('pt-BR')}</div>
            <div class="retrospectiva-label">páginas lidas</div>
          </div>
          <div class="retrospectiva-item">
            <div class="retrospectiva-numero">${resumo.horasLidas || 0}h</div>
            <div class="retrospectiva-label">de leitura no ano</div>
          </div>
          <div class="retrospectiva-item">
            <div class="retrospectiva-numero">${resumo.diasComLeitura || 0}</div>
            <div class="retrospectiva-label">dias com leitura</div>
          </div>
        </div>
        ${resumo.generoTop ? `<p class="retrospectiva-destaque">Gênero favorito: <strong>${Util.escapeHTML(resumo.generoTop.nome)}</strong></p>` : ''}
        ${resumo.autorTop ? `<p class="retrospectiva-destaque">Autor mais lido: <strong>${Util.escapeHTML(resumo.autorTop.nome)}</strong> (${resumo.autorTop.count} livro${resumo.autorTop.count === 1 ? '' : 's'})</p>` : ''}
        <p class="retrospectiva-destaque">Velocidade média: <strong>${resumo.velocidadeMedia || 0} pág/h</strong></p>
        <div class="retrospectiva-marca">
          <img src="${(document.querySelector('[data-app-logo]') || {}).src || 'img/icons/icon-128x128.png'}" alt="Ícone" style="height: 2.2em; vertical-align: middle; margin-right: 0.3em; border-radius: 8px;">
          ${document.title}
        </div>
      </div>`;

    const btnBaixar = document.getElementById('btn-baixar-retrospectiva');
    if (btnBaixar) {
      btnBaixar.onclick = () => baixarImagem(btnBaixar, resumo.ano);
    }
  }

  async function baixarImagem(botao, ano) {
    if (typeof html2canvas === 'undefined') {
      Util.toast('Biblioteca de imagem não carregada. Tente recarregar a página.', 'warning');
      return;
    }
    const textoOriginal = botao.innerHTML;
    botao.disabled = true;
    botao.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Gerando...';

    try {
      const cartao = document.getElementById('retrospectiva-cartao');
      const canvas = await html2canvas(cartao, { backgroundColor: null, scale: 2, useCORS: true, allowTaint: true });
      canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `retrospectiva-leitura-${ano}.png`;
        a.click();
        URL.revokeObjectURL(url);
        Util.toast('Imagem baixada!', 'success');
      }, 'image/png');
    } catch (e) {
      console.error(e);
      Util.toast('Erro ao gerar imagem.', 'danger');
    } finally {
      botao.disabled = false;
      botao.innerHTML = textoOriginal;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init };
})();
