// navegador.js
// Um navegador só, com perfil salvo (o login fica gravado na pasta de dados do programa),
// e uma aba por sistema (EducaDF, SIGEP, SIRAC).

const path = require('path');
const { chromium } = require('playwright');
const config = require('./config');

// No programa instalado, SISTEMA_DADOS é a pasta de dados do usuário; no "npm run servidor" é a pasta do projeto.
const PASTA_PERFIL = path.join(process.env.SISTEMA_DADOS || '.', 'perfil-chrome');

let contextoPromise = null;

function obterContexto() {
  if (!contextoPromise) {
    contextoPromise = chromium
      .launchPersistentContext(PASTA_PERFIL, {
        channel: config.NAVEGADOR_CANAL || 'chrome', // 'chrome' ou 'msedge' (Edge, já vem no Windows)
        headless: false,
        viewport: null,
        slowMo: config.LENTIDAO_MS ?? 150,
        ignoreDefaultArgs: ['--enable-automation'],
        args: ['--disable-blink-features=AutomationControlled'],
      })
      .then((ctx) => {
        ctx.on('close', () => {
          contextoPromise = null;
        });
        return ctx;
      })
      .catch((err) => {
        contextoPromise = null;
        throw err;
      });
  }
  return contextoPromise;
}

const abas = {};

// Devolve a aba do sistema. Se ela ainda estiver aberta, reaproveita (assim os filtros
// da tela ficam como você deixou).
async function obterAba(chave, url) {
  const ctx = await obterContexto();
  let page = abas[chave];
  if (!page || page.isClosed()) {
    page = await ctx.newPage();
    abas[chave] = page;
    if (url) {
      await page.goto(url);
    } else {
      console.log(
        `Aba "${chave}" aberta em branco: preencha a URL dela no config.js, ou navegue até a tela à mão (sem fechar a janela).`
      );
    }
  }
  await page.bringToFront();
  return page;
}

// Aba nova, sem reaproveitar (usada pelo SIRAC, que começa o fluxo do zero a cada admissão).
async function novaAba() {
  const ctx = await obterContexto();
  return ctx.newPage();
}

// Guarda uma aba aberta com novaAba() sob um nome, para outras telas continuarem nela
// (ex.: a Substituição continua na aba do SIRAC aberta pelo cadastro de admissão).
function registrarAba(chave, page) {
  abas[chave] = page;
}

// Devolve a aba já aberta (ou null se não existir / foi fechada), sem abrir nada novo.
function abaAberta(chave) {
  const page = abas[chave];
  return page && !page.isClosed() ? page : null;
}

// Fecha o navegador (usado ao sair do programa).
async function fecharTudo() {
  if (!contextoPromise) return;
  const ctx = await contextoPromise.catch(() => null);
  if (ctx) await ctx.close().catch(() => {});
}

module.exports = { obterContexto, obterAba, novaAba, registrarAba, abaAberta, fecharTudo };