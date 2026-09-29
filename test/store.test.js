import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryRedis, createStore, TTL_SECONDS } from "../lib/store.js";
import { parseLieu, parsePost, parseReply } from "../lib/validate.js";

function setup() {
  let t = 1_000_000_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const redis = createMemoryRedis(clock.now);
  return { clock, store: createStore(() => redis, clock.now) };
}

const input = { prenom: "Camille", age: 34, message: "Un verre ce soir ?" };

test("une annonce publiée apparaît sans son jeton de propriétaire", async () => {
  const { store } = setup();
  const { post, ownerToken } = await store.createPost("les-pins", input);
  assert.ok(ownerToken);
  const list = await store.listPosts("les-pins");
  assert.equal(list.length, 1);
  assert.equal(list[0].id, post.id);
  assert.equal(list[0].ownerHash, undefined);
});

test("les lieux sont séparés", async () => {
  const { store } = setup();
  await store.createPost("les-pins", input);
  assert.deepEqual(await store.listPosts("autre-lieu"), []);
});

test("tout disparaît après 48 h, réponses comprises", async () => {
  const { store, clock } = setup();
  const { post } = await store.createPost("les-pins", input);
  const full = await store.getPost("les-pins", post.id);
  await store.addReply("les-pins", full, { prenom: "Léo", message: "Avec plaisir" });

  clock.advance(TTL_SECONDS * 1000 - 60_000);
  const before = await store.listPosts("les-pins");
  assert.equal(before.length, 1);
  assert.equal(before[0].replies.length, 1);

  clock.advance(120_000);
  assert.deepEqual(await store.listPosts("les-pins"), []);
  assert.equal(await store.getPost("les-pins", post.id), null);
});

test("les annonces les plus récentes sont en premier", async () => {
  const { store, clock } = setup();
  await store.createPost("les-pins", { ...input, prenom: "A" });
  clock.advance(1000);
  await store.createPost("les-pins", { ...input, prenom: "B" });
  const list = await store.listPosts("les-pins");
  assert.deepEqual(list.map((p) => p.prenom), ["B", "A"]);
});

test("retirer une annonce l'efface", async () => {
  const { store } = setup();
  const { post } = await store.createPost("les-pins", input);
  await store.deletePost("les-pins", post.id);
  assert.deepEqual(await store.listPosts("les-pins"), []);
});

test("limite horaire", async () => {
  const { store, clock } = setup();
  for (let i = 0; i < 5; i++) assert.equal(await store.rateLimit("x", 5), true);
  assert.equal(await store.rateLimit("x", 5), false);
  clock.advance(3601_000);
  assert.equal(await store.rateLimit("x", 5), true);
});

test("validation des saisies", () => {
  assert.ok(parsePost(input).value);
  assert.match(parsePost({ ...input, age: 16 }).error, /18 ans/);
  assert.ok(parsePost({ ...input, prenom: "  " }).error);
  assert.ok(parsePost({ ...input, message: "x".repeat(281) }).error);
  assert.ok(parseReply({ prenom: "Léo", message: "" }).error);
  assert.equal(parseLieu("Les-Pins").value, "les-pins");
  assert.ok(parseLieu("../etc").error);
});
