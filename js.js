exports.Identifier = function(name) {
  return {
    type: 'Identifier',
    name: name
  };
};

exports.VariableDeclaration = function(declarations) {
  return {
    type: 'VariableDeclaration',
    declarations: declarations,
    kind: 'var'
  };
};

exports.VariableDeclarator = function(id, init) {
  return {
    type: 'VariableDeclarator',
    id: id,
    init: init
  };
};

exports.NewExpression = function(callee, args) {
  return {
    type: 'NewExpression',
    callee: callee,
    "arguments": args
  };
};

exports.ObjectExpression = function(properties) {
  return {
    type: 'ObjectExpression',
    properties: properties
  };
};

exports.Literal = function(value) {
  return {
    type: 'Literal',
    value: value
  };
};

exports.CallExpression = function(callee, args) {
  return {
    type: 'CallExpression',
    callee: callee,
    "arguments": args
  };
};

exports.SequenceExpression = function(expressions) {
  return {
    type: 'SequenceExpression',
    expressions: expressions
  };
};

exports.Block = function(body) {
  return {
    type: 'BlockStatement',
    body: body
  };
};

exports.Return = function(arg) {
  return {
    type: 'ReturnStatement',
    argument: arg
  };
};

exports.ForStatement = function(init, test, update, body) {
  return {
    type: 'ForStatement',
    init: init,
    test: test,
    update: update,
    body: body
  };
};

exports.ForInStatement = function (left, right, body) {
  return {
    type: 'ForInStatement',
    left: left,
    right: right,
    body: body
  };
};

exports.FunctionExpression = function(params, body) {
  return {
    type: 'FunctionExpression',
    params: params,
    body: exports.Block(body)
  };
};

exports.FunctionDeclaration = function(id, params, body) {
  return {
    id: id,
    type: 'FunctionDeclaration',
    params: params,
    body: exports.Block(body)
  };
};

exports.ExpressionStatement = function(expr) {
  return {
    type: 'ExpressionStatement',
    expression: expr
  };
};

exports.BinaryExpression = function(left, operator, right) {
  return {
    type: 'BinaryExpression',
    operator: operator,
    left: left,
    right: right
  };
};

exports.IfStatement = function(test, consequent, alternate) {
  return {
    type: 'IfStatement',
    test: test,
    consequent: consequent,
    alternate: alternate
  };
};

exports.ConditionalExpression = function (test, consequent, alternate) {
  return {
    type: 'ConditionalExpression',
    test: test,
    consequent: consequent,
    alternate: alternate
  };
}

exports.UnaryExpression = function(operator, argument) {
  return {
    type: 'UnaryExpression',
    operator: operator,
    argument: argument
  };
};

exports.MemberExpression = function(object, property) {
  return {
    type: 'MemberExpression',
    object: object,
    property: property
  };
};

exports.LogicalExpression = function(left, operator, right) {
  return {
    type: 'LogicalExpression',
    operator: operator,
    left: left,
    right: right
  };
};

exports.AssignmentExpression = function(left, operator, right) {
  return {
    type: 'AssignmentExpression',
    operator: operator,
    left: left,
    right: right
  };
};

exports.ArrayExpression = function(elements) {
  return {
    type: 'ArrayExpression',
    elements: elements
  };
};

exports.Program = function(body) {
  return {
    type: 'Program',
    body: body
  };
};

exports.MemberExpressionComputed = function (object, property) {
  var computed;
  if (property.type === 'Literal' && /^[a-zA-Z_$][0-9a-zA-Z_$]*$/.exec(property.value)) {
    property = exports.Identifier(property.value);
    computed = false;
  } else {
    computed = true;
  }
  return {
    type: 'MemberExpression',
    object: object,
    property: property,
    computed: computed
  };
};

exports.ThrowStatement = function (arg) {
  return {
    type: 'ThrowStatement',
    argument: arg
  };
};

exports.TryStatement = function (block, handler, finalizer) {
  return {
    type: "TryStatement",
    block: block,
    handler: handler,
    guardedHandlers: [],
    finalizer: finalizer
  };
};

exports.CatchClause = function (arg, block) {
  return {
    type: "CatchClause",
    param: arg,
    body: block
  };
};

exports.This = function() {
  return {
    type: 'ThisExpression'
  };
};
