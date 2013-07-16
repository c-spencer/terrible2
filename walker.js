function walkProgramTree (handlers, node) {
  function walkTree () {
    var args = Array.prototype.slice.call(arguments);

    return function selfApp (node) {
      var handler, new_node, k;

      if (handler = (node && node.constructor.name != "Object" && handlers[node.type]) || handlers.ANY) {
        result = handler.apply(null, [node, walkTree].concat(args))
        if (result !== false) {
          return result;
        }
      }

      if (Array.isArray(node)) {
        new_node = node.map(selfApp);
        new_node.type = node.type;
      } else if (typeof node == 'object') {
        new_node = {};
        for (k in node) {
          new_node[k] = selfApp(node[k]);
        }
      } else {
        new_node = node;
      }

      return new_node;
    }
  }

  var walk_args = Array.prototype.slice.call(arguments, 2);

  return walkTree.apply(null, walk_args)(node);
}

module.exports = walkProgramTree;
