var Environment = require('./Environment').Environment;

function compileTerrible(text) {
  var env = new Environment();
  var messages = [];
  env.scope.expose('print', function (v) {
    messages.push("> " + v);
  });

  try {
    env.evalText(text);
  } catch (exc) {
    messages.push("! " + (exc.message ? exc.message : exc));
    messages.push(exc.stack ? ("! " + exc.stack) : "");
  }

  return { js: env.asJS(), log: messages };
}

var last_compile = null;

function doCompile() {
  var this_compile = document.getElementById('terrible-input').value;
  if (this_compile != last_compile) {
    var compile_result = compileTerrible(this_compile);
    document.getElementById('terrible-output').value = compile_result.js;
    document.getElementById('terrible-log').value = compile_result.log.join("\n");
  }
  last_compile = this_compile;
}

document.getElementById('terrible-input').addEventListener('keyup', doCompile);

doCompile();
