// substituicao.js
// Preenche a aba "Substituição" do SIRAC, na mesma aba usada pelo cadastro de admissão.
// O programa NÃO clica em "Adicionar": você confere, escolhe as datas à mão e adiciona.
//
// Com titular:  Abertura da Turma = Não; preenche Nome, CPF, Matrícula, Cargo, Região,
//               Especialidade (Atividades), Turno e Carga Horária (a Especialidade digitada na tela vale nos dois casos).
// Sem titular:  Abertura da Turma = Sim; preenche Cargo, Região, Turno e Carga Horária
//               (a Especialidade e as datas são com você).

const { abaAberta } = require('./navegador');
const { preencherCampo } = require('./sirac');

// Espera a rede assentar (o SIRAC refaz partes da tela por AJAX) e dá um respiro.
// Acompanha as requisições em andamento da aba. Assim a espera acaba assim que o SIRAC termina de
// responder (o "networkidle" do navegador ainda soma 500 ms de silêncio a cada espera).
function vigiarRede(page) {
  if (page.__vigiaRede) return page.__vigiaRede;
  const v = { abertas: new Set(), ultimo: Date.now() };
  const fim = (r) => {
    v.abertas.delete(r);
    v.ultimo = Date.now();
  };
  page.on('request', (r) => v.abertas.add(r));
  page.on('requestfinished', fim);
  page.on('requestfailed', fim);
  page.__vigiaRede = v;
  return v;
}

async function aguardar(page, limiteMs = 8000, quietoMs = 120) {
  const v = vigiarRede(page);
  await page.waitForTimeout(60); // dá tempo da requisição disparada pela ação começar
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    if (v.abertas.size === 0 && Date.now() - v.ultimo >= quietoMs) return;
    await page.waitForTimeout(40);
  }
}
const { SUBSTITUICAO } = require('./config');

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const formatarCpf = (s) => soDigitos(s).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');

// ---------- achar os campos da aba Substituição ----------

// Marca no HTML o campo que vem depois do rótulo (data-auto-sub="chave") e devolve true se achou.
// Só olha o que está visível e depois do título "Dados do(a) Servidor(a) Efetivo(a) Substituído(a)",
// para não confundir com o "CPF:" do topo da página nem com outras abas.
// tipo: 'texto' | 'select' | 'radio'; indice: qual dos campos do tipo depois do rótulo (0 = primeiro).
async function marcar(page, chave, rotulo, tipo, indice = 0) {
  try {
    return await page.evaluate(
      ({ chave, rotulo, tipo, indice }) => {
        const n = (s) =>
          String(s || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[*:?]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const proprio = (el) =>
          Array.from(el.childNodes)
            .filter((x) => x.nodeType === 3)
            .map((x) => x.textContent)
            .join(' ');

        document.querySelectorAll(`[data-auto-sub="${chave}"]`).forEach((e) => e.removeAttribute('data-auto-sub'));

        const todos = [...document.querySelectorAll('body *')];
        const ancora = todos.find(
          (el) => vis(el) && n(proprio(el)).startsWith('dados do(a) servidor(a) efetivo(a) substituido(a)')
        );
        const depoisAncora = (el) =>
          !ancora || (ancora.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);

        const alvo = n(rotulo);
        const rotulos = todos.filter((el) => vis(el) && depoisAncora(el) && n(proprio(el)) === alvo);
        // Sem o título como referência, o "CPF" certo é o último (o primeiro é o da barra do topo).
        const rot = !ancora && chave === 'cpf' ? rotulos[rotulos.length - 1] : rotulos[0];
        if (!rot) return false;

        const ignorados = ['hidden', 'radio', 'checkbox', 'button', 'submit', 'image', 'file', 'reset', 'password'];
        const candidatos = [...document.querySelectorAll('input, select, textarea')].filter(
          (el) => vis(el) && !rot.contains(el) && rot.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
        );
        const doTipo = candidatos.filter((el) =>
          tipo === 'qualquer'
            ? el.tagName === 'SELECT' ||
              el.tagName === 'TEXTAREA' ||
              (el.tagName === 'INPUT' && !ignorados.includes((el.type || 'text').toLowerCase()))
            : tipo === 'select'
            ? el.tagName === 'SELECT'
            : tipo === 'radio'
              ? el.type === 'radio'
              : el.tagName === 'TEXTAREA' ||
                (el.tagName === 'INPUT' && !ignorados.includes((el.type || 'text').toLowerCase()))
        );
        const campo = doTipo[indice];
        if (!campo) return false;
        campo.setAttribute('data-auto-sub', chave);
        return true;
      },
      { chave, rotulo, tipo, indice }
    );
  } catch {
    return false; // a página estava trocando de tela
  }
}

const campoMarcado = (page, chave) => page.locator(`[data-auto-sub="${chave}"]`).first();

// Espera o campo aparecer (a tela se refaz por AJAX) e devolve o locator, ou null.
async function esperarCampo(page, chave, rotulo, tipo, indice = 0, ms = 10000) {
  const inicio = Date.now();
  while (Date.now() - inicio < ms) {
    if (await marcar(page, chave, rotulo, tipo, indice)) return campoMarcado(page, chave);
    await page.waitForTimeout(200);
  }
  return null;
}

// Tenta cada texto de rótulo da lista até achar o campo de data (ou acabar o tempo).
async function esperarCampoPorRotulos(page, chave, rotulos, ms = 6000) {
  const inicio = Date.now();
  while (Date.now() - inicio < ms) {
    for (const rotulo of rotulos) {
      if (await marcar(page, chave, rotulo, 'texto', 0)) return campoMarcado(page, chave);
    }
    await page.waitForTimeout(200);
  }
  return null;
}

// ---------- escolher opções de listas ----------

// Candidatos: texto normal (igual, depois começa com, depois contém) ou "re:expressão".
// Textos de 1 letra só valem se forem iguais à opção inteira.
async function selecionarFlex(select, candidatos) {
  const r = await select.evaluate((s, cands) => {
    const n = (t) =>
      String(t || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
    const textos = [...s.options].map((o) => o.textContent.trim());
    const normais = textos.map(n);
    const valida = (i) => !normais[i].startsWith('--') && normais[i] !== '';

    for (const c of cands) {
      let i = -1;
      if (c.startsWith('re:')) {
        const re = new RegExp(c.slice(3));
        i = normais.findIndex((x, k) => valida(k) && re.test(x));
      } else {
        const alvo = n(c);
        i = normais.findIndex((x, k) => valida(k) && x === alvo);
        if (i < 0 && alvo.length > 1) i = normais.findIndex((x, k) => valida(k) && x.startsWith(alvo));
        if (i < 0 && alvo.length > 1) i = normais.findIndex((x, k) => valida(k) && x.includes(alvo));
      }
      if (i >= 0) return { i, textos };
    }
    return { i: -1, textos };
  }, candidatos, { timeout: 5000 });

  if (r.i < 0) return { ok: false, opcoes: r.textos.filter((t) => t && !t.startsWith('--')) };
  await select.selectOption({ index: r.i }, { timeout: 5000 });
  return { ok: true, escolhida: r.textos[r.i] };
}

// Marca a lista, escolhe a opção e, se a tela se refizer no meio (AJAX) e o campo sumir,
// marca de novo e tenta outra vez. antes: algo a esperar depois de achar a lista (ex.: opções carregarem).
async function escolherNaLista(page, chave, rotulo, candidatos, antes) {
  let erro = '';
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const campo = await esperarCampo(page, chave, rotulo, 'select', 0, 10000);
    if (!campo) return { ok: false, naoAchou: true };
    try {
      if (antes) {
        await antes();
        await marcar(page, chave, rotulo, 'select');
      }
      return await selecionarFlex(campoMarcado(page, chave), candidatos);
    } catch (err) {
      erro = err.message.split('\n')[0];
      console.log(`SIRAC substituição: ${rotulo} mudou no meio da escolha (tentativa ${tentativa + 1}); tentando de novo.`);
      await aguardar(page);
    }
  }
  return { ok: false, erro };
}

const SINONIMOS_TURNO = {
  matutino: ['matutino', 'manha', 'm'],
  vespertino: ['vespertino', 'tarde', 'v'],
  noturno: ['noturno', 'noite', 'n'],
  integral: ['integral', 'diurno'],
  diurno: ['diurno', 'integral'],
};

function candidatosTurno(turno) {
  const chave = String(turno || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  return [turno, ...(SINONIMOS_TURNO[chave] || [])].filter(Boolean);
}

function candidatosCarga(carga) {
  const num = soDigitos(carga);
  return [`re:(^|\\D)${num}(\\D|$)`];
}

// Espera a lista de especialidades carregar (ela depende do Cargo escolhido).
async function esperarOpcoes(page, chave, minimo = 2, ms = 10000) {
  const inicio = Date.now();
  while (Date.now() - inicio < ms) {
    const n = await campoMarcado(page, chave)
      .evaluate((s) => s.options.length)
      .catch(() => 0);
    if (n >= minimo) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

// ---------- datas (busca por aproximação) ----------
// Quando o texto exato do rótulo não bate, procura o campo de data pelo sentido do rótulo
// ("início/inicial" ou "término/fim/final", mesmo com texto a mais, ex.: "Data de Fim da Carência").
// Para o fim, se nada for achado, usa o campo de texto que vem logo depois do de início.
// Devolve { achou, rotulos } (rotulos = textos de rótulos parecidos vistos na tela, só para diagnóstico).
async function marcarDataAproximada(page, chave) {
  try {
    return await page.evaluate((chave) => {
      const n = (s) =>
        String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[*:?]/g, '').replace(/\s+/g, ' ').trim();
      const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const proprio = (el) => Array.from(el.childNodes).filter((x) => x.nodeType === 3).map((x) => x.textContent).join(' ');
      const ignorados = ['hidden', 'radio', 'checkbox', 'button', 'submit', 'image', 'file', 'reset', 'password'];

      const todos = [...document.querySelectorAll('body *')];
      const ancora = todos.find((el) => vis(el) && n(proprio(el)).startsWith('dados do(a) servidor(a) efetivo(a) substituido(a)'));
      const depois = (ref, el) => !!(ref.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      const depoisAncora = (el) => !ancora || depois(ancora, el);

      const inputs = [...document.querySelectorAll('input, textarea')].filter(
        (el) => vis(el) && depoisAncora(el) && (el.tagName === 'TEXTAREA' || !ignorados.includes((el.type || 'text').toLowerCase()))
      );
      const rotulos = todos.filter((el) => {
        const t = n(proprio(el));
        return vis(el) && depoisAncora(el) && t && t.length < 60;
      });

      const reIni = /\b(inicio|inicial)\b/;
      const reFim = /\b(termino|fim|final)\b/;
      const reData = /data|periodo|carencia|vigencia/;

      const primeiroCampoApos = (rot) => inputs.find((i) => !rot.contains(i) && depois(rot, i));
      const marcarAlvo = (ch, campo) => {
        document.querySelectorAll(`[data-auto-sub="${ch}"]`).forEach((e) => e.removeAttribute('data-auto-sub'));
        campo.setAttribute('data-auto-sub', ch);
      };
      const porRotulo = (re) => {
        const rot = rotulos.find((r) => re.test(n(proprio(r))) && reData.test(n(proprio(r))) && primeiroCampoApos(r));
        return rot ? primeiroCampoApos(rot) : null;
      };

      let campo = null;
      if (chave === 'data_inicio') {
        campo = porRotulo(reIni);
      } else {
        campo = porRotulo(reFim);
        if (!campo) {
          // O campo de fim costuma vir logo depois do de início.
          const ini = porRotulo(reIni) || document.querySelector('[data-auto-sub="data_inicio"]');
          if (ini) campo = inputs.find((i) => i !== ini && depois(ini, i));
        }
      }
      if (campo) {
        marcarAlvo(chave, campo);
        return { achou: true, rotulos: [] };
      }
      const dicas = rotulos
        .map((r) => proprio(r).replace(/\s+/g, ' ').trim())
        .filter((x) => /data|inicio|início|termino|término|fim|final|periodo|período/i.test(x))
        .slice(0, 8);
      return { achou: false, rotulos: dicas };
    }, chave);
  } catch {
    return { achou: false, rotulos: [] };
  }
}

// ---------- Carga Horária ----------
// Pode ser uma lista (escolhe a opção com o número) ou um campo de texto (digita o número).
// Espera as opções carregarem, preenche e confere se o valor ficou (o SIRAC refaz a tela por AJAX
// e pode apagar a escolha). Devolve { ok, texto } ou { ok: false, motivo }.

const cargaConfere = (texto, num) => new RegExp(`(^|\\D)0*${num}(\\D|$)`).test(String(texto || ''));

async function acharCampoCarga(page, ms) {
  const inicio = Date.now();
  while (Date.now() - inicio < ms) {
    for (const rotulo of SUBSTITUICAO.rotulosCarga) {
      if (await marcar(page, 'carga', rotulo, 'qualquer', 0)) return campoMarcado(page, 'carga');
    }
    await page.waitForTimeout(200);
  }
  return null;
}

const valorDoCampo = (campo) =>
  campo
    .evaluate((el) => (el.tagName === 'SELECT' ? (el.selectedOptions[0]?.textContent || '').trim() : (el.value || '').trim()))
    .catch(() => '');

async function preencherCarga(page, carga) {
  const num = soDigitos(carga).replace(/^0+(?=\d)/, '');
  let motivo = 'não achei o campo';

  for (let tentativa = 0; tentativa < 4; tentativa++) {
    try {
      let campo = await acharCampoCarga(page, 10000);
      if (!campo) return { ok: false, motivo };

      const ehLista = await campo.evaluate((el) => el.tagName === 'SELECT');
      if (ehLista) {
        await esperarOpcoes(page, 'carga', 2, 10000); // as opções podem depender de Turno/Cargo
        campo = (await acharCampoCarga(page, 3000)) || campo;
        const r = await selecionarFlex(campo, [`re:(^|\\D)0*${num}(\\D|$)`]);
        if (!r.ok) {
          motivo = `não achei ${num} entre as opções: ${(r.opcoes || []).join(' | ') || 'nenhuma carregada'}`;
          await aguardar(page);
          continue;
        }
      } else {
        await preencherCampo(campo, num);
      }
      await aguardar(page);

      // Confere se o valor ficou depois do SIRAC atualizar a tela.
      const campo2 = await acharCampoCarga(page, 3000);
      const atual = campo2 ? await valorDoCampo(campo2) : '';
      if (cargaConfere(atual, num)) return { ok: true, texto: atual };
      motivo = 'o SIRAC apagou o valor depois de escolher';
    } catch (err) {
      motivo = err.message.split('\n')[0];
      await aguardar(page);
    }
  }
  return { ok: false, motivo };
}

// ---------- fluxo principal ----------

// d = { temTitular, nome, cpf, matricula, especialidade, turno, cargaHoraria, dataInicio, dataFim } (datas em dd/mm/aaaa)
async function preencherSubstituicao(d) {
  const page = abaAberta('sirac');
  if (!page) {
    throw new Error(
      'não achei a aba do SIRAC aberta. Faça o cadastro de admissão primeiro e deixe a aba do SIRAC aberta (sem fechar a janela).'
    );
  }
  await page.bringToFront();
  vigiarRede(page);

  const t0 = Date.now();
  const marca = (etapa) => console.log(`SIRAC substituição: ${etapa} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  const preenchidos = [];
  const pendencias = [];

  // 1) Clica na aba "Substituição" (use este botão depois de salvar o cadastro).
  const aba = page.getByText(SUBSTITUICAO.abaTexto, { exact: true }).filter({ visible: true }).first();
  try {
    await aba.waitFor({ state: 'visible', timeout: 60000 });
  } catch {
    throw new Error(
      `não achei a aba "${SUBSTITUICAO.abaTexto}" no SIRAC. Salve o cadastro de admissão primeiro e confira se a aba aparece.`
    );
  }
  await aba.click();
  await aguardar(page);
  marca('aba aberta');

  // 2) Abertura da Turma: Não (com titular) ou Sim (sem titular).
  const radioSim = await esperarCampo(page, 'abertura_sim', 'Abertura da Turma', 'radio', 0, 30000);
  if (!radioSim) {
    throw new Error('a aba Substituição abriu, mas não achei o campo "Abertura da Turma". Confira a tela do SIRAC.');
  }
  const indiceRadio = d.temTitular ? 1 : 0; // 0 = Sim, 1 = Não
  await marcar(page, 'abertura', 'Abertura da Turma', 'radio', indiceRadio);
  const radio = campoMarcado(page, 'abertura');
  if (!(await radio.isChecked().catch(() => false))) {
    await radio.check();
    await aguardar(page);
    await page.waitForTimeout(300); // o SIRAC refaz o formulário ao trocar a opção
  }
  preenchidos.push(`Abertura da Turma: ${d.temTitular ? 'Não' : 'Sim'}`);
  marca('abertura da turma');

  // 3) Dados do titular (só quando existe titular).
  if (d.temTitular) {
    const campos = [
      ['nome', 'Nome', String(d.nome || '').trim().toUpperCase(), false],
      ['cpf', 'CPF', formatarCpf(d.cpf), true],
      ['matricula', 'Matrícula', soDigitos(d.matricula), false],
    ];
    for (const [chave, rotulo, valor, mascara] of campos) {
      if (!valor) {
        pendencias.push(`${rotulo} do titular (não veio preenchido)`);
        continue;
      }
      const campo = await esperarCampo(page, chave, rotulo, 'texto', 0, 10000);
      if (!campo) {
        pendencias.push(`${rotulo} do titular (não achei o campo)`);
        continue;
      }
      await preencherCampo(campo, valor, { mascara });
      preenchidos.push(rotulo);
    }
  }

  marca('dados do titular');

  // 4) Cargo, Região, Especialidade, Turno e Carga Horária.
  // Cada lista é marcada de novo a cada tentativa, porque o SIRAC refaz a tela depois de cada escolha.
  // Se uma lista falhar, ela vai para as pendências e o resto continua.
  async function lista(chave, rotulo, nome, candidatos, descricao, { antes, esperar = false, mostrar = false } = {}) {
    const ti = Date.now();
    const r = await escolherNaLista(page, chave, rotulo, candidatos, antes);
    if (r.ok) {
      preenchidos.push(mostrar ? `${nome} (${r.escolhida})` : nome);
      if (esperar) await aguardar(page);
      console.log(`SIRAC substituição: ${nome} escolhido em ${((Date.now() - ti) / 1000).toFixed(1)} s`);
    } else if (r.naoAchou) {
      pendencias.push(`${nome} (não achei o campo)`);
    } else if (r.erro) {
      pendencias.push(`${nome} (a tela do SIRAC mudou no meio; escolha à mão)`);
    } else {
      pendencias.push(`${nome} (não achei ${descricao}; opções: ${(r.opcoes || []).join(' | ') || 'nenhuma carregada'})`);
    }
  }

  await lista('cargo', 'Cargo / Emprego', 'Cargo / Emprego', [SUBSTITUICAO.cargo], `"${SUBSTITUICAO.cargo}"`, { esperar: true });
  await lista('regiao', 'Região / Regional de Ensino', 'Região', [SUBSTITUICAO.regiao], `"${SUBSTITUICAO.regiao}"`, { esperar: true });

  // Especialidade: o que você digitou na tela; sem nada digitado, usa "Atividades" quando há titular
  // e, sem titular, deixa para você escolher.
  const especialidade = String(d.especialidade || '').trim() || (d.temTitular ? SUBSTITUICAO.especialidadeComTitular : '');
  if (especialidade) {
    await lista('especialidade', 'Especialidade / Disciplina', 'Especialidade', [especialidade], `"${especialidade}"`, {
      antes: () => esperarOpcoes(page, 'especialidade'),
      esperar: true,
      mostrar: true,
    });
  }

  marca('cargo, região e especialidade');

  let cargaOk = false;
  if (!d.turno) pendencias.push('Turno (não veio do EducaDF)');
  else await lista('turno', 'Turno', 'Turno', candidatosTurno(d.turno), `"${d.turno}"`, { mostrar: true });

  if (!d.cargaHoraria) pendencias.push('Carga Horária (não veio do EducaDF)');
  else {
    const r = await preencherCarga(page, d.cargaHoraria);
    if (r.ok) {
      cargaOk = true;
      preenchidos.push(`Carga Horária (${r.texto})`);
    } else {
      pendencias.push(`Carga Horária (${r.motivo}; escolha ${d.cargaHoraria} à mão)`);
    }
  }

  marca('turno e carga horária');

  // 5) Datas de início e fim da carência (mesmo Período usado nas datas do contrato da admissão).
  // Ficam por último porque o SIRAC refaz a tela depois de cada lista.
  for (const [chave, nome, valor] of [
    ['data_inicio', 'Data de início', d.dataInicio],
    ['data_fim', 'Data de fim', d.dataFim],
  ]) {
    if (!valor) {
      pendencias.push(`${nome} (não veio preenchida)`);
      continue;
    }
    const rotulos = SUBSTITUICAO.rotulosDatas[chave === 'data_inicio' ? 'inicio' : 'fim'];
    let campo = null;
    let dicas = [];
    const limite = Date.now() + 5000;
    do {
      campo = await esperarCampoPorRotulos(page, chave, rotulos, 250);
      if (!campo) {
        // Texto do rótulo diferente do esperado: procura pelo sentido ("início", "fim"/"término").
        const r = await marcarDataAproximada(page, chave);
        if (r.achou) campo = campoMarcado(page, chave);
        else dicas = r.rotulos;
      }
    } while (!campo && Date.now() < limite);
    if (!campo) {
      pendencias.push(
        `${nome} (não achei o campo${dicas.length ? `; rótulos parecidos na tela: ${dicas.join(' | ')}` : ''}; preencha à mão)`
      );
      continue;
    }
    try {
      await preencherCampo(campo, valor, { mascara: true });
      preenchidos.push(`${nome} (${valor})`);
    } catch (err) {
      pendencias.push(`${nome} (não consegui preencher: ${err.message.split('\n')[0]})`);
    }
  }
  marca('datas');

  // Última conferência: a carga horária pode ter sido apagada quando o SIRAC refez a tela.
  if (cargaOk) {
    const campo = await acharCampoCarga(page, 3000);
    const atual = campo ? await valorDoCampo(campo) : '';
    if (!cargaConfere(atual, soDigitos(d.cargaHoraria).replace(/^0+(?=\d)/, ''))) {
      const r = await preencherCarga(page, d.cargaHoraria);
      if (!r.ok) {
        const i = preenchidos.findIndex((p) => p.startsWith('Carga Horária'));
        if (i >= 0) preenchidos.splice(i, 1);
        pendencias.push(`Carga Horária (${r.motivo}; escolha ${d.cargaHoraria} à mão)`);
      }
    }
  }

  // Fica para você: conferir as datas, Motivo da Carência (com titular), Especialidade (sem titular) e Adicionar.
  await page.bringToFront();
  return { preenchidos, pendencias };
}

module.exports = { preencherSubstituicao };