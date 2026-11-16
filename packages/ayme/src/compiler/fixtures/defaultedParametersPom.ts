import { ayme } from "@ayme-dev/ayme";

type DashboardType = "personal" | "account" | "team";

const fallbackName = "Untitled";

function defaultCount() {
  return 1;
}

@ayme
export class DefaultedParametersPom {
  @ayme.action({ description: "Create a dashboard." })
  create(name: string, type: DashboardType = "personal") {
    return { name, type };
  }

  @ayme.action({ description: "Use literal defaults." })
  literals(count = 3, offset = -1, archived = false, label = `plain`) {
    return { count, offset, archived, label };
  }

  @ayme.action({ description: "Use non-literal defaults." })
  computed(name = fallbackName, count = defaultCount(), size = 2 * 3) {
    return { name, count, size };
  }

  @ayme.action({ description: "Mark parameters optional without defaults." })
  optional(note?: string, tag: string | undefined = undefined) {
    return { note, tag };
  }

  @ayme.action({ description: "Default a parameter typed with undefined." })
  both(type: DashboardType | undefined = "team") {
    return type;
  }
}
