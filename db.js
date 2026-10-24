/*
 * db.js — armazenamento 100% local (IndexedDB). Nada sai do navegador (LGPD).
 * Stores: periodos (um registro por período importado, com funcionários e dias) e kv (cadastros/configurações).
 * Se o IndexedDB estiver indisponível (modo privado, bloqueio), cai para memória e avisa via Db.volatil.
 */
(function (root) {
  'use strict';
  var NOME = 'numerica-ponto', mem = { periodos: [], kv: {} }, dbp = null;
  var API = { volatil: false };

  function abrir() {
    if (dbp) return dbp;
    dbp = new Promise(function (ok, erro) {
      if (!root.indexedDB) return erro(new Error('sem indexedDB'));
      var rq = root.indexedDB.open(NOME, 1);
      rq.onupgradeneeded = function () {
        rq.result.createObjectStore('periodos', { keyPath: 'id', autoIncrement: true });
        rq.result.createObjectStore('kv', { keyPath: 'chave' });
      };
      rq.onsuccess = function () { ok(rq.result); };
      rq.onerror = function () { erro(rq.error); };
    }).catch(function () { API.volatil = true; return null; });
    return dbp;
  }
  function tx(store, modo, fn) {
    return abrir().then(function (db) {
      if (!db) return null;
      return new Promise(function (ok, erro) {
        var t = db.transaction(store, modo), s = t.objectStore(store), r = fn(s);
        t.oncomplete = function () { ok(r && r.result); };
        t.onerror = t.onabort = function () { erro(t.error); };
      });
    });
  }

  API.listarPeriodos = function () {
    return tx('periodos', 'readonly', function (s) { return s.getAll(); }).then(function (r) { return r || mem.periodos.slice(); });
  };
  API.salvarPeriodo = function (p) {
    return tx('periodos', 'readwrite', function (s) { return s.put(p); }).then(function (id) {
      if (id == null) { // memória
        if (!p.id) p.id = mem.periodos.length + 1;
        mem.periodos = mem.periodos.filter(function (x) { return x.id !== p.id; }).concat([p]);
        return p.id;
      }
      p.id = id; return id;
    });
  };
  API.excluirPeriodo = function (id) {
    return tx('periodos', 'readwrite', function (s) { return s.delete(id); }).then(function () {
      mem.periodos = mem.periodos.filter(function (x) { return x.id !== id; });
    });
  };
  API.obter = function (chave, padrao) {
    return tx('kv', 'readonly', function (s) { return s.get(chave); }).then(function (r) {
      if (r === null) r = mem.kv[chave] ? { valor: mem.kv[chave] } : null;
      return r ? r.valor : padrao;
    });
  };
  API.gravar = function (chave, valor) {
    return tx('kv', 'readwrite', function (s) { return s.put({ chave: chave, valor: valor }); }).then(function (r) {
      if (r == null) mem.kv[chave] = valor;
    });
  };

  root.Db = API;
})(window);
