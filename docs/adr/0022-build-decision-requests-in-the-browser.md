---
status: accepted
---

# Build decision requests in the browser; the Decision Endpoint only adds the key

The Goal Loop's request to the System One model (the questions, the state, the single `goal_met` cutoff) is built inside Ayme in the browser. The Decision Endpoint adds the model key and forwards the provider's exact request shape. It builds the upstream request from scratch, forwards no browser headers, uses a fixed upstream URL, accepts only the System One model family and caps the body size.

Only the key is secret; the question wording is open source. Building the request in a backend would split one concern across two places and two languages, and every non-JavaScript backend would have to re-implement it. A narrow endpoint is a one-route contract any backend can satisfy.

Ayme never hosts the endpoint and never lends a key. The key and an `authorize` function are both required, so an ungated endpoint cannot be deployed by accident. The app hands Ayme one function from decision request to decision response; a helper covers the common HTTP case. No dev-server plugin is shipped.
