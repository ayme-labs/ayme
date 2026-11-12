# fixture on Playwright 1.62.1: Change Trees by mode

Settle rule: after load, no DOM mutation in any frame for 150 ms, deadline 2000 ms

- gate-a: gate cycles without a recorded action: 0; lags (ms): {"click":{"n":14,"medianMs":14.6,"maxMs":49.3,"pressMedianMs":88},"key":{"n":3,"medianMs":8.5,"maxMs":9.7,"pressMedianMs":0}}
- gate-b: gate cycles without a recorded action: 0; lags (ms): {"click":{"n":14,"medianMs":13.7,"maxMs":17.8,"pressMedianMs":0},"key":{"n":3,"medianMs":9,"maxMs":10.7,"pressMedianMs":0}}

## click Other

### after

```
#1 click  internal:role=button[name="Other"i]  [after-only]
   code: await page.getByRole('button', { name: 'Other' }).click();
   target: in tree ref=e19 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e17] region "Toast":
         - <target> <changed> [ref=e19] button "Other" [active]
         - text: 1
```

### before

```
#1 click  internal:role=button[name="Other"i]  [free-before]
   code: await page.getByRole('button', { name: 'Other' }).click();
   target: in tree ref=e19 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e17] region "Toast":
         - <target> <changed> [ref=e19] button "Other" [active]
         - text: 1
```

### gate-a

```
#1 click  internal:role=button[name="Other"i]  [gate]
   code: await page.getByRole('button', { name: 'Other' }).click();
   target: in tree ref=e19 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e17] region "Toast":
         - <target> <changed> [ref=e19] button "Other" [active]
         - text: 1
```

### gate-b

```
#1 click  internal:role=button[name="Other"i]  [gate]
   code: await page.getByRole('button', { name: 'Other' }).click();
   target: in tree ref=e19 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e17] region "Toast":
         - <changed> [ref=e19] button "Other" [active]
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e17] region "Toast":
         - <target> [ref=e19] button "Other" [active]
         - text: 1
```

## click Load orders (a row arrives 1.5 s later)

### after

```
#2 click  internal:role=button[name="Load orders"i]  [after-only]
   code: await page.getByRole('button', { name: 'Load orders' }).click();
   target: in tree ref=e5 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e4] region "Late data":
         - <target> <changed> [ref=e5] button "Load orders" [active]
         - text: Loading
       - [ref=e17] region "Toast":
         - <changed> [ref=e19] button "Other"
```

### before

```
#2 click  internal:role=button[name="Load orders"i]  [free-before]
   code: await page.getByRole('button', { name: 'Load orders' }).click();
   target: in tree ref=e5 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e4] region "Late data":
         - <target> <changed> [ref=e5] button "Load orders" [active]
         - text: Loading
       - [ref=e17] region "Toast":
         - <changed> [ref=e19] button "Other"
```

### gate-a

```
#2 click  internal:role=button[name="Load orders"i]  [gate]
   code: await page.getByRole('button', { name: 'Load orders' }).click();
   target: in tree ref=e5 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e4] region "Late data":
         - <target> <changed> [ref=e5] button "Load orders" [active]
         - text: Loading
       - [ref=e17] region "Toast":
         - <changed> [ref=e19] button "Other"
```

### gate-b

```
#2 click  internal:role=button[name="Load orders"i]  [gate]
   code: await page.getByRole('button', { name: 'Load orders' }).click();
   target: in tree ref=e5 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e4] region "Late data":
         - <changed> [ref=e5] button "Load orders" [active]
       - [ref=e17] region "Toast":
         - <changed> [ref=e19] button "Other"
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e4] region "Late data":
         - <target> [ref=e5] button "Load orders" [active]
         - text: Loading
```

## click Other again (the late row is on the page by now)

### after

```
#3 click  internal:role=button[name="Other"i]  [after-only]
   code: await page.getByRole('button', { name: 'Other' }).click();
   target: in tree ref=e19 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e4] region "Late data":
         - <changed> [ref=e5] button "Load orders"
         - [ref=e6] table "Orders":
           - [ref=e7] rowgroup:
             - <added> [ref=e39] row:
               - <added> [ref=e40] cell "Order 2"
       - <changed> [ref=e17] region "Toast":
         - <target> <changed> [ref=e19] button "Other" [active]
         - text: 2
```

### before

```
#3 click  internal:role=button[name="Other"i]  [free-before]
   code: await page.getByRole('button', { name: 'Other' }).click();
   target: in tree ref=e19 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - <changed> [ref=e4] region "Late data":
         - [ref=e6] table "Orders":
           - [ref=e7] rowgroup:
             - <added> [ref=e39] row:
               - <added> [ref=e40] cell "Order 2"
   Change Tree:
     - [ref=e2] main:
       - [ref=e4] region "Late data":
         - <changed> [ref=e5] button "Load orders"
       - <changed> [ref=e17] region "Toast":
         - <target> <changed> [ref=e19] button "Other" [active]
         - text: 2
```

### gate-a

```
#3 click  internal:role=button[name="Other"i]  [gate]
   code: await page.getByRole('button', { name: 'Other' }).click();
   target: in tree ref=e19 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - <changed> [ref=e4] region "Late data":
         - [ref=e6] table "Orders":
           - [ref=e7] rowgroup:
             - <added> [ref=e39] row:
               - <added> [ref=e40] cell "Order 2"
   Change Tree:
     - [ref=e2] main:
       - [ref=e4] region "Late data":
         - <changed> [ref=e5] button "Load orders"
       - <changed> [ref=e17] region "Toast":
         - <target> <changed> [ref=e19] button "Other" [active]
         - text: 2
```

### gate-b

```
#3 click  internal:role=button[name="Other"i]  [gate]
   code: await page.getByRole('button', { name: 'Other' }).click();
   target: in tree ref=e19 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - <changed> [ref=e4] region "Late data":
         - <changed> [ref=e5] button "Load orders"
         - [ref=e6] table "Orders":
           - [ref=e7] rowgroup:
             - <added> [ref=e39] row:
               - <added> [ref=e40] cell "Order 2"
       - [ref=e17] region "Toast":
         - <changed> [ref=e19] button "Other" [active]
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e17] region "Toast":
         - <target> [ref=e19] button "Other" [active]
         - text: 2
```

## click Insert task (a lookalike row is inserted by the click)

### after

```
#4 click  internal:role=button[name="Insert task"s]  [after-only]
   code: await page.getByRole('button', { name: 'Insert task', exact: true }).click();
   target: in tree ref=e11 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <target> <changed> [ref=e11] button "Insert task" [active]
         - [ref=e13] list "Tasks":
           - <added> [ref=e41] listitem: Task
       - [ref=e17] region "Toast":
         - <changed> [ref=e19] button "Other"
```

### before

```
#4 click  internal:role=button[name="Insert task"s]  [free-before]
   code: await page.getByRole('button', { name: 'Insert task', exact: true }).click();
   target: in tree ref=e11 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <target> <changed> [ref=e11] button "Insert task" [active]
         - [ref=e13] list "Tasks":
           - <added> [ref=e41] listitem: Task
       - [ref=e17] region "Toast":
         - <changed> [ref=e19] button "Other"
```

### gate-a

```
#4 click  internal:role=button[name="Insert task"s]  [gate]
   code: await page.getByRole('button', { name: 'Insert task', exact: true }).click();
   target: in tree ref=e11 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <target> <changed> [ref=e11] button "Insert task" [active]
         - [ref=e13] list "Tasks":
           - <added> [ref=e41] listitem: Task
       - [ref=e17] region "Toast":
         - <changed> [ref=e19] button "Other"
```

### gate-b

```
#4 click  internal:role=button[name="Insert task"s]  [gate]
   code: await page.getByRole('button', { name: 'Insert task', exact: true }).click();
   target: in tree ref=e11 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <changed> [ref=e11] button "Insert task" [active]
       - [ref=e17] region "Toast":
         - <changed> [ref=e19] button "Other"
   Change Tree:
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <target> [ref=e11] button "Insert task" [active]
         - [ref=e13] list "Tasks":
           - <added> [ref=e41] listitem: Task
```

## click Insert task later (a lookalike row arrives 1.5 s later)

### after

```
#5 click  internal:role=button[name="Insert task later"i]  [after-only]
   code: await page.getByRole('button', { name: 'Insert task later' }).click();
   target: in tree ref=e12 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <changed> [ref=e11] button "Insert task"
         - <target> <changed> [ref=e12] button "Insert task later" [active]
```

### before

```
#5 click  internal:role=button[name="Insert task later"i]  [free-before]
   code: await page.getByRole('button', { name: 'Insert task later' }).click();
   target: in tree ref=e12 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <changed> [ref=e11] button "Insert task"
         - <target> <changed> [ref=e12] button "Insert task later" [active]
```

### gate-a

```
#5 click  internal:role=button[name="Insert task later"i]  [gate]
   code: await page.getByRole('button', { name: 'Insert task later' }).click();
   target: in tree ref=e12 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <changed> [ref=e11] button "Insert task"
         - <target> <changed> [ref=e12] button "Insert task later" [active]
```

### gate-b

```
#5 click  internal:role=button[name="Insert task later"i]  [gate]
   code: await page.getByRole('button', { name: 'Insert task later' }).click();
   target: in tree ref=e12 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <changed> [ref=e11] button "Insert task"
         - <changed> [ref=e12] button "Insert task later" [active]
   Change Tree:
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <target> [ref=e12] button "Insert task later" [active]
```

## click Notify later (a toast appears on its own 1.5 s later)

### after

```
#6 click  internal:role=button[name="Notify later"i]  [after-only]
   code: await page.getByRole('button', { name: 'Notify later' }).click();
   target: in tree ref=e18 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <changed> [ref=e12] button "Insert task later"
         - [ref=e13] list "Tasks":
           - <added> [ref=e42] listitem: Task
       - [ref=e17] region "Toast":
         - <target> <changed> [ref=e18] button "Notify later" [active]
```

### before

```
#6 click  internal:role=button[name="Notify later"i]  [free-before]
   code: await page.getByRole('button', { name: 'Notify later' }).click();
   target: in tree ref=e18 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - [ref=e13] list "Tasks":
           - <added> [ref=e42] listitem: Task
   Change Tree:
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <changed> [ref=e12] button "Insert task later"
       - [ref=e17] region "Toast":
         - <target> <changed> [ref=e18] button "Notify later" [active]
```

### gate-a

```
#6 click  internal:role=button[name="Notify later"i]  [gate]
   code: await page.getByRole('button', { name: 'Notify later' }).click();
   target: in tree ref=e18 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - [ref=e13] list "Tasks":
           - <added> [ref=e42] listitem: Task
   Change Tree:
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <changed> [ref=e12] button "Insert task later"
       - [ref=e17] region "Toast":
         - <target> <changed> [ref=e18] button "Notify later" [active]
```

### gate-b

```
#6 click  internal:role=button[name="Notify later"i]  [gate]
   code: await page.getByRole('button', { name: 'Notify later' }).click();
   target: in tree ref=e18 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e10] region "Lookalike rows":
         - <changed> [ref=e12] button "Insert task later"
         - [ref=e13] list "Tasks":
           - <added> [ref=e42] listitem: Task
       - [ref=e17] region "Toast":
         - <changed> [ref=e18] button "Notify later" [active]
   Change Tree:
     - [ref=e2] main:
       - [ref=e17] region "Toast":
         - <target> [ref=e18] button "Notify later" [active]
```

## click Dismiss in the toast (the click removes the toast)

### after

```
#7 click  internal:role=button[name="Dismiss"i]  [after-only]
   code: await page.getByRole('button', { name: 'Dismiss' }).click();
   target: not resolved in the tree (selector kept)
   Change Tree:
     - [ref=e2] main:
       - [ref=e17] region "Toast":
         - <changed> [ref=e18] button "Notify later"
```

### before

```
#7 click  internal:role=button[name="Dismiss"i]  [free-before]
   code: await page.getByRole('button', { name: 'Dismiss' }).click();
   target: in tree ref=s_62 (via event snapshot)
   changed before the interaction (unassigned):
     - <added> [ref=s_63]:
       - <added> [ref=s_61] status:
         - text: Saved
         - <added> [ref=s_62] button "Dismiss"
   Change Tree:
     - [ref=e2] main:
       - [ref=e17] region "Toast":
         - <changed> [ref=e18] button "Notify later"
     - <removed> [ref=s_63]:
       - <removed> [ref=s_61] status:
         - text: Saved
         - <target> <removed> [ref=s_62] button "Dismiss"
```

### gate-a

```
#7 click  internal:role=button[name="Dismiss"i]  [gate]
   code: await page.getByRole('button', { name: 'Dismiss' }).click();
   target: in tree ref=e44 (via event snapshot)
   changed before the interaction (unassigned):
     - <added> [ref=e1]:
       - <added> [ref=e43] status:
         - text: Saved
         - <added> [ref=e44] button "Dismiss"
   Change Tree:
     - [ref=e2] main:
       - [ref=e17] region "Toast":
         - <changed> [ref=e18] button "Notify later"
     - <removed> [ref=e1]:
       - <removed> [ref=e43] status:
         - text: Saved
         - <target> <removed> [ref=e44] button "Dismiss"
```

### gate-b

```
#7 click  internal:role=button[name="Dismiss"i]  [gate]
   code: await page.getByRole('button', { name: 'Dismiss' }).click();
   target: in tree ref=e44 (via event snapshot)
   changed before the interaction (unassigned):
     - <added> [ref=e1]:
       - [ref=e2] main:
         - [ref=e17] region "Toast":
           - <changed> [ref=e18] button "Notify later"
       - <added> [ref=e43] status:
         - text: Saved
         - <added> [ref=e44] button "Dismiss" [active]
   Change Tree:
     - <removed> [ref=e1]:
       - <removed> [ref=e43] status:
         - text: Saved
         - <target> <removed> [ref=e44] button "Dismiss" [active]
```

## click the Name field

### after

```
#8 click  internal:role=textbox[name="Name"i]  [after-only]
   code: await page.getByRole('textbox', { name: 'Name' }).click();
   target: in tree ref=e23 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> <changed> [ref=e23] textbox "Name" [active]
```

### before

```
#8 click  internal:role=textbox[name="Name"i]  [free-before]
   code: await page.getByRole('textbox', { name: 'Name' }).click();
   target: in tree ref=e23 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> <changed> [ref=e23] textbox "Name" [active]
```

### gate-a

```
#8 click  internal:role=textbox[name="Name"i]  [gate]
   code: await page.getByRole('textbox', { name: 'Name' }).click();
   target: in tree ref=e23 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> <changed> [ref=e23] textbox "Name" [active]
```

### gate-b

```
#8 click  internal:role=textbox[name="Name"i]  [gate]
   code: await page.getByRole('textbox', { name: 'Name' }).click();
   target: in tree ref=e23 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <changed> [ref=e23] textbox "Name" [active]
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> [ref=e23] textbox "Name" [active]
```

## type Ada

### after

```
#9 fill "Ada"  internal:role=textbox[name="Name"i]  [after-only]
   code: await page.getByRole('textbox', { name: 'Name' }).fill('Ada');
   target: in tree ref=e23 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> <changed> [ref=e23] textbox "Name" [active]: Ada
```

### before

```
#9 fill "Ada"  internal:role=textbox[name="Name"i]  [free-before]
   code: await page.getByRole('textbox', { name: 'Name' }).fill('Ada');
   target: in tree ref=e23 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> <changed> [ref=e23] textbox "Name" [active]: Ada
```

### gate-a

```
#9 fill "Ada"  internal:role=textbox[name="Name"i]  [free-before]
   code: await page.getByRole('textbox', { name: 'Name' }).fill('Ada');
   target: in tree ref=e23 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> <changed> [ref=e23] textbox "Name" [active]: Ada
```

### gate-b

```
#9 fill "Ada"  internal:role=textbox[name="Name"i]  [free-before]
   code: await page.getByRole('textbox', { name: 'Name' }).fill('Ada');
   target: in tree ref=e23 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> <changed> [ref=e23] textbox "Name" [active]: Ada
```

## press Enter (submits the form)

### after

```
#10 press Enter  internal:role=textbox[name="Name"i]  [after-only]
   code: await page.getByRole('textbox', { name: 'Name' }).press('Enter');
   target: in tree ref=e23 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> [ref=e23] textbox "Name" [active]: Ada
         - <added> [ref=e43] paragraph: "Hello, Ada"
         - <removed> [ref=s_45] paragraph
```

### before

```
#10 press Enter  internal:role=textbox[name="Name"i]  [free-before]
   code: await page.getByRole('textbox', { name: 'Name' }).press('Enter');
   target: in tree ref=e23 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> [ref=e23] textbox "Name" [active]: Ada
         - <added> [ref=e43] paragraph: "Hello, Ada"
         - <removed> [ref=s_88] paragraph
```

### gate-a

```
#10 press Enter  internal:role=textbox[name="Name"i]  [gate]
   code: await page.getByRole('textbox', { name: 'Name' }).press('Enter');
   target: in tree ref=e23 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> [ref=e23] textbox "Name" [active]: Ada
         - <added> [ref=e45] paragraph: "Hello, Ada"
         - <removed> [ref=s_167] paragraph
```

### gate-b

```
#10 press Enter  internal:role=textbox[name="Name"i]  [gate]
   code: await page.getByRole('textbox', { name: 'Name' }).press('Enter');
   target: in tree ref=e23 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> [ref=e23] textbox "Name" [active]: Ada
         - <added> [ref=e45] paragraph: "Hello, Ada"
         - <removed> [ref=s_167] paragraph
```

## click the Subscribe checkbox

### after

```
#11 check  internal:role=checkbox[name="Subscribe"i]  [after-only]
   code: await page.getByRole('checkbox', { name: 'Subscribe' }).check();
   target: in tree ref=e25 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e20] region "Form":
         - [ref=e22]:
           - <changed> [ref=e23] textbox "Name": Ada
         - [ref=e24]:
           - <target> <changed> [ref=e25] checkbox "Subscribe" [checked] [active]
         - text: subscribed
         - text: "Color: red"
```

### before

```
#11 check  internal:role=checkbox[name="Subscribe"i]  [free-before]
   code: await page.getByRole('checkbox', { name: 'Subscribe' }).check();
   target: in tree ref=e25 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e20] region "Form":
         - [ref=e22]:
           - <changed> [ref=e23] textbox "Name": Ada
         - [ref=e24]:
           - <target> <changed> [ref=e25] checkbox "Subscribe" [checked] [active]
         - text: subscribed
         - text: "Color: red"
```

### gate-a

```
#11 check  internal:role=checkbox[name="Subscribe"i]  [gate]
   code: await page.getByRole('checkbox', { name: 'Subscribe' }).check();
   target: in tree ref=e25 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e20] region "Form":
         - [ref=e22]:
           - <changed> [ref=e23] textbox "Name": Ada
         - [ref=e24]:
           - <target> <changed> [ref=e25] checkbox "Subscribe" [checked] [active]
         - text: subscribed
         - text: "Color: red"
```

### gate-b

```
#11 check  internal:role=checkbox[name="Subscribe"i]  [gate]
   code: await page.getByRole('checkbox', { name: 'Subscribe' }).check();
   target: in tree ref=e25 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <changed> [ref=e23] textbox "Name": Ada
         - [ref=e24]:
           - <changed> [ref=e25] checkbox "Subscribe" [active]
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e20] region "Form":
         - [ref=e24]:
           - <target> <changed> [ref=e25] checkbox "Subscribe" [checked] [active]
         - text: subscribed
         - text: "Color: red"
```

## choose green in the native select

### after

```
#12 press g  internal:label="Color redgreenblue"i  [after-only]
   code: await page.getByLabel('Color redgreenblue').press('g');
   target: in tree ref=e27 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e20] region "Form":
         - [ref=e24]:
           - <changed> [ref=e25] checkbox "Subscribe" [checked]
         - text: subscribed
         - [ref=e26]:
           - <target> <changed> [ref=e27] combobox "Color" [active]:
             - <changed> [ref=s_52] option "red"
             - <changed> [ref=s_53] option "green" [selected]
         - text: "Color: green"
#13 select ["green"]  internal:label="Color redgreenblue"i  [after-only]
   code: await page.getByLabel('Color redgreenblue').selectOption('green');
   target: in tree ref=e27 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e26]:
           - <target> [ref=e27] combobox "Color" [active]
```

### before

```
#12 press g  internal:label="Color redgreenblue"i  [free-before]
   code: await page.getByLabel('Color redgreenblue').press('g');
   target: in tree ref=e27 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e20] region "Form":
         - [ref=e24]:
           - <changed> [ref=e25] checkbox "Subscribe" [checked]
         - text: subscribed
         - [ref=e26]:
           - <target> <changed> [ref=e27] combobox "Color" [active]:
             - <changed> [ref=s_103] option "red"
             - <changed> [ref=s_104] option "green" [selected]
         - text: "Color: green"
#13 select ["green"]  internal:label="Color redgreenblue"i  [free-before]
   code: await page.getByLabel('Color redgreenblue').selectOption('green');
   target: in tree ref=e27 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e26]:
           - <target> [ref=e27] combobox "Color" [active]
```

### gate-a

```
#12 press g  internal:label="Color redgreenblue"i  [gate]
   code: await page.getByLabel('Color redgreenblue').press('g');
   target: in tree ref=e27 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e24]:
           - <changed> [ref=e25] checkbox "Subscribe" [checked]
         - [ref=e26]:
           - <changed> [ref=e27] combobox "Color" [active]
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e20] region "Form":
         - text: subscribed
         - [ref=e26]:
           - <target> [ref=e27] combobox "Color" [active]:
             - <changed> [ref=s_187] option "red"
             - <changed> [ref=s_188] option "green" [selected]
         - text: "Color: green"
#13 select ["green"]  internal:label="Color redgreenblue"i  [free-before]
   code: await page.getByLabel('Color redgreenblue').selectOption('green');
   target: in tree ref=e27 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e26]:
           - <target> [ref=e27] combobox "Color" [active]
```

### gate-b

```
#12 press g  internal:label="Color redgreenblue"i  [gate]
   code: await page.getByLabel('Color redgreenblue').press('g');
   target: in tree ref=e27 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e24]:
           - <changed> [ref=e25] checkbox "Subscribe" [checked]
         - [ref=e26]:
           - <changed> [ref=e27] combobox "Color" [active]
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e20] region "Form":
         - text: subscribed
         - [ref=e26]:
           - <target> [ref=e27] combobox "Color" [active]:
             - <changed> [ref=s_187] option "red"
             - <changed> [ref=s_188] option "green" [selected]
         - text: "Color: green"
#13 select ["green"]  internal:label="Color redgreenblue"i  [free-before]
   code: await page.getByLabel('Color redgreenblue').selectOption('green');
   target: in tree ref=e27 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e26]:
           - <target> [ref=e27] combobox "Color" [active]
```

## click Menu (the menu opens on pointerdown)

### after

```
#14 click  internal:role=button[name="Menu"i]  [after-only]
   code: await page.getByRole('button', { name: 'Menu' }).click();
   target: in tree ref=e29 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e26]:
           - <changed> [ref=e27] combobox "Color"
       - [ref=e28] region "Pointerdown menu":
         - <target> <changed> [ref=e29] button "Menu" [active]
         - <added> [ref=e44] menu:
           - <added> [ref=e45] menuitem "Rename"
```

### before

```
#14 click  internal:role=button[name="Menu"i]  [free-before]
   code: await page.getByRole('button', { name: 'Menu' }).click();
   target: in tree ref=e29 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e28] region "Pointerdown menu":
         - <added> [ref=e44] menu:
           - <added> [ref=e45] menuitem "Rename"
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e26]:
           - <changed> [ref=e27] combobox "Color"
       - [ref=e28] region "Pointerdown menu":
         - <target> <changed> [ref=e29] button "Menu" [active]
```

### gate-a

```
#14 click  internal:role=button[name="Menu"i]  [gate]
   code: await page.getByRole('button', { name: 'Menu' }).click();
   target: in tree ref=e29 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e26]:
           - <changed> [ref=e27] combobox "Color"
       - [ref=e28] region "Pointerdown menu":
         - <target> <changed> [ref=e29] button "Menu" [active]
         - <added> [ref=e46] menu:
           - <added> [ref=e47] menuitem "Rename"
```

### gate-b

```
#14 click  internal:role=button[name="Menu"i]  [gate]
   code: await page.getByRole('button', { name: 'Menu' }).click();
   target: in tree ref=e29 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e26]:
           - <changed> [ref=e27] combobox "Color"
       - [ref=e28] region "Pointerdown menu":
         - <changed> [ref=e29] button "Menu" [active]
         - <added> [ref=e46] menu:
           - <added> [ref=e47] menuitem "Rename"
   Change Tree:
     - [ref=e2] main:
       - [ref=e28] region "Pointerdown menu":
         - <target> [ref=e29] button "Menu" [active]
```

## click Rename in the menu

### after

```
#15 click  internal:role=menuitem[name="Rename"i]  [after-only]
   code: await page.getByRole('menuitem', { name: 'Rename' }).click();
   target: not resolved in the tree (selector kept)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e28] region "Pointerdown menu":
         - <changed> [ref=e29] button "Menu"
         - text: renamed
         - <removed> [ref=e44] menu:
           - <removed> [ref=e45] menuitem "Rename"
```

### before

```
#15 click  internal:role=menuitem[name="Rename"i]  [free-before]
   code: await page.getByRole('menuitem', { name: 'Rename' }).click();
   target: in tree ref=e45 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e28] region "Pointerdown menu":
         - <changed> [ref=e29] button "Menu"
         - text: renamed
         - <removed> [ref=e44] menu:
           - <target> <removed> [ref=e45] menuitem "Rename"
```

### gate-a

```
#15 click  internal:role=menuitem[name="Rename"i]  [gate]
   code: await page.getByRole('menuitem', { name: 'Rename' }).click();
   target: in tree ref=e47 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e28] region "Pointerdown menu":
         - <changed> [ref=e29] button "Menu"
         - text: renamed
         - <removed> [ref=e46] menu:
           - <target> <removed> [ref=e47] menuitem "Rename"
```

### gate-b

```
#15 click  internal:role=menuitem[name="Rename"i]  [gate]
   code: await page.getByRole('menuitem', { name: 'Rename' }).click();
   target: in tree ref=e47 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e28] region "Pointerdown menu":
         - <changed> [ref=e29] button "Menu"
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e28] region "Pointerdown menu":
         - text: renamed
         - <removed> [ref=e46] menu:
           - <target> <removed> [ref=e47] menuitem "Rename"
```

## click the cart (the target is not in the tree)

### after

```
#16 click  [data-test="cart-link"]  [after-only]
   code: await page.locator('[data-test="cart-link"]').click();
   target: NOT in tree, marked on nearest ancestor ref=e30 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - <target-inside> [ref=e30] region "Missing target":
         - <changed> [ref=e33] paragraph: cart open
```

### before

```
#16 click  [data-test="cart-link"]  [free-before]
   code: await page.locator('[data-test="cart-link"]').click();
   target: NOT in tree, marked on nearest ancestor ref=e30 (via event snapshot, nearest ancestor at the moment of the action)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - <target-inside> [ref=e30] region "Missing target":
         - <changed> [ref=e33] paragraph: cart open
```

### gate-a

```
#16 click  [data-test="cart-link"]  [gate]
   code: await page.locator('[data-test="cart-link"]').click();
   target: NOT in tree, marked on nearest ancestor ref=e30 (via event snapshot, nearest ancestor at the moment of the action)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - <target-inside> [ref=e30] region "Missing target":
         - <changed> [ref=e33] paragraph: cart open
```

### gate-b

```
#16 click  [data-test="cart-link"]  [gate]
   code: await page.locator('[data-test="cart-link"]').click();
   target: NOT in tree, marked on nearest ancestor ref=e30 (via event snapshot, nearest ancestor at the moment of the action)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - <target-inside> [ref=e30] region "Missing target":
         - <changed> [ref=e33] paragraph: cart open
```

## click the button in the open shadow root

### after

```
#17 click  internal:role=button[name="Shadow button"i]  [after-only]
   code: await page.getByRole('button', { name: 'Shadow button' }).click();
   target: in tree ref=e36 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - [ref=e34] region "Shadow":
         - <changed> [ref=e35] [active]:
           - <target> [ref=e36] button "Shadow button"
           - text: 1
```

### before

```
#17 click  internal:role=button[name="Shadow button"i]  [free-before]
   code: await page.getByRole('button', { name: 'Shadow button' }).click();
   target: in tree ref=e36 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e34] region "Shadow":
         - <changed> [ref=e35] [active]:
           - <target> [ref=e36] button "Shadow button"
           - text: 1
```

### gate-a

```
#17 click  internal:role=button[name="Shadow button"i]  [gate]
   code: await page.getByRole('button', { name: 'Shadow button' }).click();
   target: in tree ref=e36 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e34] region "Shadow":
         - <changed> [ref=e35] [active]:
           - <target> [ref=e36] button "Shadow button"
           - text: 1
```

### gate-b

```
#17 click  internal:role=button[name="Shadow button"i]  [gate]
   code: await page.getByRole('button', { name: 'Shadow button' }).click();
   target: in tree ref=e36 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e34] region "Shadow":
         - <changed> [ref=e35] [active]: 0
   Change Tree:
     - [ref=e2] main:
       - [ref=e34] region "Shadow":
         - <changed> [ref=e35] [active]:
           - <target> [ref=e36] button "Shadow button"
           - text: 1
```

## click the button in the iframe

### after

```
#18 click  iframe[title="Inner frame"] >> internal:control=enter-frame >> internal:role=button[name="Inner button"i]  [after-only]
   code: await page.locator('iframe[title="Inner frame"]').contentFrame().getByRole('button', { name: 'Inner button' }).click();
   target: in tree ref=f1e2 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - [ref=e34] region "Shadow":
         - <changed> [ref=e35]: 1
       - [ref=e37] region "Frame":
         - <changed> [ref=e38] iframe [active]:
           - <changed> [ref=f1e1]:
             - <target> <changed> [ref=f1e2] button "Inner button" [active]
             - text: 1
```

### before

```
#18 click  iframe[title="Inner frame"] >> internal:control=enter-frame >> internal:role=button[name="Inner button"i]  [free-before]
   code: await page.locator('iframe[title="Inner frame"]').contentFrame().getByRole('button', { name: 'Inner button' }).click();
   target: in tree ref=f1e2 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e34] region "Shadow":
         - <changed> [ref=e35]: 1
       - [ref=e37] region "Frame":
         - <changed> [ref=e38] iframe [active]:
           - <changed> [ref=f1e1]:
             - <target> <changed> [ref=f1e2] button "Inner button" [active]
             - text: 1
```

### gate-a

```
#18 click  iframe[title="Inner frame"] >> internal:control=enter-frame >> internal:role=button[name="Inner button"i]  [gate]
   code: await page.locator('iframe[title="Inner frame"]').contentFrame().getByRole('button', { name: 'Inner button' }).click();
   target: in tree ref=f1e2 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e34] region "Shadow":
         - <changed> [ref=e35]: 1
       - [ref=e37] region "Frame":
         - <changed> [ref=e38] iframe [active]:
           - <changed> [ref=f1e1]:
             - <target> <changed> [ref=f1e2] button "Inner button" [active]
             - text: 1
```

### gate-b

```
#18 click  iframe[title="Inner frame"] >> internal:control=enter-frame >> internal:role=button[name="Inner button"i]  [gate]
   code: await page.locator('iframe[title="Inner frame"]').contentFrame().getByRole('button', { name: 'Inner button' }).click();
   target: in tree ref=f1e2 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e34] region "Shadow":
         - <changed> [ref=e35]: 1
       - [ref=e37] region "Frame":
         - <changed> [ref=e38] iframe [active]:
           - [ref=f1e1]:
             - <changed> [ref=f1e2] button "Inner button" [active]
   Change Tree:
     - [ref=e2] main:
       - [ref=e37] region "Frame":
         - [ref=e38] iframe [active]:
           - <changed> [ref=f1e1]:
             - <target> [ref=f1e2] button "Inner button" [active]
             - text: 1
```

## press Tab in the iframe

### after

```
#19 press Tab  iframe[title="Inner frame"] >> internal:control=enter-frame >> internal:role=button[name="Inner button"i]  [after-only]
   code: await page.locator('iframe[title="Inner frame"]').contentFrame().getByRole('button', { name: 'Inner button' }).press('Tab');
   target: in tree ref=f1e2 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - [ref=e37] region "Frame":
         - <changed> [ref=e38] iframe:
           - [ref=f1e1]:
             - <target> <changed> [ref=f1e2] button "Inner button"
```

### before

```
#19 press Tab  iframe[title="Inner frame"] >> internal:control=enter-frame >> internal:role=button[name="Inner button"i]  [free-before]
   code: await page.locator('iframe[title="Inner frame"]').contentFrame().getByRole('button', { name: 'Inner button' }).press('Tab');
   target: in tree ref=f1e2 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e37] region "Frame":
         - <changed> [ref=e38] iframe:
           - [ref=f1e1]:
             - <target> <changed> [ref=f1e2] button "Inner button"
```

### gate-a

```
#19 press Tab  iframe[title="Inner frame"] >> internal:control=enter-frame >> internal:role=button[name="Inner button"i]  [gate]
   code: await page.locator('iframe[title="Inner frame"]').contentFrame().getByRole('button', { name: 'Inner button' }).press('Tab');
   target: in tree ref=f1e2 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e37] region "Frame":
         - <changed> [ref=e38] iframe:
           - [ref=f1e1]:
             - <target> <changed> [ref=f1e2] button "Inner button"
```

### gate-b

```
#19 press Tab  iframe[title="Inner frame"] >> internal:control=enter-frame >> internal:role=button[name="Inner button"i]  [gate]
   code: await page.locator('iframe[title="Inner frame"]').contentFrame().getByRole('button', { name: 'Inner button' }).press('Tab');
   target: in tree ref=f1e2 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e2] main:
       - [ref=e37] region "Frame":
         - <changed> [ref=e38] iframe:
           - [ref=f1e1]:
             - <target> <changed> [ref=f1e2] button "Inner button"
```
