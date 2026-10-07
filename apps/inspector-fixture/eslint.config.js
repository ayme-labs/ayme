import config from "@ayme-dev/eslint-config/base";

// e2e's cache, output and the Ayme store under the harness are not source.
export default [...config, { ignores: ["e2e/.e2e/**"] }];
