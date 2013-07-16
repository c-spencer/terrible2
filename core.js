// Core Structures

// Vector == Array
// Map == Object
// Literals == Number / String

// Because maps in source are read as objects, we have to be careful for these
// types to not be plain objects, so that we can differentiate them.

function ListImpl(values) {
  this.values = values;
}
ListImpl.prototype.type = "List";
ListImpl.prototype.$isList = true;
function List() {
  var arr = Array.prototype.slice.call(arguments);
  return new ListImpl(arr);
}
exports.list = List;

function Symbol() {
  var args = Array.prototype.slice.apply(arguments);
  if (this instanceof Symbol) {
    this.parts = args;
  } else {
    return new (Function.prototype.bind.apply(Symbol, [null].concat(args)));
  }
}
Symbol.prototype.type = "Symbol";
Symbol.prototype.toString = function () { return this.name(); };
Symbol.prototype.addComponent = function (c) { this.parts.push(c); }
Symbol.prototype.name = function () { return this.parts[0]; }
exports.symbol = Symbol;

function Keyword (name) {
  var kw = function (m) { return m[name]; }
  kw.toString = function () { return name; };
  kw.type = "Keyword";
  return kw;
}
exports.keyword = Keyword;

// inserted support function
function forIn (obj, fn) {
  var k, arr = []
  for (k in obj) {
    arr.push(fn(k))
  }
  return arr;
}
exports.for_in = forIn;
