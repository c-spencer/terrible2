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
List.prototype.concat = function (arg) {
  this.values = this.values.concat(arg);
  return this;
}
List.prototype.push = function () {
  this.values.push.apply(this.values, arguments);
  return this;
}
List.prototype.toString = function () {
  var vs = this.values.map(function (v) { return v.toString(); });
  return "(" + vs.join(" ") + ")";
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
Symbol.prototype.parse = function () {
  var name = this.name,
      ns = "",
      root = "",
      parts = [],
      ns_parts = name.split(/\//);

  if (ns_parts.length > 1 && ns_parts[0] !== "") {
    ns = ns_parts[0];
    name = ns_parts.slice(1).join("");
  }

  if (name.match(/^\.+$/)) {
    root = name;
  } else {
    var name_parts = name.split(/\./);
    root = name_parts[0];
    parts = name_parts.slice(1);
  }

  return { namespace: ns, root: root, parts: parts };
};
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
