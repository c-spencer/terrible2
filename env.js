var reader = require('./reader')
var writer = require('./writer')
var codegen = require('escodegen')
var JS = require('./js')
var Terr = require('./terr-ast')

// Scopes

function Scope (ns, logical_stack, js_stack) {
  this.ns = ns;
  this.logical_stack = logical_stack;
  this.js_stack = js_stack;
}

Scope.prototype.addSymbol = function (name, metadata) {
  this.logical_stack[this.logical_stack.length - 1][name] = metadata;
  this.js_stack[this.js_stack.length - 1][name] = metadata;
}

Scope.prototype.newScope = function (logical, js) {
  var new_logical = logical ? this.cloneStack(this.logical_stack) : this.logical_stack;
  var new_js = js ? this.cloneStack(this.js_stack) : this.js_stack;
  return new Scope(this.ns, new_logical, new_js);
}

Scope.prototype.aggregateScope = function () {
  var scope = {};
  for (var i = 0, len = this.logical_stack.length; i < len; ++i) {
    for (var k in this.logical_stack[i]) {
      if (this.logical_stack[i][k].import) {
        continue;
      }
      scope[k] = this.logical_stack[i][k].value;
    }
  }
  console.log("aggregate scope", scope);
  return scope;
}

Scope.prototype.cloneStack = function (stack) {
  var new_stack = []
  stack.forEach(function (level) {
    var new_level = {};
    Object.keys(level).forEach(function (key) {
      new_level[key] = level[key];
    })
    new_stack.push(new_level);
  });
  // Add new layer to the top
  new_stack.push({});
  return new_stack;
}

Scope.prototype.resolve = function (name) {
  var i = this.logical_stack.length - 1;
  while (i >= 0) {
    if (this.logical_stack[i][name]) {
      return this.logical_stack[i][name];
    }
    i -= 1;
  }
  return false;
}

Scope.prototype.jsScoped = function (name) {
  return this.js_stack[this.js_stack.length - 1][name] != null
}

Scope.prototype.jsScope = function (predicate) {
  var jss = this.js_stack[this.js_stack.length - 1];
  return Object.keys(jss).filter(function (k) {
    return predicate(jss[k]);
  });
}

Scope.prototype.logicalScoped = function (name) {
  return this.logical_stack[this.logical_stack.length - 1][name] != null
}

Scope.prototype.update = function (name, attrs) {
  var i = this.logical_stack.length - 1;
  while (i >= 0) {
    if (this.logical_stack[i][name]) {
      for (var k in attrs) {
        this.logical_stack[i][name][k] = attrs[k];
      }
      return;
    }
    i -= 1;
  }
  return false;
}

Scope.prototype.inJsScope = function (name) {
  return this.js_stack[this.js_stack.length - 1][name] != null
}

Scope.prototype.expose = function (name, value) {
  this.logical_stack[0][name] = {
    type: 'any',
    accessor: JS.Identifier(name),
    value: value
  };
};

Scope.prototype.use = function (root, map) {

  var root_name = "use$" + root.join("$");
  var root = Terr.Identifier(root_name);

  for (var k in map) {
    this.logical_stack[0][k] = {
      type: 'any',
      import: true,
      accessor: Terr.Member(root, Terr.Literal(k)),
      value: map[k]
    }
  }

  this.logical_stack[0][root_name] = {
    type: 'any',
    accessor: root,
    value: map
  };
};

// Environments

function Environment () {
  this.readSession = reader.Reader.newReadSession();
  this.scope = new Scope(['user'], [{}], [{}]);
  this.scope.expose('Array', Array);
  this.scope.expose('JSON', JSON);
  this.scope.expose('console', console);

  this.scope.expose('core', require('./core'));

  // this.uses = [];
  // this.scope.use(['terrible', 'core'], require('./core'));
  // this.uses.push(['terrible', 'core']);

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

  var js_ast = Terr.CompileToJS(Terr.Seq(terr_ast), "statement");

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
