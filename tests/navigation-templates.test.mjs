import test from "node:test";
import assert from "node:assert/strict";
import { wheelNavigation } from "../frontend/components/wheel-navigation.js";
import { templates, templateContent } from "../frontend/templates/catalog.js";
import { normalizeContent } from "../server/content.mjs";

test("wheel navigation responds immediately and never locks out continued scrolling", () => {
  let time = 0;
  const steps = [],
    handle = wheelNavigation(
      (d) => steps.push(d),
      () => time,
    );
  const wheel = (deltaY, deltaMode = 0) =>
    handle({ deltaY, deltaMode, deltaX: 0, ctrlKey: false });
  wheel(120);
  assert.deepEqual(steps, [1]);
  time = 120;
  wheel(120);
  assert.deepEqual(steps, [1, 1]);
  time = 230;
  wheel(-120);
  assert.deepEqual(steps, [1, 1, -1]);
  for (time = 500; time < 2100; time += 50) wheel(16.5);
  assert(
    steps.length >= 8,
    "sustained trackpad movement must continue advancing",
  );
  const before = steps.length;
  handle({ deltaX: 100, deltaY: 10, deltaMode: 0 });
  handle({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: true });
  assert.equal(steps.length, before);
});
test("small wheel noise does not navigate and line-mode wheels do", () => {
  let time = 0;
  const steps = [];
  const handle = wheelNavigation(
    (d) => steps.push(d),
    () => time,
  );
  handle({ deltaX: 0, deltaY: 1, deltaMode: 0 });
  time = 500;
  handle({ deltaX: 0, deltaY: 1, deltaMode: 0 });
  assert.equal(steps.length, 0);
  time = 1000;
  handle({ deltaX: 0, deltaY: 3, deltaMode: 1 });
  assert.deepEqual(steps, [1]);
});
test("every template creates editable, self-contained slides with matching notes", () => {
  for (const entry of templates) {
    const deck = templateContent(entry.id, "研发 <交流> & 分享");
    const normalized = normalizeContent(deck);
    assert.equal(normalized.slideCount, entry.pages);
    assert.equal(Object.keys(normalized.notes).length, entry.pages);
    assert(normalized.html.includes("研发 &lt;交流&gt; &amp; 分享"));
    assert(!/<script|<iframe|src="https?:/i.test(normalized.html));
    assert(deck.css.includes(".slide.tpl"));
    assert.equal(deck.width, 1600);
    assert.equal(deck.height, 900);
    if (entry.id !== "blank") assert(normalized.html.includes("<svg"));
  }
  assert.throws(() => templateContent("missing", "Title"));
});
