
const fs = require('fs');
const { extractStateJS, extractLocalMapJS, getActionMaskJS } = require('./inference.js');
const G = JSON.parse(fs.readFileSync('dummy_G.json', 'utf8'));
// convert lists to Sets
G.seen = new Set(G.seen);
G.visible = new Set(G.visible);
const s = extractStateJS(G);
const m = extractLocalMapJS(G);
const a = getActionMaskJS(G);
console.log(JSON.stringify({
    state: Array.from(s),
    map: Array.from(m),
    mask: Array.from(a)
}));
