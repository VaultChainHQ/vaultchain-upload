"use client";

import { useState } from "react";
import type { ProfileRecord } from "@/lib/vaultstore";
import { vaultStore } from "@/lib/vaultstore";
import { ADDRESS_RE, short } from "@/lib/format";
import { errMsg, node, usePoll } from "@/lib/hooks";
import { toast } from "@/lib/toast";
import { CopyBtn } from "../CopyText";
import { Avatar, EmptyState, ErrorNote, Field, Pill } from "../ui";

function KeyStatus({ address }: { address: string }) {
  const k = usePoll(`pub:${address}`, () => node.pubkey(address), 0);
  if (k.loading) return null;
  return k.data ? (
    <Pill tone="ok" title="This person can receive private files from you.">Can receive private files</Pill>
  ) : (
    <Pill tone="warn" title="They have not sent a transaction yet, so the chain does not know their public key. Ask them to press “Publish my key” on their Account page.">
      Needs to publish their key
    </Pill>
  );
}

export function Contacts({ profile }: { profile: ProfileRecord }) {
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = profile.entry.id;
  const a = addr.trim();

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      vaultStore().addContact(id, name, a);
      toast(`Added ${name.trim() || "contact"}.`, "good");
      setName("");
      setAddr("");
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <div>
      <form className="panel form" onSubmit={add}>
        <h2>Add a contact</h2>
        <p className="muted">Save the address of people you share files with, so you can pick them by name instead of pasting an address.</p>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Name">
            <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" required autoComplete="off" />
          </Field>
          <Field label="Address" hint={a && !ADDRESS_RE.test(a) ? "Addresses start with vault1…" : a === profile.entry.address ? "That is your own address." : undefined}>
            <input type="text" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="vault1…" spellCheck={false} autoComplete="off" required />
          </Field>
          <button className="btn primary" type="submit" disabled={!name.trim() || !ADDRESS_RE.test(a) || a === profile.entry.address}>
            Add contact
          </button>
        </div>
        <ErrorNote error={error} />
      </form>

      {profile.contacts.length === 0 ? (
        <EmptyState icon="👥" title="No contacts yet">
          Add someone above, then choose them from the Share menu on any file.
        </EmptyState>
      ) : (
        <ul className="plain contact-list" aria-label="Your contacts">
          {profile.contacts.map((c) => (
            <li key={c.id} className="grant">
              <span className="row" style={{ alignItems: "center" }}>
                <Avatar name={c.name} color="#6b7280" size={28} />
                <span>
                  <strong>{c.name}</strong> <span className="mono muted small">{short(c.address, 14, 6)}</span>
                  <br />
                  <KeyStatus address={c.address} />
                </span>
              </span>
              <span className="row">
                <CopyBtn text={c.address} label="Copy address" what="Address" />
                <button type="button" className="btn sm danger" onClick={() => (vaultStore().removeContact(id, c.id), toast(`Removed ${c.name}.`, "info"))}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
