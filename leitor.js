/*
 * leitor.js — transforma o texto extraído do PDF (pdf.js) em funcionários e dias.
 * Puro e sem dependências: roda no navegador (window.Leitor) e no Node (simulação e testes).
 *
 * Entrada: páginas = [ [ {str,x,y}, ... ], ... ]  (itens de texto do pdf.js, uma lista por página)
 * Cada página é um funcionário. Página sem texto => pendente de OCR.
 * [INFERIDO] rótulos do cabeçalho (Empresa, CNPJ, Seção, Período, Chapa, Nome, Função, Horário)
 * seguem o texto do prompt; ajuste as regex em CAB se o PDF real usar outros rótulos.
 */
(function (root) {
  'use strict';
  var C = (typeof module !== 'undefined' && module.exports) ? require('./calculo.js') : root.Calculo;

  // Rótulos do cartão REAL (prints do Doc1.docx): sem dois-pontos em Empresa/CNPJ/Seção; período sem rótulo no título.
  var CAB = {
    empresa: /^\s*Empresa:?\s+(.+?)(?:\s+CNPJ\b|\s*$)/i,
    cnpj: /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/,
    secao: /^\s*Se[cç][aã]o:?\s+(.+?)\s*$/i,
    periodo: /(\d{2}\/\d{2}\/\d{4})\s*(?:a|à|até|-)\s*(\d{2}\/\d{2}\/\d{4})/i,
    chapa: /\bChapa:?\s*(\d+)/i,
    nome: /\bNome(?:\s+do\s+Funcion[aá]rio)?:?\s*(.+?)(?:\s{2,}Fun[cç][aã]o\b|\s*$)/i,
    funcao: /\bFun[cç][aã]o:?\s*(.+?)\s*$/i,
    horarioTit: /^\s*Hor[aá]rio(?:\s+do\s+Funcion[aá]rio)?:?\s*(.*)$/i,
    obs: /^\s*Observa[cç][aã]o/i,
    soma: /^\s*Soma:?\s*(.*)$/i,
    evento: /^\s*(2233|2236)\s+(.+?)\s+(\d{1,3}:\d{2})\s*$/
  };
  var COLS = ['trab', 'extras', 'adNot', 'atraso', 'falta', 'abono'];

  /** Agrupa itens do pdf.js em linhas (mesmo y, tolerância 2), ordenadas de cima para baixo. */
  function agruparLinhas(items) {
    var it = (items || []).filter(function (i) { return i && i.str && i.str.trim(); })
      .sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); });
    var linhas = [], atual = null, yAtual = null;
    it.forEach(function (i) {
      if (atual && Math.abs(i.y - yAtual) <= 2) atual.push(i.str);
      else { atual = [i.str]; yAtual = i.y; linhas.push(atual); }
    });
    return linhas.map(function (l) { return l.join(' ').replace(/\s+/g, ' ').trim(); });
  }

  function m1(re, s) { var m = re.exec(s); return m ? m[1].trim() : null; }

  /** "Soma: |163:19 |59:12 |32:00 | | |50:00" -> { trab, extras, adNot, ... } em minutos. */
  function parseSoma(txt) {
    if (txt.indexOf('|') < 0) return null;
    var cel = txt.split('|').slice(1), r = {};
    COLS.forEach(function (c, i) { var v = (cel[i] || '').trim().replace(/P$/, ''); r[c] = v ? C.horaParaMin(v) : null; });
    return r;
  }

  /** Interpreta as linhas de uma página (um funcionário). Uma única passada, sem regex desnecessária por linha. */
  function parsePagina(linhas) {
    var f = { chapa: null, nome: null, funcao: null, horario: null, empresa: null, cnpj: null,
              secao: null, periodo: null, dias: [], eventos: {}, soma: null, pendenteOcr: false };
    var emHorario = false, horarioTxt = [];
    for (var i = 0; i < linhas.length; i++) {
      var l = linhas[i];
      if (emHorario) { // "Horário do Funcionário:" traz o texto nas linhas seguintes, até "Observação"
        if (CAB.obs.test(l)) emHorario = false; else { horarioTxt.push(l); continue; }
      }
      var dia = C.parseLinhaDia(l);
      if (dia) { f.dias.push(dia); continue; }
      var ev = CAB.evento.exec(l);
      if (ev) { f.eventos[ev[1]] = C.horaParaMin(ev[3]); continue; }
      var so = CAB.soma.exec(l);
      if (so) { f.soma = parseSoma(so[1]); continue; }
      var ht = CAB.horarioTit.exec(l);
      if (ht) { emHorario = true; if (ht[1]) horarioTxt.push(ht[1]); continue; }
      if (!f.periodo) { var p = CAB.periodo.exec(l); if (p) f.periodo = { inicio: C.brParaIso(p[1]), fim: C.brParaIso(p[2]) }; }
      if (!f.empresa) f.empresa = m1(CAB.empresa, l);
      if (!f.cnpj) f.cnpj = m1(CAB.cnpj, l);
      if (!f.secao) f.secao = m1(CAB.secao, l);
      if (!f.chapa) f.chapa = m1(CAB.chapa, l);
      if (!f.nome) f.nome = m1(CAB.nome, l);
      if (!f.funcao) f.funcao = m1(CAB.funcao, l);
    }
    f.horario = horarioTxt.join(' ').replace(/^\s*\d{4}\s+/, '').replace(/\s+/g, ' ').trim() || null;
    if (!f.empresa || !f.chapa) { /* cabeçalho incompleto: ainda aceita se houver dias */ }
    if (!linhas.length || (!f.chapa && !f.dias.length)) f.pendenteOcr = true;
    return f;
  }

  /** Documento inteiro: cabeçalho comum + funcionários. */
  function parseDocumento(paginas) {
    return montarDocumento(paginas.map(function (p, i) { return lerPagina(p, i + 1); }));
  }
  /** Itens do pdf.js de UMA página -> funcionário. Permite descartar o texto bruto logo após ler cada página. */
  function lerPagina(items, numero) {
    var f = parsePagina(agruparLinhas(items)); f.pagina = numero; return f;
  }
  /** Junta as páginas já lidas (na ordem) em um documento. */
  function montarDocumento(funcs) {
    var paginas = funcs;
    var ok = funcs.filter(function (f) { return !f.pendenteOcr; });
    var cab = ok[0] || {};
    var inicio = cab.periodo && cab.periodo.inicio, fim = cab.periodo && cab.periodo.fim;
    if (!inicio) {
      var datas = [];
      ok.forEach(function (f) { f.dias.forEach(function (d) { datas.push(d.data); }); });
      datas.sort(); inicio = datas[0]; fim = datas[datas.length - 1];
    }
    var feriados = {};
    ok.forEach(function (f) { f.dias.forEach(function (d) { if (d.tipo === 'feriado') feriados[d.data] = true; }); });
    return {
      empresa: cab.empresa || '', cnpj: cab.cnpj || '', secao: cab.secao || '',
      inicio: inicio || null, fim: fim || null, feriados: Object.keys(feriados).sort(),
      paginas: paginas.length, pendentesOcr: funcs.filter(function (f) { return f.pendenteOcr; }).map(function (f) { return f.pagina; }),
      funcionarios: ok
    };
  }

  var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase(); };

  /** Divergências entre o cadastro salvo (por chapa) e o que veio no PDF. */
  function divergencias(funcionarios, cadastro) {
    var out = [];
    funcionarios.forEach(function (f) {
      var c = cadastro && cadastro[f.chapa];
      if (!c) return;
      if (c.funcao && f.funcao && norm(c.funcao) !== norm(f.funcao))
        out.push({ chapa: f.chapa, nome: f.nome, campo: 'função', cadastro: c.funcao, pdf: f.funcao });
      if (c.horario && f.horario && norm(c.horario) !== norm(f.horario))
        out.push({ chapa: f.chapa, nome: f.nome, campo: 'jornada', cadastro: c.horario, pdf: f.horario });
    });
    return out;
  }

  var API = { agruparLinhas: agruparLinhas, parsePagina: parsePagina, parseDocumento: parseDocumento, lerPagina: lerPagina, montarDocumento: montarDocumento,
              divergencias: divergencias, norm: norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Leitor = API;
})(typeof window !== 'undefined' ? window : globalThis);
