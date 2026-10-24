(function () {
  'use strict';
  var C = window.Calculo, L = window.Leitor, Db = window.Db;
  var app = document.getElementById('app'), view = 'apuracao', ctx = {};
  var periodos = [], cfgUser = null, funcoes = [], cadastro = {}, osList = [];
  var cache = {}; // apuração memoizada por período+chapa; limpa a cada edição/config
  var svg = function (n) { return '<svg class="i"><use href="#' + n + '"/></svg>'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var h = C.minParaHora, brl = function (v) { return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var fmtBr = function (iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
  var DOW = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
  var STATUS = { ok: 'Conferido', cf: 'Conferir', nv: 'Não iniciado' };
  var ESCALA_PADRAO = { jornada: { 0: 0, 1: 540, 2: 540, 3: 540, 4: 540, 5: 480, 6: 0 }, tolerancia: 5,
                        conferir: { marcacaoImpar: true, semMarcacao: true, ocorrencia: false, atraso: true } };

  function toast(t) { document.querySelectorAll('.toast').forEach(function (x) { x.remove(); }); var e = document.createElement('div'); e.className = 'toast'; e.setAttribute('role', 'status'); e.textContent = t; document.body.appendChild(e); setTimeout(function () { e.remove(); }, 3200); }

  // ---------- configuração e dados ----------
  function cfgCalculo() {
    var e = cfgUser || ESCALA_PADRAO;
    return { jornadaPorDiaSemana: e.jornada, toleranciaExtraMin: e.tolerancia, conferir: e.conferir };
  }
  function carregar() {
    return Promise.all([Db.listarPeriodos(), Db.obter('escalas', ESCALA_PADRAO), Db.obter('funcoes', []), Db.obter('cadastro', {}), Db.obter('os', [])])
      .then(function (r) {
        periodos = r[0].sort(function (a, b) { return b.id - a.id; }); cfgUser = r[1]; funcoes = r[2]; cadastro = r[3]; cache = {};
        // versões antigas guardavam as OS como texto; converte para o formato atual
        osList = (r[4] || []).map(function (o) { return typeof o === 'string' ? { codigo: o, descricao: '', secao: '', inicio: '', fim: '', funcoes: [], ativo: true } : o; });
      });
  }
  function funcaoCad(f) { var n = L.norm(f.funcao); return funcoes.filter(function (x) { return L.norm(x.nome) === n; })[0] || null; }
  function periodoCalc(p) { return C.resumoPeriodo(p.inicio, p.fim, p.feriados); }
  function apurar(p, f) {
    var k = p.id + ':' + p.versao + ':' + f.chapa;
    return cache[k] || (cache[k] = C.apurarFuncionario(f.dias, cfgCalculo()));
  }
  function valores(p, f) {
    var ap = apurar(p, f), cad = funcaoCad(f);
    return C.valoresFuncionario({ salario: cad ? cad.salario : 0, cargaMensalHoras: cad && cad.carga,
      heNormalMin: ap.heNormalMin, heDomFerMin: ap.heDomFerMin, adNotMin: ap.adNotMin }, periodoCalc(p));
  }
  function statusPeriodo(p) {
    if (!p.funcionarios.length) return 'nv';
    return p.funcionarios.some(function (f) { return apurar(p, f).conferir > 0; }) ? 'cf' : 'ok';
  }

  // ---------- navegação ----------
  function go(v, c) { view = v; ctx = c || {}; render(); window.scrollTo(0, 0); }
  function nav() {
    document.querySelectorAll('nav button').forEach(function (b) {
      var aba = { custos: 'custos', os: 'os', config: 'config' }[view] || 'apuracao';
      var on = b.dataset.go === aba;
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  function render() {
    app.className = (view === 'apuracao' || view === 'periodo' || view === 'espelho' || view === 'custos' || view === 'os') ? 'wide' : '';
    nav();
    ({ apuracao: apuracaoView, importar: importarView, previa: previaView, periodo: periodoView, espelho: espelhoView, config: configView, custos: custosView, os: osView }[view] || apuracaoView)();
  }

  // ---------- apuração (lista de períodos) ----------
  function apuracaoView() {
    var rows = periodos.map(function (p) {
      var st = statusPeriodo(p);
      return '<tr class="go" tabindex="0" data-p="' + p.id + '"><td><b>' + esc(p.empresa) + '</b></td><td class="m">' + fmtBr(p.inicio) + ' a ' + fmtBr(p.fim) +
        '</td><td>' + p.funcionarios.length + '</td><td class="m">v' + p.versao + '</td><td><span class="pill ' + st + '">' + STATUS[st] + '</span></td></tr>';
    }).join('');
    app.innerHTML = '<div class="head"><div><h1>Apuração de Ponto</h1><p class="lede">Períodos importados e status de conferência.</p></div>' +
      '<button class="btn p" data-go="importar">' + svg('up') + 'Importar cartão de ponto</button></div>' +
      (Db.volatil ? '<div class="alert w"><b>Armazenamento temporário</b>O navegador bloqueou o IndexedDB: os dados somem ao fechar a página.</div>' : '') +
      (periodos.length ? '<div class="card"><div class="tw"><table><thead><tr><th>Empresa</th><th>Período</th><th>Funcionários</th><th>Versão</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>'
        : '<div class="card pad"><p class="lede" style="margin:0">Nenhum período importado ainda. Use “Importar cartão de ponto” (há um PDF de exemplo em <code>exemplos/exemplo-ponto.pdf</code>).</p></div>') +
      '<p class="note">Todos os dados ficam neste navegador (IndexedDB). Nada é enviado a servidores.</p>';
  }

  // ---------- importação ----------
  function importarView() {
    app.innerHTML = '<button class="back" data-go="apuracao">' + svg('arr') + 'Voltar</button>' +
      '<h1>Importe o cartão de ponto</h1><p class="lede">Arraste um ou vários PDFs ou clique para selecionar. Um arquivo mostra a prévia; vários são importados em lote (períodos duplicados são ignorados).</p>' +
      '<div class="drop" id="drop" role="button" tabindex="0" aria-label="Selecionar PDFs"><span class="cloud">' + svg('up') + '</span><p class="t">Arraste os PDFs para esta área</p><p class="s">ou clique para selecionar</p><p class="k">Somente arquivos PDF</p></div>' +
      '<input id="file" type="file" accept="application/pdf" multiple hidden>' +
      '<p class="note">A leitura acontece no seu navegador. Páginas sem texto (PDF escaneado) ficam marcadas como pendentes de OCR.</p>';
    var d = document.getElementById('drop'), f = document.getElementById('file');
    d.onclick = function () { f.click(); };
    d.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.click(); } };
    d.ondragover = function (e) { e.preventDefault(); d.classList.add('over'); };
    d.ondragleave = function () { d.classList.remove('over'); };
    d.ondrop = function (e) { e.preventDefault(); d.classList.remove('over'); pick(e.dataTransfer.files); };
    f.onchange = function () { pick(f.files); };
  }

  // Leitura: páginas em blocos de 8 (o worker do pdf.js trabalha em paralelo) e até 3 arquivos ao mesmo tempo.
  // O texto bruto de cada bloco é descartado assim que vira funcionário. Benchmark: exemplos/benchmark.js.
  var BLOCO = 8, ARQUIVOS_SIMULTANEOS = 3;
  var estado = null, pendenteDesenho = false;

  function desenhaProgresso() {
    pendenteDesenho = false;
    var d = document.getElementById('drop'); if (!d || !estado) return;
    d.onclick = null; d.style.cursor = 'default';
    var total = 0, feito = 0, prontos = 0;
    estado.arquivos.forEach(function (a) { total += a.total || 0; feito += a.feito; if (a.pronto) prontos++; });
    var pct = total ? Math.round(feito / total * 100) : 0, n = estado.arquivos.length;
    var ativos = estado.arquivos.filter(function (a) { return !a.pronto && a.total; }).slice(0, 3);
    d.innerHTML = '<div class="read"><div class="h"><span class="spin"></span><div><b>Lendo cartões de ponto…</b><span>' + prontos + ' de ' + n + ' arquivo(s) · ' + feito + ' de ' + (total || '?') + ' páginas</span></div></div>' +
      '<ul class="steps">' + ativos.map(function (a) { return '<li class="run">' + esc(a.nome) + ' · ' + a.feito + '/' + a.total + '</li>'; }).join('') + '</ul>' +
      '<div class="track"><i style="width:' + pct + '%"></i></div><p class="f" style="margin:.4rem 0 0;font-variant-numeric:tabular-nums">' + pct + '%</p></div>';
  }
  function progresso() { if (!pendenteDesenho) { pendenteDesenho = true; requestAnimationFrame(desenhaProgresso); } }

  function sha256(buf) {
    return crypto.subtle.digest('SHA-256', buf).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }
  /** Lê um PDF: hash do conteúdo + funcionários página a página. */
  function lerArquivo(file, st) {
    return file.arrayBuffer().then(function (buf) {
      return sha256(buf.slice(0)).then(function (hash) {
        return window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise.then(function (pdf) {
          st.total = pdf.numPages; progresso();
          var funcs = [];
          function bloco(ini) {
            if (ini > pdf.numPages) return Promise.resolve();
            var nums = []; for (var n = ini; n < ini + BLOCO && n <= pdf.numPages; n++) nums.push(n);
            return Promise.all(nums.map(function (n) {
              return pdf.getPage(n).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
                return L.lerPagina(tc.items.map(function (t) { return { str: t.str, x: t.transform[4], y: t.transform[5] }; }), n);
              });
            })).then(function (lidas) { funcs = funcs.concat(lidas); st.feito += lidas.length; progresso(); return bloco(ini + BLOCO); });
          }
          return bloco(1).then(function () { pdf.destroy(); st.pronto = true; progresso(); var doc = L.montarDocumento(funcs); doc.hash = hash; doc.arquivo = file.name; return doc; });
        });
      });
    });
  }
  function pick(files) {
    var a = Array.prototype.slice.call(files || []).filter(function (x) { return x.type === 'application/pdf' || /\.pdf$/i.test(x.name); });
    if (!a.length) { toast('Arquivo inválido: envie um arquivo em formato PDF.'); return; }
    if (!window.pdfjsLib) { toast('Biblioteca de leitura de PDF não carregou (sem internet?).'); return; }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    estado = { arquivos: a.map(function (f) { return { nome: f.name, total: 0, feito: 0, pronto: false }; }) };
    var docs = new Array(a.length), prox = 0;
    function trabalhador() {
      if (prox >= a.length) return Promise.resolve();
      var i = prox++;
      return lerArquivo(a[i], estado.arquivos[i]).then(function (d) { docs[i] = d; }).then(trabalhador);
    }
    progresso();
    Promise.all(Array.apply(null, Array(Math.min(ARQUIVOS_SIMULTANEOS, a.length))).map(trabalhador))
      .then(function () { estado = null; return a.length === 1 ? go('previa', { doc: docs[0] }) : importarLote(docs); })
      .catch(function (e) { estado = null; toast('Falha ao ler o PDF: ' + (e && e.message || e)); go('importar'); });
  }
  function duplicado(doc) {
    var porHash = periodos.filter(function (p) { return (p.hashes || []).indexOf(doc.hash) >= 0; })[0];
    var porPeriodo = periodos.filter(function (p) { return p.empresa === doc.empresa && p.inicio === doc.inicio && p.fim === doc.fim; });
    return { hash: porHash || null, periodo: porPeriodo.length ? porPeriodo : null };
  }
  function montarPeriodo(doc, versao) {
    return { empresa: doc.empresa, cnpj: doc.cnpj, secao: doc.secao, inicio: doc.inicio, fim: doc.fim, feriados: doc.feriados,
      versao: versao, hashes: [doc.hash], arquivo: doc.arquivo, importadoEm: new Date().toISOString(), pendentesOcr: doc.pendentesOcr,
      funcionarios: doc.funcionarios.map(function (f) { return { chapa: f.chapa, nome: f.nome, funcao: f.funcao, horario: f.horario, eventos: f.eventos, dias: f.dias }; }) };
  }
  function atualizarCadastro(doc) {
    doc.funcionarios.forEach(function (f) { cadastro[f.chapa] = { funcao: f.funcao, horario: f.horario, nome: f.nome }; });
    return Db.gravar('cadastro', cadastro);
  }
  function importarLote(docs) {
    var ok = 0, ign = [];
    return docs.reduce(function (p, d) {
      return p.then(function () {
        var dup = duplicado(d);
        if (dup.hash || dup.periodo || !d.funcionarios.length) { ign.push(d.arquivo + (dup.hash ? ' (mesmo conteúdo)' : dup.periodo ? ' (período já importado)' : ' (sem funcionários)')); return; }
        return Db.salvarPeriodo(montarPeriodo(d, 1)).then(function () { return atualizarCadastro(d); }).then(function () { ok++; periodos.push({ empresa: d.empresa, inicio: d.inicio, fim: d.fim, hashes: [d.hash] }); });
      });
    }, Promise.resolve()).then(carregar).then(function () {
      toast(ok + ' importado(s)' + (ign.length ? ', ' + ign.length + ' ignorado(s): ' + ign.join('; ') : '') + '.');
      go('apuracao');
    });
  }

  function previaView() {
    var doc = ctx.doc, dup = duplicado(doc), per = C.resumoPeriodo(doc.inicio, doc.fim, doc.feriados);
    var div = L.divergencias(doc.funcionarios, cadastro);
    var novos = doc.funcionarios.filter(function (f) { return !cadastro[f.chapa]; }).length;
    var regs = doc.funcionarios.reduce(function (s, f) { return s + f.dias.length; }, 0);
    var trs = doc.funcionarios.map(function (f) { return '<tr><td>' + esc(f.chapa) + '</td><td><b>' + esc(f.nome) + '</b></td><td class="m">' + esc(f.funcao) + '</td><td class="m">' + esc(f.horario) + '</td><td>' + f.dias.length + '</td></tr>'; }).join('');
    var info = [['Empresa', doc.empresa], ['CNPJ', doc.cnpj], ['Seção', doc.secao], ['Período', doc.inicio ? fmtBr(doc.inicio) + ' a ' + fmtBr(doc.fim) : '—']];
    var st = [['Páginas do arquivo', doc.paginas], ['Funcionários encontrados', doc.funcionarios.length], ['Novos funcionários', novos], ['Registros (dias)', regs],
      ['Feriados no período', per.feriados], ['Páginas pendentes de OCR', doc.pendentesOcr.length]];
    var avisos = '';
    if (dup.hash) avisos += '<div class="alert w"><b>' + svg('alt') + 'Arquivo já importado</b>O conteúdo deste PDF é idêntico ao do período “' + esc(dup.hash.empresa) + ' ' + fmtBr(dup.hash.inicio) + ' a ' + fmtBr(dup.hash.fim) + '”.</div>';
    else if (dup.periodo) avisos += '<div class="alert w"><b>' + svg('alt') + 'Período já existe</b>Há ' + dup.periodo.length + ' versão(ões) deste período. Você pode importar como nova versão (v' + (Math.max.apply(null, dup.periodo.map(function (x) { return x.versao || 1; })) + 1) + ').</div>';
    if (doc.pendentesOcr.length) avisos += '<div class="alert w"><b>' + svg('alt') + 'PDF sem texto em ' + doc.pendentesOcr.length + ' página(s)</b>Páginas ' + doc.pendentesOcr.join(', ') + ' parecem escaneadas e ficam pendentes de OCR (ainda não implementado).</div>';
    if (div.length) avisos += '<div class="alert b"><b>' + svg('alt') + 'Divergências cadastrais para conferência</b><ul>' + div.map(function (d) { return '<li><b>' + esc(d.chapa) + ' — ' + esc(d.nome) + '</b> · ' + d.campo + ': cadastro “' + esc(d.cadastro) + '” x PDF “' + esc(d.pdf) + '”</li>'; }).join('') + '</ul></div>';
    var podeImportar = !dup.hash && doc.funcionarios.length;
    app.innerHTML = '<div class="ttl">' + svg('chk') + '<h1>Importação identificada</h1></div>' + avisos +
      '<div class="card pad grid2" style="margin-bottom:1.25rem"><dl>' + info.map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>' +
      '<dl class="stats">' + st.map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>'; }).join('') + '</dl></div>' +
      '<div class="card" style="margin-bottom:1.25rem"><div class="tw" style="max-height:20rem;overflow-y:auto"><table><thead><tr><th>Chapa</th><th>Nome</th><th>Função</th><th>Jornada</th><th>Dias</th></tr></thead><tbody>' + trs + '</tbody></table></div></div>' +
      '<div class="row" style="margin-top:0">' + (podeImportar ? '<button class="btn p" id="ok">' + svg('doc') + (dup.periodo ? 'Importar como nova versão' : 'Confirmar importação') + '</button>' : '') +
      '<button class="btn g" data-go="importar">Cancelar</button></div>';
    var ok = document.getElementById('ok');
    if (ok) ok.onclick = function () {
      var v = dup.periodo ? Math.max.apply(null, dup.periodo.map(function (x) { return x.versao || 1; })) + 1 : 1;
      Db.salvarPeriodo(montarPeriodo(doc, v)).then(function () { return atualizarCadastro(doc); }).then(carregar).then(function () { toast('Importação concluída.'); go('apuracao'); });
    };
  }

  // ---------- período: lista de funcionários ----------
  function periodoView() {
    var p = ctx.p = periodos.filter(function (x) { return x.id === ctx.id; })[0];
    if (!p) return go('apuracao');
    var rows = p.funcionarios.map(function (f) {
      var ap = apurar(p, f), cf = ap.conferir > 0;
      return '<tr class="go" tabindex="0" data-f="' + esc(f.chapa) + '"><td>' + esc(f.chapa) + '</td><td><b>' + esc(f.nome) + '</b></td><td class="m">' + esc(f.funcao) + '</td><td>' + h(ap.heNormalMin) + '</td><td>' + h(ap.heDomFerMin) + '</td><td>' + h(ap.adNotMin) +
        '</td><td><span class="pill ' + (cf ? 'cf' : 'ok') + '">' + (cf ? ap.conferir + ' a conferir' : 'OK') + '</span></td></tr>';
    }).join('');
    app.innerHTML = '<button class="back" data-go="apuracao">' + svg('arr') + 'Voltar</button><div class="head"><div><h1>' + esc(p.empresa) + '</h1><p class="lede">' + fmtBr(p.inicio) + ' a ' + fmtBr(p.fim) + ' · versão ' + p.versao + ' · ' + p.funcionarios.length + ' funcionários</p></div>' +
      '<div class="row" style="margin:0"><button class="btn p" id="vals">' + svg('doc') + 'Valores por funcionário</button><button class="btn o" id="del">Excluir período</button></div></div>' +
      (p.pendentesOcr && p.pendentesOcr.length ? '<div class="alert w"><b>' + svg('alt') + 'Páginas pendentes de OCR: ' + p.pendentesOcr.join(', ') + '</b></div>' : '') +
      '<div class="card"><div class="tw"><table><thead><tr><th>Chapa</th><th>Nome</th><th>Função</th><th>H.E. normal</th><th>H.E. Dom/Fer</th><th>Ad. noturno</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    document.getElementById('vals').onclick = function () { valoresModal(p, 'nome'); };
    document.getElementById('del').onclick = function () { if (confirm('Excluir este período e todos os dados dele?')) Db.excluirPeriodo(p.id).then(carregar).then(function () { go('apuracao'); }); };
  }

  // ---------- espelho de ponto (editável) ----------
  function espelhoView() {
    var p = ctx.p = periodos.filter(function (x) { return x.id === ctx.id; })[0];
    var f = p && p.funcionarios.filter(function (x) { return x.chapa === ctx.chapa; })[0];
    if (!f) return go('apuracao');
    var cad = funcaoCad(f), per = periodoCalc(p);
    app.innerHTML = '<button class="back" data-go="periodo">' + svg('arr') + 'Voltar</button><div class="head"><div><h1>' + esc(f.nome) + '</h1><p class="lede">Chapa ' + esc(f.chapa) + ' · ' + esc(f.funcao) + ' · ' + esc(f.horario || 'jornada não informada') + '</p></div></div>' +
      (cad ? '' : '<div class="alert w"><b>' + svg('alt') + 'Função sem salário cadastrado</b>Cadastre em Configurações → Funções e salários. Enquanto isso os valores ficam zerados.</div>') +
      '<div class="card" style="margin-bottom:1.25rem"><div class="tw"><table id="tb"><thead><tr><th>Data</th><th>Dia</th><th>Tipo</th><th>Marcações</th><th>Abono</th><th>Trab.</th><th>Extra</th><th>Ad. not.</th><th>Status</th><th>Justif.</th></tr></thead><tbody></tbody></table></div></div>' +
      '<div id="resumo"></div>';
    var tb = app.querySelector('tbody');
    tb.innerHTML = f.dias.map(function (d, i) {
      return '<tr data-i="' + i + '"><td>' + fmtBr(d.data) + '</td><td class="m">' + DOW[d.dow] + '</td>' +
        '<td><select data-k="tipo">' + ['util', 'desc', 'comp', 'feriado'].map(function (t) { return '<option value="' + t + '"' + (d.tipo === t ? ' selected' : '') + '>' + { util: 'Útil', desc: 'DESC', comp: 'COMP', feriado: 'Feriado' }[t] + '</option>'; }).join('') + '</select></td>' +
        '<td><input data-k="marcacoes" size="24" value="' + esc((d.marcacoes || []).join(' ')) + '" aria-label="Marcações"></td>' +
        '<td><input data-k="abono" size="5" value="' + esc(d.abonoMin ? h(d.abonoMin) : '') + '" aria-label="Abono" placeholder="00:00"></td>' +
        '<td class="c-t"></td><td class="c-e"></td><td class="c-n"></td><td class="c-s"></td><td><input type="checkbox" data-k="justificado"' + (d.justificado ? ' checked' : '') + ' aria-label="Justificado"></td></tr>';
    }).join('');
    function pinta() {
      var ap = C.apurarFuncionario(f.dias, cfgCalculo());
      cache[p.id + ':' + p.versao + ':' + f.chapa] = ap;
      tb.querySelectorAll('tr').forEach(function (tr, i) {
        var c = ap.dias[i].calc;
        tr.querySelector('.c-t').textContent = c.trabMin ? h(c.trabMin) : '';
        tr.querySelector('.c-e').textContent = c.extraMin ? h(c.extraMin) + (c.extraTipo === 'domfer' ? ' (100%)' : '') : '';
        tr.querySelector('.c-n').textContent = c.adNotMin ? h(c.adNotMin) : '';
        var s = tr.querySelector('.c-s'); s.innerHTML = '<span class="pill ' + (c.status === 'conferir' ? 'cf' : 'ok') + '" title="' + esc(c.motivos.join('; ')) + '">' + (c.status === 'conferir' ? 'Conferir' : c.status === 'justificado' ? 'Justificado' : 'OK') + '</span>';
      });
      var v = valores(p, f), div = C.compararComPdf(ap, f.eventos);
      document.getElementById('resumo').innerHTML = '<div class="card pad grid2"><dl class="stats">' +
        [['H.E. normal', h(ap.heNormalMin) + ' · ' + brl(v.valorHeNormal)], ['H.E. Dom/Fer', h(ap.heDomFerMin) + ' · ' + brl(v.valorHeDomFer)], ['Ad. noturno', h(ap.adNotMin) + ' · ' + brl(v.valorAdNoturno)], ['DSR', brl(v.dsr)], ['Total', brl(v.total)]]
          .map(function (x) { return '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>'; }).join('') + '</dl>' +
        '<div><b>Comparação com os totais do PDF</b>' + (div.length ? '<ul class="lista">' + div.map(function (d) { return '<li>' + (d.onde === 'total' ? '' : fmtBr(d.onde) + ' · ') + d.campo + ': PDF ' + d.pdf + ' × calculado ' + d.calculado + '</li>'; }).join('') + '</ul>' : '<p class="lede" style="margin:.4rem 0 0">Confere com o PDF.</p>') + '</div></div>';
    }
    tb.addEventListener('change', function (e) {
      var tr = e.target.closest('tr'), i = +tr.dataset.i, d = f.dias[i], k = e.target.dataset.k;
      if (k === 'tipo') d.tipo = e.target.value;
      else if (k === 'justificado') d.justificado = e.target.checked;
      else if (k === 'marcacoes') {
        var m = e.target.value.trim() ? e.target.value.trim().split(/\s+/) : [];
        var bad = m.some(function (x) { return C.horaParaMin(x) == null; });
        e.target.setAttribute('aria-invalid', bad ? 'true' : 'false'); if (bad) { toast('Hora inválida. Use HH:MM (ou +HH:MM para o dia seguinte).'); return; }
        d.marcacoes = m; d.intervaloPreMarcado = m.length === 4;
      } else if (k === 'abono') {
        var v = e.target.value.trim(), min = v ? C.horaParaMin(v) : 0;
        e.target.setAttribute('aria-invalid', min == null ? 'true' : 'false'); if (min == null) { toast('Abono inválido. Use HH:MM.'); return; }
        d.abonoMin = min;
      }
      pinta(); Db.salvarPeriodo(p);
    });
    pinta();
  }

  // ---------- valores por funcionário (modal) ----------
  function valoresModal(p, ordem) {
    var per = periodoCalc(p);
    var lista = p.funcionarios.slice().sort(function (a, b) {
      return ordem === 'funcao' ? (L.norm(a.funcao).localeCompare(L.norm(b.funcao)) || a.nome.localeCompare(b.nome)) : a.nome.localeCompare(b.nome);
    });
    var tot = 0, semCad = 0;
    var rows = lista.map(function (f) {
      var ap = apurar(p, f), v = valores(p, f); tot += v.total; if (v.semCadastro) semCad++;
      return '<tr><td><b>' + esc(f.nome) + '</b></td><td class="m">' + esc(f.funcao) + '</td><td>' + h(ap.heNormalMin) + '</td><td>' + h(ap.heDomFerMin) + '</td><td>' + h(ap.adNotMin) + '</td><td>' + brl(v.valorHeNormal) + '</td><td>' + brl(v.valorHeDomFer) + '</td><td>' + brl(v.valorAdNoturno) + '</td><td>' + brl(v.dsr) + '</td><td><b>' + brl(v.total) + '</b></td></tr>';
    }).join('');
    var bg = document.createElement('div'); bg.className = 'modal-bg'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true'); bg.setAttribute('aria-label', 'Valores por funcionário');
    bg.innerHTML = '<div class="modal card"><div class="head"><div><h1>Valores por funcionário</h1><p class="lede">' + esc(p.empresa) + ' · ' + fmtBr(p.inicio) + ' a ' + fmtBr(p.fim) + ' · ' + per.dias + ' dias, ' + per.dsrDias + ' de DSR, ' + per.diasUteis + ' úteis</p></div>' +
      '<div class="row no-print" style="margin:0"><span class="seg"><button class="btn o' + (ordem === 'nome' ? ' on' : '') + '" data-ord="nome">Alfabética</button><button class="btn o' + (ordem === 'funcao' ? ' on' : '') + '" data-ord="funcao">Função</button></span>' +
      '<button class="btn o" id="imp">Imprimir</button><button class="btn p" id="pdf">Salvar PDF</button><button class="btn g" id="fch">Fechar</button></div></div>' +
      (semCad ? '<div class="alert w"><b>' + svg('alt') + semCad + ' funcionário(s) sem salário/carga cadastrados: valores zerados.</b></div>' : '') +
      '<div class="tw"><table><thead><tr><th>Funcionário</th><th>Função</th><th>H.E. normal</th><th>H.E. Dom/Fer</th><th>Ad. noturno</th><th>Valor H.E.</th><th>Valor Dom/Fer</th><th>Valor ad.</th><th>DSR</th><th>Total</th></tr></thead><tbody>' + rows + '</tbody><tfoot><tr><td colspan="9"><b>Total geral</b></td><td><b>' + brl(tot) + '</b></td></tr></tfoot></table></div></div>';
    document.body.appendChild(bg);
    var fecha = function () { bg.remove(); document.removeEventListener('keydown', esck); };
    var esck = function (e) { if (e.key === 'Escape') fecha(); };
    document.addEventListener('keydown', esck);
    bg.querySelector('#fch').onclick = fecha;
    bg.querySelectorAll('[data-ord]').forEach(function (bt) { bt.onclick = function () { fecha(); valoresModal(p, bt.dataset.ord); }; });
    bg.querySelector('#imp').onclick = function () { window.print(); };
    bg.querySelector('#pdf').onclick = function () { toast('Na janela de impressão, escolha “Salvar como PDF”.'); window.print(); };
    bg.querySelector('#fch').focus();
  }

  // ---------- utilitários de planilha (Excel) ----------
  function baixar(nome, blob) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  /** .xlsx quando o SheetJS carregou; senão CSV com ; e vírgula decimal (abre direto no Excel em português). */
  function exportarLinhas(nome, rows) {
    if (window.APP_SEM_DOWNLOAD) { // página hospedada sem permissão de download: copia como tabela para colar no Excel
      var tsv = rows.map(function (r) { return r.map(function (c) { return typeof c === 'number' ? String(c).replace('.', ',') : String(c == null ? '' : c).replace(/\s+/g, ' '); }).join(String.fromCharCode(9)); }).join(String.fromCharCode(10));
      var ok = function () { toast('Tabela copiada. Cole no Excel (Ctrl+V).'); };
      var falha = function () { modalColar('Copie a tabela', 'Selecione tudo (Ctrl+A), copie (Ctrl+C) e cole no Excel.', function () {}); var t = document.getElementById('cola'); if (t) { t.value = tsv; t.select(); } };
      try { navigator.clipboard.writeText(tsv).then(ok, falha); } catch (e) { falha(); }
      return;
    }
    if (window.XLSX) {
      var ws = XLSX.utils.aoa_to_sheet(rows), wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Dados'); XLSX.writeFile(wb, nome + '.xlsx');
    } else baixar(nome + '.csv', new Blob([window.Planilha.paraCSV(rows)], { type: 'text/csv;charset=utf-8' }));
  }
  function lerPlanilhaArquivo(file) {
    if (/\.xlsx?$/i.test(file.name) && window.XLSX) {
      return file.arrayBuffer().then(function (buf) {
        var wb = XLSX.read(buf, { type: 'array' });
        return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
      });
    }
    return file.text().then(window.Planilha.textoParaLinhas);
  }
  function escolherPlanilha(cb) {
    var i = document.createElement('input'); i.type = 'file'; i.accept = '.xlsx,.xls,.csv,.txt';
    i.onchange = function () { if (i.files[0]) lerPlanilhaArquivo(i.files[0]).then(cb).catch(function (e) { toast('Não consegui ler a planilha: ' + (e && e.message || e)); }); };
    i.click();
  }
  function modalColar(titulo, dica, cb) {
    var bg = document.createElement('div'); bg.className = 'modal-bg'; bg.setAttribute('role', 'dialog'); bg.setAttribute('aria-modal', 'true');
    bg.innerHTML = '<div class="modal card" style="max-width:40rem"><h1 style="font-size:1.2rem">' + esc(titulo) + '</h1><p class="lede">' + esc(dica) + '</p>' +
      '<textarea id="cola" rows="9" placeholder="Cole aqui as linhas copiadas do Excel (com ou sem cabeçalho)"></textarea>' +
      '<div class="row"><button class="btn p" id="ok2">Importar</button><button class="btn g" id="no2">Cancelar</button></div></div>';
    document.body.appendChild(bg);
    var t = bg.querySelector('#cola'); t.focus();
    bg.querySelector('#no2').onclick = function () { bg.remove(); };
    bg.querySelector('#ok2').onclick = function () { var rows = window.Planilha.textoParaLinhas(t.value); bg.remove(); cb(rows); };
  }
  function resumoImport(nome, r) {
    toast(r.itens.length + ' ' + nome + ' importado(s)' + (r.erros.length ? ' · ' + r.erros.length + ' linha(s) ignorada(s): ' + r.erros.slice(0, 3).map(function (e) { return 'linha ' + e.linha + ' ' + e.msg; }).join('; ') : '') + '.');
  }
  function seletorPeriodo(sel) {
    return '<label class="m">Período: <select id="selp"><option value="todos"' + (sel === 'todos' ? ' selected' : '') + '>Todos os períodos</option>' +
      periodos.map(function (p) { return '<option value="' + p.id + '"' + (String(sel) === String(p.id) ? ' selected' : '') + '>' + esc(p.empresa) + ' · ' + fmtBr(p.inicio) + ' a ' + fmtBr(p.fim) + ' (v' + p.versao + ')</option>'; }).join('') + '</select></label>';
  }
  function periodosSel(sel) { return sel === 'todos' ? periodos : periodos.filter(function (p) { return String(p.id) === String(sel); }); }
  var pct = function (x) { return (x * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; };
  function expandir(tbody) {
    tbody.addEventListener('click', function (e) {
      var tr = e.target.closest('tr.grp'); if (!tr) return;
      var abre = !tr.classList.contains('open'); tr.classList.toggle('open', abre);
      tr.setAttribute('aria-expanded', abre);
      tbody.querySelectorAll('tr.sub[data-g="' + tr.dataset.g + '"]').forEach(function (s) { s.hidden = !abre; });
    });
    tbody.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('tr.grp')) e.target.click(); });
  }

  // ---------- custos por cargo ----------
  function custosView() {
    var sel = ctx.sel || 'todos', ps = periodosSel(sel);
    var r = window.Relatorios.porCargo(ps, funcoes, cfgCalculo(), apurar);
    var linhas = r.grupos.map(function (g, i) {
      var t = g.tot;
      var cab = '<tr class="grp" tabindex="0" aria-expanded="false" data-g="' + i + '"><td><span class="seta"></span><b>' + esc(g.cargo) + '</b>' + (g.semCadastro ? ' <span class="pill cf">sem salário</span>' : '') + '</td><td class="n">' + g.n + '</td><td class="n">' + h(t.heNormalMin) + '</td><td class="n">' + h(t.heDomFerMin) + '</td><td class="n">' + h(t.adNotMin) +
        '</td><td class="n">' + brl(t.valorHeNormal) + '</td><td class="n">' + brl(t.valorHeDomFer) + '</td><td class="n">' + brl(t.valorAdNoturno) + '</td><td class="n">' + brl(t.dsr) + '</td><td class="n"><b>' + brl(t.total) + '</b></td><td class="n m">' + pct(g.pct) + '</td></tr>';
      var subs = g.funcionarios.map(function (e) {
        return '<tr class="sub" data-g="' + i + '" hidden><td class="rec">' + esc(e.chapa) + ' · ' + esc(e.nome) + '</td><td class="n m">' + (e.periodos > 1 ? e.periodos + ' períodos' : '') + '</td><td class="n">' + h(e.heNormalMin) + '</td><td class="n">' + h(e.heDomFerMin) + '</td><td class="n">' + h(e.adNotMin) +
          '</td><td class="n">' + brl(e.valorHeNormal) + '</td><td class="n">' + brl(e.valorHeDomFer) + '</td><td class="n">' + brl(e.valorAdNoturno) + '</td><td class="n">' + brl(e.dsr) + '</td><td class="n">' + brl(e.total) + '</td><td class="n m">' + (g.tot.total ? pct(e.total / g.tot.total) : '') + '</td></tr>';
      }).join('');
      return cab + subs;
    }).join('');
    var T = r.total;
    app.innerHTML = '<div class="head"><div><h1>Custos por cargo</h1><p class="lede">Horas extras, adicional noturno e DSR somados por função. Clique em uma função para ver quem recebe.</p></div>' +
      '<div class="row no-print" style="margin:0">' + seletorPeriodo(sel) + '<button class="btn o" id="xl">Exportar Excel</button><button class="btn o" id="pr">Imprimir</button></div></div>' +
      (r.semSalario ? '<div class="alert w"><b>' + svg('alt') + r.semSalario + ' função(ões) sem salário cadastrado</b>Os valores dessas funções ficam zerados. Cadastre em <a href="#" data-go="config">Configurações</a> ou importe a planilha de salários.</div>' : '') +
      '<div class="kpis"><div><span>Total a pagar</span><b>' + brl(T.total) + '</b></div><div><span>Funcionários</span><b>' + r.nFuncionarios + '</b></div><div><span>Funções</span><b>' + r.grupos.length + '</b></div>' +
      '<div><span>H.E. normal + Dom/Fer</span><b>' + h(T.heNormalMin + T.heDomFerMin) + '</b></div><div><span>Ad. noturno</span><b>' + h(T.adNotMin) + '</b></div></div>' +
      (r.grupos.length ? '<div class="card"><div class="tw"><table class="dados"><thead><tr><th>Função</th><th class="n">Func.</th><th class="n">H.E. normal</th><th class="n">H.E. Dom/Fer</th><th class="n">Ad. noturno</th><th class="n">Valor H.E.</th><th class="n">Valor Dom/Fer</th><th class="n">Valor ad.</th><th class="n">DSR</th><th class="n">Total</th><th class="n">%</th></tr></thead><tbody id="tbc">' + linhas +
        '</tbody><tfoot><tr><td><b>Total geral</b></td><td class="n"><b>' + r.nFuncionarios + '</b></td><td class="n"><b>' + h(T.heNormalMin) + '</b></td><td class="n"><b>' + h(T.heDomFerMin) + '</b></td><td class="n"><b>' + h(T.adNotMin) + '</b></td><td class="n"><b>' + brl(T.valorHeNormal) + '</b></td><td class="n"><b>' + brl(T.valorHeDomFer) + '</b></td><td class="n"><b>' + brl(T.valorAdNoturno) + '</b></td><td class="n"><b>' + brl(T.dsr) + '</b></td><td class="n"><b>' + brl(T.total) + '</b></td><td class="n">100%</td></tr></tfoot></table></div></div>'
        : '<div class="card pad"><p class="lede" style="margin:0">Nenhum período importado.</p></div>');
    document.getElementById('selp').onchange = function (e) { ctx.sel = e.target.value; custosView(); };
    document.getElementById('xl').onclick = function () { exportarLinhas('custos-por-cargo', window.Relatorios.linhasCustos(r)); };
    document.getElementById('pr').onclick = function () { window.print(); };
    var tb = document.getElementById('tbc'); if (tb) expandir(tb);
  }

  // ---------- ordens de serviço ----------
  function salvarOS() { return Db.gravar('os', osList); }
  function mesclarOS(itens) { // por código: atualiza se já existe
    itens.forEach(function (n) {
      var i = osList.findIndex(function (o) { return o.codigo === n.codigo; });
      if (i >= 0) osList[i] = n; else osList.push(n);
    });
    return salvarOS();
  }
  function osView() {
    var sel = ctx.sel || 'todos', ed = ctx.edit ? osList.filter(function (o) { return o.codigo === ctx.edit; })[0] : null;
    var v = ed || { codigo: '', descricao: '', secao: '', inicio: '', fim: '', funcoes: [], ativo: true };
    var res = window.Relatorios.porOS(periodosSel(sel), osList, funcoes, cfgCalculo(), apurar);
    var lista = osList.map(function (o) {
      return '<tr><td><b>' + esc(o.codigo) + '</b></td><td>' + esc(o.descricao) + '</td><td class="m">' + esc(o.secao || 'qualquer') + '</td><td class="m">' + (o.inicio ? fmtBr(o.inicio) : '…') + ' a ' + (o.fim ? fmtBr(o.fim) : '…') + '</td><td class="m">' + esc((o.funcoes || []).join('; ') || 'todas') +
        '</td><td><label class="chk" style="margin:0"><input type="checkbox" data-at="' + esc(o.codigo) + '"' + (o.ativo !== false ? ' checked' : '') + '> ativa</label></td><td><button class="btn g" data-ed="' + esc(o.codigo) + '">Editar</button><button class="btn g" data-rm="' + esc(o.codigo) + '">Excluir</button></td></tr>';
    }).join('');
    var linhas = res.itens.map(function (b, i) {
      var cab = '<tr class="grp' + (b.sem ? ' semos' : '') + '" tabindex="0" aria-expanded="false" data-g="' + i + '"><td><span class="seta"></span><b>' + esc(b.codigo) + '</b></td><td>' + esc(b.descricao) + '</td><td class="n">' + b.n + '</td><td class="n">' + h(b.horasMin) + '</td><td class="n">' + h(b.heMin) + '</td><td class="n"><b>' + brl(b.valor) + '</b></td><td class="n m">' + pct(b.pct) + '</td></tr>';
      var subs = b.funcionarios.map(function (e) {
        return '<tr class="sub" data-g="' + i + '" hidden><td class="rec" colspan="2">' + esc(e.chapa) + ' · ' + esc(e.nome) + ' <span class="m">— ' + esc(e.funcao) + '</span></td><td class="n m">' + e.dias + ' dia(s)</td><td class="n">' + h(e.horasMin) + '</td><td class="n">' + h(e.heMin) + '</td><td class="n">' + brl(e.valor) + '</td><td></td></tr>';
      }).join('');
      return cab + subs;
    }).join('');
    app.innerHTML = '<div class="head"><div><h1>Ordens de serviço</h1><p class="lede">Cadastre as OS uma vez: cada dia trabalhado é vinculado automaticamente à OS que atende a seção, a vigência e as funções.</p></div>' +
      '<div class="row no-print" style="margin:0"><button class="btn o" id="oimp">Importar planilha</button><button class="btn o" id="ocola">Colar do Excel</button><button class="btn o" id="omod">Baixar modelo</button></div></div>' +
      '<div class="card pad" style="margin-bottom:1.25rem"><h3 style="margin:0 0 .75rem;font-size:1rem">' + (ed ? 'Editar OS ' + esc(ed.codigo) : 'Nova ordem de serviço') + '</h3>' +
      '<div class="osform"><label>Código<input id="oc" value="' + esc(v.codigo) + '"' + (ed ? ' readonly' : '') + '></label><label class="l2">Descrição<input id="od" value="' + esc(v.descricao) + '"></label>' +
      '<label>Seção / cliente contém<input id="os" value="' + esc(v.secao) + '" placeholder="ex.: ANGLO"></label><label>Início<input id="oi" type="date" value="' + esc(v.inicio) + '"></label><label>Fim<input id="of" type="date" value="' + esc(v.fim) + '"></label>' +
      '<label class="l2">Funções (opcional, separe por ;)<input id="ofn" value="' + esc((v.funcoes || []).join('; ')) + '" placeholder="vazio = todas as funções"></label></div>' +
      '<div class="row"><button class="btn p" id="osave">' + (ed ? 'Salvar alterações' : 'Adicionar OS') + '</button>' + (ed ? '<button class="btn g" id="ocan">Cancelar</button>' : '') + '</div></div>' +
      (osList.length ? '<div class="card" style="margin-bottom:1.5rem"><div class="tw"><table class="dados"><thead><tr><th>Código</th><th>Descrição</th><th>Seção / cliente</th><th>Vigência</th><th>Funções</th><th>Situação</th><th></th></tr></thead><tbody id="tbo">' + lista + '</tbody></table></div></div>' : '<p class="lede">Nenhuma OS cadastrada.</p>') +
      '<div class="head" style="margin-top:1.5rem"><div><h2 style="margin:0;font-size:1.2rem">Vínculo automático</h2><p class="lede">Horas e custo (H.E., ad. noturno e DSR rateado) por OS. Havendo mais de uma OS possível, vale a mais específica.</p></div><div class="row no-print" style="margin:0">' + seletorPeriodo(sel) + '<button class="btn o" id="oxl">Exportar Excel</button></div></div>' +
      (res.conflitos ? '<div class="alert w"><b>' + svg('alt') + res.conflitos + ' dia(s) com mais de uma OS igualmente específica</b>Foi usada a de menor código. Ajuste seção, vigência ou funções para desempatar.</div>' : '') +
      (res.itens.length ? '<div class="card"><div class="tw"><table class="dados"><thead><tr><th>OS</th><th>Descrição</th><th class="n">Func.</th><th class="n">Horas trab.</th><th class="n">H.E.</th><th class="n">Custo</th><th class="n">%</th></tr></thead><tbody id="tbr">' + linhas +
        '</tbody><tfoot><tr><td colspan="3"><b>Total</b></td><td class="n"><b>' + h(res.total.horasMin) + '</b></td><td class="n"><b>' + h(res.total.heMin) + '</b></td><td class="n"><b>' + brl(res.total.valor) + '</b></td><td></td></tr></tfoot></table></div></div>' : '<div class="card pad"><p class="lede" style="margin:0">Importe um período para ver o vínculo.</p></div>');
    var $ = function (id) { return document.getElementById(id); };
    $('osave').onclick = function () {
      var cod = $('oc').value.trim();
      if (!cod) { toast('Informe o código da OS.'); return; }
      var ini = $('oi').value, fim = $('of').value;
      if (ini && fim && ini > fim) { toast('O início não pode ser depois do fim.'); return; }
      var novo = { codigo: cod, descricao: $('od').value.trim(), secao: $('os').value.trim(), inicio: ini, fim: fim,
        funcoes: $('ofn').value.split(';').map(function (x) { return x.trim(); }).filter(Boolean), ativo: ed ? ed.ativo !== false : true };
      if (!ed && osList.some(function (o) { return o.codigo === cod; })) { toast('Já existe uma OS com esse código. Use Editar.'); return; }
      mesclarOS([novo]).then(function () { ctx.edit = null; toast('OS ' + cod + ' salva.'); osView(); });
    };
    if ($('ocan')) $('ocan').onclick = function () { ctx.edit = null; osView(); };
    $('oimp').onclick = function () { escolherPlanilha(function (rows) { var r = window.Planilha.lerOS(rows); mesclarOS(r.itens).then(function () { resumoImport('OS', r); osView(); }); }); };
    $('ocola').onclick = function () { modalColar('Colar OS do Excel', 'Colunas: Código, Descrição, Seção/Cliente, Início, Fim, Funções.', function (rows) { var r = window.Planilha.lerOS(rows); mesclarOS(r.itens).then(function () { resumoImport('OS', r); osView(); }); }); };
    $('omod').onclick = function () { exportarLinhas('modelo-ordens-de-servico', window.Planilha.MODELO_OS); };
    $('oxl').onclick = function () {
      var rows = [['OS', 'Descrição', 'Chapa', 'Funcionário', 'Função', 'Dias', 'Horas trabalhadas', 'H.E.', 'Custo']];
      res.itens.forEach(function (b) { b.funcionarios.forEach(function (e) { rows.push([b.codigo, b.descricao, e.chapa, e.nome, e.funcao, e.dias, h(e.horasMin), h(e.heMin), e.valor]); }); });
      rows.push(['TOTAL', '', '', '', '', '', h(res.total.horasMin), h(res.total.heMin), res.total.valor]); exportarLinhas('custo-por-os', rows);
    };
    $('selp').onchange = function (e) { ctx.sel = e.target.value; osView(); };
    var tbo = $('tbo');
    if (tbo) tbo.addEventListener('click', function (e) {
      var ed2 = e.target.closest('[data-ed]'), rm = e.target.closest('[data-rm]');
      if (ed2) { ctx.edit = ed2.dataset.ed; osView(); }
      else if (rm && confirm('Excluir a OS ' + rm.dataset.rm + '?')) { osList = osList.filter(function (o) { return o.codigo !== rm.dataset.rm; }); salvarOS().then(osView); }
    });
    if (tbo) tbo.addEventListener('change', function (e) {
      var c = e.target.dataset.at; if (!c) return;
      osList.forEach(function (o) { if (o.codigo === c) o.ativo = e.target.checked; }); salvarOS().then(osView);
    });
    var tbr = $('tbr'); if (tbr) expandir(tbr);
  }

  // ---------- configurações ----------
  function configView() {
    var e = cfgUser, hm = function (m) { return h(m); };
    var dias = [1, 2, 3, 4, 5, 6, 0];
    app.innerHTML = '<h1>Configurações</h1><p class="lede">Cadastros usados na apuração. As alterações recalculam tudo.</p><div class="cfg">' +
      '<div class="card"><h3>Funções e salários</h3><p>Salário base e carga mensal de cada função. Pode vir de uma planilha Excel.</p><div id="fn"></div>' +
      '<div class="row"><button class="btn o" id="addf">Adicionar função</button><button class="btn p" id="savf">Salvar</button></div>' +
      '<div class="row"><button class="btn g" id="fimp">Importar planilha</button><button class="btn g" id="fcola">Colar do Excel</button><button class="btn g" id="fexp">Exportar</button><button class="btn g" id="fmod">Modelo</button></div></div>' +
      '<div class="card"><h3>Escalas</h3><p>Jornada por dia da semana (HH:MM) e regras.</p><div id="esc" class="grade">' +
      dias.map(function (d) { return '<label>' + DOW[d] + '<input data-d="' + d + '" size="5" value="' + hm(e.jornada[d]) + '"></label>'; }).join('') +
      '<label>Tolerância (min)<input id="tol" size="3" value="' + e.tolerancia + '"></label></div>' +
      '<p style="margin-top:.8rem">Marcar o dia como “conferir” quando:</p>' +
      [['marcacaoImpar', 'marcação ímpar'], ['semMarcacao', 'dia útil sem marcação e sem abono'], ['atraso', 'atraso acima da tolerância'], ['ocorrencia', 'houver ocorrência (abonos etc.)']]
        .map(function (c) { return '<label class="chk"><input type="checkbox" data-c="' + c[0] + '"' + (e.conferir[c[0]] ? ' checked' : '') + '> ' + c[1] + '</label>'; }).join('') +
      '<div class="row"><button class="btn p" id="save">Salvar</button></div></div>' +
      '<div class="card"><h3>Ordens de serviço</h3><p>' + osList.length + ' cadastrada(s). O cadastro e o vínculo automático ficam na aba própria.</p><div class="row"><button class="btn o" data-go="os">Abrir ordens de serviço</button></div></div></div>' +
      '<p class="note">Carga mensal padrão: 220h. Multiplicadores (1,5 / 2,0 / 0,2) e DSR estão confirmados e não são editáveis aqui.</p>';
    function linhaF(f) { return '<div class="frow"><input data-n placeholder="Função" value="' + esc(f.nome) + '"><input data-s placeholder="Salário" inputmode="decimal" value="' + (f.salario || '') + '"><input data-h placeholder="Carga h" inputmode="numeric" value="' + (f.carga || 220) + '"></div>'; }
    var fn = document.getElementById('fn');
    var desenhaF = function () { fn.innerHTML = (funcoes.length ? funcoes : [{ nome: '', salario: '', carga: 220 }]).map(linhaF).join(''); };
    var lerF = function () {
      return Array.prototype.map.call(fn.querySelectorAll('.frow'), function (r) {
        return { nome: r.querySelector('[data-n]').value.trim(), salario: window.Planilha.numeroBR(r.querySelector('[data-s]').value) || 0, carga: parseInt(r.querySelector('[data-h]').value, 10) || 220 };
      }).filter(function (f) { return f.nome; });
    };
    var gravaF = function (lista, msg) { funcoes = lista; return Db.gravar('funcoes', funcoes).then(function () { cache = {}; desenhaF(); if (msg) toast(msg); }); };
    var mesclaF = function (r) { // importação atualiza por nome e mantém as demais
      var mapa = {}; funcoes.forEach(function (f) { mapa[L.norm(f.nome)] = f; }); r.itens.forEach(function (f) { mapa[L.norm(f.nome)] = f; });
      gravaF(Object.keys(mapa).map(function (k) { return mapa[k]; })).then(function () { resumoImport('função(ões)', r); });
    };
    desenhaF();
    document.getElementById('addf').onclick = function () { fn.insertAdjacentHTML('beforeend', linhaF({ nome: '', salario: '', carga: 220 })); };
    document.getElementById('savf').onclick = function () { gravaF(lerF(), 'Funções salvas.'); };
    document.getElementById('fimp').onclick = function () { escolherPlanilha(function (rows) { mesclaF(window.Planilha.lerFuncoes(rows)); }); };
    document.getElementById('fcola').onclick = function () { modalColar('Colar funções e salários', 'Colunas: Função, Salário, Carga mensal (h).', function (rows) { mesclaF(window.Planilha.lerFuncoes(rows)); }); };
    document.getElementById('fexp').onclick = function () { exportarLinhas('funcoes-e-salarios', [['Função', 'Salário', 'Carga mensal (h)']].concat(lerF().map(function (f) { return [f.nome, f.salario, f.carga]; }))); };
    document.getElementById('fmod').onclick = function () { exportarLinhas('modelo-funcoes-e-salarios', window.Planilha.MODELO_FUNCOES); };
    document.getElementById('save').onclick = function () {
      var j = {}, ok = true;
      app.querySelectorAll('#esc [data-d]').forEach(function (i) { var m = C.horaParaMin(i.value); if (m == null) ok = false; j[i.dataset.d] = m || 0; });
      if (!ok) { toast('Jornada inválida. Use HH:MM.'); return; }
      var cf = {}; app.querySelectorAll('[data-c]').forEach(function (i) { cf[i.dataset.c] = i.checked; });
      cfgUser = { jornada: j, tolerancia: parseInt(document.getElementById('tol').value, 10) || 0, conferir: cf };
      Db.gravar('escalas', cfgUser).then(function () { cache = {}; toast('Escalas salvas.'); });
    };
  }

  // ---------- eventos globais ----------
  document.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); var v = g.dataset.go; go(v, v === 'periodo' ? { id: ctx.id } : {}); return; }
    var r = e.target.closest('tr[data-p]'); if (r) { go('periodo', { id: +r.dataset.p }); return; }
    var f = e.target.closest('tr[data-f]'); if (f) go('espelho', { id: ctx.id, chapa: f.dataset.f });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-p],tr[data-f]')) e.target.click();
  });
  document.getElementById('theme').onclick = function () {
    var r = document.documentElement, cur = r.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    r.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
  };
  carregar().then(render);
})();
