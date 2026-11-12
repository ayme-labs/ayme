# Released vs stock prototype: exact value comparison

Released: <scratchpad>/released-recording/.ayme/recordings/rec_20261112T132544402Z/package.yaml
Prototype: <repo>/prototypes/recorder/reader-kit/.ayme/recordings/latest.yaml

Raw values below; only tree refs are replaced by `*` for tree comparisons. Interaction and trace refs remain exact. Minus is released, plus is prototype. Timing differences are separate from structure.

## Header (all values)
- `createdAt`: released `2026-11-12T13:25:44.402Z`; prototype `2026-11-12T14:50:47.604Z`
- `mode`: released `structural`; prototype `structural`
- `recordingId`: released `rec_20261112T132544402Z`; prototype `rec_20261112T145047604Z`
- `tracePath`: released `.ayme/recordings/rec_20261112T132544402Z/trace.zip`; prototype `.ayme/recordings/rec_20261112T145047604Z/trace.zip`
- `url`: released `https://www.saucedemo.com/`; prototype `https://www.saucedemo.com/`

## visit_1 metadata
- `cause`: released `navigate`; prototype `initial`
- `url`: released `https://www.saucedemo.com/`; prototype `https://www.saucedemo.com/`
- `visitId`: released `visit_1`; prototype `visit_1`

### Baseline, including every content/state mark
```diff
--- released
+++ prototype
@@ -12,4 +12,3 @@
       - [ref=*]:
         - [ref=*] heading "Password for all users:" [level=4]
         - text: secret_sauce
-  - [ref=*] [active]
```

## interaction_3 / interaction_1 ('[data-test="username"]')
- `button`: released `left`; prototype `left`
- `clickCount`: released `1`; prototype `1`
- `id`: released `interaction_3`; prototype `interaction_1`
- `modifiers`: released `0`; prototype `0`
- `targetRef`: released `e11`; prototype `e11`
- `targetSelector`: released `'[data-test="username"]'`; prototype `'[data-test="username"]'`
- `timestamp`: released `13882.34`; prototype `2103.065`
- `type`: released `click`; prototype `click`

### Interaction Change Tree
Identical after ref normalization.

## Trace point
- `afterSnapshotId`: released `after@interaction_3`; prototype `"31"`
- `beforeSnapshotId`: released `observation@000055`; prototype `"21"`
- `endedAt`: released `13379.637`; prototype `2286.135`
- `interactionId`: released `interaction_3`; prototype `interaction_1`
- `pageId`: released `page@6cedbaf1880789be333323a12a32711d`; prototype `page@c901dc19f0c014e2e4babaa08f00a440`
- `startedAt`: released `13379.637`; prototype `2103.065`

## interaction_4 / interaction_2 ('[data-test="username"]')
- `id`: released `interaction_4`; prototype `interaction_2`
- `targetRef`: released `e11`; prototype `e11`
- `targetSelector`: released `'[data-test="username"]'`; prototype `'[data-test="username"]'`
- `text`: released `standard_user`; prototype `standard_user`
- `timestamp`: released `14694.042`; prototype `3301.921`
- `type`: released `fill`; prototype `fill`

### Interaction Change Tree
Identical after ref normalization.

## Trace point
- `afterSnapshotId`: released `after@interaction_4`; prototype `"41"`
- `beforeSnapshotId`: released `observation@000071`; prototype `"31"`
- `endedAt`: released `14191.422`; prototype `4306.795`
- `interactionId`: released `interaction_4`; prototype `interaction_2`
- `pageId`: released `page@6cedbaf1880789be333323a12a32711d`; prototype `page@c901dc19f0c014e2e4babaa08f00a440`
- `startedAt`: released `14191.422`; prototype `3301.921`

## interaction_7 / interaction_3 ('[data-test="password"]')
- `button`: released `left`; prototype `left`
- `clickCount`: released `1`; prototype `1`
- `id`: released `interaction_7`; prototype `interaction_3`
- `modifiers`: released `0`; prototype `0`
- `targetRef`: released `e13`; prototype `e13`
- `targetSelector`: released `'[data-test="password"]'`; prototype `'[data-test="password"]'`
- `timestamp`: released `17002.654`; prototype `5380.206`
- `type`: released `click`; prototype `click`

### Interaction Change Tree
Identical after ref normalization.

## Trace point
- `afterSnapshotId`: released `after@interaction_7`; prototype `"56"`
- `beforeSnapshotId`: released `observation@000122`; prototype `"46"`
- `endedAt`: released `16775.538`; prototype `5547.308`
- `interactionId`: released `interaction_7`; prototype `interaction_3`
- `pageId`: released `page@6cedbaf1880789be333323a12a32711d`; prototype `page@c901dc19f0c014e2e4babaa08f00a440`
- `startedAt`: released `16775.538`; prototype `5380.206`

## interaction_8 / interaction_4 ('[data-test="password"]')
- `id`: released `interaction_8`; prototype `interaction_4`
- `targetRef`: released `e13`; prototype `e13`
- `targetSelector`: released `'[data-test="password"]'`; prototype `'[data-test="password"]'`
- `text`: released `secret_sauce`; prototype `secret_sauce`
- `timestamp`: released `17539.222`; prototype `6583.57`
- `type`: released `fill`; prototype `fill`

### Interaction Change Tree
Identical after ref normalization.

## Trace point
- `afterSnapshotId`: released `after@interaction_8`; prototype `"66"`
- `beforeSnapshotId`: released `observation@000127`; prototype `"56"`
- `endedAt`: released `17036.285`; prototype `7556.087`
- `interactionId`: released `interaction_8`; prototype `interaction_4`
- `pageId`: released `page@6cedbaf1880789be333323a12a32711d`; prototype `page@c901dc19f0c014e2e4babaa08f00a440`
- `startedAt`: released `17036.285`; prototype `6583.57`

## interaction_9 / interaction_5 ('[data-test="login-button"]')
- `button`: released `left`; prototype `left`
- `clickCount`: released `1`; prototype `1`
- `id`: released `interaction_9`; prototype `interaction_5`
- `modifiers`: released `0`; prototype `0`
- `targetRef`: released `e15`; prototype `e15`
- `targetSelector`: released `'[data-test="login-button"]'`; prototype `'[data-test="login-button"]'`
- `timestamp`: released `18065.018`; prototype `8600.694`
- `type`: released `click`; prototype `click`

### Interaction Change Tree
Identical after ref normalization.

## Trace point
- `beforeSnapshotId`: released `observation@000148`; prototype `"71"`
- `endedAt`: released `18109.366`; prototype `8618.694`
- `interactionId`: released `interaction_9`; prototype `interaction_5`
- `pageId`: released `page@6cedbaf1880789be333323a12a32711d`; prototype `page@c901dc19f0c014e2e4babaa08f00a440`
- `startedAt`: released `18109.366`; prototype `8600.694`

Released-only interaction: `{"kind": "interaction", "timestamp": "12540.122", "interaction": {"id": "interaction_1", "type": "click", "targetRef": "e18", "targetSelector": "'[data-test=\"login-credentials\"]'", "button": "left", "modifiers": "0", "clickCount": "2"}, "change": []}`

Released-only interaction: `{"kind": "interaction", "timestamp": "13156.748", "interaction": {"id": "interaction_2", "type": "press", "targetRef": "e1", "targetSelector": "body", "modifiers": "4", "key": "c"}, "change": []}`

Released-only interaction: `{"kind": "interaction", "timestamp": "16055.885", "interaction": {"id": "interaction_5", "type": "click", "targetRef": "e20", "targetSelector": "'[data-test=\"login-password\"]'", "button": "left", "modifiers": "0", "clickCount": "2"}, "change": []}`

Released-only interaction: `{"kind": "interaction", "timestamp": "16564.529", "interaction": {"id": "interaction_6", "type": "press", "targetRef": "e1", "targetSelector": "body", "modifiers": "4", "key": "c"}, "change": []}`

### Released unassigned changes (every timestamp and tree)
Timestamp `13357.079`
```text
    - [ref=*]:
      - [ref=*] main:
        - [ref=*] form "Login":
          - <changed> [ref=*] textbox "Username" [active]
      - <changed> [ref=*]
```
Timestamp `15332.541`
```text
    - [ref=*]:
      - [ref=*] main:
        - [ref=*] form "Login":
          - <changed> [ref=*] textbox "Username": standard_user
      - <changed> [ref=*] [active]
```
Timestamp `16747.758`
```text
    - [ref=*]:
      - [ref=*] main:
        - [ref=*] form "Login":
          - <changed> [ref=*] textbox "Password" [active]
      - <changed> [ref=*]
```
Timestamp `18065.018`
```text
    - [ref=*]:
      - [ref=*] main:
        - [ref=*] form "Login":
          - <changed> [ref=*] textbox "Password": secret_sauce
          - <changed> [ref=*] button "Login" [active] [cursor=pointer]
```

### Prototype unassigned changes (every timestamp and tree)
Timestamp `2091.065`
```text
    - [ref=*]:
      - [ref=*] main:
        - [ref=*] form "Login":
          - <changed> [ref=*] textbox "Username" [active]
```
Timestamp `5376.206`
```text
    - [ref=*]:
      - [ref=*] main:
        - [ref=*] form "Login":
          - <changed> [ref=*] textbox "Username": standard_user
          - <changed> [ref=*] textbox "Password" [active]
```
Timestamp `8594.694`
```text
    - [ref=*]:
      - [ref=*] main:
        - [ref=*] form "Login":
          - <changed> [ref=*] textbox "Password": secret_sauce
          - <changed> [ref=*] button "Login" [active] [cursor=pointer]
```

## visit_2 metadata
- `cause`: released `navigate`; prototype `navigate`
- `url`: released `https://www.saucedemo.com/inventory.html`; prototype `https://www.saucedemo.com/inventory.html`
- `visitId`: released `visit_2`; prototype `visit_2`

### Baseline, including every content/state mark
```diff
--- released
+++ prototype
@@ -3,8 +3,18 @@
     - [ref=*] banner:
       - [ref=*]:
         - [ref=*]:
-          - [ref=*] button "Open Menu" [cursor=pointer]
-          - [ref=*] img "Open Menu"
+          - [ref=*]:
+            - [ref=*]:
+              - [ref=*] button "Open Menu" [cursor=pointer]
+              - [ref=*] img "Open Menu"
+            - [ref=*]:
+              - [ref=*] navigation:
+                - [ref=*] button [cursor=pointer]: All Items
+                - [ref=*] button [cursor=pointer]: Dynamic Catalog
+                - [ref=*] link [cursor=pointer]: About
+                - [ref=*] button [cursor=pointer]: Logout
+                - [ref=*] button [cursor=pointer]: Reset App State
+              - [ref=*] button [cursor=pointer]: Close Menu
         - [ref=*]: Swag Labs
         - [ref=*] button "Cart, empty"
       - [ref=*]:
@@ -28,7 +38,7 @@
               - [ref=*]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
             - [ref=*]:
               - [ref=*]: $29.99
-              - [ref=*] button "Add to cart" [active] [cursor=pointer]
+              - [ref=*] button "Add to cart" [cursor=pointer]
         - [ref=*]:
           - [ref=*] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
             - [ref=*] img "Sauce Labs Bike Light"
```

## interaction_10 / interaction_6 ('[data-test="add-to-cart-sauce-labs-backpack"]')
- `button`: released `left`; prototype `left`
- `clickCount`: released `1`; prototype `1`
- `id`: released `interaction_10`; prototype `interaction_6`
- `modifiers`: released `0`; prototype `0`
- `targetRef`: released `e65`; prototype `e66`
- `targetSelector`: released `'[data-test="add-to-cart-sauce-labs-backpack"]'`; prototype `'[data-test="add-to-cart-sauce-labs-backpack"]'`
- `timestamp`: released `24134.557`; prototype `11223.593`
- `type`: released `click`; prototype `click`

### Interaction Change Tree
Identical after ref normalization.

## Trace point
- `afterSnapshotId`: released `after@interaction_10`; prototype `"107"`
- `beforeSnapshotId`: released `observation@000256`; prototype `"97"`
- `endedAt`: released `23628.097`; prototype `11400.979`
- `interactionId`: released `interaction_10`; prototype `interaction_6`
- `pageId`: released `page@6cedbaf1880789be333323a12a32711d`; prototype `page@c901dc19f0c014e2e4babaa08f00a440`
- `startedAt`: released `23628.097`; prototype `11223.593`

## interaction_11 / interaction_7 ('[data-test="shopping-cart-link"]')
- `button`: released `left`; prototype `left`
- `clickCount`: released `1`; prototype `1`
- `id`: released `interaction_11`; prototype `interaction_7`
- `modifiers`: released `0`; prototype `0`
- `targetRef`: released `e136`; prototype `e136`
- `targetSelector`: released `'[data-test="shopping-cart-link"]'`; prototype `'[data-test="shopping-cart-link"]'`
- `timestamp`: released `25112.956`; prototype `12519.921`
- `type`: released `click`; prototype `click`

### Interaction Change Tree
Identical after ref normalization.

## Trace point
- `beforeSnapshotId`: released `observation@000286`; prototype `"114"`
- `endedAt`: released `25144.474`; prototype `12530.921`
- `interactionId`: released `interaction_11`; prototype `interaction_7`
- `pageId`: released `page@6cedbaf1880789be333323a12a32711d`; prototype `page@c901dc19f0c014e2e4babaa08f00a440`
- `startedAt`: released `25144.474`; prototype `12519.921`

### Released unassigned changes (every timestamp and tree)

### Prototype unassigned changes (every timestamp and tree)
Timestamp `11213.593`
```text
    - [ref=*]:
      - [ref=*]:
        - [ref=*] banner:
          - [ref=*]:
            - <removed> [ref=*]:
              - <removed> [ref=*]:
                - <removed> [ref=*]:
                  - <removed> [ref=*] navigation:
                    - <removed> [ref=*] button [cursor=pointer]: All Items
                    - <removed> [ref=*] button [cursor=pointer]: Dynamic Catalog
                    - <removed> [ref=*] link [cursor=pointer]: About
                    - <removed> [ref=*] button [cursor=pointer]: Logout
                    - <removed> [ref=*] button [cursor=pointer]: Reset App State
                  - <removed> [ref=*] button [cursor=pointer]: Close Menu
        - [ref=*] main:
          - [ref=*]:
            - [ref=*]:
              - [ref=*]:
                - [ref=*]:
                  - <changed> [ref=*] button "Add to cart" [active] [cursor=pointer]
```

## visit_3 metadata
- `cause`: released `navigate`; prototype `navigate`
- `url`: released `https://www.saucedemo.com/cart.html`; prototype `https://www.saucedemo.com/cart.html`
- `visitId`: released `visit_3`; prototype `visit_3`

### Baseline, including every content/state mark
```diff
--- released
+++ prototype
@@ -1,9 +1,9 @@
-- [ref=*] [cursor=pointer]:
+- [ref=*]:
   - [ref=*]:
     - [ref=*] banner:
       - [ref=*]:
         - [ref=*]:
-          - [ref=*] button "Open Menu"
+          - [ref=*] button "Open Menu" [cursor=pointer]
           - [ref=*] img "Open Menu"
         - [ref=*]: Swag Labs
         - [ref=*] button "Cart, 1 items":
@@ -17,21 +17,21 @@
           - [ref=*]:
             - [ref=*]: 1
             - [ref=*]:
-              - [ref=*] button "View details for Sauce Labs Backpack":
+              - [ref=*] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                 - [ref=*]: Sauce Labs Backpack
               - [ref=*]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
               - [ref=*]:
                 - [ref=*]: $29.99
-                - [ref=*] button "Remove"
+                - [ref=*] button "Remove" [cursor=pointer]
         - [ref=*]:
-          - [ref=*] button "Continue Shopping"
-          - [ref=*] button "Checkout"
+          - [ref=*] button "Continue Shopping" [cursor=pointer]
+          - [ref=*] button "Checkout" [cursor=pointer]
   - [ref=*] contentinfo:
     - [ref=*] list:
       - [ref=*] listitem:
-        - [ref=*] link "X"
+        - [ref=*] link "X" [cursor=pointer]
       - [ref=*] listitem:
-        - [ref=*] link "Facebook"
+        - [ref=*] link "Facebook" [cursor=pointer]
       - [ref=*] listitem:
-        - [ref=*] link "LinkedIn"
+        - [ref=*] link "LinkedIn" [cursor=pointer]
     - [ref=*]: "© 2026 Sauce Labs. All Rights Reserved. Terms of Service | Privacy Policy"
```

Prototype-only interaction: `{"kind": "interaction", "timestamp": "15133.123", "interaction": {"id": "interaction_8", "type": "click", "targetRef": "e166", "targetSelector": "'[data-test=\"remove-sauce-labs-backpack\"]'", "button": "left", "modifiers": "0", "clickCount": "1"}, "change": ["    - [ref=*]:", "      - [ref=*]:", "        - [ref=*] banner:", "          - [ref=*]:", "            - <added> [ref=*] button \"Cart, empty\"", "            - <removed> [ref=*] button \"Cart, 1 items\":", "              - <removed> [ref=*]: 1", "        - [ref=*] main:", "          - [ref=*]:", "            - [ref=*]:", "              - <removed> [ref=*]:", "                - <removed> [ref=*]: 1", "                - <removed> [ref=*]:", "                  - <removed> [ref=*] button \"View details for Sauce Labs Backpack\" [cursor=pointer]:", "                    - <removed> [ref=*]: Sauce Labs Backpack", "                  - <removed> [ref=*]: \"carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection.\"", "                  - <removed> [ref=*]:", "                    - <removed> [ref=*]: $29.99", "                    - <removed> [ref=*] button \"Remove\" [active] [cursor=pointer]"]}`

Released-only interaction: `{"kind": "interaction", "timestamp": "33265.964", "interaction": {"id": "interaction_12", "type": "assertVisible", "targetRef": "e161", "targetSelector": "'[data-test=\"item-4-title-link\"]'"}, "change": []}`

### Released unassigned changes (every timestamp and tree)

### Prototype unassigned changes (every timestamp and tree)
Timestamp `15128.123`
```text
    - [ref=*]:
      - [ref=*]:
        - [ref=*] main:
          - [ref=*]:
            - [ref=*]:
              - [ref=*]:
                - [ref=*]:
                  - [ref=*]:
                    - <changed> [ref=*] button "Remove" [active] [cursor=pointer]
```

## Complete raw diff (every value, including all refs)

```diff
--- released
+++ prototype
@@ -1,12 +1,12 @@
-recordingId: rec_20261112T132544402Z
+recordingId: rec_20261112T145047604Z
 mode: structural
-createdAt: 2026-11-12T13:25:44.402Z
+createdAt: 2026-11-12T14:50:47.604Z
 url: https://www.saucedemo.com/
-tracePath: .ayme/recordings/rec_20261112T132544402Z/trace.zip
+tracePath: .ayme/recordings/rec_20261112T145047604Z/trace.zip
 visits:
   - visitId: visit_1
     url: https://www.saucedemo.com/
-    cause: navigate
+    cause: initial
     baselineTree:
       - [ref=e3]:
         - [ref=e4]: Swag Labs
@@ -22,39 +22,18 @@
             - [ref=e20]:
               - [ref=e21] heading "Password for all users:" [level=4]
               - text: secret_sauce
-        - [ref=e1] [active]
     timelineEntries:
-      - kind: interaction
-        timestamp: 12540.122
-        interaction:
-          id: interaction_1
-          type: click
-          targetRef: e18
-          targetSelector: '[data-test="login-credentials"]'
-          button: left
-          modifiers: 0
-          clickCount: 2
-      - kind: interaction
-        timestamp: 13156.748
-        interaction:
-          id: interaction_2
-          type: press
-          targetRef: e1
-          targetSelector: body
-          modifiers: 4
-          key: c
       - kind: change
-        timestamp: 13357.079
+        timestamp: 2091.065
         changeTree:
           - [ref=e3]:
             - [ref=e5] main:
               - [ref=e9] form "Login":
                 - <changed> [ref=e11] textbox "Username" [active]
-            - <changed> [ref=e1]
-      - kind: interaction
-        timestamp: 13882.34
-        interaction:
-          id: interaction_3
+      - kind: interaction
+        timestamp: 2103.065
+        interaction:
+          id: interaction_1
           type: click
           targetRef: e11
           targetSelector: '[data-test="username"]'
@@ -62,9 +41,9 @@
           modifiers: 0
           clickCount: 1
       - kind: interaction
-        timestamp: 14694.042
-        interaction:
-          id: interaction_4
+        timestamp: 3301.921
+        interaction:
+          id: interaction_2
           type: fill
           targetRef: e11
           targetSelector: '[data-test="username"]'
@@ -75,44 +54,17 @@
               - [ref=e9] form "Login":
                 - <changed> [ref=e11] textbox "Username" [active]: standard_user
       - kind: change
-        timestamp: 15332.541
+        timestamp: 5376.206
         changeTree:
           - [ref=e3]:
             - [ref=e5] main:
               - [ref=e9] form "Login":
                 - <changed> [ref=e11] textbox "Username": standard_user
-            - <changed> [ref=e1] [active]
-      - kind: interaction
-        timestamp: 16055.885
-        interaction:
-          id: interaction_5
-          type: click
-          targetRef: e20
-          targetSelector: '[data-test="login-password"]'
-          button: left
-          modifiers: 0
-          clickCount: 2
-      - kind: interaction
-        timestamp: 16564.529
-        interaction:
-          id: interaction_6
-          type: press
-          targetRef: e1
-          targetSelector: body
-          modifiers: 4
-          key: c
-      - kind: change
-        timestamp: 16747.758
-        changeTree:
-          - [ref=e3]:
-            - [ref=e5] main:
-              - [ref=e9] form "Login":
                 - <changed> [ref=e13] textbox "Password" [active]
-            - <changed> [ref=e1]
-      - kind: interaction
-        timestamp: 17002.654
-        interaction:
-          id: interaction_7
+      - kind: interaction
+        timestamp: 5380.206
+        interaction:
+          id: interaction_3
           type: click
           targetRef: e13
           targetSelector: '[data-test="password"]'
@@ -120,9 +72,9 @@
           modifiers: 0
           clickCount: 1
       - kind: interaction
-        timestamp: 17539.222
-        interaction:
-          id: interaction_8
+        timestamp: 6583.57
+        interaction:
+          id: interaction_4
           type: fill
           targetRef: e13
           targetSelector: '[data-test="password"]'
@@ -133,7 +85,7 @@
               - [ref=e9] form "Login":
                 - <changed> [ref=e13] textbox "Password" [active]: secret_sauce
       - kind: change
-        timestamp: 18065.018
+        timestamp: 8594.694
         changeTree:
           - [ref=e3]:
             - [ref=e5] main:
@@ -141,9 +93,9 @@
                 - <changed> [ref=e13] textbox "Password": secret_sauce
                 - <changed> [ref=e15] button "Login" [active] [cursor=pointer]
       - kind: interaction
-        timestamp: 18065.018
-        interaction:
-          id: interaction_9
+        timestamp: 8600.694
+        interaction:
+          id: interaction_5
           type: click
           targetRef: e15
           targetSelector: '[data-test="login-button"]'
@@ -158,9 +110,19 @@
         - [ref=e23]:
           - [ref=e24] banner:
             - [ref=e25]:
-              - [ref=e26]:
-                - [ref=e27] button "Open Menu" [cursor=pointer]
-                - [ref=e28] img "Open Menu"
+              - [ref=s_1]:
+                - [ref=s_2]:
+                  - [ref=e26]:
+                    - [ref=e27] button "Open Menu" [cursor=pointer]
+                    - [ref=e28] img "Open Menu"
+                  - [ref=e29]:
+                    - [ref=e31] navigation:
+                      - [ref=e32] button [cursor=pointer]: All Items
+                      - [ref=e33] button [cursor=pointer]: Dynamic Catalog
+                      - [ref=e35] link [cursor=pointer]: About
+                      - [ref=e36] button [cursor=pointer]: Logout
+                      - [ref=e37] button [cursor=pointer]: Reset App State
+                    - [ref=e39] button [cursor=pointer]: Close Menu
               - [ref=e41]: Swag Labs
               - [ref=e44] button "Cart, empty"
             - [ref=e45]:
@@ -176,86 +138,109 @@
             - [ref=e54]:
               - [ref=e55]:
                 - [ref=e57] button "View details for Sauce Labs Backpack" [cursor=pointer]:
-                  - [ref=e131] img "Sauce Labs Backpack"
-                - [ref=e58]:
-                  - [ref=e59]:
-                    - [ref=e60] button "View details for Sauce Labs Backpack" [cursor=pointer]:
-                      - [ref=e61]: Sauce Labs Backpack
-                    - [ref=e62]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
-                  - [ref=e63]:
-                    - [ref=e64]: $29.99
-                    - [ref=e65] button "Add to cart" [active] [cursor=pointer]
-              - [ref=e66]:
-                - [ref=e68] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
-                  - [ref=e130] img "Sauce Labs Bike Light"
-                - [ref=e69]:
-                  - [ref=e70]:
-                    - [ref=e71] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
-                      - [ref=e72]: Sauce Labs Bike Light
-                    - [ref=e73]: "A red light isn't the desired state in testing but it sure helps when riding your bike at night. Water-resistant with 3 lighting modes, 1 AAA battery included."
-                  - [ref=e74]:
-                    - [ref=e75]: $9.99
-                    - [ref=e76] button "Add to cart" [cursor=pointer]
-              - [ref=e77]:
-                - [ref=e79] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
-                  - [ref=e132] img "Sauce Labs Bolt T-Shirt"
-                - [ref=e80]:
-                  - [ref=e81]:
-                    - [ref=e82] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
-                      - [ref=e83]: Sauce Labs Bolt T-Shirt
-                    - [ref=e84]: "Get your testing superhero on with the Sauce Labs bolt T-shirt. From American Apparel, 100% ringspun combed cotton, heather gray with red bolt."
-                  - [ref=e85]:
-                    - [ref=e86]: $15.99
-                    - [ref=e87] button "Add to cart" [cursor=pointer]
-              - [ref=e88]:
-                - [ref=e90] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
-                  - [ref=e133] img "Sauce Labs Fleece Jacket"
-                - [ref=e91]:
-                  - [ref=e92]:
-                    - [ref=e93] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
-                      - [ref=e94]: Sauce Labs Fleece Jacket
-                    - [ref=e95]: "It's not every day that you come across a midweight quarter-zip fleece jacket capable of handling everything from a relaxing day outdoors to a busy day at the office."
+                  - [ref=e58] img "Sauce Labs Backpack"
+                - [ref=e59]:
+                  - [ref=e60]:
+                    - [ref=e61] button "View details for Sauce Labs Backpack" [cursor=pointer]:
+                      - [ref=e62]: Sauce Labs Backpack
+                    - [ref=e63]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
+                  - [ref=e64]:
+                    - [ref=e65]: $29.99
+                    - [ref=e66] button "Add to cart" [cursor=pointer]
+              - [ref=e67]:
+                - [ref=e69] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
+                  - [ref=e70] img "Sauce Labs Bike Light"
+                - [ref=e71]:
+                  - [ref=e72]:
+                    - [ref=e73] button "View details for Sauce Labs Bike Light" [cursor=pointer]:
+                      - [ref=e74]: Sauce Labs Bike Light
+                    - [ref=e75]: "A red light isn't the desired state in testing but it sure helps when riding your bike at night. Water-resistant with 3 lighting modes, 1 AAA battery included."
+                  - [ref=e76]:
+                    - [ref=e77]: $9.99
+                    - [ref=e78] button "Add to cart" [cursor=pointer]
+              - [ref=e79]:
+                - [ref=e81] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
+                  - [ref=e82] img "Sauce Labs Bolt T-Shirt"
+                - [ref=e83]:
+                  - [ref=e84]:
+                    - [ref=e85] button "View details for Sauce Labs Bolt T-Shirt" [cursor=pointer]:
+                      - [ref=e86]: Sauce Labs Bolt T-Shirt
+                    - [ref=e87]: "Get your testing superhero on with the Sauce Labs bolt T-shirt. From American Apparel, 100% ringspun combed cotton, heather gray with red bolt."
+                  - [ref=e88]:
+                    - [ref=e89]: $15.99
+                    - [ref=e90] button "Add to cart" [cursor=pointer]
+              - [ref=e91]:
+                - [ref=e93] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
+                  - [ref=e94] img "Sauce Labs Fleece Jacket"
+                - [ref=e95]:
                   - [ref=e96]:
-                    - [ref=e97]: $49.99
-                    - [ref=e98] button "Add to cart" [cursor=pointer]
-              - [ref=e99]:
-                - [ref=e101] button "View details for Sauce Labs Onesie" [cursor=pointer]:
-                  - [ref=e134] img "Sauce Labs Onesie"
-                - [ref=e102]:
-                  - [ref=e103]:
-                    - [ref=e104] button "View details for Sauce Labs Onesie" [cursor=pointer]:
-                      - [ref=e105]: Sauce Labs Onesie
-                    - [ref=e106]: "Rib snap infant onesie for the junior automation engineer in development. Reinforced 3-snap bottom closure, two-needle hemmed sleeved and bottom won't unravel."
-                  - [ref=e107]:
-                    - [ref=e108]: $7.99
-                    - [ref=e109] button "Add to cart" [cursor=pointer]
-              - [ref=e110]:
-                - [ref=e112] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
-                  - [ref=e135] img "Test.allTheThings() T-Shirt (Red)"
-                - [ref=e113]:
-                  - [ref=e114]:
-                    - [ref=e115] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
-                      - [ref=e116]: Test.allTheThings() T-Shirt (Red)
-                    - [ref=e117]: This classic Sauce Labs t-shirt is perfect to wear when cozying up to your keyboard to automate a few tests. Super-soft and comfy ringspun combed cotton.
-                  - [ref=e118]:
-                    - [ref=e119]: $15.99
-                    - [ref=e120] button "Add to cart" [cursor=pointer]
-        - [ref=e121] contentinfo:
-          - [ref=e122] list:
-            - [ref=e123] listitem:
-              - [ref=e124] link "X" [cursor=pointer]
-            - [ref=e125] listitem:
-              - [ref=e126] link "Facebook" [cursor=pointer]
-            - [ref=e127] listitem:
-              - [ref=e128] link "LinkedIn" [cursor=pointer]
-          - [ref=e129]: "© 2026 Sauce Labs. All Rights Reserved. Terms of Service | Privacy Policy"
+                    - [ref=e97] button "View details for Sauce Labs Fleece Jacket" [cursor=pointer]:
+                      - [ref=e98]: Sauce Labs Fleece Jacket
+                    - [ref=e99]: "It's not every day that you come across a midweight quarter-zip fleece jacket capable of handling everything from a relaxing day outdoors to a busy day at the office."
+                  - [ref=e100]:
+                    - [ref=e101]: $49.99
+                    - [ref=e102] button "Add to cart" [cursor=pointer]
+              - [ref=e103]:
+                - [ref=e105] button "View details for Sauce Labs Onesie" [cursor=pointer]:
+                  - [ref=e106] img "Sauce Labs Onesie"
+                - [ref=e107]:
+                  - [ref=e108]:
+                    - [ref=e109] button "View details for Sauce Labs Onesie" [cursor=pointer]:
+                      - [ref=e110]: Sauce Labs Onesie
+                    - [ref=e111]: "Rib snap infant onesie for the junior automation engineer in development. Reinforced 3-snap bottom closure, two-needle hemmed sleeved and bottom won't unravel."
+                  - [ref=e112]:
+                    - [ref=e113]: $7.99
+                    - [ref=e114] button "Add to cart" [cursor=pointer]
+              - [ref=e115]:
+                - [ref=e117] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
+                  - [ref=e118] img "Test.allTheThings() T-Shirt (Red)"
+                - [ref=e119]:
+                  - [ref=e120]:
+                    - [ref=e121] button "View details for Test.allTheThings() T-Shirt (Red)" [cursor=pointer]:
+                      - [ref=e122]: Test.allTheThings() T-Shirt (Red)
+                    - [ref=e123]: This classic Sauce Labs t-shirt is perfect to wear when cozying up to your keyboard to automate a few tests. Super-soft and comfy ringspun combed cotton.
+                  - [ref=e124]:
+                    - [ref=e125]: $15.99
+                    - [ref=e126] button "Add to cart" [cursor=pointer]
+        - [ref=e127] contentinfo:
+          - [ref=e128] list:
+            - [ref=e129] listitem:
+              - [ref=e130] link "X" [cursor=pointer]
+            - [ref=e131] listitem:
+              - [ref=e132] link "Facebook" [cursor=pointer]
+            - [ref=e133] listitem:
+              - [ref=e134] link "LinkedIn" [cursor=pointer]
+          - [ref=e135]: "© 2026 Sauce Labs. All Rights Reserved. Terms of Service | Privacy Policy"
     timelineEntries:
-      - kind: interaction
-        timestamp: 24134.557
-        interaction:
-          id: interaction_10
-          type: click
-          targetRef: e65
+      - kind: change
+        timestamp: 11213.593
+        changeTree:
+          - [ref=e22]:
+            - [ref=e23]:
+              - [ref=e24] banner:
+                - [ref=e25]:
+                  - <removed> [ref=s_1]:
+                    - <removed> [ref=s_2]:
+                      - <removed> [ref=e29]:
+                        - <removed> [ref=e31] navigation:
+                          - <removed> [ref=e32] button [cursor=pointer]: All Items
+                          - <removed> [ref=e33] button [cursor=pointer]: Dynamic Catalog
+                          - <removed> [ref=e35] link [cursor=pointer]: About
+                          - <removed> [ref=e36] button [cursor=pointer]: Logout
+                          - <removed> [ref=e37] button [cursor=pointer]: Reset App State
+                        - <removed> [ref=e39] button [cursor=pointer]: Close Menu
+              - [ref=e51] main:
+                - [ref=e54]:
+                  - [ref=e55]:
+                    - [ref=e59]:
+                      - [ref=e64]:
+                        - <changed> [ref=e66] button "Add to cart" [active] [cursor=pointer]
+      - kind: interaction
+        timestamp: 11223.593
+        interaction:
+          id: interaction_6
+          type: click
+          targetRef: e66
           targetSelector: '[data-test="add-to-cart-sauce-labs-backpack"]'
           button: left
           modifiers: 0
@@ -271,14 +256,14 @@
               - [ref=e51] main:
                 - [ref=e54]:
                   - [ref=e55]:
-                    - [ref=e58]:
-                      - [ref=e63]:
+                    - [ref=e59]:
+                      - [ref=e64]:
                         - <added> [ref=e138] button "Remove" [cursor=pointer]
-                        - <removed> [ref=e65] button "Add to cart" [active] [cursor=pointer]
-      - kind: interaction
-        timestamp: 25112.956
-        interaction:
-          id: interaction_11
+                        - <removed> [ref=e66] button "Add to cart" [active] [cursor=pointer]
+      - kind: interaction
+        timestamp: 12519.921
+        interaction:
+          id: interaction_7
           type: click
           targetRef: e136
           targetSelector: '[data-test="shopping-cart-link"]'
@@ -289,12 +274,12 @@
     url: https://www.saucedemo.com/cart.html
     cause: navigate
     baselineTree:
-      - [ref=e139] [cursor=pointer]:
+      - [ref=e139]:
         - [ref=e140]:
           - [ref=e141] banner:
             - [ref=e142]:
               - [ref=e143]:
-                - [ref=e144] button "Open Menu"
+                - [ref=e144] button "Open Menu" [cursor=pointer]
                 - [ref=e145] img "Open Menu"
               - [ref=e146]: Swag Labs
               - [ref=e149] button "Cart, 1 items":
@@ -308,100 +293,111 @@
                 - [ref=e158]:
                   - [ref=e159]: 1
                   - [ref=e160]:
-                    - [ref=e161] button "View details for Sauce Labs Backpack":
+                    - [ref=e161] button "View details for Sauce Labs Backpack" [cursor=pointer]:
                       - [ref=e162]: Sauce Labs Backpack
                     - [ref=e163]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
                     - [ref=e164]:
                       - [ref=e165]: $29.99
-                      - [ref=e166] button "Remove"
+                      - [ref=e166] button "Remove" [cursor=pointer]
               - [ref=e167]:
-                - [ref=e168] button "Continue Shopping"
-                - [ref=e169] button "Checkout"
+                - [ref=e168] button "Continue Shopping" [cursor=pointer]
+                - [ref=e169] button "Checkout" [cursor=pointer]
         - [ref=e170] contentinfo:
           - [ref=e171] list:
             - [ref=e172] listitem:
-              - [ref=e173] link "X"
+              - [ref=e173] link "X" [cursor=pointer]
             - [ref=e174] listitem:
-              - [ref=e175] link "Facebook"
+              - [ref=e175] link "Facebook" [cursor=pointer]
             - [ref=e176] listitem:
-              - [ref=e177] link "LinkedIn"
+              - [ref=e177] link "LinkedIn" [cursor=pointer]
           - [ref=e178]: "© 2026 Sauce Labs. All Rights Reserved. Terms of Service | Privacy Policy"
     timelineEntries:
-      - kind: interaction
-        timestamp: 33265.964
-        interaction:
-          id: interaction_12
-          type: assertVisible
-          targetRef: e161
-          targetSelector: '[data-test="item-4-title-link"]'
+      - kind: change
+        timestamp: 15128.123
+        changeTree:
+          - [ref=e139]:
+            - [ref=e140]:
+              - [ref=e153] main:
+                - [ref=e154]:
+                  - [ref=e155]:
+                    - [ref=e158]:
+                      - [ref=e160]:
+                        - [ref=e164]:
+                          - <changed> [ref=e166] button "Remove" [active] [cursor=pointer]
+      - kind: interaction
+        timestamp: 15133.123
+        interaction:
+          id: interaction_8
+          type: click
+          targetRef: e166
+          targetSelector: '[data-test="remove-sauce-labs-backpack"]'
+          button: left
+          modifiers: 0
+          clickCount: 1
+        changeTree:
+          - [ref=e139]:
+            - [ref=e140]:
+              - [ref=e141] banner:
+                - [ref=e142]:
+                  - <added> [ref=e179] button "Cart, empty"
+                  - <removed> [ref=e149] button "Cart, 1 items":
+                    - <removed> [ref=e150]: 1
+              - [ref=e153] main:
+                - [ref=e154]:
+                  - [ref=e155]:
+                    - <removed> [ref=e158]:
+                      - <removed> [ref=e159]: 1
+                      - <removed> [ref=e160]:
+                        - <removed> [ref=e161] button "View details for Sauce Labs Backpack" [cursor=pointer]:
+                          - <removed> [ref=e162]: Sauce Labs Backpack
+                        - <removed> [ref=e163]: "carry.allTheThings() with the sleek, streamlined Sly Pack that melds uncompromising style with unequaled laptop and tablet protection."
+                        - <removed> [ref=e164]:
+                          - <removed> [ref=e165]: $29.99
+                          - <removed> [ref=e166] button "Remove" [active] [cursor=pointer]
 traceActionPoints:
   - interactionId: interaction_1
-    pageId: page@6cedbaf1880789be333323a12a32711d
-    beforeSnapshotId: observation@000035
-    afterSnapshotId: after@interaction_1
-    startedAt: 12271.99
-    endedAt: 12271.99
+    pageId: page@c901dc19f0c014e2e4babaa08f00a440
+    beforeSnapshotId: "21"
+    afterSnapshotId: "31"
+    startedAt: 2103.065
+    endedAt: 2286.135
   - interactionId: interaction_2
-    pageId: page@6cedbaf1880789be333323a12a32711d
-    beforeSnapshotId: observation@000041
-    afterSnapshotId: after@interaction_2
-    startedAt: 12634.867
-    endedAt: 12634.867
+    pageId: page@c901dc19f0c014e2e4babaa08f00a440
+    beforeSnapshotId: "31"
+    afterSnapshotId: "41"
+    startedAt: 3301.921
+    endedAt: 4306.795
   - interactionId: interaction_3
-    pageId: page@6cedbaf1880789be333323a12a32711d
-    beforeSnapshotId: observation@000055
-    afterSnapshotId: after@interaction_3
-    startedAt: 13379.637
-    endedAt: 13379.637
+    pageId: page@c901dc19f0c014e2e4babaa08f00a440
+    beforeSnapshotId: "46"
+    afterSnapshotId: "56"
+    startedAt: 5380.206
+    endedAt: 5547.308
   - interactionId: interaction_4
-    pageId: page@6cedbaf1880789be333323a12a32711d
-    beforeSnapshotId: observation@000071
-    afterSnapshotId: after@interaction_4
-    startedAt: 14191.422
-    endedAt: 14191.422
+    pageId: page@c901dc19f0c014e2e4babaa08f00a440
+    beforeSnapshotId: "56"
+    afterSnapshotId: "66"
+    startedAt: 6583.57
+    endedAt: 7556.087
   - interactionId: interaction_5
-    pageId: page@6cedbaf1880789be333323a12a32711d
-    beforeSnapshotId: observation@000098
-    afterSnapshotId: after@interaction_5
-    startedAt: 15551.305
-    endedAt: 15551.305
+    pageId: page@c901dc19f0c014e2e4babaa08f00a440
+    beforeSnapshotId: "71"
+    startedAt: 8600.694
+    endedAt: 8618.694
   - interactionId: interaction_6
-    pageId: page@6cedbaf1880789be333323a12a32711d
-    beforeSnapshotId: after@interaction_5
-    afterSnapshotId: after@interaction_6
-    startedAt: 16060.411
-    endedAt: 16060.411
+    pageId: page@c901dc19f0c014e2e4babaa08f00a440
+    beforeSnapshotId: "97"
+    afterSnapshotId: "107"
+    startedAt: 11223.593
+    endedAt: 11400.979
   - interactionId: interaction_7
-    pageId: page@6cedbaf1880789be333323a12a32711d
-    beforeSnapshotId: observation@000122
-    afterSnapshotId: after@interaction_7
-    startedAt: 16775.538
-    endedAt: 16775.538
+    pageId: page@c901dc19f0c014e2e4babaa08f00a440
+    beforeSnapshotId: "114"
+    startedAt: 12519.921
+    endedAt: 12530.921
   - interactionId: interaction_8
-    pageId: page@6cedbaf1880789be333323a12a32711d
-    beforeSnapshotId: observation@000127
-    afterSnapshotId: after@interaction_8
-    startedAt: 17036.285
-    endedAt: 17036.285
-  - interactionId: interaction_9
-    pageId: page@6cedbaf1880789be333323a12a32711d
-    beforeSnapshotId: observation@000148
-    startedAt: 18109.366
-    endedAt: 18109.366
-  - interactionId: interaction_10
-    pageId: page@6cedbaf1880789be333323a12a32711d
-    beforeSnapshotId: observation@000256
-    afterSnapshotId: after@interaction_10
-    startedAt: 23628.097
-    endedAt: 23628.097
-  - interactionId: interaction_11
-    pageId: page@6cedbaf1880789be333323a12a32711d
-    beforeSnapshotId: observation@000286
-    startedAt: 25144.474
-    endedAt: 25144.474
-  - interactionId: interaction_12
-    pageId: page@6cedbaf1880789be333323a12a32711d
-    beforeSnapshotId: observation@000435
-    afterSnapshotId: after@interaction_12
-    startedAt: 32760.061
-    endedAt: 32760.061
+    pageId: page@c901dc19f0c014e2e4babaa08f00a440
+    beforeSnapshotId: "134"
+    afterSnapshotId: "144"
+    startedAt: 15133.123
+    endedAt: 15306.302
```

Compared 3 visits, 12 released and 8 prototype interactions; complete raw diff above.
