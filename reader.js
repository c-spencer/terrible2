// A partial port and modification of the Clojure reader
// https://github.com/clojure/clojure/blob/master/src/jvm/clojure/lang/LispReader.java

var core = require('./core')
var ID = require('./id')

// Buffer

function EOFError () {}

function Buffer (string) {
  this.string = string;
  this.pos = 0;
}

Buffer.prototype.read1 = function () {
  if (this.pos === this.string.length) {
    ++this.pos;
    return " ";
  } else if (this.pos > this.string.length) {
    throw new EOFError();
  } else {
    var ch = this.string[this.pos];
    ++this.pos;
    return ch;
  }
}

Buffer.prototype.lookahead = function (n) {
  return this.string.substring(this.pos, this.pos + n);
}

Buffer.prototype.unread = function (str) {
  this.pos -= str.length;
}

Buffer.prototype.append = function (str) {
  this.string += str;
}

// Reader

var symbolPattern = /^([:][^\d\s]|[^:\d\s])[^\n\t\r\s,]*$/

// Reader macros

function unmatchedDelimiter() {
  throw "UnmatchedDelimiter";
}

function listReader (buffer, openparen) {
  return core.list.apply(null, this.readDelimitedList(')', buffer));
}

function vectorReader (buffer, openparen) {
  return this.readDelimitedList(']', buffer);
}

function hashReader (buffer, openparen) {
  var hash = this.readDelimitedList('}', buffer);
  if (hash.length % 2) {
    throw "Hash must contain even number of forms";
  }
  var obj = {}
  for (var i = 0, len = hash.length; i < len; i += 2) {
    var left = hash[i];
    var right = hash[i+1];
    obj[left] = right;
  }
  return obj;
}

function commentReader (buffer) {
  while (!buffer.read1().match(/[\n\r]/));
  return buffer;
}

function quoteReader (buffer, apostrophe) {
  return core.list(core.symbol('quote'), this.read(buffer));
}

function syntaxQuoteReader (buffer, tick) {
  return core.list(core.symbol('syntax-quote'), this.read(buffer));
}

function unquoteReader (buffer, apostrophe) {
  return core.list(core.symbol('unquote'), this.read(buffer));
}

function splatReader (buffer, tilde) {
  return core.list(core.symbol('splat'), this.read(buffer));
}

function stringReader (buffer, quote) {
  var str = "", docquote = false, ch;

  if (buffer.lookahead(2) == '""') {
    var docquote = true;
    buffer.read1();
    buffer.read1();
  }

  while (ch = buffer.read1()) {
    if (ch == '"') {
      if (docquote) {
        if (buffer.lookahead(2) == '""') {
          buffer.read1();
          buffer.read1();
          break;
        } else {
          str += ch;
          continue;
        }
      } else {
        break;
      }
    }

    if (ch == "\\") {
      ch = buffer.read1()

      if (ch == "t") { ch = "\t"; }
      else if (ch == "r") { ch = "\r"; }
      else if (ch == "n") { ch = "\n"; }
      else if (ch == "b") { ch = "\b"; }
      else if (ch == "f") { ch = "\f"; }
      else if (ch == "\\" || ch == '"') { }
      else { throw "Unsupported escape \\" + ch }
    }

    str += ch;
  }

  return str;
}

dispatchReader = function (buffer, hash) {
  var ch = buffer.read1();
  return this.dispatch_macros[ch].call(this, buffer, ch);
}

function findArg (reader, n) {
  for (var i = 0, len = reader.ARG_ENV.length; i < len; ++i) {
    var arg = reader.ARG_ENV[i];
    if (n === arg.n) return arg;
  }
}

gen_arg = function (n) {
  var root = (n === -1) ? "rest" : "arg$" + n;
  return core.symbol(ID.gen(root));
}

function registerArg (reader, n) {
  if (!reader.ARG_ENV) {
    throw "arg lit not in #()"
  }

  var arg = findArg(reader, n);
  if (arg == null) {
    var symbol = gen_arg(n);
    reader.ARG_ENV.push({n: n, symbol: symbol});
    return symbol;
  } else {
    return arg.symbol;
  }
}

argReader = function (buffer, percent) {
  if (!this.ARG_ENV) {
    return this.readToken(buffer, percent);
  }

  var ch = buffer.lookahead(1);

  function readTrailingSymbol() {

  }

  if (this.isWhitespace(ch) || this.isTerminatingMacro(ch)) {
    return registerArg(this, 1);
  } else if (ch == ".") {
    var root = registerArg(this, 1);
    buffer.read1(); // throw away

    var symb = this.read(buffer);
    symb.parts.unshift(root.name());

    return symb;
  } else if (this.isDigit(ch)) {

    var n = buffer.read1();
    ch = buffer.read1();

    while (this.isDigit(ch)) {
      n += ch;
      ch = buffer.read1();
    }

    buffer.unread(ch);

    var n = parseFloat(n);

    var root = registerArg(this, n);

    if (buffer.lookahead(1) == ".") {
      buffer.read1();
      var symb = this.read(buffer);
      symb.parts.unshift(root.name());
      return symb;
    } else {
      return root;
    }
  }

  var n = this.read(buffer);

  if (n.type == 'Symbol' && n.name == '&') {
    return this.registerArg(-1);
  }

  if (typeof n != 'number') {
    throw 'arg literal must be %, %& or %n'
  }

  return this.registerArg(n);
}

fnReader = function (buffer, openparen) {
  buffer.unread(openparen);

  var originalENV = this.ARG_ENV;

  this.ARG_ENV = [];

  var form = this.read(buffer);

  if (originalENV && this.ARG_ENV.length != 0) {
    throw "Cannot nest lambdas with arguments."
  }

  if (this.ARG_ENV.length > 0) {
    this.ARG_ENV.sort(function (a, b) {
      if (a.n == -1) return 1;
      if (b.n == -1) return -1;
      return a.n > b.n;
    });

    if (this.ARG_ENV[this.ARG_ENV.length - 1].n === -1) {
      var rest_arg = this.ARG_ENV.pop().symbol;
    } else {
      var rest_arg = null;
    }

    var args = [];
    for (var i = 0, len = this.ARG_ENV.length; i < len; ++i) {
      args[this.ARG_ENV[i].n - 1] = this.ARG_ENV[i].symbol;
    }

    for (var i = 0, len = args.length; i < len; ++i) {
      if (!args[i]) {
        args[i] = gen_arg(i + 1);
      }
    }

    if (rest_arg) {
      args.push(core.symbol('&'));
      args.push(rest_arg);
    }
  } else {
    var args = [];
  }

  this.ARG_ENV = originalENV;

  if (form.values[0] && form.values[0].type !== "Symbol") {
    return core.list.apply(null, [core.symbol('fn'), args].concat(form.values));
  } else {
    return core.list(core.symbol('fn'), args, form);
  }
}

function Reader () {}

Reader.prototype.macros = {
  "[": vectorReader,
  "{": hashReader,
  "(": listReader,
  "]": unmatchedDelimiter,
  "}": unmatchedDelimiter,
  ")": unmatchedDelimiter,
  ";": commentReader,
  "`": syntaxQuoteReader,
  "'": quoteReader,
  "~": unquoteReader,
  "@": splatReader,
  '"': stringReader,
  '%': argReader,
  '#': dispatchReader
}

Reader.prototype.dispatch_macros = {
  '(': fnReader
}

Reader.prototype.isWhitespace = function (str) { return str.match(/[\t\r\n,\s]/); }
Reader.prototype.isDigit = function (str) { return /^[0-9]$/.exec(str); }
Reader.prototype.isNumber = function (n) { return !isNaN(parseFloat(n)) && isFinite(n); }
Reader.prototype.isTerminatingMacro = function (ch) {
  return this.macros[ch] && ch != '#' && ch != '\'' && ch != '%'
}

Reader.prototype.read = function (buffer) {
  while (true) {
    var ch, macro;

    while (this.isWhitespace(ch = buffer.read1()));

    if (this.isDigit(ch)) {
      return this.readNumber(buffer, ch);
    }

    if (macro = this.macros[ch]) {
      var ret = macro.call(this, buffer, ch);
      if (ret == buffer) {
        continue;
      } else {
        return ret;
      }
    }

    if (ch == '+' || ch == '-') {
      var ch2 = buffer.read1();
      if (this.isDigit(ch2)) {
        var n = this.readNumber(buffer, ch2);
        return core.list(core.symbol(ch), n);
      } else {
        buffer.unread(ch2);
      }
    }

    return this.readToken(buffer, ch);
  }
}

Reader.prototype.readNumber = function (buffer, s) {
  while (true) {
    var ch = buffer.read1();
    if (this.isWhitespace(ch) || this.macros[ch]) {
      buffer.unread(ch);
      break;
    }
    s += ch;
  }

  if (!this.isNumber(s)) {
    throw "Invalid number: " + s
  }

  return parseFloat(s);
}

Reader.prototype.reifySymbol = function (s) {
  if (s == 'nil' || s == 'null') return null;
  if (s == 'true') return true;
  if (s == 'false') return false;
  if (s == 'undefined') return core.symbol('undefined');
  if (symbolPattern.exec(s)) return core.symbol(s);

  throw "Invalid token: #{s}";
}

Reader.prototype.readToken = function (buffer, s) {
  if (s == ":") { // keyword
    var kw = "";
    while (true) {
      ch = buffer.read1();
      if (this.isWhitespace(ch) || this.isTerminatingMacro(ch)) {
        buffer.unread(ch);
        if (kw === "") {
          return core.symbol(s);
        } else {
          return core.keyword(kw);
        }
      }
      kw += ch;
    }
  }

  var left = null, $this = this;

  var addSymbolComponent = function (s) {
    if (left == null) {
      left = $this.reifySymbol(s);
      return left;
    } else if (s === "") {
      return left;
    } else {
      left.addComponent(s);
      return left;
    }
  }

  while (true) {
    ch = buffer.read1()

    if (ch == "[") {
      addSymbolComponent(s);
      s = "";

      var form = this.read(buffer);
      ch = buffer.read1();
      if (ch != "]") {
        throw "Unexpected symbol form";
      } else {
        addSymbolComponent(form);
        continue
      }
    }

    if (this.isWhitespace(ch) || this.isTerminatingMacro(ch)) {
      buffer.unread(ch);
      return addSymbolComponent(s);
    }

    if (ch == ".") {
      addSymbolComponent(s);
      s = "";
      continue;
    }

    s += ch;
  }
}

Reader.prototype.readDelimitedList = function (endchar, buffer) {
  var forms = [], ch, macro, ret;
  while (true) {
    while (this.isWhitespace(ch = buffer.read1()));

    if (ch === endchar) break;

    if (macro = this.macros[ch]) {
      ret = macro.call(this, buffer, ch);
    } else {
      buffer.unread(ch);
      ret = this.read(buffer);
    }
    if (ret != buffer) {
      forms.push(ret);
    }
  }

  return forms;
}

Reader.prototype.readString = function (str) {
  return this.newReadSession().readString(str);
}

Reader.prototype.newReadSession = function () {
  var buffer = new Buffer(""),
      reader = this;

  return {
    readString: function (str) {
      buffer.append(str);
      var forms = [], starting_pos = buffer.pos;
      try {
        while (form = reader.read(buffer)) {
          forms.push(form);
          starting_pos = buffer.pos;
        }
      } catch (exception) {
        if (exception instanceof EOFError) {
          buffer.pos = starting_pos;
          return forms;
        } else {
          throw exception;
        }
      }
      return forms;
    }
  }
}

// Debug and testing

print_str = function (node) {
  if (node === null) {
    return "null";
  } if (node.$isList) {
    return "(" + node.values.map(print_str).join(" ") + ")";
  } else if (node.type == "Symbol") {

    var root = node.parts[0];

    for (var i = 1, len = node.parts.length; i < len; ++i) {
      root += "[" + print_str(node.parts[i]) + "]"
    }

    return root;
  } else if (node.type == "Keyword") {
    return ":" + node.toString();
  } else if (Array.isArray(node)) {
    return "[" + node.map(print_str).join(" ") + "]";
  } else if (typeof node == "object") {
    return "{" + Object.keys(node).map(function (k) {
      return print_str(k) + ' ' + print_str(node[k])
    }).join(" ") + "}"
  } else {
    return JSON.stringify(node);
  }
}

try_parse = function (str) {
  result = reader.readString(str);
  console.log(require('util').inspect(result, false, 10));
  console.log(result.map(print_str).join("\n"))
}

// var reader = new Reader()
// try_parse("(a.b[(+ 1 2)][:a] [1 2 3] {:a 5 :b 6})");
// try_parse('(a """my fun " string""")')

exports.Reader = new Reader()
exports.printString = print_str;