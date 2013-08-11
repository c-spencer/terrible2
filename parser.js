var walker = require('./walker')
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
  '<': makeBinary('>'),
  '<=': makeBinary('>='),
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
        munged_name = declaration_guard(env, "var", id),
        ns_name = env.env.current_namespace.name;

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
      return Terr.NamespaceSet(ns_name, munged_name, js_name, val, "var");
    } else {
      return Terr.Var(accessor, val);
      return Terr.Var([[accessor, val]]);
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

    return Terr.Seq(seq);
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



  // (jsmacro if [opts test cons alt]
  //   (var walker (opts.walker opts.env))
  //   (opts.Terr
  //     (walker test)
  //     (if cons (walker cons))
  //     (if alt (walker alt))))

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
