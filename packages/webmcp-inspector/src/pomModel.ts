import type {
  PomMemberManifest,
  PomMemberObservation,
  RegisteredPomTool,
} from "@ayme-dev/webmcp";
import type { RegisteredPom } from "@ayme-dev/webmcp/internal";

// The Inspector's read model of the registry: one entry per POM class, with
// the live instances its member states are derived from.

export type PomInstance = {
  className: string;
  displayPath: string;
  probePath: string;
  registration: RegisteredPom;
};

export type PomClass = {
  className: string;
  kind: "page" | "component";
  members: PomMemberManifest[];
  tools: RegisteredPomTool[];
  registrations: RegisteredPom[];
  instances: PomInstance[];
};

export type MemberState =
  "pending" | "probe failed" | "present" | "absent" | "ambiguous";

export function listPomClasses(registrations: readonly RegisteredPom[]) {
  const classes = new Map<string, PomClass>();

  for (const registration of registrations) {
    const page = registration.manifest;
    const pageClass = ensurePomClass(
      classes,
      page.className,
      "page",
      page.members,
      registration.tools.filter((tool) => tool.componentClassName === undefined)
    );
    pageClass.registrations.push(registration);
    pageClass.instances.push({
      className: page.className,
      displayPath: page.className,
      probePath: "",
      registration,
    });

    for (const component of page.components) {
      ensurePomClass(
        classes,
        component.className,
        "component",
        component.members,
        registration.tools.filter(
          (tool) => tool.componentClassName === component.className
        )
      );
    }

    for (const instance of discoverComponentInstances(registration)) {
      classes.get(instance.className)?.instances.push(instance);
    }
  }

  return [...classes.values()];
}

function ensurePomClass(
  classes: Map<string, PomClass>,
  className: string,
  kind: PomClass["kind"],
  members: readonly PomMemberManifest[],
  tools: readonly RegisteredPomTool[]
) {
  const existing = classes.get(className);
  if (existing) {
    for (const tool of tools) {
      if (!existing.tools.some((candidate) => candidate.name === tool.name))
        existing.tools.push(tool);
    }
    return existing;
  }

  const pomClass: PomClass = {
    className,
    kind,
    members: [...members],
    tools: [...tools],
    registrations: [],
    instances: [],
  };
  classes.set(className, pomClass);
  return pomClass;
}

function discoverComponentInstances(registration: RegisteredPom) {
  const components = new Map(
    registration.manifest.components.map((component) => [
      component.className,
      component,
    ])
  );
  const instances: PomInstance[] = [];

  function visit(members: readonly PomMemberManifest[], prefix: string) {
    for (const member of members) {
      if (member.kind !== "component") continue;

      const memberPath = prefix
        ? `${prefix}.${member.memberName}`
        : member.memberName;
      const component = components.get(member.componentClassName);
      if (!component) continue;

      const count = member.collection
        ? (observationAt(registration, memberPath)?.count ?? 0)
        : 1;
      for (let index = 0; index < count; index += 1) {
        const probePath = member.collection
          ? `${memberPath}[${index}]`
          : memberPath;
        instances.push({
          className: component.className,
          displayPath: `${registration.manifest.className}.${probePath}`,
          probePath,
          registration,
        });
        visit(component.members, probePath);
      }
    }
  }

  visit(registration.manifest.members, "");
  return instances;
}

function observationAt(registration: RegisteredPom, path: string) {
  return registration.memberObservations.find(
    (observation) => observation.memberName === path
  );
}

function memberProbePath(prefix: string, member: PomMemberManifest) {
  const memberPath = prefix
    ? `${prefix}.${member.memberName}`
    : member.memberName;
  return member.kind === "component" && !member.collection
    ? `${memberPath}.root`
    : memberPath;
}

function observationsForMember(
  pomClass: PomClass,
  member: PomMemberManifest
): PomMemberObservation[] {
  if (pomClass.kind === "page") {
    const registration = pomClass.registrations[0];
    const observation = registration
      ? observationAt(registration, memberProbePath("", member))
      : undefined;
    return observation ? [observation] : [];
  }
  return pomClass.instances.flatMap((instance) => {
    const observation = observationAt(
      instance.registration,
      memberProbePath(instance.probePath, member)
    );
    return observation ? [observation] : [];
  });
}

function hasPendingProbe(pomClass: PomClass) {
  return pomClass.registrations.some(
    (registration) => registration.memberObservations.length === 0
  );
}

function observationState(observation: PomMemberObservation): MemberState {
  if (observation.error) return "probe failed";
  if (observation.kind === "component-collection")
    return observation.count > 0 ? "present" : "absent";
  if (observation.count === 0) return "absent";
  if (observation.count === 1) return "present";
  return "ambiguous";
}

function observationSummary(observation: PomMemberObservation) {
  if (observation.error) return observation.error;
  if (observation.kind === "component-collection")
    return plural(observation.count, "component", "components");
  return plural(observation.count, "match", "matches");
}

export function memberState(
  pomClass: PomClass,
  member: PomMemberManifest
): MemberState {
  const observations = observationsForMember(pomClass, member);
  const [first] = observations;
  if (!first) return hasPendingProbe(pomClass) ? "pending" : "absent";
  if (observations.some((observation) => observation.error))
    return "probe failed";
  if (pomClass.kind === "page") return observationState(first);
  const presentCount = observations.filter(
    (observation) => observation.count > 0
  ).length;
  if (presentCount === observations.length) return "present";
  if (presentCount === 0) return "absent";
  return "ambiguous";
}

export function memberSummary(pomClass: PomClass, member: PomMemberManifest) {
  const observations = observationsForMember(pomClass, member);
  const [first] = observations;
  if (!first) {
    return hasPendingProbe(pomClass)
      ? "Waiting for the first page probe."
      : "No instances found.";
  }
  const failed = observations.find((observation) => observation.error);
  if (failed) return failed.error ?? "Probe failed.";
  if (pomClass.kind === "page") return observationSummary(first);
  if (member.kind === "component" && member.collection) {
    const componentCount = observations.reduce(
      (total, observation) => total + observation.count,
      0
    );
    return `${plural(componentCount, "component", "components")} across ${plural(
      observations.length,
      "parent instance",
      "parent instances"
    )}`;
  }
  const presentCount = observations.filter(
    (observation) => observation.count > 0
  ).length;
  return `${presentCount}/${observations.length} instances have a match`;
}

export function memberKindLabel(member: PomMemberManifest) {
  if (member.kind === "component") {
    return `${member.componentClassName}${member.collection ? "[]" : ""} · ${member.access}`;
  }
  return `${member.access} · locator`;
}

/** The registry target path that highlights a member across its class. */
export function memberHighlightPath(
  pomClass: PomClass,
  member: PomMemberManifest
) {
  return `${pomClass.className}.${memberProbePath("", member)}`;
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
