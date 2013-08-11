var Environment = require('./Environment').Environment;

// INPUT OUTPUT

var target = "browser";
var mode = "library";
var interactive = false;

function compileTerrible(text) {
  var env = new Environment(target, interactive);
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

document.getElementById('environment-interactive').addEventListener('change',
  function () {
    var el = document.getElementById('environment-interactive');
    interactive = el.checked;
    console.log("interactive", interactive);
    doCompile(true);
  }
);

doCompile();

// REPL

window.replEnvironment = new Environment("browser", false);

function addResult(form, value) {
  var el = document.getElementById('evaled-forms');
  var new_el = document.createElement('div');
  new_el.setAttribute('class', 'evaled');

  var form_el = document.createElement('pre');
  form_el.setAttribute('class', 'form');
  form_el.innerText = form;
  new_el.appendChild(form_el);

  var value_el = document.createElement('pre');
  value_el.setAttribute('class', 'value');
  value_el.innerText = value;
  new_el.appendChild(value_el);

  el.appendChild(new_el);

  el.scrollTop = el.scrollHeight;
}

function replEval(text) {
  var results = replEnvironment.evalText(text + "\n");

  results.forEach(function (result) {
    addResult(result.text.trim(), result.value);
  });
}

document.getElementById('repl-submit').addEventListener('click', function () {
  var el = document.getElementById('repl-input');
  replEval(el.value);
  el.value = replEnvironment.readSession.buffer.remaining().trim();
  replEnvironment.readSession.buffer.truncate();
})

replEval("(+ 1 2)")
replEval("(defn inc [i] (+ i 1))")
replEval("(inc 5)")

// Toggles

document.getElementById('repl-toggle').addEventListener('click', function () {
  document.querySelector('body').setAttribute('class', 'repl');
});

document.getElementById('io-toggle').addEventListener('click', function () {
  document.querySelector('body').setAttribute('class', 'input-output');
});
