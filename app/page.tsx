import { Flow } from "@/components/flow/Flow";

export default function Home() {
  return (
    <>
      <div className="flow">
        <p className="eyebrow">Upload</p>
        <h1>Store a file on VaultChain</h1>
        <p className="lead">Seven short steps, about two minutes. Your key stays in this browser; nothing is signed until you confirm.</p>
      </div>
      <Flow />
    </>
  );
}
