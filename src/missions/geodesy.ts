import { radians } from '../core/coordinates';
import { MISSION_LIMITS as M } from '../config/limits';
import type { GpsHome } from './types';
// WGS84 ellipsoid. Projection is limited to this simulator's small flight area.
const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F);
function surfaceEcef(point: GpsHome) {
  const lat = radians(point.latitude), lon = radians(point.longitude);
  const n = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
  return { x:n*Math.cos(lat)*Math.cos(lon),y:n*Math.cos(lat)*Math.sin(lon),z:n*(1-E2)*Math.sin(lat) };
}
export function gpsToLocal(point: GpsHome, home: GpsHome): { east: number; north: number } {
  for(const p of [point,home]) if(!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180) throw new Error('GPS 經緯度不合法');
  const lat=radians(home.latitude),lon=radians(home.longitude),dlat=radians(point.latitude-home.latitude),dlon=radians(point.longitude-home.longitude);
  const haversine=Math.sin(dlat/2)**2+Math.cos(lat)*Math.cos(radians(point.latitude))*Math.sin(dlon/2)**2;
  const distance=2*6371008.8*Math.asin(Math.sqrt(Math.min(1,Math.max(0,haversine))));
  // Reject distant/antipodal points before tangent-plane projection, where their
  // horizontal component can be misleadingly small.
  if(distance>M.maxGpsProjectionDistance)throw new Error('GPS 航點距離起飛點過遠');
  const p=surfaceEcef(point),h=surfaceEcef(home),x=p.x-h.x,y=p.y-h.y,z=p.z-h.z;
  return {east:-Math.sin(lon)*x+Math.cos(lon)*y,north:-Math.sin(lat)*Math.cos(lon)*x-Math.sin(lat)*Math.sin(lon)*y+Math.cos(lat)*z};
}
