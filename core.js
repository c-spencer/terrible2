// Core Structures

// Vector == Array
// Map == Object
// Literals == Number / String

// Because maps in source are read as objects, we have to be careful for these
// types to not be plain objects, so that we can differentiate them.

function List() {
  var values = Array.prototype.slice.call(arguments, 0);
  if (this instanceof List) {
    this.values = values;
  } else {
    return new (Function.prototype.bind.apply(List, [null].concat(values)));
  }
}
exports.list = List;

function Symbol(name) {
  if (this instanceof Symbol) {
    this.name = name;
  } else {
    return new Symbol(name);
  }
}
Symbol.prototype.toString = function () { return this.name; };
exports.symbol = Symbol;

function Keyword (name) {
  if (this instanceof Keyword) {
    this.name = name;
  } else {
    return new Keyword(name);
  }
}
Keyword.prototype.toString = function () { return this.name; }
exports.keyword = Keyword;
