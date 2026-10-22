/**
 * Fila offline — quando uma sessão de leitura é registrada sem conexão, ela
 * fica guardada aqui (IndexedDB) em vez de ser simplesmente recusada. Assim
 * que a internet volta (evento 'online', ou logo ao abrir o app já online
 * com pendências de uma sessão anterior), tudo é enviado pro Apps Script
 * automaticamente, na ordem em que foi criado.
 */
const FilaOffline = (() => {
  let sincronizando = false;

  async function adicionarSessaoPendente(sessao, anotacoes) {
    await DB.adicionarNaFila({ tipo: 'novaSessao', sessao, anotacoes: anotacoes || [] });
    await atualizarContador();
  }

  async function atualizarContador() {
    const total = await DB.contarFila().catch(() => 0);
    document.querySelectorAll('[data-fila-offline-contador]').forEach(el => {
      if (total > 0) {
        el.textContent = total;
        el.classList.remove('d-none');
      } else {
        el.classList.add('d-none');
      }
    });
    window.dispatchEvent(new CustomEvent('calixteca:fila-offline', { detail: { total } }));
    return total;
  }

  async function sincronizar() {
    if (sincronizando || !navigator.onLine) return;
    sincronizando = true;
    let algumSincronizado = false;

    try {
      const itens = await DB.obterFila();
      for (const item of itens) {
        try {
          if (item.tipo === 'novaSessao') {
            const resp = await API.enviar({ acao: 'addSession', sessao: item.sessao });
            if (!resp || resp.status !== 'ok') throw new Error(resp && resp.erro || 'Falha ao sincronizar sessão');
            for (const anot of (item.anotacoes || [])) {
              // Anotação é secundária à sessão — se uma falhar, não trava a
              // fila por causa dela, só segue (a sessão em si já foi salva).
              await API.enviar({ acao: 'addNote', anotacao: anot }).catch(e => {
                console.warn('Falha ao sincronizar anotação da fila:', e);
              });
            }
          }
          await DB.removerDaFila(item.idLocal);
          algumSincronizado = true;
        } catch (e) {
          // Erro real de rede/servidor: para aqui e tenta de novo na próxima
          // vez (não teria por que os itens seguintes darem certo se este
          // acabou de falhar por falta de conexão, por exemplo).
          console.warn('Falha ao sincronizar item da fila offline, tentando depois:', e);
          break;
        }
      }
    } finally {
      sincronizando = false;
      const restantes = await atualizarContador();
      if (algumSincronizado && restantes === 0) {
        Util.toast('Sessões pendentes sincronizadas!', 'success');
        if (typeof Leitura !== 'undefined' && Leitura.recarregarHistorico) {
          Leitura.recarregarHistorico();
        }
      }
    }
  }

  function init() {
    atualizarContador();
    window.addEventListener('online', sincronizar);
    // Se o app abrir já online com pendências de uma visita anterior, tenta
    // sincronizar de cara (sem esperar o evento 'online', que só dispara em
    // transições offline->online, não ao simplesmente carregar a página).
    sincronizar();
    console.log('✅ Módulo Fila Offline pronto.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { adicionarSessaoPendente, sincronizar, atualizarContador };
})();
