var reader = require('./reader')
var writer = require('./writer')
var codegen = require('escodegen')
var JS = require('./js')
var Terr = require('./terr-ast')

// Scopes

function Scope (parent) {
  this.parent = parent;
  this.logical_frame = {};
  this.js_frame = {};
}

Scope.prototype.addSymbol = function (name, metadata) {
  this.logical_frame[name] = metadata;
  this.js_frame[name] = metadata;
}

Scope.prototype.newScope = function (logical, js) {
  return new Scope(this);
}

Scope.prototype.resolve = function (name) {
  if (this.logical_frame[name]) {
    return this.logical_frame[name];
  } else {
    return this.parent ? this.parent.resolve(name) : false;
  }
}

Scope.prototype.jsScoped = function (name) {
  return this.js_frame[name] != null
}

Scope.prototype.jsScope = function (predicate) {
  return Object.keys(this.js_frame).filter(function (k) {
    return predicate(this.js_frame[k]);
  });
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
    accessor: JS.Identifier(name),
    value: value
  };
};

Scope.prototype.refer = function (root, map) {

  var root_name = "refer$" + root.join("$");
  var root = Terr.Identifier(root_name);

  for (var k in map) {
    this.logical_frame[k] = {
      type: 'any',
      export: false,
      accessor: Terr.Member(root, Terr.Literal(k)),
      value: map[k],
      namespace: root
    }
  }

  this.logical_frame[root_name] = this.js_frame[root_name] = {
    type: 'any',
    accessor: root,
    value: map
  };
};

Scope.prototype.exports = function () {
  var lf = this.logical_frame;
  return Object.keys(lf).filter(function (k) {
    return lf[k].export;
  }).map(function(k) {
    return {name: k, data: lf[k]};
  });
}

// Environments

function Environment () {
  this.readSession = reader.Reader.newReadSession();
  this.scope = new Scope();
  this.scope.expose('Array', Array);
  this.scope.expose('JSON', JSON);
  this.scope.expose('console', console);

  this.scope.refer(['terrible', 'core'], require('./core'));

  this.ast_nodes = [];
}

Environment.prototype.evalText = function (text) {
  var forms = this.readSession.readString(text);

  for (var i = 0, len = forms.length; i < forms.length; ++i) {
    var form = forms[i];
    // console.log("\n<== Start Form ==>")
    // console.log(form);
    // console.log(reader.printString(form))
    // console.log("<== Start Generated ==>")
    this.ast_nodes = this.ast_nodes.concat(writer.process(form, this.scope, false));
    // console.log("<== End Generated ==>\n")
  }
}

Environment.prototype.evalFile = function (path) {
  this.evalText(require('fs').readFileSync(path));
}

Environment.prototype.asJS = function () {

  // Hoist experiment
  // var terr_ast = this.scope.jsScope(function (m) { return !m.implicit && !m.import; }).map(function (v) {
  //   return Terr.Var(Terr.Identifier(v));
  // }).concat(this.ast_nodes);

  var terr_ast = this.ast_nodes;

  terr_ast.push(Terr.Return(Terr.Obj(this.scope.exports().map(function (exported) {
    return {
      key: exported.name,
      value: exported.data.accessor
    }
  }))));

  terr_ast = Terr.Fn([Terr.Seq(terr_ast)], [0], null);

  var js_ast = Terr.CompileToJS(terr_ast, "statement");

  // console.log("asJS", require('util').inspect(js_ast, false, 20));

  return codegen.generate(JS.Program(js_ast));
}

// var env = new Environment();
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

exports.Environment = Environment;
