/**
 * 从 schemas/ 目录按 manifest 加载 schema，不硬编码数据结构字段。
 */
const path = require('path');
const fs = require('fs');

const SCHEMAS_DIR = path.join(__dirname, 'schemas');
let manifest = null;

function getManifest() {
  if (manifest) return manifest;
  const p = path.join(SCHEMAS_DIR, 'manifest.json');
  try {
    const raw = fs.readFileSync(p, 'utf8');
    manifest = JSON.parse(raw);
    return manifest;
  } catch (e) {
    console.warn('[Aris v2][schemaLoader] manifest read failed', e?.message);
    return {};
  }
}

const cache = {};

/**
 * @param {string} entity - manifest 中的键，如 'identity' / 'requirements' / 'associations'
 * @returns {object|null} schema 对象，失败返回 null
 */
function loadSchema(entity) {
  if (cache[entity]) return cache[entity];
  const m = getManifest();
  const filename = m[entity];
  if (!filename) {
    console.warn('[Aris v2][schemaLoader] no manifest entry for', entity);
    return null;
  }
  const p = path.join(SCHEMAS_DIR, filename);
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const schema = JSON.parse(raw);
    cache[entity] = schema;
    return schema;
  } catch (e) {
    console.warn('[Aris v2][schemaLoader] load failed', entity, e?.message);
    return null;
  }
}

module.exports = { loadSchema, getManifest };
