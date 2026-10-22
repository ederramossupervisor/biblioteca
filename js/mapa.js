const MapaLeitura = (() => {
  let mapa = null;
  let marcadores = [];
  let tileClaro = null;
  let tileEscuro = null;

  // Cores usadas para o "avatar" de inicial quando o livro não tem capa —
  // mesma paleta musgo do resto do app.
  const CORES_AVATAR = ['#5C6B5A', '#7A8B5E', '#8B4A3D', '#B79C6B', '#46543F'];

  function corAvatarPara(texto) {
    if (!texto) return CORES_AVATAR[0];
    let soma = 0;
    for (let i = 0; i < texto.length; i++) soma += texto.charCodeAt(i);
    return CORES_AVATAR[soma % CORES_AVATAR.length];
  }

  function temaEscuroAtivo() {
    return document.body.classList.contains('dark-mode');
  }

  function aplicarTileConformeTema() {
    if (!mapa || !tileClaro || !tileEscuro) return;
    if (temaEscuroAtivo()) {
      if (mapa.hasLayer(tileClaro)) mapa.removeLayer(tileClaro);
      if (!mapa.hasLayer(tileEscuro)) tileEscuro.addTo(mapa);
    } else {
      if (mapa.hasLayer(tileEscuro)) mapa.removeLayer(tileEscuro);
      if (!mapa.hasLayer(tileClaro)) tileClaro.addTo(mapa);
    }
  }

  async function init() {
    const container = document.getElementById('mapa-locais');
    if (!container) return;

    if (!mapa) {
      mapa = L.map('mapa-locais').setView([-15.7934, -47.8822], 4);

      tileClaro = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      });
      // Variante escura (CartoDB Dark Matter, gratuita) — usada quando o app
      // está em modo escuro, pra não ficar um mapa branco ofuscante no meio
      // de uma tela escura.
      tileEscuro = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
      });

      aplicarTileConformeTema();

      window.addEventListener('calixteca:tema-alterado', aplicarTileConformeTema);
      // Coordenada nova salva em Configurações: descarta o cache local e recarrega.
      window.addEventListener('calixteca:configs-atualizadas', () => carregarLocaisNoMapa(true));
    }

    // Mostra o que já tiver em cache local imediatamente (stale-while-revalidate);
    // só então busca a versão atual da rede e atualiza se for diferente.
    await carregarLocaisNoMapa(false);

    document.getElementById('btn-atualizar-mapa')?.addEventListener('click', () => carregarLocaisNoMapa(true));
  }

  async function carregarLocaisNoMapa(forcarRede) {
    try {
      const locais = await API.enviar({ acao: 'listarLocais' });
      if (!Array.isArray(locais)) throw new Error('Resposta inválida');

      let configs = forcarRede ? null : await DB.obterConfigsCache().catch(() => null);
      let usandoCache = !!configs;

      if (!configs) {
        configs = await API.enviar({ acao: 'getConfigs' });
        DB.salvarConfigsCache(configs).catch(() => {});
      } else {
        // Atualiza o cache em segundo plano para a próxima abertura, sem
        // bloquear a renderização com o que já temos agora.
        API.enviar({ acao: 'getConfigs' })
          .then(frescas => { if (frescas && !frescas.erro) DB.salvarConfigsCache(frescas).catch(() => {}); })
          .catch(() => {});
      }

      renderizarMarcadores(locais, configs);

      if (usandoCache) {
        // Silencioso — a versão de rede, se diferente, só reflete na próxima
        // renderização (próxima visita à tela ou clique em "Atualizar").
      }
    } catch (erro) {
      console.error('Erro ao carregar mapa:', erro);
      Util.toast('Falha ao carregar dados do mapa.', 'danger');
    }
  }

  function renderizarMarcadores(locais, configs) {
    marcadores.forEach(m => mapa.removeLayer(m));
    marcadores = [];

    for (const local of locais) {
      const chave = `local_coord_${local.local.replace(/\s+/g, '_')}`;
      const coordenadaStr = configs[chave];
      if (!coordenadaStr) continue;

      const [lat, lng] = coordenadaStr.split(',').map(Number);
      if (isNaN(lat) || isNaN(lng)) continue;

      const nomeLocalSeguro = Util.escapeHTML(local.local);
      const ultimoLivroSeguro = Util.escapeHTML(local.ultimoLivro || '');

      const popupHtml = `
        <div style="text-align:center;">
          ${local.ultimaCapa ? `<img src="${local.ultimaCapa}" alt="Capa" loading="lazy" style="width:50px; height:70px; object-fit:cover; border-radius:4px; margin-bottom:5px;">` : ''}
          <strong>${nomeLocalSeguro}</strong><br>
          <hr class="my-1">
          <i class="fas fa-book-open"></i> Sessões: ${local.sessoes}<br>
          <i class="fas fa-file-alt"></i> Páginas: ${local.paginas}<br>
          <i class="fas fa-clock"></i> Horas: ${local.horas}<br>
          <i class="fas fa-layer-group"></i> Livros diferentes: ${local.livrosUnicos}
          ${ultimoLivroSeguro ? `<br><small><i class="fas fa-bookmark"></i> Último: ${ultimoLivroSeguro}</small>` : ''}
        </div>
      `;

      let marker;
      if (local.ultimaCapa) {
        const icone = L.icon({
          iconUrl: local.ultimaCapa,
          iconSize: [26, 34],
          iconAnchor: [13, 34],
          popupAnchor: [0, -34],
          className: 'icone-capa-marcador'
        });
        marker = L.marker([lat, lng], { icon: icone }).addTo(mapa);
      } else {
        // Sem capa: em vez do ícone genérico de livro, usa um "avatar" com
        // a inicial do local (mais fácil de diferenciar num mapa com vários
        // marcadores do que um monte de ícones iguais).
        const inicial = (local.local || '?').trim().charAt(0).toUpperCase();
        const cor = corAvatarPara(local.local);
        const iconeAvatar = L.divIcon({
          className: 'avatar-marcador-local',
          html: `<div style="background:${cor};">${Util.escapeHTML(inicial)}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          popupAnchor: [0, -15]
        });
        marker = L.marker([lat, lng], { icon: iconeAvatar }).addTo(mapa);
      }

      marker.bindPopup(popupHtml);
      marcadores.push(marker);
    }

    if (marcadores.length > 0) {
      const grupo = L.featureGroup(marcadores);
      mapa.fitBounds(grupo.getBounds().pad(0.1));
    } else {
      mapa.setView([-15.7934, -47.8822], 4);
    }
  }

  return { init };
})();
