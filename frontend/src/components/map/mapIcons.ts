import {
  AlertTriangle,
  Anchor,
  Atom,
  Axe,
  Barrel,
  BatteryCharging,
  BedDouble,
  Beer,
  Bike,
  Binoculars,
  Biohazard,
  Bomb,
  BookMarked,
  BookOpen,
  BowArrow,
  Bridge,
  Bug,
  Building,
  Building2,
  Bus,
  CableCar,
  Car,
  Castle,
  Cctv,
  Church,
  CircuitBoard,
  CloudRain,
  Cog,
  Coffee,
  Coins,
  Compass,
  Cpu,
  Crosshair,
  Crown,
  Dam,
  Dices,
  DoorClosed,
  DoorOpen,
  Drone,
  Droplet,
  Eye,
  Factory,
  Fence,
  Fish,
  Flag,
  Flame,
  FlaskConical,
  Flower2,
  Footprints,
  Gavel,
  Gem,
  Ghost,
  GitBranch,
  Globe2,
  GraduationCap,
  Hammer,
  HardDrive,
  HeartPulse,
  Home,
  Hospital,
  Hotel,
  Houses,
  Key,
  Lamp,
  Landmark,
  Layers,
  Leaf,
  Library,
  Lighthouse,
  Lock,
  LucideIcon,
  Map as MapIcon,
  MapPin,
  Martini,
  Microscope,
  Milestone,
  Moon,
  Mountain,
  MountainSnow,
  Music,
  Navigation,
  Orbit,
  Package,
  Pickaxe,
  Plane,
  Plug,
  Radar,
  Radiation,
  Radio,
  Rocket,
  Route,
  Sailboat,
  Satellite,
  Scale,
  ScrollText,
  Server,
  Shell,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Ship,
  ShoppingBag,
  Shovel,
  Signpost,
  Siren,
  Skull,
  Snowflake,
  Sofa,
  Sparkles,
  Sprout,
  Store,
  Sun,
  Sword,
  Swords,
  Syringe,
  Telescope,
  Tent,
  Terminal,
  TentTree,
  TestTube2,
  Theater,
  Ticket,
  Tombstone,
  TowerControl,
  TrainFront,
  TreePine,
  Trees,
  University,
  Users,
  Utensils,
  Vault,
  Wand2,
  Warehouse,
  Waves,
  Wifi,
  Wine,
  Wrench,
  Zap,
} from "lucide-react";

export type MapIconCategory =
  | "settlement"
  | "transit"
  | "wilderness"
  | "scifi"
  | "arcana"
  | "hazard";

export type MapIconGenreTag = "fantasy" | "scifi" | "modern" | "horror";
export type MapIconScaleTag = "location" | "hub" | "container";

export interface MapIconOption {
  key: string;
  label: string;
  category: MapIconCategory;
  keywords: string[];
  genres?: MapIconGenreTag[];
  scales?: MapIconScaleTag[];
  Icon: LucideIcon;
}

export const MAP_ICON_CATEGORIES: ReadonlyArray<{
  id: MapIconCategory;
  label: string;
  shortLabel: string;
}> = [
  { id: "settlement", label: "Settlement & Venues", shortLabel: "Settlement" },
  { id: "transit", label: "Transit & Portals", shortLabel: "Transit" },
  { id: "wilderness", label: "Nature & Terrain", shortLabel: "Nature" },
  { id: "scifi", label: "Sci-Fi & Tech", shortLabel: "Sci-Fi" },
  { id: "arcana", label: "Lore, Faith & Civic", shortLabel: "Arcana" },
  { id: "hazard", label: "Security & Hazards", shortLabel: "Hazard" },
];

const CATEGORY_LABEL_BY_ID = new Map<MapIconCategory, string>(
  MAP_ICON_CATEGORIES.map((c) => [c.id, c.label])
);

export const MAP_ICON_OPTIONS: MapIconOption[] = [
  // Settlement & Venues (29)
  {
    key: "map-pin",
    label: "Location Pin",
    category: "settlement",
    keywords: ["point", "marker", "spot", "pin", "default"],
    scales: ["location"],
    Icon: MapPin,
  },
  {
    key: "building-2",
    label: "Building / Tower",
    category: "settlement",
    keywords: ["building", "tower", "office", "block", "structure", "edifice"],
    genres: ["modern", "scifi"],
    scales: ["container", "location"],
    Icon: Building2,
  },
  {
    key: "building",
    label: "Apartment / Block",
    category: "settlement",
    keywords: ["apartment", "tenement", "housing", "condo", "highrise"],
    genres: ["modern", "scifi"],
    scales: ["container", "location"],
    Icon: Building,
  },
  {
    key: "home",
    label: "Safehouse / Dwelling",
    category: "settlement",
    keywords: ["home", "house", "cottage", "safehouse", "dwelling", "refuge"],
    genres: ["fantasy", "modern", "scifi", "horror"],
    scales: ["location", "container"],
    Icon: Home,
  },
  {
    key: "hotel",
    label: "Inn / Lodging",
    category: "settlement",
    keywords: ["hotel", "hostel", "motel", "lodging", "suites", "inn"],
    genres: ["fantasy", "modern", "scifi"],
    scales: ["container", "location"],
    Icon: Hotel,
  },
  {
    key: "bed-double",
    label: "Quarters / Dorm",
    category: "settlement",
    keywords: ["bed", "quarters", "dorm", "bedroom", "rest", "bunk", "sleep"],
    scales: ["location"],
    Icon: BedDouble,
  },
  {
    key: "sofa",
    label: "Lounge / Parlor",
    category: "settlement",
    keywords: ["sofa", "lounge", "parlor", "salon", "lobby", "waiting"],
    genres: ["modern", "scifi", "fantasy"],
    scales: ["location"],
    Icon: Sofa,
  },
  {
    key: "store",
    label: "Shop / Market",
    category: "settlement",
    keywords: ["store", "shop", "market", "bazaar", "vendor", "stall", "merchant"],
    genres: ["fantasy", "modern", "scifi"],
    scales: ["location", "container"],
    Icon: Store,
  },
  {
    key: "shopping-bag",
    label: "Exchange / Boutique",
    category: "settlement",
    keywords: ["exchange", "boutique", "mall", "trade", "emporium"],
    genres: ["modern", "scifi"],
    scales: ["location", "container"],
    Icon: ShoppingBag,
  },
  {
    key: "beer",
    label: "Cantina / Tavern",
    category: "settlement",
    keywords: ["beer", "cantina", "tavern", "bar", "pub", "saloon", "alehouse"],
    genres: ["fantasy", "scifi", "modern"],
    scales: ["location", "container"],
    Icon: Beer,
  },
  {
    key: "wine",
    label: "Cellar / Cabaret",
    category: "settlement",
    keywords: ["wine", "cellar", "vineyard", "cabaret", "banquet", "winery"],
    genres: ["fantasy", "modern", "horror"],
    scales: ["location", "container"],
    Icon: Wine,
  },
  {
    key: "coffee",
    label: "Café / Teahouse",
    category: "settlement",
    keywords: ["coffee", "cafe", "teahouse", "diner", "bistro", "nook"],
    genres: ["modern", "scifi"],
    scales: ["location"],
    Icon: Coffee,
  },
  {
    key: "utensils",
    label: "Mess Hall / Eatery",
    category: "settlement",
    keywords: ["utensils", "restaurant", "kitchen", "canteen", "mess", "feast"],
    scales: ["location"],
    Icon: Utensils,
  },
  {
    key: "martini",
    label: "Nightclub / VIP Bar",
    category: "settlement",
    keywords: ["martini", "nightclub", "club", "speakeasy", "lounge", "neon"],
    genres: ["scifi", "modern"],
    scales: ["location", "container"],
    Icon: Martini,
  },
  {
    key: "music",
    label: "Stage / Opera Hall",
    category: "settlement",
    keywords: ["music", "stage", "opera", "concert", "bard", "hall"],
    genres: ["fantasy", "modern", "scifi"],
    scales: ["location", "container"],
    Icon: Music,
  },
  {
    key: "theater",
    label: "Amphitheater / Stage",
    category: "settlement",
    keywords: ["theater", "theatre", "amphitheater", "playhouse", "cinema", "drama"],
    genres: ["fantasy", "modern", "horror"],
    scales: ["location", "container"],
    Icon: Theater,
  },
  {
    key: "dices",
    label: "Casino / Den",
    category: "settlement",
    keywords: ["dices", "casino", "gambling", "arcade", "parlor"],
    genres: ["scifi", "modern", "fantasy"],
    scales: ["location", "container"],
    Icon: Dices,
  },
  {
    key: "ticket",
    label: "Arena / Box Office",
    category: "settlement",
    keywords: ["ticket", "fair", "carnival", "booth", "circus"],
    genres: ["modern", "fantasy", "horror"],
    scales: ["location"],
    Icon: Ticket,
  },
  {
    key: "warehouse",
    label: "Warehouse / Depot",
    category: "settlement",
    keywords: ["warehouse", "depot", "storage", "cargo", "hangar", "dockyard"],
    genres: ["modern", "scifi"],
    scales: ["container", "location"],
    Icon: Warehouse,
  },
  {
    key: "factory",
    label: "Foundry / Mill",
    category: "settlement",
    keywords: ["factory", "foundry", "mill", "plant", "refinery", "smokestack"],
    genres: ["modern", "scifi"],
    scales: ["container", "location"],
    Icon: Factory,
  },
  {
    key: "wrench",
    label: "Workshop / Garage",
    category: "settlement",
    keywords: ["wrench", "workshop", "garage", "repair", "mechanic", "tinker"],
    genres: ["scifi", "modern", "fantasy"],
    scales: ["location"],
    Icon: Wrench,
  },
  {
    key: "hammer",
    label: "Forge / Guildhall",
    category: "settlement",
    keywords: ["hammer", "forge", "smithy", "blacksmith", "craft", "carpenter"],
    genres: ["fantasy", "modern"],
    scales: ["location", "container"],
    Icon: Hammer,
  },
  {
    key: "hospital",
    label: "Clinic / Infirmary",
    category: "settlement",
    keywords: ["hospital", "clinic", "infirmary", "medbay", "apothecary", "asylum"],
    genres: ["modern", "scifi", "horror"],
    scales: ["container", "location"],
    Icon: Hospital,
  },
  {
    key: "lamp",
    label: "Study / Drawing Room",
    category: "settlement",
    keywords: ["lamp", "study", "parlor", "office", "den"],
    genres: ["fantasy", "horror", "modern"],
    scales: ["location"],
    Icon: Lamp,
  },
  {
    key: "coins",
    label: "Treasury / Bank",
    category: "settlement",
    keywords: ["coins", "treasury", "bank", "mint", "gold", "guild"],
    genres: ["fantasy", "modern"],
    scales: ["location", "container"],
    Icon: Coins,
  },
  {
    key: "package",
    label: "Courier Post / Stash",
    category: "settlement",
    keywords: ["package", "courier", "parcel", "locker", "stash", "mail"],
    genres: ["modern", "scifi"],
    scales: ["location"],
    Icon: Package,
  },
  {
    key: "houses",
    label: "Village / Hamlet",
    category: "settlement",
    keywords: [
      "village",
      "hamlet",
      "houses",
      "town",
      "township",
      "settlement",
      "cluster",
      "neighborhood",
      "cottages",
      "suburb",
    ],
    genres: ["fantasy", "modern", "horror"],
    scales: ["container", "location", "hub"],
    Icon: Houses,
  },
  {
    key: "barrel",
    label: "Cellar / Supply Hold",
    category: "settlement",
    keywords: ["barrel", "cask", "cellar", "brewery", "storage", "cargo", "ale"],
    genres: ["fantasy", "modern", "horror"],
    scales: ["location", "container"],
    Icon: Barrel,
  },
  {
    key: "layers",
    label: "Multi-Level Complex",
    category: "settlement",
    keywords: ["layers", "complex", "compound", "floors", "wing", "megastructure"],
    scales: ["container"],
    Icon: Layers,
  },

  // Transit & Portals (24)
  {
    key: "git-branch",
    label: "Passage Hub",
    category: "transit",
    keywords: ["hub", "junction", "fork", "nexus", "interchange", "corridor"],
    scales: ["hub"],
    Icon: GitBranch,
  },
  {
    key: "door-open",
    label: "Portal / Gate",
    category: "transit",
    keywords: ["door", "portal", "gate", "entrance", "exit", "threshold", "archway"],
    scales: ["location", "hub"],
    Icon: DoorOpen,
  },
  {
    key: "door-closed",
    label: "Sealed Door / Airlock",
    category: "transit",
    keywords: ["airlock", "bulkhead", "hatch", "sealed", "doorway"],
    genres: ["scifi", "horror", "modern"],
    scales: ["location"],
    Icon: DoorClosed,
  },
  {
    key: "footprints",
    label: "Alley / Trail",
    category: "transit",
    keywords: ["footprints", "alley", "trail", "path", "walkway", "passage", "lane"],
    scales: ["location", "hub"],
    Icon: Footprints,
  },
  {
    key: "compass",
    label: "Crossroads / Plaza",
    category: "transit",
    keywords: ["compass", "crossroads", "plaza", "square", "waypoint", "rotunda"],
    scales: ["hub", "location", "container"],
    Icon: Compass,
  },
  {
    key: "signpost",
    label: "Trailhead / Crossing",
    category: "transit",
    keywords: ["signpost", "trailhead", "crossing", "milepost", "fork"],
    genres: ["fantasy", "modern"],
    scales: ["hub", "location"],
    Icon: Signpost,
  },
  {
    key: "route",
    label: "Highway / Trade Route",
    category: "transit",
    keywords: ["route", "highway", "road", "artery", "expressway", "caravan"],
    scales: ["hub", "container"],
    Icon: Route,
  },
  {
    key: "navigation",
    label: "Vector / Beacon",
    category: "transit",
    keywords: ["navigation", "vector", "beacon", "relay", "heading"],
    genres: ["scifi", "modern"],
    scales: ["hub", "location"],
    Icon: Navigation,
  },
  {
    key: "milestone",
    label: "Border Gate / Toll",
    category: "transit",
    keywords: ["milestone", "border", "toll", "obelisk", "boundary"],
    genres: ["fantasy", "modern"],
    scales: ["location", "hub"],
    Icon: Milestone,
  },
  {
    key: "train-front",
    label: "Rail / Metro Station",
    category: "transit",
    keywords: ["train", "rail", "metro", "subway", "tram", "monorail", "station"],
    genres: ["modern", "scifi"],
    scales: ["location", "hub", "container"],
    Icon: TrainFront,
  },
  {
    key: "bus",
    label: "Coach / Shuttle Stop",
    category: "transit",
    keywords: ["bus", "coach", "shuttle", "terminal", "depot"],
    genres: ["modern", "scifi"],
    scales: ["location"],
    Icon: Bus,
  },
  {
    key: "car",
    label: "Motorpool / Street",
    category: "transit",
    keywords: ["car", "motorpool", "street", "convoy", "parking", "drive"],
    genres: ["modern", "scifi"],
    scales: ["location"],
    Icon: Car,
  },
  {
    key: "bike",
    label: "Courier / Cycle Lane",
    category: "transit",
    keywords: ["bike", "cycle", "bicycle", "alleyway"],
    genres: ["modern", "scifi"],
    scales: ["location"],
    Icon: Bike,
  },
  {
    key: "anchor",
    label: "Docks / Harbor",
    category: "transit",
    keywords: ["anchor", "docks", "harbor", "harbour", "port", "pier", "marina", "quay"],
    genres: ["fantasy", "modern", "scifi", "horror"],
    scales: ["container", "location"],
    Icon: Anchor,
  },
  {
    key: "ship",
    label: "Ferry / Drydock",
    category: "transit",
    keywords: ["ship", "ferry", "drydock", "vessel", "galleon", "barge"],
    genres: ["fantasy", "modern", "horror"],
    scales: ["container", "location"],
    Icon: Ship,
  },
  {
    key: "sailboat",
    label: "Cove / Landing",
    category: "transit",
    keywords: ["sailboat", "boat", "skiff", "jetty", "landing"],
    genres: ["fantasy", "modern"],
    scales: ["location"],
    Icon: Sailboat,
  },
  {
    key: "plane",
    label: "Airfield / Helipad",
    category: "transit",
    keywords: ["plane", "airfield", "airport", "helipad", "runway", "skyport"],
    genres: ["modern", "scifi"],
    scales: ["container", "location"],
    Icon: Plane,
  },
  {
    key: "rocket",
    label: "Spaceport / Launchpad",
    category: "transit",
    keywords: ["rocket", "spaceport", "starport", "launchpad", "shuttle", "orbiter"],
    genres: ["scifi"],
    scales: ["container", "location"],
    Icon: Rocket,
  },
  {
    key: "fence",
    label: "Courtyard / Perimeter",
    category: "transit",
    keywords: ["fence", "courtyard", "perimeter", "palisade", "yard"],
    genres: ["fantasy", "modern", "horror"],
    scales: ["location"],
    Icon: Fence,
  },
  {
    key: "bridge",
    label: "Bridge / Crossing",
    category: "transit",
    keywords: ["bridge", "viaduct", "overpass", "span", "aqueduct", "crossing"],
    genres: ["fantasy", "modern", "scifi", "horror"],
    scales: ["location", "hub"],
    Icon: Bridge,
  },
  {
    key: "lighthouse",
    label: "Lighthouse / Beacon",
    category: "transit",
    keywords: ["lighthouse", "beacon", "coast", "harbor", "tower", "signal"],
    genres: ["fantasy", "modern", "horror"],
    scales: ["location", "container"],
    Icon: Lighthouse,
  },
  {
    key: "cable-car",
    label: "Cable Car / Skyway",
    category: "transit",
    keywords: ["cable", "gondola", "tram", "skyway", "lift", "ski", "mountain"],
    genres: ["modern", "scifi", "fantasy"],
    scales: ["location", "hub"],
    Icon: CableCar,
  },
  {
    key: "tower-control",
    label: "Control / Watch Tower",
    category: "transit",
    keywords: ["control", "air", "tower", "watchtower", "spire", "radar"],
    genres: ["modern", "scifi"],
    scales: ["location", "container"],
    Icon: TowerControl,
  },
  {
    key: "flag",
    label: "Outpost / Rally Point",
    category: "transit",
    keywords: ["flag", "outpost", "banner", "garrison", "checkpoint"],
    genres: ["fantasy", "modern", "scifi"],
    scales: ["location", "container"],
    Icon: Flag,
  },

  // Nature & Terrain (24)
  {
    key: "map",
    label: "District / Zone",
    category: "wilderness",
    keywords: ["map", "district", "zone", "territory", "sector", "quarter"],
    scales: ["container"],
    Icon: MapIcon,
  },
  {
    key: "globe-2",
    label: "Region / Realm",
    category: "wilderness",
    keywords: ["globe", "region", "realm", "planet", "continent", "world"],
    scales: ["container"],
    Icon: Globe2,
  },
  {
    key: "trees",
    label: "Forest / Park",
    category: "wilderness",
    keywords: ["trees", "forest", "woods", "park", "grove", "jungle", "glade"],
    genres: ["fantasy", "modern", "horror"],
    scales: ["container", "location"],
    Icon: Trees,
  },
  {
    key: "tree-pine",
    label: "Taiga / Pinewood",
    category: "wilderness",
    keywords: ["pine", "taiga", "timberland", "conifer", "evergreen"],
    genres: ["fantasy", "horror", "modern"],
    scales: ["container", "location"],
    Icon: TreePine,
  },
  {
    key: "sprout",
    label: "Oasis / Greenhouse",
    category: "wilderness",
    keywords: ["sprout", "oasis", "greenhouse", "garden", "overgrowth", "botanical"],
    genres: ["fantasy", "scifi", "modern"],
    scales: ["location"],
    Icon: Sprout,
  },
  {
    key: "flower-2",
    label: "Meadow / Conservatory",
    category: "wilderness",
    keywords: ["flower", "meadow", "conservatory", "arboretum", "bloom"],
    genres: ["fantasy", "modern"],
    scales: ["location"],
    Icon: Flower2,
  },
  {
    key: "leaf",
    label: "Canopy / Sanctuary",
    category: "wilderness",
    keywords: ["leaf", "canopy", "thicket", "druid", "autumn"],
    genres: ["fantasy"],
    scales: ["location", "container"],
    Icon: Leaf,
  },
  {
    key: "mountain",
    label: "Peaks / Cavern",
    category: "wilderness",
    keywords: ["mountain", "peaks", "cavern", "cave", "ridge", "cliff", "pass"],
    genres: ["fantasy", "modern", "horror"],
    scales: ["container", "location"],
    Icon: Mountain,
  },
  {
    key: "mountain-snow",
    label: "Glacier / Alpine Peak",
    category: "wilderness",
    keywords: ["alpine", "glacier", "summit", "snowy", "crag"],
    genres: ["fantasy", "scifi"],
    scales: ["container", "location"],
    Icon: MountainSnow,
  },
  {
    key: "waves",
    label: "Waterfront / Canal",
    category: "wilderness",
    keywords: ["waves", "waterfront", "canal", "river", "sea", "sewer", "marsh"],
    scales: ["location", "container"],
    Icon: Waves,
  },
  {
    key: "droplet",
    label: "Spring / Cistern",
    category: "wilderness",
    keywords: ["droplet", "spring", "cistern", "well", "fountain", "reservoir"],
    genres: ["fantasy", "modern", "horror"],
    scales: ["location"],
    Icon: Droplet,
  },
  {
    key: "shell",
    label: "Coast / Tidepool",
    category: "wilderness",
    keywords: ["shell", "coast", "beach", "tidepool", "shore", "atoll"],
    genres: ["fantasy", "modern"],
    scales: ["location"],
    Icon: Shell,
  },
  {
    key: "fish",
    label: "Fishery / Deep Reef",
    category: "wilderness",
    keywords: ["fish", "fishery", "reef", "pond", "kelp", "sunken"],
    genres: ["fantasy", "modern"],
    scales: ["location"],
    Icon: Fish,
  },
  {
    key: "tent",
    label: "Encampment / Nomad",
    category: "wilderness",
    keywords: ["tent", "encampment", "camp", "nomad", "yurt", "bivouac"],
    genres: ["fantasy", "modern", "scifi"],
    scales: ["container", "location"],
    Icon: Tent,
  },
  {
    key: "flame",
    label: "Hearth / Ruins",
    category: "wilderness",
    keywords: ["flame", "hearth", "bonfire", "volcanic", "ruins", "ash", "forge"],
    genres: ["fantasy", "horror"],
    scales: ["location"],
    Icon: Flame,
  },
  {
    key: "sun",
    label: "Badlands / Solar Basin",
    category: "wilderness",
    keywords: ["sun", "badlands", "desert", "dune", "wasteland", "solarium"],
    genres: ["fantasy", "scifi"],
    scales: ["container", "location"],
    Icon: Sun,
  },
  {
    key: "moon",
    label: "Nocturne / Shadowed",
    category: "wilderness",
    keywords: ["moon", "nocturne", "night", "moonwell", "crescent", "shadow"],
    genres: ["fantasy", "horror"],
    scales: ["location"],
    Icon: Moon,
  },
  {
    key: "snowflake",
    label: "Tundra / Cryo Zone",
    category: "wilderness",
    keywords: ["snowflake", "tundra", "ice", "frost", "cryo", "frozen"],
    genres: ["fantasy", "scifi", "horror"],
    scales: ["container", "location"],
    Icon: Snowflake,
  },
  {
    key: "cloud-rain",
    label: "Mire / Monsoon Zone",
    category: "wilderness",
    keywords: ["rain", "mire", "bog", "swamp", "storm", "fen", "moor"],
    genres: ["fantasy", "horror"],
    scales: ["container", "location"],
    Icon: CloudRain,
  },
  {
    key: "bug",
    label: "Hive / Nest",
    category: "wilderness",
    keywords: ["bug", "hive", "nest", "swarm", "burrow", "chasm"],
    genres: ["scifi", "fantasy", "horror"],
    scales: ["container", "location"],
    Icon: Bug,
  },
  {
    key: "pickaxe",
    label: "Mine / Quarry",
    category: "wilderness",
    keywords: ["pickaxe", "mine", "quarry", "shaft", "excavation", "tunnel"],
    genres: ["fantasy", "modern", "scifi"],
    scales: ["container", "location"],
    Icon: Pickaxe,
  },
  {
    key: "tent-tree",
    label: "Forest Camp / Outpost",
    category: "wilderness",
    keywords: ["tent", "camp", "woods", "glade", "outpost", "ranger", "bivouac"],
    genres: ["fantasy", "modern", "horror"],
    scales: ["container", "location"],
    Icon: TentTree,
  },
  {
    key: "dam",
    label: "Dam / Canal Lock",
    category: "wilderness",
    keywords: ["dam", "hydro", "reservoir", "lock", "sluice", "floodgate", "river"],
    genres: ["modern", "scifi", "fantasy"],
    scales: ["location", "container"],
    Icon: Dam,
  },
  {
    key: "shovel",
    label: "Trench / Excavation",
    category: "wilderness",
    keywords: ["shovel", "trench", "barrow", "excavation", "dig"],
    genres: ["horror", "fantasy", "modern"],
    scales: ["location"],
    Icon: Shovel,
  },

  // Sci-Fi & Tech (21)
  {
    key: "cpu",
    label: "Server / Mainframe",
    category: "scifi",
    keywords: ["cpu", "server", "mainframe", "processor", "core", "ai"],
    genres: ["scifi", "modern"],
    scales: ["location", "container"],
    Icon: Cpu,
  },
  {
    key: "server",
    label: "Data Center / Rack",
    category: "scifi",
    keywords: ["server", "datacenter", "subnet", "datavault", "rack"],
    genres: ["scifi", "modern"],
    scales: ["container", "location"],
    Icon: Server,
  },
  {
    key: "hard-drive",
    label: "Archive Drive / Vault",
    category: "scifi",
    keywords: ["drive", "storage", "databank", "memory"],
    genres: ["scifi", "modern"],
    scales: ["location"],
    Icon: HardDrive,
  },
  {
    key: "circuit-board",
    label: "Cybernetics / Fab",
    category: "scifi",
    keywords: ["circuit", "cybernetics", "chrome", "implant", "synth", "fab"],
    genres: ["scifi"],
    scales: ["location", "container"],
    Icon: CircuitBoard,
  },
  {
    key: "terminal",
    label: "Netrunner Den / Console",
    category: "scifi",
    keywords: ["terminal", "netrunner", "deck", "hack", "console", "matrix"],
    genres: ["scifi", "modern"],
    scales: ["location"],
    Icon: Terminal,
  },
  {
    key: "radio",
    label: "Comms Tower / Array",
    category: "scifi",
    keywords: ["radio", "comms", "tower", "broadcast", "antenna", "signal"],
    genres: ["scifi", "modern"],
    scales: ["location", "container"],
    Icon: Radio,
  },
  {
    key: "wifi",
    label: "Mesh Node / Relay",
    category: "scifi",
    keywords: ["wifi", "mesh", "uplink", "hotspot", "network"],
    genres: ["scifi", "modern"],
    scales: ["hub", "location"],
    Icon: Wifi,
  },
  {
    key: "satellite",
    label: "Satellite / Dish Array",
    category: "scifi",
    keywords: ["satellite", "dish", "telemetry", "uplink"],
    genres: ["scifi", "modern"],
    scales: ["location", "container"],
    Icon: Satellite,
  },
  {
    key: "orbit",
    label: "Orbital Station / Ring",
    category: "scifi",
    keywords: ["orbit", "orbital", "station", "zerog", "habitat"],
    genres: ["scifi"],
    scales: ["container", "location"],
    Icon: Orbit,
  },
  {
    key: "radar",
    label: "Sensor Grid / Scan Post",
    category: "scifi",
    keywords: ["radar", "sensor", "sonar", "sweep", "tracking"],
    genres: ["scifi", "modern"],
    scales: ["location"],
    Icon: Radar,
  },
  {
    key: "zap",
    label: "Power Plant / Substation",
    category: "scifi",
    keywords: ["zap", "power", "substation", "generator", "grid", "voltage"],
    genres: ["scifi", "modern"],
    scales: ["container", "location"],
    Icon: Zap,
  },
  {
    key: "battery-charging",
    label: "Charging Bay / Capacitor",
    category: "scifi",
    keywords: ["battery", "charging", "capacitor", "fuel", "cell"],
    genres: ["scifi", "modern"],
    scales: ["location"],
    Icon: BatteryCharging,
  },
  {
    key: "plug",
    label: "Conduit / Utility Bay",
    category: "scifi",
    keywords: ["plug", "conduit", "utility", "maintenance", "sublevel"],
    genres: ["scifi", "modern"],
    scales: ["location", "hub"],
    Icon: Plug,
  },
  {
    key: "cog",
    label: "Machinery / Clockwork",
    category: "scifi",
    keywords: ["cog", "gear", "machinery", "turbine", "engine", "clockwork"],
    genres: ["scifi", "fantasy", "modern"],
    scales: ["location", "container"],
    Icon: Cog,
  },
  {
    key: "flask-conical",
    label: "Lab / Alchemy",
    category: "scifi",
    keywords: ["flask", "lab", "laboratory", "alchemy", "chem", "biotech"],
    genres: ["scifi", "fantasy", "horror"],
    scales: ["location", "container"],
    Icon: FlaskConical,
  },
  {
    key: "microscope",
    label: "Research / Pathology",
    category: "scifi",
    keywords: ["microscope", "research", "pathology", "bio", "science"],
    genres: ["scifi", "modern", "horror"],
    scales: ["location"],
    Icon: Microscope,
  },
  {
    key: "test-tube-2",
    label: "Vat / Mutagenics",
    category: "scifi",
    keywords: ["vat", "mutagen", "cloning", "specimen", "biolab"],
    genres: ["scifi", "horror"],
    scales: ["location"],
    Icon: TestTube2,
  },
  {
    key: "atom",
    label: "Reactor / Physics Core",
    category: "scifi",
    keywords: ["atom", "reactor", "fusion", "quantum", "collider"],
    genres: ["scifi"],
    scales: ["location", "container"],
    Icon: Atom,
  },
  {
    key: "heart-pulse",
    label: "Trauma Bay / Ripperdoc",
    category: "scifi",
    keywords: ["trauma", "ripperdoc", "cybermed", "triage", "icu", "morgue"],
    genres: ["scifi", "modern", "horror"],
    scales: ["location"],
    Icon: HeartPulse,
  },
  {
    key: "drone",
    label: "Drone Bay / Hangar",
    category: "scifi",
    keywords: ["drone", "uav", "hangar", "bay", "recon", "automated"],
    genres: ["scifi", "modern"],
    scales: ["location", "container"],
    Icon: Drone,
  },
  {
    key: "syringe",
    label: "Chem Lab / Medpod",
    category: "scifi",
    keywords: ["syringe", "stim", "medpod", "pharmacy", "injector"],
    genres: ["scifi", "modern", "horror"],
    scales: ["location"],
    Icon: Syringe,
  },

  // Lore, Faith & Civic (19)
  {
    key: "landmark",
    label: "Civic Hall / Monument",
    category: "arcana",
    keywords: ["landmark", "civic", "senate", "capitol", "monument", "museum"],
    genres: ["fantasy", "modern", "scifi"],
    scales: ["container", "location"],
    Icon: Landmark,
  },
  {
    key: "castle",
    label: "Fortress / Citadel",
    category: "arcana",
    keywords: ["castle", "fortress", "citadel", "keep", "bastion", "palace"],
    genres: ["fantasy", "horror"],
    scales: ["container", "location"],
    Icon: Castle,
  },
  {
    key: "church",
    label: "Shrine / Temple",
    category: "arcana",
    keywords: ["church", "shrine", "temple", "cathedral", "chapel", "abbey"],
    genres: ["fantasy", "horror", "modern"],
    scales: ["container", "location"],
    Icon: Church,
  },
  {
    key: "crown",
    label: "Throne / Noble Estate",
    category: "arcana",
    keywords: ["crown", "throne", "manor", "estate", "sovereign", "palace"],
    genres: ["fantasy", "horror"],
    scales: ["location", "container"],
    Icon: Crown,
  },
  {
    key: "scale",
    label: "Courthouse / Tribunal",
    category: "arcana",
    keywords: ["scale", "courthouse", "tribunal", "justice", "magistrate"],
    genres: ["fantasy", "modern", "scifi"],
    scales: ["location", "container"],
    Icon: Scale,
  },
  {
    key: "gavel",
    label: "Council / Auction Hall",
    category: "arcana",
    keywords: ["gavel", "council", "auction", "precinct", "hearing"],
    genres: ["fantasy", "modern"],
    scales: ["location"],
    Icon: Gavel,
  },
  {
    key: "library",
    label: "Library / Athenaeum",
    category: "arcana",
    keywords: ["library", "athenaeum", "books", "archives", "lore"],
    genres: ["fantasy", "modern", "horror"],
    scales: ["container", "location"],
    Icon: Library,
  },
  {
    key: "book-open",
    label: "Scriptorium / Study",
    category: "arcana",
    keywords: ["book", "scriptorium", "tome", "chronicle", "reading"],
    genres: ["fantasy", "horror"],
    scales: ["location"],
    Icon: BookOpen,
  },
  {
    key: "book-marked",
    label: "Guild Ledger / Registry",
    category: "arcana",
    keywords: ["ledger", "registry", "records", "annals"],
    genres: ["fantasy", "modern"],
    scales: ["location"],
    Icon: BookMarked,
  },
  {
    key: "scroll-text",
    label: "Chancery / Decree Hall",
    category: "arcana",
    keywords: ["scroll", "chancery", "decree", "scribe", "contract"],
    genres: ["fantasy"],
    scales: ["location"],
    Icon: ScrollText,
  },
  {
    key: "graduation-cap",
    label: "Academy / Guild School",
    category: "arcana",
    keywords: ["academy", "school", "scholars", "college"],
    genres: ["fantasy", "modern"],
    scales: ["container", "location"],
    Icon: GraduationCap,
  },
  {
    key: "university",
    label: "University / Institute",
    category: "arcana",
    keywords: ["university", "institute", "campus", "faculty"],
    genres: ["modern", "scifi", "fantasy"],
    scales: ["container", "location"],
    Icon: University,
  },
  {
    key: "sparkles",
    label: "Ley Nexus / Anomaly",
    category: "arcana",
    keywords: ["sparkles", "ley", "anomaly", "magic", "rift", "astral", "mana"],
    genres: ["fantasy", "scifi"],
    scales: ["location", "hub"],
    Icon: Sparkles,
  },
  {
    key: "wand-2",
    label: "Enchanter / Arcane Tower",
    category: "arcana",
    keywords: ["wand", "enchanter", "arcane", "mage", "ritual", "sorcery"],
    genres: ["fantasy"],
    scales: ["location", "container"],
    Icon: Wand2,
  },
  {
    key: "telescope",
    label: "Observatory / Spire",
    category: "arcana",
    keywords: ["telescope", "observatory", "spire", "planetarium", "stars"],
    genres: ["fantasy", "scifi", "modern"],
    scales: ["location", "container"],
    Icon: Telescope,
  },
  {
    key: "gem",
    label: "Jeweler / Reliquary",
    category: "arcana",
    keywords: ["gem", "jeweler", "reliquary", "crystal", "treasure"],
    genres: ["fantasy", "modern"],
    scales: ["location"],
    Icon: Gem,
  },
  {
    key: "ghost",
    label: "Haunted / Spirit Grounds",
    category: "arcana",
    keywords: ["ghost", "haunted", "spirit", "phantom", "spectral", "wraith"],
    genres: ["horror", "fantasy"],
    scales: ["location", "container"],
    Icon: Ghost,
  },
  {
    key: "tombstone",
    label: "Graveyard / Memorial",
    category: "arcana",
    keywords: ["tombstone", "graveyard", "cemetery", "barrow", "crypt", "memorial"],
    genres: ["horror", "fantasy", "modern"],
    scales: ["container", "location"],
    Icon: Tombstone,
  },
  {
    key: "users",
    label: "Assembly / Commons",
    category: "arcana",
    keywords: ["users", "assembly", "commons", "conclave", "gathering"],
    scales: ["location", "hub"],
    Icon: Users,
  },

  // Security & Hazards (20)
  {
    key: "shield",
    label: "Garrison / Security",
    category: "hazard",
    keywords: ["shield", "garrison", "security", "guardhouse", "barracks", "ward"],
    genres: ["fantasy", "scifi", "modern"],
    scales: ["container", "location"],
    Icon: Shield,
  },
  {
    key: "shield-alert",
    label: "Restricted Checkpoint",
    category: "hazard",
    keywords: ["checkpoint", "restricted", "alert", "dmz", "lockdown"],
    genres: ["scifi", "modern", "horror"],
    scales: ["location", "hub"],
    Icon: ShieldAlert,
  },
  {
    key: "shield-check",
    label: "Safe Zone / Sanctuary",
    category: "hazard",
    keywords: ["sanctuary", "safe", "warded", "precinct"],
    genres: ["fantasy", "scifi", "modern", "horror"],
    scales: ["container", "location"],
    Icon: ShieldCheck,
  },
  {
    key: "key",
    label: "Vault / Gatehouse",
    category: "hazard",
    keywords: ["key", "gatehouse", "access", "passcode"],
    scales: ["location"],
    Icon: Key,
  },
  {
    key: "lock",
    label: "Prison / Containment",
    category: "hazard",
    keywords: ["lock", "prison", "jail", "brig", "cell", "dungeon", "detention"],
    genres: ["fantasy", "modern", "scifi", "horror"],
    scales: ["container", "location"],
    Icon: Lock,
  },
  {
    key: "vault",
    label: "Bank Vault / Bunker",
    category: "hazard",
    keywords: ["vault", "bunker", "strongbox", "shelter", "safehouse"],
    genres: ["modern", "scifi", "horror"],
    scales: ["container", "location"],
    Icon: Vault,
  },
  {
    key: "siren",
    label: "Precinct / Watchtower",
    category: "hazard",
    keywords: ["siren", "police", "precinct", "enforcers", "alarm"],
    genres: ["modern", "scifi"],
    scales: ["container", "location"],
    Icon: Siren,
  },
  {
    key: "cctv",
    label: "Surveillance / Panopticon",
    category: "hazard",
    keywords: ["cctv", "surveillance", "camera", "panopticon", "monitor"],
    genres: ["modern", "scifi"],
    scales: ["location"],
    Icon: Cctv,
  },
  {
    key: "eye",
    label: "Spy Den / Lookout",
    category: "hazard",
    keywords: ["eye", "lookout", "watchpost", "spy", "informant", "broker"],
    genres: ["fantasy", "scifi", "modern", "horror"],
    scales: ["location"],
    Icon: Eye,
  },
  {
    key: "crosshair",
    label: "Sniper Nest / Range",
    category: "hazard",
    keywords: ["crosshair", "sniper", "range", "ambush", "overwatch"],
    genres: ["modern", "scifi"],
    scales: ["location"],
    Icon: Crosshair,
  },
  {
    key: "swords",
    label: "Arena / Battlefield",
    category: "hazard",
    keywords: ["swords", "arena", "battlefield", "colosseum", "pit", "combat"],
    genres: ["fantasy", "horror"],
    scales: ["container", "location"],
    Icon: Swords,
  },
  {
    key: "sword",
    label: "Armory / Duel Yard",
    category: "hazard",
    keywords: ["sword", "armory", "duel", "blade", "weapons"],
    genres: ["fantasy"],
    scales: ["location"],
    Icon: Sword,
  },
  {
    key: "axe",
    label: "Raider Camp / Execution Yard",
    category: "hazard",
    keywords: ["axe", "raider", "brigand", "logging", "execution"],
    genres: ["fantasy", "horror"],
    scales: ["location"],
    Icon: Axe,
  },
  {
    key: "bomb",
    label: "Munitions / Blast Zone",
    category: "hazard",
    keywords: ["bomb", "munitions", "blast", "crater", "explosives"],
    genres: ["modern", "scifi", "horror"],
    scales: ["location", "container"],
    Icon: Bomb,
  },
  {
    key: "skull",
    label: "Hazard / Undercroft",
    category: "hazard",
    keywords: ["skull", "undercroft", "crypt", "catacombs", "ossuary", "danger"],
    genres: ["fantasy", "horror", "scifi"],
    scales: ["container", "location"],
    Icon: Skull,
  },
  {
    key: "biohazard",
    label: "Quarantine / Plaguelands",
    category: "hazard",
    keywords: ["biohazard", "quarantine", "plague", "blight", "toxic", "contagion"],
    genres: ["horror", "scifi", "modern"],
    scales: ["container", "location"],
    Icon: Biohazard,
  },
  {
    key: "radiation",
    label: "Deadzone / Fallout",
    category: "hazard",
    keywords: ["radiation", "deadzone", "fallout", "radioactive", "wasteland"],
    genres: ["scifi", "horror", "modern"],
    scales: ["container", "location"],
    Icon: Radiation,
  },
  {
    key: "binoculars",
    label: "Lookout / Recon Post",
    category: "hazard",
    keywords: ["binoculars", "lookout", "overlook", "recon", "scout", "vantage"],
    genres: ["fantasy", "modern", "scifi", "horror"],
    scales: ["location"],
    Icon: Binoculars,
  },
  {
    key: "bow-arrow",
    label: "Hunting Lodge / Range",
    category: "hazard",
    keywords: ["bow", "arrow", "archery", "hunting", "lodge", "ranger", "range"],
    genres: ["fantasy", "modern"],
    scales: ["location", "container"],
    Icon: BowArrow,
  },
  {
    key: "alert-triangle",
    label: "Hazard Zone / Collapse",
    category: "hazard",
    keywords: ["alert", "hazard", "warning", "trap", "unstable", "collapse"],
    scales: ["location", "hub"],
    Icon: AlertTriangle,
  },
];

const OPTION_BY_KEY = new globalThis.Map<string, MapIconOption>(
  MAP_ICON_OPTIONS.map((opt) => [opt.key, opt])
);

const ICON_BY_KEY = new globalThis.Map<string, LucideIcon>(
  MAP_ICON_OPTIONS.map((opt) => [opt.key, opt.Icon])
);

export function getMapIconOption(
  iconKey: string | null | undefined
): MapIconOption | undefined {
  if (!iconKey) return undefined;
  return OPTION_BY_KEY.get(iconKey);
}

export function getMapIconCategoryLabel(category: MapIconCategory): string {
  return CATEGORY_LABEL_BY_ID.get(category) ?? category;
}

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

/**
 * Filter icons by free-text query (matching key, label, category, and keywords)
 * and optional category filter.
 */
export function filterMapIcons(
  query: string,
  category: MapIconCategory | "all"
): MapIconOption[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return MAP_ICON_OPTIONS.filter((opt) => {
    if (category !== "all" && opt.category !== category) {
      return false;
    }
    if (tokens.length === 0) return true;
    const catLabel = getMapIconCategoryLabel(opt.category).toLowerCase();
    const haystack = [
      opt.key.toLowerCase(),
      opt.label.toLowerCase(),
      catLabel,
      ...opt.keywords.map((k) => k.toLowerCase()),
    ].join(" ");
    return tokens.every((tok) => haystack.includes(tok));
  });
}

/**
 * Map a world's free-form genre label into matching icon genre tags.
 */
export function normalizeWorldGenreTags(genre?: string): MapIconGenreTag[] {
  const g = (genre || "").toLowerCase();
  const tags = new Set<MapIconGenreTag>();
  if (/(cyber|sci-?fi|space|future|neon|synth|robot|post-?apoc)/.test(g)) {
    tags.add("scifi");
  }
  if (/(fantasy|medieval|sword|magic|arcana|feudal|myth)/.test(g)) {
    tags.add("fantasy");
  }
  if (/(horror|gothic|eldritch|lovecraft|grim|dark|occult|zombie)/.test(g)) {
    tags.add("horror");
  }
  if (/(modern|noir|urban|contemporary|spy|crime|thriller|mystery)/.test(g)) {
    tags.add("modern");
  }
  return Array.from(tags);
}

function tokenizeWords(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function hasAnyWord(wordSet: Set<string>, normalizedText: string, candidates: string[]): boolean {
  for (const cand of candidates) {
    if (cand.includes(" ")) {
      if (normalizedText.includes(cand)) return true;
    } else if (wordSet.has(cand)) {
      return true;
    }
  }
  return false;
}

/**
 * Return top contextual icon suggestions ordered by node keyword/tag relevance,
 * world genre affinity, and node kind/depth scale fit.
 */
export function getSuggestedMapIcons(params: {
  kind: "location" | "hub" | "container";
  depth?: 1 | 2 | 3 | 4;
  genre?: string;
  name?: string;
  tags?: string[];
  limit?: number;
}): MapIconOption[] {
  const { kind, depth, genre, name = "", tags = [], limit = 12 } = params;
  const genreTags = normalizeWorldGenreTags(genre);
  const rawText = `${name} ${tags.join(" ")}`.toLowerCase();
  const words = new Set(tokenizeWords(rawText));

  const scored = MAP_ICON_OPTIONS.map((opt, index) => {
    let score = 0;
    if (opt.scales?.includes(kind)) {
      score += 3;
    }
    if (kind === "container" && depth && depth >= 2) {
      if (opt.key === "map" || opt.key === "globe-2" || opt.key === "landmark") {
        score += 4;
      }
    }
    for (const g of genreTags) {
      if (opt.genres?.includes(g)) {
        score += 3;
      }
    }
    if (words.size > 0) {
      for (const kw of opt.keywords) {
        if (words.has(kw.toLowerCase())) {
          score += 8;
        }
      }
      for (const lblWord of tokenizeWords(opt.label)) {
        if (lblWord.length >= 3 && words.has(lblWord)) {
          score += 6;
        }
      }
    }
    if (opt.key === getDefaultMapIconKey(kind, depth)) {
      score += 2;
    }
    return { opt, score, index };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((item) => item.opt);
}

/**
 * Infer a fitting icon key from name/tags/genre/scale on creation or draft import,
 * falling back cleanly to `getDefaultMapIconKey(kind, depth)` when no strong match exists.
 */
export function inferMapIconKey(params: {
  kind: "location" | "hub" | "container";
  depth?: 1 | 2 | 3 | 4;
  name?: string;
  tags?: string[];
  genre?: string;
}): string {
  const { kind, depth, name = "", tags = [], genre } = params;
  const normalizedText = `${name} ${tags.join(" ")}`.toLowerCase();
  const words = new Set(tokenizeWords(normalizedText));
  const genreTags = normalizeWorldGenreTags(genre);

  // Ordered high-precision rules: multi-word & domain terms before broader fallback cues
  const rules: Array<{ key: string; match: string[] }> = [
    { key: "rocket", match: ["spaceport", "starport", "launchpad", "shuttle bay", "spaceship"] },
    { key: "orbit", match: ["orbital", "space station", "zero g", "orbital ring"] },
    { key: "satellite", match: ["satellite", "dish array", "comms array"] },
    { key: "heart-pulse", match: ["ripperdoc", "trauma bay", "cybermed", "triage", "icu"] },
    { key: "hospital", match: ["hospital", "clinic", "infirmary", "medbay", "apothecary", "asylum"] },
    { key: "martini", match: ["nightclub", "speakeasy", "vip lounge", "cocktail"] },
    { key: "beer", match: ["cantina", "tavern", "saloon", "pub", "alehouse", "bar", "taproom"] },
    { key: "wine", match: ["winery", "vineyard", "cabaret", "wine cellar"] },
    { key: "coffee", match: ["cafe", "coffee", "teahouse", "bistro", "diner"] },
    { key: "utensils", match: ["mess hall", "canteen", "kitchen", "restaurant", "eatery", "galley"] },
    { key: "dices", match: ["casino", "gambling", "arcade"] },
    { key: "theater", match: ["theater", "theatre", "amphitheater", "playhouse", "cinema"] },
    { key: "music", match: ["opera", "concert", "stage"] },
    { key: "terminal", match: ["netrunner", "terminal", "console", "hacker"] },
    { key: "circuit-board", match: ["cybernetics", "cyberware", "fab", "implant"] },
    { key: "server", match: ["data center", "datacenter", "server room", "subnet"] },
    { key: "cpu", match: ["mainframe", "server", "ai core", "processor"] },
    { key: "radio", match: ["comms tower", "radio", "broadcast", "antenna"] },
    { key: "zap", match: ["power plant", "substation", "generator", "reactor"] },
    { key: "atom", match: ["fusion", "collider", "physics lab"] },
    { key: "flask-conical", match: ["alchemy", "laboratory", "lab", "biolab", "chemistry"] },
    { key: "anchor", match: ["harbor", "harbour", "docks", "dockyard", "pier", "marina", "quay", "dock"] },
    { key: "ship", match: ["drydock", "ferry", "galleon", "warship"] },
    { key: "lighthouse", match: ["lighthouse", "beacon"] },
    { key: "bridge", match: ["bridge", "viaduct", "overpass", "aqueduct"] },
    { key: "cable-car", match: ["cable car", "gondola", "skyway"] },
    { key: "tower-control", match: ["control tower", "watchtower"] },
    { key: "dam", match: ["hydro dam", "dam", "canal lock", "sluice"] },
    { key: "drone", match: ["drone bay", "drone", "uav"] },
    { key: "plane", match: ["airfield", "airport", "helipad", "skyport", "hangar"] },
    { key: "train-front", match: ["subway", "metro", "monorail", "rail", "train", "tram"] },
    { key: "door-closed", match: ["airlock", "bulkhead", "hatch"] },
    { key: "door-open", match: ["portal", "gateway", "entrance", "threshold", "gatehouse"] },
    { key: "library", match: ["library", "athenaeum", "archive", "archives"] },
    { key: "university", match: ["university", "institute", "campus"] },
    { key: "graduation-cap", match: ["academy", "college", "school"] },
    { key: "church", match: ["cathedral", "temple", "shrine", "chapel", "abbey", "church", "monastery"] },
    { key: "castle", match: ["castle", "citadel", "fortress", "keep", "bastion"] },
    { key: "crown", match: ["palace", "throne", "manor", "estate"] },
    { key: "landmark", match: ["capitol", "senate", "civic", "museum", "monument", "plaza"] },
    { key: "sparkles", match: ["ley", "nexus", "anomaly", "rift", "astral"] },
    { key: "wand-2", match: ["arcane", "enchanter", "mage", "wizard", "ritual"] },
    { key: "telescope", match: ["observatory", "planetarium", "spire"] },
    { key: "ghost", match: ["haunted", "crypt", "spirit", "phantom"] },
    { key: "skull", match: ["catacombs", "undercroft", "ossuary", "death"] },
    { key: "biohazard", match: ["quarantine", "plague", "blight", "biohazard", "contagion"] },
    { key: "radiation", match: ["radiation", "fallout", "deadzone", "radioactive"] },
    { key: "lock", match: ["prison", "jail", "dungeon", "brig", "cellblock", "detention"] },
    { key: "vault", match: ["bunker", "bank vault", "vault", "strongbox"] },
    { key: "siren", match: ["precinct", "police"] },
    { key: "shield", match: ["garrison", "barracks", "checkpoint", "watchpost", "guardhouse"] },
    { key: "swords", match: ["arena", "colosseum", "battlefield", "fighting pit"] },
    { key: "store", match: ["market", "bazaar", "shop", "store", "stall", "emporium"] },
    { key: "warehouse", match: ["warehouse", "depot", "cargo bay", "storage"] },
    { key: "factory", match: ["factory", "foundry", "mill", "refinery", "plant"] },
    { key: "hammer", match: ["forge", "smithy", "blacksmith"] },
    { key: "wrench", match: ["workshop", "garage", "repair"] },
    { key: "barrel", match: ["wine cellar", "barrel", "brewery", "supply hold"] },
    { key: "houses", match: ["village", "hamlet", "township", "settlement", "neighborhood", "cottages"] },
    { key: "hotel", match: ["hotel", "inn", "hostel", "motel"] },
    { key: "home", match: ["safehouse", "house", "home", "cottage", "apartment"] },
    { key: "tent-tree", match: ["forest camp", "woodland camp", "ranger camp"] },
    { key: "trees", match: ["forest", "woods", "woodland", "jungle", "grove", "park", "glade"] },
    { key: "mountain", match: ["mountain", "cavern", "cave", "peaks", "cliff", "canyon"] },
    { key: "waves", match: ["waterfront", "canal", "river", "sewer", "marsh", "swamp", "coast"] },
    { key: "tent", match: ["camp", "encampment", "outpost", "bivouac"] },
    { key: "pickaxe", match: ["mine", "quarry", "excavation"] },
    { key: "tombstone", match: ["graveyard", "cemetery", "barrow"] },
    { key: "binoculars", match: ["lookout", "overlook", "recon post", "vantage"] },
    { key: "bow-arrow", match: ["archery", "hunting lodge", "shooting range"] },
    { key: "shovel", match: ["trench", "dig"] },
    { key: "footprints", match: ["alley", "alleyway", "trail", "corridor"] },
    { key: "compass", match: ["crossroads", "town square", "waypoint"] },
  ];

  for (const rule of rules) {
    if (hasAnyWord(words, normalizedText, rule.match) && ICON_BY_KEY.has(rule.key)) {
      return rule.key;
    }
  }

  // Genre-aware gentle upgrade for hubs or macro districts without overriding plain location defaults
  if (kind === "container" && depth === 1 && genreTags.includes("fantasy")) {
    if (hasAnyWord(words, normalizedText, ["hall", "quarter", "keep", "ward"])) {
      return "castle";
    }
  }

  return getDefaultMapIconKey(kind, depth);
}
