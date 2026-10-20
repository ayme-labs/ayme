import config from "@ayme-dev/eslint-config/base";

export default [...config, { ignores: ["dist-without-ayme/**"] }];
