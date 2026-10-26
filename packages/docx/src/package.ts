// OPC (zip) package reading and writing.
//
// Entries are kept as raw uncompressed bytes in their original order. Parts
// that are not edited are written back byte-for-byte.

import { unzipSync, zipSync, type Zippable } from 'fflate';

export interface DocxPackage {
  /** Entry name → uncompressed bytes, in original archive order. */
  entries: Map<string, Uint8Array>;
}

export interface PackageLimits {
  maxEntries: number;
  maxTotalUncompressedBytes: number;
}

export const DEFAULT_LIMITS: PackageLimits = {
  maxEntries: 5000,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
};

export class PackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageError';
  }
}

export function readPackage(bytes: Uint8Array, limits: PackageLimits = DEFAULT_LIMITS): DocxPackage {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new PackageError('Not a zip archive (is this a .docx file?)');
  }

  let count = 0;
  let declaredTotal = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        count++;
        declaredTotal += file.originalSize;
        if (count > limits.maxEntries) throw new PackageError('Archive has too many entries');
        if (declaredTotal > limits.maxTotalUncompressedBytes) {
          throw new PackageError('Archive expands beyond the size limit');
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof PackageError) throw err;
    throw new PackageError(`Could not read archive: ${(err as Error).message}`);
  }

  const actualTotal = Object.values(files).reduce((sum, f) => sum + f.length, 0);
  if (actualTotal > limits.maxTotalUncompressedBytes) {
    throw new PackageError('Archive expands beyond the size limit');
  }
  return { entries: new Map(Object.entries(files)) };
}

// Fixed timestamp so identical content always produces identical archives.
const ZIP_MTIME = new Date('2000-01-01T00:00:00Z');
const STORED_EXTENSIONS = /\.(png|jpe?g|gif|emf|wmf|tiff?|bmp|zip|mp4|wdp)$/i;

export function writePackage(pkg: DocxPackage): Uint8Array {
  const zippable: Zippable = {};
  // [Content_Types].xml first, as Office does, then everything else in order.
  const names = [...pkg.entries.keys()].sort((a, b) =>
    a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0,
  );
  for (const name of names) {
    const level = STORED_EXTENSIONS.test(name) ? 0 : 6;
    zippable[name] = [pkg.entries.get(name)!, { level, mtime: ZIP_MTIME }];
  }
  return zipSync(zippable);
}

/** Resolve the main document part from the package relationships. */
export function mainDocumentPath(pkg: DocxPackage): string {
  const rels = pkg.entries.get('_rels/.rels');
  if (!rels) throw new PackageError('Missing _rels/.rels; not an Office document');
  const xml = new TextDecoder().decode(rels);
  const re = /<Relationship\b[^>]*>/g;
  for (const match of xml.match(re) ?? []) {
    const type = /\bType="([^"]*)"/.exec(match)?.[1] ?? '';
    const target = /\bTarget="([^"]*)"/.exec(match)?.[1];
    if (target && type.endsWith('/officeDocument')) {
      const path = target.replace(/^\//, '');
      if (!pkg.entries.has(path)) throw new PackageError(`Main document part ${path} is missing`);
      return path;
    }
  }
  throw new PackageError('No main document relationship; not a Word document');
}
