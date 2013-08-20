var Terr = require('../lib/terr-ast')
    JS = require('../lib/js'),
    assert = require('assert');

function runNode (node, mode) {
  if (mode == "expression") {
    return eval(JS.generate(JS.Program([Terr.Compile(node, mode, {})])));
  } else {
    return eval(JS.generate(JS.Program(Terr.Compile(node, mode, {}))));
  }

}

function testExpr (node, v) {
  assert.equal(runNode(node, "expression"), v);
}

describe('Literal', function () {
  it('lit', function () {
    testExpr(Terr.Literal(5), 5);
    testExpr(Terr.Literal(-1), -1);
    testExpr(Terr.Literal("a"), "a");
    testExpr(Terr.Literal(null), null);
    testExpr(Terr.Literal(false), false);
    testExpr(Terr.Literal(true), true);
  });
});

describe('Throw', function () {
  it('throws', function () {
    assert.throws(
      function () { runNode(Terr.Throw(Terr.Literal("a1z")), "expression") }, /a1z/);
    assert.throws(
      function () { runNode(Terr.Throw(Terr.Literal("a1z")), "return") }, /a1z/);
  });
});

describe('Identifier', function () {
  it('identifies', function () {
    testExpr(Terr.Identifier("undefined"), undefined);
    testExpr(Terr.Identifier("Array"), Array);
  });
});

describe('Binary', function () {
  it('binaries', function () {
    testExpr(Terr.Binary(Terr.Literal(1), "+", Terr.Literal(2)), 3);
  });

  it('precedence follows AST', function () {
    testExpr(Terr.Binary(
              Terr.Binary(Terr.Literal(3), "-", Terr.Literal(5)),
              "*",
              Terr.Literal(2)
            ), -4);
  });
});

describe('Unary', function () {
  it('unaries', function () {
    testExpr(Terr.Unary('-', Terr.Literal(5)), -5);
    testExpr(Terr.Unary('typeof', Terr.Literal(5)), "number");
  });
});
