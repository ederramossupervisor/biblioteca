/**
 * Grupos de botões com ícone (Humor, Clima) que substituem selects comuns.
 * Cada grupo é uma <div class="grupo-icones-opcoes" data-alvo="ID"> com
 * botões <button class="btn-icone-opcao" data-valor="...">, e guarda o
 * valor escolhido num <input type="hidden" id="ID"> logo depois — assim o
 * resto do código (js/leitura.js) continua lendo o valor exatamente do
 * mesmo jeito que lia de um <select>, sem precisar mudar nada lá.
 */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-icone-opcao');
  if (!btn) return;
  const grupo = btn.closest('[data-alvo]');
  if (!grupo) return;
  const campo = document.getElementById(grupo.dataset.alvo);
  if (!campo) return;

  const jaEstavaAtivo = btn.classList.contains('active');
  grupo.querySelectorAll('.btn-icone-opcao').forEach(b => b.classList.remove('active'));

  if (jaEstavaAtivo) {
    // Clicar de novo no mesmo botão desmarca (opcional, mas evita ficar
    // "preso" numa opção se a pessoa mudar de ideia).
    campo.value = '';
  } else {
    btn.classList.add('active');
    campo.value = btn.dataset.valor;
  }
});

// Usado quando o valor do campo escondido é definido por código (ex.: ao
// carregar uma sessão existente pra editar) — sincroniza qual botão fica
// "aceso" com o valor atual do campo.
function sincronizarGrupoIcones(idAlvo) {
  const campo = document.getElementById(idAlvo);
  const grupo = document.querySelector(`[data-alvo="${idAlvo}"]`);
  if (!campo || !grupo) return;
  grupo.querySelectorAll('.btn-icone-opcao').forEach(b => {
    b.classList.toggle('active', b.dataset.valor === campo.value);
  });
}
window.sincronizarGrupoIcones = sincronizarGrupoIcones;
