var JS = require('./js');
var Terr = require('./terr-ast');

// Scopes

function Scope (parent, js_frame) {
  this.parent = parent;
  this.logical_frame = {};
  this.js_frame = js_frame || {};
  this.ns_references = [];
}

Scope.prototype.addSymbol = function (name, metadata) {
  if (!metadata.metadata) {
    metadata.metadata = {};
  }
  this.logical_frame[name] = metadata;
  this.js_frame[name] = metadata;
}

Scope.prototype.newScope = function (logical, js) {
  if (js == true) {
    return new Scope(this);
  } else {
    return new Scope(this, this.js_frame);
  }
}

Scope.prototype.resolve = function (name) {
  if (this.logical_frame[name]) {
    return this.logical_frame[name];
  } else {
    for (var i = 0; i < this.ns_references.length; ++i) {
      var ref = this.ns_references[i];

      if (ref.alias === null) {
        var ns_resolved = ref.ns.scope.resolve(name);
        if (ns_resolved) {
          return ns_resolved;
        }
      }
    }

    return this.parent ? this.parent.resolve(name) : false;
  }
}

Scope.prototype.resolveNamespace = function (alias) {
  for (var i = 0; i < this.ns_references.length; ++i) {
    var ref = this.ns_references[i];

    if (ref.alias === alias) {
      return ref.ns;
    }
  }

  return this.parent? this.parent.resolveNamespace(alias) : false;
}

Scope.prototype.nameClash = function (name) {
  var keys = Object.keys(this.js_frame);
  for (var i = 0; i < keys.length; ++i) {
    if (keys[i] === name) return true;
  }
}

Scope.prototype.jsScoped = function (name) {
  return this.js_frame[name] != null
}

Scope.prototype.jsScope = function (predicate) {
  var logical_frame = this.logical_frame;
  var this_map = {};

  Object.keys(logical_frame).filter(function (k) {
    if (predicate(logical_frame[k])) {
      this_map[k] = logical_frame[k];
    }
  });

  if (this.parent) {
    var upper_map = this.parent.jsScope(predicate);

    Object.keys(this_map).forEach(function (k) {
      upper_map[k] = this_map[k];
    });

    return upper_map;
  } else {
    return this_map;
  }
}

Scope.prototype.logicalScoped = function (name) {
  return this.logical_frame[name] != null
}

Scope.prototype.update = function (name, attrs) {
  if (this.logical_frame[name]) {
    for (var k in attrs) {
      this.logical_frame[name][k] = attrs[k];
    }
  } else {
    return this.parent ? this.parent.update(name, attrs) : false;
  }
}

Scope.prototype.expose = function (name, value) {
  this.logical_frame[name] = {
    type: 'any',
    accessor: Terr.NamespaceGet(null, name, name),
    value: value,
    top_level: true,
    metadata: {}
  };
};

Scope.prototype.refer = function (namespace, alias, ns) {
  for (var i = 0; i < this.ns_references.length; ++i) {
    var ref = this.ns_references[i];
    if (ref.namespace == namespace && ref.alias == alias) return;
  }

  this.ns_references.push({namespace: namespace, alias: alias, ns: ns});
};

Scope.prototype.exports = function () {
  var lf = this.logical_frame;
  return Object.keys(lf).filter(function (k) {
    return !lf[k].metadata.private;
  }).map(function(k) {
    return {name: k, data: lf[k]};
  });
}

// Namespaces

function Namespace (name, scope) {
  this.name = name;
  this.scope = scope;
  this.scope.top_level = true;

  this.ast_nodes = [];
  this.dependent_namespaces = [];
}

Namespace.prototype.exportsMap = function () {
  return this.scope.exports().filter(function (exported) {
    if (exported.data.value && exported.data.value.$macro) {
      return false;
    } else {
      return true;
    }
  }).map(function (exported) {
    return {
      key: exported.name,
      value: exported.data.accessor
    };
  });
}

Namespace.prototype.requiresNamespace = function (ns) {
  if (!~this.dependent_namespaces.indexOf(ns)) {
    this.dependent_namespaces.push(ns);
  }
}

// var env = new Namespace();
// env.evalFile('jsbench.terr');
// env.evalFile('core.terr');
// env.evalText('(defn f ([a] a) ([a b] b) ([a & b] b)) (f 5) (f 5 6) (f 5 6 7)');
// env.evalText('(var a (fn ([a] a) ([a b] b)))');
// env.evalText('(console.log (f 6 7))');
// env.evalText("(var m {:a #({:a %.a}) :b (try m (catch [exc] false))})")
// env.evalText("#({:a %.a})")
// env.evalText("(ns terrible.test)");
// env.evalText("(def f 2 3)");
// env.evalText('(var b (do (try 7 (catch [my-val] my-val.message)) 7))')
// env.evalText('(var my-var 6)')
// env.evalText("(fn [a] (if (not 6) (return 6)) a)")
// env.evalText("(if 6 7 (do 8 9))")
// env.evalText("(fn [] (if (do 6 7) 7 (do 8 9)))")
// console.log(env.asJS())

exports.Namespace = Namespace;
exports.Scope = Scope;
