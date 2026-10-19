// cancelamento.js
// Permite cancelar uma busca em andamento (botão "Cancelar busca" da tela).
// Cada busca recebe um número; "cancelar" marca todas as buscas já iniciadas como canceladas.
// As esperas (edudf.js, sigep.js, carencia.js) chamam verificar() e param com o erro "Busca cancelada.".

const { AsyncLocalStorage } = require('async_hooks');

const contexto = new AsyncLocalStorage();
let contador = 0;
let canceladoAte = 0;

// Usado como middleware do servidor: tudo que roda dentro da requisição fica ligado ao mesmo número.
function executar(fn) {
  contador += 1;
  return contexto.run({ id: contador }, fn);
}

function cancelar() {
  canceladoAte = contador;
}

function cancelado() {
  const s = contexto.getStore();
  return Boolean(s && s.id <= canceladoAte);
}

function verificar() {
  if (cancelado()) throw new Error('Busca cancelada.');
}

module.exports = { executar, cancelar, cancelado, verificar };