var Environment = require('./environment').Environment;

var project_opts = {};

var project_env = new Environment({
  src_root: ""
});

project_env.scope.expose('defproject', function (opts) {
  project_opts = opts;
  return null;
});
project_env.scope.update('defproject', { metadata: { macro: true, private: true }});

project_env.getNamespace("project", false, true);

exports.Loader = {
  load: function (build) {
    var build_opts = project_opts.builds[build];
    var env = new Environment({
      src_root: build_opts.root,
      libs: build_opts.libs
    });
    env.current_namespace = env.getNamespace(build_opts.entry, false);
    env.runMethod(build_opts.main, []);
  }
}

exports.Environment = Environment;
