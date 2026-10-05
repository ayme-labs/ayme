# Browser setup

Set up the connection as [Connect an agent](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md)
describes, and diagnose with its "When it does not connect" section.

- Check the connection end to end: invoke the exposed action through the relay
  and confirm its visible effect in the app. A direct Ayme call or a page-state
  read alone does not check the relay.
- When Chrome asks to allow local network access, ask the user to allow it,
  then reload.
- WebMCP is evolving. If the runtime contract differs from the guide, consult
  the relay's upstream README and report the mismatch to the user; leave
  browser globals as they are.
