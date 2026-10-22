/**
 * Indicador discreto de status de sincronização com o Google Apps Script.
 * Escuta o evento 'api:status' disparado pelo api.js e os eventos nativos
 * online/offline do navegador, e atualiza qualquer elemento marcado com
 * [data-sync-status] na página.
 */
const SyncStatus = (() => {
  const ESTADOS = {
    sincronizado: { texto: 'Sincronizado', icone: 'fa-check-circle', classe: 'text-success' },
    salvando: { texto: 'Salvando...', icone: 'fa-sync-alt fa-spin', classe: 'text-muted' },
    offline: { texto: 'Offline, tentando de novo', icone: 'fa-exclamation-triangle', classe: 'text-warning' },
    erro: { texto: 'Erro ao sincronizar', icone: 'fa-exclamation-circle', classe: 'text-danger' }
  };

  function atualizar(status, mostrarToast = true) {
    const info = ESTADOS[status] || ESTADOS.sincronizado;
    document.querySelectorAll('[data-sync-status]').forEach(el => {
      el.dataset.syncStatus = status;
      el.title = info.texto;
      const icone = el.querySelector('.sync-status-icon');
      const texto = el.querySelector('.sync-status-text');
      if (icone) icone.className = `sync-status-icon fas ${info.icone} ${info.classe}`;
      if (texto) texto.textContent = info.texto;
    });

    // Toast temporário ao lado do ícone da sidebar (desktop): aparece só
    // quando o status muda de verdade e some sozinho depois de um tempo,
    // em vez de ocupar espaço fixo o tempo todo.
    if (mostrarToast) {
      const toast = document.querySelector('.sidebar-sync-toast');
      if (toast) {
        toast.textContent = info.texto;
        toast.classList.add('show');
        clearTimeout(toast._timeoutId);
        toast._timeoutId = setTimeout(() => toast.classList.remove('show'), 2500);
      }
    }
  }

  window.addEventListener('api:status', (e) => atualizar(e.detail.status));
  window.addEventListener('offline', () => atualizar('offline'));
  window.addEventListener('online', () => atualizar('sincronizado'));

  atualizar(navigator.onLine === false ? 'offline' : 'sincronizado', false);

  return { atualizar };
})();
