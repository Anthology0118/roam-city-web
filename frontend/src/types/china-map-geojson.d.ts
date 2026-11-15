declare module "china-map-geojson/lib/china.js" {
  import type { FeatureCollection, Geometry } from "geojson";
  interface ProvinceProps {
    id?: string;
    name: string;
    cp?: [number, number];
    latitude?: number;
    longitude?: number;
  }
  const chinaData: FeatureCollection<Geometry, ProvinceProps>;
  export default chinaData;
}
