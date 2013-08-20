// A partial port and modification of the Clojure reader
// https://github.com/clojure/clojure/blob/master/src/jvm/clojure/lang/LispReader.java

var core = require('./core')

// Buffer

function Buffer (string) {
  this.string = string;
  this.pos = 0;
  this.line = 0;
  this.col = 0;
}

Buffer.EOF = function () {}

Buffer.prototype.read1 = function () {
  if (this.pos === this.string.length) {
    ++this.pos;
    ++this.col;
    return " ";
  } else if (this.pos > this.string.length) {
    throw new Buffer.EOF();
  } else {
    var ch = this.string[this.pos];
    ++this.pos;
    if (ch == "\n") {
      ++this.line;
      this.col = 0;
    } else {
      ++this.col;
    }
    return ch;
  }
}

Buffer.prototype.getPos = function () {
  return { line: this.line, column: this.col }
}

Buffer.prototype.save = function () {
  return {
    line: this.line,
    col: this.col,
    pos: this.pos
  }
}

Buffer.prototype.restore = function (d) {
  this.line = d.line;
  this.col = d.col;
  this.pos = d.pos;
}

Buffer.prototype.lookahead = function (n) {
  return this.string.substring(this.pos, this.pos + n);
}

Buffer.prototype.append = function (str) {
  this.string += str;
}

Buffer.prototype.truncate = function () {
  this.string = this.string.substring(0, this.pos);
}

Buffer.prototype.remaining = function () {
  return this.string.substring(this.pos);
}

Buffer.prototype.locationFromState = function (start_state) {
  return {
    start: {
      line: start_state.line,
      column: start_state.col
    },
    end: {
      line: this.line,
      column: this.col
    }
  }
}

// Reader

var symbolPattern = /^([:][^\d\s]|[^:\d\s])[^\n\t\r\s,]*$/

// Reader macros

function unmatchedDelimiter(c) {
  return function () {
    throw "UnmatchedDelimiter `" + c + "`";
  }
}

function listReader (buffer, openparen) {
  return new core.list(this.readDelimitedList(')', buffer));
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
    if (left instanceof core.keyword || left instanceof core.symbol) {
      obj[left.name] = right;
    } else {
      obj[left] = right;
    }
  }
  return obj;
}

function commentReader (buffer) {
  while (!buffer.read1().match(/[\n\r]/));
  return buffer;
}

function yieldReader (buffer, apostrophe) {
  return new core.list([new core.symbol('yield'), this.read(buffer)]);
}

function quoteReader (buffer, apostrophe) {
  return new core.list([new core.symbol('quote'), this.read(buffer)]);
}

function syntaxQuoteReader (buffer, tick) {
  return new core.list([new core.symbol('syntax-quote'), this.read(buffer)]);
}

function unquoteReader (buffer, apostrophe) {
  if (buffer.lookahead(1) == "@") {
    buffer.read1();
    return new core.list([new core.symbol('unquote-splicing'), this.read(buffer)]);
  } else {
    return new core.list([new core.symbol('unquote'), this.read(buffer)]);
  }
}

function metadataReader (buffer, caret) {
  var ch = buffer.lookahead(1);
  if (ch === "" || this.isWhitespace(ch)) {
    return this.read(buffer);
  } else {
    var metaform = this.read(buffer);
    if (metaform instanceof core.keyword) {
      var kw = metaform;
      metaform = {};
      metaform[kw.name] = true;
    }
    var form = this.read(buffer);
    if (form instanceof core.symbol) {
      form.$metadata = metaform;
      return form;
    } else {
      throw "Can only attach metadata to symbols";
    }
  }
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
      ch = buffer.read1();

      if (ch == "t") { ch = "\t"; }
      else if (ch == "r") { ch = "\r"; }
      else if (ch == "n") { ch = "\n"; }
      else if (ch == "b") { ch = "\b"; }
      else if (ch == "f") { ch = "\f"; }
      else if (ch == "\\" || ch == '"') { }
      else { throw "Unsupported escape \\" + ch + JSON.stringify(buffer.getPos()) }
    }

    str += ch;
  }

  return str;
}

dispatchReader = function (buffer, hash) {
  var ch = buffer.lookahead(1);
  if (buffer.dispatch_handler) {
    return buffer.dispatch_handler(this, ch, buffer);
  } else {
    throw "dispatch on symbol but no Buffer dispatch_handler"
  }
};

function Reader (id_generator) {
  this.genID = id_generator;
}

var MACROS = {
  "[": vectorReader,
  "{": hashReader,
  "(": listReader,
  "]": unmatchedDelimiter("]"),
  "}": unmatchedDelimiter("}"),
  ")": unmatchedDelimiter(")"),
  ";": commentReader,
  "`": syntaxQuoteReader,
  "'": quoteReader,
  "~": unquoteReader,
  '"': stringReader,
  '#': dispatchReader,
  '^': metadataReader,
  '@': yieldReader
}

function extend_macros (map) {
  var new_macros = {};
  for (var k in MACROS) {
    new_macros[k] = MACROS[k];
  }
  for (var k in map) {
    new_macros[k] = map[k];
  }
  return new_macros;
}

Reader.prototype.withMacros = function (map, fn) {
  var prev_macros = MACROS;
  MACROS = extend_macros(map);
  var ret = fn();
  MACROS = prev_macros;
  return ret;
};

Reader.prototype.isWhitespace = function (str) { return str.match(/[\t\r\n,\s]/); }
Reader.prototype.isDigit = function (str) { return /^[0-9]$/.exec(str); }
Reader.prototype.isNumber = function (n) { return !isNaN(parseFloat(n)) && isFinite(n); }
Reader.prototype.isTerminatingMacro = function (ch) {
  return MACROS[ch] && ch != '#' && ch != '\'' && ch != '%'
}

function annotateLocation (form, buffer, start_state) {
  if (form !== null && typeof form === "object" && form.constructor != Object) {
    form.loc = buffer.locationFromState(start_state);
  }
  return form;
}

Reader.prototype.read = function (buffer) {
  while (true) {
    var ch, macro;

    var start_state = buffer.save();
    var ch = buffer.read1();

    while (this.isWhitespace(ch)) {
      start_state = buffer.save();
      ch = buffer.read1();
    }

    if (this.isDigit(ch)) {
      return this.readNumber(buffer, ch);
    }

    if (macro = MACROS[ch]) {
      var ret = macro.call(this, buffer, ch);
      if (ret == buffer) {
        continue;
      } else {
        return annotateLocation(ret, buffer, start_state);
      }
    }

    if (ch == '+' || ch == '-') {
      var buffer_state = buffer.save();
      var ch2 = buffer.read1();
      if (this.isDigit(ch2)) {
        var n = this.readNumber(buffer, ch2);
        if (ch == '-') {
          n = 0 - n;
        }
        return n;
      } else {
        buffer.restore(buffer_state);
      }
    }

    return annotateLocation(this.readToken(buffer, ch), buffer, start_state);
  }
}

Reader.prototype.readNumber = function (buffer, s) {
  while (true) {
    var buffer_state = buffer.save();
    var ch = buffer.read1();
    if (this.isWhitespace(ch) || MACROS[ch]) {
      buffer.restore(buffer_state);
      break;
    }
    s += ch;
  }

  if (!this.isNumber(s)) {
    throw "Invalid number: " + s + " " + JSON.stringify(buffer.getPos())
  }

  return parseFloat(s);
}

Reader.prototype.reifySymbol = function (s) {
  if (s == 'nil' || s == 'null') return null;
  if (s == 'true') return true;
  if (s == 'false') return false;
  if (symbolPattern.exec(s)) return new core.symbol(s);

  throw "Invalid token: #{s}";
}

Reader.prototype.readToken = function (buffer, s) {
  if (s == ":") { // keyword
    var kw = "";
    while (true) {
      var buffer_state = buffer.save();
      var ch = buffer.read1();
      if (this.isWhitespace(ch) || this.isTerminatingMacro(ch)) {
        buffer.restore(buffer_state);
        if (kw === "") {
          return new core.symbol(s);
        } else {
          return new core.keyword(kw);
        }
      }
      kw += ch;
    }
  } else { // symbol
    while (true) {
      var buffer_state = buffer.save();
      var ch = buffer.read1();
      if (this.isWhitespace(ch) || this.isTerminatingMacro(ch)) {
        buffer.restore(buffer_state);
        return this.reifySymbol(s);
      }
      s += ch;
    }
  }
}

Reader.prototype.readDelimitedList = function (endchar, buffer) {
  var forms = [], ch, macro, ret, buffer_state;
  while (true) {
    buffer_state = buffer.save();
    ch = buffer.read1();
    while (this.isWhitespace(ch)) {
      buffer_state = buffer.save();
      ch = buffer.read1();
    }

    if (ch === endchar) break;

    if (macro = MACROS[ch]) {
      ret = macro.call(this, buffer, ch);
    } else {
      buffer.restore(buffer_state);
      ret = this.read(buffer);
    }
    if (ret != buffer) {
      forms.push(ret);
    }
  }

  return forms;
}

Reader.prototype.readString = function (str, form_handler, dispatch_handler) {
  return this.newReadSession().readString(str, form_handler, dispatch_handler);
}

Reader.prototype.newReadSession = function () {
  var buffer = new Buffer(""),
      reader = this;

  return {
    buffer: buffer,
    readString: function (str, form_handler, dispatch_handler) {
      buffer.append(str);
      buffer.dispatch_handler = dispatch_handler;
      var forms = [], buffer_state;
      try {
        buffer_state = buffer.save();
        while ((form = reader.read(buffer)) !== undefined) {

          if (form != null && form.constructor !== Object) {
            form.$text = buffer.string.substring(buffer_state.pos, buffer.pos);
          }

          form_handler(null, form);

          buffer_state = buffer.save();
        }
      } catch (exception) {
        if (exception instanceof Buffer.EOF) {
          buffer.restore(buffer_state);
          return;
        } else {
          form_handler(exception);
          return;
        }
      }
    }
  }
}

exports.Reader = Reader;
exports.Buffer = Buffer;
