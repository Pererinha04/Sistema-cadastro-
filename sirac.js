// sirac.js
// Automação do navegador (Playwright) para preencher a Admissão no SIRAC.
// O programa NÃO clica em "Salvar": você confere os campos e salva manualmente.

const { novaAba, registrarAba, abaAberta } = require('./navegador');
const { acharLogin, preencherLogin } = require('./login');
const {
  URL_SIRAC,
  URL_SIRAC_INICIO,
  SIRAC_ABRIR_PELO_MENU,
  SIRAC_MENU,
  JURISDICIONADO,
  EDITAL,
  ESPECIALIDADE,
  FIXOS,
  ROTULOS,
  SEL,
} = require('./config');

// ---------- utilidades ----------

const soDigitos = (s) => String(s).replace(/\D/g, '');

const formatarCpf = (s) =>
  soDigitos(s).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');

// 1994-04-21 -> 21/04/1994
const paraDDMMAAAA = (iso) => iso.split('-').reverse().join('/');

// Preenche um campo. Se tiver máscara e o fill falhar, digita tecla por tecla.
async function preencherCampo(locator, valor, { mascara = false } = {}) {
  await locator.fill(valor);
  if (mascara) {
    const atual = await locator.inputValue();
    if (soDigitos(atual) !== soDigitos(valor)) {
      await locator.fill('');
      await locator.pressSequentially(soDigitos(valor), { delay: 30 });
    }
  }
}

// Seleciona a ÚLTIMA opção cujo texto COMEÇA com "inicio" (ex.: "36/2025 - Temporário (80)").
// A lista do SIRAC tem opções repetidas; a que vale é a última.
async function selecionarPorInicio(select, inicio) {
  const indice = await select
    .locator('option')
    .evaluateAll((opts, ini) => {
      let achado = -1;
      opts.forEach((o, i) => {
        if (o.textContent.trim().startsWith(ini)) achado = i;
      });
      return achado;
    }, inicio);
  if (indice < 0) throw new Error(`Opção não encontrada na lista: ${inicio}`);
  await select.selectOption({ index: indice });
}

// Seleciona a opção cujo texto é igual a "texto" (sem diferenciar maiúsculas) ou, se não houver,
// a que começa com ele. Mostra as opções existentes se não achar.
async function selecionarOpcao(select, texto, nomeCampo) {
  const r = await select.evaluate((s, t) => {
    const alvo = t.toLowerCase();
    const textos = [...s.options].map((o) => o.textContent.trim());
    let i = textos.findIndex((x) => x.toLowerCase() === alvo);
    if (i < 0) i = textos.findIndex((x) => x.toLowerCase().startsWith(alvo));
    return { i, textos };
  }, texto);
  if (r.i < 0) {
    throw new Error(
      `Campo "${nomeCampo}": não achei a opção "${texto}". Opções na tela: ${r.textos.join(' | ')}`
    );
  }
  await select.selectOption({ index: r.i });
}

// ---------- achar campos ----------

const MAIUSC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MINUSC = 'abcdefghijklmnopqrstuvwxyz';

// XPath de um texto de rótulo: ignora ":" e "*", espaços e maiúsculas/minúsculas.
const xRotulo = (texto) =>
  `//*[text()[normalize-space(translate(., "${MAIUSC}:*", "${MINUSC}"))="${texto.toLowerCase()}"]]`;

// Campo (input ou select) que vem logo depois do rótulo.
function campoPorRotulo(page, rotulo, tag) {
  const filtro = tag === 'input' ? 'input[not(@type="hidden") and not(@type="radio")]' : tag;
  return page.locator(`xpath=(${xRotulo(rotulo)})[1]/following::${filtro}[1]`);
}

// Radios ficam na ordem da tela: Masculino, Feminino / Sim, Não.
const ORDEM_RADIO = { Masculino: 1, Feminino: 2, Sim: 1, Não: 2 };

// Radio de um grupo: o 1º ou o 2º radio que vem depois do rótulo do grupo.
function radioPorRotulo(page, grupo, opcao) {
  return page.locator(
    `xpath=(${xRotulo(grupo)})[1]/following::input[@type="radio"][${ORDEM_RADIO[opcao]}]`
  );
}

function campo(page, manual, rotulo, tag) {
  return manual ? page.locator(manual) : campoPorRotulo(page, rotulo, tag);
}
function radio(page, manual, grupo, opcao) {
  return manual ? page.locator(manual) : radioPorRotulo(page, grupo, opcao);
}

// Confere se o campo existe antes de usar, com mensagem clara.
async function exigir(locator, nome, rotulo) {
  try {
    await locator.first().waitFor({ state: 'attached', timeout: 8000 });
  } catch {
    throw new Error(
      `Não achei o campo "${nome}" na tela de Admissão (procurei o texto "${rotulo}"). Ajuste ROTULOS.${nome} no config.js ou coloque o seletor em SEL.${nome}.`
    );
  }
  return locator.first();
}

// ---------- login e escolha do edital ----------

// Espera a rede assentar (o SIRAC recarrega partes da tela por AJAX) e dá um respiro.
async function aguardar(page) {
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
}

function credenciaisSirac() {
  return {
    usuario: process.env.SIRAC_USUARIO || process.env.USUARIO_SIRAC || process.env.EDUCADF_USUARIO,
    senha: process.env.SIRAC_SENHA || process.env.SENHA_SIRAC,
  };
}

// Se houver tela de login, preenche e clica em Entrar (uma vez só). Devolve true se entrou agora.
async function tratarLogin(page, estado) {
  if (estado.preencheu || estado.tentativas >= 3) return false;
  const frame = await acharLogin(page);
  if (!frame) return false;

  const { usuario, senha } = credenciaisSirac();
  if (!usuario || !senha) {
    if (!estado.avisou) {
      // Mostra só os NOMES das variáveis parecidas no .env (nunca os valores).
      const parecidas = Object.keys(process.env).filter((k) => /sirac|senha|usuario|login/i.test(k));
      console.log(
        `SIRAC: achei a tela de login, mas não achei SIRAC_USUARIO e SIRAC_SENHA no .env. Variáveis parecidas que o programa enxergou: ${
          parecidas.length ? parecidas.join(', ') : 'nenhuma'
        }. Entre à mão na janela.`
      );
      estado.avisou = true;
    }
    return false;
  }

  try {
    const r = await preencherLogin(frame, usuario, senha);
    console.log(`SIRAC: login preenchido (${r.temUsuario ? 'usuário e senha' : 'só a senha'}) e Entrar clicado.`);
    estado.preencheu = true;
    return true;
  } catch (err) {
    estado.tentativas += 1;
    console.log(`SIRAC: não consegui preencher o login (${err.message.split('\n')[0]}).`);
    return false;
  }
}

// Clica nos itens de SIRAC_MENU em ordem (passa o mouse nos de cima e clica no último).
async function abrirPeloMenu(page) {
  for (let i = 0; i < SIRAC_MENU.length; i++) {
    const item = page.getByText(SIRAC_MENU[i], { exact: true }).filter({ visible: true }).first();
    await item.waitFor({ state: 'visible', timeout: 8000 });
    if (i < SIRAC_MENU.length - 1) {
      await item.hover();
      await page.waitForTimeout(400);
      // Se o submenu não abriu só com o mouse em cima, clica no item.
      const proximo = page.getByText(SIRAC_MENU[i + 1], { exact: true }).filter({ visible: true }).first();
      if (!(await proximo.isVisible().catch(() => false))) await item.click();
    } else {
      await item.click();
    }
    await page.waitForTimeout(500);
  }
}

const naTelaDePesquisa = (page) =>
  /cadastroAdmissao\/pesquisa/.test(page.url());

// Espera a tela "Cadastrar Admissão". Faz o login se pedir. No modo menu, abre pelo menu
// (SIRAC_MENU) ou espera você abrir.
async function aguardarTela(page) {
  const estado = { preencheu: false, tentativas: 0, avisou: false };
  const limite = SIRAC_ABRIR_PELO_MENU ? 300000 : 120000;
  const inicio = Date.now();
  let reabriu = false;
  let tentativasMenu = 0;

  while (Date.now() - inicio < limite) {
    const pronta = SIRAC_ABRIR_PELO_MENU
      ? naTelaDePesquisa(page) && (await page.locator('select').nth(1).count().catch(() => 0)) > 0
      : await page.locator('select').first().isVisible().catch(() => false);
    if (pronta) return;

    const entrou = await tratarLogin(page, estado);

    if (!entrou && !(await acharLogin(page))) {
      if (SIRAC_ABRIR_PELO_MENU) {
        if (SIRAC_MENU.length && tentativasMenu < 3) {
          const primeiro = page.getByText(SIRAC_MENU[0], { exact: true }).filter({ visible: true }).first();
          if (await primeiro.count().catch(() => 0)) {
            tentativasMenu += 1;
            try {
              await abrirPeloMenu(page);
            } catch (err) {
              console.log(`SIRAC: não consegui abrir pelo menu (${err.message.split('\n')[0]}). Abra à mão.`);
            }
          }
        }
      } else if (estado.preencheu && !reabriu && Date.now() - inicio > 8000) {
        reabriu = true; // depois do login pode cair na página inicial
        await page.goto(URL_SIRAC).catch(() => {});
      }
    }

    await page.waitForTimeout(500);
  }
  throw new Error('a tela "Cadastrar Admissão" não apareceu a tempo. Abra-a à mão na janela e tente de novo.');
}

// Mostra no terminal o que o navegador manda ao SIRAC na tela de pesquisa (sem ViewState).
function observarRede(page) {
  if (page.__observando) return;
  page.__observando = true;
  page.on('request', (req) => {
    if (req.method() !== 'POST' || !req.url().includes('pesquisar.seam')) return;
    try {
      const u = new URL(req.url());
      const campos = [...new URLSearchParams(req.postData() || '').entries()].map(([k, v]) =>
        /viewstate/i.test(k) ? `${k}(len ${v.length})` : `${k.replace('formPesquisa:', '')}=${String(v).slice(0, 30)}`
      );
      console.log(`SIRAC rede: POST ${u.pathname.split('/').pop()}${u.search} :: ${campos.join(' | ')}`);
    } catch {}
  });
  page.on('response', (res) => {
    if (res.request().method() === 'POST' && res.url().includes('pesquisar.seam')) {
      console.log(`SIRAC rede: resposta ${res.status()}`);
    }
  });
}

// Escolhe o edital na lista. Cada tentativa usa um jeito diferente de mexer na lista.
async function escolherEditalNaLista(page, tentativa) {
  const select = page.locator('select').nth(1);

  if (tentativa === 3) {
    const outro = await page
      .locator('select')
      .nth(0)
      .evaluate((s, atual) => {
        const o = [...s.options].find((x) => x.textContent.trim() && x.textContent.trim() !== atual);
        return o ? o.textContent.trim() : null;
      }, JURISDICIONADO);
    if (outro) {
      await page.locator('select').nth(0).selectOption({ label: outro });
      await aguardar(page);
      await page.locator('select').nth(0).selectOption({ label: JURISDICIONADO });
      await aguardar(page);
      await page.waitForTimeout(1500);
    }
  }

  if (tentativa === 1) {
    await selecionarPorInicio(select, EDITAL);
    return;
  }

  await select.focus();
  await page.waitForTimeout(800);
  await page.keyboard.press('End');
  const texto = await select.evaluate((s) => (s.selectedOptions[0]?.textContent || '').trim());
  if (!texto.startsWith(EDITAL)) {
    console.log(`SIRAC: o teclado parou em "${texto}", usando seleção direta.`);
    await selecionarPorInicio(select, EDITAL);
  }
}

// Escolhe Jurisdicionado e Edital esperando o SIRAC recarregar a lista entre uma coisa e outra.
async function escolherEdital(page) {
  observarRede(page);
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    await aguardarTela(page);
    await aguardar(page);

    const selects = page.locator('select');
    const atual = await selects
      .nth(0)
      .evaluate((s) => (s.selectedOptions[0]?.textContent || '').trim());
    if (atual !== JURISDICIONADO) {
      await selects.nth(0).selectOption({ label: JURISDICIONADO });
      await aguardar(page);
    }

    await page.waitForFunction(
      (ini) => {
        const lista = document.querySelectorAll('select')[1];
        return lista && lista.textContent.includes(ini);
      },
      EDITAL,
      { timeout: 30000 }
    );
    await aguardar(page);

    await page.waitForTimeout(1500);
    await escolherEditalNaLista(page, tentativa);
    await aguardar(page);

    // Continuar envia o edital escolhido ao servidor e mostra a tabela com o link do edital.
    await page.getByRole('button', { name: 'Continuar' }).click({ timeout: 15000 });
    await aguardar(page);

    const erro = await page.getByText('Valor inválido').first().isVisible().catch(() => false);
    if (!erro) return;

    if (SIRAC_ABRIR_PELO_MENU) {
      throw new Error(
        'o SIRAC respondeu "Valor inválido" mesmo abrindo Cadastrar Admissão pelo menu. Mande o log "SIRAC rede:" do terminal.'
      );
    }
    console.log(`SIRAC: "Valor inválido" ao escolher o edital (tentativa ${tentativa}/3). Recarregando a tela.`);
    await page.goto(URL_SIRAC);
  }
  throw new Error('o SIRAC continuou respondendo "Valor inválido" ao escolher o edital depois de 3 tentativas.');
}

// ---------- fluxo principal ----------

// Etapa 3: digita o CPF e clica em Continuar até o formulário de Admissão abrir.
// Não espera a rede ficar parada (o SIRAC quase nunca fica, e isso travava a tela por 30 s):
// espera o campo "Nome" da Admissão aparecer. Se a tela continuar no CPF, tenta de novo.
async function informarCpf(page, cpf) {
  const botao = page.getByRole('button', { name: 'Continuar' }).filter({ visible: true }).first();
  const naAdmissao = async () => {
    try {
      return (await campo(page, SEL.nome, ROTULOS.nome, 'input').count()) > 0;
    } catch {
      return false; // a página estava trocando de tela
    }
  };

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    // Se a tela já avançou (resposta lenta da tentativa anterior), não digita o CPF em outro campo.
    if (await naAdmissao()) return;

    const campoCpf = SEL.cpf
      ? page.locator(SEL.cpf)
      : page.locator('input[type="text"]:visible').last();
    await preencherCampo(campoCpf, formatarCpf(cpf), { mascara: true });
    await campoCpf.press('Tab'); // sai do campo: o SIRAC pode validar e refazer a tela ao sair
    await aguardar(page);

    await botao.click({ timeout: 15000 });
    console.log(`SIRAC: Continuar do CPF clicado (tentativa ${tentativa}/3).`);

    const inicio = Date.now();
    while (Date.now() - inicio < 20000) {
      if (await naAdmissao()) {
        console.log(`SIRAC: formulário de Admissão aberto em ${((Date.now() - inicio) / 1000).toFixed(1)} s.`);
        return;
      }
      await page.waitForTimeout(300);
    }

    // Só para diagnóstico: mensagem que o SIRAC mostrou na tela (não contém o CPF).
    const aviso = await page
      .locator('text=/inv[áa]lid|obrigat|n[ãa]o encontrad/i')
      .filter({ visible: true })
      .first()
      .innerText({ timeout: 1000 })
      .catch(() => '');
    console.log(
      `SIRAC: o formulário não abriu depois do Continuar${aviso ? ` (a tela diz: ${aviso.split('\n')[0].slice(0, 120)})` : ''}. Tentando de novo.`
    );
  }
  throw new Error(
    'o SIRAC não abriu o formulário de Admissão depois de clicar em Continuar (3 tentativas). Confira o CPF na janela, clique em Continuar à mão e tente de novo; veja o log para a mensagem do SIRAC.'
  );
}

// Etapas 0 a 3: abre o SIRAC e chega até o formulário de Admissão.
async function abrirFormularioAdmissao(page, cpf, { reaproveitada = false } = {}) {
  // Aba do SIRAC que já estava aberta: não abre outra; vai em Jurisdicionado > Cadastrar Admissão
  // pelo menu (SIRAC_MENU) e segue o mesmo processo de sempre.
  let voltouPeloMenu = false;
  if (reaproveitada && SIRAC_MENU.length) {
    const primeiro = page.getByText(SIRAC_MENU[0], { exact: true }).filter({ visible: true }).first();
    if (await primeiro.count().catch(() => 0)) {
      try {
        console.log(`SIRAC: aba já aberta; indo em ${SIRAC_MENU.join(' > ')} pelo menu.`);
        await abrirPeloMenu(page);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await aguardar(page);
        voltouPeloMenu = true;
      } catch (err) {
        console.log(`SIRAC: não consegui usar o menu na aba aberta (${err.message.split('\n')[0]}); abrindo a página inicial.`);
      }
    }
  }

  if (voltouPeloMenu) {
    // já está na tela de pesquisa de Cadastrar Admissão
  } else if (SIRAC_ABRIR_PELO_MENU) {
    await page.goto(URL_SIRAC_INICIO);
    console.log(
      SIRAC_MENU.length
        ? 'SIRAC: aba aberta. O programa vai tentar abrir Cadastrar Admissão pelo menu; se não conseguir, abra à mão.'
        : 'SIRAC: aba aberta. Abra Cadastrar Admissão pelo menu do SIRAC; o programa continua sozinho.'
    );
  } else {
    await page.goto(URL_SIRAC);
  }
  await escolherEdital(page);

  // Depois do Continuar aparece uma tabela com o link do edital (ex.: "36/2025").
  await page.getByRole('link', { name: EDITAL, exact: true }).first().click({ timeout: 30000 });
  await aguardar(page);

  // Etapa 2: lista de cargos. Aqui VOCÊ escolhe a especialidade e clica em "Professor Substituto".
  // O programa espera a lista sumir e a tela do CPF abrir (até 10 minutos).
  console.log('SIRAC: escolha a especialidade e clique em "Professor Substituto" na janela. O programa continua sozinho.');
  const lista = page.getByRole('cell', { name: ESPECIALIDADE, exact: true }).first();
  const apareceu = await lista
    .waitFor({ state: 'visible', timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  if (apareceu) await lista.waitFor({ state: 'hidden', timeout: 600000 });
  await aguardar(page);
  await page.getByRole('button', { name: 'Continuar' }).first().waitFor({ state: 'visible', timeout: 600000 });

  // Etapa 3: CPF + Continuar
  await informarCpf(page, cpf);
}

// ---------- Turno ----------

const SINONIMOS_TURNO = {
  matutino: ['matutino', 'manha', 'm'],
  vespertino: ['vespertino', 'tarde', 'v'],
  noturno: ['noturno', 'noite', 'n'],
  diurno: ['diurno', 'integral'],
};

const semAcento = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Preenche o Turno no formulário de Admissão: se for uma lista, escolhe a opção; se forem botões
// de marcar (radio), marca o que tem o nome do turno. Devolve { ok, escolhida } ou { ok: false, motivo }.
async function preencherTurno(page, turno) {
  const candidatos = [turno, ...(SINONIMOS_TURNO[semAcento(turno)] || [])];
  let opcoes = [];

  // 1) Lista (select) que vem depois do rótulo "Turno".
  const select = campo(page, SEL.turno, ROTULOS.turno, 'select').first();
  const temLista = await select.waitFor({ state: 'attached', timeout: 3000 }).then(() => true).catch(() => false);
  if (temLista) {
    const r = await select.evaluate((s, cands) => {
      const n = (t) =>
        String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      const textos = [...s.options].map((o) => o.textContent.trim());
      const normais = textos.map(n);
      const valida = (i) => normais[i] !== '' && !normais[i].startsWith('--') && !normais[i].startsWith('selecione');
      for (const c of cands) {
        const alvo = n(c);
        let i = normais.findIndex((x, k) => valida(k) && x === alvo);
        if (i < 0 && alvo.length > 1) i = normais.findIndex((x, k) => valida(k) && x.startsWith(alvo));
        if (i < 0 && alvo.length > 1) i = normais.findIndex((x, k) => valida(k) && x.includes(alvo));
        if (i >= 0) return { i, textos };
      }
      return { i: -1, textos };
    }, candidatos);
    if (r.i >= 0) {
      await select.selectOption({ index: r.i });
      return { ok: true, escolhida: r.textos[r.i] };
    }
    opcoes = r.textos.filter((x) => x && !/^(--|selecione)/i.test(x));
  }

  // 2) Botões de marcar (radio) com o nome do turno.
  for (const nome of candidatos.filter((x) => x.length > 1)) {
    const radioTurno = page.getByRole('radio', { name: nome, exact: true }).first();
    if (await radioTurno.count().catch(() => 0)) {
      await radioTurno.check();
      return { ok: true, escolhida: nome };
    }
  }

  return {
    ok: false,
    motivo: temLista
      ? `não achei "${turno}" entre as opções: ${opcoes.join(' | ') || 'nenhuma'}`
      : `não achei o campo "${ROTULOS.turno}" na tela de Admissão`,
  };
}

// ---------- Carga Horária ----------

// Campo (lista ou texto) que vem logo depois do rótulo da Carga Horária no formulário de Admissão.
async function preencherCargaHoraria(page, carga) {
  const num = soDigitos(carga).replace(/^0+(?=\d)/, '');
  const rotulos = Array.isArray(ROTULOS.cargaHoraria) ? ROTULOS.cargaHoraria : [ROTULOS.cargaHoraria];

  let alvo = null;
  if (SEL.cargaHoraria) {
    alvo = page.locator(SEL.cargaHoraria).first();
  } else {
    const proximoCampo =
      'following::*[self::select or self::input[not(@type="hidden") and not(@type="radio") and not(@type="checkbox") and not(@type="submit") and not(@type="button") and not(@type="image")]][1]';
    for (const rotulo of rotulos) {
      const loc = page.locator(`xpath=(${xRotulo(rotulo)})[1]/${proximoCampo}`);
      if (await loc.count().catch(() => 0)) {
        alvo = loc.first();
        break;
      }
    }
  }
  if (!alvo) return { ok: false, motivo: `não achei o campo "${rotulos[0]}" na tela de Admissão` };

  const ehLista = await alvo.evaluate((el) => el.tagName === 'SELECT');
  if (ehLista) {
    const r = await alvo.evaluate((s, n) => {
      const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      const textos = [...s.options].map((o) => o.textContent.trim());
      const re = new RegExp(`(^|\\D)0*${n}(\\D|$)`);
      const i = textos.findIndex((x) => norm(x) !== '' && !norm(x).startsWith('--') && re.test(norm(x)));
      return { i, textos };
    }, num);
    if (r.i < 0) {
      const opcoes = r.textos.filter((x) => x && !/^(--|selecione)/i.test(x));
      return { ok: false, motivo: `não achei ${num} entre as opções: ${opcoes.join(' | ') || 'nenhuma'}` };
    }
    await alvo.selectOption({ index: r.i });
    return { ok: true, escolhida: r.textos[r.i] };
  }

  await preencherCampo(alvo, num);
  return { ok: true, escolhida: num };
}

async function preencherAdmissao(d) {
  // Usa a aba do SIRAC que já está aberta (se houver); só abre uma nova na primeira vez.
  let page = abaAberta('sirac');
  const reaproveitada = Boolean(page);
  if (page) {
    await page.bringToFront();
    if (!page.__aceitaSaida) {
      page.__aceitaSaida = true;
      // Se o SIRAC perguntar "deseja sair desta página?", aceita (os outros avisos seguem como antes).
      page.on('dialog', (dlg) => (dlg.type() === 'beforeunload' ? dlg.accept() : dlg.dismiss()).catch(() => {}));
    }
  } else {
    page = await novaAba();
    registrarAba('sirac', page); // a Substituição continua nesta mesma aba
  }
  await abrirFormularioAdmissao(page, d.cpf, { reaproveitada });

  // Etapa 4: formulário de Admissão
  // --- variáveis (vêm do formulário local) ---
  await preencherCampo(
    await exigir(campo(page, SEL.nome, ROTULOS.nome, 'input'), 'nome', ROTULOS.nome),
    d.nome
  );
  await preencherCampo(
    await exigir(campo(page, SEL.matricula, ROTULOS.matricula, 'input'), 'matricula', ROTULOS.matricula),
    d.matricula
  );
  await preencherCampo(
    await exigir(campo(page, SEL.classificacao, ROTULOS.classificacao, 'input'), 'classificacao', ROTULOS.classificacao),
    d.classificacao
  );
  await preencherCampo(
    await exigir(campo(page, SEL.nascimento, ROTULOS.nascimento, 'input'), 'nascimento', ROTULOS.nascimento),
    paraDDMMAAAA(d.dataNascimento),
    { mascara: true }
  );
  await (
    await exigir(radio(page, SEL.sexo[d.sexo], ROTULOS.sexo, d.sexo), 'sexo', ROTULOS.sexo)
  ).check();

  // --- fixos (listas) ---
  for (const chave of ['nacionalidade', 'escolaridade', 'aptidao']) {
    const select = await exigir(campo(page, SEL[chave], ROTULOS[chave], 'select'), chave, ROTULOS[chave]);
    await selecionarOpcao(select, FIXOS[chave], chave);
  }

  // --- fixos (Sim/Não) ---
  for (const chave of ['acumulacao', 'quitacaoEleitoral', 'declaracaoBens', 'subJudice']) {
    const opcao = FIXOS[chave];
    await (
      await exigir(radio(page, SEL[chave][opcao], ROTULOS[chave], opcao), chave, ROTULOS[chave])
    ).check();
  }

  // --- Datas do contrato (vêm do Período da carência, buscado no formulário local) ---
  for (const [chave, valor] of [['dataAssinatura', d.dataAssinatura], ['dataTermino', d.dataTermino]]) {
    if (!valor) continue;
    await preencherCampo(
      await exigir(campo(page, SEL[chave], ROTULOS[chave], 'input'), chave, ROTULOS[chave]),
      valor,
      { mascara: true }
    );
  }

  // --- Turno (escolhido na tela do programa; em branco = não preenche) ---
  const pendencias = [];
  if (d.turno) {
    try {
      const r = await preencherTurno(page, d.turno);
      if (!r.ok) pendencias.push(`Turno (${r.motivo}; escolha ${d.turno} à mão)`);
    } catch (err) {
      pendencias.push(`Turno (${err.message.split('\n')[0]}; escolha ${d.turno} à mão)`);
    }
  }

  // --- Carga Horária (digitada na tela do programa; em branco = não preenche) ---
  if (d.cargaHoraria) {
    try {
      const r = await preencherCargaHoraria(page, d.cargaHoraria);
      if (!r.ok) pendencias.push(`Carga Horária (${r.motivo}; coloque ${d.cargaHoraria} à mão)`);
    } catch (err) {
      pendencias.push(`Carga Horária (${err.message.split('\n')[0]}; coloque ${d.cargaHoraria} à mão)`);
    }
  }

  // Deixa a aba na frente para você conferir. Não salva.
  await page.bringToFront();
  return { pendencias };
}

module.exports = { preencherAdmissao, abrirFormularioAdmissao, aguardar, preencherCampo };