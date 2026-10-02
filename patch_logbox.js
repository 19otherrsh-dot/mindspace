const fs = require('fs');
const p = 'd:/Antigravity/Mindspace/node_modules/@expo/log-box/dist/ExpoLogBox.bundle/_expo/static/js/web/entry-d41d8cd98f00b204e9800998ecf8427e.js';
let t = fs.readFileSync(p, 'utf8');
t = t.replace(`c='function'==typeof l.default?l.default:l.default.default`, `c=(typeof l!=='undefined' && l && l.default) ? (typeof l.default === 'function' ? l.default : (l.default.default || l.default)) : (val => String(val))`);
fs.writeFileSync(p, t);
