var nodes = {
  Identifier: ['name'],
  VariableDeclaration: {fields: ['declarations'], defaults: { kind: "var" }},
  VariableDeclarator: ['id', 'init'],
  NewExpression: ['callee', 'arguments'],
  ObjectExpression: ['properties'],
  Literal: ['value'],
  CallExpression: ['callee', 'arguments'],
  SequenceExpression: ['expressions'],
  BlockStatement: ['body'],
  ReturnStatement: ['argument'],
  ForStatement: ['init', 'test', 'update', 'body'],
  ForInStatement: ['left', 'right', 'body'],
  WhileStatement: ['test', 'body'],
  ContinueStatement: ['label'],
  BreakStatement: ['label'],
  LabeledStatement: ['label', 'body'],
  ExpressionStatement: ['expression'],
  BinaryExpression: ['left', 'operator', 'right'],
  IfStatement: ['test', 'consequent', 'alternate'],
  ConditionalExpression: ['test', 'consequent', 'alternate'],
  UnaryExpression: ['operator', 'argument'],
  MemberExpression: ['object', 'property'],
  LogicalExpression: ['left', 'operator', 'right'],
  AssignmentExpression: ['left', 'operator', 'right'],
  ArrayExpression: ['elements'],
  Program: ['body'],
  ThrowStatement: ['argument'],
  TryStatement: ['block', 'handler', 'finalizer'],
  CatchClause: ['param', 'block'],
  ThisExpression: []
}

for (var type in nodes) {
  (function (type, node) {
    if (Array.isArray(node)) {
      var fields = node, defaults = {};
    } else {
      var fields = node.fields, defaults = node.defaults;
    }
    exports[type] = function () {
      var o = { type: type };
      var args = arguments;
      for (var k in defaults) { o[k] = defaults[k]; }
      fields.forEach(function (field, i) {
        o[field] = args[i];
      });
      return o;
    }
  }(type, nodes[type]));
}

exports.FunctionExpression = function(params, body) {
  return {
    type: 'FunctionExpression',
    params: params,
    body: exports.BlockStatement(body)
  };
};

exports.FunctionDeclaration = function(id, params, body) {
  return {
    id: id,
    type: 'FunctionDeclaration',
    params: params,
    body: exports.BlockStatement(body)
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
