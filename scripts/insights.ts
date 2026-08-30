import { loadEnv } from './load-env';
loadEnv();

const { generateSuggestions, listSuggestions, suggestionSummary } = await import('../src/lib/insights/engine');
const { RULE_META } = await import('../src/lib/insights/rules');

/** Javaslatok újraszámolása és kiírása — szinkron nélkül, a helyi tükörből. */
const result = generateSuggestions();
console.log(`\n${result.open} nyitott javaslat (${result.created} új ebben a körben)\n`);

const labels = Object.fromEntries(RULE_META.map((r) => [r.id, r.label]));
const summary = suggestionSummary();

for (const { rule, count } of summary.byRule) {
  console.log(`${labels[rule] ?? rule}: ${count}`);
}

console.log('\nA tíz legsürgősebb:\n');
for (const s of listSuggestions({ limit: 10 })) {
  console.log(`[${s.severity}] ${s.title}`);
  if (s.action) console.log(`         → ${s.action.describe}`);
}
