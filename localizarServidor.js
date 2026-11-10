// localizarServidor.js
// Busca matrícula e dados pessoais pela tela EducaDF: Unidade Escolar > Localizar Servidor.
const { obterAba } = require('./navegador');
const { acharLogin, preencherLogin } = require('./login');
const { URL_LOCALIZAR_SERVIDOR } = require('./config');
const cancelamento = require('./cancelamento');

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const normaliza = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const ESPERA_MS = 180000;

// A tela nova tem uma busca única com resultados enquanto digita. O campo antigo
// de nome/matrícula/CPF ainda é reconhecido para instalações que não receberam a atualização.
async function campoBuscaServidor(page) {
  // Na interface nova, o indício está junto da busca principal. Encontra o campo
  // pelo texto da própria tela para não confundir com os filtros de Escola/Cargo
  // nem com a busca lateral do menu.
  const marcado = await page.evaluate(() => {
    const normaliza = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const possuiDica = (el) => {
      const texto = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ');
      const t = normaliza(texto);
      return t.includes('nome ou matricula') && t.includes('resultado enquanto digita');
    };
    const dica = [...document.querySelectorAll('body *')].find(possuiDica);
    if (!dica) return false;
    document.querySelectorAll('[data-auto-busca-servidor]').forEach((el) => el.removeAttribute('data-auto-busca-servidor'));
    for (let pai = dica; pai && pai !== document.body; pai = pai.parentElement) {
      const campo = pai.matches('input:not([type="hidden"]), textarea, [contenteditable="true"]')
        ? pai
        : pai.querySelector('input:not([type="hidden"]), textarea, [contenteditable="true"]');
      if (campo) {
        campo.setAttribute('data-auto-busca-servidor', 'true');
        return true;
      }
    }
    return false;
  }).catch(() => false);
  if (marcado) return page.locator('[data-auto-busca-servidor="true"]').first();

  // Compatibilidade com versões anteriores: aceita apenas campos identificados
  // explicitamente por nome, matrícula ou rótulo acessível. Nunca adivinha Escola.
  const inputs = page.locator('input:visible');
  const metadados = await inputs.evaluateAll((els) => els.map((el) => ({
    placeholder: el.getAttribute('placeholder') || '',
    name: el.getAttribute('name') || '',
    id: el.id || '',
    aria: el.getAttribute('aria-label') || '',
    lateral: Boolean(el.closest('aside, nav, [role="navigation"], [class*="sidebar"], [class*="side-nav"], [class*="sidenav"]')),
  })));
  const antigoMatricula = metadados.findIndex((m) => {
    const texto = `${m.placeholder} ${m.name} ${m.id} ${m.aria}`;
    return /matr[ií]cula/i.test(texto) && !/nome\s+ou\s+matr[ií]cula|resultado enquanto digita/i.test(texto);
  });
  if (antigoMatricula > 0) return inputs.nth(antigoMatricula - 1);
  const candidatos = metadados.map((m, i) => ({ ...m, i })).filter((m) =>
    !m.lateral && !/localizar\.\.\./i.test(m.placeholder) && /nome|servidor/i.test(`${m.placeholder} ${m.name} ${m.id} ${m.aria}`)
  );
  const indice = candidatos[0]?.i ?? -1;
  return indice >= 0 ? inputs.nth(indice) : null;
}

async function abrirPeloMenu(page) {
  try {
    let item = page.getByText('Localizar Servidor', { exact: true }).filter({ visible: true }).first();
    if (!(await item.isVisible().catch(() => false))) {
      const unidade = page.getByText('Unidade Escolar', { exact: true }).filter({ visible: true }).first();
      if (await unidade.isVisible().catch(() => false)) {
        await unidade.click({ timeout: 4000 });
        await page.waitForTimeout(400);
      }
      item = page.getByText('Localizar Servidor', { exact: true }).filter({ visible: true }).first();
    }
    if (await item.isVisible().catch(() => false)) {
      await item.click({ timeout: 5000 });
      await page.waitForTimeout(800);
      return true;
    }
  } catch {}
  return false;
}

async function prepararTela(page) {
  const pronta = async () => page.url().includes('/localizar-servidor') && Boolean(await campoBuscaServidor(page));
  if (await pronta()) return;

  if (!(await abrirPeloMenu(page)) || !(await pronta())) {
    await page.goto(URL_LOCALIZAR_SERVIDOR).catch(() => {});
  }

  const inicio = Date.now();
  let preencheuLogin = false;
  while (Date.now() - inicio < ESPERA_MS) {
    cancelamento.verificar();
    if (await pronta()) return;

    const frame = await acharLogin(page);
    if (frame && !preencheuLogin) {
      const { EDUCADF_USUARIO, EDUCADF_SENHA } = process.env;
      if (EDUCADF_USUARIO && EDUCADF_SENHA) {
        await preencherLogin(frame, EDUCADF_USUARIO, EDUCADF_SENHA).catch(() => {});
        preencheuLogin = true;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error('A tela Unidade Escolar > Localizar Servidor não abriu no EducaDF. Entre no sistema e tente novamente.');
}

async function lerFicha(page) {
  const abaFuncionais = page.getByText(/^(Dados Funcionais|Funcional)$/i).first();
  await abaFuncionais.click({ timeout: 8000 });
  await page.getByText(/^(DADOS FUNCIONAIS|Vínculo e jornada)$/i).last().waitFor({ state: 'visible', timeout: 10000 });
  const matricula = await page.evaluate(() => {
    const texto = document.body.innerText;
    const encontrados = [...texto.matchAll(/\bMatr[ií]cula\s*:?\s*(\d{5,})/gi)];
    return encontrados.length ? encontrados[encontrados.length - 1][1] : '';
  });

  const abaPessoais = page.getByText(/^(Dados Pessoais|Pessoal)$/i).first();
  await abaPessoais.click({ timeout: 8000 });
  await page.getByText(/^(Nome Completo|Dados Pessoais)$/i).first().waitFor({ state: 'visible', timeout: 10000 });
  const dadosPessoais = await page.evaluate(() => {
    const linhas = document.body.innerText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const campo = (...rotulos) => {
      const desejados = rotulos.map(semAcento);
      // Procura de baixo para cima para priorizar o valor da aba atual sobre
      // o CPF mascarado do cabeçalho fixo da ficha.
      for (let i = linhas.length - 1; i >= 0; i--) {
        const atual = semAcento(linhas[i]);
        const igual = desejados.includes(atual);
        const prefixo = desejados.find((r) => atual.startsWith(`${r} `) || atual.startsWith(`${r}:`));
        if (prefixo) return linhas[i].slice(prefixo.length).replace(/^\s*:?\s*/, '').trim();
        if (igual && i + 1 < linhas.length) return linhas[i + 1];
      }
      return '';
    };
    return {
      nome: campo('Nome Completo'),
      cpf: campo('CPF'),
      sexo: campo('Sexo'),
      dataNascimento: campo('Data de Nascimento', 'Nascimento'),
    };
  });
  return { ...dadosPessoais, matricula };
}

function paraISO(data) {
  const br = String(data || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = String(data || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : '';
}

async function buscarServidor(nome, cpf = '') {
  const nomeBusca = String(nome || '').trim();
  const cpfBusca = soDigitos(cpf);
  if (!nomeBusca) throw new Error('O nome do servidor não foi informado.');
  if (cpfBusca && cpfBusca.length !== 11) throw new Error('O CPF precisa ter 11 dígitos.');

  const page = await obterAba('educadf', URL_LOCALIZAR_SERVIDOR);
  await prepararTela(page);
  cancelamento.verificar();

  // Se a tela antiga ainda estiver disponível, mantém o fluxo de três campos.
  const buscaPrincipal = await campoBuscaServidor(page);
  const telaNova = Boolean(await buscaPrincipal?.getAttribute('data-auto-busca-servidor').catch(() => null));
  const campos = page.locator('input:visible');
  const metadados = await campos.evaluateAll((els) => els.map((el) => ({
    placeholder: el.getAttribute('placeholder') || '',
    name: el.getAttribute('name') || '',
    id: el.id || '',
    aria: el.getAttribute('aria-label') || '',
  })));
  const indiceMatricula = metadados.findIndex((m) => {
    const texto = `${m.placeholder} ${m.name} ${m.id} ${m.aria}`;
    return /matr[ií]cula/i.test(texto) && !/nome\s+ou\s+matr[ií]cula|resultado enquanto digita/i.test(texto);
  });
  let abrirFicha;
  if (!telaNova && indiceMatricula > 0 && indiceMatricula + 1 < metadados.length) {
    await campos.nth(indiceMatricula - 1).fill(nomeBusca);
    if (cpfBusca) await campos.nth(indiceMatricula + 1).fill(cpfBusca);
    await page.getByRole('button', { name: /Filtrar/i }).first().click({ timeout: 8000 });
    const linhas = page.locator('tr, [role="row"]');
    const limite = Date.now() + 20000;
    let correspondentes = [];
    while (Date.now() < limite) {
      cancelamento.verificar();
      const quantidade = await linhas.count().catch(() => 0);
      for (let i = 0; i < quantidade; i++) {
        const linha = linhas.nth(i);
        const texto = await linha.innerText().catch(() => '');
        const bate = cpfBusca
          ? soDigitos(texto).includes(cpfBusca)
          : normaliza(texto).includes(normaliza(nomeBusca));
        if (bate) correspondentes.push(linha);
      }
      if (correspondentes.length) break;
      await page.waitForTimeout(300);
    }
    if (!correspondentes.length) {
      throw new Error(cpfBusca ? 'Servidor não encontrado no EducaDF para esse nome e CPF.' : 'Servidor não encontrado no EducaDF pelo nome.');
    }
    const primeiraLinha = correspondentes[0];
    const link = primeiraLinha.locator('a').first();
    abrirFicha = await link.count() ? link : primeiraLinha.getByText(nomeBusca, { exact: false }).first();
  } else {
    const busca = buscaPrincipal;
    if (!busca) throw new Error('Não encontrei o campo de busca por nome na tela Localizar Servidor.');
    await busca.fill(nomeBusca);
    const resultado = page.getByText(nomeBusca, { exact: false }).filter({ visible: true }).first();
    try {
      await resultado.waitFor({ state: 'visible', timeout: 15000 });
    } catch {
      throw new Error(`Servidor não encontrado no EducaDF pelo nome “${nomeBusca}”.`);
    }
    abrirFicha = resultado;
  }

  await abrirFicha.click({ timeout: 8000 });
  await page.waitForURL(/\/(?:localizar-servidor\/ficha|cadastro\/ficha-unificada)\//, { timeout: 15000 });
  cancelamento.verificar();

  const ficha = await lerFicha(page);
  const cpfLido = soDigitos(ficha.cpf);
  const cpfFicha = cpfLido.length === 11 ? cpfLido : '';
  // Matrícula vem da aba Dados Funcionais da ficha aberta, não da linha de resultados.
  const matriculaFuncional = soDigitos(ficha.matricula);
  const matriculas = matriculaFuncional ? [matriculaFuncional] : [];
  if (cpfBusca && cpfFicha && cpfFicha !== cpfBusca) {
    throw new Error('O CPF da ficha aberta não corresponde ao CPF pesquisado. A busca foi interrompida para evitar usar dados de outra pessoa.');
  }
  const avisos = [];
  if (!cpfFicha && !cpfBusca) avisos.push('O EducaDF exibiu o CPF mascarado; não consegui obter os 11 dígitos na ficha.');
  if (!matriculas.length) avisos.push('Não consegui ler a matrícula na aba Dados Funcionais da ficha do servidor.');
  const dataNascimento = paraISO(ficha.dataNascimento);
  if (!dataNascimento) avisos.push('Não consegui ler a data de nascimento na ficha do servidor.');
  const sexo = /^feminino$/i.test(ficha.sexo) ? 'Feminino' : /^masculino$/i.test(ficha.sexo) ? 'Masculino' : '';
  if (!sexo) avisos.push('Não consegui identificar o sexo na ficha do servidor.');

  return {
    nome: ficha.nome || nomeBusca,
    cpf: cpfFicha || cpfBusca,
    matriculas,
    matricula: matriculas[0] || '',
    dataNascimento,
    sexo,
    avisos,
  };
}

async function buscarNoLocalizarServidor(nome, cpf) {
  return buscarServidor(nome, cpf);
}

async function buscarServidorPorNome(nome) {
  return buscarServidor(nome, '');
}

module.exports = { buscarNoLocalizarServidor, buscarServidorPorNome };
