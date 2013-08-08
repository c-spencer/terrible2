var Environment = require('./Environment').Environment;

var target = "browser";
var mode = "library";

function compileTerrible(text) {
  var env = new Environment(target);
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

  return { js: env.asJS(mode), log: messages };
}

var last_compile = null;

function doCompile(forced) {
  var this_compile = document.getElementById('terrible-input').value;
  if (forced === true || this_compile != last_compile) {
    var compile_result = compileTerrible(this_compile);
    document.getElementById('terrible-output').value = compile_result.js;
    document.getElementById('terrible-log').value = compile_result.log.join("\n");
  }
  last_compile = this_compile;
}

document.getElementById('terrible-input').addEventListener('keyup', doCompile);

document.getElementById('environment-target').addEventListener('change',
  function () {
    var el = document.getElementById('environment-target');
    target = el.value;
    doCompile(true);
  }
);

document.getElementById('environment-mode').addEventListener('change',
  function () {
    var el = document.getElementById('environment-mode');
    mode = el.value;
    doCompile(true);
  }
);

doCompile();
