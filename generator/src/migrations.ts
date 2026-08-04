/**
 * Migration journal surgery for the generated project. The generated
 * migrations/meta/_journal.json must reference only kept migrations and
 * renumber idx sequentially (0, 1, 2, ...) or `bun run db:migrate` breaks on
 * the generated project. Snapshots for removed migrations must be deleted.
 */

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface MigrationJournal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/** "0002_chemical_karen_page.sql" -> "0002_chemical_karen_page" */
export function journalTagFor(migrationFile: string): string {
  return migrationFile.replace(/\.sql$/, "");
}

/** "0002_chemical_karen_page.sql" -> "0002_snapshot.json" */
export function snapshotNameFor(migrationFile: string): string {
  const prefix = migrationFile.match(/^(\d+)_/)?.[1];
  if (prefix === undefined) {
    throw new Error(`cannot derive snapshot name for migration "${migrationFile}"`);
  }
  return `${prefix}_snapshot.json`;
}

/**
 * Filters a migrations/meta/_journal.json document down to the migrations in
 * keepFiles (exact migration FILE names) and renumbers idx sequentially.
 * Preserves version/dialect and each kept entry's original metadata.
 */
export function filterMigrationJournal(journalJson: string, keepFiles: string[]): string {
  const journal = JSON.parse(journalJson) as MigrationJournal;
  const keepTags = new Set(keepFiles.map(journalTagFor));
  const entries = journal.entries
    .filter((entry) => keepTags.has(entry.tag))
    .map((entry, index) => ({ ...entry, idx: index }));
  const filtered: MigrationJournal = {
    version: journal.version,
    dialect: journal.dialect,
    entries,
  };
  return `${JSON.stringify(filtered, null, 2)}\n`;
}

/**
 * Filters the file names in migrations/meta/ down to the journal plus the
 * snapshots of kept migrations. Returns the entries to KEEP.
 */
export function filterMigrationSnapshots(metaEntryNames: string[], keepFiles: string[]): string[] {
  const keepSnapshots = new Set(keepFiles.map(snapshotNameFor));
  return metaEntryNames
    .filter((name) => name === "_journal.json" || keepSnapshots.has(name))
    .sort();
}
