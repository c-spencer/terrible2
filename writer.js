var walker = require('./walker')
var core = require('./core')
var JS = require('./js')
var codegen = require('escodegen')
var ID = require('./id')
var Terr = require('./terr-ast')

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

builtins = {

  '=': makeBinary('==='),
  '+': makeBinary('+'),
  '-': makeBinary('-'),
  'not=': makeBinary('!=='),
  'or': makeBinary('||'),
  'and': makeBinary('&&'),
  '>': makeBinary('>'),
  '>=': makeBinary('>='),
  '/': makeBinary('/'),

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

  "var": function (opts, id, val) {
    var walker = opts.walker,
        env = opts.env;

    if (id.type !== "Symbol") {
      throw "First argument to var must be symbol."
    }

    if (id.parts.length == 1) {
      var munged_name = mungeSymbol(id.name());

      // If there is already a var with the same name in the JS scope, generate a new
      // name to avoid overwriting it. The scope always returns from the logical stack
      // not the js stack, so although this clobbers the old js scope information, the
      // js stack is only needed for the presence check, not the metadata.

      if (env.scope.jsScoped(munged_name)) {
        if (env.scope.logicalScoped(munged_name)) {
          throw "Cannot redeclare var " + id.name()
        }
        var js_name = ID.gen(munged_name);
      } else {
        var js_name = munged_name;
      }

      env.scope.addSymbol(munged_name, { type: 'any', accessor: Terr.Identifier(js_name) });

      // TOTHINK: Treat value as a new scope?

      id = walker(env)(id);

      if (val !== undefined) {
        val = walker(env)(val);
        if (val === null) {
          return undefined;
        } else if (val.type == "Fn") {
          val.id = id;
          // return val;
        }

        env.scope.update(munged_name, { node: val });
      }

      return Terr.Var(id, val);
    } else {
      throw "Can't var a multi-part id."
      // var resolved = env.scope.resolve(id.name());

      // walker = walker(env);

      // return Terr.Assign(walker(id), walker(val));
    }

  },

  "def": function (opts, id, val) {
    var walker = opts.walker,
        env = opts.env;

    if (id.type !== "Symbol") {
      throw "First argument to def must be symbol."
    }

    if (id.parts.length == 1) {
      var munged_name = mungeSymbol(id.name());

      if (env.scope.jsScoped(munged_name)) {
        var js_name = ID.gen(munged_name);
      } else {
        var js_name = munged_name;
      }

      env.scope.addSymbol(munged_name, { type: 'any', accessor: Terr.Identifier(js_name) });

      id = walker(env)(id);

      if (val !== undefined) {
        val = walker(env)(val);
        if (val === null) {
          return undefined;
        } else if (val.type == "Fn") {
          val.id = id;
          // return val;
        }

        env.scope.update(munged_name, { node: val });
      }

      return Terr.Var(id, val);
    } else {
      throw "Can't def a multi-part id."
    }
  },

  "fn": function (opts, args) {

    var walker = opts.walker,
        env = opts.env;

    // COMPILE FN

    function compile_fn (args, body) {
      var formal_args = [];
      var rest_arg = null;

      var fn_env = env.newScope(true, true);

      for (var i = 0, len = args.length; i < len; ++i) {
        var arg = args[i];

        if (arg.type == "Symbol" && arg.parts.length == 1) {
          if (arg.name() == "&") {
            rest_arg = args[i + 1];
            if (!rest_arg || rest_arg.type != "Symbol" || rest_arg.parts.length != 1) {
              throw "Invalid rest arg " + rest_arg;
            }
            if (i + 2 != args.length) {
              throw "Can only set arg after & rest"
            }
            break;
          } else {
            var munged_name = mungeSymbol(arg.name());
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
          core.list(core.symbol("Array", "prototype", "slice", "call"),
            core.symbol("arguments"), formal_args.length)));
      }

      var walked_body = body.map(walker(fn_env));

      // Hoist experiment
      // var terr_body = Terr.Seq(
      //   fn_env.scope.jsScope(function (m) { return !m.implicit; }).map(function (v) {
      //     return Terr.Var(Terr.Identifier(v));
      //   }).concat(walked_body)
      // );

      var terr_body = Terr.Seq(walked_body);

      return Terr.SubFn(formal_args, terr_body, formal_args.length, rest_arg != null);
    }

    // END COMPILE FN

    if (args.type == "List") { // multiple arity function
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
      var munged = mungeSymbol(symb.name());
      env.scope.addSymbol(munged, { type: 'any', import: true, accessor: Terr.Identifier(munged) });
    });

    return Terr.Seq([]);
  },

  "ns": function (opts, ns) {
    opts.env.scope.ns = ns.parts;

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
      seq.push(Terr.Assign(walker(settings[i]), walker(settings[i + 1])));
    }

    return Terr.Seq(seq);
  },

  "do": function (opts) {
    var walker = opts.walker,
        env = opts.env;

    // Open a new logical scope, but not a new javascript scope, to allow block
    // insertion to work as expected.
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

    return Terr.If(walker(test), cons ? walker(cons) : undefined,
                                 alt ? walker(alt) : undefined);
  },

  ".": function (opts, target, member) {
    var args = Array.prototype.slice.call(arguments, 3);
    var walker = opts.walker(opts.env);

    return Terr.Call(Terr.Member(walker(target), Terr.Literal(member.name())),
                     args.map(walker));
  },

  "try": function (opts) {
    var walker = opts.walker,
        env = opts.env;

    var body = Array.prototype.slice.call(arguments, 1);
    var catch_clause = body.pop();

    if (catch_clause.type !== "List" || catch_clause.values.length < 2 || catch_clause.values[0].type !== "Symbol" || catch_clause.values[0].name() !== "catch") {
      throw "Invalid catch clause"
    }

    var catch_args = catch_clause.values[1];
    var catch_body = catch_clause.values.slice(2);

    if (!Array.isArray(catch_args) || catch_args.length !== 1) {
      throw "Invalid catch args."
    }

    var body_walker = walker(env);
    var body = Terr.Seq(body.map(body_walker));

    var munged_name = mungeSymbol(catch_args[0].name());

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
  }
}

function compile_eval (node, scope) {

  // Compilation/evalution strategy:
  // Take a known scope, and extract exposed variables in that scope an env map,
  // then use with inside the evaluation to capture changes to that env.
  //
  // Any variables declared by the block will already be set as in scope, so this
  // correctly initialises new variables, as well as updating others through
  // side effects.

  // Get an aggregated map of the current scope.
  var agg = scope.aggregateScope();

  var to_rescope = Object.keys(agg);

  var compile_nodes = Terr.CompileToJS(node, "return");

  var js = codegen.generate({
    type: "WithStatement",
    object: JS.Identifier("$env"),
    body: JS.Block(compile_nodes)
  });

  // console.log("<--Compile Eval-->")
  // console.log(js);
  // console.log("<--Run Compile Eval-->");
  var ret = new Function('$env', js)(agg);
  // console.log("<--End Compile Eval-->")

  // Update the scope values.
  to_rescope.forEach(function (k) {
    scope.update(k, { value: agg[k] });
  });

  return ret;
}

var macros = {
  defn: function (name) {
    var body = Array.prototype.slice.call(arguments, 1);
    return core.list(
      core.symbol('def'),
      name,
      core.list.apply(null, [core.symbol('fn')].concat(body))
    )
  },

  "setfn!": function (name) {
    var body = Array.prototype.slice.call(arguments, 1);
    return core.list(
      core.symbol('set!'),
      name,
      core.list.apply(null, [core.symbol('fn')].concat(body))
    )
  },

  "varfn": function (name) {
    var body = Array.prototype.slice.call(arguments, 1);
    return core.list(
      core.symbol('set!'),
      name,
      core.list.apply(null, [core.symbol('fn')].concat(body))
    )
  }
}

walk_handlers = {
  "List": function (node, walker, env) {

    if (env.quoted) {
      var quoted_walker = walker(env);
      var unquoted_walker = walker(env.setQuoted(false));
      return Terr.Call(
        unquoted_walker(core.symbol('list')),
        node.values.map(quoted_walker)
      )
    }

    var head = node.values[0];
    var tail = node.values.slice(1);

    if (head && head.type == "Symbol") {

      if (head.name()[0] == "." && head.name() != ".") {
        walker = walker(env);
        var target = walker(tail[0]);
        tail = tail.slice(1).map(walker);
        head.parts[0] = head.parts[0].substring(1);

        head.parts.forEach(function (p) {
          target = Terr.Member(target, walker(p));
        });

        return Terr.Call(target, tail);
      }

      if (head.parts.length > 1) {
        walker = walker(env);
        var ret = Terr.Call(walker(head), tail.map(walker))
        return ret;
      }

      var name = head.name();

      if (builtins[name]) {
        return builtins[name].apply(null, [{
          walker: walker,
          env: env
        }].concat(tail));
      } else if (macros[name]) {
        return walker(env)(macros[name].apply(null, tail));
      }

      var resolved = env.scope.resolve(mungeSymbol(name));

      if (resolved === false) {
        throw "Couldn't resolve " + name;
      }

      walker = walker(env);

      if (resolved.node && resolved.node.type == "Fn") {

        var fn_node = resolved.node;

        var target = walker(head);

        if (fn_node.arities.length == 1) { // mono-arity, no sub-dispatch
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

      return Terr.Call(target || walker(head), tail.map(walker));
    } else {
      throw "Cannot call `" + JSON.stringify(head) + "` as function."
    }
  },

  "Symbol": function (node, walker, env) {

    if (env.quoted) {
      var quoted_walker = walker(env);
      var unquoted_walker = walker(env.setQuoted(false));
      return Terr.Call(
        unquoted_walker(core.symbol('symbol')),
        node.parts.map(quoted_walker)
      )
    }

    var resolved = env.scope.resolve(mungeSymbol(node.name()));

    if (!resolved) {
      console.trace();
      throw "Couldn't resolve `" + node.name() + "`";
    }

    var root = resolved.accessor;
    var walker = walker(env);

    for (var i = 1, len = node.parts.length; i < len; ++i) {
      root = Terr.Member(root, walker(node.parts[i]));
    }

    return root;
  },

  "Keyword": function (node, walker, env) {
    return Terr.Call(Terr.Identifier("core", ["keyword"]), [Terr.Literal(node.toString())]);
  },

  "ANY": function (node, walker, env) {
    if (Array.isArray(node)) {
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
}

function WalkingEnv(scope, quoted) {
  this.scope = scope;
  this.quoted = quoted;
}

WalkingEnv.prototype.newScope = function (logical, js) {
  return new WalkingEnv(this.scope.newScope(logical, js), this.quoted);
}

WalkingEnv.prototype.setQuoted = function (quoted) {
  return new WalkingEnv(this.scope.newScope(false, false), quoted);
}

function process_form (form, scope, quoted) {
  form.topLevel = true;

  // console.log("form", require('util').inspect(form, false, 20));

  var walking_env = new WalkingEnv(scope, quoted, {});

  var ast = walker(walk_handlers, form, walking_env);
  // console.log("ast", require('util').inspect(ast, false, 20));
  var value = compile_eval(ast, scope);

  // console.log(require('util').inspect(scope, false, 10));

  return ast;
}

exports.process = process_form;
