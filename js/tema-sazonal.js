/**
 * Módulo de Tema Sazonal Automático
 * Ajusta a cor primária com base na hora do dia — dentro da mesma
 * família de tons da paleta do app (musgo), não mais cores avulsas
 * que brigavam com o resto da interface.
 *
 * Respeita o toggle "cor automática por horário" definido em
 * Configurações: se o usuário desligar, este módulo não mexe mais
 * em --primary (a cor manual escolhida prevalece).
 */
const TemaSazonal = (() => {
  function corAutomaticaAtiva() {
    return Util.getPreference('corAutomatica', true);
  }

  function aplicarCorPorHora() {
    if (!corAutomaticaAtiva()) return;

    const hora = new Date().getHours();
    let corPrimaria;
    if (hora >= 5 && hora < 12) {
      // Manhã: musgo mais claro
      corPrimaria = '#7A8B72';
    } else if (hora >= 12 && hora < 18) {
      // Tarde: musgo padrão do app
      corPrimaria = '#5C6B5A';
    } else {
      // Noite: musgo mais profundo
      corPrimaria = '#46543F';
    }
    document.documentElement.style.setProperty('--primary', corPrimaria);
  }

  // Atualiza a cada minuto (caso a hora mude)
  setInterval(aplicarCorPorHora, 60000);
  aplicarCorPorHora(); // aplica imediatamente

  return { aplicarCorPorHora };
})();
