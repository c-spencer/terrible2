var connect = require('connect');
var src_server = connect.static(__dirname);
var repl_server = connect.static(__dirname + "/repl/", { index: 'repl.html' });
connect.createServer(function (req, res, next) {
  if (req.url.match(/^\/$|^\/[^\/]*\.js$/)) {
    return repl_server(req, res, next);
  } else {
    return src_server(req, res, next);
  }
}).listen(12345);
