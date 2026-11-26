// Stands in the browser runtime's Playwright Lite page of a document, the key
// its stores are kept under, where a jsdom test has none to make: one object
// per document, which nothing drives. `vi.mock` puts it in place of
// `page-state/infrastructure/browserInPage.ts`'s own.
export function standInPageOfDocument() {
  const serverDocument = {};
  const pages = new WeakMap<object, object>();
  return {
    pageOfDocument: (document: object | undefined) => {
      // A server has no document: the one page its sessions share.
      const currentDocument = document ?? serverDocument;
      let page = pages.get(currentDocument);
      if (!page) pages.set(currentDocument, (page = {}));
      return page;
    },
  };
}
