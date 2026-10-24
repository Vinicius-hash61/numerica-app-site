/*
 * calculo.js — regras de negócio da Apuração de Ponto (Numérica Contabilidade).
 * Reconstruídas por engenharia reversa a partir do cartão de ponto (PDF) e da tela
 * "Valores por funcionário". Sem dependências: roda no navegador (window.Calculo) e no Node.
 *
 * Teste:  node calculo.js
 *
 * Legenda de confiança (comentários [CONFIRMADO] / [INFERIDO]):
 *   CONFIRMADO = reproduz exatamente os números vistos nos prints.
 *   INFERIDO   = hipótese coerente com os prints, ainda sem prova. Validar com o cliente.
 */
(function (root) {
  'use strict';

  // ---------- configuração padrão (tudo sobrescrevível) ----------
  var CONFIG = {
    cargaMensalHoras: 220,      // [INFERIDO] 1800 / 220 = 8,18 (valor/hora visto no app)
    multHeNormal: 1.5,          // [CONFIRMADO] 97,36 / 7:56 / 8,1818
    multHeDomFer: 2.0,          // [CONFIRMADO] 128,18 / 7:50 / 8,1818
    multAdNoturno: 0.2,         // [CONFIRMADO] 4,91 / 3:00 / 8,1818
    jornadaPorDiaSemana: {      // minutos; 0=dom ... 6=sáb. [CONFIRMADO p/ este cliente: 44h/sem]
      0: 0, 1: 540, 2: 540, 3: 540, 4: 540, 5: 480, 6: 0
    },
    intervaloAutomaticoMin: 60, // [CONFIRMADO] 12:00–13:00 já vem pré-marcado no cartão
    toleranciaExtraMin: 5,      // [INFERIDO] dia 03/02: 3 min acima da jornada não gerou extra
    janelaNoturna: [22 * 60, 29 * 60], // [INFERIDO] 22:00 às 05:00 (29*60 = 05:00 do dia seguinte)
    conferir: { marcacaoImpar: true, semMarcacao: true, ocorrencia: false, atraso: true } // [PROPOSTA] critérios do status "conferir"
  };

  // ---------- utilitários de hora ----------
  /** "07:56" -> 476 ; "+07:11" -> 1440 + 431 (hora do dia seguinte) ; "047:59" -> 2879 */
  function horaParaMin(txt) {
    if (txt == null || txt === '') return null;
    var s = String(txt).trim();
    var prox = s.charAt(0) === '+';
    if (prox) s = s.slice(1);
    var m = /^(\d{1,3}):(\d{2})$/.exec(s);
    if (!m) return null;
    return (prox ? 1440 : 0) + parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  /** 476 -> "07:56" (horas podem passar de 24: 2879 -> "47:59") */
  function minParaHora(min) {
    var n = Math.round(min), h = Math.floor(n / 60), m = n % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  function arred2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

  // ---------- período ----------
  function isoParaUTC(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function brParaIso(br) { var p = br.split('/'); return p[2] + '-' + p[1] + '-' + p[0]; }

  /**
   * Conta dias do período. [CONFIRMADO] 11/01/2025–10/02/2025 com feriado 20/01:
   * 31 dias, 5 domingos, 6 dias de DSR, 25 dias úteis (fator 0,24).
   * @param {string} inicio 'AAAA-MM-DD'  @param {string} fim 'AAAA-MM-DD'
   * @param {string[]} feriados lista 'AAAA-MM-DD'
   */
  function resumoPeriodo(inicio, fim, feriados) {
    var fer = {};
    (feriados || []).forEach(function (f) { fer[f] = true; });
    var dias = 0, domingos = 0, feriadosFora = 0;
    for (var t = isoParaUTC(inicio); t <= isoParaUTC(fim); t += 86400000) {
      var d = new Date(t), iso = d.toISOString().slice(0, 10);
      dias++;
      if (d.getUTCDay() === 0) domingos++;
      else if (fer[iso]) feriadosFora++; // feriado em domingo conta uma vez só
    }
    var dsrDias = domingos + feriadosFora;
    return { dias: dias, domingos: domingos, feriados: feriadosFora, dsrDias: dsrDias,
             diasUteis: dias - dsrDias, fatorDsr: (dias - dsrDias) ? dsrDias / (dias - dsrDias) : 0 };
  }

  // ---------- cálculo do dia ----------
  /** minutos de [a,b) que caem na janela noturna, considerando 3 dias (ontem, hoje, amanhã). */
  function minutosNoturnos(a, b, janela) {
    var ini = janela[0], fim = janela[1], total = 0;
    [-1440, 0, 1440].forEach(function (off) {
      var s = Math.max(a, ini + off), e = Math.min(b, fim + off);
      if (e > s) total += e - s;
    });
    return total;
  }

  /**
   * Calcula um dia do cartão.
   * @param {object} d
   *   data 'AAAA-MM-DD'
   *   tipo 'util' | 'desc' | 'comp' | 'feriado'
   *   marcacoes ['07:12','12:00','13:00','19:38']  (pares ent/sai; '+HH:MM' = dia seguinte)
   *   intervaloPreMarcado true quando 12:00–13:00 já está no cartão (padrão: true)
   *   abonoMin minutos abonados (ocorrência 0058, 0072, 0053...)
   *   jornadaMin opcional; padrão = CONFIG.jornadaPorDiaSemana[dia]
   * @returns {{trabMin,extraMin,extraTipo,adNotMin,atrasoMin,status,motivos}}
   */
  function calcularDia(d, cfg) {
    cfg = Object.assign({}, CONFIG, cfg || {});
    var m = (d.marcacoes || []).map(horaParaMin);
    var motivos = [];
    var abono = d.abonoMin || 0;
    var dow = new Date(isoParaUTC(d.data)).getUTCDay();
    var jornada = d.jornadaMin != null ? d.jornadaMin : cfg.jornadaPorDiaSemana[dow];
    var folga = d.tipo === 'desc' || d.tipo === 'comp' || d.tipo === 'feriado';

    // intervalos trabalhados [ini,fim)
    var pares = [];
    var preMarcado = d.intervaloPreMarcado !== false;
    if (m.length >= 2) {
      if (preMarcado && m.length === 4) {
        // [CONFIRMADO] só a 1ª entrada e a última saída são reais; o intervalo é descontado
        pares.push([m[0], m[3]]);
      } else {
        for (var i = 0; i + 1 < m.length; i += 2) pares.push([m[i], m[i + 1]]);
      }
    }
    if (m.length % 2 === 1) motivos.push('Marcação ímpar');

    var bruto = pares.reduce(function (s, p) { return s + (p[1] - p[0]); }, 0);
    var trab = bruto;
    if (preMarcado && m.length === 4) trab -= cfg.intervaloAutomaticoMin; // [CONFIRMADO] 07:12→19:38 = 11:26
    if (trab < 0) trab = 0;

    // adicional noturno [INFERIDO]: horas trabalhadas na janela 22h–05h, sem a pausa
    var adNot = 0;
    if (preMarcado && m.length === 4) {
      // pausa fixa 12:00–13:00 não é noturna: mede entrada→saída reais
      adNot = minutosNoturnos(m[0], m[3], cfg.janelaNoturna);
    } else {
      pares.forEach(function (p) { adNot += minutosNoturnos(p[0], p[1], cfg.janelaNoturna); });
    }

    var extra = 0, extraTipo = 'normal', atraso = 0;
    if (folga) {
      // [CONFIRMADO] em DESC/feriado todo o trabalhado vira extra (H.E. Dom/Fer)
      extra = trab; extraTipo = 'domfer';
    } else {
      var efetivo = trab + abono;
      var excesso = efetivo - jornada;
      // [CONFIRMADO] extras = (trabalhado + abono) − jornada
      if (excesso > cfg.toleranciaExtraMin) extra = excesso;
      else if (excesso < -cfg.toleranciaExtraMin && m.length) atraso = -excesso;
    }

    // status do dia [PROPOSTA — critério real do app desconhecido; cada regra liga/desliga em cfg.conferir]
    var cf = Object.assign({}, CONFIG.conferir, cfg.conferir);
    if (!cf.marcacaoImpar) motivos = [];
    if (!folga && !m.length && !abono && cf.semMarcacao) motivos.push('Dia útil sem marcação e sem abono');
    if (d.ocorrencia && cf.ocorrencia) motivos.push('Ocorrência ' + d.ocorrencia);
    if (atraso && cf.atraso) motivos.push('Atraso de ' + minParaHora(atraso));
    var status = d.justificado ? 'justificado' : (motivos.length ? 'conferir' : 'ok');

    return { trabMin: trab, extraMin: extra, extraTipo: extraTipo, adNotMin: adNot,
             atrasoMin: atraso, status: status, motivos: motivos };
  }

  // ---------- valores por funcionário ----------
  /** valor/hora = salário / carga mensal. [CONFIRMADO] 1800/220 = 8,1818 */
  function valorHora(salario, cargaMensalHoras) {
    return salario / (cargaMensalHoras || CONFIG.cargaMensalHoras);
  }

  /**
   * @param {object} f  { salario, cargaMensalHoras?, heNormalMin, heDomFerMin, adNotMin }
   * @param {object} periodo  resultado de resumoPeriodo()
   * Sem salário/carga => tudo zerado (comportamento do app: "valores ficam zerados").
   */
  function valoresFuncionario(f, periodo, cfg) {
    cfg = Object.assign({}, CONFIG, cfg || {});
    var zero = { valorHora: 0, valorHeNormal: 0, valorHeDomFer: 0, valorAdNoturno: 0, dsr: 0, total: 0, semCadastro: true };
    if (!f.salario || !(f.cargaMensalHoras || cfg.cargaMensalHoras)) return zero;
    var vh = valorHora(f.salario, f.cargaMensalHoras || cfg.cargaMensalHoras);
    var he = (f.heNormalMin / 60) * vh * cfg.multHeNormal;
    var hd = (f.heDomFerMin / 60) * vh * cfg.multHeDomFer;
    var an = (f.adNotMin / 60) * vh * cfg.multAdNoturno;
    // [CONFIRMADO] DSR = (HE normal + HE dom/fer + ad. noturno) × (domingos+feriados) / dias úteis
    var dsr = (he + hd + an) * periodo.fatorDsr;
    var r = { valorHora: arred2(vh), valorHeNormal: arred2(he), valorHeDomFer: arred2(hd),
              valorAdNoturno: arred2(an), dsr: arred2(dsr), semCadastro: false };
    r.total = arred2(r.valorHeNormal + r.valorHeDomFer + r.valorAdNoturno + r.dsr);
    return r;
  }

  // ---------- leitura de uma linha de dia do PDF (texto extraído) ----------
  var DIAS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
  /**
   * Interpreta uma linha como:
   *  "05/02/2025 QUA 07:12 12:00 13:00 19:38 0072 - Abono transporte  |11:26 |02:38P | ... |00:12"
   *  "09/02/2025 DOM 07:10 12:00 13:00 16:00 DESC(00:00 - 23:59) |07:50 |07:50P"
   *  "25/01/2025 SAB COMP(00:00 - 23:59)"   "20/01/2025 SEG Feriado Municipal"
   * Retorna null se não for linha de dia. As colunas à direita (TRAB/EXTRAS/…) vêm depois do 1º '|'.
   */
  function parseLinhaDia(linha) {
    var m = /^\s*(\d{2}\/\d{2}\/\d{4})\s+(DOM|SEG|TER|QUA|QUI|SEX|SAB)\b(.*)$/.exec(linha);
    if (!m) return null;
    var partes = m[3].split('|');
    var esq = partes[0], dir = partes.slice(1).map(function (x) { return x.trim(); });
    var tipo = 'util';
    if (/\bDESC\s*\(/i.test(esq)) tipo = 'desc';
    else if (/\bCOMP\s*\(/i.test(esq)) tipo = 'comp';
    else if (/Feriado/i.test(esq)) tipo = 'feriado';
    // DESC(00:00 - 23:59) pode quebrar de linha no PDF ("DESC(00:00 –" / "23:59)"): remove mesmo sem o ")"
    var semParenteses = esq.replace(/\b(?:DESC|COMP)\s*\([^)]*(?:\)|$)/gi, ' ').replace(/\([^)]*\)/g, ' ');
    var horas = (semParenteses.match(/\+?\b\d{2}:\d{2}\b/g) || []);
    var oc = /\b(\d{4})\s*-\s*([^|]+)$/.exec(semParenteses.trim());
    var iso = brParaIso(m[1]);
    var colunas = ['trab', 'extras', 'adNot', 'atraso', 'falta', 'abono'];
    var cols = {};
    colunas.forEach(function (c, i) { cols[c] = (dir[i] || '').replace(/P$/, '') || null; });
    cols.extraPago = /P$/.test(dir[1] || '');
    return { data: iso, dow: DIAS.indexOf(m[2]), tipo: tipo,
             marcacoes: horas,
             ocorrencia: oc ? oc[1] : null, ocorrenciaTexto: oc ? oc[2].trim() : null, pdf: cols };
  }

  // ---------- apuração do funcionário (soma dos dias) ----------
  /**
   * Calcula todos os dias e totaliza. Cada dia: { data, tipo, marcacoes, abonoMin?, ocorrencia?, justificado?, pdf? }.
   * Retorna { dias:[{...dia, calc}], heNormalMin, heDomFerMin, adNotMin, atrasoMin, conferir }.
   */
  function apurarFuncionario(dias, cfg) {
    var r = { dias: [], heNormalMin: 0, heDomFerMin: 0, adNotMin: 0, atrasoMin: 0, conferir: 0 };
    dias.forEach(function (d) {
      var abono = d.abonoMin != null ? d.abonoMin : (d.pdf && d.pdf.abono ? horaParaMin(d.pdf.abono) || 0 : 0);
      var c = calcularDia({ data: d.data, tipo: d.tipo, marcacoes: d.marcacoes, abonoMin: abono,
                            ocorrencia: d.ocorrencia, justificado: d.justificado,
                            intervaloPreMarcado: d.intervaloPreMarcado, jornadaMin: d.jornadaMin }, cfg);
      if (c.extraTipo === 'domfer') r.heDomFerMin += c.extraMin; else r.heNormalMin += c.extraMin;
      r.adNotMin += c.adNotMin; r.atrasoMin += c.atrasoMin;
      if (c.status === 'conferir') r.conferir++;
      r.dias.push(Object.assign({}, d, { abonoMin: abono, calc: c }));
    });
    return r;
  }

  /**
   * [item 5 do prompt] Compara o cálculo próprio com os totais do PDF: dia a dia (coluna EXTRAS)
   * e por evento (2233 ad. noturno, 2236 H.E. 100%). Retorna lista de divergências (vazia = confere).
   */
  function compararComPdf(ap, eventos, soma) {
    var out = [];
    ap.dias.forEach(function (d) {
      if (!d.pdf || d.pdf.extras == null) return;
      var pdfMin = horaParaMin(d.pdf.extras) || 0;
      if (pdfMin !== d.calc.extraMin)
        out.push({ onde: d.data, campo: 'extras', pdf: minParaHora(pdfMin), calculado: minParaHora(d.calc.extraMin) });
    });
    eventos = eventos || {};
    if (eventos['2233'] != null && eventos['2233'] !== ap.adNotMin)
      out.push({ onde: 'total', campo: '2233 ad. noturno', pdf: minParaHora(eventos['2233']), calculado: minParaHora(ap.adNotMin) });
    if (eventos['2236'] != null && eventos['2236'] !== ap.heDomFerMin)
      out.push({ onde: 'total', campo: '2236 H.E. 100%', pdf: minParaHora(eventos['2236']), calculado: minParaHora(ap.heDomFerMin) });
    // linha "Soma:" do cartão: extras = H.E. normal + H.E. Dom/Fer (confere com o PDF real: 11:13 + 47:59 = 59:12)
    if (soma && soma.extras != null && soma.extras !== ap.heNormalMin + ap.heDomFerMin)
      out.push({ onde: 'total', campo: 'Soma extras', pdf: minParaHora(soma.extras), calculado: minParaHora(ap.heNormalMin + ap.heDomFerMin) });
    if (soma && soma.adNot != null && soma.adNot !== ap.adNotMin)
      out.push({ onde: 'total', campo: 'Soma ad. noturno', pdf: minParaHora(soma.adNot), calculado: minParaHora(ap.adNotMin) });
    return out;
  }

  var API = { CONFIG: CONFIG, horaParaMin: horaParaMin, minParaHora: minParaHora, arred2: arred2,
              brParaIso: brParaIso, resumoPeriodo: resumoPeriodo, calcularDia: calcularDia, valorHora: valorHora,
              valoresFuncionario: valoresFuncionario, parseLinhaDia: parseLinhaDia,
              apurarFuncionario: apurarFuncionario, compararComPdf: compararComPdf };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Calculo = API;

  // ---------- autoteste: node calculo.js ----------
  if (typeof module !== 'undefined' && require.main === module) {
    var falhas = 0;
    function eq(nome, obtido, esperado) {
      var ok = JSON.stringify(obtido) === JSON.stringify(esperado);
      if (!ok) falhas++;
      console.log((ok ? 'OK    ' : 'FALHOU') + ' ' + nome + (ok ? '' : '  obtido=' + JSON.stringify(obtido) + ' esperado=' + JSON.stringify(esperado)));
    }
    var per = resumoPeriodo('2025-01-11', '2025-02-10', ['2025-01-20']);
    eq('período: dias/domingos/feriados/úteis', [per.dias, per.domingos, per.feriados, per.diasUteis], [31, 5, 1, 25]);
    // Adeir Gomes Silva — tela "Valores por funcionário"
    var v = valoresFuncionario({ salario: 1800, cargaMensalHoras: 220,
      heNormalMin: horaParaMin('07:56'), heDomFerMin: horaParaMin('07:50'), adNotMin: horaParaMin('03:00') }, per);
    eq('Adeir H.E. normal', v.valorHeNormal, 97.36);
    eq('Adeir H.E. Dom/Fer', v.valorHeDomFer, 128.18);
    eq('Adeir Ad. noturno', v.valorAdNoturno, 4.91);
    eq('Adeir DSR', v.dsr, 55.31);
    eq('Adeir TOTAL', v.total, 285.76);
    eq('sem salário zera', valoresFuncionario({ salario: 0, heNormalMin: 600, heDomFerMin: 0, adNotMin: 0 }, per).total, 0);
    // dias do cartão
    function dia(args) { var r = calcularDia(args); return [minParaHora(r.trabMin), minParaHora(r.extraMin), r.extraTipo, minParaHora(r.adNotMin)]; }
    eq('05/02 qua 07:12–19:38 + abono 00:12', dia({ data: '2025-02-05', tipo: 'util', marcacoes: ['07:12', '12:00', '13:00', '19:38'], abonoMin: 12 }), ['11:26', '02:38', 'normal', '00:00']);
    eq('06/02 qui 07:12–19:00 + abono 00:12', dia({ data: '2025-02-06', tipo: 'util', marcacoes: ['07:12', '12:00', '13:00', '19:00'], abonoMin: 12 }), ['10:48', '02:00', 'normal', '00:00']);
    eq('07/02 sex 07:13–16:00 + abono 00:13', dia({ data: '2025-02-07', tipo: 'util', marcacoes: ['07:13', '12:00', '13:00', '16:00'], abonoMin: 13 }), ['07:47', '00:00', 'normal', '00:00']);
    eq('09/02 dom DESC 07:10–16:00', dia({ data: '2025-02-09', tipo: 'desc', marcacoes: ['07:10', '12:00', '13:00', '16:00'] }), ['07:50', '07:50', 'domfer', '00:00']);
    eq('30/01 qui 13:00–19:00 + abono 05:00', dia({ data: '2025-01-30', tipo: 'util', marcacoes: ['13:00', '19:00'], abonoMin: 300 }), ['06:00', '02:00', 'normal', '00:00']);
    eq('03/02 seg 13:00–17:03 + abono 05:00 (tolerância)', dia({ data: '2025-02-03', tipo: 'util', marcacoes: ['13:00', '17:03'], abonoMin: 300 }), ['04:03', '00:00', 'normal', '00:00']);
    eq('turno noturno 18:50→07:11 (+)', dia({ data: '2024-08-26', tipo: 'util', marcacoes: ['18:50', '+00:00', '+01:00', '+07:11'], intervaloPreMarcado: false, jornadaMin: 660 }).slice(0, 1).concat(dia({ data: '2024-08-26', tipo: 'util', marcacoes: ['18:50', '+00:00', '+01:00', '+07:11'], intervaloPreMarcado: false, jornadaMin: 660 }).slice(3)), ['11:21', '06:00']);
    // parser
    var p = parseLinhaDia('05/02/2025 QUA 07:12 12:00 13:00 19:38 0072 - Abono transporte |11:26 |02:38P | | | |00:12');
    eq('parser: tipo/marcações/ocorrência', [p.tipo, p.marcacoes, p.ocorrencia, p.pdf.trab, p.pdf.extras, p.pdf.extraPago, p.pdf.abono], ['util', ['07:12', '12:00', '13:00', '19:38'], '0072', '11:26', '02:38', true, '00:12']);
    eq('parser: DESC', parseLinhaDia('09/02/2025 DOM 07:10 12:00 13:00 16:00 DESC(00:00 - 23:59) |07:50 |07:50P').tipo, 'desc');
    eq('parser: feriado', parseLinhaDia('20/01/2025 SEG Feriado Municipal |').tipo, 'feriado');
    eq('parser: ignora cabeçalho', parseLinhaDia('Chapa: 012039'), null);
    // formato real (Doc1.docx): DESC quebrado em duas linhas não pode virar marcação
    eq('parser: DESC quebrado de linha', parseLinhaDia('29/08/2024 QUI 06:55 12:00 13:00 17:01 DESC(00:00 –').marcacoes, ['06:55', '12:00', '13:00', '17:01']);
    eq('parser: ocorrência com hífen no texto', parseLinhaDia('03/02/2025 SEG 13:00 17:03 0007 - Falta de registro - Entrada |04:03 | | | | |05:00').ocorrencia, '0007');
    eq('parser: folga de campo com abono', parseLinhaDia('01/09/2024 DOM 0026 - Folga de campo | | | | | |11:00').pdf.abono, '11:00');
    console.log(falhas ? ('\n' + falhas + ' falha(s)') : '\nTodos os testes passaram');
    process.exit(falhas ? 1 : 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
