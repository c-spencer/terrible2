var Namespace = require('./namespace');
var Terr = require('./terr-ast');
var codegen = require('escodegen');
var JS = require('./js');
var reader = require('./reader');
var parser = require('./parser');
var core = require('./core');
var fs = require('fs');

var terrible_core = fs.readFileSync("./src/terrible/core.terrible");
var core_js = fs.readFileSync("./core.js").replace(/exports[^\n]+\n/g, '');

function Environment (target, interactive) {

  var id_counter = 0;

  this.interactive = interactive;

  this.genID = function (root) {
    return root + "_$" + (++id_counter);
  }

  this.readSession = (new reader.Reader(this.genID)).newReadSession();

  this.target = target || "node";

  this.scope = new Namespace.Scope();

  this.scope.expose('List', core.list);
  this.scope.expose('Symbol', core.symbol);
  this.scope.expose('Keyword', core.keyword);
  this.scope.expose('gensym', core.gensym);

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
  var that = this;

  var results = [];

  var forms = this.readSession.readString(text, function (err, form) {

    if (err) {
      var text = that.readSession.buffer.remaining().trim();
      that.readSession.buffer.truncate();
      results.push({ text: text, exception: err });
      return;
    }

    try {
      var processed = parser.process(form, that, false);
      processed.form = form;
      processed.text = form.$text;

      var nodes = processed.ast;

      results.push(processed);

      that.current_namespace.ast_nodes =
        that.current_namespace.ast_nodes.concat(nodes);
    } catch (exception) {
      if (error_cb) {
        error_cb(form, form.$text, exception);
      } else {
        console.log(exception, exception.stack);
        results.push({
          form: form,
          text: form.$text,
          exception: exception
        });
      }
    }

  }, function (reader, token, buffer) {
    var resolved = that.current_namespace.scope.resolve(parser.mungeSymbol(token.name));
    if (resolved && resolved.metadata['reader-macro']) {
      try {
        return resolved.value(reader, buffer);
      } catch (exc) {
        console.log(exc, exc.stack);
      }
    } else {
      console.log("Couldn't resolve dispatcher for ", token)
      throw "Couldn't resolve dispatcher for " + token
    }
  });

  return results;
};

Environment.prototype.asJS = function (mode) {
  var raw_core = Terr.Call(
    Terr.Identifier('eval'),
    [Terr.Literal(core_js)]
  );
  raw_core['x-verbatim'] = core_js;

  var seq = Terr.Seq([raw_core]);

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
      sourceMapWithCode: true,
      verbatim: 'x-verbatim'
    });

    console.log("map", result.map.toString());

    return result.code;
  } else {
    return codegen.generate(JS.Program(js_ast), {
      verbatim: 'x-verbatim'
    });
  }
}

exports.Environment = Environment;
