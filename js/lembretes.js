/**
 * Lembrete de leitura (Notification API)
 *
 * Escopo desta versão: como o back-end é o Google Apps Script (sem servidor
 * de push), o lembrete só dispara quando o app é aberto — não chega uma
 * notificação sozinha com o app fechado. Ao abrir o app (a partir de um
 * horário razoável do dia), se ainda não foi lido nada hoje, mostra uma
 * notificação local uma única vez por dia.
 */
const Lembretes = (() => {
  const CHAVE_ATIVO = 'lembreteLeituraAtivo';
  const CHAVE_ULTIMO_LEMBRETE = 'ultimoLembreteLeituraData';
  const HORA_MINIMA = 16; // só lembra a partir desse horário

  function ativo() {
    return Util.getPreference(CHAVE_ATIVO, false);
  }

  function jaMostrouHoje() {
    const ultima = Util.getPreference(CHAVE_ULTIMO_LEMBRETE, null);
    if (!ultima) return false;
    return new Date(ultima).toDateString() === new Date().toDateString();
  }

  async function solicitarPermissao() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'default') {
      return Notification.requestPermission();
    }
    return Notification.permission;
  }

  async function verificarLembreteLeitura() {
    if (!('Notification' in window)) return;
    if (!ativo()) return;
    if (Notification.permission !== 'granted') return;
    if (jaMostrouHoje()) return;
    if (new Date().getHours() < HORA_MINIMA) return;

    try {
      const dados = await API.enviar({ acao: 'dashboard' });
      const paginasHoje = dados && !dados.erro ? (dados.paginasHoje || 0) : null;
      if (paginasHoje === 0) {
        new Notification(document.title || 'Leitura', {
          body: 'Você ainda não leu hoje. Que tal alguns minutos agora, pra manter a sequência?',
          icon: 'img/icons/icon-192x192.png'
        });
        Util.setPreference(CHAVE_ULTIMO_LEMBRETE, new Date().toISOString());
      }
    } catch (e) {
      console.warn('Não foi possível checar o lembrete de leitura:', e);
    }
  }

  return { verificarLembreteLeitura, solicitarPermissao, ativo };
})();
