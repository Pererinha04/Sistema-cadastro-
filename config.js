// config.js
// Tudo que é fixo ou que depende da estrutura da tela do SIRAC fica aqui.

module.exports = {
  // Navegador que o programa abre para os sistemas: 'chrome' (Google Chrome instalado)
  // ou 'msedge' (Microsoft Edge, que já vem no Windows).
  NAVEGADOR_CANAL: 'chrome',

  // Pausa (em milissegundos) que o programa faz depois de cada ação no navegador. Menor = mais rápido.
  // Se o SIRAC começar a dar erros estranhos, volte para 150 (valor antigo).
  LENTIDAO_MS: 60,

  // Tela inicial: Cadastrar Admissão.
  URL_SIRAC:
    'https://sirac-adm.tc.df.gov.br/sirac-adm/faces/restrito/cadastroAdmissao/pesquisa/pesquisar.seam',

  // Teste do "Valor inválido": com true, o programa abre a página inicial do SIRAC e VOCÊ chega em
  // Cadastrar Admissão pelo menu (como no Chrome normal, com ?cid=...). O resto é automático.
  // Se funcionar, o problema era abrir a tela direto pela URL (sem o cid).
  SIRAC_ABRIR_PELO_MENU: true,
  URL_SIRAC_INICIO: 'https://sirac-adm.tc.df.gov.br/sirac-adm/',
  // Itens do menu do SIRAC para chegar em Cadastrar Admissão, na ordem em que você clica
  // (texto exato de cada item), ex.: ['Admissão', 'Cadastrar Admissão']. Vazio = você abre à mão.
  SIRAC_MENU: ['Jurisdicionado', 'Cadastrar Admissão'],

  // Tela "Banco de Aprovado" do EducaDF.
  URL_EDUCADF: 'https://educadf.se.df.gov.br/cadastro-escola/modulos/gestao/banco-horas-aprovado',
  EDUCADF: {
    placeholderCpf: 'CPF',
    menu: ['Modulação', 'Banco de Aprovado'], // cliques no menu lateral para chegar nesta tela
    colunas: {
      nome: 'Nome do Aprovado',
      // 'Ampla' (ex.: 801) ou 'Ordem de Convocação' (ex.: 96)
      classificacao: 'Ampla',
      // Coluna com os códigos, ex.: "SIGEP 381546" e "EducaDF 17643" (um em cada linha).
      // O código NÃO vai para o SIRAC: serve para consultar em Modulação > Gestão de Carência.
      carencia: 'Carência em Exercício',
    },
    // Qual código é usado: o primeiro que começar com este nome
    // ('EducaDF' ou 'SIGEP'). Se não houver, usa o primeiro código que aparecer. '' = sempre o primeiro.
    origemCarencia: 'EducaDF',
    // Ações (botão "..." da linha) > Histórico de convocações: conta as carências do ano abaixo.
    menuHistorico: /hist[óo]rico de convoca[çc][õo]es/i,
    anoHistorico: 2026,
  },

  // Tela "Gerenciar Carências" do EducaDF (Modulação > Gestão de Carência).
  URL_CARENCIA: 'https://educadf.se.df.gov.br/cadastro-escola/modulos/gestao/carencia',
  CARENCIA: {
    placeholderCodigo: 'Código da Carência',
    menu: ['Modulação', 'Gestão de Carência'], // cliques no menu lateral
    menuAcoes: 'Horários da Carência', // item do botão "..." (coluna Ações)
    colunas: {
      titular: 'Professor Titular',
      substituto: 'Professor Substituto',
      periodo: 'Período', // ex.: 10/02/2026 a 22/12/2026 (início = assinatura, fim = término)
      nomeCargaHoraria: 'Nome da Carga Horária', // ex.: 14_M_ATIVIDADES_30H_5ºC (usado só como reserva)
    },
  },

  // Aba "Substituição" do SIRAC: valores que são sempre iguais.
  SUBSTITUICAO: {
    abaTexto: 'Substituição',
    cargo: 'Professor de Educação Básica',
    regiao: 'Paranoá',
    especialidadeComTitular: 'Atividades',
    // Textos que aparecem ao lado dos campos de data na aba Substituição do SIRAC.
    // O programa tenta cada um, na ordem. CONFIRE olhando a tela e ajuste/acrescente se for diferente.
    // Textos possíveis do campo Carga Horária na aba Substituição (tenta na ordem).
    rotulosCarga: ['Carga Horária', 'Carga Horária Semanal', 'Carga Horária (h)', 'Carga Horária (horas)', 'C.H.'],
    rotulosDatas: {
      inicio: ['Data de Início', 'Data Início', 'Início da Carência', 'Data Inicial', 'Início'],
      fim: ['Data de Término', 'Data Término', 'Data de Fim', 'Data Fim', 'Término da Carência', 'Data Final', 'Término', 'Fim'],
    },
  },

  // Tela "Localizar Servidor" do SIGEP (02.CADASTRO).
  URL_SIGEP: 'https://sigep.se.df.gov.br/',
  SIGEP: {
    placeholderBusca: 'INFORME A MATRÍCULA',
    menuBusca: /02\.?\s*CADASTRO/i,
  },

  // Etapa 1 e 2 (telas de escolha)
  JURISDICIONADO: 'SEE',
  EDITAL: '36/2025',
  ESPECIALIDADE: 'Pedagogia',

  // Valores que são sempre iguais no formulário de Admissão
  FIXOS: {
    nacionalidade: 'Brasileiro Nato',
    escolaridade: 'Superior completo',
    aptidao: 'Apto',
    acumulacao: 'Não',
    quitacaoEleitoral: 'Sim',
    declaracaoBens: 'Sim',
    subJudice: 'Não',
  },

  // Textos que aparecem na tela do SIRAC ao lado de cada campo (sem ":" nem "*").
  // O programa usa esses textos para achar o campo quando o seletor em SEL for null.
  // CONFIRA cada um olhando a tela de Admissão e ajuste se o texto for diferente.
  ROTULOS: {
    nome: 'Nome',
    matricula: 'Matrícula',
    classificacao: 'Classificação',
    nascimento: 'Data de Nascimento',
    sexo: 'Sexo',
    nacionalidade: 'Nacionalidade',
    escolaridade: 'Escolaridade',
    aptidao: 'Aptidão Física/Mental',
    acumulacao: 'Acumulação',
    quitacaoEleitoral: 'Quitação Eleitoral',
    declaracaoBens: 'Declaração de Bens',
    subJudice: 'sub judice',
    dataAssinatura: 'Data de Assinatura do Contrato',
    dataTermino: 'Data de Término do Contrato',
    turno: 'Turno',
    // Carga Horária do formulário de Admissão: tenta cada texto, na ordem.
    cargaHoraria: ['Carga Horária', 'Carga Horária Semanal', 'Carga Horária (h)'],
  },

  // Seletores CSS dos campos. null = achar pelo texto de ROTULOS.
  // Se algum campo não for achado, coloque aqui o seletor real, ex.: '[id="form:nome"]'.
  // Nos radios, o seletor é o do campo "Sim"/"Não" (ou "Masculino"/"Feminino") escolhido.
  SEL: {
    cpf: null, // null = último campo de texto da página

    nome: null,
    matricula: null,
    classificacao: null,
    nascimento: null,
    dataAssinatura: null,
    dataTermino: null,
    turno: null, // se o Turno for uma lista, o seletor dela
    cargaHoraria: null, // seletor da Carga Horária, se o rótulo não for achado

    nacionalidade: null,
    escolaridade: null,
    aptidao: null,

    sexo: { Masculino: null, Feminino: null },
    acumulacao: { Sim: null, Não: null },
    quitacaoEleitoral: { Sim: null, Não: null },
    declaracaoBens: { Sim: null, Não: null },
    subJudice: { Sim: null, Não: null },
  },
};