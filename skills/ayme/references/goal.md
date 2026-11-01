# Goal

To use `goal`, pass every value the task names in `values`, each labelled in
plain words, such as `{ "survey name": "Q4 Feedback" }`. The Goal Loop takes
free text only from `values`; when a step needs text you did not pass, it hands
back with `needs_value`.

Every run ends in a
[Handover](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/goals-with-jev.md#the-handover):
follow its `next`, and when it names a tool in `needs`, finish with that tool.

When `goal` hands over with `needs_value` because none of a parameter's
allowed values belongs in it, the loop offered that parameter only its
allowed values, so a Goal Value of a type it does not take changes nothing.
Call the tool named in `needs` yourself with the value, or call `goal` again
with a goal that names it.
