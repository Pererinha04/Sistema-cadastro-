// localizarServidor.js
// Busca matrícula e dados pessoais pela tela EducaDF: Unidade Escolar > Localizar Servidor.
const { obterAba } = require('./navegador');
const { acharLogin, preencherLogin } = require('./login');
const { URL_LOCALIZAR_SERVIDOR } = require('./config');
const cancelamento = require('./cancelamento');

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const ESPERA_MS = 180000;

// A tela atual tem uma única caixa de busca larga. Os filtros Escola/Cargo e a
// busca lateral são menores; se a caixa principal não for reconhecida, não adivinhamos.
async function campoBuscaServidor(page) {
  const marcado = await page.evaluate(() => {
    document.querySelectorAll('[data-auto-busca-servidor]').forEach((el) => el.removeAttribute('data-auto-busca-servidor'));
    const visivel = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const campos = [...document.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"]')]
      .filter((el) => visivel(el)
        && !el.closest('aside, nav, [role="navigation"], [class*="sidebar"], [class*="side-nav"], [class*="sidenav"]')
        && !/localizar\.\.\./i.test(el.getAttribute('placeholder') || ''))
      .map((el) => ({ el, largura: el.getBoundingClientRect().width }))
      .sort((a, b) => b.largura - a.largura);
    const principal = campos.find((c) => c.largura >= 400)?.el;
    if (!principal) return false;
    principal.setAttribute('data-auto-busca-servidor', 'true');
    return true;
  }).catch(() => false);
  return marcado ? page.locator('[data-auto-busca-servidor="true"]').first() : null;
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

  if (!/[A-Za-zÀ-ú]/.test(nomeBusca)) {
    throw new Error('A busca de Localizar Servidor precisa receber o nome do servidor, não o CPF.');
  }

  // Limpa filtros que possam ter ficado com o CPF após uma tentativa anterior.
  const limparFiltros = page.getByText(/^Limpar$/i).filter({ visible: true }).first();
  if (await limparFiltros.count().catch(() => 0)) {
    await limparFiltros.click({ timeout: 3000 }).catch(() => {});
  }

  // A busca nova aceita só nome/matrícula. CPF nunca é escrito em campo algum desta tela.
  const buscaPrincipal = await campoBuscaServidor(page);
  if (!buscaPrincipal) {
    throw new Error('Não encontrei a caixa principal “nome ou matrícula” do Localizar Servidor. Nenhum filtro foi preenchido.');
  }
  console.log('EducaDF: pesquisando Localizar Servidor pelo nome na caixa principal.');
  await buscaPrincipal.fill(nomeBusca);

  const resultado = page.getByText(nomeBusca, { exact: false }).filter({ visible: true }).first();
  try {
    await resultado.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    throw new Error(`Servidor não encontrado no EducaDF pelo nome “${nomeBusca}”.`);
  }
  const abrirFicha = resultado;

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
