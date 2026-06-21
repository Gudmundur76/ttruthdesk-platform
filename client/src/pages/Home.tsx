/**
 * Home.tsx — Admin redirect
 * citation.manus.space is an internal admin tool. Root redirects to /dashboard.
 */
import { Redirect } from "wouter";

export default function Home() {
  return <Redirect to="/dashboard" />;
}
