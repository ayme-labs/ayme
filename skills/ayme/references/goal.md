# Goal

Pass the goal in words, and every value the task names in `values`. Label
each value in plain words. A value is a string or a number. Example:
`ProjectsPage` has an action `createProject(name)`.

```
goal({
  goal: "Create a project named Website relaunch",
  maxSteps: 5,
  values: { "project name": "Website relaunch" },
})
```

`goal` never makes up text. A parameter without fixed values gets only a
value you pass in `values`.

Every run ends in a
[Handover](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/goals-with-jev.md#the-handover).
Read its `next` and do what it says. Without `values`, the run above hands
over:

```
{
  reason: "needs_value",
  next: 'The operation "ProjectsPage.createProject" needs values for: name, and no Goal Value fits name. Call goal again with a value for name in values, or call ProjectsPage.createProject directly.',
  history: [],
  needs: { tool: "ProjectsPage.createProject", parameters: ["name"] },
}
```

When `needs` names a tool, finish with that tool:
`ProjectsPage.createProject({ name: "Website relaunch" })`. Or call `goal`
again with the value in `values`.

Some parameters take only fixed values. Example: `ProjectsPage` also has an
action `filter(status: ("active" | "archived")[])`, and the goal was "Filter
the projects". When none of the statuses fits, `goal` hands over:

```
{
  reason: "needs_value",
  next: 'The operation "ProjectsPage.filter" needs a value for "status", and the model judged that none of its allowed values belongs in it.',
  history: [],
  needs: { tool: "ProjectsPage.filter", parameters: ["status"] },
}
```

Pick the value yourself and call the tool:
`ProjectsPage.filter({ status: ["archived"] })`. Or call `goal` again with a
goal that names the value, such as "Show the archived projects". Adding a
Goal Value of a type the parameter does not take changes nothing. The loop
offers this parameter only its allowed values.
