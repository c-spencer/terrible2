// js index syntax
a.b.c[1 + 2](1, 2, 3)

// arrays and objects

var arr = [{my: 1, value: 2}, {"my-other": 3, value: 4}]
exports("arr")

// function arities

var $exports = {} // compile environment
function exports(name) { $exports[name] = true } // compile environment

function fn_arity(arity, fn) {
  fn.$arity = arity
  return fn
}

// no support for multi-arity lambdas

$set_arity = function (a) {
  this.$arity = a
  return this
}

$set_arity(function (a, b) { return a + b })

function g (a, b) { return a + b }.$set_arity(2)
exports("g") // compile environment


var f = (function () {
  var $fndef = function ($1, $2, $3) {
    if (arguments.length == 2) return $fndef.$2($1, $2)
    if (arguments.length == 3) return $fndef.$3($1, $2, $3)
    if (arguments.length >= 3) return $fndef.$3_.apply(this, arguments)
    throw "No matching arity."
  }

  $fndef.f$2 = function (a, b) { return 2 }
  $fndef.f$3 = function (a, b, c) { return 3 }
  $fndef.f$3_ = function (a, b, c) {
    var d = Array.prototype.slice.call(arguments, 3);
    return 4 > 3;
  }

  $fndef.$multiArity = true                         // compile environment
  $fndef.$arities = { 2: "$2", 3: "$3", 3_: "$3_" } // compile environment
  return f;
}());
exports("f"); // compile environment

f.f$2(3, 4)
f.apply(this, [5, 6, 7, 8, 9])

return { f: f, f$2: f$2, f$3: f$3, f$3_: f$3_ } // exports generation


// loop primitives

// for-in

// inserted support function
function for_in (obj, fn) {
  var k, arr = []
  for (k in obj) {
    arr.push(fn(k))
  }
  return arr;
}

for_in(obj, function (k) {
  var v = obj[k]
  return v
})

// for-in-nc

// inserted support function
function for_in_nc (obj, fn) {
  for (var k in obj) {
    fn(k)
  }
}

for_in_nc(obj, function (k) {
  return i = i + 1
})

// ifor (obvious -nc version omitted)

function ifor (start, end, step, expand, fn) {
  var i, arr = []
  if (expand) {
    for (i = start; i <= end; i += step) {
      var v = fn(i);
      for (var j = 0, len = v.length; j < v.length; ++j ) {
        arr.push(v[j])
      }
    }
  } else {
    for (i = start; i <= end; i += step) {
      arr.push(fn(i))
    }
  }
  return arr
}

ifor(0, 10, 2, true, function (i) {
  return ifor(5, 10, 1, false, function (j) {
    return i + j;
  })
})

// afor (obvious -nc version omitted)

function afor (arr, fn) {
  var arr = []
  for (var i = 0, len = arr.length; i < len; ++i) {
    arr.push(fn(i))
  }
  return arr
}

afor(arr, function (i) {
  return arr[i]
})

// for (-nc version with s/map/each/)
map(arr, function (obj) {
  map(obj, function (v, k) {
    console.log(k, v)
  })
})

// protocols

var Iterable = {
  prefix: "$Iterable$123",
  methods: {
    map: [2],
    each: [2]
  },
  isProtocol: true
}
exports("Iterable") ; // compile environment

function map(obj, func) {
  if (obj.$Iterable$123$map$2) {
    obj.$Iterable$123$map$2(obj, func)
  } else {
    $Iterable$default$map$2(obj, func)
  }
}
exports("map") ; // compile environment

function each(obj, func) {
  if (obj.$Iterable$123$each$2) {
    obj.$Iterable$123$each$2(obj, func)
  } else {
    $Iterable$default$each$2(obj, func)
  }
}
exports("each") ; // compile environment

Array.prototype.$Iterable$123$map$2 = function (obj, func) { return obj.map(func) }
$Iterable$123$default$map$2 = function (obj, func) {
  var new_obj = {}
  (function () {
    var k, v
    for (k in obj) {
      v = obj[k]
      new_obj[k] = func(v)
    }
  }())
  return new_obj
}


// types

// from coffeescript, without __super__
__extends = function(child, parent) {
  for (var key in parent) {
    if (Object.hasOwnProperty.call(parent, key)) child[key] = parent[key];
  }
  function ctor() { this.constructor = child; }
  ctor.prototype = parent.prototype;
  child.prototype = new ctor();
  return child;
};

function MyIterable(some, other, vars) {
  this['my-value'] = other + vars
  this.my = 6
}

__extends(MyIterable, SomethingElse)

MyIterable.prototype.$Iterable$123$map$2 = function (_, func) {
  return this.locals.map(func)
}

MyIterable.prototype.$Iterable$123$each$2 = function (_, func) {
  return this.locals.forEach(func)
}
