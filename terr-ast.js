var JS = require('./JS');

var Terr = exports;

var compilers = {
  Fn: {
    fields: ['bodies', 'arities', 'variadic'],
    compile: function (node, mode) {
      var bodies = node.arities.map(function (k) {
        return Terr.CompileToJS(node.bodies[k], "expression")
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
          return [JS.Return(bodies[0])];
        } else if (mode == "expression") {
          return bodies[0];
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
        Terr.CompileToJS(node.body, "return")
      )
    }
  },

  Identifier: {
    fields: ['name', 'parts'],
    compile: function (node, mode) {
      var base = JS.Identifier(node.name);
      if (node.parts) {
        for (var i = 0; i < node.parts.length; ++i) {
          base = JS.MemberExpressionComputed(base, JS.Literal(node.parts[i]));
        }
      }
      return ExpressionToMode(base, mode);
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
      return ExpressionToMode(JS.AssignmentExpression(
        Terr.CompileToJS(node.left, "expression"),
        "=",
        Terr.CompileToJS(node.right, "expression")
      ), mode);
    }
  },

  Binary: {
    fields: ['left', 'op', 'right'],
    compile: function (node, mode) {
      return ExpressionToMode(JS.BinaryExpression(
        Terr.CompileToJS(node.left, "expression"),
        node.op,
        Terr.CompileToJS(node.right, "expression")
      ), mode);
    }
  },

  Unary: {
    fields: ['op', 'expr'],
    compile: function (node, mode) {
      return ExpressionToMode(JS.UnaryExpression(
        node.op,
        Terr.CompileToJS(node.expr, "expression")
      ), mode);
    }
  },

  Call: {
    fields: ['target', 'args'],
    compile: function (node, mode) {
      return ExpressionToMode(JS.CallExpression(
        Terr.CompileToJS(node.target, "expression"),
        node.args.map(function (a) {
          return Terr.CompileToJS(a, "expression");
        })
      ), mode)
    }
  },

  Arr: {
    fields: ['values'],
    compile: function (node, mode) {
      return ExpressionToMode(JS.ArrayExpression(
        node.values.map(function (a) {
          return Terr.CompileToJS(a, "expression");
        })
      ), mode);
    }
  },

  Return: {
    fields: ['expression'],
    compile: function (node, mode) {
      if (mode == "expression") {
        throw "Return in expression position? Is this real?"
      }
      return [JS.Return(Terr.CompileToJS(node.expression, "expression"))];
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
    throw "Implement Compiler for " + ast.type;
  }
}
