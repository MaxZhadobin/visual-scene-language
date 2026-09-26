import { extractViaHttp } from './src/tools/httpExtractor.ts';

try {
  const result = await extractViaHttp('https://ru.wikipedia.org/wiki/Нейронная_сеть', { readable: true });
  console.log('OK:', result.title, result.wordCount);
} catch (e) {
  console.error('ERROR:', e.message);
  console.error('STACK:', e.stack);
}
