var Environment = Terrible.Environment;

var project_opts = {};

var project_env = new Environment({
  src_root: ""
});

project_env.scope.expose('defproject', function (opts) {
  project_opts = opts;
});

project_env.getNamespace("project", false, true);

Terrible.Loader = {
  load: function (build) {
    var build_opts = project_opts.builds[build];
    var env = new Environment({
      src_root: build_opts.root
    });
    env.getNamespace(build_opts.entry, false);
  }
}
