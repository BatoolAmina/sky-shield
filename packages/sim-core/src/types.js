export const CLASSES = ['surveillance_drone', 'fast_drone', 'low_intruder', 'swarm_member', 'bird', 'friendly_aircraft', 'civil_aircraft'];
export const THREAT_CLASSES = ['surveillance_drone', 'fast_drone', 'low_intruder', 'swarm_member'];
export const isThreatClass = (c) => THREAT_CLASSES.includes(c);
export const CLASS_LABEL = {
    surveillance_drone: 'Surveillance drone', fast_drone: 'Fast approaching drone', low_intruder: 'Low-altitude intruder',
    swarm_member: 'Swarm member', bird: 'Bird', friendly_aircraft: 'Friendly aircraft', civil_aircraft: 'Civil aircraft / helicopter',
};
export const TACTICS = ['direct', 'flank', 'low_altitude', 'decoy_split', 'saturation'];
export const ZONES = { restricted: 1500, warning: 4000, outer: 9000, impact: 150 };
export const zoneOfRange = (r) => (r <= ZONES.restricted ? 'restricted' : r <= ZONES.warning ? 'warning' : 'safe');
export const DEFAULT_DEFENCE = { maxConcurrent: 2, sectorCenterDeg: 0, sectorWidthDeg: 360, sectorMultIn: 1, sectorMultOut: 1, lowAltMult: 1, effMult: 1 };
