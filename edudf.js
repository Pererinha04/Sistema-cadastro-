// edudf.js
// Lê nome, CPF e classificação do candidato na tela "Banco de Aprovado" do EducaDF.
// Antes da primeira busca, deixe na tela os filtros de Edital, Especialidade e Turno
// escolhidos (o programa só preenche o CPF e clica em Filtrar).

const { obterAba } = require('./navegador');
const { acharLogin, preencherLogin } = require('./login');
const { URL_EDUCADF, EDUCADF } = require('./config');
const cancelamento = require('./cancelamento');

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
// Os IDs usados em Gestão de Carência têm pelo menos 5 dígitos. Evita interpretar
// o ano (por exemplo, "Carência 2026") como se fosse o identificador da carência.
const codigoCarenciaValido = (s) => /^\d{5,}$/.test(String(s || '')) && !/^(19|20)\d{2}$/.test(String(s || ''));

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

// Espera o Banco de Aprovados na rota direta de Gestão escolar. Isso evita selecionar
// por engano a opção Modulação que agora também existe dentro de Recursos Humanos.
async function prepararTela(page) {
  const campoCpf = page.getByPlaceholder(EDUCADF.placeholderCpf, { exact: true });
  const { EDUCADF_USUARIO, EDUCADF_SENHA } = process.env;
  const temCredenciais = Boolean(EDUCADF_USUARIO && EDUCADF_SENHA);

  console.log(
    `EducaDF: aba aberta em ${onde(page)}. Acessando Banco de Aprovados pela rota de Gestão escolar.`
  );

  const inicio = Date.now();
  let tentativas = 0;
  let preencheu = false;
  let avisouSemCredenciais = false;
  let tentativasUrl = 0;
  let ultimaTentativaUrl = 0;

  while (Date.now() - inicio < ESPERA_MS) {
    cancelamento.verificar();
    if (await estaVisivel(campoCpf)) {
      console.log('EducaDF: tela do Banco de Aprovado aberta.');
      return;
    }

    const frameLogin = await acharLogin(page);

    // Não procurar o item "Modulação" pelo texto: há duas opções homônimas no menu.
    // A URL identifica sem ambiguidade a página de Gestão escolar > Banco de Aprovados.
    const urlAtual = page.url();
    const estaNaRotaCorreta = urlAtual.includes('/modulos/gestao/banco-aprovados');
    const estaNoLogin = /\/auth(?:[/?#]|$)/i.test(urlAtual);
    if (!frameLogin && !estaNaRotaCorreta && !estaNoLogin && tentativasUrl < 3 && Date.now() - ultimaTentativaUrl > 5000) {
      tentativasUrl += 1;
      ultimaTentativaUrl = Date.now();
      console.log('EducaDF: abrindo diretamente Gestão escolar > Banco de Aprovados.');
      await fecharSobreposicoes(page);
      await page.goto(URL_EDUCADF).catch(() => {});
      await page.waitForTimeout(1000);
      continue;
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
async function lerHistoricoConvocacoes(page, linha, nomeCandidato) {
  const ano = String(EDUCADF.anoHistorico || 2026);
  const avisos = [];
  const urlAntes = page.url();
  let dados = null;

  try {
    cancelamento.verificar();
    const nome = String(nomeCandidato || '').trim();
    const alvo = nome ? linha.getByText(nome, { exact: false }).first() : linha.locator('a, button').first();
    await alvo.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await alvo.click({ timeout: 8000 });
    // O EducaDF abre os detalhes em uma área lateral da própria página, não em um modal.
    await page.getByText(/Convocações neste edital/i).first().waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    cancelamento.verificar();

    dados = await page.evaluate(() => {
      const v = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      // O drawer não tem role=dialog nem classe offcanvas; seus dados estão no corpo da página.
      const raiz = document.body;
      const tabelas = [...raiz.querySelectorAll('table, [role="table"], [role="grid"]')]
        .filter(v)
        .map((tb) => ({
          cab: [...tb.querySelectorAll('th, [role="columnheader"]')].map((h) => h.innerText.trim()),
          linhas: [...tb.querySelectorAll('tr, [role="row"]')]
            .map((tr) => [...tr.querySelectorAll('td, [role="cell"], [role="gridcell"]')].map((c) => c.innerText.trim()))
            .filter((cels) => cels.length),
        }));
      return { temJanela: true, texto: raiz.innerText, tabelas };
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

  const textoCompleto = dados.texto.replace(/\s+/g, ' ').trim();
  const texto = textoCompleto.slice(0, 600);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const reAno = new RegExp(`(^|\\D)${ano}(\\D|$)`);

  // O painel novo mostra cada convocação como um bloco, não como tabela.
  // Prioriza essa seção porque o drawer também pode conter tabelas de situação sem relação com convocações.
  const secao = textoCompleto.split(/CONVOCAÇÕES NESTE EDITAL/i)[1]?.split(/HABILITAÇÃO E APTIDÃO/i)[0] || '';
  if (secao) {
    const convocacoes = [...secao.matchAll(/Carência\s+(\d{3,})[\s\S]{0,180}?(\d{2}\/\d{2}\/\d{4})/gi)]
      .filter((m) => m[2].endsWith(ano));
    const codigos = [];
    for (const m of convocacoes) {
      if (codigoCarenciaValido(m[1]) && !codigos.some((x) => x.codigo === m[1])) {
        codigos.push({ codigo: m[1], origem: 'EducaDF' });
      }
    }
    return { ano, total: convocacoes.length, codigos, avisos, texto };
  }

  // Ignora a tabela do próprio Banco de Aprovado, que pode estar atrás (quando não abre janela).
  const tabelas = dados.tabelas.filter((tb) => !tb.cab.some((h) => norm(h) === norm(EDUCADF.colunas.nome)));
  const comCarencia = tabelas.filter((tb) => tb.cab.some((h) => /carenc/.test(norm(h))));
  const tabela = (comCarencia.length ? comCarencia : tabelas).sort((x, y) => y.linhas.length - x.linhas.length)[0];

  if (!tabela || !tabela.linhas.length) {
    avisos.push('Abri os detalhes do candidato, mas não achei a seção de convocações. Confira à mão (veja "O que li" abaixo).');
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
    const eduBruto = iEdu >= 0 ? soDigitos(cels[iEdu]) : '';
    const sigepBruto = iSigep >= 0 ? soDigitos(cels[iSigep]) : '';
    const edu = codigoCarenciaValido(eduBruto) ? eduBruto : '';
    const sigep = codigoCarenciaValido(sigepBruto) ? sigepBruto : '';
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
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();

  const linha = page
    .locator('tr, [role="row"]')
    .filter({ hasText: digitos.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') })
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
  const [nome] = celulaDa(EDUCADF.colunas.nome)
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

  // Carência em Exercício: pode trazer mais de um código (ex.: "SIGEP 381546" e "EducaDF 17643").
  // Pega o primeiro da origem configurada (EDUCADF.origemCarencia) ou, se não houver, o primeiro de todos.
  // Se a coluna não existir ou estiver vazia, devolve '' (não atrapalha o resto da busca).
  let carencia = '';
  try {
    const texto = celulaDa(EDUCADF.colunas.carencia);
    const marcados = [...texto.matchAll(/\b(EducaDF|SIGEP)\s*[:#\-]?\s*(\d{3,})/gi)].map((m) => ({
      origem: m[1].toLowerCase(),
      numero: m[2],
    }));
    const codigos = (marcados.length ? marcados : [...texto.matchAll(/\bCar[eê]ncia\s+(\d{3,})/gi)].map((m) => ({
      origem: '',
      numero: m[1],
    }))).filter((c) => codigoCarenciaValido(c.numero));
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
  const historico = await lerHistoricoConvocacoes(page, linha, nome);
  if (!codigoCarenciaValido(carencia)) {
    const doHistorico = historico.codigos.find((c) => c.origem === 'EducaDF' && codigoCarenciaValido(c.codigo))
      || historico.codigos.find((c) => codigoCarenciaValido(c.codigo));
    carencia = doHistorico ? doHistorico.codigo : '';
  }
  console.log(
    `EducaDF: histórico de convocações ${historico.ano}: ${historico.total === null ? 'não consegui contar' : `${historico.total} carência(s)`}.`
  );
  console.log(`EducaDF: código da carência para consulta: ${carencia || 'não encontrado'}.`);

  return {
    historico,
    nome: nome || '',
    cpf: digitos,
    classificacao: soDigitos(celulaDa(EDUCADF.colunas.classificacao)),
    situacao: celulaDa('Situação'),
    carencia,
  };
}

module.exports = { buscarNoEducaDF };
