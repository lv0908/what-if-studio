import path from 'node:path';
import { pathToFileURL } from 'node:url';

const three = pathToFileURL(path.resolve('engine/what-if/vendor/three/three.module.min.js')).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return { url: three, shortCircuit: true };
  return nextResolve(specifier, context);
}
