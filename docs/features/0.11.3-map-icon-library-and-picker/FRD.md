---
feature: map-icon-library-and-picker
target_version: 0.11.3
document_type: frd
status: approved
last_updated: 2026-11-15
---

# Feature Requirements Document (FRD)
## Expanded Map Icon Library & Structured Icon Picker UX

**Status:** Approved  
**Target Version:** CyberCantina v0.11.3  
**Scope:**
- Frontend Icon Registry & Metadata (`frontend/src/components/map/mapIcons.ts`)
- Frontend Icon Picker UI (`frontend/src/components/map/MapDetailsDrawer.tsx`, optional modal browser in `frontend/src/components/map/MapDialogs.tsx`)
- Optional Creation / Mapping Helpers (`frontend/src/components/map/useTopologyMutations.ts`, `frontend/src/components/world/worldDraftMappers.ts`)
- Frontend Tests (`frontend/src/components/__tests__/mapEditor.test.tsx`)

---

## 1. Executive Summary & Problem Statement

### 1.1 Problem Statement
1. **Limited Visual Variety on Spatial Maps:**
   - [`MAP_ICON_OPTIONS`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L43-L75) currently provides only **31** static icons, causing dense cities, sci-fi complexes, arcane realms, and multi-building districts to repeat the same handful of glyphs (`map-pin`, `building-2`, `store`, `cpu`, `trees`).
2. **Flat Grid Does Not Scale Beyond ~30–40 Icons:**
   - [`MapIconPicker`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L105-L195) inside the ~300px details drawer renders a flat 6-column `170px` scrollable box. Even though [`MapIconOption.category`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L39) already exists, it is never surfaced for filtering or grouping (only shown on hover tooltips).
   - Exposing all ~1,500+ Lucide icons indiscriminately would flood the picker with irrelevant UI icons (text alignment, arrows, spreadsheet controls) and defeat Vite tree-shaking via wildcard imports.

### 1.2 Proposed Solution
Expand the map icon system using a **curated, domain-grouped worldbuilding registry (~110–130 verified Lucide icons)** paired with a **searchable, categorized picker** and **world/node-aware suggestions**:
1. **Curated Domain Catalog (`FR-1`):** Expand [`MAP_ICON_OPTIONS`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L43-L75) with static named imports (preserving Vite tree-shaking and synchronous SVG canvas/SSR rendering), enriched with `keywords`, `genres`, and `scales` metadata.
2. **6 Clear Worldbuilding Categories (`FR-2`):** Reorganize the current 4 coarse categories (`Urban`, `Transit`, `Wild`, `Facility`) into **6 intuitive categories** tailored to RPG/narrative mapping.
3. **Structured Discovery UI (`FR-3`):** Upgrade [`MapIconPicker`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L105-L195) with live keyword search, category pills, a `"Suggested"` / `"Used in World"` strip, and an optional `"Browse All"` expanded modal view so the drawer stays compact while giving full access to 100+ icons.
4. **Genre- & Keyword-Aware Suggestions (`FR-4`):** Use `worldContext.genre`, node `kind`/`depth`, and `name`/`environmental_tags` to rank relevant icons first (and optionally assign smarter defaults when creating new nodes).

---

## 2. Scope, Boundaries & Core Invariants

1. **Zero Backend or Database Changes Required:**
   - `location_nodes.icon` and `location_containers.icon` are already nullable `TEXT` string keys across SQLite and API schemas (`LocationNode.icon`, `LocationContainer.icon`).
2. **100% Backward Compatibility for Existing Icon Keys:**
   - All **31 existing `key` strings** (e.g. `"map-pin"`, `"building-2"`, `"git-branch"`, `"door-open"`, `"globe-2"`, `"beer"`, etc.) **must remain unchanged** and continue resolving to their exact Lucide components via [`resolveMapIconComponent`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L94-L103).
   - Fallback rule stays intact: unknown/null keys gracefully resolve via [`getDefaultMapIconKey`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L81-L92).
3. **Tree-Shaking & Synchronous Rendering Invariant:**
   - No `import * as LucideIcons from "lucide-react"`. Every icon in the catalog uses an explicit named import so Vite strips the ~1,350 unused Lucide UI icons and [`SpatialTopologyCanvas`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/SpatialTopologyCanvas.tsx) renders SVG nodes synchronously without loading flicker or Vitest SSR breakage.
4. **No Canvas Clutter / Node Geometry Changes:**
   - All icons render inside the existing `14px–16px` icon slots on node cards, container cards, ghost cards, and the details drawer.

---

## 3. Proposed Categories & Curated Icon Catalog Suggestions

> All Lucide icon names below were verified directly against the installed `lucide-react` (`^0.378.0`) export list. Icons prefixed with `*` are **already present** in [`MAP_ICON_OPTIONS`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L43-L75).

### 3.1 Category Taxonomy (6 Categories)

| Category ID | Display Label | Purpose / Worldbuilding Scope | Target Count |
| :--- | :--- | :--- | :---: |
| `settlement` | **Settlement & Venues** | Districts, interiors, taverns, inns, markets, civic halls, homes, workshops | ~26 |
| `transit` | **Transit & Portals** | Hubs, gates, alleys, roads, rail, docks, air/spaceports, waypoints | ~20 |
| `wilderness` | **Nature & Terrain** | Forests, peaks, rivers, coastlines, weather biomes, camps, subterranean terrain | ~22 |
| `scifi` | **Sci-Fi & Tech** | Labs, servers, cybernetics, comms, reactors, industrial/orbital infrastructure | ~20 |
| `arcana` | **Lore, Faith & Civic** | Temples, libraries, archives, arcane sanctums, courts, nobility, ruins | ~18 |
| `hazard` | **Security & Hazards** | Garrisons, vaults, prisons, surveillance, combat zones, bio/rad hazards | ~18 |

*(Total curated catalog: **~124 icons** — 4x the current 31 while keeping every single entry genuinely map-usable.)*

---

### 3.2 Concrete Icon Suggestions per Category

#### A. `settlement` — Settlement & Venues
| Key | Lucide Icon | Suggested Label | Example Search Keywords |
| :--- | :--- | :--- | :--- |
| `map-pin` * | `MapPin` | Location Pin | point, marker, spot, default |
| `building-2` * | `Building2` | Building / Tower | office, tower, block, structure |
| `building` | `Building` | Apartment / Block | tenement, complex, residential |
| `home` * | `Home` | Safehouse / Dwelling | house, cottage, quarters, refuge |
| `hotel` | `Hotel` | Inn / Lodging | hostel, motel, suites |
| `bed-double` * | `BedDouble` | Quarters / Dorm | bedroom, rest, bunk, sleep |
| `sofa` | `Sofa` | Lounge / Parlor | salon, lobby, waiting room |
| `store` * | `Store` | Shop / Market | bazaar, vendor, stall, retail |
| `shopping-bag` | `ShoppingBag` | Exchange / Boutique | trade, mall, black market |
| `beer` * | `Beer` | Cantina / Tavern | bar, pub, saloon, inn, drink |
| `wine` | `Wine` | Cellar / Cabaret | vineyard, lounge, banquet |
| `coffee` | `Coffee` | Café / Teahouse | diner, bistro, nook |
| `utensils` | `Utensils` | Mess Hall / Eatery | restaurant, kitchen, canteen |
| `martini` | `Martini` | Nightclub / VIP Bar | club, speakeasy, neon |
| `music` | `Music` | Stage / Opera Hall | venue, concert, bard, club |
| `theater` | `Theater` | Amphitheater / Stage | playhouse, cinema, drama |
| `dices` | `Dices` | Casino / Den | gambling, parlor, arcade |
| `ticket` | `Ticket` | Arena / Box Office | fair, booth, entrance |
| `warehouse` * | `Warehouse` | Warehouse / Depot | storage, cargo, hangar, dockyard |
| `factory` | `Factory` | Foundry / Mill | plant, refinery, smokestack |
| `wrench` * | `Wrench` | Workshop / Garage | repair, smithy, mechanic |
| `hammer` | `Hammer` | Forge / Guildhall | smith, carpenter, craft |
| `hospital` | `Hospital` | Clinic / Infirmary | medbay, ripperdoc, apothecary |
| `lamp` | `Lamp` | Study / Den | parlor, dim room, study |
| `coins` | `Coins` | Treasury / Bank | exchange, vault, guild, gold |
| `package` | `Package` | Courier Post / Locker | mail, stash, parcel, drop |
| `layers` * | `Layers` | Complex / Multi-Level | floors, wing, compound, stacked |

#### B. `transit` — Transit & Portals
| Key | Lucide Icon | Suggested Label | Example Search Keywords |
| :--- | :--- | :--- | :--- |
| `git-branch` * | `GitBranch` | Passage Hub | junction, fork, nexus, interchange |
| `door-open` * | `DoorOpen` | Portal / Gate | doorway, threshold, exit, entry |
| `door-closed` | `DoorClosed` | Sealed Door / Airlock | hatch, bulkhead, locked |
| `footprints` * | `Footprints` | Alley / Trail | walkway, path, corridor, track |
| `compass` * | `Compass` | Crossroads / Waypoint | plaza, square, navigation |
| `signpost` | `Signpost` | Trailhead / Crossing | fork, milepost, border |
| `route` | `Route` | Highway / Trade Route | road, artery, transit line |
| `navigation` | `Navigation` | Vector / Beacon | checkpoint, relay, heading |
| `milestone` | `Milestone` | Milepost / Border Gate | toll, frontier, obelisk |
| `train-front` * | `TrainFront` | Rail / Metro Station | subway, tram, monorail |
| `bus` | `Bus` | Bus / Shuttle Stop | coach, caravan stop |
| `car` | `Car` | Motorpool / Garage | street, convoy, parking |
| `bike` | `Bike` | Courier / Cycle Lane | alleyway, courier |
| `anchor` * | `Anchor` | Docks / Harbor | port, pier, marina, quay |
| `ship` | `Ship` | Ferry / Drydock | vessel, galleon, barge |
| `sailboat` | `Sailboat` | Cove / Landing | skiff, boat, jetty |
| `plane` | `Plane` | Airfield / Helipad | airport, runway, skyport |
| `rocket` * | `Rocket` | Spaceport / Launchpad | shuttle, starport, pad |
| `fence` | `Fence` | Courtyard / Perimeter | gate, yard, palisade |
| `flag` | `Flag` | Outpost / Banner | camp, rally point, border |

#### C. `wilderness` — Nature & Terrain
| Key | Lucide Icon | Suggested Label | Example Search Keywords |
| :--- | :--- | :--- | :--- |
| `map` * | `Map` | District / Region | zone, territory, sector |
| `globe-2` * | `Globe2` | Realm / Planet | world, continent, macro |
| `trees` * | `Trees` | Forest / Park | woods, grove, jungle, glade |
| `tree-pine` | `TreePine` | Taiga / Pinewood | timberland, northern woods |
| `sprout` | `Sprout` | Oasis / Greenhouse | garden, clearing, overgrowth |
| `flower-2` | `Flower2` | Meadow / Conservatory | arboretum, bloom, glade |
| `leaf` | `Leaf` | Canopy / Sanctuary | druids, thicket, autumn |
| `mountain` * | `Mountain` | Peaks / Cavern | ridge, cliff, cave, pass |
| `mountain-snow` | `MountainSnow` | Glacier / Alpine Peak | summit, frost, pass |
| `waves` * | `Waves` | Waterfront / Canal | river, sea, sewer, marsh |
| `droplet` | `Droplet` | Spring / Cistern | well, fountain, reservoir |
| `shell` | `Shell` | Coast / Tidepool | beach, reef, shore |
| `fish` | `Fish` | Fishery / Deep Reef | pond, kelp, sunken |
| `tent` * | `Tent` | Encampment / Nomad | camp, yurt, bivouac |
| `flame` * | `Flame` | Hearth / Ruins | bonfire, volcanic, ash |
| `sun` | `Sun` | Badlands / Solar Basin | desert, wasteland, plaza |
| `moon` | `Moon` | Nocturne / Shadowed | night, moonwell, crescent |
| `snowflake` | `Snowflake` | Tundra / Cryo Zone | ice, frost, glacier |
| `cloud-rain` | `CloudRain` | Mire / Monsoon Zone | swamp, storm, bog |
| `bug` | `Bug` | Hive / Nest | swarm, burrow, chasm |
| `pickaxe` | `Pickaxe` | Mine / Quarry | shaft, cavern, excavation |
| `shovel` | `Shovel` | Trench / Excavation | dig, barrow, grave |

#### D. `scifi` — Sci-Fi & Tech
| Key | Lucide Icon | Suggested Label | Example Search Keywords |
| :--- | :--- | :--- | :--- |
| `cpu` * | `Cpu` | Server / Mainframe | node, datavault, core, ai |
| `server` | `Server` | Data Center / Rack | subnet, datacenter, vault |
| `hard-drive` | `HardDrive` | Archive Drive / Terminal | memory, storage, terminal |
| `circuit-board` | `CircuitBoard` | Cybernetics / Fab | synth, chip, implant |
| `terminal` | `Terminal` | Netrunner Den / Console | deck, terminal, hack |
| `radio` * | `Radio` | Comms Tower / Array | broadcast, antenna, signal |
| `wifi` | `Wifi` | Mesh Node / Relay | hotspot, uplink, network |
| `satellite` | `Satellite` | Orbital / Dish Array | comms, uplink, station |
| `orbit` | `Orbit` | Orbital Station / Ring | zero-g, station, satellite |
| `radar` | `Radar` | Sensor Grid / Scan Post | sweep, tracking, perimeter |
| `zap` | `Zap` | Power Plant / Substation | generator, grid, reactor |
| `battery-charging` | `BatteryCharging` | Charging Bay / Capacitor | fuel, energy, cell |
| `plug` | `Plug` | Power Conduit / Junction | grid, utility, maintenance |
| `cog` | `Cog` | Machinery / Turbine | gears, engine room, clockwork |
| `flask-conical` | `FlaskConical` | Lab / Alchemy | chem, biotech, apothecary |
| `microscope` | `Microscope` | Research / Medlab | pathology, bio, lab |
| `test-tube-2` | `TestTube2` | Vat / Mutagenics | cloning, sample, chem |
| `atom` | `Atom` | Reactor / Physics Lab | fusion, core, arcane tech |
| `heart-pulse` | `HeartPulse` | Trauma Bay / Ripperdoc | clinic, cybermed, triage |
| `syringe` | `Syringe` | Chem Lab / Medpod | stim, clinic, black market |

#### E. `arcana` — Lore, Faith & Civic
| Key | Lucide Icon | Suggested Label | Example Search Keywords |
| :--- | :--- | :--- | :--- |
| `landmark` * | `Landmark` | Civic Hall / Monument | senate, plaza, capitol, museum |
| `castle` * | `Castle` | Fortress / Citadel | keep, bastion, palace |
| `church` * | `Church` | Shrine / Temple | cathedral, chapel, abbey |
| `crown` | `Crown` | Throne / Noble Estate | manor, court, sovereign |
| `scale` | `Scale` | Courthouse / Tribunal | justice, magistrate, guild |
| `gavel` | `Gavel` | Council / Precinct | trial, law, auction |
| `library` | `Library` | Library / Athenaeum | books, lore, hall of records |
| `book-open` | `BookOpen` | Scriptorium / Study | tome, chronicle, archive |
| `book-marked` | `BookMarked` | Guild Ledger / Registry | records, guild, chronicle |
| `scroll-text` | `ScrollText` | Chancery / Decree Hall | contract, scribe, lore |
| `graduation-cap` | `GraduationCap` | Academy / College | university, guild school |
| `university` | `University` | University / Conservatory | institute, campus |
| `sparkles` | `Sparkles` | Ley Nexus / Anomaly | magic, rift, shrine, astral |
| `wand-2` | `Wand2` | Enchanter / Arcane Guild | mage, tower, ritual |
| `telescope` | `Telescope` | Observatory / Spire | stars, watchtower, astral |
| `gem` | `Gem` | Jeweler / Reliquary | crystal, treasury, vault |
| `ghost` | `Ghost` | Haunted / Spirit Grounds | crypt, phantom, spectral |
| `users` | `Users` | Assembly / Commons | plaza, guildhall, camp |

#### F. `hazard` — Security & Hazards
| Key | Lucide Icon | Suggested Label | Example Search Keywords |
| :--- | :--- | :--- | :--- |
| `shield` * | `Shield` | Garrison / Security | guardhouse, barracks, ward |
| `shield-alert` | `ShieldAlert` | Restricted Checkpoint | checkpoint, alert, DMZ |
| `shield-check` | `ShieldCheck` | Safe Zone / Sanctuary | precinct, warded, verified |
| `key` * | `Key` | Vault / Gatehouse | lock, cryptkey, access |
| `lock` | `Lock` | Prison / Containment | cell, brig, lockdown |
| `vault` | `Vault` | Bank Vault / Bunker | strongbox, shelter, core |
| `siren` | `Siren` | Precinct / Watchtower | alarm, enforcers, response |
| `cctv` | `Cctv` | Surveillance / Watch | panopticon, camera, security |
| `eye` | `Eye` | Spy Den / Lookout | watchpost, faction, informant |
| `crosshair` | `Crosshair` | Sniper Nest / Range | firing range, ambush |
| `swords` | `Swords` | Arena / Battlefield | pit, colosseum, clash |
| `sword` | `Sword` | Armory / Duel Yard | weapons, guard, blade |
| `axe` | `Axe` | Execution Yard / Camp | logging, raiders, brigands |
| `bomb` | `Bomb` | Munitions / Blast Zone | crater, demolitions, black powder |
| `skull` * | `Skull` | Hazard / Undercroft | crypt, catacombs, danger |
| `biohazard` | `Biohazard` | Quarantine / Plaguelands | blight, toxic, containment |
| `radiation` | `Radiation` | Deadzone / Fallout | waste, hot zone, reactor leak |
| `alert-triangle` | `AlertTriangle` | Hazard Zone / Collapse | warning, trap, unstable |

---

## 4. Functional Requirements & UX Design

### FR-1: Enriched Static Icon Registry (`frontend/src/components/map/mapIcons.ts`)
**Requirement:** Expand `MapIconOption` metadata without breaking existing callers.
- Extend `MapIconOption`:
  ```ts
  export type MapIconCategory =
    | "settlement"
    | "transit"
    | "wilderness"
    | "scifi"
    | "arcana"
    | "hazard";

  export interface MapIconOption {
    key: string;
    label: string;
    category: MapIconCategory;
    keywords: string[];
    genres?: Array<"fantasy" | "scifi" | "modern" | "horror">;
    scales?: Array<"location" | "hub" | "container">;
    Icon: LucideIcon;
  }
  ```
- Export human-readable category metadata (`MAP_ICON_CATEGORIES`) alongside [`MAP_ICON_OPTIONS`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L43-L75).
- Provide pure search & ranking helpers (unit-testable in Node Vitest):
  - `filterMapIcons(query: string, category: MapIconCategory | "all"): MapIconOption[]` — matches `key`, `label`, `category` label, and `keywords` case-insensitively.
  - `getSuggestedMapIcons(params: { kind, depth?, genre?, name?, tags?, usedKeys? }): MapIconOption[]` — returns top ~12–18 prioritized icons tailored to the current node & world genre without hiding the rest.

---

### FR-2: Two-Stage Discovery Inside `MapDetailsDrawer` + Optional Expanded Browser Modal
**Requirement:** Keep the ~300px details drawer uncluttered while making all ~120+ icons effortless to reach.

1. **Inside [`MapIconPicker`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/MapDetailsDrawer.tsx#L105-L195) (Inline Popover Panel):**
   - **Sticky Search Bar:** `Search icons (e.g. bar, dock, lab, crypt)...` with clear button (`X`).
   - **Compact Category Pills:** `All`, `Settlement`, `Transit`, `Nature`, `Sci-Fi`, `Arcana`, `Hazard` (horizontally wrap or scroll cleanly).
   - **When `query === ""` and `category === "all"`:**
     - **Used in World** (optional top strip of unique icons already placed on this map — encourages visual consistency).
     - **Suggested** (top ~12 icons ranked by `worldContext.genre`, node `kind`/`depth`, and node tags/name).
     - **All Icons** grouped by category headers (or compact 6-column grid filtered immediately when clicking a category pill).
   - **Hover / Selected Label Footer:** Displays `{Icon} {opt.label} · {Category}` at the bottom of the picker on hover/focus so users never have to guess what a small glyph represents.
   - **Zero-Match Empty State:** Clear message (`"No icons matching '...'"`) with a `"Show all icons"` reset link.

2. **Optional Full-Width "Browse All Icons…" Modal (Review Decision #1):**
   - A small `"Expand"` / `"Browse all (124)"` button in the drawer popover opens a centered modal dialog (similar in footprint to `MultiEdgePopover`) with category sidebar + search bar + labeled 2-column or larger icon tiles.
   - Great if creators prefer scanning labeled icons instead of tooltips in a 300px drawer.

---

### FR-3: Passive Variety via Smart Keyword Defaulting (Review Decision #2)
**Requirement:** Optionally auto-select an appropriate icon key when generating/creating locations and containers rather than defaulting everything to `map-pin` / `building-2`.
- Add a pure helper `inferMapIconKey({ name, tags, kind, depth, genre })`:
  - Matches high-signal keywords in `name` + `environmental_tags` (e.g., `"tavern|cantina|bar|pub" -> "beer"`, `"dock|harbor|pier" -> "anchor"`, `"clinic|hospital|medbay" -> "heart-pulse"`, `"forest|woods|park" -> "trees"`, `"spaceport|launch" -> "rocket"`).
  - Falls back to [`getDefaultMapIconKey(kind, depth)`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapIcons.ts#L81-L92) if no strong keyword matches.
- **Boundary:** Never overwrite an explicitly user-chosen or already-saved `icon` (`loc.icon` / `cont.icon`); only apply at initial creation (`createStandaloneAt` / World Wizard fallback mapper) if desired.

---

### FR-4: Validation, Accessibility & Keyboard Discipline
- Search `<input>` inside `MapIconPicker` must **not** trigger global canvas shortcuts (`Delete` is already guarded by [`isEditableKeyboardTarget`](file:///home/diegolima/Git/cybercantina/frontend/src/components/map/mapGeometry.ts), and `Escape` should close the icon popover or clear the search query).
- Icon option buttons keep `role="option"`, `aria-selected`, and descriptive `title` / `aria-label` (`"{label} ({category})"`).

---

## 5. Open Decisions for Review

Please confirm your preferences on these points before we move to `/plan`:

1. **Discovery Layout (`FR-2`):** Should we keep the picker strictly **inline inside `MapDetailsDrawer`** (Search + Category pills + Suggested strip), OR also add an **"Expand / Browse All" modal** for larger labeled tiles?
2. **Smart Auto-Icons (`FR-3`):** When creating a new node/container or mapping World Wizard drafts with `icon == null`, should we **auto-infer an icon** from its name/tags (e.g. "Cantina" → `beer`), or keep `null` (rendering the type default) unless the user picks one manually?
3. **Catalog Scope & Additions:** Are there specific genres, motifs, or icons missing from the ~124-icon table above that you want added or trimmed (for example, more horror/occult, steampunk, nautical, or domestic interior icons)?
