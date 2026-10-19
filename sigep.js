// sigep.js
// Pesquisa o servidor pelo CPF na tela "Localizar Servidor" do SIGEP.
// Fluxo da tela: digitar o CPF -> Buscar -> lista "Registros Localizados"
// (cada linha: "7064.184-6 NOME (LOTAÇÃO/Fone:...)") -> clicar na linha -> ficha com
// os campos Matrícula e Nascimento.
// A(s) matrícula(s) vêm da lista; a data de nascimento vem da ficha.

const { obterAba } = require('./navegador');
const { acharLogin, preencherLogin } = require('./login');
const { URL_SIGEP, SIGEP } = require('./config');
const cancelamento = require('./cancelamento');

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// Matrícula como aparece na lista do SIGEP: "7064.184-6" ou "7065.686-X" (o último dígito pode ser a letra X).
const MAT = String.raw`\d[\d.]*(?:-[\dXx])?`;
const RE_LINHA = new RegExp(String.raw`^\s*${MAT}\s+\S`);
const RE_MATRICULA = new RegExp(String.raw`^\s*(${MAT})`);
const RE_MATRICULA_NOME = new RegExp(String.raw`^\s*(${MAT})\s+([^(]+)`);

// 21/04/1994 -> 1994-04-21
const paraISO = (br) => br.split('/').reverse().join('-');

// Lê da ficha a matrícula e o nascimento. Acha o campo pelo rótulo ("Nascimento") e,
// para o nascimento, também pelo nome/id do campo. Se a página estiver trocando de tela
// no meio da leitura, devolve vazio e quem chamou tenta de novo.
async function lerFicha(page) {
  try {
    return await page.evaluate(() => {
      const valorDe = (el) => {
        if (!el) return '';
        if (el.tagName === 'SELECT') return (el.selectedOptions[0]?.textContent || '').trim();
        return (el.value || '').trim();
      };

      // Procura os rótulos cujo texto bate com a expressão e devolve o primeiro campo preenchido
      // que vem logo depois (ou o campo ligado ao rótulo por "for").
      const campoDoRotulo = (regex) => {
        const rotulos = [...document.querySelectorAll('body *')].filter(
          (el) =>
            el.children.length === 0 &&
            el.textContent.trim().length < 30 &&
            regex.test(el.textContent.trim())
        );
        for (const rot of rotulos) {
          let campo = rot.control || null;
          let pai = rot.parentElement;
          for (let i = 0; i < 3 && pai && !campo; i++, pai = pai.parentElement) {
            campo =
              [...pai.querySelectorAll('input, select, textarea')].find(
                (c) => rot.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING
              ) || null;
          }
          const v = valorDe(campo);
          if (v) return v;
        }
        return '';
      };

      const campoPorNome = (parte) =>
        valorDe(document.querySelector(`input[id*="${parte}" i], input[name*="${parte}" i]`));

      return {
        matricula: campoDoRotulo(/^matr[ií]cula$/i),
        nascimento: campoDoRotulo(/^nasc(imento)?\.?$/i) || campoPorNome('nasc'),
        cpf: campoDoRotulo(/^cpf$/i) || campoPorNome('cpf'),
      };
    });
  } catch {
    return { matricula: '', nascimento: '', cpf: '' };
  }
}

// Aceita 21/04/1994, 1994-04-21 ou data com hora, e devolve dd/mm/aaaa (ou '').
function normalizarData(texto) {
  const br = String(texto || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[1]}/${br[2]}/${br[3]}`;
  const iso = String(texto || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return '';
}

// Espera a ficha do servidor clicado carregar e devolve a data de nascimento (dd/mm/aaaa) ou ''.
// Se a matrícula da ficha for legível, só aceita a da linha clicada (evita ler a ficha da
// busca anterior). Se não der para ler a matrícula, aceita depois de 3 segundos.
async function lerNascimentoDaFicha(page, matriculaEsperada, limiteMs = 15000) {
  const inicio = Date.now();
  let ultimo = { matricula: '', nascimento: '' };

  while (Date.now() - inicio < limiteMs) {
    cancelamento.verificar();
    ultimo = await lerFicha(page);
    const data = normalizarData(ultimo.nascimento);
    const mat = soDigitos(ultimo.matricula);
    const fichaCerta = mat ? mat === matriculaEsperada : Date.now() - inicio > 3000;
    if (data && fichaCerta) return data;
    await page.waitForTimeout(300);
  }

  console.log(
    `SIGEP: não consegui ler o nascimento. Matrícula da ficha: ${
      ultimo.matricula ? 'achada' : 'não achada'
    }; nascimento: ${ultimo.nascimento ? 'achado, mas fora do formato esperado' : 'não achado'}.`
  );
  return '';
}

// Tempo que o programa espera você chegar à tela "Localizar Servidor".
const ESPERA_MS = 180000;

// Espera a tela "Localizar Servidor". Quando o formulário de login aparece, o programa
// preenche a matrícula e a senha do .env, mas NÃO clica em Entrar: o reCAPTCHA
// ("Não sou um robô") é com você. Depois do login, ele abre o menu 02.CADASTRO sozinho.
async function prepararTela(page) {
  const campo = page.getByPlaceholder(SIGEP.placeholderBusca);
  const usuario = process.env.SIGEP_USUARIO || process.env.EDUCADF_USUARIO;
  const senha = process.env.SIGEP_SENHA;
  const temCredenciais = Boolean(usuario && senha);

  console.log(`SIGEP: aba aberta. Se pedir login, marque "Não sou um robô" e clique em Entrar na janela.`);

  const inicio = Date.now();
  let tentativas = 0;
  let preencheu = false;
  let cliqueiMenu = false;
  let avisouSemCredenciais = false;

  while (Date.now() - inicio < ESPERA_MS) {
    cancelamento.verificar();
    if (await campo.isVisible().catch(() => false)) {
      console.log('SIGEP: tela Localizar Servidor aberta.');
      return;
    }

    const frame = await acharLogin(page);

    if (frame && !preencheu && tentativas < 3) {
      if (!temCredenciais) {
        if (!avisouSemCredenciais) {
          console.log(
            'SIGEP: achei a tela de login, mas SIGEP_SENHA (e a matrícula) não foram lidos do .env. Entre à mão na janela.'
          );
          avisouSemCredenciais = true;
        }
      } else {
        try {
          const r = await preencherLogin(frame, usuario, senha, { clicarEntrar: false });
          console.log(
            `SIGEP: ${r.temUsuario ? 'login e senha preenchidos' : 'só a senha foi preenchida (não achei o campo de login)'}. Marque "Não sou um robô" e clique em Entrar.`
          );
          preencheu = true;
        } catch (err) {
          tentativas += 1;
          console.log(`SIGEP: não consegui preencher o login (${err.message.split('\n')[0]}).`);
        }
      }
    } else if (!frame && !cliqueiMenu && (preencheu || Date.now() - inicio > 6000)) {
      // Sem tela de login e fora da busca: abre "Localizar Servidor" pelo menu 02.CADASTRO.
      const menu = page.getByText(SIGEP.menuBusca).filter({ visible: true }).first();
      if (await menu.count().catch(() => 0)) {
        console.log('SIGEP: abrindo "Localizar Servidor" pelo menu 02.CADASTRO.');
        await menu.click({ timeout: 5000 }).catch(() => {});
        cliqueiMenu = true;
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    'a tela "Localizar Servidor" não apareceu em 3 minutos. Na janela do SIGEP, entre (com o "Não sou um robô") e abra 02.CADASTRO; depois clique em Buscar dados de novo.'
  );
}

async function buscarNoSigep(cpf) {
  const digitos = soDigitos(cpf);

  if (!URL_SIGEP) {
    throw new Error(
      'URL_SIGEP está vazia no config.js. Copie da barra de endereço o link da tela de login do SIGEP e cole lá.'
    );
  }
  const page = await obterAba('sigep', URL_SIGEP);

  await prepararTela(page);

  const campo = page.getByPlaceholder(SIGEP.placeholderBusca);

  await campo.fill(digitos);
  await page
    .locator('button, a, input[type="submit"], input[type="button"]')
    .filter({ hasText: /^\s*Buscar\s*$/ })
    .first()
    .click();

  // Espera o título da lista com o CPF buscado (evita ler a lista da busca anterior).
  try {
    await page
      .getByText(`Registros Localizados com argumento "${digitos}"`)
      .first()
      .waitFor({ state: 'visible', timeout: 20000 });
  } catch {
    throw new Error('Servidor não encontrado no SIGEP para esse CPF.');
  }

  // Linhas da lista: começam com a matrícula (ex.: "7064.184-6 BARBARA LOPES...")
  const itens = page.getByText(RE_LINHA);
  const textos = await itens.allInnerTexts();
  const matriculas = [
    ...new Set(textos.map((t) => soDigitos(t.match(RE_MATRICULA)[1]))),
  ].filter(Boolean);

  if (!matriculas.length) {
    throw new Error('Servidor não encontrado no SIGEP para esse CPF.');
  }

  const comLetra = textos.map((x) => (x.match(RE_MATRICULA) || [])[1]).filter((m) => m && /x$/i.test(m));
  const nota = comLetra.length
    ? `A matrícula do SIGEP termina em X (${comLetra[0]}); o programa usou só os números (${soDigitos(comLetra[0])}). Confira como o SIRAC pede.`
    : '';

  // Abre a primeira linha para ler a data de nascimento (é a mesma pessoa em todos os vínculos).
  // Se a ficha não abrir (clique que não pegou, tela ainda atualizando), tenta de novo até 3 vezes.
  console.log(`SIGEP: lista com ${matriculas.length} matrícula(s); abrindo a primeira linha.`);
  let nasc = '';
  for (let tentativa = 1; tentativa <= 3 && !nasc; tentativa++) {
    cancelamento.verificar();
    const linha = itens.first();
    await linha.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    try {
      await linha.click({ timeout: 5000 });
    } catch {
      await linha.click({ force: true, timeout: 5000 }).catch(() => {});
    }
    nasc = await lerNascimentoDaFicha(page, matriculas[0], tentativa === 1 ? 15000 : 8000);
    if (!nasc) console.log(`SIGEP: a tentativa ${tentativa} de abrir a ficha não trouxe o nascimento.`);
  }

  return {
    nota,
    matriculas, // pode ter mais de uma (mais de um vínculo)
    dataNascimento: nasc ? paraISO(nasc) : '',
    aviso: nasc ? '' : 'SIGEP: achei a matrícula, mas não consegui ler a data de nascimento na ficha.',
  };
}

// ---------- busca pelo NOME (usada na Substituição, para achar o professor titular) ----------

const normaliza = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Espera a ficha do servidor clicado carregar e devolve o CPF (só dígitos) ou ''.
async function lerCpfDaFicha(page, matriculaEsperada) {
  const inicio = Date.now();
  let ultimo = { matricula: '', cpf: '' };

  while (Date.now() - inicio < 15000) {
    cancelamento.verificar();
    ultimo = await lerFicha(page);
    const cpf = soDigitos(ultimo.cpf);
    const mat = soDigitos(ultimo.matricula);
    const fichaCerta = mat ? mat === matriculaEsperada : Date.now() - inicio > 3000;
    if (cpf.length === 11 && fichaCerta) return cpf;
    await page.waitForTimeout(300);
  }

  console.log(
    `SIGEP: não consegui ler o CPF na ficha. Matrícula da ficha: ${ultimo.matricula ? 'achada' : 'não achada'}; CPF: ${
      ultimo.cpf ? 'achado, mas fora do formato esperado' : 'não achado'
    }.`
  );
  return '';
}

// Pesquisa um servidor pelo NOME na tela "Localizar Servidor" e devolve nome, CPF e matrícula(s).
// Se houver mais de uma linha com o mesmo nome (homônimos ou mais de um vínculo), usa a primeira
// e avisa para você conferir.
async function buscarServidorPorNome(nome) {
  const alvo = normaliza(nome);
  if (!alvo) throw new Error('Nome do titular vazio.');

  if (!URL_SIGEP) {
    throw new Error('URL_SIGEP está vazia no config.js.');
  }
  const page = await obterAba('sigep', URL_SIGEP);
  await prepararTela(page);

  const campo = page.getByPlaceholder(SIGEP.placeholderBusca);
  await campo.fill(nome);
  await page
    .locator('button, a, input[type="submit"], input[type="button"]')
    .filter({ hasText: /^\s*Buscar\s*$/ })
    .first()
    .click();

  // Espera o título da lista com o nome buscado (evita ler a lista da busca anterior).
  try {
    await page
      .getByText(new RegExp(`Registros Localizados com argumento\\s*"${escaparRegex(nome.trim())}"`, 'i'))
      .first()
      .waitFor({ state: 'visible', timeout: 20000 });
  } catch {
    throw new Error('Titular não encontrado no SIGEP pelo nome (ou o SIGEP mostrou o nome de outro jeito).');
  }

  const itens = page.getByText(RE_LINHA);
  const textos = await itens.allInnerTexts();

  // Cada linha: "7064.184-6 NOME (LOTAÇÃO/Fone:...)"
  const linhas = textos
    .map((t, indice) => {
      const m = t.match(RE_MATRICULA_NOME);
      return m ? { indice, matricula: soDigitos(m[1]), nome: normaliza(m[2]) } : null;
    })
    .filter(Boolean);

  let candidatas = linhas.filter((l) => l.nome === alvo);
  if (!candidatas.length) candidatas = linhas.filter((l) => l.nome.includes(alvo) || alvo.includes(l.nome));
  if (!candidatas.length) throw new Error('Titular não encontrado no SIGEP pelo nome.');

  const avisos = [];
  const matriculas = [...new Set(candidatas.map((l) => l.matricula))];
  if (matriculas.length > 1) {
    avisos.push(`SIGEP: o nome do titular tem ${matriculas.length} matrículas (${matriculas.join(', ')}). Usei a primeira; confira se é a certa (pode haver homônimo).`);
  }

  const escolhida = candidatas[0];
  await itens.nth(escolhida.indice).click();
  const cpf = await lerCpfDaFicha(page, escolhida.matricula);
  if (!cpf) avisos.push('SIGEP: achei o titular, mas não consegui ler o CPF na ficha. Digite o CPF à mão.');

  return {
    nome: textos[escolhida.indice].match(RE_MATRICULA_NOME)[2].trim(),
    cpf,
    matricula: escolhida.matricula,
    matriculas,
    avisos,
  };
}

module.exports = { buscarNoSigep, buscarServidorPorNome };