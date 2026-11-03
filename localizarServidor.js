// localizarServidor.js
// Busca matrícula e dados pessoais pela tela EducaDF: Unidade Escolar > Localizar Servidor.
const { obterAba } = require('./navegador');
const { acharLogin, preencherLogin } = require('./login');
const { URL_LOCALIZAR_SERVIDOR } = require('./config');
const cancelamento = require('./cancelamento');

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const normaliza = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const ESPERA_MS = 180000;

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
  const matricula = page.getByPlaceholder(/matr[ií]cula/i).first();
  const pronta = async () => page.url().includes('/localizar-servidor') && await matricula.isVisible().catch(() => false);
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
  const abaFuncionais = page.getByText('Dados Funcionais', { exact: true }).first();
  await abaFuncionais.click({ timeout: 8000 });
  await page.getByText('DADOS FUNCIONAIS', { exact: true }).last().waitFor({ state: 'visible', timeout: 10000 });
  const matricula = await page.evaluate(() => {
    const linhas = document.body.innerText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    // Usa a última ocorrência: a navegação lateral também contém o item "Matrícula".
    let indice = -1;
    for (let i = linhas.length - 2; i >= 0; i--) {
      if (/^matr[ií]cula$/i.test(linhas[i])) { indice = i; break; }
    }
    return indice >= 0 ? linhas[indice + 1] || '' : '';
  });

  const abaPessoais = page.getByText('Dados Pessoais', { exact: true }).first();
  await abaPessoais.click({ timeout: 8000 });
  await page.getByText('Nome Completo', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 });
  const dadosPessoais = await page.evaluate(() => {
    const linhas = document.body.innerText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const campo = (...rotulos) => {
      const desejados = rotulos.map(semAcento);
      for (let i = 0; i < linhas.length - 1; i++) {
        if (desejados.includes(semAcento(linhas[i]))) return linhas[i + 1];
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

  // Os campos principais aparecem nesta ordem: nome, matrícula, CPF. A matrícula serve como referência estável.
  const campos = page.locator('input:visible');
  const metadados = await campos.evaluateAll((els) => els.map((el) => ({
    placeholder: el.getAttribute('placeholder') || '',
    name: el.getAttribute('name') || '',
    id: el.id || '',
    aria: el.getAttribute('aria-label') || '',
  })));
  const indiceMatricula = metadados.findIndex((m) => /matr[ií]cula/i.test(`${m.placeholder} ${m.name} ${m.id} ${m.aria}`));
  if (indiceMatricula < 1 || indiceMatricula + 1 >= metadados.length) {
    throw new Error('Não encontrei os campos de nome, matrícula e CPF na tela Localizar Servidor.');
  }
  await campos.nth(indiceMatricula - 1).fill(nomeBusca);
  if (cpfBusca) await campos.nth(indiceMatricula + 1).fill(cpfBusca);

  await page.getByRole('button', { name: /Filtrar/i }).first().click({ timeout: 8000 });
  const linhas = page.locator('tr, [role="row"]');
  const correspondentes = [];
  const limite = Date.now() + 20000;
  while (Date.now() < limite) {
    cancelamento.verificar();
    const quantidade = await linhas.count().catch(() => 0);
    for (let i = 0; i < quantidade; i++) {
      const linha = linhas.nth(i);
      const texto = await linha.innerText().catch(() => '');
      const bate = cpfBusca
        ? soDigitos(texto).includes(cpfBusca)
        : normaliza(texto).includes(normaliza(nomeBusca));
      if (bate) correspondentes.push({ linha, texto });
    }
    if (correspondentes.length) break;
    await page.waitForTimeout(300);
  }
  if (!correspondentes.length) {
    throw new Error(cpfBusca ? 'Servidor não encontrado no EducaDF para esse nome e CPF.' : 'Servidor não encontrado no EducaDF pelo nome.');
  }

  const primeiraLinha = correspondentes[0].linha;
  const link = primeiraLinha.locator('a').first();
  if (await link.count()) await link.click({ timeout: 8000 });
  else await primeiraLinha.getByText(nomeBusca, { exact: false }).first().click({ timeout: 8000 });
  await page.waitForURL(/\/localizar-servidor\/ficha\//, { timeout: 15000 });
  cancelamento.verificar();

  const ficha = await lerFicha(page);
  const cpfFicha = soDigitos(ficha.cpf);
  // Matrícula vem da aba Dados Funcionais da ficha aberta, não da linha de resultados.
  const matriculaFuncional = soDigitos(ficha.matricula);
  const matriculas = matriculaFuncional ? [matriculaFuncional] : [];
  if (cpfBusca && cpfFicha && cpfFicha !== cpfBusca) {
    throw new Error('O CPF da ficha aberta não corresponde ao CPF pesquisado. A busca foi interrompida para evitar usar dados de outra pessoa.');
  }
  const avisos = [];
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
