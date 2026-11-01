import assert from "node:assert/strict";
import test from "node:test";
import { loadAfroditaConfig } from "../src/config.js";
import {
  clearVerifiedModelsCache,
  getActiveVerifiedModels,
  isVerifiedCatalogUser,
} from "../src/verified-users.js";

const config = {
  supabaseUrl: "https://example.supabase.co",
  supabaseKey: "sb_publishable_test-key",
};
const testBotToken = `12345678:${"x".repeat(35)}`;

test("un error de red no concede verificación ni devuelve resultados", async () => {
  clearVerifiedModelsCache();
  const fetcher: typeof fetch = async () => {
    throw new TypeError("fetch failed");
  };

  await assert.rejects(
    getActiveVerifiedModels(-100, config, fetcher),
    /AFRODITA_SUPABASE_NETWORK_ERROR/u,
  );
  await assert.rejects(
    isVerifiedCatalogUser(-100, 123, config, fetcher),
    /AFRODITA_SUPABASE_NETWORK_ERROR/u,
  );
});

test("el grupo debe ser un entero seguro distinto de cero antes de consultar", async () => {
  clearVerifiedModelsCache();
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return new Response("[]", { status: 200 });
  };

  for (const groupId of [0, -0, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
    await assert.rejects(
      getActiveVerifiedModels(groupId, config, fetcher),
      /AFRODITA_SUPABASE_GROUP_ID_INVALID/u,
    );
  }
  assert.equal(calls, 0);
});

test("una fila de otro grupo con el mismo user_id no autoriza en este grupo", async () => {
  clearVerifiedModelsCache();
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify([
        { group_id: -200, user_id: 123, display_name: "Ana de otro grupo" },
      ]),
      { status: 200 },
    );

  assert.deepEqual(await getActiveVerifiedModels(-100, config, fetcher), []);
  clearVerifiedModelsCache();
  assert.equal(await isVerifiedCatalogUser(-100, 123, config, fetcher), false);
});

test("filas malformadas se descartan y no conceden autorización", async () => {
  clearVerifiedModelsCache();
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify([
        "garbage",
        null,
        { group_id: -100, user_id: "123", display_name: "Id numérico como texto" },
        { group_id: -100, user_id: -5, display_name: "Id negativo" },
        { group_id: -100, user_id: 0, display_name: "Id cero" },
        { group_id: -100, display_name: "Sin user_id" },
        { group_id: -100, user_id: 123.5, display_name: "Id no entero" },
      ]),
      { status: 200 },
    );

  assert.deepEqual(await getActiveVerifiedModels(-100, config, fetcher), []);
  clearVerifiedModelsCache();
  assert.equal(await isVerifiedCatalogUser(-100, 123, config, fetcher), false);
});

test("una revocación persistida corta la autorización y un fallo posterior de red no la reactiva", async () => {
  clearVerifiedModelsCache();
  let mode: "active" | "revoked" | "offline" = "active";
  const fetcher: typeof fetch = async () => {
    if (mode === "offline") throw new TypeError("fetch failed");
    return new Response(
      JSON.stringify(
        mode === "active"
          ? [{ group_id: -100, user_id: 123, display_name: "Ana" }]
          : [],
      ),
      { status: 200 },
    );
  };

  assert.equal(await isVerifiedCatalogUser(-100, 123, config, fetcher), true);
  mode = "revoked";
  assert.equal(await isVerifiedCatalogUser(-100, 123, config, fetcher), false);
  mode = "offline";
  await assert.rejects(
    isVerifiedCatalogUser(-100, 123, config, fetcher),
    /AFRODITA_SUPABASE_NETWORK_ERROR/u,
  );
});

test("la configuración rechaza claves privilegiadas de Supabase", () => {
  for (const key of ["sb_secret_test_key", "service_role_test_key"]) {
    assert.throws(
      () =>
        loadAfroditaConfig({
          AFRODITA_BOT_TOKEN: testBotToken,
          AFRODITA_SUPABASE_URL: "https://example.supabase.co",
          AFRODITA_SUPABASE_KEY: key,
        }),
      /publishable o JWT anon/u,
    );
  }
});
