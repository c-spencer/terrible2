var Namespace = require('./namespace');
var Terr = require('./terr-ast');
var codegen = require('escodegen');
var JS = require('./js');
var reader = require('./reader');
var parser = require('./parser');

function Environment (target) {
  this.readSession = reader.Reader.newReadSession();

  this.target = target || "node";

  this.scope = new Namespace.Scope();
  this.scope.expose('Array', Array);
  this.scope.expose('Function', Function);
  this.scope.expose('Object', Object);
  this.scope.expose('Number', Number);

  this.scope.expose('JSON', JSON);
  this.scope.expose('console', console);

  this.namespaces = [];

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
    var ns = new Namespace.Namespace(name, this.scope.newScope(true, true));
    this.namespaces.push(ns);
    return ns;
  }
};

Environment.prototype.evalText = function (text) {
  var forms = this.readSession.readString(text);

  for (var i = 0, len = forms.length; i < forms.length; ++i) {
    var form = forms[i];
    var nodes = parser.process(form, this, false);

    this.current_namespace.ast_nodes = this.current_namespace.ast_nodes.concat(
      nodes
    );
  }
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

  var js_ast = Terr.CompileToJS(seq, "statement");

  return codegen.generate(JS.Program(js_ast));
}

exports.Environment = Environment;
