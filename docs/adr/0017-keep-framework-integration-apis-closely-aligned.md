# Keep framework integration APIs closely aligned

ayme framework packages should expose equivalent capabilities with consistent terminology, option names, and Page Object contracts. Share framework-independent runtime behavior in core.

Prefer matching consumer APIs where the frameworks permit it. Allow framework-native differences when required for correct lifecycle or dependency propagation, and document those differences. Do not introduce redundant APIs or global mutable setup solely to make framework syntax identical.

Root setup owns runtime activation and cleanup. Page Object integration returns the instance directly and owns its registration lifetime.
