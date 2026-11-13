import {
  Anchor,
  BedDouble,
  Beer,
  Building2,
  Castle,
  Church,
  Compass,
  Cpu,
  DoorOpen,
  Flame,
  Footprints,
  GitBranch,
  Globe2,
  Home,
  Key,
  Landmark,
  Layers,
  LucideIcon,
  Map as MapIcon,
  MapPin,
  Mountain,
  Radio,
  Rocket,
  Shield,
  Skull,
  Store,
  Tent,
  TrainFront,
  Trees,
  Warehouse,
  Waves,
  Wrench,
} from "lucide-react";

export interface MapIconOption {
  key: string;
  label: string;
  category: "Urban" | "Transit" | "Wild" | "Facility";
  Icon: LucideIcon;
}

export const MAP_ICON_OPTIONS: MapIconOption[] = [
  { key: "map-pin", label: "Location Pin", category: "Urban", Icon: MapPin },
  { key: "building-2", label: "Building", category: "Urban", Icon: Building2 },
  { key: "home", label: "Safehouse / Inn", category: "Urban", Icon: Home },
  { key: "store", label: "Shop / Market", category: "Urban", Icon: Store },
  { key: "beer", label: "Cantina / Bar", category: "Urban", Icon: Beer },
  { key: "warehouse", label: "Warehouse", category: "Urban", Icon: Warehouse },
  { key: "landmark", label: "Civic Hall", category: "Urban", Icon: Landmark },
  { key: "castle", label: "Fortress", category: "Urban", Icon: Castle },
  { key: "church", label: "Shrine / Temple", category: "Urban", Icon: Church },
  { key: "bed-double", label: "Quarters", category: "Urban", Icon: BedDouble },
  { key: "git-branch", label: "Passage Hub", category: "Transit", Icon: GitBranch },
  { key: "door-open", label: "Portal / Gate", category: "Transit", Icon: DoorOpen },
  { key: "footprints", label: "Alley / Path", category: "Transit", Icon: Footprints },
  { key: "compass", label: "Crossroads", category: "Transit", Icon: Compass },
  { key: "train-front", label: "Rail / Transit", category: "Transit", Icon: TrainFront },
  { key: "anchor", label: "Docks / Harbor", category: "Transit", Icon: Anchor },
  { key: "rocket", label: "Spaceport", category: "Transit", Icon: Rocket },
  { key: "map", label: "District / Zone", category: "Wild", Icon: MapIcon },
  { key: "globe-2", label: "Region / Realm", category: "Wild", Icon: Globe2 },
  { key: "trees", label: "Forest / Park", category: "Wild", Icon: Trees },
  { key: "mountain", label: "Peaks / Cavern", category: "Wild", Icon: Mountain },
  { key: "waves", label: "Waterfront", category: "Wild", Icon: Waves },
  { key: "tent", label: "Encampment", category: "Wild", Icon: Tent },
  { key: "flame", label: "Hearth / Ruins", category: "Facility", Icon: Flame },
  { key: "shield", label: "Garrison / Security", category: "Facility", Icon: Shield },
  { key: "key", label: "Vault / Lock", category: "Facility", Icon: Key },
  { key: "wrench", label: "Workshop", category: "Facility", Icon: Wrench },
  { key: "cpu", label: "Server / Lab", category: "Facility", Icon: Cpu },
  { key: "radio", label: "Comms Tower", category: "Facility", Icon: Radio },
  { key: "skull", label: "Hazard / Undercroft", category: "Facility", Icon: Skull },
  { key: "layers", label: "Complex", category: "Facility", Icon: Layers },
];

const ICON_BY_KEY = new Map<string, LucideIcon>(
  MAP_ICON_OPTIONS.map((opt) => [opt.key, opt.Icon])
);

export function getDefaultMapIconKey(
  kind: "location" | "hub" | "container",
  depth?: 1 | 2 | 3 | 4
): string {
  if (kind === "hub") return "git-branch";
  if (kind === "container") {
    if (depth === 1) return "building-2";
    if (depth === 2) return "map";
    return "globe-2";
  }
  return "map-pin";
}

export function resolveMapIconComponent(
  iconKey: string | null | undefined,
  kind: "location" | "hub" | "container",
  depth?: 1 | 2 | 3 | 4
): LucideIcon {
  if (iconKey && ICON_BY_KEY.has(iconKey)) {
    return ICON_BY_KEY.get(iconKey)!;
  }
  return ICON_BY_KEY.get(getDefaultMapIconKey(kind, depth)) || MapPin;
}
