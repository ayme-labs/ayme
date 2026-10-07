import CounterExample from "./counter-example";
import { countRender } from "./renders";

export default function Home() {
  countRender();
  return (
    <main>
      <h1>Ayme Next.js prototype</h1>
      <p>One Page Object, compiled by Turbopack and used in the browser.</p>
      <CounterExample />
      <a href="/other">Full page load</a>
    </main>
  );
}
