import { Dashboard } from "@/components/Dashboard";

export default function Home() {
  return (
    <main>
      <header>
        <h1>VaultChain Upload</h1>
        <p className="muted">Client-side signing and encryption for the VaultChain devnet.</p>
      </header>
      <div className="warning" role="alert">
        <b>Devnet only. Do not use real funds or sensitive data.</b>
        <ul>
          <li>Your private keys are generated and stored in <b>this browser&apos;s localStorage as plain hex</b>, with no passphrase. Anyone with access to this browser profile (or any script running on this site) can take them. Back up the key before you rely on it, and clear browser data = lose the key.</li>
          <li>The devnet can be reset at any time, which erases all balances, files and deals.</li>
          <li>Keys and plaintext never leave your browser. Only signed transactions, ciphertext (or plaintext, if you turn encryption off) and signed read tokens are sent to the node and the storage provider.</li>
        </ul>
      </div>
      <Dashboard />
      <footer className="muted">
        <a href="https://github.com/VaultChainHQ/vaultchain">vaultchain</a> · <a href="https://github.com/VaultChainHQ/vaultchain-explorer">vaultchain-explorer</a> ·{" "}
        <a href="https://github.com/VaultChainHQ/vaultchain-upload">vaultchain-upload</a>
      </footer>
    </main>
  );
}
