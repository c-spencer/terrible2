var codegen = require('escodegen');
var JS = require('./js');

function code (node) {
  return codegen.generate(node);
}

function inspect (label, obj) {
  console.log(label, require('util').inspect(obj, false, 20));
}

var if_expression = JS.ConditionalExpression(JS.Identifier('a'), JS.Literal(true), JS.Literal(false));

var if_statement = JS.IfStatement(
  JS.Identifier('a'),
  JS.ExpressionStatement(JS.Literal(true)),
  JS.ExpressionStatement(JS.Literal(false)));

function test_return_statements(node) {
  var steps = [node];
  steps.push(JS.EnsureReturnStatement(steps[0]));
  steps.push(JS.UnensureReturnStatement(steps[1]));
  steps.push(JS.EnsureReturnStatement(steps[2]));

  var compiled_steps = steps.map(codegen.generate);

  console.log("<--Expression-->");
  console.log(compiled_steps[0]);
  console.log("<--Statement-->");
  console.log(compiled_steps[1]);
  console.log("<--And Back-->");
  console.log(compiled_steps[2]);
  console.log("<--End-->\n");
}

function test_statement_expression(node) {
  var steps = [node];
  steps.push(JS.EnsureExpression(steps[0]));
  steps.push(JS.EnsureStatement(steps[1]));
  // steps.push(JS.EnsureExpression(steps[2]));

  inspect("steps", steps);

  var compiled_steps = steps.map(codegen.generate);

  console.log("<--Statement-->");
  console.log(compiled_steps[0]);
  console.log("<--Expression-->");
  console.log(compiled_steps[1]);
  console.log("<--And Back-->");
  console.log(compiled_steps[2]);
  console.log("<--End-->\n");
}

test_return_statements(if_expression);
test_return_statements(JS.Literal(6));

console.log("\n----\n");

test_statement_expression(if_statement);
test_statement_expression(JS.ExpressionStatement(JS.Literal(6)));
