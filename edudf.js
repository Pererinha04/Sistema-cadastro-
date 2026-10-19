// edudf.js
// Lê nome, CPF e classificação do candidato na tela "Banco de Aprovado" do EducaDF.
// Antes da primeira busca, deixe na tela os filtros de Edital, Especialidade e Turno
// escolhidos (o programa só preenche o CPF e clica em Filtrar).

const { obterAba } = require('./navegador');
const { acharLogin, preencherLogin } = require('./login');
const { URL_EDUCADF, EDUCADF } = require('./config');
const cancelamento = require('./cancelamento');

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// Tempo que o programa espera você chegar ao Banco de Aprovado (clicar em Servidor,
// fazer o login se precisar e abrir Modulação > Banco de Aprovado).
const ESPERA_MS = 180000;

// Endereço da aba sem os parâmetros (que podem ter códigos de sessão), só para o log.
function onde(page) {
  try {
    const u = new URL(page.url());
    return u.host + u.pathname;
  } catch {
    return 'aba em branco';
  }
}

async function estaVisivel(locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false; // a página estava trocando de tela
  }
}

// Fecha janelas/painéis que tenham ficado abertos por cima da tela (ex.: "Horários da Carência"
// da Substituição), porque eles bloqueiam o clique no menu lateral.
async function fecharSobreposicoes(page) {
  try {
    const aberta = page
      .locator('[role="dialog"], .modal.show, .offcanvas.show')
      .filter({ visible: true })
      .first();
    if (!(await estaVisivel(aberta))) return;
    const fechar = aberta.getByRole('button', { name: /fechar|voltar|cancelar|close|×/i }).first();
    if (await fechar.count()) await fechar.click({ timeout: 2000 });
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    if (await estaVisivel(aberta)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  } catch {
    // se não deu para fechar, o clique do menu avisa no log
  }
}

// Clica em Modulação (se o grupo ainda estiver fechado) e em Banco de Aprovado no menu lateral.
// Devolve true se clicou no item final; false se o menu não estava na tela ou o clique falhou.
async function abrirBancoPeloMenu(page) {
  try {
    await fecharSobreposicoes(page);
    const [pai, filho] = EDUCADF.menu;
    const itemFilho = page.getByText(filho, { exact: true }).filter({ visible: true }).first();
    if (!(await estaVisivel(itemFilho))) {
      const itemPai = page.getByText(pai, { exact: true }).filter({ visible: true }).first();
      if (!(await estaVisivel(itemPai))) return false;
      await itemPai.click({ timeout: 3000 });
      await page.waitForTimeout(500);
    }
    await itemFilho.click({ timeout: 3000 });
    return true;
  } catch (err) {
    console.log(`EducaDF: o clique no menu falhou (${err.message.split('\n')[0]}).`);
    return false;
  }
}

// Espera a tela do Banco de Aprovado. Pelo caminho, VOCÊ clica em "Servidor" e depois em
// Modulação > Banco de Aprovado. Quando o formulário de login aparecer, o programa preenche
// a matrícula e a senha do .env e clica em Entrar (uma vez só).
async function prepararTela(page) {
  const campoCpf = page.getByPlaceholder(EDUCADF.placeholderCpf, { exact: true });
  const { EDUCADF_USUARIO, EDUCADF_SENHA } = process.env;
  const temCredenciais = Boolean(EDUCADF_USUARIO && EDUCADF_SENHA);

  console.log(
    `EducaDF: aba aberta em ${onde(page)}. Na janela: clique em "Servidor"; depois do login, abra Modulação > Banco de Aprovado.`
  );

  const inicio = Date.now();
  let tentativas = 0;
  let preencheu = false;
  let avisouSemCredenciais = false;
  let tentativasMenu = 0;
  let ultimoMenu = 0;
  let abriuPelaUrl = false;

  while (Date.now() - inicio < ESPERA_MS) {
    cancelamento.verificar();
    if (await estaVisivel(campoCpf)) {
      console.log('EducaDF: tela do Banco de Aprovado aberta.');
      return;
    }

    const frameLogin = await acharLogin(page);

    // A aba pode estar em outra tela (ex.: Gestão de Carência, da Substituição): tenta ir para
    // Modulação > Banco de Aprovado pelo menu lateral. Se o menu ainda não existe (falta clicar em
    // "Servidor" ou entrar), tenta de novo daqui a pouco.
    if (tentativasMenu < 10 && Date.now() - ultimoMenu > 4000 && !frameLogin) {
      ultimoMenu = Date.now();
      tentativasMenu += 1;
      if (await abrirBancoPeloMenu(page)) {
        console.log('EducaDF: abrindo Modulação > Banco de Aprovado pelo menu.');
        await page.waitForTimeout(1500);
        continue;
      }

      // O menu não funcionou duas vezes seguidas (ou não apareceu): abre a tela direto pelo endereço.
      // Se a sessão do EducaDF ainda estiver ativa, ela abre sem pedir login de novo.
      if (tentativasMenu >= 2 && !abriuPelaUrl && !onde(page).endsWith('/auth')) {
        abriuPelaUrl = true;
        console.log('EducaDF: o menu não abriu o Banco de Aprovado; abrindo a tela direto pelo endereço.');
        await page.goto(URL_EDUCADF).catch(() => {});
        await page.waitForTimeout(1500);
        continue;
      }
    }

    if (!preencheu && tentativas < 3) {
      const frame = frameLogin || (await acharLogin(page));
      if (frame) {
        if (!temCredenciais) {
          if (!avisouSemCredenciais) {
            console.log(
              'EducaDF: achei a tela de login, mas EDUCADF_USUARIO / EDUCADF_SENHA não foram lidos do .env. Entre à mão na janela.'
            );
            avisouSemCredenciais = true;
          }
        } else {
          try {
            const r = await preencherLogin(frame, EDUCADF_USUARIO, EDUCADF_SENHA);
            console.log(
              `EducaDF: ${r.temUsuario ? 'matrícula e senha preenchidas' : 'só a senha foi preenchida (não achei o campo de usuário)'}; clicou em Entrar: ${r.clicou ? 'sim' : 'não'}.`
            );
            preencheu = true;
          } catch (err) {
            tentativas += 1;
            console.log(`EducaDF: não consegui preencher o login (${err.message.split('\n')[0]}).`);
          }
        }
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    'o campo de CPF do Banco de Aprovado não apareceu em 3 minutos. Na janela do EducaDF, clique em Servidor, entre e abra Modulação > Banco de Aprovado; depois clique em Buscar dados de novo.'
  );
}

// Abre Ações > Histórico de convocações da linha do candidato e conta as carências do ano
// configurado (EDUCADF.anoHistorico). Devolve { ano, total, codigos: [{codigo, origem}], avisos, texto }.
// Nunca derruba a busca principal: se algo falhar, volta com total null e um aviso.
async function lerHistoricoConvocacoes(page, linha) {
  const ano = String(EDUCADF.anoHistorico || 2026);
  const avisos = [];
  const urlAntes = page.url();
  let dados = null;

  try {
    cancelamento.verificar();
    await linha.locator('button').last().click({ timeout: 8000 });
    await page.getByText(EDUCADF.menuHistorico).filter({ visible: true }).first().click({ timeout: 8000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    cancelamento.verificar();

    dados = await page.evaluate(() => {
      const v = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const janela = [...document.querySelectorAll('[role="dialog"], .modal.show, .modal-dialog, .offcanvas.show')].find(v);
      const raiz = janela || document.body;
      const tabelas = [...raiz.querySelectorAll('table, [role="table"], [role="grid"]')]
        .filter(v)
        .map((tb) => ({
          cab: [...tb.querySelectorAll('th, [role="columnheader"]')].map((h) => h.innerText.trim()),
          linhas: [...tb.querySelectorAll('tr, [role="row"]')]
            .map((tr) => [...tr.querySelectorAll('td, [role="cell"], [role="gridcell"]')].map((c) => c.innerText.trim()))
            .filter((cels) => cels.length),
        }));
      return { temJanela: Boolean(janela), texto: raiz.innerText, tabelas };
    });
  } catch (err) {
    if (cancelamento.cancelado()) throw err;
    avisos.push(`Não consegui abrir "Histórico de convocações" (${err.message.split('\n')[0]}).`);
  }

  // Fecha o que abriu para a próxima busca começar limpa.
  try {
    if (page.url() !== urlAntes) {
      await page.goBack();
    } else {
      const fechar = page
        .locator('[role="dialog"], .modal.show, .offcanvas.show')
        .filter({ visible: true })
        .first()
        .getByRole('button', { name: /fechar|voltar|cancelar|close|×/i })
        .first();
      if (await fechar.count()) await fechar.click({ timeout: 3000 });
      else await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(500);
  } catch {}

  if (!dados) return { ano, total: null, codigos: [], avisos, texto: '' };

  const texto = dados.texto.replace(/\s+/g, ' ').trim().slice(0, 600);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const reAno = new RegExp(`(^|\\D)${ano}(\\D|$)`);

  // Ignora a tabela do próprio Banco de Aprovado, que pode estar atrás (quando não abre janela).
  const tabelas = dados.tabelas.filter((tb) => !tb.cab.some((h) => norm(h) === norm(EDUCADF.colunas.nome)));
  // A tabela do histórico é a que tem coluna de carência; senão, a maior.
  const comCarencia = tabelas.filter((tb) => tb.cab.some((h) => /carenc/.test(norm(h))));
  const tabela = (comCarencia.length ? comCarencia : tabelas).sort((x, y) => y.linhas.length - x.linhas.length)[0];

  if (!tabela || !tabela.linhas.length) {
    avisos.push('Abri o Histórico de convocações, mas não achei uma tabela para contar. Confira à mão (veja "O que li" abaixo).');
    return { ano, total: null, codigos: [], avisos, texto };
  }

  // Colunas da tela: Req. | ID. Carência SIGEP | ID. Carência EducaDF | Ano Carência | Status
  const col = (...res) => tabela.cab.findIndex((h) => res.every((re) => re.test(norm(h))));
  const iAno = col(/ano/, /carenc/) >= 0 ? col(/ano/, /carenc/) : col(/^ano/);
  const iEdu = col(/carenc/, /educadf/);
  const iSigep = col(/carenc/, /sigep/);
  const iStatus = col(/^status/);

  const codigos = [];
  let total = 0;
  for (const cels of tabela.linhas) {
    // Só conta a linha cujo Ano Carência é o ano pedido.
    if (iAno >= 0 ? !reAno.test(cels[iAno] || '') : true) continue;
    total += 1;

    const status = iStatus >= 0 ? (cels[iStatus] || '').replace(/\s+/g, ' ').trim() : '';
    const edu = iEdu >= 0 ? soDigitos(cels[iEdu]) : '';
    const sigep = iSigep >= 0 ? soDigitos(cels[iSigep]) : '';
    // Prefere o código do EducaDF (é o usado na Gestão de Carência); sem ele, mostra o do SIGEP.
    const escolhido = edu ? { codigo: edu, origem: 'EducaDF' } : sigep ? { codigo: sigep, origem: 'SIGEP' } : null;
    if (escolhido && !codigos.some((x) => x.codigo === escolhido.codigo)) codigos.push({ ...escolhido, status });
  }

  if (iAno < 0) {
    avisos.push(`Não achei a coluna "Ano Carência" no histórico, então não consegui filtrar ${ano}. Confira à mão.`);
    return { ano, total: null, codigos: [], avisos, texto };
  }
  if (iEdu < 0 && iSigep < 0) avisos.push('Não achei as colunas de ID da carência no histórico.');
  if (codigos.some((x) => x.origem === 'SIGEP')) avisos.push('Alguma carência não tem ID do EducaDF; mostrei o ID do SIGEP (marcado).');

  return { ano, total, codigos, avisos, texto };
}

async function buscarNoEducaDF(cpf) {
  const digitos = soDigitos(cpf);
  const page = await obterAba('educadf', URL_EDUCADF);

  await prepararTela(page);

  const campoCpf = page.getByPlaceholder(EDUCADF.placeholderCpf, { exact: true });

  await campoCpf.fill(digitos);
  await page.getByRole('button', { name: 'Filtrar' }).click();

  const linha = page
    .locator('tr, [role="row"]')
    .filter({ hasText: digitos })
    .first();

  try {
    await linha.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    throw new Error(
      'CPF não encontrado no Banco de Aprovado. Confira se Edital, Especialidade e Turno estão escolhidos na tela do EducaDF.'
    );
  }

  const { cab, cel } = await linha.evaluate((tr) => {
    const tabela = tr.closest('table, [role="table"], [role="grid"]') || document;
    const cab = [...tabela.querySelectorAll('th, [role="columnheader"]')].map((h) =>
      h.innerText.trim()
    );
    const cel = [...tr.querySelectorAll('td, [role="cell"], [role="gridcell"]')].map((c) =>
      c.innerText.trim()
    );
    return { cab, cel };
  });

  const celulaDa = (titulo) => {
    const i = cab.findIndex((h) => h.toLowerCase() === titulo.toLowerCase());
    if (i < 0) {
      throw new Error(
        `Coluna "${titulo}" não encontrada no EducaDF. Colunas lidas: ${cab.join(' | ')}`
      );
    }
    return cel[i] || '';
  };

  // A célula do nome traz também a etiqueta de situação (ex.: "Normal", "Encaminhamento para INSS")
  const [nome, ...resto] = celulaDa(EDUCADF.colunas.nome)
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

  // Carência em Exercício: pode trazer mais de um código (ex.: "SIGEP 381546" e "EducaDF 17643").
  // Pega o primeiro da origem configurada (EDUCADF.origemCarencia) ou, se não houver, o primeiro de todos.
  // Se a coluna não existir ou estiver vazia, devolve '' (não atrapalha o resto da busca).
  let carencia = '';
  try {
    const texto = celulaDa(EDUCADF.colunas.carencia);
    const codigos = [...texto.matchAll(/([A-Za-zÀ-ú]+)?\s*[:\-]?\s*(\d{3,})/g)].map((m) => ({
      origem: (m[1] || '').toLowerCase(),
      numero: m[2],
    }));
    const origem = String(EDUCADF.origemCarencia || '').toLowerCase();
    const escolhido = (origem && codigos.find((c) => c.origem === origem)) || codigos[0];
    carencia = escolhido ? escolhido.numero : '';
    console.log(
      `EducaDF: Carência em Exercício lida: ${codigos.length} código(s); usando ${carencia || 'nenhum'}${
        escolhido && escolhido.origem ? ` (${escolhido.origem})` : ''
      }.`
    );
  } catch (err) {
    console.log(`EducaDF: não li a Carência em Exercício (${err.message.split('\n')[0]}).`);
  }

  // Histórico de convocações (só o ano configurado). Falha aqui não atrapalha o resto.
  const historico = await lerHistoricoConvocacoes(page, linha);
  console.log(
    `EducaDF: histórico de convocações ${historico.ano}: ${historico.total === null ? 'não consegui contar' : `${historico.total} carência(s)`}.`
  );

  return {
    historico,
    nome: nome || '',
    cpf: digitos,
    classificacao: soDigitos(celulaDa(EDUCADF.colunas.classificacao)),
    situacao: resto.join(' '),
    carencia,
  };
}

module.exports = { buscarNoEducaDF };