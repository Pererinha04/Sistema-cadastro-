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

// No Localizar Servidor o resultado é uma linha/cartão clicável que contém o nome.
// Marcar o próprio link/linha evita clicar em ocorrências no menu ou no cabeçalho.
async function acharResultadoClicavel(page, nome, cpf = '') {
  const marcado = await page.evaluate(({ nomeAlvo, cpfAlvo }) => {
    document.querySelectorAll('[data-auto-resultado-servidor]').forEach((el) => el.removeAttribute('data-auto-resultado-servidor'));
    const normalizar = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');
    const alvo = normalizar(nomeAlvo);
    const cpfDigitos = String(cpfAlvo || '').replace(/\D/g, '');
    if (!alvo) return false;
    const visivel = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const contemCpf = (el) => cpfDigitos.length === 11 && String(el.innerText || el.textContent || '').replace(/\D/g, '').includes(cpfDigitos);

    // Com CPF, o nome retornado por outro módulo pode estar abreviado ou diferente.
    // Encontre primeiro o cartão que contém o CPF da busca e use o link/nome desse cartão.
    if (cpfDigitos.length === 11) {
      const portadores = [...document.querySelectorAll('a, button, [role="link"], [role="button"], tr, [role="row"], span, div')]
        .filter((el) => visivel(el) && contemCpf(el))
        .sort((a, b) => (a.innerText || a.textContent || '').length - (b.innerText || b.textContent || '').length);
      for (const portador of portadores) {
        let cartao = portador;
        for (let nivel = 0; nivel < 7 && cartao.parentElement; nivel++) {
          const texto = cartao.innerText || cartao.textContent || '';
          if (contemCpf(cartao) && texto.length > 20 && texto.length < 1200) break;
          cartao = cartao.parentElement;
        }
        const links = [...cartao.querySelectorAll('a, button, [role="link"], [role="button"]')]
          .filter((el) => visivel(el) && !contemCpf(el) && /[A-ZÀ-Ü]/i.test(el.innerText || el.textContent || ''));
        const nomeLink = links.sort((a, b) => (a.innerText || a.textContent || '').length - (b.innerText || b.textContent || '').length)[0];
        const alvoClique = nomeLink || portador;
        alvoClique.setAttribute('data-auto-resultado-servidor', 'true');
        return true;
      }
    }

    // Busca por nome (usada quando a rotina procura o titular sem CPF).
    // A lista nova do EducaDF não marca necessariamente o resultado como link/linha.
    // O texto do nome pode estar num span/div dentro do cartão clicável.
    const candidatos = [...document.querySelectorAll('a, button, [role="link"], [role="button"], tr, [role="row"], span, div')]
      .filter((el) => visivel(el) && normalizar(el.innerText || el.textContent).includes(alvo))
      .sort((a, b) => {
        const at = normalizar(a.innerText || a.textContent);
        const bt = normalizar(b.innerText || b.textContent);
        return (at === alvo ? 0 : 1) - (bt === alvo ? 0 : 1) || at.length - bt.length;
      });
    const resultado = candidatos[0];
    if (!resultado) return false;
    resultado.setAttribute('data-auto-resultado-servidor', 'true');
    return true;
  }, { nomeAlvo: nome, cpfAlvo: cpf }).catch(() => false);
  return marcado ? page.locator('[data-auto-resultado-servidor="true"]').first() : null;
}

async function aguardarResultadoClicavel(page, nome, cpf = '', timeout = 15000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeout) {
    cancelamento.verificar();
    const resultado = await acharResultadoClicavel(page, nome, cpf);
    if (resultado) return resultado;
    await page.waitForTimeout(250);
  }
  return null;
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

  const termoBusca = cpfBusca || nomeBusca;

  // Limpa filtros que possam ter ficado com o CPF após uma tentativa anterior.
  const limparFiltros = page.getByText(/^Limpar$/i).filter({ visible: true }).first();
  if (await limparFiltros.count().catch(() => 0)) {
    await limparFiltros.click({ timeout: 3000 }).catch(() => {});
  }

  // Quando o fluxo já tem o CPF, pesquisa por ele na caixa principal. O nome continua
  // sendo usado para identificar e abrir o resultado correspondente.
  const buscaPrincipal = await campoBuscaServidor(page);
  if (!buscaPrincipal) {
    throw new Error('Não encontrei a caixa principal de busca do Localizar Servidor. Nenhum filtro foi preenchido.');
  }
  console.log(`EducaDF: pesquisando Localizar Servidor pelo ${cpfBusca ? 'CPF' : 'nome'} na caixa principal.`);
  await buscaPrincipal.fill(termoBusca);

  const abrirFicha = await aguardarResultadoClicavel(page, nomeBusca, cpfBusca);
  if (!abrirFicha) {
    throw new Error(cpfBusca
      ? 'O EducaDF encontrou a busca, mas não consegui identificar a linha pelo CPF para abrir a ficha.'
      : 'O EducaDF não exibiu um resultado clicável para o servidor pesquisado. Confira o nome e tente novamente.');
  }

  const urlFicha = /\/(?:localizar-servidor\/ficha|cadastro\/ficha-unificada)\//;
  await abrirFicha.click({ timeout: 10000 });
  let abriu = await page.waitForURL(urlFicha, { timeout: 8000 }).then(() => true).catch(() => false);
  if (!abriu) {
    // A tela informa que Enter abre a ficha após selecionar o resultado. Usar
    // a navegação por teclado como fallback para cartões com clique customizado.
    console.log('EducaDF: clique no nome não abriu a ficha; selecionando o resultado com seta e Enter.');
    const busca = await campoBuscaServidor(page);
    if (busca) {
      await busca.press('ArrowDown').catch(() => {});
      await busca.press('Enter').catch(() => {});
      abriu = await page.waitForURL(urlFicha, { timeout: 12000 }).then(() => true).catch(() => false);
    }
  }
  if (!abriu) throw new Error('O resultado do servidor apareceu, mas o EducaDF não abriu a ficha após clicar no nome/pressionar Enter.');
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
