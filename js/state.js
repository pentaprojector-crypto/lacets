// État partagé de l'appli et petit bus d'événements.
export const app = {
  map: null,
  settings: {},
  screen: 'carte',
  screens: {},
  bus: new EventTarget(),
};

export function emit(name, detail) {
  app.bus.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on(name, fn) {
  const handler = (e) => fn(e.detail);
  app.bus.addEventListener(name, handler);
  return () => app.bus.removeEventListener(name, handler);
}
