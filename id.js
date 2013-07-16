var id_counter = 0

var nextID = function () { return ++id_counter; }

exports.gen = function (root) {
  return root + "_$" + nextID();
}
