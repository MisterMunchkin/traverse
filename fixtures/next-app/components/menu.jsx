import Link from 'next/link';
export default function Menu() {
  return <nav><Link href="/projects/42" aria-label="Open project">Open project</Link><br/><Link href="/settings">Settings</Link></nav>;
}
