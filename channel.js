function Channel (metadata) {
  this.metadata = metadata;
  this.callback = this.callback.bind(this);
  this.values = [];
  this.selectors = [];
}

Channel.prototype.callback = function (v) {
  this.push(v);
}

Channel.prototype.push = function (v) {
  if (this.values.length > 0) {
    this.values.push(v);
  } else {
    if (this.selectors.length > 0) {
      var sel = this.selectors[0];
      this.selectors = this.selectors.slice(1);
      sel(v, this);
    } else {
      this.values.push(v);
    }
  }
}

Channel.prototype.select = function (callback) {
  if (this.selectors.length > 0) {
    this.selectors.push(callback);
  } else {
    if (this.values.length > 0) {
      var val = this.values[0];
      this.values = this.selectors.slice(1);
      callback(val, this);
    } else {
      this.selectors.push(callback);
    }
  }
}

Channel.prototype.removeSelect = function (callback) {
  var idx = this.selectors.indexOf(callback);
  if (~idx) {
    this.selectors.splice(idx, 1);
  }
}

Channel.select = function (channels, callback) {
  var foundSelect = false;
  function cb (v, chan) {
    foundSelect = true;
    channels.forEach(function (c) {
      c.removeSelect(cb);
    });
    callback(v, chan);
  }

  channels.forEach(function (c) {
    if (foundSelect) return;
    c.select(cb);
  });
}

var stream1 = new Channel(1);
var stream2 = new Channel(2);

setInterval(stream1.callback, 1000);
setInterval(stream2.callback, 300);

(function loop(n) {
  Channel.select([stream1, stream2], function (value, channel) {
    console.log(n, channel.metadata);
    loop(n + 1);
  });
}(1));

// (let [stream1 (chan-cb 1 (setInterval ! 1000))
//       stream2 (chan-cb 2 (setInterval ! 300))]
//   (loop [n 1]
//     (chan-select [[v c] [stream1 stream2]]
//       (console.log n c.metadata)
//       (recur (+ n 1)))))

// var s1 = (function () { var c = new Channel(1); setInterval(c.callback, 1000); return c; }())
// var s2 = (function () { var c = new Channel(1); setInterval(c.callback, 300); return c; }())

// (function recur (n) {
//   Channel.select([s1, s2], function (v, c) {
//     console.log(n, c.metadata);
//     recur(n + 1);
//   });
// }(1));
