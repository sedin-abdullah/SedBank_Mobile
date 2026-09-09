/**
 * Mirrors every `data-testid` onto the element's `id`.
 *
 * Why this exists: `data-testid` is invisible to Android's accessibility tree,
 * but an element's HTML `id` surfaces as the node's `resource-id`. So a native
 * runner — Appium, UiAutomator2, Sedstart — can address exactly the elements
 * the web suite already addresses, from the one catalogue in
 * `shared/testIds.js`, and the locator never depends on the visible text.
 *
 * Done here rather than at each call site because there are a few hundred of
 * them across pages and components: a per-element change would be a large diff
 * that inevitably misses some, and the next person adding a testid would have
 * to remember. This way the two are the same thing by construction.
 *
 * Rules:
 *  - an explicit `id` always wins; nothing is overwritten
 *  - an id already taken by another element is skipped, so the document stays
 *    valid where a testid is deliberately rendered more than once
 *  - React replaces nodes constantly, so it runs again on every mutation
 */

let observer = null;

function assignIds(root = document) {
  const candidates = root.querySelectorAll?.('[data-testid]:not([id])');
  if (!candidates) return;

  candidates.forEach((element) => {
    const testId = element.getAttribute('data-testid');
    if (!testId) return;

    // getElementById is the cheap way to ask "is this id free?".
    if (document.getElementById(testId)) return;

    element.id = testId;
  });
}

/**
 * Starts mirroring. Safe to call more than once; safe on the server (guards on
 * `document`). Returns a stop function, which only the tests use.
 */
export function mirrorTestIdsToNativeIds() {
  if (typeof document === 'undefined' || observer) return () => {};

  assignIds();

  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') {
        record.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.hasAttribute('data-testid') && !node.id) assignIds(node.parentNode ?? document);
          assignIds(node);
        });
      } else if (record.type === 'attributes' && record.target.nodeType === 1) {
        assignIds(record.target.parentNode ?? document);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-testid'],
  });

  return () => {
    observer?.disconnect();
    observer = null;
  };
}
