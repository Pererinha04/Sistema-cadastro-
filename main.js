// main.js
// Janela do programa (Electron). Sobe o servidor local e mostra o formulário numa janela própria.
// As configurações (.env) e o login salvo ficam na pasta de dados do usuário, não na pasta de instalação.

const { app, BrowserWindow, Menu, dialog, shell, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');

// Precisa vir ANTES de carregar o server.js e o navegador.js.
process.env.SISTEMA_DADOS = app.getPath('userData');

// Grava as mensagens de andamento e de erro (as que antes iam para o terminal) em log.txt.
// Não contém CPF, senhas nem outros dados pessoais. O arquivo é recriado a cada abertura.
const ARQUIVO_LOG = path.join(app.getPath('userData'), 'log.txt');
try {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(ARQUIVO_LOG, '', 'utf8');
} catch {}
function registrar(args) {
  try {
    const texto = args.map((a) => (typeof a === 'string' ? a : String(a && a.message ? a.message : a))).join(' ');
    fs.appendFileSync(ARQUIVO_LOG, `[${new Date().toLocaleTimeString('pt-BR')}] ${texto}\n`, 'utf8');
  } catch {}
}
for (const nivel of ['log', 'error']) {
  const original = console[nivel].bind(console);
  console[nivel] = (...args) => {
    original(...args);
    registrar(args);
  };
}

const MODELO_ENV = `# Este arquivo é preenchido pela tela "Configurações" do programa.
EDUCADF_USUARIO=
EDUCADF_SENHA=
SIGEP_SENHA=
SIRAC_USUARIO=
SIRAC_SENHA=
`;

let janela = null;
let saindo = false;

function criarJanela() {
  // Tema escuro do Windows para a barra de título. A barra de menu fica sempre escondida
  // (a navegação é feita pelos botões da própria tela).
  nativeTheme.themeSource = 'dark';
  janela = new BrowserWindow({
    width: 960,
    height: 900,
    title: 'Preencher admissão no SIRAC',
    backgroundColor: '#07111f',
    icon: path.join(__dirname, 'icon.ico'), // ícone da janela e da barra de tarefas
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });
  janela.setMenuBarVisibility(false);
  janela.loadURL('http://127.0.0.1:3000');
  janela.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.on('closed', () => {
    janela = null;
  });
}

function montarMenu() {
  const modelo = [
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Abrir pasta de configuração (.env)',
          click: () => shell.openPath(app.getPath('userData')),
        },
        { label: 'Abrir arquivo de log', click: () => shell.openPath(ARQUIVO_LOG) },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Tela',
      submenu: [
        { label: 'Cadastro de admissão', click: () => janela && janela.loadURL('http://127.0.0.1:3000/') },
        { label: 'Substituição', click: () => janela && janela.loadURL('http://127.0.0.1:3000/substituicao.html') },
        { label: 'Configurações', click: () => janela && janela.loadURL('http://127.0.0.1:3000/configuracao.html') },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(modelo));
}

// Só uma cópia do programa por vez (a porta 3000 e o perfil do navegador são únicos).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (janela) {
      if (janela.isMinimized()) janela.restore();
      janela.focus();
    }
  });

  app.whenReady().then(async () => {
    montarMenu();

    // Primeira execução: cria o .env em branco e avisa que as senhas são preenchidas na tela Configurações.
    const arquivoEnv = path.join(app.getPath('userData'), '.env');
    if (!fs.existsSync(arquivoEnv)) {
      fs.mkdirSync(app.getPath('userData'), { recursive: true });
      fs.writeFileSync(arquivoEnv, MODELO_ENV, 'utf8');
      await dialog.showMessageBox({
        type: 'info',
        title: 'Primeira execução',
        message: 'Falta informar seus usuários e senhas.',
        detail: 'Quando o programa abrir, clique no botão "Configurações" no topo da tela, preencha os dados e clique em Salvar.',
        buttons: ['OK'],
        defaultId: 0,
      });
    }

    const { servidor } = require('./server');
    servidor.once('listening', criarJanela);
    servidor.once('error', (err) => {
      dialog.showErrorBox(
        'Não consegui iniciar o programa',
        err.code === 'EADDRINUSE'
          ? 'A porta 3000 já está em uso. Feche outro programa que a use (ou outra cópia deste) e tente de novo.'
          : err.message
      );
      app.quit();
    });
  });

  // Fecha também o navegador dos sistemas (EducaDF, SIGEP, SIRAC) ao sair.
  app.on('before-quit', async (e) => {
    if (saindo) return;
    e.preventDefault();
    saindo = true;
    try {
      await require('./navegador').fecharTudo();
    } catch {}
    app.quit();
  });

  app.on('window-all-closed', () => app.quit());
}