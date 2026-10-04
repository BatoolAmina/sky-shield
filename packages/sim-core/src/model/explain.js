import { shapValues } from './treeshap.js';
import { CLASS_LABEL } from '../types.js';

const LABEL = {
  speed_mean: 'speed', speed_std: 'speed variability', alt_mean: 'altitude', alt_std: 'altitude variation', vert_rate_abs: 'vertical rate', heading_rate_abs: 'heading change rate',
  curvature: 'path curvature', radial_rate: 'closing rate toward the asset', range_to_asset: 'distance to the asset', cpa_dist: 'closest-approach distance', time_to_cpa: 'time to closest approach',
  heading_to_asset_cos: 'alignment of heading with the asset', rcs_mean: 'radar signature', rcs_std: 'radar-signature variation', rf_frac: 'RF emission', rf_sig: 'RF signature type',
  iff_frac: 'transponder replies', eo_drone_frac: 'camera drone hint', eo_bird_frac: 'camera bird hint', eo_air_frac: 'camera aircraft hint', n_sensor_types: 'number of sensors seeing it',
  track_age: 'track age', fusion_conf: 'fused track confidence', hit_rate: 'radar hit rate', group_count: 'nearby tracks moving alike', group_score: 'group-motion similarity',
};
const UNIT = { speed_mean: ' m/s', speed_std: ' m/s', alt_mean: ' m', alt_std: ' m', vert_rate_abs: ' m/s', heading_rate_abs: ' deg/s', radial_rate: ' m/s', range_to_asset: ' m', cpa_dist: ' m', time_to_cpa: ' s', rcs_mean: ' dB', track_age: ' s' };
const fmt = (n, v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) + (UNIT[n] ?? '');

function describe(name, v, stats) {
  const s = stats[name]; const lab = LABEL[name] ?? name;
  if (name === 'rf_frac') return v > 0.3 ? 'RF emission is present' : 'no RF emission is seen';
  if (name === 'iff_frac') return v > 0.3 ? 'it answers transponder queries' : 'it does not answer transponder queries';
  if (name === 'rf_sig') return v < 0 ? 'no RF signature type is known' : `its RF signature type is ${v}`;
  if (name === 'radial_rate') return v < -3 ? `it is closing on the asset (${fmt(name, v)})` : v > 3 ? `it is moving away (${fmt(name, v)})` : 'it is not closing on the asset';
  if (!s) return `${lab} is ${fmt(name, v)}`;
  const level = v <= s.p25 ? 'low' : v >= s.p75 ? 'high' : 'moderate';
  return `${lab} is ${level} (${fmt(name, v)})`;
}
/** Explanation for the predicted class: top-k SHAP features turned into a template sentence. */
export function explain(model, x, k = 3) {
  const pred = model.predict(x), { phi } = shapValues(model, x), c = pred.cls;
  const idx = Array.from(phi[c].keys()).sort((a, b) => Math.abs(phi[c][b]) - Math.abs(phi[c][a])).slice(0, k);
  const top = idx.map((i) => ({ feature: model.featureNames[i], value: x[i], shap: phi[c][i], text: describe(model.featureNames[i], x[i], model.stats) }));
  const text = top.map((t) => t.text);
  const sentence = `Classified as ${CLASS_LABEL[pred.label]} because ${text.length > 1 ? text.slice(0, -1).join(', ') + ' and ' + text[text.length - 1] : text[0]}.`;
  return { ...pred, top, sentence };
}
