// Gives the screen modules access to the router without an import cycle with app.js.

let router = null;

export function setRouter(value) {
  router = value;
}

/** Opens a screen (see router.go). */
export function go(name, params) {
  if (!router) throw new Error('nav: the router is not ready.');
  return router.go(name, params);
}
