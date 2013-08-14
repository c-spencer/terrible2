var connect = require('connect');
var src_server = connect.static(__dirname);
connect.createServer(
  connect.static(__dirname + "/repl/", { index: 'repl.html' }),
  function (req, res, next) {
    if (req.url.match(/^\/src/)) {
      return src_server(req, res, next);
    } else {
      return next();
    }
  }
).listen(12345);
