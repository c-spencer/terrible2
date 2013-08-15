var core = require('../lib/core');
var assert = require('assert');

describe('List', function () {
  it('creates new lists', function () {
    var list = new core.list([1, 2, 3]);
    assert.deepEqual(list.values, [1, 2, 3]);

    var concat_list = list.concat([4, 5, 6]);
    assert.equal(concat_list, list);
    assert.deepEqual(list.values, [1, 2, 3, 4, 5, 6]);

    var push_list = list.push(7, 8);
    assert.equal(push_list, list);
    assert.deepEqual(list.values, [1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('Symbol', function () {
  it('creates new symbols', function () {
    var symbol = new core.symbol('a.b.c');
    assert.equal(symbol.name, 'a.b.c');
  });

  it('parses correctly', function () {
    function parse (symb, expected) {
      assert.deepEqual(new core.symbol(symb).parse(), expected);
    }

    parse('a', {namespace: '', root: 'a', parts: []});
    parse('a.b', {namespace: '', root: 'a', parts: ['b']});
    parse('a.b.c', {namespace: '', root: 'a', parts: ['b', 'c']});
    parse('a/a', {namespace: 'a', root: 'a', parts: []});
    parse('a.b/a.b', {namespace: 'a.b', root: 'a', parts: ['b']});
    parse('a.b.c/a.b.c', {namespace: 'a.b.c', root: 'a', parts: ['b', 'c']});
    parse('/', {namespace: '', root: '/', parts: []});
    parse('//', {namespace: '', root: '//', parts: []});
    parse('a/', {namespace: '', root: 'a/', parts: []});
    parse('a//', {namespace: 'a', root: '/', parts: []});
    parse('a/a.b/', {namespace: 'a', root: 'a', parts: ['b/']});
    parse('.', {namespace: '', root: '.', parts: []});
    parse('..', {namespace: '', root: '..', parts: []});
    parse('.a', {namespace: '', root: '', parts: ['a']});
    parse('.a.b', {namespace: '', root: '', parts: ['a', 'b']});
  });
});

describe('Keyword', function () {
  it('creates new keywords', function () {
    var keyword = new core.keyword('a.b.c');
    assert.equal(keyword.name, 'a.b.c');
  });
});

describe('gensym', function () {
  it('generates new symbols', function () {
    var a = core.gensym('root'), b = core.gensym('root');
    assert.equal(a instanceof core.symbol, true);
    assert.equal(b instanceof core.symbol, true);
    assert.notEqual(a.name, b.name);
  });
});
