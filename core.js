// Core Structures

// Vector == Array
// Map == Object
// Literals == Number / String

function List(values) {
  this.values = values;
}
List.prototype.concat = function (arg) {
  this.values = this.values.concat(arg);
  return this;
}
List.prototype.push = function () {
  this.values.push.apply(this.values, arguments);
  return this;
}
exports.list = List;

function Symbol(name) {
  this.name = name;
}
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
  this.name = name;
}
exports.keyword = Keyword;
