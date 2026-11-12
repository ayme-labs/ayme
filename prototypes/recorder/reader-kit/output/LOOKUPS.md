# Reader lookup log

Proposed without user settlement, per brief: LoginPage, InventoryPage, CartPage,
Header, Product and CartItem; replay all eight interactions. Login can return
InventoryPage or LoginPage on error. No discarded entries.

Trace open: one command. Snapshot inspections: two commands, positions 107 and
134, both after. First inspection enumerated data-test attributes; output was
too large and partially truncated. Second inspection excluded images/links and
printed content. Counts below count element lookups, not every incidental node
returned by enumeration. Package selectors used directly need no trace lookup
and are not included in these counts.

| Element / package ref | Why | Package selector? | Found how | Trace commands | Confidence |
|---|---|---|---|---|---|---|
| Product card e55 | repeated component root | No | Other: enumerate data-test nodes at 107; repeated inventory-item wrappers | 1 shared | High |
| Product name e62 | select backpack component | No | Other: enumerate data-test nodes at 107 | 1 shared | High |
| Header e24 | shared component root | No | Other: enumerate data-test nodes at 107 | 1 shared | High |
| Cart badge e137/e150 | assert count and later absence | No | Content and ancestors: data-test enumeration at 107, confirmed text 1 at 134 | 2 shared | High |
| Page title e46/e151 | navigation assertion | No | Content and ancestors: enumeration at 107 and title text Your Cart at 134 | 2 shared | High |
| Cart row e158 | repeated component root and disappearance | No | Content and ancestors: inventory-item containing backpack text at 134 | 1 shared | High |
| Cart product name e162 | retained value assertion | No | Content and ancestors: inventory-item-name with backpack text at 134 | 1 shared | High |

Direct package candidates retained: username e11, password e13, login e15,
add e66, cart e136, remove e166. These are data-test selectors and meet the
strategy; no trace command needed to discover them.

Unresolved lookup: login error (no ref). The recording has only successful
login. To implement the mandated union outcome I used a conventional data-test
error candidate without trace evidence. This is an uncertain lookup, found
not at all in the trace; zero commands. A recorded failed-login snapshot or
documented error selector would make this easy. The live successful run cannot
validate the error branch.

No weaker assertion was chosen due to lookup difficulty. Acted-on add/remove
button replacement is omitted per the rule excluding the acted element's own
change; badge and row changes are checked. Menu disappearance was unrelated.
The instruction to ask about unrecorded outcomes cannot be followed in this
trial; the error branch above is the explicit assumption.

Counts: 8 total; package selector 0; role/name 0; content/ancestors 4;
other 3; not found 1. Two snapshot commands shared across seven found elements.
