var walker = require('../lib/walker');
var assert = require('assert');

describe('Walker', function () {
  it('walks a JS tree, passing args', function () {
    var this_a = {}, this_b = {};
    var handler = function (node, walker, a, b) {
      //
      assert.equal(a, this_a);
      assert.equal(b, this_b);

      if (typeof node === "string") {
        return walker(a, b)(parseFloat(node));
      } else if (node === 2) {
        return 22;
      } else {
        return false;
      }
    }
    var sub_obj = {a: 1, b: 2};
    var result = walker(handler, [1, 2, sub_obj, "1", "2"], this_a, this_b);
    assert.deepEqual(result, [1, 22, {a: 1, b: 22}, "1", 22]);
    assert.notEqual(result[2], sub_obj);
  });
});
