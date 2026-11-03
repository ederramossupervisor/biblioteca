/**
 * Mapa de locais de leitura (MapLibre GL).
 *  - Marcadores com a capa do último livro (ou a inicial do local); o tamanho cresce com o uso.
 *  - Pontos muito próximos viram uma bolinha com a quantidade e se abrem ao dar zoom.
 *  - Locais sem posição aparecem numa lista, com "Marcar no mapa": tocar no mapa, buscar um
 *    endereço ou usar a localização atual. O pino pode ser arrastado antes de salvar.
 *  - Filtros por período e por livro; ranking dos locais ao lado.
 * As coordenadas continuam guardadas nas configurações (local_coord_<nome>) como antes.
 */
const MapaLeitura = (() => {
  const CENTRO_BRASIL = [-47.8822, -15.7934]; // [lng, lat]
  const ESTILO_CLARO = 'https://tiles.openfreemap.org/styles/liberty';
  const ATRIB_OSM = '&copy; OpenStreetMap contributors';

  // Estilos "raster" simples: usados no modo escuro (CARTO Dark Matter) e como reserva se o
  // estilo claro não carregar.
  const ESTILO_ESCURO = {
    version: 8,
    sources: { base: { type: 'raster', tileSize: 256, maxzoom: 19, attribution: ATRIB_OSM + ' &copy; CARTO',
      tiles: ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`) } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }]
  };
  const ESTILO_RESERVA = {
    version: 8,
    sources: { base: { type: 'raster', tileSize: 256, maxzoom: 19, attribution: ATRIB_OSM,
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.openstreetmap.org/{z}/{x}/{y}.png`) } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }]
  };

  const CORES_AVATAR = ['#5C6B5A', '#7A8B5E', '#8B4A3D', '#B79C6B', '#46543F'];
  const DISTANCIA_AGRUPAR_PX = 46;

  let mapa = null;
  let dados = { sessoes: [], livros: [] };
  let configs = {};
  let locais = [];          // agregados com o filtro atual
  let marcadoresDOM = [];   // { marker, locais: [...] }
  let posicionando = null;  // { nome, marker, coord:[lng,lat] }
  let ligado = false;
  let estiloReservaUsado = false;

  // ---------- utilitários ----------
  const el = (id) => document.getElementById(id);
  const esc = (t) => Util.escapeHTML(String(t == null ? '' : t));
  const escuro = () => document.body.classList.contains('dark-mode');
  const chaveCoord = (nome) => 'local_coord_' + nome.replace(/\s+/g, '_');

  function corAvatar(texto) {
    let soma = 0;
    for (let i = 0; i < (texto || '').length; i++) soma += texto.charCodeAt(i);
    return CORES_AVATAR[soma % CORES_AVATAR.length];
  }

  function lerCoord(nome) {
    const bruto = configs[chaveCoord(nome)];
    if (!bruto) return null;
    const [lat, lng] = String(bruto).split(',').map(Number);
    return (isNaN(lat) || isNaN(lng)) ? null : [lng, lat];
  }

  // ---------- dados ----------
  function dentroDoPeriodo(dataStr, periodo) {
    if (periodo === 'todos' || !dataStr) return true;
    const d = new Date(String(dataStr).slice(0, 10) + 'T12:00:00');
    if (isNaN(d.getTime())) return true;
    const hoje = new Date();
    if (periodo === 'ano') return d.getFullYear() === hoje.getFullYear();
    const dias = Number(periodo);
    return (hoje - d) / 86400000 <= dias;
  }

  function agregar() {
    const periodo = el('mapa-filtro-periodo') ? el('mapa-filtro-periodo').value : 'todos';
    const livroId = el('mapa-filtro-livro') ? el('mapa-filtro-livro').value : '';
    const livrosPorId = {};
    dados.livros.forEach((l) => { livrosPorId[l.id] = l; });

    const mapaLocais = {};
    dados.sessoes.forEach((s) => {
      if (livroId && s.livroId !== livroId) return;
      if (!dentroDoPeriodo(s.data, periodo)) return;
      const l = mapaLocais[s.local] || (mapaLocais[s.local] = { nome: s.local, sessoes: 0, paginas: 0, minutos: 0, livros: new Set(), ultimaData: '', ultimoLivroId: null });
      l.sessoes++; l.paginas += s.paginas; l.minutos += s.minutos;
      if (s.livroId) l.livros.add(s.livroId);
      if (!l.ultimaData || String(s.data) >= l.ultimaData) { l.ultimaData = String(s.data); l.ultimoLivroId = s.livroId; }
    });

    locais = Object.values(mapaLocais).map((l) => {
      const livro = livrosPorId[l.ultimoLivroId] || { titulo: '', capa: '' };
      return { nome: l.nome, sessoes: l.sessoes, paginas: l.paginas, minutos: l.minutos, horas: (l.minutos / 60).toFixed(1),
        livrosUnicos: l.livros.size, ultimoLivro: livro.titulo, capa: livro.capa, coord: lerCoord(l.nome) };
    }).sort((a, b) => b.paginas - a.paginas);
  }

  async function carregar(forcarRede, enquadrarMapa = true) {
    try {
      dados = await API.enviar({ acao: 'sessoesDosLocais' });
      configs = (!forcarRede && await DB.obterConfigsCache().catch(() => null)) || null;
      if (!configs) {
        configs = await API.enviar({ acao: 'getConfigs' });
        DB.salvarConfigsCache(configs).catch(() => {});
      }
      configs = configs || {};
      preencherFiltroLivros();
      atualizarTudo(enquadrarMapa);
    } catch (e) {
      console.error('Erro ao carregar mapa:', e);
      Util.toast('Falha ao carregar dados do mapa.', 'danger');
    }
  }

  function preencherFiltroLivros() {
    const sel = el('mapa-filtro-livro');
    if (!sel) return;
    const atual = sel.value;
    const usados = new Set(dados.sessoes.map((s) => s.livroId));
    sel.innerHTML = '<option value="">Todos os livros</option>' + dados.livros
      .filter((l) => usados.has(l.id)).sort((a, b) => a.titulo.localeCompare(b.titulo))
      .map((l) => `<option value="${esc(l.id)}">${esc(l.titulo)}</option>`).join('');
    sel.value = atual;
  }

  // ---------- marcadores ----------
  function tamanhoPara(l) {
    const max = Math.max(...locais.map((x) => x.sessoes), 1);
    return Math.round(30 + 26 * Math.sqrt(l.sessoes / max));
  }

  function popupHtml(l) {
    return `<div style="text-align:center;min-width:150px;">
      ${l.capa ? `<img src="${esc(l.capa)}" alt="Capa" loading="lazy" style="width:50px;height:70px;object-fit:cover;border-radius:4px;margin-bottom:5px;">` : ''}
      <strong>${esc(l.nome)}</strong><br><hr class="my-1">
      <i class="fas fa-book-open"></i> Sessões: ${l.sessoes}<br>
      <i class="fas fa-file-alt"></i> Páginas: ${l.paginas}<br>
      <i class="fas fa-clock"></i> Horas: ${l.horas}<br>
      <i class="fas fa-layer-group"></i> Livros diferentes: ${l.livrosUnicos}
      ${l.ultimoLivro ? `<br><small><i class="fas fa-bookmark"></i> Último: ${esc(l.ultimoLivro)}</small>` : ''}</div>`;
  }

  function elementoLocal(l) {
    const t = tamanhoPara(l);
    const d = document.createElement('div');
    if (l.capa) {
      d.className = 'mapa-marcador';
      d.style.width = Math.round(t * 0.78) + 'px';
      d.style.height = t + 'px';
      d.style.backgroundImage = `url("${String(l.capa).replace(/"/g, '%22')}")`;
    } else {
      d.className = 'mapa-avatar';
      d.style.width = d.style.height = t + 'px';
      d.style.fontSize = Math.round(t * 0.45) + 'px';
      d.style.background = corAvatar(l.nome);
      d.textContent = (l.nome || '?').trim().charAt(0).toUpperCase();
    }
    d.title = l.nome;
    return d;
  }

  // Junta, de forma simples, os pontos que estão a menos de DISTANCIA_AGRUPAR_PX uns dos outros.
  function agrupar(comCoord) {
    const pontos = comCoord.map((l) => ({ l, p: mapa.project(l.coord) }));
    const usados = new Set();
    const grupos = [];
    pontos.forEach((a, i) => {
      if (usados.has(i)) return;
      const grupo = [a.l];
      usados.add(i);
      pontos.forEach((b, j) => {
        if (usados.has(j)) return;
        if (Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) < DISTANCIA_AGRUPAR_PX) { grupo.push(b.l); usados.add(j); }
      });
      grupos.push(grupo);
    });
    return grupos;
  }

  function desenharMarcadores() {
    if (!mapa) return;
    marcadoresDOM.forEach((m) => m.marker.remove());
    marcadoresDOM = [];

    const comCoord = locais.filter((l) => l.coord);
    agrupar(comCoord).forEach((grupo) => {
      if (grupo.length === 1) {
        const l = grupo[0];
        const popup = new maplibregl.Popup({ offset: 24, maxWidth: '260px' }).setHTML(popupHtml(l));
        const marker = new maplibregl.Marker({ element: elementoLocal(l) }).setLngLat(l.coord).setPopup(popup).addTo(mapa);
        marcadoresDOM.push({ marker, locais: [l] });
      } else {
        const lng = grupo.reduce((s, l) => s + l.coord[0], 0) / grupo.length;
        const lat = grupo.reduce((s, l) => s + l.coord[1], 0) / grupo.length;
        const d = document.createElement('div');
        d.className = 'mapa-cluster';
        d.style.width = d.style.height = '44px';
        d.textContent = grupo.length;
        d.title = grupo.map((l) => l.nome).join(', ');
        d.addEventListener('click', () => {
          const b = new maplibregl.LngLatBounds();
          grupo.forEach((l) => b.extend(l.coord));
          mapa.fitBounds(b, { padding: 80, maxZoom: 17, duration: 600 });
        });
        const marker = new maplibregl.Marker({ element: d }).setLngLat([lng, lat]).addTo(mapa);
        marcadoresDOM.push({ marker, locais: grupo });
      }
    });
  }

  function enquadrar() {
    const pts = locais.filter((l) => l.coord);
    if (!pts.length) { mapa.jumpTo({ center: CENTRO_BRASIL, zoom: 3.5 }); return; }
    if (pts.length === 1) { mapa.jumpTo({ center: pts[0].coord, zoom: 13 }); return; }
    const b = new maplibregl.LngLatBounds();
    pts.forEach((l) => b.extend(l.coord));
    mapa.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
  }

  // ---------- listas (ranking e locais sem posição) ----------
  function desenharListas() {
    const pend = locais.filter((l) => !l.coord);
    const boxPend = el('mapa-pendentes');
    if (boxPend) {
      boxPend.hidden = pend.length === 0;
      boxPend.innerHTML = pend.length
        ? `<h6 class="fw-bold mb-2"><i class="fas fa-map-pin me-1"></i>Locais sem posição no mapa</h6>` + pend.map((l) =>
          `<div class="mapa-pendente"><span><b>${esc(l.nome)}</b> <small class="text-muted">· ${l.sessoes} sessão(ões)</small></span>
            <button type="button" class="btn btn-sm btn-primary text-nowrap" data-marcar="${esc(l.nome)}">Marcar no mapa</button></div>`).join('')
        : '';
    }

    const box = el('mapa-ranking');
    if (!box) return;
    const comPos = locais.filter((l) => l.coord);
    if (!locais.length) { box.innerHTML = '<div class="text-muted small">Nenhuma sessão com local neste filtro.</div>'; return; }
    box.innerHTML = locais.map((l, i) => `<div class="mapa-rank-item">
        <span class="mapa-rank-pos">${i + 1}</span>
        <div class="mapa-rank-nome" ${l.coord ? `data-ir="${esc(l.nome)}"` : ''}>
          <div class="fw-bold">${esc(l.nome)}</div>
          <div class="small text-muted">${l.sessoes} sessão(ões) · ${l.paginas} págs. · ${l.horas} h</div>
        </div>
        <button type="button" class="btn btn-outline-secondary btn-sm text-nowrap" data-marcar="${esc(l.nome)}">${l.coord ? 'Reposicionar' : 'Marcar'}</button>
      </div>`).join('');
    if (!comPos.length) box.insertAdjacentHTML('afterbegin', '<div class="small text-muted mb-2">Nenhum local tem posição ainda — use “Marcar” para colocá-los no mapa.</div>');
  }

  function atualizarTudo(enquadrarMapa) {
    agregar();
    desenharListas();
    if (mapa) {
      desenharMarcadores();
      if (enquadrarMapa) enquadrar();
    }
  }

  // ---------- posicionar um local ----------
  function iniciarPosicionamento(nome) {
    cancelarPosicionamento();
    const coordAtual = lerCoord(nome);
    posicionando = { nome, marker: null, coord: null };
    el('mapa-modo').hidden = false;
    el('mapa-modo-titulo').textContent = `Posicionar: ${nome}`;
    el('mapa-resultados-busca').innerHTML = '';
    el('mapa-busca').value = '';
    el('mapa-btn-salvar-pos').disabled = true;
    mapa.getCanvas().style.cursor = 'crosshair';
    if (coordAtual) { colocarPino(coordAtual); mapa.flyTo({ center: coordAtual, zoom: Math.max(mapa.getZoom(), 14) }); }
    el('mapa-modo').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function colocarPino(coord) {
    if (!posicionando) return;
    posicionando.coord = coord;
    if (!posicionando.marker) {
      posicionando.marker = new maplibregl.Marker({ draggable: true, color: '#d6336c' }).setLngLat(coord).addTo(mapa);
      posicionando.marker.on('dragend', () => {
        const p = posicionando.marker.getLngLat();
        posicionando.coord = [p.lng, p.lat];
      });
    } else {
      posicionando.marker.setLngLat(coord);
    }
    el('mapa-btn-salvar-pos').disabled = false;
  }

  function cancelarPosicionamento() {
    if (posicionando && posicionando.marker) posicionando.marker.remove();
    posicionando = null;
    const modo = el('mapa-modo');
    if (modo) modo.hidden = true;
    if (mapa) mapa.getCanvas().style.cursor = '';
  }

  async function salvarPosicionamento() {
    if (!posicionando || !posicionando.coord) return;
    const [lng, lat] = posicionando.coord;
    const nome = posicionando.nome;
    try {
      await API.enviar({ acao: 'salvarCoordenadaLocal', local: nome, coordenada: `${lat.toFixed(6)},${lng.toFixed(6)}` });
      cancelarPosicionamento();
      Util.toast(`Posição de “${esc(nome)}” salva.`, 'success');
      try {
        const novas = await API.enviar({ acao: 'getConfigs' });
        if (novas && !novas.erro) await DB.salvarConfigsCache(novas);
      } catch (e) { /* o cache é só otimização */ }
      window.dispatchEvent(new CustomEvent('calixteca:configs-atualizadas'));
    } catch (e) {
      Util.toast('Não foi possível salvar a posição.', 'danger');
    }
  }

  async function buscarEndereco() {
    const q = el('mapa-busca').value.trim();
    const caixa = el('mapa-resultados-busca');
    if (q.length < 3) { caixa.innerHTML = '<div class="small text-muted">Digite pelo menos 3 letras.</div>'; return; }
    caixa.innerHTML = '<div class="small text-muted">Buscando…</div>';
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=pt-BR&q=' + encodeURIComponent(q));
      const lista = await r.json();
      if (!Array.isArray(lista) || !lista.length) { caixa.innerHTML = '<div class="small text-muted">Nada encontrado. Tente incluir a cidade.</div>'; return; }
      caixa.innerHTML = lista.map((x, i) => `<button type="button" class="mapa-resultado-busca" data-res="${i}">${esc(x.display_name)}</button>`).join('');
      caixa._resultados = lista;
    } catch (e) {
      caixa.innerHTML = '<div class="small text-danger">Não foi possível buscar agora.</div>';
    }
  }

  function usarMinhaLocalizacao() {
    if (!navigator.geolocation) { Util.toast('Seu aparelho não informa a localização.', 'warning'); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      const c = [pos.coords.longitude, pos.coords.latitude];
      colocarPino(c);
      mapa.flyTo({ center: c, zoom: 16 });
    }, () => Util.toast('Não consegui obter sua localização (verifique a permissão do navegador).', 'warning'), { enableHighAccuracy: true, timeout: 15000 });
  }

  function irParaLocal(nome) {
    const l = locais.find((x) => x.nome === nome);
    if (!l || !l.coord) return;
    el('mapa-locais').scrollIntoView({ behavior: 'smooth', block: 'center' });
    mapa.once('moveend', () => {
      const m = marcadoresDOM.find((x) => x.locais.length === 1 && x.locais[0].nome === nome);
      if (m && !m.marker.getPopup().isOpen()) m.marker.togglePopup();
    });
    mapa.flyTo({ center: l.coord, zoom: Math.max(mapa.getZoom(), 15) });
  }

  // ---------- inicialização ----------
  function criarMapa() {
    mapa = new maplibregl.Map({
      container: 'mapa-locais',
      style: escuro() ? ESTILO_ESCURO : ESTILO_CLARO,
      center: CENTRO_BRASIL,
      zoom: 3.5,
      attributionControl: { compact: true }
    });
    mapa.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    mapa.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    // Se o estilo moderno não carregar (serviço fora do ar, rede ruim), cai para o mapa simples.
    mapa.on('error', (ev) => {
      if (estiloReservaUsado || escuro()) return;
      const msg = String((ev && ev.error && ev.error.message) || '');
      if (!mapa.isStyleLoaded() && /style|fetch|Failed|Not Found|NetworkError/i.test(msg)) {
        estiloReservaUsado = true;
        mapa.setStyle(ESTILO_RESERVA);
      }
    });

    // Os grupos só mudam com o zoom (a distância é em pixels); assim o balão aberto não fecha ao arrastar o mapa.
    mapa.on('zoomend', desenharMarcadores);
    mapa.on('click', (ev) => { if (posicionando) colocarPino([ev.lngLat.lng, ev.lngLat.lat]); });
  }

  function ligarEventos() {
    el('mapa-filtro-periodo').addEventListener('change', () => atualizarTudo(true));
    el('mapa-filtro-livro').addEventListener('change', () => atualizarTudo(true));
    el('btn-atualizar-mapa').addEventListener('click', () => carregar(true));
    el('mapa-btn-buscar').addEventListener('click', buscarEndereco);
    el('mapa-busca').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscarEndereco(); } });
    el('mapa-btn-gps').addEventListener('click', usarMinhaLocalizacao);
    el('mapa-btn-salvar-pos').addEventListener('click', salvarPosicionamento);
    el('mapa-btn-cancelar-pos').addEventListener('click', cancelarPosicionamento);

    el('mapa-resultados-busca').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-res]');
      if (!b) return;
      const r = el('mapa-resultados-busca')._resultados[Number(b.dataset.res)];
      const c = [Number(r.lon), Number(r.lat)];
      colocarPino(c);
      mapa.flyTo({ center: c, zoom: 16 });
      el('mapa-resultados-busca').innerHTML = '';
    });

    const area = el('mapa-ranking').closest('.card');
    area.addEventListener('click', (ev) => {
      const marcar = ev.target.closest('[data-marcar]');
      if (marcar) { iniciarPosicionamento(marcar.dataset.marcar); return; }
      const ir = ev.target.closest('[data-ir]');
      if (ir) irParaLocal(ir.dataset.ir);
    });

    window.addEventListener('calixteca:tema-alterado', () => {
      if (mapa) mapa.setStyle(escuro() ? ESTILO_ESCURO : ESTILO_CLARO);
    });
    // Coordenada nova salva em Configurações (ou aqui): descarta o cache local e recarrega.
    window.addEventListener('calixteca:configs-atualizadas', () => carregar(true, false));
  }

  async function init() {
    if (!el('mapa-locais') || typeof maplibregl === 'undefined') return;
    if (!mapa) {
      criarMapa();
    } else {
      mapa.resize();
    }
    if (!ligado) { ligado = true; ligarEventos(); }
    await carregar(false);
  }

  return { init };
})();
