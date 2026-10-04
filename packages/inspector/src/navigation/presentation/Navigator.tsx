import { NavigatorView } from "../view/NavigatorView";
import { useNavigator } from "./useNavigator";

/**
 * The navigator: one search over every lens, the lens switcher, the legend,
 * and the active lens's tree. Search results replace the tree while there
 * is a query.
 */
export function Navigator(props: Parameters<typeof useNavigator>[0]) {
  return <NavigatorView {...props} {...useNavigator(props)} />;
}
