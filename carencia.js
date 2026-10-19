// carencia.js
// Lê uma carência no EducaDF (Modulação > Gestão de Carência):
// digita o código, clica em Filtrar, vê se existe professor titular e abre
// Ações > Horários da Carência para pegar turno e carga horária.

const { obterAba } = require('./navegador');
const { acharLogin, preencherLogin } = require('./login');
const { URL_CARENCIA, CARENCIA } = require('./config');
const cancelamento = require('./cancelamento');

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// Minúsculas, sem acento e com espaços simples (para comparar textos da tela).
const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const ESPERA_MS = 180000;

const visivel = (locator) => locator.isVisible().catch(() => false);

// Chega na tela "Gerenciar Carências": pelo menu lateral (Modulação > Gestão de Carência) e,
// se não der, direto pela URL. Faz o login do EducaDF se a tela de login aparecer.
async function prepararTela(page) {
  const campo = page.getByPlaceholder(CARENCIA.placeholderCodigo, { exact: true });
  const { EDUCADF_USUARIO, EDUCADF_SENHA } = process.env;

  const inicio = Date.now();
  let preencheuLogin = false;
  let tentouMenu = false;
  let tentouUrl = false;

  while (Date.now() - inicio < ESPERA_MS) {
    cancelamento.verificar();
    if (await visivel(campo)) return;

    const frame = await acharLogin(page);
    if (frame) {
      if (!preencheuLogin && EDUCADF_USUARIO && EDUCADF_SENHA) {
        try {
          await preencherLogin(frame, EDUCADF_USUARIO, EDUCADF_SENHA);
          console.log('EducaDF: login preenchido para abrir Gestão de Carência.');
          preencheuLogin = true;
        } catch (err) {
          console.log(`EducaDF: não consegui preencher o login (${err.message.split('\n')[0]}).`);
        }
      }
    } else if (!tentouMenu) {
      tentouMenu = true;
      try {
        const [pai, filho] = CARENCIA.menu;
        const itemFilho = page.getByText(filho, { exact: true }).filter({ visible: true }).first();
        if (!(await visivel(itemFilho))) {
          await page.getByText(pai, { exact: true }).filter({ visible: true }).first().click({ timeout: 5000 });
          await page.waitForTimeout(500);
        }
        await itemFilho.click({ timeout: 5000 });
        console.log('EducaDF: abrindo Modulação > Gestão de Carência pelo menu.');
        await page.waitForTimeout(1500);
      } catch (err) {
        console.log(`EducaDF: não consegui abrir pelo menu (${err.message.split('\n')[0]}).`);
      }
    } else if (!tentouUrl && Date.now() - inicio > 15000) {
      tentouUrl = true;
      console.log('EducaDF: abrindo Gestão de Carência direto pela URL.');
      await page.goto(URL_CARENCIA).catch(() => {});
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    'a tela "Gerenciar Carências" do EducaDF não abriu em 3 minutos. Na janela do EducaDF, abra Modulação > Gestão de Carência e tente de novo.'
  );
}

// Lê o Período ("10/02/2026 a 22/12/2026") de uma linha já lida e devolve as datas em aaaa-mm-dd.
function lerPeriodo(cab, cel) {
  const i = cab.findIndex((h) => norm(h) === norm(CARENCIA.colunas.periodo));
  if (i < 0) return { periodo: '', dataInicio: '', dataFim: '' };
  const periodo = (cel[i] || '').replace(/\s+/g, ' ').trim();
  const datas = [...periodo.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map((m) => `${m[3]}-${m[2]}-${m[1]}`);
  return { periodo, dataInicio: datas[0] || '', dataFim: datas[1] || '' };
}

// Lê turno e carga horária do texto da tela "Horários da Carência".
function lerHorarios(texto) {
  const t = norm(texto);

  const contagem = {};
  for (const [palavra, nome] of [
    ['matutino', 'Matutino'],
    ['vespertino', 'Vespertino'],
    ['noturno', 'Noturno'],
    ['integral', 'Integral'],
    ['diurno', 'Diurno'],
  ]) {
    const n = (t.match(new RegExp(palavra, 'g')) || []).length;
    if (n) contagem[nome] = n;
  }
  const turnos = Object.keys(contagem).sort((a, b) => contagem[b] - contagem[a]);

  const horas = [...t.matchAll(/(\d{1,2})\s*(?:h\b|horas?\b)/g)].map((m) => Number(m[1]));
  const cargas = [...new Set(horas)];

  return { turnos, cargas };
}

// Turno e carga a partir do nome da carga horária (ex.: "14_M_ATIVIDADES_30H_5ºC"), só como reserva.
function lerDoNome(nome) {
  const partes = String(nome || '').toUpperCase().split(/[_\-\s]+/);
  const mapa = { M: 'Matutino', V: 'Vespertino', N: 'Noturno', I: 'Integral' };
  const letra = partes.find((p) => mapa[p]);
  const h = String(nome || '').match(/(\d{1,2})\s*H\b/i);
  return { turno: letra ? mapa[letra] : '', carga: h ? Number(h[1]) : null };
}

async function buscarCarencia(codigo) {
  const digitos = soDigitos(codigo);
  if (!digitos) throw new Error('Informe o código da carência.');

  const page = await obterAba('educadf', URL_CARENCIA);
  await prepararTela(page);

  const campo = page.getByPlaceholder(CARENCIA.placeholderCodigo, { exact: true });
  await campo.fill(digitos);
  await page.getByRole('button', { name: /Filtrar/ }).first().click();

  const linha = page.locator('tr, [role="row"]').filter({ hasText: digitos }).first();
  try {
    await linha.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    throw new Error(`Carência ${digitos} não encontrada no EducaDF. Confira o código e os filtros da tela (ex.: o ano).`);
  }

  const { cab, cel } = await linha.evaluate((tr) => {
    const tabela = tr.closest('table, [role="table"], [role="grid"]') || document;
    const cab = [...tabela.querySelectorAll('th, [role="columnheader"]')].map((h) => h.innerText.trim());
    const cel = [...tr.querySelectorAll('td, [role="cell"], [role="gridcell"]')].map((c) => c.innerText.trim());
    return { cab, cel };
  });

  const celulaDa = (titulo) => {
    const i = cab.findIndex((h) => norm(h) === norm(titulo));
    if (i < 0) {
      throw new Error(`Coluna "${titulo}" não encontrada no EducaDF. Colunas lidas: ${cab.join(' | ').replace(/\n/g, ' ')}`);
    }
    return cel[i] || '';
  };

  // Titular: o nome do professor; "Não informado" ou "-" significa que não tem.
  const textoTitular = celulaDa(CARENCIA.colunas.titular)
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)[0] || '';
  const temTitular = Boolean(textoTitular) && !/^n[aã]o informado$/i.test(textoTitular) && textoTitular !== '-';
  const titular = temTitular ? textoTitular : '';

  const avisos = [];
  let nomeCarga = '';
  try {
    nomeCarga = celulaDa(CARENCIA.colunas.nomeCargaHoraria);
  } catch {}

  // Período da carência = datas do contrato (início e fim), lidas na mesma linha.
  const per = lerPeriodo(cab, cel);
  if (per.periodo && (!per.dataInicio || !per.dataFim)) {
    avisos.push(`Não consegui ler as duas datas do Período (li: "${per.periodo}"). Preencha as datas à mão.`);
  }

  // Ações > Horários da Carência
  const urlAntes = page.url();
  let textoHorarios = '';

  try {
    await linha.locator('button').last().click({ timeout: 8000 });
    await page.getByText(CARENCIA.menuAcoes, { exact: true }).filter({ visible: true }).first().click({ timeout: 8000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);

    textoHorarios = await page.evaluate(() => {
      const v = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const janela = [...document.querySelectorAll('[role="dialog"], .modal.show, .modal-dialog, .offcanvas.show')].find(v);
      return (janela || document.body).innerText;
    });
  } catch (err) {
    avisos.push(`Não consegui abrir "${CARENCIA.menuAcoes}" (${err.message.split('\n')[0]}). Preencha turno e carga horária à mão.`);
  }

  // Fecha o que abriu para a próxima busca começar limpa.
  try {
    if (page.url() !== urlAntes) {
      await page.goBack();
    } else {
      const fechar = page.getByRole('button', { name: /fechar|voltar|cancelar|close/i }).filter({ visible: true }).first();
      if (await fechar.count()) await fechar.click({ timeout: 3000 });
      else await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(500);
  } catch {}

  const { turnos, cargas } = lerHorarios(textoHorarios);
  const reserva = lerDoNome(nomeCarga);

  let turno = turnos[0] || '';
  let cargaHoraria = cargas.length === 1 ? String(cargas[0]) : '';

  if (turnos.length > 1) avisos.push(`Os horários têm mais de um turno (${turnos.join(', ')}). Conferi o mais frequente; confirme.`);
  if (cargas.length > 1) avisos.push(`Achei mais de uma carga horária nos horários (${cargas.join(', ')}). Escolha a correta.`);

  if (!turno && reserva.turno) {
    turno = reserva.turno;
    avisos.push(`Turno tirado do nome da carga horária (${nomeCarga.replace(/\n/g, ' ')}), não da tela de horários. Confirme.`);
  }
  if (!cargaHoraria && cargas.length === 0 && reserva.carga) {
    cargaHoraria = String(reserva.carga);
    avisos.push(`Carga horária tirada do nome da carga horária (${nomeCarga.replace(/\n/g, ' ')}), não da tela de horários. Confirme.`);
  }
  if (!turno || !cargaHoraria) avisos.push('Não consegui ler turno e/ou carga horária com certeza. Complete na tela antes de preencher o SIRAC.');

  return {
    codigo: digitos,
    temTitular,
    titular,
    turno,
    cargaHoraria,
    periodo: per.periodo,
    dataInicio: per.dataInicio,
    dataFim: per.dataFim,
    avisos,
    // Só para diagnóstico na tela (não contém CPF): trecho do que foi lido em "Horários da Carência".
    textoHorarios: textoHorarios.replace(/\s+/g, ' ').trim().slice(0, 400),
  };
}

// Lê só o Período da carência (ex.: "10/02/2026 a 22/12/2026") na tela Gerenciar Carências.
// Início = Data de Assinatura do Contrato; fim = Data de Término do Contrato no SIRAC.
async function buscarPeriodoCarencia(codigo) {
  const digitos = soDigitos(codigo);
  if (!digitos) throw new Error('Informe o código da carência.');

  const page = await obterAba('educadf', URL_CARENCIA);
  await prepararTela(page);

  const campo = page.getByPlaceholder(CARENCIA.placeholderCodigo, { exact: true });
  await campo.fill(digitos);
  await page.getByRole('button', { name: /Filtrar/ }).first().click();

  const linha = page.locator('tr, [role="row"]').filter({ hasText: digitos }).first();
  try {
    await linha.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    throw new Error(`Carência ${digitos} não encontrada no EducaDF. Confira o código e os filtros da tela (ex.: o ano).`);
  }

  const { cab, cel } = await linha.evaluate((tr) => {
    const tabela = tr.closest('table, [role="table"], [role="grid"]') || document;
    const cab = [...tabela.querySelectorAll('th, [role="columnheader"]')].map((h) => h.innerText.trim());
    const cel = [...tr.querySelectorAll('td, [role="cell"], [role="gridcell"]')].map((c) => c.innerText.trim());
    return { cab, cel };
  });

  const i = cab.findIndex((h) => norm(h) === norm(CARENCIA.colunas.periodo));
  if (i < 0) {
    throw new Error(`Coluna "${CARENCIA.colunas.periodo}" não encontrada no EducaDF. Colunas lidas: ${cab.join(' | ').replace(/\n/g, ' ')}`);
  }
  const textoPeriodo = (cel[i] || '').replace(/\s+/g, ' ').trim();

  // dd/mm/aaaa -> aaaa-mm-dd (formato do campo de data do formulário local)
  const datas = [...textoPeriodo.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map((m) => `${m[3]}-${m[2]}-${m[1]}`);
  const avisos = [];
  if (datas.length < 2) {
    avisos.push(`Não consegui ler as duas datas do Período (li: "${textoPeriodo}"). Preencha à mão.`);
  }

  return { codigo: digitos, periodo: textoPeriodo, dataInicio: datas[0] || '', dataFim: datas[1] || '', avisos };
}

module.exports = { buscarCarencia, buscarPeriodoCarencia };