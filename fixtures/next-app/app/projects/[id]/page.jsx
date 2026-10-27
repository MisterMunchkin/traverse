import Link from 'next/link';
export default async function Project({params}) {
  const {id} = await params;
  return <main><h1>Project {id}</h1><Link href="/">Home</Link></main>;
}
