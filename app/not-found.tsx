import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap-narrow" style={{ paddingTop: 24 }}>
      <p className="eyebrow">404</p>
      <h1>That page does not exist.</h1>
      <p className="lead">The link may be mistyped. You can start a new upload or open your files from here.</p>
      <p className="row">
        <Link className="btn primary" href="/">Upload a file</Link>
        <Link className="btn" href="/files">My files</Link>
        <Link className="btn" href="/account">Account</Link>
      </p>
    </div>
  );
}
