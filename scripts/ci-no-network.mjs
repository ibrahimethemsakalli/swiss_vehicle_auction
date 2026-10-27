import { createRequire, syncBuiltinESMExports } from 'node:module';
const require = createRequire(import.meta.url);
const denied = () => {
  throw new Error('CI_NETWORK_DISABLED: unit tests must inject a provider stub');
};
globalThis.fetch = async () => denied();
for (const name of ['node:http', 'node:https']) {
  const module = require(name);
  module.request = denied;
  module.get = denied;
}
const net = require('node:net');
net.connect = denied;
net.createConnection = denied;
require('node:tls').connect = denied;
syncBuiltinESMExports();
