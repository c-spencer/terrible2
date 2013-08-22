(function(e){if("function"==typeof bootstrap)bootstrap("terrible",e);else if("object"==typeof exports)module.exports=e();else if("function"==typeof define&&define.amd)define(e);else if("undefined"!=typeof ses){if(!ses.ok())return;ses.makeTerrible=e}else"undefined"!=typeof window?window.Terrible=e():global.Terrible=e()})(function(){var define,ses,bootstrap,module,exports;
return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
// Core Structures

// Vector == Array
// Map == Object
// Literals == Number / String

function List(values) {
  var that = this;
  this.values = values;

  this.concat = function (arg) {
    that.values = that.values.concat(arg);
    return that;
  };

  this.push = function () {
    that.values.push.apply(that.values, arguments);
    return that;
  };
}
exports.list = List;

function Symbol(name) {
  this.name = name;

  this.parse = function () { return Symbol_parse(name); };
}
var symbol_regex = /^([^\.\/][^\/]*)\/(?:(\.+)|([^\.]+(?:\.[^\.]+)*))$|(?:(\.+)|(\.?[^\.]+(?:\.[^\.]+)*))$/;
var Symbol_parse = function (symbol_name) {
  var match = symbol_name.match(symbol_regex);
  if (match) {
    var dots = (match[1] ? match[2] : match[4]) || "";
    var parts = ((match[1] ? match[3] : match[5]) || "").split(/\./g);
    return {
      namespace: match[1] || "",
      root: dots + parts[0],
      parts: parts.slice(1)
    }
  } else {
    console.log("Couldn't match symbol regex", symbol_name);
    throw "Couldn't match symbol regex" + symbol_name;
  }
};
exports.symbol = Symbol;

function Keyword (name) {
  this.name = name;
}
exports.keyword = Keyword;

var gensym_counter = 0;
function gensym (root) {
  return new Symbol("gensym$" + root + "$" + (++gensym_counter));
}
exports.gensym = gensym;

},{}],2:[function(require,module,exports){
var Namespace = require('./namespace');
var Terr = require('./terr-ast');
var JS = require('./js');
var reader = require('./reader');
var parser = require('./parser');
var core = require('./core');
var fs = require('fs');

var core_js = "// Core Structures\n\n// Vector == Array\n// Map == Object\n// Literals == Number / String\n\nfunction List(values) {\n  var that = this;\n  this.values = values;\n\n  this.concat = function (arg) {\n    that.values = that.values.concat(arg);\n    return that;\n  };\n\n  this.push = function () {\n    that.values.push.apply(that.values, arguments);\n    return that;\n  };\n}\nexports.list = List;\n\nfunction Symbol(name) {\n  this.name = name;\n\n  this.parse = function () { return Symbol_parse(name); };\n}\nvar symbol_regex = /^([^\\.\\/][^\\/]*)\\/(?:(\\.+)|([^\\.]+(?:\\.[^\\.]+)*))$|(?:(\\.+)|(\\.?[^\\.]+(?:\\.[^\\.]+)*))$/;\nvar Symbol_parse = function (symbol_name) {\n  var match = symbol_name.match(symbol_regex);\n  if (match) {\n    var dots = (match[1] ? match[2] : match[4]) || \"\";\n    var parts = ((match[1] ? match[3] : match[5]) || \"\").split(/\\./g);\n    return {\n      namespace: match[1] || \"\",\n      root: dots + parts[0],\n      parts: parts.slice(1)\n    }\n  } else {\n    console.log(\"Couldn't match symbol regex\", symbol_name);\n    throw \"Couldn't match symbol regex\" + symbol_name;\n  }\n};\nexports.symbol = Symbol;\n\nfunction Keyword (name) {\n  this.name = name;\n}\nexports.keyword = Keyword;\n\nvar gensym_counter = 0;\nfunction gensym (root) {\n  return new Symbol(\"gensym$\" + root + \"$\" + (++gensym_counter));\n}\nexports.gensym = gensym;\n".replace(/exports[^\n]+\n/g, '');

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
  var FILE_LOADER = BrowserLoader;
} else {
  var FILE_LOADER = NodeLoader;
}

function Environment (config) {

  this.options = {
    target: "node",
    src_root: "src"
  }

  for (var k in config) {
    this.options[k] = config[k];
  }

  var id_counter = 0;

  this.genID = function (root) {
    return root + "_$" + (++id_counter);
  }

  this.loader = new FILE_LOADER(config.src_root);

  this.readSession = (new reader.Reader(this.genID)).newReadSession();

  this.scope = new Namespace.Scope();

  this.scope.expose('List', core.list);
  this.scope.expose('Symbol', core.symbol);
  this.scope.expose('Keyword', core.keyword);
  this.scope.expose('gensym', core.gensym);

  this.namespaces = [];
  this.module_requirements = {};
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

Environment.prototype.findNamespace = function (name, exclude_core) {
  for (var i = 0; i < this.namespaces.length; ++i) {
    if (this.namespaces[i].name === name) {
      return this.namespaces[i];
    }
  }
  var loaded = this.loader.loadPath(name.replace(/\./g, '/') + ".terrible");
  if (loaded) {
    var prev_ns = this.current_namespace,
        ns = this.createNamespace(name, exclude_core);

    this.current_namespace = ns;
    this.evalSession().eval(loaded);
    this.current_namespace = prev_ns;

    return ns;
  }
};

Environment.prototype.createNamespace = function (name, exclude_core) {
  var ns = new Namespace.Namespace(name, this.scope.newScope(true, false));
  this.namespaces.push(ns);

  console.log('createNs', name, exclude_core);

  if (name != "terrible.core" && !exclude_core) {
    ns.scope.refer("terrible.core", null, this.findNamespace("terrible.core"));
  };
  return ns;
};

Environment.prototype.getNamespace = function (name, create, exclude_core) {
  var ns = this.findNamespace(name, exclude_core);
  if (ns) {
    return ns;
  } else if (create) {
    return this.createNamespace(name, exclude_core);
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

  var compile_nodes = Terr.Compile(terr_ast, "return", { interactive: true });

  var js = JS.generate(JS.Program(compile_nodes));

  namespace.ast_nodes = namespace.ast_nodes.concat(terr_ast);

  try {
    return new Function('$ENV', js)(ENV);
  } catch (exc) {
    console.log(exc, js, exc.stack);
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

  // topologically sort dependent namespaces of the current namespace.

  var L = []; // Result List
  var S = []; // Set of roots
  var R = {}; // Remaining elements
  var that = this;

  function expand_dependency(ns) {
    if (ns.dependent_namespaces.length === 0) {
      if (!~S.indexOf(ns.name)) {
        S.push(ns.name);
      }
    } else if (!R[ns.name]) {
      R[ns.name] = {};
      ns.dependent_namespaces.forEach(function (sub_ns) {
        R[ns.name][sub_ns.name] = true;
        expand_dependency(sub_ns);
      });
    }
  }

  expand_dependency(this.current_namespace);

  var removal, r_keys;
  while (removal = S.pop()) {
    L.push(removal);
    Object.keys(R).forEach(function (key) {
      delete R[key][removal];
      if (Object.keys(R[key]).length === 0) {
        S.push(key);
        delete R[key];
      }
    });
  }

  // build a composite AST

  var seq = Terr.Seq([
    Terr.Verbatim(core_js)
  ]);

  function filter_out_macros(ast_nodes) {
    return ast_nodes.map(function (node) {
      if (node.type == "Seq") {
        return Terr.Seq(node.values.filter(function (f) {
          return !f.$isMacro;
        }));
      } else {
        return node;
      }
    });
  }

  L.forEach(function (ns_name) {
    seq.values.push(Terr.Seq(filter_out_macros(that.getNamespace(ns_name).ast_nodes)));
  });

  if (mode === "library") {
    var export_map = this.current_namespace.exportsMap();

    if (this.options.target === "browser") {
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

  if (this.options.target === "browser") {
    var fn = Terr.Fn([Terr.SubFn([], seq, 0)], [0], null);
    fn.$noReturn = true;
    seq = Terr.Call(fn, []);
  }

  var js_ast = Terr.Compile(seq, "statement", { interactive: false });

  if (false) { // source map experimenting
    var result = JS.generate(JS.Program(js_ast), {
      sourceMap: "input",
      sourceMapWithCode: true,
      verbatim: 'x-verbatim'
    });

    console.log("map", result.map.toString());

    return result.code;
  } else {
    return JS.generate(JS.Program(js_ast), {
      verbatim: 'x-verbatim'
    });
  }
}

exports.Environment = Environment;

},{"./core":1,"./js":3,"./namespace":4,"./parser":5,"./reader":6,"./terr-ast":7,"fs":9}],3:[function(require,module,exports){
if (typeof traceur === "undefined") {
  var traceur_path = "traceur"
  traceur = require(traceur_path);
}

var TJS = traceur.codegeneration.ParseTreeFactory;
var TTree = traceur.syntax.trees;

var nodes = {
  VariableDeclaration: ['lvalue', 'typeAnnotation', 'initializer'],
  NewExpression: ['callee', 'arguments'],
  ObjectExpression: ['properties'],
  Block: ['body'],
  ReturnStatement: ['argument'],
  ForStatement: ['init', 'test', 'update', 'body'],
  ForInStatement: ['left', 'right', 'body'],
  ContinueStatement: ['label'],
  ExpressionStatement: ['expression'],
  IfStatement: ['test', 'consequent', 'alternate'],
  ConditionalExpression: ['test', 'consequent', 'alternate'],
  UnaryExpression: ['operator', 'argument'],
  MemberLookupExpression: ['object', 'property'],
  ArrayLiteralExpression: ['elements'],
  Program: ['body'],
  ThrowStatement: ['argument'],
  TryStatement: ['block', 'handler', 'finalizer'],
  CatchClause: ['param', 'block'],
  ThisExpression: [],
  ParenExpression: ['expression'],
  VariableDeclarationList: [],
  YieldExpression: ['expression']
}

exports.BinaryOperator = function (left, op, right) {
  return new TTree.BinaryOperator(null, left, TJS.createOperatorToken(op), right);
};

exports.BindingIdentifier = TJS.createBindingIdentifier;
exports.IdentifierExpression = TJS.createIdentifierExpression;
exports.IdentifierToken = TJS.createIdentifierToken;

for (var type in nodes) {
  (function (type, node) {
    exports[type] = function () {
      return new (Function.prototype.bind.apply(
        TTree[type],
        [null, null].concat(Array.prototype.slice.call(arguments, 0))
      ));
    }
  }(type, nodes[type]));
}

exports.FunctionExpression = function(params, body, generator) {
  return new TTree.FunctionExpression(null,
    null,
    generator || false,
    new TTree.FormalParameterList(null, params),
    new TTree.Block(null, body)
  );
};

exports.FunctionDeclaration = function(id, params, body, generator) {
  return new TTree.FunctionDeclaration(null,
    id,
    generator || false,
    new TTree.FormalParameterList(null, params),
    new TTree.Block(null, body)
  );
};

exports.CallExpression = function (callee, args) {
  return new TTree.CallExpression(
    null,
    callee,
    new TTree.ArgumentList(null, args)
  );
};

exports.VariableStatement = function (type, list) {
  return new TTree.VariableStatement(null,
    new TTree.VariableDeclarationList(null, type, list)
  );
};

exports.NewExpression = function (operand, args) {
  return new TTree.NewExpression(null,
    new TTree.ParenExpression(null, operand),
    new TTree.ArgumentList(null, args)
  );
};

exports.ObjectExpression = function (properties) {
  return new TTree.ObjectLiteralExpression(null,
    properties.map(function (o) {
      return TJS.createPropertyNameAssignment(o.name, o.value);
    })
  );
};

exports.Literal = function (value) {
  if (typeof value == "string") {
    return TJS.createStringLiteral(value);
  } else if (typeof value == "number") {
    return TJS.createNumberLiteral(value);
  } else if (typeof value == "boolean") {
    return TJS.createBooleanLiteral(value);
  } else if (value === null) {
    return TJS.createNullLiteral();
  } else {
    throw "Unknown literal kind " + value;
  }
};

exports.Verbatim = function (js) {
  return parseJS(js);

  return exports.CallExpression(
    exports.IdentifierExpression('eval'),
    [exports.Literal(js)]
  );
};

exports.MemberExpressionComputed = function (object, property) {
  if (property.type === 'LITERAL_EXPRESSION'
      && /^"[a-zA-Z_$][0-9a-zA-Z_$]*"$/.exec(property.literalToken.value)) {
    return TJS.createMemberExpression(object,
      property.literalToken.value.substring(1, property.literalToken.value.length - 1));
  } else {
    return exports.MemberLookupExpression(object, property);
  }
};

exports.generate = function (tree, options) {
  return ES6_to_ES5(tree);
};

function ES6_to_ES5 (ast) {
  var ErrorReporter = traceur.util.ErrorReporter,
      Writer = traceur.outputgeneration.TreeWriter,
      Project = traceur.semantics.symbols.Project,
      ProgramTransformer = traceur.codegeneration.ProgramTransformer;

  var transformer = new ProgramTransformer(new ErrorReporter(), new Project("./"));

  var js = writeAST(transformer.transform(ast, {}));
  // console.log(js);
  return js;
}

function parseJS (str) {
  var ErrorReporter = traceur.util.ErrorReporter,
      source = new traceur.syntax.SourceFile("my-file", str),
      parser = new traceur.syntax.Parser(new ErrorReporter(), source);

  var parsed = parser.parseProgram();

  return parsed;
}

function writeAST (ast) {
  return traceur.outputgeneration.TreeWriter.write(ast);
}

},{}],4:[function(require,module,exports){
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
  if (!metadata.metadata) {
    metadata.metadata = {};
  }
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

    if (ref.alias === alias || ref.namespace === alias) {
      return ref.ns;
    }
  }

  return this.parent? this.parent.resolveNamespace(alias) : false;
}

// False positives, but better than false negatives.
Scope.prototype.nameClash = function (name) {
  return this.jsScoped(name);
}

Scope.prototype.jsScoped = function (name) {
  return this.js_frame[name] != null
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
    top_level: true,
    metadata: { private: true }
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
  return Object.keys(lf).map(function(k) {
    return {name: k, data: lf[k]};
  });
};

function extend(left, right, transform) {
  left = left || {};
  for (var k in right) {
    if (right.hasOwnProperty(k)) {
      if (transform) {
        left[k] = transform(right[k]);
      } else {
        left[k] = right[k];
      }
    }
  }
  return left;
}

// TODO: Really inefficient, especially on larger scopes. Should do something smarter.
Scope.prototype.clone = function () {
  var new_logical = extend({}, this.logical_frame, function (frame_entry) {
    return extend({}, frame_entry);
  });

  var new_js = extend({}, this.js_frame, function (frame_entry) {
    return extend({}, frame_entry);
  });

  var copied_scope = new Scope(this.parent, new_js);
  copied_scope.logical_frame = new_logical;
  copied_scope.ns_references = this.ns_references.slice(0);
  copied_scope.top_level = this.top_level;
  return copied_scope;
};

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
    if (exported.data.metadata['private']
        || exported.data.metadata['macro']
        || exported.data.metadata['terr-macro']
        || exported.data.metadata['reader-macro']) {
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

exports.Namespace = Namespace;
exports.Scope = Scope;

},{"./js":3,"./terr-ast":7}],5:[function(require,module,exports){
var walker = require('./walker')
var core = require('./core')
var JS = require('./js')
var Terr = require('./terr-ast')

function isSymbol(s)  { return s instanceof core.symbol; }
function isKeyword(s) { return s instanceof core.keyword; }
function isList(s)    { return s instanceof core.list; }
function slice (a, i) { return Array.prototype.slice.call(a, i); }

function extend(left, right) {
  left = left || {};
  for (var k in right) {
    if (right.hasOwnProperty(k)) {
      left[k] = right[k];
    }
  }
  return left;
}

var reserved_words = ['break', 'do', 'instanceof', 'typeof', 'case', 'else', 'new',
                      'var', 'catch', 'finally', 'return', 'void', 'continue', 'for',
                      'switch', 'while', 'debugger', 'function', 'with', 'default', 'if',
                      'throw', 'delete', 'in', 'try', 'class', 'enum', 'extends', 'super',
                      'const', 'export', 'import', 'implements', 'let', 'private', 'public',
                      'yield', 'interface', 'package', 'protected', 'static'];

var munged_symbols = {
  ":": "COLON",   "+": "PLUS",      ">": "GT",
  "<": "LT",      "=": "EQ",        "~": "TILDE",
  "!": "BANG",    "@": "CIRCA",     "#": "HASH",
  "'": "QUOTE",   '"': "DQUOTE",    "%": "PERCENT",
  "^": "CARET",   "&": "AMPERSAND", "*": "STAR",
  "|": "BAR",     "{": "LBRACE",    "}": "RBRACE",
  "[": "LBRACK",  "]": "RBRACK",    "/": "SLASH",
  "\\": "BSLASH", "?": "QMARK",     ".": "DOT",
  "(": "LPAREN",  ")": "RPAREN"
};

var mungeRegex = RegExp("[" + Object.keys(munged_symbols).map(function (k) {
  return "\\" + k;
}).join("|") + "]", "g");

var reservedRegex = RegExp("^(" + reserved_words.join("|") + ")$", "g");

function mungeSymbol (str) {
  return str.replace(/\-/g, '_')
            .replace(mungeRegex, function (m) { return "_" + munged_symbols[m] + "_"; })
            .replace(reservedRegex, function (match) { return match + "_"; });
}

builtins = {
  "var": function (opts) {
    var env = opts.env,
        walker = opts.walker(env),
        ns = env.namespace.name,
        munged_ns = mungeSymbol(ns.replace(/\./g, '$')) + "$",
        decls = [],
        inputs = slice(arguments, 1);

    for (var i = 0; i < inputs.length; i += 2) {
      var id = inputs[i],
          val = inputs[i + 1];

      if (!isSymbol(id)) { throw "Var binding must be a symbol."; }

      var parsed_id = id.parse(),
          munged_name = mungeSymbol(parsed_id.root),
          metadata = extend({ private: true }, id.$metadata);

      if (parsed_id.namespace) { throw "Cannot var bind into another namespace." }
      if (parsed_id.parts.length > 0) { throw "Cannot var bind a multi-part id." }

      if (metadata.external) { // expose an outside global var
        env.scope.addSymbol(munged_name, {
          type: 'any',
          accessor: Terr.Identifier(munged_name),
          metadata: metadata
        });

        // no val associated, so backtrack one index
        i = i - 1;
      } else if (env.scope.logicalScoped(munged_name)) { // Just assign into existing var
        var resolved = env.scope.resolve(munged_name);
        if (resolved.metadata.constant) { throw "Cannot reassign a constant " + munged_name }

        val = walker(val);

        env.scope.update(munged_name, {
          node: val,
          metadata: metadata
        });

        if (val && val.type == "Fn") {
          if (metadata['no-return'])  {
            val.$noReturn = true;
          }
          val.id = Terr.Identifier(munged_name);
        }

        if (resolved.top_level) {
          decls.push(Terr.NamespaceSet(ns, munged_name, resolved.js_name, val, "assign"));
        } else {
          decls.push(Terr.Assign(Terr.Identifier(resolved.js_name), val));
        }
      } else {
        var js_name = env.scope.nameClash(munged_name) ? env.genID(munged_name)
                                                       : munged_name;

        // this will change if/when non top-level def is supported
        if (env.scope.top_level && !metadata.private) {
          js_name = munged_ns + js_name;
        }

        var accessor = env.scope.top_level ? Terr.NamespaceGet(ns, munged_name, js_name)
                                           : Terr.Identifier(js_name);

        env.scope.addSymbol(munged_name, {
          type: 'any',
          accessor: accessor,
          js_name: js_name,
          top_level: env.scope.top_level,
          metadata: metadata
        });

        val = walker(val);
        env.scope.update(munged_name, { node: val });

        if (val && val.type == "Fn") {
          if (metadata['no-return']) {
            val.$noReturn = true;
          }
          val.id = Terr.Identifier(munged_name);
        }

        if (env.scope.top_level) {
          var v = Terr.NamespaceSet(ns, munged_name, js_name, val, "var");
        } else {
          var v = Terr.Var([[accessor, val]]);
        }
        if (metadata['terr-macro'] || metadata['macro'] || metadata['reader-macro']) {
          v.$isMacro = true;
        }
        decls.push(v);
      }
    }

    return Terr.Seq(decls);
  },

  "lambda": function (opts, args) {
    var walker = opts.walker,
        env = opts.env;

    var compile_fn = function (args, body) {
      var formal_args = [],
          rest_arg = null,
          fn_env = env.newScope(true, true),
          consume_rest_arg = false;

      args.forEach(function (arg, i) {
        if (!isSymbol(arg)) { throw "Invalid formal arg " + arg; }

        var parsed_arg = arg.parse();

        if (parsed_arg.parts.length > 0) { throw "Invalid formal arg " + JSON.stringify(arg); }

        if (parsed_arg.root == "&") {
          consume_rest_arg = true;
        } else if (consume_rest_arg) {
          if (i !== args.length - 1) { throw "Too many args following rest &"; }

          rest_arg = arg;
        } else {
          var munged_name = mungeSymbol(parsed_arg.root),
              node = Terr.Identifier(munged_name);

          fn_env.scope.addSymbol(munged_name, {
            type: 'any',
            accessor: node
          });

          formal_args.push(node);
        }
      });

      fn_env.scope.addSymbol('arguments', {
        type: 'Arguments',
        accessor: Terr.Identifier('arguments')
      });
      fn_env.scope.addSymbol('this', {
        type: 'Object',
        accessor: Terr.Identifier('this')
      });

      if (rest_arg) {
        body.unshift(
          new core.list([new core.symbol("var"), rest_arg,
                         new core.list([new core.symbol("Array.prototype.slice.call"),
                                        new core.symbol("arguments"),
                                        formal_args.length]) ]));
      }

      var terr_body = Terr.Seq(body.map(walker(fn_env)));

      return Terr.SubFn(formal_args, terr_body, formal_args.length, rest_arg != null);
    }; // end compile_fn

    var forms =
          isList(args) ? slice(arguments, 1).map(function (list) { return list.values; })
                       : [[args].concat(slice(arguments, 2))],
        arity_map = {},
        arities = [],
        variadic = null;

    forms.forEach(function (form, i) {
      var compiled = compile_fn(form[0], form.slice(1));

      if (compiled.variadic) {
        if (i !== forms.length - 1) {
          throw "Variadic form must be in last position."
        }
        variadic = compiled.arity;
        arity_map._ = compiled;
        arities.push("_");
      } else if (arity_map[compiled.arity]) {
        throw "Cannot define same arity twice."
      } else if (compiled.arity < arities[arities.length - 1]) {
        throw "Multi-arity functions should be declared in ascending number of arguments."
      } else {
        arity_map[compiled.arity] = compiled;
        arities.push(compiled.arity);
      }
    });

    return Terr.Fn(arity_map, arities, variadic);
  },

  "ns": function (opts, ns) {
    opts.env.setNamespace(opts.env.env.getNamespace(ns.name, true));

    return Terr.Seq([]);
  },

  "set!": function (opts) {
    var walker = opts.walker,
        env = opts.env;

    var settings = slice(arguments, 1);

    if (settings.length % 2) {
      throw "set! takes an even number of arguments"
    }

    walker = walker(env);

    var seq = [];

    for (var i = 0, len = settings.length; i < len; i += 2) {
      var o_left = settings[i],
          left = walker(o_left),
          right = walker(settings[i + 1]);

      if (isSymbol(o_left)) {
        var left_parsed = o_left.parse();
        if (left_parsed.parts.length === 0) {
          var resolved = env.resolveSymbol(left_parsed);
          if (resolved.metadata.constant) { throw "Cannot reassign constant " + o_left.name }
        }
      }

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

  "unquote-splicing": function (opts, arg) {
    if (opts.env.quoted != "syntax") {
      throw "Cannot call unquote-splicing outside of syntax-quote."
    }
    var result = opts.walker(opts.env.setQuoted(false))(arg);

    return Terr.Splice(result);
  }
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

    var head = node.values[0],
        tail = node.values.slice(1),
        o_walker = walker,
        walker = walker(env);

    // Quoting
    if (env.quoted && (!isSymbol(head) || (head.name !== 'unquote' &&
                                           head.name !== "unquote-splicing"))) {
      var values = node.values.map(walker),
          list_symb = o_walker(env.setQuoted(false))(
            new core.list([new core.symbol('terrible.core/list')])
          );

      if (env.quoted == "syntax") {
        return _loc(values.reduce(function (left, right) {
          if (right.type == "Splice") {
            left = Terr.Call(Terr.Member(left, Terr.Literal("concat")), [right.value]);
            left.$concat = true;
          } else {
            if (left.$concat) {
              left = Terr.Call(Terr.Member(left, Terr.Literal("push")), [right]);
            } else {
              left.args.push(right);
            }
          }
          return left;
        }, list_symb));
      } else {
        list_symb.args = values;
        return _loc(list_symb);
      }
    }

    // Symbol dispatch
    if (head && isSymbol(head)) {

      var parsed_head = head.parse(),
          name = parsed_head.root;

      // (.concat [1 2 3] [4 5 6])
      if (parsed_head.root == "") {
        var target = parsed_head.parts.reduce(function (left, right) {
          return Terr.Member(left, Terr.Literal(right));
        }, walker(tail[0]));

        return _loc(Terr.Call(target, tail.slice(1).map(walker)));
      }

      // (a.b 1 2 3)
      if (parsed_head.parts.length > 0) {
        return _loc(Terr.Call(walker(head), tail.map(walker)));
      }

      // (var a 5)
      if (builtins[name]) {
        return _loc(builtins[name].apply(null, [{
          walker: o_walker,
          env: env
        }].concat(tail)));
      }

      var resolved = env.resolveSymbol(parsed_head);
      if (resolved === false) { throw "Couldn't resolve " + name; }

      // terr-macros and macros
      if (resolved.metadata['terr-macro']) {
        return _loc(resolved.value.apply(null, [{
          walker: o_walker,
          env: env,
          Terr: Terr,
          extend: extend,
          builtins: builtins,
          mungeSymbol: mungeSymbol
        }].concat(tail)));
      } else if (resolved.metadata['macro']) {
        return _loc(walker(resolved.value.apply(null, tail)));
      }

      // Check arities match and specialise for multi-arity functions.
      if (resolved.node && resolved.node.type == "Fn") {
        var fn_node = resolved.node,
            target = walker(head);

        if (~fn_node.arities.indexOf(tail.length)) {
          // Don't specialise the call if interactive, as it could change underneath us.
          if (!env.env.interactive && fn_node.arities.length > 1) {
            target = Terr.Member(target, Terr.Literal("$" + tail.length));
          }
        } else if (fn_node.variadic != null && tail.length >= fn_node.variadic) {
          if (!env.env.interactive && fn_node.arities.length > 1) {
            target = Terr.Member(target, Terr.Literal("$_"));
          }
        } else {
          throw "Function `" + name + "` expects " + fn_node.arities +
                " arguments, " + tail.length + " provided."
        }
      } else if (resolved.type != "any") {
        throw "Cannot call " + resolved.type + " `" + name + "` as function."
      }

      return _loc(Terr.Call(loc(head, target || walker(head)),
                            tail.map(walker)));
    } else if (head && isList(head)) {
      return _loc(Terr.Call(walker(head), tail.map(walker)));
    } else if (head && isKeyword(head)) {
      return _loc(Terr.Member(walker(tail[0]), Terr.Literal(head.name)));
    } else {
      throw "Cannot call `" + JSON.stringify(head) + "` as function."
    }
  },

  "Symbol": function (node, walker, env) {

    if (env.quoted == "quote" || (env.quoted == "syntax" && builtins[node.name])) {
      walker = walker(env.setQuoted(false));
      return loc(node, Terr.Call(
        walker(new core.symbol('terrible.core/symbol')),
        [Terr.Literal(node.name)]
      ));
    } else if (env.quoted == "syntax") {
      var parsed_node = node.parse();
      var resolved = env.resolveSymbol(parsed_node);

      walker = walker(env.setQuoted(false));

      if (!resolved) {
        if (parsed_node.root.match(/#$/)) {
          // TODO: insert safely
          return loc(node, Terr.Call(
            walker(new core.symbol('terrible.core/symbol')),
            [Terr.Literal(node.name)]
          ));
        } else {
          throw "Couldn't resolve `" + node.name + "`";
        }
      }

      var ns = parsed_node.namespace || env.namespace.name;

      return loc(node, Terr.Call(
        walker(new core.symbol('terrible.core/symbol')),
        [Terr.Literal(ns + "/" + [parsed_node.root].concat(parsed_node.parts).join("."))]
      ));
    }

    var parsed_node = node.parse();
    var resolved = env.resolveSymbol(parsed_node);

    if (!resolved) {
      console.trace();
      console.log("Couldn't resolve", node.name);
      throw "Couldn't resolve `" + node.name + "`";
    }

    if (resolved.metadata.constant) { return resolved.node; }

    if (resolved.top_level) {
      var root = Terr.NamespaceGet(
        parsed_node.namespace || env.namespace.name,
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
  }
}

walk_handler = function (node, walker, env) {
  if (isList(node)) {
    return walk_handlers.List(node, walker, env);
  } if (isKeyword(node)) {
    var kw_env = env.setQuoted(false); // Keywords are the same quoted or unquoted.
    return walker(kw_env)(
      new core.list([new core.symbol("terrible.core/keyword"), node.name])
    );
  } else if (isSymbol(node)) {
    return walk_handlers.Symbol(node, walker, env);
  } else if (Array.isArray(node)) {
    return Terr.Arr(node.map(walker(env)));
  } else if (node === null) {
    return Terr.Literal(null);
  } else if (node instanceof RegExp) {
    return Terr.Literal(node);
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
};

function WalkingEnv(env, namespace, scope, quoted, ns_scope_map) {
  this.env = env;
  this.namespace = namespace;
  this.scope = scope;
  this.quoted = quoted;
  this.ns_scope_map = ns_scope_map;
}

WalkingEnv.prototype.genID = function (root) {
  return this.env.genID(root);
};

WalkingEnv.prototype.newScope = function (logical, js) {
  return new WalkingEnv(this.env, this.namespace,
                        this.scope.newScope(logical, js), this.quoted, this.ns_scope_map);
};

WalkingEnv.prototype.setQuoted = function (quoted) {
  return new WalkingEnv(this.env, this.namespace, this.scope.newScope(false, false), quoted, this.ns_scope_map);
};

WalkingEnv.prototype.setNamespace = function (namespace) {
  if (!this.ns_scope_map[namespace.name]) {
    this.ns_scope_map[namespace.name] = namespace.scope.clone();
  }
  this.namespace = namespace;
  this.scope = this.ns_scope_map[namespace.name];
  return this;
};

WalkingEnv.prototype.resolveSymbol = function (parsed_symbol) {
  if (parsed_symbol.namespace) {
    var ns = this.scope.resolveNamespace(parsed_symbol.namespace) ||
             this.env.findNamespace(parsed_symbol.namespace);

    if (!ns) {
      throw "Couldn't find namespace `" + parsed_symbol.namespace + "`"
    }

    parsed_symbol.namespace = ns.name;

    if (ns != this.namespace) {
      this.namespace.requiresNamespace(ns);
    }

    var scope = ns.scope;
  } else {
    var scope = this.scope;
  }

  return scope.resolve(mungeSymbol(parsed_symbol.root));
};

exports.process = function (form, env, namespace, quoted) {
  var walking_env = new WalkingEnv(env, null, null, quoted, {}).setNamespace(namespace),
      ast = walker(walk_handler, form, walking_env);

  return { ast: ast, namespace: walking_env.namespace, scope_map: walking_env.ns_scope_map };
};
exports.mungeSymbol = mungeSymbol;

},{"./core":1,"./js":3,"./terr-ast":7,"./walker":8}],6:[function(require,module,exports){
// A partial port and modification of the Clojure reader
// https://github.com/clojure/clojure/blob/master/src/jvm/clojure/lang/LispReader.java

var core = require('./core')

// Buffer

function Buffer (string) {
  this.string = string;
  this.pos = 0;
  this.line = 0;
  this.col = 0;
}

Buffer.EOF = function () {}

Buffer.prototype.read1 = function () {
  if (this.pos === this.string.length) {
    ++this.pos;
    ++this.col;
    return " ";
  } else if (this.pos > this.string.length) {
    throw new Buffer.EOF();
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
  return new core.list(this.readDelimitedList(')', buffer));
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
    if (left instanceof core.keyword || left instanceof core.symbol) {
      obj[left.name] = right;
    } else {
      obj[left] = right;
    }
  }
  return obj;
}

function commentReader (buffer) {
  while (!buffer.read1().match(/[\n\r]/));
  return buffer;
}

function quoteReader (buffer, apostrophe) {
  return new core.list([new core.symbol('quote'), this.read(buffer)]);
}

function syntaxQuoteReader (buffer, tick) {
  return new core.list([new core.symbol('syntax-quote'), this.read(buffer)]);
}

function unquoteReader (buffer, apostrophe) {
  if (buffer.lookahead(1) == "@") {
    buffer.read1();
    return new core.list([new core.symbol('unquote-splicing'), this.read(buffer)]);
  } else {
    return new core.list([new core.symbol('unquote'), this.read(buffer)]);
  }
}

function metadataReader (buffer, caret) {
  var ch = buffer.lookahead(1);
  if (ch === "" || this.isWhitespace(ch)) {
    return this.read(buffer);
  } else {
    var metaform = this.read(buffer);
    if (metaform instanceof core.keyword) {
      var kw = metaform;
      metaform = {};
      metaform[kw.name] = true;
    }
    var form = this.read(buffer);
    if (form instanceof core.symbol) {
      form.$metadata = metaform;
      return form;
    } else {
      throw "Can only attach metadata to symbols";
    }
  }
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
      ch = buffer.read1();

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
  var ch = buffer.lookahead(1);
  if (buffer.dispatch_handler) {
    return buffer.dispatch_handler(this, ch, buffer);
  } else {
    throw "dispatch on symbol but no Buffer dispatch_handler"
  }
};

function Reader (id_generator) {
  this.genID = id_generator;
}

var MACROS = {
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
  '"': stringReader,
  '#': dispatchReader,
  '^': metadataReader
}

function extend_macros (map) {
  var new_macros = {};
  for (var k in MACROS) {
    new_macros[k] = MACROS[k];
  }
  for (var k in map) {
    new_macros[k] = map[k];
  }
  return new_macros;
}

Reader.prototype.withMacros = function (map, fn) {
  var prev_macros = MACROS;
  MACROS = extend_macros(map);
  var ret = fn();
  MACROS = prev_macros;
  return ret;
};

Reader.prototype.isWhitespace = function (str) { return str.match(/[\t\r\n,\s]/); }
Reader.prototype.isDigit = function (str) { return /^[0-9]$/.exec(str); }
Reader.prototype.isNumber = function (n) { return !isNaN(parseFloat(n)) && isFinite(n); }
Reader.prototype.isTerminatingMacro = function (ch) {
  return MACROS[ch] && ch != '#' && ch != '\'' && ch != '%'
}

function annotateLocation (form, buffer, start_state) {
  if (form !== null && typeof form === "object" && form.constructor != Object) {
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

    if (macro = MACROS[ch]) {
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
        if (ch == '-') {
          n = 0 - n;
        }
        return n;
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
    if (this.isWhitespace(ch) || MACROS[ch]) {
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
  if (symbolPattern.exec(s)) return new core.symbol(s);

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
          return new core.symbol(s);
        } else {
          return new core.keyword(kw);
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

    if (macro = MACROS[ch]) {
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

Reader.prototype.readString = function (str, form_handler, dispatch_handler) {
  return this.newReadSession().readString(str, form_handler, dispatch_handler);
}

Reader.prototype.newReadSession = function () {
  var buffer = new Buffer(""),
      reader = this;

  return {
    buffer: buffer,
    readString: function (str, form_handler, dispatch_handler) {
      buffer.append(str);
      buffer.dispatch_handler = dispatch_handler;
      var forms = [], buffer_state;
      try {
        buffer_state = buffer.save();
        while ((form = reader.read(buffer)) !== undefined) {

          if (form != null && form.constructor !== Object) {
            form.$text = buffer.string.substring(buffer_state.pos, buffer.pos);
          }

          form_handler(null, form);

          buffer_state = buffer.save();
        }
      } catch (exception) {
        if (exception instanceof Buffer.EOF) {
          buffer.restore(buffer_state);
          return;
        } else {
          form_handler(exception);
          return;
        }
      }
    }
  }
}

exports.Reader = Reader;
exports.Buffer = Buffer;

},{"./core":1}],7:[function(require,module,exports){
var JS = require('./js');

var Terr = exports;

function intoBlock (node, mode, context) {
  if (node !== undefined) {
    var r = Terr.CompileToJS(node, mode, context);
    if (r.length == 1) {
      return r[0];
    } else {
      return JS.Block(r);
    }
  } else {
    if (mode == "return") {
      return JS.ReturnStatement();
    } else {
      return undefined;
    }
  }
}

var compilers = {
  Fn: {
    fields: ['bodies', 'arities', 'variadic'],
    compile: function (node, mode, context) {
      var bodies = node.arities.map(function (k) {
        if (node.$noReturn) {
          node.bodies[k].$noReturn = true;
        }
        return Terr.CompileToJS(node.bodies[k], "expression", context);
      });

      if (node.id) {
        var fndef = Terr.CompileToJS(node.id, "expression", context);
      } else {
        var fndef = JS.BindingIdentifier("$fndef");
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
          return [JS.ReturnStatement(fn)];
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
          dispatch_args.push(JS.IdentifierExpression("$" + i));
        }

        var args_len = JS.BindingIdentifier('$args_len');

        var dispatch_body = [JS.VariableStatement('var', [
          JS.VariableDeclaration(
            args_len,
            null,
            JS.MemberExpressionComputed(
              JS.IdentifierExpression("arguments"),
              JS.Literal("length")
            )
          )
        ])];

        var closure_body = [];

        node.arities.forEach(function (arity, i) {

          var app_name = JS.Literal("$" + arity);

          if (arity == "_") {
            dispatch_body.push(
              JS.IfStatement(
                JS.BinaryOperator(args_len, ">=", JS.Literal(node.variadic)),
                JS.ReturnStatement(JS.CallExpression(
                  JS.MemberExpressionComputed(
                    JS.MemberExpressionComputed(fndef, app_name),
                    JS.Literal("apply")
                  ),
                  [JS.IdentifierExpression("this"), JS.IdentifierExpression("arguments")]
                ))
              )
            )
          } else {
            dispatch_body.push(
              JS.IfStatement(
                JS.BinaryOperator(args_len, "==", JS.Literal(arity)),
                JS.ReturnStatement(JS.CallExpression(
                  JS.MemberExpressionComputed(
                    JS.MemberExpressionComputed(fndef, app_name),
                    JS.Literal("call")
                  ),
                  [JS.IdentifierExpression("this")].concat(dispatch_args.slice(0, arity))
                ))
              )
            )
          }

          closure_body.push(
            JS.ExpressionStatement(JS.BinaryOperator(
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
          closure_body.push(JS.ReturnStatement(fndef));
          return closure_body;
        } else if (mode == "statement") {
          return closure_body;
        } else {
          closure_body.push(JS.ReturnStatement(fndef));
          return IIFE(closure_body);
        }
      }
    }
  },

  SubFn: {
    fields: ['args', 'body', 'arity', 'variadic'],
    compile: function (node, mode, context) {

      var fn_context = { hasYield: false },
          this_context = context.set({ functionContext: fn_context });

      var fn_e = JS.FunctionExpression(
        node.args.map(function (n) { return Terr.CompileToJS(n, "expression", context); }),
        Terr.CompileToJS(node.body, node.$noReturn ? "statement" : "return", this_context),
        fn_context.hasYield
      );

      if (mode === "expression") {
        return JS.ParenExpression(fn_e);
      } else {
        return fn_e;
      }
    }
  },

  Identifier: {
    fields: ['name'],
    compile: function (node, mode, context) {
      return ExpressionToMode(loc(node, JS.IdentifierExpression(node.name)), mode, context);
    }
  },

  NamespaceGet: {
    fields: ['namespace', 'name', 'js_name'],
    compile: function (node, mode, context) {
      if (!context.o.interactive) {
        return compilers.Identifier.compile(
          loc(node, {name: node.js_name}), mode, context);
      }

      return Terr.CompileToJS(Terr.Call(
        Terr.Member(Terr.Identifier("$ENV"), Terr.Literal("get")),
        [ Terr.Literal(node.namespace),
          Terr.Literal(node.name) ]
      ), mode, context);
    }
  },

  NamespaceSet: {
    fields: ['namespace', 'name', 'js_name', 'value', 'declaration'],
    compile: function (node, mode, context) {
      if (!context.o.interactive) {
        if (node.declaration == "var") {
          return compilers.Var.compile(loc(node, {
            pairs: [[Terr.Identifier(node.js_name), node.value]]
          }), mode, context);
        } else {
          return compilers.Assign.compile(loc(node, {
            left: Terr.Identifier(node.js_name),
            right: node.value
          }), mode, context);
        }
      }

      return Terr.CompileToJS(Terr.Call(
        Terr.Member(Terr.Identifier("$ENV"), Terr.Literal("set")),
        [ Terr.Literal(node.namespace),
          Terr.Literal(node.name),
          node.value || Terr.Identifier('undefined') ]
      ), mode, context);
    }
  },

  Seq: {
    fields: ['values'],
    compile: function (node, mode, context) {
      var statements = [];
      for (var i = 0, len = node.values.length; i < len; ++i) {
        if (i + 1 == len && (mode == "expression" || mode == "return")) {
          statements = statements.concat(
            Terr.CompileToJS(node.values[i], "return", context));
        } else {
          statements = statements.concat(
            Terr.CompileToJS(node.values[i], "statement", context));
        }
      }

      if (mode == "expression") {
        return IIFE(statements);
      } else {
        return statements;
      }
    }
  },

  Var: {
    fields: ['pairs'],
    compile: function (node, mode, context) {

      var symb, expr;

      var mapped = node.pairs.map(function (pair) {
        symb = JS.BindingIdentifier(pair[0].name);
        expr = Terr.CompileToJS(pair[1], "expression", context) || null;
        return JS.VariableDeclaration(symb, null, expr);
      });

      var decl = JS.VariableStatement('var', mapped);

      if (mode == "expression") {
        return expr;
      } else if (mode == "statement") {
        return [decl];
      } else if (mode == "return") {
        return [decl, JS.ReturnStatement(symb)];
      }
    }
  },

  If: {
    fields: ['test', 'cons', 'alt'],
    compile: function (node, mode, context) {
      var test = Terr.CompileToJS(node.test, "expression", context);

      if (mode == "expression") {
        return JS.ConditionalExpression(test,
          node.cons ? Terr.CompileToJS(node.cons, "expression", context)
                    : undefined,
          node.alt ? Terr.CompileToJS(node.alt, "expression", context)
                   : JS.Identifier("undefined"))
      } else if (mode == "statement" || mode == "return") {
        return [JS.IfStatement(test,
                  intoBlock(node.cons, mode, context),
                  intoBlock(node.alt, mode, context))]
      }
    }
  },

  Literal: {
    fields: ['value'],
    compile: function (node, mode, context) {
      if (typeof node.value == "number" && node.value < 0) {
        return ExpressionToMode(
          JS.UnaryExpression('-', JS.Literal(0 - node.value)), mode, context);
      } else {
        return ExpressionToMode(JS.Literal(node.value), mode, context);
      }
    }
  },

  Try: {
    fields: ['body', 'catch_arg', 'catch', 'finally'],
    compile: function (node, mode, context) {
      if (mode == "expression" || mode == "return") {
        var sub_mode = "return";
      } else {
        var sub_mode = "statement";
      }

      var tryStatement = JS.TryStatement(
        JS.Block(Terr.CompileToJS(node.body, sub_mode, context)),
        JS.CatchClause(
          Terr.CompileToJS(node.catch_arg, "expression", context),
          JS.Block(Terr.CompileToJS(node.catch, sub_mode, context))
        ),
        node.finally ? JS.Block(Terr.CompileToJS(node.finally, "statement", context))
                     : undefined
      )

      if (mode == "statement" || mode == "return") {
        return [tryStatement];
      } else {
        return IIFE([tryStatement]);
      }
    }
  },

  Member: {
    fields: ['left', 'right'],
    compile: function (node, mode, context) {
      return ExpressionToMode(JS.MemberExpressionComputed(
        Terr.CompileToJS(node.left, "expression", context),
        Terr.CompileToJS(node.right, "expression", context)
      ), mode);
    }
  },

  Obj: {
    fields: ['properties'],
    compile: function (node, mode, context) {
      var props = node.properties.map(function (prop) {
        return {
          name: JSON.stringify(prop.key),
          value: Terr.CompileToJS(prop.value, "expression", context)
        };
      });

      return ExpressionToMode(JS.ParenExpression(JS.ObjectExpression(props)), mode, context);
    }
  },

  Assign: {
    fields: ['left', 'right'],
    compile: function (node, mode, context) {
      return ExpressionToMode(loc(node, JS.BinaryOperator(
        Terr.CompileToJS(node.left, "expression", context),
        "=",
        Terr.CompileToJS(node.right, "expression", context)
      )), mode);
    }
  },

  Binary: {
    fields: ['left', 'op', 'right'],
    compile: function (node, mode, context) {
      return ExpressionToMode(loc(node, JS.ParenExpression(JS.BinaryOperator(
        Terr.CompileToJS(node.left, "expression", context),
        node.op,
        Terr.CompileToJS(node.right, "expression", context)
      ))), mode);
    }
  },

  Unary: {
    fields: ['op', 'expr'],
    compile: function (node, mode, context) {
      return ExpressionToMode(loc(node, JS.UnaryExpression(
        node.op,
        Terr.CompileToJS(node.expr, "expression", context)
      )), mode);
    }
  },

  Call: {
    fields: ['target', 'args'],
    compile: function (node, mode, context) {
      return ExpressionToMode(loc(node, JS.CallExpression(
        Terr.CompileToJS(node.target, "expression", context),
        node.args.map(function (a) {
          return Terr.CompileToJS(a, "expression", context);
        })
      )), mode);
    }
  },

  Arr: {
    fields: ['values'],
    compile: function (node, mode, context) {
      return ExpressionToMode(loc(node, JS.ArrayLiteralExpression(
        node.values.map(function (a) {
          return Terr.CompileToJS(a, "expression", context);
        })
      )), mode);
    }
  },

  Return: {
    fields: ['expression'],
    compile: function (node, mode, context) {
      if (mode == "expression") {
        throw "Return in expression position? Is this real?"
      }
      return [loc(node, JS.ReturnStatement(
                          Terr.CompileToJS(node.expression, "expression", context)))];
    }
  },

  New: {
    fields: ['callee', 'args'],
    compile: function (node, mode, context) {
      return ExpressionToMode(JS.NewExpression(
        Terr.CompileToJS(node.callee, "expression", context),
        node.args.map(function (a) {
          return Terr.CompileToJS(a, "expression", context);
        })
      ), mode, context);
    }
  },

  ForIn: {
    fields: ['left', 'right', 'body'],
    compile: function (node, mode, context) {
      return StatementToMode(JS.ForInStatement(
        intoBlock(node.left, "statement", context).declarations,
        Terr.CompileToJS(node.right, "expression", context),
        intoBlock(node.body, "statement", context)
      ), mode, context);
    }
  },

  Loop: {
    fields: ['body', 'test', 'update'],
    compile: function (node, mode, context) {
      var loop_statement = JS.ForStatement(
        undefined,
        // traceur error without the literal true fallthrough
        Terr.CompileToJS(node.test, "expression", context) || JS.Literal(true),
        Terr.CompileToJS(node.update, "expression", context),
        intoBlock(node.body, "return", context)
      );

      if (mode == "return") {
        return [loop_statement];
      } else if (mode == "statement") {
        return [JS.ExpressionStatement(IIFE([loop_statement]))];
      } else if (mode == "expression") {
        return IIFE([loop_statement]);
      }
    }
  },

  Continue: {
    fields: [],
    compile: function (node, mode, context) {
      if (mode == "expression") {
        throw "Continue in expression position? Is this real?"
      }
      return JS.ContinueStatement(null);
    }
  },

  Yield: {
    fields: ['expression'],
    compile: function (node, mode, context) {
      if (!context.o.functionContext) {
        throw "Cannot call Yield outside of function context."
      } else {
        context.o.functionContext.hasYield = true;
      }
      var ys = JS.YieldExpression(Terr.CompileToJS(node.expression, "expression", context));

      if (mode == "expression") {
        return ys;
      } else if (mode == "statement") {
        return [JS.ExpressionStatement(ys)]
      } else {
        return [JS.ExpressionStatement(ys), JS.ReturnStatement()];
      }
    }
  },

  Throw: {
    fields: ['expression'],
    compile: function (node, mode, context) {
      var statement = JS.ThrowStatement(
        Terr.CompileToJS(node.expression, "expression", context));
      if (mode == "expression") {
        return IIFE([statement]);
      } else {
        return [statement];
      }
    }
  },

  Splice: {
    fields: ['value'],
    compile: function (node, mode, context) {
      throw "Cannot compile Splice to JS, should be stripped by parser."
    }
  },

  Verbatim: {
    fields: ['js'],
    compile: function (node, mode, context) {
      return JS.Verbatim(node.js);
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
    return [JS.ReturnStatement(node)];
  }
  return node;
}

function StatementToMode (node, mode) {
  if (node == "expression") {
    return IIFE([node]);
  } else if (node == "return") {
    return [JS.ReturnStatement(IIFE([node]))];
  } else {
    return [node];
  }
}

function IIFE (body) {
  return JS.ParenExpression(JS.CallExpression(JS.FunctionExpression([], body), []));
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

Terr.CompileToJS = function (ast, mode, context) {
  if (!context) {
    console.trace()
    console.log("NO CONTEXT");
    throw "NO CONTEXT PASSED"
  }
  if (ast === undefined) {
    return ast;
  } else if (compilers[ast.type]) {
    return compilers[ast.type].compile(ast, mode, context);
  } else {
    console.trace();
    console.log(ast);
    throw "Implement Compiler for " + ast.type;
  }
}

function CompilationContext (o) {
  this.o = o;
}

CompilationContext.prototype.set = function (bindings) {
  var new_o = {};
  for (var k in this.o) {
    if (this.o.hasOwnProperty(k)) {
      new_o[k] = this.o[k];
    }
  }
  for (var k in bindings) {
    if (bindings.hasOwnProperty(k)) {
      new_o[k] = bindings[k];
    }
  }
  return new CompilationContext(new_o);
};

Terr.Compile = function (ast, mode, options) {
  var context = new CompilationContext({}).set(options);
  return Terr.CompileToJS(ast, mode, context);
}

},{"./js":3}],8:[function(require,module,exports){
function walkProgramTree (handler, node) {
  function walkTree () {
    var args = Array.prototype.slice.call(arguments);

    return function selfApp (node) {
      if (node === undefined) return undefined;

      var new_node, k;

      result = handler.apply(null, [node, walkTree].concat(args))
      if (result !== false) {
        return result;
      }

      if (Array.isArray(node)) {
        new_node = node.map(selfApp);
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

},{}],9:[function(require,module,exports){
// nothing to see here... no file methods for the browser

},{}]},{},[2])(2)
});
;