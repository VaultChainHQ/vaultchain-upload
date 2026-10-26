// Where unfinished uploads live so they survive a page reload: a small record per upload plus the chunks waiting to be sent,
// kept in IndexedDB. Chunks of private files are already encrypted when they are stored here, so nothing readable is written to disk.
// There is a memory implementation with the same interface for tests and for browsers without IndexedDB.

export interface UploadJob {
  id: string;
  /** The account that signs the transactions; only that profile can finish the upload. */
  owner: string;
  name: string;
  mime: string;
  /** Size of the original file in bytes. */
  size: number;
  encrypt: boolean;
  durationBlocks: number;
  createdAt: number;
  updatedAt: number;
  /** Set once every chunk has been written to the store: from here on the original file is no longer needed. */
  staged?: { root: string; storedSize: number; chunkSize: number; chunks: number; leaves: string };
  /** The file key sealed to the owner (hex), for the CommitManifest of a private file. */
  envelope?: string;
  manifestTx?: string;
  dealTx?: string;
  dealId?: number;
  /** Chunk indexes the provider has accepted. */
  uploaded: number[];
  granted?: boolean;
  /** 0..1 while the file is still being read and chunked. */
  stagingFraction?: number;
  error?: string;
}

export interface JobStore {
  putJob(job: UploadJob): Promise<void>;
  getJob(id: string): Promise<UploadJob | undefined>;
  listJobs(): Promise<UploadJob[]>;
  /** Removes the job and all its chunks. */
  deleteJob(id: string): Promise<void>;
  putChunk(id: string, index: number, data: Uint8Array): Promise<void>;
  getChunk(id: string, index: number): Promise<Uint8Array | undefined>;
  /** Drops chunks (used when staging starts over). */
  clearChunks(id: string): Promise<void>;
}

export function memoryJobStore(): JobStore & { chunkCount(id: string): number } {
  const jobs = new Map<string, UploadJob>();
  const chunks = new Map<string, Uint8Array>();
  const key = (id: string, i: number) => `${id}/${i}`;
  return {
    putJob: async (j) => void jobs.set(j.id, structuredClone(j)),
    getJob: async (id) => {
      const j = jobs.get(id);
      return j ? structuredClone(j) : undefined;
    },
    listJobs: async () => [...jobs.values()].map((j) => structuredClone(j)).sort((a, b) => a.createdAt - b.createdAt),
    deleteJob: async (id) => {
      jobs.delete(id);
      for (const k of [...chunks.keys()]) if (k.startsWith(`${id}/`)) chunks.delete(k);
    },
    putChunk: async (id, i, d) => void chunks.set(key(id, i), d.slice()),
    getChunk: async (id, i) => chunks.get(key(id, i)),
    clearChunks: async (id) => {
      for (const k of [...chunks.keys()]) if (k.startsWith(`${id}/`)) chunks.delete(k);
    },
    chunkCount: (id) => [...chunks.keys()].filter((k) => k.startsWith(`${id}/`)).length,
  };
}

const DB_NAME = "vaultchain-upload-jobs";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => rej(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function hasIndexedDB(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): boolean {
  return !!factory;
}

/** Jobs and chunks in IndexedDB. `factory` is injectable so the tests can use fake-indexeddb. */
export function idbJobStore(factory: IDBFactory = indexedDB, name = DB_NAME): JobStore {
  let dbp: Promise<IDBDatabase> | undefined;
  const open = () =>
    (dbp ??= new Promise<IDBDatabase>((res, rej) => {
      const r = factory.open(name, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("jobs", { keyPath: "id" });
        db.createObjectStore("chunks");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error ?? new Error("could not open IndexedDB"));
    }));
  const run = async <T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T> | T): Promise<T> => {
    const db = await open();
    const tx = db.transaction(stores, mode);
    const finished = done(tx);
    const out = await fn(tx);
    await finished;
    return out;
  };
  const range = (id: string) => IDBKeyRange.bound(`${id}/`, `${id}/\uffff`);
  return {
    putJob: (j) => run(["jobs"], "readwrite", (tx) => void tx.objectStore("jobs").put(j)),
    getJob: (id) => run(["jobs"], "readonly", (tx) => req<UploadJob | undefined>(tx.objectStore("jobs").get(id))),
    listJobs: async () => (await run(["jobs"], "readonly", (tx) => req<UploadJob[]>(tx.objectStore("jobs").getAll()))).sort((a, b) => a.createdAt - b.createdAt),
    deleteJob: (id) =>
      run(["jobs", "chunks"], "readwrite", (tx) => {
        tx.objectStore("jobs").delete(id);
        tx.objectStore("chunks").delete(range(id));
      }),
    putChunk: (id, i, d) => run(["chunks"], "readwrite", (tx) => void tx.objectStore("chunks").put(d, `${id}/${i}`)),
    getChunk: async (id, i) => {
      const v = await run(["chunks"], "readonly", (tx) => req<Uint8Array | ArrayBuffer | undefined>(tx.objectStore("chunks").get(`${id}/${i}`)));
      if (v === undefined) return undefined;
      return v instanceof Uint8Array ? v : new Uint8Array(v);
    },
    clearChunks: (id) => run(["chunks"], "readwrite", (tx) => void tx.objectStore("chunks").delete(range(id))),
  };
}

let shared: JobStore | undefined;
/** The store the app uses: IndexedDB when the browser has it, otherwise memory (uploads then cannot survive a reload). */
export function jobStore(): JobStore {
  return (shared ??= hasIndexedDB() ? idbJobStore() : memoryJobStore());
}
export const durableJobs = (): boolean => hasIndexedDB();
