var walker = require('./walker')
var core = require('./core')
var JS = require('./js')
var codegen = require('escodegen')
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

function mungeSymbol (str) {
  return str.replace(/-/g, '_')
    .replace(/\:/g, "_COLON_") .replace(/\+/g, "_PLUS_")     .replace(/\>/g, "_GT_")
    .replace(/\</g, "_LT_")    .replace(/\=/g, "_EQ_")       .replace(/\~/g, "_TILDE_")
    .replace(/\!/g, "_BANG_")  .replace(/\@/g, "_CIRCA_")    .replace(/\#/g, "_HASH_")
    .replace(/\\'/g, "_QUOTE_").replace(/\"/g, "_DQUOTE_")   .replace(/\%/g, "_PERCENT_")
    .replace(/\^/g, "_CARET_") .replace(/\&/g, "_AMPERSAND_").replace(/\*/g, "_STAR_")
    .replace(/\|/g, "_BAR_")   .replace(/\{/g, "_LBRACE_")   .replace(/\}/g, "_RBRACE_")
    .replace(/\[/g, "_LBRACK_").replace(/\]/g, "_RBRACK_")   .replace(/\//g, "_SLASH_")
    .replace(/\\/g, "_BSLASH_").replace(/\?/g, "_QMARK_")    .replace(/\./g, "_DOT_")
    .replace(RegExp("^(" + reserved_words.join("|") + ")$"), function (match) {
      return match + "_";
    });
}

builtins = {
  "var": function (opts) {
    var env = opts.env,
        walker = opts.walker(env),
        ns = env.env.current_namespace.name,
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
          val.id = Terr.Identifier(munged_name);
        }

        if (env.scope.top_level) {
          decls.push(Terr.NamespaceSet(ns, munged_name, js_name, val, "var"));
        } else {
          decls.push(Terr.Var([[accessor, val]]));
        }
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

        if (parsed_arg.parts.length > 0) { throw "Invalid formal arg " + arg; }

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
    opts.env.env.current_namespace = opts.env.env.getNamespace(ns.name);

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
  return new Function('$ENV', js)(ENV);
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
        return _loc(Terr.Call(
          list_symb,
          values
        ));
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

      var ns = parsed_node.namespace || env.env.current_namespace.name;

      return loc(node, Terr.Call(
        walker(new core.symbol('terrible.core/symbol')),
        [Terr.Literal(ns + "/" + [parsed_node.root].concat(parsed_node.parts).join("."))]
      ));
    }

    var parsed_node = node.parse();
    var resolved = env.resolveSymbol(parsed_node);

    if (!resolved) {
      console.trace();
      throw "Couldn't resolve `" + node.name + "`";
    }

    if (resolved.metadata.constant) { return resolved.node; }

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
  }
}

walk_handler = function (node, walker, env) {
  if (isList(node)) {
    return walk_handlers.List(node, walker, env);
  } if (isKeyword(node)) {
    return walker(env)(new core.list([new core.symbol("terrible.core/keyword"), node.name]));
  } else if (isSymbol(node)) {
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
};

function WalkingEnv(env, scope, quoted) {
  this.env = env;
  this.scope = scope;
  this.quoted = quoted;
}

WalkingEnv.prototype.genID = function (root) {
  return this.env.genID(root);
};

WalkingEnv.prototype.newScope = function (logical, js) {
  return new WalkingEnv(this.env, this.scope.newScope(logical, js), this.quoted);
};

WalkingEnv.prototype.setQuoted = function (quoted) {
  return new WalkingEnv(this.env, this.scope.newScope(false, false), quoted);
};

WalkingEnv.prototype.resolveSymbol = function (parsed_symbol) {
  if (parsed_symbol.namespace) {
    var ns = this.scope.resolveNamespace(parsed_symbol.namespace) ||
             this.env.findNamespace(parsed_symbol.namespace);

    if (!ns) {
      throw "Couldn't find namespace `" + parsed_symbol.namespace + "`"
    }

    parsed_symbol.namespace = ns.name;

    this.env.current_namespace.requiresNamespace(ns);
    var scope = ns.scope;
  } else {
    var scope = this.scope;
  }

  return scope.resolve(mungeSymbol(parsed_symbol.root));
};

exports.process = function (form, env, quoted) {
  var walking_env = new WalkingEnv(env, env.current_namespace.scope, quoted),
      ast = walker(walk_handler, form, walking_env),
      value = compile_eval(ast, env);

  return { ast: ast, value: value };
};
exports.mungeSymbol = mungeSymbol;
