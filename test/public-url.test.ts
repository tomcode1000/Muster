import { test } from "node:test";
import assert from "node:assert/strict";
import { publicBase, publicHost } from "../src/public-url";

function withEnv(env: Record<string, string | undefined>, body: () => void) {
  const before = { MUSTER_PUBLIC_URL: process.env.MUSTER_PUBLIC_URL, HOSTNAME: process.env.HOSTNAME };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    body();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("MUSTER_PUBLIC_URL wins, without its trailing slash", () => {
  withEnv({ MUSTER_PUBLIC_URL: "https://muster.onrender.com/", HOSTNAME: "https://tunnel.example" }, () => {
    assert.equal(publicBase(), "https://muster.onrender.com");
    assert.equal(publicHost(), "muster.onrender.com");
  });
});

test("HOSTNAME is still read when it holds a real address", () => {
  withEnv({ MUSTER_PUBLIC_URL: undefined, HOSTNAME: "https://abc123.trycloudflare.com" }, () => {
    assert.equal(publicBase(), "https://abc123.trycloudflare.com");
  });
});

// Container platforms set HOSTNAME to the instance id. Handing that to Twilio
// would dial calls at an address that does not exist, and the failure would be
// silent, so it counts as unset instead.
test("a bare container hostname counts as unset", () => {
  withEnv({ MUSTER_PUBLIC_URL: undefined, HOSTNAME: "srv-d1abc2de3f4g5h6i7j8k" }, () => {
    assert.equal(publicBase(), "");
    assert.equal(publicHost(), "");
  });
});

test("nothing set is nothing set", () => {
  withEnv({ MUSTER_PUBLIC_URL: undefined, HOSTNAME: undefined }, () => {
    assert.equal(publicBase(), "");
  });
});
