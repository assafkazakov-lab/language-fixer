// Emits macos/Sources/LanguageFixerCore/Resources/ngrams.json from the same
// in-memory model tools/build_model.js builds, so the Swift port and the
// extension always score from identical data. Run after build_model.js:
//   node tools/build_model.js && node tools/export_model_swift.js
'use strict';
const fs = require('fs');
const path = require('path');

global.window = global;
require(path.join(__dirname, '..', 'ngrams.js'));
const model = global.__langFixerModel;

const out = {
  scale: model.scale,
  bound: model.bound,
  he: { keys: model.he.keys, vals: model.he.vals, words: model.he.words },
  en: { keys: model.en.keys, vals: model.en.vals, words: model.en.words },
};

const dest = path.join(__dirname, '..', 'macos', 'Sources', 'LanguageFixerCore', 'Resources', 'ngrams.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`wrote ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`);
