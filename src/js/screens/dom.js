// Small DOM helpers shared by the screens.

/**
 * Clones `<template id="tpl-<name>">` into `root` and returns the elements that carry a
 * `data-ref` attribute, by name.
 */
export function renderTemplate(root, name) {
  const template = document.getElementById(`tpl-${name}`);
  if (!template) throw new Error(`Missing <template id="tpl-${name}">.`);
  const fragment = template.content.cloneNode(true);
  const refs = {};
  for (const element of fragment.querySelectorAll('[data-ref]')) {
    refs[element.dataset.ref] = element;
  }
  root.appendChild(fragment);
  return refs;
}
