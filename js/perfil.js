/**
 * Perfil do usuário: nome do app e ícone (a "cara" que cada pessoa dá ao seu app).
 *
 * Fica na tabela `perfis` (uma linha por usuário). O ícone pode ser:
 *   - 'emoji:📚' + uma cor de fundo (cor_primaria); ou
 *   - 'img:data:image/jpeg;base64,...' — foto enviada pela pessoa (já reduzida para 192x192).
 *
 * Onde isso aparece: título da aba, cabeçalhos/menus (elementos com data-app-nome e
 * data-app-logo), favicon, apple-touch-icon e o manifest do PWA (nome/ícone da tela inicial).
 *
 * Limite da plataforma: o nome e o ícone na TELA INICIAL do celular são lidos quando o app é
 * instalado. Se a pessoa mudar depois, precisa reinstalar (remover e "Adicionar à tela inicial").
 */
const Perfil = (() => {
  const sb = SupabaseApp.client;
  const PADRAO = { nome_app: 'Minha Leitura', icone: 'emoji:📚', cor_primaria: '#6366f1' };
  const EMOJIS = ['📚', '📖', '🦉', '🌙', '☕', '🌿', '🔥', '⭐', '🦋', '🐱', '🌊', '🎧', '🏔️', '🪐', '🍃', '✒️', '🕯️', '🍂', '🌸', '🧭'];
  const CORES = ['#6366f1', '#c81414', '#0f766e', '#b45309', '#7c3aed', '#0369a1', '#be185d', '#334155'];

  let atual = { ...PADRAO };
  let manifestUrl = null;
  let telaPronta = false;
  let rascunho = null; // alterações ainda não salvas na tela de configurações

  // ---------- cache local (para o nome/ícone aparecerem sem esperar a rede) ----------
  function lerCache() {
    try { return JSON.parse(Util.lsGet('perfil_cache') || 'null'); } catch (e) { return null; }
  }
  function gravarCache(p) {
    try { Util.lsSet('perfil_cache', JSON.stringify(p)); } catch (e) { /* ignora */ }
  }

  function normalizar(p) {
    const n = { ...PADRAO, ...(p || {}) };
    if (!n.icone || n.icone === 'livro') n.icone = PADRAO.icone;
    n.nome_app = String(n.nome_app || PADRAO.nome_app).trim().slice(0, 30) || PADRAO.nome_app;
    return n;
  }

  // ---------- carregar / salvar ----------
  async function carregar() {
    const emCache = lerCache();
    if (emCache) { atual = normalizar(emCache); await aplicar(atual); }

    try {
      const { data, error } = await sb.from('perfis').select('nome_app, icone, cor_primaria').maybeSingle();
      if (error) throw error;
      if (data) {
        atual = normalizar(data);
      } else {
        // Conta criada antes do gatilho de perfil: cria a linha agora.
        const { data: sessao } = await sb.auth.getSession();
        const uid = sessao && sessao.session && sessao.session.user.id;
        if (uid) await sb.from('perfis').upsert({ user_id: uid, ...atual }, { onConflict: 'user_id' });
      }
      gravarCache(atual);
      await aplicar(atual);
    } catch (e) {
      console.warn('Perfil: usando dados locais (sem rede?)', e);
      if (!emCache) await aplicar(atual);
    }
    return atual;
  }

  async function salvar(parcial) {
    const novo = normalizar({ ...atual, ...parcial });
    const { data: sessao } = await sb.auth.getSession();
    const uid = sessao && sessao.session && sessao.session.user.id;
    if (!uid) throw new Error('Sessão expirada. Entre novamente.');
    const { error } = await sb.from('perfis').upsert(
      { user_id: uid, nome_app: novo.nome_app, icone: novo.icone, cor_primaria: novo.cor_primaria },
      { onConflict: 'user_id' }
    );
    if (error) throw new Error(error.message);
    atual = novo;
    gravarCache(atual);
    await aplicar(atual);
    return atual;
  }

  // ---------- gerar o ícone (canvas) ----------
  function carregarImagem(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function iconeDataURL(perfil, tamanho) {
    const p = normalizar(perfil);
    const c = document.createElement('canvas');
    c.width = c.height = tamanho;
    const ctx = c.getContext('2d');

    if (p.icone.startsWith('img:')) {
      try {
        const img = await carregarImagem(p.icone.slice(4));
        const lado = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, tamanho, tamanho);
        return c.toDataURL('image/png');
      } catch (e) { /* cai para o emoji padrão */ }
    }

    const emoji = p.icone.startsWith('emoji:') ? p.icone.slice(6) : PADRAO.icone.slice(6);
    ctx.fillStyle = p.cor_primaria;
    ctx.fillRect(0, 0, tamanho, tamanho);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(tamanho * 0.55)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(emoji, tamanho / 2, tamanho / 2 + tamanho * 0.04);
    return c.toDataURL('image/png');
  }

  // ---------- aplicar na página ----------
  function definirLink(rel, href, id) {
    let link = document.querySelector(id ? `#${id}` : `link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement('link');
      link.rel = rel;
      if (id) link.id = id;
      document.head.appendChild(link);
    }
    link.href = href;
    return link;
  }

  async function aplicar(p) {
    document.title = p.nome_app;
    document.querySelectorAll('[data-app-nome]').forEach((el) => { el.textContent = p.nome_app; });

    const icone96 = await iconeDataURL(p, 96);
    document.querySelectorAll('[data-app-logo]').forEach((img) => { img.src = icone96; img.alt = p.nome_app; });

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', p.cor_primaria);
    const metaTitulo = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (metaTitulo) metaTitulo.setAttribute('content', p.nome_app);

    definirLink('icon', await iconeDataURL(p, 64));
    definirLink('apple-touch-icon', await iconeDataURL(p, 180));
    aplicarManifest();
  }

  // O manifest vem de uma função do Supabase (endereço real), com o nome e a foto do perfil.
  // Assim o Chrome consegue instalar o app e ele leva o nome escolhido pela pessoa.
  function aplicarManifest() {
    const uid = (typeof Auth !== 'undefined' && Auth.id && Auth.id()) || null;
    if (!uid) return;
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    const href = `${SupabaseApp.URL}/functions/v1/leituras-manifest?u=${encodeURIComponent(uid)}&b=${encodeURIComponent(base)}&t=${Date.now()}`;
    let link = document.getElementById('app-manifest') || document.querySelector('link[rel="manifest"]');
    if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link); }
    link.id = 'app-manifest';
    link.href = href;
  }

  // ---------- tela em Configurações ----------
  function el(id) { return document.getElementById(id); }

  function valoresDaTela() {
    return {
      nome_app: (el('perfil-nome').value || '').trim(),
      icone: rascunho.icone,
      cor_primaria: rascunho.cor_primaria
    };
  }

  async function atualizarPrevia() {
    const img = el('perfil-previa');
    if (!img || !rascunho) return;
    img.src = await iconeDataURL({ ...rascunho, nome_app: el('perfil-nome').value || atual.nome_app }, 128);
    el('perfil-previa-nome').textContent = (el('perfil-nome').value || '').trim() || atual.nome_app;
    document.querySelectorAll('#perfil-emojis .perfil-emoji').forEach((b) => {
      b.classList.toggle('ativo', rascunho.icone === 'emoji:' + b.dataset.emoji);
    });
    document.querySelectorAll('#perfil-cores .perfil-cor').forEach((b) => {
      b.classList.toggle('ativo', rascunho.cor_primaria.toLowerCase() === b.dataset.cor);
    });
    el('perfil-cor-livre').value = rascunho.cor_primaria;
  }

  async function reduzirFoto(arquivo) {
    const url = URL.createObjectURL(arquivo);
    try {
      const img = await carregarImagem(url);
      const c = document.createElement('canvas');
      c.width = c.height = 192;
      const lado = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 192, 192);
      return c.toDataURL('image/jpeg', 0.85);
    } finally { URL.revokeObjectURL(url); }
  }

  function initTela() {
    if (!el('perfil-nome')) return;
    rascunho = { icone: atual.icone, cor_primaria: atual.cor_primaria };
    el('perfil-nome').value = atual.nome_app;
    el('perfil-email').textContent = Auth.email() || '—';

    if (!telaPronta) {
      telaPronta = true;

      el('perfil-emojis').innerHTML = EMOJIS.map((e) =>
        `<button type="button" class="perfil-emoji" data-emoji="${e}" aria-label="Ícone ${e}">${e}</button>`).join('');
      el('perfil-cores').innerHTML = CORES.map((c) =>
        `<button type="button" class="perfil-cor" data-cor="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`).join('');

      el('perfil-emojis').addEventListener('click', (ev) => {
        const b = ev.target.closest('.perfil-emoji');
        if (!b) return;
        rascunho.icone = 'emoji:' + b.dataset.emoji;
        atualizarPrevia();
      });
      el('perfil-cores').addEventListener('click', (ev) => {
        const b = ev.target.closest('.perfil-cor');
        if (!b) return;
        rascunho.cor_primaria = b.dataset.cor;
        if (!rascunho.icone.startsWith('emoji:')) rascunho.icone = PADRAO.icone;
        atualizarPrevia();
      });
      el('perfil-cor-livre').addEventListener('input', (ev) => {
        rascunho.cor_primaria = ev.target.value;
        if (!rascunho.icone.startsWith('emoji:')) rascunho.icone = PADRAO.icone;
        atualizarPrevia();
      });
      el('perfil-nome').addEventListener('input', atualizarPrevia);

      el('perfil-foto').addEventListener('change', async (ev) => {
        const arquivo = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!arquivo) return;
        if (!arquivo.type.startsWith('image/')) { Util.toast('Escolha um arquivo de imagem.', 'warning'); return; }
        if (arquivo.size > 8 * 1024 * 1024) { Util.toast('Imagem grande demais (máx. 8 MB).', 'warning'); return; }
        try {
          rascunho.icone = 'img:' + await reduzirFoto(arquivo);
          atualizarPrevia();
        } catch (e) { Util.toast('Não foi possível ler essa imagem.', 'danger'); }
      });

      el('form-perfil').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const v = valoresDaTela();
        if (!v.nome_app) { Util.toast('Dê um nome ao seu app.', 'warning'); return; }
        if (v.nome_app.length > 30) { Util.toast('O nome pode ter até 30 caracteres.', 'warning'); return; }
        const botao = el('perfil-salvar');
        botao.disabled = true;
        try {
          await salvar(v);
          Util.toast('Perfil atualizado! Para mudar o nome/ícone na tela inicial do celular, reinstale o app.', 'success');
        } catch (e) {
          Util.toast(e.message || 'Erro ao salvar o perfil.', 'danger');
        } finally { botao.disabled = false; }
      });

      el('btn-sair').addEventListener('click', async () => {
        const ok = await Util.confirmar('Sair da conta neste aparelho?');
        if (ok) Auth.sair();
      });
    }
    atualizarPrevia();
  }

  return { carregar, salvar, aplicar, initTela, iconeDataURL, atual: () => ({ ...atual }) };
})();
