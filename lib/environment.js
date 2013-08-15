var Namespace = require('./namespace');
var Terr = require('./terr-ast');
var codegen = require('escodegen');
var JS = require('./js');
var reader = require('./reader');
var parser = require('./parser');
var core = require('./core');
var fs = require('fs');

var core_js = fs.readFileSync(__dirname + "/core.js", 'utf-8').replace(/exports[^\n]+\n/g, '');

function BrowserLoader (root) {
  this.root = root;
};

var path_cache = {};

BrowserLoader.prototype.loadPath = function (path) {
  if (path_cache[path]) {
    return path_cache[path];
  }
  var request = new XMLHttpRequest();
  request.open('GET', this.root + "/" + path, false);
  request.send(null);

  if (request.status == 200) {
    path_cache[path] = request.responseText;
    return request.responseText;
  } else {
    path_cache[path] = null;
    return null;
  }
}

function NodeLoader (root) {
  this.root = root;
};

NodeLoader.prototype.loadPath = function (path) {
  try {
    return fs.readFileSync(this.root + "/" + path);
  } catch (exc) {
    return undefined;
  }
}

if (typeof window !== "undefined") {
  var MODULE_LOADER = BrowserLoader;
} else {
  var MODULE_LOADER = NodeLoader;
}

function Environment (target, interactive) {

  var id_counter = 0;

  this.interactive = interactive;

  this.genID = function (root) {
    return root + "_$" + (++id_counter);
  }

  this.loader = new MODULE_LOADER("src");

  this.readSession = (new reader.Reader(this.genID)).newReadSession();

  this.target = target || "node";

  this.scope = new Namespace.Scope();

  this.scope.expose('List', core.list);
  this.scope.expose('Symbol', core.symbol);
  this.scope.expose('Keyword', core.keyword);
  this.scope.expose('gensym', core.gensym);

  this.namespaces = [];

  this.loadNamespace('user', true);
};

Environment.prototype.runMethod = function (name, args) {
  var fn = this.current_namespace.scope.resolve(parser.mungeSymbol(name));
  if (!fn) {
    throw "No such method " + this.current_namespace.name + "/" + name
  }
  return fn.value.apply(null, args);
};

Environment.prototype.loadNamespace = function (name, create) {
  this.current_namespace = this.getNamespace(name, create);
};

Environment.prototype.findNamespace = function (name) {
  for (var i = 0; i < this.namespaces.length; ++i) {
    if (this.namespaces[i].name === name) {
      return this.namespaces[i];
    }
  }
  var loaded = this.loader.loadPath(name.replace(/\./g, '/') + ".terrible");
  if (loaded) {
    var prev_ns = this.current_namespace,
        ns = this.createNamespace(name);

    this.current_namespace = ns;
    this.evalSession().eval(loaded);
    this.current_namespace = prev_ns;

    return ns;
  }
};

Environment.prototype.createNamespace = function (name) {
  var ns = new Namespace.Namespace(name, this.scope.newScope(true, false));
  this.namespaces.push(ns);

  if (name != "terrible.core") {
    ns.scope.refer("terrible.core", null, this.findNamespace("terrible.core"));
  };
  return ns;
};

Environment.prototype.getNamespace = function (name, create) {
  var ns = this.findNamespace(name);
  if (ns) {
    return ns;
  } else if (create) {
    return this.createNamespace(name);
  } else {
    throw "Couldn't getNamespace " + name;
  }
};

Environment.prototype.evalSession = function () {
  var session = {
    readSession: (new reader.Reader(this.genID)).newReadSession()
  };

  var that = this;

  return {
    eval: function (text, error_cb) {
      return that.evalText(session, text, error_cb);
    }
  }
};

Environment.prototype.evaluateInNamespace = function (terr_ast, namespace) {
  var env = this;

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

  // TODO: better way of doing this
  Terr.INTERACTIVE = true;
  var compile_nodes = Terr.CompileToJS(terr_ast, "return");

  var js = codegen.generate(JS.Program(compile_nodes));

  namespace.ast_nodes = namespace.ast_nodes.concat(terr_ast);

  try {
    return new Function('$ENV', js)(ENV);
  } catch (exc) {
    console.log(exc, js);
    throw exc;
  };
}

Environment.prototype.evalText = function (session, text, error_cb) {
  var that = this;

  var results = [];

  var forms = session.readSession.readString(text, function (err, form) {

    if (err) {
      var text = session.readSession.buffer.remaining().trim();
      session.readSession.buffer.truncate();
      console.log(err, err.stack);
      results.push({ text: text, exception: err });
      return;
    }

    try {
      var processed = parser.process(form, that, that.current_namespace, false);

      for (var ns_name in processed.scope_map) {
        that.findNamespace(ns_name).scope = processed.scope_map[ns_name];
      }
      that.current_namespace = processed.namespace;

      var value = that.evaluateInNamespace(processed.ast, that.current_namespace);

      processed.value = value;
      processed.form = form;
      processed.text = form.$text;

      var nodes = processed.ast;

      results.push(processed);
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

  }, function (reader, name, buffer) {
    var resolved = that.current_namespace.scope.resolve(parser.mungeSymbol('reader-'+name));
    if (resolved && resolved.metadata['reader-macro']) {
      try {
        return resolved.value(reader, buffer);
      } catch (exc) {
        console.log(exc, exc.stack);
      }
    } else {
      console.log("Couldn't resolve dispatcher for `" + name + "`")
      throw "Couldn't resolve dispatcher for `" + name + "`"
    }
  });

  return results;
};

Environment.prototype.asJS = function (mode, entry_fn) {
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
  } else {
    if (entry_fn) {
      var fn = this.current_namespace.scope.resolve(parser.mungeSymbol(entry_fn));
      if (!fn) {
        throw "Couldn't resolve entry point " + this.current_namespace.name + "/" + entry_fn;
      }
      seq.values.push(Terr.Call(fn.accessor, []));
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
