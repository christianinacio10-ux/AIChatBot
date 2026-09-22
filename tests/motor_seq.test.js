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
  arredondarPecas(valor) {
    if (valor == null || isNaN(valor)) return 0;
    return Math.round(valor * 1000) / 1000;
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
  SIM: 'SIM',
  SITUACAO_DEMANDA: { semMaquina: 'SEM_MAQUINA', semUnidade: 'SEM_UNIDADE', bloqueadaMp: 'BLOQUEADA_MP' },
  ESTADO_PRAZO: { noPrazo: 'noPrazo', risco: 'risco', atrasado: 'atrasado', semPrograma: 'semPrograma', bloqueado: 'bloqueado' },
  minutosEfetivosMaquina_(maq, dia) {
    return Calendario.semTurno[Util.chaveDia(dia)] ? 0 : Calendario.capacidadeMin;
  },
  pessoasDisponiveis_() { return Calendario.pessoas; },
  consumirMinutosOperadores_() {},
};
vm.createContext(ctx);
vm.runInContext(
  extractFn('isoDia_') + '\n' +
  extractFn('dataEntregaIso_') + '\n' +
  extractFn('dataDemandaIso_') + '\n' +
  extractFn('dataOrdemIso_') + '\n' +
  extractFn('indicePeriodo_') + '\n' +
  extractFn('ordemEncerrada_') + '\n' +
  extractFn('ordemFirme_') + '\n' +
  extractFn('politicaCongelamento_') + '\n' +
  extractFn('politicaOtimizacao_') + '\n' +
  extractFn('diasAntecipacaoDeConfig_') + '\n' +
  extractFn('unidadeAntecipacaoDeConfig_') + '\n' +
  extractFn('jobPiorQueCabeca_') + '\n' +
  extractFn('jobNaJanelaCabeca_') + '\n' +
  extractFn('escolherProximoJob_') + '\n' +
  extractFn('clonarOcupPessoas_') + '\n' +
  extractFn('alocarSlot_') + '\n' +
  extractFn('planejadaForaDaJanela_') + '\n' +
  extractFn('planejadaQtdDivergente_') + '\n' +
  extractFn('ordemCobreDemanda_') + '\n' +
  extractFn('ordemCobreNesteCalculo_') + '\n' +
  extractFn('dataFilaProducao_') + '\n' +
  extractFn('compararPedidoProducao_') + '\n' +
  extractFn('pecasDaDemanda_') + '\n' +
  extractFn('pecasRestantesDemanda_') + '\n' +
  extractFn('dataSnapshotSo_') + '\n' +
  extractFn('estadoPrazoDatas_') + '\n' +
  extractFn('consumirOcupacaoCalendario_') + '\n' +
  extractFn('destinoOrdemOrfa_') + '\n' +
  extractFn('vctoEsperadoIso_') + '\n' +
  extractFn('inconsistenciaVcto_') + '\n' +
  extractFn('perguntaOperacionalChat_') + '\n' +
  extractFn('textoEstadoChat_') + '\n' +
  extractFn('dataInicioOtimizacao_'),
  ctx
);
const escolherProximoJob_ = ctx.escolherProximoJob_;
const ordemFirme_ = ctx.ordemFirme_;
const isoDia_ = ctx.isoDia_;
const dataEntregaIso_ = ctx.dataEntregaIso_;
const dataDemandaIso_ = ctx.dataDemandaIso_;
const indicePeriodo_ = ctx.indicePeriodo_;
const politicaCongelamento_ = ctx.politicaCongelamento_;
const politicaOtimizacao_ = ctx.politicaOtimizacao_;
const alocarSlot_ = ctx.alocarSlot_;
const planejadaForaDaJanela_ = ctx.planejadaForaDaJanela_;
const compararPedidoProducao_ = ctx.compararPedidoProducao_;
const pecasDaDemanda_ = ctx.pecasDaDemanda_;
const vctoEsperadoIso_ = ctx.vctoEsperadoIso_;
const inconsistenciaVcto_ = ctx.inconsistenciaVcto_;
const pecasRestantesDemanda_ = ctx.pecasRestantesDemanda_;
const planejadaQtdDivergente_ = ctx.planejadaQtdDivergente_;
const ordemCobreNesteCalculo_ = ctx.ordemCobreNesteCalculo_;
const estadoPrazoDatas_ = ctx.estadoPrazoDatas_;
const consumirOcupacaoCalendario_ = ctx.consumirOcupacaoCalendario_;
const dataSnapshotSo_ = ctx.dataSnapshotSo_;
const destinoOrdemOrfa_ = ctx.destinoOrdemOrfa_;
const perguntaOperacionalChat_ = ctx.perguntaOperacionalChat_;
const textoEstadoChat_ = ctx.textoEstadoChat_;
const dataInicioOtimizacao_ = ctx.dataInicioOtimizacao_;
const clonarOcupPessoas_ = ctx.clonarOcupPessoas_;
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
  '01/10 so no Vcto nao e ASAP em 11/09',
  !otim.antecipa({ dataVencimento: '2026-10-01', dataDesejada: '', dataPrometida: '' })
);
ok(
  'Vcto manda mesmo se desejada estiver mais cedo',
  !otim.antecipa({ dataVencimento: '2026-10-01', dataDesejada: '2026-09-15' })
);
ok(
  'Vcto dentro das 2 semanas e ASAP',
  otim.antecipa({ dataVencimento: '2026-09-20' })
);
ok(
  'demanda da grade senta no Vcto, nao na desejada',
  dataDemandaIso_({ dataVencimento: '2026-10-01', dataDesejada: '2026-09-15' }) === '2026-10-01'
);
ok(
  'sem Vcto a entrega cai na prometida',
  dataEntregaIso_({ dataPrometida: '2026-09-22', dataDesejada: '2026-09-15' }) === '2026-09-22'
);
ok(
  'modo JIT nunca puxa para hoje',
  !politicaOtimizacao_(cfg({
    otimizacao_modo: 'jit',
    otimizacao_semanas_antecipacao: 2,
    otimizacao_folga_dias: 2,
  }), hoje).antecipa({ dataDesejada: '2026-09-15' })
);

const dia21 = new Date(2026, 8, 21);
const busca21 = Util.inicioDoDia(dia21);
const otim1s = politicaOtimizacao_(cfg({
  otimizacao_modo: 'antecipar',
  otimizacao_semanas_antecipacao: 1,
  otimizacao_folga_dias: 2,
}), dia21);
ok('1 semana em 21/09: 28/09 ainda e ASAP', otim1s.antecipa({ dataVencimento: '2026-09-28' }));
ok('1 semana continua 7 dias na tela', otim1s.diasAntecipacao === 7 && otim1s.painel.valor === 1 && otim1s.painel.unidade === 'semanas');
ok('1 semana em 21/09: 29/09 ja nao e ASAP', !otim1s.antecipa({ dataVencimento: '2026-09-29' }));
ok(
  '23/09 dentro da semana comeca hoje (21/09)',
  Util.chaveDia(dataInicioOtimizacao_({ dataVencimento: '2026-09-23' }, busca21, otim1s, 120)) === '2026-09-21'
);
ok(
  '29/09 com 1 semana comeca 7 dias antes do Vcto (22/09), nao 1 dia antes',
  Util.chaveDia(dataInicioOtimizacao_({ dataVencimento: '2026-09-29' }, busca21, otim1s, 120)) === '2026-09-22'
);
ok(
  '30/09 com 1 semana comeca em 23/09 e pode usar quinta/sexta ociosas',
  Util.chaveDia(dataInicioOtimizacao_({ dataVencimento: '2026-09-30' }, busca21, otim1s, 120)) === '2026-09-23'
);
ok(
  'folga JIT nao manda no modo antecipar fora da janela',
  Util.chaveDia(dataInicioOtimizacao_({ dataVencimento: '2026-09-29' }, busca21, otim1s, 120)) !== '2026-09-27'
);
ok(
  'JIT continua colado com folga de 2 dias',
  Util.chaveDia(dataInicioOtimizacao_({ dataVencimento: '2026-09-29' }, busca21, politicaOtimizacao_(cfg({
    otimizacao_modo: 'jit',
    otimizacao_semanas_antecipacao: 1,
    otimizacao_folga_dias: 2,
  }), dia21), 60)) === '2026-09-27'
);
ok(
  '0 semanas: 29/09 comeca no Vcto',
  Util.chaveDia(dataInicioOtimizacao_({ dataVencimento: '2026-09-29' }, busca21, politicaOtimizacao_(cfg({
    otimizacao_modo: 'antecipar',
    otimizacao_semanas_antecipacao: 0,
    otimizacao_folga_dias: 2,
  }), dia21), 60)) === '2026-09-29'
);
const otim3d = politicaOtimizacao_(cfg({
  otimizacao_modo: 'antecipar',
  otimizacao_antecipacao_dias: 3,
  otimizacao_antecipacao_unidade: 'dias',
  otimizacao_semanas_antecipacao: 2,
}), dia21);
ok('3 dias mandam mais que a semana antiga', otim3d.diasAntecipacao === 3 && otim3d.painel.unidade === 'dias' && otim3d.painel.valor === 3);
ok('24/09 com 3 dias a partir de 21/09 ainda e agora', otim3d.antecipa({ dataVencimento: '2026-09-24' }));
ok('25/09 com 3 dias ja espera a janela', !otim3d.antecipa({ dataVencimento: '2026-09-25' }));
ok(
  '29/09 com 3 dias comeca em 26/09',
  Util.chaveDia(dataInicioOtimizacao_({ dataVencimento: '2026-09-29' }, busca21, otim3d, 60)) === '2026-09-26'
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

const comOt0110 = pedido('SO428850|1', '2026-10-01', '2026-09-11', 15);
const semOt1509 = pedido('SO427393|1', '2026-09-15', '', null);
ok(
  '15/09 sem OT vem antes do 01/10 mesmo com OT nascida em 11/09',
  [comOt0110, semOt1509].sort(compararPedidoProducao_)[0] === semOt1509
);
ok(
  'mesma data do cliente: sequencia da OT desempata',
  [pedido('A|2', '2026-09-15', '', null), pedido('A|1', '2026-09-15', '2026-09-11', 4)]
    .sort(compararPedidoProducao_)[0].chave === 'A|1'
);
ok(
  'cliente 11/09 com OT vem antes de cliente 20/09 sem OT',
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
const dem0110 = { dataVencimento: '2026-10-01', dataDesejada: '2026-10-01' };

ok(
  'PLANEJADA de 01/10 parada em 14/09 conta como fora da janela',
  planejadaForaDaJanela_(
    { tipo: 'PLANEJADA', fim: '2026-09-14', travada: false }, dem0110, semCongela, otimJanela
  )
);
ok(
  'PLANEJADA de 01/10 colada na janela de 2 semanas antes do Vcto nao conta',
  !planejadaForaDaJanela_(
    { tipo: 'PLANEJADA', fim: '2026-09-29', travada: false }, dem0110, semCongela, otimJanela
  )
);
ok(
  'PLANEJADA 18/09 para 01/10 nas 2 semanas de antecipacao e valida',
  !planejadaForaDaJanela_(
    { tipo: 'PLANEJADA', fim: '2026-09-18', travada: false }, dem0110, semCongela, otimJanela
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

ok(
  'milheiro gravado como peca reaplica fator 1000 na leitura',
  pecasDaDemanda_(0.201, 0.201, 1000) === 201
);
ok(
  'pecas ja convertidas nao sao multiplicadas de novo',
  pecasDaDemanda_(201, 0.201, 1000) === 201
);
ok(
  'fator 1 nao inventa conversao',
  pecasDaDemanda_(0.201, 0.201, 1) === 0.201
);
ok(
  'sem fator deixa o valor gravado',
  pecasDaDemanda_(0.201, 0.201, null) === 0.201
);

ok(
  'prom = desejada → vcto esperado e a desejada',
  vctoEsperadoIso_({ dataDesejada: '2026-09-15', dataPrometida: '2026-09-15' }) === '2026-09-15'
);
ok(
  'prom depois da desejada → vcto esperado e a prometida',
  vctoEsperadoIso_({ dataDesejada: '2026-09-15', dataPrometida: '2026-10-01' }) === '2026-10-01'
);
ok(
  'vcto igual ao esperado nao sinaliza',
  !inconsistenciaVcto_({
    dataDesejada: '2026-09-15', dataPrometida: '2026-10-01', dataVencimento: '2026-10-01',
  }).ativa
);
ok(
  'vcto diferente de prom quando prom > desejada sinaliza',
  inconsistenciaVcto_({
    dataDesejada: '2026-09-15', dataPrometida: '2026-10-01', dataVencimento: '2026-09-15',
  }).ativa &&
  inconsistenciaVcto_({
    dataDesejada: '2026-09-15', dataPrometida: '2026-10-01', dataVencimento: '2026-09-15',
  }).regra === 'promMaior'
);
ok(
  'vcto diferente da desejada quando prom = desejada sinaliza',
  inconsistenciaVcto_({
    dataDesejada: '2026-09-15', dataPrometida: '2026-09-15', dataVencimento: '2026-10-01',
  }).ativa &&
  inconsistenciaVcto_({
    dataDesejada: '2026-09-15', dataPrometida: '2026-09-15', dataVencimento: '2026-10-01',
  }).regra === 'promIgual'
);
ok(
  'plano nao inventa vcto: sem as tres datas nao ha inconsistencia',
  !inconsistenciaVcto_({ dataDesejada: '', dataPrometida: '', dataVencimento: '' }).ativa
);

/* ----------------------------- gap legado: netting e cobertura de quantidade */

ok('estoque parcial deixa o liquido', pecasRestantesDemanda_(100, 0, 50) === 50);
ok('OT parcial deixa o liquido', pecasRestantesDemanda_(201, 0.201, 0) === 200.799);
ok('cobertura cheia zera o liquido', pecasRestantesDemanda_(100, 60, 40) === 0);
ok('nao inventa negativo', pecasRestantesDemanda_(10, 20, 0) === 0);

function programarLiquido_(linhas, firme, estoque, jaItem) {
  const teto = {};
  linhas.forEach(function (d) { teto[d.item] = (teto[d.item] || 0) + d.pecas; });
  const propostas = [];
  const ignoradas = [];
  const coberto = Object.assign({}, jaItem || {});
  linhas.forEach(function (d) {
    const qty = pecasRestantesDemanda_(d.pecas, firme[d.chave] || 0, estoque[d.chave] || 0);
    if (qty <= 0) { ignoradas.push('coberta'); return; }
    if ((firme[d.chave] || 0) > 0) { ignoradas.push('otParcial'); return; }
    const ja = coberto[d.item] || 0;
    if (ja + qty > teto[d.item] + 0.0001) { ignoradas.push('acima'); return; }
    propostas.push({ chave: d.chave, qty: qty });
    coberto[d.item] = ja + qty;
  });
  return { propostas: propostas, ignoradas: ignoradas, coberto: coberto };
}

const skuA = { chave: 'A|1', item: 'SKU', pecas: 100 };
const skuB = { chave: 'B|1', item: 'SKU', pecas: 80 };
const velho = programarLiquido_(
  [skuA, skuB], {}, {}, { SKU: 50 }
);
const velhoCheio = (function () {
  const teto = 180;
  const ja = 50;
  const acimaA = ja + 100 > teto + 0.0001;
  const acimaB = ja + 100 <= teto + 0.0001 && (ja + 100) + 80 > teto + 0.0001;
  return !acimaA && acimaB;
})();
ok('legado: estoque 50 + qtd cheia da A mata a B no teto', velhoCheio);

const liquidoEstoque = programarLiquido_(
  [skuA, skuB], {}, { 'A|1': 50 }, { SKU: 50 }
);
ok(
  'estoque 50 em A programa 50+80 e fecha o SKU',
  liquidoEstoque.propostas.length === 2 &&
    liquidoEstoque.propostas[0].qty === 50 &&
    liquidoEstoque.propostas[1].qty === 80 &&
    Math.abs(liquidoEstoque.coberto.SKU - 180) < 0.0001 &&
    liquidoEstoque.ignoradas.length === 0
);

const milheiroVelho = programarLiquido_(
  [{ chave: 'P|1', item: 'P5EB1593', pecas: 201 }], {}, {}, { P5EB1593: 0.201 }
);
ok(
  'legado: PLANEJADA 0,201 contra SO 201 tomava "acima da demanda"',
  milheiroVelho.ignoradas[0] === 'acima' && milheiroVelho.propostas.length === 0
);
const milheiroNovo = programarLiquido_(
  [{ chave: 'P|1', item: 'P5EB1593', pecas: 201 }], {}, {}, { P5EB1593: 0 }
);
ok(
  'PLANEJADA divergente fora da cobertura programa as 201',
  milheiroNovo.propostas.length === 1 && milheiroNovo.propostas[0].qty === 201
);

ok(
  'LIBERADA parcial nao gera segunda OT',
  programarLiquido_(
    [{ chave: 'L|1', item: 'X', pecas: 100 }], { 'L|1': 60 }, {}, { X: 60 }
  ).ignoradas[0] === 'otParcial'
);

const dem201 = { quantidadePecas: 201, dataVencimento: '2026-10-01' };
const ot201 = { tipo: 'PLANEJADA', quantidade: 201, travada: false };
const otMil = { tipo: 'PLANEJADA', quantidade: 0.201, travada: false };
const semCongelaQtd = politicaCongelamento_(cfg({ congelar_dias: 0 }), hoje);
ok(
  'PLANEJADA com qtd igual continua cobrindo no recalculo novas',
  ordemCobreNesteCalculo_(ot201, semCongelaQtd, false, dem201, otimJanela)
);
ok(
  'PLANEJADA 0,201 nao cobre SO de 201 pecas',
  planejadaQtdDivergente_(otMil, dem201) &&
    !ordemCobreNesteCalculo_(otMil, semCongelaQtd, false, dem201, otimJanela)
);
ok(
  'LIBERADA parcial continua firme mesmo com qtd diferente',
  ordemCobreNesteCalculo_(
    { tipo: 'LIBERADA', quantidade: 60, travada: true },
    semCongelaQtd, false, { quantidadePecas: 100 }, otimJanela
  )
);

ok(
  'snapshot da SO usa Vcto, nao a desejada',
  dataSnapshotSo_({ data_vencimento: '2026-10-01', data_desejada: '2026-09-15' }) === '2026-10-01'
);
ok(
  'prazo atrasado olha o Vcto, nao a prometida vazia',
  estadoPrazoDatas_('2026-09-20', '2026-09-15', '', '', true, '2026-09-15') === 'atrasado'
);
ok(
  'fim antes do Vcto e depois da desejada e risco, nao atraso',
  estadoPrazoDatas_('2026-09-20', '2026-09-15', '2026-10-01', '', true, '2026-10-01') === 'risco'
);
ok(
  'fim na desejada e noPrazo',
  estadoPrazoDatas_('2026-09-15', '2026-09-15', '2026-10-01', '', true, '2026-10-01') === 'noPrazo'
);
ok(
  'fim depois do Vcto e atrasado',
  estadoPrazoDatas_('2026-10-05', '2026-09-15', '2026-10-01', '', true, '2026-10-01') === 'atrasado'
);

ok(
  'pedido sem data nao fura a cabeca no agrupamento',
  escolherProximoJob_(
    [cabeca, job('A|99', 'ITEM_A', '', 10)],
    'ITEM_A', '', janela, null, hoje
  ) === cabeca
);

const ocupCal = { 'ADTP1-1': {}, __pessoas: {} };
consumirOcupacaoCalendario_(ocupCal, maqAd, hoje, 600, [], [], [], []);
ok(
  'job de 10 h no turno de 8 h ocupa dois dias',
  Math.abs((ocupCal['ADTP1-1']['2026-09-10'] || 0) - 480) < 1e-9 &&
    Math.abs((ocupCal['ADTP1-1']['2026-09-11'] || 0) - 120) < 1e-9
);
const ocupCheio = { 'ADTP1-1': { '2026-09-10': 480 }, __pessoas: {} };
alocarSlot_(maqAd, hoje, fimHorizonte, 60, ocupCheio, [], [], [], []);
ok(
  'depois de 8 h no dia 1 a proxima OT nasce no dia 2, nao em cima',
  ocupCheio['ADTP1-1']['2026-09-11'] > 0
);

ok('PLANEJADA congelada sem SO some, nao fica REVISAR', destinoOrdemOrfa_('PLANEJADA', 'SIM') === 'apagar');
ok('PLANEJADA solta sem SO some', destinoOrdemOrfa_('PLANEJADA', 'NAO') === 'apagar');
ok('LIBERADA sem SO vira TECO', destinoOrdemOrfa_('LIBERADA', 'SIM') === 'encerrar');
ok('ENCERRADA orfa nao se remexe', destinoOrdemOrfa_('ENCERRADA', 'SIM') === 'manter');

ok('pergunta de risco e operacional', perguntaOperacionalChat_('quais ordens estao em risco?'));
ok('SKU e operacional', perguntaOperacionalChat_('como esta o item P5EB1593?'));
ok('importar backlog e operacional', perguntaOperacionalChat_('importa o backlog'));
ok('obrigado nao forca ferramenta', !perguntaOperacionalChat_('obrigado'));
ok('oi nao forca ferramenta', !perguntaOperacionalChat_('oi, tudo bem?'));

const foto = textoEstadoChat_({
  demandasAbertas: 12,
  pecasAbertas: 8000,
  ordens: 4,
  flexibilityPct: 91,
  reliabilityPct: 97,
  ingestao: { quando: '2026-09-21', detalhe: '12 abertas' },
  pendencias: ['maquina_sem_velocidade'],
});
ok('foto do chat traz Flexibility em texto, nao JSON de KPI', foto.indexOf('Flexibility: 91%') >= 0 && foto.indexOf('"kpis"') < 0);
ok('foto cita a ultima importacao', foto.indexOf('2026-09-21') >= 0);
ok('foto sem ingestao pede importar', textoEstadoChat_({}).indexOf('importe') >= 0);

ok('UI do Plano liga o botao Importar backlog', src.indexOf('function ligarImportarBacklog') >= 0);
ok('chat nao usa overlay Atualizando no envio', /Estado\.chat\.digitando = true/.test(src) && !/enviarChatUi[\s\S]{0,200}marcarCarregando\(true\)/.test(src));
ok('chat tem ferramenta importarBacklog', /importarBacklog:\s*true/.test(src));
ok('prompt do chat e programador de Blumenau Apparel', src.indexOf('programador de producao da planta ADS Blumenau') >= 0 && src.indexOf('segmento apparel') >= 0);

ok('copia da ocupacao de pessoas nao vaza para o original', (function () {
  const srcOcup = { OP1: { '2026-09-21': 40 } };
  const copia = clonarOcupPessoas_(srcOcup);
  copia.OP1['2026-09-21'] = 99;
  copia.OP2 = { '2026-09-22': 1 };
  return srcOcup.OP1['2026-09-21'] === 40 && !srcOcup.OP2 && copia.OP1['2026-09-21'] === 99;
})());
ok('gravar planilha nao da flush por linha', /descarregar\(\) \{\s*this\._sujo = true;/.test(src));

/**
 * Prioridade sem arraste: planilha de mentira para apiPrioridadeLinha.
 * Interessa o que fica gravado em DEMANDA_AJUSTES, nao o plano devolvido.
 */
function planilhaAjustesFalsa(linhas) {
  const ctxPrio = {
    Util: { paraNumero: Util.paraNumero ? Util.paraNumero : function (v) { return v === '' || v == null ? null : Number(v); } },
    ABAS: { ajustes: 'DEMANDA_AJUSTES' },
    ORIGEM: { manual: 'manual' },
    Session: { getActiveUser() { return { getEmail() { return 'pcp@ads'; } }; } },
    CachePainel: { invalidar() {} },
    Repo: {
      limparMemoria() {},
      registrarAuditoria() {},
      atualizarRegistro(aba, linha, registro) {
        const alvo = linhas.filter(function (l) { return l._linha === linha; })[0];
        Object.keys(registro).forEach(function (k) { alvo[k] = registro[k]; });
      },
      acrescentar(aba, registros) {
        registros.forEach(function (r) {
          linhas.push(Object.assign({ _linha: linhas.length + 2 }, r));
        });
      },
    },
    Cadastros: {
      ajustes() {
        const mapa = {};
        linhas.forEach(function (l) {
          mapa[l.chave] = {
            chave: l.chave,
            prioridadeManual: l.prioridade_manual === '' || l.prioridade_manual == null
              ? null : Number(l.prioridade_manual),
            observacao: l.observacao || '',
            _linha: l._linha,
          };
        });
        return mapa;
      },
    },
    localizarPorCampo_(aba, campo, valor) {
      return linhas.filter(function (l) { return l[campo] === valor; })[0] || null;
    },
    montarPlano() { return {}; },
  };
  vm.createContext(ctxPrio);
  vm.runInContext(
    extractFn('gravarPrioridadeAjuste_') + '\n' + extractFn('apiPrioridadeLinha'),
    ctxPrio
  );
  return ctxPrio;
}

(function () {
  const linhas = [
    { chave: 'B|1', prioridade_manual: 10, observacao: '', _linha: 2 },
    { chave: 'C|1', prioridade_manual: 20, observacao: 'campanha azul', _linha: 3 },
  ];
  const ctxPrio = planilhaAjustesFalsa(linhas);
  ctxPrio.apiPrioridadeLinha({ chave: 'A|1', acao: 'topo' });
  const mapa = {};
  linhas.forEach(function (l) { mapa[l.chave] = l; });
  ok(
    'subir para o topo poe a linha na frente e renumera o resto',
    mapa['A|1'].prioridade_manual === 10 &&
      mapa['B|1'].prioridade_manual === 20 &&
      mapa['C|1'].prioridade_manual === 30
  );
  ok('renumerar nao apaga a observacao', mapa['C|1'].observacao === 'campanha azul');
})();

(function () {
  const linhas = [{ chave: 'B|1', prioridade_manual: 10, observacao: '', _linha: 2 }];
  const ctxPrio = planilhaAjustesFalsa(linhas);
  ctxPrio.apiPrioridadeLinha({ chave: 'A|1', acao: 'definir', prioridade: 5 });
  ok(
    'definir prioridade mexe so na linha pedida',
    linhas.length === 2 && linhas[0].prioridade_manual === 10 && linhas[1].prioridade_manual === 5
  );
  ctxPrio.apiPrioridadeLinha({ chave: 'A|1', acao: 'limpar' });
  ok('limpar zera a prioridade da linha', linhas[1].prioridade_manual === '');
  let erro = '';
  try { ctxPrio.apiPrioridadeLinha({ chave: 'A|1', acao: 'definir', prioridade: 0 }); }
  catch (e) { erro = e.message; }
  ok('prioridade zero e recusada', erro.indexOf('maior que zero') >= 0);
})();

ok('arraste travado diz o motivo', src.indexOf('function motivoArrasteLista') >= 0 &&
  src.indexOf('arrasteTravadoOrdem') >= 0);
ok('busca ativa nao cancela mais o arraste',
  src.indexOf("if (row.style.display === 'none') oculto = true;") < 0);
ok('drawer da linha prioriza sem arrastar',
  src.indexOf('drawer-ot-topo') >= 0 && src.indexOf('apiPrioridadeLinha(Object.assign') >= 0);

if (falhas) {
  console.error('\n' + falhas + ' teste(s) falharam');
  process.exit(1);
}
console.log('\ntodos os testes passaram');
