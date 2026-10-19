// server.js
// Servidor local: recebe os dados do formulário e chama a automação.

const fs = require('fs');
const path = require('path');

// Pasta onde ficam o .env e o perfil do navegador: a pasta de dados do programa instalado
// (definida pelo main.js) ou, rodando direto com "npm run servidor", a pasta do projeto.
const DADOS = process.env.SISTEMA_DADOS || __dirname;

// Lê usuário e senha do arquivo .env (nunca coloque senha no código). Precisa do Node 20.12 ou mais novo.
try {
  process.loadEnvFile(path.join(DADOS, '.env'));
} catch (err) {
  console.log(`Não consegui ler o arquivo .env em ${DADOS} (${err.code || err.message}).`);
}

const VARIAVEIS = ['EDUCADF_USUARIO', 'EDUCADF_SENHA', 'SIGEP_SENHA', 'SIRAC_SENHA'];
const faltando = () => VARIAVEIS.filter((v) => !process.env[v]);

const express = require('express');
const { preencherAdmissao } = require('./sirac');
const { buscarNoEducaDF } = require('./edudf');
const { buscarNoSigep, buscarServidorPorNome } = require('./sigep');
const { buscarCarencia, buscarPeriodoCarencia } = require('./carencia');
const { preencherSubstituicao } = require('./substituicao');
const cancelamento = require('./cancelamento');

const app = express();
app.use(express.json());

// Buscas que podem ser canceladas pelo botão "Cancelar busca".
app.use(['/buscar', '/carencia/datas'], (req, res, next) => cancelamento.executar(next));
app.use(express.static(path.join(__dirname, 'public')));

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// ---------- Configurações (.env) ----------
// Tela "Configurações": grava usuários e senhas no .env da pasta de dados e já atualiza o
// programa em andamento (não precisa fechar e abrir de novo).

const ARQ_ENV = path.join(DADOS, '.env');
const CHAVES_ENV = ['EDUCADF_USUARIO', 'EDUCADF_SENHA', 'SIGEP_SENHA', 'SIRAC_USUARIO', 'SIRAC_SENHA'];
const SO_SENHAS = ['EDUCADF_SENHA', 'SIGEP_SENHA', 'SIRAC_SENHA'];

function lerEnv() {
  try {
    return fs.readFileSync(ARQ_ENV, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}

// Coloca aspas só quando precisa. Devolve null se o valor não cabe em nenhum tipo de aspas.
function formatarValorEnv(v) {
  if (!/[\s#'"`\\]/.test(v)) return v;
  for (const q of ['"', "'", '`']) if (!v.includes(q)) return q + v + q;
  return null;
}

app.get('/configuracao/estado', (req, res) => {
  res.json({
    campos: CHAVES_ENV.map((chave) => ({
      chave,
      preenchido: Boolean(process.env[chave]),
      valor: SO_SENHAS.includes(chave) ? '' : process.env[chave] || '', // a senha nunca sai daqui
    })),
  });
});

app.post('/configuracao', (req, res) => {
  const novos = {};
  for (const chave of CHAVES_ENV) {
    const v = String((req.body.valores || {})[chave] ?? '').trim();
    if (!v) continue; // em branco = mantém o que já existe
    const f = formatarValorEnv(v);
    if (f === null) {
      return res.status(400).json({ ok: false, erro: `O valor de ${chave} tem aspas demais para salvar.` });
    }
    novos[chave] = { bruto: v, formatado: f };
  }

  const linhas = lerEnv();
  for (const [chave, { formatado }] of Object.entries(novos)) {
    const i = linhas.findIndex((l) => l.startsWith(chave + '='));
    if (i >= 0) linhas[i] = `${chave}=${formatado}`;
    else linhas.push(`${chave}=${formatado}`);
  }

  try {
    fs.writeFileSync(ARQ_ENV, linhas.join('\n').replace(/\n*$/, '\n'), 'utf8');
  } catch (err) {
    console.error('Configuração:', err.code || err.message);
    return res.status(500).json({ ok: false, erro: `Não consegui gravar o .env (${err.code || err.message}).` });
  }
  for (const [chave, { bruto }] of Object.entries(novos)) process.env[chave] = bruto;
  res.json({ ok: true });
});

// Confere os dados antes de abrir o navegador. Devolve a mensagem de erro ou null.
function validar(d) {
  if (!d.nome || !d.nome.trim()) return 'Informe o nome.';
  if (soDigitos(d.cpf).length !== 11) return 'O CPF precisa ter 11 dígitos.';
  if (!d.classificacao || !String(d.classificacao).trim()) return 'Informe a classificação.';
  if (!soDigitos(d.matricula)) return 'Informe a matrícula (somente números).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.dataNascimento || '')) return 'Informe a data de nascimento.';
  if (!['Masculino', 'Feminino'].includes(d.sexo)) return 'Escolha o sexo.';
  return null;
}

// 2026-02-10 -> 10/02/2026 (vazio se não estiver nesse formato)
const paraBR = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : '');

// Mensagem de erro mais clara quando a janela do navegador é fechada no meio da busca.
const mensagem = (err) =>
  /has been closed/i.test(err.message)
    ? 'a janela do navegador foi fechada durante a busca. Não feche a janela dos sistemas; tente de novo.'
    : String(err.message)
        .replace(/\u001b\[[0-9;]*m/g, '') // cores do terminal que o Playwright coloca nas mensagens
        .split('Call log')[0]
        .trim();

// Busca os dados do candidato pelo CPF: EducaDF (nome, classificação) e SIGEP (matrícula, nascimento).
// Se um dos sistemas falhar, devolve o que conseguiu e um aviso, para você completar à mão.
// Obs.: só registra mensagens de erro no terminal, nunca os dados pessoais.
app.post('/buscar', async (req, res) => {
  const cpf = soDigitos(req.body.cpf);
  if (cpf.length !== 11) return res.status(400).json({ ok: false, erro: 'O CPF precisa ter 11 dígitos.' });

  const resultado = { ok: true, nome: '', classificacao: '', situacao: '', matriculas: [], dataNascimento: '', historico: null, avisos: [], notas: [] };

  // Primeiro o EducaDF, depois o SIGEP (um de cada vez).
  try {
    const e = await buscarNoEducaDF(cpf);
    Object.assign(resultado, { nome: e.nome, classificacao: e.classificacao, situacao: e.situacao, carencia: e.carencia, historico: e.historico });
  } catch (err) {
    if (cancelamento.cancelado()) return res.json({ ok: false, cancelado: true, erro: 'Busca cancelada.' });
    console.error('EducaDF:', err.message);
    resultado.avisos.push(`EducaDF: ${mensagem(err)}`);
  }

  if (cancelamento.cancelado()) return res.json({ ok: false, cancelado: true, erro: 'Busca cancelada.' });

  try {
    const s = await buscarNoSigep(cpf);
    Object.assign(resultado, { matriculas: s.matriculas, dataNascimento: s.dataNascimento });
    if (s.aviso) resultado.avisos.push(s.aviso);
    if (s.nota) resultado.notas.push(s.nota);
  } catch (err) {
    if (cancelamento.cancelado()) return res.json({ ok: false, cancelado: true, erro: 'Busca cancelada.' });
    console.error('SIGEP:', err.message);
    resultado.avisos.push(`SIGEP: ${mensagem(err)}`);
  }

  // Avisa na tela quando o login automático está desligado por falta de dados no .env.
  const sem = faltando();
  if (sem.length) {
    resultado.notas.push(
      `Login automático desligado: não achei ${sem.join(', ')} no .env (preencha na tela Configurações).`
    );
  }

  res.json(resultado);
});

// Busca o Período da carência no EducaDF (Gestão de Carência) para preencher as datas do contrato.
app.post('/carencia/datas', async (req, res) => {
  const codigo = soDigitos(req.body.codigo);
  if (!codigo) return res.status(400).json({ ok: false, erro: 'Informe o código da carência.' });
  try {
    const c = await buscarPeriodoCarencia(codigo);
    res.json({ ok: true, ...c });
  } catch (err) {
    if (cancelamento.cancelado()) return res.json({ ok: false, cancelado: true, erro: 'Busca cancelada.' });
    console.error('EducaDF (período):', err.message);
    res.status(500).json({ ok: false, erro: `EducaDF: ${mensagem(err)}` });
  }
});

// Botão "Cancelar busca": as buscas em andamento param na próxima verificação.
app.post('/cancelar', (req, res) => {
  cancelamento.cancelar();
  res.json({ ok: true });
});

app.post('/preencher', async (req, res) => {
  const dados = {
    nome: String(req.body.nome || '').trim().toUpperCase(),
    cpf: req.body.cpf,
    classificacao: String(req.body.classificacao || '').trim(),
    matricula: soDigitos(req.body.matricula),
    dataNascimento: req.body.dataNascimento,
    sexo: req.body.sexo,
    dataAssinatura: paraBR(req.body.dataAssinatura),
    dataTermino: paraBR(req.body.dataTermino),
  };

  const erro = validar(dados);
  if (erro) return res.status(400).json({ ok: false, erro });

  try {
    await preencherAdmissao(dados);
    res.json({ ok: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ---------- Substituição ----------

// Busca a carência no EducaDF (titular, turno, carga horária) e, se houver titular,
// o nome, CPF e matrícula dele no SIGEP. Se o SIGEP falhar, devolve o que conseguiu.
app.post('/substituicao/buscar', async (req, res) => {
  const codigo = soDigitos(req.body.codigo);
  if (!codigo) return res.status(400).json({ ok: false, erro: 'Informe o código da carência.' });

  const resultado = {
    ok: true,
    codigo,
    temTitular: false,
    titular: '',
    nome: '',
    cpf: '',
    matricula: '',
    matriculas: [],
    turno: '',
    cargaHoraria: '',
    periodo: '',
    dataInicio: '',
    dataFim: '',
    textoHorarios: '',
    avisos: [],
    notas: [],
  };

  try {
    const c = await buscarCarencia(codigo);
    Object.assign(resultado, {
      temTitular: c.temTitular,
      titular: c.titular,
      nome: c.titular,
      turno: c.turno,
      cargaHoraria: c.cargaHoraria,
      periodo: c.periodo,
      dataInicio: c.dataInicio,
      dataFim: c.dataFim,
      textoHorarios: c.textoHorarios,
    });
    resultado.avisos.push(...c.avisos.map((a) => `EducaDF: ${a}`));
  } catch (err) {
    console.error('EducaDF (carência):', err.message);
    return res.status(500).json({ ok: false, erro: `EducaDF: ${mensagem(err)}` });
  }

  if (resultado.temTitular) {
    try {
      const s = await buscarServidorPorNome(resultado.titular);
      Object.assign(resultado, { nome: s.nome, cpf: s.cpf, matricula: s.matricula, matriculas: s.matriculas });
      resultado.avisos.push(...s.avisos);
    } catch (err) {
      console.error('SIGEP (titular):', err.message);
      resultado.avisos.push(`SIGEP: ${mensagem(err)} Digite CPF e matrícula do titular à mão.`);
    }
  }

  const sem = faltando();
  if (sem.length) {
    resultado.notas.push(
      `Login automático desligado: não achei ${sem.join(', ')} no .env (preencha na tela Configurações).`
    );
  }

  res.json(resultado);
});

// Clica na aba Substituição do SIRAC e preenche. Não clica em Adicionar.
app.post('/substituicao/preencher', async (req, res) => {
  const dados = {
    temTitular: Boolean(req.body.temTitular),
    nome: String(req.body.nome || '').trim().toUpperCase(),
    cpf: soDigitos(req.body.cpf),
    matricula: soDigitos(req.body.matricula),
    turno: String(req.body.turno || '').trim(),
    cargaHoraria: soDigitos(req.body.cargaHoraria),
    dataInicio: paraBR(req.body.dataInicio),
    dataFim: paraBR(req.body.dataFim),
  };

  if (dados.temTitular) {
    if (!dados.nome) return res.status(400).json({ ok: false, erro: 'Informe o nome do titular.' });
    if (dados.cpf.length !== 11) return res.status(400).json({ ok: false, erro: 'O CPF do titular precisa ter 11 dígitos.' });
    if (!dados.matricula) return res.status(400).json({ ok: false, erro: 'Informe a matrícula do titular.' });
  }

  try {
    const r = await preencherSubstituicao(dados);
    res.json({ ok: true, ...r });
  } catch (err) {
    console.error('SIRAC (substituição):', err.message);
    res.status(500).json({ ok: false, erro: mensagem(err) });
  }
});

// Só aceita conexões da própria máquina (são dados pessoais)
const PORTA = 3000;
const servidor = app.listen(PORTA, '127.0.0.1', () => {
  console.log(`Abra http://localhost:${PORTA}`);
  const sem = faltando();
  console.log(
    sem.length
      ? `ATENÇÃO: não achei no .env: ${sem.join(', ')}. O login automático fica desligado.`
      : '.env lido: login automático ativo (EducaDF, SIGEP e SIRAC).'
  );
});

module.exports = { servidor };