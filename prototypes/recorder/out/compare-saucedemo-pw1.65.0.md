# saucedemo on Playwright 1.65.0: Change Trees by mode

Settle rule: after load, no DOM mutation in any frame for 150 ms, deadline 2000 ms

- gate-a: gate cycles without a recorded action: 0; lags (ms): {"click":{"n":5,"medianMs":16.3,"maxMs":26.4,"pressMedianMs":90.8}}
- gate-b: gate cycles without a recorded action: 0; lags (ms): {"click":{"n":5,"medianMs":10.2,"maxMs":15.9,"pressMedianMs":0}}

## click Username

### after

```
#0 navigate    [none]
   code: await page.goto('https://www.saucedemo.com/');
#1 click  [data-test="username"]  [after-only]
   code: await page.locator('[data-test="username"]').click();
   target: in tree ref=e11 (via ancestor walk)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <target> <changed> [ref=e11] textbox "Username" [active]
```

### before

```
#0 navigate    [none]
   code: await page.goto('https://www.saucedemo.com/');
#1 click  [data-test="username"]  [free-before]
   code: await page.locator('[data-test="username"]').click();
   target: in tree ref=e11 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <target> <changed> [ref=e11] textbox "Username" [active]
```

### gate-a

```
#0 navigate    [none]
   code: await page.goto('https://www.saucedemo.com/');
#1 click  [data-test="username"]  [gate]
   code: await page.locator('[data-test="username"]').click();
   target: in tree ref=e11 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <target> <changed> [ref=e11] textbox "Username" [active]
```

### gate-b

```
#0 navigate    [none]
   code: await page.goto('https://www.saucedemo.com/');
#1 click  [data-test="username"]  [gate]
   code: await page.locator('[data-test="username"]').click();
   target: in tree ref=e11 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <changed> [ref=e11] textbox "Username" [active]
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <target> [ref=e11] textbox "Username" [active]
```

## type standard_user

### after

```
#2 fill "standard_user"  [data-test="username"]  [after-only]
   code: await page.locator('[data-test="username"]').fill('standard_user');
   target: in tree ref=e11 (via ancestor walk)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <target> <changed> [ref=e11] textbox "Username" [active]: standard_user
```

### before

```
#2 fill "standard_user"  [data-test="username"]  [free-before]
   code: await page.locator('[data-test="username"]').fill('standard_user');
   target: in tree ref=e11 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <target> <changed> [ref=e11] textbox "Username" [active]: standard_user
```

### gate-a

```
#2 fill "standard_user"  [data-test="username"]  [free-before]
   code: await page.locator('[data-test="username"]').fill('standard_user');
   target: in tree ref=e11 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <target> <changed> [ref=e11] textbox "Username" [active]: standard_user
```

### gate-b

```
#2 fill "standard_user"  [data-test="username"]  [free-before]
   code: await page.locator('[data-test="username"]').fill('standard_user');
   target: in tree ref=e11 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <target> <changed> [ref=e11] textbox "Username" [active]: standard_user
```

## click Password

### after

```
#3 click  [data-test="password"]  [after-only]
   code: await page.locator('[data-test="password"]').click();
   target: in tree ref=e13 (via ancestor walk)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <changed> [ref=e11] textbox "Username": standard_user
           - <target> <changed> [ref=e13] textbox "Password" [active]
```

### before

```
#3 click  [data-test="password"]  [free-before]
   code: await page.locator('[data-test="password"]').click();
   target: in tree ref=e13 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <changed> [ref=e11] textbox "Username": standard_user
           - <target> <changed> [ref=e13] textbox "Password" [active]
```

### gate-a

```
#3 click  [data-test="password"]  [gate]
   code: await page.locator('[data-test="password"]').click();
   target: in tree ref=e13 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <changed> [ref=e11] textbox "Username": standard_user
           - <target> <changed> [ref=e13] textbox "Password" [active]
```

### gate-b

```
#3 click  [data-test="password"]  [gate]
   code: await page.locator('[data-test="password"]').click();
   target: in tree ref=e13 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <changed> [ref=e11] textbox "Username": standard_user
           - <changed> [ref=e13] textbox "Password" [active]
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <target> [ref=e13] textbox "Password" [active]
```

## type secret_sauce

### after

```
#4 fill "secret_sauce"  [data-test="password"]  [after-only]
   code: await page.locator('[data-test="password"]').fill('secret_sauce');
   target: in tree ref=e13 (via ancestor walk)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <target> <changed> [ref=e13] textbox "Password" [active]: secret_sauce
```

### before

```
#4 fill "secret_sauce"  [data-test="password"]  [free-before]
   code: await page.locator('[data-test="password"]').fill('secret_sauce');
   target: in tree ref=e13 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <target> <changed> [ref=e13] textbox "Password" [active]: secret_sauce
```

### gate-a

```
#4 fill "secret_sauce"  [data-test="password"]  [free-before]
   code: await page.locator('[data-test="password"]').fill('secret_sauce');
   target: in tree ref=e13 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <target> <changed> [ref=e13] textbox "Password" [active]: secret_sauce
```

### gate-b

```
#4 fill "secret_sauce"  [data-test="password"]  [free-before]
   code: await page.locator('[data-test="password"]').fill('secret_sauce');
   target: in tree ref=e13 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <target> <changed> [ref=e13] textbox "Password" [active]: secret_sauce
```

## click Login

### after

```
#5 click  [data-test="login-button"]  [after-only]
   code: await page.locator('[data-test="login-button"]').click();
   navigated to: https://www.saucedemo.com/inventory.html
   target: not resolved in the tree (selector kept)
   Change Tree:
     - [ref=e22]:
       - <added> [ref=e23]:
         - <added> [ref=e24] banner:
           - <added> [ref=e25]:
             - <added> [ref=e26]:
               - <added> [ref=e27] button "Open Menu" [cursor=pointer]
               - <added> [ref=e28] img "Open Menu"
             - <added> [ref=e29]: Swag Labs
             - <added> [ref=e32] button "Cart, empty"
           - <added> [ref=e33]:
             - <added> [ref=e34]: Products
             - <added> [ref=e36] [cursor=pointer]:
               - <added> [ref=e37]: Name (A to Z)
               - <added> [ref=e38] combobox "Sort products":
                 - <added> [ref=s_1] option "Name (A to Z)" [selected]
                 - <added> [ref=s_2] option "Name (Z to A)"
                 - <added> [ref=s_3] option "Price (low to high)"
                 - <added> [ref=s_4] option "Price (high to low)"
         - <added> [ref=e39] main:
           - <added> [ref=e42]:
             - <added> [ref=e43]:
               - <added> [ref=e45] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                 - <added> [ref=e46] img "Sauce Labs Backpack"
               - <added> [ref=e47]:
                 - <added> [ref=e48]:
                   - <added> [ref=e49] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                     - <added> [ref=e50]: Sauce Labs Backpack
                   - <added> [ref=e51]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
                 - <added> [ref=e52]:
                   - <added> [ref=e53]: $29.99
                   - <added> [ref=e54] button "Add to cart" [cursor=pointer]
             - <added> [ref=e55]:
               - <added> [ref=e57] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                 - <added> [ref=e58] img "Sauce Labs Bike Light"
               - <added> [ref=e59]:
                 - <added> [ref=e60]:
                   - <added> [ref=e61] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                     - <added> [ref=e62]: Sauce Labs Bike Light
                   - <added> [ref=e63]: "A red light isn't the desired state in testing but it sure helps when riding your bike at night. Water-resistant with 3 lighting modes, 1 AAA battery included."
                 - <added> [ref=e64]:
                   - <added> [ref=e65]: $9.99
                   - <added> [ref=e66] button "Add to cart" [cursor=pointer]
             - <added> [ref=e67]:
               - <added> [ref=e69] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                 - <added> [ref=e70] img "Sauce Labs Bolt T-Shirt"
               - <added> [ref=e71]:
                 - <added> [ref=e72]:
                   - <added> [ref=e73] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                     - <added> [ref=e74]: Sauce Labs Bolt T-Shirt
                   - <added> [ref=e75]: "Get your testing superhero on with the Sauce Labs bolt T-shirt. From American Apparel, 100% ringspun combed cotton, heather gray with red bolt."
                 - <added> [ref=e76]:
                   - <added> [ref=e77]: $15.99
                   - <added> [ref=e78] button "Add to cart" [cursor=pointer]
             - <added> [ref=e79]:
               - <added> [ref=e81] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                 - <added> [ref=e82] img "Sauce Labs Fleece Jacket"
               - <added> [ref=e83]:
                 - <added> [ref=e84]:
                   - <added> [ref=e85] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                     - <added> [ref=e86]: Sauce Labs Fleece Jacket
                   - <added> [ref=e87]: "It's not every day that you come across a midweight quarter-zip fleece jacket capable of handling everything from a relaxing day outdoors to a busy day at the office."
                 - <added> [ref=e88]:
                   - <added> [ref=e89]: $49.99
                   - <added> [ref=e90] button "Add to cart" [cursor=pointer]
             - <added> [ref=e91]:
               - <added> [ref=e93] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                 - <added> [ref=e94] img "Sauce Labs Onesie"
               - <added> [ref=e95]:
                 - <added> [ref=e96]:
                   - <added> [ref=e97] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                     - <added> [ref=e98]: Sauce Labs Onesie
                   - <added> [ref=e99]: "Rib snap infant onesie for the junior automation engineer in development. Reinforced 3-snap bottom closure, two-needle hemmed sleeved and bottom won't unravel."
                 - <added> [ref=e100]:
                   - <added> [ref=e101]: $7.99
                   - <added> [ref=e102] button "Add to cart" [cursor=pointer]
             - <added> [ref=e103]:
               - <added> [ref=e105] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                 - <added> [ref=e106] img "Test.allTheThings() T-Shirt (Red)"
               - <added> [ref=e107]:
                 - <added> [ref=e108]:
                   - <added> [ref=e109] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                     - <added> [ref=e110]: Test.allTheThings() T-Shirt (Red)
                   - <added> [ref=e111]: This classic Sauce Labs t-shirt is perfect to wear when cozying up to your keyboard to automate a few tests. Super-soft and comfy ringspun combed cotton.
                 - <added> [ref=e112]:
                   - <added> [ref=e113]: $15.99
                   - <added> [ref=e114] button "Add to cart" [cursor=pointer]
       - <added> [ref=e115] contentinfo:
         - <added> [ref=e116] list:
           - <added> [ref=e117] listitem:
             - <added> [ref=e118] link "X" [cursor=pointer]:
               - /url: "https://x.com/saucelabs"
           - <added> [ref=e119] listitem:
             - <added> [ref=e120] link "Facebook" [cursor=pointer]:
               - /url: "https://www.facebook.com/saucelabs"
           - <added> [ref=e121] listitem:
             - <added> [ref=e122] link "LinkedIn" [cursor=pointer]:
               - /url: "https://www.linkedin.com/company/sauce-labs/"
         - <added> [ref=e123]: "© 2026 Sauce Labs. All Rights Reserved. Terms of Service | Privacy Policy"
       - <removed> [ref=e4]: Swag Labs
       - <removed> [ref=e5] main:
         - <removed> [ref=e9] form "Login":
           - <removed> [ref=e11] textbox "Username": standard_user
           - <removed> [ref=e13] textbox "Password" [active]: secret_sauce
           - <removed> [ref=e15] button "Login" [cursor=pointer]
         - <removed> [ref=e17]:
           - <removed> [ref=e18]:
             - <removed> [ref=e19] heading "Accepted usernames are:" [level=4]
             - text: standard_userlocked_out_userproblem_userperformance_glitch_usererror_uservisual_user
           - <removed> [ref=e20]:
             - <removed> [ref=e21] heading "Password for all users:" [level=4]
             - text: secret_sauce
```

### before

```
#5 click  [data-test="login-button"]  [free-before]
   code: await page.locator('[data-test="login-button"]').click();
   navigated to: https://www.saucedemo.com/inventory.html
   target: in tree ref=e15 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e22]:
       - <added> [ref=e23]:
         - <added> [ref=e24] banner:
           - <added> [ref=e25]:
             - <added> [ref=e26]:
               - <added> [ref=e27] button "Open Menu" [cursor=pointer]
               - <added> [ref=e28] img "Open Menu"
             - <added> [ref=e29]: Swag Labs
             - <added> [ref=e32] button "Cart, empty"
           - <added> [ref=e33]:
             - <added> [ref=e34]: Products
             - <added> [ref=e36] [cursor=pointer]:
               - <added> [ref=e37]: Name (A to Z)
               - <added> [ref=e38] combobox "Sort products":
                 - <added> [ref=s_1] option "Name (A to Z)" [selected]
                 - <added> [ref=s_2] option "Name (Z to A)"
                 - <added> [ref=s_3] option "Price (low to high)"
                 - <added> [ref=s_4] option "Price (high to low)"
         - <added> [ref=e39] main:
           - <added> [ref=e42]:
             - <added> [ref=e43]:
               - <added> [ref=e45] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                 - <added> [ref=e46] img "Sauce Labs Backpack"
               - <added> [ref=e47]:
                 - <added> [ref=e48]:
                   - <added> [ref=e49] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                     - <added> [ref=e50]: Sauce Labs Backpack
                   - <added> [ref=e51]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
                 - <added> [ref=e52]:
                   - <added> [ref=e53]: $29.99
                   - <added> [ref=e54] button "Add to cart" [cursor=pointer]
             - <added> [ref=e55]:
               - <added> [ref=e57] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                 - <added> [ref=e58] img "Sauce Labs Bike Light"
               - <added> [ref=e59]:
                 - <added> [ref=e60]:
                   - <added> [ref=e61] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                     - <added> [ref=e62]: Sauce Labs Bike Light
                   - <added> [ref=e63]: "A red light isn't the desired state in testing but it sure helps when riding your bike at night. Water-resistant with 3 lighting modes, 1 AAA battery included."
                 - <added> [ref=e64]:
                   - <added> [ref=e65]: $9.99
                   - <added> [ref=e66] button "Add to cart" [cursor=pointer]
             - <added> [ref=e67]:
               - <added> [ref=e69] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                 - <added> [ref=e70] img "Sauce Labs Bolt T-Shirt"
               - <added> [ref=e71]:
                 - <added> [ref=e72]:
                   - <added> [ref=e73] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                     - <added> [ref=e74]: Sauce Labs Bolt T-Shirt
                   - <added> [ref=e75]: "Get your testing superhero on with the Sauce Labs bolt T-shirt. From American Apparel, 100% ringspun combed cotton, heather gray with red bolt."
                 - <added> [ref=e76]:
                   - <added> [ref=e77]: $15.99
                   - <added> [ref=e78] button "Add to cart" [cursor=pointer]
             - <added> [ref=e79]:
               - <added> [ref=e81] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                 - <added> [ref=e82] img "Sauce Labs Fleece Jacket"
               - <added> [ref=e83]:
                 - <added> [ref=e84]:
                   - <added> [ref=e85] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                     - <added> [ref=e86]: Sauce Labs Fleece Jacket
                   - <added> [ref=e87]: "It's not every day that you come across a midweight quarter-zip fleece jacket capable of handling everything from a relaxing day outdoors to a busy day at the office."
                 - <added> [ref=e88]:
                   - <added> [ref=e89]: $49.99
                   - <added> [ref=e90] button "Add to cart" [cursor=pointer]
             - <added> [ref=e91]:
               - <added> [ref=e93] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                 - <added> [ref=e94] img "Sauce Labs Onesie"
               - <added> [ref=e95]:
                 - <added> [ref=e96]:
                   - <added> [ref=e97] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                     - <added> [ref=e98]: Sauce Labs Onesie
                   - <added> [ref=e99]: "Rib snap infant onesie for the junior automation engineer in development. Reinforced 3-snap bottom closure, two-needle hemmed sleeved and bottom won't unravel."
                 - <added> [ref=e100]:
                   - <added> [ref=e101]: $7.99
                   - <added> [ref=e102] button "Add to cart" [cursor=pointer]
             - <added> [ref=e103]:
               - <added> [ref=e105] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                 - <added> [ref=e106] img "Test.allTheThings() T-Shirt (Red)"
               - <added> [ref=e107]:
                 - <added> [ref=e108]:
                   - <added> [ref=e109] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                     - <added> [ref=e110]: Test.allTheThings() T-Shirt (Red)
                   - <added> [ref=e111]: This classic Sauce Labs t-shirt is perfect to wear when cozying up to your keyboard to automate a few tests. Super-soft and comfy ringspun combed cotton.
                 - <added> [ref=e112]:
                   - <added> [ref=e113]: $15.99
                   - <added> [ref=e114] button "Add to cart" [cursor=pointer]
       - <added> [ref=e115] contentinfo:
         - <added> [ref=e116] list:
           - <added> [ref=e117] listitem:
             - <added> [ref=e118] link "X" [cursor=pointer]:
               - /url: "https://x.com/saucelabs"
           - <added> [ref=e119] listitem:
             - <added> [ref=e120] link "Facebook" [cursor=pointer]:
               - /url: "https://www.facebook.com/saucelabs"
           - <added> [ref=e121] listitem:
             - <added> [ref=e122] link "LinkedIn" [cursor=pointer]:
               - /url: "https://www.linkedin.com/company/sauce-labs/"
         - <added> [ref=e123]: "© 2026 Sauce Labs. All Rights Reserved. Terms of Service | Privacy Policy"
       - <removed> [ref=e4]: Swag Labs
       - <removed> [ref=e5] main:
         - <removed> [ref=e9] form "Login":
           - <removed> [ref=e11] textbox "Username": standard_user
           - <removed> [ref=e13] textbox "Password" [active]: secret_sauce
           - <target> <removed> [ref=e15] button "Login" [cursor=pointer]
         - <removed> [ref=e17]:
           - <removed> [ref=e18]:
             - <removed> [ref=e19] heading "Accepted usernames are:" [level=4]
             - text: standard_userlocked_out_userproblem_userperformance_glitch_usererror_uservisual_user
           - <removed> [ref=e20]:
             - <removed> [ref=e21] heading "Password for all users:" [level=4]
             - text: secret_sauce
```

### gate-a

```
#5 click  [data-test="login-button"]  [gate]
   code: await page.locator('[data-test="login-button"]').click();
   navigated to: https://www.saucedemo.com/inventory.html
   target: in tree ref=e15 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e22]:
       - <added> [ref=e23]:
         - <added> [ref=e24] banner:
           - <added> [ref=e25]:
             - <added> [ref=s_1]:
               - <added> [ref=s_2]:
                 - <added> [ref=e26]:
                   - <added> [ref=e27] button "Open Menu" [cursor=pointer]
                   - <added> [ref=e28] img "Open Menu"
                 - <added> [ref=e29]:
                   - <added> [ref=e31] navigation:
                     - <added> [ref=e32] button [cursor=pointer]: All Items
                     - <added> [ref=e33] button [cursor=pointer]: Dynamic Catalog
                     - <added> [ref=e35] link [cursor=pointer]:
                       - /url: "https://saucelabs.com/"
                       - text: About
                     - <added> [ref=e36] button [cursor=pointer]: Logout
                     - <added> [ref=e37] button [cursor=pointer]: Reset App State
                   - <added> [ref=e39] button [cursor=pointer]: Close Menu
             - <added> [ref=e41]: Swag Labs
             - <added> [ref=e44] button "Cart, empty"
           - <added> [ref=e45]:
             - <added> [ref=e46]: Products
             - <added> [ref=e48] [cursor=pointer]:
               - <added> [ref=e49]: Name (A to Z)
               - <added> [ref=e50] combobox "Sort products":
                 - <added> [ref=s_3] option "Name (A to Z)" [selected]
                 - <added> [ref=s_4] option "Name (Z to A)"
                 - <added> [ref=s_5] option "Price (low to high)"
                 - <added> [ref=s_6] option "Price (high to low)"
         - <added> [ref=e51] main:
           - <added> [ref=e54]:
             - <added> [ref=e55]:
               - <added> [ref=e57] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                 - <added> [ref=e58] img "Sauce Labs Backpack"
               - <added> [ref=e59]:
                 - <added> [ref=e60]:
                   - <added> [ref=e61] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                     - <added> [ref=e62]: Sauce Labs Backpack
                   - <added> [ref=e63]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
                 - <added> [ref=e64]:
                   - <added> [ref=e65]: $29.99
                   - <added> [ref=e66] button "Add to cart" [cursor=pointer]
             - <added> [ref=e67]:
               - <added> [ref=e69] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                 - <added> [ref=e70] img "Sauce Labs Bike Light"
               - <added> [ref=e71]:
                 - <added> [ref=e72]:
                   - <added> [ref=e73] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                     - <added> [ref=e74]: Sauce Labs Bike Light
                   - <added> [ref=e75]: "A red light isn't the desired state in testing but it sure helps when riding your bike at night. Water-resistant with 3 lighting modes, 1 AAA battery included."
                 - <added> [ref=e76]:
                   - <added> [ref=e77]: $9.99
                   - <added> [ref=e78] button "Add to cart" [cursor=pointer]
             - <added> [ref=e79]:
               - <added> [ref=e81] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                 - <added> [ref=e82] img "Sauce Labs Bolt T-Shirt"
               - <added> [ref=e83]:
                 - <added> [ref=e84]:
                   - <added> [ref=e85] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                     - <added> [ref=e86]: Sauce Labs Bolt T-Shirt
                   - <added> [ref=e87]: "Get your testing superhero on with the Sauce Labs bolt T-shirt. From American Apparel, 100% ringspun combed cotton, heather gray with red bolt."
                 - <added> [ref=e88]:
                   - <added> [ref=e89]: $15.99
                   - <added> [ref=e90] button "Add to cart" [cursor=pointer]
             - <added> [ref=e91]:
               - <added> [ref=e93] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                 - <added> [ref=e94] img "Sauce Labs Fleece Jacket"
               - <added> [ref=e95]:
                 - <added> [ref=e96]:
                   - <added> [ref=e97] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                     - <added> [ref=e98]: Sauce Labs Fleece Jacket
                   - <added> [ref=e99]: "It's not every day that you come across a midweight quarter-zip fleece jacket capable of handling everything from a relaxing day outdoors to a busy day at the office."
                 - <added> [ref=e100]:
                   - <added> [ref=e101]: $49.99
                   - <added> [ref=e102] button "Add to cart" [cursor=pointer]
             - <added> [ref=e103]:
               - <added> [ref=e105] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                 - <added> [ref=e106] img "Sauce Labs Onesie"
               - <added> [ref=e107]:
                 - <added> [ref=e108]:
                   - <added> [ref=e109] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                     - <added> [ref=e110]: Sauce Labs Onesie
                   - <added> [ref=e111]: "Rib snap infant onesie for the junior automation engineer in development. Reinforced 3-snap bottom closure, two-needle hemmed sleeved and bottom won't unravel."
                 - <added> [ref=e112]:
                   - <added> [ref=e113]: $7.99
                   - <added> [ref=e114] button "Add to cart" [cursor=pointer]
             - <added> [ref=e115]:
               - <added> [ref=e117] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                 - <added> [ref=e118] img "Test.allTheThings() T-Shirt (Red)"
               - <added> [ref=e119]:
                 - <added> [ref=e120]:
                   - <added> [ref=e121] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                     - <added> [ref=e122]: Test.allTheThings() T-Shirt (Red)
                   - <added> [ref=e123]: This classic Sauce Labs t-shirt is perfect to wear when cozying up to your keyboard to automate a few tests. Super-soft and comfy ringspun combed cotton.
                 - <added> [ref=e124]:
                   - <added> [ref=e125]: $15.99
                   - <added> [ref=e126] button "Add to cart" [cursor=pointer]
       - <added> [ref=e127] contentinfo:
         - <added> [ref=e128] list:
           - <added> [ref=e129] listitem:
             - <added> [ref=e130] link "X" [cursor=pointer]:
               - /url: "https://x.com/saucelabs"
           - <added> [ref=e131] listitem:
             - <added> [ref=e132] link "Facebook" [cursor=pointer]:
               - /url: "https://www.facebook.com/saucelabs"
           - <added> [ref=e133] listitem:
             - <added> [ref=e134] link "LinkedIn" [cursor=pointer]:
               - /url: "https://www.linkedin.com/company/sauce-labs/"
         - <added> [ref=e135]: "© 2026 Sauce Labs. All Rights Reserved. Terms of Service | Privacy Policy"
       - <removed> [ref=e4]: Swag Labs
       - <removed> [ref=e5] main:
         - <removed> [ref=e9] form "Login":
           - <removed> [ref=e11] textbox "Username": standard_user
           - <removed> [ref=e13] textbox "Password" [active]: secret_sauce
           - <target> <removed> [ref=e15] button "Login" [cursor=pointer]
         - <removed> [ref=e17]:
           - <removed> [ref=e18]:
             - <removed> [ref=e19] heading "Accepted usernames are:" [level=4]
             - text: standard_userlocked_out_userproblem_userperformance_glitch_usererror_uservisual_user
           - <removed> [ref=e20]:
             - <removed> [ref=e21] heading "Password for all users:" [level=4]
             - text: secret_sauce
```

### gate-b

```
#5 click  [data-test="login-button"]  [gate]
   code: await page.locator('[data-test="login-button"]').click();
   navigated to: https://www.saucedemo.com/inventory.html
   target: in tree ref=e15 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e3]:
       - [ref=e5] main:
         - [ref=e9] form "Login":
           - <changed> [ref=e13] textbox "Password": secret_sauce
           - <changed> [ref=e15] button "Login" [active] [cursor=pointer]
   Change Tree:
     - [ref=e22]:
       - <added> [ref=e23]:
         - <added> [ref=e24] banner:
           - <added> [ref=e25]:
             - <added> [ref=s_1]:
               - <added> [ref=s_2]:
                 - <added> [ref=e26]:
                   - <added> [ref=e27] button "Open Menu" [cursor=pointer]
                   - <added> [ref=e28] img "Open Menu"
                 - <added> [ref=e29]:
                   - <added> [ref=e31] navigation:
                     - <added> [ref=e32] button [cursor=pointer]: All Items
                     - <added> [ref=e33] button [cursor=pointer]: Dynamic Catalog
                     - <added> [ref=e35] link [cursor=pointer]:
                       - /url: "https://saucelabs.com/"
                       - text: About
                     - <added> [ref=e36] button [cursor=pointer]: Logout
                     - <added> [ref=e37] button [cursor=pointer]: Reset App State
                   - <added> [ref=e39] button [cursor=pointer]: Close Menu
             - <added> [ref=e41]: Swag Labs
             - <added> [ref=e44] button "Cart, empty"
           - <added> [ref=e45]:
             - <added> [ref=e46]: Products
             - <added> [ref=e48] [cursor=pointer]:
               - <added> [ref=e49]: Name (A to Z)
               - <added> [ref=e50] combobox "Sort products":
                 - <added> [ref=s_3] option "Name (A to Z)" [selected]
                 - <added> [ref=s_4] option "Name (Z to A)"
                 - <added> [ref=s_5] option "Price (low to high)"
                 - <added> [ref=s_6] option "Price (high to low)"
         - <added> [ref=e51] main:
           - <added> [ref=e54]:
             - <added> [ref=e55]:
               - <added> [ref=e57] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                 - <added> [ref=e58] img "Sauce Labs Backpack"
               - <added> [ref=e59]:
                 - <added> [ref=e60]:
                   - <added> [ref=e61] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                     - <added> [ref=e62]: Sauce Labs Backpack
                   - <added> [ref=e63]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
                 - <added> [ref=e64]:
                   - <added> [ref=e65]: $29.99
                   - <added> [ref=e66] button "Add to cart" [cursor=pointer]
             - <added> [ref=e67]:
               - <added> [ref=e69] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                 - <added> [ref=e70] img "Sauce Labs Bike Light"
               - <added> [ref=e71]:
                 - <added> [ref=e72]:
                   - <added> [ref=e73] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                     - <added> [ref=e74]: Sauce Labs Bike Light
                   - <added> [ref=e75]: "A red light isn't the desired state in testing but it sure helps when riding your bike at night. Water-resistant with 3 lighting modes, 1 AAA battery included."
                 - <added> [ref=e76]:
                   - <added> [ref=e77]: $9.99
                   - <added> [ref=e78] button "Add to cart" [cursor=pointer]
             - <added> [ref=e79]:
               - <added> [ref=e81] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                 - <added> [ref=e82] img "Sauce Labs Bolt T-Shirt"
               - <added> [ref=e83]:
                 - <added> [ref=e84]:
                   - <added> [ref=e85] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                     - <added> [ref=e86]: Sauce Labs Bolt T-Shirt
                   - <added> [ref=e87]: "Get your testing superhero on with the Sauce Labs bolt T-shirt. From American Apparel, 100% ringspun combed cotton, heather gray with red bolt."
                 - <added> [ref=e88]:
                   - <added> [ref=e89]: $15.99
                   - <added> [ref=e90] button "Add to cart" [cursor=pointer]
             - <added> [ref=e91]:
               - <added> [ref=e93] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                 - <added> [ref=e94] img "Sauce Labs Fleece Jacket"
               - <added> [ref=e95]:
                 - <added> [ref=e96]:
                   - <added> [ref=e97] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                     - <added> [ref=e98]: Sauce Labs Fleece Jacket
                   - <added> [ref=e99]: "It's not every day that you come across a midweight quarter-zip fleece jacket capable of handling everything from a relaxing day outdoors to a busy day at the office."
                 - <added> [ref=e100]:
                   - <added> [ref=e101]: $49.99
                   - <added> [ref=e102] button "Add to cart" [cursor=pointer]
             - <added> [ref=e103]:
               - <added> [ref=e105] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                 - <added> [ref=e106] img "Sauce Labs Onesie"
               - <added> [ref=e107]:
                 - <added> [ref=e108]:
                   - <added> [ref=e109] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                     - <added> [ref=e110]: Sauce Labs Onesie
                   - <added> [ref=e111]: "Rib snap infant onesie for the junior automation engineer in development. Reinforced 3-snap bottom closure, two-needle hemmed sleeved and bottom won't unravel."
                 - <added> [ref=e112]:
                   - <added> [ref=e113]: $7.99
                   - <added> [ref=e114] button "Add to cart" [cursor=pointer]
             - <added> [ref=e115]:
               - <added> [ref=e117] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                 - <added> [ref=e118] img "Test.allTheThings() T-Shirt (Red)"
               - <added> [ref=e119]:
                 - <added> [ref=e120]:
                   - <added> [ref=e121] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                     - <added> [ref=e122]: Test.allTheThings() T-Shirt (Red)
                   - <added> [ref=e123]: This classic Sauce Labs t-shirt is perfect to wear when cozying up to your keyboard to automate a few tests. Super-soft and comfy ringspun combed cotton.
                 - <added> [ref=e124]:
                   - <added> [ref=e125]: $15.99
                   - <added> [ref=e126] button "Add to cart" [cursor=pointer]
       - <added> [ref=e127] contentinfo:
         - <added> [ref=e128] list:
           - <added> [ref=e129] listitem:
             - <added> [ref=e130] link "X" [cursor=pointer]:
               - /url: "https://x.com/saucelabs"
           - <added> [ref=e131] listitem:
             - <added> [ref=e132] link "Facebook" [cursor=pointer]:
               - /url: "https://www.facebook.com/saucelabs"
           - <added> [ref=e133] listitem:
             - <added> [ref=e134] link "LinkedIn" [cursor=pointer]:
               - /url: "https://www.linkedin.com/company/sauce-labs/"
         - <added> [ref=e135]: "© 2026 Sauce Labs. All Rights Reserved. Terms of Service | Privacy Policy"
       - <removed> [ref=e4]: Swag Labs
       - <removed> [ref=e5] main:
         - <removed> [ref=e9] form "Login":
           - <removed> [ref=e11] textbox "Username": standard_user
           - <removed> [ref=e13] textbox "Password": secret_sauce
           - <target> <removed> [ref=e15] button "Login" [active] [cursor=pointer]
         - <removed> [ref=e17]:
           - <removed> [ref=e18]:
             - <removed> [ref=e19] heading "Accepted usernames are:" [level=4]
             - text: standard_userlocked_out_userproblem_userperformance_glitch_usererror_uservisual_user
           - <removed> [ref=e20]:
             - <removed> [ref=e21] heading "Password for all users:" [level=4]
             - text: secret_sauce
```

## click Add to cart (Backpack)

### after

```
#6 click  [data-test="add-to-cart-sauce-labs-backpack"]  [after-only]
   code: await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
   target: not resolved in the tree (selector kept)
   Change Tree:
     - [ref=e22]:
       - [ref=e23]:
         - [ref=e24] banner:
           - [ref=e25]:
             - <added> [ref=e124] button "Cart, 1 items":
               - <added> [ref=e125]: 1
             - <removed> [ref=e32] button "Cart, empty"
         - [ref=e39] main:
           - [ref=e42]:
             - [ref=e43]:
               - [ref=e47]:
                 - [ref=e52]:
                   - <added> [ref=e126] button "Remove" [cursor=pointer]
                   - <removed> [ref=e54] button "Add to cart" [cursor=pointer]
```

### before

```
#6 click  [data-test="add-to-cart-sauce-labs-backpack"]  [free-before]
   code: await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
   target: in tree ref=e54 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e22]:
       - [ref=e23]:
         - [ref=e24] banner:
           - [ref=e25]:
             - <added> [ref=e124] button "Cart, 1 items":
               - <added> [ref=e125]: 1
             - <removed> [ref=e32] button "Cart, empty"
         - [ref=e39] main:
           - [ref=e42]:
             - [ref=e43]:
               - [ref=e47]:
                 - [ref=e52]:
                   - <added> [ref=e126] button "Remove" [cursor=pointer]
                   - <target> <removed> [ref=e54] button "Add to cart" [cursor=pointer]
```

### gate-a

```
#6 click  [data-test="add-to-cart-sauce-labs-backpack"]  [gate]
   code: await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
   target: in tree ref=e66 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e22]:
       - [ref=e23]:
         - [ref=e24] banner:
           - [ref=e25]:
             - <removed> [ref=s_1]:
               - <removed> [ref=s_2]:
                 - <removed> [ref=e29]:
                   - <removed> [ref=e31] navigation:
                     - <removed> [ref=e32] button [cursor=pointer]: All Items
                     - <removed> [ref=e33] button [cursor=pointer]: Dynamic Catalog
                     - <removed> [ref=e35] link [cursor=pointer]:
                       - /url: "https://saucelabs.com/"
                       - text: About
                     - <removed> [ref=e36] button [cursor=pointer]: Logout
                     - <removed> [ref=e37] button [cursor=pointer]: Reset App State
                   - <removed> [ref=e39] button [cursor=pointer]: Close Menu
   Change Tree:
     - [ref=e22]:
       - [ref=e23]:
         - [ref=e24] banner:
           - [ref=e25]:
             - <added> [ref=e136] button "Cart, 1 items":
               - <added> [ref=e137]: 1
             - <removed> [ref=e44] button "Cart, empty"
         - [ref=e51] main:
           - [ref=e54]:
             - [ref=e55]:
               - [ref=e59]:
                 - [ref=e64]:
                   - <added> [ref=e138] button "Remove" [cursor=pointer]
                   - <target> <removed> [ref=e66] button "Add to cart" [cursor=pointer]
```

### gate-b

```
#6 click  [data-test="add-to-cart-sauce-labs-backpack"]  [gate]
   code: await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
   target: in tree ref=e66 (via event snapshot)
   changed before the interaction (unassigned):
     - [ref=e22]:
       - [ref=e23]:
         - [ref=e24] banner:
           - [ref=e25]:
             - <removed> [ref=s_1]:
               - <removed> [ref=s_2]:
                 - <removed> [ref=e29]:
                   - <removed> [ref=e31] navigation:
                     - <removed> [ref=e32] button [cursor=pointer]: All Items
                     - <removed> [ref=e33] button [cursor=pointer]: Dynamic Catalog
                     - <removed> [ref=e35] link [cursor=pointer]:
                       - /url: "https://saucelabs.com/"
                       - text: About
                     - <removed> [ref=e36] button [cursor=pointer]: Logout
                     - <removed> [ref=e37] button [cursor=pointer]: Reset App State
                   - <removed> [ref=e39] button [cursor=pointer]: Close Menu
         - [ref=e51] main:
           - [ref=e54]:
             - [ref=e55]:
               - [ref=e59]:
                 - [ref=e64]:
                   - <changed> [ref=e66] button "Add to cart" [active] [cursor=pointer]
   Change Tree:
     - [ref=e22]:
       - [ref=e23]:
         - [ref=e24] banner:
           - [ref=e25]:
             - <added> [ref=e136] button "Cart, 1 items":
               - <added> [ref=e137]: 1
             - <removed> [ref=e44] button "Cart, empty"
         - [ref=e51] main:
           - [ref=e54]:
             - [ref=e55]:
               - [ref=e59]:
                 - [ref=e64]:
                   - <added> [ref=e138] button "Remove" [cursor=pointer]
                   - <target> <removed> [ref=e66] button "Add to cart" [active] [cursor=pointer]
```

## click the cart link

### after

```
#7 click  [data-test="shopping-cart-link"]  [after-only]
   code: await page.locator('[data-test="shopping-cart-link"]').click();
   navigated to: https://www.saucedemo.com/cart.html
   target: in tree ref=e137 (via ancestor walk)
   Change Tree:
     - [ref=e127]:
       - [ref=e128]:
         - [ref=e129] banner:
           - [ref=e130]:
             - <target> [ref=e137] button "Cart, 1 items"
           - <added> [ref=e139]: Your Cart
           - <removed> [ref=e33]:
             - <removed> [ref=e34]: Products
             - <removed> [ref=e36] [cursor=pointer]:
               - <removed> [ref=e37]: Name (A to Z)
               - <removed> [ref=e38] combobox "Sort products":
                 - <removed> [ref=s_5] option "Name (A to Z)" [selected]
                 - <removed> [ref=s_6] option "Name (Z to A)"
                 - <removed> [ref=s_7] option "Price (low to high)"
                 - <removed> [ref=s_8] option "Price (high to low)"
         - [ref=e141] main:
           - [ref=e142]:
             - <added> [ref=e143]:
               - <added> [ref=e144]: QTY
               - <added> [ref=e145]: Description
               - <added> [ref=e146]:
                 - <added> [ref=e147]: 1
                 - <added> [ref=e148]:
                   - <added> [ref=e149] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                     - <added> [ref=e150]: Sauce Labs Backpack
                   - <added> [ref=e151]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
                   - <added> [ref=e152]:
                     - <added> [ref=e153]: $29.99
                     - <added> [ref=e154] button "Remove" [cursor=pointer]
             - <added> [ref=e155]:
               - <added> [ref=e156] button "Continue Shopping" [cursor=pointer]
               - <added> [ref=e157] button "Checkout" [cursor=pointer]
             - <removed> [ref=e43]:
               - <removed> [ref=e45] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                 - <removed> [ref=e46] img "Sauce Labs Backpack"
               - <removed> [ref=e47]:
                 - <removed> [ref=e48]:
                   - <removed> [ref=e49] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                     - <removed> [ref=e50]: Sauce Labs Backpack
                   - <removed> [ref=e51]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
                 - <removed> [ref=e52]:
                   - <removed> [ref=e53]: $29.99
                   - <removed> [ref=e126] button "Remove" [cursor=pointer]
             - <removed> [ref=e55]:
               - <removed> [ref=e57] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                 - <removed> [ref=e58] img "Sauce Labs Bike Light"
               - <removed> [ref=e59]:
                 - <removed> [ref=e60]:
                   - <removed> [ref=e61] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                     - <removed> [ref=e62]: Sauce Labs Bike Light
                   - <removed> [ref=e63]: "A red light isn't the desired state in testing but it sure helps when riding your bike at night. Water-resistant with 3 lighting modes, 1 AAA battery included."
                 - <removed> [ref=e64]:
                   - <removed> [ref=e65]: $9.99
                   - <removed> [ref=e66] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e67]:
               - <removed> [ref=e69] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                 - <removed> [ref=e70] img "Sauce Labs Bolt T-Shirt"
               - <removed> [ref=e71]:
                 - <removed> [ref=e72]:
                   - <removed> [ref=e73] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                     - <removed> [ref=e74]: Sauce Labs Bolt T-Shirt
                   - <removed> [ref=e75]: "Get your testing superhero on with the Sauce Labs bolt T-shirt. From American Apparel, 100% ringspun combed cotton, heather gray with red bolt."
                 - <removed> [ref=e76]:
                   - <removed> [ref=e77]: $15.99
                   - <removed> [ref=e78] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e79]:
               - <removed> [ref=e81] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                 - <removed> [ref=e82] img "Sauce Labs Fleece Jacket"
               - <removed> [ref=e83]:
                 - <removed> [ref=e84]:
                   - <removed> [ref=e85] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                     - <removed> [ref=e86]: Sauce Labs Fleece Jacket
                   - <removed> [ref=e87]: "It's not every day that you come across a midweight quarter-zip fleece jacket capable of handling everything from a relaxing day outdoors to a busy day at the office."
                 - <removed> [ref=e88]:
                   - <removed> [ref=e89]: $49.99
                   - <removed> [ref=e90] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e91]:
               - <removed> [ref=e93] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                 - <removed> [ref=e94] img "Sauce Labs Onesie"
               - <removed> [ref=e95]:
                 - <removed> [ref=e96]:
                   - <removed> [ref=e97] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                     - <removed> [ref=e98]: Sauce Labs Onesie
                   - <removed> [ref=e99]: "Rib snap infant onesie for the junior automation engineer in development. Reinforced 3-snap bottom closure, two-needle hemmed sleeved and bottom won't unravel."
                 - <removed> [ref=e100]:
                   - <removed> [ref=e101]: $7.99
                   - <removed> [ref=e102] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e103]:
               - <removed> [ref=e105] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                 - <removed> [ref=e106] img "Test.allTheThings() T-Shirt (Red)"
               - <removed> [ref=e107]:
                 - <removed> [ref=e108]:
                   - <removed> [ref=e109] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                     - <removed> [ref=e110]: Test.allTheThings() T-Shirt (Red)
                   - <removed> [ref=e111]: This classic Sauce Labs t-shirt is perfect to wear when cozying up to your keyboard to automate a few tests. Super-soft and comfy ringspun combed cotton.
                 - <removed> [ref=e112]:
                   - <removed> [ref=e113]: $15.99
                   - <removed> [ref=e114] button "Add to cart" [cursor=pointer]
```

### before

```
#7 click  [data-test="shopping-cart-link"]  [free-before]
   code: await page.locator('[data-test="shopping-cart-link"]').click();
   navigated to: https://www.saucedemo.com/cart.html
   target: in tree ref=e137 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e127]:
       - [ref=e128]:
         - [ref=e129] banner:
           - [ref=e130]:
             - <target> [ref=e137] button "Cart, 1 items"
           - <added> [ref=e139]: Your Cart
           - <removed> [ref=e33]:
             - <removed> [ref=e34]: Products
             - <removed> [ref=e36] [cursor=pointer]:
               - <removed> [ref=e37]: Name (A to Z)
               - <removed> [ref=e38] combobox "Sort products":
                 - <removed> [ref=s_5] option "Name (A to Z)" [selected]
                 - <removed> [ref=s_6] option "Name (Z to A)"
                 - <removed> [ref=s_7] option "Price (low to high)"
                 - <removed> [ref=s_8] option "Price (high to low)"
         - [ref=e141] main:
           - [ref=e142]:
             - <added> [ref=e143]:
               - <added> [ref=e144]: QTY
               - <added> [ref=e145]: Description
               - <added> [ref=e146]:
                 - <added> [ref=e147]: 1
                 - <added> [ref=e148]:
                   - <added> [ref=e149] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                     - <added> [ref=e150]: Sauce Labs Backpack
                   - <added> [ref=e151]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
                   - <added> [ref=e152]:
                     - <added> [ref=e153]: $29.99
                     - <added> [ref=e154] button "Remove" [cursor=pointer]
             - <added> [ref=e155]:
               - <added> [ref=e156] button "Continue Shopping" [cursor=pointer]
               - <added> [ref=e157] button "Checkout" [cursor=pointer]
             - <removed> [ref=e43]:
               - <removed> [ref=e45] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                 - <removed> [ref=e46] img "Sauce Labs Backpack"
               - <removed> [ref=e47]:
                 - <removed> [ref=e48]:
                   - <removed> [ref=e49] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                     - <removed> [ref=e50]: Sauce Labs Backpack
                   - <removed> [ref=e51]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
                 - <removed> [ref=e52]:
                   - <removed> [ref=e53]: $29.99
                   - <removed> [ref=e126] button "Remove" [cursor=pointer]
             - <removed> [ref=e55]:
               - <removed> [ref=e57] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                 - <removed> [ref=e58] img "Sauce Labs Bike Light"
               - <removed> [ref=e59]:
                 - <removed> [ref=e60]:
                   - <removed> [ref=e61] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                     - <removed> [ref=e62]: Sauce Labs Bike Light
                   - <removed> [ref=e63]: "A red light isn't the desired state in testing but it sure helps when riding your bike at night. Water-resistant with 3 lighting modes, 1 AAA battery included."
                 - <removed> [ref=e64]:
                   - <removed> [ref=e65]: $9.99
                   - <removed> [ref=e66] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e67]:
               - <removed> [ref=e69] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                 - <removed> [ref=e70] img "Sauce Labs Bolt T-Shirt"
               - <removed> [ref=e71]:
                 - <removed> [ref=e72]:
                   - <removed> [ref=e73] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                     - <removed> [ref=e74]: Sauce Labs Bolt T-Shirt
                   - <removed> [ref=e75]: "Get your testing superhero on with the Sauce Labs bolt T-shirt. From American Apparel, 100% ringspun combed cotton, heather gray with red bolt."
                 - <removed> [ref=e76]:
                   - <removed> [ref=e77]: $15.99
                   - <removed> [ref=e78] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e79]:
               - <removed> [ref=e81] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                 - <removed> [ref=e82] img "Sauce Labs Fleece Jacket"
               - <removed> [ref=e83]:
                 - <removed> [ref=e84]:
                   - <removed> [ref=e85] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                     - <removed> [ref=e86]: Sauce Labs Fleece Jacket
                   - <removed> [ref=e87]: "It's not every day that you come across a midweight quarter-zip fleece jacket capable of handling everything from a relaxing day outdoors to a busy day at the office."
                 - <removed> [ref=e88]:
                   - <removed> [ref=e89]: $49.99
                   - <removed> [ref=e90] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e91]:
               - <removed> [ref=e93] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                 - <removed> [ref=e94] img "Sauce Labs Onesie"
               - <removed> [ref=e95]:
                 - <removed> [ref=e96]:
                   - <removed> [ref=e97] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                     - <removed> [ref=e98]: Sauce Labs Onesie
                   - <removed> [ref=e99]: "Rib snap infant onesie for the junior automation engineer in development. Reinforced 3-snap bottom closure, two-needle hemmed sleeved and bottom won't unravel."
                 - <removed> [ref=e100]:
                   - <removed> [ref=e101]: $7.99
                   - <removed> [ref=e102] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e103]:
               - <removed> [ref=e105] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                 - <removed> [ref=e106] img "Test.allTheThings() T-Shirt (Red)"
               - <removed> [ref=e107]:
                 - <removed> [ref=e108]:
                   - <removed> [ref=e109] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                     - <removed> [ref=e110]: Test.allTheThings() T-Shirt (Red)
                   - <removed> [ref=e111]: This classic Sauce Labs t-shirt is perfect to wear when cozying up to your keyboard to automate a few tests. Super-soft and comfy ringspun combed cotton.
                 - <removed> [ref=e112]:
                   - <removed> [ref=e113]: $15.99
                   - <removed> [ref=e114] button "Add to cart" [cursor=pointer]
```

### gate-a

```
#7 click  [data-test="shopping-cart-link"]  [gate]
   code: await page.locator('[data-test="shopping-cart-link"]').click();
   navigated to: https://www.saucedemo.com/cart.html
   target: in tree ref=e149 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e139]:
       - [ref=e140]:
         - [ref=e141] banner:
           - [ref=e142]:
             - <target> [ref=e149] button "Cart, 1 items"
           - <added> [ref=e151]: Your Cart
           - <removed> [ref=e45]:
             - <removed> [ref=e46]: Products
             - <removed> [ref=e48] [cursor=pointer]:
               - <removed> [ref=e49]: Name (A to Z)
               - <removed> [ref=e50] combobox "Sort products":
                 - <removed> [ref=s_19] option "Name (A to Z)" [selected]
                 - <removed> [ref=s_20] option "Name (Z to A)"
                 - <removed> [ref=s_21] option "Price (low to high)"
                 - <removed> [ref=s_22] option "Price (high to low)"
         - [ref=e153] main:
           - [ref=e154]:
             - <added> [ref=e155]:
               - <added> [ref=e156]: QTY
               - <added> [ref=e157]: Description
               - <added> [ref=e158]:
                 - <added> [ref=e159]: 1
                 - <added> [ref=e160]:
                   - <added> [ref=e161] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                     - <added> [ref=e162]: Sauce Labs Backpack
                   - <added> [ref=e163]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
                   - <added> [ref=e164]:
                     - <added> [ref=e165]: $29.99
                     - <added> [ref=e166] button "Remove" [cursor=pointer]
             - <added> [ref=e167]:
               - <added> [ref=e168] button "Continue Shopping" [cursor=pointer]
               - <added> [ref=e169] button "Checkout" [cursor=pointer]
             - <removed> [ref=e55]:
               - <removed> [ref=e57] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                 - <removed> [ref=e58] img "Sauce Labs Backpack"
               - <removed> [ref=e59]:
                 - <removed> [ref=e60]:
                   - <removed> [ref=e61] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                     - <removed> [ref=e62]: Sauce Labs Backpack
                   - <removed> [ref=e63]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
                 - <removed> [ref=e64]:
                   - <removed> [ref=e65]: $29.99
                   - <removed> [ref=e138] button "Remove" [cursor=pointer]
             - <removed> [ref=e67]:
               - <removed> [ref=e69] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                 - <removed> [ref=e70] img "Sauce Labs Bike Light"
               - <removed> [ref=e71]:
                 - <removed> [ref=e72]:
                   - <removed> [ref=e73] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                     - <removed> [ref=e74]: Sauce Labs Bike Light
                   - <removed> [ref=e75]: "A red light isn't the desired state in testing but it sure helps when riding your bike at night. Water-resistant with 3 lighting modes, 1 AAA battery included."
                 - <removed> [ref=e76]:
                   - <removed> [ref=e77]: $9.99
                   - <removed> [ref=e78] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e79]:
               - <removed> [ref=e81] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                 - <removed> [ref=e82] img "Sauce Labs Bolt T-Shirt"
               - <removed> [ref=e83]:
                 - <removed> [ref=e84]:
                   - <removed> [ref=e85] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                     - <removed> [ref=e86]: Sauce Labs Bolt T-Shirt
                   - <removed> [ref=e87]: "Get your testing superhero on with the Sauce Labs bolt T-shirt. From American Apparel, 100% ringspun combed cotton, heather gray with red bolt."
                 - <removed> [ref=e88]:
                   - <removed> [ref=e89]: $15.99
                   - <removed> [ref=e90] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e91]:
               - <removed> [ref=e93] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                 - <removed> [ref=e94] img "Sauce Labs Fleece Jacket"
               - <removed> [ref=e95]:
                 - <removed> [ref=e96]:
                   - <removed> [ref=e97] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                     - <removed> [ref=e98]: Sauce Labs Fleece Jacket
                   - <removed> [ref=e99]: "It's not every day that you come across a midweight quarter-zip fleece jacket capable of handling everything from a relaxing day outdoors to a busy day at the office."
                 - <removed> [ref=e100]:
                   - <removed> [ref=e101]: $49.99
                   - <removed> [ref=e102] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e103]:
               - <removed> [ref=e105] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                 - <removed> [ref=e106] img "Sauce Labs Onesie"
               - <removed> [ref=e107]:
                 - <removed> [ref=e108]:
                   - <removed> [ref=e109] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                     - <removed> [ref=e110]: Sauce Labs Onesie
                   - <removed> [ref=e111]: "Rib snap infant onesie for the junior automation engineer in development. Reinforced 3-snap bottom closure, two-needle hemmed sleeved and bottom won't unravel."
                 - <removed> [ref=e112]:
                   - <removed> [ref=e113]: $7.99
                   - <removed> [ref=e114] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e115]:
               - <removed> [ref=e117] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                 - <removed> [ref=e118] img "Test.allTheThings() T-Shirt (Red)"
               - <removed> [ref=e119]:
                 - <removed> [ref=e120]:
                   - <removed> [ref=e121] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                     - <removed> [ref=e122]: Test.allTheThings() T-Shirt (Red)
                   - <removed> [ref=e123]: This classic Sauce Labs t-shirt is perfect to wear when cozying up to your keyboard to automate a few tests. Super-soft and comfy ringspun combed cotton.
                 - <removed> [ref=e124]:
                   - <removed> [ref=e125]: $15.99
                   - <removed> [ref=e126] button "Add to cart" [cursor=pointer]
```

### gate-b

```
#7 click  [data-test="shopping-cart-link"]  [gate]
   code: await page.locator('[data-test="shopping-cart-link"]').click();
   navigated to: https://www.saucedemo.com/cart.html
   target: in tree ref=e149 (via event snapshot)
   changed before the interaction (unassigned):
     (nothing)
   Change Tree:
     - [ref=e139]:
       - [ref=e140]:
         - [ref=e141] banner:
           - [ref=e142]:
             - <target> [ref=e149] button "Cart, 1 items"
           - <added> [ref=e151]: Your Cart
           - <removed> [ref=e45]:
             - <removed> [ref=e46]: Products
             - <removed> [ref=e48] [cursor=pointer]:
               - <removed> [ref=e49]: Name (A to Z)
               - <removed> [ref=e50] combobox "Sort products":
                 - <removed> [ref=s_19] option "Name (A to Z)" [selected]
                 - <removed> [ref=s_20] option "Name (Z to A)"
                 - <removed> [ref=s_21] option "Price (low to high)"
                 - <removed> [ref=s_22] option "Price (high to low)"
         - [ref=e153] main:
           - [ref=e154]:
             - <added> [ref=e155]:
               - <added> [ref=e156]: QTY
               - <added> [ref=e157]: Description
               - <added> [ref=e158]:
                 - <added> [ref=e159]: 1
                 - <added> [ref=e160]:
                   - <added> [ref=e161] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                     - <added> [ref=e162]: Sauce Labs Backpack
                   - <added> [ref=e163]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
                   - <added> [ref=e164]:
                     - <added> [ref=e165]: $29.99
                     - <added> [ref=e166] button "Remove" [cursor=pointer]
             - <added> [ref=e167]:
               - <added> [ref=e168] button "Continue Shopping" [cursor=pointer]
               - <added> [ref=e169] button "Checkout" [cursor=pointer]
             - <removed> [ref=e55]:
               - <removed> [ref=e57] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                 - <removed> [ref=e58] img "Sauce Labs Backpack"
               - <removed> [ref=e59]:
                 - <removed> [ref=e60]:
                   - <removed> [ref=e61] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                     - <removed> [ref=e62]: Sauce Labs Backpack
                   - <removed> [ref=e63]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
                 - <removed> [ref=e64]:
                   - <removed> [ref=e65]: $29.99
                   - <removed> [ref=e138] button "Remove" [cursor=pointer]
             - <removed> [ref=e67]:
               - <removed> [ref=e69] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                 - <removed> [ref=e70] img "Sauce Labs Bike Light"
               - <removed> [ref=e71]:
                 - <removed> [ref=e72]:
                   - <removed> [ref=e73] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
                     - <removed> [ref=e74]: Sauce Labs Bike Light
                   - <removed> [ref=e75]: "A red light isn't the desired state in testing but it sure helps when riding your bike at night. Water-resistant with 3 lighting modes, 1 AAA battery included."
                 - <removed> [ref=e76]:
                   - <removed> [ref=e77]: $9.99
                   - <removed> [ref=e78] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e79]:
               - <removed> [ref=e81] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                 - <removed> [ref=e82] img "Sauce Labs Bolt T-Shirt"
               - <removed> [ref=e83]:
                 - <removed> [ref=e84]:
                   - <removed> [ref=e85] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
                     - <removed> [ref=e86]: Sauce Labs Bolt T-Shirt
                   - <removed> [ref=e87]: "Get your testing superhero on with the Sauce Labs bolt T-shirt. From American Apparel, 100% ringspun combed cotton, heather gray with red bolt."
                 - <removed> [ref=e88]:
                   - <removed> [ref=e89]: $15.99
                   - <removed> [ref=e90] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e91]:
               - <removed> [ref=e93] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                 - <removed> [ref=e94] img "Sauce Labs Fleece Jacket"
               - <removed> [ref=e95]:
                 - <removed> [ref=e96]:
                   - <removed> [ref=e97] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
                     - <removed> [ref=e98]: Sauce Labs Fleece Jacket
                   - <removed> [ref=e99]: "It's not every day that you come across a midweight quarter-zip fleece jacket capable of handling everything from a relaxing day outdoors to a busy day at the office."
                 - <removed> [ref=e100]:
                   - <removed> [ref=e101]: $49.99
                   - <removed> [ref=e102] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e103]:
               - <removed> [ref=e105] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                 - <removed> [ref=e106] img "Sauce Labs Onesie"
               - <removed> [ref=e107]:
                 - <removed> [ref=e108]:
                   - <removed> [ref=e109] button "View details for Sauce Labs Onesie" [cursor=pointer]:
                     - <removed> [ref=e110]: Sauce Labs Onesie
                   - <removed> [ref=e111]: "Rib snap infant onesie for the junior automation engineer in development. Reinforced 3-snap bottom closure, two-needle hemmed sleeved and bottom won't unravel."
                 - <removed> [ref=e112]:
                   - <removed> [ref=e113]: $7.99
                   - <removed> [ref=e114] button "Add to cart" [cursor=pointer]
             - <removed> [ref=e115]:
               - <removed> [ref=e117] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                 - <removed> [ref=e118] img "Test.allTheThings() T-Shirt (Red)"
               - <removed> [ref=e119]:
                 - <removed> [ref=e120]:
                   - <removed> [ref=e121] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
                     - <removed> [ref=e122]: Test.allTheThings() T-Shirt (Red)
                   - <removed> [ref=e123]: This classic Sauce Labs t-shirt is perfect to wear when cozying up to your keyboard to automate a few tests. Super-soft and comfy ringspun combed cotton.
                 - <removed> [ref=e124]:
                   - <removed> [ref=e125]: $15.99
                   - <removed> [ref=e126] button "Add to cart" [cursor=pointer]
```
