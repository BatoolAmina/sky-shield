export const CLASSES = ['surveillance_drone', 'fast_drone', 'low_intruder', 'swarm_member', 'bird', 'friendly_aircraft', 'civil_aircraft'];
export const LABEL = { surveillance_drone: 'Surveillance drone', fast_drone: 'Fast approaching drone', low_intruder: 'Low-altitude intruder', swarm_member: 'Swarm member', bird: 'Bird', friendly_aircraft: 'Friendly aircraft', civil_aircraft: 'Civil aircraft / helicopter' };
export const THREAT = new Set(CLASSES.slice(0, 4));
export const RESPONSES = [['monitor', 'Monitor', 'm'], ['warn', 'Warn', 'w'], ['escalate', 'Escalate', 'e'], ['ecm', 'ECM', 'c'], ['intercept', 'Intercept', 'i']];
export const threatColor = (p) => (p == null ? '#8aa0b3' : `hsl(${Math.round(120 * (1 - Math.min(1, Math.max(0, p))))},85%,55%)`);
export const ROE_TEXT = [
  'Warn / hail: allowed anywhere inside the warning zone (4 km).',
  'Electronic countermeasure: classify the track as a threat first; range 0.3 - 3.5 km.',
  'Intercept: classify as a threat first; range up to 2.5 km; track confidence at least 0.5; outside the restricted zone (1.5 km) you must escalate readiness first.',
  'Engaging a non-threat is collateral damage and costs score. Attempts that violate these rules are denied and counted.',
];
export const ASSETS = 'Protected asset at the centre of the display. Zones: restricted 1.5 km, warning 4 km, outer 9 km. Radar, RF detector, EO camera and transponder (IFF) feed one fused picture; ground truth is hidden.';
