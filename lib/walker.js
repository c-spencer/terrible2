function walkProgramTree (handler, node) {
  function walkTree () {
    var args = Array.prototype.slice.call(arguments);

    return function selfApp (node) {
      if (node === undefined) return undefined;

      var new_node, k;

      result = handler.apply(null, [node, walkTree].concat(args))
      if (result !== false) {
        return result;
      }

      if (Array.isArray(node)) {
        new_node = node.map(selfApp);
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
