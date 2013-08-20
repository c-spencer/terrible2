var TJS = traceur.codegeneration.ParseTreeFactory;
var TTree = traceur.syntax.trees;

var nodes = {
  VariableDeclaration: ['lvalue', 'typeAnnotation', 'initializer'],
  NewExpression: ['callee', 'arguments'],
  ObjectExpression: ['properties'],
  SequenceExpression: ['expressions'],
  Block: ['body'],
  ReturnStatement: ['argument'],
  ForStatement: ['init', 'test', 'update', 'body'],
  ForInStatement: ['left', 'right', 'body'],
  ContinueStatement: ['label'],
  BreakStatement: ['label'],
  ExpressionStatement: ['expression'],
  IfStatement: ['test', 'consequent', 'alternate'],
  ConditionalExpression: ['test', 'consequent', 'alternate'],
  UnaryExpression: ['operator', 'argument'],
  MemberExpression: ['object', 'property'],
  MemberLookupExpression: ['object', 'property'],
  LogicalExpression: ['left', 'operator', 'right'],
  AssignmentExpression: ['left', 'operator', 'right'],
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
    // if (Array.isArray(node)) {
    //   var fields = node, defaults = {};
    // } else {
    //   var fields = node.fields, defaults = node.defaults;
    // }
    exports[type] = function () {
      // console.log(type, arguments);
      return new (Function.prototype.bind.apply(
        TTree[type],
        [null, null].concat(Array.prototype.slice.call(arguments, 0))
      ));

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
