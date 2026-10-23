// Calixteca – Service Worker v19 (shell completo + cache sob demanda para libs pesadas + cache de imagens/capas)
const CACHE_NAME = 'leituras-v3';
const RUNTIME_CACHE_NAME = 'leituras-runtime-v3';

// App shell: tudo que o app precisa pra funcionar offline logo de cara.
// Instalado eagerly (cache.addAll) — por isso fica restrito a recursos
// essenciais e leves; libs pesadas específicas de uma função ficam de
// fora daqui (ver RUNTIME_PATTERNS) pra não travar a instalação do SW
// se um CDN estiver lento/fora do ar.
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/variables.css',
  './css/layout.css',
  './css/livros.css',
  './css/leitura.css',
  './css/leitor.css',
  './css/dashboard.css',
  './css/biblioteca.css',
  './css/estatisticas.css',
  './css/metas.css',
  './css/anotacoes.css',
  './css/desejos.css',
  './css/exportar.css',
  './css/configuracoes.css',
  './css/retrospectiva.css',
  './css/skeleton.css',
  './css/dark-mode.css',
  './css/splash.css',
  './css/login.css',
  './js/supabase-client.js',
  './js/perfil.js',
  './js/util.js',
  './js/bingo-dados.js',
  './js/seletor-icones.js',
  './js/api.js',
  './js/auth.js',
  './js/db.js',
  './js/fila-offline.js',
  './js/classificacao.js',
  './js/livros.js',
  './js/ocr.js',
  './js/leitura.js',
  './js/dashboard.js',
  './js/biblioteca.js',
  './js/estatisticas.js',
  './js/retrospectiva.js',
  './js/calendario.js',
  './js/mapa.js',
  './js/metas.js',
  './js/anotacoes.js',
  './js/desejos.js',
  './js/exportar.js',
  './js/configuracoes.js',
  './js/tema-sazonal.js',
  './js/sync-status.js',
  './js/lembretes.js',
  './js/busca-global.js',
  './js/leitor.js',
  './js/app.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://unpkg.com/dexie@3.2.4/dist/dexie.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Libs pesadas e usadas só por funções específicas (OCR, leitor de EPUB,
// scanner de código de barras, exportação de imagem, fontes do Google).
// Cacheadas em cache-first assim que forem pedidas pela primeira vez, sem
// entrar no install — evita que o SW inteiro falhe se um desses CDNs
// estiver indisponível no momento da instalação.
const RUNTIME_PATTERNS = [
  '@supabase/supabase-js',
  'tesseract.js',
  'quagga2',
  'html2canvas',
  'jszip',
  'epubjs',
  'open-dyslexic',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// Instalação: força ativação imediata
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Ativação: limpa caches antigos (de qualquer versão) e assume controle de todos os clientes
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME && key !== RUNTIME_CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Interceptação de rede
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = request.url;

  const isShellAsset = ASSETS.includes(url);
  const isFont = url.endsWith('.woff2') || url.endsWith('.woff') || url.endsWith('.ttf');
  // Qualquer requisição de imagem (capas de livro vindas do Google Drive, Google
  // Books, etc.) entra no cache de runtime também — elas não mudam depois de
  // publicadas, então cache-first evita rebaixar a mesma capa toda vez que a
  // Biblioteca/Dashboard é aberta.
  const isImage = request.destination === 'image';
  const isRuntimeAsset = !isShellAsset && (isImage || RUNTIME_PATTERNS.some(padrao => url.includes(padrao)));

  // Qualquer coisa fora do shell/fontes/libs pesadas conhecidas: deixa o
  // navegador buscar normalmente, sem qualquer interferência (ex.: as
  // chamadas pro Google Apps Script nunca passam por aqui).
  if (!isShellAsset && !isFont && !isRuntimeAsset) {
    return;
  }

  const cacheName = isRuntimeAsset ? RUNTIME_CACHE_NAME : CACHE_NAME;

  // Cache-first com atualização em background
  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(cacheName).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached); // fallback offline

      return cached || fetchPromise;
    })
  );
});
