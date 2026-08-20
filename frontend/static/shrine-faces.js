/* Remap canvas / img faces to the shrine portraits before roundtable.js loads. */
(function () {
  var FACE = {
    wick: "/portraits/wick.jpg",
    strike: "/portraits/strike.jpg",
    odds: "/portraits/odds.jpg",
    quorum: "/portraits/quorum.jpg",
    clock: "/portraits/clock.jpg",
    satoshi: "/portraits/satoshi-up.jpg",
    chair: "/portraits/satoshi-up.jpg",
    table: "/portraits/satoshi-table.jpg",
    shrine: "/portraits/satoshi-table.jpg"
  };

  function remap(url) {
    var s = String(url || "");
    if (!s || s.indexOf("portraits/") !== -1) return s;
    var lower = s.toLowerCase();
    if (/chair-up|chair-wait|chair-down|chair-sell|satoshi-shrine|satoshi(?!.*council)/.test(lower)) {
      return FACE.satoshi;
    }
    var names = ["wick", "strike", "odds", "quorum", "clock"];
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var re = new RegExp("(?:^|[/_.-])" + n + "(?:[-_.]|\\.|$)", "i");
      if (re.test(lower) && /bots|static|chair|portrait/.test(lower)) return FACE[n];
    }
    return s;
  }

  var proto = HTMLImageElement.prototype;
  var desc = Object.getOwnPropertyDescriptor(proto, "src");
  if (desc && desc.set && desc.get) {
    Object.defineProperty(proto, "src", {
      configurable: true,
      enumerable: desc.enumerable,
      get: function () { return desc.get.call(this); },
      set: function (v) { desc.set.call(this, remap(v)); }
    });
  }

  var origSet = proto.setAttribute;
  proto.setAttribute = function (name, value) {
    if (String(name).toLowerCase() === "src") value = remap(value);
    return origSet.call(this, name, value);
  };
})();
