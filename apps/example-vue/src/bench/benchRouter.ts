import { ref } from "vue";

/**
 * The bench pages' router: the path below the app's base, kept in step with
 * the History API. A page moves on with `navigate`, which pushes a history
 * entry without loading a new document, as a client-side router does.
 */
const pathOfLocation = () =>
  location.pathname.slice(import.meta.env.BASE_URL.length);

export const benchPath = ref(pathOfLocation());

addEventListener("popstate", () => {
  benchPath.value = pathOfLocation();
});

export function navigate(path: string) {
  history.pushState(null, "", `${import.meta.env.BASE_URL}${path}`);
  benchPath.value = path;
}
