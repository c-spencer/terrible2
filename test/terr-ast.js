var Terr = require('../lib/terr-ast')
    JS = require('../lib/js'),
    assert = require('assert');

function runNode (node, mode) {
  if (mode == "expression") {
    var js = JS.generate(JS.Program([Terr.Compile(node, mode, {})]));
  } else {
    var js = JS.generate(JS.Program(Terr.Compile(node, mode, {})));
  }
  return eval(js);
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

describe('Seq', function () {
  it('sequences', function () {
    assert.equal(runNode(Terr.Seq([Terr.Literal(1), Terr.Literal(2)]), "statement"), 2);
    assert.equal(runNode(Terr.Seq([Terr.Literal(1), Terr.Literal(2)]), "expression"), 2);
  });
});

describe('Verbatim', function () {
  it('verbatim', function () {
    assert.equal(runNode(Terr.Verbatim("2 * 7"), "expression"), 14);
  });
});

describe('Obj', function () {
  it('objectifies', function () {
    assert.deepEqual(runNode(Terr.Obj([{key: "a", value: Terr.Literal("1")},
                                       {key: "b", value: Terr.Literal(2)}]), "expression"),
                     {a: "1", b: 2});
  });
});

describe('Member', function () {
  it('members', function () {
    assert.equal(runNode(Terr.Member(Terr.Obj([{key: "a", value: Terr.Literal("1")},
                                               {key: "b", value: Terr.Literal(2)}]),
                                     Terr.Literal("b")), "expression"), 2);
  });
});

describe('Arr', function () {
  it('arrays', function () {
    assert.deepEqual(runNode(Terr.Arr([Terr.Literal(1), Terr.Literal(5)]), "expression"),
                     [1, 5]);
  });
});

describe('Var', function () {
  it('vars', function () {
    assert.equal(runNode(Terr.Seq([Terr.Var([[Terr.Identifier("a"), Terr.Literal(15)]]),
                                   Terr.Identifier("a")]), "expression"), 15);
    assert.equal(runNode(Terr.Seq([Terr.Var([[Terr.Identifier("a"), Terr.Literal(15)]]),
                                   Terr.Identifier("a")]), "statement"), 15);
  });
});

describe('If', function () {
  it('conditions', function () {
    assert.equal(runNode(Terr.If(Terr.Literal(true), Terr.Literal(1), Terr.Literal(2)),
                         "expression"), 1);
    assert.equal(runNode(Terr.If(Terr.Literal(false), Terr.Literal(1), Terr.Literal(2)),
                         "expression"), 2);
    assert.equal(runNode(Terr.If(Terr.Literal(true), Terr.Literal(1), Terr.Literal(2)),
                         "statement"), 1);
    assert.equal(runNode(Terr.If(Terr.Literal(false), Terr.Literal(1), Terr.Literal(2)),
                         "statement"), 2);
  });
});

var inc_fn = Terr.Fn({1: Terr.SubFn([Terr.Identifier("a")],
                                     Terr.Binary(Terr.Identifier("a"),
                                                 "+",
                                                 Terr.Literal(1)),
                                     1,
                                     false)},
                      [1],
                      null);

var inc_vf = Terr.Fn({1: Terr.SubFn([Terr.Identifier("a")],
                                    Terr.Binary(Terr.Identifier("a"),
                                                "+",
                                                Terr.Literal(1)),
                                    1,
                                    false),
                      2: Terr.SubFn([Terr.Identifier("a"), Terr.Identifier("b")],
                                    Terr.Binary(Terr.Identifier("a"),
                                                "+",
                                                Terr.Identifier("b")),
                                    2,
                                    false),
                      _: Terr.SubFn([Terr.Identifier("a"),
                                     Terr.Identifier("b"),
                                     Terr.Identifier("c")],
                                    Terr.Binary(Terr.Identifier("a"),
                                                "-",
                                                Terr.Identifier("b")),
                                    2,
                                    true)},
                      [1, 2, "_"],
                      2);

describe('Fn', function () {
  it('functions', function () {
    assert.equal(runNode(
      Terr.Seq([
        Terr.Var([[Terr.Identifier("inc"), inc_fn]]),
        Terr.Call(Terr.Identifier("inc"), [Terr.Literal(5)])
      ]), "statement"), 6);
    assert.equal(runNode(
      Terr.Seq([
        Terr.Var([[Terr.Identifier("inc"), inc_fn]]),
        Terr.Call(Terr.Identifier("inc"), [Terr.Literal(5)])
      ]), "expression"), 6);

    assert.equal(runNode(
      Terr.Seq([
        Terr.Var([[Terr.Identifier("inc_v"), inc_vf]]),
        Terr.Call(Terr.Identifier("inc_v"), [Terr.Literal(5)])
      ]), "expression"), 6);
    assert.equal(runNode(
      Terr.Seq([
        Terr.Var([[Terr.Identifier("inc_v"), inc_vf]]),
        Terr.Call(Terr.Identifier("inc_v"), [Terr.Literal(5), Terr.Literal(5)])
      ]), "expression"), 10);
    assert.equal(runNode(
      Terr.Seq([
        Terr.Var([[Terr.Identifier("inc_v"), inc_vf]]),
        Terr.Call(Terr.Identifier("inc_v"), [Terr.Literal(5),
                                             Terr.Literal(5),
                                             Terr.Literal(2)])
      ]), "expression"), 0);
  });
});

var gen_fn = Terr.Fn({0: Terr.SubFn([],
                                    Terr.Seq([
                                      Terr.Yield(Terr.Literal(4)),
                                      Terr.Yield(Terr.Literal(8))
                                    ]),
                                    0,
                                    false)},
                      [0],
                      null);

describe('Yield', function () {
  assert.throws(function () { runNode(Terr.Yield(Terr.Literal(5)), "expression") });

  assert.deepEqual(runNode(
      Terr.Seq([
        Terr.Var([[Terr.Identifier("gen"), gen_fn],
                  [Terr.Identifier("g"), Terr.Call(Terr.Identifier("gen"), [])]]),
        Terr.Call(Terr.Member(Terr.Identifier("g"), Terr.Literal("next")), [])
      ]), "statement"), { value: 4, done: false });
});
