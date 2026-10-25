// Plain-language explanations for the words the explorer cannot avoid. Shown as tooltips and on /glossary.
export interface Term {
  label: string;
  short: string;
  long: string;
}

export const GLOSSARY: Record<string, Term> = {
  vault: { label: "VAULT", short: "The devnet token. Test money with no real value.", long: "VAULT is the token used to pay for storage and fees. On the devnet it is free test money from the faucet. 1 VAULT is 1,000,000 uvault (the smallest unit)." },
  uvault: { label: "uvault", short: "The smallest unit of VAULT: 1,000,000 uvault = 1 VAULT.", long: "Amounts are stored on the chain in uvault, like cents to a dollar. The explorer shows them in VAULT." },
  height: { label: "Block height", short: "How many blocks the chain has produced. About one block every 3 seconds.", long: "A block is a batch of transactions. The height is the block count, so it also works as the chain's clock. On the devnet a block takes roughly 3 seconds." },
  deal: { label: "Storage deal", short: "An agreement to keep one file stored for a set time, paid up front.", long: "When you upload a file you open a deal: you lock a payment, the chain picks storage providers, and they earn it by regularly proving they still hold your file." },
  manifest: { label: "File record", short: "The on-chain record of a file: its name, size, owner and fingerprint.", long: "Also called a manifest. It is a small public record on the chain that describes an uploaded file (not the file itself). The file's bytes live with the storage providers." },
  root: { label: "File ID", short: "A unique fingerprint of the file's contents (64 hex characters).", long: "Also called the root hash or CID. Two files with identical contents have the same ID, and any change to the file changes it. You can use it to find a file here or in the upload app." },
  replica: { label: "Copy", short: "One provider's stored copy of the file. Deals can ask for several.", long: "Also called a replica. Keeping several copies on different providers means the file survives if one provider goes offline." },
  provider: { label: "Storage provider", short: "A server that stores files and earns VAULT for proving it still has them.", long: "Providers lock collateral, accept deals, hold the file's chunks and answer proof challenges. A provider that cheats or disappears is penalised." },
  proof: { label: "Storage proof", short: "A provider's answer to a random challenge, showing it still holds a piece of the file.", long: "The chain regularly asks a provider for a random chunk of the file. A correct answer is a proof, and it is recorded on the chain." },
  epoch: { label: "Proof round", short: "The numbered period in which a proof was due (also called an epoch).", long: "Time is split into rounds of a fixed number of blocks. Each round, each copy should produce one proof." },
  encryption: { label: "Encrypted", short: "The file's contents are scrambled; only people given the key can read them.", long: "Encrypted files are locked in the owner's browser before upload. Providers and this explorer only ever see unreadable bytes. The owner can share access with other addresses." },
  grant: { label: "Access grant", short: "Permission the owner gave another address to read an encrypted file.", long: "Sharing an encrypted file means sealing its key for the other person's address. Grants can have an expiry and can be revoked by the owner." },
  nonce: { label: "Nonce", short: "How many transactions this account has sent. Stops a transaction being replayed.", long: "Each account counts the transactions it has sent. The chain accepts them in order and never twice." },
  escrow: { label: "Payment (escrow)", short: "The VAULT locked in a deal. Providers earn it as they prove storage.", long: "The deal's payment is held by the chain and released to providers over the term as they keep proving they hold the file." },
  collateral: { label: "Collateral", short: "VAULT a provider locks as a promise to behave. It can lose some if it cheats.", long: "Providers stake collateral when they join. Missing proofs can cost them part of it." },
  tx: { label: "Transaction", short: "A signed action on the chain, such as sending tokens or opening a deal.", long: "Everything that changes the chain is a transaction: a transfer, registering a file, opening a deal, sharing access. Each has a unique hash." },
  chunk: { label: "Chunk", short: "A file is split into pieces (chunks) so it can be checked and moved in parts.", long: "Chunks are the unit providers store and prove. A proof challenge asks for one chunk." },
  mime: { label: "File type", short: "The kind of file, such as image/png or application/pdf.", long: "Also called MIME type. It tells apps how to open a file." },
};

export const GLOSSARY_ORDER = ["vault", "uvault", "height", "deal", "manifest", "root", "replica", "provider", "proof", "epoch", "encryption", "grant", "escrow", "collateral", "tx", "chunk", "nonce", "mime"];
