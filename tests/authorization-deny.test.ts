import assert from "node:assert/strict";
import test from "node:test";
import {
  clearVerifiedModelsCache,
  isVerifiedCatalogUser,
} from "../src/verified-users.js";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseKey: "sb_publishable_test-key",
};

test("un catálogo vacío deniega la verificación y no concede acceso", async () => {
  clearVerifiedModelsCache();
  const fetcher: typeof fetch = async () =>
    new Response("[]", { status: 200 });

  assert.equal(await isVerifiedCatalogUser(-100, 123, config, fetcher), false);
});

test("usuarios revocados o ajenos al catálogo no quedan autorizados", async () => {
  clearVerifiedModelsCache();
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify([
        { group_id: -100, user_id: 999, display_name: "Otra persona" },
      ]),
      { status: 200 },
    );

  assert.equal(await isVerifiedCatalogUser(-100, 123, config, fetcher), false);
});

test("un fallo de verificación rechaza en lugar de conceder acceso", async () => {
  clearVerifiedModelsCache();
  const fetcher: typeof fetch = async () =>
    new Response("{}", { status: 500 });

  await assert.rejects(
    isVerifiedCatalogUser(-100, 123, config, fetcher),
    /AFRODITA_SUPABASE_HTTP_500/u,
  );
});