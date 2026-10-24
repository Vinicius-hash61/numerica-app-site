/*
 * planilha.js — entrada e saída "como Excel". Trabalha com linhas (array de arrays), venha de .xlsx (SheetJS),
 * .csv ou de texto colado do Excel (tabulação). Sem dependências; navegador (window.Planilha) e Node.
 *
 * Modelos de coluna aceitos (nomes de cabeçalho flexíveis, sem acento/maiúscula):
 *   Funções:  Função | Salário | Carga mensal (h)           (carga opcional, padrão 220)
 *   OS:       Código | Descrição | Seção/Cliente | Início | Fim | Funções   (tudo opcional, menos Código)
 */
(function (root) {
  'use strict';
  var node = typeof module !== 'undefined' && module.exports;

  var sem = function (s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); };

  /** 1.800,50 | R$ 1.800,00 | 1800.5 | 1800 -> número (ou null). */
  function numeroBR(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v == null ? '' : v).replace(/[^\d.,-]/g, '');
    if (!s) return null;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1 || /^[1-9]\d{0,2}\.\d{3}$/.test(s)) s = s.replace(/\./g, ''); // "2.500" no Brasil é dois mil e quinhentos
    var n = parseFloat(s); return isFinite(n) ? n : null;
  }

  /** dd/mm/aaaa | aaaa-mm-dd | serial do Excel | Date -> 'AAAA-MM-DD' (ou ''). */
  function dataISO(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
    var s = String(v).trim(), m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  /** Acha as colunas pelo cabeçalho. Sem cabeçalho reconhecível, assume a ordem do modelo. */
  function mapear(rows, campos) {
    var idx = {}, achou = 0, ini = 0;
    var cab = (rows[0] || []).map(sem);
    Object.keys(campos).forEach(function (c) {
      var i = cab.findIndex(function (h) { return campos[c].some(function (a) { return h === a || h.indexOf(a) === 0; }); });
      if (i >= 0) { idx[c] = i; achou++; }
    });
    if (achou) ini = 1; else Object.keys(campos).forEach(function (c, i) { idx[c] = i; });
    return { idx: idx, ini: ini };
  }
  var cel = function (r, i) { return i == null ? '' : (r[i] == null ? '' : r[i]); };

  function lerFuncoes(rows) {
    var mp = mapear(rows, { nome: ['funcao', 'cargo'], salario: ['salario', 'valor', 'base'], carga: ['carga', 'horas'] });
    var itens = [], erros = [], vistos = {};
    for (var i = mp.ini; i < rows.length; i++) {
      var r = rows[i] || [], nome = String(cel(r, mp.idx.nome)).trim();
      if (!nome && !r.some(Boolean)) continue;
      var sal = numeroBR(cel(r, mp.idx.salario)), carga = numeroBR(cel(r, mp.idx.carga)) || 220;
      if (!nome) { erros.push({ linha: i + 1, msg: 'função em branco' }); continue; }
      if (sal == null || sal <= 0) { erros.push({ linha: i + 1, msg: 'salário inválido para "' + nome + '"' }); continue; }
      if (vistos[sem(nome)]) { erros.push({ linha: i + 1, msg: 'função repetida "' + nome + '" (mantida a primeira)' }); continue; }
      vistos[sem(nome)] = true; itens.push({ nome: nome, salario: sal, carga: carga });
    }
    return { itens: itens, erros: erros };
  }

  function lerOS(rows) {
    var mp = mapear(rows, { codigo: ['codigo', 'os', 'ordem'], descricao: ['descricao', 'nome'], secao: ['secao', 'cliente', 'centro', 'obra'],
      inicio: ['inicio', 'data inicio', 'vigencia'], fim: ['fim', 'termino', 'data fim', 'data termino'], funcoes: ['funcoes', 'cargos', 'funcao'] });
    var itens = [], erros = [], vistos = {};
    for (var i = mp.ini; i < rows.length; i++) {
      var r = rows[i] || [], cod = String(cel(r, mp.idx.codigo)).trim();
      if (!cod && !r.some(Boolean)) continue;
      if (!cod) { erros.push({ linha: i + 1, msg: 'código em branco' }); continue; }
      if (vistos[cod]) { erros.push({ linha: i + 1, msg: 'OS repetida "' + cod + '" (mantida a primeira)' }); continue; }
      var ini = dataISO(cel(r, mp.idx.inicio)), fim = dataISO(cel(r, mp.idx.fim));
      if (ini && fim && ini > fim) { erros.push({ linha: i + 1, msg: 'OS ' + cod + ': início depois do fim' }); continue; }
      vistos[cod] = true;
      itens.push({ codigo: cod, descricao: String(cel(r, mp.idx.descricao)).trim(), secao: String(cel(r, mp.idx.secao)).trim(), inicio: ini, fim: fim,
        funcoes: String(cel(r, mp.idx.funcoes)).split(/[;,\n]/).map(function (x) { return x.trim(); }).filter(Boolean), ativo: true });
    }
    return { itens: itens, erros: erros };
  }

  /** Texto colado do Excel (tab) ou CSV (; ou ,) -> linhas. Respeita aspas. */
  function textoParaLinhas(txt) {
    txt = String(txt || '').replace(/^﻿/, '');
    var prim = txt.split(/\r?\n/)[0] || '', sep = prim.indexOf('\t') >= 0 ? '\t' : (prim.split(';').length > prim.split(',').length ? ';' : ',');
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < txt.length; i++) {
      var ch = txt[i];
      if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim(); }); });
  }

  /** Linhas -> CSV que o Excel em português abre direto (separador ;, BOM, vírgula decimal). */
  function paraCSV(rows) {
    var f = function (v) { if (typeof v === 'number') v = String(v).replace('.', ','); v = String(v == null ? '' : v); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return '﻿' + rows.map(function (r) { return r.map(f).join(';'); }).join('\r\n');
  }

  var MODELO_FUNCOES = [['Função', 'Salário', 'Carga mensal (h)'], ['MONTADOR DE ANDAIMES', 1800, 220], ['SUPERVISOR DE ANDAIMES', 3600, 220]];
  var MODELO_OS = [['Código', 'Descrição', 'Seção / Cliente', 'Início', 'Fim', 'Funções'],
    ['OS-001', 'Montagem de andaimes - parada geral', 'CLIENTE EXEMPLO', '01/01/2025', '28/02/2025', ''],
    ['OS-002', 'Manutenção - equipe de supervisão', 'CLIENTE EXEMPLO', '01/01/2025', '', 'SUPERVISOR DE ANDAIMES; ENCARREGADO DE MONTAGENS']];

  var API = { numeroBR: numeroBR, dataISO: dataISO, lerFuncoes: lerFuncoes, lerOS: lerOS, textoParaLinhas: textoParaLinhas, paraCSV: paraCSV,
              MODELO_FUNCOES: MODELO_FUNCOES, MODELO_OS: MODELO_OS };
  if (node) module.exports = API; else root.Planilha = API;
})(typeof window !== 'undefined' ? window : globalThis);
