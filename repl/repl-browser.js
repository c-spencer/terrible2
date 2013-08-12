;(function(e,t,n){function i(n,s){if(!t[n]){if(!e[n]){var o=typeof require=="function"&&require;if(!s&&o)return o(n,!0);if(r)return r(n,!0);throw new Error("Cannot find module '"+n+"'")}var u=t[n]={exports:{}};e[n][0].call(u.exports,function(t){var r=e[n][1][t];return i(r?r:t)},u,u.exports)}return t[n].exports}var r=typeof require=="function"&&require;for(var s=0;s<n.length;s++)i(n[s]);return i})({1:[function(require,module,exports){
(function(){var Namespace = require('./namespace');
var Terr = require('./terr-ast');
var codegen = require('escodegen');
var JS = require('./js');
var reader = require('./reader');
var parser = require('./parser');
var core = require('./core');
var fs = require('fs');

var terrible_core = "(ns terrible.core)\n\n(def list (lambda [& args]\n  (List.apply nil args)))\n\n(def symbol (lambda [name]\n  (Symbol name)))\n\n(var set-macro\n  (lambda [f]\n    (set! f.$macro true)\n    f))\n\n(def macro (set-macro\n  (lambda [& body]\n    `(set-macro (lambda ~@body)))))\n\n(def defmacro\n  (macro [name & body]\n    `(def ~name (macro ~@body))))\n\n(defmacro fn [& body]\n  `(lambda ~@body))\n\n(defmacro defn [name & body]\n  `(def ~name (fn ~@body)))\n\n(defmacro varfn [name & body]\n  `(var ~name (fn ~@body)))\n\n(defmacro setfn! [name & body]\n  `(set! ~name (fn ~@body)))\n\n(defn list? [l]\n  (instance? l List))\n\n(defn symbol? [s]\n  (instance? s Symbol))\n\n(defn keyword [name]\n  (Keyword name))\n\n(defn keyword? [k]\n  (instance? k Keyword))\n\n(defmacro cond [t v & cases]\n  (if (and (keyword? t)\n           (= t.name \"else\"))\n    v\n    (if (> cases.length 0)\n      `(if ~t ~v (cond ~@cases))\n      `(if ~t ~v))))\n\n(defmacro let [bindings & body]\n  (var vars [])\n  (js-for [i 0] (< i bindings.length) (set! i (+ i 2))\n    (var s (get bindings i)\n         v (get bindings (+ i 1)))\n    (vars.push `(var ~s ~v)))\n  `(do ~@vars ~@body))\n\n(defmacro -> [left app & apps]\n  (cond\n    (not app)       left\n    (keyword? app) `(-> (get ~left ~app.name) ~@apps)\n    (list? app)    `(-> (~app.values.0 ~left ~@(app.values.slice 1))\n                        ~@apps)\n    (symbol? app)  `(-> (~app ~left) ~@apps)\n    :else           (throw \"Invalid -> target\")))\n\n; (defmacro defprotocol [symb & fns]\n;   (let [marker (+ symb.name \"$proto\")\n;         first (fn [list] list.values.0)\n;         name (fn [symb] symb.name)\n;         fn-names (-> fns (.map first) (.map name))\n;         defaults {}]\n;     (fn-names.forEach (fn [n]\n;       (set! (get defaults (+ \"default$\" n)) nil)))\n;     `(def ~symb ~defaults)))\n\n; ; declaration\n; (defprotocol Iterable\n;   (map [obj func])\n;   (each [obj func]))\n\n; ; expansion\n; (def Iterable\n;   { :$default$map nil\n;     :$default$each nil })\n\n; (defn map [obj func]\n;   (cond\n;     obj.Iterable$proto$map (obj.Iterable$proto$map obj func)\n;     Iterable.$default$map (Iterable.$default$map obj func)\n;     :else (throw \"No suitable implementation of Iterable map$2 found.\")))\n\n; (defn each [obj func]\n;   (cond\n;     obj.Iterable$proto$each (obj.Iterable$proto$each obj func)\n;     Iterable.$default$each (Iterable.$default$each obj func)\n;     :else (throw \"No suitable implementation of Iterable each$2 found.\")))\n";

function Environment (target, interactive) {

  var id_counter = 0;

  this.interactive = interactive;

  this.genID = function (root) {
    return root + "_$" + (++id_counter);
  }

  this.readSession = (new reader.Reader(this.genID)).newReadSession();

  this.target = target || "node";

  this.scope = new Namespace.Scope();
  this.scope.expose('Array', Array);
  this.scope.expose('Function', Function);
  this.scope.expose('Object', Object);
  this.scope.expose('Number', Number);

  this.scope.expose('JSON', JSON);
  this.scope.expose('console', console);

  this.scope.expose('List', core.list);
  this.scope.expose('Symbol', core.symbol);
  this.scope.expose('Keyword', core.keyword);

  this.namespaces = [];

  this.current_namespace = this.getNamespace('terrible.core');

  this.evalText(terrible_core);

  this.current_namespace = this.getNamespace('user');
};

Environment.prototype.findNamespace = function (name) {
  for (var i = 0; i < this.namespaces.length; ++i) {
    if (this.namespaces[i].name === name) {
      return this.namespaces[i];
    }
  }
};

Environment.prototype.getNamespace = function (name) {
  var ns = this.findNamespace(name);
  if (ns) {
    return ns;
  } else {
    var ns = new Namespace.Namespace(name, this.scope.newScope(true, false));
    if (name != "terrible.core") {
      ns.scope.refer("terrible.core", null, this.findNamespace("terrible.core"))
    }
    this.namespaces.push(ns);
    return ns;
  }
};

Environment.prototype.evalText = function (text, error_cb) {
  var forms = this.readSession.readString(text);

  var results = [];

  for (var i = 0, len = forms.length; i < forms.length; ++i) {
    var form = forms[i];
    try {
      var processed = parser.process(form, this, false);
      processed.form = form;
      processed.text = form.$text;

      var nodes = processed.ast;

      results.push(processed);

      if (!processed.value || !processed.value.$macro) {
        this.current_namespace.ast_nodes =
          this.current_namespace.ast_nodes.concat(nodes);
      }
    } catch (exception) {
      if (error_cb) {
        error_cb(form, form.$text, exception);
      } else {
        results.push({
          form: form,
          text: form.$text,
          exception: exception
        });
      }
    }
  }

  if (forms.$exception) {
    var text = this.readSession.buffer.remaining().trim();
    this.readSession.buffer.truncate();
    results.push({ text: text, value: forms.$exception });
  }

  return results;
};

Environment.prototype.asJS = function (mode) {
  var seq = Terr.Seq([]);

  for (var i = 0; i < this.namespaces.length; ++i) {
    seq.values.push(Terr.Seq(this.namespaces[i].ast_nodes));
  }

  if (mode === "library") {
    var export_map = this.current_namespace.exportsMap();

    if (this.target === "browser") {
      seq.values.push(Terr.Return(Terr.Obj(export_map)));
    } else {
      for (var i = 0; i < export_map.length; ++i) {
        var entry = export_map[i];
        seq.values.push(Terr.Assign(
          Terr.Member(Terr.Identifier("exports"), Terr.Literal(entry.key)),
          entry.value
        ));
      }
    }
  }

  if (this.target === "browser") {
    var fn = Terr.Fn([Terr.SubFn([], seq, 0)], [0], null);
    fn.$noReturn = true;
    seq = Terr.Call(fn, []);
  }

  // TODO: better way of doing this, threading a context or such.
  Terr.INTERACTIVE = this.interactive;
  var js_ast = Terr.CompileToJS(seq, "statement");

  if (false) { // source map experimenting
    var result = codegen.generate(JS.Program(js_ast), {
      sourceMap: "input",
      sourceMapWithCode: true
    });

    console.log("map", result.map.toString());

    return result.code;
  } else {
    return codegen.generate(JS.Program(js_ast));
  }
}

exports.Environment = Environment;

})()
},{"./core":3,"./js":4,"./namespace":5,"./parser":19,"./reader":20,"./terr-ast":22,"escodegen":6,"fs":25}],2:[function(require,module,exports){
exports.Identifier = function(name) {
  return {
    type: 'Identifier',
    name: name
  };
};

exports.VariableDeclaration = function(declarations) {
  return {
    type: 'VariableDeclaration',
    declarations: declarations,
    kind: 'var'
  };
};

exports.VariableDeclarator = function(id, init) {
  return {
    type: 'VariableDeclarator',
    id: id,
    init: init
  };
};

exports.NewExpression = function(callee, args) {
  return {
    type: 'NewExpression',
    callee: callee,
    "arguments": args
  };
};

exports.ObjectExpression = function(properties) {
  return {
    type: 'ObjectExpression',
    properties: properties
  };
};

exports.Literal = function(value) {
  return {
    type: 'Literal',
    value: value
  };
};

exports.CallExpression = function(callee, args) {
  return {
    type: 'CallExpression',
    callee: callee,
    "arguments": args
  };
};

exports.SequenceExpression = function(expressions) {
  return {
    type: 'SequenceExpression',
    expressions: expressions
  };
};

exports.Block = function(body) {
  return {
    type: 'BlockStatement',
    body: body
  };
};

exports.Return = function(arg) {
  return {
    type: 'ReturnStatement',
    argument: arg
  };
};

exports.ForStatement = function(init, test, update, body) {
  return {
    type: 'ForStatement',
    init: init,
    test: test,
    update: update,
    body: body
  };
};

exports.FunctionExpression = function(params, body) {
  return {
    type: 'FunctionExpression',
    params: params,
    body: exports.Block(body)
  };
};

exports.FunctionDeclaration = function(id, params, body) {
  return {
    id: id,
    type: 'FunctionDeclaration',
    params: params,
    body: exports.Block(body)
  };
};

exports.ExpressionStatement = function(expr) {
  return {
    type: 'ExpressionStatement',
    expression: expr
  };
};

exports.BinaryExpression = function(left, operator, right) {
  return {
    type: 'BinaryExpression',
    operator: operator,
    left: left,
    right: right
  };
};

exports.IfStatement = function(test, consequent, alternate) {
  return {
    type: 'IfStatement',
    test: test,
    consequent: consequent,
    alternate: alternate
  };
};

exports.ConditionalExpression = function (test, consequent, alternate) {
  return {
    type: 'ConditionalExpression',
    test: test,
    consequent: consequent,
    alternate: alternate
  };
}

exports.UnaryExpression = function(operator, argument) {
  return {
    type: 'UnaryExpression',
    operator: operator,
    argument: argument
  };
};

exports.MemberExpression = function(object, property) {
  return {
    type: 'MemberExpression',
    object: object,
    property: property
  };
};

exports.LogicalExpression = function(left, operator, right) {
  return {
    type: 'LogicalExpression',
    operator: operator,
    left: left,
    right: right
  };
};

exports.AssignmentExpression = function(left, operator, right) {
  return {
    type: 'AssignmentExpression',
    operator: operator,
    left: left,
    right: right
  };
};

exports.ArrayExpression = function(elements) {
  return {
    type: 'ArrayExpression',
    elements: elements
  };
};

exports.Program = function(body) {
  return {
    type: 'Program',
    body: body
  };
};

exports.MemberExpressionComputed = function (object, property) {
  var computed;
  if (property.type === 'Literal' && /^[a-zA-Z_$][0-9a-zA-Z_$]*$/.exec(property.value)) {
    property = exports.Identifier(property.value);
    computed = false;
  } else {
    computed = true;
  }
  return {
    type: 'MemberExpression',
    object: object,
    property: property,
    computed: computed
  };
};

exports.ThrowStatement = function (arg) {
  return {
    type: 'ThrowStatement',
    argument: arg
  };
};

exports.TryStatement = function (block, handler, finalizer) {
  return {
    type: "TryStatement",
    block: block,
    handler: handler,
    guardedHandlers: [],
    finalizer: finalizer
  };
};

exports.CatchClause = function (arg, block) {
  return {
    type: "CatchClause",
    param: arg,
    body: block
  };
};

exports.This = function() {
  return {
    type: 'ThisExpression'
  };
};

},{}],3:[function(require,module,exports){
// Core Structures

// Vector == Array
// Map == Object
// Literals == Number / String

// Because maps in source are read as objects, we have to be careful for these
// types to not be plain objects, so that we can differentiate them.

function List() {
  var values = Array.prototype.slice.call(arguments, 0);
  if (this instanceof List) {
    this.values = values;
  } else {
    return new (Function.prototype.bind.apply(List, [null].concat(values)));
  }
}
List.prototype.concat = function (arg) {
  this.values = this.values.concat(arg);
  return this;
}
List.prototype.push = function () {
  this.values.push.apply(this.values, arguments);
  return this;
}
List.prototype.toString = function () {
  var vs = this.values.map(function (v) { return v.toString(); });
  return "(" + vs.join(" ") + ")";
}
exports.list = List;

function Symbol(name) {
  if (this instanceof Symbol) {
    this.name = name;
  } else {
    return new Symbol(name);
  }
}
Symbol.prototype.toString = function () { return this.name; };
exports.symbol = Symbol;

function Keyword (name) {
  if (this instanceof Keyword) {
    this.name = name;
  } else {
    return new Keyword(name);
  }
}
Keyword.prototype.toString = function () { return this.name; }
exports.keyword = Keyword;

},{}],4:[function(require,module,exports){
exports.Identifier = function(name) {
  return {
    type: 'Identifier',
    name: name
  };
};

exports.VariableDeclaration = function(declarations) {
  return {
    type: 'VariableDeclaration',
    declarations: declarations,
    kind: 'var'
  };
};

exports.VariableDeclarator = function(id, init) {
  return {
    type: 'VariableDeclarator',
    id: id,
    init: init
  };
};

exports.NewExpression = function(callee, args) {
  return {
    type: 'NewExpression',
    callee: callee,
    "arguments": args
  };
};

exports.ObjectExpression = function(properties) {
  return {
    type: 'ObjectExpression',
    properties: properties
  };
};

exports.Literal = function(value) {
  return {
    type: 'Literal',
    value: value
  };
};

exports.CallExpression = function(callee, args) {
  return {
    type: 'CallExpression',
    callee: callee,
    "arguments": args
  };
};

exports.SequenceExpression = function(expressions) {
  return {
    type: 'SequenceExpression',
    expressions: expressions
  };
};

exports.Block = function(body) {
  return {
    type: 'BlockStatement',
    body: body
  };
};

exports.Return = function(arg) {
  return {
    type: 'ReturnStatement',
    argument: arg
  };
};

exports.ForStatement = function(init, test, update, body) {
  return {
    type: 'ForStatement',
    init: init,
    test: test,
    update: update,
    body: body
  };
};

exports.FunctionExpression = function(params, body) {
  return {
    type: 'FunctionExpression',
    params: params,
    body: exports.Block(body)
  };
};

exports.FunctionDeclaration = function(id, params, body) {
  return {
    id: id,
    type: 'FunctionDeclaration',
    params: params,
    body: exports.Block(body)
  };
};

exports.ExpressionStatement = function(expr) {
  return {
    type: 'ExpressionStatement',
    expression: expr
  };
};

exports.BinaryExpression = function(left, operator, right) {
  return {
    type: 'BinaryExpression',
    operator: operator,
    left: left,
    right: right
  };
};

exports.IfStatement = function(test, consequent, alternate) {
  return {
    type: 'IfStatement',
    test: test,
    consequent: consequent,
    alternate: alternate
  };
};

exports.ConditionalExpression = function (test, consequent, alternate) {
  return {
    type: 'ConditionalExpression',
    test: test,
    consequent: consequent,
    alternate: alternate
  };
}

exports.UnaryExpression = function(operator, argument) {
  return {
    type: 'UnaryExpression',
    operator: operator,
    argument: argument
  };
};

exports.MemberExpression = function(object, property) {
  return {
    type: 'MemberExpression',
    object: object,
    property: property
  };
};

exports.LogicalExpression = function(left, operator, right) {
  return {
    type: 'LogicalExpression',
    operator: operator,
    left: left,
    right: right
  };
};

exports.AssignmentExpression = function(left, operator, right) {
  return {
    type: 'AssignmentExpression',
    operator: operator,
    left: left,
    right: right
  };
};

exports.ArrayExpression = function(elements) {
  return {
    type: 'ArrayExpression',
    elements: elements
  };
};

exports.Program = function(body) {
  return {
    type: 'Program',
    body: body
  };
};

exports.MemberExpressionComputed = function (object, property) {
  var computed;
  if (property.type === 'Literal' && /^[a-zA-Z_$][0-9a-zA-Z_$]*$/.exec(property.value)) {
    property = exports.Identifier(property.value);
    computed = false;
  } else {
    computed = true;
  }
  return {
    type: 'MemberExpression',
    object: object,
    property: property,
    computed: computed
  };
};

exports.ThrowStatement = function (arg) {
  return {
    type: 'ThrowStatement',
    argument: arg
  };
};

exports.TryStatement = function (block, handler, finalizer) {
  return {
    type: "TryStatement",
    block: block,
    handler: handler,
    guardedHandlers: [],
    finalizer: finalizer
  };
};

exports.CatchClause = function (arg, block) {
  return {
    type: "CatchClause",
    param: arg,
    body: block
  };
};

exports.This = function() {
  return {
    type: 'ThisExpression'
  };
};

},{}],5:[function(require,module,exports){
var JS = require('./js');
var Terr = require('./terr-ast');

// Scopes

function Scope (parent, js_frame) {
  this.parent = parent;
  this.logical_frame = {};
  this.js_frame = js_frame || {};
  this.ns_references = [];
}

Scope.prototype.addSymbol = function (name, metadata) {
  this.logical_frame[name] = metadata;
  this.js_frame[name] = metadata;
}

Scope.prototype.newScope = function (logical, js) {
  if (js == true) {
    return new Scope(this);
  } else {
    return new Scope(this, this.js_frame);
  }
}

Scope.prototype.resolve = function (name) {
  if (this.logical_frame[name]) {
    return this.logical_frame[name];
  } else {
    for (var i = 0; i < this.ns_references.length; ++i) {
      var ref = this.ns_references[i];

      if (ref.alias === null) {
        var ns_resolved = ref.ns.scope.resolve(name);
        if (ns_resolved) {
          return ns_resolved;
        }
      }
    }

    return this.parent ? this.parent.resolve(name) : false;
  }
}

Scope.prototype.resolveNamespace = function (alias) {
  for (var i = 0; i < this.ns_references.length; ++i) {
    var ref = this.ns_references[i];

    if (ref.alias === alias) {
      return ref.ns;
    }
  }

  return this.parent? this.parent.resolveNamespace(alias) : false;
}

Scope.prototype.nameClash = function (name) {
  var keys = Object.keys(this.js_frame);
  for (var i = 0; i < keys.length; ++i) {
    if (keys[i] === name) return true;
  }
}

Scope.prototype.jsScoped = function (name) {
  return this.js_frame[name] != null
}

Scope.prototype.jsScope = function (predicate) {
  var logical_frame = this.logical_frame;
  var this_map = {};

  Object.keys(logical_frame).filter(function (k) {
    if (predicate(logical_frame[k])) {
      this_map[k] = logical_frame[k];
    }
  });

  if (this.parent) {
    var upper_map = this.parent.jsScope(predicate);

    Object.keys(this_map).forEach(function (k) {
      upper_map[k] = this_map[k];
    });

    return upper_map;
  } else {
    return this_map;
  }
}

Scope.prototype.logicalScoped = function (name) {
  return this.logical_frame[name] != null
}

Scope.prototype.update = function (name, attrs) {
  if (this.logical_frame[name]) {
    for (var k in attrs) {
      this.logical_frame[name][k] = attrs[k];
    }
  } else {
    return this.parent ? this.parent.update(name, attrs) : false;
  }
}

Scope.prototype.expose = function (name, value) {
  this.logical_frame[name] = {
    type: 'any',
    accessor: Terr.NamespaceGet(null, name, name),
    value: value,
    top_level: true
  };
};

Scope.prototype.refer = function (namespace, alias, ns) {
  for (var i = 0; i < this.ns_references.length; ++i) {
    var ref = this.ns_references[i];
    if (ref.namespace == namespace && ref.alias == alias) return;
  }

  this.ns_references.push({namespace: namespace, alias: alias, ns: ns});
};

Scope.prototype.exports = function () {
  var lf = this.logical_frame;
  return Object.keys(lf).filter(function (k) {
    return lf[k].export;
  }).map(function(k) {
    return {name: k, data: lf[k]};
  });
}

// Namespaces

function Namespace (name, scope) {
  this.name = name;
  this.scope = scope;
  this.scope.top_level = true;

  this.ast_nodes = [];
  this.dependent_namespaces = [];
}

Namespace.prototype.exportsMap = function () {
  return this.scope.exports().filter(function (exported) {
    if (exported.data.value && exported.data.value.$macro) {
      return false;
    } else {
      return true;
    }
  }).map(function (exported) {
    return {
      key: exported.name,
      value: exported.data.accessor
    };
  });
}

Namespace.prototype.requiresNamespace = function (ns) {
  if (!~this.dependent_namespaces.indexOf(ns)) {
    this.dependent_namespaces.push(ns);
  }
}

// var env = new Namespace();
// env.evalFile('jsbench.terr');
// env.evalFile('core.terr');
// env.evalText('(defn f ([a] a) ([a b] b) ([a & b] b)) (f 5) (f 5 6) (f 5 6 7)');
// env.evalText('(var a (fn ([a] a) ([a b] b)))');
// env.evalText('(console.log (f 6 7))');
// env.evalText("(var m {:a #({:a %.a}) :b (try m (catch [exc] false))})")
// env.evalText("#({:a %.a})")
// env.evalText("(ns terrible.test)");
// env.evalText("(def f 2 3)");
// env.evalText('(var b (do (try 7 (catch [my-val] my-val.message)) 7))')
// env.evalText('(var my-var 6)')
// env.evalText("(fn [a] (if (not 6) (return 6)) a)")
// env.evalText("(if 6 7 (do 8 9))")
// env.evalText("(fn [] (if (do 6 7) 7 (do 8 9)))")
// console.log(env.asJS())

exports.Namespace = Namespace;
exports.Scope = Scope;

},{"./js":4,"./terr-ast":22}],6:[function(require,module,exports){
(function(global){/*
  Copyright (C) 2012-2013 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012-2013 Michael Ficarra <escodegen.copyright@michael.ficarra.me>
  Copyright (C) 2012-2013 Mathias Bynens <mathias@qiwi.be>
  Copyright (C) 2013 Irakli Gozalishvili <rfobic@gmail.com>
  Copyright (C) 2012 Robert Gust-Bardon <donate@robert.gust-bardon.org>
  Copyright (C) 2012 John Freeman <jfreeman08@gmail.com>
  Copyright (C) 2011-2012 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
  Copyright (C) 2012 Kris Kowal <kris.kowal@cixar.com>
  Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*jslint bitwise:true */
/*global exports:true, generateStatement:true, generateExpression:true, require:true, global:true*/
(function () {
    'use strict';

    var Syntax,
        Precedence,
        BinaryPrecedence,
        Regex,
        VisitorKeys,
        VisitorOption,
        SourceNode,
        isArray,
        base,
        indent,
        json,
        renumber,
        hexadecimal,
        quotes,
        escapeless,
        newline,
        space,
        parentheses,
        semicolons,
        safeConcatenation,
        directive,
        extra,
        parse,
        sourceMap,
        traverse,
        FORMAT_MINIFY,
        FORMAT_DEFAULTS;

    traverse = require('estraverse').traverse;

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        ArrayPattern: 'ArrayPattern',
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ComprehensionBlock: 'ComprehensionBlock',
        ComprehensionExpression: 'ComprehensionExpression',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DirectiveStatement: 'DirectiveStatement',
        DoWhileStatement: 'DoWhileStatement',
        DebuggerStatement: 'DebuggerStatement',
        EmptyStatement: 'EmptyStatement',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        ObjectPattern: 'ObjectPattern',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement',
        YieldExpression: 'YieldExpression'

    };

    Precedence = {
        Sequence: 0,
        Assignment: 1,
        Conditional: 2,
        LogicalOR: 3,
        LogicalAND: 4,
        BitwiseOR: 5,
        BitwiseXOR: 6,
        BitwiseAND: 7,
        Equality: 8,
        Relational: 9,
        BitwiseSHIFT: 10,
        Additive: 11,
        Multiplicative: 12,
        Unary: 13,
        Postfix: 14,
        Call: 15,
        New: 16,
        Member: 17,
        Primary: 18
    };

    BinaryPrecedence = {
        '||': Precedence.LogicalOR,
        '&&': Precedence.LogicalAND,
        '|': Precedence.BitwiseOR,
        '^': Precedence.BitwiseXOR,
        '&': Precedence.BitwiseAND,
        '==': Precedence.Equality,
        '!=': Precedence.Equality,
        '===': Precedence.Equality,
        '!==': Precedence.Equality,
        'is': Precedence.Equality,
        'isnt': Precedence.Equality,
        '<': Precedence.Relational,
        '>': Precedence.Relational,
        '<=': Precedence.Relational,
        '>=': Precedence.Relational,
        'in': Precedence.Relational,
        'instanceof': Precedence.Relational,
        '<<': Precedence.BitwiseSHIFT,
        '>>': Precedence.BitwiseSHIFT,
        '>>>': Precedence.BitwiseSHIFT,
        '+': Precedence.Additive,
        '-': Precedence.Additive,
        '*': Precedence.Multiplicative,
        '%': Precedence.Multiplicative,
        '/': Precedence.Multiplicative
    };

    Regex = {
        NonAsciiIdentifierPart: new RegExp('[\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0300-\u0374\u0376\u0377\u037a-\u037d\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u0483-\u0487\u048a-\u0527\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u05d0-\u05ea\u05f0-\u05f2\u0610-\u061a\u0620-\u0669\u066e-\u06d3\u06d5-\u06dc\u06df-\u06e8\u06ea-\u06fc\u06ff\u0710-\u074a\u074d-\u07b1\u07c0-\u07f5\u07fa\u0800-\u082d\u0840-\u085b\u08a0\u08a2-\u08ac\u08e4-\u08fe\u0900-\u0963\u0966-\u096f\u0971-\u0977\u0979-\u097f\u0981-\u0983\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bc-\u09c4\u09c7\u09c8\u09cb-\u09ce\u09d7\u09dc\u09dd\u09df-\u09e3\u09e6-\u09f1\u0a01-\u0a03\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a59-\u0a5c\u0a5e\u0a66-\u0a75\u0a81-\u0a83\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abc-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ad0\u0ae0-\u0ae3\u0ae6-\u0aef\u0b01-\u0b03\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3c-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b5c\u0b5d\u0b5f-\u0b63\u0b66-\u0b6f\u0b71\u0b82\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd0\u0bd7\u0be6-\u0bef\u0c01-\u0c03\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c33\u0c35-\u0c39\u0c3d-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c58\u0c59\u0c60-\u0c63\u0c66-\u0c6f\u0c82\u0c83\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbc-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0cde\u0ce0-\u0ce3\u0ce6-\u0cef\u0cf1\u0cf2\u0d02\u0d03\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d-\u0d44\u0d46-\u0d48\u0d4a-\u0d4e\u0d57\u0d60-\u0d63\u0d66-\u0d6f\u0d7a-\u0d7f\u0d82\u0d83\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2\u0df3\u0e01-\u0e3a\u0e40-\u0e4e\u0e50-\u0e59\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb9\u0ebb-\u0ebd\u0ec0-\u0ec4\u0ec6\u0ec8-\u0ecd\u0ed0-\u0ed9\u0edc-\u0edf\u0f00\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f3e-\u0f47\u0f49-\u0f6c\u0f71-\u0f84\u0f86-\u0f97\u0f99-\u0fbc\u0fc6\u1000-\u1049\u1050-\u109d\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u135d-\u135f\u1380-\u138f\u13a0-\u13f4\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f0\u1700-\u170c\u170e-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176c\u176e-\u1770\u1772\u1773\u1780-\u17d3\u17d7\u17dc\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u1820-\u1877\u1880-\u18aa\u18b0-\u18f5\u1900-\u191c\u1920-\u192b\u1930-\u193b\u1946-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u19d0-\u19d9\u1a00-\u1a1b\u1a20-\u1a5e\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1aa7\u1b00-\u1b4b\u1b50-\u1b59\u1b6b-\u1b73\u1b80-\u1bf3\u1c00-\u1c37\u1c40-\u1c49\u1c4d-\u1c7d\u1cd0-\u1cd2\u1cd4-\u1cf6\u1d00-\u1de6\u1dfc-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u200c\u200d\u203f\u2040\u2054\u2071\u207f\u2090-\u209c\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d7f-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2de0-\u2dff\u2e2f\u3005-\u3007\u3021-\u302f\u3031-\u3035\u3038-\u303c\u3041-\u3096\u3099\u309a\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312d\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fcc\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua62b\ua640-\ua66f\ua674-\ua67d\ua67f-\ua697\ua69f-\ua6f1\ua717-\ua71f\ua722-\ua788\ua78b-\ua78e\ua790-\ua793\ua7a0-\ua7aa\ua7f8-\ua827\ua840-\ua873\ua880-\ua8c4\ua8d0-\ua8d9\ua8e0-\ua8f7\ua8fb\ua900-\ua92d\ua930-\ua953\ua960-\ua97c\ua980-\ua9c0\ua9cf-\ua9d9\uaa00-\uaa36\uaa40-\uaa4d\uaa50-\uaa59\uaa60-\uaa76\uaa7a\uaa7b\uaa80-\uaac2\uaadb-\uaadd\uaae0-\uaaef\uaaf2-\uaaf6\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uabc0-\uabea\uabec\uabed\uabf0-\uabf9\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe00-\ufe0f\ufe20-\ufe26\ufe33\ufe34\ufe4d-\ufe4f\ufe70-\ufe74\ufe76-\ufefc\uff10-\uff19\uff21-\uff3a\uff3f\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc]')
    };

    function ignoreJSHintError() { }

    function getDefaultOptions() {
        // default options
        return {
            indent: null,
            base: null,
            parse: null,
            comment: false,
            format: {
                indent: {
                    style: '    ',
                    base: 0,
                    adjustMultilineComment: false
                },
                json: false,
                renumber: false,
                hexadecimal: false,
                quotes: 'single',
                escapeless: false,
                compact: false,
                parentheses: true,
                semicolons: true,
                safeConcatenation: false
            },
            moz: {
                starlessGenerator: false,
                parenthesizedComprehensionBlock: false
            },
            sourceMap: null,
            sourceMapRoot: null,
            sourceMapWithCode: false,
            directive: false,
            verbatim: null
        };
    }

    function stringToArray(str) {
        var length = str.length,
            result = [],
            i;
        for (i = 0; i < length; i += 1) {
            result[i] = str.charAt(i);
        }
        return result;
    }

    function stringRepeat(str, num) {
        var result = '';

        for (num |= 0; num > 0; num >>>= 1, str += str) {
            if (num & 1) {
                result += str;
            }
        }

        return result;
    }

    isArray = Array.isArray;
    if (!isArray) {
        isArray = function isArray(array) {
            return Object.prototype.toString.call(array) === '[object Array]';
        };
    }

    // Fallback for the non SourceMap environment
    function SourceNodeMock(line, column, filename, chunk) {
        var result = [];

        function flatten(input) {
            var i, iz;
            if (isArray(input)) {
                for (i = 0, iz = input.length; i < iz; ++i) {
                    flatten(input[i]);
                }
            } else if (input instanceof SourceNodeMock) {
                result.push(input);
            } else if (typeof input === 'string' && input) {
                result.push(input);
            }
        }

        flatten(chunk);
        this.children = result;
    }

    SourceNodeMock.prototype.toString = function toString() {
        var res = '', i, iz, node;
        for (i = 0, iz = this.children.length; i < iz; ++i) {
            node = this.children[i];
            if (node instanceof SourceNodeMock) {
                res += node.toString();
            } else {
                res += node;
            }
        }
        return res;
    };

    SourceNodeMock.prototype.replaceRight = function replaceRight(pattern, replacement) {
        var last = this.children[this.children.length - 1];
        if (last instanceof SourceNodeMock) {
            last.replaceRight(pattern, replacement);
        } else if (typeof last === 'string') {
            this.children[this.children.length - 1] = last.replace(pattern, replacement);
        } else {
            this.children.push(''.replace(pattern, replacement));
        }
        return this;
    };

    SourceNodeMock.prototype.join = function join(sep) {
        var i, iz, result;
        result = [];
        iz = this.children.length;
        if (iz > 0) {
            for (i = 0, iz -= 1; i < iz; ++i) {
                result.push(this.children[i], sep);
            }
            result.push(this.children[iz]);
            this.children = result;
        }
        return this;
    };

    function hasLineTerminator(str) {
        return (/[\r\n]/g).test(str);
    }

    function endsWithLineTerminator(str) {
        var ch = str.charAt(str.length - 1);
        return ch === '\r' || ch === '\n';
    }

    function shallowCopy(obj) {
        var ret = {}, key;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                ret[key] = obj[key];
            }
        }
        return ret;
    }
    ignoreJSHintError(shallowCopy);

    function deepCopy(obj) {
        var ret = {}, key, val;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                val = obj[key];
                if (typeof val === 'object' && val !== null) {
                    ret[key] = deepCopy(val);
                } else {
                    ret[key] = val;
                }
            }
        }
        return ret;
    }

    function updateDeeply(target, override) {
        var key, val;

        function isHashObject(target) {
            return typeof target === 'object' && target instanceof Object && !(target instanceof RegExp);
        }

        for (key in override) {
            if (override.hasOwnProperty(key)) {
                val = override[key];
                if (isHashObject(val)) {
                    if (isHashObject(target[key])) {
                        updateDeeply(target[key], val);
                    } else {
                        target[key] = updateDeeply({}, val);
                    }
                } else {
                    target[key] = val;
                }
            }
        }
        return target;
    }

    function generateNumber(value) {
        var result, point, temp, exponent, pos;

        if (value !== value) {
            throw new Error('Numeric literal whose value is NaN');
        }
        if (value < 0 || (value === 0 && 1 / value < 0)) {
            throw new Error('Numeric literal whose value is negative');
        }

        if (value === 1 / 0) {
            return json ? 'null' : renumber ? '1e400' : '1e+400';
        }

        result = '' + value;
        if (!renumber || result.length < 3) {
            return result;
        }

        point = result.indexOf('.');
        if (!json && result.charAt(0) === '0' && point === 1) {
            point = 0;
            result = result.slice(1);
        }
        temp = result;
        result = result.replace('e+', 'e');
        exponent = 0;
        if ((pos = temp.indexOf('e')) > 0) {
            exponent = +temp.slice(pos + 1);
            temp = temp.slice(0, pos);
        }
        if (point >= 0) {
            exponent -= temp.length - point - 1;
            temp = +(temp.slice(0, point) + temp.slice(point + 1)) + '';
        }
        pos = 0;
        while (temp.charAt(temp.length + pos - 1) === '0') {
            pos -= 1;
        }
        if (pos !== 0) {
            exponent -= pos;
            temp = temp.slice(0, pos);
        }
        if (exponent !== 0) {
            temp += 'e' + exponent;
        }
        if ((temp.length < result.length ||
                    (hexadecimal && value > 1e12 && Math.floor(value) === value && (temp = '0x' + value.toString(16)).length < result.length)) &&
                +temp === value) {
            result = temp;
        }

        return result;
    }

    // Generate valid RegExp expression.
    // This function is based on https://github.com/Constellation/iv Engine

    function escapeRegExpCharacter(ch, previousIsBackslash) {
        // not handling '\' and handling \u2028 or \u2029 to unicode escape sequence
        if ((ch & ~1) === 0x2028) {
            return (previousIsBackslash ? 'u' : '\\u') + ((ch === 0x2028) ? '2028' : '2029');
        } else if (ch === 10 || ch === 13) {  // \n, \r
            return (previousIsBackslash ? '' : '\\') + ((ch === 10) ? 'n' : 'r');
        }
        return String.fromCharCode(ch);
    }

    function generateRegExp(reg) {
        var match, result, flags, i, iz, ch, characterInBrack, previousIsBackslash;

        result = reg.toString();

        if (reg.source) {
            // extract flag from toString result
            match = result.match(/\/([^/]*)$/);
            if (!match) {
                return result;
            }

            flags = match[1];
            result = '';

            characterInBrack = false;
            previousIsBackslash = false;
            for (i = 0, iz = reg.source.length; i < iz; ++i) {
                ch = reg.source.charCodeAt(i);

                if (!previousIsBackslash) {
                    if (characterInBrack) {
                        if (ch === 93) {  // ]
                            characterInBrack = false;
                        }
                    } else {
                        if (ch === 47) {  // /
                            result += '\\';
                        } else if (ch === 91) {  // [
                            characterInBrack = true;
                        }
                    }
                    result += escapeRegExpCharacter(ch, previousIsBackslash);
                    previousIsBackslash = ch === 92;  // \
                } else {
                    // if new RegExp("\\\n') is provided, create /\n/
                    result += escapeRegExpCharacter(ch, previousIsBackslash);
                    // prevent like /\\[/]/
                    previousIsBackslash = false;
                }
            }

            return '/' + result + '/' + flags;
        }

        return result;
    }

    function escapeAllowedCharacter(ch, next) {
        var code = ch.charCodeAt(0), hex = code.toString(16), result = '\\';

        switch (ch) {
        case '\b':
            result += 'b';
            break;
        case '\f':
            result += 'f';
            break;
        case '\t':
            result += 't';
            break;
        default:
            if (json || code > 0xff) {
                result += 'u' + '0000'.slice(hex.length) + hex;
            } else if (ch === '\u0000' && '0123456789'.indexOf(next) < 0) {
                result += '0';
            } else if (ch === '\x0B') { // '\v'
                result += 'x0B';
            } else {
                result += 'x' + '00'.slice(hex.length) + hex;
            }
            break;
        }

        return result;
    }

    function escapeDisallowedCharacter(ch) {
        var result = '\\';
        switch (ch) {
        case '\\':
            result += '\\';
            break;
        case '\n':
            result += 'n';
            break;
        case '\r':
            result += 'r';
            break;
        case '\u2028':
            result += 'u2028';
            break;
        case '\u2029':
            result += 'u2029';
            break;
        default:
            throw new Error('Incorrectly classified character');
        }

        return result;
    }

    function escapeDirective(str) {
        var i, iz, ch, buf, quote;

        buf = str;
        if (typeof buf[0] === 'undefined') {
            buf = stringToArray(buf);
        }

        quote = quotes === 'double' ? '"' : '\'';
        for (i = 0, iz = buf.length; i < iz; i += 1) {
            ch = buf[i];
            if (ch === '\'') {
                quote = '"';
                break;
            } else if (ch === '"') {
                quote = '\'';
                break;
            } else if (ch === '\\') {
                i += 1;
            }
        }

        return quote + str + quote;
    }

    function escapeString(str) {
        var result = '', i, len, ch, singleQuotes = 0, doubleQuotes = 0, single;

        if (typeof str[0] === 'undefined') {
            str = stringToArray(str);
        }

        for (i = 0, len = str.length; i < len; i += 1) {
            ch = str[i];
            if (ch === '\'') {
                singleQuotes += 1;
            } else if (ch === '"') {
                doubleQuotes += 1;
            } else if (ch === '/' && json) {
                result += '\\';
            } else if ('\\\n\r\u2028\u2029'.indexOf(ch) >= 0) {
                result += escapeDisallowedCharacter(ch);
                continue;
            } else if ((json && ch < ' ') || !(json || escapeless || (ch >= ' ' && ch <= '~'))) {
                result += escapeAllowedCharacter(ch, str[i + 1]);
                continue;
            }
            result += ch;
        }

        single = !(quotes === 'double' || (quotes === 'auto' && doubleQuotes < singleQuotes));
        str = result;
        result = single ? '\'' : '"';

        if (typeof str[0] === 'undefined') {
            str = stringToArray(str);
        }

        for (i = 0, len = str.length; i < len; i += 1) {
            ch = str[i];
            if ((ch === '\'' && single) || (ch === '"' && !single)) {
                result += '\\';
            }
            result += ch;
        }

        return result + (single ? '\'' : '"');
    }

    function isWhiteSpace(ch) {
        // Use `\x0B` instead of `\v` for IE < 9 compatibility
        return '\t\x0B\f \xa0'.indexOf(ch) >= 0 || (ch.charCodeAt(0) >= 0x1680 && '\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\ufeff'.indexOf(ch) >= 0);
    }

    function isLineTerminator(ch) {
        return '\n\r\u2028\u2029'.indexOf(ch) >= 0;
    }

    function isIdentifierPart(ch) {
        return (ch === '$') || (ch === '_') || (ch === '\\') ||
            (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
            ((ch >= '0') && (ch <= '9')) ||
            ((ch.charCodeAt(0) >= 0x80) && Regex.NonAsciiIdentifierPart.test(ch));
    }

    function toSourceNode(generated, node) {
        if (node == null) {
            if (generated instanceof SourceNode) {
                return generated;
            } else {
                node = {};
            }
        }
        if (node.loc == null) {
            return new SourceNode(null, null, sourceMap, generated, node.name || null);
        }
        return new SourceNode(node.loc.start.line, node.loc.start.column, (sourceMap === true ? node.loc.source || null : sourceMap), generated, node.name || null);
    }

    function join(left, right) {
        var leftSource = toSourceNode(left).toString(),
            rightSource = toSourceNode(right).toString(),
            leftChar = leftSource.charAt(leftSource.length - 1),
            rightChar = rightSource.charAt(0);

        if (((leftChar === '+' || leftChar === '-') && leftChar === rightChar) || (isIdentifierPart(leftChar) && isIdentifierPart(rightChar))) {
            return [left, ' ', right];
        } else if (isWhiteSpace(leftChar) || isLineTerminator(leftChar) || isWhiteSpace(rightChar) || isLineTerminator(rightChar)) {
            return [left, right];
        }
        return [left, space, right];
    }

    function addIndent(stmt) {
        return [base, stmt];
    }

    function withIndent(fn) {
        var previousBase, result;
        previousBase = base;
        base += indent;
        result = fn.call(this, base);
        base = previousBase;
        return result;
    }

    function calculateSpaces(str) {
        var i;
        for (i = str.length - 1; i >= 0; i -= 1) {
            if (isLineTerminator(str.charAt(i))) {
                break;
            }
        }
        return (str.length - 1) - i;
    }

    function adjustMultilineComment(value, specialBase) {
        var array, i, len, line, j, spaces, previousBase;

        array = value.split(/\r\n|[\r\n]/);
        spaces = Number.MAX_VALUE;

        // first line doesn't have indentation
        for (i = 1, len = array.length; i < len; i += 1) {
            line = array[i];
            j = 0;
            while (j < line.length && isWhiteSpace(line[j])) {
                j += 1;
            }
            if (spaces > j) {
                spaces = j;
            }
        }

        if (typeof specialBase !== 'undefined') {
            // pattern like
            // {
            //   var t = 20;  /*
            //                 * this is comment
            //                 */
            // }
            previousBase = base;
            if (array[1][spaces] === '*') {
                specialBase += ' ';
            }
            base = specialBase;
        } else {
            if (spaces & 1) {
                // /*
                //  *
                //  */
                // If spaces are odd number, above pattern is considered.
                // We waste 1 space.
                spaces -= 1;
            }
            previousBase = base;
        }

        for (i = 1, len = array.length; i < len; i += 1) {
            array[i] = toSourceNode(addIndent(array[i].slice(spaces))).join('');
        }

        base = previousBase;

        return array.join('\n');
    }

    function generateComment(comment, specialBase) {
        if (comment.type === 'Line') {
            if (endsWithLineTerminator(comment.value)) {
                return '//' + comment.value;
            } else {
                // Always use LineTerminator
                return '//' + comment.value + '\n';
            }
        }
        if (extra.format.indent.adjustMultilineComment && /[\n\r]/.test(comment.value)) {
            return adjustMultilineComment('/*' + comment.value + '*/', specialBase);
        }
        return '/*' + comment.value + '*/';
    }

    function addCommentsToStatement(stmt, result) {
        var i, len, comment, save, tailingToStatement, specialBase, fragment;

        if (stmt.leadingComments && stmt.leadingComments.length > 0) {
            save = result;

            comment = stmt.leadingComments[0];
            result = [];
            if (safeConcatenation && stmt.type === Syntax.Program && stmt.body.length === 0) {
                result.push('\n');
            }
            result.push(generateComment(comment));
            if (!endsWithLineTerminator(toSourceNode(result).toString())) {
                result.push('\n');
            }

            for (i = 1, len = stmt.leadingComments.length; i < len; i += 1) {
                comment = stmt.leadingComments[i];
                fragment = [generateComment(comment)];
                if (!endsWithLineTerminator(toSourceNode(fragment).toString())) {
                    fragment.push('\n');
                }
                result.push(addIndent(fragment));
            }

            result.push(addIndent(save));
        }

        if (stmt.trailingComments) {
            tailingToStatement = !endsWithLineTerminator(toSourceNode(result).toString());
            specialBase = stringRepeat(' ', calculateSpaces(toSourceNode([base, result, indent]).toString()));
            for (i = 0, len = stmt.trailingComments.length; i < len; i += 1) {
                comment = stmt.trailingComments[i];
                if (tailingToStatement) {
                    // We assume target like following script
                    //
                    // var t = 20;  /**
                    //               * This is comment of t
                    //               */
                    if (i === 0) {
                        // first case
                        result = [result, indent];
                    } else {
                        result = [result, specialBase];
                    }
                    result.push(generateComment(comment, specialBase));
                } else {
                    result = [result, addIndent(generateComment(comment))];
                }
                if (i !== len - 1 && !endsWithLineTerminator(toSourceNode(result).toString())) {
                    result = [result, '\n'];
                }
            }
        }

        return result;
    }

    function parenthesize(text, current, should) {
        if (current < should) {
            return ['(', text, ')'];
        }
        return text;
    }

    function maybeBlock(stmt, semicolonOptional, functionBody) {
        var result, noLeadingComment;

        noLeadingComment = !extra.comment || !stmt.leadingComments;

        if (stmt.type === Syntax.BlockStatement && noLeadingComment) {
            return [space, generateStatement(stmt, { functionBody: functionBody })];
        }

        if (stmt.type === Syntax.EmptyStatement && noLeadingComment) {
            return ';';
        }

        withIndent(function () {
            result = [newline, addIndent(generateStatement(stmt, { semicolonOptional: semicolonOptional, functionBody: functionBody }))];
        });

        return result;
    }

    function maybeBlockSuffix(stmt, result) {
        var ends = endsWithLineTerminator(toSourceNode(result).toString());
        if (stmt.type === Syntax.BlockStatement && (!extra.comment || !stmt.leadingComments) && !ends) {
            return [result, space];
        }
        if (ends) {
            return [result, base];
        }
        return [result, newline, base];
    }

    function generateVerbatim(expr, option) {
        var i, result;
        result = expr[extra.verbatim].split(/\r\n|\n/);
        for (i = 1; i < result.length; i++) {
            result[i] = newline + base + result[i];
        }

        result = parenthesize(result, Precedence.Sequence, option.precedence);
        return toSourceNode(result, expr);
    }

    function generateIdentifier(node) {
        return toSourceNode(node.name, node);
    }

    function generateFunctionBody(node) {
        var result, i, len, expr;
        result = ['('];
        for (i = 0, len = node.params.length; i < len; i += 1) {
            result.push(generateIdentifier(node.params[i]));
            if (i + 1 < len) {
                result.push(',' + space);
            }
        }
        result.push(')');

        if (node.expression) {
            result.push(space);
            expr = generateExpression(node.body, {
                precedence: Precedence.Assignment,
                allowIn: true,
                allowCall: true
            });
            if (expr.toString().charAt(0) === '{') {
                expr = ['(', expr, ')'];
            }
            result.push(expr);
        } else {
            result.push(maybeBlock(node.body, false, true));
        }
        return result;
    }

    function generateExpression(expr, option) {
        var result, precedence, type, currentPrecedence, i, len, raw, fragment, multiline, leftChar, leftSource, rightChar, allowIn, allowCall, allowUnparenthesizedNew, property;

        precedence = option.precedence;
        allowIn = option.allowIn;
        allowCall = option.allowCall;
        type = expr.type || option.type;

        if (extra.verbatim && expr.hasOwnProperty(extra.verbatim)) {
            return generateVerbatim(expr, option);
        }

        switch (type) {
        case Syntax.SequenceExpression:
            result = [];
            allowIn |= (Precedence.Sequence < precedence);
            for (i = 0, len = expr.expressions.length; i < len; i += 1) {
                result.push(generateExpression(expr.expressions[i], {
                    precedence: Precedence.Assignment,
                    allowIn: allowIn,
                    allowCall: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result = parenthesize(result, Precedence.Sequence, precedence);
            break;

        case Syntax.AssignmentExpression:
            allowIn |= (Precedence.Assignment < precedence);
            result = parenthesize(
                [
                    generateExpression(expr.left, {
                        precedence: Precedence.Call,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + expr.operator + space,
                    generateExpression(expr.right, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ],
                Precedence.Assignment,
                precedence
            );
            break;

        case Syntax.ConditionalExpression:
            allowIn |= (Precedence.Conditional < precedence);
            result = parenthesize(
                [
                    generateExpression(expr.test, {
                        precedence: Precedence.LogicalOR,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + '?' + space,
                    generateExpression(expr.consequent, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + ':' + space,
                    generateExpression(expr.alternate, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ],
                Precedence.Conditional,
                precedence
            );
            break;

        case Syntax.LogicalExpression:
        case Syntax.BinaryExpression:
            currentPrecedence = BinaryPrecedence[expr.operator];

            allowIn |= (currentPrecedence < precedence);

            fragment = generateExpression(expr.left, {
                precedence: currentPrecedence,
                allowIn: allowIn,
                allowCall: true
            });

            leftSource = fragment.toString();

            if (leftSource.charAt(leftSource.length - 1) === '/' && isIdentifierPart(expr.operator.charAt(0))) {
                result = [fragment, ' ', expr.operator];
            } else {
                result = join(fragment, expr.operator);
            }

            fragment = generateExpression(expr.right, {
                precedence: currentPrecedence + 1,
                allowIn: allowIn,
                allowCall: true
            });

            if (expr.operator === '/' && fragment.toString().charAt(0) === '/') {
                // If '/' concats with '/', it is interpreted as comment start
                result.push(' ', fragment);
            } else {
                result = join(result, fragment);
            }

            if (expr.operator === 'in' && !allowIn) {
                result = ['(', result, ')'];
            } else {
                result = parenthesize(result, currentPrecedence, precedence);
            }

            break;

        case Syntax.CallExpression:
            result = [generateExpression(expr.callee, {
                precedence: Precedence.Call,
                allowIn: true,
                allowCall: true,
                allowUnparenthesizedNew: false
            })];

            result.push('(');
            for (i = 0, len = expr['arguments'].length; i < len; i += 1) {
                result.push(generateExpression(expr['arguments'][i], {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result.push(')');

            if (!allowCall) {
                result = ['(', result, ')'];
            } else {
                result = parenthesize(result, Precedence.Call, precedence);
            }
            break;

        case Syntax.NewExpression:
            len = expr['arguments'].length;
            allowUnparenthesizedNew = option.allowUnparenthesizedNew === undefined || option.allowUnparenthesizedNew;

            result = join(
                'new',
                generateExpression(expr.callee, {
                    precedence: Precedence.New,
                    allowIn: true,
                    allowCall: false,
                    allowUnparenthesizedNew: allowUnparenthesizedNew && !parentheses && len === 0
                })
            );

            if (!allowUnparenthesizedNew || parentheses || len > 0) {
                result.push('(');
                for (i = 0; i < len; i += 1) {
                    result.push(generateExpression(expr['arguments'][i], {
                        precedence: Precedence.Assignment,
                        allowIn: true,
                        allowCall: true
                    }));
                    if (i + 1 < len) {
                        result.push(',' + space);
                    }
                }
                result.push(')');
            }

            result = parenthesize(result, Precedence.New, precedence);
            break;

        case Syntax.MemberExpression:
            result = [generateExpression(expr.object, {
                precedence: Precedence.Call,
                allowIn: true,
                allowCall: allowCall,
                allowUnparenthesizedNew: false
            })];

            if (expr.computed) {
                result.push('[', generateExpression(expr.property, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: allowCall
                }), ']');
            } else {
                if (expr.object.type === Syntax.Literal && typeof expr.object.value === 'number') {
                    fragment = toSourceNode(result).toString();
                    if (fragment.indexOf('.') < 0) {
                        if (!/[eExX]/.test(fragment) &&
                                !(fragment.length >= 2 && fragment.charCodeAt(0) === 48)) {  // '0'
                            result.push('.');
                        }
                    }
                }
                result.push('.', generateIdentifier(expr.property));
            }

            result = parenthesize(result, Precedence.Member, precedence);
            break;

        case Syntax.UnaryExpression:
            fragment = generateExpression(expr.argument, {
                precedence: Precedence.Unary,
                allowIn: true,
                allowCall: true
            });

            if (space === '') {
                result = join(expr.operator, fragment);
            } else {
                result = [expr.operator];
                if (expr.operator.length > 2) {
                    // delete, void, typeof
                    // get `typeof []`, not `typeof[]`
                    result = join(result, fragment);
                } else {
                    // Prevent inserting spaces between operator and argument if it is unnecessary
                    // like, `!cond`
                    leftSource = toSourceNode(result).toString();
                    leftChar = leftSource.charAt(leftSource.length - 1);
                    rightChar = fragment.toString().charAt(0);

                    if (((leftChar === '+' || leftChar === '-') && leftChar === rightChar) || (isIdentifierPart(leftChar) && isIdentifierPart(rightChar))) {
                        result.push(' ', fragment);
                    } else {
                        result.push(fragment);
                    }
                }
            }
            result = parenthesize(result, Precedence.Unary, precedence);
            break;

        case Syntax.YieldExpression:
            if (expr.delegate) {
                result = 'yield*';
            } else {
                result = 'yield';
            }
            if (expr.argument) {
                result = join(
                    result,
                    generateExpression(expr.argument, {
                        precedence: Precedence.Assignment,
                        allowIn: true,
                        allowCall: true
                    })
                );
            }
            break;

        case Syntax.UpdateExpression:
            if (expr.prefix) {
                result = parenthesize(
                    [
                        expr.operator,
                        generateExpression(expr.argument, {
                            precedence: Precedence.Unary,
                            allowIn: true,
                            allowCall: true
                        })
                    ],
                    Precedence.Unary,
                    precedence
                );
            } else {
                result = parenthesize(
                    [
                        generateExpression(expr.argument, {
                            precedence: Precedence.Postfix,
                            allowIn: true,
                            allowCall: true
                        }),
                        expr.operator
                    ],
                    Precedence.Postfix,
                    precedence
                );
            }
            break;

        case Syntax.FunctionExpression:
            result = 'function';

            if (expr.id) {
                result = [result + ' ',
                          generateIdentifier(expr.id),
                          generateFunctionBody(expr)];
            } else {
                result = [result + space, generateFunctionBody(expr)];
            }

            break;

        case Syntax.ArrayPattern:
        case Syntax.ArrayExpression:
            if (!expr.elements.length) {
                result = '[]';
                break;
            }
            multiline = expr.elements.length > 1;
            result = ['[', multiline ? newline : ''];
            withIndent(function (indent) {
                for (i = 0, len = expr.elements.length; i < len; i += 1) {
                    if (!expr.elements[i]) {
                        if (multiline) {
                            result.push(indent);
                        }
                        if (i + 1 === len) {
                            result.push(',');
                        }
                    } else {
                        result.push(multiline ? indent : '', generateExpression(expr.elements[i], {
                            precedence: Precedence.Assignment,
                            allowIn: true,
                            allowCall: true
                        }));
                    }
                    if (i + 1 < len) {
                        result.push(',' + (multiline ? newline : space));
                    }
                }
            });
            if (multiline && !endsWithLineTerminator(toSourceNode(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '', ']');
            break;

        case Syntax.Property:
            if (expr.kind === 'get' || expr.kind === 'set') {
                result = [
                    expr.kind + ' ',
                    generateExpression(expr.key, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    generateFunctionBody(expr.value)
                ];
            } else {
                if (expr.shorthand) {
                    result = generateExpression(expr.key, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    });
                } else if (expr.method) {
                    result = [];
                    if (expr.value.generator) {
                        result.push('*');
                    }
                    result.push(generateExpression(expr.key, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }), generateFunctionBody(expr.value));
                } else {
                    result = [
                        generateExpression(expr.key, {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        }),
                        ':' + space,
                        generateExpression(expr.value, {
                            precedence: Precedence.Assignment,
                            allowIn: true,
                            allowCall: true
                        })
                    ];
                }
            }
            break;

        case Syntax.ObjectExpression:
            if (!expr.properties.length) {
                result = '{}';
                break;
            }
            multiline = expr.properties.length > 1;

            withIndent(function () {
                fragment = generateExpression(expr.properties[0], {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true,
                    type: Syntax.Property
                });
            });

            if (!multiline) {
                // issues 4
                // Do not transform from
                //   dejavu.Class.declare({
                //       method2: function () {}
                //   });
                // to
                //   dejavu.Class.declare({method2: function () {
                //       }});
                if (!hasLineTerminator(toSourceNode(fragment).toString())) {
                    result = [ '{', space, fragment, space, '}' ];
                    break;
                }
            }

            withIndent(function (indent) {
                result = [ '{', newline, indent, fragment ];

                if (multiline) {
                    result.push(',' + newline);
                    for (i = 1, len = expr.properties.length; i < len; i += 1) {
                        result.push(indent, generateExpression(expr.properties[i], {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true,
                            type: Syntax.Property
                        }));
                        if (i + 1 < len) {
                            result.push(',' + newline);
                        }
                    }
                }
            });

            if (!endsWithLineTerminator(toSourceNode(result).toString())) {
                result.push(newline);
            }
            result.push(base, '}');
            break;

        case Syntax.ObjectPattern:
            if (!expr.properties.length) {
                result = '{}';
                break;
            }

            multiline = false;
            if (expr.properties.length === 1) {
                property = expr.properties[0];
                if (property.value.type !== Syntax.Identifier) {
                    multiline = true;
                }
            } else {
                for (i = 0, len = expr.properties.length; i < len; i += 1) {
                    property = expr.properties[i];
                    if (!property.shorthand) {
                        multiline = true;
                        break;
                    }
                }
            }
            result = ['{', multiline ? newline : '' ];

            withIndent(function (indent) {
                for (i = 0, len = expr.properties.length; i < len; i += 1) {
                    result.push(multiline ? indent : '', generateExpression(expr.properties[i], {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    if (i + 1 < len) {
                        result.push(',' + (multiline ? newline : space));
                    }
                }
            });

            if (multiline && !endsWithLineTerminator(toSourceNode(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '', '}');
            break;

        case Syntax.ThisExpression:
            result = 'this';
            break;

        case Syntax.Identifier:
            result = generateIdentifier(expr);
            break;

        case Syntax.Literal:
            if (expr.hasOwnProperty('raw') && parse) {
                try {
                    raw = parse(expr.raw).body[0].expression;
                    if (raw.type === Syntax.Literal) {
                        if (raw.value === expr.value) {
                            result = expr.raw;
                            break;
                        }
                    }
                } catch (e) {
                    // not use raw property
                }
            }

            if (expr.value === null) {
                result = 'null';
                break;
            }

            if (typeof expr.value === 'string') {
                result = escapeString(expr.value);
                break;
            }

            if (typeof expr.value === 'number') {
                result = generateNumber(expr.value);
                break;
            }

            if (typeof expr.value === 'boolean') {
                result = expr.value ? 'true' : 'false';
                break;
            }

            result = generateRegExp(expr.value);
            break;

        case Syntax.ComprehensionExpression:
            result = [
                '[',
                generateExpression(expr.body, {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                })
            ];

            if (expr.blocks) {
                for (i = 0, len = expr.blocks.length; i < len; i += 1) {
                    fragment = generateExpression(expr.blocks[i], {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    });
                    result = join(result, fragment);
                }
            }

            if (expr.filter) {
                result = join(result, 'if' + space);
                fragment = generateExpression(expr.filter, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                });
                if (extra.moz.parenthesizedComprehensionBlock) {
                    result = join(result, [ '(', fragment, ')' ]);
                } else {
                    result = join(result, fragment);
                }
            }
            result.push(']');
            break;

        case Syntax.ComprehensionBlock:
            if (expr.left.type === Syntax.VariableDeclaration) {
                fragment = [
                    expr.left.kind + ' ',
                    generateStatement(expr.left.declarations[0], {
                        allowIn: false
                    })
                ];
            } else {
                fragment = generateExpression(expr.left, {
                    precedence: Precedence.Call,
                    allowIn: true,
                    allowCall: true
                });
            }

            fragment = join(fragment, expr.of ? 'of' : 'in');
            fragment = join(fragment, generateExpression(expr.right, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            }));

            if (extra.moz.parenthesizedComprehensionBlock) {
                result = [ 'for' + space + '(', fragment, ')' ];
            } else {
                result = join('for' + space, fragment);
            }
            break;

        default:
            throw new Error('Unknown expression type: ' + expr.type);
        }

        return toSourceNode(result, expr);
    }

    function generateStatement(stmt, option) {
        var i, len, result, node, allowIn, functionBody, directiveContext, fragment, semicolon;

        allowIn = true;
        semicolon = ';';
        functionBody = false;
        directiveContext = false;
        if (option) {
            allowIn = option.allowIn === undefined || option.allowIn;
            if (!semicolons && option.semicolonOptional === true) {
                semicolon = '';
            }
            functionBody = option.functionBody;
            directiveContext = option.directiveContext;
        }

        switch (stmt.type) {
        case Syntax.BlockStatement:
            result = ['{', newline];

            withIndent(function () {
                for (i = 0, len = stmt.body.length; i < len; i += 1) {
                    fragment = addIndent(generateStatement(stmt.body[i], {
                        semicolonOptional: i === len - 1,
                        directiveContext: functionBody
                    }));
                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNode(fragment).toString())) {
                        result.push(newline);
                    }
                }
            });

            result.push(addIndent('}'));
            break;

        case Syntax.BreakStatement:
            if (stmt.label) {
                result = 'break ' + stmt.label.name + semicolon;
            } else {
                result = 'break' + semicolon;
            }
            break;

        case Syntax.ContinueStatement:
            if (stmt.label) {
                result = 'continue ' + stmt.label.name + semicolon;
            } else {
                result = 'continue' + semicolon;
            }
            break;

        case Syntax.DirectiveStatement:
            if (stmt.raw) {
                result = stmt.raw + semicolon;
            } else {
                result = escapeDirective(stmt.directive) + semicolon;
            }
            break;

        case Syntax.DoWhileStatement:
            // Because `do 42 while (cond)` is Syntax Error. We need semicolon.
            result = join('do', maybeBlock(stmt.body));
            result = maybeBlockSuffix(stmt.body, result);
            result = join(result, [
                'while' + space + '(',
                generateExpression(stmt.test, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                }),
                ')' + semicolon
            ]);
            break;

        case Syntax.CatchClause:
            withIndent(function () {
                result = [
                    'catch' + space + '(',
                    generateExpression(stmt.param, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            result.push(maybeBlock(stmt.body));
            break;

        case Syntax.DebuggerStatement:
            result = 'debugger' + semicolon;
            break;

        case Syntax.EmptyStatement:
            result = ';';
            break;

        case Syntax.ExpressionStatement:
            result = [generateExpression(stmt.expression, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            })];
            // 12.4 '{', 'function' is not allowed in this position.
            // wrap expression with parentheses
            fragment = toSourceNode(result).toString();
            if (fragment.charAt(0) === '{' || (fragment.slice(0, 8) === 'function' && ' ('.indexOf(fragment.charAt(8)) >= 0) || (directive && directiveContext && stmt.expression.type === Syntax.Literal && typeof stmt.expression.value === 'string')) {
                result = ['(', result, ')' + semicolon];
            } else {
                result.push(semicolon);
            }
            break;

        case Syntax.VariableDeclarator:
            if (stmt.init) {
                result = [
                    generateExpression(stmt.id, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space,
                    '=',
                    space,
                    generateExpression(stmt.init, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ];
            } else {
                result = generateIdentifier(stmt.id);
            }
            break;

        case Syntax.VariableDeclaration:
            result = [stmt.kind];
            // special path for
            // var x = function () {
            // };
            if (stmt.declarations.length === 1 && stmt.declarations[0].init &&
                    stmt.declarations[0].init.type === Syntax.FunctionExpression) {
                result.push(' ', generateStatement(stmt.declarations[0], {
                    allowIn: allowIn
                }));
            } else {
                // VariableDeclarator is typed as Statement,
                // but joined with comma (not LineTerminator).
                // So if comment is attached to target node, we should specialize.
                withIndent(function () {
                    node = stmt.declarations[0];
                    if (extra.comment && node.leadingComments) {
                        result.push('\n', addIndent(generateStatement(node, {
                            allowIn: allowIn
                        })));
                    } else {
                        result.push(' ', generateStatement(node, {
                            allowIn: allowIn
                        }));
                    }

                    for (i = 1, len = stmt.declarations.length; i < len; i += 1) {
                        node = stmt.declarations[i];
                        if (extra.comment && node.leadingComments) {
                            result.push(',' + newline, addIndent(generateStatement(node, {
                                allowIn: allowIn
                            })));
                        } else {
                            result.push(',' + space, generateStatement(node, {
                                allowIn: allowIn
                            }));
                        }
                    }
                });
            }
            result.push(semicolon);
            break;

        case Syntax.ThrowStatement:
            result = [join(
                'throw',
                generateExpression(stmt.argument, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                })
            ), semicolon];
            break;

        case Syntax.TryStatement:
            result = ['try', maybeBlock(stmt.block)];
            result = maybeBlockSuffix(stmt.block, result);
            if (stmt.handlers) {
                // old interface
                for (i = 0, len = stmt.handlers.length; i < len; i += 1) {
                    result = join(result, generateStatement(stmt.handlers[i]));
                    if (stmt.finalizer || i + 1 !== len) {
                        result = maybeBlockSuffix(stmt.handlers[i].body, result);
                    }
                }
            } else {
                // new interface
                if (stmt.handler) {
                    result = join(result, generateStatement(stmt.handler));
                    if (stmt.finalizer || stmt.guardedHandlers.length > 0) {
                        result = maybeBlockSuffix(stmt.handler.body, result);
                    }
                }

                for (i = 0, len = stmt.guardedHandlers.length; i < len; i += 1) {
                    result = join(result, generateStatement(stmt.guardedHandlers[i]));
                    if (stmt.finalizer || i + 1 !== len) {
                        result = maybeBlockSuffix(stmt.guardedHandlers[i].body, result);
                    }
                }
            }
            if (stmt.finalizer) {
                result = join(result, ['finally', maybeBlock(stmt.finalizer)]);
            }
            break;

        case Syntax.SwitchStatement:
            withIndent(function () {
                result = [
                    'switch' + space + '(',
                    generateExpression(stmt.discriminant, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')' + space + '{' + newline
                ];
            });
            if (stmt.cases) {
                for (i = 0, len = stmt.cases.length; i < len; i += 1) {
                    fragment = addIndent(generateStatement(stmt.cases[i], {semicolonOptional: i === len - 1}));
                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNode(fragment).toString())) {
                        result.push(newline);
                    }
                }
            }
            result.push(addIndent('}'));
            break;

        case Syntax.SwitchCase:
            withIndent(function () {
                if (stmt.test) {
                    result = [
                        join('case', generateExpression(stmt.test, {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        })),
                        ':'
                    ];
                } else {
                    result = ['default:'];
                }

                i = 0;
                len = stmt.consequent.length;
                if (len && stmt.consequent[0].type === Syntax.BlockStatement) {
                    fragment = maybeBlock(stmt.consequent[0]);
                    result.push(fragment);
                    i = 1;
                }

                if (i !== len && !endsWithLineTerminator(toSourceNode(result).toString())) {
                    result.push(newline);
                }

                for (; i < len; i += 1) {
                    fragment = addIndent(generateStatement(stmt.consequent[i], {semicolonOptional: i === len - 1 && semicolon === ''}));
                    result.push(fragment);
                    if (i + 1 !== len && !endsWithLineTerminator(toSourceNode(fragment).toString())) {
                        result.push(newline);
                    }
                }
            });
            break;

        case Syntax.IfStatement:
            withIndent(function () {
                result = [
                    'if' + space + '(',
                    generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            if (stmt.alternate) {
                result.push(maybeBlock(stmt.consequent));
                result = maybeBlockSuffix(stmt.consequent, result);
                if (stmt.alternate.type === Syntax.IfStatement) {
                    result = join(result, ['else ', generateStatement(stmt.alternate, {semicolonOptional: semicolon === ''})]);
                } else {
                    result = join(result, join('else', maybeBlock(stmt.alternate, semicolon === '')));
                }
            } else {
                result.push(maybeBlock(stmt.consequent, semicolon === ''));
            }
            break;

        case Syntax.ForStatement:
            withIndent(function () {
                result = ['for' + space + '('];
                if (stmt.init) {
                    if (stmt.init.type === Syntax.VariableDeclaration) {
                        result.push(generateStatement(stmt.init, {allowIn: false}));
                    } else {
                        result.push(generateExpression(stmt.init, {
                            precedence: Precedence.Sequence,
                            allowIn: false,
                            allowCall: true
                        }), ';');
                    }
                } else {
                    result.push(';');
                }

                if (stmt.test) {
                    result.push(space, generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }), ';');
                } else {
                    result.push(';');
                }

                if (stmt.update) {
                    result.push(space, generateExpression(stmt.update, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }), ')');
                } else {
                    result.push(')');
                }
            });

            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        case Syntax.ForInStatement:
            result = ['for' + space + '('];
            withIndent(function () {
                if (stmt.left.type === Syntax.VariableDeclaration) {
                    withIndent(function () {
                        result.push(stmt.left.kind + ' ', generateStatement(stmt.left.declarations[0], {
                            allowIn: false
                        }));
                    });
                } else {
                    result.push(generateExpression(stmt.left, {
                        precedence: Precedence.Call,
                        allowIn: true,
                        allowCall: true
                    }));
                }

                result = join(result, 'in');
                result = [join(
                    result,
                    generateExpression(stmt.right, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    })
                ), ')'];
            });
            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        case Syntax.LabeledStatement:
            result = [stmt.label.name + ':', maybeBlock(stmt.body, semicolon === '')];
            break;

        case Syntax.Program:
            len = stmt.body.length;
            result = [safeConcatenation && len > 0 ? '\n' : ''];
            for (i = 0; i < len; i += 1) {
                fragment = addIndent(
                    generateStatement(stmt.body[i], {
                        semicolonOptional: !safeConcatenation && i === len - 1,
                        directiveContext: true
                    })
                );
                result.push(fragment);
                if (i + 1 < len && !endsWithLineTerminator(toSourceNode(fragment).toString())) {
                    result.push(newline);
                }
            }
            break;

        case Syntax.FunctionDeclaration:
            result = [(stmt.generator && !extra.moz.starlessGenerator ? 'function* ' : 'function '),
                      generateIdentifier(stmt.id),
                      generateFunctionBody(stmt)];
            break;

        case Syntax.ReturnStatement:
            if (stmt.argument) {
                result = [join(
                    'return',
                    generateExpression(stmt.argument, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    })
                ), semicolon];
            } else {
                result = ['return' + semicolon];
            }
            break;

        case Syntax.WhileStatement:
            withIndent(function () {
                result = [
                    'while' + space + '(',
                    generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        case Syntax.WithStatement:
            withIndent(function () {
                result = [
                    'with' + space + '(',
                    generateExpression(stmt.object, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        default:
            throw new Error('Unknown statement type: ' + stmt.type);
        }

        // Attach comments

        if (extra.comment) {
            result = addCommentsToStatement(stmt, result);
        }

        fragment = toSourceNode(result).toString();
        if (stmt.type === Syntax.Program && !safeConcatenation && newline === '' &&  fragment.charAt(fragment.length - 1) === '\n') {
            result = toSourceNode(result).replaceRight(/\s+$/, '');
        }

        return toSourceNode(result, stmt);
    }

    function generate(node, options) {
        var defaultOptions = getDefaultOptions(), result, pair;

        if (options != null) {
            // Obsolete options
            //
            //   `options.indent`
            //   `options.base`
            //
            // Instead of them, we can use `option.format.indent`.
            if (typeof options.indent === 'string') {
                defaultOptions.format.indent.style = options.indent;
            }
            if (typeof options.base === 'number') {
                defaultOptions.format.indent.base = options.base;
            }
            options = updateDeeply(defaultOptions, options);
            indent = options.format.indent.style;
            if (typeof options.base === 'string') {
                base = options.base;
            } else {
                base = stringRepeat(indent, options.format.indent.base);
            }
        } else {
            options = defaultOptions;
            indent = options.format.indent.style;
            base = stringRepeat(indent, options.format.indent.base);
        }
        json = options.format.json;
        renumber = options.format.renumber;
        hexadecimal = json ? false : options.format.hexadecimal;
        quotes = json ? 'double' : options.format.quotes;
        escapeless = options.format.escapeless;
        if (options.format.compact) {
            newline = space = indent = base = '';
        } else {
            newline = '\n';
            space = ' ';
        }
        parentheses = options.format.parentheses;
        semicolons = options.format.semicolons;
        safeConcatenation = options.format.safeConcatenation;
        directive = options.directive;
        parse = json ? null : options.parse;
        sourceMap = options.sourceMap;
        extra = options;

        if (sourceMap) {
            if (!exports.browser) {
                // We assume environment is node.js
                // And prevent from including source-map by browserify
                SourceNode = require('source-map').SourceNode;
            } else {
                SourceNode = global.sourceMap.SourceNode;
            }
        } else {
            SourceNode = SourceNodeMock;
        }

        switch (node.type) {
        case Syntax.BlockStatement:
        case Syntax.BreakStatement:
        case Syntax.CatchClause:
        case Syntax.ContinueStatement:
        case Syntax.DirectiveStatement:
        case Syntax.DoWhileStatement:
        case Syntax.DebuggerStatement:
        case Syntax.EmptyStatement:
        case Syntax.ExpressionStatement:
        case Syntax.ForStatement:
        case Syntax.ForInStatement:
        case Syntax.FunctionDeclaration:
        case Syntax.IfStatement:
        case Syntax.LabeledStatement:
        case Syntax.Program:
        case Syntax.ReturnStatement:
        case Syntax.SwitchStatement:
        case Syntax.SwitchCase:
        case Syntax.ThrowStatement:
        case Syntax.TryStatement:
        case Syntax.VariableDeclaration:
        case Syntax.VariableDeclarator:
        case Syntax.WhileStatement:
        case Syntax.WithStatement:
            result = generateStatement(node);
            break;

        case Syntax.AssignmentExpression:
        case Syntax.ArrayExpression:
        case Syntax.ArrayPattern:
        case Syntax.BinaryExpression:
        case Syntax.CallExpression:
        case Syntax.ConditionalExpression:
        case Syntax.FunctionExpression:
        case Syntax.Identifier:
        case Syntax.Literal:
        case Syntax.LogicalExpression:
        case Syntax.MemberExpression:
        case Syntax.NewExpression:
        case Syntax.ObjectExpression:
        case Syntax.ObjectPattern:
        case Syntax.Property:
        case Syntax.SequenceExpression:
        case Syntax.ThisExpression:
        case Syntax.UnaryExpression:
        case Syntax.UpdateExpression:
        case Syntax.YieldExpression:

            result = generateExpression(node, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            });
            break;

        default:
            throw new Error('Unknown node type: ' + node.type);
        }

        if (!sourceMap) {
            return result.toString();
        }

        pair = result.toStringWithSourceMap({
            file: options.file,
            sourceRoot: options.sourceMapRoot
        });

        if (options.sourceMapWithCode) {
            return pair;
        }
        return pair.map.toString();
    }

    // simple visitor implementation

    VisitorKeys = {
        AssignmentExpression: ['left', 'right'],
        ArrayExpression: ['elements'],
        ArrayPattern: ['elements'],
        BlockStatement: ['body'],
        BinaryExpression: ['left', 'right'],
        BreakStatement: ['label'],
        CallExpression: ['callee', 'arguments'],
        CatchClause: ['param', 'body'],
        ConditionalExpression: ['test', 'consequent', 'alternate'],
        ContinueStatement: ['label'],
        DirectiveStatement: [],
        DoWhileStatement: ['body', 'test'],
        DebuggerStatement: [],
        EmptyStatement: [],
        ExpressionStatement: ['expression'],
        ForStatement: ['init', 'test', 'update', 'body'],
        ForInStatement: ['left', 'right', 'body'],
        FunctionDeclaration: ['id', 'params', 'body'],
        FunctionExpression: ['id', 'params', 'body'],
        Identifier: [],
        IfStatement: ['test', 'consequent', 'alternate'],
        Literal: [],
        LabeledStatement: ['label', 'body'],
        LogicalExpression: ['left', 'right'],
        MemberExpression: ['object', 'property'],
        NewExpression: ['callee', 'arguments'],
        ObjectExpression: ['properties'],
        ObjectPattern: ['properties'],
        Program: ['body'],
        Property: ['key', 'value'],
        ReturnStatement: ['argument'],
        SequenceExpression: ['expressions'],
        SwitchStatement: ['discriminant', 'cases'],
        SwitchCase: ['test', 'consequent'],
        ThisExpression: [],
        ThrowStatement: ['argument'],
        TryStatement: ['block', 'handlers', 'finalizer'],
        UnaryExpression: ['argument'],
        UpdateExpression: ['argument'],
        VariableDeclaration: ['declarations'],
        VariableDeclarator: ['id', 'init'],
        WhileStatement: ['test', 'body'],
        WithStatement: ['object', 'body'],
        YieldExpression: ['argument']
    };

    VisitorOption = {
        Break: 1,
        Skip: 2
    };

    // based on LLVM libc++ upper_bound / lower_bound
    // MIT License

    function upperBound(array, func) {
        var diff, len, i, current;

        len = array.length;
        i = 0;

        while (len) {
            diff = len >>> 1;
            current = i + diff;
            if (func(array[current])) {
                len = diff;
            } else {
                i = current + 1;
                len -= diff + 1;
            }
        }
        return i;
    }

    function lowerBound(array, func) {
        var diff, len, i, current;

        len = array.length;
        i = 0;

        while (len) {
            diff = len >>> 1;
            current = i + diff;
            if (func(array[current])) {
                i = current + 1;
                len -= diff + 1;
            } else {
                len = diff;
            }
        }
        return i;
    }
    ignoreJSHintError(lowerBound);

    function extendCommentRange(comment, tokens) {
        var target, token;

        target = upperBound(tokens, function search(token) {
            return token.range[0] > comment.range[0];
        });

        comment.extendedRange = [comment.range[0], comment.range[1]];

        if (target !== tokens.length) {
            comment.extendedRange[1] = tokens[target].range[0];
        }

        target -= 1;
        if (target >= 0) {
            if (target < tokens.length) {
                comment.extendedRange[0] = tokens[target].range[1];
            } else if (token.length) {
                comment.extendedRange[1] = tokens[tokens.length - 1].range[0];
            }
        }

        return comment;
    }

    function attachComments(tree, providedComments, tokens) {
        // At first, we should calculate extended comment ranges.
        var comments = [], comment, len, i;

        if (!tree.range) {
            throw new Error('attachComments needs range information');
        }

        // tokens array is empty, we attach comments to tree as 'leadingComments'
        if (!tokens.length) {
            if (providedComments.length) {
                for (i = 0, len = providedComments.length; i < len; i += 1) {
                    comment = deepCopy(providedComments[i]);
                    comment.extendedRange = [0, tree.range[0]];
                    comments.push(comment);
                }
                tree.leadingComments = comments;
            }
            return tree;
        }

        for (i = 0, len = providedComments.length; i < len; i += 1) {
            comments.push(extendCommentRange(deepCopy(providedComments[i]), tokens));
        }

        // This is based on John Freeman's implementation.
        traverse(tree, {
            cursor: 0,
            enter: function (node) {
                var comment;

                while (this.cursor < comments.length) {
                    comment = comments[this.cursor];
                    if (comment.extendedRange[1] > node.range[0]) {
                        break;
                    }

                    if (comment.extendedRange[1] === node.range[0]) {
                        if (!node.leadingComments) {
                            node.leadingComments = [];
                        }
                        node.leadingComments.push(comment);
                        comments.splice(this.cursor, 1);
                    } else {
                        this.cursor += 1;
                    }
                }

                // already out of owned node
                if (this.cursor === comments.length) {
                    return VisitorOption.Break;
                }

                if (comments[this.cursor].extendedRange[0] > node.range[1]) {
                    return VisitorOption.Skip;
                }
            }
        });

        traverse(tree, {
            cursor: 0,
            leave: function (node) {
                var comment;

                while (this.cursor < comments.length) {
                    comment = comments[this.cursor];
                    if (node.range[1] < comment.extendedRange[0]) {
                        break;
                    }

                    if (node.range[1] === comment.extendedRange[0]) {
                        if (!node.trailingComments) {
                            node.trailingComments = [];
                        }
                        node.trailingComments.push(comment);
                        comments.splice(this.cursor, 1);
                    } else {
                        this.cursor += 1;
                    }
                }

                // already out of owned node
                if (this.cursor === comments.length) {
                    return VisitorOption.Break;
                }

                if (comments[this.cursor].extendedRange[0] > node.range[1]) {
                    return VisitorOption.Skip;
                }
            }
        });

        return tree;
    }

    FORMAT_MINIFY = {
        indent: {
            style: '',
            base: 0
        },
        renumber: true,
        hexadecimal: true,
        quotes: 'auto',
        escapeless: true,
        compact: true,
        parentheses: false,
        semicolons: false
    };

    FORMAT_DEFAULTS = getDefaultOptions().format;

    exports.version = require('./package.json').version;
    exports.generate = generate;
    exports.attachComments = attachComments;
    exports.browser = false;
    exports.FORMAT_MINIFY = FORMAT_MINIFY;
    exports.FORMAT_DEFAULTS = FORMAT_DEFAULTS;
}());
/* vim: set sw=4 ts=4 et tw=80 : */

})(self)
},{"./package.json":18,"estraverse":7,"source-map":8}],7:[function(require,module,exports){
(function(){/*
  Copyright (C) 2012 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*jslint bitwise:true */
/*global exports:true, define:true, window:true */
(function (factory) {
    'use strict';

    // Universal Module Definition (UMD) to support AMD, CommonJS/Node.js,
    // and plain browser loading,
    if (typeof define === 'function' && define.amd) {
        define(['exports'], factory);
    } else if (typeof exports !== 'undefined') {
        factory(exports);
    } else {
        factory((window.estraverse = {}));
    }
}(function (exports) {
    'use strict';

    var Syntax,
        isArray,
        VisitorOption,
        VisitorKeys,
        wrappers;

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DebuggerStatement: 'DebuggerStatement',
        DirectiveStatement: 'DirectiveStatement',
        DoWhileStatement: 'DoWhileStatement',
        EmptyStatement: 'EmptyStatement',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement'
    };

    isArray = Array.isArray;
    if (!isArray) {
        isArray = function isArray(array) {
            return Object.prototype.toString.call(array) === '[object Array]';
        };
    }

    VisitorKeys = {
        AssignmentExpression: ['left', 'right'],
        ArrayExpression: ['elements'],
        BlockStatement: ['body'],
        BinaryExpression: ['left', 'right'],
        BreakStatement: ['label'],
        CallExpression: ['callee', 'arguments'],
        CatchClause: ['param', 'body'],
        ConditionalExpression: ['test', 'consequent', 'alternate'],
        ContinueStatement: ['label'],
        DebuggerStatement: [],
        DirectiveStatement: [],
        DoWhileStatement: ['body', 'test'],
        EmptyStatement: [],
        ExpressionStatement: ['expression'],
        ForStatement: ['init', 'test', 'update', 'body'],
        ForInStatement: ['left', 'right', 'body'],
        FunctionDeclaration: ['id', 'params', 'body'],
        FunctionExpression: ['id', 'params', 'body'],
        Identifier: [],
        IfStatement: ['test', 'consequent', 'alternate'],
        Literal: [],
        LabeledStatement: ['label', 'body'],
        LogicalExpression: ['left', 'right'],
        MemberExpression: ['object', 'property'],
        NewExpression: ['callee', 'arguments'],
        ObjectExpression: ['properties'],
        Program: ['body'],
        Property: ['key', 'value'],
        ReturnStatement: ['argument'],
        SequenceExpression: ['expressions'],
        SwitchStatement: ['discriminant', 'cases'],
        SwitchCase: ['test', 'consequent'],
        ThisExpression: [],
        ThrowStatement: ['argument'],
        TryStatement: ['block', 'handlers', 'finalizer'],
        UnaryExpression: ['argument'],
        UpdateExpression: ['argument'],
        VariableDeclaration: ['declarations'],
        VariableDeclarator: ['id', 'init'],
        WhileStatement: ['test', 'body'],
        WithStatement: ['object', 'body']
    };

    VisitorOption = {
        Break: 1,
        Skip: 2
    };

    wrappers = {
        PropertyWrapper: 'Property'
    };

    function traverse(top, visitor) {
        var worklist, leavelist, node, nodeType, ret, current, current2, candidates, candidate, marker = {};

        worklist = [ top ];
        leavelist = [ null ];

        while (worklist.length) {
            node = worklist.pop();
            nodeType = node.type;

            if (node === marker) {
                node = leavelist.pop();
                if (visitor.leave) {
                    ret = visitor.leave(node, leavelist[leavelist.length - 1]);
                } else {
                    ret = undefined;
                }
                if (ret === VisitorOption.Break) {
                    return;
                }
            } else if (node) {
                if (wrappers.hasOwnProperty(nodeType)) {
                    node = node.node;
                    nodeType = wrappers[nodeType];
                }

                if (visitor.enter) {
                    ret = visitor.enter(node, leavelist[leavelist.length - 1]);
                } else {
                    ret = undefined;
                }

                if (ret === VisitorOption.Break) {
                    return;
                }

                worklist.push(marker);
                leavelist.push(node);

                if (ret !== VisitorOption.Skip) {
                    candidates = VisitorKeys[nodeType];
                    current = candidates.length;
                    while ((current -= 1) >= 0) {
                        candidate = node[candidates[current]];
                        if (candidate) {
                            if (isArray(candidate)) {
                                current2 = candidate.length;
                                while ((current2 -= 1) >= 0) {
                                    if (candidate[current2]) {
                                        if(nodeType === Syntax.ObjectExpression && 'properties' === candidates[current] && null == candidates[current].type) {
                                            worklist.push({type: 'PropertyWrapper', node: candidate[current2]});
                                        } else {
                                            worklist.push(candidate[current2]);
                                        }
                                    }
                                }
                            } else {
                                worklist.push(candidate);
                            }
                        }
                    }
                }
            }
        }
    }

    function replace(top, visitor) {
        var worklist, leavelist, node, nodeType, target, tuple, ret, current, current2, candidates, candidate, marker = {}, result;

        result = {
            top: top
        };

        tuple = [ top, result, 'top' ];
        worklist = [ tuple ];
        leavelist = [ tuple ];

        function notify(v) {
            ret = v;
        }

        while (worklist.length) {
            tuple = worklist.pop();

            if (tuple === marker) {
                tuple = leavelist.pop();
                ret = undefined;
                if (visitor.leave) {
                    node = tuple[0];
                    target = visitor.leave(tuple[0], leavelist[leavelist.length - 1][0], notify);
                    if (target !== undefined) {
                        node = target;
                    }
                    tuple[1][tuple[2]] = node;
                }
                if (ret === VisitorOption.Break) {
                    return result.top;
                }
            } else if (tuple[0]) {
                ret = undefined;
                node = tuple[0];

                nodeType = node.type;
                if (wrappers.hasOwnProperty(nodeType)) {
                    tuple[0] = node = node.node;
                    nodeType = wrappers[nodeType];
                }

                if (visitor.enter) {
                    target = visitor.enter(tuple[0], leavelist[leavelist.length - 1][0], notify);
                    if (target !== undefined) {
                        node = target;
                    }
                    tuple[1][tuple[2]] = node;
                    tuple[0] = node;
                }

                if (ret === VisitorOption.Break) {
                    return result.top;
                }

                if (tuple[0]) {
                    worklist.push(marker);
                    leavelist.push(tuple);

                    if (ret !== VisitorOption.Skip) {
                        candidates = VisitorKeys[nodeType];
                        current = candidates.length;
                        while ((current -= 1) >= 0) {
                            candidate = node[candidates[current]];
                            if (candidate) {
                                if (isArray(candidate)) {
                                    current2 = candidate.length;
                                    while ((current2 -= 1) >= 0) {
                                        if (candidate[current2]) {
                                            if(nodeType === Syntax.ObjectExpression && 'properties' === candidates[current] && null == candidates[current].type) {
                                                worklist.push([{type: 'PropertyWrapper', node: candidate[current2]}, candidate, current2]);
                                            } else {
                                                worklist.push([candidate[current2], candidate, current2]);
                                            }
                                        }
                                    }
                                } else {
                                    worklist.push([candidate, node, candidates[current]]);
                                }
                            }
                        }
                    }
                }
            }
        }

        return result.top;
    }

    exports.version = '0.0.4';
    exports.Syntax = Syntax;
    exports.traverse = traverse;
    exports.replace = replace;
    exports.VisitorKeys = VisitorKeys;
    exports.VisitorOption = VisitorOption;
}));
/* vim: set sw=4 ts=4 et tw=80 : */

})()
},{}],8:[function(require,module,exports){
/*
 * Copyright 2009-2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE.txt or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
exports.SourceMapGenerator = require('./source-map/source-map-generator').SourceMapGenerator;
exports.SourceMapConsumer = require('./source-map/source-map-consumer').SourceMapConsumer;
exports.SourceNode = require('./source-map/source-node').SourceNode;

},{"./source-map/source-map-consumer":13,"./source-map/source-map-generator":14,"./source-map/source-node":15}],9:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var util = require('./util');

  /**
   * A data structure which is a combination of an array and a set. Adding a new
   * member is O(1), testing for membership is O(1), and finding the index of an
   * element is O(1). Removing elements from the set is not supported. Only
   * strings are supported for membership.
   */
  function ArraySet() {
    this._array = [];
    this._set = {};
  }

  /**
   * Static method for creating ArraySet instances from an existing array.
   */
  ArraySet.fromArray = function ArraySet_fromArray(aArray) {
    var set = new ArraySet();
    for (var i = 0, len = aArray.length; i < len; i++) {
      set.add(aArray[i]);
    }
    return set;
  };

  /**
   * Add the given string to this set.
   *
   * @param String aStr
   */
  ArraySet.prototype.add = function ArraySet_add(aStr) {
    if (this.has(aStr)) {
      // Already a member; nothing to do.
      return;
    }
    var idx = this._array.length;
    this._array.push(aStr);
    this._set[util.toSetString(aStr)] = idx;
  };

  /**
   * Is the given string a member of this set?
   *
   * @param String aStr
   */
  ArraySet.prototype.has = function ArraySet_has(aStr) {
    return Object.prototype.hasOwnProperty.call(this._set,
                                                util.toSetString(aStr));
  };

  /**
   * What is the index of the given string in the array?
   *
   * @param String aStr
   */
  ArraySet.prototype.indexOf = function ArraySet_indexOf(aStr) {
    if (this.has(aStr)) {
      return this._set[util.toSetString(aStr)];
    }
    throw new Error('"' + aStr + '" is not in the set.');
  };

  /**
   * What is the element at the given index?
   *
   * @param Number aIdx
   */
  ArraySet.prototype.at = function ArraySet_at(aIdx) {
    if (aIdx >= 0 && aIdx < this._array.length) {
      return this._array[aIdx];
    }
    throw new Error('No element indexed by ' + aIdx);
  };

  /**
   * Returns the array representation of this set (which has the proper indices
   * indicated by indexOf). Note that this is a copy of the internal array used
   * for storing the members so that no one can mess with internal state.
   */
  ArraySet.prototype.toArray = function ArraySet_toArray() {
    return this._array.slice();
  };

  exports.ArraySet = ArraySet;

});

},{"./util":16,"amdefine":17}],10:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 *
 * Based on the Base 64 VLQ implementation in Closure Compiler:
 * https://code.google.com/p/closure-compiler/source/browse/trunk/src/com/google/debugging/sourcemap/Base64VLQ.java
 *
 * Copyright 2011 The Closure Compiler Authors. All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *  * Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above
 *    copyright notice, this list of conditions and the following
 *    disclaimer in the documentation and/or other materials provided
 *    with the distribution.
 *  * Neither the name of Google Inc. nor the names of its
 *    contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var base64 = require('./base64');

  // A single base 64 digit can contain 6 bits of data. For the base 64 variable
  // length quantities we use in the source map spec, the first bit is the sign,
  // the next four bits are the actual value, and the 6th bit is the
  // continuation bit. The continuation bit tells us whether there are more
  // digits in this value following this digit.
  //
  //   Continuation
  //   |    Sign
  //   |    |
  //   V    V
  //   101011

  var VLQ_BASE_SHIFT = 5;

  // binary: 100000
  var VLQ_BASE = 1 << VLQ_BASE_SHIFT;

  // binary: 011111
  var VLQ_BASE_MASK = VLQ_BASE - 1;

  // binary: 100000
  var VLQ_CONTINUATION_BIT = VLQ_BASE;

  /**
   * Converts from a two-complement value to a value where the sign bit is
   * is placed in the least significant bit.  For example, as decimals:
   *   1 becomes 2 (10 binary), -1 becomes 3 (11 binary)
   *   2 becomes 4 (100 binary), -2 becomes 5 (101 binary)
   */
  function toVLQSigned(aValue) {
    return aValue < 0
      ? ((-aValue) << 1) + 1
      : (aValue << 1) + 0;
  }

  /**
   * Converts to a two-complement value from a value where the sign bit is
   * is placed in the least significant bit.  For example, as decimals:
   *   2 (10 binary) becomes 1, 3 (11 binary) becomes -1
   *   4 (100 binary) becomes 2, 5 (101 binary) becomes -2
   */
  function fromVLQSigned(aValue) {
    var isNegative = (aValue & 1) === 1;
    var shifted = aValue >> 1;
    return isNegative
      ? -shifted
      : shifted;
  }

  /**
   * Returns the base 64 VLQ encoded value.
   */
  exports.encode = function base64VLQ_encode(aValue) {
    var encoded = "";
    var digit;

    var vlq = toVLQSigned(aValue);

    do {
      digit = vlq & VLQ_BASE_MASK;
      vlq >>>= VLQ_BASE_SHIFT;
      if (vlq > 0) {
        // There are still more digits in this value, so we must make sure the
        // continuation bit is marked.
        digit |= VLQ_CONTINUATION_BIT;
      }
      encoded += base64.encode(digit);
    } while (vlq > 0);

    return encoded;
  };

  /**
   * Decodes the next base 64 VLQ value from the given string and returns the
   * value and the rest of the string.
   */
  exports.decode = function base64VLQ_decode(aStr) {
    var i = 0;
    var strLen = aStr.length;
    var result = 0;
    var shift = 0;
    var continuation, digit;

    do {
      if (i >= strLen) {
        throw new Error("Expected more digits in base 64 VLQ value.");
      }
      digit = base64.decode(aStr.charAt(i++));
      continuation = !!(digit & VLQ_CONTINUATION_BIT);
      digit &= VLQ_BASE_MASK;
      result = result + (digit << shift);
      shift += VLQ_BASE_SHIFT;
    } while (continuation);

    return {
      value: fromVLQSigned(result),
      rest: aStr.slice(i)
    };
  };

});

},{"./base64":11,"amdefine":17}],11:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var charToIntMap = {};
  var intToCharMap = {};

  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    .split('')
    .forEach(function (ch, index) {
      charToIntMap[ch] = index;
      intToCharMap[index] = ch;
    });

  /**
   * Encode an integer in the range of 0 to 63 to a single base 64 digit.
   */
  exports.encode = function base64_encode(aNumber) {
    if (aNumber in intToCharMap) {
      return intToCharMap[aNumber];
    }
    throw new TypeError("Must be between 0 and 63: " + aNumber);
  };

  /**
   * Decode a single base 64 digit to an integer.
   */
  exports.decode = function base64_decode(aChar) {
    if (aChar in charToIntMap) {
      return charToIntMap[aChar];
    }
    throw new TypeError("Not a valid base 64 digit: " + aChar);
  };

});

},{"amdefine":17}],12:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  /**
   * Recursive implementation of binary search.
   *
   * @param aLow Indices here and lower do not contain the needle.
   * @param aHigh Indices here and higher do not contain the needle.
   * @param aNeedle The element being searched for.
   * @param aHaystack The non-empty array being searched.
   * @param aCompare Function which takes two elements and returns -1, 0, or 1.
   */
  function recursiveSearch(aLow, aHigh, aNeedle, aHaystack, aCompare) {
    // This function terminates when one of the following is true:
    //
    //   1. We find the exact element we are looking for.
    //
    //   2. We did not find the exact element, but we can return the next
    //      closest element that is less than that element.
    //
    //   3. We did not find the exact element, and there is no next-closest
    //      element which is less than the one we are searching for, so we
    //      return null.
    var mid = Math.floor((aHigh - aLow) / 2) + aLow;
    var cmp = aCompare(aNeedle, aHaystack[mid]);
    if (cmp === 0) {
      // Found the element we are looking for.
      return aHaystack[mid];
    }
    else if (cmp > 0) {
      // aHaystack[mid] is greater than our needle.
      if (aHigh - mid > 1) {
        // The element is in the upper half.
        return recursiveSearch(mid, aHigh, aNeedle, aHaystack, aCompare);
      }
      // We did not find an exact match, return the next closest one
      // (termination case 2).
      return aHaystack[mid];
    }
    else {
      // aHaystack[mid] is less than our needle.
      if (mid - aLow > 1) {
        // The element is in the lower half.
        return recursiveSearch(aLow, mid, aNeedle, aHaystack, aCompare);
      }
      // The exact needle element was not found in this haystack. Determine if
      // we are in termination case (2) or (3) and return the appropriate thing.
      return aLow < 0
        ? null
        : aHaystack[aLow];
    }
  }

  /**
   * This is an implementation of binary search which will always try and return
   * the next lowest value checked if there is no exact hit. This is because
   * mappings between original and generated line/col pairs are single points,
   * and there is an implicit region between each of them, so a miss just means
   * that you aren't on the very start of a region.
   *
   * @param aNeedle The element you are looking for.
   * @param aHaystack The array that is being searched.
   * @param aCompare A function which takes the needle and an element in the
   *     array and returns -1, 0, or 1 depending on whether the needle is less
   *     than, equal to, or greater than the element, respectively.
   */
  exports.search = function search(aNeedle, aHaystack, aCompare) {
    return aHaystack.length > 0
      ? recursiveSearch(-1, aHaystack.length, aNeedle, aHaystack, aCompare)
      : null;
  };

});

},{"amdefine":17}],13:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var util = require('./util');
  var binarySearch = require('./binary-search');
  var ArraySet = require('./array-set').ArraySet;
  var base64VLQ = require('./base64-vlq');

  /**
   * A SourceMapConsumer instance represents a parsed source map which we can
   * query for information about the original file positions by giving it a file
   * position in the generated source.
   *
   * The only parameter is the raw source map (either as a JSON string, or
   * already parsed to an object). According to the spec, source maps have the
   * following attributes:
   *
   *   - version: Which version of the source map spec this map is following.
   *   - sources: An array of URLs to the original source files.
   *   - names: An array of identifiers which can be referrenced by individual mappings.
   *   - sourceRoot: Optional. The URL root from which all sources are relative.
   *   - sourcesContent: Optional. An array of contents of the original source files.
   *   - mappings: A string of base64 VLQs which contain the actual mappings.
   *   - file: The generated file this source map is associated with.
   *
   * Here is an example source map, taken from the source map spec[0]:
   *
   *     {
   *       version : 3,
   *       file: "out.js",
   *       sourceRoot : "",
   *       sources: ["foo.js", "bar.js"],
   *       names: ["src", "maps", "are", "fun"],
   *       mappings: "AA,AB;;ABCDE;"
   *     }
   *
   * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit?pli=1#
   */
  function SourceMapConsumer(aSourceMap) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
    }

    var version = util.getArg(sourceMap, 'version');
    var sources = util.getArg(sourceMap, 'sources');
    var names = util.getArg(sourceMap, 'names');
    var sourceRoot = util.getArg(sourceMap, 'sourceRoot', null);
    var sourcesContent = util.getArg(sourceMap, 'sourcesContent', null);
    var mappings = util.getArg(sourceMap, 'mappings');
    var file = util.getArg(sourceMap, 'file');

    if (version !== this._version) {
      throw new Error('Unsupported version: ' + version);
    }

    this._names = ArraySet.fromArray(names);
    this._sources = ArraySet.fromArray(sources);
    this.sourceRoot = sourceRoot;
    this.sourcesContent = sourcesContent;
    this.file = file;

    // `this._generatedMappings` and `this._originalMappings` hold the parsed
    // mapping coordinates from the source map's "mappings" attribute. Each
    // object in the array is of the form
    //
    //     {
    //       generatedLine: The line number in the generated code,
    //       generatedColumn: The column number in the generated code,
    //       source: The path to the original source file that generated this
    //               chunk of code,
    //       originalLine: The line number in the original source that
    //                     corresponds to this chunk of generated code,
    //       originalColumn: The column number in the original source that
    //                       corresponds to this chunk of generated code,
    //       name: The name of the original symbol which generated this chunk of
    //             code.
    //     }
    //
    // All properties except for `generatedLine` and `generatedColumn` can be
    // `null`.
    //
    // `this._generatedMappings` is ordered by the generated positions.
    //
    // `this._originalMappings` is ordered by the original positions.
    this._generatedMappings = [];
    this._originalMappings = [];
    this._parseMappings(mappings, sourceRoot);
  }

  /**
   * The version of the source mapping spec that we are consuming.
   */
  SourceMapConsumer.prototype._version = 3;

  /**
   * The list of original sources.
   */
  Object.defineProperty(SourceMapConsumer.prototype, 'sources', {
    get: function () {
      return this._sources.toArray().map(function (s) {
        return this.sourceRoot ? util.join(this.sourceRoot, s) : s;
      }, this);
    }
  });

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (an ordered list in this._generatedMappings).
   */
  SourceMapConsumer.prototype._parseMappings =
    function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
      var generatedLine = 1;
      var previousGeneratedColumn = 0;
      var previousOriginalLine = 0;
      var previousOriginalColumn = 0;
      var previousSource = 0;
      var previousName = 0;
      var mappingSeparator = /^[,;]/;
      var str = aStr;
      var mapping;
      var temp;

      while (str.length > 0) {
        if (str.charAt(0) === ';') {
          generatedLine++;
          str = str.slice(1);
          previousGeneratedColumn = 0;
        }
        else if (str.charAt(0) === ',') {
          str = str.slice(1);
        }
        else {
          mapping = {};
          mapping.generatedLine = generatedLine;

          // Generated column.
          temp = base64VLQ.decode(str);
          mapping.generatedColumn = previousGeneratedColumn + temp.value;
          previousGeneratedColumn = mapping.generatedColumn;
          str = temp.rest;

          if (str.length > 0 && !mappingSeparator.test(str.charAt(0))) {
            // Original source.
            temp = base64VLQ.decode(str);
            mapping.source = this._sources.at(previousSource + temp.value);
            previousSource += temp.value;
            str = temp.rest;
            if (str.length === 0 || mappingSeparator.test(str.charAt(0))) {
              throw new Error('Found a source, but no line and column');
            }

            // Original line.
            temp = base64VLQ.decode(str);
            mapping.originalLine = previousOriginalLine + temp.value;
            previousOriginalLine = mapping.originalLine;
            // Lines are stored 0-based
            mapping.originalLine += 1;
            str = temp.rest;
            if (str.length === 0 || mappingSeparator.test(str.charAt(0))) {
              throw new Error('Found a source and line, but no column');
            }

            // Original column.
            temp = base64VLQ.decode(str);
            mapping.originalColumn = previousOriginalColumn + temp.value;
            previousOriginalColumn = mapping.originalColumn;
            str = temp.rest;

            if (str.length > 0 && !mappingSeparator.test(str.charAt(0))) {
              // Original name.
              temp = base64VLQ.decode(str);
              mapping.name = this._names.at(previousName + temp.value);
              previousName += temp.value;
              str = temp.rest;
            }
          }

          this._generatedMappings.push(mapping);
          if (typeof mapping.originalLine === 'number') {
            this._originalMappings.push(mapping);
          }
        }
      }

      this._originalMappings.sort(this._compareOriginalPositions);
    };

  /**
   * Comparator between two mappings where the original positions are compared.
   */
  SourceMapConsumer.prototype._compareOriginalPositions =
    function SourceMapConsumer_compareOriginalPositions(mappingA, mappingB) {
      if (mappingA.source > mappingB.source) {
        return 1;
      }
      else if (mappingA.source < mappingB.source) {
        return -1;
      }
      else {
        var cmp = mappingA.originalLine - mappingB.originalLine;
        return cmp === 0
          ? mappingA.originalColumn - mappingB.originalColumn
          : cmp;
      }
    };

  /**
   * Comparator between two mappings where the generated positions are compared.
   */
  SourceMapConsumer.prototype._compareGeneratedPositions =
    function SourceMapConsumer_compareGeneratedPositions(mappingA, mappingB) {
      var cmp = mappingA.generatedLine - mappingB.generatedLine;
      return cmp === 0
        ? mappingA.generatedColumn - mappingB.generatedColumn
        : cmp;
    };

  /**
   * Find the mapping that best matches the hypothetical "needle" mapping that
   * we are searching for in the given "haystack" of mappings.
   */
  SourceMapConsumer.prototype._findMapping =
    function SourceMapConsumer_findMapping(aNeedle, aMappings, aLineName,
                                           aColumnName, aComparator) {
      // To return the position we are searching for, we must first find the
      // mapping for the given position and then return the opposite position it
      // points to. Because the mappings are sorted, we can use binary search to
      // find the best mapping.

      if (aNeedle[aLineName] <= 0) {
        throw new TypeError('Line must be greater than or equal to 1, got '
                            + aNeedle[aLineName]);
      }
      if (aNeedle[aColumnName] < 0) {
        throw new TypeError('Column must be greater than or equal to 0, got '
                            + aNeedle[aColumnName]);
      }

      return binarySearch.search(aNeedle, aMappings, aComparator);
    };

  /**
   * Returns the original source, line, and column information for the generated
   * source's line and column positions provided. The only argument is an object
   * with the following properties:
   *
   *   - line: The line number in the generated source.
   *   - column: The column number in the generated source.
   *
   * and an object is returned with the following properties:
   *
   *   - source: The original source file, or null.
   *   - line: The line number in the original source, or null.
   *   - column: The column number in the original source, or null.
   *   - name: The original identifier, or null.
   */
  SourceMapConsumer.prototype.originalPositionFor =
    function SourceMapConsumer_originalPositionFor(aArgs) {
      var needle = {
        generatedLine: util.getArg(aArgs, 'line'),
        generatedColumn: util.getArg(aArgs, 'column')
      };

      var mapping = this._findMapping(needle,
                                      this._generatedMappings,
                                      "generatedLine",
                                      "generatedColumn",
                                      this._compareGeneratedPositions);

      if (mapping) {
        var source = util.getArg(mapping, 'source', null);
        if (source && this.sourceRoot) {
          source = util.join(this.sourceRoot, source);
        }
        return {
          source: source,
          line: util.getArg(mapping, 'originalLine', null),
          column: util.getArg(mapping, 'originalColumn', null),
          name: util.getArg(mapping, 'name', null)
        };
      }

      return {
        source: null,
        line: null,
        column: null,
        name: null
      };
    };

  /**
   * Returns the original source content. The only argument is the url of the
   * original source file. Returns null if no original source content is
   * availible.
   */
  SourceMapConsumer.prototype.sourceContentFor =
    function SourceMapConsumer_sourceContentFor(aSource) {
      if (!this.sourcesContent) {
        return null;
      }

      if (this.sourceRoot) {
        aSource = util.relative(this.sourceRoot, aSource);
      }

      if (this._sources.has(aSource)) {
        return this.sourcesContent[this._sources.indexOf(aSource)];
      }

      var url;
      if (this.sourceRoot
          && (url = util.urlParse(this.sourceRoot))) {
        // XXX: file:// URIs and absolute paths lead to unexpected behavior for
        // many users. We can help them out when they expect file:// URIs to
        // behave like it would if they were running a local HTTP server. See
        // https://bugzilla.mozilla.org/show_bug.cgi?id=885597.
        var fileUriAbsPath = aSource.replace(/^file:\/\//, "");
        if (url.scheme == "file"
            && this._sources.has(fileUriAbsPath)) {
          return this.sourcesContent[this._sources.indexOf(fileUriAbsPath)]
        }

        if ((!url.path || url.path == "/")
            && this._sources.has("/" + aSource)) {
          return this.sourcesContent[this._sources.indexOf("/" + aSource)];
        }
      }

      throw new Error('"' + aSource + '" is not in the SourceMap.');
    };

  /**
   * Returns the generated line and column information for the original source,
   * line, and column positions provided. The only argument is an object with
   * the following properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.
   *   - column: The column number in the original source.
   *
   * and an object is returned with the following properties:
   *
   *   - line: The line number in the generated source, or null.
   *   - column: The column number in the generated source, or null.
   */
  SourceMapConsumer.prototype.generatedPositionFor =
    function SourceMapConsumer_generatedPositionFor(aArgs) {
      var needle = {
        source: util.getArg(aArgs, 'source'),
        originalLine: util.getArg(aArgs, 'line'),
        originalColumn: util.getArg(aArgs, 'column')
      };

      if (this.sourceRoot) {
        needle.source = util.relative(this.sourceRoot, needle.source);
      }

      var mapping = this._findMapping(needle,
                                      this._originalMappings,
                                      "originalLine",
                                      "originalColumn",
                                      this._compareOriginalPositions);

      if (mapping) {
        return {
          line: util.getArg(mapping, 'generatedLine', null),
          column: util.getArg(mapping, 'generatedColumn', null)
        };
      }

      return {
        line: null,
        column: null
      };
    };

  SourceMapConsumer.GENERATED_ORDER = 1;
  SourceMapConsumer.ORIGINAL_ORDER = 2;

  /**
   * Iterate over each mapping between an original source/line/column and a
   * generated line/column in this source map.
   *
   * @param Function aCallback
   *        The function that is called with each mapping.
   * @param Object aContext
   *        Optional. If specified, this object will be the value of `this` every
   *        time that `aCallback` is called.
   * @param aOrder
   *        Either `SourceMapConsumer.GENERATED_ORDER` or
   *        `SourceMapConsumer.ORIGINAL_ORDER`. Specifies whether you want to
   *        iterate over the mappings sorted by the generated file's line/column
   *        order or the original's source/line/column order, respectively. Defaults to
   *        `SourceMapConsumer.GENERATED_ORDER`.
   */
  SourceMapConsumer.prototype.eachMapping =
    function SourceMapConsumer_eachMapping(aCallback, aContext, aOrder) {
      var context = aContext || null;
      var order = aOrder || SourceMapConsumer.GENERATED_ORDER;

      var mappings;
      switch (order) {
      case SourceMapConsumer.GENERATED_ORDER:
        mappings = this._generatedMappings;
        break;
      case SourceMapConsumer.ORIGINAL_ORDER:
        mappings = this._originalMappings;
        break;
      default:
        throw new Error("Unknown order of iteration.");
      }

      var sourceRoot = this.sourceRoot;
      mappings.map(function (mapping) {
        var source = mapping.source;
        if (source && sourceRoot) {
          source = util.join(sourceRoot, source);
        }
        return {
          source: source,
          generatedLine: mapping.generatedLine,
          generatedColumn: mapping.generatedColumn,
          originalLine: mapping.originalLine,
          originalColumn: mapping.originalColumn,
          name: mapping.name
        };
      }).forEach(aCallback, context);
    };

  exports.SourceMapConsumer = SourceMapConsumer;

});

},{"./array-set":9,"./base64-vlq":10,"./binary-search":12,"./util":16,"amdefine":17}],14:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var base64VLQ = require('./base64-vlq');
  var util = require('./util');
  var ArraySet = require('./array-set').ArraySet;

  /**
   * An instance of the SourceMapGenerator represents a source map which is
   * being built incrementally. To create a new one, you must pass an object
   * with the following properties:
   *
   *   - file: The filename of the generated source.
   *   - sourceRoot: An optional root for all URLs in this source map.
   */
  function SourceMapGenerator(aArgs) {
    this._file = util.getArg(aArgs, 'file');
    this._sourceRoot = util.getArg(aArgs, 'sourceRoot', null);
    this._sources = new ArraySet();
    this._names = new ArraySet();
    this._mappings = [];
    this._sourcesContents = null;
  }

  SourceMapGenerator.prototype._version = 3;

  /**
   * Creates a new SourceMapGenerator based on a SourceMapConsumer
   *
   * @param aSourceMapConsumer The SourceMap.
   */
  SourceMapGenerator.fromSourceMap =
    function SourceMapGenerator_fromSourceMap(aSourceMapConsumer) {
      var sourceRoot = aSourceMapConsumer.sourceRoot;
      var generator = new SourceMapGenerator({
        file: aSourceMapConsumer.file,
        sourceRoot: sourceRoot
      });
      aSourceMapConsumer.eachMapping(function (mapping) {
        var newMapping = {
          generated: {
            line: mapping.generatedLine,
            column: mapping.generatedColumn
          }
        };

        if (mapping.source) {
          newMapping.source = mapping.source;
          if (sourceRoot) {
            newMapping.source = util.relative(sourceRoot, newMapping.source);
          }

          newMapping.original = {
            line: mapping.originalLine,
            column: mapping.originalColumn
          };

          if (mapping.name) {
            newMapping.name = mapping.name;
          }
        }

        generator.addMapping(newMapping);
      });
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content) {
          generator.setSourceContent(sourceFile, content);
        }
      });
      return generator;
    };

  /**
   * Add a single mapping from original source line and column to the generated
   * source's line and column for this source map being created. The mapping
   * object should have the following properties:
   *
   *   - generated: An object with the generated line and column positions.
   *   - original: An object with the original line and column positions.
   *   - source: The original source file (relative to the sourceRoot).
   *   - name: An optional original token name for this mapping.
   */
  SourceMapGenerator.prototype.addMapping =
    function SourceMapGenerator_addMapping(aArgs) {
      var generated = util.getArg(aArgs, 'generated');
      var original = util.getArg(aArgs, 'original', null);
      var source = util.getArg(aArgs, 'source', null);
      var name = util.getArg(aArgs, 'name', null);

      this._validateMapping(generated, original, source, name);

      if (source && !this._sources.has(source)) {
        this._sources.add(source);
      }

      if (name && !this._names.has(name)) {
        this._names.add(name);
      }

      this._mappings.push({
        generated: generated,
        original: original,
        source: source,
        name: name
      });
    };

  /**
   * Set the source content for a source file.
   */
  SourceMapGenerator.prototype.setSourceContent =
    function SourceMapGenerator_setSourceContent(aSourceFile, aSourceContent) {
      var source = aSourceFile;
      if (this._sourceRoot) {
        source = util.relative(this._sourceRoot, source);
      }

      if (aSourceContent !== null) {
        // Add the source content to the _sourcesContents map.
        // Create a new _sourcesContents map if the property is null.
        if (!this._sourcesContents) {
          this._sourcesContents = {};
        }
        this._sourcesContents[util.toSetString(source)] = aSourceContent;
      } else {
        // Remove the source file from the _sourcesContents map.
        // If the _sourcesContents map is empty, set the property to null.
        delete this._sourcesContents[util.toSetString(source)];
        if (Object.keys(this._sourcesContents).length === 0) {
          this._sourcesContents = null;
        }
      }
    };

  /**
   * Applies the mappings of a sub-source-map for a specific source file to the
   * source map being generated. Each mapping to the supplied source file is
   * rewritten using the supplied source map. Note: The resolution for the
   * resulting mappings is the minimium of this map and the supplied map.
   *
   * @param aSourceMapConsumer The source map to be applied.
   * @param aSourceFile Optional. The filename of the source file.
   *        If omitted, SourceMapConsumer's file property will be used.
   */
  SourceMapGenerator.prototype.applySourceMap =
    function SourceMapGenerator_applySourceMap(aSourceMapConsumer, aSourceFile) {
      // If aSourceFile is omitted, we will use the file property of the SourceMap
      if (!aSourceFile) {
        aSourceFile = aSourceMapConsumer.file;
      }
      var sourceRoot = this._sourceRoot;
      // Make "aSourceFile" relative if an absolute Url is passed.
      if (sourceRoot) {
        aSourceFile = util.relative(sourceRoot, aSourceFile);
      }
      // Applying the SourceMap can add and remove items from the sources and
      // the names array.
      var newSources = new ArraySet();
      var newNames = new ArraySet();

      // Find mappings for the "aSourceFile"
      this._mappings.forEach(function (mapping) {
        if (mapping.source === aSourceFile && mapping.original) {
          // Check if it can be mapped by the source map, then update the mapping.
          var original = aSourceMapConsumer.originalPositionFor({
            line: mapping.original.line,
            column: mapping.original.column
          });
          if (original.source !== null) {
            // Copy mapping
            if (sourceRoot) {
              mapping.source = util.relative(sourceRoot, original.source);
            } else {
              mapping.source = original.source;
            }
            mapping.original.line = original.line;
            mapping.original.column = original.column;
            if (original.name !== null && mapping.name !== null) {
              // Only use the identifier name if it's an identifier
              // in both SourceMaps
              mapping.name = original.name;
            }
          }
        }

        var source = mapping.source;
        if (source && !newSources.has(source)) {
          newSources.add(source);
        }

        var name = mapping.name;
        if (name && !newNames.has(name)) {
          newNames.add(name);
        }

      }, this);
      this._sources = newSources;
      this._names = newNames;

      // Copy sourcesContents of applied map.
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content) {
          if (sourceRoot) {
            sourceFile = util.relative(sourceRoot, sourceFile);
          }
          this.setSourceContent(sourceFile, content);
        }
      }, this);
    };

  /**
   * A mapping can have one of the three levels of data:
   *
   *   1. Just the generated position.
   *   2. The Generated position, original position, and original source.
   *   3. Generated and original position, original source, as well as a name
   *      token.
   *
   * To maintain consistency, we validate that any new mapping being added falls
   * in to one of these categories.
   */
  SourceMapGenerator.prototype._validateMapping =
    function SourceMapGenerator_validateMapping(aGenerated, aOriginal, aSource,
                                                aName) {
      if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
          && aGenerated.line > 0 && aGenerated.column >= 0
          && !aOriginal && !aSource && !aName) {
        // Case 1.
        return;
      }
      else if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
               && aOriginal && 'line' in aOriginal && 'column' in aOriginal
               && aGenerated.line > 0 && aGenerated.column >= 0
               && aOriginal.line > 0 && aOriginal.column >= 0
               && aSource) {
        // Cases 2 and 3.
        return;
      }
      else {
        throw new Error('Invalid mapping.');
      }
    };

  function cmpLocation(loc1, loc2) {
    var cmp = (loc1 && loc1.line) - (loc2 && loc2.line);
    return cmp ? cmp : (loc1 && loc1.column) - (loc2 && loc2.column);
  }

  function strcmp(str1, str2) {
    str1 = str1 || '';
    str2 = str2 || '';
    return (str1 > str2) - (str1 < str2);
  }

  function cmpMapping(mappingA, mappingB) {
    return cmpLocation(mappingA.generated, mappingB.generated) ||
      cmpLocation(mappingA.original, mappingB.original) ||
      strcmp(mappingA.source, mappingB.source) ||
      strcmp(mappingA.name, mappingB.name);
  }

  /**
   * Serialize the accumulated mappings in to the stream of base 64 VLQs
   * specified by the source map format.
   */
  SourceMapGenerator.prototype._serializeMappings =
    function SourceMapGenerator_serializeMappings() {
      var previousGeneratedColumn = 0;
      var previousGeneratedLine = 1;
      var previousOriginalColumn = 0;
      var previousOriginalLine = 0;
      var previousName = 0;
      var previousSource = 0;
      var result = '';
      var mapping;

      // The mappings must be guaranteed to be in sorted order before we start
      // serializing them or else the generated line numbers (which are defined
      // via the ';' separators) will be all messed up. Note: it might be more
      // performant to maintain the sorting as we insert them, rather than as we
      // serialize them, but the big O is the same either way.
      this._mappings.sort(cmpMapping);

      for (var i = 0, len = this._mappings.length; i < len; i++) {
        mapping = this._mappings[i];

        if (mapping.generated.line !== previousGeneratedLine) {
          previousGeneratedColumn = 0;
          while (mapping.generated.line !== previousGeneratedLine) {
            result += ';';
            previousGeneratedLine++;
          }
        }
        else {
          if (i > 0) {
            if (!cmpMapping(mapping, this._mappings[i - 1])) {
              continue;
            }
            result += ',';
          }
        }

        result += base64VLQ.encode(mapping.generated.column
                                   - previousGeneratedColumn);
        previousGeneratedColumn = mapping.generated.column;

        if (mapping.source && mapping.original) {
          result += base64VLQ.encode(this._sources.indexOf(mapping.source)
                                     - previousSource);
          previousSource = this._sources.indexOf(mapping.source);

          // lines are stored 0-based in SourceMap spec version 3
          result += base64VLQ.encode(mapping.original.line - 1
                                     - previousOriginalLine);
          previousOriginalLine = mapping.original.line - 1;

          result += base64VLQ.encode(mapping.original.column
                                     - previousOriginalColumn);
          previousOriginalColumn = mapping.original.column;

          if (mapping.name) {
            result += base64VLQ.encode(this._names.indexOf(mapping.name)
                                       - previousName);
            previousName = this._names.indexOf(mapping.name);
          }
        }
      }

      return result;
    };

  /**
   * Externalize the source map.
   */
  SourceMapGenerator.prototype.toJSON =
    function SourceMapGenerator_toJSON() {
      var map = {
        version: this._version,
        file: this._file,
        sources: this._sources.toArray(),
        names: this._names.toArray(),
        mappings: this._serializeMappings()
      };
      if (this._sourceRoot) {
        map.sourceRoot = this._sourceRoot;
      }
      if (this._sourcesContents) {
        map.sourcesContent = map.sources.map(function (source) {
          if (map.sourceRoot) {
            source = util.relative(map.sourceRoot, source);
          }
          return Object.prototype.hasOwnProperty.call(
            this._sourcesContents, util.toSetString(source))
            ? this._sourcesContents[util.toSetString(source)]
            : null;
        }, this);
      }
      return map;
    };

  /**
   * Render the source map being generated to a string.
   */
  SourceMapGenerator.prototype.toString =
    function SourceMapGenerator_toString() {
      return JSON.stringify(this);
    };

  exports.SourceMapGenerator = SourceMapGenerator;

});

},{"./array-set":9,"./base64-vlq":10,"./util":16,"amdefine":17}],15:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var SourceMapGenerator = require('./source-map-generator').SourceMapGenerator;
  var util = require('./util');

  /**
   * SourceNodes provide a way to abstract over interpolating/concatenating
   * snippets of generated JavaScript source code while maintaining the line and
   * column information associated with the original source code.
   *
   * @param aLine The original line number.
   * @param aColumn The original column number.
   * @param aSource The original source's filename.
   * @param aChunks Optional. An array of strings which are snippets of
   *        generated JS, or other SourceNodes.
   * @param aName The original identifier.
   */
  function SourceNode(aLine, aColumn, aSource, aChunks, aName) {
    this.children = [];
    this.sourceContents = {};
    this.line = aLine === undefined ? null : aLine;
    this.column = aColumn === undefined ? null : aColumn;
    this.source = aSource === undefined ? null : aSource;
    this.name = aName === undefined ? null : aName;
    if (aChunks != null) this.add(aChunks);
  }

  /**
   * Creates a SourceNode from generated code and a SourceMapConsumer.
   *
   * @param aGeneratedCode The generated code
   * @param aSourceMapConsumer The SourceMap for the generated code
   */
  SourceNode.fromStringWithSourceMap =
    function SourceNode_fromStringWithSourceMap(aGeneratedCode, aSourceMapConsumer) {
      // The SourceNode we want to fill with the generated code
      // and the SourceMap
      var node = new SourceNode();

      // The generated code
      // Processed fragments are removed from this array.
      var remainingLines = aGeneratedCode.split('\n');

      // We need to remember the position of "remainingLines"
      var lastGeneratedLine = 1, lastGeneratedColumn = 0;

      // The generate SourceNodes we need a code range.
      // To extract it current and last mapping is used.
      // Here we store the last mapping.
      var lastMapping = null;

      aSourceMapConsumer.eachMapping(function (mapping) {
        if (lastMapping === null) {
          // We add the generated code until the first mapping
          // to the SourceNode without any mapping.
          // Each line is added as separate string.
          while (lastGeneratedLine < mapping.generatedLine) {
            node.add(remainingLines.shift() + "\n");
            lastGeneratedLine++;
          }
          if (lastGeneratedColumn < mapping.generatedColumn) {
            var nextLine = remainingLines[0];
            node.add(nextLine.substr(0, mapping.generatedColumn));
            remainingLines[0] = nextLine.substr(mapping.generatedColumn);
            lastGeneratedColumn = mapping.generatedColumn;
          }
        } else {
          // We add the code from "lastMapping" to "mapping":
          // First check if there is a new line in between.
          if (lastGeneratedLine < mapping.generatedLine) {
            var code = "";
            // Associate full lines with "lastMapping"
            do {
              code += remainingLines.shift() + "\n";
              lastGeneratedLine++;
              lastGeneratedColumn = 0;
            } while (lastGeneratedLine < mapping.generatedLine);
            // When we reached the correct line, we add code until we
            // reach the correct column too.
            if (lastGeneratedColumn < mapping.generatedColumn) {
              var nextLine = remainingLines[0];
              code += nextLine.substr(0, mapping.generatedColumn);
              remainingLines[0] = nextLine.substr(mapping.generatedColumn);
              lastGeneratedColumn = mapping.generatedColumn;
            }
            // Create the SourceNode.
            addMappingWithCode(lastMapping, code);
          } else {
            // There is no new line in between.
            // Associate the code between "lastGeneratedColumn" and
            // "mapping.generatedColumn" with "lastMapping"
            var nextLine = remainingLines[0];
            var code = nextLine.substr(0, mapping.generatedColumn -
                                          lastGeneratedColumn);
            remainingLines[0] = nextLine.substr(mapping.generatedColumn -
                                                lastGeneratedColumn);
            lastGeneratedColumn = mapping.generatedColumn;
            addMappingWithCode(lastMapping, code);
          }
        }
        lastMapping = mapping;
      }, this);
      // We have processed all mappings.
      // Associate the remaining code in the current line with "lastMapping"
      // and add the remaining lines without any mapping
      addMappingWithCode(lastMapping, remainingLines.join("\n"));

      // Copy sourcesContent into SourceNode
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content) {
          node.setSourceContent(sourceFile, content);
        }
      });

      return node;

      function addMappingWithCode(mapping, code) {
        if (mapping === null || mapping.source === undefined) {
          node.add(code);
        } else {
          node.add(new SourceNode(mapping.originalLine,
                                  mapping.originalColumn,
                                  mapping.source,
                                  code,
                                  mapping.name));
        }
      }
    };

  /**
   * Add a chunk of generated JS to this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.add = function SourceNode_add(aChunk) {
    if (Array.isArray(aChunk)) {
      aChunk.forEach(function (chunk) {
        this.add(chunk);
      }, this);
    }
    else if (aChunk instanceof SourceNode || typeof aChunk === "string") {
      if (aChunk) {
        this.children.push(aChunk);
      }
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Add a chunk of generated JS to the beginning of this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.prepend = function SourceNode_prepend(aChunk) {
    if (Array.isArray(aChunk)) {
      for (var i = aChunk.length-1; i >= 0; i--) {
        this.prepend(aChunk[i]);
      }
    }
    else if (aChunk instanceof SourceNode || typeof aChunk === "string") {
      this.children.unshift(aChunk);
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Walk over the tree of JS snippets in this node and its children. The
   * walking function is called once for each snippet of JS and is passed that
   * snippet and the its original associated source's line/column location.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walk = function SourceNode_walk(aFn) {
    this.children.forEach(function (chunk) {
      if (chunk instanceof SourceNode) {
        chunk.walk(aFn);
      }
      else {
        if (chunk !== '') {
          aFn(chunk, { source: this.source,
                       line: this.line,
                       column: this.column,
                       name: this.name });
        }
      }
    }, this);
  };

  /**
   * Like `String.prototype.join` except for SourceNodes. Inserts `aStr` between
   * each of `this.children`.
   *
   * @param aSep The separator.
   */
  SourceNode.prototype.join = function SourceNode_join(aSep) {
    var newChildren;
    var i;
    var len = this.children.length;
    if (len > 0) {
      newChildren = [];
      for (i = 0; i < len-1; i++) {
        newChildren.push(this.children[i]);
        newChildren.push(aSep);
      }
      newChildren.push(this.children[i]);
      this.children = newChildren;
    }
    return this;
  };

  /**
   * Call String.prototype.replace on the very right-most source snippet. Useful
   * for trimming whitespace from the end of a source node, etc.
   *
   * @param aPattern The pattern to replace.
   * @param aReplacement The thing to replace the pattern with.
   */
  SourceNode.prototype.replaceRight = function SourceNode_replaceRight(aPattern, aReplacement) {
    var lastChild = this.children[this.children.length - 1];
    if (lastChild instanceof SourceNode) {
      lastChild.replaceRight(aPattern, aReplacement);
    }
    else if (typeof lastChild === 'string') {
      this.children[this.children.length - 1] = lastChild.replace(aPattern, aReplacement);
    }
    else {
      this.children.push(''.replace(aPattern, aReplacement));
    }
    return this;
  };

  /**
   * Set the source content for a source file. This will be added to the SourceMapGenerator
   * in the sourcesContent field.
   *
   * @param aSourceFile The filename of the source file
   * @param aSourceContent The content of the source file
   */
  SourceNode.prototype.setSourceContent =
    function SourceNode_setSourceContent(aSourceFile, aSourceContent) {
      this.sourceContents[util.toSetString(aSourceFile)] = aSourceContent;
    };

  /**
   * Walk over the tree of SourceNodes. The walking function is called for each
   * source file content and is passed the filename and source content.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walkSourceContents =
    function SourceNode_walkSourceContents(aFn) {
      this.children.forEach(function (chunk) {
        if (chunk instanceof SourceNode) {
          chunk.walkSourceContents(aFn);
        }
      }, this);
      Object.keys(this.sourceContents).forEach(function (sourceFileKey) {
        aFn(util.fromSetString(sourceFileKey), this.sourceContents[sourceFileKey]);
      }, this);
    };

  /**
   * Return the string representation of this source node. Walks over the tree
   * and concatenates all the various snippets together to one string.
   */
  SourceNode.prototype.toString = function SourceNode_toString() {
    var str = "";
    this.walk(function (chunk) {
      str += chunk;
    });
    return str;
  };

  /**
   * Returns the string representation of this source node along with a source
   * map.
   */
  SourceNode.prototype.toStringWithSourceMap = function SourceNode_toStringWithSourceMap(aArgs) {
    var generated = {
      code: "",
      line: 1,
      column: 0
    };
    var map = new SourceMapGenerator(aArgs);
    var sourceMappingActive = false;
    this.walk(function (chunk, original) {
      generated.code += chunk;
      if (original.source !== null
          && original.line !== null
          && original.column !== null) {
        map.addMapping({
          source: original.source,
          original: {
            line: original.line,
            column: original.column
          },
          generated: {
            line: generated.line,
            column: generated.column
          },
          name: original.name
        });
        sourceMappingActive = true;
      } else if (sourceMappingActive) {
        map.addMapping({
          generated: {
            line: generated.line,
            column: generated.column
          }
        });
        sourceMappingActive = false;
      }
      chunk.split('').forEach(function (ch) {
        if (ch === '\n') {
          generated.line++;
          generated.column = 0;
        } else {
          generated.column++;
        }
      });
    });
    this.walkSourceContents(function (sourceFile, sourceContent) {
      map.setSourceContent(sourceFile, sourceContent);
    });

    return { code: generated.code, map: map };
  };

  exports.SourceNode = SourceNode;

});

},{"./source-map-generator":14,"./util":16,"amdefine":17}],16:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  /**
   * This is a helper function for getting values from parameter/options
   * objects.
   *
   * @param args The object we are extracting values from
   * @param name The name of the property we are getting.
   * @param defaultValue An optional value to return if the property is missing
   * from the object. If this is not specified and the property is missing, an
   * error will be thrown.
   */
  function getArg(aArgs, aName, aDefaultValue) {
    if (aName in aArgs) {
      return aArgs[aName];
    } else if (arguments.length === 3) {
      return aDefaultValue;
    } else {
      throw new Error('"' + aName + '" is a required argument.');
    }
  }
  exports.getArg = getArg;

  var urlRegexp = /([\w+\-.]+):\/\/((\w+:\w+)@)?([\w.]+)?(:(\d+))?(\S+)?/;

  function urlParse(aUrl) {
    var match = aUrl.match(urlRegexp);
    if (!match) {
      return null;
    }
    return {
      scheme: match[1],
      auth: match[3],
      host: match[4],
      port: match[6],
      path: match[7]
    };
  }
  exports.urlParse = urlParse;

  function urlGenerate(aParsedUrl) {
    var url = aParsedUrl.scheme + "://";
    if (aParsedUrl.auth) {
      url += aParsedUrl.auth + "@"
    }
    if (aParsedUrl.host) {
      url += aParsedUrl.host;
    }
    if (aParsedUrl.port) {
      url += ":" + aParsedUrl.port
    }
    if (aParsedUrl.path) {
      url += aParsedUrl.path;
    }
    return url;
  }
  exports.urlGenerate = urlGenerate;

  function join(aRoot, aPath) {
    var url;

    if (aPath.match(urlRegexp)) {
      return aPath;
    }

    if (aPath.charAt(0) === '/' && (url = urlParse(aRoot))) {
      url.path = aPath;
      return urlGenerate(url);
    }

    return aRoot.replace(/\/$/, '') + '/' + aPath;
  }
  exports.join = join;

  /**
   * Because behavior goes wacky when you set `__proto__` on objects, we
   * have to prefix all the strings in our set with an arbitrary character.
   *
   * See https://github.com/mozilla/source-map/pull/31 and
   * https://github.com/mozilla/source-map/issues/30
   *
   * @param String aStr
   */
  function toSetString(aStr) {
    return '$' + aStr;
  }
  exports.toSetString = toSetString;

  function fromSetString(aStr) {
    return aStr.substr(1);
  }
  exports.fromSetString = fromSetString;

  function relative(aRoot, aPath) {
    aRoot = aRoot.replace(/\/$/, '');

    var url = urlParse(aRoot);
    if (aPath.charAt(0) == "/" && url && url.path == "/") {
      return aPath.slice(1);
    }

    return aPath.indexOf(aRoot + '/') === 0
      ? aPath.substr(aRoot.length + 1)
      : aPath;
  }
  exports.relative = relative;

});

},{"amdefine":17}],17:[function(require,module,exports){
(function(process,__filename){/** vim: et:ts=4:sw=4:sts=4
 * @license amdefine 0.0.5 Copyright (c) 2011, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/amdefine for details
 */

/*jslint node: true */
/*global module, process */
'use strict';

var path = require('path');

/**
 * Creates a define for node.
 * @param {Object} module the "module" object that is defined by Node for the
 * current module.
 * @param {Function} [require]. Node's require function for the current module.
 * It only needs to be passed in Node versions before 0.5, when module.require
 * did not exist.
 * @returns {Function} a define function that is usable for the current node
 * module.
 */
function amdefine(module, require) {
    var defineCache = {},
        loaderCache = {},
        alreadyCalled = false,
        makeRequire, stringRequire;

    /**
     * Trims the . and .. from an array of path segments.
     * It will keep a leading path segment if a .. will become
     * the first path segment, to help with module name lookups,
     * which act like paths, but can be remapped. But the end result,
     * all paths that use this function should look normalized.
     * NOTE: this method MODIFIES the input array.
     * @param {Array} ary the array of path segments.
     */
    function trimDots(ary) {
        var i, part;
        for (i = 0; ary[i]; i+= 1) {
            part = ary[i];
            if (part === '.') {
                ary.splice(i, 1);
                i -= 1;
            } else if (part === '..') {
                if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                    //End of the line. Keep at least one non-dot
                    //path segment at the front so it can be mapped
                    //correctly to disk. Otherwise, there is likely
                    //no path mapping for a path starting with '..'.
                    //This can still fail, but catches the most reasonable
                    //uses of ..
                    break;
                } else if (i > 0) {
                    ary.splice(i - 1, 2);
                    i -= 2;
                }
            }
        }
    }

    function normalize(name, baseName) {
        var baseParts;

        //Adjust any relative paths.
        if (name && name.charAt(0) === '.') {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                baseParts = baseName.split('/');
                baseParts = baseParts.slice(0, baseParts.length - 1);
                baseParts = baseParts.concat(name.split('/'));
                trimDots(baseParts);
                name = baseParts.join('/');
            }
        }

        return name;
    }

    /**
     * Create the normalize() function passed to a loader plugin's
     * normalize method.
     */
    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(id) {
        function load(value) {
            loaderCache[id] = value;
        }

        load.fromText = function (id, text) {
            //This one is difficult because the text can/probably uses
            //define, and any relative paths and requires should be relative
            //to that id was it would be found on disk. But this would require
            //bootstrapping a module/require fairly deeply from node core.
            //Not sure how best to go about that yet.
            throw new Error('amdefine does not implement load.fromText');
        };

        return load;
    }

    makeRequire = function (systemRequire, exports, module, relId) {
        function amdRequire(deps, callback) {
            if (typeof deps === 'string') {
                //Synchronous, single module require('')
                return stringRequire(systemRequire, exports, module, deps, relId);
            } else {
                //Array of dependencies with a callback.

                //Convert the dependencies to modules.
                deps = deps.map(function (depName) {
                    return stringRequire(systemRequire, exports, module, depName, relId);
                });

                //Wait for next tick to call back the require call.
                process.nextTick(function () {
                    callback.apply(null, deps);
                });
            }
        }

        amdRequire.toUrl = function (filePath) {
            if (filePath.indexOf('.') === 0) {
                return normalize(filePath, path.dirname(module.filename));
            } else {
                return filePath;
            }
        };

        return amdRequire;
    };

    //Favor explicit value, passed in if the module wants to support Node 0.4.
    require = require || function req() {
        return module.require.apply(module, arguments);
    };

    function runFactory(id, deps, factory) {
        var r, e, m, result;

        if (id) {
            e = loaderCache[id] = {};
            m = {
                id: id,
                uri: __filename,
                exports: e
            };
            r = makeRequire(require, e, m, id);
        } else {
            //Only support one define call per file
            if (alreadyCalled) {
                throw new Error('amdefine with no module ID cannot be called more than once per file.');
            }
            alreadyCalled = true;

            //Use the real variables from node
            //Use module.exports for exports, since
            //the exports in here is amdefine exports.
            e = module.exports;
            m = module;
            r = makeRequire(require, e, m, module.id);
        }

        //If there are dependencies, they are strings, so need
        //to convert them to dependency values.
        if (deps) {
            deps = deps.map(function (depName) {
                return r(depName);
            });
        }

        //Call the factory with the right dependencies.
        if (typeof factory === 'function') {
            result = factory.apply(module.exports, deps);
        } else {
            result = factory;
        }

        if (result !== undefined) {
            m.exports = result;
            if (id) {
                loaderCache[id] = m.exports;
            }
        }
    }

    stringRequire = function (systemRequire, exports, module, id, relId) {
        //Split the ID by a ! so that
        var index = id.indexOf('!'),
            originalId = id,
            prefix, plugin;

        if (index === -1) {
            id = normalize(id, relId);

            //Straight module lookup. If it is one of the special dependencies,
            //deal with it, otherwise, delegate to node.
            if (id === 'require') {
                return makeRequire(systemRequire, exports, module, relId);
            } else if (id === 'exports') {
                return exports;
            } else if (id === 'module') {
                return module;
            } else if (loaderCache.hasOwnProperty(id)) {
                return loaderCache[id];
            } else if (defineCache[id]) {
                runFactory.apply(null, defineCache[id]);
                return loaderCache[id];
            } else {
                if(systemRequire) {
                    return systemRequire(originalId);
                } else {
                    throw new Error('No module with ID: ' + id);
                }
            }
        } else {
            //There is a plugin in play.
            prefix = id.substring(0, index);
            id = id.substring(index + 1, id.length);

            plugin = stringRequire(systemRequire, exports, module, prefix, relId);

            if (plugin.normalize) {
                id = plugin.normalize(id, makeNormalize(relId));
            } else {
                //Normalize the ID normally.
                id = normalize(id, relId);
            }

            if (loaderCache[id]) {
                return loaderCache[id];
            } else {
                plugin.load(id, makeRequire(systemRequire, exports, module, relId), makeLoad(id), {});

                return loaderCache[id];
            }
        }
    };

    //Create a define function specific to the module asking for amdefine.
    function define(id, deps, factory) {
        if (Array.isArray(id)) {
            factory = deps;
            deps = id;
            id = undefined;
        } else if (typeof id !== 'string') {
            factory = id;
            id = deps = undefined;
        }

        if (deps && !Array.isArray(deps)) {
            factory = deps;
            deps = undefined;
        }

        if (!deps) {
            deps = ['require', 'exports', 'module'];
        }

        //Set up properties for this module. If an ID, then use
        //internal cache. If no ID, then use the external variables
        //for this node module.
        if (id) {
            //Put the module in deep freeze until there is a
            //require call for it.
            defineCache[id] = [id, deps, factory];
        } else {
            runFactory(id, deps, factory);
        }
    }

    //define.require, which has access to all the values in the
    //cache. Useful for AMD modules that all have IDs in the file,
    //but need to finally export a value to node based on one of those
    //IDs.
    define.require = function (id) {
        if (loaderCache[id]) {
            return loaderCache[id];
        }

        if (defineCache[id]) {
            runFactory.apply(null, defineCache[id]);
            return loaderCache[id];
        }
    };

    define.amd = {};

    return define;
}

module.exports = amdefine;

})(require("__browserify_process"),"/../node_modules/escodegen/node_modules/source-map/node_modules/amdefine/amdefine.js")
},{"__browserify_process":28,"path":26}],18:[function(require,module,exports){
module.exports=module.exports={
  "name": "escodegen",
  "description": "ECMAScript code generator",
  "homepage": "http://github.com/Constellation/escodegen.html",
  "main": "escodegen.js",
  "bin": {
    "esgenerate": "./bin/esgenerate.js",
    "escodegen": "./bin/escodegen.js"
  },
  "version": "0.0.24",
  "engines": {
    "node": ">=0.4.0"
  },
  "maintainers": [
    {
      "name": "Yusuke Suzuki",
      "email": "utatane.tea@gmail.com",
      "url": "http://github.com/Constellation"
    }
  ],
  "repository": {
    "type": "git",
    "url": "http://github.com/Constellation/escodegen.git"
  },
  "dependencies": {
    "esprima": "~1.0.2",
    "estraverse": "~0.0.4",
    "source-map": ">= 0.1.2"
  },
  "optionalDependencies": {
    "source-map": ">= 0.1.2"
  },
  "devDependencies": {
    "esprima-moz": "*",
    "browserify": "*",
    "q": "*",
    "bower": "*",
    "semver": "*",
    "chai": "~1.7.2",
    "grunt-contrib-jshint": "~0.6.0",
    "grunt": "~0.4.1",
    "grunt-mocha-test": "~0.5.0",
    "grunt-cli": "~0.1.9"
  },
  "licenses": [
    {
      "type": "BSD",
      "url": "http://github.com/Constellation/escodegen/raw/master/LICENSE.BSD"
    }
  ],
  "scripts": {
    "test": "grunt travis",
    "unit-test": "grunt test",
    "lint": "grunt lint",
    "release": "node tools/release.js",
    "build": "(echo '// Generated by browserify'; ./node_modules/.bin/browserify -i source-map tools/entry-point.js) > escodegen.browser.js"
  },
  "readme": "\n### Escodegen [![Build Status](https://secure.travis-ci.org/Constellation/escodegen.png)](http://travis-ci.org/Constellation/escodegen) [![Build Status](https://drone.io/github.com/Constellation/escodegen/status.png)](https://drone.io/github.com/Constellation/escodegen/latest)\n\nEscodegen ([escodegen](http://github.com/Constellation/escodegen)) is\n[ECMAScript](http://www.ecma-international.org/publications/standards/Ecma-262.htm)\n(also popularly known as [JavaScript](http://en.wikipedia.org/wiki/JavaScript>JavaScript))\ncode generator from [Parser API](https://developer.mozilla.org/en/SpiderMonkey/Parser_API) AST.\nSee [online generator demo](http://constellation.github.com/escodegen/demo/index.html).\n\n\n### Install\n\nEscodegen can be used in a web browser:\n\n    <script src=\"escodegen.browser.js\"></script>\n\nor in a Node.js application via the package manager:\n\n    npm install escodegen\n\n\n### Usage\n\nA simple example: the program\n\n    escodegen.generate({\n        type: 'BinaryExpression',\n        operator: '+',\n        left: { type: 'Literal', value: 40 },\n        right: { type: 'Literal', value: 2 }\n    });\n\nproduces the string `'40 + 2'`\n\nSee the [API page](https://github.com/Constellation/escodegen/wiki/API) for\noptions. To run the tests, execute `npm test` in the root directory.\n\n\n### License\n\n#### Escodegen\n\nCopyright (C) 2012 [Yusuke Suzuki](http://github.com/Constellation)\n (twitter: [@Constellation](http://twitter.com/Constellation)) and other contributors.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are met:\n\n  * Redistributions of source code must retain the above copyright\n    notice, this list of conditions and the following disclaimer.\n\n  * Redistributions in binary form must reproduce the above copyright\n    notice, this list of conditions and the following disclaimer in the\n    documentation and/or other materials provided with the distribution.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \"AS IS\"\nAND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE\nIMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE\nARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY\nDIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES\n(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;\nLOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND\nON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT\n(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF\nTHIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.\n\n#### source-map\n\nSourceNodeMocks has a limited interface of mozilla/source-map SourceNode implementations.\n\nCopyright (c) 2009-2011, Mozilla Foundation and contributors\nAll rights reserved.\n\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted provided that the following conditions are met:\n\n* Redistributions of source code must retain the above copyright notice, this\n  list of conditions and the following disclaimer.\n\n* Redistributions in binary form must reproduce the above copyright notice,\n  this list of conditions and the following disclaimer in the documentation\n  and/or other materials provided with the distribution.\n\n* Neither the names of the Mozilla Foundation nor the names of project\n  contributors may be used to endorse or promote products derived from this\n  software without specific prior written permission.\n\nTHIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \"AS IS\" AND\nANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED\nWARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE\nDISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE\nFOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL\nDAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR\nSERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER\nCAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,\nOR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE\nOF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.\n",
  "readmeFilename": "README.md",
  "bugs": {
    "url": "https://github.com/Constellation/escodegen/issues"
  },
  "_id": "escodegen@0.0.24",
  "dist": {
    "shasum": "b6ce32abbf9458249c40983d9b866ac0457a8a1d"
  },
  "_from": "escodegen@",
  "_resolved": "https://registry.npmjs.org/escodegen/-/escodegen-0.0.24.tgz"
}

},{}],19:[function(require,module,exports){
(function(){var walker = require('./walker')
var core = require('./core')
var JS = require('./js')
var codegen = require('escodegen')
var Terr = require('./terr-ast')

function isSymbol(s) {
  return s instanceof core.symbol;
}
function isKeyword(s) {
  return s instanceof core.keyword;
}
function isList(s) {
  return s instanceof core.list;
}

function mungeSymbol (str) {
  return str.replace(/-/g, '_')
    .replace(/\:/g, "_COLON_")
    .replace(/\+/g, "_PLUS_")
    .replace(/\>/g, "_GT_")
    .replace(/\</g, "_LT_")
    .replace(/\=/g, "_EQ_")
    .replace(/\~/g, "_TILDE_")
    .replace(/\!/g, "_BANG_")
    .replace(/\@/g, "_CIRCA_")
    .replace(/\#/g, "_SHARP_")
    .replace(/\\'/g, "_SINGLEQUOTE_")
    .replace(/\"/g, "_DOUBLEQUOTE_")
    .replace(/\%/g, "_PERCENT_")
    .replace(/\^/g, "_CARET_")
    .replace(/\&/g, "_AMPERSAND_")
    .replace(/\*/g, "_STAR_")
    .replace(/\|/g, "_BAR_")
    .replace(/\{/g, "_LBRACE_")
    .replace(/\}/g, "_RBRACE_")
    .replace(/\[/g, "_LBRACK_")
    .replace(/\]/g, "_RBRACK_")
    .replace(/\//g, "_SLASH_")
    .replace(/\\/g, "_BSLASH_")
    .replace(/\?/g, "_QMARK_")
    .replace(/\./g, "_DOT_")
}

function reduceBinaryOperator (values, op) {
  var left = values[0];
  var i = 1;
  while (i < values.length) {
    left = Terr.Binary(left, op, values[i]);
    i += 1;
  }
  return left;
}

function makeBinary (op) {
  return function (opts) {
    var args = Array.prototype.slice.call(arguments, 1);
    return reduceBinaryOperator(args.map(opts.walker(opts.env)), op)
  }
}

function makeUnary (op) {
  return function (opts, arg) {
    return Terr.Unary(op, opts.walker(opts.env)(arg));
  }
}

function parseSymbol (symb) {
  var pos = 0;
  var ch = symb[pos++];
  var ns = null;
  var parts = [];
  var root = null;
  var part = "";
  var no_ns = false;

  if (ch === ".") {
    if (symb[1] === undefined || symb[1] === ".") {
      return {
        namespace: ns,
        root: symb,
        parts: parts
      }
    } else {
      root = "";
      ch = symb[pos++];
    }
  }

  while (ch !== undefined) {
    if (ch === ".") {
      if (part === "") {
        throw "Couldn't parse symbol `" + symb + "`"
      }
      if (root === null) {
        root = part;
        part = "";
      } else {
        parts.push(part);
        part = "";
      }
    } else if (ch == "/" && no_ns === false) {
      if (pos === 1) {
        no_ns = true;
        part += ch;
      } else if (ns === null && pos !== 1) {
        ns = symb.slice(0, pos - 1);
        part = "";
        parts = [];
        root = null;
      } else {
        throw "Couldn't parse symbol `" + symb + "`"
      }
    } else {
      part += ch;
    }
    ch = symb[pos++];
  }

  if (root === null) {
    root = part;
  } else {
    parts.push(part);
  }

  return {
    namespace: ns,
    root: root,
    parts: parts
  }
}

function resolveSymbol (env, parsed_symbol) {
  if (parsed_symbol.namespace) {

    var ns = env.scope.resolveNamespace(parsed_symbol.namespace) ||
             env.env.findNamespace(parsed_symbol.namespace);

    if (!ns) {
      throw "Couldn't find namespace `" + parsed_symbol.namespace + "`"
    }

    // If aliased, updated the parsed namespace.
    parsed_symbol.namespace = ns.name;

    env.env.current_namespace.requiresNamespace(ns);
    var scope = ns.scope;
  } else {
    var scope = env.scope;
  }

  return scope.resolve(mungeSymbol(parsed_symbol.root));
}

// Shared declaration checks
function declaration_guard (env, kind, id) {
  if (!isSymbol(id)) {
    throw "First argument to " + kind + " must be symbol."
  }

  var parsed_id = parseSymbol(id.name);

  if (parsed_id.namespace) {
    throw "Cannot " + kind + " into another namespace."
  }

  if (parsed_id.parts.length !== 0) {
    throw "Can't " + kind + " a multi-part id."
  }

  var munged_name = mungeSymbol(parsed_id.root);

  if (env.scope.logicalScoped(munged_name)) {
    throw "Cannot re" + kind + " " + id.name
  }

  return munged_name;
}

function declaration_val (val, walker, env, name) {
  if (val !== undefined) {
    val = walker(env)(val);
    if (val === null) {
      return undefined;
    } else if (val.type == "Fn") {
      val.id = Terr.Identifier(name);
    }

    env.scope.update(name, { node: val });
  }
  return val;
}

builtins = {

  '=': makeBinary('==='),
  '+': makeBinary('+'),
  '-': makeBinary('-'),
  'not=': makeBinary('!=='),
  'or': makeBinary('||'),
  'and': makeBinary('&&'),
  '>': makeBinary('>'),
  '>=': makeBinary('>='),
  '<': makeBinary('<'),
  '<=': makeBinary('<='),
  '/': makeBinary('/'),
  'instance?': makeBinary('instanceof'),
  'mod': makeBinary('%'),

  'not': makeUnary('!'),
  'xor': makeUnary('~'),
  'type': makeUnary('typeof'),

  'new': function (opts, callee) {
    var args = Array.prototype.slice.call(arguments, 2);
    var walker = opts.walker(opts.env);
    return Terr.New(walker(callee), args.map(walker));
  },

  'return': function (opts, arg) {
    var walker = opts.walker(opts.env);
    return Terr.Return(arg ? walker(arg) : undefined);
  },

  'get': function (opts, target, arg) {
    var walker = opts.walker(opts.env);
    return Terr.Member(walker(target), walker(arg));
  },

  "var": function (opts, id, val) {
    var walker = opts.walker,
        env = opts.env,
        ns_name = env.env.current_namespace.name,
        decls = [],
        inputs = Array.prototype.slice.call(arguments, 1);

    for (var i = 0; i < inputs.length; i += 2) {
      var id = inputs[i],
          val = inputs[i + 1],
          munged_name = declaration_guard(env, "var", id);

      if (env.scope.nameClash(munged_name)) {
        var js_name = env.genID(munged_name);
      } else {
        var js_name = munged_name;
      }

      if (env.scope.top_level) {
        var accessor = Terr.NamespaceGet(ns_name, munged_name, js_name);
      } else {
        var accessor = Terr.Identifier(js_name);
      }

      env.scope.addSymbol(munged_name, {
        type: 'any',
        accessor: accessor,
        js_name: js_name,
        export: false,
        top_level: env.scope.top_level
      });

      val = declaration_val(val, walker, env, munged_name);

      if (env.scope.top_level) {
        decls.push(Terr.NamespaceSet(ns_name, munged_name, js_name, val, "var"));
      } else {
        decls.push([accessor, val]);
      }
    }

    if (env.scope.top_level) {
      return Terr.Seq(decls);
    } else {
      return Terr.Var(decls);
    }

  },

  "def": function (opts, id, val) {
    var walker = opts.walker,
        env = opts.env,
        munged_name = declaration_guard(env, "def", id),
        ns_name = env.env.current_namespace.name,
        munged_ns = mungeSymbol(ns_name.replace(/\./g, '$')) + "$";

    if (env.scope.nameClash(munged_name)) {
      var js_name = munged_ns + env.genID(munged_name);
    } else {
      var js_name = munged_ns + munged_name;
    }

    var accessor = Terr.NamespaceGet(ns_name, munged_name, js_name);

    env.scope.addSymbol(munged_name, {
      type: 'any',
      accessor: accessor,
      js_name: js_name,
      export: true,
      top_level: true
    });

    val = declaration_val(val, walker, env, munged_name);

    return Terr.NamespaceSet(ns_name, munged_name, js_name, val, "var");
  },

  "lambda": function (opts, args) {

    var walker = opts.walker,
        env = opts.env;

    // COMPILE FN

    function compile_fn (args, body) {
      var formal_args = [];
      var rest_arg = null;

      var fn_env = env.newScope(true, true);

      for (var i = 0, len = args.length; i < len; ++i) {
        var arg = args[i];

        if (!isSymbol(arg)) {
          throw "Invalid formal arg " + arg;
        }

        var parsed_arg = parseSymbol(arg.name);

        if (parsed_arg.parts.length === 0) {
          if (parsed_arg.root == "&") {
            rest_arg = args[i + 1];

            if (!rest_arg || !isSymbol(rest_arg)) {
              throw "Invalid rest arg " + rest_arg;
            }

            var parsed_rest_arg = parseSymbol(rest_arg.name);

            if (parsed_rest_arg.parts.length !== 0) {
              throw "Invalid rest arg " + rest_arg;
            }
            if (i + 2 != args.length) {
              throw "Too many args following rest &"
            }
            break;
          } else {
            var munged_name = mungeSymbol(parsed_arg.root);
            var node = Terr.Identifier(munged_name);
            fn_env.scope.addSymbol(munged_name, { type: 'any', implicit: true, accessor: node });
            formal_args.push(node);
          }
        } else {
          throw "Invalid formal arg " + arg;
        }
      }

      fn_env.scope.addSymbol('arguments', { type: 'any', implicit: true, accessor: Terr.Identifier('arguments') });
      fn_env.scope.addSymbol('this', { type: 'any', implicit: true, accessor: Terr.Identifier('this') });

      if (rest_arg) {
        body.unshift(core.list(core.symbol("var"), rest_arg,
          core.list(core.symbol("Array.prototype.slice.call"),
            core.symbol("arguments"), formal_args.length)));
      }

      var walked_body = body.map(walker(fn_env));
      var terr_body = Terr.Seq(walked_body);

      return Terr.SubFn(formal_args, terr_body, formal_args.length, rest_arg != null);
    }

    // END COMPILE FN

    if (isList(args)) { // multiple arity function
      var arity_forms = Array.prototype.slice.call(arguments, 1);
    } else {
      var arity_forms = [core.list.apply(null, Array.prototype.slice.call(arguments, 1))]
    }

    var arity_map = {};
    var arities = [];
    var variadic = null;

    for (var i = 0, len = arity_forms.length; i < len; ++i) {

      var compiled = compile_fn(arity_forms[i].values[0], arity_forms[i].values.slice(1));

      if (compiled.variadic) {
        if (i !== arity_forms.length - 1) {
          throw "Variadic form must be in last position."
        }
        var variadic = compiled.arity;
        arity_map._ = compiled;
        arities.push("_");

        break;
      }

      if (arity_map[compiled.arity]) {
        throw "Cannot define same arity twice."
      } else if (compiled.arity < arities[arities.length - 1]) {
        throw "Multi-arity functions should be declared in ascending number of arguments."
      }

      arity_map[compiled.arity] = compiled;
      arities.push(compiled.arity);
    }

    return Terr.Fn(arity_map, arities, variadic);
  },

  "declare": function (opts) {
    var walker = opts.walker,
        env = opts.env;

    var symbs = Array.prototype.slice.call(arguments, 1);

    symbs.forEach(function (symb) {
      var parsed_symb = parseSymbol(symb.name);

      if (parsed_symb.parts.length > 0 || parsed_symb.namespace) {
        throw "Cannot declare " + symb.name
      }

      var munged = mungeSymbol(parsed_symb.root);
      env.scope.addSymbol(munged, {
        type: 'any',
        export: false,
        external: true,
        accessor: Terr.Identifier(munged)
      });
    });

    return Terr.Seq([]);
  },

  "ns": function (opts, ns) {
    opts.env.env.current_namespace = opts.env.env.getNamespace(ns.name);

    return Terr.Seq([]);
  },

  "refer": function (opts, symbol, alias) {
    var ns = opts.env.env.findNamespace(symbol.name);
    if (!ns) {
      throw "Couldn't resolve namespace `" + symbol.name + "`";
    }

    var alias = alias ? alias.name : null;

    opts.env.scope.refer(symbol.name, alias,
                         opts.env.env.findNamespace(symbol.name));

    return Terr.Seq([]);
  },

  "set!": function (opts) {
    var walker = opts.walker,
        env = opts.env;

    var settings = Array.prototype.slice.call(arguments, 1);

    if (settings.length % 2) {
      throw "set! takes an even number of arguments"
    }

    walker = walker(env);

    var seq = [];

    for (var i = 0, len = settings.length; i < len; i += 2) {
      var left = walker(settings[i]);
      var right = walker(settings[i + 1]);

      if (left.type == "NamespaceGet") {
        left.type = "NamespaceSet";
        left.value = right;
        left.declaration = "assign";

        seq.push(left);
      } else {
        seq.push(Terr.Assign(left, right));
      }
    }

    if (seq.length == 1) {
      return seq[0];
    } else {
      return Terr.Seq(seq);
    }

  },

  // Open a new logical scope, but not a new javascript scope, to allow block
  // insertion to work as expected.
  "do": function (opts) {
    var walker = opts.walker,
        env = opts.env;

    env = env.newScope(true, false);

    walker = walker(env);

    var args = Array.prototype.slice.call(arguments, 1);

    return Terr.Seq(args.map(walker));
  },

  // (for [i 0 len 10] (< i len) (set! i (inc i))
  //    i)

  "js-for": function (opts, init, test, update) {
    var walker = opts.walker,
        env = opts.env;

    env = env.newScope(true, false);

    var walker = walker(env);

    var init = walker(core.list(core.symbol('var')).concat(init));
    var test = walker(test);
    var update = walker(update);
    var body = Terr.Seq(Array.prototype.slice.call(arguments, 4).map(walker));

    return Terr.For(init, test, update, body);
  },

  // (while (< i 10) (inc i))

  "if": function (opts, test, cons, alt) {
    var walker = opts.walker,
        env = opts.env;

    walker = walker(env);

    return Terr.If(walker(test), cons !== undefined ? walker(cons) : undefined,
                                 alt !== undefined ? walker(alt) : undefined);
  },

  ".": function (opts, target, member) {
    var args = Array.prototype.slice.call(arguments, 3);
    var walker = opts.walker(opts.env);

    var parsed_member = parseSymbol(member.name);

    if (parsed_member.parts.length > 0 || parsed_member.namespace) {
      throw "Cannot . access " + member.name
    }

    return Terr.Call(
      Terr.Member(walker(target), Terr.Literal(parsed_member.root)),
      args.map(walker)
    );
  },

  "try": function (opts) {
    var walker = opts.walker,
        env = opts.env;

    var body = Array.prototype.slice.call(arguments, 1);
    var catch_clause = body.pop();

    if (!isList(catch_clause) || catch_clause.values.length < 2 || !isSymbol(catch_clause.values[0]) || catch_clause.values[0].name !== "catch") {
      throw "Invalid catch clause"
    }

    var catch_args = catch_clause.values[1];
    var catch_body = catch_clause.values.slice(2);

    if (!Array.isArray(catch_args) || catch_args.length !== 1 || !isSymbol(catch_args[0])) {
      throw "Invalid catch args."
    }

    var body_walker = walker(env);
    var body = Terr.Seq(body.map(body_walker));

    var catch_arg = catch_args[0];
    var parsed_catch_arg = parseSymbol(catch_arg.name);

    if (parsed_catch_arg.parts.length > 0 || parsed_catch_arg.namespace) {
      throw "Invalid catch arg."
    }

    var munged_name = mungeSymbol(parsed_catch_arg.root);

    var catch_env = env.newScope(true, false);
    catch_env.scope.addSymbol(munged_name, { type: 'any', accessor: Terr.Identifier(munged_name)});
    var catch_walker = walker(catch_env);
    catch_body = catch_body.map(catch_walker);

    return Terr.Try(body, Terr.Identifier(munged_name), Terr.Seq(catch_body), undefined);
  },

  "throw": function (opts, arg) {
    return Terr.Throw(opts.walker(opts.env)(arg));
  },

  "quote": function (opts, arg) {
    return opts.walker(opts.env.setQuoted("quote"))(arg);
  },

  "unquote": function (opts, arg) {
    return opts.walker(opts.env.setQuoted(false))(arg);
  },

  "unquote-splicing": function (opts, arg) {
    if (opts.env.quoted != "syntax") {
      throw "Cannot call unquote-splicing outside of syntax-quote."
    }
    var result = opts.walker(opts.env.setQuoted(false))(arg);
    result.$splice = true;
    return result;
  },

  "syntax-quote": function (opts, arg) {
    return opts.walker(opts.env.setQuoted("syntax"))(arg);
  }
}

function compile_eval (node, env) {

  var ENV = {
    get: function (namespace, name) {
      if (namespace === null) {
        return env.scope.resolve(name).value;
      }
      return env.findNamespace(namespace).scope.resolve(name).value;
    },
    set: function (namespace, name, value) {
      if (namespace === null) {
        env.scope.update(name, { value: value });
      } else {
        env.findNamespace(namespace).scope.update(name, { value: value });
      }
      return value;
    }
  };

  // TODO: better way od doing this
  Terr.INTERACTIVE = true;
  var compile_nodes = Terr.CompileToJS(node, "return");

  var js = codegen.generate(JS.Program(compile_nodes));

  // console.log("<--Compile Eval-->")
  // console.log(js);
  // console.log("<--Run Compile Eval-->");
  var ret = new Function('$ENV', js)(ENV);
  // console.log("<--End Compile Eval-->")

  return ret;
}

function loc (node, form) {
  if (node.loc) { form.loc = node.loc; }
  return form;
}

walk_handlers = {
  "List": function (node, walker, env) {

    // easier bound version
    var _loc = function (form) {
      return loc(node, form);
    }

    var head = node.values[0];
    var tail = node.values.slice(1);

    if (env.quoted) {

      if (head && isSymbol(head) && (head.name == 'unquote' ||
                                     head.name == "unquote-splicing")) {

      } else {
        var quoted_walker = walker(env);
        var unquoted_walker = walker(env.setQuoted(false));

        var list_symb = unquoted_walker(core.symbol('terrible.core/list'));
        var values = node.values.map(quoted_walker);

        if (env.quoted == "syntax") {

          var args = [];
          var root = null;

          var pack_args = function () {
            if (!root) {
              root = Terr.Call(list_symb, args);
              args = [];
            } else {
              root = Terr.Call(Terr.Member(root, Terr.Literal("push")), args);
              args = [];
            }
          }

          values.forEach(function (v) {
            if (v.$splice) {
              pack_args();
              root = Terr.Call(Terr.Member(root, Terr.Literal("concat")), [v]);
            } else {
              args.push(v);
            }
          });
          if (!root || args.length > 0) {
            pack_args();
          }

          return _loc(root);
        } else {
          return _loc(Terr.Call(
            list_symb,
            values
          ));
        }
      }
    }

    if (head && isSymbol(head)) {

      var parsed_head = parseSymbol(head.name);

      if (parsed_head.root == "") {
        walker = walker(env);
        var target = walker(tail[0]);
        tail = tail.slice(1).map(walker);

        parsed_head.parts.forEach(function (p) {
          target = Terr.Member(target, walker(p));
        });

        return _loc(Terr.Call(target, tail));
      }

      if (parsed_head.parts.length > 0) {
        walker = walker(env);
        return _loc(Terr.Call(walker(head), tail.map(walker)));
      }

      var name = parsed_head.root;

      if (builtins[name]) {
        return _loc(builtins[name].apply(null, [{
          walker: walker,
          env: env
        }].concat(tail)));
      }

      var resolved = resolveSymbol(env, parsed_head);

      if (resolved.value) {
        var m = resolved.value;
        if (m.$macro === true && typeof m === "function") {
          return _loc(walker(env)(m.apply(null, tail)));
        }
      }

      if (resolved === false) {
        throw "Couldn't resolve " + name;
      }

      walker = walker(env);

      if (resolved.node && resolved.node.type == "Fn") {

        var fn_node = resolved.node;

        var target = walker(head);

        if (env.env.interactive) {
          // arities could change out underneath us, so don't specialise here
        } else if (fn_node.arities.length == 1) { // mono-arity, no sub-dispatch
          if (fn_node.variadic) {
            if (tail.length < fn_node.variadic) {
              throw "Function `" + name + "` expects at least " + fn_node.variadic + " arguments, but " + tail.length + " provided."
            }
          } else { // monadic
            if (fn_node.arities[0] != tail.length) {
              throw "Function `" + name + "` expects " + fn_node.arities[0] + " arguments, " + tail.length + " provided."
            }
          }
        } else { // multi-arity
          if (~fn_node.arities.indexOf(tail.length)) {
            target = Terr.Member(target, Terr.Literal("$" + tail.length));
          } else { // no straight arity
            if (fn_node.variadic && tail.length >= fn_node.variadic) {
              target = Terr.Member(target, Terr.Literal("$_"));
            } else {
              throw "Function `" + name + "` expects " + fn_node.arities + " arguments, " + tail.length + " provided."
            }
          }
        }
      } else if (resolved.type == "any") {

      } else {
        throw "Cannot call " + resolved.type + " `" + name + "` as function."
      }

      return _loc(Terr.Call(loc(head, target || walker(head)),
                            tail.map(walker)));
    } else if (head && isList(head)) {
      var walker = walker(env);
      return _loc(Terr.Call(walker(head), tail.map(walker)));
    } else {
      throw "Cannot call `" + JSON.stringify(head) + "` as function."
    }
  },

  "Symbol": function (node, walker, env) {

    if (env.quoted == "quote" || builtins[node.name]) {
      walker = walker(env.setQuoted(false));
      return loc(node, Terr.Call(
        walker(core.symbol('terrible.core/symbol')),
        [Terr.Literal(node.name)]
      ));
    } else if (env.quoted == "syntax") {

      var parsed_node = parseSymbol(node.name);
      var resolved = resolveSymbol(env, parsed_node);

      if (!resolved) {
        console.trace();
        throw "Couldn't resolve `" + node.name + "`";
      }

      walker = walker(env.setQuoted(false));

      var ns = parsed_node.namespace || env.env.current_namespace.name;

      return loc(node, Terr.Call(
        walker(core.symbol('terrible.core/symbol')),
        [Terr.Literal(ns + "/" + [parsed_node.root].concat(parsed_node.parts).join("."))]
      ));
    }

    var parsed_node = parseSymbol(node.name);
    var resolved = resolveSymbol(env, parsed_node);

    if (!resolved) {
      console.trace();
      throw "Couldn't resolve `" + node.name + "`";
    }

    if (resolved.top_level) {
      var root = Terr.NamespaceGet(
        parsed_node.namespace || env.env.current_namespace.name,
        mungeSymbol(parsed_node.root),
        resolved.accessor.js_name
      );
    } else {
      var root = resolved.accessor;
    }

    var walker = walker(env);

    for (var i = 0, len = parsed_node.parts.length; i < len; ++i) {
      root = Terr.Member(root, walker(parsed_node.parts[i]));
    }

    return loc(node, root);
  },

  "Keyword": function (node, walker, env) {
    return walker(env)(core.list(core.symbol("terrible.core/keyword"), node.toString()));

    // Terr.Call(
    //   Terr.Member(
    //     Terr.Identifier("refer$terrible$core"), Terr.Literal("keyword")
    //   ),
    //   [Terr.Literal(node.toString())]
    // );
  }
}

walk_handler = function (node, walker, env) {
  if (node instanceof core.list) {
    return walk_handlers.List(node, walker, env);
  } if (node instanceof core.keyword) {
    return walk_handlers.Keyword(node, walker, env);
  } else if (node instanceof core.symbol) {
    return walk_handlers.Symbol(node, walker, env);
  } else if (Array.isArray(node)) {
    return Terr.Arr(node.map(walker(env)));
  } else if (node === null) {
    return Terr.Literal(null);
  } else if (typeof node == 'object') {

    var props = [];
    walker = walker(env);

    for (var k in node) {
      props.push({key: k, value: walker(node[k])});
    }

    return Terr.Obj(props);
  } else {
    return Terr.Literal(node);
  }
}

function WalkingEnv(env, scope, quoted) {
  this.env = env;
  this.scope = scope;
  this.quoted = quoted;
}

WalkingEnv.prototype.genID = function (root) {
  return this.env.genID(root);
}

WalkingEnv.prototype.newScope = function (logical, js) {
  return new WalkingEnv(this.env, this.scope.newScope(logical, js), this.quoted);
}

WalkingEnv.prototype.setQuoted = function (quoted) {
  return new WalkingEnv(this.env, this.scope.newScope(false, false), quoted);
}

function process_form (form, env, quoted) {

  // console.log("form", require('util').inspect(form, false, 20));

  var walking_env = new WalkingEnv(env, env.current_namespace.scope, quoted);

  var ast = walker(walk_handler, form, walking_env);
  // console.log("ast", require('util').inspect(ast, false, 20));
  var value = compile_eval(ast, env);

  // console.log(require('util').inspect(scope, false, 10));

  return { ast: ast, value: value };
}

exports.process = process_form;

})()
},{"./core":3,"./js":4,"./terr-ast":22,"./walker":23,"escodegen":6}],20:[function(require,module,exports){
(function(){// A partial port and modification of the Clojure reader
// https://github.com/clojure/clojure/blob/master/src/jvm/clojure/lang/LispReader.java

var core = require('./core')

// Buffer

function EOFError () {}

function Buffer (string) {
  this.string = string;
  this.pos = 0;
  this.line = 0;
  this.col = 0;
}

Buffer.prototype.read1 = function () {
  if (this.pos === this.string.length) {
    ++this.pos;
    ++this.col;
    return " ";
  } else if (this.pos > this.string.length) {
    throw new EOFError();
  } else {
    var ch = this.string[this.pos];
    ++this.pos;
    if (ch == "\n") {
      ++this.line;
      this.col = 0;
    } else {
      ++this.col;
    }
    return ch;
  }
}

Buffer.prototype.getPos = function () {
  return { line: this.line, column: this.col }
}

Buffer.prototype.save = function () {
  return {
    line: this.line,
    col: this.col,
    pos: this.pos
  }
}

Buffer.prototype.restore = function (d) {
  this.line = d.line;
  this.col = d.col;
  this.pos = d.pos;
}

Buffer.prototype.lookahead = function (n) {
  return this.string.substring(this.pos, this.pos + n);
}

Buffer.prototype.unread = function (str) {
  this.pos -= str.length;
}

Buffer.prototype.append = function (str) {
  this.string += str;
}

Buffer.prototype.truncate = function () {
  this.string = this.string.substring(0, this.pos);
}

Buffer.prototype.remaining = function () {
  return this.string.substring(this.pos);
}

Buffer.prototype.locationFromState = function (start_state) {
  return {
    start: {
      line: start_state.line,
      column: start_state.col
    },
    end: {
      line: this.line,
      column: this.col
    }
  }
}

// Reader

var symbolPattern = /^([:][^\d\s]|[^:\d\s])[^\n\t\r\s,]*$/

// Reader macros

function unmatchedDelimiter(c) {
  return function () {
    throw "UnmatchedDelimiter `" + c + "`";
  }
}

function listReader (buffer, openparen) {
  return core.list.apply(null, this.readDelimitedList(')', buffer));
}

function vectorReader (buffer, openparen) {
  return this.readDelimitedList(']', buffer);
}

function hashReader (buffer, openparen) {
  var hash = this.readDelimitedList('}', buffer);
  if (hash.length % 2) {
    throw "Hash must contain even number of forms";
  }
  var obj = {}
  for (var i = 0, len = hash.length; i < len; i += 2) {
    var left = hash[i];
    var right = hash[i+1];
    obj[left] = right;
  }
  return obj;
}

function commentReader (buffer) {
  while (!buffer.read1().match(/[\n\r]/));
  return buffer;
}

function quoteReader (buffer, apostrophe) {
  return core.list(core.symbol('quote'), this.read(buffer));
}

function syntaxQuoteReader (buffer, tick) {
  return core.list(core.symbol('syntax-quote'), this.read(buffer));
}

function unquoteReader (buffer, apostrophe) {
  if (buffer.lookahead(1) == "@") {
    buffer.read1();
    return core.list(core.symbol('unquote-splicing'), this.read(buffer));
  } else {
    return core.list(core.symbol('unquote'), this.read(buffer));
  }
}

function splatReader (buffer, tilde) {
  return core.list(core.symbol('splat'), this.read(buffer));
}

function stringReader (buffer, quote) {
  var str = "", docquote = false, ch;

  if (buffer.lookahead(2) == '""') {
    var docquote = true;
    buffer.read1();
    buffer.read1();
  }

  while (ch = buffer.read1()) {
    if (ch == '"') {
      if (docquote) {
        if (buffer.lookahead(2) == '""') {
          buffer.read1();
          buffer.read1();
          break;
        } else {
          str += ch;
          continue;
        }
      } else {
        break;
      }
    }

    if (ch == "\\") {
      ch = buffer.read1()

      if (ch == "t") { ch = "\t"; }
      else if (ch == "r") { ch = "\r"; }
      else if (ch == "n") { ch = "\n"; }
      else if (ch == "b") { ch = "\b"; }
      else if (ch == "f") { ch = "\f"; }
      else if (ch == "\\" || ch == '"') { }
      else { throw "Unsupported escape \\" + ch + JSON.stringify(buffer.getPos()) }
    }

    str += ch;
  }

  return str;
}

dispatchReader = function (buffer, hash) {
  var ch = buffer.read1();
  return this.dispatch_macros[ch].call(this, buffer, ch);
}

function findArg (reader, n) {
  for (var i = 0, len = reader.ARG_ENV.length; i < len; ++i) {
    var arg = reader.ARG_ENV[i];
    if (n === arg.n) return arg;
  }
}

gen_arg = function (reader, n) {
  var root = (n === -1) ? "rest" : "arg$" + n;
  return core.symbol(reader.genID(root));
}

function registerArg (reader, n) {
  if (!reader.ARG_ENV) {
    throw "arg lit not in #()"
  }

  var arg = findArg(reader, n);
  if (arg == null) {
    var symbol = gen_arg(reader, n);
    reader.ARG_ENV.push({n: n, symbol: symbol});
    return symbol;
  } else {
    return arg.symbol;
  }
}

argReader = function (buffer, percent) {
  if (!this.ARG_ENV) {
    return this.readToken(buffer, percent);
  }

  var ch = buffer.lookahead(1);

  if (this.isWhitespace(ch) || this.isTerminatingMacro(ch)) {
    return registerArg(this, 1);
  } else if (ch == ".") {
    var root = registerArg(this, 1);
    buffer.read1(); // throw away

    var symb = this.read(buffer);
    symb.parts.unshift(root.name());

    return symb;
  } else if (this.isDigit(ch)) {

    var n = buffer.read1();
    var buffer_state = buffer.save();
    ch = buffer.read1();

    while (this.isDigit(ch)) {
      n += ch;
      buffer_state = buffer.save();
      ch = buffer.read1();
    }

    buffer.restore(buffer_state);

    var n = parseFloat(n);

    var root = registerArg(this, n);

    if (buffer.lookahead(1) == ".") {
      buffer.read1();
      var symb = this.read(buffer);
      symb.parts.unshift(root.name());
      return symb;
    } else {
      return root;
    }
  }

  var n = this.read(buffer);

  if (n instanceof core.symbol && n.name == '&') {
    return this.registerArg(-1);
  }

  if (typeof n != 'number') {
    throw 'arg literal must be %, %& or %n ' + JSON.stringify(buffer.getPos())
  }

  return this.registerArg(n);
}

fnReader = function (buffer, openparen) {
  buffer.unread(openparen);

  var originalENV = this.ARG_ENV;

  this.ARG_ENV = [];

  var form = this.read(buffer);

  if (originalENV && this.ARG_ENV.length != 0) {
    throw "Cannot nest lambdas with arguments. " + JSON.stringify(buffer.getPos())
  }

  if (this.ARG_ENV.length > 0) {
    this.ARG_ENV.sort(function (a, b) {
      if (a.n == -1) return 1;
      if (b.n == -1) return -1;
      return a.n > b.n;
    });

    if (this.ARG_ENV[this.ARG_ENV.length - 1].n === -1) {
      var rest_arg = this.ARG_ENV.pop().symbol;
    } else {
      var rest_arg = null;
    }

    var args = [];
    for (var i = 0, len = this.ARG_ENV.length; i < len; ++i) {
      args[this.ARG_ENV[i].n - 1] = this.ARG_ENV[i].symbol;
    }

    for (var i = 0, len = args.length; i < len; ++i) {
      if (!args[i]) {
        args[i] = gen_arg(this, i + 1);
      }
    }

    if (rest_arg) {
      args.push(core.symbol('&'));
      args.push(rest_arg);
    }
  } else {
    var args = [];
  }

  this.ARG_ENV = originalENV;

  if (form.values[0] && !(form.values[0] instanceof core.symbol)) {
    return core.list.apply(null, [core.symbol('lambda'), args].concat(form.values));
  } else {
    return core.list(core.symbol('lambda'), args, form);
  }
}

function Reader (id_generator) {
  this.genID = id_generator;
}

Reader.prototype.macros = {
  "[": vectorReader,
  "{": hashReader,
  "(": listReader,
  "]": unmatchedDelimiter("]"),
  "}": unmatchedDelimiter("}"),
  ")": unmatchedDelimiter(")"),
  ";": commentReader,
  "`": syntaxQuoteReader,
  "'": quoteReader,
  "~": unquoteReader,
  "@": splatReader,
  '"': stringReader,
  '%': argReader,
  '#': dispatchReader
}

Reader.prototype.dispatch_macros = {
  '(': fnReader
}

Reader.prototype.isWhitespace = function (str) { return str.match(/[\t\r\n,\s]/); }
Reader.prototype.isDigit = function (str) { return /^[0-9]$/.exec(str); }
Reader.prototype.isNumber = function (n) { return !isNaN(parseFloat(n)) && isFinite(n); }
Reader.prototype.isTerminatingMacro = function (ch) {
  return this.macros[ch] && ch != '#' && ch != '\'' && ch != '%'
}

function annotateLocation (form, buffer, start_state) {
  if (form !== null && typeof form === "object") {
    form.loc = buffer.locationFromState(start_state);
  }
  return form;
}

Reader.prototype.read = function (buffer) {
  while (true) {
    var ch, macro;

    var start_state = buffer.save();
    var ch = buffer.read1();

    while (this.isWhitespace(ch)) {
      start_state = buffer.save();
      ch = buffer.read1();
    }

    if (this.isDigit(ch)) {
      return this.readNumber(buffer, ch);
    }

    if (macro = this.macros[ch]) {
      var ret = macro.call(this, buffer, ch);
      if (ret == buffer) {
        continue;
      } else {
        return annotateLocation(ret, buffer, start_state);
      }
    }

    if (ch == '+' || ch == '-') {
      var buffer_state = buffer.save();
      var ch2 = buffer.read1();
      if (this.isDigit(ch2)) {
        var n = this.readNumber(buffer, ch2);
        return annotateLocation(core.list(core.symbol(ch), n), buffer, start_state);
      } else {
        buffer.restore(buffer_state);
      }
    }

    return annotateLocation(this.readToken(buffer, ch), buffer, start_state);
  }
}

Reader.prototype.readNumber = function (buffer, s) {
  while (true) {
    var buffer_state = buffer.save();
    var ch = buffer.read1();
    if (this.isWhitespace(ch) || this.macros[ch]) {
      buffer.restore(buffer_state);
      break;
    }
    s += ch;
  }

  if (!this.isNumber(s)) {
    throw "Invalid number: " + s + " " + JSON.stringify(buffer.getPos())
  }

  return parseFloat(s);
}

Reader.prototype.reifySymbol = function (s) {
  if (s == 'nil' || s == 'null') return null;
  if (s == 'true') return true;
  if (s == 'false') return false;
  if (s == 'undefined') return core.symbol('undefined');
  if (symbolPattern.exec(s)) return core.symbol(s);

  throw "Invalid token: #{s}";
}

Reader.prototype.readToken = function (buffer, s) {
  if (s == ":") { // keyword
    var kw = "";
    while (true) {
      var buffer_state = buffer.save();
      var ch = buffer.read1();
      if (this.isWhitespace(ch) || this.isTerminatingMacro(ch)) {
        buffer.restore(buffer_state);
        if (kw === "") {
          return core.symbol(s);
        } else {
          return core.keyword(kw);
        }
      }
      kw += ch;
    }
  } else { // symbol
    while (true) {
      var buffer_state = buffer.save();
      var ch = buffer.read1();
      if (this.isWhitespace(ch) || this.isTerminatingMacro(ch)) {
        buffer.restore(buffer_state);
        return this.reifySymbol(s);
      }
      s += ch;
    }
  }
}

Reader.prototype.readDelimitedList = function (endchar, buffer) {
  var forms = [], ch, macro, ret, buffer_state;
  while (true) {
    buffer_state = buffer.save();
    ch = buffer.read1();
    while (this.isWhitespace(ch)) {
      buffer_state = buffer.save();
      ch = buffer.read1();
    }

    if (ch === endchar) break;

    if (macro = this.macros[ch]) {
      ret = macro.call(this, buffer, ch);
    } else {
      buffer.restore(buffer_state);
      ret = this.read(buffer);
    }
    if (ret != buffer) {
      forms.push(ret);
    }
  }

  return forms;
}

Reader.prototype.readString = function (str) {
  return this.newReadSession().readString(str);
}

Reader.prototype.newReadSession = function () {
  var buffer = new Buffer(""),
      reader = this;

  return {
    buffer: buffer,
    readString: function (str) {
      buffer.append(str);
      var forms = [], buffer_state;
      try {
        buffer_state = buffer.save();
        while (form = reader.read(buffer)) {
          forms.push(form);

          form.$text = buffer.string.substring(buffer_state.pos, buffer.pos);

          buffer_state = buffer.save();
        }
      } catch (exception) {
        if (exception instanceof EOFError) {
          buffer.restore(buffer_state);
          return forms;
        } else {
          buffer.restore(buffer_state);
          forms.$exception = exception;
          return forms;
        }
      }
      return forms;
    }
  }
}

// Debug and testing

print_str = function (node) {
  if (node === null) {
    return "null";
  } if (node.$isList) {
    return "(" + node.values.map(print_str).join(" ") + ")";
  } else if (node.type == "Symbol") {

    var root = node.parts[0];

    for (var i = 1, len = node.parts.length; i < len; ++i) {
      root += "[" + print_str(node.parts[i]) + "]"
    }

    return root;
  } else if (node.type == "Keyword") {
    return ":" + node.toString();
  } else if (Array.isArray(node)) {
    return "[" + node.map(print_str).join(" ") + "]";
  } else if (typeof node == "object") {
    return "{" + Object.keys(node).map(function (k) {
      return print_str(k) + ' ' + print_str(node[k])
    }).join(" ") + "}"
  } else {
    return JSON.stringify(node);
  }
}

try_parse = function (str) {
  result = reader.readString(str);
  console.log(require('util').inspect(result, false, 10));
  console.log(result.map(print_str).join("\n"))
}

// var reader = new Reader()
// try_parse("(a.b[(+ 1 2)][:a] [1 2 3] {:a 5 :b 6})");
// try_parse('(a """my fun " string""")')

exports.Reader = Reader
exports.printString = print_str;

})()
},{"./core":3,"util":27}],21:[function(require,module,exports){
var Environment = require('../Environment').Environment;

// INPUT OUTPUT

var target = "browser";
var mode = "library";
var interactive = false;
var minify = false;

function compileTerrible(text) {
  var env = new Environment(target, interactive);
  var messages = [];
  env.scope.expose('print', function (v) {
    messages.push("> " + v);
  });

  try {
    env.evalText(text, function (form, source, exc) {
      messages.push("! " + source.trim());
      messages.push("! " + (exc.message ? exc.message : exc));
      if (exc.stack) {
        messages.push("! " + exc.stack);
      }
    });
  } catch (exc) {
    messages.push("! " + (exc.message ? exc.message : exc));
    if (exc.stack) {
      messages.push("! " + exc.stack);
    }
  }

  var js = env.asJS(mode);

  if (minify) {
    var parsed = UglifyJS.parse(js, {});
    parsed.figure_out_scope();
    var compressor = UglifyJS.Compressor({});
    var compressed = parsed.transform(compressor);
    js = compressed.print_to_string({beautify: true});
  }

  return { js: js, log: messages };
}

var last_compile = null;

function doCompile(forced) {
  var this_compile = document.getElementById('terrible-input').value;
  if (forced === true || this_compile != last_compile) {
    var compile_result = compileTerrible(this_compile);
    document.getElementById('terrible-output').value = compile_result.js;
    document.getElementById('terrible-log').value = compile_result.log.join("\n");
  }
  last_compile = this_compile;
}

document.getElementById('terrible-input').addEventListener('keyup', doCompile);

document.getElementById('environment-target').addEventListener('change',
  function () {
    var el = document.getElementById('environment-target');
    target = el.value;
    doCompile(true);
  }
);

document.getElementById('environment-mode').addEventListener('change',
  function () {
    var el = document.getElementById('environment-mode');
    mode = el.value;
    doCompile(true);
  }
);

document.getElementById('environment-interactive').addEventListener('change',
  function () {
    var el = document.getElementById('environment-interactive');
    interactive = el.checked;
    doCompile(true);
  }
);

document.getElementById('environment-minify').addEventListener('change',
  function () {
    var el = document.getElementById('environment-minify');
    minify = el.checked;
    doCompile(true);
  }
);

doCompile();

// REPL

window.replEnvironment = new Environment("browser", false);

function addResult(form, value, result_class) {
  var el = document.getElementById('evaled-forms');
  var new_el = document.createElement('div');
  new_el.setAttribute('class', 'evaled');

  var form_el = document.createElement('pre');
  form_el.setAttribute('class', 'form');
  form_el.innerText = form;
  new_el.appendChild(form_el);

  var value_el = document.createElement('pre');
  value_el.setAttribute('class', result_class);
  value_el.innerText = value;
  new_el.appendChild(value_el);

  el.appendChild(new_el);

  el.scrollTop = el.scrollHeight;
}

function replEval(text) {
  var results = replEnvironment.evalText(text + "\n");

  results.forEach(function (result) {
    if (result.exception) {
      addResult(result.text.trim(), result.exception, "value exception");
    } else {
      addResult(result.text.trim(), result.value, "value");
    }
  });
}

function replSubmit () {
  var el = document.getElementById('repl-input');
  replEval(el.value);
  el.value = replEnvironment.readSession.buffer.remaining().trim();
  replEnvironment.readSession.buffer.truncate();
}

document.getElementById('repl-submit').addEventListener('click', replSubmit);

document.getElementById('repl-input').addEventListener('keypress', function (e) {
  if (e.shiftKey && e.which == 13) {
    e.preventDefault();
    replSubmit();
  }
})

// replEval("(+ 1 2)");
// replEval("(defn inc [i] (+ i 1))");
// replEval("(inc 5)");

// Toggles

document.getElementById('repl-toggle').addEventListener('click', function () {
  document.querySelector('body').setAttribute('class', 'repl');
});

document.getElementById('io-toggle').addEventListener('click', function () {
  document.querySelector('body').setAttribute('class', 'input-output');
});

},{"../Environment":1}],22:[function(require,module,exports){
var JS = require('./JS');

var Terr = exports;

Terr.INTERACTIVE = false;

function intoBlock (node, mode) {
  if (node !== undefined) {
    var r = Terr.CompileToJS(node, mode);
    if (r.length == 1) {
      return r[0];
    } else {
      return JS.Block(r);
    }
  } else {
    return undefined;
  }
}

var compilers = {
  Fn: {
    fields: ['bodies', 'arities', 'variadic'],
    compile: function (node, mode) {
      var bodies = node.arities.map(function (k) {
        if (node.$noReturn) {
          node.bodies[k].$noReturn = true;
        }
        return Terr.CompileToJS(node.bodies[k], "expression");
      });

      if (node.id) {
        var fndef = Terr.CompileToJS(node.id, "expression");
      } else {
        var fndef = JS.Identifier("$fndef");
      }

      if (node.arities.length == 1) {
        var fn = bodies[0];

        if (node.id) {
          fn.id = fndef;
        }

        if (mode == "statement") {
          if (fn.id) {
            fn.type = "FunctionDeclaration";
            return fn;
          } else {
            return [JS.ExpressionStatement(fn)];
          }
        } else if (mode == "return") {
          return [JS.Return(fn)];
        } else if (mode == "expression") {
          return fn;
        }
      } else {

        if (node.variadic !== null) {
          var max_arity = Math.max.apply(Math, node.arities.slice(0, node.arities.length - 1).concat([node.variadic]));
        } else {
          var max_arity = Math.max.apply(Math, node.arities);
        }

        var dispatch_args = [];
        for (var i = 0; i < max_arity; ++i) {
          dispatch_args.push(JS.Identifier("$" + i));
        }

        var args_len = JS.Identifier('$args_len');

        var dispatch_body = [JS.VariableDeclaration([
          JS.VariableDeclarator(
            args_len,
            JS.MemberExpressionComputed(JS.Identifier("arguments"), JS.Literal("length"))
          )
        ])];

        var closure_body = [];

        node.arities.forEach(function (arity, i) {

          var app_name = JS.Literal("$" + arity);

          if (arity == "_") {
            dispatch_body.push(
              JS.IfStatement(
                JS.BinaryExpression(args_len, ">=", JS.Literal(node.variadic)),
                JS.Return(JS.CallExpression(
                  JS.MemberExpressionComputed(
                    JS.MemberExpressionComputed(fndef, app_name),
                    JS.Literal("apply")
                  ),
                  [JS.Identifier("this"), JS.Identifier("arguments")]
                ))
              )
            )
          } else {
            dispatch_body.push(
              JS.IfStatement(
                JS.BinaryExpression(args_len, "==", JS.Literal(arity)),
                JS.Return(JS.CallExpression(
                  JS.MemberExpressionComputed(
                    JS.MemberExpressionComputed(fndef, app_name),
                    JS.Literal("call")
                  ),
                  [JS.Identifier("this")].concat(dispatch_args.slice(0, arity))
                ))
              )
            )
          }

          closure_body.push(
            JS.ExpressionStatement(JS.AssignmentExpression(
              JS.MemberExpressionComputed(fndef, app_name),
              "=",
              bodies[i]
            ))
          );
        });

        dispatch_body.push(JS.ThrowStatement(JS.Literal("No matching arity.")));

        var dispatch_fn = JS.FunctionDeclaration(fndef, dispatch_args, dispatch_body);

        closure_body.unshift(dispatch_fn);

        if (mode == "return") {
          closure_body.push(JS.Return(fndef));
          return closure_body;
        } else if (mode == "statement") {
          return closure_body;
        } else {
          closure_body.push(JS.Return(fndef));
          return JS.CallExpression(JS.FunctionExpression([], closure_body), []);
        }
      }
    }
  },

  SubFn: {
    fields: ['args', 'body', 'arity', 'variadic'],
    compile: function (node, mode) {
      return JS.FunctionExpression(
        node.args.map(function (n) { return Terr.CompileToJS(n, "expression"); }),
        Terr.CompileToJS(node.body, node.$noReturn ? "statement" : "return")
      )
    }
  },

  Identifier: {
    fields: ['name'],
    compile: function (node, mode) {
      return ExpressionToMode(loc(node, JS.Identifier(node.name)), mode);
    }
  },

  NamespaceGet: {
    fields: ['namespace', 'name', 'js_name'],
    compile: function (node, mode) {
      if (!Terr.INTERACTIVE) {
        return compilers.Identifier.compile(
          loc(node, {name: node.js_name}), mode);
      }

      return Terr.CompileToJS(Terr.Call(
        Terr.Member(Terr.Identifier("$ENV"), Terr.Literal("get")),
        [ Terr.Literal(node.namespace),
          Terr.Literal(node.name) ]
      ), mode);
    }
  },

  NamespaceSet: {
    fields: ['namespace', 'name', 'js_name', 'value', 'declaration'],
    compile: function (node, mode) {
      if (!Terr.INTERACTIVE) {
        if (node.declaration == "var") {
          return compilers.Var.compile(loc(node, {
            pairs: [[Terr.Identifier(node.js_name), node.value]]
          }), mode);
        } else {
          return compilers.Assign.compile(loc(node, {
            left: Terr.Identifier(node.js_name),
            right: node.value
          }), mode);
        }
      }

      return Terr.CompileToJS(Terr.Call(
        Terr.Member(Terr.Identifier("$ENV"), Terr.Literal("set")),
        [ Terr.Literal(node.namespace),
          Terr.Literal(node.name),
          node.value ]
      ), mode);
    }
  },

  Seq: {
    fields: ['values'],
    compile: function (node, mode) {
      var statements = [];
      for (var i = 0, len = node.values.length; i < len; ++i) {
        if (i + 1 == len && (mode == "expression" || mode == "return")) {
          statements = statements.concat(Terr.CompileToJS(node.values[i], "return"));
        } else {
          statements = statements.concat(Terr.CompileToJS(node.values[i], "statement"));
        }
      }

      if (mode == "expression") {
        return JS.CallExpression(JS.FunctionExpression([], statements), []);
      } else {
        return statements;
      }
    }
  },

  Var: {
    fields: ['pairs'],
    compile: function (node, mode) {

      var symb, expr;

      var mapped = node.pairs.map(function (pair) {
        symb = Terr.CompileToJS(pair[0], "expression");
        expr = Terr.CompileToJS(pair[1], "expression");
        return JS.VariableDeclarator(symb, expr);
      });

      var decl = JS.VariableDeclaration(mapped);

      if (mode == "expression") {
        return expr;
      } else if (mode == "statement") {
        return [decl];
      } else if (mode == "return") {
        return [decl, JS.Return(symb)];
      }
    }
  },

  If: {
    fields: ['test', 'cons', 'alt'],
    compile: function (node, mode) {
      var test = Terr.CompileToJS(node.test, "expression");

      if (mode == "expression") {
        return JS.ConditionalExpression(test,
          node.cons ? Terr.CompileToJS(node.cons, "expression") : undefined,
          node.alt ? Terr.CompileToJS(node.alt, "expression") : JS.Identifier("undefined"))
      } else if (mode == "statement" || mode == "return") {
        return [JS.IfStatement(test,
                  intoBlock(node.cons, mode),
                  intoBlock(node.alt, mode))]
      }
    }
  },

  Literal: {
    fields: ['value'],
    compile: function (node, mode) {
      return ExpressionToMode(JS.Literal(node.value), mode);
    }
  },

  Try: {
    fields: ['body', 'catch_arg', 'catch', 'finally'],
    compile: function (node, mode) {
      if (mode == "expression" || mode == "return") {
        var sub_mode = "return";
      } else {
        var sub_mode = "statement";
      }

      var tryStatement = JS.TryStatement(
        JS.Block(Terr.CompileToJS(node.body, sub_mode)),
        JS.CatchClause(
          Terr.CompileToJS(node.catch_arg, "expression"),
          JS.Block(Terr.CompileToJS(node.catch, sub_mode))
        ),
        node.finally ? JS.Block(Terr.CompileToJS(node.finally, "statement"))
                     : undefined
      )

      if (mode == "statement" || mode == "return") {
        return [tryStatement];
      } else {
        return JS.CallExpression(JS.FunctionExpression([], [tryStatement]), []);
      }
    }
  },

  Member: {
    fields: ['left', 'right'],
    compile: function (node, mode) {
      return ExpressionToMode(JS.MemberExpressionComputed(
        Terr.CompileToJS(node.left, "expression"),
        Terr.CompileToJS(node.right, "expression")
      ), mode);
    }
  },

  Obj: {
    fields: ['properties'],
    compile: function (node, mode) {
      var props = [];
      for (var i = 0, len = node.properties.length; i < len; ++i) {
        var prop = node.properties[i];
        props.push({
          type: 'Property',
          key: JS.Literal(prop.key),
          value: Terr.CompileToJS(prop.value, "expression"),
          kind: 'init'
        });
      }

      return ExpressionToMode({ type: "ObjectExpression", properties: props }, mode);
    }
  },

  Assign: {
    fields: ['left', 'right'],
    compile: function (node, mode) {
      return ExpressionToMode(loc(node, JS.AssignmentExpression(
        Terr.CompileToJS(node.left, "expression"),
        "=",
        Terr.CompileToJS(node.right, "expression")
      )), mode);
    }
  },

  Binary: {
    fields: ['left', 'op', 'right'],
    compile: function (node, mode) {
      return ExpressionToMode(loc(node, JS.BinaryExpression(
        Terr.CompileToJS(node.left, "expression"),
        node.op,
        Terr.CompileToJS(node.right, "expression")
      )), mode);
    }
  },

  Unary: {
    fields: ['op', 'expr'],
    compile: function (node, mode) {
      return ExpressionToMode(loc(node, JS.UnaryExpression(
        node.op,
        Terr.CompileToJS(node.expr, "expression")
      )), mode);
    }
  },

  Call: {
    fields: ['target', 'args'],
    compile: function (node, mode) {
      return ExpressionToMode(loc(node, JS.CallExpression(
        Terr.CompileToJS(node.target, "expression"),
        node.args.map(function (a) {
          return Terr.CompileToJS(a, "expression");
        })
      )), mode);
    }
  },

  Arr: {
    fields: ['values'],
    compile: function (node, mode) {
      return ExpressionToMode(loc(node, JS.ArrayExpression(
        node.values.map(function (a) {
          return Terr.CompileToJS(a, "expression");
        })
      )), mode);
    }
  },

  Return: {
    fields: ['expression'],
    compile: function (node, mode) {
      if (mode == "expression") {
        throw "Return in expression position? Is this real?"
      }
      return [loc(node,
                  JS.Return(Terr.CompileToJS(node.expression, "expression")))];
    }
  },

  New: {
    fields: ['callee', 'args'],
    compile: function (node, mode) {
      return ExpressionToMode(JS.NewExpression(
        Terr.CompileToJS(node.callee, "expression"),
        node.args.map(function (a) {
          return Terr.CompileToJS(a, "expression");
        })
      ), mode);
    }
  },

  For: {
    fields: ['init', 'test', 'update', 'body'],
    compile: function (node, mode) {
      if (mode == "expression") {
        console.log("For not supported in expression position.")
        throw "For not supported in expression position."
      }

      var for_statement = JS.ForStatement(
        intoBlock(node.init, "statement"),
        Terr.CompileToJS(node.test, "expression"),
        Terr.CompileToJS(node.update, "expression"),
        intoBlock(node.body, "statement")
      )

      return [for_statement];
    }
  },

  Throw: {
    fields: ['expression'],
    compile: function (node, mode) {
      var statement = JS.ThrowStatement(Terr.CompileToJS(node.expression, "expression"));
      if (mode == "expression") {
        return JS.CallExpression(JS.FunctionExpression([], [statement]), []);
      } else {
        return [statement];
      }
    }
  }
}

function loc (node, js) {
  if (node.loc) {
    js.loc = node.loc;
  }
  return js;
}

function ExpressionToMode (node, mode) {
  if (mode == "statement") {
    return [JS.ExpressionStatement(node)];
  } else if (mode == "return") {
    return [JS.Return(node)];
  }
  return node;
}

// Reify constructors
for (var k in compilers) {
  exports[k] = (function (type, def) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      var ret = {
        type: type
      };
      for (var i = 0, len = args.length; i < len; ++i) {
        ret[def[i]] = args[i];
      }
      return ret;
    }
  }(k, compilers[k].fields))
}

Terr.CompileToJS = function (ast, mode) {
  if (ast === undefined) {
    return ast;
  } else if (compilers[ast.type]) {
    return compilers[ast.type].compile(ast, mode);
  } else {
    console.trace();
    console.log(ast);
    throw "Implement Compiler for " + ast.type;
  }
}

},{"./JS":2}],23:[function(require,module,exports){
function walkProgramTree (handler, node) {
  function walkTree () {
    var args = Array.prototype.slice.call(arguments);

    return function selfApp (node) {
      var new_node, k;

      result = handler.apply(null, [node, walkTree].concat(args))
      if (result !== false) {
        return result;
      }

      if (Array.isArray(node)) {
        new_node = node.map(selfApp);
        new_node.type = node.type;
      } else if (typeof node == 'object') {
        new_node = {};
        for (k in node) {
          new_node[k] = selfApp(node[k]);
        }
      } else {
        new_node = node;
      }

      return new_node;
    }
  }

  var walk_args = Array.prototype.slice.call(arguments, 2);

  return walkTree.apply(null, walk_args)(node);
}

module.exports = walkProgramTree;

},{}],24:[function(require,module,exports){
(function(process){if (!process.EventEmitter) process.EventEmitter = function () {};

var EventEmitter = exports.EventEmitter = process.EventEmitter;
var isArray = typeof Array.isArray === 'function'
    ? Array.isArray
    : function (xs) {
        return Object.prototype.toString.call(xs) === '[object Array]'
    }
;
function indexOf (xs, x) {
    if (xs.indexOf) return xs.indexOf(x);
    for (var i = 0; i < xs.length; i++) {
        if (x === xs[i]) return i;
    }
    return -1;
}

// By default EventEmitters will print a warning if more than
// 10 listeners are added to it. This is a useful default which
// helps finding memory leaks.
//
// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
var defaultMaxListeners = 10;
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!this._events) this._events = {};
  this._events.maxListeners = n;
};


EventEmitter.prototype.emit = function(type) {
  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events || !this._events.error ||
        (isArray(this._events.error) && !this._events.error.length))
    {
      if (arguments[1] instanceof Error) {
        throw arguments[1]; // Unhandled 'error' event
      } else {
        throw new Error("Uncaught, unspecified 'error' event.");
      }
      return false;
    }
  }

  if (!this._events) return false;
  var handler = this._events[type];
  if (!handler) return false;

  if (typeof handler == 'function') {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        var args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
    return true;

  } else if (isArray(handler)) {
    var args = Array.prototype.slice.call(arguments, 1);

    var listeners = handler.slice();
    for (var i = 0, l = listeners.length; i < l; i++) {
      listeners[i].apply(this, args);
    }
    return true;

  } else {
    return false;
  }
};

// EventEmitter is defined in src/node_events.cc
// EventEmitter.prototype.emit() is also defined there.
EventEmitter.prototype.addListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('addListener only takes instances of Function');
  }

  if (!this._events) this._events = {};

  // To avoid recursion in the case that type == "newListeners"! Before
  // adding it to the listeners, first emit "newListeners".
  this.emit('newListener', type, listener);

  if (!this._events[type]) {
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  } else if (isArray(this._events[type])) {

    // Check for listener leak
    if (!this._events[type].warned) {
      var m;
      if (this._events.maxListeners !== undefined) {
        m = this._events.maxListeners;
      } else {
        m = defaultMaxListeners;
      }

      if (m && m > 0 && this._events[type].length > m) {
        this._events[type].warned = true;
        console.error('(node) warning: possible EventEmitter memory ' +
                      'leak detected. %d listeners added. ' +
                      'Use emitter.setMaxListeners() to increase limit.',
                      this._events[type].length);
        console.trace();
      }
    }

    // If we've already got an array, just append.
    this._events[type].push(listener);
  } else {
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  var self = this;
  self.on(type, function g() {
    self.removeListener(type, g);
    listener.apply(this, arguments);
  });

  return this;
};

EventEmitter.prototype.removeListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('removeListener only takes instances of Function');
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (!this._events || !this._events[type]) return this;

  var list = this._events[type];

  if (isArray(list)) {
    var i = indexOf(list, listener);
    if (i < 0) return this;
    list.splice(i, 1);
    if (list.length == 0)
      delete this._events[type];
  } else if (this._events[type] === listener) {
    delete this._events[type];
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  if (arguments.length === 0) {
    this._events = {};
    return this;
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (type && this._events && this._events[type]) this._events[type] = null;
  return this;
};

EventEmitter.prototype.listeners = function(type) {
  if (!this._events) this._events = {};
  if (!this._events[type]) this._events[type] = [];
  if (!isArray(this._events[type])) {
    this._events[type] = [this._events[type]];
  }
  return this._events[type];
};

})(require("__browserify_process"))
},{"__browserify_process":28}],25:[function(require,module,exports){
// nothing to see here... no file methods for the browser

},{}],26:[function(require,module,exports){
(function(process){function filter (xs, fn) {
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (fn(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length; i >= 0; i--) {
    var last = parts[i];
    if (last == '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Regex to split a filename into [*, dir, basename, ext]
// posix version
var splitPathRe = /^(.+\/(?!$)|\/)?((?:.+?)?(\.[^.]*)?)$/;

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
var resolvedPath = '',
    resolvedAbsolute = false;

for (var i = arguments.length; i >= -1 && !resolvedAbsolute; i--) {
  var path = (i >= 0)
      ? arguments[i]
      : process.cwd();

  // Skip empty and invalid entries
  if (typeof path !== 'string' || !path) {
    continue;
  }

  resolvedPath = path + '/' + resolvedPath;
  resolvedAbsolute = path.charAt(0) === '/';
}

// At this point the path should be resolved to a full absolute path, but
// handle relative paths to be safe (might happen when process.cwd() fails)

// Normalize the path
resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
var isAbsolute = path.charAt(0) === '/',
    trailingSlash = path.slice(-1) === '/';

// Normalize the path
path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }
  
  return (isAbsolute ? '/' : '') + path;
};


// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    return p && typeof p === 'string';
  }).join('/'));
};


exports.dirname = function(path) {
  var dir = splitPathRe.exec(path)[1] || '';
  var isWindows = false;
  if (!dir) {
    // No dirname
    return '.';
  } else if (dir.length === 1 ||
      (isWindows && dir.length <= 3 && dir.charAt(1) === ':')) {
    // It is just a slash or a drive letter with a slash
    return dir;
  } else {
    // It is a full dirname, strip trailing slash
    return dir.substring(0, dir.length - 1);
  }
};


exports.basename = function(path, ext) {
  var f = splitPathRe.exec(path)[2] || '';
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPathRe.exec(path)[3] || '';
};

exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

})(require("__browserify_process"))
},{"__browserify_process":28}],27:[function(require,module,exports){
var events = require('events');

exports.isArray = isArray;
exports.isDate = function(obj){return Object.prototype.toString.call(obj) === '[object Date]'};
exports.isRegExp = function(obj){return Object.prototype.toString.call(obj) === '[object RegExp]'};


exports.print = function () {};
exports.puts = function () {};
exports.debug = function() {};

exports.inspect = function(obj, showHidden, depth, colors) {
  var seen = [];

  var stylize = function(str, styleType) {
    // http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
    var styles =
        { 'bold' : [1, 22],
          'italic' : [3, 23],
          'underline' : [4, 24],
          'inverse' : [7, 27],
          'white' : [37, 39],
          'grey' : [90, 39],
          'black' : [30, 39],
          'blue' : [34, 39],
          'cyan' : [36, 39],
          'green' : [32, 39],
          'magenta' : [35, 39],
          'red' : [31, 39],
          'yellow' : [33, 39] };

    var style =
        { 'special': 'cyan',
          'number': 'blue',
          'boolean': 'yellow',
          'undefined': 'grey',
          'null': 'bold',
          'string': 'green',
          'date': 'magenta',
          // "name": intentionally not styling
          'regexp': 'red' }[styleType];

    if (style) {
      return '\033[' + styles[style][0] + 'm' + str +
             '\033[' + styles[style][1] + 'm';
    } else {
      return str;
    }
  };
  if (! colors) {
    stylize = function(str, styleType) { return str; };
  }

  function format(value, recurseTimes) {
    // Provide a hook for user-specified inspect functions.
    // Check that value is an object with an inspect function on it
    if (value && typeof value.inspect === 'function' &&
        // Filter out the util module, it's inspect function is special
        value !== exports &&
        // Also filter out any prototype objects using the circular check.
        !(value.constructor && value.constructor.prototype === value)) {
      return value.inspect(recurseTimes);
    }

    // Primitive types cannot have properties
    switch (typeof value) {
      case 'undefined':
        return stylize('undefined', 'undefined');

      case 'string':
        var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                                 .replace(/'/g, "\\'")
                                                 .replace(/\\"/g, '"') + '\'';
        return stylize(simple, 'string');

      case 'number':
        return stylize('' + value, 'number');

      case 'boolean':
        return stylize('' + value, 'boolean');
    }
    // For some reason typeof null is "object", so special case here.
    if (value === null) {
      return stylize('null', 'null');
    }

    // Look up the keys of the object.
    var visible_keys = Object_keys(value);
    var keys = showHidden ? Object_getOwnPropertyNames(value) : visible_keys;

    // Functions without properties can be shortcutted.
    if (typeof value === 'function' && keys.length === 0) {
      if (isRegExp(value)) {
        return stylize('' + value, 'regexp');
      } else {
        var name = value.name ? ': ' + value.name : '';
        return stylize('[Function' + name + ']', 'special');
      }
    }

    // Dates without properties can be shortcutted
    if (isDate(value) && keys.length === 0) {
      return stylize(value.toUTCString(), 'date');
    }

    var base, type, braces;
    // Determine the object type
    if (isArray(value)) {
      type = 'Array';
      braces = ['[', ']'];
    } else {
      type = 'Object';
      braces = ['{', '}'];
    }

    // Make functions say that they are functions
    if (typeof value === 'function') {
      var n = value.name ? ': ' + value.name : '';
      base = (isRegExp(value)) ? ' ' + value : ' [Function' + n + ']';
    } else {
      base = '';
    }

    // Make dates with properties first say the date
    if (isDate(value)) {
      base = ' ' + value.toUTCString();
    }

    if (keys.length === 0) {
      return braces[0] + base + braces[1];
    }

    if (recurseTimes < 0) {
      if (isRegExp(value)) {
        return stylize('' + value, 'regexp');
      } else {
        return stylize('[Object]', 'special');
      }
    }

    seen.push(value);

    var output = keys.map(function(key) {
      var name, str;
      if (value.__lookupGetter__) {
        if (value.__lookupGetter__(key)) {
          if (value.__lookupSetter__(key)) {
            str = stylize('[Getter/Setter]', 'special');
          } else {
            str = stylize('[Getter]', 'special');
          }
        } else {
          if (value.__lookupSetter__(key)) {
            str = stylize('[Setter]', 'special');
          }
        }
      }
      if (visible_keys.indexOf(key) < 0) {
        name = '[' + key + ']';
      }
      if (!str) {
        if (seen.indexOf(value[key]) < 0) {
          if (recurseTimes === null) {
            str = format(value[key]);
          } else {
            str = format(value[key], recurseTimes - 1);
          }
          if (str.indexOf('\n') > -1) {
            if (isArray(value)) {
              str = str.split('\n').map(function(line) {
                return '  ' + line;
              }).join('\n').substr(2);
            } else {
              str = '\n' + str.split('\n').map(function(line) {
                return '   ' + line;
              }).join('\n');
            }
          }
        } else {
          str = stylize('[Circular]', 'special');
        }
      }
      if (typeof name === 'undefined') {
        if (type === 'Array' && key.match(/^\d+$/)) {
          return str;
        }
        name = JSON.stringify('' + key);
        if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
          name = name.substr(1, name.length - 2);
          name = stylize(name, 'name');
        } else {
          name = name.replace(/'/g, "\\'")
                     .replace(/\\"/g, '"')
                     .replace(/(^"|"$)/g, "'");
          name = stylize(name, 'string');
        }
      }

      return name + ': ' + str;
    });

    seen.pop();

    var numLinesEst = 0;
    var length = output.reduce(function(prev, cur) {
      numLinesEst++;
      if (cur.indexOf('\n') >= 0) numLinesEst++;
      return prev + cur.length + 1;
    }, 0);

    if (length > 50) {
      output = braces[0] +
               (base === '' ? '' : base + '\n ') +
               ' ' +
               output.join(',\n  ') +
               ' ' +
               braces[1];

    } else {
      output = braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
    }

    return output;
  }
  return format(obj, (typeof depth === 'undefined' ? 2 : depth));
};


function isArray(ar) {
  return ar instanceof Array ||
         Array.isArray(ar) ||
         (ar && ar !== Object.prototype && isArray(ar.__proto__));
}


function isRegExp(re) {
  return re instanceof RegExp ||
    (typeof re === 'object' && Object.prototype.toString.call(re) === '[object RegExp]');
}


function isDate(d) {
  if (d instanceof Date) return true;
  if (typeof d !== 'object') return false;
  var properties = Date.prototype && Object_getOwnPropertyNames(Date.prototype);
  var proto = d.__proto__ && Object_getOwnPropertyNames(d.__proto__);
  return JSON.stringify(proto) === JSON.stringify(properties);
}

function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}

var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}

exports.log = function (msg) {};

exports.pump = null;

var Object_keys = Object.keys || function (obj) {
    var res = [];
    for (var key in obj) res.push(key);
    return res;
};

var Object_getOwnPropertyNames = Object.getOwnPropertyNames || function (obj) {
    var res = [];
    for (var key in obj) {
        if (Object.hasOwnProperty.call(obj, key)) res.push(key);
    }
    return res;
};

var Object_create = Object.create || function (prototype, properties) {
    // from es5-shim
    var object;
    if (prototype === null) {
        object = { '__proto__' : null };
    }
    else {
        if (typeof prototype !== 'object') {
            throw new TypeError(
                'typeof prototype[' + (typeof prototype) + '] != \'object\''
            );
        }
        var Type = function () {};
        Type.prototype = prototype;
        object = new Type();
        object.__proto__ = prototype;
    }
    if (typeof properties !== 'undefined' && Object.defineProperties) {
        Object.defineProperties(object, properties);
    }
    return object;
};

exports.inherits = function(ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object_create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
};

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (typeof f !== 'string') {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(exports.inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j': return JSON.stringify(args[i++]);
      default:
        return x;
    }
  });
  for(var x = args[i]; i < len; x = args[++i]){
    if (x === null || typeof x !== 'object') {
      str += ' ' + x;
    } else {
      str += ' ' + exports.inspect(x);
    }
  }
  return str;
};

},{"events":24}],28:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            if (ev.source === window && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}]},{},[21])
;