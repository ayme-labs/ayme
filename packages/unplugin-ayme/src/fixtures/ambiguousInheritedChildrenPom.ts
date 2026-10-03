import { ayme } from "@ayme-dev/ayme";

@ayme
class BaseMenu {}

class UserMenu extends BaseMenu {}

class AdminMenu extends BaseMenu {}

@ayme
export class AmbiguousInheritedChildrenPom {
  readonly ambiguousMenu!: UserMenu & AdminMenu;
}
