var namespace = require('../lib/namespace'),
    Namespace = namespace.Namespace,
    Scope = namespace.Scope,
    assert = require('assert');

describe('Scope', function () {
  it('ismagic', function() {
    var scope = new Scope();
    var subscope = scope.newScope(true, true);
    var subscope2 = scope.newScope(true, false);

    var my_obj = {};
    scope.addSymbol('my_name', my_obj);

    // annotates metadata obj when missing
    assert.deepEqual(my_obj, {metadata:{}});

    assert.equal(scope.resolve('my_name'), my_obj);
    assert.equal(subscope.resolve('my_name'), my_obj);
    assert.equal(subscope2.resolve('my_name'), my_obj);

    assert.equal(scope.jsScoped('my_name'), true);
    assert.equal(subscope.jsScoped('my_name'), false);
    assert.equal(subscope2.jsScoped('my_name'), true);

    assert.equal(scope.nameClash('my_name'), true);
    assert.equal(subscope.nameClash('my_name'), false);
    assert.equal(subscope2.nameClash('my_name'), true);

    assert.equal(scope.logicalScoped('my_name'), true);
    assert.equal(subscope.logicalScoped('my_name'), false);
    assert.equal(subscope2.logicalScoped('my_name'), false);

    scope.update('my_name', {value: 1});
    assert.deepEqual(scope.resolve('my_name'), {value: 1, metadata:{}});
    assert.deepEqual(subscope.resolve('my_name'), {value: 1, metadata:{}});
    assert.deepEqual(subscope2.resolve('my_name'), {value: 1, metadata:{}});
    subscope.update('my_name', {value: 2});
    assert.deepEqual(scope.resolve('my_name'), {value: 2, metadata:{}});
    assert.deepEqual(subscope.resolve('my_name'), {value: 2, metadata:{}});
    assert.deepEqual(subscope2.resolve('my_name'), {value: 2, metadata:{}});

    var my_obj2 = {};
    subscope.addSymbol('my_name', my_obj2);
    assert.equal(scope.resolve('my_name'), my_obj);
    assert.equal(subscope.resolve('my_name'), my_obj2);
    assert.equal(subscope2.resolve('my_name'), my_obj);

    var other_scope = new Scope();
    var other_obj = {};
    var my_ns = {name: 'my-ns', scope: other_scope};
    other_scope.addSymbol('other_name', other_obj);

    subscope.refer('my-ns', null, my_ns);
    subscope.refer('my-ns', "m", my_ns);

    assert.equal(subscope.resolveNamespace('ma'), false);
    assert.equal(subscope.resolveNamespace('m'), my_ns);
    assert.equal(subscope.resolveNamespace('my-ns'), my_ns);

    assert.equal(scope.resolve('other_name'), false);
    assert.equal(subscope.resolve('other_name'), other_obj);
    assert.equal(other_scope.resolve('other_name'), other_obj);

    subscope2.expose('Array', Array);

    assert.equal(subscope2.resolve('Array').value, Array);

    var my_private_obj = {metadata: { private: true }};
    scope.addSymbol('my_private', my_private_obj);

    assert.deepEqual(scope.exports(), [{name: "my_name", data: my_obj},
                                       {name: "my_private", data: my_private_obj}]);

    var cloned_scope = subscope.clone();

    assert.notEqual(cloned_scope.resolve('my_name'), my_obj2);
    assert.deepEqual(cloned_scope.resolve('my_name'), my_obj2);
    assert.equal(cloned_scope.resolveNamespace('m'), my_ns);
    assert.equal(cloned_scope.resolve('other_name'), other_obj);
  });
});
