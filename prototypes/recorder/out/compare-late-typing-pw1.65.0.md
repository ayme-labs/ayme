# late-typing on Playwright 1.65.0: Change Trees by mode

Settle rule: after load, no DOM mutation in any frame for 150 ms, deadline 2000 ms

- gate-b: gate cycles without a recorded action: 0; lags (ms): {"click":{"n":2,"medianMs":82.2,"maxMs":82.2,"pressMedianMs":0}}

## click Load orders (a row arrives 1.5 s later)

### after

```
#1 click  internal:role=button[name="Load orders"i]  [after-only]
   code: await page.getByRole('button', { name: 'Load orders' }).click();
   target: in tree ref=e5 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e4] region "Late data":
         - <target> <changed> [ref=e5] button "Load orders" [active]
         - text: Loading
```

### gate-b

```
#1 click  internal:role=button[name="Load orders"i]  [gate]
   code: await page.getByRole('button', { name: 'Load orders' }).click();
   target: in tree ref=e5 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e4] region "Late data":
         - <changed> [ref=e5] button "Load orders" [active]
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e4] region "Late data":
         - <target> [ref=e5] button "Load orders" [active]
         - text: Loading
```

## click the Name field (before the row arrives)

### after

```
#2 click  internal:role=textbox[name="Name"i]  [after-only]
   code: await page.getByRole('textbox', { name: 'Name' }).click();
   target: in tree ref=e23 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - <changed> [ref=e4] region "Late data":
         - <changed> [ref=e5] button "Load orders"
         - [ref=e6] table "Orders":
           - [ref=e7] rowgroup:
             - <added> [ref=e39] row:
               - <added> [ref=e40] cell "Order 2"
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> <changed> [ref=e23] textbox "Name" [active]
```

### gate-b

```
#2 click  internal:role=textbox[name="Name"i]  [gate]
   code: await page.getByRole('textbox', { name: 'Name' }).click();
   target: in tree ref=e23 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - [ref=e4] region "Late data":
         - <changed> [ref=e5] button "Load orders"
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <changed> [ref=e23] textbox "Name" [active]
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> [ref=e23] textbox "Name" [active]
```

## type Ada (the late row is on the page by now)

### after

```
#3 fill "Ada"  internal:role=textbox[name="Name"i]  [after-only]
   code: await page.getByRole('textbox', { name: 'Name' }).fill('Ada');
   target: in tree ref=e23 (via ancestor walk)
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> <changed> [ref=e23] textbox "Name" [active]: Ada
```

### gate-b

```
#3 fill "Ada"  internal:role=textbox[name="Name"i]  [free-before]
   code: await page.getByRole('textbox', { name: 'Name' }).fill('Ada');
   target: in tree ref=e23 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e2] main:
       - <changed> [ref=e4] region "Late data":
         - [ref=e6] table "Orders":
           - [ref=e7] rowgroup:
             - <added> [ref=e39] row:
               - <added> [ref=e40] cell "Order 2"
   Change Tree:
     - [ref=e2] main:
       - [ref=e20] region "Form":
         - [ref=e22]:
           - <target> <changed> [ref=e23] textbox "Name" [active]: Ada
```
