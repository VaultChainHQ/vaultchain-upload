"use client";

import { Gate } from "../Gate";
import { Contacts } from "./Contacts";

export function ContactsView() {
  return <Gate needKey={false}>{({ profile }) => <Contacts profile={profile} />}</Gate>;
}
