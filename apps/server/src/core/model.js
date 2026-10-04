import { existsSync, readFileSync } from 'node:fs';
import { TreeModel } from '../../../../packages/sim-core/src/index.js';
/** Loads the exported mentor model (results/<run>/model/model.json). Returns null (mentor disabled) if missing. */
export function loadModel(path) {
  if (!path || !existsSync(path)) return null;
  return new TreeModel(JSON.parse(readFileSync(path, 'utf8')));
}
