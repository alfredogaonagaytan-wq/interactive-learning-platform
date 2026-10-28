/* Apps Script V8 lacks a few Web APIs the shared engine uses. Minimal, standards-compatible versions. */
var globalThis = this;
if (typeof TextEncoder === 'undefined') {
  this.TextEncoder = function TextEncoder() {};
  this.TextEncoder.prototype.encode = function (s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  };
}
if (typeof crypto === 'undefined') {
  this.crypto = {
    getRandomValues: function (arr) {
      var hex = '';
      while (hex.length < arr.length * 2) hex += Utilities.getUuid().replace(/-/g, '');
      for (var i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
      return arr;
    },
  };
}
