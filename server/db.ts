import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { sameRoaster, splitProcess } from "../shared/types.ts";
import { preinfusionOf } from "./preinfusion.ts";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "data");
export const IMAGE_DIR = path.join(DATA_DIR, "images");
mkdirSync(IMAGE_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "kaffee.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

/** SQL oder, für Datenumbauten, eine Funktion; beides läuft in einer Transaktion */
const migrations: (string | (() => void))[] = [
  `
  CREATE TABLE coffees (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    roaster TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    farm TEXT NOT NULL DEFAULT '',
    producer TEXT NOT NULL DEFAULT '',
    varieties TEXT NOT NULL DEFAULT '[]',
    process TEXT NOT NULL DEFAULT '',
    altitude TEXT NOT NULL DEFAULT '',
    harvest TEXT NOT NULL DEFAULT '',
    roast_level TEXT CHECK (roast_level IN ('hell', 'mittel', 'dunkel')),
    roast_for TEXT CHECK (roast_for IN ('filter', 'espresso', 'omni')),
    roaster_notes TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    weight_g INTEGER,
    price_eur REAL,
    url TEXT NOT NULL DEFAULT '',
    image TEXT,
    color TEXT,
    source TEXT,
    wishlist INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE batches (
    id INTEGER PRIMARY KEY,
    coffee_id INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
    roast_date TEXT,
    opened_at TEXT,
    weight_g INTEGER,
    price_eur REAL,
    status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('ungeoeffnet', 'offen', 'leer')),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX batches_coffee ON batches(coffee_id);

  CREATE TABLE recipes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT '',
    dose_g REAL,
    water_g REAL,
    temp_c REAL,
    grind TEXT NOT NULL DEFAULT '',
    grinder TEXT NOT NULL DEFAULT '',
    time_s INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE brews (
    id INTEGER PRIMARY KEY,
    coffee_id INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
    batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
    recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
    brewed_at TEXT NOT NULL,
    dose_g REAL,
    water_g REAL,
    temp_c REAL,
    grind TEXT NOT NULL DEFAULT '',
    time_s INTEGER,
    scores TEXT NOT NULL,
    total REAL NOT NULL,
    flavors TEXT NOT NULL DEFAULT '[]',
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX brews_coffee ON brews(coffee_id);
  CREATE INDEX brews_batch ON brews(batch_id);
  CREATE INDEX brews_recipe ON brews(recipe_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // Nachgetragen = aufgebrauchte Charge aus alten Zeiten, Daten unbekannt. Cup Score = Angabe des Rösters (SCA-Skala)
  `
  ALTER TABLE batches ADD COLUMN backfilled INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE coffees ADD COLUMN cup_score REAL;
  `,
  // Aufbereitung in Art (für Statistik und Filter) und Zusatz (Fermentation, Trocknung, Anteile) aufteilen
  () => {
    db.exec(`ALTER TABLE coffees ADD COLUMN process_detail TEXT NOT NULL DEFAULT ''`);
    const rows = db.prepare(`SELECT id, process FROM coffees WHERE process != ''`).all() as { id: number; process: string }[];
    const upd = db.prepare(`UPDATE coffees SET process = ?, process_detail = ? WHERE id = ?`);
    for (const r of rows) {
      const [art, detail] = splitProcess(r.process);
      upd.run(art, detail, r.id);
    }
  },
  // Schreibweisen derselben Rösterei zusammenführen („Kaffeemacher Rösterei“ → „Kaffeemacher“), häufigste gewinnt
  () => {
    const rows = db
      .prepare(`SELECT roaster, COUNT(*) AS n FROM coffees WHERE roaster != '' GROUP BY roaster ORDER BY n DESC, LENGTH(roaster), roaster`)
      .all() as { roaster: string; n: number }[];
    const canon: string[] = [];
    const upd = db.prepare(`UPDATE coffees SET roaster = ? WHERE roaster = ?`);
    for (const r of rows) {
      const target = canon.find((c) => sameRoaster(c, r.roaster));
      if (!target) canon.push(r.roaster);
      else upd.run(target, r.roaster);
    }
  },
  // Zubereitungen, die der Röster vorschlägt (JSON-Liste von RoasterRecipe)
  `ALTER TABLE coffees ADD COLUMN roaster_recipes TEXT NOT NULL DEFAULT '[]';`,
  // Schnellbewertung neben dem SCA-Bogen: kind 'quick' mit 1–5 Sternen statt Bogen (scores/total dann NULL);
  // Kurzurteil (taste: „sauer“, „bitter“ …) für beide Arten, Grundlage der Hinweise beim Einstellen
  () => {
    db.exec(`
      CREATE TABLE brews_new (
        id INTEGER PRIMARY KEY,
        coffee_id INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
        batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
        recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
        brewed_at TEXT NOT NULL,
        dose_g REAL,
        water_g REAL,
        temp_c REAL,
        grind TEXT NOT NULL DEFAULT '',
        time_s INTEGER,
        kind TEXT NOT NULL DEFAULT 'sca' CHECK (kind IN ('sca', 'quick')),
        scores TEXT,
        total REAL,
        rating INTEGER CHECK (rating BETWEEN 1 AND 5),
        taste TEXT NOT NULL DEFAULT '[]',
        flavors TEXT NOT NULL DEFAULT '[]',
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CHECK ((kind = 'sca' AND scores IS NOT NULL AND total IS NOT NULL) OR (kind = 'quick' AND rating IS NOT NULL))
      );
      INSERT INTO brews_new (id, coffee_id, batch_id, recipe_id, brewed_at, dose_g, water_g, temp_c, grind, time_s, scores, total, flavors, comment, created_at)
        SELECT id, coffee_id, batch_id, recipe_id, brewed_at, dose_g, water_g, temp_c, grind, time_s, scores, total, flavors, comment, created_at FROM brews;
      DROP TABLE brews;
      ALTER TABLE brews_new RENAME TO brews;
      CREATE INDEX brews_coffee ON brews(coffee_id);
      CREATE INDEX brews_batch ON brews(batch_id);
      CREATE INDEX brews_recipe ON brews(recipe_id);
    `);
  },
  // Espresso-Ziel am Kaffee (JSON ShotOverride, NULL = Standard des Röstgrads aus den Einstellungen)
  `ALTER TABLE coffees ADD COLUMN shot_target TEXT;`,
  // Schnellbewertung ohne Pflicht-Sterne: Das Kurzurteil reicht, Sterne sind freiwillig (rating darf NULL sein)
  () => {
    db.exec(`
      CREATE TABLE brews_new (
        id INTEGER PRIMARY KEY,
        coffee_id INTEGER NOT NULL REFERENCES coffees(id) ON DELETE CASCADE,
        batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
        recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
        brewed_at TEXT NOT NULL,
        dose_g REAL,
        water_g REAL,
        temp_c REAL,
        grind TEXT NOT NULL DEFAULT '',
        time_s INTEGER,
        kind TEXT NOT NULL DEFAULT 'sca' CHECK (kind IN ('sca', 'quick')),
        scores TEXT,
        total REAL,
        rating INTEGER CHECK (rating BETWEEN 1 AND 5),
        taste TEXT NOT NULL DEFAULT '[]',
        flavors TEXT NOT NULL DEFAULT '[]',
        comment TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CHECK ((kind = 'sca' AND scores IS NOT NULL AND total IS NOT NULL) OR (kind = 'quick' AND scores IS NULL))
      );
      INSERT INTO brews_new SELECT id, coffee_id, batch_id, recipe_id, brewed_at, dose_g, water_g, temp_c, grind, time_s, kind, scores, total, rating,
        taste, flavors, comment, created_at FROM brews;
      DROP TABLE brews;
      ALTER TABLE brews_new RENAME TO brews;
      CREATE INDEX brews_coffee ON brews(coffee_id);
      CREATE INDEX brews_batch ON brews(batch_id);
      CREATE INDEX brews_recipe ON brews(recipe_id);
    `);
  },
  // Übergang beim Tütenwechsel im Hopper: noch Bohnen der vorigen Tüte dabei, zählt nicht fürs Lernen der neuen Tüte
  `ALTER TABLE brews ADD COLUMN mixed INTEGER NOT NULL DEFAULT 0 CHECK (mixed IN (0, 1));`,
  // … wieder entfernt: Der Hopper wird vor jeder neuen Tüte leer gemahlen
  `ALTER TABLE brews DROP COLUMN mixed;`,
  // Mahlvorgänge aus der Mahlkönig-Sync-Cloud (E64 WS), ein Bezug verweist auf den Mahlvorgang, aus dem er stammt
  `
  CREATE TABLE grinder_events (
    id INTEGER PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    ground_at TEXT NOT NULL,
    device TEXT NOT NULL DEFAULT '',
    grind_um REAL,
    grind_target_um REAL,
    dose_g REAL,
    dose_target_g REAL,
    grind_s REAL,
    recipe_index INTEGER,
    recipe_mode TEXT NOT NULL DEFAULT '',
    brew_time_target_s REAL,
    brewed_at TEXT,
    yield_g REAL,
    shot_s REAL,
    quality TEXT NOT NULL DEFAULT '',
    raw TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX grinder_events_at ON grinder_events(ground_at);
  ALTER TABLE brews ADD COLUMN grinder_event_id INTEGER REFERENCES grinder_events(id) ON DELETE SET NULL;
  CREATE UNIQUE INDEX brews_grinder_event ON brews(grinder_event_id) WHERE grinder_event_id IS NOT NULL;
  `,
  // Shots der Decent DE1, geschickt vom Plugin der de1app nach jedem Bezug; ein Bezug verweist auf seinen Shot
  `
  CREATE TABLE machine_shots (
    id INTEGER PRIMARY KEY,
    uuid TEXT NOT NULL UNIQUE,
    shot_at TEXT NOT NULL,
    profile TEXT NOT NULL DEFAULT '',
    beverage TEXT NOT NULL DEFAULT '',
    dose_g REAL,
    yield_g REAL,
    time_s REAL,
    temp_c REAL,
    peak_bar REAL,
    grind TEXT NOT NULL DEFAULT '',
    bean TEXT NOT NULL DEFAULT '',
    curve TEXT NOT NULL DEFAULT '{}',
    raw TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX machine_shots_at ON machine_shots(shot_at);
  ALTER TABLE brews ADD COLUMN machine_shot_id INTEGER REFERENCES machine_shots(id) ON DELETE SET NULL;
  CREATE UNIQUE INDEX brews_machine_shot ON brews(machine_shot_id) WHERE machine_shot_id IS NOT NULL;
  `,
  // Archiv der de1app: jede Datei aus history/, history_v2/ und den Profilordnern vollständig als JSON (`server/decent-archive.ts`)
  `
  CREATE TABLE decent_files (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    clock INTEGER,
    mtime INTEGER,
    size INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    received_at TEXT NOT NULL
  );
  CREATE INDEX decent_files_clock ON decent_files(clock);
  `,
  // Auslassen und Vormahlen am Startknopf sind keine Bezüge (der Abgleich übernimmt sie nicht mehr); verknüpfte bleiben
  `
  DELETE FROM grinder_events WHERE json_extract(raw, '$.source') = 'local' AND json_extract(raw, '$.trigger') = 'StartButton'
    AND id NOT IN (SELECT grinder_event_id FROM brews WHERE grinder_event_id IS NOT NULL);
  `,
  // Preinfusion getrennt von der Bezugszeit: am Shot aus dem Original nachrechnen; Bezüge, die die Gesamtzeit der Maschine
  // übernommen hatten, bekommen die Zeit ohne Preinfusion (von Hand eingetragene Zeiten bleiben)
  () => {
    db.exec(`ALTER TABLE machine_shots ADD COLUMN preinfusion_s REAL; ALTER TABLE brews ADD COLUMN preinfusion_s REAL;`);
    const set = db.prepare(`UPDATE machine_shots SET preinfusion_s = ? WHERE id = ?`);
    for (const r of db.prepare(`SELECT id, time_s, raw FROM machine_shots`).all() as { id: number; time_s: number | null; raw: string }[]) {
      const s = JSON.parse(r.raw) as Record<string, unknown>;
      const nums = (v: unknown) => (Array.isArray(v) ? v.map((x) => Number(x) || 0) : []);
      const profile = s.profile && typeof s.profile === "object" ? (s.profile as Record<string, unknown>) : {};
      const pi = preinfusionOf(nums(s.elapsed), nums(s.state_change), profile);
      if (pi != null && r.time_s != null && pi < r.time_s) set.run(pi, r.id);
    }
    db.exec(`
      UPDATE brews SET preinfusion_s = (SELECT ROUND(s.preinfusion_s) FROM machine_shots s WHERE s.id = brews.machine_shot_id),
        time_s = (SELECT CAST(ROUND(s.time_s - s.preinfusion_s) AS INTEGER) FROM machine_shots s WHERE s.id = brews.machine_shot_id)
      WHERE machine_shot_id IS NOT NULL AND EXISTS (SELECT 1 FROM machine_shots s WHERE s.id = brews.machine_shot_id
        AND s.preinfusion_s > 0 AND brews.time_s = CAST(ROUND(s.time_s) AS INTEGER));
      UPDATE brews SET preinfusion_s = (SELECT ROUND(s.preinfusion_s) FROM machine_shots s WHERE s.id = brews.machine_shot_id)
      WHERE machine_shot_id IS NOT NULL AND preinfusion_s IS NULL;
    `);
  },
  // Decent-Profil je Kaffee (`server/decent-profile.ts`): alle Profilvariablen der de1app als JSON
  `ALTER TABLE coffees ADD COLUMN decent_profile TEXT;`,
  // Gefrierfach je Charge: [{from, to}] in Tagen (YYYY-MM-DD), `to` leer = liegt noch drin; zählt nicht zum Röstalter
  `ALTER TABLE batches ADD COLUMN freezes TEXT NOT NULL DEFAULT '[]';`,
  // Startknopf-Vorgänge der Mühle (zeitweise fürs Trinktempo, gleich danach wieder entfernt)
  `
  CREATE TABLE grinder_manual (
    uuid TEXT PRIMARY KEY,
    ground_at TEXT NOT NULL,
    grind_s REAL NOT NULL,
    weight_g REAL
  );
  CREATE INDEX grinder_manual_at ON grinder_manual(ground_at);
  `,
  // Verbrauchsschätzung wieder entfernt: Einfrieren wird ohne Tempo empfohlen
  `DROP TABLE grinder_manual;`,
];

function migrate() {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < migrations.length; v++) {
    db.exec("BEGIN");
    try {
      const m = migrations[v];
      if (typeof m === "string") db.exec(m);
      else m();
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
migrate();

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
