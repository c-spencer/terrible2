var JS = require('./JS');

var Terr = exports;

Terr.INTERACTIVE = false;

var compilers = {
  Fn: {
    fields: ['bodies', 'arities', 'variadic'],
    compile: function (node, mode) {
      var bodies = node.arities.map(function (k) {
        if (node.$noReturn) {
          node.bodies[k].$noReturn = true;
        }
        return Terr.CompileToJS(node.bodies[k], "expression");
      });

      if (node.id) {
        var fndef = Terr.CompileToJS(node.id, "expression");
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
          return [JS.Return(fn)];
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
                JS.Return(JS.CallExpression(
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
                JS.Return(JS.CallExpression(
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
          closure_body.push(JS.Return(fndef));
          return closure_body;
        } else if (mode == "statement") {
          return closure_body;
        } else {
          closure_body.push(JS.Return(fndef));
          return JS.CallExpression(JS.FunctionExpression([], closure_body), []);
        }
      }
    }
  },

  SubFn: {
    fields: ['args', 'body', 'arity', 'variadic'],
    compile: function (node, mode) {
      return JS.FunctionExpression(
        node.args.map(function (n) { return Terr.CompileToJS(n, "expression"); }),
        Terr.CompileToJS(node.body, node.$noReturn ? "statement" : "return")
      )
    }
  },

  Identifier: {
    fields: ['name'],
    compile: function (node, mode) {
      return ExpressionToMode(loc(node, JS.Identifier(node.name)), mode);
    }
  },

  NamespaceGet: {
    fields: ['namespace', 'name', 'js_name'],
    compile: function (node, mode) {
      if (!Terr.INTERACTIVE) {
        return compilers.Identifier.compile(
          loc(node, {name: node.js_name}), mode);
      }

      return Terr.CompileToJS(Terr.Call(
        Terr.Member(Terr.Identifier("$ENV"), Terr.Literal("get")),
        [ Terr.Literal(node.namespace),
          Terr.Literal(node.name) ]
      ), mode);
    }
  },

  NamespaceSet: {
    fields: ['namespace', 'name', 'js_name', 'value', 'declaration'],
    compile: function (node, mode) {
      if (!Terr.INTERACTIVE) {
        if (node.declaration == "var") {
          return compilers.Var.compile(loc(node, {
            symbol: Terr.Identifier(node.js_name),
            expression: node.value
          }), mode);
        } else {
          return compilers.Assign.compile(loc(node, {
            left: Terr.Identifier(node.js_name),
            right: node.value
          }), mode);
        }
      }

      return Terr.CompileToJS(Terr.Call(
        Terr.Member(Terr.Identifier("$ENV"), Terr.Literal("set")),
        [ Terr.Literal(node.namespace),
          Terr.Literal(node.name),
          node.value ]
      ), mode);
    }
  },

  Seq: {
    fields: ['values'],
    compile: function (node, mode) {
      var statements = [];
      for (var i = 0, len = node.values.length; i < len; ++i) {
        if (i + 1 == len && (mode == "expression" || mode == "return")) {
          statements = statements.concat(Terr.CompileToJS(node.values[i], "return"));
        } else {
          statements = statements.concat(Terr.CompileToJS(node.values[i], "statement"));
        }
      }

      if (mode == "expression") {
        return JS.CallExpression(JS.FunctionExpression([], statements), []);
      } else {
        return statements;
      }
    }
  },

  Var: {
    fields: ['symbol', 'expression'],
    compile: function (node, mode) {
      var symb = Terr.CompileToJS(node.symbol, "expression");
      var expr = Terr.CompileToJS(node.expression, "expression");
      var decl = JS.VariableDeclaration([JS.VariableDeclarator(symb, expr)]);

      if (mode == "expression") {
        return expr;
      } else if (mode == "statement") {
        return [decl];
      } else if (mode == "return") {
        return [decl, JS.Return(symb)];
      }
    }
  },

  If: {
    fields: ['test', 'cons', 'alt'],
    compile: function (node, mode) {
      var test = Terr.CompileToJS(node.test, "expression");

      if (mode == "expression") {
        return JS.ConditionalExpression(test,
          node.cons ? JS.Block(Terr.CompileToJS(node.cons, "expression")) : undefined,
          node.alt ? JS.Block(Terr.CompileToJS(node.alt, "expression")) : undefined)
      } else if (mode == "statement" || mode == "return") {
        return [JS.IfStatement(test,
                  node.cons ? JS.Block(Terr.CompileToJS(node.cons, mode)) : undefined,
                  node.alt ? JS.Block(Terr.CompileToJS(node.alt, mode)) : undefined)]
      }
    }
  },

  Literal: {
    fields: ['value'],
    compile: function (node, mode) {
      return ExpressionToMode(JS.Literal(node.value), mode);
    }
  },

  Try: {
    fields: ['body', 'catch_arg', 'catch', 'finally'],
    compile: function (node, mode) {
      if (mode == "expression" || mode == "return") {
        var sub_mode = "return";
      } else {
        var sub_mode = "statement";
      }

      var tryStatement = JS.TryStatement(
        JS.Block(Terr.CompileToJS(node.body, sub_mode)),
        JS.CatchClause(
          Terr.CompileToJS(node.catch_arg, "expression"),
          JS.Block(Terr.CompileToJS(node.catch, sub_mode))
        ),
        node.finally ? JS.Block(Terr.CompileToJS(node.finally, "statement"))
                     : undefined
      )

      if (mode == "statement" || mode == "return") {
        return [tryStatement];
      } else {
        return JS.CallExpression(JS.FunctionExpression([], [tryStatement]), []);
      }
    }
  },

  Member: {
    fields: ['left', 'right'],
    compile: function (node, mode) {
      return ExpressionToMode(JS.MemberExpressionComputed(
        Terr.CompileToJS(node.left, "expression"),
        Terr.CompileToJS(node.right, "expression")
      ), mode);
    }
  },

  Obj: {
    fields: ['properties'],
    compile: function (node, mode) {
      var props = [];
      for (var i = 0, len = node.properties.length; i < len; ++i) {
        var prop = node.properties[i];
        props.push({
          type: 'Property',
          key: JS.Literal(prop.key),
          value: Terr.CompileToJS(prop.value, "expression"),
          kind: 'init'
        });
      }

      return ExpressionToMode({ type: "ObjectExpression", properties: props }, mode);
    }
  },

  Assign: {
    fields: ['left', 'right'],
    compile: function (node, mode) {
      return ExpressionToMode(loc(node, JS.AssignmentExpression(
        Terr.CompileToJS(node.left, "expression"),
        "=",
        Terr.CompileToJS(node.right, "expression")
      )), mode);
    }
  },

  Binary: {
    fields: ['left', 'op', 'right'],
    compile: function (node, mode) {
      return ExpressionToMode(loc(node, JS.BinaryExpression(
        Terr.CompileToJS(node.left, "expression"),
        node.op,
        Terr.CompileToJS(node.right, "expression")
      )), mode);
    }
  },

  Unary: {
    fields: ['op', 'expr'],
    compile: function (node, mode) {
      return ExpressionToMode(loc(node, JS.UnaryExpression(
        node.op,
        Terr.CompileToJS(node.expr, "expression")
      )), mode);
    }
  },

  Call: {
    fields: ['target', 'args'],
    compile: function (node, mode) {
      return ExpressionToMode(loc(node, JS.CallExpression(
        Terr.CompileToJS(node.target, "expression"),
        node.args.map(function (a) {
          return Terr.CompileToJS(a, "expression");
        })
      )), mode);
    }
  },

  Arr: {
    fields: ['values'],
    compile: function (node, mode) {
      return ExpressionToMode(loc(node, JS.ArrayExpression(
        node.values.map(function (a) {
          return Terr.CompileToJS(a, "expression");
        })
      )), mode);
    }
  },

  Return: {
    fields: ['expression'],
    compile: function (node, mode) {
      if (mode == "expression") {
        throw "Return in expression position? Is this real?"
      }
      return [loc(node,
                  JS.Return(Terr.CompileToJS(node.expression, "expression")))];
    }
  },

  New: {
    fields: ['callee', 'args'],
    compile: function (node, mode) {
      return ExpressionToMode(JS.NewExpression(
        Terr.CompileToJS(node.callee, "expression"),
        node.args.map(function (a) {
          return Terr.CompileToJS(a, "expression");
        })
      ), mode);
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
    return [JS.Return(node)];
  }
  return node;
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

Terr.CompileToJS = function (ast, mode) {
  if (ast === undefined) {
    return ast;
  } else if (compilers[ast.type]) {
    return compilers[ast.type].compile(ast, mode);
  } else {
    console.trace();
    console.log(ast);
    throw "Implement Compiler for " + ast.type;
  }
}
