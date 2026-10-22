const Configuracoes = (() => {
  async function init() {
    const page = document.getElementById('page-configuracoes');
    if (!page || !page.classList.contains('active')) return;

    console.log('⚙️ Carregando configurações...');
    await carregarConfiguracoes();
    configurarEventos();
    await carregarInfoSistema();
    await carregarCoordenadas();
    atualizarLembreteBackup();

    // Salvar nova coordenada
    document.getElementById('btn-salvar-coordenada')?.addEventListener('click', async () => {
      const local = document.getElementById('coord-local').value.trim();
      const coordenada = document.getElementById('coord-valor').value.trim();
      if (!local || !coordenada) {
        Util.toast('Preencha ambos os campos.', 'warning');
        return;
      }
      try {
        const resp = await API.enviar({ acao: 'salvarCoordenadaLocal', local, coordenada });
        if (resp && resp.status === 'ok') {
          Util.toast(resp.mensagem || 'Salvo!', 'success');
          document.getElementById('coord-local').value = '';
          document.getElementById('coord-valor').value = '';
          carregarCoordenadas();
          // Avisa quem estiver com o cache de Configuracoes em mãos (ex.: o
          // Mapa de Locais) que uma coordenada nova foi salva, pra não ficar
          // preso ao cache antigo até expirar sozinho.
          try {
            const configsAtuais = await API.enviar({ acao: 'getConfigs' });
            if (configsAtuais && !configsAtuais.erro) {
              await DB.salvarConfigsCache(configsAtuais);
            }
          } catch (e) { /* cache é só uma otimização — sem problema se falhar */ }
          window.dispatchEvent(new CustomEvent('calixteca:configs-atualizadas'));
        }
      } catch (e) {
        Util.toast('Erro ao salvar.', 'danger');
      }
    });

    console.log('✅ Módulo Configurações pronto.');
  }

  async function carregarConfiguracoes() {
    try {
      const config = await API.enviar({ acao: 'getConfigs' });
      if (config && !config.erro) {
        document.getElementById('config-meta-livros').value = config.metaLivrosPadrao || '';
        document.getElementById('config-meta-paginas').value = config.metaPaginasPadrao || '';
        document.getElementById('config-cor').value = config.corPrimaria || '#1a73e8';
        document.getElementById('config-tema').value = config.tema || 'light';

        // Cor automática por horário: liga por padrão (mantém o comportamento
        // já existente) a menos que o usuário já tenha desligado antes.
        const corAutomatica = config.corAutomatica === undefined
          ? true
          : (config.corAutomatica === 'sim' || config.corAutomatica === true);
        const checkboxCorAuto = document.getElementById('config-cor-automatica');
        if (checkboxCorAuto) checkboxCorAuto.checked = corAutomatica;
        document.getElementById('config-cor').disabled = corAutomatica;

        // Espelha localmente pra outros módulos (ex. TemaSazonal) lerem sem
        // precisar bater na API de novo.
        Util.setPreference('corAutomatica', corAutomatica);
        Util.setPreference('corPrimaria', config.corPrimaria || '#1a73e8');
      }
    } catch (e) {
      console.error('Erro ao carregar configurações:', e);
    }
  }

  function configurarEventos() {
    document.getElementById('form-config').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const corAutomatica = document.getElementById('config-cor-automatica')?.checked ?? true;
        await API.enviar({ acao: 'saveConfig', chave: 'metaLivrosPadrao', valor: document.getElementById('config-meta-livros').value });
        await API.enviar({ acao: 'saveConfig', chave: 'metaPaginasPadrao', valor: document.getElementById('config-meta-paginas').value });
        await API.enviar({ acao: 'saveConfig', chave: 'corPrimaria', valor: document.getElementById('config-cor').value });
        await API.enviar({ acao: 'saveConfig', chave: 'tema', valor: document.getElementById('config-tema').value });
        await API.enviar({ acao: 'saveConfig', chave: 'corAutomatica', valor: corAutomatica ? 'sim' : 'nao' });

        aplicarTemaCor();
        Util.toast('Configurações salvas!', 'success');
      } catch (erro) {
        Util.toast('Erro ao salvar configurações', 'danger');
      }
    });

    // Alterna o campo de cor manual conforme o toggle de cor automática
    document.getElementById('config-cor-automatica')?.addEventListener('change', (e) => {
      document.getElementById('config-cor').disabled = e.target.checked;
    });

    // Lembrete de leitura: preferência é só deste dispositivo (a permissão
    // de notificação também é por navegador), então fica em localStorage.
    const checkboxLembrete = document.getElementById('config-lembrete-leitura');
    const statusLembrete = document.getElementById('config-lembrete-status');
    if (checkboxLembrete) {
      checkboxLembrete.checked = Util.getPreference('lembreteLeituraAtivo', false);
      atualizarStatusLembrete();

      checkboxLembrete.addEventListener('change', async (e) => {
        if (e.target.checked) {
          const permissao = await Lembretes.solicitarPermissao();
          if (permissao !== 'granted') {
            e.target.checked = false;
            Util.setPreference('lembreteLeituraAtivo', false);
            Util.toast('Permissão de notificação negada pelo navegador.', 'warning');
            atualizarStatusLembrete();
            return;
          }
        }
        Util.setPreference('lembreteLeituraAtivo', e.target.checked);
        atualizarStatusLembrete();
      });
    }

    function atualizarStatusLembrete() {
      if (!statusLembrete) return;
      if (!('Notification' in window)) {
        statusLembrete.textContent = 'Seu navegador não suporta notificações.';
      } else if (Notification.permission === 'denied') {
        statusLembrete.textContent = 'Notificações bloqueadas nas configurações do navegador.';
      } else {
        statusLembrete.textContent = '';
      }
    }

    document.getElementById('btn-backup').addEventListener('click', async () => {
      try {
        const backup = await API.enviar({ acao: 'exportBackup' });
        // Grifos, posição de leitura e configuração do leitor vivem só no
        // localStorage (não na planilha) — sem isso, restaurar um backup em
        // outro aparelho "esquecia" tudo o que foi grifado no leitor.
        backup._localStorage = coletarDadosLocaisParaBackup();
        const jsonStr = JSON.stringify(backup, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `leitura_plus_backup_${new Date().toLocaleDateString('en-CA')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Util.setPreference('ultimoBackupData', new Date().toISOString());
        atualizarLembreteBackup();
        Util.toast('Backup baixado com sucesso!', 'success');
      } catch (e) {
        Util.toast('Erro ao gerar backup', 'danger');
      }
    });

    const inputRestore = document.getElementById('input-restore');
    const btnRestore = document.getElementById('btn-restore');

    inputRestore.addEventListener('change', () => {
      btnRestore.disabled = !inputRestore.files.length;
    });

    btnRestore.addEventListener('click', async () => {
      const file = inputRestore.files[0];
      if (!file) return;
      const confirmouRestaurar = await Util.confirmar('Tem certeza que deseja restaurar este backup? Todos os dados atuais serão substituídos.', { titulo: 'Restaurar backup', variante: 'warning', confirmarTexto: 'Restaurar', icone: 'fa-clock-rotate-left' });
      if (!confirmouRestaurar) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const backupData = JSON.parse(e.target.result);
          btnRestore.disabled = true;
          btnRestore.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Restaurando...';
          await API.enviar({ acao: 'importBackup', backup: backupData });
          if (backupData._localStorage) {
            restaurarDadosLocaisDoBackup(backupData._localStorage);
          }
          Util.toast('Dados restaurados com sucesso! Recarregue a página.', 'success');
          setTimeout(() => location.reload(), 2000);
        } catch (erro) {
          Util.toast('Erro ao restaurar: ' + erro.message, 'danger');
          btnRestore.disabled = false;
          btnRestore.innerHTML = '<i class="fas fa-upload"></i> Restaurar';
        }
      };
      reader.readAsText(file);
    });
  }

  // Reúne tudo que o leitor guarda só no localStorage (grifos por livro,
  // posição de leitura por livro, e a configuração de aparência do leitor)
  // pra entrar junto no arquivo de backup.
  function coletarDadosLocaisParaBackup() {
    const dados = { highlights: {}, posicoes: {}, leitorConfig: null };
    // As chaves entram no backup sem o prefixo do usuário: assim o arquivo
    // continua compatível com backups antigos e pode ser restaurado em qualquer conta.
    for (const chave of Util.lsNomes('calixteca_')) {
      if (chave.startsWith('calixteca_highlights_')) {
        try { dados.highlights[chave] = JSON.parse(Util.lsGet(chave)); } catch (e) {}
      } else if (chave.startsWith('calixteca_pos_')) {
        try { dados.posicoes[chave] = JSON.parse(Util.lsGet(chave)); } catch (e) {}
      } else if (chave === 'calixteca_leitor_config') {
        try { dados.leitorConfig = JSON.parse(Util.lsGet(chave)); } catch (e) {}
      }
    }
    return dados;
  }

  function restaurarDadosLocaisDoBackup(dadosLocais) {
    try {
      Object.entries(dadosLocais.highlights || {}).forEach(([chave, valor]) => {
        Util.lsSet(chave, JSON.stringify(valor));
      });
      Object.entries(dadosLocais.posicoes || {}).forEach(([chave, valor]) => {
        Util.lsSet(chave, JSON.stringify(valor));
      });
      if (dadosLocais.leitorConfig) {
        Util.lsSet('calixteca_leitor_config', JSON.stringify(dadosLocais.leitorConfig));
      }
    } catch (e) {
      console.warn('Falha ao restaurar grifos/posições/config do leitor:', e);
    }
  }

  async function carregarCoordenadas() {
    try {
      const config = await API.enviar({ acao: 'getConfigs' });
      const lista = document.getElementById('lista-coordenadas');
      if (!lista) return;
      lista.innerHTML = '';
      for (const [chave, valor] of Object.entries(config)) {
        if (chave.startsWith('local_coord_')) {
          const local = chave.replace('local_coord_', '').replace(/_/g, ' ');
          const li = document.createElement('li');
          li.className = 'd-flex justify-content-between align-items-center py-1';
          li.innerHTML = `<span><i class="fas fa-map-pin me-2 text-danger"></i>${Util.escapeHTML(local)}: ${Util.escapeHTML(valor)}</span>
            <button class="btn btn-sm btn-outline-danger btn-remover-coord" data-chave="${chave}"><i class="fas fa-trash"></i></button>`;
          lista.appendChild(li);
        }
      }
      document.querySelectorAll('.btn-remover-coord').forEach(btn => {
        btn.addEventListener('click', async () => {
          await API.enviar({ acao: 'saveConfig', chave: btn.dataset.chave, valor: '' });
          carregarCoordenadas();
        });
      });
    } catch (e) {
      console.error('Erro ao carregar coordenadas:', e);
    }
  }

  async function carregarInfoSistema() {
    try {
      // Reaproveita o que a Biblioteca já buscou e guardou no IndexedDB;
      // só bate na API se ainda não existir nada em cache local.
      let livros = await DB.obterLivros();
      if (!livros || livros.length === 0) {
        livros = await API.enviar({ acao: 'listAllBooks' });
      }
      const total = Array.isArray(livros) ? livros.length : 0;
      document.getElementById('info-total-livros').textContent = total;
      document.getElementById('info-espaco').textContent = (total * 1).toFixed(0) + ' KB (estimado)';
    } catch (e) {
      console.error(e);
    }
  }

  // Lembrete simples de backup periódico: sem automação real, só avisa
  // quando já fazem 30+ dias desde o último backup baixado neste dispositivo.
  function atualizarLembreteBackup() {
    const aviso = document.getElementById('backup-lembrete');
    if (!aviso) return;
    const ultima = Util.getPreference('ultimoBackupData', null);
    if (!ultima) {
      aviso.textContent = 'Nenhum backup registrado neste dispositivo ainda.';
      aviso.classList.remove('d-none');
      return;
    }
    const dias = Math.floor((Date.now() - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24));
    if (dias >= 30) {
      aviso.textContent = `Já fazem ${dias} dias desde o último backup. Que tal baixar um novo?`;
      aviso.classList.remove('d-none');
    } else {
      aviso.textContent = `Último backup: há ${dias} dia(s).`;
      aviso.classList.remove('d-none');
    }
  }

  function aplicarTemaCor() {
    const cor = document.getElementById('config-cor').value;
    const tema = document.getElementById('config-tema').value;
    const corAutomatica = document.getElementById('config-cor-automatica')?.checked ?? true;

    Util.setPreference('corAutomatica', corAutomatica);
    Util.setPreference('corPrimaria', cor);

    if (corAutomatica && typeof TemaSazonal !== 'undefined') {
      // Deixa o módulo sazonal decidir a cor da hora atual.
      TemaSazonal.aplicarCorPorHora();
    } else {
      document.documentElement.style.setProperty('--primary', cor);
    }

    if (tema === 'dark') {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    Util.setPreference('darkMode', tema === 'dark');
  }

  return { init };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Configuracoes.init());
} else {
  Configuracoes.init();
}
