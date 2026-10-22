const OCR = (() => {
  let worker = null;

  async function initWorker() {
    if (worker) return worker;
    worker = await Tesseract.createWorker('por', 1, {
      logger: m => console.log(m)
    });
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç0123456789.,;:!?\'\"-–—()[]{}«»“”‘’/&@#$%*+= \n',
    });
    return worker;
  }

  function preprocessarImagem(imageFile) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        let scale = 1;
        if (img.width < 1000) scale = Math.max(2, Math.ceil(1500 / img.width));
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const contrast = ((gray - 128) * 1.5) + 128;
          const val = Math.min(255, Math.max(0, contrast));
          data[i] = val;
          data[i + 1] = val;
          data[i + 2] = val;
        }
        ctx.putImageData(imageData, 0, 0);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.95);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(imageFile);
    });
  }

  function recortarImagem(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const modalId = 'modal-recorte-ocr-' + Date.now();
        const modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.id = modalId;
        modal.tabIndex = -1;
        modal.innerHTML = `
          <div class="modal-dialog modal-xl modal-dialog-centered">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Recortar área do texto</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body p-0" style="position:relative; overflow:auto; background:#333; display:flex; justify-content:center;">
                <canvas id="canvas-recorte-${modalId}" style="max-width:100%; cursor:crosshair;"></canvas>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                <button type="button" class="btn btn-primary" id="btn-processar-recorte-${modalId}" disabled>Processar seleção</button>
              </div>
            </div>
          </div>`;
        document.body.appendChild(modal);

        const bsModal = new bootstrap.Modal(modal);
        let recorteResolvido = false;

        modal.addEventListener('hidden.bs.modal', () => {
          // Só remove o modal do DOM se ele ainda existir
          if (modal.parentNode) {
            document.body.removeChild(modal);
          }
          // Se o recorte não foi resolvido (cancelou), rejeita a Promise
          if (!recorteResolvido) {
            reject(new Error('Recorte cancelado'));
          }
        });

        bsModal.show();

        const canvas = document.getElementById(`canvas-recorte-${modalId}`);
        const ctx = canvas.getContext('2d');
        const maxWidth = window.innerWidth * 0.9;
        const maxHeight = window.innerHeight * 0.7;
        let drawWidth = img.width;
        let drawHeight = img.height;
        if (drawWidth > maxWidth) {
          const ratio = maxWidth / drawWidth;
          drawWidth = maxWidth;
          drawHeight = img.height * ratio;
        }
        if (drawHeight > maxHeight) {
          const ratio = maxHeight / drawHeight;
          drawHeight = maxHeight;
          drawWidth = drawWidth * ratio;
        }
        canvas.width = drawWidth;
        canvas.height = drawHeight;
        ctx.drawImage(img, 0, 0, drawWidth, drawHeight);

        let startX, startY, endX, endY;
        let drawing = false;

        function getPos(e) {
          const rect = canvas.getBoundingClientRect();
          const scaleX = drawWidth / rect.width;
          const scaleY = drawHeight / rect.height;
          let clientX, clientY;
          if (e.touches) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
          } else {
            clientX = e.clientX;
            clientY = e.clientY;
          }
          return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
          };
        }

        function drawRect() {
          ctx.clearRect(0, 0, drawWidth, drawHeight);
          ctx.drawImage(img, 0, 0, drawWidth, drawHeight);
          if (startX !== undefined && endX !== undefined) {
            const x = Math.min(startX, endX);
            const y = Math.min(startY, endY);
            const w = Math.abs(endX - startX);
            const h = Math.abs(endY - startY);
            ctx.fillStyle = 'rgba(0,150,255,0.3)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = '#0096ff';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
          }
        }

        function start(e) {
          e.preventDefault();
          const pos = getPos(e);
          startX = pos.x;
          startY = pos.y;
          endX = pos.x;
          endY = pos.y;
          drawing = true;
        }

        function move(e) {
          if (!drawing) return;
          e.preventDefault();
          const pos = getPos(e);
          endX = pos.x;
          endY = pos.y;
          drawRect();
        }

        function stop(e) {
          if (!drawing) return;
          drawing = false;
          document.getElementById(`btn-processar-recorte-${modalId}`).disabled = false;
        }

        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        canvas.addEventListener('mouseup', stop);
        canvas.addEventListener('touchstart', start);
        canvas.addEventListener('touchmove', move);
        canvas.addEventListener('touchend', stop);

        document.getElementById(`btn-processar-recorte-${modalId}`).addEventListener('click', () => {
          const x = Math.min(startX, endX);
          const y = Math.min(startY, endY);
          const w = Math.abs(endX - startX);
          const h = Math.abs(endY - startY);
          if (w < 10 || h < 10) {
            Util.toast('Selecione uma área maior.', 'warning');
            return;
          }
          const recorteCanvas = document.createElement('canvas');
          recorteCanvas.width = w;
          recorteCanvas.height = h;
          const recorteCtx = recorteCanvas.getContext('2d');
          recorteCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
          recorteCanvas.toBlob(blob => {
            recorteResolvido = true;
            bsModal.hide();
            resolve(blob);
          }, 'image/jpeg', 0.95);
        });
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function capturarECapturarTexto(targetElement) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();

    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) {
        document.body.removeChild(input);
        return;
      }

      Util.toast('Recorte a área do texto desejada.', 'info');
      const btn = document.querySelector('#btn-ocr-sessao, #btn-ocr');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Aguardando recorte...';
      }

      try {
        const recorteBlob = await recortarImagem(file);
        
        Util.toast('Reconhecendo texto... Isso pode levar alguns segundos.', 'info');
        if (btn) btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Processando...';

        const processedBlob = await preprocessarImagem(recorteBlob);
        const w = await initWorker();
        const { data: { text } } = await w.recognize(processedBlob);
        
        let textoLimpo = text.trim()
          .replace(/\n{3,}/g, '\n\n')
          .replace(/[ \t]+/g, ' ')
          .replace(/([a-z])- ([a-z])/g, '$1$2')
          .replace(/[\u2018\u2019]/g, "'")
          .replace(/[\u201C\u201D]/g, '"')
          .replace(/\u2013|\u2014/g, '-')
          .replace(/\u00B4/g, "'")
          .replace(/\u0060/g, "'");

        if (targetElement && targetElement.tagName === 'TEXTAREA') {
          abrirModalEdicaoOCR(textoLimpo, targetElement);
        } else {
          const destino = targetElement || document.getElementById('citacao-texto');
          if (destino) {
            if (destino.tagName === 'TEXTAREA' || destino.tagName === 'INPUT') {
              destino.value = textoLimpo;
            } else {
              destino.textContent = `"${textoLimpo}"`;
            }
          }
        }
        Util.toast('Texto capturado com sucesso!', 'success');
      } catch (erro) {
        console.error('Erro no OCR:', erro);
        if (erro.message !== 'Recorte cancelado') {
          Util.toast('Falha ao processar a imagem.', 'danger');
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-camera"></i> Escanear página';
        }
        document.body.removeChild(input);
      }
    });
  }

  function abrirModalEdicaoOCR(texto, targetTextarea) {
    const modalElement = document.getElementById('modal-ocr-edicao');
    const textarea = document.getElementById('ocr-texto-editavel');
    if (!modalElement || !textarea) {
      targetTextarea.value = texto;
      return;
    }
    textarea.value = texto;
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
    const btnConfirmar = document.getElementById('btn-confirmar-ocr');
    const handler = () => {
      targetTextarea.value = textarea.value;
      modal.hide();
      btnConfirmar.removeEventListener('click', handler);
    };
    btnConfirmar.addEventListener('click', handler);
    modalElement.addEventListener('hidden.bs.modal', () => targetTextarea.focus(), { once: true });
  }

  return { capturarECapturarTexto };
})();
