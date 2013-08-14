// Core Structures

// Vector == Array
// Map == Object
// Literals == Number / String

function List(values) {
  var that = this;
  this.values = values;

  this.concat = function (arg) {
    that.values = that.values.concat(arg);
    return that;
  };

  this.push = function () {
    that.values.push.apply(that.values, arguments);
    return that;
  };
}
exports.list = List;

function Symbol(name) {
  this.name = name;

  this.parse = function () { return Symbol_parse(name); };
}
var Symbol_parse = function (symbol_name) {
  var name = symbol_name,
      ns = "",
      root = "",
      parts = [],
      ns_parts = name.split(/\//);

  if (ns_parts.length > 1 && ns_parts[0] !== "") {
    name = ns_parts.slice(1).join("/");
    if (name === "") {
      name = symbol_name;
    } else {
      ns = ns_parts[0];
    }
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

var gensym_counter = 0;
function gensym (root) {
  return new Symbol("gensym$" + root + "$" + (++gensym_counter));
}
exports.gensym = gensym;
