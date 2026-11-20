// Kleine Render-Registry: Module melden ihre Render-Funktionen an,
// andere lösen ein Neuzeichnen aus, ohne sich gegenseitig importieren zu müssen.
const renderers = {};

export function register(name, fn) { renderers[name] = fn; }

export function render(...names) {
  for (const n of names) renderers[n]?.();
}
