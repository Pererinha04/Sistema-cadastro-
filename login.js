// login.js
// Ajuda a preencher telas de login (usada pelo EducaDF e pelo SIGEP).
// Procura um campo de senha visível na página e também dentro de quadros (iframes), e
// marca o campo de senha e o campo de usuário (o campo de texto logo antes da senha).

const TIPOS_IGNORADOS = ['password', 'hidden', 'checkbox', 'radio', 'submit', 'button', 'image', 'file', 'reset'];

// Devolve o quadro (frame) onde existe um formulário de login visível, ou null.
async function acharLogin(page) {
  for (const frame of page.frames()) {
    try {
      const achou = await frame.evaluate((ignorar) => {
        const visivel = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

        document.querySelectorAll('[data-auto-login]').forEach((e) => e.removeAttribute('data-auto-login'));

        const senha = [...document.querySelectorAll('input[type="password"]')].find(visivel);
        if (!senha) return false;

        const candidatos = [...document.querySelectorAll('input')].filter(
          (i) => visivel(i) && !ignorar.includes((i.type || 'text').toLowerCase())
        );
        // O usuário é o campo de texto mais próximo ANTES da senha.
        const antes = candidatos.filter(
          (i) => senha.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_PRECEDING
        );
        const usuario = antes[antes.length - 1] || candidatos[0];

        senha.setAttribute('data-auto-login', 'senha');
        if (usuario) usuario.setAttribute('data-auto-login', 'usuario');
        return true;
      }, TIPOS_IGNORADOS);

      if (achou) return frame;
    } catch {
      // o quadro estava trocando de página; tenta de novo na próxima volta
    }
  }
  return null;
}

// Preenche usuário e senha no quadro achado por acharLogin.
// Com clicarEntrar, também clica em "Entrar" (no SIGEP isso fica com você, por causa do captcha).
async function preencherLogin(frame, usuario, senha, { clicarEntrar = true } = {}) {
  const campoUsuario = frame.locator('[data-auto-login="usuario"]').first();
  const campoSenha = frame.locator('[data-auto-login="senha"]').first();

  const temUsuario = (await campoUsuario.count()) > 0;
  if (temUsuario) await campoUsuario.fill(usuario, { timeout: 5000 });
  await campoSenha.fill(senha, { timeout: 5000 });

  let clicou = false;
  if (clicarEntrar) {
    const botao = frame.getByRole('button', { name: /entrar|acessar|login|continuar/i }).first();
    if (await botao.count()) {
      await botao.click({ timeout: 5000 });
    } else {
      await campoSenha.press('Enter');
    }
    clicou = true;
  }
  return { temUsuario, clicou };
}

module.exports = { acharLogin, preencherLogin };