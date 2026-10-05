import CounterExample from "./counter-example";

export default function Home() {
  return (
    <main>
      <h1>Ayme Next.js prototype</h1>
      <p>One Page Object, compiled by Turbopack and used in the browser.</p>
      <CounterExample />
      <a href="/other">Full page load</a>
    </main>
  );
}
