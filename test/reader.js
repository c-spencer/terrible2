var reader = require('../lib/reader'),
    Buffer = reader.Buffer,
    Reader = reader.Reader,
    assert = require('assert'),
    core = require('../lib/core');

describe('Buffer', function () {
  it('properly tracks location', function () {
    var buffer = new Buffer("abc");
    assert.deepEqual(buffer.save(), { line: 0, col: 0, pos: 0 });
    assert.equal(buffer.read1(), "a");
    assert.equal(buffer.lookahead(1), "b");
    assert.equal(buffer.lookahead(2), "bc");
    assert.equal(buffer.read1(), "b");
    assert.equal(buffer.read1(), "c");
    assert.deepEqual(buffer.save(), { line: 0, col: 3, pos: 3 });
    assert.equal(buffer.read1(), " ");
    assert.throws(function () { buffer.read1() }, Buffer.EOF);

    buffer.restore({ line: 0, col: 3, pos: 3 });
    assert.deepEqual(buffer.save(), { line: 0, col: 3, pos: 3 });

    buffer.append("\ndef");
    assert.equal(buffer.lookahead(1), "\n");
    assert.equal(buffer.lookahead(2), "\nd");
    assert.equal(buffer.read1(), "\n");
    assert.equal(buffer.read1(), "d");
    assert.equal(buffer.read1(), "e");
    assert.equal(buffer.read1(), "f");
    assert.deepEqual(buffer.save(), { line: 1, col: 3, pos: 7 });

    assert.deepEqual(buffer.getPos(), { line: 1, column: 3 });

    assert.deepEqual(buffer.locationFromState({ line: 0, col: 2 }),
                      { start: { line: 0, column: 2 },
                        end: { line: 1, column: 3 } });

    buffer.restore({ line: 0, col: 3, pos: 3 });
    assert.equal(buffer.remaining(), "\ndef");
    buffer.truncate();
    assert.equal(buffer.read1(), " ");
    assert.throws(function () { buffer.read1() }, Buffer.EOF);
  });
});

function formEqual(left, right) {
  if (left instanceof core.list) {
    assert.equal(right instanceof core.list, true);
    left.values.map(function (v, i) { formEqual(v, right.values[i]); });
  } else if (left instanceof core.symbol) {
    assert.equal(right instanceof core.symbol, true);
    assert.equal(left.name, right.name);
    formEqual(left.$metadata, right.$metadata);
  } else if (Array.isArray(left)) {
    assert.equal(Array.isArray(right), true);
    left.map(function (v, i) { formEqual(v, right[i]); });
  } else if (typeof left === "object") {
    for (var k in left) {
      formEqual(left[k], right[k]);
    }
  } else {
    assert.equal(left, right);
  }
}

function equal(left, right) {
  try {
    formEqual(left, right);
  } catch (exc) {
    console.log("in", left, right);
    throw exc;
  }
}

describe('Reader', function () {
  var readForms = function (str, dispatch_fn) {
    var forms = [];
    var reader = new Reader(function (root) { return root; });

    reader.readString(str, function (err, form) {
      if (err) { throw err; }
      forms.push(form);
    }, dispatch_fn);

    return forms;
  };

  it('reads basic primitives', function () {
    assert.deepEqual(readForms('1  -1  0  3e6  4.4  "s"'),
                               [1, -1, 0, 3e6, 4.4, "s"]);

    assert.deepEqual(readForms('1 ;comment\n 2'),
                               [1, 2]);

    assert.deepEqual(readForms('"""hi "world"."""'),
                                 ['hi "world".']);

    assert.deepEqual(readForms('"\\n \\" \\r \\b \\f"'),
                                 ['\n " \r \b \f']);

    assert.deepEqual(readForms('nil null false true'),
                              [null, null, false, true]);

    assert.throws(function () { readForms('"\\x"') });
    assert.throws(function () { readForms('45a') });
  });

  var testSymbolRead = function (s) {
    equal(readForms(s), [new core.symbol(s)])
  };

  it('reads symbols', function () {
    testSymbolRead('a');
    testSymbolRead('a.b');
    testSymbolRead('a.b/a.b');
    testSymbolRead('undefined');
    testSymbolRead('-a');
    testSymbolRead('+a');
    testSymbolRead(':');
  });

  it('reads collections', function () {
    equal(readForms('()'), [new core.list([])]);
    equal(readForms('(1 2 3)'), [new core.list([1, 2, 3])]);
    equal(readForms('[]'), [[]]);
    equal(readForms('[1 2 3]'), [[1, 2, 3]]);
    equal(readForms('{}'), [{}]);
    equal(readForms('{:a 5}'), [{a: 5}]);
    equal(readForms('{a 5}'), [{a: 5}]);
    equal(readForms('{"a" 5}'), [{a: 5}]);
    assert.throws(function () { readForms(')') });
    assert.throws(function () { readForms('}') });
    assert.throws(function () { readForms(']') });
    assert.throws(function () { readForms('{:a}') });
  });

  it('expands quoting macros', function () {
    equal(readForms('`(1)'), readForms('(syntax-quote (1))'));
    equal(readForms("'(1)"), readForms('(quote (1))'));
    equal(readForms("~(1)"), readForms('(unquote (1))'));
    equal(readForms("~@(1)"), readForms('(unquote-splicing (1))'));
  });

  it('attaches metadata', function () {
    assert.throws(function () { readForms('^:meta 1') });
    assert.throws(function () { readForms('^:meta ()') });
    assert.throws(function () { readForms('^:meta []') });
    assert.throws(function () { readForms('^:meta {}') });

    equal(readForms('^'), [new core.symbol('^')]);

    var s = new core.symbol('s');
    s.$metadata = {meta: true};
    equal(readForms('^:meta s'), [s]);

    var s2 = new core.symbol('s');
    s2.$metadata = {meta: "some value", meta2: new core.symbol('a')};
    equal(readForms('^{:meta "some value" :meta2 a} s'), [s2]);
  });

  it('allows macro dispatching', function () {
    var forms = readForms('#g', function (reader, ch, buffer) {
      assert.equal(buffer.read1(), 'g');
      assert.equal(ch, 'g');
      return new core.symbol('gas');
    });
    equal(forms, [new core.symbol('gas')]);

    var forms = readForms('#g a a', function (reader, ch, buffer) {
      assert.equal(buffer.read1(), 'g');
      assert.equal(ch, 'g');

      return reader.withMacros({
        a: function (buffer, a_chr) { return new core.symbol('amazing'); }
      }, function () {
        return reader.read(buffer);
      });
    });
    equal(forms, [new core.symbol('amazing'), new core.symbol('a')]);

    assert.throws(function () { readForms('#g'); });
  });
});
