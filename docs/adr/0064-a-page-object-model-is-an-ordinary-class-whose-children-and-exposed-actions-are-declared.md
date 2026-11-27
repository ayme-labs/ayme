---
status: accepted
supersedes: ADR-0007, ADR-0048
---

# A Page Object Model is an ordinary class whose children and exposed actions are declared

## Why

Consumers should be able to reuse ordinary TypeScript Page Object Models with Playwright and WebMCP without adopting ayme base classes or duplicating their method schemas.

What a model holds cannot all be read from its types. A locator's type cannot say whether it stands for one element or for many: only the author knows. Inferring children from types took in helper locators that are not parts of the page, and guessed that a parameterless method returning Page Objects was a collection.

## Decision

- Ordinary TypeScript classes are Page Object Models, without ayme base classes. A class is a Page Object Model when it, or an ancestor, carries ayme's mark.
- The model is what its author declares. A member is a Page Object Child only when its model declares it, with one mark for a single child and another for a Child Collection, and either can carry a description. A member that is not declared is not a child, whatever its type, so a public locator can serve tests without entering the model. Page Object children are declared too, though their type already names their model, so that authors follow one rule, every child can carry a description, and the model is exactly what was declared.
- Only Page Object Actions whose declaration is explicitly marked become Page Object Tools, including a marked method a class inherits; an unmarked method never does, whatever its class.
- The build derives the development-time contract from TypeScript visibility and static types: action schemas from their signatures, and a declared child's model from its type, which must agree with the declaration.
- Because a child's declaration says whether it is one element or many, ayme can warn when a single child matches several elements, and names each element of a collection by its index.
- The build fails rather than guess, so an unsupported or ambiguous type gives a build diagnostic instead of a weak runtime schema: it fails on a type the compiler cannot represent, with no override for it, and on a declaration on a member that holds neither a locator nor a Page Object, on a shape the guide does not list, or whose type it cannot resolve.
- A Locator member that resolves to its Page Object's root is the root, not a child (ADR-0067). The Structural Page State marks only Page Object Roots; marking children is a separate decision.

## Considered and rejected

- Requiring ayme base classes or custom Page Object Model declarations. Consumers should be able to reuse their ordinary Page Object Models without adopting base classes or duplicating their method schemas.
- Inferring the production contract through runtime reflection. What was chosen gives a build diagnostic for an unsupported or ambiguous type, where a schema inferred at run time would be weak.
- Declaring only locator children and recognising Page Object children by their type. It keeps two rules and leaves undescribed children in the model.
- Keeping inference and using marks only to add descriptions. It keeps accidental children and leaves a locator's cardinality unknown.
- One mark for children, with the cardinality read from the type. A locator's type carries none.

## Cost

Every model declares its children, with no inference to fall back on. A declaration forgotten on a Page Object member silently removes that child from the model and, unless its model is reached another way, its tools from publication. The declarations buy explicitness, not a smaller compiler: the build's type analysis stays.
