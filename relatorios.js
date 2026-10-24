/*
 * relatorios.js — visões de negócio sobre os períodos importados. Sem DOM, sem dependências:
 *   porCargo()  custo agrupado por função, com os funcionários de cada função;
 *   vincularOS() / porOS()  vínculo automático de cada dia trabalhado a uma ordem de serviço.
 * Roda no navegador (window.Relatorios) e no Node (testes).
 */
(function (root) {
  'use strict';
  var node = typeof module !== 'undefined' && module.exports;
  var C = node ? require('./calculo.js') : root.Calculo;
  var L = node ? require('./leitor.js') : root.Leitor;

  var norm = L.norm;
  var SOMAVEIS = ['heNormalMin', 'heDomFerMin', 'adNotMin', 'valorHeNormal', 'valorHeDomFer', 'valorAdNoturno', 'dsr', 'total'];

  function achaCadastro(funcoes, nome) {
    var n = norm(nome);
    for (var i = 0; i < funcoes.length; i++) if (norm(funcoes[i].nome) === n) return funcoes[i];
    return null;
  }

  /** Valores de um funcionário em um período. apurar(p,f) é opcional (permite cache do chamador). */
  function linhaFuncionario(p, f, funcoes, cfg, apurar) {
    var ap = apurar ? apurar(p, f) : C.apurarFuncionario(f.dias, cfg);
    var cad = achaCadastro(funcoes, f.funcao);
    var v = C.valoresFuncionario({ salario: cad ? cad.salario : 0, cargaMensalHoras: cad && cad.carga,
      heNormalMin: ap.heNormalMin, heDomFerMin: ap.heDomFerMin, adNotMin: ap.adNotMin }, C.resumoPeriodo(p.inicio, p.fim, p.feriados));
    return { chapa: f.chapa, nome: f.nome, funcao: f.funcao, periodoId: p.id, empresa: p.empresa,
      heNormalMin: ap.heNormalMin, heDomFerMin: ap.heDomFerMin, adNotMin: ap.adNotMin,
      valorHeNormal: v.valorHeNormal, valorHeDomFer: v.valorHeDomFer, valorAdNoturno: v.valorAdNoturno, dsr: v.dsr, total: v.total,
      semCadastro: !!v.semCadastro, salario: cad ? cad.salario : 0, periodos: 1 };
  }
  function somar(a, b) { SOMAVEIS.forEach(function (k) { a[k] = (a[k] || 0) + (b[k] || 0); }); return a; }
  function zero() { var o = {}; SOMAVEIS.forEach(function (k) { o[k] = 0; }); return o; }
  function arred(o) { SOMAVEIS.forEach(function (k) { if (k.indexOf('Min') < 0) o[k] = C.arred2(o[k]); }); return o; }

  /**
   * Agrupa por função. Em "todos os períodos" o mesmo funcionário (chapa) é somado.
   * Retorna { grupos:[{cargo, salario, semCadastro, funcionarios:[], n, tot, pct}], total, nFuncionarios, semSalario }.
   */
  function porCargo(periodos, funcoes, cfg, apurar) {
    var mapa = {}, total = zero(), vistos = {};
    periodos.forEach(function (p) {
      p.funcionarios.forEach(function (f) {
        var ln = linhaFuncionario(p, f, funcoes, cfg, apurar), k = norm(f.funcao) || '(SEM FUNÇÃO)';
        var g = mapa[k] || (mapa[k] = { cargo: f.funcao || '(sem função)', salario: ln.salario, semCadastro: ln.semCadastro, porChapa: {}, tot: zero() });
        var chave = (p.empresa || '') + '|' + f.chapa, e = g.porChapa[chave]; // chapa só é única dentro da empresa
        if (e) { somar(e, ln); e.periodos++; } else g.porChapa[chave] = ln;
        vistos[chave] = true;
      });
    });
    var grupos = Object.keys(mapa).map(function (k) {
      var g = mapa[k]; g.funcionarios = Object.keys(g.porChapa).map(function (c) { return arred(g.porChapa[c]); })
        .sort(function (a, b) { return b.total - a.total || a.nome.localeCompare(b.nome); });
      g.funcionarios.forEach(function (e) { somar(g.tot, e); });
      arred(g.tot); g.n = g.funcionarios.length; delete g.porChapa; somar(total, g.tot);
      return g;
    }).sort(function (a, b) { return b.tot.total - a.tot.total || a.cargo.localeCompare(b.cargo); });
    arred(total);
    grupos.forEach(function (g) { g.pct = total.total ? g.tot.total / total.total : 0; });
    return { grupos: grupos, total: total, nFuncionarios: Object.keys(vistos).length,
             semSalario: grupos.filter(function (g) { return g.semCadastro; }).length };
  }

  // ---------- ordens de serviço ----------
  /** Resultado: { os, conflito } — os = null quando nenhuma serve. */
  function vincularOS(secao, funcao, dataIso, osList) {
    var s = norm(secao), fu = norm(funcao), melhor = [], max = -1;
    (osList || []).forEach(function (o) {
      if (o.ativo === false) return;
      if (o.inicio && dataIso < o.inicio) return;
      if (o.fim && dataIso > o.fim) return;
      if (o.secao && s.indexOf(norm(o.secao)) < 0) return;
      var fs = (o.funcoes || []).map(norm).filter(Boolean);
      if (fs.length && fs.indexOf(fu) < 0) return;
      var score = (o.secao ? 2 : 0) + (fs.length ? 2 : 0) + (o.inicio && o.fim ? 1 : 0);
      if (score > max) { max = score; melhor = [o]; } else if (score === max) melhor.push(o);
    });
    if (!melhor.length) return { os: null, conflito: false };
    melhor.sort(function (a, b) { return String(a.codigo).localeCompare(String(b.codigo)); });
    return { os: melhor[0], conflito: melhor.length > 1 };
  }

  /**
   * Distribui horas e custos por OS. Cada dia trabalhado vai para a OS que o atende; o DSR do funcionário
   * é rateado na proporção do valor (H.E. + ad. noturno) de cada OS. Dias sem OS caem em "Sem OS".
   */
  function porOS(periodos, osList, funcoes, cfg, apurar) {
    var SEM = '__sem__', mapa = {}, conflitos = 0, total = { horasMin: 0, heMin: 0, valor: 0 };
    function bucket(o) {
      var k = o ? o.codigo : SEM;
      return mapa[k] || (mapa[k] = { codigo: o ? o.codigo : '—', descricao: o ? o.descricao : 'Dias sem ordem de serviço vinculada', sem: !o, horasMin: 0, heMin: 0, valor: 0, porChapa: {} });
    }
    var cfgC = Object.assign({}, C.CONFIG, cfg || {});
    periodos.forEach(function (p) {
      p.funcionarios.forEach(function (f) {
        var ap = apurar ? apurar(p, f) : C.apurarFuncionario(f.dias, cfg);
        var ln = linhaFuncionario(p, f, funcoes, cfg, function () { return ap; });
        var vh = ln.salario ? C.valorHora(ln.salario, (achaCadastro(funcoes, f.funcao) || {}).carga) : 0;
        var parc = [], somaDias = 0;
        ap.dias.forEach(function (d) {
          var c = d.calc; if (!c.trabMin) return;
          var vin = vincularOS(p.secao, f.funcao, d.data, osList); if (vin.conflito) conflitos++;
          var mult = c.extraTipo === 'domfer' ? cfgC.multHeDomFer : cfgC.multHeNormal;
          var val = vh * ((c.extraMin / 60) * mult + (c.adNotMin / 60) * cfgC.multAdNoturno);
          parc.push({ b: bucket(vin.os), trab: c.trabMin, he: c.extraMin, val: val }); somaDias += val;
        });
        parc.forEach(function (x) {
          var dsr = somaDias ? ln.dsr * x.val / somaDias : 0, v = x.val + dsr;
          x.b.horasMin += x.trab; x.b.heMin += x.he; x.b.valor += v;
          var e = x.b.porChapa[f.chapa] || (x.b.porChapa[f.chapa] = { chapa: f.chapa, nome: f.nome, funcao: f.funcao, horasMin: 0, heMin: 0, valor: 0, dias: 0 });
          e.horasMin += x.trab; e.heMin += x.he; e.valor += v; e.dias++;
          total.horasMin += x.trab; total.heMin += x.he; total.valor += v;
        });
      });
    });
    var itens = Object.keys(mapa).map(function (k) {
      var b = mapa[k]; b.valor = C.arred2(b.valor);
      b.funcionarios = Object.keys(b.porChapa).map(function (c) { var e = b.porChapa[c]; e.valor = C.arred2(e.valor); return e; })
        .sort(function (a, c) { return c.valor - a.valor || a.nome.localeCompare(c.nome); });
      b.n = b.funcionarios.length; delete b.porChapa; return b;
    }).sort(function (a, b) { return (a.sem - b.sem) || (b.valor - a.valor) || String(a.codigo).localeCompare(String(b.codigo)); });
    total.valor = C.arred2(total.valor);
    itens.forEach(function (b) { b.pct = total.valor ? b.valor / total.valor : 0; });
    return { itens: itens, total: total, conflitos: conflitos };
  }

  /** Linhas para exportar o relatório por cargo (Excel/CSV): cabeçalho + 1 linha por cargo + 1 por funcionário. */
  function linhasCustos(r) {
    var h = C.minParaHora, out = [['Cargo', 'Funcionário', 'Chapa', 'H.E. normal', 'H.E. Dom/Fer', 'Ad. noturno', 'Valor H.E. normal', 'Valor H.E. Dom/Fer', 'Valor ad. noturno', 'DSR', 'Total']];
    var lin = function (a, b, c, t) { return [a, b, c, h(t.heNormalMin), h(t.heDomFerMin), h(t.adNotMin), t.valorHeNormal, t.valorHeDomFer, t.valorAdNoturno, t.dsr, t.total]; };
    r.grupos.forEach(function (g) {
      out.push(lin(g.cargo, 'TOTAL DO CARGO (' + g.n + ' func.)', '', g.tot));
      g.funcionarios.forEach(function (e) { out.push(lin(g.cargo, e.nome, e.chapa, e)); });
    });
    out.push(lin('TOTAL GERAL', '', '', r.total));
    return out;
  }

  var API = { porCargo: porCargo, vincularOS: vincularOS, porOS: porOS, linhaFuncionario: linhaFuncionario, linhasCustos: linhasCustos };
  if (node) module.exports = API; else root.Relatorios = API;
})(typeof window !== 'undefined' ? window : globalThis);
