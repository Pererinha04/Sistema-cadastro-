# Sistema Cadastro

Aplicação desktop desenvolvida com **JavaScript, Electron, Node.js e Playwright**, com o objetivo de automatizar o preenchimento de formulários a partir de uma interface local.

O projeto busca simplificar tarefas repetitivas por meio da automação de navegador e da integração entre os componentes da aplicação.

## 🚀 Funcionalidades

- Aplicação desktop utilizando Electron.
- Servidor local desenvolvido com Node.js e Express.
- Automação de navegador com Playwright.
- Organização da lógica em módulos JavaScript.
- Preparação para geração de instalador para Windows.

## 🛠️ Tecnologias utilizadas

- **JavaScript** — lógica e funcionalidades da aplicação.
- **Electron** — desenvolvimento da interface desktop.
- **Node.js** — execução do ambiente JavaScript.
- **Express** — implementação do servidor local.
- **Playwright** — automação de navegador.
- **Electron Builder** — empacotamento da aplicação para distribuição.

## 📂 Estrutura do projeto

```text
Sistema-cadastro-/
├── public/             # Arquivos públicos da aplicação
├── main.js             # Ponto de entrada do Electron
├── server.js           # Servidor local com Express
├── navegador.js        # Módulo relacionado ao navegador
├── login.js            # Módulo de login
├── sirac.js            # Módulo de automação
├── sigep.js             # Módulo de automação
├── edudf.js             # Módulo de automação
├── carencia.js          # Funcionalidades específicas
├── substituicao.js      # Funcionalidades específicas
├── cancelamento.js      # Funcionalidades específicas
├── config.js            # Configurações da aplicação
├── package.json         # Dependências e scripts
└── .gitignore           # Arquivos ignorados pelo Git
```

## 💻 Como executar o projeto

### Pré-requisitos

- Node.js e npm instalados.
- Git instalado para clonar o repositório.
- Windows recomendado para executar e testar a versão desktop configurada.

### 1. Clone o repositório

```bash
git clone https://github.com/Pererinha04/Sistema-cadastro-.git
```

### 2. Acesse a pasta do projeto

```bash
cd Sistema-cadastro-
```

### 3. Instale as dependências

```bash
npm install
```

### 4. Inicie a aplicação desktop

```bash
npm start
```

O comando inicia a aplicação Electron conforme a configuração do projeto.

### Servidor local

Para iniciar o servidor separadamente, utilize:

```bash
npm run servidor
```

## 📦 Gerar instalador

O projeto possui configuração para empacotamento com Electron Builder.

Para gerar a distribuição, execute:

```bash
npm run dist
```

O resultado depende das configurações de compilação definidas no `package.json`.

## 🎯 Objetivo do projeto

Este projeto foi desenvolvido para aplicar conhecimentos de desenvolvimento de software na automação de tarefas, explorando a integração entre aplicações desktop, servidores locais e ferramentas de automação de navegador.

## 📚 Conhecimentos aplicados

- Desenvolvimento de aplicações desktop com Electron.
- Utilização de Node.js e Express.
- Automação de navegador com Playwright.
- Modularização e organização de código JavaScript.
- Gerenciamento de dependências com npm.
- Configuração de empacotamento de aplicações.

## ⚠️ Observações

- O funcionamento da automação depende da disponibilidade e da estrutura dos sistemas utilizados.
- Utilize a aplicação somente em sistemas para os quais você tenha autorização de acesso.
- Não compartilhe credenciais, tokens, dados pessoais ou informações institucionais confidenciais.
- Este projeto é independente e não representa uma ferramenta oficial dos sistemas eventualmente utilizados.

## 👨‍💻 Desenvolvedor

**CardosoDev**

- GitHub: [@Pererinha04](https://github.com/Pererinha04)

---

Projeto desenvolvido para estudo e aplicação prática de tecnologias JavaScript, automação e desenvolvimento desktop.
