/**
 * Utilitários gerais – Calixteca
 */
const Util = {
  qs: (sel) => document.querySelector(sel),
  qsa: (sel) => document.querySelectorAll(sel),

  escapeHTML: (str) => {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  },

  // Toast notification usando Bootstrap
  toast: (mensagem, tipo = 'info') => {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'position-fixed bottom-0 end-0 p-3';
      container.style.zIndex = '9999';
      document.body.appendChild(container);
    }

    const id = 'toast-' + Date.now();
    const bgClass = {
      success: 'bg-success text-white',
      danger: 'bg-danger text-white',
      warning: 'bg-warning text-dark',
      info: 'bg-info text-dark'
    }[tipo] || 'bg-info text-dark';

    const html = `
      <div id="${id}" class="toast align-items-center border-0 ${bgClass}" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="d-flex">
          <div class="toast-body">${mensagem}</div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Fechar"></button>
        </div>
      </div>`;

    container.insertAdjacentHTML('beforeend', html);
    const toastEl = document.getElementById(id);
    const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
    toast.show();
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
  },

  // Diálogo de confirmação personalizado (substitui o confirm() nativo do navegador)
  // Retorna uma Promise<boolean>: true se confirmado, false se cancelado/fechado.
  confirmar: (mensagem, opcoes = {}) => {
    const {
      titulo = 'Confirmar ação',
      confirmarTexto = 'Confirmar',
      cancelarTexto = 'Cancelar',
      variante = 'primary', // 'primary' | 'danger' | 'warning'
      icone = null // classe Font Awesome opcional (ex.: 'fa-trash'); se omitido, usa a padrão da variante
    } = opcoes;

    return new Promise((resolve) => {
      let modalEl = document.getElementById('util-confirm-modal');
      if (!modalEl) {
        const html = `
          <div class="modal fade" id="util-confirm-modal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered modal-sm">
              <div class="modal-content">
                <div class="modal-body text-center pt-4 pb-2">
                  <div id="util-confirm-icone" class="mx-auto mb-3 d-flex align-items-center justify-content-center" style="width:56px;height:56px;border-radius:50%;">
                    <i class="fas"></i>
                  </div>
                  <h5 id="util-confirm-titulo" class="mb-2"></h5>
                  <p id="util-confirm-mensagem" class="text-secondary mb-0"></p>
                </div>
                <div class="modal-footer border-0 justify-content-center pb-4 pt-0">
                  <button type="button" class="btn btn-outline-secondary px-3" id="util-confirm-cancelar" data-bs-dismiss="modal"></button>
                  <button type="button" class="btn px-3" id="util-confirm-ok"></button>
                </div>
              </div>
            </div>
          </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        modalEl = document.getElementById('util-confirm-modal');
      }

      const iconeWrap = modalEl.querySelector('#util-confirm-icone');
      const iconeEl = iconeWrap.querySelector('i');
      const tituloEl = modalEl.querySelector('#util-confirm-titulo');
      const mensagemEl = modalEl.querySelector('#util-confirm-mensagem');
      const btnCancelar = modalEl.querySelector('#util-confirm-cancelar');
      const btnOk = modalEl.querySelector('#util-confirm-ok');

      const estilos = {
        primary: { bg: 'bg-primary-subtle', texto: 'text-primary-emphasis', btn: 'btn-primary', icone: 'fa-circle-question' },
        danger: { bg: 'bg-danger-subtle', texto: 'text-danger-emphasis', btn: 'btn-danger', icone: 'fa-trash' },
        warning: { bg: 'bg-warning-subtle', texto: 'text-warning-emphasis', btn: 'btn-warning', icone: 'fa-triangle-exclamation' }
      };
      const estilo = estilos[variante] || estilos.primary;

      iconeWrap.className = `mx-auto mb-3 d-flex align-items-center justify-content-center ${estilo.bg} ${estilo.texto}`;
      iconeEl.className = `fas ${icone || estilo.icone}`;
      iconeEl.style.fontSize = '1.4rem';

      tituloEl.textContent = titulo;
      mensagemEl.textContent = mensagem;
      btnCancelar.textContent = cancelarTexto;
      btnOk.textContent = confirmarTexto;
      btnOk.className = `btn px-3 ${estilo.btn}`;

      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

      let resolvido = false;
      const finalizar = (valor) => {
        if (resolvido) return;
        resolvido = true;
        resolve(valor);
      };

      const onOk = () => {
        finalizar(true);
        modal.hide();
      };
      const onHidden = () => {
        finalizar(false);
        btnOk.removeEventListener('click', onOk);
        modalEl.removeEventListener('hidden.bs.modal', onHidden);
      };

      btnOk.addEventListener('click', onOk);
      modalEl.addEventListener('hidden.bs.modal', onHidden);

      modal.show();
    });
  },

  formatDate: (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('pt-BR');
  },

  // ---- Armazenamento local separado por usuário ----
  // Cada conta tem seu próprio "espaço" no localStorage (prefixo com o id do
  // usuário logado, guardado por auth.js em 'leituras_uid'). Assim duas contas
  // no mesmo aparelho nunca enxergam grifos, rascunhos ou preferências uma da outra.
  uidLocal: () => { try { return localStorage.getItem('leituras_uid') || 'anon'; } catch (e) { return 'anon'; } },
  lsKey: (nome) => `u_${Util.uidLocal()}__${nome}`,
  // Lista os nomes (sem o prefixo do usuário) que começam com um prefixo.
  lsNomes: (prefixo) => {
    const base = `u_${Util.uidLocal()}__`;
    const nomes = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(base + prefixo)) nomes.push(k.slice(base.length));
    }
    return nomes;
  },
  lsGet: (nome) => localStorage.getItem(Util.lsKey(nome)),
  lsSet: (nome, valor) => localStorage.setItem(Util.lsKey(nome), valor),
  lsRemove: (nome) => localStorage.removeItem(Util.lsKey(nome)),

  setPreference: (key, value) => Util.lsSet(`leitura_${key}`, JSON.stringify(value)),
  getPreference: (key, def = null) => {
    const val = Util.lsGet(`leitura_${key}`);
    return val ? JSON.parse(val) : def;
  },

  converterLinkDrive: function(url) {
    if (!url) return '';
    const regex = /\/file\/d\/([^/]+)\//;
    const match = url.match(regex);
    if (match && match[1]) {
      return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1000`;
    }
    return url;
  },

  // Extrai a cor média de uma imagem (capa de livro) desenhando ela num
  // canvas pequeno e tirando a média dos pixels — ignora quase-branco/
  // quase-preto (bordas/sombra) pra pegar uma cor mais representativa da
  // capa em si. Resolve com "r, g, b" (pra usar em rgba(...)) ou null se a
  // imagem não puder ser lida (ex.: sem CORS liberado pelo servidor da
  // imagem — falha silenciosa, não deve quebrar a tela).
  //
  // Não define img.crossOrigin: as capas vêm do Google Drive, que nunca
  // libera CORS nesse endpoint de thumbnail — pedir modo CORS só gera erro
  // barulhento no console (imagem chega a falhar o carregamento) sem nunca
  // funcionar. Sem crossOrigin a imagem carrega normalmente para exibição;
  // o canvas fica "manchado" (tainted) e getImageData() lança uma exceção,
  // que já é tratada no catch abaixo — mesmo resultado (sem cor extraída),
  // sem barulho no console.
  extrairCorMedia: function(urlImagem) {
    return new Promise((resolve) => {
      if (!urlImagem) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const tamanho = 40;
          const canvas = document.createElement('canvas');
          canvas.width = tamanho;
          canvas.height = tamanho;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, tamanho, tamanho);
          const dados = ctx.getImageData(0, 0, tamanho, tamanho).data;

          let r = 0, g = 0, b = 0, total = 0;
          for (let i = 0; i < dados.length; i += 4) {
            if (dados[i + 3] < 100) continue; // ignora pixels transparentes
            const luminosidade = (dados[i] + dados[i + 1] + dados[i + 2]) / 3;
            if (luminosidade > 245 || luminosidade < 10) continue; // ignora quase-branco/quase-preto
            r += dados[i]; g += dados[i + 1]; b += dados[i + 2];
            total++;
          }
          if (total === 0) { resolve(null); return; }
          resolve(`${Math.round(r / total)}, ${Math.round(g / total)}, ${Math.round(b / total)}`);
        } catch (e) {
          resolve(null); // canvas "manchado" por CORS — desiste sem quebrar a tela
        }
      };
      img.onerror = () => resolve(null);
      img.src = urlImagem;
    });
  }
};

// Ripple effect global
document.addEventListener('click', function(e) {
  const btn = e.target.closest('.btn');
  if (!btn) return;

  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  btn.appendChild(ripple);

  ripple.addEventListener('animationend', () => ripple.remove());
});
