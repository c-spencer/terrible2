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
