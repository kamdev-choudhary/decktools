import path from 'node:path';
import type { PathStyle } from '../../shared/schemas';
import { seal, unseal, type Sealed } from './crypto';
import { readJson, writeJsonAtomic } from './files';

/** A remembered connection. Stored encrypted; the secret never leaves the server. */
export interface SavedConnection {
  id: string;
  owner: string;
  label?: string;
  endpoint: string | null;
  region: string;
  pathStyle: PathStyle;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  buckets: string[];
  publicUrlBase: string | null;
  savedAt: string;
}

/** <data-dir>/connections.enc: every remembered connection, sealed with AES-256-GCM. */
export class SavedConnectionStore {
  private items: SavedConnection[] = [];
  private file: string;

  constructor(
    dataDir: string,
    private readonly key: Buffer,
  ) {
    this.file = path.join(dataDir, 'connections.enc');
  }

  async load() {
    const sealed = await readJson<Sealed | null>(this.file, null);
    this.items = sealed ? unseal<SavedConnection[]>(this.key, sealed) : [];
  }

  all(): SavedConnection[] {
    return this.items;
  }

  async add(item: SavedConnection) {
    this.items = [...this.items.filter((i) => i.id !== item.id), item];
    await writeJsonAtomic(this.file, seal(this.key, this.items));
  }

  async remove(id: string) {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length !== before) await writeJsonAtomic(this.file, seal(this.key, this.items));
  }
}
