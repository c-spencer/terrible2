var JS = require('./js');

var Terr = exports;

function intoBlock (node, mode, context) {
  if (node !== undefined) {
    var r = Terr.CompileToJS(node, mode, context);
    if (r.length == 1) {
      return r[0];
    } else {
      return JS.BlockStatement(r);
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
        var fndef = JS.Identifier("$fndef");
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
          dispatch_args.push(JS.Identifier("$" + i));
        }

        var args_len = JS.Identifier('$args_len');

        var dispatch_body = [JS.VariableDeclaration([
          JS.VariableDeclarator(
            args_len,
            JS.MemberExpressionComputed(JS.Identifier("arguments"), JS.Literal("length"))
          )
        ])];

        var closure_body = [];

        node.arities.forEach(function (arity, i) {

          var app_name = JS.Literal("$" + arity);

          if (arity == "_") {
            dispatch_body.push(
              JS.IfStatement(
                JS.BinaryExpression(args_len, ">=", JS.Literal(node.variadic)),
                JS.ReturnStatement(JS.CallExpression(
                  JS.MemberExpressionComputed(
                    JS.MemberExpressionComputed(fndef, app_name),
                    JS.Literal("apply")
                  ),
                  [JS.Identifier("this"), JS.Identifier("arguments")]
                ))
              )
            )
          } else {
            dispatch_body.push(
              JS.IfStatement(
                JS.BinaryExpression(args_len, "==", JS.Literal(arity)),
                JS.ReturnStatement(JS.CallExpression(
                  JS.MemberExpressionComputed(
                    JS.MemberExpressionComputed(fndef, app_name),
                    JS.Literal("call")
                  ),
                  [JS.Identifier("this")].concat(dispatch_args.slice(0, arity))
                ))
              )
            )
          }

          closure_body.push(
            JS.ExpressionStatement(JS.AssignmentExpression(
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
      return JS.FunctionExpression(
        node.args.map(function (n) { return Terr.CompileToJS(n, "expression", context); }),
        Terr.CompileToJS(node.body, node.$noReturn ? "statement" : "return", context)
      )
    }
  },

  Identifier: {
    fields: ['name'],
    compile: function (node, mode, context) {
      return ExpressionToMode(loc(node, JS.Identifier(node.name)), mode, context);
    }
  },

  NamespaceGet: {
    fields: ['namespace', 'name', 'js_name'],
    compile: function (node, mode, context) {
      if (!context.interactive) {
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
      if (!context.interactive) {
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
        symb = Terr.CompileToJS(pair[0], "expression", context);
        expr = Terr.CompileToJS(pair[1], "expression", context);
        return JS.VariableDeclarator(symb, expr);
      });

      var decl = JS.VariableDeclaration(mapped);

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
        JS.BlockStatement(Terr.CompileToJS(node.body, sub_mode, context)),
        JS.CatchClause(
          Terr.CompileToJS(node.catch_arg, "expression", context),
          JS.BlockStatement(Terr.CompileToJS(node.catch, sub_mode, context))
        ),
        node.finally ? JS.BlockStatement(Terr.CompileToJS(node.finally, "statement", context))
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
      var props = [];
      for (var i = 0, len = node.properties.length; i < len; ++i) {
        var prop = node.properties[i];
        props.push({
          type: 'Property',
          key: JS.Literal(prop.key),
          value: Terr.CompileToJS(prop.value, "expression", context),
          kind: 'init'
        });
      }

      return ExpressionToMode({ type: "ObjectExpression", properties: props }, mode, context);
    }
  },

  Assign: {
    fields: ['left', 'right'],
    compile: function (node, mode, context) {
      return ExpressionToMode(loc(node, JS.AssignmentExpression(
        Terr.CompileToJS(node.left, "expression", context),
        "=",
        Terr.CompileToJS(node.right, "expression", context)
      )), mode);
    }
  },

  Binary: {
    fields: ['left', 'op', 'right'],
    compile: function (node, mode, context) {
      return ExpressionToMode(loc(node, JS.BinaryExpression(
        Terr.CompileToJS(node.left, "expression", context),
        node.op,
        Terr.CompileToJS(node.right, "expression", context)
      )), mode);
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
      return ExpressionToMode(loc(node, JS.ArrayExpression(
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

  For: {
    fields: ['init', 'test', 'update', 'body'],
    compile: function (node, mode, context) {
      return StatementToMode(JS.ForStatement(
        intoBlock(node.init, "statement", context),
        Terr.CompileToJS(node.test, "expression", context),
        Terr.CompileToJS(node.update, "expression", context),
        intoBlock(node.body, "statement", context)
      ), mode, context);
    }
  },

  ForIn: {
    fields: ['left', 'right', 'body'],
    compile: function (node, mode, context) {
      return StatementToMode(JS.ForInStatement(
        intoBlock(node.left, "statement", context),
        Terr.CompileToJS(node.right, "expression", context),
        intoBlock(node.body, "statement", context)
      ), mode, context);
    }
  },

  While: {
    fields: ['test', 'body'],
    compile: function (node, mode, context) {
      return StatementToMode(JS.WhileStatement(
        Terr.CompileToJS(node.test, "expression", context),
        intoBlock(node.body, "statement", context)
      ), mode, context);
    }
  },

  Loop: {
    fields: ['label', 'body', 'test', 'update'],
    compile: function (node, mode, context) {
      var loop_statement = JS.LabeledStatement(
        Terr.CompileToJS(node.label, "expression", context),
        JS.ForStatement(
          undefined,
          Terr.CompileToJS(node.test, "expression", context),
          Terr.CompileToJS(node.update, "expression", context),
          intoBlock(node.body, "return", context)
        )
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
    fields: ['label'],
    compile: function (node, mode, context) {
      if (mode == "expression") {
        throw "Continue in expression position? Is this real?"
      }

      return JS.ContinueStatement(Terr.CompileToJS(node.label, "expression", context));
    }
  },

  Break: {
    fields: ['label'],
    compile: function (node, mode, context) {
      if (mode == "expression") {
        throw "Break in expression position? Is this real?"
      }

      return JS.BreakStatement(Terr.CompileToJS(node.label, "expression", context));
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
      var raw_core = Terr.Call(
        Terr.Identifier('eval'),
        [Terr.Literal(node.js)]
      );
      raw_core['x-verbatim'] = node.js;

      return Terr.CompileToJS(raw_core, mode, context);
    }
  }
}

function loc (node, js) {
  if (node.loc) {
    js.loc = node.loc;
  }
  if (node['x-verbatim']) {
    js['x-verbatim'] = node['x-verbatim'];
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
  return JS.CallExpression(JS.FunctionExpression([], body), []);
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

Terr.Compile = function (ast, mode, options) {
  return Terr.CompileToJS(ast, mode, { interactive: options.interactive });
}
