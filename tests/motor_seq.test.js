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
  somarMinutos(data, minutos) {
    return new Date(data.getTime() + minutos * 60000);
  },
  chaveDia(data) {
    return data.getFullYear() + '-' + this.dois_(data.getMonth() + 1) + '-' + this.dois_(data.getDate());
  },
};

/**
 * Calendario de mentira para exercitar alocarSlot_: capacidade igual todo dia,
 * menos os dias listados em semTurno.
 */
const Calendario = { capacidadeMin: 480, semTurno: {}, pessoas: 1 };

/** Le a constante do proprio fonte: voltar a 0,01 minuto quebra os testes. */
function extractConst(name) {
  const m = src.match(new RegExp('const ' + name + ' = ([^;]+);'));
  if (!m) throw new Error('nao achei const ' + name);
  return Number(m[1]);
}

const vm = require('vm');
const ctx = {
  Util: Util,
  EPS_MIN: extractConst('EPS_MIN'),
  TIPO_ORDEM: { planejada: 'PLANEJADA', liberada: 'LIBERADA', encerrada: 'ENCERRADA' },
  MODO_OTIMIZACAO: { antecipar: 'antecipar', jit: 'jit' },
  minutosEfetivosMaquina_(maq, dia) {
    return Calendario.semTurno[Util.chaveDia(dia)] ? 0 : Calendario.capacidadeMin;
  },
  pessoasDisponiveis_() { return Calendario.pessoas; },
  consumirMinutosOperadores_() {},
};
vm.createContext(ctx);
vm.runInContext(
  extractFn('isoDia_') + '\n' +
  extractFn('dataOrdemIso_') + '\n' +
  extractFn('indicePeriodo_') + '\n' +
  extractFn('ordemEncerrada_') + '\n' +
  extractFn('ordemFirme_') + '\n' +
  extractFn('politicaCongelamento_') + '\n' +
  extractFn('politicaOtimizacao_') + '\n' +
  extractFn('jobPiorQueCabeca_') + '\n' +
  extractFn('jobNaJanelaCabeca_') + '\n' +
  extractFn('escolherProximoJob_') + '\n' +
  extractFn('alocarSlot_') + '\n' +
  extractFn('planejadaForaDaJanela_') + '\n' +
  extractFn('dataFilaProducao_') + '\n' +
  extractFn('compararPedidoProducao_'),
  ctx
);
const escolherProximoJob_ = ctx.escolherProximoJob_;
const ordemFirme_ = ctx.ordemFirme_;
const isoDia_ = ctx.isoDia_;
const indicePeriodo_ = ctx.indicePeriodo_;
const politicaCongelamento_ = ctx.politicaCongelamento_;
const politicaOtimizacao_ = ctx.politicaOtimizacao_;
const alocarSlot_ = ctx.alocarSlot_;
const planejadaForaDaJanela_ = ctx.planejadaForaDaJanela_;
const compararPedidoProducao_ = ctx.compararPedidoProducao_;
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

const cabeca15 = job('S|15', 'P5EB1593', '2026-09-15', 10);
const out01 = job('S|01', 'P5EB1593', '2026-10-01', 10);
ok(
  'mesmo item 01/10 nao fura cabeca 15/09',
  escolherProximoJob_([cabeca15, out01], 'P5EB1593', '', janela, null, hoje) === cabeca15
);

ok('isoDia_ corta datetime', isoDia_('2026-09-16T08:00:00') === '2026-09-16');
ok('isoDia_ aceita Date', isoDia_(new Date(2026, 8, 15)) === '2026-09-15');
const horiz = [
  { inicio: '2026-09-10', fim: '2026-09-10' },
  { inicio: '2026-09-16', fim: '2026-09-16' },
  { inicio: '2026-10-01', fim: '2026-10-01' },
];
ok('MRP nao joga demanda com hora no ultimo bucket', indicePeriodo_(horiz, '2026-09-16T00:00:00') === 1);

const horizAntes = [
  { inicio: '2016-09-12', fim: '2026-09-09' },
  { inicio: '2026-09-10', fim: '2026-09-10' },
  { inicio: '2026-12-28', fim: '2036-12-24' },
];
ok(
  'oferta de 10/09 com hora cai no dia, nao no DEPOIS',
  indicePeriodo_(horizAntes, '2026-09-10T08:00:00') === 1
);
ok(
  'data antes do horizonte cai no ANTES, nao no DEPOIS',
  indicePeriodo_(horizAntes, '2026-09-01') === 0
);

ok(
  'congelar 0 nao trava PLANEJADA de hoje',
  !ordemFirme_({ tipo: 'PLANEJADA', travada: false, inicio: hoje }, { dias: 0, limite: null })
);
ok(
  'LIBERADA continua firme mesmo com congelar 0',
  !!ordemFirme_({ tipo: 'LIBERADA', travada: false, inicio: hoje }, { dias: 0, limite: null })
);

function cfg(mapa) {
  return {
    numero: function (k, def) { return mapa[k] != null ? mapa[k] : def; },
    texto: function (k, def) { return mapa[k] != null ? mapa[k] : def; },
    booleano: function (k, def) { return mapa[k] != null ? !!mapa[k] : def; },
  };
}

const congela0 = politicaCongelamento_(cfg({ congelar_dias: 0, congelar_ao_aplicar: true }), hoje);
ok('congelar 0 nao cria limite de hoje', congela0.limite == null && congela0.dias === 0);
ok(
  'PLANEJADA de hoje nao e firme com politica congelar 0',
  !ordemFirme_({ tipo: 'PLANEJADA', travada: false, inicio: hoje }, congela0)
);

const otim = politicaOtimizacao_(cfg({
  otimizacao_modo: 'antecipar',
  otimizacao_semanas_antecipacao: 2,
  otimizacao_folga_dias: 2,
}), hoje);
ok('15/09 com datetime e ASAP nas 2 semanas', otim.antecipa({ dataDesejada: '2026-09-15T00:00:00' }));
ok('15/09 como Date e ASAP nas 2 semanas', otim.antecipa({ dataDesejada: new Date(2026, 8, 15) }));
ok('01/10 com datetime nao e ASAP', !otim.antecipa({ dataDesejada: '2026-10-01T08:00:00' }));
ok('01/10 como Date nao e ASAP', !otim.antecipa({ dataDesejada: new Date(2026, 9, 1) }));
ok(
  'modo JIT nunca puxa para hoje',
  !politicaOtimizacao_(cfg({
    otimizacao_modo: 'jit',
    otimizacao_semanas_antecipacao: 2,
    otimizacao_folga_dias: 2,
  }), hoje).antecipa({ dataDesejada: '2026-09-15' })
);

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

const puxado = projetar([100, 0, 0], [100, 0, 0], 0);
ok('reparo MRP puxando oferta para a semana 1 zera o projetado', puxado[0] >= 0 && puxado.every(function (v) { return v >= 0; }));

const sku = projetar(
  [100, 43.904],
  [100 - 2.239 + 43.904, 0],
  0
);
ok(
  'oferta no fim antecipado cobre a semana 1; buraco posterior = pecas sem OT',
  sku[0] > 0 && Math.abs(sku[1] + 2.239) < 0.001
);

/* ---------------------------------------------- alocarSlot_ e ordens pequenas */

const maqAd = { id: 'ADTP1-1', consumoOperador: 1 };
const fimHorizonte = new Date(2026, 11, 31);
const PECAS_HORA = 6000;

function slotDe(qtd, inicio) {
  return alocarSlot_(
    maqAd, inicio || hoje, fimHorizonte, (qtd / PECAS_HORA) * 60, {}, [], [], [], []
  );
}

function inicioDe(slot) {
  return slot ? Util.chaveDia(slot.inicio) : 'sem slot';
}

/**
 * O print do PSEB1593: as cinco linhas abaixo de um milheiro voltavam sem slot
 * e o motor as reportava como "sem capacidade", somando o furo de 2,239.
 */
[0.201, 0.33, 0.429, 0.585, 0.694].forEach(function (qtd) {
  ok('ordem de ' + qtd + ' recebe slot', !!slotDe(qtd));
});
ok('ordem de 1,469 continua recebendo slot', !!slotDe(1.469));
ok('ordem de 43,904 continua recebendo slot', !!slotDe(43.904));

ok(
  'duracao zero cai no primeiro dia com capacidade',
  inicioDe(alocarSlot_(maqAd, hoje, fimHorizonte, 0, {}, [], [], [], [])) === '2026-09-10'
);

Calendario.semTurno['2026-09-10'] = true;
ok(
  'ordem minuscula nao inventa capacidade em dia sem turno',
  inicioDe(slotDe(0.201)) === '2026-09-11'
);
delete Calendario.semTurno['2026-09-10'];

Calendario.capacidadeMin = 0;
ok('horizonte sem nenhuma capacidade continua sem slot', slotDe(0.201) === null);
Calendario.capacidadeMin = 480;

ok(
  'ordem maior que o horizonte inteiro continua sem slot',
  alocarSlot_(maqAd, hoje, Util.somarDias(hoje, 1), 5000, {}, [], [], [], []) === null
);

const ocupado = {};
ok(
  'ordem minuscula consome os minutos que usou',
  !!alocarSlot_(maqAd, hoje, fimHorizonte, 0.00201, ocupado, [], [], [], []) &&
    Math.abs(ocupado[maqAd.id]['2026-09-10'] - 0.00201) < 1e-9
);

/* --------------------------------------------------- fila da lista de pedidos */

function pedido(chave, dataDesejada, fim, sequencia) {
  return { chave: chave, dataDesejada: dataDesejada, dataPrometida: dataDesejada, fim: fim, sequencia: sequencia };
}

const comOt0110 = pedido('SO428850|1', '2026-10-01', '2026-09-18', 15);
const semOt1509 = pedido('SO427393|1', '2026-09-15', '', null);
ok(
  'linha sem OT de 15/09 vem antes de OT programada para 18/09',
  [comOt0110, semOt1509].sort(compararPedidoProducao_)[0] === semOt1509
);
ok(
  'linha sem OT nao passa na frente de OT que ja termina antes dela',
  [pedido('A|1', '2026-09-20', '', null), pedido('B|1', '2026-09-11', '2026-09-11', 1)]
    .sort(compararPedidoProducao_)[0].chave === 'B|1'
);
ok(
  'PCP manual continua mandando na fila',
  [
    Object.assign(pedido('C|1', '2026-09-11', '2026-09-11', 1), { prioridadeManual: 50 }),
    Object.assign(pedido('D|1', '2026-10-01', '', null), { prioridadeManual: 10 }),
  ].sort(compararPedidoProducao_)[0].chave === 'D|1'
);

/* ------------------------------------------- PLANEJADA herdada fora da janela */

const otimJanela = politicaOtimizacao_(cfg({
  otimizacao_modo: 'antecipar',
  otimizacao_semanas_antecipacao: 2,
  otimizacao_folga_dias: 2,
}), hoje);
const semCongela = politicaCongelamento_(cfg({ congelar_dias: 0 }), hoje);
const dem0110 = { dataDesejada: '2026-10-01' };

ok(
  'PLANEJADA de 01/10 parada em 14/09 conta como fora da janela',
  planejadaForaDaJanela_(
    { tipo: 'PLANEJADA', fim: '2026-09-14', travada: false }, dem0110, semCongela, otimJanela
  )
);
ok(
  'PLANEJADA de 01/10 colada no alvo JIT nao conta',
  !planejadaForaDaJanela_(
    { tipo: 'PLANEJADA', fim: '2026-09-29', travada: false }, dem0110, semCongela, otimJanela
  )
);
ok(
  'pedido dentro das 2 semanas pode ser antecipado sem virar aviso',
  !planejadaForaDaJanela_(
    { tipo: 'PLANEJADA', fim: '2026-09-11', travada: false },
    { dataDesejada: '2026-09-15' }, semCongela, otimJanela
  )
);
ok(
  'LIBERADA nao entra no aviso',
  !planejadaForaDaJanela_(
    { tipo: 'LIBERADA', fim: '2026-09-14', travada: false }, dem0110, semCongela, otimJanela
  )
);

if (falhas) {
  console.error('\n' + falhas + ' teste(s) falharam');
  process.exit(1);
}
console.log('\ntodos os testes passaram');
