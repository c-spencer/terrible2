var Namespace = require('./namespace');
var Terr = require('./terr-ast');
var codegen = require('escodegen');
var JS = require('./js');
var reader = require('./reader');
var parser = require('./parser');

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
    var ns = new Namespace.Namespace(name, this.scope.newScope(true, false));
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

      this.current_namespace.ast_nodes =
        this.current_namespace.ast_nodes.concat(nodes);
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
