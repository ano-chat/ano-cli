import { describe, it, expect } from "vitest";
import { DEFAULT_CLIENT_IDS } from "../../src/cli/commands/auth/login.js";

/**
 * Pre-v2.25.3 the CLI mapped both staging AND the production apex
 * to the same WorkOS client_id (the staging one), making
 * `ano auth login --endpoint https://api.ano.dev` fail at token
 * exchange with `invalid_client`. These tests pin the contract:
 *
 *  - Staging gets the staging client_id
 *  - Apex (production) gets the PROD client_id
 *  - Resolved regional endpoints (api-us, api-eu) also get the
 *    prod client_id so `ano auth login --endpoint https://api-us.ano.dev`
 *    works directly post-region-resolution
 *
 * Source of truth for the literal values is Doppler:
 *   doppler secrets get WORKOS_CLIENT_ID --plain --project ano --config stg
 *   doppler secrets get WORKOS_CLIENT_ID --plain --project ano --config prd
 *
 * If you're updating these values, refresh the test's expected
 * constants from Doppler in the same PR.
 */
describe("auth login — DEFAULT_CLIENT_IDS", () => {
  const STAGING = "client_01KG774HCH15HC3EN79E7A9BV4";
  const PROD = "client_01KG774HNEGYXTDACJD2HFEF1A";

  it("staging endpoint maps to the staging client_id", () => {
    expect(DEFAULT_CLIENT_IDS["https://api-staging.ano.dev"]).toBe(STAGING);
  });

  it("apex (api.ano.dev) maps to the PRODUCTION client_id, not staging", () => {
    // Regression guard: pre-v2.25.3 this was the staging client_id,
    // which made `ano auth login --endpoint https://api.ano.dev`
    // fail at token exchange with `invalid_client`. The apex is the
    // CF Worker production routing — OAuth must use the prod
    // WorkOS environment.
    expect(DEFAULT_CLIENT_IDS["https://api.ano.dev"]).toBe(PROD);
    expect(DEFAULT_CLIENT_IDS["https://api.ano.dev"]).not.toBe(STAGING);
  });

  it("resolved prod regional endpoints share the prod client_id", () => {
    expect(DEFAULT_CLIENT_IDS["https://api-us.ano.dev"]).toBe(PROD);
    expect(DEFAULT_CLIENT_IDS["https://api-eu.ano.dev"]).toBe(PROD);
  });

  it("staging and prod client_ids are distinct", () => {
    expect(STAGING).not.toBe(PROD);
  });

  it("doesn't accidentally include a development/localhost entry", () => {
    // OAuth against dev:local doesn't make sense (no WorkOS env),
    // and entries here are public — must not leak any internal
    // /staging-only client_id under a localhost key.
    expect(DEFAULT_CLIENT_IDS["http://127.0.0.1:3001"]).toBeUndefined();
    expect(DEFAULT_CLIENT_IDS["http://localhost:3001"]).toBeUndefined();
  });
});
