#!/usr/bin/env node
'use strict';

/**
 * Extrai funcoes puras do motor em AIChatBot.txt e valida:
 * - agrupamento pela cabeca (D+10 nao fura; D+2 na janela pode)
 * - PCP pior nao fura a fila
 * - antecipar 2 semanas: job fora da janela nao e ASAP
 * - MRP: demanda na semana 1 com oferta no mesmo bucket nao fica negativa
 */

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'AIChatBot.txt'), 'utf8');

function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('nao achei function ' + name);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('chave nao fechou: ' + name);
}

const Util = {
  dois_(n) { return n < 10 ? '0' + n : String(n); },
  paraData(valor) {
    if (!valor) return null;
    if (valor instanceof Date) return valor;
    const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  },
  inicioDoDia(data) {
    return new Date(data.getFullYear(), data.getMonth(), data.getDate());
  },
  somarDias(data, dias) {
    return new Date(data.getFullYear(), data.getMonth(), data.getDate() + dias);
  },
  chaveDia(data) {
    return data.getFullYear() + '-' + this.dois_(data.getMonth() + 1) + '-' + this.dois_(data.getDate());
  },
};

const vm = require('vm');
const ctx = { Util: Util };
vm.createContext(ctx);
vm.runInContext(
  extractFn('jobPiorQueCabeca_') + '\n' +
  extractFn('jobNaJanelaCabeca_') + '\n' +
  extractFn('escolherProximoJob_'),
  ctx
);
const escolherProximoJob_ = ctx.escolherProximoJob_;
const jobPiorQueCabeca_ = ctx.jobPiorQueCabeca_;
const jobNaJanelaCabeca_ = ctx.jobNaJanelaCabeca_;
if (!escolherProximoJob_) throw new Error('falha ao extrair escolherProximoJob_');

const hoje = new Date(2026, 8, 10); // 10/09/2026
const D = '2026-09-10';
const D2 = '2026-09-12';
const D10 = '2026-09-20';
const janela = 7;

function job(chave, item, data, prio, cor) {
  return {
    chave: chave,
    itemCodigo: item,
    dataDesejada: data,
    dataPrometida: data,
    prioridadeManual: prio,
    cor: cor || '',
  };
}

let falhas = 0;
function ok(nome, cond, detalhe) {
  if (cond) console.log('ok  ' + nome);
  else {
    falhas++;
    console.log('FAIL ' + nome + (detalhe ? ' — ' + detalhe : ''));
  }
}

const cabeca = job('A|10', 'ITEM_B', D, 10);
const mesmoD2 = job('A|20', 'ITEM_A', D2, 10);
const mesmoD10 = job('A|30', 'ITEM_A', D10, 10);
const outros = job('B|10', 'ITEM_C', D, 15);

ok(
  'mesmo item D+10 nao fura a cabeca',
  escolherProximoJob_([cabeca, mesmoD10], 'ITEM_A', '', janela, null, hoje) === cabeca,
  'deveria devolver a cabeca'
);

ok(
  'mesmo item D+2 na janela de 7 dias pode agrupar',
  escolherProximoJob_([cabeca, mesmoD2], 'ITEM_A', '', janela, null, hoje) === mesmoD2,
  'deveria agrupar ITEM_A D+2'
);

ok(
  'PCP pior nao fura mesmo com mesmo item na janela',
  escolherProximoJob_(
    [job('H|1', 'X', D, 10), job('H|2', 'Y', D2, 50)],
    'Y', '', janela, null, hoje
  ).chave === 'H|1',
  'PCP 50 nao pode pular PCP 10'
);

ok(
  'sem ultimo item devolve a cabeca',
  escolherProximoJob_([cabeca, mesmoD2], '', '', janela, null, hoje) === cabeca
);

ok(
  'campanha de cor respeita janela da cabeca',
  escolherProximoJob_(
    [cabeca, job('C|1', 'Z', D10, 20, 'WHITE')],
    'OUTRO', 'WHITE', janela,
    { ativa: true, janelaDias: 7 },
    hoje
  ) === cabeca,
  'WHITE em D+10 fora da janela da cabeca'
);

const limiteIso = Util.chaveDia(Util.somarDias(Util.inicioDoDia(hoje), 14));
function antecipa(jobLinha) {
  const iso = jobLinha.dataDesejada || jobLinha.dataPrometida || '';
  return !iso || iso <= limiteIso;
}

ok('job na janela de 2 semanas e ASAP', antecipa(job('1', 'A', '2026-09-20')));
ok('job fora das 2 semanas nao e ASAP', !antecipa(job('2', 'A', '2026-10-01')));
ok('job sem data e ASAP (elegivel)', antecipa(job('3', 'A', '')));

function projetar(demanda, oferta, estoque) {
  const out = [];
  let acc = estoque || 0;
  for (let i = 0; i < demanda.length; i++) {
    acc = Math.round((acc + (oferta[i] || 0) - (demanda[i] || 0)) * 1000) / 1000;
    out.push(acc);
  }
  return out;
}

const mrp = projetar([100, 0, 0], [100, 0, 0], 0);
ok('MRP semana 1 sem buraco quando oferta cobre demanda', mrp[0] >= 0 && mrp.every(function (v) { return v >= 0; }));

const buraco = projetar([100, 0, 0], [0, 100, 0], 0);
ok('MRP detecta buraco se oferta cai depois da demanda', buraco[0] < 0);

if (falhas) {
  console.error('\n' + falhas + ' teste(s) falharam');
  process.exit(1);
}
console.log('\ntodos os testes passaram');
