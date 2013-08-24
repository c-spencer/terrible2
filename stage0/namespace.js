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

    if (ref.alias === alias || ref.namespace === alias) {
      return ref.ns;
    }
  }

  return this.parent? this.parent.resolveNamespace(alias) : false;
}

// False positives, but better than false negatives.
Scope.prototype.nameClash = function (name) {
  return this.jsScoped(name);
}

Scope.prototype.jsScoped = function (name) {
  return this.js_frame[name] != null
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
    metadata: { private: true }
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
  return Object.keys(lf).map(function(k) {
    return {name: k, data: lf[k]};
  });
};

function extend(left, right, transform) {
  left = left || {};
  for (var k in right) {
    if (right.hasOwnProperty(k)) {
      if (transform) {
        left[k] = transform(right[k]);
      } else {
        left[k] = right[k];
      }
    }
  }
  return left;
}

// TODO: Really inefficient, especially on larger scopes. Should do something smarter.
Scope.prototype.clone = function () {
  var new_logical = extend({}, this.logical_frame, function (frame_entry) {
    return extend({}, frame_entry);
  });

  var new_js = extend({}, this.js_frame, function (frame_entry) {
    return extend({}, frame_entry);
  });

  var copied_scope = new Scope(this.parent, new_js);
  copied_scope.logical_frame = new_logical;
  copied_scope.ns_references = this.ns_references.slice(0);
  copied_scope.top_level = this.top_level;
  return copied_scope;
};

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
    if (exported.data.metadata['private']
        || exported.data.metadata['macro']
        || exported.data.metadata['terr-macro']
        || exported.data.metadata['reader-macro']) {
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

exports.Namespace = Namespace;
exports.Scope = Scope;
