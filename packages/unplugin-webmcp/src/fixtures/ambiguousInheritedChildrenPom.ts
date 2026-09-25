import { WebMCP } from "./webmcp";

@WebMCP
class BaseMenu {}

class UserMenu extends BaseMenu {}

class AdminMenu extends BaseMenu {}

@WebMCP
export class AmbiguousInheritedChildrenPom {
  readonly ambiguousMenu!: UserMenu & AdminMenu;
}
