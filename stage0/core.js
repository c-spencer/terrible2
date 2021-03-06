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
var symbol_regex = /^([^\.\/][^\/]*)\/(?:(\.+)|([^\.]+(?:\.[^\.]+)*))$|(?:(\.+)|(\.?[^\.]+(?:\.[^\.]+)*))$/;
var Symbol_parse = function (symbol_name) {
  var match = symbol_name.match(symbol_regex);
  if (match) {
    var dots = (match[1] ? match[2] : match[4]) || "";
    var parts = ((match[1] ? match[3] : match[5]) || "").split(/\./g);
    return {
      namespace: match[1] || "",
      root: dots + parts[0],
      parts: parts.slice(1)
    }
  } else {
    console.log("Couldn't match symbol regex", symbol_name);
    throw "Couldn't match symbol regex" + symbol_name;
  }
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
