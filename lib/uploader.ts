import { friendlyError } from "./errors";
import type { UploadDeps } from "./flow";
import { node, provider } from "./hooks";
import { session } from "./session";
import { grantRead, uploadObject } from "./vault/flows";

/** The real dependencies for `runQueue`: sign with the unlocked profile, upload through the engine, and open public files to everyone. */
export function realDeps(): UploadDeps {
  return {
    explain: friendlyError,
    upload: async (o) => {
      const u = session().snapshot();
      if (!u) throw new Error("The profile is locked. Unlock it and try again.");
      const signer = { key: u.key, priv: u.priv };
      // A long upload must not trip the inactivity lock, so every progress tick counts as activity.
      const progress = (step: string, fraction?: number) => {
        session().touch();
        o.progress(step, fraction);
      };
      const data = new Uint8Array(await o.file.arrayBuffer());
      const res = await uploadObject({ node, provider, signer, data, name: o.name, mime: o.mime, encrypt: o.encrypt, durationBlocks: o.durationBlocks, progress });
      if (!o.encrypt) {
        progress("Granting public access to anyone with the link");
        const [rec, grants, info] = await Promise.all([node.manifest(res.root), node.grants(res.root), node.info()]);
        const open = grants.some((g) => g.grantee === "*" && g.expiry_height > info.height);
        if (rec && !open) await grantRead(node, signer, rec, "*", info.height + o.durationBlocks, progress);
      }
      return res;
    },
  };
}
